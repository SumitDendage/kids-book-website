<div align="center">

# Learn With Why

**Printable worksheets and activity sheets for Kindergarten to Class 3 — sold per PDF or by class plan, opened in a protected, watermarked viewer, wrapped in a cinematic scroll-driven website.**

[Live demo](#quick-start) · [Features](#features) · [Structure](#repository-structure) · [Admin & developer panels](#staff-panels) · [Go live](#going-live) · [Roadmap](#roadmap)

![Site version](https://img.shields.io/badge/version-2026.09.17-f0b455) ![Stack](https://img.shields.io/badge/stack-Node%2024%20%2B%20SQLite%20%2B%20vanilla%20JS-1f6b47) ![Build](https://img.shields.io/badge/build-none%20required-8fd6d2) ![Payments](https://img.shields.io/badge/payments-Razorpay-3395ff) ![License](https://img.shields.io/badge/license-proprietary-555)

</div>

---

## Overview

Learn With Why is a storefront for a small studio in Pune that draws calm, ink-light learning sheets for Kindergarten to Class 3. A customer scrolls through six chapters of a floating-island landscape (960 frames scrubbed by the scroll), meets the fox and the rabbit in the Sheets chapter, tries a **free sheet in every class**, and **subscribes to a class for a period** to open and print everything in it.

The customer site is a single file with no build step — `site/dist/index.html` — plus `viewer.html` (the protected PDF viewer) and `admin.js` (the staff dashboards). Behind it, `site/server.cjs` is a real backend: a JSON API, a **SQLite database** (Node's built-in `node:sqlite`, no npm packages), **Razorpay** payments and a **private PDF store** that only streams a sheet to a signed-in customer who holds an entitlement for it. Two earlier builds (a Next.js app and a Vite/React app) are kept under `archive/` for reference.

## How a sheet is opened

```
Learn With Why website → public worksheet catalogue → customer selects a PDF → login
        FREE ─────────────────────────── PAID → Razorpay Checkout → backend verifies the signature → entitlement
          └──────────────── server access check (POST /api/access/:id) ────────────────┘
                     → private PDF storage (site/protected/) → the PDF viewer (viewer.html)
                     → watermark (name · email · time) — the sheet stays on the account, no expiry
```

Every step is enforced on the server: the entitlement row in the database decides and the viewer only shows what `/api/view/*` streams. Entitlements do not expire; an admin can revoke one, and the open viewer closes within a minute.

## Quick start

```bash
git clone https://github.com/SumitDendage/kids-book-website.git
cd kids-book-website
cp site/.env.example site/.env   # Razorpay keys + admin key (optional: without keys a labelled demo gateway runs)
node site/server.cjs             # → http://127.0.0.1:4173  (needs Node 22.13+ / 24 for node:sqlite)
node site/test/smoke.cjs         # 33 end-to-end checks on a throw-away database
```

That is all: no `npm install`, no bundler. The database is created and seeded at `site/data/lww.sqlite` on first start. The site needs the Node server (it is not a static site any more — the API, the database and the PDF store live in the same process).

| Route | What it is |
|---|---|
| `/` | The customer site (Home · About us · What we do · Sheets · Contact us · Testimonials) |
| `/#sheets` | Jumps to the Sheets chapter (every chapter has an anchor) |
| `/viewer.html` | The protected PDF viewer (reached from the site with a view token) |
| `/#admin` | Admin account — sign up / sign in, then the admin dashboard |
| `/#developer` | Developer panel — sign up / sign in, then the developer dashboard |
| `/api/*` | The JSON API — see [site/README.md](site/README.md) for every route |

## Features

### Customer site
- **Cinematic scroll** — the six chapters glide as one stack while the 960 landscape frames scrub underneath; frames are decoded on demand with a memory cap, so the page stays smooth.
- **Fox & rabbit preview** — a 50-frame animation plays inside the Sheets chapter and behind the store page.
- **Glass UI** — transparent header pill with hover-jump links, logo tile with wordmark, frosted panels that let the landscape through.
- **Sign up / Sign in** on the first screen (name, email, password) — real accounts in the database, scrypt-hashed passwords, httpOnly session cookies; *Forgot password* with a six-digit code, "Keep me signed in". The role — Parent, Teacher, Tutor or School — is asked **after** sign-up.
- **Free-first shelf** — one shelf per class with the free sheet first and the rest beside it; a store page with **New · Bestselling · Free · Subscription** filters, classes and subjects.
- **Buy one PDF, or a class plan** — a paid sheet can be bought on its own (₹39–₹99) or with a class plan (1 month ₹199 · 3 months ₹499 · 1 year ₹1499) that opens every sheet in the class; other classes stay locked. Either way the purchase grants **a permanent entitlement** — the sheet stays on the account. Free sheets open for anyone signed in. Coupons and per-class discounts apply at checkout.
- **Razorpay** — the checkout creates a Razorpay order for the signed total (in paise), opens Razorpay Checkout (UPI, cards, net banking, wallets), and the backend verifies the payment signature — and the signed webhook — before it grants access. No keys configured → a clearly labelled demo gateway, nothing charged.
- **Protected PDF viewer** — PDFs live outside the web root and are streamed only to the signed-in buyer, rendered with pdf.js, stamped with the customer's name, email and time (as an overlay and baked into the pixels). Context menu, drag, copy, print and save shortcuts are blocked; the page blurs when the window loses focus.
- **Checkout with server-side pricing** — country, address, city, state and PIN/ZIP; India is detected automatically (INR, GST 18%, 6-digit PIN, Indian states) and other countries get their own currency, tax and postal format. The server computes **base price + tax + platform/payment fee = total**, returns a signed quote, and only accepts a valid signed quote as an order — prices cannot be changed from the browser. Razorpay is connected; PayPal / Stripe are listed as coming soon.
- **My Account → My Worksheets** lists every entitlement from the database; **print** produces an A4 page carrying the plan line.
- **Creative copy for children** — a rotating *"Today's why"* question and playful lines in every chapter.
- **SEO** — descriptive title/description, Open Graph & Twitter cards, JSON-LD (Organization, WebSite, ItemList of products), sitemap, robots, favicon, crawlable anchors.

### Staff panels
| Admin (`/#admin`) | Developer (`/#developer`) |
|---|---|
| Overview with sales chart | System health, uptime, heap, FPS |
| **Products** — book studio with drag-and-drop cover & PDF, rating, category, price, stock, audience, print/download limits; card gallery with search & filters | Errors & stack traces (captured automatically) |
| **Orders** — live from the database once the admin key is saved (Settings → Server connection); status changes are written back | API monitoring (every `fetch`, status, latency) |
| **Customers** — every account in the database: plans, orders, total spending, downloads | Database health (tables, sizes, quota) |
| **Settings → Server connection** — the admin key that connects the dashboards to the database | |
| **Analytics** — sales, visitors, conversion funnel, top products, sources | Payment, webhook and authentication logs |
| Coupons & discounts | Performance (DOM ready, load, first paint) |
| Content management (home page copy) | Security events (failed logins) |
| Roles & permissions (admin / editor / support / developer) | Deployments (version + latest commits) |
| Audit logs | Backups (export / restore JSON), audit logs |

## Repository structure

```
kids-book-website/
├── site/                     ← the live site + backend (run this)
│   ├── server.cjs            entry point: static site + JSON API on :4173
│   ├── server/               the backend modules
│   │   ├── db.cjs            SQLite (node:sqlite): schema, settings, seeding
│   │   ├── seed.cjs          the worksheet catalogue the database starts with
│   │   ├── auth.cjs          accounts, sessions, password reset
│   │   ├── pricing.cjs       countries, tax, fees, signed quotes
│   │   ├── payments.cjs      Razorpay orders, signature verification, webhook, demo gateway
│   │   ├── access.cjs        entitlements, the access check, view tokens, PDF streaming
│   │   ├── admin.cjs         staff API (orders, customers, worksheets + PDF upload, settings)
│   │   └── http.cjs          request helpers, cookies, rate limiting
│   ├── test/smoke.cjs        end-to-end test of the whole flow
│   ├── .env.example          RAZORPAY_KEY_ID / _SECRET / _WEBHOOK_SECRET, ADMIN_KEY, SITE_URL
│   ├── data/lww.sqlite       the database — created on first run, git-ignored
│   ├── protected/            PRIVATE PDF STORAGE — never served as static files
│   │   ├── a-to-z/           the 26 free alphabet sheets (PDF + page image)
│   │   └── uploads/          PDFs uploaded through the admin API
│   ├── README.md             the backend: flow, database tables, every API route, Razorpay setup
│   └── dist/
│       ├── index.html        the whole customer site: styles, markup, script
│       ├── viewer.html       the protected PDF viewer: pdf.js, watermark, protection
│       ├── admin.js          admin + developer dashboards
│       ├── frames-webp/      960 landscape frames (scroll background)
│       ├── preview-frames/   50 fox & rabbit frames
│       ├── fonts/            Cormorant Garamond + Inter, self-hosted
│       ├── sheets/           public thumbnails only
│       ├── favicon.svg · og.jpg · robots.txt · sitemap.xml
├── archive/
│   ├── learn-with-why/       earlier Next.js 16 build (frame scrub, ring gallery, Library)
│   └── papercub-react/       earlier Vite/React build
└── README.md
```

## Editing content

Everything the customer reads lives at the top of the `<script>` in `site/dist/index.html`:

| Constant | Controls |
|---|---|
| `NAV` | chapter names in the header |
| `CLASSES`, `SUBJECTS` | the categories |
| `CATALOGUE`, `SHEETS`, `WORKSHEETS` | the shelf (`price: 0` = free access sheet) |
| `PLANS` | subscription lengths and prices |
| `ROLES` | Parent / Teacher / Tutor / School |
| `PAY` | payment methods offered at checkout |
| `WHYS` | the rotating "Today's why" questions |

Chapter copy is plain HTML in the six `<section class="chapter">` blocks. Prices, page counts and which sheets have a real PDF come from the database at load time (`GET /api/worksheets`) and override the constants; change them with the admin API (`PUT /api/admin/worksheets/:id`, `POST …/:id/file` to upload the PDF) — see [site/README.md](site/README.md).

## Going live

1. **Razorpay** — put `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` in `site/.env` (test keys first), add a webhook for `payment.captured`, `order.paid` and `payment.failed` at `https://<host>/api/pay/webhook` and put its secret in `RAZORPAY_WEBHOOK_SECRET`. The demo gateway switches itself off as soon as keys are present.
2. **Admin key** — set `ADMIN_KEY`, then save the same key in Admin → Settings → Server connection so the dashboards read the database.
3. **PDFs** — upload each worksheet's PDF with `POST /api/admin/worksheets/:id/file` (or drop `<id>.pdf` into `site/protected/`), and set its price with `PUT /api/admin/worksheets/:id`.
4. **Host** — run `node site/server.cjs` behind HTTPS (set `SITE_URL=https://…` so the session cookie is `Secure`; behind a proxy pass `X-Forwarded-Proto` and the country header). Keep `site/data/` and `site/protected/` on persistent storage and back them up.
5. **Email** — forgot-password codes are printed on the server console; set `NODE_ENV=production` so they are no longer returned to the browser, and plug a mail sender into `site/server/auth.cjs` (`forgot`).
6. **Domain** — the SEO tags, sitemap and robots assume `https://learnwithwhy.in`; change it before deploying and submit the sitemap in Google Search Console.
7. **Staff accounts** — the admin / developer sign-in is still a browser demo; the database and the admin API are protected by `ADMIN_KEY`.

## Roadmap
- [x] Backend + SQLite database (accounts, orders, entitlements, access log)
- [x] Razorpay (orders, signature verification, webhook)
- [x] Protected PDF storage, watermarked viewer, permanent entitlements (admin revoke)
- [ ] PayPal / Stripe for international customers
- [ ] Email for password reset and order receipts
- [ ] Staff accounts and roles in the database
- [ ] Server-side PDF stamping (the watermark is applied in the viewer today)

## License

**Proprietary — all rights reserved.** This repository, its code, design, artwork and every worksheet belong to **Learn With Why** as a business; no individual holds or is credited with ownership. Nothing here may be copied, reused, redistributed or used to build another product without written permission, and the [LICENSE](LICENSE) file and copyright notices may not be removed or altered by anyone. See [LICENSE](LICENSE).

## Credits

Design, artwork, copy and code © Learn With Why. Fonts: Cormorant Garamond and Inter (open licences).
