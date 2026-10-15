# What is still missing

This is the honest list of what the new Supabase server still needs before real customers can use it.
The steps that fix each item are in [SETUP.md](SETUP.md). Nothing here can be done from the code side,
because each item is one of your accounts, keys or decisions.

## Already done in your Supabase project

- The database: every table, rule, index and safety policy (18 migrations, listed under
  **Database → Migrations**; the newest adds account types, prints per account type and the cart), the price plans, countries, settings, staff roles and the 105 Kindergarten
  sheets (8 free, the rest ₹19). Class 1 to 3 show "Coming soon".
- Two storage areas: **worksheets** (private, for PDFs and page pictures) and **covers** (public, for
  cover pictures uploaded from Admin → Products).
- Nothing that was in the project before was deleted.

## Still missing: things only you can do

| # | What | Where it goes | What happens until then |
|---|---|---|---|
| 1 | The server program `api` is not online yet | double-click `supabase\deploy-server.bat` (SETUP step 1) | the website cannot sign in, sell or open any sheet |
| 2 | Public sign-ups are still on in Supabase | Authentication → Sign In / Providers (step 2) | people could make accounts around the website |
| 3 | `SITE_URL`, `ALLOWED_ORIGINS`, `AUTH_FORWARD_IP` | Edge Functions → Secrets (step 3) | email links point to a test address; any site may call the server |
| 4 | Your owner account | Authentication → Users, then `select private.make_owner('…')` (step 4) | nobody can open /admin or /developer |
| 5 | The hourly tidy-up routine | paste `migrations/20261007125900_housekeeping.sql` in the SQL Editor (step 4.5) | old rate-limit counters and expired links pile up slowly (harmless for weeks) |
| 6 | The 105 worksheet PDFs and their page pictures (226 files, 73.2 MB) | `node supabase\scripts\upload-files.mjs backend\protected` with your `sb_secret_` key (step 5) | every sheet says "Coming soon", including the free ones |
| 7 | An email service: `MAIL_PROVIDER`, `BREVO_API_KEY` (or `RESEND_API_KEY`), `MAIL_FROM` on a domain you verified | Edge Functions → Secrets (step 6) | **sign-up is closed** (the password is sent by email); no receipts, resets, warnings or contact-note emails |
| 8 | Razorpay: `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, and the webhook in Razorpay | Edge Functions → Secrets and the Razorpay dashboard (step 7) | checkout says payments are not set up |
| 9 | Optional: Stripe (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`) and PayPal (`PAYPAL_CLIENT_ID`, `PAYPAL_SECRET`, `PAYPAL_MODE`, `PAYPAL_WEBHOOK_ID`) | Edge Functions → Secrets, webhooks in each dashboard (`supabase/.env.example` has the addresses) | those payment options stay hidden; customers abroad can still use Razorpay if your Razorpay account accepts international cards |
| 10 | "merge 10", then a new build uploaded to Hostinger | chat, then SETUP step 8 | the live site keeps the old version |

No key is needed for the Ask AI assistant: it answers from the FAQ stored in the database.

## Decisions with a safe default (change any time in Admin)

- A bought sheet stays open **365 days** from the verified payment (Admin → Settings, or per sheet).
- **GST 18%** for India, and the other countries' taxes (VAT 20% for the UK and so on) were copied from
  the old server. Please check with an accountant; change them in Admin → Settings.
- Currency prices abroad use fixed exchange rates stored in Settings, not live rates.
- **Prints per sheet come from the account type:** Parent 3, Teacher 30, Organization 300 (a school,
  tuition centre or other group). Each customer chooses their type once; you can change it in
  Admin → Customers. Change the numbers in Admin → Settings, or give one sheet its own number in
  Products (its print rule; 0 there means no printing). Downloads stay off (0 per purchase) until you
  allow some in Products.
- Customers from the old local server are **not** copied over (their passwords could not be moved
  safely); they sign up again.
- The 28 old sample products (Hindi, Art & craft and the old demo sheets) were **not** imported.
- Three confirmed sharing warnings pause paid sheets (sign-in, My Account, orders, free sheets and appeals
  still work). The rules that count as a warning are in Admin → Security → Rules; a new IP address or a
  new device on its own never counts.

## Not tested against the real services yet

These parts were tested many times, but only against faithful stand-ins on this side, because the
real services need your keys:

- Razorpay, Stripe and PayPal payments and their webhooks.
- Sending email through Brevo or Resend.
- Supabase's own sign-in service, and the server program running inside Supabase (step 1 is the first
  real run; the health page shows whether it works).

So please do SETUP step 9 (one test sign-up and one Razorpay **test mode** purchase) before telling
customers about the new site.

## Known limits (by design or for later)

- Nobody can fully stop screenshots, phone photos or copies printed or downloaded when you allow them.
  The viewer shows the customer's name and email across every page and checks access again every
  minute (Admin → Settings).
- A refund of part of an order does not take the sheet away; a full refund does. A full refund of an
  order with several sheets ends every sheet in it.
- Prints are counted when the server hands out a print copy. The server cannot see a printer, so it
  cannot count copies made from one print dialog.
- One order holds up to 50 sheets, and a cart holds up to 50.
- Sharing checks run when someone signs in and when they open a paid sheet.
