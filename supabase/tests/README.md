# API tests

The tests run the `api` Edge Function **in-process** against a local Postgres database, a fake
Supabase Auth/Storage server and a mail capture. Nothing reaches the internet.

## Run

```sh
cd supabase
LWW_TEST_DB=lww_t_a tests/run.sh                          # every tests/api/*.test.ts
LWW_TEST_DB=lww_t_a tests/run.sh tests/api/auth.test.ts   # one file (or a folder)
LWW_TEST_DB=lww_t_a tests/run.sh tests/api/auth.test.ts -- --filter "login"   # extra deno test args
TEST_NO_CHECK=1 tests/run.sh ...                          # skip type checking (another module mid-edit)
```

`run.sh` rebuilds the database (`tests/local/reset-db.sh`: Supabase stand-ins + every migration)
**before each test file** and runs each file in its own `deno test` process, one after another.
Use your own database name (`lww_t_<letter>`); the default is `lww_sb`. It needs the local
Postgres on `127.0.0.1:5433` (`PGHOST`/`PGPORT` override) and Deno at
`/var/tmp/sb/tools/node_modules/.bin/deno` (`DENO` overrides) with `DENO_DIR=/var/tmp/sb/deno-cache`.

Type-check the function: `cd functions/api && deno check --config deno.json index.ts lib/*.ts services/*.ts routes/*.ts gateways/*.ts`.

## Writing a test file

```ts
import { assert, assertEquals, assertStatus, startHarness, test, uniqueEmail } from './harness.ts';

const h = await startHarness();          // once per file

test('a customer sees only their own orders', async () => {
  const c = await h.customer();          // verified, agreement accepted, signed in (12 h session)
  const r = await h.call('GET', '/api/me/orders', { token: c.token });
  assertStatus(r, 200);                  // prints the response body when it fails
  assertEquals(r.body.orders.length, 0);
});
```

- `test(name, fn)` is `Deno.test` with the sanitizers off (pools and the fake server stay open).
  Deno names `harness.ts` as the location of a failed test; the stack trace shows your line.
- There is no `@std/assert` in the offline cache. Use the helpers exported by `harness.ts`
  (`assert`, `assertEquals` (deep), `assertNotEquals`, `assertMatch`, `assertStatus`,
  `assertRejects`) or `node:assert`.
- Each file starts from a fresh database, but tests **inside** a file share it: use
  `uniqueEmail()` and new users per test, and do not assume empty tables.
- There is no fake clock: move time with SQL, for example

  ```ts
  await h.sql`update entitlements set expires_at = now() - interval '1 minute' where id = ${id}`;
  ```

## Harness API (`tests/api/harness.ts`, DESIGN.md §6)

| Member | What it does |
|---|---|
| `h.call(method, path, { token, body, raw, headers, ip, device, contentType })` | Builds a request to `http://api.local/functions/v1/api/...` and runs `handle(req, { awaitBackground: true })`, so emails and other `ctx.later` work have finished when it returns. `path` may be `/api/x`, `x`, `/functions/v1/api/x` or a full URL. Returns `{ status, body, text, bytes, headers }`; `body` is parsed JSON (text for `text/*`, otherwise `null`). Every call gets a random `X-Forwarded-For` (10.x.y.z) unless `ip` is given, and the harness's `X-Device-Id` unless `device` is given. |
| `h.sql` | postgres.js connection as `sb_postgres` (bypasses RLS) for setup and checks. bigint comes back as a number, like the API. |
| `h.customer({ email, name, verified, agreement, remember, ip, device })` | Creates the user in the fake Auth (admin endpoint), marks the profile active/verified with the current agreement version, signs in with the fake password grant and inserts the `app_sessions` row as `openSession` would (12 h, or 30 days with `remember`). `verified: false` leaves the profile unverified (the session is opened directly in the fake so you can test `email_unverified`). Returns `{ id, email, password, token, refreshToken, sessionId, name }`. |
| `h.staff(role, permissions?, { email, name, remember })` | `customer()` plus a `staff_members` row (`permissions` default to the role template) and `is_staff` on the session. Roles: owner, admin, support, content, developer. |
| `h.login(email, password, { remember, staff, agreement, ip, device })` | Calls the real `POST /api/auth/login`; returns `{ status, body, text, token, refreshToken }`. |
| `h.mail` | `sent[]`, `failed[]`, `last(to?)`, `to(address)`, `link(to, param?)`, `linkParam(to, 'verify')`, `failNext(n = 1, permanent = false)`, `clear()`. `off()` detaches the test transport so `lib/mail.ts` uses its real Brevo/Resend HTTP code against the fake (mail still lands in `sent`); `on()` re-attaches it. |
| `h.processOutbox()` | Runs `processOutbox` until nothing is due; returns `{ sent, failed }`. Implicit outbox sweeps are disabled during `h.call`. |
| `h.storage.put/has/get(bucket, path, ...)` | Objects in the fake Storage (bytes in memory + a `storage.objects` row with `metadata.size`, so `private.worksheet_objects()` and `private.product_file_status()` see them). |
| `h.samplePdf(pages)` / `h.uploadPdfFor(productId, pages)` | A real PDF made with pdf-lib / that PDF stored at the product's `pdf_path` (sets `uploads/<id>.pdf` if it has none). |
| `h.grant(userId, { productId \| classId, days = 30, startsInDays })` | Inserts a `grant` entitlement directly (no order): live by default, `days: -1` = already expired, `startsInDays` = scheduled. Returns its id. |
| `h.setEnv(vars)` / `h.resetEnv()` / `h.env()` | Change env names for the API (`undefined` removes one); caches (env, auth, settings) are cleared. Reset in a `finally`. |
| `h.setSetting(key, value)` | Upserts a `settings` row and clears the settings cache. |
| `h.fake.url`, `h.fake.route(method, prefix, fn)` | The fake server. `route` adds an endpoint (longest prefix wins, newest on a tie, `'*'` = any method) and returns a function that removes it. Use it for gateway fakes (point `RAZORPAY_API_BASE` etc. at `h.fake.url` with `h.setEnv`) or to override a built-in route, e.g. make `/auth/v1/token` return 502 to test `auth_unavailable`. |
| `h.fake.calls(prefix, method?)`, `h.fake.requests` | What the fake received (e.g. to check a GoTrue call was or was not made). |
| `h.fake.auth.mintAccessToken({ userId, sessionId, expiresIn, secret })` | A signed (or wrongly signed / expired) access token. `issueSession(userId)`, `setAccessTtl(s)`, `clearRefreshTokens()` also exist. |
| `h.device`, `h.userAgent`, `h.deviceHash(device?)` | The harness device id / UA and the hash the API stores for a device. |
| `uniqueEmail(tag)`, `testPassword()`, `randomIp()` | Fresh addresses on `test.local`, a password that passes `passwordProblem`, a random 10.x address. |

## The fake Supabase server (`tests/api/fakes/supabase.ts`)

- **Auth (GoTrue):** `POST /auth/v1/admin/users`, `GET/PUT/DELETE /auth/v1/admin/users/:id`
  (`password`, `email_confirm`, `ban_duration` Go-style or `none`, `user_metadata`),
  `POST /auth/v1/token?grant_type=password|refresh_token`, `POST /auth/v1/logout?scope=local|others|global`,
  `GET /auth/v1/user`. Users and sessions are real rows in `auth.users`/`auth.sessions` (written as
  `sb_fake_services`), so the profile trigger and `private.end_auth_sessions()` work. Access tokens
  are HS256 JWTs signed with the test `LWW_JWT_SECRET` (`iss = <url>/auth/v1`, `aud = authenticated`,
  `sub`, `session_id`, `email`, `role`, `exp`), lifetime 3600 s. Refresh tokens rotate and stay
  bound to their `auth.sessions` row: once the row is gone, refresh fails with 400
  `refresh_token_not_found`. Errors use GoTrue's codes (`invalid_credentials`,
  `email_not_confirmed`, `user_banned`, `email_exists`, `weak_password`, `user_not_found`,
  `session_not_found`, `bad_jwt`). Admin routes need the test secret key; token/user routes accept
  the publishable or secret key. Passwords are salted SHA-256 (test only).
- **Storage:** `POST/PUT/GET/DELETE /storage/v1/object/:bucket/<path>` (`x-upsert`), `DELETE
  /storage/v1/object/:bucket {prefixes}`, `POST /storage/v1/object/sign/:bucket/<path>` →
  `{ signedURL }` (and `GET` of that link), `GET /storage/v1/object/public/:bucket/<path>` (public
  buckets only). Bucket size limits and MIME types from `storage.buckets` are enforced. All but the
  public/signed GETs need the test secret key.
- **Mail:** `POST /v3/smtp/email` (Brevo) and `POST /emails` (Resend) feed the same capture.
- Anything else answers 404 JSON.

Limits: objects live in memory for one test process (the fake clears `storage.objects` when it
starts, so rows and bytes always agree); rows inserted into `storage.objects` by hand have no
bytes. The fake does not model GoTrue rate limits, MFA, email change confirmation or
refresh-token family revocation beyond a 10 s reuse window.
