# Database

The database is PostgreSQL on Supabase. Its full definition is the ordered list of SQL files in [`supabase/migrations`](../supabase/migrations). This page is an overview; the migrations are the source of truth.

## Rules for changes

- Migrations are applied in timestamp order. Never edit a file that has been applied; add a new one with a later timestamp.
- Keep migrations additive where possible (`create ... if not exists`, `create or replace`, `alter ... add`).
- Apply a migration to the live project before merging the code that needs it.
- `20261007125900_housekeeping.sql` (the hourly tidy-up job) is added by hand in the SQL Editor; see [SETUP.md](../supabase/docs/SETUP.md#4-owner-account-and-tidy-up).

## Access model

- Row-level security is **enabled on every table** in the `public` schema.
- 18 tables have one read-only policy: either public catalogue data (for example `products`, `classes`, `sections`, `plans`, `faq_entries`) or the caller's own rows (`profiles`, `orders`, `order_items`, `entitlements`, `account_warnings`, `notifications`).
- The other 28 tables have no policy, so the public keys cannot read or write them at all.
- No policy allows inserts, updates or deletes from the browser. All writes go through the API.
- The API switches each transaction to the role `lww_api`, which has only the grants it needs.
- Sensitive operations live as functions in the `private` schema that the public keys have no permission to run: for example `private.fulfil_order` (the only way a payment becomes access), `private.refund_order` and `private.make_owner` (run once by the owner in the SQL Editor).

## Tables

The local test build creates 46 tables.

### Accounts and staff

| Table | Purpose |
|---|---|
| `profiles` | One row per user: name, account type, verification, lockout and block state |
| `app_sessions` | Sign-in sessions opened by the API; can be ended or blocked one at a time |
| `login_activity` | Every sign-in attempt and its result |
| `login_otp_challenges` | Pending email-code sign-ins: code hash and encrypted session, short-lived |
| `auth_tokens` | One-time links for email confirmation and password reset (hashes only) |
| `agreement_acceptances` | Which version of the account-sharing agreement each customer accepted |
| `staff_members` | Staff accounts and their role |
| `staff_permissions` | Permissions granted to each staff member |
| `staff_role_templates` | The permission sets for Owner, Administrator, Support, Content editor and Developer |

### Catalogue

| Table | Purpose |
|---|---|
| `products` | Worksheets: title, class, subject, section, price, access rules, print and download limits, files, status |
| `classes`, `subjects`, `sections` | How the catalogue is organised |
| `academic_sessions`, `product_sessions` | School years and which sheets belong to them |
| `home_sections`, `home_section_items` | The sheet lists on the home page and in the shop |
| `plans` | Class subscription plans, prices and the regions they are sold in |
| `reviews` | Customer reviews of sheets, moderated by staff |

### Commerce

| Table | Purpose |
|---|---|
| `quotes` | Server-computed prices, valid for a short time; the browser only sends back the quote id |
| `orders`, `order_items` | Orders and the sheets or plans in them |
| `payments`, `payment_events` | Gateway payments and every webhook or verification event |
| `gateway_refunds` | Refunds reported by a gateway |
| `entitlements` | Access records: which customer may open which sheet or class until when |
| `delivery_counters`, `delivery_counts` | Print and download copies used per access record and sheet |
| `coupons`, `coupon_redemptions` | Coupon codes, their rules and their use |
| `cart_items` | Saved carts |
| `expenses` | Costs entered by the owner for the profit and loss view |

### Security

| Table | Purpose |
|---|---|
| `security_rules` | Tunable rules that turn usage patterns into incidents |
| `security_incidents` | Suspected sharing, waiting for staff or confirmed automatically |
| `account_warnings` | Confirmed warnings; three active warnings pause paid access by default |
| `account_appeals` | Customer appeals and staff decisions |
| `access_log` | Sessions, devices, networks and viewer use seen by the API |
| `security_events` | Security-relevant events for the Developer panel |

### Operations and content

| Table | Purpose |
|---|---|
| `settings` | Shop-wide settings staff can change (access hours, prints, tax, sign-in and sharing rules) |
| `site_content` | Editable home page text |
| `faq_entries` | Questions and answers used by the help chat |
| `contact_messages` | Notes sent through the contact form |
| `email_outbox` | Queued emails with retry state |
| `notifications` | In-app notifications for customers and staff |
| `analytics_events` | Visits and conversions for the Analytics section |
| `audit_logs` | Every staff change; append-only |

## Storage

| Bucket | Access | Contents |
|---|---|---|
| `worksheets` | Private | Worksheet PDFs and page images. Read only by the API, never by a direct link |
| `covers` | Public | Cover images uploaded from Admin → Products |

## Local database

The tests and the local dev server build a fresh database with Supabase stand-ins plus every migration:

```bash
cd supabase
LWW_TEST_DB=lww_dev tests/local/reset-db.sh
```

It expects PostgreSQL 16 or newer on `127.0.0.1:5433` (override with `PGHOST` and `PGPORT`). See [supabase/tests/README.md](../supabase/tests/README.md).
