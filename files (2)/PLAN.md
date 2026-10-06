# PLAN.md — Master Build Prompt (Loop Style)

## Rules for the agent (read every time before doing anything)

1. Read `README.md` Status Table first. Find the first row still marked "Not Started" or "In Progress" — that is your current task. Ignore everything else in this repo unless the current feature file references it.
2. Open only the matching `/features/NN-name.md` file. That is your full spec for this step. Do not pull in PRD/SRS/DFD unless the feature file explicitly tells you to check something there.
3. Do ONE feature at a time. When done, run/check the "Definition of Done" checklist at the bottom of that feature file.
4. When Definition of Done is fully checked, update `README.md` Status Table: mark this row "Done".
5. STOP. Report to the user what was built and what was verified. Ask: "Agla step (feature #N+1) shuru karun?"
6. Do NOT start the next feature automatically. Wait for explicit user confirmation ("haan start karo" / "next").
7. If a feature file's instructions conflict with something already built, stop and ask — don't silently override earlier work.

## Feature Order (do not skip ahead)

1. Roles & Auth (`07-roles-auth.md`) — foundation, everything else needs login/roles
2. Menu Management (`08-menu-management.md`) — need menu before orders can exist
3. Dine-in QR Ordering (`01-dinein-ordering.md`)
4. WhatsApp Delivery Ordering (`02-whatsapp-delivery.md`)
5. Offline Local Sync + Print Bridge (`03-offline-local-sync.md`)
6. Inventory + Vendor Module (`04-inventory-vendor.md`)
7. Special Offers (`06-special-offers.md`)
8. Excel Export (`10-excel-export.md`)
9. Super-Admin Panel (`09-super-admin.md`)
10. FBR Digital Invoicing (`05-fbr-integration.md`) — last, needs live restaurant to get real FBR credentials for testing

### Delivery tracking requirements for the Rider step (Feature 07)

When implementing the Rider role, include the delivery handoff and customer tracking requirements recorded in `07-roles-auth.md`: riders see the payment state for their assigned deliveries, and customers can view payment state plus the assigned rider's name and phone number without creating an account. Do not implement this during Feature 02. Select and verify the online payment provider before treating an online payment as paid; only server-confirmed payment results count as paid. Customer tracking must use a secure, non-guessable order token rather than an exposed sequential order number.

## Format every step must follow

```text
STEP N: [feature name]
- Reading: features/NN-name.md
- Building: [short list of files/components]
- Definition of Done: [checklist from feature file]
- Result: [what got built, what was tested]
- Next: waiting for user confirmation to proceed to STEP N+1
```

## Rules for the agent (read every time before doing anything)

Read README.md Status Table first. Find the first row still marked "Not Started" or "In Progress" — that is your current task. Ignore everything else in this repo unless the current feature file references it.

Open only the matching /features/NN-name.md file. That is your full spec for this step. Do not pull in PRD/SRS/DFD unless the feature file explicitly tells you to check something there.

Do ONE feature at a time. When done, run/check the "Definition of Done" checklist at the bottom of that feature file.

When Definition of Done is fully checked, update README.md Status Table: mark this row "Done".

STOP. Report to the user what was built and what was verified. Ask: "Agla step (feature #N+1) shuru karun?"

Do NOT start the next feature automatically. Wait for explicit user confirmation ("haan start karo" / "next").

If a feature file's instructions conflict with something already built, stop and ask — don't silently override earlier work.

Write only the code this feature actually needs. No speculative abstractions, no extra config options, no helper functions "for later," no boilerplate the feature doesn't use. If a feature needs 80 lines, write 80 lines — not 800. If you're about to generate a large file, stop and check: does every part of this serve something in the current feature file's spec? If not, cut it.

Touch only the files this feature requires. Don't refactor, rename, or "clean up" unrelated files/folders while building a feature — changes must stay isolated to what the feature file describes, following the existing folder structure in DFD_FINAL.md (each feature lives in its own folder: /orders, /kitchen, /inventory, etc.). If something outside your current feature genuinely needs changing, stop and tell the user — don't do it silently as part of this step.

## Feature Order (do not skip ahead)

Roles & Auth (07-roles-auth.md) — foundation, everything else needs login/roles

Menu Management (08-menu-management.md) — need menu before orders can exist

Dine-in QR Ordering (01-dinein-ordering.md)

WhatsApp Delivery Ordering (02-whatsapp-delivery.md)

Offline Local Sync + Print Bridge (03-offline-local-sync.md)

Inventory + Vendor Module (04-inventory-vendor.md)

Special Offers (06-special-offers.md)

Excel Export (10-excel-export.md)

Super-Admin Panel (09-super-admin.md)

FBR Digital Invoicing (05-fbr-integration.md) — last, needs live restaurant to get real FBR credentials for testing

## Format every step must follow

```text
STEP N: [feature name]
- Reading: features/NN-name.md
- Building: [short list of files/components]
- Definition of Done: [checklist from feature file]
- Result: [what got built, what was tested]
- Next: waiting for user confirmation to proceed to STEP N+1
```
