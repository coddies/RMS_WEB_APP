-- Tenant pairing key is one-time shown by the trusted onboarding process.
-- Store only its SHA-256 verifier in tenants.license_key.
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS license_key text,
  ADD COLUMN IF NOT EXISTS hardware_fingerprint text;

CREATE UNIQUE INDEX IF NOT EXISTS tenants_license_key_unique
  ON public.tenants (license_key) WHERE license_key IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.tenants'::regclass AND conname = 'tenants_license_key_hash_format') THEN
    ALTER TABLE public.tenants ADD CONSTRAINT tenants_license_key_hash_format
      CHECK (license_key IS NULL OR license_key ~ '^[a-f0-9]{64}$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.tenants'::regclass AND conname = 'tenants_hardware_fingerprint_format') THEN
    ALTER TABLE public.tenants ADD CONSTRAINT tenants_hardware_fingerprint_format
      CHECK (hardware_fingerprint IS NULL OR hardware_fingerprint ~ '^[a-f0-9]{64}$');
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.rms_issue_pairing_key(p_tenant_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  one_time_key text;
  key_material text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.tenants WHERE id = p_tenant_id) THEN
    RAISE EXCEPTION 'TENANT_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  -- Two independent v4 UUIDs provide 244 bits of random key material.
  key_material := replace(pg_catalog.gen_random_uuid()::text, '-', '')
               || replace(pg_catalog.gen_random_uuid()::text, '-', '');
  one_time_key := 'rms_' || key_material;

  UPDATE public.tenants
  SET license_key = pg_catalog.encode(
    pg_catalog.sha256(pg_catalog.convert_to(one_time_key, 'UTF8')), 'hex'
  ), hardware_fingerprint = NULL
  WHERE id = p_tenant_id;

  RETURN one_time_key;
END;
$$;

REVOKE ALL ON FUNCTION public.rms_issue_pairing_key(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rms_issue_pairing_key(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.rms_pair_local_bridge(p_license_key text, p_fingerprint text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  paired_tenant public.tenants%ROWTYPE;
  supplied_hash text;
BEGIN
  IF p_license_key IS NULL OR p_license_key !~ '^rms_[a-f0-9]{64}$'
     OR p_fingerprint IS NULL OR p_fingerprint !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'PAIRING_KEY_INVALID' USING ERRCODE = '28000';
  END IF;

  supplied_hash := pg_catalog.encode(
    pg_catalog.sha256(pg_catalog.convert_to(p_license_key, 'UTF8')), 'hex'
  );

  SELECT * INTO paired_tenant
  FROM public.tenants
  WHERE license_key = supplied_hash
  FOR UPDATE;

  IF paired_tenant.id IS NULL THEN
    RAISE EXCEPTION 'PAIRING_KEY_INVALID' USING ERRCODE = '28000';
  END IF;
  IF paired_tenant.hardware_fingerprint IS NOT NULL
     AND paired_tenant.hardware_fingerprint <> p_fingerprint THEN
    RAISE EXCEPTION 'PAIRING_KEY_ALREADY_REGISTERED' USING ERRCODE = '28000';
  END IF;

  UPDATE public.tenants
  SET hardware_fingerprint = p_fingerprint
  WHERE id = paired_tenant.id;

  RETURN paired_tenant.slug;
END;
$$;

REVOKE ALL ON FUNCTION public.rms_pair_local_bridge(text, text) FROM PUBLIC, authenticated;
GRANT EXECUTE ON FUNCTION public.rms_pair_local_bridge(text, text) TO anon;

-- Enforce order/menu tenant consistency with composite FKs. The trigger fills
-- tenant_id for existing API insert payloads and validates the menu item.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.order_items oi
    JOIN public.orders o ON o.id = oi.order_id
    JOIN public.menu_items mi ON mi.id = oi.menu_item_id
    WHERE o.tenant_id <> mi.tenant_id
  ) THEN
    RAISE EXCEPTION 'Existing order_items contain cross-tenant order/menu references; repair those rows before applying this migration.';
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.orders'::regclass
                 AND contype = 'u' AND pg_get_constraintdef(oid) = 'UNIQUE (tenant_id, id)') THEN
    ALTER TABLE public.orders ADD CONSTRAINT orders_tenant_id_id_unique UNIQUE (tenant_id, id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.menu_items'::regclass
                 AND contype = 'u' AND pg_get_constraintdef(oid) = 'UNIQUE (tenant_id, id)') THEN
    ALTER TABLE public.menu_items ADD CONSTRAINT menu_items_tenant_id_id_unique UNIQUE (tenant_id, id);
  END IF;
END;
$$;

ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS tenant_id uuid;
UPDATE public.order_items oi SET tenant_id = o.tenant_id
FROM public.orders o WHERE o.id = oi.order_id AND oi.tenant_id IS NULL;
ALTER TABLE public.order_items ALTER COLUMN tenant_id SET NOT NULL;

ALTER TABLE public.order_items DROP CONSTRAINT IF EXISTS order_items_order_id_fkey;
ALTER TABLE public.order_items DROP CONSTRAINT IF EXISTS order_items_menu_item_id_fkey;
ALTER TABLE public.order_items DROP CONSTRAINT IF EXISTS order_items_tenant_order_fk;
ALTER TABLE public.order_items DROP CONSTRAINT IF EXISTS order_items_tenant_menu_item_fk;
ALTER TABLE public.order_items
  ADD CONSTRAINT order_items_tenant_order_fk
    FOREIGN KEY (tenant_id, order_id) REFERENCES public.orders (tenant_id, id) ON DELETE CASCADE,
  ADD CONSTRAINT order_items_tenant_menu_item_fk
    FOREIGN KEY (tenant_id, menu_item_id) REFERENCES public.menu_items (tenant_id, id);

CREATE OR REPLACE FUNCTION public.rms_validate_order_item_tenant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  order_tenant uuid;
  item_tenant uuid;
BEGIN
  SELECT tenant_id INTO order_tenant FROM public.orders WHERE id = NEW.order_id;
  SELECT tenant_id INTO item_tenant FROM public.menu_items WHERE id = NEW.menu_item_id;
  IF order_tenant IS NULL OR item_tenant IS NULL OR order_tenant <> item_tenant
     OR (NEW.tenant_id IS NOT NULL AND NEW.tenant_id <> order_tenant) THEN
    RAISE EXCEPTION 'ORDER_ITEM_TENANT_MISMATCH' USING ERRCODE = '23514';
  END IF;
  NEW.tenant_id := order_tenant;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.rms_validate_order_item_tenant() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS rms_order_items_tenant_consistency ON public.order_items;
CREATE TRIGGER rms_order_items_tenant_consistency
  BEFORE INSERT OR UPDATE OF tenant_id, order_id, menu_item_id ON public.order_items
  FOR EACH ROW EXECUTE FUNCTION public.rms_validate_order_item_tenant();

-- Invoker views make the caller's base-table grants and RLS policies apply.
CREATE OR REPLACE VIEW public.kitchen_tickets
WITH (security_barrier = true, security_invoker = true) AS
  SELECT o.id AS order_id, o.tenant_id, o.order_number, o.table_id, t.table_number, o.status, o.created_at,
    COALESCE(jsonb_agg(jsonb_build_object('name', m.name, 'quantity', oi.quantity)) FILTER (WHERE oi.id IS NOT NULL), '[]'::jsonb) AS items
  FROM public.orders o
  LEFT JOIN public.restaurant_tables t ON t.id = o.table_id AND t.tenant_id = o.tenant_id
  LEFT JOIN public.order_items oi ON oi.order_id = o.id
  LEFT JOIN public.menu_items m ON m.id = oi.menu_item_id AND m.tenant_id = o.tenant_id
  WHERE o.tenant_id = public.rms_staff_tenant_id() AND public.rms_staff_role() = 'kitchen' AND o.status IN ('PENDING', 'PREPARING')
  GROUP BY o.id, t.table_number;

CREATE OR REPLACE VIEW public.rider_deliveries
WITH (security_barrier = true, security_invoker = true) AS
  SELECT o.id AS order_id, o.tenant_id, o.order_number, o.customer_name, o.customer_phone, o.customer_address, o.status, o.created_at,
    COALESCE(jsonb_agg(jsonb_build_object('name', m.name, 'quantity', oi.quantity)) FILTER (WHERE oi.id IS NOT NULL), '[]'::jsonb) AS items
  FROM public.orders o
  LEFT JOIN public.order_items oi ON oi.order_id = o.id
  LEFT JOIN public.menu_items m ON m.id = oi.menu_item_id AND m.tenant_id = o.tenant_id
  WHERE o.tenant_id = public.rms_staff_tenant_id() AND o.assigned_rider_id = public.rms_staff_user_id()
    AND o.order_type = 'DELIVERY' AND o.status IN ('PENDING', 'PREPARING', 'READY') AND public.rms_staff_role() = 'rider'
  GROUP BY o.id;

-- Invoker views now rely on base-table RLS, so grant only the required staff reads.
DROP POLICY IF EXISTS rms_orders_kitchen_read ON public.orders;
DROP POLICY IF EXISTS rms_orders_rider_read ON public.orders;
CREATE POLICY rms_orders_kitchen_read ON public.orders FOR SELECT TO authenticated
  USING (tenant_id = public.rms_staff_tenant_id() AND public.rms_staff_role() = 'kitchen' AND status IN ('PENDING', 'PREPARING'));
CREATE POLICY rms_orders_rider_read ON public.orders FOR SELECT TO authenticated
  USING (tenant_id = public.rms_staff_tenant_id() AND public.rms_staff_role() = 'rider'
    AND assigned_rider_id = public.rms_staff_user_id() AND order_type = 'DELIVERY' AND status IN ('PENDING', 'PREPARING', 'READY'));

DROP POLICY IF EXISTS rms_order_items_read ON public.order_items;
DROP POLICY IF EXISTS rms_order_items_cashier_write ON public.order_items;
DROP POLICY IF EXISTS rms_order_items_kitchen_rider_read ON public.order_items;
CREATE POLICY rms_order_items_read ON public.order_items FOR SELECT TO authenticated
  USING (tenant_id = public.rms_staff_tenant_id() AND public.rms_staff_role() IN ('admin', 'cashier') AND EXISTS (
    SELECT 1 FROM public.orders o WHERE o.id = order_items.order_id AND o.tenant_id = public.rms_staff_tenant_id()
  ));
CREATE POLICY rms_order_items_cashier_write ON public.order_items FOR ALL TO authenticated
  USING (tenant_id = public.rms_staff_tenant_id() AND public.rms_staff_role() IN ('admin', 'cashier') AND EXISTS (
    SELECT 1 FROM public.orders o WHERE o.id = order_items.order_id AND o.tenant_id = public.rms_staff_tenant_id()
  ))
  WITH CHECK (tenant_id = public.rms_staff_tenant_id() AND public.rms_staff_role() IN ('admin', 'cashier') AND EXISTS (
    SELECT 1 FROM public.orders o WHERE o.id = order_items.order_id AND o.tenant_id = public.rms_staff_tenant_id()
  ));

CREATE POLICY rms_order_items_kitchen_rider_read ON public.order_items FOR SELECT TO authenticated
  USING (tenant_id = public.rms_staff_tenant_id() AND EXISTS (
    SELECT 1 FROM public.orders o
    WHERE o.id = order_items.order_id AND o.tenant_id = public.rms_staff_tenant_id()
      AND ((public.rms_staff_role() = 'kitchen' AND o.status IN ('PENDING', 'PREPARING'))
        OR (public.rms_staff_role() = 'rider' AND o.assigned_rider_id = public.rms_staff_user_id()
          AND o.order_type = 'DELIVERY' AND o.status IN ('PENDING', 'PREPARING', 'READY')))
  ));

DROP POLICY IF EXISTS rms_menu_items_rider_delivery_read ON public.menu_items;
CREATE POLICY rms_menu_items_rider_delivery_read ON public.menu_items FOR SELECT TO authenticated
  USING (tenant_id = public.rms_staff_tenant_id() AND public.rms_staff_role() = 'rider' AND EXISTS (
    SELECT 1 FROM public.order_items oi JOIN public.orders o ON o.id = oi.order_id
    WHERE oi.menu_item_id = menu_items.id AND o.tenant_id = public.rms_staff_tenant_id()
      AND o.assigned_rider_id = public.rms_staff_user_id() AND o.order_type = 'DELIVERY'
      AND o.status IN ('PENDING', 'PREPARING', 'READY')
  ));
