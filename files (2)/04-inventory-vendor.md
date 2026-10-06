# Feature 04: Inventory + Vendor Module

## What
Simple raw-ingredient stock tracking with low-stock alerts, plus an optional (Premium, opt-in) vendor auto-restock-alert module.

## Inventory (Basic — all tenants)
1. Manager adds raw ingredients: name, quantity, unit (kg/liter/piece), low-stock threshold.
2. Menu items are linked to ingredients via a simple mapping (e.g. "Chicken Karahi" uses "Chicken" — quantity per item, not full gram-precise recipe calc).
3. On order fulfillment, linked ingredient stock is decremented by the mapped amount.
4. When stock crosses below threshold, an alert fires to the role(s) configured per tenant (`notify_low_stock_to`: manager / cashier / both — a per-restaurant setting in tenant config).
5. Inventory dashboard view: list of ingredients with stock level progress bar (green/amber/red), low-stock items pinned to top.

## Vendor Module (Premium, opt-in — only shown if tenant.tier includes it)
1. Manager can add vendor records (name, phone, services/items supplied).
2. Ingredients can be linked to a vendor.
3. When linked ingredient crosses low-stock threshold AND vendor module is enabled, an automatic WhatsApp message (`wa.me` link, same free method as Feature 02) is sent to the vendor's number with a restock request.
4. Optional vendor PWA: vendor can view restock requests and mark them fulfilled. Not a native/Play Store app.

## Definition of Done
- [ ] Adding stock and setting threshold works and persists
- [ ] Order fulfillment correctly decrements linked ingredient stock
- [ ] Threshold breach sends alert to correctly configured role(s)
- [ ] Vendor module is completely hidden/inactive for tenants who haven't opted in
- [ ] (If vendor enabled) threshold breach triggers correctly formatted WhatsApp message to vendor
