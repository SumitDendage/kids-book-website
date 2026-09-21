# `site/` — the Learn With Why website and backend

One Node process, no npm packages: the static site, the JSON API, the SQLite database and the private PDF store.

```bash
cp site/.env.example site/.env   # add Razorpay keys + an admin key (optional for a local demo)
node site/server.cjs             # http://127.0.0.1:4173
node site/test/smoke.cjs         # end-to-end test on a throw-away database
```

## The flow the backend implements

```
Public catalogue  GET /api/worksheets
      ↓
Customer picks a PDF
      ↓
Login             POST /api/auth/signup · signin    (scrypt password, httpOnly session cookie)
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
| `server.cjs` | Entry point: loads `.env`, opens the database, mounts the API modules, serves `dist/`. |
| `server/db.cjs` | SQLite via `node:sqlite` — schema, settings (JSON values), seeding, PDF attachment. |
| `server/seed.cjs` | The worksheet catalogue the database starts with (ids match the cards in `dist/index.html`). |
| `server/auth.cjs` | Sign up / in / out, `me`, role, forgot-password codes, password reset. |
| `server/pricing.cjs` | Countries, tax, fees, currency; signed quotes for a class plan or a single PDF. |
| `server/payments.cjs` | Razorpay orders, signature verification, webhook, demo gateway; the one place an order becomes paid. |
| `server/access.cjs` | Entitlements, the access check, view tokens, PDF/page streaming, access log, public catalogue. |
| `server/admin.cjs` | Staff API (`x-admin-key`): orders, customers, entitlements, worksheets + PDF upload, settings, logs. |
| `server/http.cjs` | JSON/raw bodies, cookies, same-origin check, rate limiter. |
| `test/smoke.cjs` | 34 end-to-end checks of the flow above on a temporary database. |
| `data/lww.sqlite` | The database (git-ignored, created on first run; settings are copied from the old `data/db.json` if present). |
| `protected/` | Private PDF storage. `a-to-z/` ships with the 26 free sheets; admin uploads land in `uploads/`. |
| `dist/index.html` | The customer site: styles, the six chapters, and the page script (auth, catalogue, checkout, viewer hand-off). |
| `dist/viewer.html` | The protected viewer: pdf.js rendering, watermark, copy/print protection. |
| `dist/admin.js` | Admin + Developer dashboards. With the admin key saved they read orders, customers and entitlements from the database. |
| `dist/frames-webp/`, `dist/preview-frames/`, `dist/fonts/`, `dist/sheets/` | Landscape frames, fox & rabbit frames, fonts, public thumbnails. |

## Database

`data/lww.sqlite` (WAL mode). Tables:

| Table | Holds |
|---|---|
| `users` | id, email, name, role, `pw_hash` (scrypt `salt:hash`), created/last-login |
| `sessions` | sha256 of the cookie token, user, expiry, UA, IP |
| `password_resets` | hashed six-digit codes, 15-minute expiry, attempt counter |
| `worksheets` | id, title, class, subject, pages, price (INR, 0 = free), `file` (path inside `protected/`), thumb, active |
| `orders` | id `LWO-xxxxxx`, user, kind (`class` / `worksheet`), currency, total, INR total, amount in minor units, lines, coupon, address, method, status (`created` → `paid` / `failed` / `refunded`), Razorpay order + payment ids |
| `payments` | every gateway event (order created, verify, webhook, demo) with outcome |
| `entitlements` | user, scope (`worksheet` or `class`), reference, kind (`free` / `paid`), order, `starts_at`, `revoked_at` — no expiry |
| `access_log` | every access decision and PDF/page stream, with IP |
| `settings` | JSON values: `plans`, `classes`, `coupons`, `discounts`, `rates`, `fees`, `secret` |

Inspect it with any SQLite client, or from Node:

```bash
node -e "const {DatabaseSync}=require('node:sqlite');const d=new DatabaseSync('site/data/lww.sqlite');console.table(d.prepare('SELECT id,user_id,scope,worksheet_id,cls,kind,datetime(starts_at/1000,\"unixepoch\") AS since,revoked_at FROM entitlements').all())"
```

## API

All responses are JSON. State-changing calls must come from the site's own origin (the `Origin` header is checked); the webhook is the exception.

| Method & path | Auth | What it does |
|---|---|---|
| `GET /api/worksheets` | – | Public catalogue: price, pages, whether a real PDF is attached, thumbnail. |
| `GET /api/config` · `GET /api/geo` · `GET /api/health` | – | Countries, plans, gateway mode; country guess; liveness. |
| `POST /api/auth/signup` `{name,email,password,remember}` | – | Creates the account and signs in (201 + cookie). |
| `POST /api/auth/signin` `{email,password,remember}` | – | Signs in. 20 attempts per 10 minutes per IP + email. |
| `POST /api/auth/signout` · `GET /api/auth/me` · `PATCH /api/auth/me` `{role,name}` | cookie | Session end, who am I, profile. |
| `POST /api/auth/forgot` `{email}` → `POST /api/auth/reset` `{email,code[,password]}` | – | Six-digit code (printed on the server console; returned in the response outside production), then the new password. |
| `POST /api/quote` `{cls,plan}` or `{worksheet}` + `coupon`, `address` | – | Signed quote, valid 15 minutes. |
| `POST /api/pay/order` `{quote,method}` | cookie | Order + Razorpay order → `{gateway:{key,razorpay_order_id,amount,…}}`, or `{gateway:{provider:'demo'}}` without keys. |
| `POST /api/pay/verify` `{order_id,razorpay_order_id,razorpay_payment_id,razorpay_signature}` | cookie | Verifies the signature, marks the order paid, grants the entitlement. |
| `POST /api/pay/webhook` | Razorpay signature | Same grant from `payment.captured` / `order.paid`; `payment.failed` marks the order failed. Idempotent. |
| `POST /api/pay/demo/confirm` `{order_id}` | cookie | Only while no gateway keys are configured. |
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

Without keys the server runs the **demo gateway**: the checkout says so, a confirmation replaces the card form, and the order is settled by `POST /api/pay/demo/confirm`. The route does not exist once keys are set.

## Protection model

- PDFs are never reachable as static files; `/api/view/file` re-checks the session cookie **and** the entitlement row on every request, so a copied link is useless and a revoked sheet closes even in an open viewer (it re-asks the server every minute and on focus).
- View tokens are HMAC-signed, bound to the user, the worksheet and the entitlement (useless without the session cookie), and travel in a header (not the URL); the viewer page sends no referrer.
- Every page carries the customer's name, email and the time twice: a CSS overlay and a stamp baked into the canvas pixels.
- The viewer blocks the context menu, drag, copy, print and save shortcuts, blurs when the window is not in front, and hides everything in print media.
- Prices are computed and signed on the server; an edited quote is refused. Only Razorpay's signature (or its signed webhook) turns an order into an entitlement.

## Configuration (`site/.env`)

| Variable | Meaning |
|---|---|
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` | Gateway keys; empty = demo gateway. |
| `RAZORPAY_WEBHOOK_SECRET` | Webhook signature secret; empty = webhooks are acknowledged but ignored. |
| `ADMIN_KEY` | Staff API key (default `change-me` — change it). |
| `SITE_URL` | `https://…` turns on the `Secure` cookie flag. |
| `PORT`, `HOST`, `DB_PATH`, `PROTECTED_DIR` | Where to listen, where the database lives, where the private PDFs live. |
| `RESET_CODE_IN_RESPONSE`, `NODE_ENV` | Whether forgot-password codes are returned to the browser (default: yes unless `NODE_ENV=production`). |

## Accessibility & motion

Native scrolling is replaced by an eased scroll of the chapter stack; keyboard (arrows, Page Up/Down, Home/End), touch and wheel all work. `prefers-reduced-motion` removes the lean, the hover jump and the rotating question, and stops the testimonials auto-advancing. Every overlay closes with Escape.
