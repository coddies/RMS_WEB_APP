# RMS Platform — Project README (Source of Truth)

> **Rule for any AI coding agent working on this repo:** Read this file first, every session. It tells you what exists, what's next, and where to find the spec for the current task. Do NOT re-read the full PRD/SRS/DFD every time — read only the relevant `/docs/features/*.md` file for the step you're on. Update the Status Table below after finishing a step.

---

## 1. What This Is

A single-codebase, multi-tenant restaurant ordering + billing + inventory system for small/mid restaurants (starting Faisalabad/Chiniot). Local-first: Cashier/Kitchen counter operations run in an installed Windows app using local SQLite and printing; the public QR/WhatsApp menu and Manager/Rider web flows run on Vercel. Both sync through Supabase when online.

Full specs: `PRD_FINAL.md`, `SRS_FINAL.md`, `DFD_FINAL.md`, `DESIGN_FINAL.md`, `SECURITY_FINAL.md`.
Step-by-step build instructions: `PLAN.md`.
Per-feature detail: `/features/*.md`.

---

## 2. Status Table

| # | Feature | Spec File | Status |
|---|---|---|---|
| 1 | Dine-in QR Ordering | features/01-dinein-ordering.md | Done |
| 2 | WhatsApp Delivery Ordering | features/02-whatsapp-delivery.md | Done |
| 3 | Offline Local Sync + Print Bridge | features/03-offline-local-sync.md | In Progress |
| 4 | Inventory + Vendor Module | features/04-inventory-vendor.md | Not Started |
| 5 | FBR Digital Invoicing | features/05-fbr-integration.md | Not Started |
| 6 | Special Offers | features/06-special-offers.md | Not Started |
| 7 | Roles & Auth | features/07-roles-auth.md | In Progress |
| 8 | Menu Management (Admin) | features/08-menu-management.md | In Progress |
| 9 | Super-Admin Panel | features/09-super-admin.md | Not Started |
| 10 | Excel Export | features/10-excel-export.md | Not Started |

*(Agent: change "Not Started" -> "In Progress" -> "Done" as you work. This table is the only thing that needs updating after each step — don't rewrite this README's other sections.)*

---

## 3. Tech Stack (locked)

- Web: Next.js (App Router), deployed on Vercel — customer menu, Manager/Rider staff flows, super-admin
- Local: Windows Cashier/Kitchen counter app plus local-bridge (print service + SQLite offline queue/cache + sync worker) — installed on the restaurant counter PC
- DB: Supabase (Postgres), Row-Level Security per tenant
- WhatsApp: free `wa.me` deep links only — no paid API
- Design: Black + Red dark theme (see DESIGN_FINAL.md)

## 4. Explicitly Out of Scope (v1)

Gram-level recipe deduction, multi-station KDS, native rider Play Store app, income tax integration.

## 5. Next Action

See `PLAN.md` — do not start a step unless told to by the user.

| # | Feature | Spec File | Status |
|---|---|---|---|
| 1 | Roles & Auth | features/07-roles-auth.md | In Progress |
| 2 | Menu Management (Admin) | features/08-menu-management.md | In Progress |
| 3 | Dine-in QR Ordering | features/01-dinein-ordering.md | In Progress (blocked — needs Auth for cashier realtime test) |
| 4 | WhatsApp Delivery Ordering | features/02-whatsapp-delivery.md | In Progress |
| 5 | Offline Local Sync + Print Bridge | features/03-offline-local-sync.md | In Progress |
| 6 | Inventory + Vendor Module | features/04-inventory-vendor.md | Not Started |
| 7 | Special Offers | features/06-special-offers.md | Not Started |
| 8 | Excel Export | features/10-excel-export.md | Not Started |
| 9 | Super-Admin Panel | features/09-super-admin.md | Not Started |
| 10 | FBR Digital Invoicing | features/05-fbr-integration.md | Not Started |
