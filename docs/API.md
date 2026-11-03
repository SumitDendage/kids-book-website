# API reference

The website talks to one Supabase Edge Function, `api`, at `https://<project-ref>.supabase.co/functions/v1/api/...`. Its source is in [`supabase/functions/api`](../supabase/functions/api): `routes/` holds one file per group below, `services/` the business rules, `gateways/` Razorpay, Stripe and PayPal, and `lib/` the shared request, auth and database code.

## Conventions

- Every request sends the project's publishable key in the `apikey` header. Signed-in requests also send `Authorization: Bearer <access token>`.
- Requests and responses are JSON, except file and page downloads in the viewer and CSV exports.
- Errors return an HTTP status with `{ "error": "<message>", "code": "<code>" }`, plus field errors where relevant.
- Only origins listed in the `ALLOWED_ORIGINS` secret may call the API from a browser.
- Staff routes check the caller's permissions on the server on every call; the panels only hide what a staff member cannot use.
- `GET /api/health` reports whether the API is running and which integrations are configured, never their values.


There are 170 routes. This list was generated from the route registrations in `supabase/functions/api/routes/`.

## Public

No sign-in needed. Rate-limited per IP.

| Method | Path |
|---|---|
| `GET` | `/api/health` |
| `GET` | `/api/config` |
| `GET` | `/api/geo` |
| `POST` | `/api/contact` |
| `POST` | `/api/ai/chat` |
| `POST` | `/api/events` |
| `GET` | `/api/content` |
| `GET` | `/api/faq` |
| `GET` | `/api/worksheets/:id/reviews` |

## Authentication

Sign-up, two-step sign-in, sessions and password reset.

| Method | Path |
|---|---|
| `POST` | `/api/auth/signup` |
| `POST` | `/api/auth/verify-email` |
| `POST` | `/api/auth/resend-verification` |
| `POST` | `/api/auth/login` |
| `POST` | `/api/auth/signin` |
| `POST` | `/api/auth/verify-login-otp` |
| `POST` | `/api/auth/logout` |
| `POST` | `/api/auth/signout` |
| `GET` | `/api/auth/me` |
| `PATCH` | `/api/auth/me` |
| `POST` | `/api/auth/refresh-token` |
| `POST` | `/api/auth/forgot-password` |
| `POST` | `/api/auth/reset-password` |

## Catalogue and orders

`GET /api/worksheets` and `POST /api/quote` are public; `/api/me/*` needs a signed-in customer.

| Method | Path |
|---|---|
| `GET` | `/api/worksheets` |
| `POST` | `/api/quote` |
| `GET` | `/api/me/orders` |
| `GET` | `/api/me/entitlements` |

## Cart

Signed-in customer.

| Method | Path |
|---|---|
| `GET` | `/api/cart` |
| `POST` | `/api/cart` |
| `DELETE` | `/api/cart` |
| `POST` | `/api/cart/merge` |
| `DELETE` | `/api/cart/:id` |

## Payments

Order creation and verification need a signed-in customer; webhooks are verified by the gateway signature.

| Method | Path |
|---|---|
| `POST` | `/api/pay/order` |
| `POST` | `/api/pay/verify` |
| `POST` | `/api/pay/webhook` |
| `POST` | `/api/pay/razorpay/webhook` |
| `POST` | `/api/pay/cancel` |
| `POST` | `/api/pay/stripe/confirm` |
| `POST` | `/api/pay/stripe/webhook` |
| `POST` | `/api/pay/paypal/capture` |
| `POST` | `/api/pay/paypal/webhook` |

## Viewer

`POST /api/access/:id` issues a short-lived view token (a guest token for free sheets); the `/api/view/*` routes need that token and re-check access on every call.

| Method | Path |
|---|---|
| `POST` | `/api/access/:id` |
| `GET` | `/api/view/meta` |
| `GET` | `/api/view/file` |
| `GET` | `/api/view/page` |
| `POST` | `/api/view/print` |
| `POST` | `/api/view/download` |

## My account

Signed-in customer.

| Method | Path |
|---|---|
| `GET` | `/api/me/security` |
| `POST` | `/api/me/security/acknowledge` |
| `GET` | `/api/me/appeals` |
| `POST` | `/api/me/appeals` |
| `GET` | `/api/me/notifications` |
| `POST` | `/api/me/notifications/read` |
| `GET` | `/api/me/sessions` |
| `POST` | `/api/me/sessions/:id/end` |
| `POST` | `/api/me/reviews` |

## Admin: catalogue

Staff with catalogue permissions.

| Method | Path |
|---|---|
| `GET` | `/api/admin/worksheets` |
| `POST` | `/api/admin/worksheets` |
| `POST` | `/api/admin/worksheets/:id/restore` |
| `POST` | `/api/admin/worksheets/:id/file` |
| `POST` | `/api/admin/worksheets/:id/pages/:n` |
| `POST` | `/api/admin/worksheets/:id/cover` |
| `POST` | `/api/admin/worksheets/:id/gallery` |
| `POST` | `/api/admin/worksheets/:id/duplicate` |
| `GET` | `/api/admin/worksheets/:id` |
| `PUT` | `/api/admin/worksheets/:id` |
| `DELETE` | `/api/admin/worksheets/:id` |
| `GET` | `/api/admin/files` |
| `GET` | `/api/admin/classes` |
| `PUT` | `/api/admin/classes` |
| `GET` | `/api/admin/sections` |
| `POST` | `/api/admin/sections` |
| `PUT` | `/api/admin/sections/:id` |
| `DELETE` | `/api/admin/sections/:id` |

## Admin: subjects, sessions and home page lists

Staff with catalogue permissions.

| Method | Path |
|---|---|
| `GET` | `/api/admin/subjects` |
| `POST` | `/api/admin/subjects` |
| `PUT` | `/api/admin/subjects/:id` |
| `DELETE` | `/api/admin/subjects/:id` |
| `GET` | `/api/admin/sessions` |
| `POST` | `/api/admin/sessions` |
| `PUT` | `/api/admin/sessions/:id` |
| `DELETE` | `/api/admin/sessions/:id` |
| `GET` | `/api/admin/home-sections` |
| `POST` | `/api/admin/home-sections` |
| `PUT` | `/api/admin/home-sections/:id/items` |
| `PUT` | `/api/admin/home-sections/:id` |
| `DELETE` | `/api/admin/home-sections/:id` |

## Admin: orders, access, settings and coupons

Staff with order, pricing or settings permissions.

| Method | Path |
|---|---|
| `GET` | `/api/admin/orders` |
| `PUT` | `/api/admin/orders` |
| `GET` | `/api/admin/orders/:id` |
| `POST` | `/api/admin/orders/:id/refund` |
| `GET` | `/api/admin/payments` |
| `GET` | `/api/admin/payment-events` |
| `GET` | `/api/admin/entitlements` |
| `POST` | `/api/admin/entitlements/grant` |
| `POST` | `/api/admin/entitlements/revoke` |
| `POST` | `/api/admin/entitlements/:id/extend` |
| `GET` | `/api/admin/settings` |
| `PUT` | `/api/admin/settings/:key` |
| `PUT` | `/api/admin/plans` |
| `PUT` | `/api/admin/rates` |
| `PUT` | `/api/admin/coupons` |
| `GET` | `/api/admin/coupons` |
| `POST` | `/api/admin/coupons` |
| `PUT` | `/api/admin/coupons/:code` |
| `DELETE` | `/api/admin/coupons/:code` |

## Admin: money

Staff with analytics and order permissions.

| Method | Path |
|---|---|
| `GET` | `/api/admin/finance` |
| `POST` | `/api/admin/expenses` |
| `PATCH` | `/api/admin/expenses/:id` |
| `DELETE` | `/api/admin/expenses/:id` |

## Admin: customers, staff and messages

Staff with customer, staff or message permissions.

| Method | Path |
|---|---|
| `GET` | `/api/admin/me` |
| `GET` | `/api/admin/users` |
| `PUT` | `/api/admin/users/status` |
| `GET` | `/api/admin/users/:id` |
| `PUT` | `/api/admin/users/:id` |
| `PATCH` | `/api/admin/users/:id` |
| `POST` | `/api/admin/users/:id/block` |
| `POST` | `/api/admin/users/:id/unblock` |
| `POST` | `/api/admin/users/:id/sessions/end-all` |
| `POST` | `/api/admin/users/:id/password-reset` |
| `GET` | `/api/admin/staff/roles` |
| `GET` | `/api/admin/staff` |
| `POST` | `/api/admin/staff` |
| `PUT` | `/api/admin/staff/:userId` |
| `DELETE` | `/api/admin/staff/:userId` |
| `GET` | `/api/admin/messages` |
| `POST` | `/api/admin/messages/read` |
| `POST` | `/api/admin/messages/replied` |
| `POST` | `/api/admin/messages/:id/status` |
| `POST` | `/api/admin/messages/:id/reply` |

## Admin: account sharing and security

Staff with security permissions.

| Method | Path |
|---|---|
| `GET` | `/api/admin/security/customers` |
| `GET` | `/api/admin/security/customers/:id/sessions` |
| `POST` | `/api/admin/security/sessions/:id/block` |
| `POST` | `/api/admin/security/sessions/:id/unblock` |
| `POST` | `/api/admin/security/customers/:id/block` |
| `POST` | `/api/admin/security/customers/:id/unblock` |
| `POST` | `/api/admin/security/customers/:id/report` |
| `GET` | `/api/admin/security/incidents` |
| `POST` | `/api/admin/security/incidents/:id/confirm` |
| `POST` | `/api/admin/security/incidents/:id/dismiss` |
| `GET` | `/api/admin/security/warnings` |
| `POST` | `/api/admin/security/warnings/:id/revoke` |
| `GET` | `/api/admin/security/appeals` |
| `POST` | `/api/admin/security/appeals/:id/decide` |
| `GET` | `/api/admin/security/rules` |
| `PUT` | `/api/admin/security/rules` |
| `GET` | `/api/admin/security/rules/:id` |
| `PUT` | `/api/admin/security/rules/:id` |
| `GET` | `/api/admin/security-events` |
| `GET` | `/api/admin/login-activity` |
| `GET` | `/api/admin/access-log` |

## Admin and developer: operations

Staff with dashboard, email, audit, content or developer permissions.

| Method | Path |
|---|---|
| `GET` | `/api/admin/stats` |
| `GET` | `/api/admin/analytics` |
| `GET` | `/api/admin/emails` |
| `POST` | `/api/admin/emails/process` |
| `POST` | `/api/admin/emails/:id/retry` |
| `POST` | `/api/admin/emails/:id/skip` |
| `GET` | `/api/admin/audit` |
| `GET` | `/api/admin/notifications` |
| `POST` | `/api/admin/notifications/read` |
| `GET` | `/api/admin/export/:kind` |
| `GET` | `/api/admin/backup` |
| `GET` | `/api/admin/developer/health` |
| `GET` | `/api/admin/content` |
| `PUT` | `/api/admin/content` |
| `GET` | `/api/admin/faq` |
| `POST` | `/api/admin/faq` |
| `PUT` | `/api/admin/faq/:id` |
| `DELETE` | `/api/admin/faq/:id` |
| `GET` | `/api/admin/reviews` |
| `POST` | `/api/admin/reviews/:id/status` |
