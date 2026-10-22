# Configuration status

What is set up on the live Supabase project and what still needs the owner's accounts or keys.
Steps for each item are in [SETUP.md](SETUP.md). Last reviewed **18 October 2026**.

## Done

- **Database**: every table, rule, index and row-level security policy, applied from
  [`migrations`](../migrations) (including account types and prints, the cart, Sizes sheets, timed
  access in hours, the admin product manager and free sheets without sign-in).
- **Catalogue**: 115 Kindergarten sheets with their PDFs in the private **worksheets** store; 8 free,
  the rest ₹19. Class 1 to 3 show "Coming soon".
- **Server program**: the `api` Edge Function is deployed and answers `/api/health`.
- **Sign-up**: customers choose a password and confirm their email with a 6-digit code (Supabase Auth).
- **Owner account**: the developer owner exists. Every further staff member is added in Admin → Roles.
- **Website**: published automatically to [www.learnwithwhy.com](https://www.learnwithwhy.com) after
  every merge into `main`.

## Still open

| What | Where | Until then |
|---|---|---|
| Razorpay keys: `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, and the webhook | Edge Functions → Secrets and the Razorpay dashboard ([step 7](SETUP.md#7-razorpay)) | checkout shows that payments are not set up |
| Email provider: `MAIL_PROVIDER`, `BREVO_API_KEY` (or `RESEND_API_KEY`), `MAIL_FROM` | Edge Functions → Secrets ([step 6](SETUP.md#6-email-for-receipts-and-notices-optional)) | no purchase emails, sharing warnings by email or staff alerts |
| Owner account for the admin email | sign up, then `select private.make_owner('…')` ([step 4](SETUP.md#4-owner-account-and-tidy-up)) | only the developer owner can manage staff |
| Optional: Stripe and PayPal keys | Edge Functions → Secrets | those payment options stay hidden |

The Ask AI assistant needs no key: it answers from the FAQ.

## Known limits

- No website can fully stop screenshots or phone photos. The viewer stamps the customer's name and
  email on every page and checks access again every minute.
- A partial refund does not take a sheet away; a full refund does.
- Prints are counted when the server hands out a print copy; it cannot see the printer.
- One order or cart holds up to 50 sheets.
- Sharing checks run at sign-in and when a paid sheet is opened.
