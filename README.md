<div align="center">

# Learn With Why

**Printable worksheets and activity sheets for Kindergarten to Class 3 — sold per PDF, opened in a protected, watermarked viewer, wrapped in a cinematic scroll-driven website.**

[Quick start](#quick-start) · [Moving to the new folders](#moving-to-the-new-folders-october-2026) · [Put it on Hostinger](#put-it-on-hostinger) · [Features](#features) · [Structure](#repository-structure) · [Staff panels](#staff-panels) · [Go live](#going-live) · [Roadmap](#roadmap)

![Site version](https://img.shields.io/badge/version-2026.09.17-f0b455) ![Front end](https://img.shields.io/badge/front%20end-React%2019%20%2B%20Vite%208-61dafb) ![Backend](https://img.shields.io/badge/backend-Node%2022%20%2B%20PostgreSQL%20%2B%20SQLite-1f6b47) ![Payments](https://img.shields.io/badge/payments-Razorpay-3395ff) ![License](https://img.shields.io/badge/license-proprietary-555)

</div>

---

## Overview

Learn With Why is a storefront for a small studio in Pune that draws calm, ink-light learning sheets for Kindergarten to Class 3. A customer scrolls through six chapters of a floating-island landscape (960 frames scrubbed by the scroll), meets the fox and the rabbit in the Sheets chapter, tries the **free sheets**, and **buys the rest one PDF at a time** to open and print them.

The website talks to a Node backend (`backend/server.cjs`): a JSON API, a **PostgreSQL database for customer accounts** (sign-up with an emailed password, email confirmation, sign-in, sessions, password reset), a **SQLite store for the shop** (catalogue, orders, entitlements), **Razorpay** payments, email through **SMTP**, and a **private PDF store** that only streams a sheet to a signed-in customer who owns it. **The backend and the databases are kept off GitHub on purpose**: they live only on your computer and on the server, in the `backend` and `database` folders next to `frontend` (see [What is where](#what-is-where)). How the backend works, how to set it up and how to put it online is in `backend\README.md` inside that folder; every endpoint is in `backend\API.md`.

### What is where

| Folder | On GitHub? | What it is |
|---|---|---|
| **`frontend/`** | yes | **The website, built with React and Vite** (was `react-app/`): the customer site, the staff panels (`/admin`, `/developer`) and the protected viewer (`viewer.html`). This is the part you build and upload. |
| `legacy/old-static-site/` | yes | The original plain-HTML website (was `site/dist/`), kept for reference only. |
| `backend/` | **no** — your computer and the server only | The Node server (was `site/`): `server.cjs` (`npm start`), the API, accounts, payments, email and the 79 private PDFs in `backend/protected/`. Your own settings go in `backend/.env`. |
| `database/` | **no** — your computer and the server only | The databases themselves, no JavaScript: the PostgreSQL schema in `database/postgresql/migrations/` and the shop database in `database/data/` (made on the first start). |

`backend/` and `database/` are listed in `.gitignore`, so git never uploads them and `git pull` never changes them. A fresh copy of both comes from **`backend-and-database.zip`** (kept in the Claude project's files): in the `kids-book-website` folder run `tar -xf "%USERPROFILE%\Downloads\backend-and-database.zip"` (or put the zip's own path between the quotes). They are gone only from the current files on GitHub: older commits in the repository's history (and older branches) still hold the old copies, so GitHub is neither a backup of them nor a place they have been erased from. Keep that zip safe and back up your settings, orders and uploads yourself (`database\README.md` → Backups).

The old plain-HTML copy is no longer served: the server only serves the React website built in `frontend/dist`. If that is not built yet, every page says "Not found: the website is not built yet" and the server window says how to build it. More about the old copy: [`legacy/README.md`](legacy/README.md).

## How a sheet is opened

```
Learn With Why website → public worksheet catalogue → customer selects a PDF → login
        FREE ─────────────────────────── PAID → Razorpay Checkout → backend verifies the signature → entitlement
          └──────────────── server access check (POST /api/access/:id) ────────────────┘
                     → private PDF storage (backend/protected/) → the PDF viewer (viewer.html)
                     → watermark (name · email · time) — a bought sheet stays on the account; a class plan runs for its months
```

Access is enforced on the server: the entitlement row in the database decides, and the viewer only shows what `/api/view/*` streams. The watermark is drawn by the viewer in the browser, so an entitled customer is sent the unstamped PDF (server-side stamping is on the roadmap). A sheet bought on its own (or a free sheet) never expires. A class plan runs for its 1, 3, 6 or 12 months; a renewal bought while it runs starts the day it ends. When a plan ends, or an admin revokes an entitlement, the open viewer closes within a minute.

## Quick start

You need **Git** (https://git-scm.com/download/win), **Node.js 22.13 or newer** (https://nodejs.org) and, for the backend, a **PostgreSQL** database (how to get one: `backend\README.md` → Set up PostgreSQL). The website alone builds on Node 20.19+ or 22.12+, but the backend needs 22.13+ for its built-in SQLite. The `backend` and `database` folders must already be in the `kids-book-website` folder (from `backend-and-database.zip`, see [Moving to the new folders](#moving-to-the-new-folders-october-2026)). If your `kids-book-website` folder still has `site` and `react-app` folders in it, do not run `git pull` there: do [Moving to the new folders](#moving-to-the-new-folders-october-2026) first. On Windows, open the `kids-book-website` folder in File Explorer, click the address bar, type `cmd` and press Enter; a command window opens in that folder. Use this Command Prompt (cmd), not PowerShell or VS Code's terminal: the commands here do not work there.

**1. Build the website**

```bat
git pull
cd frontend
npm install
npm run build
```

This makes the `frontend\dist` folder, which the backend serves. Run `npm run build` again after every change to the website.

**2. Your settings (first time only)**

In the same window, make your own settings file by copying the example (skip this step if `backend\.env` already exists, for example after [moving to the new folders](#moving-to-the-new-folders-october-2026)):

```bat
cd ..\backend
if not exist .env copy .env.example .env
```

In the same window type `notepad .env` and press Enter, change two lines, then save with Ctrl+S. Every other setting is explained in the file and has a working default:

- `DATABASE_URL` — replace `CHANGE-ME` with your PostgreSQL password (or paste the connection string your provider gives you).
- `ADMIN_KEY` — replace `change-me` with a key of your own.

`backend\.env` never goes to GitHub (the whole `backend` folder is kept off it), so your passwords stay on your computer. After changing it, stop the server (Ctrl+C) and start it again.

**3. Start the backend** (in the same window)

```bat
cd ..\backend
npm install
npm start
```

Open http://127.0.0.1:4173, click on the page and press Ctrl+F5 (on some laptops Fn+Ctrl+F5, or Ctrl+Shift+R). Free sheets open after sign-in; paid ones need the Razorpay keys (`RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`) in `backend\.env`.

When it starts, the server prints a few lines about the site, the accounts, the shop, mail, payments and the admin key. A line starting with `!!` tells you what to do, for example when the website is not built yet. If `backend\protected` is missing, the server stops with "nothing was started or changed" and says what to do. If you type `npm start` before `npm install`, it says the packages are not installed yet.

Without an SMTP mail service in `backend\.env`, the account emails (the generated password, the Accept & Continue link, reset links) are printed in this window instead of being sent.

**Working on the website (optional)**

To see your changes straight away without building, open a second window in the `kids-book-website` folder and run:

```bat
cd frontend
npm run dev
```

Then open http://localhost:5173 (set `SITE_URL=http://localhost:5173` in `backend\.env` while you use `npm run dev`, so the links in emails open it). While `npm run dev` is running, every `/api/...` call from the website is forwarded to the backend on port 4173. Without the backend the pages still open, but anything that needs the server fails: sign-in shows "Request failed (502)", checkout shows "Pricing service unavailable" and the viewer shows "Could not open the sheet".

Addresses of the website (http://127.0.0.1:4173 with `npm start`, http://localhost:5173 while `npm run dev` runs, or your domain after uploading):

| Address | What it is |
|---|---|
| `/` | The customer site (Home · About us · What we do · Sheets · Contact us · Testimonials) |
| `/#sheets` | Jumps to the Sheets chapter (every chapter has an anchor) |
| `/admin` | Admin account — sign up / sign in, then the admin dashboard (old `/#admin` links still work) |
| `/developer` | Developer panel — sign up / sign in, then the developer dashboard (old `/#developer` links still work) |
| `/viewer.html` | The protected PDF viewer, reached from the site with a view token (`/viewer` works too) |
| `/api/*` | The JSON API, answered by the backend |

## Moving to the new folders (October 2026)

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

   Your settings are now in `backend\.env`. The notes at the top of that file may still talk about `site\.env` and GitHub; you can ignore them. If you never filled in your settings in the old folder, type `notepad backend\.env` and change `DATABASE_URL` and `ADMIN_KEY` as in [Quick start](#quick-start) step 2.

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

1. In the `kids-book-website` folder run:

   ```bat
   cd frontend
   npm install
   npm run build
   ```

   This makes a `frontend\dist` folder.
2. Upload **everything inside `frontend\dist`** into `public_html` in Hostinger's File Manager, including the hidden `.htaccess` file (turn on "Show hidden files" if you can't see it).
3. `.htaccess` makes `/admin`, `/developer` and every other page address open the site, keeps images and fonts working, and sends `/viewer` to the sheet viewer.

Hostinger's normal web hosting only serves files; it cannot run the Node backend (the `backend` folder, which is not on GitHub). The backend must run on hosting that runs Node (Hostinger's Node.js hosting, a VPS, or similar) on the **same domain** as the website. Until it does, the uploaded site looks and scrolls exactly right, but sign-in, checkout and the sheet viewer will not work.

**The website and `/api` must be on the same domain.** The backend refuses sign-in, checkout and other changes that come from another domain, and it sends no CORS headers. So leave `VITE_API_BASE_URL` empty and serve both from one domain, for example a Node host or reverse proxy that sends `/api/*` to the backend and everything else to the files in `frontend/dist`. `VITE_API_BASE_URL` for a backend on a different domain only works after the backend is changed to allow that domain (CORS with credentials and a cross-site session cookie).

## Secrets

Only **public** values may go in `frontend/.env.local`: everything starting with `VITE_` is copied into the JavaScript that visitors download. The Razorpay key secret, the webhook secret, `ADMIN_KEY`, database details and any other secret belong only in the backend's own `backend/.env` (made by copying `backend/.env.example`; like the whole backend, it never goes to GitHub). Payment verification stays on the backend; the website only receives the public Razorpay key id from the server at checkout.

One exception to watch: staff paste `ADMIN_KEY` into Admin → Settings → Server connection. It is kept as plain text in that browser's storage (`lww_admin_key`) and is included in every Export / Download backup JSON file. Only save it on a trusted computer, never share backup files, and change `ADMIN_KEY` in `backend/.env` if one leaks.

The private PDFs in `backend/protected/` are **not** copied into `frontend/public/` on purpose: they are only ever streamed by the backend to a signed-in customer who owns the sheet. The site only ships the small thumbnails in `frontend/public/sheets/`.

## Features

### Customer site
- **Cinematic scroll** — the six chapters glide as one stack while the 960 landscape frames scrub underneath; frames are decoded on demand with a memory cap, so the page stays smooth.
- **Fox & rabbit preview** — a 50-frame animation plays inside the Sheets chapter and behind the store page.
- **Glass UI** — transparent header pill with hover-jump links, logo tile with wordmark, frosted panels that let the landscape through.
- **Sign up / Sign in** on the first screen — sign-up asks only for name and email; the server generates a password and emails it with an **Accept & Continue** link that confirms the address and leads back to sign-in. Accounts live in PostgreSQL with Argon2id-hashed passwords, httpOnly session cookies, a lock after 5 wrong passwords, and *Forgot password* by a single-use emailed link. "Keep me signed in". The role — Parent, Teacher, Tutor or School — is asked **after** sign-up.
- **Kindergarten skill board** — eight topic groups (pre-reading, alphabet, phonics, vocabulary, sight words, grammar & writing, reading, maths & the world); every skill opens its own shelf of sheets.
- **68 printable PDF sheets in 5 skill types** — letter tracing A–Z, picture-reading charts, colour the letter, match the letters and spot the letters. The first few of each set are free; the rest are bought one by one.
- **The store** — a page of its own with **New · Bestselling · Free · Subscription** views, classes, subjects and the five skill cards. (Subscription lists the paid sheets; class plans are no longer sold, so every PDF is bought on its own.)
- **Buy one PDF** — every purchase grants **a permanent entitlement**: the sheet stays on the account. Free sheets open for anyone signed in. Coupons apply at checkout.
- **Razorpay** — the checkout creates a Razorpay order for the signed total, opens Razorpay Checkout straight on the chosen method (card, UPI QR code, UPI ID, wallet), and the backend verifies the payment signature — and the signed webhook — before it grants access. Until keys are configured its ways to pay are shown as coming soon and nothing can be bought (there is no demo gateway); the same goes for PayPal and Stripe.
- **Checkout with server-side pricing** — country, address, city, state and PIN; India is detected automatically (INR, GST, 6-digit PIN, Indian states) and other countries get their own currency and tax. The server computes **base price + tax + fee = total**, returns a signed quote, and only accepts a valid signed quote as an order — prices cannot be changed from the browser.
- **Protected PDF viewer** — PDFs live outside the web root and are streamed only to the signed-in buyer, rendered with pdf.js, stamped with the customer's name, email and time. Context menu, drag, copy, print and save shortcuts are blocked; the page blurs when the window loses focus.
- **My Account → My Worksheets** lists every sheet on the customer's account (the PDFs they bought and the free sheets they have opened), straight from the database.
- **Contact form** — notes go to learnwithwhy6@gmail.com through the backend.
- **Creative copy for children** — a rotating *"Today's why"* question and playful lines in every chapter.
- **SEO** — descriptive title/description, Open Graph & Twitter cards, JSON-LD (Organization, WebSite, ItemList of products), sitemap, robots, favicon, crawlable anchors.

### Staff panels
| Admin (`/admin`) | Developer (`/developer`) |
|---|---|
| Overview with sales chart | System health, uptime, heap, FPS |
| **Products** — book studio with drag-and-drop cover & PDF, rating, category, price, stock, audience, print/download limits; card gallery with search & filters | Errors & stack traces (captured automatically) |
| **Orders** — live from the database once the admin key is saved (Settings → Server connection); status changes are written back | API monitoring (every `fetch`, status, latency) |
| **Customers** — every account in the database: orders, total spending, downloads | Browser storage (this browser's `lww_*` keys, sizes, quota — not the SQLite database) |
| **Messages** — the Contact us inbox, live from the database once the admin key is saved; mark as read / replied | |
| **Settings → Server connection** — the admin key that connects the dashboards to the database | |
| **Analytics** — sales, visitors, conversion funnel, top products, sources | Payment and authentication logs from this browser (the webhook page stays empty; webhook events are recorded in the database) |
| Coupons & discounts | Performance (DOM ready, load, first paint) |
| Content management (home page copy) | Security events (failed logins) |
| Roles & permissions (admin / editor / support / developer) | Deployments (site version and host; the latest-commits list only loads if the GitHub repository is public) |
| Audit logs | Backups (export / restore this browser's data as JSON — back up `database/data/` on the server separately), audit logs |

Only **Orders**, **Customers** and **Messages** read and write the database (through `/api/admin/*`, once the admin key is saved). The Products book studio (cover, PDF, price), Coupons & discounts, Content, Roles and the visitor side of Analytics are saved only in the admin's own browser: they do not upload PDFs, do not change what the server charges or which coupons it accepts, and do not change what customers see. For real changes use the admin API: `PUT /api/admin/worksheets/:id`, `POST /api/admin/worksheets/:id/file` and `PUT /api/admin/coupons` (see `backend\README.md`).

The admin and developer sign-in is still a browser demo; the database and the admin API are protected by `ADMIN_KEY` on the backend.

## Repository structure

```
kids-book-website/
├── frontend/                  ← THE WEBSITE (React + Vite) — work here, upload its build (was react-app/)
│   ├── index.html             the site's page (loads src/main.jsx)
│   ├── viewer.html            the sheet viewer's page (loads src/viewer-main.jsx)
│   ├── vite.config.js         two pages, output to dist/, /api forwarded to the backend in dev
│   ├── package.json           npm run dev · npm run build · npm run preview
│   ├── .env.example           public settings only (VITE_API_BASE_URL, VITE_DEV_API_PROXY)
│   ├── README.md              step-by-step for this folder
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
├── backend/                   ← THE SERVER (Node) — npm start (was site/) · NOT ON GITHUB: your computer and the server only
│   ├── server.cjs             the entry point: the API, the private PDFs and the built website on one process
│   ├── package.json           npm start · npm run migrate · npm test (argon2, nodemailer, pg; Node 22.13+)
│   ├── .env.example           every setting, explained — copy it to .env
│   ├── .env                   YOUR settings (you make it)
│   ├── README.md              the backend: flow, databases, setup, email, tests, deployment
│   ├── API.md                 every endpoint
│   ├── scripts/migrate.cjs    npm run migrate (the server also migrates at every start)
│   ├── src/
│   │   ├── config/            config.cjs (settings from the environment) · paths.cjs (every folder)
│   │   ├── http/              http.cjs (helpers) · middleware.cjs (security headers, CORS, sign-in check)
│   │   ├── routes/            auth.cjs (accounts) · access.cjs (entitlements + viewer) · payments.cjs (Razorpay, Stripe, PayPal) · admin.cjs · contact.cjs
│   │   ├── services/          pricing.cjs (quotes) · mail.cjs (SMTP) · emails.cjs (templates) · passwords.cjs (Argon2id)
│   │   └── database/          pg.cjs (PostgreSQL) · db.cjs (the SQLite shop and its tables) · migrate.cjs · legacy.cjs · seed.cjs
│   ├── test/                  backend, database and end-to-end tests (npm test; needs TEST_DATABASE_URL)
│   └── protected/             PRIVATE PDF STORAGE — never served as static files
│       ├── a-to-z/ · colour/ · matching/ · reading/ · sound/ · sound-exercise/ · spot/   the 79 PDFs + preview JPGs
│       └── uploads/           PDFs uploaded in the admin panel
├── database/                  the databases themselves, no JavaScript · NOT ON GITHUB: your computer and the server only
│   ├── postgresql/migrations/ 001_auth_schema.sql — the accounts tables, applied automatically at every start
│   └── data/                  lww.sqlite, the shop database (made on the first start)
├── legacy/
│   └── old-static-site/       the original plain-HTML site (was site/dist/) — not served any more
├── .gitignore                 keeps backend/, database/, builds and settings off GitHub
├── LICENSE
└── README.md
```

## Editing content

Everything the customer reads lives in `frontend/src/data/`:

| File | Constant | Controls |
|---|---|---|
| `content.js` | `NAV` | chapter names in the header |
| `content.js` | `CLASSES`, `SUBJECTS` | the categories |
| `content.js` | `HERO` | the first screen's small badge line and intro paragraph (the headline itself is `DEFAULT_TITLE` in `components/home/HomeChapter.jsx`) |
| `content.js` | `PLANS`, `ROLES` | old class-plan lengths and prices (plans are no longer sold) · Parent / Teacher / Tutor / School |
| `content.js` | `QUOTES`, `THANKS` | the testimonials and the scrolling thank-you notes |
| `content.js` | `WHYS` | the rotating "Today's why" questions |
| `catalogue.js` | `CATALOGUE`, `SHEETS`, `WORKSHEETS`, `ABOUT` | the shelf (`price: 0` = free) and what is inside each sheet |
| `catalogue.js` | `AZ_FREE`, `RC_FREE`, `SHEET_PRICE` | which tracing, colour and picture-reading PDFs are free (Match and Spot: the first three ranges), and the fallback price |
| `catalogue.js` | `KG_TOPICS` | the Kindergarten skill board |
| `checkout.js` | `PAY_VIA` | the ways to pay offered at checkout |

Chapter text is in the components under `frontend/src/components/home/` and `frontend/src/components/sheets/`. Prices, page counts and which sheets have a real PDF come from the database at load time (`GET /api/worksheets`) and override the constants; change them with the admin API (`PUT /api/admin/worksheets/:id`, `POST …/:id/file` to upload the PDF) — see `backend\README.md`.

After any change, run `npm run build` again in `frontend` and upload everything inside the new `frontend/dist` folder (including `.htaccess`) into `public_html`, replacing the old files.

## Going live

1. **Website** — build `frontend` and upload everything inside `frontend/dist` to Hostinger ([see above](#put-it-on-hostinger)).
2. **Backend** — a PostgreSQL database plus `npm start` in `backend/` (unpacked from `backend-and-database.zip`, since it is not on GitHub) on hosting that runs Node, on the **same domain** as the website (`/api/*` must reach it), behind HTTPS (set `SITE_URL=https://…` so the session cookie is `Secure` and email links are right; behind a proxy pass `X-Forwarded-Proto`, `X-Forwarded-For` and the country header). Its settings go in `backend/.env` (copy `backend/.env.example`). Keep `database/data/` and `backend/protected/` on persistent storage and back them up with the database. Step by step: `backend\README.md` → Deploy.
3. **Razorpay** — put `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` in `backend/.env` (test keys first), add a webhook for `payment.captured`, `order.paid` and `payment.failed` at `https://<host>/api/pay/webhook` and put its secret in `RAZORPAY_WEBHOOK_SECRET`. Until keys are present the checkout shows payment as coming soon.
4. **Admin key** — set `ADMIN_KEY` in `backend/.env`, then save the same key in Admin → Settings → Server connection so the dashboards read the database.
5. **PDFs** — upload each worksheet's PDF with `POST /api/admin/worksheets/:id/file` (or drop `<id>.pdf` into `backend/protected/` and restart the backend; it is attached at the next start), and set its price with `PUT /api/admin/worksheets/:id`.
6. **Email** — sign-up and forgot password send email: set `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` and `MAIL_FROM` in `backend/.env` (and `NODE_ENV=production`), then sign up with your own address to check the email arrives.
7. **Domain** — the SEO tags, sitemap and robots assume `https://learnwithwhy.in`; change them before deploying and submit the sitemap in Google Search Console.

## Roadmap
- [x] Backend + SQLite database (orders, entitlements, access log)
- [x] Accounts in PostgreSQL: emailed generated password, email confirmation, lockout, sessions, reset by link
- [x] Razorpay (orders, signature verification, webhook)
- [x] Protected PDF storage, watermarked viewer, entitlements (a bought sheet for good, a class plan for its months; admin revoke)
- [x] React + Vite version of the website (`frontend/`), same design
- [ ] PayPal / Stripe for international customers
- [x] Email for sign-up and password reset (SMTP)
- [ ] Email for order receipts
- [ ] Shop data (orders, entitlements) in PostgreSQL too
- [ ] Staff accounts and roles in the database
- [ ] Server-side PDF stamping (the watermark is applied in the viewer today)

## License

**Proprietary — all rights reserved.** This repository, its code, design, artwork and every worksheet belong to **Learn With Why** as a business; no individual holds or is credited with ownership. Nothing here may be copied, reused, redistributed or used to build another product without written permission, and the [LICENSE](LICENSE) file and copyright notices may not be removed or altered by anyone. See [LICENSE](LICENSE).

## Credits

Design, artwork, copy and code © Learn With Why. Fonts: Cormorant Garamond and Inter (open licences).
