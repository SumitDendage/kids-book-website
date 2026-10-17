<div align="center">

# Learn With Why

**Printable worksheets and activity sheets for Kindergarten to Class 3 — sold per PDF, opened in a protected, watermarked viewer, wrapped in a cinematic scroll-driven website.**

[Quick start](#quick-start) · [Moving to the new folders](#moving-to-the-new-folders-october-2026) · [Put it on Hostinger](#put-it-on-hostinger) · [Features](#features) · [Structure](#repository-structure) · [Staff panels](#staff-panels) · [Go live](#going-live) · [Roadmap](#roadmap)

![Site version](https://img.shields.io/badge/version-2026.09.17-f0b455) ![Front end](https://img.shields.io/badge/front%20end-React%2019%20%2B%20Vite%208-61dafb) ![Backend](https://img.shields.io/badge/backend-Supabase%20Edge%20Functions%20%2B%20Postgres-1f6b47) ![Payments](https://img.shields.io/badge/payments-Razorpay-3395ff) ![License](https://img.shields.io/badge/license-proprietary-555)

</div>

---

## Overview

Learn With Why is a storefront for a small studio in Pune that draws calm, ink-light learning sheets for Kindergarten to Class 3. A customer scrolls through six chapters of a floating-island landscape (960 frames scrubbed by the scroll), meets the fox and the rabbit in the Sheets chapter, tries the **free sheets**, and **buys the rest one PDF at a time** (or a whole class with a plan) to open them in the protected viewer.

The website talks straight from the visitor's browser to a server on **Supabase**, in the project "SumitDendage's Project". One Edge Function called `api` answers every `/api/*` call at `https://liaqgyskuhnxmlvmrnrl.supabase.co/functions/v1`. **Supabase Auth** keeps the passwords, a **Postgres database with row-level security** holds the accounts, sheets, orders and access, and a **private storage area called "worksheets"** holds the PDFs. Payments go through **Razorpay**, and email through Brevo (or Resend). The browser sends the customer's sign-in token with each call, so the website needs no server of its own: a plain Hostinger upload is enough. **The server code is kept off GitHub on purpose**: it lives in the `supabase` folder next to `frontend` on your computer and reaches you as `supabase-backend.zip` (see [What is where](#what-is-where)). How it works is in `supabase/README.md`; how to set it up, once, is in `supabase/docs/SETUP.md`.

### What is where

| Folder | On GitHub? | What it is |
|---|---|---|
| **`frontend/`** | yes | **The website, built with React and Vite** (was `react-app/`): the customer site, the staff panels (`/admin`, `/developer`) and the protected viewer (`viewer.html`). This is the part you build and upload. It talks to the Supabase server by itself. |
| **`supabase/`** | **no**: your computer only | **The server.** The Edge Function `api` (`functions/api/`), the database steps (`migrations/`), the PDF upload script, the tests, `deploy-server.bat` and your guides in `docs/` (start with `docs/SETUP.md`). It reaches you as `supabase-backend.zip`. |
| `legacy/old-static-site/` | yes | The original plain-HTML website (was `site/dist/`), kept for reference only. |
| `backend/` | **no**: your computer only | **Old, no longer used. Kept as a backup only.** The old Node server (was `site/`). Its `backend\protected` folder still holds the worksheet PDFs, which SETUP step 5 uploads to Supabase. |
| `database/` | **no**: your computer only | **Old, no longer used. Kept as a backup only.** The old server's databases: the SQLite shop database in `database\data` (your old orders) and the PostgreSQL schema. |

`supabase/`, `backend/` and `database/` are listed in `.gitignore`, so git never uploads them and `git pull` never changes them. A fresh copy of `supabase/` comes from **`supabase-backend.zip`** (kept in the Claude project's files): unzip it into the `kids-book-website` folder so that the `supabase` folder sits next to `frontend` (see supabase/docs/SETUP.md step 1). The old `backend` and `database` folders came from **`backend-and-database.zip`**. Older commits in the repository's history (and older branches) still hold old copies of `backend` and `database`, so GitHub is neither a backup of them nor a place they have been erased from. Keep both zips safe. Your shop's accounts, orders and access now live in your Supabase project.

The old plain-HTML copy is no longer used: the live site is the React website built in `frontend/dist`. More about the old copy: [`legacy/README.md`](legacy/README.md).

## How a sheet is opened

```
Learn With Why website (Hostinger) → worksheet catalogue from the server → customer picks a sheet → sign in
        FREE ─────────────────────────── PAID → Razorpay Checkout → the server verifies the payment → access with an end date
          └──────────────── server access check on every request (the Edge Function api) ────────────────┘
                     → private Supabase storage ("worksheets") → PDF stamped with name · email → the viewer (viewer.html)
                     → the viewer asks again every minute; when the access ends, the sheet closes
```

Access is decided on the server, never in the browser. A paid sheet opens only after the server has checked the payment with Razorpay (the signature, the order, the amount and the currency). Then it saves the access with an end date. A bought sheet stays open for its access days: 365 by default, counted from the verified payment. Staff can change the number for one sheet (Admin → Products) or for the whole shop (Admin → Settings). A class plan runs for its 1, 3, 6 or 12 months; a renewal bought while it runs starts the day it ends. The 8 free sheets open for anyone who is signed in. When access ends, the sheet moves to **Expired** in My Account → My Worksheets, with a **Buy Access Again** button.

The PDFs live in a private storage area on Supabase. Nobody can download from it directly: the server checks the customer's sign-in, account and access on every request, then stamps the customer's name and email into the PDF before it sends it. The open viewer asks the server again every minute and closes the sheet when the access has ended, staff have taken it away, or paid access is paused. Three confirmed account-sharing warnings pause a customer's paid sheets (free sheets and My Account keep working).

## Quick start

You need **Git** (https://git-scm.com/download/win) and **Node.js 22.12 or newer** (https://nodejs.org; 20.19 also works). If your `kids-book-website` folder still has `site` and `react-app` folders in it, do not run `git pull` there: do [Moving to the new folders](#moving-to-the-new-folders-october-2026) first. On Windows, open the `kids-book-website` folder in File Explorer, click the address bar, type `cmd` and press Enter; a command window opens in that folder. Use this Command Prompt (cmd), not PowerShell or VS Code's terminal: the commands here do not work there.

**1. Build the website**

```bat
git pull
cd frontend
npm install
npm run build
```

This makes the `frontend\dist` folder, which you upload to Hostinger ([Put it on Hostinger](#put-it-on-hostinger)). Run `npm run build` again after every change to the website.

**2. Try it on your computer (optional)**

In the same window (you are already in `frontend`), type:

```bat
npm run dev
```

Then open http://localhost:5173. Your changes to the website show up straight away, without building. To stop it, press Ctrl+C in the window.

While you try it this way, the website talks to the **live** Supabase API, so it uses your real shop: real accounts, real orders and real emails. For that to work, the server must accept calls from http://localhost:5173. In Supabase → Edge Functions → Secrets, change `ALLOWED_ORIGINS` so it also lists that address, for example `https://learnwithwhy.in,https://www.learnwithwhy.in,http://localhost:5173` (see supabase/docs/SETUP.md step 3). Without it the pages still open, but sign-in, the shop and the viewer cannot reach the server. Links in emails still open the live site (`SITE_URL`). When you are done trying, you can take `,http://localhost:5173` out again.

**3. The server (once)**

There is nothing to start on your computer any more: the server runs on Supabase all the time. You set it up once with `supabase/docs/SETUP.md`, which comes in `supabase-backend.zip` (unzip it so the `supabase` folder sits next to `frontend`). It has 9 short steps: put the server program online, turn off public sign-ups, add the website address, create your owner account, upload the PDFs, set up email, set up Razorpay, put the website online, and try everything once.

Addresses of the website (http://localhost:5173 while `npm run dev` runs, or your domain after uploading):

| Address | What it is |
|---|---|
| `/` | The customer site (Home · About us · What we do · Sheets · Contact us · Testimonials) |
| `/#sheets` | Jumps to the Sheets chapter (every chapter has an anchor) |
| `/admin` | Staff sign-in, then the admin dashboard (old `/#admin` links still work). There is no sign-up here: the owner adds staff in Admin → Roles. |
| `/developer` | Staff sign-in, then the developer dashboard, for staff with the developer permission (old `/#developer` links still work) |
| `/viewer.html` | The protected PDF viewer, reached from the site with a view token (`/viewer` works too) |
| `https://liaqgyskuhnxmlvmrnrl.supabase.co/functions/v1/api/...` | The JSON API: the Supabase Edge Function `api`. Open `.../api/health` to see whether it is running (it never shows a key). |

## Moving to the new folders (October 2026)

**Note:** after the move to Supabase, the `backend` folder is only a backup, so you do not need to start it (`npm start` in step 7 and in the daily routine at the end). These steps are kept for moving an old `site` / `react-app` folder.

Do this once, after this change is on GitHub's main branch. It leaves your current folder untouched as a backup, makes a fresh copy of the website from GitHub, and puts the backend and database (which are no longer on GitHub) next to it from the zip. **Do not run `git pull` in your current folder before this.**

Before you start, download **`backend-and-database.zip`** from the Claude project into your **Downloads** folder.

Use a Command Prompt (cmd) window, not PowerShell: if the line where you type starts with `PS`, type `cmd` and press Enter first. Type or paste the commands **one line at a time** and press Enter after each one; wait for the line ending in `>` to come back before the next one.

**Already typed `git pull` in your current folder?** If it said `Your local changes to the following files would be overwritten by merge: site/.env` and `Aborting`, nothing was changed. If it printed `Fast-forward`, the old server files are gone from that folder, but your orders (`site\data`) and uploaded PDFs (`site\protected\uploads`) are still in it, even though `git status` does not show them. Either way, do **not** run `git commit`, `git stash` or `git reset`: just start at step 1.

1. **Stop everything.** In every black window that runs npm (the website and the server), press Ctrl+C; if it asks `Terminate batch job (Y/N)?`, type `Y` and press Enter. Then close every black window (click its X) and close VS Code. Leave one File Explorer window open.

2. **Keep your current folder as a backup.** In File Explorer, right-click the `kids-book-website` folder, choose Rename and call it `kids-book-website-old`. If Windows says the folder is in use, check that no black window or VS Code is still open and try again; if the folder is in OneDrive, pause syncing first (OneDrive icon → Pause syncing); if it still says in use, restart the computer and rename the folder before opening anything else.

3. **Get a fresh copy of the website.** In that File Explorer window (the one that now shows `kids-book-website-old`, not inside it), click the address bar, type `cmd` and press Enter. Type `dir` and press Enter: the list must show `kids-book-website-old` and must not show `kids-book-website`. Then:

   ```bat
   git clone https://github.com/SumitDendage/kids-book-website.git
   cd kids-book-website
   ```

   This downloads about 270 MB and can take a few minutes. If a **Connect to GitHub** window opens (look in the taskbar if nothing seems to happen), sign in with your browser as SumitDendage. If git says `Repository not found`, Git is signed in as another GitHub account: open **Credential Manager** → Windows Credentials, remove `git:https://github.com`, and run the `git clone` line again. If git says `destination path 'kids-book-website' already exists`, step 2 did not work: close this window and do step 2 again.

4. **Put the backend and database next to it:**

   ```bat
   tar -xf "%USERPROFILE%\Downloads\backend-and-database.zip"
   dir
   ```

   The list should show `backend`, `database`, `frontend` and `legacy`. If it shows `react-app` and `site` instead of `frontend` and `legacy`, this change is not on GitHub's main branch yet: stop, close the window, delete the new `kids-book-website` folder and rename `kids-book-website-old` back to `kids-book-website`.

   If tar says `Failed to open`, find the zip in File Explorer, hold Shift, right-click it and choose **Copy as path**; then type `tar -xf ` (with a space at the end), press Ctrl+V and press Enter. If your Downloads folder has more than one copy (for example `backend-and-database (1).zip`), use the newest one. If tar says `This does not look like a tar archive`, type the line again with `C:\Windows\System32\tar.exe` in place of `tar`.

5. **Bring over your own settings, orders and uploaded PDFs** from the old folder (each line only acts when there is something to copy):

   ```bat
   if exist ..\kids-book-website-old\site\.env if not exist backend\.env copy ..\kids-book-website-old\site\.env backend\.env
   if not exist backend\.env copy backend\.env.example backend\.env
   if exist ..\kids-book-website-old\site\data xcopy ..\kids-book-website-old\site\data database\data\ /E /I /Y
   if exist ..\kids-book-website-old\site\protected\uploads xcopy ..\kids-book-website-old\site\protected\uploads backend\protected\uploads\ /E /I /Y
   if exist ..\kids-book-website-old\react-app\.env.local copy ..\kids-book-website-old\react-app\.env.local frontend\.env.local
   ```

   Your settings are now in `backend\.env`. The notes at the top of that file may still talk about `site\.env` and GitHub; you can ignore them. If you never filled in your settings in the old folder, leave them as they are: the backend is only a backup now.

6. **Build the website:**

   ```bat
   cd frontend
   npm install
   npm run build
   ```

7. **Start the server:**

   ```bat
   cd ..\backend
   npm install
   npm start
   ```

   Open http://127.0.0.1:4173, click on the page and press Ctrl+F5 (on some laptops Fn+Ctrl+F5, or Ctrl+Shift+R). In the black window the `shop` line should show `…\kids-book-website\database\data\lww.sqlite`. The first line, `ExperimentalWarning: SQLite is an experimental feature…`, is normal. If you see `EADDRINUSE`, another server is still running: close the other black windows and type `npm start` again. If a line starts with `!!`, it tells you what to do.

8. **When the site has worked for a few days**, make one backup as in `database\README.md` → Backups (stop the server first). Then you can delete the `kids-book-website-old` folder; until then it is the only other copy of your orders and uploaded PDFs.

From then on, every day, in the `kids-book-website` folder: `git pull` (it updates only the website), then `cd frontend`, `npm install`, `npm run build`, then `cd ..\backend`, `npm start`. `git pull` never touches `backend` or `database`, so back them up yourself (`database\README.md` → Backups).

## Put it on Hostinger

**It happens by itself.** After every change to `frontend` on `main`, GitHub builds the website and puts the ready files on the `live-site` branch (`.github/workflows/publish-website.yml`). Hostinger pulls that branch into `public_html/_live` (hPanel → Websites → learnwithwhy.com → Advanced → Git), and a timed job (hPanel → Advanced → Cron Jobs) copies `_live` into the site every 5 minutes, replacing changed files only. Nothing is deleted from the site, and there is nothing to upload or extract. To stop it, switch off auto-deployment in that Git page or delete the cron job.

To upload by hand instead:

1. In the `kids-book-website` folder run:

   ```bat
   cd frontend
   npm install
   npm run build
   ```

   This makes a `frontend\dist` folder.
2. Upload **everything inside `frontend\dist`** into `public_html` in Hostinger's File Manager, including the hidden `.htaccess` file (turn on "Show hidden files" if you can't see it).
3. `.htaccess` makes `/admin`, `/developer` and every other page address open the site, keeps images and fonts working, and sends `/viewer` to the sheet viewer.

That is all. Hostinger's normal web hosting is enough: the website talks to the Supabase server by itself, straight from the visitor's browser, so you do not need Node hosting or a VPS. The old `backend` folder is no longer used; keep it as a backup.

Two things make the uploaded site work:

- **The server knows your address.** `SITE_URL` and `ALLOWED_ORIGINS` in Supabase → Edge Functions → Secrets must name your website (see supabase/docs/SETUP.md step 3). The server refuses calls from any website that is not in `ALLOWED_ORIGINS`. If your site is not at `learnwithwhy.in`, put its real address in both.
- **`VITE_API_BASE_URL` stays empty.** Leave it empty in `frontend\.env.local` (or do not make that file at all). The website then uses the live API, `https://liaqgyskuhnxmlvmrnrl.supabase.co/functions/v1`. Set it only to try another Supabase project; `frontend/.env.example` explains how.

## Secrets

**Every key goes in Supabase → Edge Functions → Secrets, never in the website**, an email or a chat. The website holds no secrets. Only **public** values may go in `frontend/.env.local`, because everything starting with `VITE_` is copied into the JavaScript that visitors download. The website only needs the API address (`VITE_API_BASE_URL`, empty for the live API); it gets the public Razorpay key id from the server at checkout.

The server's secrets by name, from `supabase/.env.example` (that file has no values). How to get each one is in supabase/docs/SETUP.md steps 3, 6 and 7:

| What | Names |
|---|---|
| Your website's address | `SITE_URL`, `ALLOWED_ORIGINS`, `AUTH_FORWARD_IP` |
| Email | `MAIL_PROVIDER`, `BREVO_API_KEY` (or `RESEND_API_KEY`), `MAIL_FROM` |
| Razorpay | `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` |
| Stripe (optional, outside India) | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` |
| PayPal (optional, outside India) | `PAYPAL_CLIENT_ID`, `PAYPAL_SECRET`, `PAYPAL_MODE`, `PAYPAL_WEBHOOK_ID` |
| Rarely needed (optional) | `LWW_JWT_SECRET` |

Supabase adds its own (`SUPABASE_URL`, `SUPABASE_DB_URL` and the project keys) by itself. The Developer panel shows whether each secret is set, never its value.

Your Supabase **`sb_secret_` key** (Project Settings → API Keys) opens everything in your project. Use it only in a Command Prompt window to upload the PDFs (SETUP step 5), then close that window.

Staff sign in with their own accounts, so the shared `ADMIN_KEY` is gone. A browser keeps only its own person's sign-in, which ends when the server says so.

The worksheet PDFs are **not** copied into `frontend/public/` on purpose: they live in the private "worksheets" storage on Supabase and are only sent, stamped, to a signed-in customer with access. The site ships only the small thumbnails in `frontend/public/sheets/`.

## Features

### Customer site
- **Cinematic scroll**: the six chapters glide as one stack while the 960 landscape frames scrub underneath; frames are decoded on demand with a memory cap, so the page stays smooth.
- **Walking friends**: the fox, deer and rabbit from the landscape picture walk along the bottom of the screen as the page scrolls, on a canvas of their own (`services/walkers.js`, sprites in `src/assets/scene/`), sized for each screen so they are always whole.
- **Fox & rabbit preview**: a 50-frame animation plays inside the Sheets chapter and behind the store page.
- **Glass UI**: transparent header pill with hover-jump links, logo tile with wordmark, frosted panels that let the landscape through.
- **Sign up / Sign in** on the first screen: sign-up asks for a name and an email, and the customer ticks the account-sharing agreement (the server records which version they accepted). The server makes a password and emails it with an **Accept & Continue** link that confirms the address. Passwords live only in Supabase Auth. Five wrong passwords lock the account for 15 minutes, and *Forgot password* sends a link. "Keep me signed in" keeps a sign-in for 30 days (otherwise 12 hours). The role (Parent, Teacher, Tutor or School) is asked **after** sign-up. Until email is set up (SETUP step 6), sign-up is closed.
- **Kindergarten skill board**: eight topic groups (pre-reading, alphabet, phonics, vocabulary, sight words, grammar & writing, reading, maths & the world); every skill opens its own shelf of sheets.
- **105 printable PDF sheets**, all for Kindergarten so far (Class 1 to 3 say "Coming soon"): letter tracing A to Z, picture-reading charts, colour the letter, match the letters, letters before and after, beginning and ending sounds, missing letters, and the Vocabulary Colours and Shapes sheets. Eight are free (Alphabet A and B, Colours 1 to 3, Shapes 1 to 3); the rest cost ₹19 each by default. Prices are set on the server (Admin → Products).
- **The store**: a page of its own with **All sheets · New · Bestselling · Free · Subscription** views, classes, subjects and the seven Alphabet skill cards. Under Subscription a customer can buy a **class plan** that opens every sheet in the class while it runs (1, 3, 6 or 12 months; which lengths are offered depends on the country, and the prices come from the server).
- **Buying a sheet**: a bought sheet opens for its access days, 365 by default, counted from the moment the payment is verified. Staff can change the number per sheet or in Admin → Settings. The end date is shown on the sheet, in My Account and in the receipt email. Free sheets open for anyone signed in. Coupons apply at checkout.
- **Razorpay**: the checkout creates a Razorpay order for the server's price and opens Razorpay Checkout straight on the chosen method (card, UPI QR code, UPI ID, wallet). The server checks the payment with Razorpay (signature, order, amount and currency) and also accepts the signed webhook, before it opens the sheet; a repeated message never gives access twice. Until the keys are set (SETUP step 7), the ways to pay are shown as coming soon. Stripe and PayPal for other countries are built in but stay hidden until their keys are added.
- **Checkout with server-side pricing**: country, address, city, state and PIN; India is detected automatically (INR, GST, 6-digit PIN, Indian states) and other countries get their own currency and tax. The server works out **base price + tax + fee = total** and keeps that quote for 15 minutes; the order is made from the stored quote, so prices cannot be changed from the browser.
- **Protected PDF viewer**: the PDFs live in the private "worksheets" storage on Supabase. The server checks access on every request and stamps the customer's name and email into the PDF before sending it; pdf.js draws it. The viewer checks access again every minute and closes the sheet when access ends. Sheets are view only by default: Print and Download appear only when staff allow a number of copies for that sheet. The context menu, drag, copy and the print and save shortcuts are blocked, and the page blurs when the window loses focus. (No website can stop a screenshot or a phone photo; see supabase/docs/SECURITY.md.)
- **My Account**: **My Worksheets** lists what opens now (with its end date), class plans, and an **Expired** list with **Buy Access Again**. **Orders**, **Devices** (where the account is signed in) and **Security** (sharing warnings and appeals) are tabs of their own.
- **Account sharing**: the server watches for one account being used on many devices, networks or countries at once. A suspicion becomes a warning only when staff confirm it; warnings 1/3, 2/3 and 3/3 are emailed, and three confirmed warnings pause paid sheets. Sign-in, My Account, orders and free sheets keep working, and the customer can send an appeal.
- **Contact form**: "Leave a little note" sends each note to the server, where it lands in Admin → Messages and is emailed to the shop once email is set up. Until then (or when the server cannot be reached) a copy also goes through [Web3Forms](https://web3forms.com); its key is `WEB3FORMS_KEY` in `frontend/src/data/content.js`.
- **Ask AI**: a round logo button at the bottom right of the landing page (and only there) opens a chat panel over the page. The assistant answers from the questions and answers that staff keep in Admin → Content (it is not a real AI yet). Only when the server cannot be reached does it fall back to the short answers in `frontend/src/data/aiAssistant.js`.
- **Creative copy for children**: a rotating *"Today's why"* question and playful lines in every chapter.
- **SEO**: descriptive title/description, Open Graph & Twitter cards, JSON-LD (Organization, WebSite, ItemList of products), sitemap, robots, favicon, crawlable anchors.

### Staff panels

Staff sign in at `/admin` or `/developer` with their own accounts. The roles are Owner, Administrator, Support, Content editor and Developer; each person sees only the sections their permissions allow, and the server checks every call. Only an owner can add owners or admins.

| Admin (`/admin`) | Developer (`/developer`) |
|---|---|
| **Dashboard**: revenue, sales, open access and visitors today, the sales chart, the latest paid orders | **Dashboard**: how the live system is doing; each setting shows as set or not set up, never its value |
| **Products**: every sheet, with drafts and archived ones; upload the cover, the PDF and page pictures; price, access days, print and download limits. A new sheet starts as a draft. | **Errors**: what went wrong on the server (failed emails, payment notifications, security events) |
| **Orders**: every order with its payments and the access it gave. An order is paid only through a verified payment, so there is no "mark as paid". | **Emails**: every email the site sends, with Retry and Skip |
| **Customers**: every account, with its orders, access, sign-ins, warnings and account tools | **API monitoring**: is the API answering, and how fast |
| **Security**: sign-ins, sharing incidents, warnings, appeals and the sharing rules; block one sign-in, pause paid access, or block the whole account | **Database**: the tables and about how many rows each holds |
| **Messages**: the Contact us inbox; reply by email, mark as replied, archive | **Payments**, **Webhooks**, **Authentication** (sign-ins, with Block per sign-in) and **Security** (security events and the viewer log) |
| **Analytics**: sales, visitors, conversion, best sellers, sources | **Performance**: load and paint timings, measured in this browser only |
| **Coupons**: coupon codes and class discounts | **Deployments**: which versions of the API and the website are running now |
| **Content**: the home page text, the questions and answers (Ask AI uses them) and reviews | **Backups**: the settings backup file and CSV exports |
| **Roles**: staff members and what each one may do; a new staff member gets a password by email | **Audit logs** |
| **Settings**: how long a bought sheet stays open, class plan prices, fees, tax, currency rates, sign-in rules, the viewer's access check, the shop inbox, the sharing agreement and warnings | |
| **Audit logs**: everything staff changed, newest first (it cannot be edited) | |

Everything in both panels is read from and saved to the server. The browser only remembers the panel's theme and sidebar.

## Repository structure

```
kids-book-website/
├── frontend/                  ← THE WEBSITE (React + Vite) — work here, upload its build (was react-app/)
│   ├── index.html             the site's page (loads src/main.jsx)
│   ├── viewer.html            the sheet viewer's page (loads src/viewer-main.jsx)
│   ├── vite.config.js         two pages, output to dist/ (the dev /api forwarding is used only when VITE_API_BASE_URL is /)
│   ├── package.json           npm run dev · npm run build · npm run preview
│   ├── .env.example           public settings only (VITE_API_BASE_URL, VITE_DEV_API_PROXY)
│   ├── README.md              step-by-step for this folder (parts still describe the old Node backend)
│   ├── src/
│   │   ├── components/        the pieces of the page: navbar, chapters, sheet cards, store, checkout, modals, dashboard parts
│   │   ├── pages/             Admin/, Developer/, Portal/ (staff pages) and Viewer/ (the sheet viewer)
│   │   ├── layouts/           SiteLayout — every chapter and overlay
│   │   ├── context/           shared state: who is signed in, which popup is open, toasts
│   │   ├── services/          talking to the server (api.js), the 960-frame scroll engine, the viewer drawing
│   │   ├── hooks/             scroll input, the fox-and-rabbit preview, My Worksheets
│   │   ├── data/              the words, classes, sheets and prices shown on the site
│   │   ├── styles/            the original CSS, split into files but not changed
│   │   └── utils/             small helpers
│   ├── public/                copied as-is into the build
│   │   ├── .htaccess          Hostinger / Apache: page addresses, caching, file types
│   │   ├── frames-webp/       960 landscape frames (scroll background)
│   │   ├── preview-frames/    50 fox & rabbit frames
│   │   ├── fonts/             Cormorant Garamond + Inter, self-hosted
│   │   ├── sheets/            public thumbnails only (never the PDFs)
│   │   ├── shop/              the store page's wallpaper
│   │   └── favicon.svg · og.jpg · robots.txt · sitemap.xml
│   └── dist/                  made by npm run build — upload everything inside it (never on GitHub)
├── supabase/                  ← THE SERVER (Supabase) · NOT ON GITHUB: your computer only, from supabase-backend.zip
│   ├── README.md              how the pieces fit, working on it locally, deploying
│   ├── docs/                  SETUP.md (your 9 setup steps) · MISSING-CONFIG.md (what is still missing) · SECURITY.md · DESIGN.md
│   ├── functions/api/         the server program (Deno, TypeScript): routes/, services/, gateways/ (Razorpay, Stripe, PayPal), lib/
│   ├── migrations/            the database, one file per step (already applied to the live project)
│   ├── scripts/               upload-files.mjs: uploads the PDFs to the private worksheets store
│   ├── tests/                 API and database tests
│   ├── deploy-server.bat      puts the server program online (double-click; SETUP step 1)
│   ├── config.toml            the project id and the api function's deploy setting
│   └── .env.example           the name of every server secret, no values
├── backend/                   OLD Node server, no longer used · kept as a backup only · NOT ON GITHUB
│   └── protected/             the worksheet PDFs and page pictures (SETUP step 5 uploads them to Supabase)
├── database/                  OLD databases (SQLite shop, PostgreSQL schema), no longer used · kept as a backup only · NOT ON GITHUB
├── legacy/
│   └── old-static-site/       the original plain-HTML site (was site/dist/) — not served any more
├── .gitignore                 keeps supabase/, backend/, database/, builds and settings off GitHub
├── LICENSE
└── README.md
```

## Editing content

Everything the customer reads lives in `frontend/src/data/`:

| File | Constant | Controls |
|---|---|---|
| `content.js` | `NAV` | chapter names in the header |
| `content.js` | `CLASSES`, `SUBJECTS` | the categories |
| `content.js` | `HERO` | the first screen's small badge line and intro paragraph (the headline itself is `DEFAULT_TITLE` in `components/home/HomeChapter.jsx`); the text saved in Admin → Content wins |
| `content.js` | `PLANS`, `ROLES` | class-plan lengths and prices used until the server answers (the server's plans in Admin → Settings win) · Parent / Teacher / Tutor / School |
| `content.js` | `QUOTES`, `THANKS` | the testimonials and the scrolling thank-you notes |
| `content.js` | `WHYS` | the rotating "Today's why" questions |
| `catalogue.js` | `CATALOGUE`, `SHEETS`, `WORKSHEETS`, `ABOUT` | the shelf (`price: 0` = free) and what is inside each sheet |
| `catalogue.js` | `FREE_PDFS`, `SHEET_PRICE` | which printable PDFs are free (`az-A`, `az-B`, `vc-1` to `vc-3`, `vs-1` to `vs-3`) and the fallback price, used only until the server answers; the server's catalogue (Admin → Products) wins |
| `catalogue.js` | `KG_TOPICS` | the Kindergarten skill board |
| `checkout.js` | `PAY_VIA` | the ways to pay offered at checkout |
| `aiAssistant.js` | `AI_NAME`, `AI_WELCOME`, `AI_ANSWERS` | the Ask AI helper's name, first message and the short answers it gives only when the server cannot be reached |

Chapter text is in the components under `frontend/src/components/home/` and `frontend/src/components/sheets/`. Prices, page counts and which sheets have a real PDF come from the server at load time (`GET /api/worksheets`) and override the constants. Change them in Admin → Products, where you also upload a sheet's PDF.

After any change, run `npm run build` again in `frontend` and upload everything inside the new `frontend/dist` folder (including `.htaccess`) into `public_html`, replacing the old files.

## Going live

The full steps are in `supabase/docs/SETUP.md` (in `supabase-backend.zip`). In short:

1. **Server**: SETUP steps 1 to 7. Put the server program online with `deploy-server.bat` and check `https://liaqgyskuhnxmlvmrnrl.supabase.co/functions/v1/api/health`, turn off public sign-ups, add the website address, create your owner account, upload the PDFs, set up email (Brevo) and set up Razorpay (test mode first).
2. **Website**: SETUP step 8. Build `frontend` and upload everything inside `frontend/dist` to Hostinger ([see above](#put-it-on-hostinger)).
3. **Try everything once**: SETUP step 9. Make one test sign-up and one Razorpay test-mode purchase before you tell customers.
4. **What is still missing**: `supabase/docs/MISSING-CONFIG.md` lists each thing only you can do, what happens until it is done, and the safe defaults you may want to change (365 days of access, 18% GST, view-only sheets).
5. **Domain**: the SEO tags, sitemap and robots assume `https://learnwithwhy.in`. If your site lives somewhere else, change them, and `SITE_URL` and `ALLOWED_ORIGINS` too. Submit the sitemap in Google Search Console.

## Roadmap
- [x] Server on Supabase: one Edge Function (`api`), Postgres with row-level security, private PDF storage (replaces the old Node backend)
- [x] Accounts in Supabase Auth: emailed generated password, email confirmation, account-sharing agreement, lockout, sessions, reset by link
- [x] Razorpay (orders, payment checked on the server, webhook)
- [x] Protected PDF storage, watermarked viewer, access with an end date (a bought sheet for its access days, 365 by default; a class plan for its months; staff can take access away)
- [x] React + Vite version of the website (`frontend/`), same design
- [x] Shop data (orders, access) in the same Postgres database as the accounts
- [x] Staff accounts and roles in the database, with real staff sign-in
- [x] Server-side PDF stamping (the customer's name and email are stamped into the PDF on the server)
- [x] Email for sign-up and password reset (Brevo or Resend; SETUP step 6)
- [x] Email for order receipts ("Purchase Successful", with the end date)
- [x] Account-sharing checks: warnings 1/3 to 3/3, paid sheets paused at three, appeals
- [ ] PayPal / Stripe for international customers (built into the server, but hidden until their keys are added and not yet tried with real payments)
- [ ] A real AI behind Ask AI (today the assistant answers from the FAQ that staff keep in Admin → Content)

## License

**Proprietary — all rights reserved.** This repository, its code, design, artwork and every worksheet belong to **Learn With Why** as a business; no individual holds or is credited with ownership. Nothing here may be copied, reused, redistributed or used to build another product without written permission, and the [LICENSE](LICENSE) file and copyright notices may not be removed or altered by anyone. See [LICENSE](LICENSE).

## Credits

Design, artwork, copy and code © Learn With Why. Fonts: Cormorant Garamond and Inter (open licences).
