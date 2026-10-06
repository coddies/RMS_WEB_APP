# Feature 07: Roles & Auth (build first — foundation)

## Roles
| Role | Login | Access |
|---|---|---|
| Customer | None (guest) | Public menu only, minimal data captured per order (name/phone/address on delivery) |
| Cashier | Username + PIN | Orders, billing, print |
| Kitchen/Chef | Username + PIN | Kitchen ticket view only |
| Manager/Admin | Username + Password | Full dashboard: menu, inventory, staff, reports, offers, vendor (if enabled) |
| Rider | Phone + PIN (simple) | Own assigned deliveries only |
| Platform Super-Admin | Separate secured login | Tenant management (Feature 09) — not visible to any restaurant user |

## Rider Delivery and Customer Tracking (implement with Feature 07)
- Rider sees only deliveries assigned to their own rider account, including whether payment is paid online or still pending/unpaid.
- The customer remains a guest. A customer-facing order-tracking view shows the current payment state and, after assignment, the assigned rider's name and phone number. Before assignment, show that a rider has not yet been assigned.
- Customer tracking must use a secure, non-guessable per-order token; never expose another customer's order by using a sequential order number alone.
- Treat an online payment as paid only after the selected payment provider confirms it server-side (for example, a verified provider callback). Choose the provider and confirmation method before implementing online payments; do not trust a browser-submitted paid flag.

## Requirements
- All roles except Customer and Super-Admin are scoped to a single tenant_id (Row-Level Security — a Cashier at Restaurant A can never see Restaurant B's data).
- Login UI optimized for fast PIN entry on a shared counter device (large number pad, minimal fields).
- Session length: reasonable for a work shift (e.g. 8-12 hrs) before re-login required.
- No customer account/signup system — guest ordering only, data stored per-order (not a customer profile system) for now.

## Definition of Done
- [ ] Each role can log in and see only their permitted views
- [ ] Cashier cannot access Menu Management or Staff settings
- [ ] Kitchen cannot access billing
- [ ] Rider cannot see other riders' or other restaurants' deliveries
- [ ] Tenant data isolation verified: logging in as Restaurant A staff never surfaces Restaurant B data
