# Feature 09: Super-Admin Panel (Platform Owner Only)

## What
A separate, secured panel — not visible to any restaurant — for the platform owner to onboard and manage restaurants.

## Screens
1. Restaurant list: name, slug, tier (Basic/Premium), status (active/inactive), subscription renewal date
2. Add/Edit restaurant: name, slug, logo upload, primary color, tier assignment, contact info
3. Subscription tracking: payment status, last payment date, next renewal due — manually updated for v1 (no payment gateway integration yet)

## Requirements
- Onboarding a new restaurant here must require zero code deployment — purely a database record (tenant) creation, per DFD_FINAL.md file structure.
- Auto-generates the restaurant's table QR codes based on slug + table count entered.

## Definition of Done
- [ ] Creating a new restaurant here makes it immediately live at its slug URL, no redeploy
- [ ] Tier assignment correctly gates Premium-only features (vendor module, etc.) for that tenant
- [ ] QR codes generate correctly for the entered table count
