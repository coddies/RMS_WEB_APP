# DESIGN_FINAL.md — UI/UX Design System (v2, supersedes original DESIGN.md)

> Comprehensive UI/UX Specification for Restaurant Management System (Web & Native Desktop)
> Strict rule: Zero AI emojis anywhere in UI or documentation. Professional Ignite POS dark style.

## 1. Visual Theme & Design Tokens

Black + Crimson Red dark theme matching Ignite Smoke-house & Grill POS.
- `--bg-base`: #0A0A0C (ultra-deep matte obsidian)
- `--bg-sidebar`: #101217 (sleek dark graphite)
- `--bg-surface`: #14171F (panel surface)
- `--bg-surface-elevated`: #1B202B
- `--border-subtle`: #222736
- `--border-focus`: #3B445B
- `--primary-accent`: #DC2626 (crimson red)
- `--primary-accent-hover`: #EF4444
- `--text-main`: #F0F0F0
- `--text-muted`: #8B949E
- Status colors: Free/Success/In-Stock #10B981, Warning/Preparing #F59E0B, Occupied/Sold-Out/Urgent #EF4444, Info/Billed #3B82F6
- Font: Segoe UI, Inter, system-ui sans-serif
- Touch targets: minimum 48x48px everywhere
- Rounded corners 6-10px, crisp borders

## 2. Side Dashboard (Unified Left Navigation Shell)

### 2.1 Brand Header & Terminal Indicator
- Top Brand Tag: `IGNITE POS | RMS COUNTER` (Crimson #DC2626)
- Restaurant / Terminal Card: Dark pill container displaying tenant brand name and station identifier (`COUNTER 01 · LOCAL SQLITE`).

### 2.2 Navigation Items
Vertical stack of tactile, high-contrast action tabs:
1. `Orders (POS)`: Active counter billing, table assignment, payment capture, and thermal receipt printing.
2. `Kitchen (KDS)`: Live kitchen order tickets pipeline with status progression and elapsed cooking timers.
3. `Menu Management`: Catalog management, instant in-stock / sold-out toggling, price editing, and cloud sync.
4. `Special Offers`: Deals, combos, discount scheduling, and promotional banner management.
5. `Inventory`: Real-time ingredient levels, low-stock threshold alerts, and vendor tracking.
6. `Staff Accounts`: Local operator profiles, PIN security, role permissions, and cashier shift logs.
7. `Reports & Settings`: Daily sales totals, end-of-day Z-report printing, terminal pairing keys, and hardware diagnostics.

- Active State: Crimson red background (#DC2626), white text, bold weight.
- Inactive State: Dark graphite background (#14171F), light gray text (#F0F0F0), border #252A36.

### 2.3 Bottom Staff Card & Fast Role Switcher
- Staff display name (e.g. `SERVER 01`, `MANAGER ADMIN`).
- Role pill badge (Admin: Crimson #DC2626, Kitchen: Amber #D97706, Cashier: Emerald #059669).
- Action Button: `[SWITCH ROLE / LOCK]` which triggers the Fast PIN Keypad modal for instant shift handover without restarting the terminal.

## 3. Fast Lock Screen & Touch Numeric Keypad

- Terminal lock screen and fast role switch dialog.
- Selected user / role display.
- Discrete dot circles for PIN feedback.
- Large touch-friendly numeric grid:
  `[ 1 ]` `[ 2 ]` `[ 3 ]`
  `[ 4 ]` `[ 5 ]` `[ 6 ]`
  `[ 7 ]` `[ 8 ]` `[ 9 ]`
  `[ Clear ]` `[ 0 ]` `[ Backspace ]`
- Action Button: `[ Unlock Terminal ]` (Crimson red #DC2626).
- Supports physical keyboard numpad and touch input.

## 4. Screen Modules Inventory

### 4.1 Orders (POS Terminal)
- Menu catalog list with categories and formatted prices.
- Table / order reference input.
- Active cart line items with quantity counters.
- Save & Print thermal receipt button.
- Mark Paid button.
- Incoming online web orders badge and live order tracking.

### 4.2 Kitchen KDS Screen (Live Order Pipeline)
3-column Kanban pipeline:
- Column 1: Received (New incoming tickets, red badge, `[ START COOKING ]`).
- Column 2: Preparing (Active cooking tickets with elapsed timers, `[ MARK PLATED ]`).
- Column 3: Pickup / Ready (Completed dishes, `[ HAND OFF / COMPLETE ]` and `[ PRINT KOT ]`).
- Real-time audible chime on newly arriving dine-in and online orders.

### 4.3 Menu Management Screen
- Metric summary cards: Total Items, In-Stock (green), Sold-Out (red), Cloud Synced (green).
- Category accordion sections.
- Item row layout: name, price in Rs, category tag.
- Instant stock switch: `[ IN STOCK ]` vs `[ SOLD OUT ]` toggle that immediately syncs across counter and public menu.
- Item editor modal: item name, price, category selector, in-stock switch.
- Filter search box with instantaneous name matching.

### 4.4 Special Offers & Promotions Screen
- Promotion builder: combos, discounts, and banner configuration.
- Publishing synchronization to both POS terminal and mobile QR menu.

### 4.5 Inventory Screen
- Raw stock items and unit counts.
- Low-stock alerts and supplier logs.

### 4.6 Staff Management Screen
- Local SQLite authentication with hashed PINs.
- Add staff, change PIN, role assignment, and background cloud sync.

## 5. Pairing Key Architecture
- Supports 10-character Restaurant Pairing Keys (e.g. `T@3XYCM@6_`) and 64-character tokens.
- Secure local token storage via Windows DPAPI and local `.env`.
- Auto-detection across installation directory and Windows service config.
