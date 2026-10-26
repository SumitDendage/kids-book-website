# Configuration checklist

Everything the live project needs that cannot live in the code: accounts, keys and settings only the
owner can add. Steps for each item are in [SETUP.md](SETUP.md).

The repository cannot show which of these are set on the live project. To check, open
`https://liaqgyskuhnxmlvmrnrl.supabase.co/functions/v1/api/health` (it shows whether the database,
the payment gateways and email are working, never a key) or the Developer panel, which shows each
secret as set or not set.

## Required

| Item | Where | Without it |
|---|---|---|
| Every file in [`migrations/`](../migrations) applied | Supabase SQL / CLI | API calls fail with database errors |
| `api` Edge Function deployed | GitHub workflow or `deploy-server.bat` ([step 1](SETUP.md#1-database-and-server-program)) | the website cannot sign in, sell or open sheets |
| Auth: sign-ups on, **Confirm email** on, `{{ .Token }}` in the Confirm signup template | Authentication settings ([step 2](SETUP.md#2-authentication-settings)) | customers cannot create or confirm accounts |
| `SITE_URL`, `ALLOWED_ORIGINS`, `AUTH_FORWARD_IP` | Edge Functions → Secrets ([step 3](SETUP.md#3-the-website-address)) | browsers are refused; email links point to the wrong place |
| An owner account (`select private.make_owner('…')`) | SQL Editor ([step 4](SETUP.md#4-owner-account-and-tidy-up)) | nobody can open `/admin` |
| Worksheet PDFs in the private `worksheets` bucket | Admin → Products or `scripts/upload-files.mjs` ([step 5](SETUP.md#5-upload-the-worksheet-pdfs)) | sheets show "Coming soon" |
| `MAIL_PROVIDER`, `BREVO_API_KEY` or `RESEND_API_KEY`, `MAIL_FROM`, `LOGIN_OTP_ENCRYPTION_KEY` | Edge Functions → Secrets ([step 6](SETUP.md#6-email-and-sign-in-codes)) | **sign-in fails** (no code can be sent); no receipts or warning emails |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` and the Razorpay webhook | Secrets and the Razorpay dashboard ([step 7](SETUP.md#7-razorpay)) | checkout says payments are not set up |

## Optional

| Item | Effect |
|---|---|
| `ADMIN_SECURITY_EMAIL` | where new-IP sign-in alerts go |
| The hourly tidy-up (`migrations/20261007125900_housekeeping.sql`) | clears old rate-limit counters, unused quotes and expired links |
| Stripe: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | shows card payments through Stripe outside India |
| PayPal: `PAYPAL_CLIENT_ID`, `PAYPAL_SECRET`, `PAYPAL_MODE`, `PAYPAL_WEBHOOK_ID` | shows PayPal outside India |
| `SUPABASE_ACCESS_TOKEN` repository secret | lets the **Deploy server to Supabase** workflow run |

The help chat needs no key: it answers from the FAQ in the database.

## Defaults worth reviewing

All of these can be changed in **Admin → Settings** or per sheet in **Admin → Products**:

- A bought sheet stays open for **1 hour** after the verified payment.
- Prints per sheet: **Parent 2, Teacher 3, Organization 300**. Downloads are off unless allowed per sheet.
- **₹19** per sheet; 27 sheets are free.
- **18% GST** for India and stored tax rates for other countries. Check these with an accountant.
- Prices abroad use fixed exchange rates stored in Settings, not live rates.
- **Three** active sharing warnings pause paid access.

## Not tested against live services

The API tests use stand-ins for Razorpay, Stripe, PayPal, Brevo, Resend and Supabase Auth and
Storage. Before relying on a new key, make one test sign-up and one Razorpay test-mode purchase
([step 9](SETUP.md#9-test-everything-once)).

## Known limits

- No website can stop screenshots or phone photos. The viewer stamps the customer's email on every
  page and checks access again every minute.
- A partial refund does not take a sheet away; a full refund does.
- Prints are counted when the server hands out a print copy; it cannot see the printer.
- One order or cart holds up to 50 sheets.
- Sharing checks run at sign-in and when a paid sheet is opened.
