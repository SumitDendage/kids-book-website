# `site/` — the Learn With Why website

One HTML file, no build step. Serve `dist/`:

```bash
node server.cjs      # http://127.0.0.1:4173
```

## Files

| File | Purpose |
|---|---|
| `dist/index.html` | The customer site: design tokens and styles, the six chapters, and the page script (frame engine, scroll, auth, shelf, store, subscriptions, checkout, cart, staff sign-in). |
| `dist/admin.js` | The Admin and Developer dashboards. Loaded after the page script; shares its data. |
| `dist/frames-webp/` | 960 landscape frames scrubbed by the scroll. Loaded lazily (key frames first, then a window around the playhead), capped in memory. |
| `dist/preview-frames/` | 50 fox & rabbit frames for the Sheets player and the store background. |
| `dist/fonts/` | Cormorant Garamond (headings) and Inter (UI), self-hosted. |
| `dist/favicon.svg`, `og.jpg`, `robots.txt`, `sitemap.xml` | SEO and social assets. |

## How the page is organised

`index.html` reads top to bottom:

1. **`<style>`** — tokens (`--fg`, `--glass`, fonts, radii, easing), then components in the order they appear on screen.
2. **Markup** — veil, header, the six `<section class="chapter">` blocks, chrome (counter, hint, toast), drawers, the store page, checkout page, staff page.
3. **`<script>`**, in blocks:
   - `CONTENT` — `NAV`, `CLASSES`, `SUBJECTS`, `CATALOGUE`, `SHEETS`, `WORKSHEETS`, `ROLES`, `PLANS`, `PAY`, `WHYS`
   - `STORAGE` — `read`/`write` helpers, telemetry (`logEvent`, error capture, `fetch` monitor), subscriptions
   - `FRAME ENGINE` — loading, eviction and drawing of the landscape frames
   - `CHAPTERS` — the continuous scroll, chapter lean/fade, active section, hash routing
   - `NAV`, `TOAST`
   - `CHAPTER 01` — sign up / sign in / forgot password, role after sign-up
   - `CHAPTER 02` — fox & rabbit player and sheet carousel
   - `THE STORE` — New / Bestselling / Free / Subscription, classes, subjects
   - `CHECKOUT` — class + plan chooser, coupons and discounts, payment methods
   - `SHELF` — free-first grid per class in the Sheets chapter
   - `CONTACT`, `TESTIMONIALS`
   - `CART · UNLOCK · PRINT`
   - `STAFF` — staff sign-up / sign-in and the hand-off to `admin.js`
   - `BOOT` — price/product/content overrides from the admin panel, then the veil lifts

## Data (demo mode)

Everything is stored in the browser under `lww_*` keys until a backend is connected:

`lww_users`, `lww_session`, `lww_subs`, `lww_owned`, `lww_orders`, `lww_prints`, `lww_products`, `lww_prices`, `lww_plan_prices`, `lww_coupons`, `lww_discounts`, `lww_content`, `lww_roles`, `lww_staff_users`, `lww_staff`, `lww_events`, `lww_errors`, `lww_api`, `lww_payments`, `lww_webhooks`, `lww_security`, `lww_audit`.

The developer panel can export all of them as one JSON backup and restore it.

## Accessibility & motion

Native scrolling is replaced by an eased scroll of the chapter stack; keyboard (arrows, Page Up/Down, Home/End), touch and wheel all work. `prefers-reduced-motion` removes the lean, the hover jump and the rotating question, and stops the testimonials auto-advancing. Every overlay closes with Escape.
