create extension if not exists pgcrypto;

create table if not exists public.tenants (
  id uuid primary key default gen_random_uuid(),
  brand_name varchar not null,
  slug varchar not null unique,
  primary_color varchar not null default '#DC2626',
  logo_url text,
  tier varchar not null default 'BASIC',
  created_at timestamptz not null default now()
);

create table if not exists public.restaurant_tables (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  table_number varchar not null,
  unique (tenant_id, table_number),
  unique (tenant_id, id)
);

create table if not exists public.menu_categories (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name varchar not null,
  sort_order integer not null default 0,
  unique (tenant_id, id)
);

create table if not exists public.menu_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name varchar not null,
  price decimal(10, 2) not null check (price >= 0),
  category_id uuid not null,
  image_url text,
  description text,
  in_stock boolean not null default true,
  foreign key (tenant_id, category_id) references public.menu_categories(tenant_id, id),
  unique (tenant_id, id)
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  order_number bigserial not null unique,
  table_id uuid references public.restaurant_tables(id),
  order_type varchar not null check (order_type in ('DINE_IN', 'DELIVERY')),
  status varchar not null default 'PENDING' check (status in ('PENDING', 'PREPARING', 'READY', 'COMPLETED', 'CANCELLED')),
  total_amount decimal(10, 2) not null default 0,
  sync_status varchar not null default 'SYNCED' check (sync_status in ('SYNCED', 'PENDING')),
  created_at timestamptz not null default now(),
  foreign key (tenant_id, table_id) references public.restaurant_tables(tenant_id, id),
  unique (tenant_id, id)
);

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  menu_item_id uuid not null references public.menu_items(id),
  quantity integer not null check (quantity > 0),
  price_at_order decimal(10, 2) not null check (price_at_order >= 0)
);

create index if not exists orders_pending_by_tenant on public.orders (tenant_id, created_at desc) where status = 'PENDING';

alter table public.orders replica identity full;
do $$ begin
  alter publication supabase_realtime add table public.orders;
exception when duplicate_object then null;
end $$;
