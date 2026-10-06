-- A tenant's one counter terminal owns a monotonically increasing local sequence.
-- The unique key makes retries idempotent even if the browser loses the sync response.
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS local_sequence_no integer;
CREATE UNIQUE INDEX IF NOT EXISTS orders_tenant_local_sequence_unique
  ON public.orders (tenant_id, local_sequence_no);

CREATE OR REPLACE FUNCTION public.rms_sync_offline_order(
  p_tenant_id uuid,
  p_local_sequence_no integer,
  p_order jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_order_id uuid;
  v_order_number bigint;
  v_table_id uuid;
  v_total numeric(10,2);
  v_item_count integer;
BEGIN
  IF p_tenant_id IS NULL OR p_local_sequence_no IS NULL OR p_local_sequence_no < 1
     OR jsonb_typeof(p_order) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'INVALID_OFFLINE_ORDER' USING ERRCODE = '22023';
  END IF;

  -- Existing sequence means this exact local order was already committed.
  SELECT o.id, o.order_number INTO v_order_id, v_order_number
  FROM public.orders AS o
  WHERE o.tenant_id = p_tenant_id AND o.local_sequence_no = p_local_sequence_no;
  IF v_order_id IS NOT NULL THEN
    RETURN jsonb_build_object('id', v_order_id, 'order_number', v_order_number, 'duplicate', true);
  END IF;

  IF p_order->>'order_type' IS NULL OR p_order->>'order_type' NOT IN ('DINE_IN', 'DELIVERY')
     OR jsonb_typeof(p_order->'items') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'INVALID_OFFLINE_ORDER' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p_order->'items') < 1 OR jsonb_array_length(p_order->'items') > 50 THEN
    RAISE EXCEPTION 'INVALID_OFFLINE_ORDER' USING ERRCODE = '22023';
  END IF;

  IF p_order->>'order_type' = 'DINE_IN' THEN
    SELECT t.id INTO v_table_id
    FROM public.restaurant_tables AS t
    WHERE t.tenant_id = p_tenant_id AND t.table_number = p_order->>'table_number';
    IF v_table_id IS NULL THEN RAISE EXCEPTION 'OFFLINE_ORDER_TABLE_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_order->'items') AS x(item_id uuid, quantity integer, price_at_order numeric)
    LEFT JOIN public.menu_items AS mi ON mi.id = x.item_id AND mi.tenant_id = p_tenant_id
    WHERE x.item_id IS NULL OR x.quantity IS NULL OR x.quantity NOT BETWEEN 1 AND 99
      OR x.price_at_order IS NULL OR x.price_at_order < 0 OR mi.id IS NULL
  ) THEN
    RAISE EXCEPTION 'INVALID_OFFLINE_ORDER_ITEM' USING ERRCODE = '22023';
  END IF;

  SELECT count(*), sum(x.quantity * x.price_at_order)::numeric(10,2)
    INTO v_item_count, v_total
  FROM jsonb_to_recordset(p_order->'items') AS x(item_id uuid, quantity integer, price_at_order numeric);
  IF v_item_count < 1 OR v_item_count > 50 THEN RAISE EXCEPTION 'INVALID_OFFLINE_ORDER_ITEMS' USING ERRCODE = '22023'; END IF;

  INSERT INTO public.orders (
    tenant_id, table_id, order_type, status, customer_name, customer_phone,
    customer_address, total_amount, sync_status, local_sequence_no, created_at
  ) VALUES (
    p_tenant_id, v_table_id, p_order->>'order_type', 'PENDING',
    nullif(p_order->>'customer_name', ''), nullif(p_order->>'customer_phone', ''),
    nullif(p_order->>'customer_address', ''), v_total, 'SYNCED', p_local_sequence_no,
    coalesce(nullif(p_order->>'created_at', '')::timestamptz, now())
  ) ON CONFLICT (tenant_id, local_sequence_no) DO NOTHING
  RETURNING id, order_number INTO v_order_id, v_order_number;

  IF v_order_id IS NULL THEN
    SELECT o.id, o.order_number INTO v_order_id, v_order_number
    FROM public.orders AS o
    WHERE o.tenant_id = p_tenant_id AND o.local_sequence_no = p_local_sequence_no;
    RETURN jsonb_build_object('id', v_order_id, 'order_number', v_order_number, 'duplicate', true);
  END IF;

  INSERT INTO public.order_items(order_id, menu_item_id, quantity, price_at_order)
  SELECT v_order_id, x.item_id, x.quantity, x.price_at_order
  FROM jsonb_to_recordset(p_order->'items') AS x(item_id uuid, quantity integer, price_at_order numeric);

  RETURN jsonb_build_object('id', v_order_id, 'order_number', v_order_number, 'total_amount', v_total, 'duplicate', false);
END;
$$;

REVOKE ALL ON FUNCTION public.rms_sync_offline_order(uuid, integer, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rms_sync_offline_order(uuid, integer, jsonb) TO service_role;
