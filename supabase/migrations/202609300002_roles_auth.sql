-- Staff account bridge and tenant claims for the Roles & Auth feature.
CREATE TABLE IF NOT EXISTS public.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name varchar NOT NULL,
  role varchar NOT NULL CHECK (role IN ('admin', 'cashier', 'kitchen', 'rider')),
  phone varchar,
  username varchar,
  password_hash text,
  pin_hash text,
  active boolean NOT NULL DEFAULT true,
  auth_user_id uuid UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL
);

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS name varchar;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS role varchar;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS phone varchar;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS username varchar;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS password_hash text;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS pin_hash text;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS auth_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS users_auth_user_id_unique ON public.users (auth_user_id) WHERE auth_user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS users_tenant_username_unique ON public.users (tenant_id, lower(username)) WHERE username IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS users_tenant_phone_unique ON public.users (tenant_id, phone) WHERE phone IS NOT NULL;

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS customer_name varchar;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS customer_phone varchar;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS customer_address text;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS assigned_rider_id uuid REFERENCES public.users(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.rms_staff_tenant_id()
RETURNS uuid
LANGUAGE sql STABLE
AS $$ SELECT NULLIF(auth.jwt() ->> 'tenant_id', '')::uuid $$;

CREATE OR REPLACE FUNCTION public.rms_staff_role()
RETURNS text
LANGUAGE sql STABLE
AS $$ SELECT auth.jwt() ->> 'staff_role' $$;

CREATE OR REPLACE FUNCTION public.rms_staff_user_id()
RETURNS uuid
LANGUAGE sql STABLE
AS $$ SELECT NULLIF(auth.jwt() ->> 'staff_user_id', '')::uuid $$;

CREATE OR REPLACE FUNCTION public.rms_custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  claims jsonb;
  staff_user_id uuid;
  staff_tenant_id uuid;
  staff_role text;
  staff_active boolean;
BEGIN
  SELECT u.id, u.tenant_id, u.role, u.active
    INTO staff_user_id, staff_tenant_id, staff_role, staff_active
    FROM public.users AS u
    WHERE u.auth_user_id = (event ->> 'user_id')::uuid;
  IF staff_tenant_id IS NULL OR staff_active IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Staff account is inactive or has no tenant mapping';
  END IF;
  claims := event -> 'claims';
  claims := jsonb_set(claims, '{tenant_id}', to_jsonb(staff_tenant_id::text), true);
  claims := jsonb_set(claims, '{staff_user_id}', to_jsonb(staff_user_id::text), true);
  claims := jsonb_set(claims, '{staff_role}', to_jsonb(staff_role), true);
  RETURN jsonb_set(event, '{claims}', claims, true);
END;
$$;

GRANT USAGE ON SCHEMA public TO supabase_auth_admin;
GRANT SELECT (auth_user_id, tenant_id, role, active) ON public.users TO supabase_auth_admin;
REVOKE EXECUTE ON FUNCTION public.rms_custom_access_token_hook(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rms_custom_access_token_hook(jsonb) TO supabase_auth_admin;

-- Remove older permissive policies on these tenant tables before installing the scoped policies below.
DO $$
DECLARE
  table_name text;
  policy_row record;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'tenants', 'restaurant_tables', 'users', 'menu_categories', 'menu_items', 'orders', 'order_items',
    'ingredients', 'menu_item_ingredients', 'vendors', 'ingredient_vendors', 'special_offers'
  ] LOOP
    IF to_regclass(format('public.%I', table_name)) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon', table_name);
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO authenticated', table_name);
      FOR policy_row IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = table_name LOOP
        EXECUTE format('DROP POLICY %I ON public.%I', policy_row.policyname, table_name);
      END LOOP;
    END IF;
  END LOOP;
END;
$$;

-- Staff profiles are readable only by the manager or the staff member themself.
REVOKE ALL ON TABLE public.users FROM anon, authenticated;
GRANT SELECT (id, tenant_id, name, role, phone, username, active, auth_user_id) ON public.users TO authenticated;
CREATE POLICY rms_users_read ON public.users FOR SELECT TO authenticated
  USING (tenant_id = public.rms_staff_tenant_id() AND (public.rms_staff_role() = 'admin' OR id = public.rms_staff_user_id()));
CREATE POLICY rms_users_admin_write ON public.users FOR ALL TO authenticated
  USING (tenant_id = public.rms_staff_tenant_id() AND public.rms_staff_role() = 'admin')
  WITH CHECK (tenant_id = public.rms_staff_tenant_id() AND public.rms_staff_role() = 'admin');
CREATE POLICY rms_users_auth_hook_read ON public.users FOR SELECT TO supabase_auth_admin USING (true);

CREATE POLICY rms_tenants_read ON public.tenants FOR SELECT TO authenticated
  USING (id = public.rms_staff_tenant_id());
CREATE POLICY rms_tenants_admin_update ON public.tenants FOR UPDATE TO authenticated
  USING (id = public.rms_staff_tenant_id() AND public.rms_staff_role() = 'admin')
  WITH CHECK (id = public.rms_staff_tenant_id() AND public.rms_staff_role() = 'admin');

CREATE POLICY rms_tables_read ON public.restaurant_tables FOR SELECT TO authenticated
  USING (tenant_id = public.rms_staff_tenant_id() AND public.rms_staff_role() IN ('admin', 'cashier', 'kitchen'));
CREATE POLICY rms_tables_admin_write ON public.restaurant_tables FOR ALL TO authenticated
  USING (tenant_id = public.rms_staff_tenant_id() AND public.rms_staff_role() = 'admin')
  WITH CHECK (tenant_id = public.rms_staff_tenant_id() AND public.rms_staff_role() = 'admin');

CREATE POLICY rms_menu_categories_read ON public.menu_categories FOR SELECT TO authenticated
  USING (tenant_id = public.rms_staff_tenant_id() AND public.rms_staff_role() IN ('admin', 'cashier', 'kitchen'));
CREATE POLICY rms_menu_categories_admin_write ON public.menu_categories FOR ALL TO authenticated
  USING (tenant_id = public.rms_staff_tenant_id() AND public.rms_staff_role() = 'admin')
  WITH CHECK (tenant_id = public.rms_staff_tenant_id() AND public.rms_staff_role() = 'admin');
CREATE POLICY rms_menu_items_read ON public.menu_items FOR SELECT TO authenticated
  USING (tenant_id = public.rms_staff_tenant_id() AND public.rms_staff_role() IN ('admin', 'cashier', 'kitchen'));
CREATE POLICY rms_menu_items_admin_write ON public.menu_items FOR ALL TO authenticated
  USING (tenant_id = public.rms_staff_tenant_id() AND public.rms_staff_role() = 'admin')
  WITH CHECK (tenant_id = public.rms_staff_tenant_id() AND public.rms_staff_role() = 'admin');

CREATE POLICY rms_orders_read ON public.orders FOR SELECT TO authenticated
  USING (tenant_id = public.rms_staff_tenant_id() AND public.rms_staff_role() IN ('admin', 'cashier'));
CREATE POLICY rms_orders_cashier_write ON public.orders FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.rms_staff_tenant_id() AND public.rms_staff_role() IN ('admin', 'cashier'));
CREATE POLICY rms_orders_cashier_update ON public.orders FOR UPDATE TO authenticated
  USING (tenant_id = public.rms_staff_tenant_id() AND public.rms_staff_role() IN ('admin', 'cashier'))
  WITH CHECK (tenant_id = public.rms_staff_tenant_id() AND public.rms_staff_role() IN ('admin', 'cashier'));
CREATE POLICY rms_orders_admin_delete ON public.orders FOR DELETE TO authenticated
  USING (tenant_id = public.rms_staff_tenant_id() AND public.rms_staff_role() = 'admin');

CREATE POLICY rms_order_items_read ON public.order_items FOR SELECT TO authenticated
  USING (public.rms_staff_role() IN ('admin', 'cashier') AND EXISTS (
    SELECT 1 FROM public.orders AS o WHERE o.id = order_items.order_id AND o.tenant_id = public.rms_staff_tenant_id()
  ));
CREATE POLICY rms_order_items_cashier_write ON public.order_items FOR ALL TO authenticated
  USING (public.rms_staff_role() IN ('admin', 'cashier') AND EXISTS (
    SELECT 1 FROM public.orders AS o WHERE o.id = order_items.order_id AND o.tenant_id = public.rms_staff_tenant_id()
  ))
  WITH CHECK (public.rms_staff_role() IN ('admin', 'cashier') AND EXISTS (
    SELECT 1 FROM public.orders AS o WHERE o.id = order_items.order_id AND o.tenant_id = public.rms_staff_tenant_id()
  ));

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['ingredients', 'vendors', 'special_offers'] LOOP
    IF to_regclass(format('public.%I', table_name)) IS NOT NULL THEN
      EXECUTE format('CREATE POLICY rms_%I_admin_only ON public.%I FOR ALL TO authenticated USING (tenant_id = public.rms_staff_tenant_id() AND public.rms_staff_role() = ''admin'') WITH CHECK (tenant_id = public.rms_staff_tenant_id() AND public.rms_staff_role() = ''admin'')', table_name, table_name);
    END IF;
  END LOOP;
  IF to_regclass('public.menu_item_ingredients') IS NOT NULL THEN
    CREATE POLICY rms_menu_item_ingredients_admin_only ON public.menu_item_ingredients FOR ALL TO authenticated
      USING (public.rms_staff_role() = 'admin' AND EXISTS (SELECT 1 FROM public.menu_items m WHERE m.id = menu_item_ingredients.menu_item_id AND m.tenant_id = public.rms_staff_tenant_id()))
      WITH CHECK (public.rms_staff_role() = 'admin' AND EXISTS (SELECT 1 FROM public.menu_items m WHERE m.id = menu_item_ingredients.menu_item_id AND m.tenant_id = public.rms_staff_tenant_id()));
  END IF;
  IF to_regclass('public.ingredient_vendors') IS NOT NULL AND to_regclass('public.ingredients') IS NOT NULL THEN
    CREATE POLICY rms_ingredient_vendors_admin_only ON public.ingredient_vendors FOR ALL TO authenticated
      USING (public.rms_staff_role() = 'admin' AND EXISTS (SELECT 1 FROM public.ingredients i WHERE i.id = ingredient_vendors.ingredient_id AND i.tenant_id = public.rms_staff_tenant_id()))
      WITH CHECK (public.rms_staff_role() = 'admin' AND EXISTS (SELECT 1 FROM public.ingredients i WHERE i.id = ingredient_vendors.ingredient_id AND i.tenant_id = public.rms_staff_tenant_id()));
  END IF;
END;
$$;

-- Kitchen and rider receive filtered views, never the billing fields from the base orders table.
CREATE OR REPLACE VIEW public.kitchen_tickets WITH (security_barrier = true) AS
  SELECT o.id AS order_id, o.tenant_id, o.order_number, o.table_id, t.table_number, o.status, o.created_at,
    COALESCE(jsonb_agg(jsonb_build_object('name', m.name, 'quantity', oi.quantity)) FILTER (WHERE oi.id IS NOT NULL), '[]'::jsonb) AS items
  FROM public.orders o
  LEFT JOIN public.restaurant_tables t ON t.id = o.table_id AND t.tenant_id = o.tenant_id
  LEFT JOIN public.order_items oi ON oi.order_id = o.id
  LEFT JOIN public.menu_items m ON m.id = oi.menu_item_id AND m.tenant_id = o.tenant_id
  WHERE o.tenant_id = public.rms_staff_tenant_id() AND public.rms_staff_role() = 'kitchen' AND o.status IN ('PENDING', 'PREPARING')
  GROUP BY o.id, t.table_number;
CREATE OR REPLACE VIEW public.rider_deliveries WITH (security_barrier = true) AS
  SELECT o.id AS order_id, o.tenant_id, o.order_number, o.customer_name, o.customer_phone, o.customer_address, o.status, o.created_at,
    COALESCE(jsonb_agg(jsonb_build_object('name', m.name, 'quantity', oi.quantity)) FILTER (WHERE oi.id IS NOT NULL), '[]'::jsonb) AS items
  FROM public.orders o
  LEFT JOIN public.order_items oi ON oi.order_id = o.id
  LEFT JOIN public.menu_items m ON m.id = oi.menu_item_id AND m.tenant_id = o.tenant_id
  WHERE o.tenant_id = public.rms_staff_tenant_id() AND o.assigned_rider_id = public.rms_staff_user_id()
    AND o.order_type = 'DELIVERY' AND o.status IN ('PENDING', 'PREPARING', 'READY') AND public.rms_staff_role() = 'rider'
  GROUP BY o.id;
REVOKE ALL ON public.kitchen_tickets, public.rider_deliveries FROM anon;
GRANT SELECT ON public.kitchen_tickets, public.rider_deliveries TO authenticated;
