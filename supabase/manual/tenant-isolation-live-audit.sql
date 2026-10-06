-- Run in Supabase SQL Editor after applying all project migrations.
-- 1) Every table that contains tenant-owned data must show rls_enabled=true.
SELECT c.relname AS table_name, c.relrowsecurity AS rls_enabled,
       c.relforcerowsecurity AS force_rls
FROM pg_catalog.pg_class AS c
JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind IN ('r', 'p')
  AND (
    c.relname = 'tenants'
    OR EXISTS (
      SELECT 1 FROM pg_catalog.pg_attribute AS a
      WHERE a.attrelid = c.oid AND a.attname = 'tenant_id'
        AND a.attnum > 0 AND NOT a.attisdropped
    )
  )
ORDER BY c.relname;

-- 2) Review every policy predicate, including policies not created by this repo.
SELECT schemaname, tablename, policyname, roles, cmd, qual, with_check
FROM pg_catalog.pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;

-- 3) Views should show security_invoker=true after the hardening migration.
SELECT c.relname AS view_name, c.reloptions
FROM pg_catalog.pg_class AS c
JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind = 'v'
  AND c.relname IN ('kitchen_tickets', 'rider_deliveries')
ORDER BY c.relname;

-- 4) Check the database-level order/menu tenant guard exists and is enabled.
SELECT t.tgname AS trigger_name, t.tgenabled, p.proname AS trigger_function
FROM pg_catalog.pg_trigger AS t
JOIN pg_catalog.pg_class AS c ON c.oid = t.tgrelid
JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
JOIN pg_catalog.pg_proc AS p ON p.oid = t.tgfoid
WHERE n.nspname = 'public' AND c.relname = 'order_items'
  AND t.tgname = 'rms_order_items_tenant_consistency'
  AND NOT t.tgisinternal;
