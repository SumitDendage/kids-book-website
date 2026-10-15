# Learn With Why on Supabase — build contract

This file is the contract every builder follows. The database (10 migrations), the request core
(`functions/api/lib/*`), the email templates and the entitlement helpers already exist and type-check.
What is left is the route modules, four shared services and the tests.

Paths below are relative to `/home/claude/kids-book-website/supabase/`.

## 0. Ground rules for every builder

- Edit **only the files your section owns** (§3). If a shared file needs a change (a lib helper, a
  migration, another owner's stub), do not edit it: describe the change in your final report under
  "Requests for the integrator" with the exact diff. Exception: you may add a **new** migration file
  `migrations/20261007121<N>00_<owner>_<topic>.sql` (N = your letter's index: A=0 B=1 C=2 D=3 E=4 F=5 G=6)
  when you genuinely need a column, index or function; keep it additive and idempotent where cheap.
- Never commit, push or touch git. Never touch `/home/claude/kids-book-website/frontend`, `backend/`
  or `database/` (read-only references). Never print values from any `.env` file.
- No network calls to the internet. The container cannot reach Supabase or any gateway; all tests use
  local fakes.
- Do not use `pkill -f`/`kill $(pgrep -f …)`. Do not delete directories outside your scratch space.
- Read before writing: the old behaviour is mapped in `/var/tmp/sb/map/*.md`
  (`backend-api.md` = every old endpoint with exact request/response bodies and error texts,
  `backend-services.md` = pricing/payments/access/auth rules, `frontend-customer.md` and
  `frontend-admin.md` = what the React site calls and which fields it reads, `security-pages.md` =
  the account-security zip with endpoints E1–E8, `database.md` = old schemas). The old Node code is
  in `/home/claude/kids-book-website/backend/src/**` (read-only). **Keep old request and response
  shapes** (field names, error messages, `code` values) unless this file says otherwise; add new
  fields freely.

## 1. Code conventions

- Deno + TypeScript strict. Imports are relative with `.ts` (`../lib/db.ts`); npm packages only via
  the import map (`postgres`, `jose`, `pdf-lib`). No other dependencies.
- A route module exports `register(r: Router)` and calls `r.get/post/put/patch/delete(path, handler)`.
  Paths are full (`/api/admin/orders/:id`). `:name` matches one segment (already URI-decoded).
  Register more specific paths **before** generic ones in the same module if they could collide.
- A handler receives `ctx: Ctx` (`lib/context.ts`) and returns a plain object/array (→ 200 JSON) or a
  `Response`. Errors: `throw new HttpError(status, message, { code, errors, ...extra })` or
  `fail(...)` (`lib/http.ts`). Body = `{ error, code?, errors?: { field: message }, ...extra }`.
  Validation problems → 400 with `errors`. Unknown id → 404 `{ error: 'Not found' }` (old wording
  where the old route had one).
- Read bodies with `readJson(ctx.req)` (64 KB default) or `readRaw(ctx.req, limit)` for uploads.
  Query parameters: `ctx.query.get(...)`, numbers via `intParam`.
- **Database:** only through `tx(async (q) => …)` (`lib/db.ts`) — every transaction runs as role
  `lww_api` (least privilege, see `migrations/20261007120600_row_security.sql` for its grants).
  Keep transactions short and **never make HTTP calls (GoTrue, Storage, gateways, mail) inside a
  transaction**: read → call out → write. postgres.js tagged templates only (no string-built SQL;
  `q.unsafe` only with constant text). JSON values: `q.json(obj)`. Arrays: `${arr}::text[]`.
  `bigint` columns come back as numbers. Unique violation → `isUnique(e, 'constraint_name')`.
  If `lww_api` lacks a grant you need, request it (§0) — do not work around it.
- **Times:** stored as `timestamptz` (UTC). API output uses **epoch milliseconds** for old fields
  and keeps adding ISO strings only where this file says (`expiresAt`). Human text in emails uses
  `fmtDateTime(d, profile.time_zone)` which always names the zone ("7 Oct 2027, 6:15 pm IST").
- **Money:** product and plan prices are whole rupees (`price_inr`). Quotes/orders carry the
  customer's currency with 2 decimals (0 for zero-decimal currencies such as JPY and KRW) and
  `amount_minor` for gateways (`minorUnits`: ×1, ×100, or ×1000 for three-decimal currencies such as
  KWD). Currencies whose minor unit the gateways treat differently (HUF, ISK, TWD, UGX) are refused
  in the rates/countries settings.
- **Security:** every staff route starts with `await requireStaff(ctx, '<permission>')`; every
  customer route with `await requireUser(ctx)` (or `optionalUser`). Every staff write writes an
  `audit(ctx, {...}, q)` row **in the same transaction**. Rate-limit anything public or costly with
  `rateLimit(ctx, name, key, limit, windowSeconds)`. Never return `pdf_path`, storage paths, tokens,
  hashes, raw provider payloads or env values to customers. Never log secrets, passwords, tokens or
  full card/payment payloads (`console.error` messages only).
- **Background work** (emails, last-seen, rule evaluation): `ctx.later(() => …)`. Queue normal emails
  with `enqueue(q, {...})` inside the transaction, then `kickOutbox(ctx)` after it. Emails that hold
  a password or a one-time link go through `sendSensitive(...)` (sent now, body never stored).
- Settings: `getSettings(q?)` (cached 20 s; `clearSettingsCache()` after a write).
- Keep files readable: short comments that explain *why*, in plain English, like the core files.

## 2. Auth model (already implemented in `lib/auth.ts` — read it)

- Supabase Auth stores passwords. The API talks to it with `lib/gotrue.ts` (admin create/update/
  delete user, password grant, refresh grant, logout, getUser).
- The browser keeps `{ accessToken, refreshToken }` (localStorage) and sends
  `Authorization: Bearer <accessToken>` plus `X-Device-Id` (random per browser) and `X-Visitor-Id`.
  No cookies any more; the old same-origin/CSRF check is replaced by bearer tokens + CORS.
- `requireUser(ctx)` verifies the JWT, then requires an `app_sessions` row with the JWT's
  `session_id` that is not revoked, not expired and not blocked, and a profile that is not blocked and
  is verified. Codes: 401 `signin`, 403 `account_suspended` (whole-account block), 403
  `session_blocked`, 403 `email_unverified`.
- Three separate controls (document them; keep them independent):
  - **Account block** (`profiles.blocked_at`): cannot sign in or use the API; every session ended.
    API code stays `account_suspended` for the old site; the user object says `status:'suspended'`.
  - **Paid-access suspension** (`profiles.subscription_suspended_at`, reason `warnings|staff`):
    sign-in, My Account, order history, free sheets, appeals and notifications keep working; paid
    sheets and class plans do not open (403 `access_suspended`) and new purchases are refused
    (403 `access_suspended`). Entitlements are not touched, so lifting it restores access (time
    that passed while suspended is not added back — document).
  - **Session block** (`app_sessions.blocked_at`): one sign-in stops (403 `session_blocked`),
    reversible; the Supabase Auth session is kept so an unblock works. Refresh is refused while
    blocked.
- Staff = row in `staff_members` (active). Owner has every permission; other roles use their
  `permissions[]`. The 27 permission keys are in `staff_permissions` (see reference-data migration).
  `staff.manage` creates staff; only an **owner** may grant `owner`/`admin` roles or `staff.manage`,
  change another owner, or deactivate an admin. The last owner is protected by a trigger.
- There is no shared ADMIN_KEY any more. `x-admin-key` is ignored. Staff sign in with the same
  `/api/auth/login` (`staff: true` in the body).

## 3. Ownership (who writes what)

| Agent | Files it owns (create/replace) | Endpoints |
|---|---|---|
| **A auth** | `routes/auth.ts`, `services/accounts.ts`, `tests/api/auth.test.ts` | §4.A |
| **B shop+public** | `routes/shop.ts`, `routes/public.ts`, `services/pricing.ts`, `services/chatbot.ts`, `tests/api/shop.test.ts`, `tests/api/public.test.ts` | §4.B |
| **C payments** | `routes/payments.ts`, `services/fulfil.ts`, `gateways/razorpay.ts`, `gateways/stripe.ts`, `gateways/paypal.ts`, `tests/api/fakes/gateways.ts`, `tests/api/payments.test.ts` | §4.C |
| **D access+security** | `routes/access.ts`, `routes/account.ts`, `services/viewtoken.ts`, `services/watermark.ts`, `services/sharing.ts`, `tests/api/access.test.ts`, `tests/api/security.test.ts` | §4.D |
| **E admin catalogue+commerce** | `routes/admin_catalogue.ts`, `routes/admin_commerce.ts`, `tests/api/admin_catalogue.test.ts`, `tests/api/admin_commerce.test.ts` | §4.E |
| **F admin people+security** | `routes/admin_people.ts`, `routes/admin_security.ts`, `tests/api/admin_people.test.ts`, `tests/api/admin_security.test.ts` | §4.F |
| **G admin ops** | `routes/admin_ops.ts`, `services/analytics.ts`, `services/csv.ts`, `tests/api/admin_ops.test.ts` | §4.G |
| **H test infra** | `tests/api/harness.ts`, `tests/api/fakes/supabase.ts`, `tests/api/fakes/mail.ts`, `tests/api/smoke.test.ts`, `tests/run.sh` | §6 |

Shared services are already stubbed with their **final signatures** — the owner replaces the bodies
and must not change the exported signatures (adding optional parameters or extra exports is fine):
`services/accounts.ts` (A), `services/sharing.ts` (D), `services/pricing.ts` (B), `services/fulfil.ts`
(C). Other agents import and call them as declared. Read the doc comments in those stubs.

## 4. Endpoints

All paths are under the function, e.g. `https://<ref>.supabase.co/functions/v1/api/auth/login`; the
router sees `/api/auth/login`.

### 4.A Auth (`routes/auth.ts`, `services/accounts.ts`)
- `POST /api/auth/signup {name, email, role?, agreement: true, agreementVersion?}` — the customer does
  not choose a password. Validate (old messages). Require `agreement === true` (400
  `errors.agreement`, code `agreement_required`). If email is not configured (`mailReady()` false
  and no test transport) → 503 `mail_unavailable` before creating anything. Generate the password
  (`generatePassword()`), `adminCreateUser({confirmed:false, via:'signup'})` (profile row is created
  by trigger), record `agreement_acceptances` (version + sha256 of `settings.agreement.text`, context
  `signup`, ip, ua) and set `profiles.agreement_version/accepted_at`, `time_zone` if a valid
  `timeZone` was sent, create a `verify_email` token (store sha256 only; link
  `${SITE_URL}/?verify=<token>` — check what the old frontend reads), send `welcome` via
  `sendSensitive`. If the send fails → `adminDeleteUser` and 502 `mail_failed` ("We could not send
  the email …"). Existing email → keep the old behaviour. Response: old shape plus
  `passwordEmailed: true`. Rate limits: 20/h per IP, 3/h per email. Analytics `signup`.
- `POST /api/auth/verify-email {token}` → profile verified/active, `adminUpdateUser({emailConfirm:true})`,
  token used. Old response shape.
- `POST /api/auth/resend-verification {email}` → neutral response always; for an unverified account
  generate a **new** password (`adminUpdateUser`), new token, `resendVerification` email. 3/h per
  email, 20/h per IP.
- `POST /api/auth/login` (alias `/api/auth/signin`) `{email, password, remember, agreement?, staff?}`:
  lockout from `settings.login` (failed attempts → `locked_until`, old 423/429 behaviour — check the
  map), `passwordGrant` → on success load profile: blocked → end the new GoTrue session
  (`logoutSession`) and 403 `account_suspended`; unverified → logout + 403 `email_unverified`;
  `staff:true` and not active staff → logout + 403 `not_staff`; customer whose
  `agreement_version` ≠ current `settings.agreement.version` and `agreement !== true` → logout + 403
  `agreement_required` with `{ agreement: { version, text } }`; with `agreement:true` record a
  `reaccept`. Then `openSession` (app_sessions row: remember → `rememberDays`, else `shortHours`,
  capped at `maxDays` from creation — `maxDays` and `rememberDays` are at most 90, the settings
  route refuses more and `app_sessions_at_most_90_days` checks it in the table; device label, ip, network, country, device hash, is_staff),
  reset failures, `last_login_at`, `login_activity` row (every success **and** failure with the
  allowed reasons), analytics `login`, `ctx.later(() => evaluateRules(ctx, userId))`.
  Response: `{ user: publicUser(...), session: sessionBody(...), staff: {role, permissions}|null,
  security: SecurityStatus|null }` (customers get `security`). Rate limits: 100/15 min per IP,
  10/15 min per IP+email.
- `POST /api/auth/logout` (alias `signout`) — optional bearer; revoke that app session (`logout`) and
  `logoutSession`. Always 200 `{ ok: true }`.
- `GET /api/auth/me` (`requireUser`) → `{ user, staff, security }`. `PATCH /api/auth/me {name?, role?,
  timeZone?}` → updated user. The account type (`role`) is chosen **once**: see §4.H. Every user
  body (`me`, `login`, `refresh`, `PATCH me`) carries `role`, `accountType` and `printsPerSheet`.
- `requireUser` checks `profiles.blocked_at` **first**: a blocked account answers 403
  `account_suspended` even when its sign-in has also ended, so an open page learns why. Refresh does
  the same (after a successful `refreshGrant`).
- `POST /api/auth/refresh-token {refreshToken}` → no bearer needed. `refreshGrant`; then the app
  session (by the new token's `session_id`) must exist, not revoked/expired/blocked, account not
  blocked → otherwise 401 `signin` / 403 codes as above. Session end does **not** move (the cap is
  fixed at sign-in). Returns `{ session: sessionBody(...) , user }`.
- `POST /api/auth/forgot-password {email}` → neutral; token `reset_password`
  (`settings.auth_links.resetMinutes`), link `${SITE_URL}/?reset=<token>` (check old frontend),
  `passwordReset` email via `sendSensitive`. 3/h per email.
- `POST /api/auth/reset-password {token, password}` → `passwordProblem`, `adminUpdateUser({password})`,
  `password_changed_at`, clear lockout, `endAllSessions(q, id, 'password_reset')`, queue
  `passwordChanged`. 30/15 min per IP for token routes.
- `services/accounts.ts`: implement the stub signatures. `endAllSessions` updates `app_sessions`
  and calls `private.end_auth_sessions(user, keep)` in the same transaction. `blockAccount` sets
  `blocked_at/blocked_reason/blocked_by`, ends sessions (`account_blocked`), audit
  `account.block`, security event; `unblockAccount` clears them (audit `account.unblock`).

### 4.B Shop and public (`routes/shop.ts`, `routes/public.ts`, `services/pricing.ts`, `services/chatbot.ts`)
- `GET /api/worksheets` — old shape (check the map) from `products` with `status='active'` plus
  `classes` and `plans`. Add per item: `available` (= PDF uploaded, via one call to
  `private.product_file_status()`), `accessDays`, `free` (price 0), `printLimit`, `downloadLimit`,
  `printRule` (`account` | `sheet`), `prints` (`{parent, teacher, organization}`: this sheet's prints
  per account type, §4.H), `rating`, `ratingCount`, `reviewAvg`, `reviewCount`, `audience`, `stock`.
  Never `pdf_path`.
  Class status from `classes.status` (`coming_soon` → old "Coming soon" flags). Cache-Control as old.
- `POST /api/quote` — same request and response shape as the old route (read
  `backend-services.md §2` and `backend/src/services/pricing.cjs`), all prices from the database,
  countries/tax/fees/rates from settings, plan regions (`IN`/`INTL`; `y1` is outside India only),
  class `discount_pct`, coupons (`active`, window, `applies_to`, `class_id`; usage limits are checked
  at quote and order time, where an unpaid order holds its use for 48 hours — the caller's own
  included — and again inside `private.fulfil_order`: a payment that arrives after the code ran out
  still grants, but no redemption is counted and staff get a `coupon.over_limit` notification),
  worksheet access days. Store it in `quotes` (`expires_at = now() +
  settings.quote.ttlMinutes`, `payload` = `{ rate, discountInr, methods, lines: QuoteLine[] }`) and
  return the old body plus `quoteId`, `sig` (= quoteId, so the old client field stays filled),
  `expiresAt` (ms), `accessDays`, and per line the expiry text the checkout shows. Unavailable sheets
  (no PDF, archived, class coming soon) → old "not for sale" error with code `unavailable`.
  `methods` lists only gateways that are configured (`gatewayModes()`) **and** allowed for the
  country. 60/min per IP. Several sheets (the cart) go in one quote: `{ worksheets: [ids], address,
  coupon? }`, see §4.H.
- `services/pricing.ts`: `countryFor`, `buildQuote`, `loadQuote`, `revalidateQuote` as stubbed.
- `GET /api/me/orders` — customer's orders, newest first, old shape plus `lines`, `paidAt`,
  `status`, and for each line its entitlement `{purchasedAt, startsAt, expiresAt, status}`.
- `GET /api/me/entitlements` — **all** the customer's entitlements (active, scheduled, expired,
  revoked, lapsed) using `pubEntitlement` from `services/entitlements.ts`, plus top-level
  `{ now, accessDays, accessStatus }`. Keep the old top-level shape (check the map: array vs
  object) and add the new fields compatibly.
- `GET /api/health` → `{ ok, version, db: true|false, time }` (no secrets; db check `select 1`).
- `GET /api/config` → old shape (gateways/keys that are public such as Razorpay key id, Stripe/PayPal
  enabled flags, currency info…) plus `classStatus`, `accessDays`, `agreement {version,text}`,
  `features {email: mailReady(), payments: {...}}`, `security {maxWarnings}`,
  `viewer {recheckSeconds}`, `supportEmail`, `prints {parent, teacher, organization}` (prints per
  sheet by account type, from `settings.prints`).
- `GET /api/geo` → old shape; country from `ctx.country` (platform header), else `IN` default as old.
- `POST /api/contact {name, email, message, ...}` → old validation and response; rows in
  `contact_messages` (user id if signed in via `optionalUser`), queue `contactToInbox` to
  `settings.contact.inbox` with `replyTo` = sender, `related_type='contact_message'`,
  `kickOutbox`. 5/h per IP, 32 KB body. Staff notification `contact.new`.
- `POST /api/ai/chat {message, history?}` → FAQ chatbot (`services/chatbot.ts`): keyword + trigram
  retrieval over `faq_entries` where `audience='public' and status='published'` only; replace
  `{accessDays}` with the setting; answer shape the frontend expects (read `frontend-customer.md
  §10` and `frontend/src/services/aiChat.js` + `frontend/src/data/aiAssistant.js`); a polite
  fallback that points to the contact form. No AI API. 30/min per IP.
- `POST /api/events {kind, path?, productId?, meta?}` — client analytics: kinds `page_view`,
  `product_view`, `checkout_start`, `search` only; `visitor_id` from `X-Visitor-Id`, `user_id` from
  `optionalUser`, referrer host only, `device`. 120/min per IP. Returns 204-like `{ ok: true }`.
- `GET /api/content` → published `site_content` as `{ key: value }`. `GET /api/faq` → published public
  FAQ list. `GET /api/worksheets/:id/reviews` → published reviews (name initials only, never user id).

### 4.C Payments (`routes/payments.ts`, `services/fulfil.ts`, `gateways/*`)
- `POST /api/pay/order {quoteId | sig, method, address?, country?}` (customer): old request/response
  shape (read the map; the old body also had `worksheet/cls/plan/coupon` — the stored quote wins and
  must match if they are sent). Refuse when `subscription_suspended_at` (403 `access_suspended`).
  Flow: tx1 `loadQuote` + `revalidateQuote` + method allowed + insert `orders` (status `created`,
  `newOrderId()`, `lines` = quote lines, `rate`, totals, `discount_inr`, `coupon_code`, ip/ua) and
  `order_items`; mark `quotes.used_at/used_by_order` the first time. Then create the gateway order
  (Razorpay order with `amount_minor`, `receipt` = order id; Stripe Checkout Session with
  `client_reference_id` and `metadata.order_id`, success/cancel URLs from `SITE_URL` as old; PayPal
  order with `custom_id`). tx2: store `gateway_order_id`, `gateway_mode`. Gateway failure →
  order `failed` with reason, 502 `gateway_error`. Not configured → 503 `payments_unavailable`.
  Analytics `order_created`, `checkout` audit is not needed.
- `POST /api/pay/verify {razorpay_order_id, razorpay_payment_id, razorpay_signature, order_id?}` —
  HMAC check with the key secret (constant time), the order must belong to the caller, then **fetch
  the payment from Razorpay** (`GET /v1/payments/:id`: status `captured` — or `authorized` then
  capture — `order_id` matches, amount/currency) and call `fulfil`. Never trust client amounts.
- `POST /api/pay/webhook` (Razorpay, no auth): raw body ≤ 256 KB, HMAC
  `X-Razorpay-Signature` with the webhook secret, dedupe by `X-Razorpay-Event-Id`
  (unique `(provider, event_id)` in `payment_events`; a duplicate returns 200 `{ ok: true,
  duplicate: true }` without work), events `payment.captured`, `order.paid` → `fulfil`;
  `payment.failed` → order `failed` unless paid; `refund.processed` → `private.gateway_refund`.
  Gateway refunds (Razorpay, Stripe, PayPal) are recorded by payment id in `gateway_refunds`, even
  before the capture arrives or without a known order; only the refund of the payment that paid the
  order refunds it and revokes its access (a duplicate payment's refund leaves the order paid and
  tells staff; when the order was paid twice and the payment it was booked with is refunded while
  the other one of the full amount is still captured, the order stays paid, is booked against the
  surviving payment and staff are told), and `private.fulfil_order` refuses a payment already
  refunded (`payment_refunded`).
  Bad signature → 400 and a `payment_events` row with `signature_ok=false`. Always log the event
  (no full payload: `payload_sha256` + a small `detail`).
- `POST /api/pay/cancel {order_id}` (customer) → `created` → `cancelled` for own order (old shape).
- `POST /api/pay/stripe/confirm {session_id | order_id}` (customer) → retrieve the Checkout Session
  from Stripe, `payment_status === 'paid'`, metadata order id matches the caller's order → `fulfil`.
- `POST /api/pay/stripe/webhook` → verify `Stripe-Signature` (`t=…,v1=…`, HMAC-SHA256 of
  `t.payload`, 5-minute tolerance), dedupe by event id, `checkout.session.completed` /
  `checkout.session.async_payment_succeeded` → `fulfil`; `charge.refunded` → refund.
- `POST /api/pay/paypal/capture {order_id | token}` (customer) → capture the PayPal order,
  `COMPLETED`, amount/currency/custom_id match → `fulfil`.
- `POST /api/pay/paypal/webhook` → verify with PayPal's `/v1/notifications/verify-webhook-signature`
  (needs `PAYPAL_WEBHOOK_ID`), dedupe, `PAYMENT.CAPTURE.COMPLETED` → `fulfil`,
  `PAYMENT.CAPTURE.REFUNDED` → refund.
- `services/fulfil.ts`: `fulfil()` runs **one transaction**: `private.fulfil_order(...)`; on `paid`
  load the order lines + entitlements and queue `purchaseSuccessful` (subject starts "Purchase
  Successful", every line with its title and expiry in the customer's time zone, "My Account → My
  Worksheets") with `dedupeKey = 'purchase:<orderId>'`, customer notification `purchase.success`,
  staff notification `order.paid`, analytics `purchase` (value INR), audit `order.paid` (actor
  system). `rejected` → `payment_events`/security event `payment.rejected` with the reason; never
  grants. Then `kickOutbox`. Return the stub's shape. `private.fulfil_order` takes a per-customer
  advisory lock before granting, so two class plans for one class paid at the same moment chain.
- Gateway clients use `env().razorpay.apiBase` etc. (tests point them at fakes). Timeouts 15 s.
  `tests/api/fakes/gateways.ts` exports `installGatewayFakes(h)` that registers fake Razorpay
  (`/v1/orders`, `/v1/payments/:id`, `/v1/payments/:id/capture`), Stripe (`/v1/checkout/sessions`,
  `/v1/checkout/sessions/:id`) and PayPal (`/v1/oauth2/token`, `/v2/checkout/orders`,
  `/v2/checkout/orders/:id/capture`, `/v1/notifications/verify-webhook-signature`) handlers on the
  harness fake server (§6), with controllable state (paid/failed/amount).

### 4.D Access, viewer and account security (`routes/access.ts`, `routes/account.ts`, `services/*`)
- `POST /api/access/:id` (customer; id `^[A-Za-z0-9-]{1,64}$`): product must exist and be `active`
  (archived sheets stay open for people who already hold live access; drafts only for staff with
  `catalogue.read`), PDF uploaded (`hasPdf`; else 410 `unavailable` "This sheet is being prepared"),
  account not suspended for paid access (free passes still work), then `bestLive(...)`. A free sheet
  creates the free pass if missing (unique index protects races). No live access → old 402/403 body
  with `worksheet`, `cls`, `price`, and new `expired: true, expiredAt` when the newest record has
  expired (so the site can show **Buy Access Again**). Success → old body + `viewToken`,
  `expiresAt` (entitlement end), `tokenExpiresAt`, `recheckSeconds`, `printsLeft`,
  `downloadsLeft`, `entitlement` (pubEntitlement). `observeAccess` every time (ok or not).
- View token (`services/viewtoken.ts`): HMAC-SHA256 with `private.app_secrets.view_token_key`
  (select via `lww_api`) over `userId|productId|entitlementId|sessionId|exp`; base64url; exp =
  min(now + `viewer.tokenHours`, entitlement end). Sent as `X-View-Token` header (or `?t=` for
  `<img>` page requests, as old).
- `GET /api/view/meta`, `GET /api/view/file`, `GET /api/view/page?n=` — bearer **and** view token;
  **every request re-checks** the session, account, suspension, product status, PDF presence and
  that the entitlement is still live (the token's entitlement or any other live one), then
  `observeAccess`. Denied → 401/403 with `code` (`expired`, `access_suspended`, `session_blocked`,
  `revoked`, …) so the viewer can clear itself. `meta` → old shape + `expiresAt`,
  `recheckSeconds`, `watermark: { name, email, orderId, issuedAt }`, `printsLeft`, `downloadsLeft`,
  `pages`. `file` → streams the PDF from the private bucket (never a public URL); stamp a light
  watermark on every page with pdf-lib (`services/watermark.ts`): a footer line `Licensed to
  <email> - <order id> - <UTC date>` measured to stay inside the page (shrunk, then wrapped), a
  `Name on account: <name>` line under it cut to the page width (left out when the name cannot be
  printed), and the email alone faintly across the page. The customer can change their name, so it
  never comes first or stands in the identifying line; if stamping fails, stream the
  original and record a security event `watermark.failed`. `file` is rate-limited per account
  (`FILE_LIMIT`, 60 an hour; 429 `rate_limited`) and every delivery or refusal is logged.
  `page` → streams `private.worksheet_page_images(base)` image n: the numbered pictures
  `<base>-<n>.<ext>`; a single `<base>.<ext>` only for catalogue files with no numbered pictures
  (never under `uploads/`, where `<id>-<n>` may be another sheet's id).
  Headers via `streamResponse` (`X-Pages` when known).
- `POST /api/view/print` and `POST /api/view/download` (bearer + view token): atomic quota through
  `private.consume_sheet_delivery(entitlement, product, kind, limit)` — counted per access record
  **and sheet** in `delivery_counts`, so every sheet of a class plan has its own allowance; 0 = not allowed
  → 403 `not_allowed`; used up → 429 `quota_exhausted`; download returns the stamped PDF with
  `Content-Disposition: attachment` (and `X-Downloads-Left`/`X-Downloads-Limit`, exposed through
  CORS); print returns `{ ok, printsLeft, printLimit, counts: 'server_deliveries' }`. The print limit
  is the **effective** one from §4.H (account type or the sheet's own number), the download limit is
  `products.download_limit`. `POST /api/access/:id` and `GET /api/view/meta` report `printRule`,
  `printLimit`, `printsLeft`, `downloadLimit`, `downloadsLeft` the same way; meta's `user` is
  `{ name, email, timeZone }`. Every viewer refusal carries `{ worksheet, scope, cls }` (scope = the
  kind of access record, `worksheet` or `class`; all three null for a token that is not this
  customer's) so the site can offer the right way back. Be honest in copy: limits only count server
  deliveries.
- `services/sharing.ts`: implement the stub. Rules come from `security_rules` (`params`), see the
  header comment of `migrations/20261007120400_security.sql` for the policy. Distinct devices =
  distinct sign-in `device_id_hash` (a request's own X-Device-Id only without a sign-in row, then
  the session id), so one sign-in is one device; `app_sessions` seen + `access_log` within the
  window. `concurrent_devices` and `many_countries_day` count only allowed opens of paid sheets
  (`access_log.ok` on a non-free entitlement). Networks = `ip_network`; countries = `country`. A new
  IP or new device **alone** never opens an incident: `concurrent_devices` needs both thresholds
  (at least); the other rules trip only **above** their number. `dedupe_key =
  '<rule>:<user>:<bucket>'` (bucket = window-aligned UTC time) so one pattern is one incident;
  an open incident gets `last_seen_at/evidence` updated on repeat. A decided (confirmed or
  dismissed) incident keeps its evidence; activity beyond it (more devices, networks, countries or
  requests) opens a follow-up incident (`<dedupe>:after:<id>`) that staff decide — it never
  confirms itself. A manual report with the same reason within 10 minutes is the same report
  (`repeat: true`, no second incident or warning). The warning email says when paid access was
  already paused rather than counting it as the last warning. `auto_confirm` rules call `issueWarning` at once,
  others wait for staff. Level = active count + 1; `expires_at` = now + `warningExpiryDays`. At
  `maxWarnings` active warnings and `autoSuspend` → `suspendAccess(reason 'warnings')`. Emails:
  `securityWarning` to the customer (dedupe `warning:<id>`), `staffAlert` to
  `settings.email.adminAlerts` (dedupe `warning-staff:<id>`), notifications for both. Every
  decision writes audit + security events. Staff and the owner are never evaluated.
- `routes/account.ts` (customer): `GET /api/me/security` (E1, `SecurityStatus`),
  `POST /api/me/security/acknowledge {warning}` (E2: acknowledge warnings up to that level; never
  lowers the count), `GET /api/me/appeals`, `POST /api/me/appeals {kind, message, warningId?}`
  (one open appeal; staff notification + staff email), `GET /api/me/notifications`,
  `POST /api/me/notifications/read {ids? | all}`, `GET /api/me/sessions` (own sessions: device
  label, last seen, current flag, blocked flag — never ids of other users),
  `POST /api/me/sessions/:id/end` (own other session), `POST /api/me/reviews {worksheet, rating,
  title?, body?}` (only with a past or present entitlement to that sheet; status `pending`).
  These work while paid access is suspended.

### 4.E Admin catalogue and commerce (`routes/admin_catalogue.ts`, `routes/admin_commerce.ts`)
Old endpoints keep their shapes (read `backend-api.md` §admin and `frontend-admin.md`), now behind
`requireStaff` instead of `x-admin-key`:
- Catalogue (`catalogue.read` / `catalogue.write` / `files.upload`): `GET /api/admin/worksheets`
  (all statuses + `available`, `pdfBytes`, `pdfUpdatedAt`), `POST /api/admin/worksheets` (create,
  status draft until a PDF is uploaded), `PUT /api/admin/worksheets/:id` (title, description,
  class, subject, section, pages, price — `pricing.write` for price changes — was price, status,
  audience, print/download limits, stock, access_days, tags, sort, thumb), `DELETE
  /api/admin/worksheets/:id` (archive; hard delete only when never ordered), `POST
  /api/admin/worksheets/:id/restore`, `POST /api/admin/worksheets/:id/file` (raw PDF ≤ 40 MB, check
  `%PDF-` magic, refuse what the stamp cannot handle — over 20 MB `pdf_too_large`, password-protected
  `pdf_encrypted`, unreadable `pdf_unstampable` — so no sheet goes out unstamped, upload to `worksheets/uploads/<id>.pdf` unless the product already has a
  `pdf_path`, set `pdf_path`, count pages with pdf-lib when cheap), `POST
  /api/admin/worksheets/:id/pages/:n` (jpeg/png/webp ≤ 5 MB next to the PDF base), `POST
  /api/admin/worksheets/:id/cover` (public `covers` bucket, sets `cover_path`, `thumb_url` =
  public URL), `GET /api/admin/files` (which products lack PDFs), `GET/PUT /api/admin/classes`
  (`status`, `discount_pct`, name, sort; `pricing.write` for discount).
- Commerce: `GET /api/admin/orders` (filters status/q/from/to, pagination), `GET
  /api/admin/orders/:id` (lines, payments, events, entitlements), `PUT /api/admin/orders` (old:
  status change — allowed: `created→cancelled`, notes; **setting `paid` is refused** with 400
  `use_gateway`: access only comes from verified payments or explicit grants), `POST
  /api/admin/orders/:id/refund {reason}` (`orders.write`; `private.refund_order`; audit; customer
  email/notification) — this records a refund done in the gateway dashboard (say so in the
  response), `GET /api/admin/payments`, `GET /api/admin/payment-events` (webhook log),
  `GET /api/admin/entitlements` (filters), `POST /api/admin/entitlements/grant {user|email,
  worksheet|cls, plan?, days?|until?, reason}` (`entitlements.grant`, kind `grant`, expiry
  required), `POST /api/admin/entitlements/revoke {id, reason}`, `POST
  /api/admin/entitlements/:id/extend {days|until, reason}` (`entitlements.grant`).
  `GET /api/admin/settings` (old shape + every settings key the role may see),
  `PUT /api/admin/plans`, `PUT /api/admin/rates`, `PUT /api/admin/coupons` (old bulk shape),
  `GET/POST /api/admin/coupons`, `PUT/DELETE /api/admin/coupons/:code` (delete = deactivate when it
  has redemptions), `PUT /api/admin/settings/:key` for whitelisted keys with validation —
  `worksheet_access` (days 1–3650), `fees`, `currency_rates`, `quote`, `countries` → `pricing.write`;
  `sessions`, `login`, `auth_links`, `viewer`, `contact`, `email`, `agreement` → `settings.write`;
  `security` → `security.write`. Every write audited with before/after.

### 4.F Admin people and security (`routes/admin_people.ts`, `routes/admin_security.ts`)
- `GET /api/admin/me` → `{ user, staff: { role, permissions (effective) }, permissions: all keys }`.
- Customers (`customers.read` / `customers.write`): `GET /api/admin/users` (old shape + `accessStatus`,
  `warningCount`, `blocked`, `lastLoginAt`, `activeSessionCount`; search/pagination), `GET
  /api/admin/users/:id` (profile, orders, entitlements with status, sessions, warnings, incidents,
  appeals, recent logins), `PUT /api/admin/users/status {id|email, status: 'active'|'suspended',
  reason?}` (old compat → `blockAccount`/`unblockAccount`), `POST /api/admin/users/:id/block
  {reason}`, `POST /api/admin/users/:id/unblock`, `POST /api/admin/users/:id/sessions/end-all`,
  `POST /api/admin/users/:id/password-reset` (sends the reset link, never shows a password).
- Staff (`staff.manage`): `GET /api/admin/staff`, `GET /api/admin/staff/roles` (templates +
  permission list), `POST /api/admin/staff {email, name?, role, permissions?}` (promote an existing
  account, or create one with a generated password emailed via `staffWelcome` — 503
  `mail_unavailable` when email is off), `PUT /api/admin/staff/:userId {role?, permissions?,
  active?, note?}`, `DELETE /api/admin/staff/:userId` (deactivate; ends the staff sessions). Owner-only
  rules from §2. A staff member cannot change their own role or deactivate themselves.
- Messages (`messages.read` / `messages.write`): `GET /api/admin/messages` (old shape + `status`,
  `mailed`, `mailError`), `POST /api/admin/messages/read {id}` and `/replied {id}` (old), `POST
  /api/admin/messages/:id/status {status}`, `POST /api/admin/messages/:id/reply {body}` (queues an
  email to the sender, reply-to the inbox, marks replied).
- Security (security zip E3–E8, `security.read` / `security.write`):
  `GET /api/admin/security/customers` (E3), `GET /api/admin/security/customers/:id/sessions` (E4),
  `POST /api/admin/security/sessions/:id/block` (E5) and `/unblock` (E6) — one session only,
  `POST /api/admin/security/customers/:id/block` (E7) and `/unblock` (E8) — **paid-access
  suspension** (`suspendAccess` reason `staff` / `liftSuspension`, body may carry `{note,
  resetWarnings}`), exact response shapes from `security-pages.md §5.4`. Plus: `GET
  /api/admin/security/incidents?status=`, `POST /api/admin/security/incidents/:id/confirm|dismiss
  {note}`, `POST /api/admin/security/customers/:id/report {reason, confirm}`, `GET
  /api/admin/security/warnings`, `POST /api/admin/security/warnings/:id/revoke {reason}`, `GET
  /api/admin/security/appeals`, `POST /api/admin/security/appeals/:id/decide {accept, response,
  resetWarnings}` (accept → `liftSuspension`; `appealDecision` email), `GET/PUT
  /api/admin/security/rules(/:id)` (enabled, auto_confirm, severity, params validated),
  old logs `GET /api/admin/security-events`, `GET /api/admin/login-activity`, `GET
  /api/admin/access-log` (`logs.read` or `security.read`).

### 4.G Admin operations (`routes/admin_ops.ts`, `services/analytics.ts`, `services/csv.ts`)
- `GET /api/admin/stats` (`dashboard.view`) — old shape, from real rows.
- `GET /api/admin/analytics?from=&to=&tz=` (`analytics.read`) — visitors (distinct visitor ids),
  page views, product views, checkout starts, orders created, paid orders, revenue INR, conversion
  (paid orders / visitors and / checkout starts), refunds, top products, by day (in the tz), by
  country, signups. Only real events; say "no data" rather than inventing.
- Emails (`emails.read` / `emails.write`): `GET /api/admin/emails?status=` (never bodies of
  sensitive mail; show subject/template/to/status/attempts/last_error), `POST
  /api/admin/emails/:id/retry`, `/skip`, `POST /api/admin/emails/process` (runs `processOutbox`).
- `GET /api/admin/audit` (`audit.read`), `GET /api/admin/notifications` + `POST
  /api/admin/notifications/read` (staff audience).
- Exports (`exports.run`): `GET /api/admin/export/:kind` CSV for `orders`, `customers`,
  `payments`, `entitlements`, `messages`, `coupons`, `audit` (formula-injection-safe CSV,
  `Content-Disposition: attachment`, audited). `GET /api/admin/backup` (`exports.run` +
  owner/admin role): JSON of configuration tables (settings, plans, classes, products, coupons,
  faq, site_content, security_rules, staff role templates) — never auth data, tokens or secrets.
- Developer (`developer.read`): `GET /api/admin/developer/health` → env presence report
  (`envReport()`), DB time, applied migration names if readable, table counts, outbox backlog,
  last payment event, last error-ish security events, gateway modes, mail provider. Never values.
- Content (`content.write`): `GET/PUT /api/admin/content` (site_content keys, published flag),
  FAQ CRUD `GET/POST /api/admin/faq`, `PUT/DELETE /api/admin/faq/:id` (audience public/staff,
  status published/draft/planned — planned and staff answers are never public).
- Reviews (`reviews.moderate`): `GET /api/admin/reviews?status=`, `POST
  /api/admin/reviews/:id/status {status}`.

### 4.H Account types, prints per account type, the cart and several-sheet orders (October 2026)

Migration `20261015090000_accounts_prints_cart.sql` (additive only). Tests:
`tests/api/accounts_prints_cart.test.ts`.

- **Account type** = `profiles.role`. The site offers Parent (`parent`), Teacher (`teacher`; the old
  `tutor` counts as Teacher) and Organization (stored as `school`: a school, tuition centre or other
  group). `accountType` in every user body is `parent` | `teacher` | `organization` | null (not chosen
  yet, counted as Parent for prints). A customer sets it while it is empty, at sign-up (`role`) or with
  `PATCH /api/auth/me {role}` (`organization`/`organisation` are accepted and stored as `school`; an
  unknown value is 400 `errors.role`). Once set, a different value (or clearing it) is 409
  `{ code: 'role_locked', error: 'Your account type is already set. Write to us if it needs changing.',
  role }`; the same value again is 200. Security event `account_type.set`.
- **Staff change it:** `PUT|PATCH /api/admin/users/:id {accountType | role}` (`customers.write`; own
  account allowed, other staff accounts follow the usual guard) → `{ ok, changed, user }` (user as in
  the customers list, with `accountType` and `printsPerSheet`). Audit `account.role` with
  `{ before: {role, accountType}, after: {role, accountType} }`, security event
  `account_type.changed_by_staff {by, before, after}`. 400 `errors.role` for a missing or unknown type,
  404 for an unknown customer.
- **`settings.prints`** `{"parent":2,"teacher":4,"organization":300}`: whole numbers 0 to 1000, edited
  with `PUT /api/admin/settings/prints {value: {parent?, teacher?, organization?}}` (`pricing.write`;
  400 `errors.<field>` for a bad or unknown field; audited `settings.update`). Public in
  `GET /api/config` as `prints`. FAQ answers may use `{printsParent}`, `{printsTeacher}`,
  `{printsOrganization}` (filled in by `services/chatbot.ts fillAnswer`).
- **`products.print_rule`** `account` (default) | `sheet`. One helper,
  `services/entitlements.ts effectivePrintLimit(product, role, settings.prints)`: `sheet` →
  `print_limit` (0 = no printing), `account` → `printsPerSheet(settings.prints, role)`. Used by
  `routes/access.ts quotaLeft` and `takeCopy` for every kind of access record (free pass, purchase,
  class plan, grant), counted per record and sheet in `delivery_counts`. Used up → 429
  `quota_exhausted` "You have used all N prints of this sheet that come with your account. You can
  still open it in the viewer." Admin products read and write `printRule` (400 `errors.printRule`);
  `GET /api/admin/worksheets*` also returns `prints` per account type.
- **The cart** (`routes/cart.ts`, table `public.cart_items (user_id, product_id, added_at)`, only
  `lww_api` may touch it). Signed-in customers only (`requireUser`), rate-limited (reads 300, writes
  120 per 10 minutes per account), one advisory lock per customer so two tabs cannot pass the limit.
  Every route answers with the whole cart:
  `{ items: [{ worksheet, title, priceInr, wasPriceInr, cls, subject, thumb, accessDays, problem,
  note, addedAt }], count, buyable, totalInr, max: 50 }` where `problem` is null | `owned` | `free` |
  `unavailable` (with a short `note`) and `totalInr`/`buyable` count only lines with no problem.
  - `GET /api/cart`.
  - `POST /api/cart {worksheet}`: 404 `unknown_item` for an unknown or draft sheet (or a hidden
    class), 400 `is_free`, 409 `already_owned` (a live bought or granted record of that sheet; a class
    plan does not count), 400 `cart_full {max: 50}`; adding a sheet already in the cart changes
    nothing. A sheet that is not for sale right now is kept and shown as `unavailable`.
  - `DELETE /api/cart/:id` (removes one line; unknown ids are fine), `DELETE /api/cart` (empties it).
  - `POST /api/cart/merge {worksheets: [ids]}` (the browser cart after sign-in): adds what it can and
    silently skips the rest; returns the cart plus `added: [ids]` and `skipped: [{worksheet, reason:
    'unknown' | 'free' | 'owned' | 'full'}]`. 400 `bad_items` when `worksheets` is not a list.
- **Several sheets in one quote:** `POST /api/quote {worksheets: [ids], address, coupon?}` → 1 to 50
  paid sheets (repeats counted once) in one order with one line each; each line's discount on its own
  price (class discount, coupon rules per line), then one tax/fee on the total. Refusals name the
  sheet: 400 `free {worksheet}`, 400 `unknown_item {worksheet}`, 400 `unavailable {worksheet}`, 409
  `already_owned {worksheet}`, 400 `no_items`, 400 `bad_items`, 400 `too_many {max: 50}`. The
  response is the usual quote with `worksheet: null` (when more than one), `title: 'N worksheets'`,
  `cls` and `accessDays` when every sheet shares them (else null), `items` (every line with its own
  end date), `worksheets: [ids]`, `count`, `listInr`. The old `{worksheet}` and `{cls, plan}` bodies
  are unchanged.
- **Orders:** `POST /api/pay/order` makes one order with one `order_items` row per sheet. A sent
  `worksheets` list must name exactly the quote's sheets (any order), and a sent single `worksheet`
  only matches a one-sheet quote (else 400 `quote_mismatch`). Razorpay notes carry `items` and
  `worksheets`; Stripe metadata `worksheet` is empty for several sheets. Verification, webhooks,
  `private.fulfil_order` (one access record per sheet), refunds (every record of the order ends),
  receipts (`GET /api/me/orders` `lines`, the Purchase Successful email, staff order views) all work
  per line. When an order is fulfilled its sheets leave that customer's cart in the same transaction
  (`services/fulfil.ts afterPaid`).
- **Small additions:** `GET /api/admin/payments` rows carry `orderTotalInr`;
  `GET /api/admin/security-events` rows carry `byEmail` (the email of `detail.by`).

## 5. Business rules in one place

- **Worksheet access length:** `products.access_days ?? settings.worksheet_access.days` (365 by
  default, staff can change it). Class plans last their months and start when running plans of the
  same class end.
- **Free sheets:** 8 products at price 0 (`az-A`, `az-B`, `vc-1..3`, `vs-1..3`). A free pass never
  expires but lapses when the price becomes > 0. A free sheet always opens on the customer's free
  pass, also for a class-plan holder, so it keeps opening when the plan ends or paid access is paused.
- **Expired access:** hidden from the active list, kept in history and in admin, the site offers
  "Buy Access Again" (a new order, new entitlement). Expiry is checked on every viewer request.
- **Prints come from the account type:** Parent 3, Teacher 30, Organization 300 per sheet and access
  record (`settings.prints`), unless the sheet's print rule is `sheet` (its own `print_limit`).
  Downloads stay per sheet (`download_limit`, 0 by default). See §4.H.
- **No counted copies still means bytes:** a sheet with no prints or downloads (print rule `sheet` with
  `print_limit` 0, download limit 0) has no Print or Download button and `/api/view/print|download`
  refuse it, but the viewer still needs
  the stamped PDF from `/api/view/file` to draw it (most sheets have no page pictures for every page).
  Never refuse `/api/view/file` to an allowed viewer because a limit is 0; keep it authenticated,
  stamped with the customer's name and email, rate-limited (60 an hour per account) and logged
  instead. A determined customer can save that copy; the docs say so.
- **Never grant access from:** client totals, client payment claims without server verification,
  staff editing an order to paid. Only `private.fulfil_order` (verified payment) or an explicit
  audited staff grant with an end date.
- **Warnings:** one per confirmed incident; active = not revoked and not expired; 3 active →
  paid access suspended; suspension stays until staff lift it or accept an appeal; lifting with
  `resetWarnings` revokes active warnings (audited); warnings also expire after
  `warningExpiryDays`.

## 6. Test harness (agent H) — the API other agents code against

`tests/api/harness.ts` exports:

```ts
export type Harness = {
  call(method: string, path: string, o?: { token?: string | null; body?: unknown; raw?: Uint8Array;
       headers?: Record<string, string>; ip?: string; device?: string; contentType?: string })
    : Promise<{ status: number; body: any; text: string; bytes: Uint8Array; headers: Headers }>;
  sql: import('postgres').Sql;          // connection as sb_postgres (bypasses RLS) for setup and checks
  mail: { sent: { to: string; subject: string; html: string; text: string; replyTo?: string | null }[];
          failNext(n?: number, permanent?: boolean): void; clear(): void;
          last(to?: string): { to: string; subject: string; html: string; text: string } | undefined };
  fake: { route(method: string, pathPrefix: string, fn: (req: Request, url: URL) => Response | Promise<Response>): void;
          url: string };                // the fake Supabase server (also hosts gateway fakes)
  storage: { put(bucket: string, path: string, bytes: Uint8Array, type: string): Promise<void>;
             has(bucket: string, path: string): boolean };
  customer(o?: { email?: string; name?: string; verified?: boolean; agreement?: boolean; remember?: boolean })
    : Promise<{ id: string; email: string; password: string; token: string; refreshToken: string; sessionId: string }>;
  staff(role: 'owner' | 'admin' | 'support' | 'content' | 'developer', permissions?: string[])
    : Promise<{ id: string; email: string; password: string; token: string; refreshToken: string; sessionId: string }>;
  login(email: string, password: string, o?: { remember?: boolean; staff?: boolean; agreement?: boolean; ip?: string; device?: string })
    : Promise<{ status: number; body: any; token?: string; refreshToken?: string }>;
  setEnv(vars: Record<string, string | undefined>): void;   // merges over the test env, clears caches
  setSetting(key: string, value: unknown): Promise<void>;     // writes settings + clearSettingsCache()
  samplePdf(pages?: number): Promise<Uint8Array>;             // a real small PDF made with pdf-lib
  uploadPdfFor(productId: string, pages?: number): Promise<void>; // puts a PDF at the product's pdf_path
  processOutbox(): Promise<void>;
  close(): Promise<void>;
};
export async function startHarness(): Promise<Harness>;
export function uniqueEmail(tag?: string): string;
/** Deno.test with the op/resource sanitizers off (pools and the fake server stay open). */
export function test(name: string, fn: () => Promise<void>): void;
```

There is no fake clock: move time by updating timestamps with `h.sql` (e.g. set an entitlement's
`expires_at` to the past).

- The fake Supabase server (`tests/api/fakes/supabase.ts`, `Deno.serve` on 127.0.0.1, random port)
  implements the GoTrue routes `lib/gotrue.ts` calls (writing real rows into `auth.users` and
  `auth.sessions` as `sb_fake_services:sb_fake_services`, HS256 JWTs signed with the test
  `LWW_JWT_SECRET`, `iss = <url>/auth/v1`, `aud = authenticated`, claims `sub`, `session_id`,
  `email`, `role`, `exp`; refresh tokens bound to an `auth.sessions` row — deleted session ⇒ refresh
  fails; `email_confirm` respected; unconfirmed password grant ⇒ 400 `email_not_confirmed` after a
  correct password) and the Storage routes `lib/storage.ts` calls (bytes in memory **and** a row in
  `storage.objects` with `metadata.size`, so `private.worksheet_objects` etc. work).
- `customer()` and `staff()` do **not** depend on the route modules: they create the user through the
  fake's admin endpoint (confirmed), mark the profile active/verified with the current agreement
  version via `h.sql`, sign in with the fake's password grant and insert the `app_sessions` row
  directly (same fields `openSession` writes: 30 days when `remember`, else 12 h; `is_staff`;
  device hash of the harness device). `staff()` also inserts `staff_members` (permissions default
  to the role template). `login()` calls the real `/api/auth/login`.
- Each test file calls `startHarness()` once; database = env `LWW_TEST_DB` (default `lww_sb`),
  rebuilt by `tests/local/reset-db.sh` (also honours `LWW_TEST_DB`). **Each builder uses its own
  database** to avoid clashes: `LWW_TEST_DB=lww_t_<letter>` (e.g. `lww_t_a`).
- Requests carry a random `X-Forwarded-For` (10.x.y.z) unless `ip` is given, so per-IP rate limits
  do not leak between tests; `X-Device-Id` random per harness unless `device` is given.
- Run: `tests/run.sh [file-or-dir]` = reset the DB then
  `deno test -A --no-check=remote --config functions/api/deno.json <files>` with
  `DENO_DIR=/var/tmp/sb/deno-cache NO_COLOR=1`. Deno: `/var/tmp/sb/tools/node_modules/.bin/deno`.
  Local Postgres: `postgres://postgres@127.0.0.1:5433` (superuser) and
  `sb_postgres:sb_postgres` (what the API connects as, through `setPoolForTests`).
- Type-check: `cd functions/api && deno check --config deno.json index.ts lib/*.ts services/*.ts routes/*.ts gateways/*.ts`.

## 7. Definition of done for a builder

1. Your files implement every endpoint and stub signature in your section; `deno check` passes for the
   whole function (other stubs may still throw at runtime — that is fine).
2. Your tests run green against your own database with `tests/run.sh tests/api/<yours>.test.ts`
   (if the harness is not there yet when you finish coding, wait by reading other code, then run).
   Cover the security-relevant cases named in your section (cross-user access, permission refusals,
   duplicates, expiry, blocks, email failures where they apply).
3. Final report: endpoints done, deviations from old shapes (and why), new migrations, requests for
   the integrator (exact diffs), known gaps. Be honest about anything untested.
