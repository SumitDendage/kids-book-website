# `site/` — the Learn With Why website and backend

One Node process: the static site, the JSON API, the private PDF store and two databases:

- **PostgreSQL** holds the **customer accounts**: users, email confirmation and password-reset tokens, sessions, login activity and security events.
- **SQLite** (`data/lww.sqlite`) holds **the shop**: catalogue, orders, payments, entitlements, access log, contact notes and settings. Its rows point at a customer by the PostgreSQL `users.id`.

```bash
cd site
npm install                      # pg, argon2, nodemailer
cp .env.example .env             # set DATABASE_URL (+ SMTP_*, SITE_URL, ADMIN_KEY)
npm run migrate                  # optional: the server also migrates at every start
npm start                        # http://127.0.0.1:4173
TEST_DATABASE_URL=postgres://lww:lww@127.0.0.1:5432/postgres npm test
```

The full endpoint reference is in **[API.md](API.md)**. Setup from scratch and going online are covered under [Set up PostgreSQL](#set-up-postgresql), [Email](#email) and [Deploy](#deploy) below.

## The flow the backend implements

```
Public catalogue  GET /api/worksheets
      ↓
Customer picks a PDF
      ↓
Account           POST /api/auth/signup            name + email → generated password + Accept & Continue link, by email
                  POST /api/auth/verify-email      the link → email confirmed, account active
                  POST /api/auth/login             Argon2id check → httpOnly session cookie (PostgreSQL user_sessions)
      ↓
FREE ───────────────────────── PAID
 │                               │  POST /api/quote            signed price (base + tax + fee)
 │                               │  POST /api/pay/order        order row + Razorpay order (amount in paise)
 │                               │  Razorpay Checkout          UPI / card / net banking in the browser
 │                               │  POST /api/pay/verify       HMAC-SHA256(order|payment) checked with the key secret
 │                               │  POST /api/pay/webhook      payment.captured / order.paid, signed with the webhook secret
 │                               ↓
 │                        ENTITLEMENT row (paid) — permanent
 └──────────────┬────────────────┘
                ↓
Server access check   POST /api/access/:id   → free sheet: a free entitlement is minted on the spot
                ↓                            → paid sheet: needs an entitlement (this PDF, or its class) else 402
Private PDF storage   site/protected/        never served as a static file
                ↓
The PDF viewer        dist/viewer.html       GET /api/view/meta · file · page — cookie + view token + entitlement, every request
                ↓
Watermark             name · email · time baked into every page
                ↓
Yours to keep         nothing expires; an admin revoke (POST /api/admin/entitlements/revoke) is the only way access ends
```

## Files

| File | Purpose |
|---|---|
| `server.cjs` | Entry point: loads `.env`, migrates PostgreSQL, opens the shop store, runs the middleware and routes, serves the React build. `createApp()` is what the tests start. |
| `server/config.cjs` | Every environment setting in one place (database, email, account limits). |
| `server/pg.cjs` | PostgreSQL connection pool; parameterised queries; `tx()` transactions. |
| `server/migrate.cjs` · `db/migrations/*.sql` | Numbered schema migrations, applied once each (checksummed, advisory-locked). |
| `server/auth.cjs` | Accounts: sign-up with a generated password, email confirmation, login with lockout, sessions and refresh, logout, forgot/reset password, `me`, the staff helpers. |
| `server/passwords.cjs` | Argon2id hashing, the password generator, the password rule; old scrypt hashes still verify. |
| `server/mail.cjs` · `server/emails.cjs` | Nodemailer (SMTP) and the account emails (text + HTML). |
| `server/middleware.cjs` | Security headers, CORS, the cross-site check, and `requireAuth` for the protected routes. |
| `server/legacy.cjs` | Carries accounts from the SQLite-only backend over to PostgreSQL once, with the same ids. |
| `server/db.cjs` | The shop store: SQLite via `node:sqlite`, schema, settings (JSON values), seeding, PDF attachment. |
| `server/seed.cjs` | The worksheet catalogue the database starts with (ids match the cards in `dist/index.html`). |
| `server/pricing.cjs` | Countries, tax, fees, currency; signed quotes for a class plan or a single PDF. |
| `server/payments.cjs` | Razorpay orders, signature verification, webhook; Stripe and PayPal hosted pages; the one place an order becomes paid. |
| `server/access.cjs` | Entitlements, the access check, view tokens, PDF/page streaming, access log, public catalogue. |
| `server/admin.cjs` | Staff API (`x-admin-key`): orders, customers, entitlements, worksheets + PDF upload, settings, logs. |
| `server/http.cjs` | JSON/raw bodies, cookies, same-origin check, rate limiter. |
| `scripts/migrate.cjs` | `npm run migrate`. |
| `test/auth.test.cjs` · `test/db.test.cjs` · `test/smoke.cjs` | Account API tests, database tests, and the end-to-end walk through the whole shop. See [Tests](#tests). |
| `API.md` | The API reference. |
| `data/lww.sqlite` | The shop store (git-ignored, created on first run; settings are copied from the old `data/db.json` if present). |
| `protected/` | Private PDF storage. `a-to-z/` ships with the 26 free sheets; admin uploads land in `uploads/`. |
| `dist/index.html` | The customer site: styles, the six chapters, and the page script (auth, catalogue, checkout, viewer hand-off). |
| `dist/viewer.html` | The protected viewer: pdf.js rendering, watermark, copy/print protection. |
| `dist/admin.js` | Admin + Developer dashboards. With the admin key saved they read orders, customers and entitlements from the database. |
| `dist/frames-webp/`, `dist/preview-frames/`, `dist/fonts/`, `dist/sheets/` | Landscape frames, fox & rabbit frames, fonts, public thumbnails. |

## Database

### PostgreSQL — accounts (`db/migrations/001_auth_schema.sql`)

| Table | Holds |
|---|---|
| `users` | id, name, email (unique, lower-case), `password_hash` (Argon2id), `email_verified`, `email_verified_at`, `account_status` (`pending_verification` → `active`, or `suspended`), role, `failed_login_attempts`, `locked_until`, `password_changed_at`, `created_at`, `updated_at` (trigger), `last_login_at` |
| `email_verification_tokens` | SHA-256 of the Accept & Continue token, user, `expires_at` (24 h), `used_at` |
| `password_reset_tokens` | SHA-256 of the reset token, user, `expires_at` (30 min), `used_at` (single use) |
| `user_sessions` | SHA-256 of the cookie token (and of the previous one, for 60 s after a refresh), user, remember, IP, user agent, `expires_at`, `revoked_at` + reason |
| `login_activity` | every sign-in attempt: email, user, success, `failure_reason` (`bad_credentials`, `email_unverified`, `account_locked`, `account_suspended`, `rate_limited`), IP, user agent |
| `security_events` | `signup`, `email_verified`, `verification_resent`, `account_locked`, `password_reset_requested`, `password_reset`, `password_rehashed`, `logout`, `account_suspended` / `account_active`, `account_imported` — with detail (JSON), IP, user agent |
| `schema_migrations` | which migration files ran, and their checksums |

The database's own rules back the code up: unique lower-case email, an `active` account must be confirmed, tokens are 64-hex SHA-256 values, and deleting a user removes their tokens and sessions but keeps the security trail. Expired tokens and sessions are swept 30 days after they end.

Look inside with `psql "$DATABASE_URL"`:

```sql
SELECT id, email, email_verified, account_status, last_login_at FROM users ORDER BY id;
SELECT created_at, email, success, failure_reason, ip FROM login_activity ORDER BY id DESC LIMIT 20;
```

### SQLite — the shop (`data/lww.sqlite`, WAL mode)

| Table | Holds |
|---|---|
| `users` | the shop's copy of each signed-in customer (same id, email, name, role) so orders and entitlements can point at them; `pw_hash` is `!postgresql` — passwords live only in PostgreSQL |
| `worksheets` | id, title, class, subject, pages, price (INR, 0 = free), `file` (path inside `protected/`), thumb, active |
| `orders` | id `LWO-xxxxxx`, user, kind (`class` / `worksheet`), currency, total, INR total, amount in minor units, lines, coupon, address, method, status (`created` → `paid` / `failed` / `refunded`), Razorpay order + payment ids |
| `payments` | every gateway event (order created, verify, webhook) with outcome |
| `entitlements` | user, scope (`worksheet` or `class`), reference, kind (`free` / `paid`), order, `starts_at`, `revoked_at` — no expiry |
| `access_log` | every access decision and PDF/page stream, with IP |
| `settings` | JSON values: `plans`, `classes`, `coupons`, `discounts`, `rates`, `fees`, `secret` |

Inspect it with any SQLite client, or from Node:

```bash
node -e "const {DatabaseSync}=require('node:sqlite');const d=new DatabaseSync('site/data/lww.sqlite');console.table(d.prepare('SELECT id,user_id,scope,worksheet_id,cls,kind,datetime(starts_at/1000,\"unixepoch\") AS since,revoked_at FROM entitlements').all())"
```

## API

All responses are JSON. State-changing calls must come from the site's own origin (the `Origin` header is checked); the webhook is the exception. **[API.md](API.md)** documents every account endpoint with its answers and error codes.

| Method & path | Auth | What it does |
|---|---|---|
| `GET /api/worksheets` | – | Public catalogue: price, pages, whether a real PDF is attached, thumbnail. |
| `GET /api/config` · `GET /api/geo` · `GET /api/health` | – | Countries, plans, gateway mode; country guess; liveness (and PostgreSQL). |
| `POST /api/auth/signup` `{name,email}` | – | Creates the account; emails a generated password + Accept & Continue link. No session until confirmed. |
| `POST /api/auth/verify-email` `{token}` · `POST /api/auth/resend-verification` `{email}` | – | Confirm the email (the link); send a new password + link to an unconfirmed account. |
| `POST /api/auth/login` `{email,password,remember}` · `POST /api/auth/logout` | – | Sign in (httpOnly cookie; 5 wrong passwords lock 15 min); sign out (session revoked). |
| `GET /api/auth/me` · `PATCH /api/auth/me` `{role,name}` · `POST /api/auth/refresh-token` | cookie | Who am I, profile, rotate the session token. |
| `POST /api/auth/forgot-password` `{email}` → `POST /api/auth/reset-password` `{token,password}` | – | Single-use reset link by email (30 min), then the new password; every session is signed out. |
| `POST /api/quote` `{cls,plan}` or `{worksheet}` + `coupon`, `address` | – | Signed quote, valid 15 minutes. |
| `POST /api/pay/order` `{quote,method}` | cookie | Order + Razorpay order → `{gateway:{key,razorpay_order_id,amount,…}}`; 503 `gateway_off` without keys. |
| `POST /api/pay/verify` `{order_id,razorpay_order_id,razorpay_payment_id,razorpay_signature}` | cookie | Verifies the signature, marks the order paid, grants the entitlement. |
| `POST /api/pay/webhook` | Razorpay signature | Same grant from `payment.captured` / `order.paid`; `payment.failed` marks the order failed. Idempotent. |
| `GET /api/me/entitlements` · `GET /api/me/orders` | cookie | My plans / My worksheets; my orders. |
| `POST /api/access/:worksheetId` | cookie | **The server access check.** 200 `{token,…}` · 402 `payment_required` · 404. |
| `GET /api/view/meta` · `GET /api/view/file` · `GET /api/view/page?n=0` | cookie + `X-View-Token` | Viewer metadata (watermark identity), the PDF bytes, a pre-rendered page image. 403 once the entitlement is revoked. |
| `GET /api/admin/stats` · `orders` · `users` · `entitlements` · `worksheets` · `settings` · `access-log` · `payments` | `x-admin-key` | Read everything. |
| `PUT /api/admin/orders` `{id,status}` · `PUT /api/admin/plans` · `PUT /api/admin/rates` · `PUT /api/admin/coupons` | `x-admin-key` | Change status and store settings. |
| `POST /api/admin/entitlements/grant` `{email,scope,ref}` · `POST /api/admin/entitlements/revoke` `{id}` | `x-admin-key` | Manual access; revoke ends an open viewer within a minute. |
| `PUT /api/admin/worksheets/:id` `{title,cls,subject,pages,price,active}` · `DELETE …/:id` | `x-admin-key` | Create / edit / retire a worksheet. |
| `POST /api/admin/worksheets/:id/file` (body = the PDF) | `x-admin-key` | Upload the PDF into `protected/uploads/`. |

Upload a PDF from the shell:

```bash
curl -X PUT http://127.0.0.1:4173/api/admin/worksheets/kg-mat-cnt -H "x-admin-key: change-me" -H "Content-Type: application/json" -d "{\"price\":59}"
curl -X POST http://127.0.0.1:4173/api/admin/worksheets/kg-mat-cnt/file -H "x-admin-key: change-me" -H "Content-Type: application/pdf" --data-binary @count-to-20.pdf
```

A PDF dropped into `protected/` as `<worksheet id>.pdf` is attached automatically at the next start.

## Razorpay

1. Dashboard → Settings → API keys: put `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` in `site/.env`. Test keys (`rzp_test_…`) run the real checkout without moving money.
2. Dashboard → Settings → Webhooks: URL `https://<your host>/api/pay/webhook`, events `payment.captured`, `order.paid`, `payment.failed`; put the secret in `RAZORPAY_WEBHOOK_SECRET`.
3. Amounts go to Razorpay in the smallest unit of the quote's currency (paise for INR). Non-INR currencies need international payments enabled on the Razorpay account.

Without keys Razorpay is **not connected**: `/api/config` reports `razorpay: false`, the checkout shows card, QR code, UPI and wallet as coming soon, and `POST /api/pay/order` and `/api/pay/verify` answer 503. There is no demo gateway — to try a payment locally, use test keys.

## Protection model

Accounts:

- Passwords are generated with the OS random generator (about 93 bits), emailed once, and stored only as **Argon2id** hashes. Customers can choose their own with Forgot password.
- Sign-in needs a **confirmed email** (the Accept & Continue link) and an `active` account. Five wrong passwords in a row **lock the account** for 15 minutes. Per-IP and per-email **rate limits** sit on sign-up, sign-in, the email-sending endpoints and the token endpoints. An unknown email gets the same answer, in the same time, as a wrong password.
- Sessions are random 256-bit tokens in an **httpOnly, SameSite=Lax** cookie (`Secure` over HTTPS). The database keeps only their SHA-256, so they can be revoked: logout, password reset and suspension end them at once.
- Every token in an email (confirmation, reset) is single-use, expires, and is stored as a SHA-256. Email links use `SITE_URL`, never the request's `Host` header, so a forged header cannot redirect a reset link.
- Every query is parameterised (no SQL injection). Inputs are checked on the server (email format and length, name, password rule, token format). Bodies over 64 KB are refused.
- **Security headers** on every response: `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, `Cross-Origin-Opener-Policy`, HSTS over HTTPS, and a deny-all CSP on JSON. **CORS** is off unless `CORS_ORIGINS` names a site, and cross-site writes are refused.
- The IP-based limits read the first `X-Forwarded-For` address, so run the server behind a proxy that sets it (nginx, Cloudflare, Hostinger). The account lockout does not depend on the IP.

Sheets and payments:

- PDFs are never reachable as static files; `/api/view/file` re-checks the session cookie **and** the entitlement row on every request, so a copied link is useless and a revoked sheet closes even in an open viewer (it re-asks the server every minute and on focus).
- View tokens are HMAC-signed, bound to the user, the worksheet and the entitlement (useless without the session cookie), and travel in a header (not the URL); the viewer page sends no referrer.
- Every page carries the customer's name, email and the time twice: a CSS overlay and a stamp baked into the canvas pixels.
- The viewer blocks the context menu, drag, copy, print and save shortcuts, blurs when the window is not in front, and hides everything in print media.
- Prices are computed and signed on the server; an edited quote is refused. Only Razorpay's signature (or its signed webhook) turns an order into an entitlement.

## Configuration (`site/.env`)

Every variable is explained in [`.env.example`](.env.example).

| Variable | Meaning |
|---|---|
| `DATABASE_URL` | **Required.** PostgreSQL connection string for the accounts. |
| `DATABASE_SSL`, `PG_POOL_MAX` | `disable` / `require` / `no-verify` (default `require` with `NODE_ENV=production`); pool size. |
| `SITE_URL` | The public address. Email links point here; `https://…` turns on the `Secure` cookie flag. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` | The mail server for account emails and contact notes. `RESEND_API_KEY` alone also works. |
| `MAIL_TRANSPORT` | `smtp` · `console` (development: emails printed in the log) · `none`. Default: `smtp` when `SMTP_HOST` is set, else `console` (development) or `none` (production). |
| `EMAIL_VERIFY_TTL_HOURS`, `PASSWORD_RESET_TTL_MINUTES` | Link lifetimes (24 h, 30 min). |
| `SESSION_DAYS`, `SESSION_HOURS`, `SESSION_MAX_DAYS` | Session length with / without "Keep me signed in"; the most a refresh can extend to (30 d, 12 h, 90 d). |
| `LOGIN_MAX_FAILED`, `LOGIN_LOCK_MINUTES` | Lockout after wrong passwords (5, 15 min). |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` | Gateway keys; empty = Razorpay off (nothing can be bought). |
| `RAZORPAY_WEBHOOK_SECRET` | Webhook signature secret; empty = webhooks are acknowledged but ignored. |
| `ADMIN_KEY` | Staff API key (default `change-me` — change it). |
| `PORT`, `HOST`, `DB_PATH`, `PROTECTED_DIR` | Where to listen, where the shop store lives, where the private PDFs live. |
| `NODE_ENV` | `production` requires real email and TLS to the database by default. |

## Set up PostgreSQL

Any PostgreSQL 13 or newer works. Pick one:

- **On your computer / a VPS** (Ubuntu): `sudo apt install postgresql`, then
  ```bash
  sudo -u postgres psql -c "CREATE ROLE lww LOGIN PASSWORD 'a-long-random-password'"
  sudo -u postgres createdb -O lww lww
  # DATABASE_URL=postgres://lww:a-long-random-password@127.0.0.1:5432/lww
  ```
- **Docker**: `docker run -d --name lww-pg -e POSTGRES_USER=lww -e POSTGRES_PASSWORD=a-long-random-password -e POSTGRES_DB=lww -p 5432:5432 -v lww-pg:/var/lib/postgresql/data postgres:16`
- **Managed** (Neon, Supabase, Render, Railway, DigitalOcean, AWS RDS, …): create a database and copy its connection string into `DATABASE_URL`. Keep `DATABASE_SSL=require` (the production default).

Then `npm run migrate` (or just `npm start`) creates the tables. Migrations live in `db/migrations/NNN_name.sql`. To change the schema, add a new numbered file; never edit one that already ran (the server refuses to start if a file's checksum changed).

**Customers from before PostgreSQL.** At the first start, every account in the SQLite `users` table is copied into PostgreSQL **with the same id**, so their orders and sheets stay theirs. Their old password keeps working (it is re-hashed with Argon2id at the next sign-in), they count as confirmed, and everyone signs in once more. The id sequence is moved past every old id. Back up `data/lww.sqlite` before the first start, as always before an upgrade.

## Email

Sign-up and Forgot password send email, so production needs an SMTP service: fill in `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` and `MAIL_FROM` (examples for Gmail, Hostinger, Brevo and Resend are in `.env.example`). At start the server logs `mail SMTP ready` or the reason it is not. For good delivery, send from your own domain and add the SPF and DKIM records your provider gives you.

In development without SMTP, every email (with the password and links) is **printed in the server log**. Set `SITE_URL=http://localhost:5173` when using `npm run dev`, so the links open the Vite dev server. To catch real SMTP mail locally, run [Mailpit](https://mailpit.axllent.org) and set `SMTP_HOST=127.0.0.1 SMTP_PORT=1025`.

## Tests

```bash
TEST_DATABASE_URL=postgres://lww:lww@127.0.0.1:5432/postgres npm test
```

`TEST_DATABASE_URL` points at a PostgreSQL server where that user may `CREATE DATABASE`. Each test file makes its own `lww_test_…` database and drops it afterwards; `DATABASE_URL` is never touched.

- `test/auth.test.cjs` (21 tests): sign-up and the email, duplicate emails, confirmation (valid / expired / reused / double-clicked), sign-in, cookie flags, hashes only, the protected routes, refresh-token rotation, logout, lockout (also against a burst of parallel guesses), forgot / reset (single use, expiry, sessions revoked), resend, mail failure rollback, SQL injection, rate limits, suspension, headers.
- `test/db.test.cjs` (9 tests): migrations (once, concurrent, edited file refused, failed file rolled back), tables and columns, constraints, cascades, transactions, the carry-over of old SQLite accounts.
- `test/smoke.cjs` (59 checks): the whole shop end to end — catalogue, sign-up → confirm → sign-in, free and paid sheets, Razorpay (stubbed), webhook, viewer, admin, contact, reset — and an old SQLite customer signing in and keeping their sheet.

## Deploy

1. **PostgreSQL**: create the database (above) and note its `DATABASE_URL`.
2. **Server**: Node 22.13 or newer, on hosting that runs Node (a VPS, Render, Railway, Hostinger VPS / Node.js hosting …). Copy the repository, then:
   ```bash
   cd react-app && npm ci && npm run build          # the website → react-app/dist
   cd ../site && npm ci --omit=dev
   cp .env.example .env                              # DATABASE_URL, SITE_URL=https://your-domain, SMTP_*, MAIL_FROM, ADMIN_KEY, NODE_ENV=production, HOST=0.0.0.0
   npm run migrate
   npm start
   ```
   Keep it running with a process manager (`pm2 start server.cjs --name lww`, or a systemd service), and keep `site/data/` and `site/protected/` on persistent storage.
3. **HTTPS**: put the server behind a proxy that terminates TLS and passes `X-Forwarded-Proto` and `X-Forwarded-For` (nginx, Caddy, Cloudflare, or the host's own). The site and `/api` must be on the **same domain**.
4. **Check**: `curl https://your-domain/api/health` → `{"ok":true,"database":true,…}`; sign up with your own address and confirm the email arrives.
5. **Backups**: back up PostgreSQL (`pg_dump "$DATABASE_URL" > lww-$(date +%F).sql`, or the provider's backups) and `site/data/lww.sqlite`.

The old plain-HTML backup site in `dist/` predates email confirmation: its sign-in still works, but its sign-up and forgot-password forms do not match the new flow. Serve the React build.

## Accessibility & motion

Native scrolling is replaced by an eased scroll of the chapter stack; keyboard (arrows, Page Up/Down, Home/End), touch and wheel all work. `prefers-reduced-motion` removes the lean, the hover jump and the rotating question, and stops the testimonials auto-advancing. Every overlay closes with Escape.
