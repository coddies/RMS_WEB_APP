# Feature 08: Menu Management (Admin) — build second, before ordering features

## What
Admin/Manager screen to create, edit, delete menu items and toggle stock status. This must exist before dine-in/delivery ordering (Features 01/02) can be tested with real data.

## Screen
- Category sections (collapsible), item count badge per category
- Each item row: thumbnail, name, price, category tag, In-Stock/Sold-Out toggle, edit icon, delete icon
- Search bar to filter by name
- "+ Add New Item" opens a panel: photo upload, name, price, category dropdown, description, ingredient-linking multi-select (connects to Feature 04 inventory), Save/Cancel

## Requirements
- In-Stock/Sold-Out toggle must reflect immediately on the live customer menu (Feature 01/02) — no cache delay beyond a few seconds.
- Photo upload should compress/resize before storing (avoid huge file sizes slowing menu load — ties to NFR-03 performance requirement in SRS).
- Deleting an item that has active orders referencing it should be prevented or soft-deleted (don't break order history).

## Definition of Done
- [ ] Add/edit/delete item works and reflects on customer menu within a few seconds
- [ ] Sold-out toggle immediately blocks that item from being added to cart on customer side
- [ ] Search filters correctly by name
- [ ] Ingredient-linking correctly connects to inventory records for Feature 04
