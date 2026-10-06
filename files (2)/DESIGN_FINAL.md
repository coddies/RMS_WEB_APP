# DESIGN_FINAL.md — UI/UX Design System (v2, supersedes original DESIGN.md)

## 1. Theme
Black + Red dark theme.
- `--bg-base`: #0D0D0D / #121212
- `--bg-surface`: #161B22 / #1E1E24
- `--primary-accent`: #DC2626 / #8B0000 (dynamic per-tenant override allowed)
- `--text-main`: #F0F0F0
- `--text-muted`: #8B949E
- Status colors: Free/Success #10B981, Warning #F59E0B, Occupied/Urgent #EF4444, Info/Billed #3B82F6
- Font: Inter / system sans-serif
- Touch targets: minimum 48x48px everywhere
- Rounded corners 8-12px, subtle card shadows

## 2. Screen Inventory

### 2.1 Customer Menu (mobile-first, QR/delivery entry)
- Logo/name (dynamic per tenant) + Table/Delivery badge
- Sticky category tabs
- Item cards with photo, name, price, description, "+" add
- Special offer items: distinct highlighted card (per selected template style — see 2.4)
- Bottom sticky cart bar
- Dine-in checkout: single "Submit Order to Kitchen" button
- Delivery checkout: Name/Address/Phone fields (with inline validation errors per FR-13) + "Order via WhatsApp" button
- Privacy Policy link accessible from footer/checkout (per FR-15)

### 2.2 Unified Staff Dashboard (single shell, sidebar nav)
- Sidebar: Orders, Kitchen, Menu, Inventory, Vendors (if enabled), Staff, Reports, Settings
- Role-based: sidebar items shown/hidden per logged-in role (Feature 07)
- Same shell for all roles — no separate app/URL to switch between, only the visible sections change

### 2.3 Menu Management Screen (Admin)
- Top bar: category filter + "+ Add New Item" button
- Collapsible category sections, item rows with thumbnail/name/price/stock-toggle/edit/delete
- Add/Edit panel: photo upload, name, price, category, description, ingredient-linking multi-select
- Search bar

### 2.4 Create Special Offer Screen (Admin)
- "+ New Offer" opens modal/panel
- Step 1: item selection (searchable checklist)
- Step 2: pick from 4-5 offer card style templates (Flame Badge, Gradient Glow Border, Ribbon Tag, Countdown Banner, Seasonal Frame)
- Step 3: day-of-week toggle pills (Mon-Sun)
- Step 4: start/end date-time pickers, or "run indefinitely" toggle
- Step 5: optional custom badge text
- Live preview panel
- Save (red, full-width) / Cancel

### 2.5 Login Screen
- Centered card, logo, Phone/Username + PIN/Password, large PIN pad for fast counter entry

### 2.6 Rider Mobile View (PWA)
- List of assigned deliveries: name, address (tap-to-call), items, single cycling status button (Picked Up -> On the Way -> Delivered)
- Minimal, one-handed use

### 2.7 Super-Admin Panel
- Restaurant list table (name, slug, tier, status, renewal date)
- Add/Edit restaurant form
- Separate login, separate visual treatment (still black/red, but with a distinct "Platform Admin" header so it's never confused with a restaurant's own dashboard)

## 3. Responsive Breakpoints
- Mobile (320-480px): Customer menu, WhatsApp checkout, Rider PWA
- Tablet (768-1024px): Kitchen KDS, tableside use
- Desktop (1200px+): Manager dashboard, Cashier counter terminal

## 4. Multi-Tenant Theming
Tenant config JSON (brand_name, logo_url, primary_color, secondary_color, font_family) applied via CSS variables at runtime — same layout/components reused for every restaurant, no per-tenant rebuild.
