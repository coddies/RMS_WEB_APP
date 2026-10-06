# SECURITY_FINAL.md — v1 Scope (trimmed from original SECURITY.md)

## 1. Multi-Tenant Data Isolation
All tenant data in shared Supabase Postgres. Row-Level Security (RLS) enforced on every table using `tenant_id`.
```sql
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_policy ON orders
    FOR ALL USING (tenant_id = auth.jwt() ->> 'tenant_id');
```

## 2. Role-Based Access Control
| Role | Menu Edit | Order Create | Billing | Kitchen View | Inventory Edit | Rider View |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| Admin/Manager | Yes | Yes | Yes | Yes | Yes | Yes |
| Cashier | No | Yes | Yes | No | View Only | No |
| Kitchen | No | No | No | Yes | View Only | No |
| Rider | No | No | No | No | No | Self Only |
| Customer | View Only | Create (Guest) | No | No | No | No |
| Super-Admin | (Platform-level, separate from restaurant roles) | | | | | |

## 3. Auth
- Supabase Auth, JWT (HMAC-SHA256), short-lived access tokens (60 min), refresh tokens in HTTP-only secure cookies.
- Local-bridge stores any locally cached sensitive data encrypted (AES-256).

## 4. Network
- TLS 1.3 for all web traffic, HTTPS enforced (automatic via Vercel).
- FBR tokens/NTN per tenant stored encrypted at rest, never exposed to frontend (server-side only — see FR-15/no-frontend-secrets principle).

## 5. Privacy (new — added per SRS FR-15)
- Privacy Policy page live, listing what customer data is collected (name/phone/address) and why (order fulfillment + FBR compliance reporting only).
- No customer data sold or shared beyond FBR reporting requirement.
- Customer data retained only as needed for order history/reporting — no separate marketing use without explicit consent (not in v1 scope).

## 6. Deferred (not v1)
Rider live GPS privacy controls (deferred with live GPS map feature itself — Premium), full penetration-testing program, formal SOC2-style audit — revisit once platform has paying restaurants at scale.
