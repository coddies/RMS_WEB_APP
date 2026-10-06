# Product Requirements Document (PRD) — FINAL
## Local-First Multi-Tenant Restaurant Management System (RMS)

**Version:** 2.0 (Final — supersedes v1.0)
**Status:** Approved for Build
**Target Market:** Faisalabad / Chiniot small-to-mid restaurants (expandable)

---

## 1. Executive Summary

A **single-codebase, multi-tenant** restaurant ordering + billing + inventory system. One deployment serves every onboarded restaurant — a new restaurant is added by creating a database record (tenant), not by rebuilding or redeploying software.

Core principle: **local-first, online-enhanced.**
- Counter operations (orders, billing, printing, kitchen tickets) run on a **local app + local database (SQLite)** at the restaurant, independent of internet.
- When internet is available, the same local app syncs to the cloud (Supabase) for backup, reporting, and to receive orders placed via the public QR/WhatsApp web menu.
- When internet is down: QR/website ordering is unavailable (no internet = customer can't load the web menu), but the counter system keeps working fully — staff take orders manually at the till.

---

## 2. User Roles

| Role | Access | Login |
|---|---|---|
| Customer | Public web menu (QR / delivery link) | None (guest) |
| Cashier | Orders, billing, print | Username/PIN |
| Kitchen/Chef | Kitchen ticket view only | Username/PIN |
| Manager/Admin (per restaurant) | Full restaurant dashboard: menu, inventory, staff, reports, vendor, offers | Username/Password |
| Rider | Assigned deliveries only | Phone + PIN |
| Platform Super-Admin (you) | Onboard restaurants, manage tiers/subscriptions, usage monitoring | Separate secured panel |

---

## 3. Tiering

### Basic (included for every onboarded restaurant)
- Dine-in QR ordering (table-specific link)
- WhatsApp delivery/takeaway ordering (free `wa.me` link, no paid API)
- Cashier dashboard + order management
- Kitchen ticket view
- Local offline order-taking + local thermal print (via print bridge)
- Simple inventory (stock qty + threshold alerts)
- FBR monthly sales tax digital invoicing (confirmed required — all target restaurants are FBR-registered)
- Excel auto-export of sales data
- Special offer scheduling (day-of-week + date range)

### Premium (opt-in, extra cost)
- Vendor/Supplier module (linked vendors, auto low-stock WhatsApp alert to vendor, vendor PWA)
- Rider live tracking map (for restaurants with delivery volume justifying it)
- Advanced reporting/analytics

*(FBR moved from "premium" to "Basic" — confirmed all target restaurants are already FBR-registered with their own POS/NTN numbers.)*

---

## 4. Key Functional Flows

### 4.1 Dine-in (QR)
`https://[tenant].domain.com/menu?table=T-05&type=dinein`
Scan → menu opens with table pre-bound → customer orders → order appears on local Cashier Dashboard with sound alert → cashier approves → kitchen ticket prints/shows.

### 4.2 Delivery/Takeaway (WhatsApp)
`https://[tenant].domain.com/menu?type=delivery`
Customer browses menu → enters Name, Address, Phone → taps "Order via WhatsApp" → `wa.me` link opens with pre-filled order text → customer hits Send → order also logs on Cashier Dashboard.

### 4.3 Offline Mode
- Menu + prices cached locally on restaurant PC when internet is available.
- If internet drops: local app keeps taking manual orders + printing, queues them locally (sequenced, no duplicates).
- On reconnect: queued orders auto-sync to cloud.
- Public QR/WhatsApp web ordering is unaffected by restaurant's local internet (it's hosted on Vercel) — but if the *restaurant's* wifi is down, staff can't see new incoming online orders live; those queue until reconnect.

### 4.4 Inventory + Vendor
- Manager enters raw stock (e.g. "Chicken — 5kg", threshold "1kg").
- Menu items linked to ingredients (simple mapping, not gram-precise recipe calc in v1).
- On order, linked ingredient stock decremented by estimated amount.
- Below threshold → alert sent to configured role(s) (manager/cashier/both — per-restaurant setting).
- **(Premium)** If vendor module enabled: low stock also triggers auto WhatsApp message to the linked vendor.

### 4.5 FBR (Sales Tax — Monthly)
- Each restaurant registers independently on FBR IRIS with their own NTN, gets a POS registration number + API token.
- Token stored per-tenant in the system.
- Every sale triggers an API call to FBR → returns Invoice Reference Number + QR code → printed on receipt.

### 4.6 Special Offers
- Any menu item: 3-dot menu → "Mark as Special Offer" → select day(s) of week + start/end date-time.
- Active offers auto-highlighted on customer menu (distinct card style), auto-expire.

---

## 5. Platform (Super-Admin) Requirements
- Add/edit restaurant (name, slug, logo, colors, contact)
- Assign tier (Basic/Premium) and track subscription/payment/renewal
- View active vs inactive restaurants
- (Later) usage stats, support log

---

## 6. Explicitly Out of Scope (v1)
- Gram-precise recipe-level inventory deduction
- Multi-station KDS routing
- Native rider mobile app on Play Store (PWA only)
- Desktop `.exe` with full offline GUI (replaced by lightweight local print-bridge + cache, not a full native app)
- Income tax integration (only monthly sales tax/FBR digital invoicing is in scope)
