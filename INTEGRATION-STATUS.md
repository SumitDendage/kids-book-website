# Supabase integration status — 15 October 2026

> Current project update: the user selected `wjqmrcglzqemrvafjeel` on 15 October 2026.
> Development, production and example Vite environment files and the project-scoped
> MCP configuration now use that project. The supplied publishable key was accepted
> by `/auth/v1/settings` (HTTP 200). `/functions/v1/api/health` still returns HTTP 404
> Requested function was not found. Earlier results below describe the previous
> `liaqgyskuhnxmlvmrnrl` project and remain historical evidence, not current key status.
> No database data was moved, no Edge Function was deployed, and MCP OAuth still
> needs authentication. Hosting-provider environment overrides must also be updated
> to this project and the site rebuilt before the deployed website uses it.


This is a partial integration, not a deployed or end-to-end verified backend.
Changes are in `frontend/` on branch `codex/supabase-integration`. This branch is
not a production deployment. No remote tables, accounts, policies, files or secrets were changed.

## Implemented

- Installed and pinned `@supabase/supabase-js` 2.117.3 with its lockfile.
- Added the shared `src/lib/supabase.js` client.
- Set the requested URL and publishable key in local development configuration,
  `.env.example`, and the tracked `.env.production` used by production builds.
- Removed the hardcoded fallback to project `wjqmrcglzqemrvafjeel`. All API calls
  now target the configured project and include the publishable key.
- Connected existing login, logout, forgot-password, reset-password and confirmation
  resend actions to the SDK. SDK storage, refresh and auth events own the session.
  Existing custom tokens are not reused. Existing users must sign in again.
- Added recovery-event handling without signing out the recovery session before
  the password update. Cross-tab account changes update the displayed identity.
- Parent/Teacher/Tutor/School choices persist as Auth user metadata. They are display
  preferences only; database profile rows and authorization are not yet connected.
  Administrative roles cannot be written through this profile adapter.
- Staff use the same SDK session as customers. Every existing staff request still
  requires server authorization. No browser role grants staff access.
- Confirmation resend no longer regenerates a password or claims to do so.
- Preserved styling, page structure and animations. Replaced the misleading optional
  remember checkbox with a note explaining SDK persistent sign-in.
- Added a project-scoped official MCP configuration and a read-only connection check.
- Fixed npm scripts for this Windows folder's ampersand and patched the existing
  `source-map-js` dependency vulnerability.

## Evidence and verification

- Production build: passed.
- Twelve isolated Auth and API adapter tests: passed. These use a mocked SDK and are not live
  authentication, email, database, payment or browser end-to-end tests. API tests
  verify project routing, bearer headers, 401/404 errors and payment-proof forwarding.
- npm audit after the dependency patch: zero reported vulnerabilities.
- Live `GET /auth/v1/settings` with the supplied key: **401 Invalid API key**.
  Supabase's response says the key may contain a typo or belong to another project.
  The same key was already paired with the old project in the repository; this is
  not proof of which project owns it. Its ownership remains unverified.
- Live requests to the target `api` function without the key returned **404
  Requested function was not found**. With the supplied key, the gateway returns
  **401 Invalid API key** first. These are distinct failures.
- Official Supabase MCP database/function tools were not exposed in this session.
  Adding `.mcp.json` does not authenticate or establish that connection by itself.

## Work blocked pending project access

The repository deliberately excludes `/backend`, `/database`, and `/supabase`.
It contains no deployed Edge Function source or SQL migrations. The frontend already
expects an `api` Edge Function for signup, catalogue, configuration, access, payments,
account records, administration, contact and other features. Those existing callers
remain; no fake success responses or replacement schema were invented.

The following remain unimplemented/unverified for the target project:

- Schema inspection, reusing existing tables, generated database APIs, catalogue
  books/worksheets/categories/prices/images, profile rows and database carts.
- RLS and database role restrictions, public image buckets, private paid-file
  storage, ownership/expiry checks and short-lived download URLs.
- Server-generated signup passwords and transactional credential email delivery.
  The signup button still calls the missing server route. Login never generates
  passwords, and confirmation resend uses the SDK without changing passwords.
- Razorpay test order creation, authoritative server prices, signature/webhook
  verification, atomic idempotent purchase grants, refund/revocation behavior.
- Live authentication/recovery emails, role isolation, carts, Storage, paid and
  expired worksheet access, repeated callbacks and webhook replay tests.
- Deployed host environment settings and deployment verification.

## Configuration required to continue

1. Authenticate the official Supabase MCP server for `liaqgyskuhnxmlvmrnrl` and
   expose its database, development, functions and debugging tools. Inspect schema,
   existing functions, policies and buckets before writing changes.
2. Obtain this project's actual publishable key through MCP or Dashboard API keys.
   Replace the rejected value in development and production configuration.
3. Identify the hosting provider. Set both public Vite variables there and rebuild;
   Vite variables are embedded at build time. Remote host overrides can supersede
   `.env.production`. The host itself has not been configured in this session.
4. Supply the excluded backend source if it exists. Otherwise implement the existing
   frontend contracts against the inspected schema using Supabase Edge Functions.
5. Identify the configured email provider and verified sender. Set its credentials,
   Razorpay test key/secret and webhook secret in Supabase server-side secrets only.
   Do not put them in chat or any `VITE_*` variable.
6. Configure Auth Site URL and recovery redirect allowlist for the actual deployment
   and localhost development origin. Confirm email templates and SMTP delivery.
7. Inspect existing RLS and Storage policies, then test with separate customer and
   staff identities before deploying commerce.

## Local checks

Run from `frontend/`:

```sh
npm ci
npm test
npm run build
npm run check:supabase
```

The connection check is expected to fail until the rejected key is replaced. It
prints status/error messages, not credentials, and creates no accounts or payments.

## Repository inspection follow-up

The checkout contains 2,426 tracked files, including the React source, public media
and the legacy static site. Authentication, catalogue, checkout, customer drawers,
worksheet access and staff API call sites were inspected. The existing UI uses
single-item/plan checkout; its Cart label opens owned worksheets, not a persistent
shopping-cart implementation. A database cart still needs implementation after
schema inspection. Remote main matched this checkout before the integration branch
was created. The local `.env` exists and is ignored; only public example/production
configuration is tracked. Late entitlement responses are now ignored after account
switches or logout, and prior customer entitlements clear when identity changes.

## HTTP 404 follow-up

A read-only diagnostic scan found 155 API path references across the current React
source (dynamic values are recorded as prefixes). Exact URLs, source locations and
live HTTP responses are saved in `frontend/route-diagnostics.json`. Run
`node scripts/diagnose-routes.mjs` from `frontend/` to repeat without creating users,
orders, emails or payments.

With the configured publishable key, Auth, Data API and the probed Edge Function
routes all return 401 Invalid API key. Without that rejected key, these GET routes
return 404 Requested function was not found:

- `/functions/v1/api/health`
- `/functions/v1/api/worksheets`
- `/functions/v1/api/config`
- `/functions/v1/api/content`
- `/functions/v1/api/faq`
- `/functions/v1/api/me/orders`
- `/functions/v1/api/me/entitlements`

The frontend `/api` prefix names the missing `api` function; it is not evidence
that `/rest/v1/products` exists or has a compatible response. Table names, columns,
RLS and the reported 105 products cannot be verified while the Data API rejects
the key and official Supabase MCP tools are unavailable. No table or function was
created, no authentication was disabled, and these remote 404s remain unresolved.

Local fixes: developer health checks now use the authenticated API transport rather
than omitting the publishable key; JSON APIs reject HTML/invalid JSON with HTTP 200;
catalogue/order/entitlement reads validate their expected response envelopes;
catalogue data rejects missing IDs or invalid prices instead of silently displaying
an empty or corrupt result. Styling and layouts were not changed.

Individual flow status:

- Products: blocked before database query; reported 105 rows not verified.
- Signup: existing server email workflow requires an undeployed function; no account created.
- Login: uses SDK Auth, not an Edge Function; rejected key prevents a live login test.
- Carts: no persistent cart implementation exists in the inspected UI; schema required.
- Checkout: server quote/order/verification routes are undeployed; no payment attempted.
- Accounts: orders/entitlements routes are missing; response validation tested with mocks.

User-staged deletion of environment templates, VS Code settings, and package edits
were preserved and excluded from the follow-up commit. Deployment must supply the
public Vite variables because the tracked production environment file is staged for
deletion. This is not a claim that the remote deployment has those values.
