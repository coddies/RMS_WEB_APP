# Feature 03: Offline Local Sync + Print Bridge

## What
Counter operations (cashier orders, billing, kitchen tickets, and printing) must work with zero internet dependency in an installed native Windows counter app. The local-bridge remains the background Windows service for SQLite, printing, and synchronization. Public QR/WhatsApp ordering and Manager/Rider roles remain on the web app.

## Why local-bridge is required
Browsers cannot send ESC/POS commands directly to USB/LAN thermal printers (security restriction). A small local helper program is required to receive print jobs and talk to the printer hardware.

## Components
1. **Native counter app**: a Windows desktop UI installed with local-bridge opens cashier and kitchen views in a native window. It reads the cached menu and local order/ticket/payment state from SQLite, and never requires Chrome or the Vercel site for counter operations.
2. **Menu/price cache**: when online, local-bridge pulls current menu + prices from Supabase and stores in local SQLite. Refreshed periodically and when the native app is used online.
3. **Offline order queue**: when internet is down, cashier enters orders manually (or via table QR if the restaurant's local network — not internet — still works). Orders are persisted in SQLite with sequence numbers and `sync_status=PENDING`.
4. **Print service**: native app sends receipt/KOT print jobs to local-bridge; local-bridge formats ESC/POS and sends to the printer via USB/LAN. Must complete in <500ms.
5. **Sync worker**: when internet returns, sync queued orders in sequence order and pull new online guest orders/menu changes. Use a least-privilege staff-authenticated sync path; never put the Supabase service-role key in the desktop app or installer.

## Requirements
- Local-bridge must run as a lightweight background service on the restaurant's counter PC (Windows), auto-start on boot.
- The native Cashier/Kitchen app installs alongside local-bridge and follows `DESIGN_FINAL.md`: black/red tokens, the existing staff dashboard shell/layout, and minimum 48x48 touch targets.
- Manager and Rider continue to use the web/Vercel flow; counter-app changes must not alter their routes or role checks.
- If internet drops mid-session, no data loss and no interruption to order-taking or printing.
- Public QR/WhatsApp web ordering (Features 01/02) depends on the restaurant's own internet — if restaurant wifi is down, new online orders queue until the restaurant reconnects; this is a known, accepted limitation (not a bug).

## Definition of Done
- [x] Offline queue/reconnect simulated: two local orders remained queued before reconnect and then synced; print portion is **Skipped — hardware unavailable** (non-blocking, retest with a physical printer).
- [x] Orders taken offline synced completely in sequence order (1, 2) with no duplicate: replaying the first local submission returned the existing queue entry; both cloud rows are `SYNCED` and appear on the cashier dashboard as orders #26 and #27.
- [ ] Print job completes in under 500ms from approval when a printer is connected — **Skipped — hardware unavailable**; retest when a physical USB/LAN printer is available (non-blocking per owner).
- [x] Menu cache refreshed with 2 items; cached prices matched the current Supabase prices after reconnect.
- [x] Local-bridge is packaged as an installable Windows app/service (`.exe` installer), not only runnable from source/dev mode.
- [ ] Installed local-bridge auto-starts on PC boot and runs in the background without a terminal window.
- [ ] Fresh install on a clean machine prompts for the restaurant slug and Supabase configuration, verifies the slug, and starts successfully without manual file editing.
- [ ] (a) Native counter app opens and accepts a manual order with internet disconnected; the order, kitchen ticket, payment state, and print request remain local.
- [ ] (b) Cashier/Kitchen native UI visually matches the approved black/red staff dashboard layout and tokens in `DESIGN_FINAL.md`.
- [ ] (c) Background sync pushes local orders and pulls menu/online guest-order updates after reconnect, with no duplicates and correct sequence.
- [x] (d) Manager/Rider web routes and role components were left unchanged; the Next.js production build passed.
- [ ] Native app authenticates Cashier/Kitchen staff and prevents each role from opening the other's work area.
- [ ] Installer launches the native counter app without a browser and registers a Start menu shortcut.
- [ ] Offline sync uses a least-privilege, staff-authenticated Supabase path; no service-role key is shipped to the counter PC.
