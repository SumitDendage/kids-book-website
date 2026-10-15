# Learn With Why on Supabase: setup steps for the owner

Your website now has a real server on Supabase, in your own project **"SumitDendage's Project"**
(address `https://liaqgyskuhnxmlvmrnrl.supabase.co`). The database, its safety rules and the list of
105 sheets are already in that project. Nothing that was there before was deleted. The server program
(called `api`) is ready in the `supabase` folder; step 1 puts it online with one double-click (it is too
big for the tools I can use to upload it myself).

What is left needs **you**, because it involves your own accounts and keys. Do the steps in order.
Keys and passwords go **only** into the Supabase dashboard or your own Command Prompt window, never into
the website, an email or a chat.

| Step | What | Time | Without it |
|---|---|---|---|
| 1 | Put the server program online and check it answers | 5 min | the website cannot sign anyone in or sell anything |
| 2 | Turn off public sign-ups in Supabase | 1 min | someone could create accounts behind the website's back |
| 3 | Add the website address | 3 min | links in emails and payment returns point to a test address and do not work; any site could call the server |
| 4 | Create your owner account | 5 min | nobody can open /admin |
| 5 | Upload the worksheet PDFs | 10 min | every sheet shows "Coming soon" |
| 6 | Set up email (Brevo) | 20 min | **nobody can sign up** (the password is sent by email), no receipts, no warnings |
| 7 | Set up Razorpay | 15 min | checkout says payments are not set up |
| 8 | Put the new website online | 10 min | the live site keeps the old version |
| 9 | Try everything once | 10 min | — |

---

## 1. Put the server program online and check it answers

1. Unzip `supabase-backend.zip` into your project folder, so that you have
   `C:\Users\Sumit\Documents\kids-book-website\supabase` (next to `frontend`).
2. Double-click `supabase\deploy-server.bat`. The first time, a browser window asks you to sign in to
   Supabase and allow the "Supabase CLI": say yes. The window then uploads the program and ends with
   `Done.` (If Windows asks whether to run the file, choose **More info → Run anyway**.)
3. Open this address in your browser:

   `https://liaqgyskuhnxmlvmrnrl.supabase.co/functions/v1/api/health`

   You should see a short line starting with `{"ok":true`. It also says what is not set up yet, for
   example `"mail":"none"` until step 6 and `"razorpay":false` until step 7. It never shows a key.

Run `deploy-server.bat` again whenever you get a newer `supabase` folder from me.

## 2. Turn off public sign-ups in Supabase

1. Go to [supabase.com/dashboard](https://supabase.com/dashboard) and open **SumitDendage's Project**.
2. Left menu: **Authentication** → **Sign In / Providers**.
3. Turn **Allow new users to sign up** **off**, then **Save**.

Customers can still sign up on your website: the server creates their account (with the sharing rules
they accepted and a password it makes for them). This switch only stops people from creating accounts
directly with Supabase, around your website.

## 3. Add the website address

Left menu: **Edge Functions** → **Secrets** (sometimes under *Manage secrets*) → **Add new secret**.
Add these three, one at a time (name on the left, value on the right):

| Name | Value |
|---|---|
| `SITE_URL` | `https://learnwithwhy.in` |
| `ALLOWED_ORIGINS` | `https://learnwithwhy.in,https://www.learnwithwhy.in` |
| `AUTH_FORWARD_IP` | `true` |

`SITE_URL` is where links in emails (and the way back from Stripe or PayPal) point. `ALLOWED_ORIGINS`
means only your website may call the server from a browser. `AUTH_FORWARD_IP` lets Supabase count
sign-in attempts per visitor instead of treating every visitor as one. If your website lives at a
different address than `learnwithwhy.in`, put that address in `SITE_URL` and `ALLOWED_ORIGINS` instead.
To also try the website on your own computer with `npm run dev`, add `,http://localhost:5173` at the end
of `ALLOWED_ORIGINS`.

## 4. Create your owner account

1. Left menu: **Authentication** → **Users** → **Add user** → **Create new user**.
2. Type your email and a strong password (12 or more characters). Tick **Auto Confirm User**.
   Press **Create user**.
3. Left menu: **SQL Editor** → **New query**. Paste this line, with your email:

   ```sql
   select private.make_owner('your-email@example.com');
   ```

4. Press **Run**. It answers `owner: your-email@example.com`.
5. Still in the SQL Editor: **New query**, then open `supabase\migrations\20261007125900_housekeeping.sql`
   in Notepad, copy everything, paste it and press **Run**. This adds the hourly tidy-up (it clears
   old rate-limit counters, unused price quotes and expired sign-in links that the server made). If
   Supabase warns that the query can delete rows, press **Run this query**: adding it deletes nothing.

After step 8 you sign in at `https://learnwithwhy.in/admin` with that email and password. Add other
staff from **Admin → Roles**: the server emails each of them a password (after step 6). Only an owner
can create other owners or admins.

## 5. Upload the worksheet PDFs

The 105 sheets are listed in the database, but each one stays "Coming soon" until its PDF is in the
private store called **worksheets**. Customers can never download from that store directly; the server
checks every request.

You need the files in `backend\protected` on your computer (from the backend zip) and Node (you already
have it for the website).

1. In Supabase: **Project Settings** (gear, bottom left) → **API Keys** → **Secret keys**. Copy the
   key named `default` (create one with **Add new secret key** if there is none). It starts with
   `sb_secret_`. **It opens everything in your project**: paste it only in the window below.
2. Open **Command Prompt** and go to your project folder, for example:

   ```bat
   cd C:\Users\Sumit\Documents\kids-book-website
   set SUPABASE_URL=https://liaqgyskuhnxmlvmrnrl.supabase.co
   set SUPABASE_SECRET_KEY=paste-the-sb_secret-key-here
   node supabase\scripts\upload-files.mjs backend\protected
   ```

   (In PowerShell use `$env:SUPABASE_URL="..."` and `$env:SUPABASE_SECRET_KEY="..."` instead of `set`.)
3. It prints `226 files, 73.2 MB` and counts up to `All files uploaded.` If some fail, run the same
   command again: it only replaces files, it never deletes anything.
4. Close the Command Prompt window (this forgets the key).

To check: **Storage** → **worksheets** shows folders such as `a-to-z`, `vocab-colours` and
`vocab-shapes`. New sheets you add later are uploaded from **Admin → Products** instead.

## 6. Set up email (Brevo)

The server sends: the welcome email with the customer's password and the verify link, password reset
links, "Purchase Successful" receipts with the expiry date, sharing warnings 1/3, 2/3 and 3/3, staff
alerts, and your contact-form notes to **learnwithwhy6@gmail.com**. Until email is set up, **sign-up
is closed** (the website says email is not ready), because a new customer could not get a password.

1. Make a free account at [brevo.com](https://www.brevo.com).
2. **Senders, Domains & Dedicated IPs** → **Domains** → add `learnwithwhy.in`. Brevo shows a few DNS
   records; add them in Hostinger (**Domains → DNS / Nameservers → DNS records**) and press
   **Verify** in Brevo. (A Gmail address as the sender usually lands in spam, so use your domain.)
3. **Senders** → add `hello@learnwithwhy.in` (or another address on your domain).
4. **SMTP & API** → **API Keys** → **Generate a new API key**. Copy it.
5. In Supabase, **Edge Functions → Secrets**, add:

| Name | Value |
|---|---|
| `MAIL_PROVIDER` | `brevo` |
| `BREVO_API_KEY` | the key from Brevo |
| `MAIL_FROM` | `Learn With Why <hello@learnwithwhy.in>` |

The health page from step 1 then shows `"mail":"brevo"`. Emails that could not be sent are retried and
listed in **Developer → Emails**.

## 7. Set up Razorpay

1. In the Razorpay dashboard: **Account & Settings → API Keys**. Start in **Test mode**: generate a key
   pair and copy the Key Id and Key Secret.
2. **Account & Settings → Webhooks → Add New Webhook**:
   - URL: `https://liaqgyskuhnxmlvmrnrl.supabase.co/functions/v1/api/pay/webhook`
   - Secret: make up a long random text (write it down for the next step)
   - Events: `payment.captured`, `order.paid`, `payment.failed`, `refund.processed`
3. In Supabase, **Edge Functions → Secrets**, add `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` and
   `RAZORPAY_WEBHOOK_SECRET` (the text you made up).

When test payments work, repeat 1 to 3 with the **Live mode** keys and a live webhook. Stripe and
PayPal (for customers outside India) are optional; their names and webhook addresses are in
`supabase/.env.example`.

## 8. Put the new website online

After you say **merge 10** in the chat (that saves the new website on GitHub):

```bat
cd C:\Users\Sumit\Documents\kids-book-website
git pull
cd frontend
npm install
npm run build
```

Then upload **everything inside `frontend\dist`** (including the hidden `.htaccess`) to Hostinger
`public_html`, as before. The website now talks to Supabase by itself, so plain Hostinger hosting is
enough: you do not need Node hosting or a VPS any more. The old `backend` folder is no longer used;
keep it as a backup.

## 9. Try everything once

1. Open the site in a private window. Sign up with a second email address of yours, tick the sharing
   rules, read the welcome email, press its button, and sign in with the password from the email.
2. Open a free sheet (Alphabet A): the viewer shows your name and email across the page.
3. Buy a sheet in Razorpay **test mode** (Razorpay's test card numbers are on its website). You see
   **Purchase Successful** with the sheet name and the date it stays open until, and the same in the
   email. It is in **My Account → My Worksheets**.
4. At `/admin`: the order is in **Orders**, the customer in **Customers**, and both actions in
   **Audit logs**.

## Things only you can decide (they have safe defaults now)

- **How long a bought sheet stays open:** 365 days from payment. Change it in **Admin → Settings**
  (or per sheet in **Products**). Class plans last their 1, 3, 6 or 12 months.
- **GST:** checkout adds 18% GST for India, as the old server did. Ask your accountant whether you must
  charge it; change it in **Admin → Settings**.
- **Free sheets:** Alphabet A and B, Colours 1 to 3 and Shapes 1 to 3 (8 sheets), as you asked on
  7 October.
- **Printing:** each sheet a customer can open comes with prints of its own, set by their account type:
  **Parent 3, Teacher 30, Organization 300** (a school, tuition centre or other group). Customers choose
  their type once after signing up; you can change it in **Admin → Customers**. Change the three numbers
  in **Admin → Settings**, or give one sheet its own number in **Products** (its print rule; 0 there
  means that sheet is not printed).
- **Downloading:** off for every sheet (0 downloads). You can allow a number of downloads per purchase
  in **Products**.
- **The cart:** signed-in customers keep a cart on the server (up to 50 sheets) and pay for it as one
  order with one receipt. Each sheet in it opens for its own access days from the verified payment.
- **Old accounts:** customers who signed up on the old local server sign up again (their passwords were
  never copied, on purpose).

## If something goes wrong

- **The website says email is not ready:** step 6.
- **Checkout says payments are not set up:** step 7.
- **"Cross-site request refused":** the website address is missing from `ALLOWED_ORIGINS` (step 3).
- **Anything else:** Supabase → **Edge Functions → api → Logs** shows what the server did; the
  **Developer** panel on your site shows payments, webhooks, sign-ins and emails.
