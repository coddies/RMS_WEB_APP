-- The local bridge refreshes its menu cache with the public Supabase key.
-- Grant only the fields used by that query; existing RLS policies remain in force.
GRANT SELECT (id, slug) ON public.tenants TO anon;
GRANT SELECT (id, name, price, category_id, image_url, in_stock, tenant_id)
  ON public.menu_items TO anon;
GRANT SELECT (id, name, tenant_id) ON public.menu_categories TO anon;
