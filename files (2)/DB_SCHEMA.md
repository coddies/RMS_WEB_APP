# DB_SCHEMA.md — Consolidated Data Model (v1)

Storage: Supabase Postgres (cloud) + local SQLite mirror (subset: today's orders + current menu cache, for offline mode). Images: **Cloudinary** (free tier, auto-compression/resize + CDN — chosen over Supabase Storage because menu photos need automatic optimization on upload).

```sql
tenants
  id UUID PK
  brand_name VARCHAR
  slug VARCHAR UNIQUE
  whatsapp_phone VARCHAR -- restaurant WhatsApp number in Pakistani/international format
  primary_color VARCHAR DEFAULT '#DC2626'
  logo_url TEXT
  tier VARCHAR -- 'BASIC' | 'PREMIUM'
  license_key VARCHAR -- SHA-256 verifier for a one-time pairing key; never store raw key
  hardware_fingerprint TEXT NULLABLE -- hashed Windows machine identity registered by installer
  fbr_ntn VARCHAR NULLABLE
  fbr_token TEXT NULLABLE (encrypted)
  notify_low_stock_to VARCHAR -- 'manager' | 'cashier' | 'both'
  subscription_status VARCHAR -- 'active' | 'expired'
  subscription_renewal_date DATE
  created_at TIMESTAMPTZ

restaurant_tables
  id UUID PK
  tenant_id UUID FK -> tenants
  table_number VARCHAR

users (staff — admin/manager/cashier/kitchen/rider)
  id UUID PK
  tenant_id UUID FK -> tenants
  auth_user_id UUID UNIQUE FK -> auth.users.id NULLABLE (linked on first successful login)
  name VARCHAR
  role VARCHAR -- 'admin' | 'cashier' | 'kitchen' | 'rider'
  phone VARCHAR NULLABLE (rider login)
  username VARCHAR NULLABLE
  password_hash TEXT NULLABLE (manager/admin scrypt hash)
  pin_hash TEXT NULLABLE (cashier/kitchen/rider scrypt hash)
  active BOOLEAN DEFAULT TRUE

menu_categories
  id UUID PK
  tenant_id UUID FK -> tenants
  name VARCHAR
  sort_order INTEGER DEFAULT 0

menu_items
  id UUID PK
  tenant_id UUID FK -> tenants
  name VARCHAR
  price DECIMAL(10,2)
  category_id UUID FK -> menu_categories
  image_url TEXT
  description TEXT
  in_stock BOOLEAN DEFAULT TRUE

ingredients
  id UUID PK
  tenant_id UUID FK -> tenants
  name VARCHAR
  unit VARCHAR -- 'kg' | 'liter' | 'piece'
  current_stock DECIMAL
  threshold DECIMAL

menu_item_ingredients (link table)
  id UUID PK
  menu_item_id UUID FK -> menu_items
  ingredient_id UUID FK -> ingredients
  quantity_required DECIMAL

vendors (Premium only)
  id UUID PK
  tenant_id UUID FK -> tenants
  name VARCHAR
  phone VARCHAR

ingredient_vendors (link table)
  ingredient_id UUID FK -> ingredients
  vendor_id UUID FK -> vendors

orders
  id UUID PK
  tenant_id UUID FK -> tenants
  order_number BIGSERIAL -- human-readable, for receipts/customer reference
  table_id UUID NULLABLE FK -> restaurant_tables
  order_type VARCHAR -- 'DINE_IN' | 'DELIVERY'
  status VARCHAR -- 'PENDING' | 'PREPARING' | 'READY' | 'COMPLETED' | 'CANCELLED'
  customer_name VARCHAR NULLABLE
  customer_phone VARCHAR NULLABLE
  customer_address TEXT NULLABLE
  assigned_rider_id UUID NULLABLE FK -> users.id
  total_amount DECIMAL(10,2)
  fbr_irn VARCHAR NULLABLE
  fbr_qr_data TEXT NULLABLE
  sync_status VARCHAR -- 'SYNCED' | 'PENDING' (offline queue)
  local_sequence_no INTEGER NULLABLE
  created_at TIMESTAMPTZ

order_items
  id UUID PK
  tenant_id UUID FK -> tenants -- populated and verified by DB trigger
  order_id UUID FK -> orders
  menu_item_id UUID FK -> menu_items
  quantity INTEGER
  price_at_order DECIMAL(10,2)

special_offers
  id UUID PK
  tenant_id UUID FK -> tenants
  menu_item_id UUID FK -> menu_items
  card_style VARCHAR -- 'flame' | 'gradient' | 'ribbon' | 'countdown' | 'seasonal_frame'
  badge_text VARCHAR NULLABLE
  days_of_week VARCHAR[] -- ['mon','wed','fri']
  start_at TIMESTAMPTZ NULLABLE
  end_at TIMESTAMPTZ NULLABLE
  run_indefinitely BOOLEAN DEFAULT FALSE
```

`order_items` has composite foreign keys `(tenant_id, order_id)` and `(tenant_id, menu_item_id)` so the order and menu item must belong to the same tenant. A database trigger derives `tenant_id` and rejects mismatches, including writes made by the privileged server client.

All tenant-scoped tables get RLS policy per `SECURITY_FINAL.md` (`tenant_id = auth.jwt() ->> 'tenant_id'`).
