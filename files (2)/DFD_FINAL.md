# Data Flow Diagrams (DFD) + System File Structure — FINAL
## Local-First Multi-Tenant Restaurant Management System (RMS)

**Version:** 2.0 (Final — supersedes v1.0)

---

## 1. Level 0 — Context Diagram

```
[ Customer (Mobile) ] --scan QR / open link--> [ Web App (Vercel) ] --order event--> [ Local Restaurant App ]
                                                       |                                      |
                                                [ Cloud DB (Supabase) ] <----sync (when online)---+
                                                       |                                      |
                                                       |                              [ Local Print Bridge ] --> [ Thermal Printer ]
                                                       |
                                            [ FBR API ] <--invoice data-- [ Local Restaurant App ]
                                                       |
                                          [ WhatsApp (wa.me) ] <--delivery order text-- [ Customer ]
                                                                <--restock alert-- [ Vendor, if module enabled ]
```

## 2. Level 1 — Core Sub-Processes

```
[Customer] -> P1: Order Capture (QR-bound or delivery form)
   -> writes to DS-1 (Orders)

P1 -> P2: Cashier/Kitchen Sync
   -> local realtime push to Cashier Dashboard + Kitchen ticket view
   -> P2 -> Local Print Bridge -> Thermal Printer

P1 -> P3: Inventory Engine
   -> reads DS-2 (Ingredients + Menu-Ingredient links)
   -> decrements stock -> if below threshold -> Alert (to Manager/Cashier per tenant config)
   -> if Vendor module ON -> WhatsApp alert to linked Vendor (DS-5)

P2 -> P4: FBR Reporting
   -> on sale completion -> API call to FBR (using tenant's stored NTN/token)
   -> receives IRN + QR -> sent back to Print Bridge for receipt

P4 -> P5: Offline Queue Manager
   -> if no internet: order/print/inventory continue locally, FBR call queued
   -> on reconnect: flush queue to Supabase + FBR in sequence order

All processes -> P6: Excel Export
   -> daily auto-export + on-demand export of DS-1 to local .xlsx
```

## 3. Data Stores

- **DS-1: Orders** — items, status, type (dinein/delivery), table_id (nullable), tenant_id, timestamps, sync_status
- **DS-2: Menu & Ingredients** — menu_items, ingredients, menu_item_ingredient_links, stock_qty, threshold
- **DS-3: Tenant Config** — branding (logo/colors), tier (Basic/Premium), FBR credentials (NTN, token), notify_low_stock_to setting
- **DS-4: Users** — Admin/Manager/Cashier/Kitchen/Rider records, role, tenant_id, credentials
- **DS-5: Vendors** (Premium only) — vendor contact, linked ingredients
- **DS-6: Special Offers** — item_id, days_of_week, start/end datetime

---

## 4. System File Structure

**Single repository, single deployment — one codebase serves every restaurant.** Onboarding a new restaurant = one new row in `tenants` table, no new code, no redeploy.

```
/rms-platform
│
├── /apps
│   ├── /web                          # Next.js app — deployed ONCE on Vercel
│   │   ├── /app
│   │   │   ├── /menu                 # Customer-facing (QR + delivery), reads ?table= / ?type=
│   │   │   ├── /dashboard            # Unified staff shell (sidebar-based)
│   │   │   │   ├── /orders
│   │   │   │   ├── /kitchen
│   │   │   │   ├── /inventory
│   │   │   │   ├── /vendors          # only rendered if tenant.tier includes vendor module
│   │   │   │   ├── /staff
│   │   │   │   └── /settings
│   │   │   ├── /rider                # Rider PWA view
│   │   │   ├── /track/[orderId]      # live order status (Premium: live map)
│   │   │   └── /super-admin          # platform owner only — tenant/subscription mgmt
│   │   ├── /lib
│   │   │   ├── tenant-resolver.ts    # resolves tenant by slug/subdomain -> loads DS-3 config
│   │   │   ├── theme-engine.ts       # applies tenant colors/logo via CSS vars
│   │   │   ├── fbr-client.ts         # FBR API integration (per-tenant token)
│   │   │   └── whatsapp-link.ts      # wa.me link builder
│   │   └── /components               # shared UI (role-agnostic, styled via theme vars)
│   │
│   └── /local-bridge                 # installed ONCE per restaurant PC
│       ├── print-service              # ESC/POS thermal print handler
│       ├── local-db (SQLite)          # offline order cache + queue
│       ├── menu-cache-sync            # pulls latest menu/prices when online
│       └── sync-worker                # flushes offline queue to Supabase + FBR on reconnect
│
├── /packages
│   ├── /db                           # Supabase schema, migrations, RLS policies (shared)
│   └── /ui                           # shared design-system components (black-red theme tokens)
│
└── /docs
    ├── PRD_FINAL.md
    ├── SRS_FINAL.md
    └── DFD_FINAL.md
```

**Per-restaurant onboarding checklist (no code changes):**
1. Insert row in `tenants` (DS-3): slug, name, logo, colors, tier, FBR NTN/token
2. Generate table QR codes (auto, from tenant slug + table numbers)
3. Install `/local-bridge` on restaurant PC, configure with `tenant_id`
4. Create staff user accounts (DS-4)
