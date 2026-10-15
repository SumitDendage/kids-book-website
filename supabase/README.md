# Learn With Why: the Supabase backend

Everything the website needs on the server side, for the Supabase project **"SumitDendage's Project"**
(`liaqgyskuhnxmlvmrnrl`, Mumbai region): Supabase Auth for passwords, PostgreSQL with row-level security,
private storage for the worksheet PDFs, and one Edge Function, `api`, that serves every `/api/*` route the
website calls.

**Owner: start with [docs/SETUP.md](docs/SETUP.md)**, then read [docs/MISSING-CONFIG.md](docs/MISSING-CONFIG.md)
for what is still missing. This folder is kept off GitHub on purpose (like `backend/` and `database/`); it
reaches you as `supabase-backend.zip`.

## What is in this folder

| Path | What |
|---|---|
| `migrations/` | The database, one file per step, in the order they were applied to the live project. |
| `functions/api/` | The server program (Deno, TypeScript). `index.ts` starts it; `routes/` has one file per area; `services/` the business rules; `gateways/` Razorpay, Stripe and PayPal; `lib/` sign-in checks, database, email, settings. |
| `scripts/upload-files.mjs` | Uploads the worksheet PDFs and page pictures to the private **worksheets** store. |
| `scripts/build_seed_sql.py` | How the sheet list in `migrations/*_catalogue_data.sql` was built from the website's catalogue. |
| `tests/` | The API tests (in-process, with fakes for Auth, Storage, the gateways and email), the database checks in `tests/sql/`, the local dev server and the browser tests in `tests/e2e/`. See [tests/README.md](tests/README.md). |
| `deploy-server.bat` | Puts `api` online from a Windows PC (Supabase CLI, no Docker needed). |
| `config.toml` | Only what the deploy needs: the project id and `verify_jwt = false` for `api` (the API checks every token itself). |
| `.env.example` | Every secret the server reads, with no values. Real values go only in **Edge Functions → Secrets**. |
| `docs/DESIGN.md` | The build contract: auth model, every endpoint, business rules. |
| `docs/SECURITY.md` | The security and account-sharing policy in plain words. |

## How the pieces fit

- The website (Hostinger, plain files) calls `https://liaqgyskuhnxmlvmrnrl.supabase.co/functions/v1/api/...`
  with a bearer token. Its central adapter is `frontend/src/services/api.js`.
- Passwords live only in Supabase Auth. Sign-up generates the password on the server and emails it;
  nothing logs or stores it. Each sign-in also gets an `app_sessions` row, so staff can end or block one
  session without touching the others.
- The API talks to Postgres as the role `lww_api`, which has only the grants it needs. Customers and
  the browser never get direct table access: row-level security is on for every table and most tables
  have no policy at all, which means "no access" for the public keys.
- Access to a sheet is an `entitlements` row created only by `private.fulfil_order` after a payment was
  verified with the gateway (or by an audited staff grant with an end date). Every viewer request checks
  it again, with the session, the account and any suspension.
- Emails go through an outbox table with retries; emails holding a password or a one-time link are sent
  at once and their text is never stored.

## Working on it locally

You need Postgres 16 or newer and Deno 2.

```sh
cd supabase
LWW_TEST_DB=lww_dev tests/local/reset-db.sh                  # fresh local database with every migration
LWW_TEST_DB=lww_dev deno run -A --config functions/api/deno.json tests/dev-server.ts \
    --port 54321 --origin http://127.0.0.1:5173 --files ../backend/protected
# then, in frontend/: VITE_API_BASE_URL=http://127.0.0.1:54321/functions/v1 npm run dev
```

The dev server prints the seeded owner and customer passwords, captures email at `/__dev/mail` and fakes
Razorpay Checkout; nothing reaches the internet.

Checks to run before every deploy:

```sh
cd supabase/functions/api && deno check --config deno.json index.ts lib/*.ts services/*.ts routes/*.ts gateways/*.ts
cd supabase && LWW_TEST_DB=lww_t_a tests/run.sh             # every API test file, each on a fresh database
```

## Changing the database

Every file in `migrations/` is already applied to the live project, and the file names carry the version
numbers recorded there (**Database → Migrations**). Never edit an applied file: add a new one with a later
timestamp. Keep `DELETE` and `DROP` out of new files where you can (the Supabase AI tools ask the owner to
approve them); prefer `create or replace` and `alter ... add`.

The one exception is `20261007125900_housekeeping.sql` (the hourly tidy-up routine). It is not in the live
history because the owner adds it by hand from the SQL Editor (SETUP step 4). It is safe to run again. If
you ever push this folder with `supabase db push`, run it once by hand instead, or record it with
`supabase migration repair --status applied 20261007125900`.

## Deploying the server program

```bat
deploy-server.bat
```

or `npx supabase functions deploy api --project-ref liaqgyskuhnxmlvmrnrl --no-verify-jwt --use-api`.
Check `https://liaqgyskuhnxmlvmrnrl.supabase.co/functions/v1/api/health` afterwards.
