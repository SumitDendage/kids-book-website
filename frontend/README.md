# Learn With Why: website

The customer website, the staff panels and the protected worksheet viewer for
[www.learnwithwhy.com](https://www.learnwithwhy.com), built with **React 19** and **Vite 8**.

The website is static files only. It talks directly to the Supabase server (see
[`../supabase`](../supabase/README.md)) from the visitor's browser, so plain web hosting is enough.

## Requirements

- [Node.js](https://nodejs.org) 20.19 or newer (the publish workflow uses Node 22)

## Commands

```bash
npm install        # once, and after dependencies change
npm run dev        # development site at http://localhost:5173 with instant reload
npm run build      # production build in dist/, then the SEO topic pages and sitemap
npm run preview    # serve the production build locally
npm test           # unit tests (tests/*.test.mjs)
npm run check:supabase   # check the configured Supabase address and public key answer
```

The development site uses the **live** server, with real accounts and orders. To sign in from
`localhost`, the server's `ALLOWED_ORIGINS` secret must include `http://localhost:5173`
(see [SETUP.md step 3](../supabase/docs/SETUP.md#3-the-website-address)).

The build fetches the live catalogue for the SEO pages. Set `SEO_OFFLINE=1` to use the saved copy in
`scripts/seo-catalogue-snapshot.json` instead; the build also falls back to it when the API cannot be
reached.

## Configuration

Settings are read from `.env.production` (used by builds) and an optional `.env.local`. Copy
[`.env.example`](.env.example) to start.

| Variable | Purpose |
|---|---|
| `VITE_SUPABASE_URL` | The Supabase project address |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | The project's **publishable** key (starts with `sb_publishable_`) |
| `VITE_API_BASE_URL` | Optional: another API address, for a local test server |
| `VITE_DEV_API_PROXY` | Optional: where `npm run dev` forwards `/api` when `VITE_API_BASE_URL` is `/` |

> **Never put a secret in a `VITE_` variable.** Everything starting with `VITE_` is copied into the
> JavaScript every visitor downloads. Payment, email and database secrets belong only in
> Supabase → Edge Functions → Secrets.

## Deployment

Merging into `main` publishes the site automatically: GitHub Actions tests and builds it and
Hostinger picks up the new build (see the main [README](../README.md#deployment)). To deploy by hand,
upload everything inside `dist/`, including the hidden `.htaccess`, to the website's `public_html`.

`public/.htaccess` makes `/admin`, `/developer` and every other page address open the site, sends
`/viewer` to the worksheet viewer and sets caching and file types.

## Project layout

| Folder | Contents |
|---|---|
| `src/components` | Page sections: home chapters, sheets and vocabulary board, store, checkout, account, security notices, AI helper |
| `src/pages` | `Admin/` and `Developer/` panels, `Portal/` (staff sign-in), `Viewer/`, `AccountBlocked/` |
| `src/layouts` | `SiteLayout`, which holds every chapter and overlay |
| `src/context` | Shared state: the signed-in customer, security status, popups and toasts |
| `src/services` | The API client (`api.js`), Supabase sign-in (`supabaseAuth.js`), checkout, FAQ search, the 960-frame scroll engine, walking animals and scenery, viewer drawing |
| `src/hooks` | Scroll input, the fox-and-rabbit preview, My Worksheets |
| `src/data` | Site text, classes, catalogue, prices, plans and the FAQ answers (`faq.json`) |
| `src/styles` | Stylesheets, loaded in file-number order |
| `src/assets` | Logo, animal sprites and the vocabulary board picture |
| `public` | Landscape frames, sheet thumbnails, fonts, `.htaccess`, SEO files |
| `scripts` | `build-seo-pages.mjs` (static topic pages and sitemap after the build), `check-supabase.mjs`, `diagnose-routes.mjs` |
| `tests` | Unit tests for the API client, sign-in, FAQ search and the SEO pages |

## Editing content

Most customer-facing text lives in `src/data/`:

| File | What it controls |
|---|---|
| `content.js` | Menu, classes, subjects, home text, account types, plan names, testimonials, the "Today's why" questions |
| `catalogue.js` | The sheet shelf, the Kindergarten sections and the built-in free list |
| `checkout.js` | The ways to pay shown at checkout |
| `faq.json` | The answers used by the Ask AI helper |

Prices, access time, plans and which sheets are on sale come from the server and are managed in
**Admin → Products** and **Admin → Settings**; the values in `src/data` are only fallbacks.

Worksheet PDFs are never stored here. They live in the server's private storage and are only sent,
watermarked, to someone allowed to open them.
