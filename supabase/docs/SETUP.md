# Server setup guide

This guide sets up the Learn With Why server on Supabase, from an empty project to a working shop at
[www.learnwithwhy.com](https://www.learnwithwhy.com). Most of it is done once. The live project is
**"SumitDendage's Project"** (Mumbai region, address `https://liaqgyskuhnxmlvmrnrl.supabase.co`).

> **Keys and passwords go only into the Supabase dashboard or your own Command Prompt window**, never
> into the website, this repository, an email or a chat.

What is already done and what is still open is listed in [MISSING-CONFIG.md](MISSING-CONFIG.md).

| Step | What | Without it |
|---|---|---|
| 1 | Apply the database and deploy the server program | the website cannot sign anyone in or sell anything |
| 2 | Authentication settings | customers cannot create accounts or confirm their email |
| 3 | The website address | email links point to the wrong place; other sites could call the server |
| 4 | The owner account and the hourly tidy-up | nobody can open `/admin` |
| 5 | Upload the worksheet PDFs | every sheet shows "Coming soon" |
| 6 | Email and sign-in codes | **nobody can sign in** (the second step emails a code); no purchase emails, warnings or staff alerts |
| 7 | Razorpay | checkout says payments are not set up |
| 8 | The website | it publishes itself after every merge |
| 9 | Test everything once | — |

---

## 1. Database and server program

The database lives in [`supabase/migrations`](../migrations), one file per change, applied in order.
New migrations are applied to the live project before the change that needs them is merged.

To deploy the server program (`api`), either run **Actions → Deploy server to Supabase → Run
workflow** on GitHub (needs the `SUPABASE_ACCESS_TOKEN` repository secret, a Supabase personal access
token), or, on a Windows PC with the repository checked out:

1. Double-click `supabase\deploy-server.bat`. The first time, a browser window asks you to sign in to
   Supabase and allow the Supabase CLI. The window uploads the program and ends with `Done.`
2. Open `https://liaqgyskuhnxmlvmrnrl.supabase.co/functions/v1/api/health`. It answers with a short
   line starting `{"ok":true` and says what is not set up yet (for example `"razorpay":false`). It
   never shows a key.

Deploy again whenever `supabase/functions` changes on `main`.

## 2. Authentication settings

Supabase dashboard → **Authentication**:

1. **Sign In / Providers** → **Allow new users to sign up**: **on**. Customers create their own
   account on the website with an email and a password of their choice.
2. **Sign In / Providers** → **Email** → **Confirm email**: **on**. Supabase then emails a code and
   the account opens only after the customer types it in.
3. **Emails** → **Confirm signup** template: make sure it contains `{{ .Token }}`, so the email shows
   the 6-digit code. For example:

   ```html
   <h2>Welcome to Learn With Why</h2>
   <p>Your code is <b>{{ .Token }}</b>. Type it on the website to open your account.</p>
   ```

4. **URL Configuration** → **Site URL**: `https://www.learnwithwhy.com`, and add
   `https://learnwithwhy.com` and `https://www.learnwithwhy.com` to the redirect URLs (used by
   *Forgot password*).

Supabase's built-in email sender has a low hourly limit. For a busy shop, add your own SMTP sender
under **Authentication → Emails → SMTP Settings**.

## 3. The website address

**Edge Functions → Secrets → Add new secret**:

| Name | Value |
|---|---|
| `SITE_URL` | `https://www.learnwithwhy.com` |
| `ALLOWED_ORIGINS` | `https://learnwithwhy.com,https://www.learnwithwhy.com` |
| `AUTH_FORWARD_IP` | `true` |

`SITE_URL` is where links in emails and payment returns point. `ALLOWED_ORIGINS` lists the only
websites allowed to call the server from a browser; add `,http://localhost:5173` to try the website
locally with `npm run dev`. `AUTH_FORWARD_IP` lets Supabase count sign-in attempts per visitor.

## 4. Owner account and tidy-up

1. Create the account: sign up on the website, use **Create an account** on the `/admin` sign-in
   page, or add it in **Authentication → Users → Add user** (tick **Auto Confirm User**).
2. **SQL Editor → New query**, with that email:

   ```sql
   select private.make_owner('your-email@example.com');
   ```

   It answers `owner: your-email@example.com`.
3. In the SQL Editor, paste the contents of
   [`migrations/20261007125900_housekeeping.sql`](../migrations/20261007125900_housekeeping.sql) and
   press **Run**. It adds the hourly tidy-up of old rate-limit counters, unused price quotes and
   expired links. If Supabase warns that the query can delete rows, confirm: adding it deletes nothing.

Owners add other staff in **Admin → Roles**: the person creates an account on the staff sign-in page,
then an owner gives that email a role. Only an owner can create other owners or administrators.

## 5. Upload the worksheet PDFs

Each sheet stays "Coming soon" until its PDF is in the private **worksheets** store. New sheets are
added in **Admin → Products**, which uploads the PDF for you. To upload a whole folder at once:

1. **Project Settings → API Keys → Secret keys**: copy a key starting with `sb_secret_`. It opens
   everything in the project, so paste it only in the window below.
2. In Command Prompt, in the repository folder:

   ```bat
   set SUPABASE_URL=https://liaqgyskuhnxmlvmrnrl.supabase.co
   set SUPABASE_SECRET_KEY=paste-the-sb_secret-key-here
   node supabase\scripts\upload-files.mjs path\to\protected-folder
   ```

3. It counts up to `All files uploaded.` Running it again only replaces files; it never deletes.
4. Close the window, which forgets the key.

## 6. Email and sign-in codes

Sign-up codes and password reset emails are sent by Supabase Auth (step 2). The server sends its own
emails: the **6-digit sign-in code** (the second step of every sign-in, customers and staff), purchase
receipts, sharing warnings 1/3 to 3/3 and staff alerts. They need an email provider and an encryption
key:

1. Create an account at [brevo.com](https://www.brevo.com) (or Resend).
2. Verify the domain `learnwithwhy.com` (add the DNS records Brevo shows in Hostinger → Domains → DNS)
   and add a sender such as `hello@learnwithwhy.com`.
3. Create an API key and add these secrets:

| Name | Value |
|---|---|
| `MAIL_PROVIDER` | `brevo` (or `resend`) |
| `BREVO_API_KEY` | the key (or `RESEND_API_KEY`) |
| `MAIL_FROM` | `Learn With Why <hello@learnwithwhy.com>` |
| `LOGIN_OTP_ENCRYPTION_KEY` | 32 random bytes in Base64, for example from `openssl rand -base64 32` |
| `ADMIN_SECURITY_EMAIL` | where alerts about sign-ins from a new IP address go |

The health page then shows `"mail":"brevo"`. Failed emails are retried and listed in
**Developer → Emails**.

## 7. Razorpay

1. Razorpay dashboard → **Account & Settings → API Keys**. Start in **Test mode** and generate a key
   pair.
2. **Account & Settings → Webhooks → Add New Webhook**:
   - URL: `https://liaqgyskuhnxmlvmrnrl.supabase.co/functions/v1/api/pay/webhook`
   - Secret: a long random text of your own
   - Events: `payment.captured`, `order.paid`, `payment.failed`, `refund.processed`
3. Add the secrets `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` and `RAZORPAY_WEBHOOK_SECRET`.

When test payments work, repeat with the **Live mode** keys and a live webhook. Stripe and PayPal (for
customers outside India) are optional; their secret names and webhook addresses are in
[`supabase/.env.example`](../.env.example).

## 8. The website

Nothing to do by hand. Every merge into `main` that changes `frontend/` is tested, built and published
to Hostinger automatically (see the main [README](../../README.md#deployment)). Plain Hostinger web
hosting is enough: the website talks to Supabase directly from the visitor's browser.

## 9. Test everything once

1. In a private browser window, sign up with a second email address, tick the sharing rules, type the
   6-digit code from the email and choose an account type. Then sign in: after the password, type the code from the second email.
2. Open a free sheet (Alphabet A), with and without signing in: the viewer shows the watermark.
3. Buy a sheet with Razorpay **test mode**. You see **Purchase Successful**, the sheet appears in
   **My Account → My Worksheets** with its countdown.
4. At `/admin`: the order is in **Orders**, the customer in **Customers**, and both actions in
   **Audit logs**.

## Defaults you can change

All of these are in **Admin → Settings** (or per sheet in **Admin → Products**):

- **Access time for a bought sheet:** 1 hour from the verified payment. Class plans last their
  1, 3, 6 or 12 months.
- **Prints per sheet by account type:** Parent 2, Teacher 3, Organization 300. Downloads are off
  unless allowed for a sheet.
- **Price:** ₹19 per sheet. **Free sheets:** a few in every section (27 in all), set per sheet in
  Admin → Products.
- **Tax:** 18% GST for India and the stored rates for other countries. Check these with an
  accountant.
- **Account sharing:** three confirmed warnings pause paid sheets.
