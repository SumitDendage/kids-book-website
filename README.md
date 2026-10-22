<div align="center">

<img src="frontend/public/favicon.svg" alt="Learn With Why logo" width="88" height="88">

# Learn With Why

**Printable learning worksheets for Kindergarten to Class 3, in a hand-painted, animated storybook website.**

### 🌐 [www.learnwithwhy.com](https://www.learnwithwhy.com)

[![Website](https://img.shields.io/badge/website-learnwithwhy.com-2b1d4e?style=flat-square)](https://www.learnwithwhy.com)
![React 19](https://img.shields.io/badge/React-19-61dafb?style=flat-square&logo=react&logoColor=white)
![Vite 8](https://img.shields.io/badge/Vite-8-646cff?style=flat-square&logo=vite&logoColor=white)
![Supabase](https://img.shields.io/badge/backend-Supabase-3ecf8e?style=flat-square&logo=supabase&logoColor=white)
![Razorpay](https://img.shields.io/badge/payments-Razorpay-3395ff?style=flat-square&logo=razorpay&logoColor=white)
![Deploy](https://img.shields.io/badge/deploy-automatic-1f6b47?style=flat-square&logo=githubactions&logoColor=white)
![License](https://img.shields.io/badge/license-proprietary-555?style=flat-square)

[About](#about) · [Features](#features) · [Tech stack](#tech-stack) · [Architecture](#architecture) · [Getting started](#getting-started) · [Deployment](#deployment) · [Project structure](#project-structure) · [Security](#security) · [Roadmap](#roadmap) · [License](#license)

</div>

---

## About

**Learn With Why** is an online shop for printable worksheets that help young children learn by asking *why*. Parents, teachers and schools browse a growing library of English, Maths and Science sheets for **Kindergarten, Class 1, Class 2 and Class 3**, try the free sheets straight away, and buy the rest one sheet at a time or as a class subscription.

Every sheet opens in a **protected, watermarked viewer**, so the work of the authors stays safe while families and classrooms still get what they paid for. The whole site is wrapped in a scroll-driven, hand-painted landscape with walking animals, flying birds and running waterfalls.

| | |
|---|---|
| **Website** | [www.learnwithwhy.com](https://www.learnwithwhy.com) |
| **For** | Parents, teachers, tutors, schools and tuition centres |
| **Classes** | Kindergarten (live) · Class 1, 2 and 3 (coming soon) |
| **Subjects** | English · Maths · Science |
| **Library** | 115 printable PDF worksheets, 8 of them free |
| **Contact** | learnwithwhy6@gmail.com |

## Features

### 📚 Worksheet library

- **Kindergarten Alphabet**: seven skill sections, from letter tracing A to Z and letter recognition to matching, letters before and after, beginning sounds, ending sounds and missing letters.
- **Kindergarten Vocabulary**: an illustrated *Explore Vocabulary* board with 12 topic cards. **Colours**, **Shapes** and **Sizes** hold 10 sheets each (most with an answer page); the other topics are coming soon.
- **Free sheets**: 8 sheets (Alphabet A and B, Colours 1 to 3, Shapes 1 to 3) open for anyone, **no account needed**.
- **Thumbnails on every card**, so a customer sees each sheet before opening it.

### 🛒 Shop and payments

- **Shop page** with *All sheets · New · Bestselling · Free · Subscription* views, filters by class, subject and section, and search.
- **Cart and checkout**: buy one sheet or several at once. Every sheet is ₹19 by default; prices and labels are set by staff.
- **Class subscriptions**: open every sheet in a class while the plan runs. **India: 1, 3 or 6 months. Other countries: 1, 3, 6 or 12 months.**
- **Razorpay checkout** with cards, UPI (QR code or UPI ID) and wallets. Every payment is verified on the server (signature, order, amount and currency) before access is given. Stripe and PayPal for other countries are built in and switch on when their keys are added.
- **Server-side pricing** with country detection, GST for India, local currency and tax elsewhere, coupons and class discounts. The browser can never change a price.
- **Purchase email** with the order details, sent once email is configured.

### 🔐 Accounts and access

- **Sign up with email confirmation**: the customer chooses a password and confirms the address with a **6-digit code** sent by email.
- **Account types**, chosen once after sign-up: **Parent**, **Teacher** or **Organization** (school, tuition centre or group). Each type has its own print allowance per sheet (by default Parent 2, Teacher 4, Organization 300).
- **Timed access**: a bought sheet stays open for a set number of hours (**24 by default**, changeable by staff) with a **live countdown**, and leaves the account when the time runs out. The customer can buy it again at any time.
- **My Account**: my worksheets, class plans, order history, signed-in devices and security status.
- **Password reset**, account lockout after repeated wrong passwords, and "Keep me signed in".

### 🛡️ Protected viewer

- PDFs live in **private cloud storage**; nobody can download them directly.
- The server checks the customer's access on every request and **stamps their name and email into the PDF** before it is shown.
- The viewer checks access again every minute and closes the sheet when access ends.
- Right-click, drag, copy and the print and save shortcuts are blocked, and the page blurs when the window loses focus. Print is available only within the customer's allowance.

### 🚨 Account-sharing protection

- The server watches for one account being used on many devices, networks or countries at once.
- A **3-warning system**: staff confirm each case, the customer is warned (1 of 3, 2 of 3, 3 of 3), and after the third warning paid sheets are paused. Free sheets and My Account keep working.
- Customers can send an **appeal**; staff can block a single session, pause paid access or block a whole account.

### 🧑‍💼 Staff panels

Staff sign in at **`/admin`** or **`/developer`** with their own accounts. Roles are Owner, Administrator, Support, Content editor and Developer, and the server checks every action.

| Admin panel | Developer panel |
|---|---|
| **Dashboard**: revenue, sales, open access and visitors | **Health**: how the live system is doing |
| **Products**: add, edit, price, label, schedule and publish sheets; upload covers and PDFs | **Errors** and **Logs** from the server |
| **Categories**: create and order shop sections | **Emails**: every email sent, with retry |
| **Orders** and **Customers** with their history | **API monitoring** and **Performance** |
| **Security**: sharing cases, warnings, appeals and blocks | **Database** overview and **Backups** |
| **Messages**, **Coupons**, **Analytics** and **Content** | **Session controls** and **Deployments** |
| **Roles**: add staff and choose what each may do | |
| **Settings**: access hours, prints per account type, plans, fees, tax and sign-in rules | |
| **Audit logs**: every staff change, read-only | |

### 🌳 Experience and design

- **Cinematic scroll**: a hand-painted floating-island landscape made of 960 frames that move with the page.
- **Living scenery**: a fox, a deer and a rabbit walk along the bottom of the screen, birds fly across the sky and the waterfalls run, all drawn live. Reduced-motion settings are respected.
- **Magical forest look** with rounded Fredoka and Nunito fonts, pastel cards and candy-coloured buttons.
- **Ask Learn With Why AI**: a chat helper that answers common questions instantly from more than 200 prepared answers.
- **Contact form** that delivers notes straight to the shop's inbox.
- **Responsive** on phones, tablets and computers, with SEO tags, structured data, a sitemap and social sharing cards.

## Tech stack

| Layer | Technology |
|---|---|
| **Website** | React 19, Vite 8, React Router 7, pdf.js (protected viewer), canvas animation |
| **Server** | Supabase Edge Function (Deno, TypeScript) serving every `/api/*` route |
| **Database** | Supabase PostgreSQL with row-level security on every table |
| **Sign-in** | Supabase Auth (email and password, email codes, staff roles) |
| **Files** | Supabase private storage for the worksheet PDFs |
| **Payments** | Razorpay (India); Stripe and PayPal ready for other countries |
| **Email** | Supabase Auth emails; Brevo or Resend for receipts and notices |
| **Contact form** | Web3Forms |
| **Hosting** | Hostinger (website) · Supabase, Mumbai region (server and data) |
| **CI/CD** | GitHub Actions: test, build and publish on every merge to `main` |

## Architecture

```
            Visitor's browser
                   │
                   ▼
   ┌──────────────────────────────────┐        ┌────────────────────────────┐
   │  Website  (React + Vite)         │  API   │  Supabase                  │
   │  www.learnwithwhy.com · Hostinger├───────►│  Edge Function  "api"      │
   └──────────────────────────────────┘        │  PostgreSQL + RLS          │
                                               │  Auth · private PDF storage│
                                               └──────┬──────────────┬──────┘
                                                      │              │
                                                 Razorpay       Email provider
```

- The website is plain static files; it needs no server of its own.
- All business rules (prices, access, payments, warnings) are decided on the server, never in the browser.
- A sheet opens only when the server finds valid access for that customer, then streams a watermarked copy to the viewer.

## Getting started

**Requirements:** [Node.js](https://nodejs.org) 22.12 or newer (20.19 also works) and [Git](https://git-scm.com).

```bash
git clone https://github.com/SumitDendage/kids-book-website.git
cd kids-book-website/frontend
npm install
npm run dev
```

Open **http://localhost:5173**. The development site talks to the live server, so it uses real accounts and orders.

| Command (in `frontend/`) | What it does |
|---|---|
| `npm run dev` | Starts the development site with instant reload |
| `npm run build` | Builds the production website into `frontend/dist` |
| `npm run preview` | Serves the production build locally |
| `npm test` | Runs the website's tests |

> **Note:** The server only accepts calls from addresses listed in its `ALLOWED_ORIGINS` setting. To sign in from `localhost`, add `http://localhost:5173` there (see [supabase/docs/SETUP.md](supabase/docs/SETUP.md)).

### Pages

| Address | Page |
|---|---|
| `/` | The customer website (Home, About us, What we do, Sheets, Contact, Testimonials) |
| `/admin` | Admin panel (staff only) |
| `/developer` | Developer panel (staff only) |
| `/viewer` | The protected worksheet viewer |

## Deployment

The website is published **automatically**. Nothing has to be uploaded by hand.

1. A change is merged into `main`.
2. GitHub Actions ([`publish-website.yml`](.github/workflows/publish-website.yml)) runs the tests, builds the website and places the build on the `live-site` branch.
3. Hostinger pulls the `live-site` branch, and a scheduled job copies the new files into the live website within minutes.

The server is deployed separately to Supabase with the Supabase CLI (`supabase/deploy-server.bat` on Windows). Database changes live in [`supabase/migrations`](supabase/migrations). The full setup guide is [supabase/docs/SETUP.md](supabase/docs/SETUP.md).

## Project structure

```
kids-book-website/
├── frontend/                 The website (React + Vite)
│   ├── src/
│   │   ├── components/       Page sections: home, sheets, store, checkout, account, AI helper
│   │   ├── pages/            Admin, Developer, staff sign-in, viewer, account-blocked page
│   │   ├── services/         API client, sign-in, scroll engine, scenery and viewer drawing
│   │   ├── data/             Site text, catalogue, prices, FAQ answers
│   │   └── styles/           Stylesheets
│   ├── public/               Frames, sheet thumbnails, .htaccess, SEO files
│   └── tests/                Website tests
├── supabase/                 The server
│   ├── functions/api/        Edge Function: routes, services, payment gateways
│   ├── migrations/           Database schema and changes, in order
│   ├── tests/                API, database and browser tests
│   └── docs/                 Setup, design, security and configuration guides
├── legacy/old-static-site/   The original HTML website, kept for reference
└── .github/workflows/        Automatic website publishing
```

### Documentation

| Document | Contents |
|---|---|
| [frontend/README.md](frontend/README.md) | Working on the website |
| [supabase/README.md](supabase/README.md) | How the server is put together |
| [supabase/docs/SETUP.md](supabase/docs/SETUP.md) | One-time server setup, step by step |
| [supabase/docs/DESIGN.md](supabase/docs/DESIGN.md) | Every API route and business rule |
| [supabase/docs/SECURITY.md](supabase/docs/SECURITY.md) | Security and account-sharing policy |
| [supabase/docs/MISSING-CONFIG.md](supabase/docs/MISSING-CONFIG.md) | Settings still to be filled in, and safe defaults |
| [legacy/README.md](legacy/README.md) | The original static website |

## Security

- **No secrets in this repository.** Server keys (payments, email, database) are stored only in Supabase → Edge Functions → Secrets. The website contains public values only.
- **Row-level security** is enabled on every database table; the browser never reads tables directly.
- **Payments are verified on the server** before any access is given, and a repeated payment message never gives access twice.
- **PDFs are private** and are only ever sent watermarked, to a signed-in customer with valid access (free sheets are watermarked as free copies).
- **Every staff action is checked by role** on the server and written to the audit log.

Found a security problem? Please email **learnwithwhy6@gmail.com** rather than opening a public issue.

## Roadmap

- [x] React + Vite website with the animated storybook design
- [x] Supabase server, database with row-level security and private PDF storage
- [x] Sign-up with email code, account types and staff roles
- [x] Razorpay payments, cart, class subscriptions and coupons
- [x] Watermarked protected viewer with timed access and countdown
- [x] Account-sharing detection with the 3-warning system and appeals
- [x] Admin product manager: labels, scheduling, sections and categories
- [x] Free sheets without an account
- [x] Automatic website publishing to Hostinger
- [ ] Class 1, Class 2 and Class 3 worksheets
- [ ] More Vocabulary topics
- [ ] Stripe and PayPal live for international customers
- [ ] A fully AI-powered assistant

## License

**Proprietary. All rights reserved.** This repository, including its code, design, artwork and every worksheet, belongs to **Learn With Why**. Nothing here may be copied, reused, redistributed or used to build another product without written permission. See [LICENSE](LICENSE).

<div align="center">

---

Made with care for curious young minds · **[www.learnwithwhy.com](https://www.learnwithwhy.com)**

© 2026 Learn With Why

</div>
