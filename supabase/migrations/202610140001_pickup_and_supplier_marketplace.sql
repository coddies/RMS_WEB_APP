-- Migration: 202610140001_pickup_and_supplier_marketplace.sql
-- Description: Add PICKUP to orders.order_type, add supply_products and stock_orders tables, and settings support.

-- 1. Update orders.order_type check constraint
ALTER TABLE IF EXISTS public.orders DROP CONSTRAINT IF EXISTS orders_order_type_check;
ALTER TABLE public.orders ADD CONSTRAINT orders_order_type_check CHECK (order_type IN ('DINE_IN', 'DELIVERY', 'PICKUP'));

-- 2. Add Supplier Marketplace & Settings columns to tenants
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS supplier_marketplace_phone VARCHAR;
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS notify_low_stock_phone VARCHAR;

-- Default sample supplier phone if null
UPDATE public.tenants 
SET supplier_marketplace_phone = COALESCE(supplier_marketplace_phone, '923157244884'),
    notify_low_stock_phone = COALESCE(notify_low_stock_phone, '923157244884')
WHERE supplier_marketplace_phone IS NULL;

-- 3. Create supply_products table (software provider's own product catalog)
CREATE TABLE IF NOT EXISTS public.supply_products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category VARCHAR NOT NULL,
  name VARCHAR NOT NULL,
  description TEXT,
  image_url TEXT,
  price DECIMAL(10,2) NULL,
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS on supply_products (readable by all authenticated staff and anon)
ALTER TABLE public.supply_products ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow staff and anon to read supply products" ON public.supply_products;
CREATE POLICY "Allow staff and anon to read supply products" ON public.supply_products
  FOR SELECT USING (true);

-- 4. Create stock_orders table
CREATE TABLE IF NOT EXISTS public.stock_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
  items JSONB NOT NULL,
  total_amount DECIMAL(10,2) NULL,
  status VARCHAR NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'CONFIRMED', 'SHIPPED', 'DELIVERED', 'CANCELLED')),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS on stock_orders
ALTER TABLE public.stock_orders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Tenants can manage their own stock orders" ON public.stock_orders;
CREATE POLICY "Tenants can manage their own stock orders" ON public.stock_orders
  FOR ALL USING (tenant_id = public.rms_staff_tenant_id());

-- 5. Seed sample supply products
INSERT INTO public.supply_products (category, name, description, image_url, price, active)
VALUES
  ('Kitchen Equipment', 'Commercial Double Deep Fryer (12L)', 'Stainless steel dual basket heavy-duty temperature-controlled electric fryer.', 'https://images.unsplash.com/photo-1590794056226-79ef3a8147e1?auto=format&fit=crop&w=600&q=80', 48500.00, true),
  ('Kitchen Equipment', 'Heavy Duty Flat Top Griddle (Gas)', '36-inch cast-iron flat top grill for smash burgers and steaks.', 'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?auto=format&fit=crop&w=600&q=80', 65000.00, true),
  ('Disposables & Packaging', 'Eco Kraft Burger Boxes (Pack of 500)', 'Greaseproof biodegradable premium kraft takeaway clamshell boxes.', 'https://images.unsplash.com/photo-1530587191325-3db32d826c18?auto=format&fit=crop&w=600&q=80', 4200.00, true),
  ('Disposables & Packaging', 'Custom Branded 2-Ply Tissues (Box of 1000)', 'Embossed restaurant-grade soft absorbent paper napkins.', 'https://images.unsplash.com/photo-1583947215259-38e31be8751f?auto=format&fit=crop&w=600&q=80', 1850.00, true),
  ('Kitchen Supplies', 'Thermal POS Receipt Paper Rolls 80mm (Box of 50)', 'BPA-free high sensitivity thermal roll for kitchen & counter printers.', 'https://images.unsplash.com/photo-1607344645866-009c320c5ab8?auto=format&fit=crop&w=600&q=80', 6500.00, true),
  ('Kitchen Supplies', 'Chef Sanitation Apron & Nitrile Gloves (Pack of 100)', 'Food-safe powder-free black nitrile gloves and waterproof kitchen apron.', 'https://images.unsplash.com/photo-1584634731339-252c581abfc5?auto=format&fit=crop&w=600&q=80', 2300.00, true),
  ('Beverage Supplies', 'Cold Drink PET Cups with Domes 500ml (300 pcs)', 'Clear crystal plastic cups for milkshakes, mocktails, and sodas.', 'https://images.unsplash.com/photo-1517256064527-09c73fc73e38?auto=format&fit=crop&w=600&q=80', 3600.00, true)
ON CONFLICT DO NOTHING;
