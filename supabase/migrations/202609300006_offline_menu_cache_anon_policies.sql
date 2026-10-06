-- The public key may read public menu rows so the local bridge can refresh
-- its cache. Column-level grants in migration 005 limit which fields are visible.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'tenants'
      AND policyname = 'rms_offline_cache_read_tenants'
  ) THEN
    CREATE POLICY rms_offline_cache_read_tenants
      ON public.tenants FOR SELECT TO anon USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'menu_categories'
      AND policyname = 'rms_offline_cache_read_menu_categories'
  ) THEN
    CREATE POLICY rms_offline_cache_read_menu_categories
      ON public.menu_categories FOR SELECT TO anon USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'menu_items'
      AND policyname = 'rms_offline_cache_read_menu_items'
  ) THEN
    CREATE POLICY rms_offline_cache_read_menu_items
      ON public.menu_items FOR SELECT TO anon USING (true);
  END IF;
END $$;
