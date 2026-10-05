# Learn With Why — API reference

Base URL: the site itself (`https://<your site>/api/...`). The React app calls these through `react-app/src/services/api.js`.

## Conventions

- **JSON in, JSON out.** Send `Content-Type: application/json`. Bodies are limited to 64 KB (`413` beyond that).
- **Session = an httpOnly cookie** named `lww_sid` (`HttpOnly; SameSite=Lax; Path=/`, plus `Secure` over HTTPS). The browser sends it automatically; JavaScript cannot read it. The database stores only its SHA-256.
- **Same origin only.** `POST`/`PUT`/`PATCH`/`DELETE` from another site's page are refused with `403` (the `Origin` header is checked). The Razorpay webhook is the one exception. Other domains can be allowed with `CORS_ORIGINS`.
- **Errors** look like this. `code` is stable and meant for programs; `error` is a sentence for people; `errors` maps form fields to messages when the form was wrong.

  ```json
  { "error": "Enter a valid email address.", "code": "rate_limited", "errors": { "email": "Enter a valid email address." } }
  ```

- **Times** are milliseconds since 1970 (UTC).
- **`503 service_unavailable`** means PostgreSQL could not be reached for a moment; the request can simply be retried. `GET /api/health` shows `database: false` meanwhile.
- **Protected routes** (marked 🔒) pass the authentication middleware first. It answers `401 {code:"signin"}` without a valid session, `403 {code:"email_unverified"}` for an unconfirmed address, and `403 {code:"account_suspended"}` for a suspended account. A handler only ever sees a confirmed, active customer.

## Accounts

### `POST /api/auth/signup`

Creates the account and emails the customer a **generated password** with an **Accept & Continue** link. There is no session yet: the email address must be confirmed first.

| Body | |
|---|---|
| `name` | 1–80 characters |
| `email` | a valid address, at most 254 characters (stored lower-case) |

- `201` `{ ok: true, verificationRequired: true, email, message }`
- `400` field errors · `409 email_taken` · `429 rate_limited` (20 sign-ups per IP per hour)
- `502 mail_failed`: the email could not be sent, so the account was **not** created. Try again.
- `503 mail_unavailable`: the server has no email service configured.

The password is 16 random characters in four groups (e.g. `Kp7m-Qx4r-Tn9w-Bz3h`), stored only as an Argon2id hash. The link is `SITE_URL/?verify=<token>` and works once, for `EMAIL_VERIFY_TTL_HOURS` (24 by default).

### `POST /api/auth/verify-email`

What the Accept & Continue link calls. The site opens `/?verify=<token>`, posts the token here, then shows the sign-in form.

| Body | |
|---|---|
| `token` | from the link |

- `200` `{ ok, verified: true, alreadyVerified, email, message }`. The email is marked verified and the account becomes `active`. Using the link again answers `alreadyVerified: true`.
- `400 token_invalid` · `400 token_expired` · `429 rate_limited`

### `POST /api/auth/resend-verification`

For an account that is not confirmed yet: emails a **new** generated password and a new link. The earlier password and link stop working.

| Body | |
|---|---|
| `email` | |

- `200` `{ ok, message }`. The answer is the same whether or not the address has an unconfirmed account, so it cannot be used to discover customers.
- `400` · `429 rate_limited` (3 per address and 20 per IP per hour) · `503 mail_unavailable`

### `POST /api/auth/login`

Also answers on `/api/auth/signin`. Signs in and sets the session cookie.

| Body | |
|---|---|
| `email` | |
| `password` | |
| `remember` | `true`: the cookie lasts `SESSION_DAYS` (30). Otherwise it is a browser-session cookie and the server session lasts `SESSION_HOURS` (12). |

- `200` `{ user }`. See *The user object* below.
- `400` field errors.
- `401 bad_credentials`: the same answer for an unknown email and a wrong password, which also take the same time.
- `403 email_unverified` (with `email`): the password was right but the address is not confirmed; offer resend-verification. `403 account_suspended`.
- `429 account_locked` (with `lockedUntil`): `LOGIN_MAX_FAILED` (5) wrong passwords in a row lock the account for `LOGIN_LOCK_MINUTES` (15). Even the right password waits. A password reset unlocks it. Each attempt is counted before its password is checked, so a burst of parallel guesses still gets only 5 tries.
- `429 rate_limited`: 10 attempts per IP and email, and 100 per IP, per 15 minutes.

Every attempt is written to `login_activity`. A hash from the old SQLite backend (scrypt) is re-hashed with Argon2id on success.

### `POST /api/auth/logout`

Also answers on `/api/auth/signout`. Revokes the session on the server and clears the cookie. Returns `200 { ok: true }`, signed in or not.

### 🔒 `GET /api/auth/me`

Returns `200 { user }`.

### 🔒 `PATCH /api/auth/me`

| Body | |
|---|---|
| `role` | optional: `parent`, `teacher`, `tutor`, `school` or `null` |
| `name` | optional: 1–80 characters |

Returns `200 { user }`, or `400`.

### 🔒 `POST /api/auth/refresh-token`

Rotates the cookie: a new random token replaces the old one, and the expiry moves on, but never past `SESSION_MAX_DAYS` (90) after sign-in. The old token keeps working for 60 seconds, so two tabs refreshing together do not sign each other out. The site calls this when it loads.

Returns `200 { user, expiresAt }`. `expiresAt` is `null` when an old token was presented within its grace period.

### `POST /api/auth/forgot-password`

Emails a **single-use reset link**, `SITE_URL/?reset=<token>`, which works for `PASSWORD_RESET_TTL_MINUTES` (30). A new request kills the previous link.

| Body | |
|---|---|
| `email` | |

- `200` `{ ok, message }`: the same for every address.
- `400` · `429 rate_limited` (3 per address and 20 per IP per hour) · `503 mail_unavailable`

### `POST /api/auth/reset-password`

The site opens `/?reset=<token>`, shows the new-password form and posts here.

| Body | |
|---|---|
| `token` | from the link |
| `password` | 8–128 characters, with a capital letter and a number |

- `200` `{ ok, message }`. The password is replaced (Argon2id), the link is used up, **every session is signed out**, the lock and failure count are cleared, and the email counts as confirmed. A "your password was changed" email is sent.
- `400` field errors · `400 token_invalid` · `400 token_used` · `400 token_expired` · `429 rate_limited`

### The user object

```json
{ "id": 12, "name": "Asha Rao", "email": "asha@example.com", "role": "teacher",
  "emailVerified": true, "status": "active", "created": 1791116749935, "lastLogin": 1791117122525 }
```

`status` is `pending_verification`, `active` or `suspended`. The password hash never leaves the server.

## Shop, viewer and payments

These are unchanged by the PostgreSQL accounts, apart from going through the same middleware.

| Method & path | Auth | What it does |
|---|---|---|
| `GET /api/worksheets` | – | Public catalogue: price, pages, whether a real PDF is attached, thumbnail. |
| `GET /api/config` · `GET /api/geo` | – | Countries, plans, connected gateways; a country guess. |
| `GET /api/health` | – | `200 { ok, database, gateway, mail }`; `503` when PostgreSQL does not answer. |
| `POST /api/contact` `{name,email,message}` | – | The contact form (5 notes per IP per 10 minutes). |
| `POST /api/quote` `{worksheet}` or `{cls,plan}` + `coupon`, `address` | – | Signed price quote, valid 15 minutes. |
| 🔒 `POST /api/pay/order` · `/api/pay/verify` · `/api/pay/cancel` · `/api/pay/stripe/confirm` · `/api/pay/paypal/capture` | cookie | Checkout (see `site/README.md` → Razorpay). |
| `POST /api/pay/webhook` | Razorpay signature | Payment events from Razorpay. |
| 🔒 `GET /api/me/entitlements` · `GET /api/me/orders` | cookie | My worksheets; my orders. Each entitlement has `start`, `end` (a class plan's last moment; `null` for no end) and `active`. |
| 🔒 `POST /api/access/:worksheetId` | cookie | The server access check: `200 {token,…}` · `402 payment_required` · `404`. |
| 🔒 `GET /api/view/meta` · `file` · `page?n=0` | cookie + `X-View-Token` | The protected viewer. `meta` has `scope` and `until` (when the class plan ends); a plan that has ended answers `403 expired`. |

## Staff (`x-admin-key` header = `ADMIN_KEY`)

| Method & path | What it does |
|---|---|
| `GET /api/admin/users` | Customers from PostgreSQL, with `email_verified`, `account_status`, `locked_until` and their order/sheet counts from the shop. |
| `PUT /api/admin/users/status` `{id, status}` | `active` or `suspended`. Suspending revokes every session at once. |
| `GET /api/admin/security-events?limit=300` | Sign-ups, confirmations, lockouts, resets, sign-outs, suspensions. |
| `GET /api/admin/login-activity?limit=300` | Every sign-in attempt, with the reason it failed. |
| `GET /api/admin/stats` · `orders` · `entitlements` · `worksheets` · `settings` · `access-log` · `payments` · `messages` | Read the shop (see `site/README.md`). |
| `PUT /api/admin/orders` · `plans` · `rates` · `coupons` · `worksheets/:id` · `POST …/entitlements/grant` · `…/revoke` · `…/worksheets/:id/file` | Change the shop. |

## Try it from the shell

```bash
B=http://127.0.0.1:4173; H='-H Content-Type:application/json -H Origin:http://127.0.0.1:4173'
curl $H -X POST $B/api/auth/signup -d '{"name":"Ria","email":"ria@example.com"}'
# development without SMTP: the email (password + link) is printed in the server log
curl $H -X POST $B/api/auth/verify-email -d '{"token":"<token from the link>"}'
curl $H -c jar -X POST $B/api/auth/login -d '{"email":"ria@example.com","password":"<from the email>","remember":true}'
curl -b jar $B/api/auth/me
```
