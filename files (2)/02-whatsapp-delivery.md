# Feature 02: WhatsApp Delivery / Takeaway Ordering

## What
Customer orders for delivery/takeaway via a general (non-table) link; order text is sent via a free WhatsApp `wa.me` deep link — no paid WhatsApp Business API.

## Flow
1. URL: `https://[tenant].domain.com/menu?type=delivery` (no `table` param — system treats missing table as delivery mode)
2. Customer browses menu, adds items to cart.
3. Checkout screen: Name, Delivery Address, Phone Number (required fields — see validation below).
4. "Order via WhatsApp" button (WhatsApp green) builds a `wa.me` link:
   `https://wa.me/[restaurant_phone]?text=<url-encoded order summary + name + address + phone>`
5. Tapping opens WhatsApp app/web with pre-filled text; customer taps Send.
6. Simultaneously, order is logged to `orders` table (order_type=DELIVERY, status=PENDING) so it also appears on Cashier Dashboard — independent of whether the customer actually sends the WhatsApp message.

## Requirements — Form Validation (added gap)
- Name: required, min 2 characters
- Phone: required, must match Pakistani mobile format (03XXXXXXXXX), validated client-side before enabling the WhatsApp button
- Address: required, min 10 characters
- Cart must not be empty to reach checkout

## Requirements — Spam Protection (added gap)
- Simple honeypot field (hidden input bots fill, humans don't) on the checkout form
- Rate limit: max 5 order submissions per phone number per hour (server-side check) to prevent abuse/spam order flooding
- No CAPTCHA needed at this scale — honeypot + rate limit is sufficient for v1

## Definition of Done
- [ ] Missing `table` param correctly triggers delivery mode UI
- [ ] Form rejects invalid phone/short name/short address with inline error messages
- [ ] WhatsApp link opens with correctly formatted, fully populated pre-filled text
- [ ] Order also appears on Cashier Dashboard regardless of WhatsApp send
- [ ] Honeypot field present and rate limit enforced
