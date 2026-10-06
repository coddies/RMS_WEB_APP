# Feature 01: Dine-in QR Ordering

## What
Each restaurant table has a unique QR sticker. Scanning opens the menu pre-bound to that table; order goes straight to the Cashier Dashboard.

## Flow
1. URL: `https://[tenant].domain.com/menu?table=T-05&type=dinein`
2. Page reads `table` and `type` from URL params on load.
3. Top of menu shows a badge: "Table #05 — Dine In".
4. Customer browses categories, adds items, views cart.
5. Checkout (dine-in): no payment/address fields — single "Submit Order to Kitchen" button.
6. On submit: order written to `orders` table (tenant_id, table_id, items, status=PENDING, order_type=DINE_IN).
7. Cashier Dashboard receives it via realtime event + audio beep + visual flash.
8. Confirmation screen shown to customer with order number.

## Requirements
- No login required for customer.
- QR codes are auto-generatable per tenant (slug + table number) — not manually created images each time.
- Menu item availability must reflect current in-stock/sold-out toggle (Feature 08) at time of order.

## Definition of Done
- [ ] Scanning a table QR opens menu with correct table badge shown
- [ ] Order submission creates a DB row with correct table_id + tenant_id
- [ ] Cashier Dashboard shows new order within 2 seconds with sound alert
- [ ] Sold-out items cannot be added to cart
- [ ] Works correctly for at least 2 different tenants without code change (multi-tenant check)
