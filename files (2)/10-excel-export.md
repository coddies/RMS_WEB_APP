# Feature 10: Excel Sales Export

## What
Restaurant sales data must always exist independently of the platform, in a format the owner controls (Excel) — this is a trust/ownership requirement, not just a reporting nice-to-have.

## Requirements
1. Automatic daily export: at end of day, sales data auto-writes to a local `.xlsx` file on the restaurant's counter PC (via local-bridge, Feature 03).
2. Manual export button in dashboard: pick any date range, download `.xlsx` on demand.
3. Export includes: order id, date/time, items, amounts, order type (dine-in/delivery), payment status.

## Definition of Done
- [ ] Daily auto-export file is created and correctly reflects that day's completed orders
- [ ] Manual date-range export produces a correctly formatted, opens-without-error .xlsx file
- [ ] Export works even if that day had offline-queued orders (synced data included once flushed)
