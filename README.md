<div align="center">

# Learn With Why

**Printable worksheets and activity sheets for Kindergarten to Class 3 — sold per PDF, opened in a protected, watermarked viewer, wrapped in a cinematic scroll-driven website.**

[Quick start](#quick-start) · [Put it on Hostinger](#put-it-on-hostinger) · [Features](#features) · [Structure](#repository-structure) · [Staff panels](#staff-panels) · [Go live](#going-live) · [Roadmap](#roadmap)

![Site version](https://img.shields.io/badge/version-2026.09.17-f0b455) ![Front end](https://img.shields.io/badge/front%20end-React%2019%20%2B%20Vite%208-61dafb) ![Backend](https://img.shields.io/badge/backend-Node%2022%20%2B%20SQLite-1f6b47) ![Payments](https://img.shields.io/badge/payments-Razorpay-3395ff) ![License](https://img.shields.io/badge/license-proprietary-555)

</div>

---

## Overview

Learn With Why is a storefront for a small studio in Pune that draws calm, ink-light learning sheets for Kindergarten to Class 3. A customer scrolls through six chapters of a floating-island landscape (960 frames scrubbed by the scroll), meets the fox and the rabbit in the Sheets chapter, tries the **free sheets**, and **buys the rest one PDF at a time** to open and print them.

The repository holds two copies of the same website:

| Folder | What it is |
|---|---|
| **`react-app/`** | **The website, built with React and Vite.** This is the version to work on and to upload. Same design, words, animations and features as before; only the way the code is organised is new. |
| `site/dist/` | The original website as plain HTML and JavaScript (`index.html`, `viewer.html`, `admin.js`), with no build step. It is kept unchanged as a working backup. |

Both talk to the same Node backend (`site/server.cjs`): a JSON API, a **SQLite database** (Node's built-in `node:sqlite`, no npm packages), **Razorpay** payments and a **private PDF store** that only streams a sheet to a signed-in customer who owns it.

> **The backend files are not in this repository yet.** `site/server.cjs`, `site/server/`, `site/test/` and `site/.env.example` are listed in `.gitignore` and live only on the owner's computer. Pull request #1 adds an earlier copy of them back (from 21 September). That copy does not have the contact-form route (`/api/contact`), the admin Messages routes or the Stripe/PayPal return routes yet, so the contact form and Admin → Messages also need the owner's current server files. Until the backend runs somewhere, the website opens, but sign-in, checkout, the shop prices from the database and the sheet viewer do not work.

## How a sheet is opened

```
Learn With Why website → public worksheet catalogue → customer selects a PDF → login
        FREE ─────────────────────────── PAID → Razorpay Checkout → backend verifies the signature → entitlement
          └──────────────── server access check (POST /api/access/:id) ────────────────┘
                     → private PDF storage (site/protected/) → the PDF viewer (viewer.html)
                     → watermark (name · email · time) — the sheet stays on the account, no expiry
```

Access is enforced on the server: the entitlement row in the database decides, and the viewer only shows what `/api/view/*` streams. The watermark is drawn by the viewer in the browser, so an entitled customer is sent the unstamped PDF (server-side stamping is on the roadmap). Entitlements do not expire; an admin can revoke one, and the open viewer closes within a minute.

## Quick start

You need **Node.js 22.13 or newer** (https://nodejs.org). The website alone builds on Node 20.19+ or 22.12+, but the backend needs 22.13+ for its built-in SQLite. On Windows, open the folder in File Explorer, click the address bar, type `cmd` and press Enter; a command window opens in that folder.

**1. The website (React version)**

```bash
cd react-app
npm install        # first time only
npm run dev        # → http://localhost:5173
```

**2. The backend (optional, in a second window opened in the main `kids-book-website` folder)**

```bash
node site/server.cjs     # → http://127.0.0.1:4173
```

While `npm run dev` is running, every `/api/...` call from the website is forwarded to the backend on port 4173. Without the backend the pages still open, but anything that needs the server fails: sign-in shows "Request failed (502)", checkout shows "Pricing service unavailable" and the viewer shows "Could not open the sheet".

Addresses of the React site (http://localhost:5173 while developing, or your domain after uploading):

| Address | What it is |
|---|---|
| `/` | The customer site (Home · About us · What we do · Sheets · Contact us · Testimonials) |
| `/#sheets` | Jumps to the Sheets chapter (every chapter has an anchor) |
| `/admin` | Admin account — sign up / sign in, then the admin dashboard (old `/#admin` links still work) |
| `/developer` | Developer panel — sign up / sign in, then the developer dashboard (old `/#developer` links still work) |
| `/viewer.html` | The protected PDF viewer, reached from the site with a view token (`/viewer` works too) |
| `/api/*` | The JSON API, answered by the backend |

The original plain-HTML copy still runs on its own with `node site/server.cjs` (open http://127.0.0.1:4173). On that copy the staff panels are `/#admin` and `/#developer`, and the viewer is `/viewer.html`.

## Put it on Hostinger

1. In the `react-app` folder run:

   ```bash
   npm install
   npm run build
   ```

   This makes a `react-app/dist` folder.
2. Upload **everything inside `react-app/dist`** into `public_html` in Hostinger's File Manager, including the hidden `.htaccess` file (turn on "Show hidden files" if you can't see it).
3. `.htaccess` makes `/admin`, `/developer` and every other page address open the site, keeps images and fonts working, and sends `/viewer` to the sheet viewer.

Hostinger's normal web hosting only serves files; it cannot run the Node backend. Until the backend is hosted somewhere that runs Node (Hostinger's Node.js hosting, a VPS, or similar), the uploaded site looks and scrolls exactly right, but sign-in, checkout and the sheet viewer will not work.

**The website and `/api` must be on the same domain.** The backend refuses sign-in, checkout and other changes that come from another domain, and it sends no CORS headers. So leave `VITE_API_BASE_URL` empty and serve both from one domain, for example a Node host or reverse proxy that sends `/api/*` to the backend and everything else to the files in `react-app/dist`. `VITE_API_BASE_URL` for a backend on a different domain only works after the backend is changed to allow that domain (CORS with credentials and a cross-site session cookie).

## Secrets

Only **public** values may go in `react-app/.env.local`: everything starting with `VITE_` is copied into the JavaScript that visitors download. The Razorpay key secret, the webhook secret, `ADMIN_KEY`, database details and any other secret belong only in the backend's own `site/.env`. Payment verification stays on the backend; the website only receives the public Razorpay key id from the server at checkout.

One exception to watch: staff paste `ADMIN_KEY` into Admin → Settings → Server connection. It is kept as plain text in that browser's storage (`lww_admin_key`) and is included in every Export / Download backup JSON file. Only save it on a trusted computer, never share backup files, and change `ADMIN_KEY` in `site/.env` if one leaks.

The private PDFs in `site/protected/` are **not** copied into `react-app/public/` on purpose: they are only ever streamed by the backend to a signed-in customer who owns the sheet. The site only ships the small thumbnails in `react-app/public/sheets/`.

## Features

### Customer site
- **Cinematic scroll** — the six chapters glide as one stack while the 960 landscape frames scrub underneath; frames are decoded on demand with a memory cap, so the page stays smooth.
- **Fox & rabbit preview** — a 50-frame animation plays inside the Sheets chapter and behind the store page.
- **Glass UI** — transparent header pill with hover-jump links, logo tile with wordmark, frosted panels that let the landscape through.
- **Sign up / Sign in** on the first screen (name, email, password) — real accounts in the database, scrypt-hashed passwords, httpOnly session cookies; *Forgot password* with a six-digit code, "Keep me signed in". The role — Parent, Teacher, Tutor or School — is asked **after** sign-up.
- **Kindergarten skill board** — eight topic groups (pre-reading, alphabet, phonics, vocabulary, sight words, grammar & writing, reading, maths & the world); every skill opens its own shelf of sheets.
- **68 printable PDF sheets in 5 skill types** — letter tracing A–Z, picture-reading charts, colour the letter, match the letters and spot the letters. The first few of each set are free; the rest are bought one by one.
- **The store** — a page of its own with **New · Bestselling · Free · Subscription** views, classes, subjects and the five skill cards. (Subscription lists the paid sheets; class plans are no longer sold, so every PDF is bought on its own.)
- **Buy one PDF** — every purchase grants **a permanent entitlement**: the sheet stays on the account. Free sheets open for anyone signed in. Coupons apply at checkout.
- **Razorpay** — the checkout creates a Razorpay order for the signed total, opens Razorpay Checkout straight on the chosen method (card, UPI QR code, UPI ID, wallet), and the backend verifies the payment signature — and the signed webhook — before it grants access. No keys configured → a clearly labelled demo gateway, nothing charged. PayPal and Stripe are shown as coming soon.
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
| Audit logs | Backups (export / restore this browser's data as JSON — back up `site/data/` on the server separately), audit logs |

Only **Orders**, **Customers** and **Messages** read and write the database (through `/api/admin/*`, once the admin key is saved). The Products book studio (cover, PDF, price), Coupons & discounts, Content, Roles and the visitor side of Analytics are saved only in the admin's own browser: they do not upload PDFs, do not change what the server charges or which coupons it accepts, and do not change what customers see. For real changes use the admin API: `PUT /api/admin/worksheets/:id`, `POST /api/admin/worksheets/:id/file` and `PUT /api/admin/coupons` (see [site/README.md](site/README.md)).

The admin and developer sign-in is still a browser demo; the database and the admin API are protected by `ADMIN_KEY` on the backend.

## Repository structure

```
kids-book-website/
├── react-app/                 ← THE WEBSITE (React + Vite) — work here, upload its build
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
│   └── public/                copied as-is into the build
│       ├── .htaccess          Hostinger / Apache: page addresses, caching, file types
│       ├── frames-webp/       960 landscape frames (scroll background)
│       ├── preview-frames/    50 fox & rabbit frames
│       ├── fonts/             Cormorant Garamond + Inter, self-hosted
│       ├── sheets/            public thumbnails only (never the PDFs)
│       └── favicon.svg · og.jpg · robots.txt · sitemap.xml
├── site/                      the original plain-HTML site + the backend's home
│   ├── dist/                  index.html · viewer.html · admin.js · frames · fonts · thumbnails (unchanged backup)
│   ├── protected/             PRIVATE PDF STORAGE — never served as static files
│   │   └── a-to-z/ · colour/ · matching/ · reading/ · spot/
│   ├── README.md              the backend: flow, database tables, the main API routes, Razorpay setup
│   └── (server.cjs, server/, test/, .env.example — backend, kept off GitHub for now; see pull request #1)
├── LICENSE
└── README.md
```

## Editing content

Everything the customer reads lives in `react-app/src/data/`:

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

Chapter text is in the components under `react-app/src/components/home/` and `react-app/src/components/sheets/`. Prices, page counts and which sheets have a real PDF come from the database at load time (`GET /api/worksheets`) and override the constants; change them with the admin API (`PUT /api/admin/worksheets/:id`, `POST …/:id/file` to upload the PDF) — see [site/README.md](site/README.md).

After any change, run `npm run build` again and upload everything inside the new `react-app/dist` folder (including `.htaccess`) into `public_html`, replacing the old files.

## Going live

1. **Website** — build `react-app` and upload `dist/` to Hostinger ([see above](#put-it-on-hostinger)).
2. **Backend** — run `node site/server.cjs` on hosting that runs Node, on the **same domain** as the website (`/api/*` must reach it), behind HTTPS (set `SITE_URL=https://…` so the session cookie is `Secure`; behind a proxy pass `X-Forwarded-Proto` and the country header). Keep `site/data/` and `site/protected/` on persistent storage and back them up.
3. **Razorpay** — put `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` in `site/.env` (test keys first), add a webhook for `payment.captured`, `order.paid` and `payment.failed` at `https://<host>/api/pay/webhook` and put its secret in `RAZORPAY_WEBHOOK_SECRET`. The demo gateway switches itself off as soon as keys are present.
4. **Admin key** — set `ADMIN_KEY` in `site/.env`, then save the same key in Admin → Settings → Server connection so the dashboards read the database.
5. **PDFs** — upload each worksheet's PDF with `POST /api/admin/worksheets/:id/file` (or drop `<id>.pdf` into `site/protected/` and restart the backend; it is attached at the next start), and set its price with `PUT /api/admin/worksheets/:id`.
6. **Email** — forgot-password codes are printed on the server console; set `NODE_ENV=production` so they are no longer returned to the browser, and plug a mail sender into the backend.
7. **Domain** — the SEO tags, sitemap and robots assume `https://learnwithwhy.in`; change them before deploying and submit the sitemap in Google Search Console.

## Roadmap
- [x] Backend + SQLite database (accounts, orders, entitlements, access log)
- [x] Razorpay (orders, signature verification, webhook)
- [x] Protected PDF storage, watermarked viewer, permanent entitlements (admin revoke)
- [x] React + Vite version of the website (`react-app/`), same design
- [ ] Backend files back in the repository (pull request #1)
- [ ] PayPal / Stripe for international customers
- [ ] Email for password reset and order receipts
- [ ] Staff accounts and roles in the database
- [ ] Server-side PDF stamping (the watermark is applied in the viewer today)

## License

**Proprietary — all rights reserved.** This repository, its code, design, artwork and every worksheet belong to **Learn With Why** as a business; no individual holds or is credited with ownership. Nothing here may be copied, reused, redistributed or used to build another product without written permission, and the [LICENSE](LICENSE) file and copyright notices may not be removed or altered by anyone. See [LICENSE](LICENSE).

## Credits

Design, artwork, copy and code © Learn With Why. Fonts: Cormorant Garamond and Inter (open licences).
