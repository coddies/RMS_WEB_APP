-- Roles/Auth QA fixtures. Run only after supabase/migrations/202609300002_roles_auth.sql succeeds.
-- One-time seed: creates four demo-role logins, a second test tenant, and uniquely labelled orders.
-- No production tenant data is updated. Keep these accounts/test rows only while verification is in progress.
DO $rms_qa$
DECLARE
  demo_id uuid;
  isolation_id uuid;
  cashier_id uuid;
  kitchen_id uuid;
  rider_id uuid;
  other_rider_id uuid;
  isolation_rider_id uuid;
  demo_table_id uuid;
  demo_item_id uuid;
  demo_item_price numeric(10,2);
  isolation_category_id uuid;
  isolation_item_id uuid;
  own_order_id uuid;
  other_rider_order_id uuid;
  isolation_order_id uuid;
  kitchen_order_id uuid;
BEGIN
  SELECT id INTO demo_id FROM public.tenants WHERE slug = 'demo';
  IF demo_id IS NULL THEN RAISE EXCEPTION 'Expected existing tenant slug demo'; END IF;
  IF EXISTS (SELECT 1 FROM public.tenants WHERE slug = 'qa-isolation-20261001') THEN
    RAISE EXCEPTION 'QA tenant already exists; stop to avoid duplicating fixtures';
  END IF;
  IF EXISTS (SELECT 1 FROM public.users WHERE tenant_id = demo_id AND (username IN ('qa_admin','qa_cashier','qa_kitchen') OR phone IN ('QA-RIDER-01','QA-RIDER-02'))) THEN
    RAISE EXCEPTION 'QA demo staff already exists; stop to avoid overwriting accounts';
  END IF;

  INSERT INTO public.users (tenant_id,name,role,username,password_hash,pin_hash,active)
  VALUES (demo_id,'QA Manager','admin','qa_admin','scrypt$d30ac8e75a11f11a75433eb3dc6341b6$a3b42d7edfb35dc2a23b14c793b37e1d85b6976aee2b5d13c18aa08286efbc00f08ea2962e8ca29458db3ecefcafbcb8c1c3543b146d9e519cbcea40b588f4d1',NULL,true);
  INSERT INTO public.users (tenant_id,name,role,username,password_hash,pin_hash,active)
  VALUES (demo_id,'QA Cashier','cashier','qa_cashier',NULL,'scrypt$f65ac3b9dd53a4145d2af3afe11adc34$82c0273efd4771595a4cef18b519d5fb2b3290952be75eddafb7d88099b2bd81fef7bde8ae1f095497ca99c81628847c26e4ce7aa4b7fd7c74af3927264ba1b8',true)
  RETURNING id INTO cashier_id;
  INSERT INTO public.users (tenant_id,name,role,username,password_hash,pin_hash,active)
  VALUES (demo_id,'QA Kitchen','kitchen','qa_kitchen',NULL,'scrypt$e5b7e4019a4cdf4fc965f2bbd2bb7e0b$430c63ce0b8f2147f9cc4787b179ca361b0d47cc443a38dba6661576c1eab082307f8280942552afc956a3078ddf4cf7a85c17fa31fe6dff1d23db26ed6ff787',true)
  RETURNING id INTO kitchen_id;
  INSERT INTO public.users (tenant_id,name,role,phone,password_hash,pin_hash,active)
  VALUES (demo_id,'QA Rider','rider','QA-RIDER-01',NULL,'scrypt$a64fecefed0cacd26bff179ea24d1d78$6a010d54be90f9bf4933fae0caa685f88cc6803ed955d09369e1ebe4a9cffeb4718b0f15a178419fb8973063c17d9926f89ed5f3deb70f03558c02aacd50f021',true)
  RETURNING id INTO rider_id;
  INSERT INTO public.users (tenant_id,name,role,phone,password_hash,pin_hash,active)
  VALUES (demo_id,'QA Other Rider','rider','QA-RIDER-02',NULL,'scrypt$9909d60e7f83c1e3f4f645eab504a0ec$23a9ee2d369f8d4519809caf9d65efc30e0848864600237ea67439b0fbd63cfad7e5e6ea3a4008ec4d6178ca090b806c2458576d50b488f69b0ad83bd62918d8',true)
  RETURNING id INTO other_rider_id;

  INSERT INTO public.tenants (brand_name,slug) VALUES ('QA Isolation Tenant','qa-isolation-20261001') RETURNING id INTO isolation_id;
  INSERT INTO public.users (tenant_id,name,role,phone,active)
  VALUES (isolation_id,'QA Isolation Rider','rider','QA-RIDER-ISOLATION',true)
  RETURNING id INTO isolation_rider_id;

  SELECT id INTO demo_table_id FROM public.restaurant_tables WHERE tenant_id=demo_id AND table_number='T-01';
  SELECT id,price INTO demo_item_id,demo_item_price FROM public.menu_items WHERE tenant_id=demo_id AND in_stock=true ORDER BY name LIMIT 1;
  IF demo_table_id IS NULL OR demo_item_id IS NULL THEN RAISE EXCEPTION 'Demo tenant needs table T-01 and at least one in-stock menu item'; END IF;

  INSERT INTO public.orders (tenant_id,table_id,order_type,status,total_amount,sync_status,customer_name)
  VALUES (demo_id,demo_table_id,'DINE_IN','PENDING',demo_item_price,'SYNCED','QA_KITCHEN_TICKET_20261001') RETURNING id INTO kitchen_order_id;
  INSERT INTO public.order_items (order_id,menu_item_id,quantity,price_at_order)
  VALUES (kitchen_order_id,demo_item_id,1,demo_item_price);

  INSERT INTO public.orders (tenant_id,order_type,status,total_amount,sync_status,customer_name,customer_phone,customer_address,assigned_rider_id)
  VALUES (demo_id,'DELIVERY','PENDING',demo_item_price,'SYNCED','QA Rider Own Order','QA-ORDER-OWN','QA fixture address; not a real delivery.',rider_id) RETURNING id INTO own_order_id;
  INSERT INTO public.order_items (order_id,menu_item_id,quantity,price_at_order)
  VALUES (own_order_id,demo_item_id,1,demo_item_price);

  INSERT INTO public.orders (tenant_id,order_type,status,total_amount,sync_status,customer_name,customer_phone,customer_address,assigned_rider_id)
  VALUES (demo_id,'DELIVERY','PENDING',demo_item_price,'SYNCED','QA Other Rider Order','QA-ORDER-OTHER','QA fixture address; not a real delivery.',other_rider_id) RETURNING id INTO other_rider_order_id;
  INSERT INTO public.order_items (order_id,menu_item_id,quantity,price_at_order)
  VALUES (other_rider_order_id,demo_item_id,1,demo_item_price);

  INSERT INTO public.menu_categories (tenant_id,name,sort_order)
  VALUES (isolation_id,'QA Isolation Category',0) RETURNING id INTO isolation_category_id;
  INSERT INTO public.menu_items (tenant_id,name,price,category_id,description,in_stock)
  VALUES (isolation_id,'QA_ONLY_MARKER_20261001',1.00,isolation_category_id,'Tenant isolation fixture only.',true)
  RETURNING id INTO isolation_item_id;
  INSERT INTO public.orders (tenant_id,order_type,status,total_amount,sync_status,customer_name,customer_phone,customer_address,assigned_rider_id)
  VALUES (isolation_id,'DELIVERY','PENDING',1.00,'SYNCED','QA_ISOLATION_ORDER_20261001','QA-ORDER-ISOLATION','QA fixture address; not a real delivery.',isolation_rider_id)
  RETURNING id INTO isolation_order_id;
  INSERT INTO public.order_items (order_id,menu_item_id,quantity,price_at_order)
  VALUES (isolation_order_id,isolation_item_id,1,1.00);
END;
$rms_qa$;

-- Result check: six QA staff rows (five in demo and one in the isolation tenant), one QA tenant, four QA orders.
SELECT 'qa_staff_rows' AS check_name, count(*)::text AS result FROM public.users
WHERE (tenant_id=(SELECT id FROM public.tenants WHERE slug='demo') AND (username LIKE 'qa_%' OR phone LIKE 'QA-RIDER-%'))
   OR tenant_id=(SELECT id FROM public.tenants WHERE slug='qa-isolation-20261001')
UNION ALL
SELECT 'qa_tenants', count(*)::text FROM public.tenants WHERE slug='qa-isolation-20261001'
UNION ALL
SELECT 'qa_orders', count(*)::text FROM public.orders
WHERE customer_name IN ('QA Rider Own Order','QA Other Rider Order','QA_ISOLATION_ORDER_20261001','QA_KITCHEN_TICKET_20261001');
