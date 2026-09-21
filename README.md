<div align="center">

# Learn With Why

**Printable worksheets and activity sheets for children aged 3–8 — sold by class subscription, wrapped in a cinematic scroll-driven website.**

[Live demo](#quick-start) · [Features](#features) · [Structure](#repository-structure) · [Admin & developer panels](#staff-panels) · [Go live](#going-live) · [Roadmap](#roadmap)

![Site version](https://img.shields.io/badge/version-2026.09.17-f0b455) ![Stack](https://img.shields.io/badge/stack-vanilla%20HTML%20%2B%20JS-1f6b47) ![Build](https://img.shields.io/badge/build-none%20required-8fd6d2) ![License](https://img.shields.io/badge/license-proprietary-555)

</div>

---

## Overview

Learn With Why is a storefront for a small studio in Pune that draws calm, ink-light learning sheets for Nursery to Class 3. A customer scrolls through six chapters of a floating-island landscape (960 frames scrubbed by the scroll), meets the fox and the rabbit in the Sheets chapter, tries a **free sheet in every class**, and **subscribes to a class for a period** to open and print everything in it.

The whole customer site is a single file with no build step — `site/dist/index.html` — plus `admin.js` for the staff dashboards. Two earlier builds (a Next.js app and a Vite/React app) are kept under `archive/` for reference.

## Quick start

```bash
git clone https://github.com/SumitDendage/kids-book-website.git
cd kids-book-website
node site/server.cjs        # → http://127.0.0.1:4173
```

That is all: no `npm install`, no bundler. Any static host works too — serve the `site/dist/` folder.

| Route | What it is |
|---|---|
| `/` | The customer site (Home · About us · What we do · Sheets · Contact us · Testimonials) |
| `/#sheets` | Jumps to the Sheets chapter (every chapter has an anchor) |
| `/#admin` | Admin account — sign up / sign in, then the admin dashboard |
| `/#developer` | Developer panel — sign up / sign in, then the developer dashboard |

## Features

### Customer site
- **Cinematic scroll** — the six chapters glide as one stack while the 960 landscape frames scrub underneath; frames are decoded on demand with a memory cap, so the page stays smooth.
- **Fox & rabbit preview** — a 50-frame animation plays inside the Sheets chapter and behind the store page.
- **Glass UI** — transparent header pill with hover-jump links, logo tile with wordmark, frosted panels that let the landscape through.
- **Sign up / Sign in** on the first screen (name, email, password), *Forgot password* with a six-digit code, "Keep me signed in". The role — Parent, Teacher, Tutor or School — is asked **after** sign-up.
- **Free-first shelf** — one shelf per class with the free sheet first and the rest beside it; a store page with **New · Bestselling · Free · Subscription** filters, classes and subjects.
- **Class subscriptions** — pick a class and a period (1 month ₹199 · 3 months ₹499 · 1 year ₹1499); every sheet in that class opens and prints until the period ends; other classes stay locked. Coupons and per-class discounts apply at checkout.
- **Checkout with server-side pricing** — country, address, city, state and PIN/ZIP; India is detected automatically (INR, GST 18%, 6-digit PIN, Indian states) and other countries get their own currency, tax and postal format. The server (`site/server.cjs`) computes **base price + tax + platform/payment fee = total**, returns a signed quote, and only accepts a valid signed quote as an order — prices cannot be changed from the browser. Razorpay / PayPal / Stripe are offered per region (gateways not connected yet — demo orders).
- **Cart** lists subscriptions with days left; **print** produces an A4 page carrying the plan and expiry.
- **Creative copy for children** — a rotating *"Today's why"* question and playful lines in every chapter.
- **SEO** — descriptive title/description, Open Graph & Twitter cards, JSON-LD (Organization, WebSite, ItemList of products), sitemap, robots, favicon, crawlable anchors.

### Staff panels
| Admin (`/#admin`) | Developer (`/#developer`) |
|---|---|
| Overview with sales chart | System health, uptime, heap, FPS |
| **Products** — book studio with drag-and-drop cover & PDF, rating, category, price, stock, age group, audience, print/download limits; card gallery with search & filters | Errors & stack traces (captured automatically) |
| **Orders** — pending · paid · shipped · delivered · cancelled · refunded | API monitoring (every `fetch`, status, latency) |
| **Customers** — profile, orders, total spending, downloads, print usage | Database health (tables, sizes, quota) |
| **Analytics** — sales, visitors, conversion funnel, top products, sources | Payment, webhook and authentication logs |
| Coupons & discounts | Performance (DOM ready, load, first paint) |
| Content management (home page copy) | Security events (failed logins) |
| Roles & permissions (admin / editor / support / developer) | Deployments (version + latest commits) |
| Audit logs | Backups (export / restore JSON), audit logs |

## Repository structure

```
kids-book-website/
├── site/                     ← the live site (serve this)
│   ├── server.cjs            static server + pricing/checkout API on :4173
│   ├── data/db.json          server database (plans, coupons, rates, orders) — created on first run, git-ignored
│   ├── README.md             how the site is put together, where to edit content
│   └── dist/
│       ├── index.html        the whole customer site: styles, markup, script
│       ├── admin.js          admin + developer dashboards
│       ├── frames-webp/      960 landscape frames (scroll background)
│       ├── preview-frames/   50 fox & rabbit frames
│       ├── fonts/            Cormorant Garamond + Inter, self-hosted
│       ├── favicon.svg · og.jpg · robots.txt · sitemap.xml
├── archive/
│   ├── learn-with-why/       earlier Next.js 16 build (frame scrub, ring gallery, Supabase + DRM backend files)
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

Chapter copy is plain HTML in the six `<section class="chapter">` blocks. The admin panel can also change products, plan prices, coupons and home-page copy without touching code (stored in the browser in demo mode).

## Going live

The site runs today as a **front-end demo**: accounts, subscriptions, orders and logs are kept in the browser's storage. To launch:

1. **Payments** — `POST /api/order` in `site/server.cjs` is where the gateway is called: create the Razorpay / PayPal / Stripe order with the signed quote's total, open the gateway in the browser, and grant the subscription from the webhook. Set `ADMIN_KEY` for the admin endpoints.
2. **Backend** — `archive/learn-with-why/supabase/` already contains a Postgres schema with row-level security, `checkout()` / `consume_print()` functions and a VeryPDF DRM edge function; point the storage helpers at it.
3. **Staff auth** — replace the demo staff sign-up with real accounts and roles.
4. **Domain** — the SEO tags, sitemap and robots assume `https://learnwithwhy.in`; change it before deploying and submit the sitemap in Google Search Console.

## Roadmap
- [ ] Payment gateway integration (Razorpay first)
- [ ] Supabase auth + database behind the storage helpers
- [ ] Real PDFs per sheet with DRM-protected printing
- [ ] Email for password reset and order receipts

## License

**Proprietary — all rights reserved.** This repository, its code, design, artwork and every worksheet belong to **Learn With Why** as a business; no individual holds or is credited with ownership. Nothing here may be copied, reused, redistributed or used to build another product without written permission, and the [LICENSE](LICENSE) file and copyright notices may not be removed or altered by anyone. See [LICENSE](LICENSE).

## Credits

Design, artwork, copy and code © Learn With Why. Fonts: Cormorant Garamond and Inter (open licences).
