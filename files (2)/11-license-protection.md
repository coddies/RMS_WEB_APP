# Feature 11: License Protection (build after core v1 is live — not launch-blocking)

## What
Local-bridge refuses to run on an unregistered/unauthorized machine, shows a contact message, and can be remotely disabled via Super-Admin if a restaurant's subscription lapses — all without breaking offline-first operation.

## Flow
1. On first run after install, local-bridge registers its hardware fingerprint against the tenant's `license_key`.
2. On every subsequent startup: check cached signed license token (valid offline up to 7 days) → if due, attempt phone-home to Supabase to refresh it.
3. Fingerprint mismatch → refuse to start, show: "Unauthorized installation detected. For licensing support, contact: [name/number]."
4. `subscription_status = expired/suspended` (set from Super-Admin) → next phone-home disables bridge with "Subscription expired" message.
5. All check events logged to `license_events`.

## Requirements
- MUST NOT require internet on every single startup — offline grace period (7 days cached + 3 day buffer) is mandatory, per BUSINESS.md constraint.
- Already-placed/queued orders and printing must never be blocked by a license issue — only new order intake may be restricted after full grace period expiry.
- Super-Admin panel (Feature 09) gets: license status per tenant, last check-in time, revoke/reissue controls.

## Definition of Done
- [ ] Fresh install on a new machine registers fingerprint correctly
- [ ] Copying the installed bridge folder to a second machine triggers mismatch + contact message
- [ ] Disconnecting internet for less than 7 days: bridge keeps working normally
- [ ] Setting subscription_status to 'expired' in Super-Admin correctly disables bridge on next check-in
- [ ] license_events logs check-in, mismatch, and revoke events correctly
- [ ] No existing queued/offline order or print job is ever blocked by a license check
