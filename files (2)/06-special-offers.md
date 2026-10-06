# Feature 06: Special Offers

## What
Manager can mark any menu item as a time-boxed special offer (e.g. seasonal item, limited-time deal), scheduled by day-of-week and date range, shown highlighted on the customer menu.

## Flow (Admin side)
1. From Menu Management (Feature 08), each item has a 3-dot menu -> "Mark as Special Offer" (or a dedicated "+ New Offer" button/tab).
2. Admin selects item(s) via searchable checklist.
3. Admin picks a visual style from 4-5 predefined offer-card templates (e.g. Flame Badge, Gradient Glow Border, Ribbon Tag, Countdown Banner, Seasonal Frame).
4. Admin sets day-of-week toggles (Mon-Sun) — offer only shows on selected days.
5. Admin sets start/end date-time, or toggles "run indefinitely until manually stopped".
6. Optional custom badge text (e.g. "🔥 Winter Special").
7. Live preview shown before saving.

## Flow (Customer side)
- Active offers (matching current date + day-of-week) are shown with the selected highlighted card style, positioned at the top of their category or in a dedicated offers row.
- Offers auto-expire at end datetime with no manual cleanup needed — a scheduled check (or query-time filter) hides expired offers automatically.

## Definition of Done
- [ ] Offer only displays on the configured day(s) of week
- [ ] Offer automatically disappears after end datetime without manual action
- [ ] Selected card style renders correctly and distinctly from normal menu items
- [ ] "Run indefinitely" option works and doesn't require an end date
