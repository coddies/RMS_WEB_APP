# DESIGN.md — Ignite POS & RMS Counter Design System

> Comprehensive UI/UX Specification for Restaurant Management System (Web & Native Desktop)
> Supersedes legacy design documents. Strict rule: Zero AI emojis anywhere in UI or documentation.

---

## 1. Visual Theme & Design Tokens

Inspired by high-performance restaurant POS terminals (Ignite Smoke-house & Grill dark edition).

### 1.1 Color Palette
- **Canvas / Root Background**: `#0A0A0C` (ultra-deep matte obsidian)
- **Sidebar Background**: `#101217` (sleek dark graphite)
- **Surface / Card Background**: `#14171F` (panel surface)
- **Surface Elevated / Hover**: `#1B202B`
- **Border Subtle**: `#222736`
- **Border Focus / Accent**: `#3B445B`
- **Primary Accent (Brand Red)**: `#DC2626` (crimson red)
- **Primary Accent Hover**: `#EF4444`
- **Text Main**: `#F0F0F0` (crisp white)
- **Text Secondary / Muted**: `#8B949E` (cool gray)
- **Status Green (In Stock / Online / Ready)**: `#10B981`
- **Status Orange / Amber (Preparing / Warning)**: `#F59E0B`
- **Status Red (Sold Out / Received / Urgent)**: `#EF4444`
- **Status Blue (Info / Dine-in)**: `#3B82F6`

### 1.2 Typography
- **Primary Font**: Segoe UI, Inter, system-ui sans-serif
- **Headings**: SemiBold / Bold (20px to 26px)
- **Navigation Labels**: Medium (13px, uppercase tracking +0.5px)
- **Metric Numbers**: Bold (22px to 28px)
- **Status Badges / Pills**: Bold (10px to 11px, uppercase)
- **Monospace (Order IDs / Timers)**: Consolas, Cascadia Mono

---

## 2. Side Dashboard (Unified Left Navigation Shell)

The left sidebar is the persistent command center across both native desktop (`RMSCounter.exe`) and web staff dashboards.

### 2.1 Sidebar Top Brand Header
- **Top Brand Sub-label**: `IGNITE POS | RMS COUNTER` (10px, uppercase bold, Crimson `#DC2626`)
- **Station / Tenant Card**: Dark pill container (`#161922`, rounded 6px)
  - Primary text: Dynamic restaurant brand name or tenant slug (e.g., `IGNITE SMOKE-HOUSE`)
  - Sub-text: Terminal identifier (e.g., `COUNTER 01 · LOCAL SQLITE`)

### 2.2 Navigation Items
Vertical stack of tactile, high-contrast action tabs (height 44px, padding 14px horizontal, rounded 6px):
1. **Orders (POS)**: Active counter terminal billing, table assignment, payment capture, and thermal receipt printing.
2. **Kitchen (KDS)**: Live kitchen order tickets pipeline with status progression and elapsed cooking timers.
3. **Menu Management**: Catalog management, instant in-stock / sold-out toggling, price editing, and cloud sync.
4. **Special Offers**: Deals, combos, discount scheduling, and promotional banner management.
5. **Inventory**: Real-time ingredient levels, low-stock threshold alerts, and vendor tracking.
6. **Staff Accounts**: Local operator profiles, PIN security, role permissions, and cashier shift logs.
7. **Reports & Settings**: Daily sales totals, end-of-day Z-report printing, terminal pairing keys, and hardware diagnostics.

- **Active State**: Crimson red background (`#DC2626`), white text, bold weight.
- **Inactive State**: Dark graphite background (`#14171F`), light gray text (`#F0F0F0`), border `#252A36`.
- **Hover State**: `#1B202B` with crisp border highlight.

### 2.3 Bottom Staff Card & Fast Role Switcher
Positioned at the bottom dock of the sidebar:
- **Staff Name**: Bold text displaying active operator (e.g., `SERVER 01`, `MANAGER ADMIN`).
- **Role Badge**: High-contrast pill container:
  - Admin: Crimson `#DC2626`
  - Kitchen: Amber `#D97706`
  - Cashier: Emerald `#059669`
- **Action Button: `[SWITCH ROLE / LOCK]`**:
  - Triggers the Fast PIN Keypad modal for instant shift handover or terminal locking without closing the application.

---

## 3. Fast Lock Screen & Touch Numeric Keypad

A full-screen or modal security layer for terminal access, role switching, and shift changes.

### 3.1 Keypad Layout
- **Brand Title**: Restaurant name and terminal lock notification.
- **Selected User / Role Display**: Active operator name with role badge.
- **PIN Indicator**: 4 to 6 discrete dot circles displaying masking feedback upon key entry.
- **Tactile Numeric Grid (3x4)**:
  - Row 1: `[ 1 ]` `[ 2 ]` `[ 3 ]`
  - Row 2: `[ 4 ]` `[ 5 ]` `[ 6 ]`
  - Row 3: `[ 7 ]` `[ 8 ]` `[ 9 ]`
  - Row 4: `[ Clear ]` `[ 0 ]` `[ Backspace ]`
- **Submit Action**: Full-width crimson button `[ Unlock Terminal ]`.
- **Keyboard Support**: Full support for physical keyboard numpad, touch screen, and mouse clicks.

---

## 4. Screen Modules Inventory

### 4.1 Orders (POS Terminal)
- **Left Panel (Menu Quick Select)**:
  - Category filter pills.
  - Item cards displaying item name, formatted price in Rs, and stock status.
  - Double-click or touch to increment cart count.
- **Right Panel (Cart & Active Orders)**:
  - Table number / Customer reference input.
  - Active line items with item name, quantity multiplier, and total price.
  - Order action buttons: `[ Save Order & Print Receipt ]` and `[ Mark Selected Order Paid ]`.
  - Active orders list with status pills (`PENDING`, `PREPARING`, `READY`, `COMPLETED`).
  - Web order badge (`WEB #1024`) for orders synchronized from the online portal.

### 4.2 Kitchen (KDS Live Pipeline)
3-column Kanban layout matching high-volume restaurant kitchens:
- **Column 1: Received (Incoming)**
  - Red header badge.
  - Order cards with timestamp, table number, item list with quantities.
  - Action button: `[ START COOKING (PREP) ]`.
- **Column 2: Preparing (Active)**
  - Amber header badge.
  - Order cards with active elapsed cooking timer (e.g., `14:41`).
  - Action button: `[ MARK PLATED / EXPEDITE ]`.
- **Column 3: Ready for Pickup**
  - Green header badge.
  - Order cards ready for server handoff.
  - Action buttons: `[ PRINT KOT ]` and `[ SERVER HANDOFF / COMPLETE ]`.
- **Real-Time Chime**: Audible notification on new incoming dine-in and web orders.

### 4.3 Menu Management Screen
- **Header Metric Cards**:
  1. `TOTAL ITEMS` (e.g. 42)
  2. `IN STOCK` (e.g. 39, green text)
  3. `SOLD OUT` (e.g. 3, red text)
  4. `CLOUD SYNC` (e.g. 100% Synced, green text)
- **Action Bar**: Instant search filter box + `[+ Add New Item]` crimson button.
- **Item Rows / Cards**:
  - Item name, category badge, price formatted in Rs.
  - Instant stock toggle switch: `[ IN STOCK ]` (green) vs `[ SOLD OUT ]` (red).
  - Quick action buttons: `[ Edit Item ]` and `[ Delete Item ]`.
- **Add / Edit Item Drawer**:
  - Modal form for item name, price, category selector, and in-stock default state.
  - Instant write to local SQLite cache + background microtask sync to Supabase.

### 4.4 Special Offers & Promotions Screen
- Promo banner configuration.
- Combo deals (e.g., Burger + Fries + Drink bundle).
- Discount rules (percentage or fixed amount off).
- Active schedule (start date, end date, active days of week).
- Sync status to online customer menu and counter terminal.

### 4.5 Inventory & Vendor Management
- Stock item catalog (raw ingredients, beverage units, packaging).
- Reorder threshold levels with low-stock warning banners.
- Quick stock adjustment (`+` / `-` stock units).

### 4.6 Staff Accounts Management
- List of registered staff members with username, role, active status, and sync state.
- Actions: `[ Add Staff ]`, `[ Edit / Change PIN ]`, `[ Deactivate Account ]`.
- Pure local authentication backed by PBKDF2/scrypt password hashing in SQLite.

---

## 5. Restaurant Pairing & Key Architecture

### 5.1 One-Time Restaurant Pairing Key
- **Format**: 10-character alphanumeric string (e.g., `T@3XYCM@6_`) or 64-character token.
- **Workflow**:
  1. Restaurant admin copies the 10-character Pairing Key from the Web Admin dashboard.
  2. During installation or initial setup, the key is entered once.
  3. The local bridge exchanges the key via Supabase RPC `rms_pair_local_bridge` using the machine's hardware GUID.
  4. The local system securely stores the local bridge token in Windows DPAPI and `.env`.
  5. The desktop app automatically detects the paired token from all standard locations (`C:\Program Files\RMS Local Bridge\.env`, local app data, service environment).
  6. No repeated key entry is required during regular shifts.

---

## 6. Strict Aesthetic & Quality Rules

1. **Zero AI Emojis**: Never use emojis in UI buttons, titles, cards, list rows, or status messages. Use clean uppercase typography, geometric glyphs (`·`, `|`, `+`, `-`), or status pill borders.
2. **High-Contrast Dark Aesthetic**: Use `#0A0A0C` background, `#14171F` panel surfaces, and `#DC2626` crimson brand accents.
3. **Local-First Speed**: All operations (billing, menu toggling, role switching) must execute instantaneously against local SQLite without waiting for cloud round-trips.
