# Feature 05: FBR Digital Invoicing (Monthly Sales Tax)

## What
Every completed sale is reported to FBR's digital invoicing system in real time; the returned invoice reference + QR code is printed on the customer receipt. This is monthly sales tax reporting — NOT annual income tax (out of scope).

## Prerequisite (do this LAST, per PLAN.md — needs a real onboarded restaurant)
- Each restaurant registers independently on FBR's IRIS portal using their own NTN/CNIC and receives a POS registration number + API token.
- The restaurant provides this token during onboarding — it is NOT something the platform generates.

## Flow
1. Token + NTN stored per-tenant (encrypted at rest) in tenant config.
2. On sale completion (order marked PAID/COMPLETED), system builds an invoice payload (items, tax, amount) and calls FBR's API using that tenant's token.
3. FBR returns an Invoice Reference Number (IRN) + QR code.
4. IRN + QR code is added to the receipt and sent to the local print bridge (Feature 03) for printing.
5. If FBR API is unreachable (e.g. FBR downtime, or restaurant offline): queue the invoice call like any other offline-queued action (see Feature 03) and retry on reconnect. Receipt still prints without the FBR QR code in this case, marked for later reprint/update if needed.

## Requirements
- Test against FBR's sandbox environment first (per FBR technical docs) before going live with any real restaurant.
- Per-tenant token storage must be isolated (tenant A's token never usable for tenant B's calls).

## Definition of Done
- [ ] Sandbox test invoice successfully round-trips (payload sent, IRN+QR received)
- [ ] Receipt correctly prints IRN + QR code when FBR call succeeds
- [ ] Graceful fallback (queued retry) when FBR call fails or restaurant is offline
- [ ] Token stored encrypted, scoped correctly per tenant
