ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS whatsapp_phone varchar;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS customer_name varchar;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS customer_phone varchar;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS customer_address text;

CREATE INDEX IF NOT EXISTS orders_delivery_phone_created_idx
  ON public.orders (tenant_id, customer_phone, created_at DESC)
  WHERE order_type = 'DELIVERY';

CREATE OR REPLACE FUNCTION public.rms_submit_delivery_order(
  p_tenant_slug text,
  p_customer_name text,
  p_customer_phone text,
  p_customer_address text,
  p_items jsonb
)
RETURNS TABLE(order_id uuid, order_number bigint, total_amount numeric, items jsonb)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_tenant_id uuid;
  v_order_id uuid;
  v_order_number bigint;
  v_total numeric(10,2);
  v_items jsonb;
BEGIN
  IF p_customer_name IS NULL OR char_length(btrim(p_customer_name)) < 2 OR char_length(btrim(p_customer_name)) > 120 THEN
    RAISE EXCEPTION 'INVALID_CUSTOMER_NAME' USING ERRCODE = '22023';
  END IF;
  IF p_customer_phone !~ '^03[0-9]{9}$' THEN
    RAISE EXCEPTION 'INVALID_CUSTOMER_PHONE' USING ERRCODE = '22023';
  END IF;
  IF p_customer_address IS NULL OR char_length(btrim(p_customer_address)) < 10 OR char_length(btrim(p_customer_address)) > 500 THEN
    RAISE EXCEPTION 'INVALID_CUSTOMER_ADDRESS' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items) = 0 OR jsonb_array_length(p_items) > 50 THEN
    RAISE EXCEPTION 'INVALID_ORDER_ITEMS' USING ERRCODE = '22023';
  END IF;

  SELECT t.id INTO v_tenant_id FROM public.tenants AS t WHERE t.slug = p_tenant_slug;
  IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'TENANT_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_tenant_id::text || ':' || p_customer_phone, 0));
  IF (SELECT count(*) FROM public.orders AS o WHERE o.tenant_id = v_tenant_id AND o.customer_phone = p_customer_phone AND o.order_type = 'DELIVERY' AND o.created_at >= now() - interval '1 hour') >= 5 THEN
    RAISE EXCEPTION 'DELIVERY_RATE_LIMIT' USING ERRCODE = 'P0001';
  END IF;

  WITH requested AS (
    SELECT x.item_id, sum(x.quantity)::integer AS quantity
    FROM pg_catalog.jsonb_to_recordset(p_items) AS x(item_id uuid, quantity integer)
    GROUP BY x.item_id
  ), resolved AS (
    SELECT mi.id AS item_id, mi.name, mi.price, r.quantity
    FROM requested AS r JOIN public.menu_items AS mi ON mi.id = r.item_id AND mi.tenant_id = v_tenant_id
    WHERE mi.in_stock = true AND r.quantity BETWEEN 1 AND 99
  )
  SELECT pg_catalog.sum(price * quantity)::numeric(10,2),
         pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('item_id', item_id, 'name', name, 'quantity', quantity, 'price', price))
    INTO v_total, v_items FROM resolved;
  IF v_items IS NULL OR pg_catalog.jsonb_array_length(v_items) <> (SELECT count(DISTINCT x.item_id) FROM pg_catalog.jsonb_to_recordset(p_items) AS x(item_id uuid, quantity integer))
     OR EXISTS (SELECT 1 FROM pg_catalog.jsonb_to_recordset(p_items) AS x(item_id uuid, quantity integer) WHERE x.item_id IS NULL OR x.quantity IS NULL OR x.quantity NOT BETWEEN 1 AND 99) THEN
    RAISE EXCEPTION 'INVALID_OR_UNAVAILABLE_MENU_ITEM' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.orders AS created_order (tenant_id, order_type, status, total_amount, sync_status, customer_name, customer_phone, customer_address)
  VALUES (v_tenant_id, 'DELIVERY', 'PENDING', v_total, 'SYNCED', btrim(p_customer_name), p_customer_phone, btrim(p_customer_address))
  RETURNING created_order.id, created_order.order_number INTO v_order_id, v_order_number;

  INSERT INTO public.order_items (order_id, menu_item_id, quantity, price_at_order)
  SELECT v_order_id, (entry->>'item_id')::uuid, (entry->>'quantity')::integer, (entry->>'price')::numeric
  FROM pg_catalog.jsonb_array_elements(v_items) AS entries(entry);

  RETURN QUERY SELECT v_order_id, v_order_number, v_total, v_items;
END;
$$;

REVOKE ALL ON FUNCTION public.rms_submit_delivery_order(text, text, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rms_submit_delivery_order(text, text, text, text, jsonb) TO service_role;
