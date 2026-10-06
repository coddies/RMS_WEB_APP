# Software Requirements Specification (SRS) — FINAL
## Local-First Multi-Tenant Restaurant Management System (RMS)

**Version:** 2.0 (Final — supersedes v1.0)

---

## 1. Scope

One multi-tenant web application (deployed once, on Vercel) + one lightweight local bridge program (installed once per restaurant PC) + shared cloud database (Supabase). New restaurants are onboarded via configuration (a database record), never via new code or redeployment.

---

## 2. Functional Requirements

**FR-01 — Dine-in QR Order Capture**
System reads `table_id` + `type=dinein` from URL, binds order to table, pushes to local Cashier Dashboard via realtime event with audio alert.

**FR-02 — WhatsApp Delivery Order Generation**
System generates a `wa.me` deep link with pre-filled order text (items, name, address, phone). No paid WhatsApp Business API required.

**FR-03 — Local Print Bridge**
Since browsers cannot talk directly to USB/LAN thermal printers, a small local helper program (not a full desktop app) receives print jobs from the web/local dashboard and sends ESC/POS commands to the printer. Print trigger latency < 500ms.

**FR-04 — Offline Order Queue**
Local app caches current menu + prices when online. On internet loss, orders keep being entered manually and stored in a local SQLite queue (sequence-numbered). On reconnect, a background sync worker flushes the queue to Supabase, using sequence order to prevent duplicates.

**FR-05 — Inventory & Threshold Alerts**
Manager enters raw ingredient stock (name, quantity, unit, threshold). Menu items are linked to ingredients (simple quantity-per-item mapping). On order fulfillment, linked stock is decremented. Crossing the threshold triggers an alert to the role(s) configured per restaurant (`notify_low_stock_to: manager | cashier | both`).

**FR-06 — Vendor Module (Premium, opt-in)**
If enabled for a tenant: ingredients can be linked to a vendor record. Low-stock threshold breach auto-sends a WhatsApp restock request to the vendor's number. Vendor has an optional PWA (not a native/Play Store app) to view requests and update supply status.

**FR-07 — FBR Digital Invoicing (Monthly Sales Tax)**
Each tenant stores its own NTN + FBR POS registration token. Every completed sale triggers an API call to FBR's invoicing endpoint; the returned Invoice Reference Number + QR code is printed on the receipt via the local print bridge.

**FR-08 — Special Offer Scheduling**
Any menu item can be flagged as a special offer with a day-of-week selector and a start/end date-time. Active offers are visually distinct on the customer menu and auto-expire without manual removal.

**FR-09 — Role-Based Access**
Admin/Manager (full access), Cashier (orders + billing, no menu/staff edit), Kitchen (ticket view only), Rider (own assigned deliveries only, phone+PIN login), Customer (no login, guest order — name/phone/address captured minimally per order).

**FR-10 — Excel Sales Export**
Dashboard provides a manual "Export Sales" action producing `.xlsx` for any date range, plus an automatic daily local export, so restaurant sales data always exists independently of the platform's own database.

**FR-11 — Multi-Tenant Theming**
Each restaurant's branding (logo, primary color, name) is stored as tenant config and applied via CSS variables at runtime — same codebase, no per-restaurant build.

**FR-12 — Super-Admin Panel**
Platform owner can create/edit tenant records, assign tier (Basic/Premium), and track subscription status/renewal date, separate from any restaurant's own dashboard.

**FR-13 — Delivery Form Validation**
Delivery checkout form (name, phone, address) must validate client-side before enabling order submission: name min 2 chars, phone must match Pakistani mobile format, address min 10 chars, cart non-empty.

**FR-14 — Spam Protection**
Delivery order form includes a honeypot field to catch bots, and a server-side rate limit of max 5 order submissions per phone number per hour.

**FR-15 — Privacy Policy**
Since customer name/phone/address is collected on every delivery order, a basic Privacy Policy page must be accessible from the customer menu, stating what data is collected and why (order fulfillment only, not shared with third parties beyond FBR reporting requirements).

---

## 3. Non-Functional Requirements

**NFR-01 — Offline Reliability**
Local counter operations (order entry, print, ticket view) must have 100% uptime independent of internet status.

**NFR-02 — Sync Integrity**
Offline-queued orders must sync without duplication or loss once connectivity returns (sequence-based, single-terminal assumption per restaurant — no multi-device conflict resolution needed at this scale).

**NFR-03 — Performance**
Customer menu load < 1.5s on 3G. Print trigger < 500ms from approval.

**NFR-04 — Multi-Tenancy & Scale**
Single deployment must isolate tenant data via Row-Level Security; onboarding a new restaurant requires zero code changes.

**NFR-05 — Usability**
Minimum 48x48px touch targets on all counter/kitchen interfaces; high-contrast dark theme for low-light kitchen use.

---

## 4. Explicitly Deferred (Not in v1)
Gram-level recipe deduction, multi-station KDS, native rider app, full offline desktop GUI app, income tax integration.
