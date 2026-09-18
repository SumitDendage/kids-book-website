# Learn With Why

Printable sheets for Nursery to Class 3, sold from a cinematic Next.js storefront: a fox
and a rabbit study under an old tree while you scroll, the shelf sits over them in glass,
one sheet in every class is free, the rest unlock into a Library that opens and prints
inside the site.

## Run

```bash
npm install
npm run dev        # http://localhost:3000
npm run build      # production build (static pages for every sheet)
```

## What is where

```
app/
  layout.jsx             fonts (Cormorant Garamond + Nunito via next/font), providers, nav, overlays
  page.jsx               landing: Stage (hero + sheets over the frames) · About · Contact · Testimonials · Footer
  sheets/[id]/page.jsx   sheet detail — what's inside, preview pages, licence, Pay now / Add to bag
  library/page.jsx       My Library — open, print, lock
  globals.css            design tokens + every component
components/
  ui/Logo.jsx            the tree-in-a-crescent mark (SVG; draws itself on in the loader)
  ui/Motion.jsx          Reveal · SplitWords · Magnetic · Tilt · CountUp
  chrome/                Loader, Nav (active section, compact on scroll, menu drawer), Overlays (bag, auth, toast)
  site/FrameScene.jsx    the 50 fox-and-rabbit frames, scrubbed by scroll
  site/Stage.jsx         pinned canvas + hero + Sheets
  site/RingGallery.jsx   Three.js ring of covers, camera in the middle (hover pauses, drag spins, click opens)
  site/Sheets.jsx        class chips → subject chips → glass sheet cards (free / locked)
  site/SheetDetail.jsx   detail + Pay now
  site/Sections.jsx      About (parallax frame), Testimonials (drag carousel), Contact, Footer
  library/Library.jsx    Library cards, protected viewer, print confirmation, print job
lib/
  content.js             every word, class, subject, sheet, licence and price
  store.jsx              app state: session, bag, Library, toast, drawers, pending actions after sign-in
  authStore.js           auth: Supabase online, localStorage demo offline
  libraryStore.js        licences: checkout, consume a print, DRM status
  pages.js               draws a sheet's pages in the browser
public/frames/           frame_001.jpg … frame_050.jpg
supabase/                schema + RLS + checkout/consume_print functions, drm-protect edge function
```

## Editing the shelf

Everything is in `lib/content.js`:

- `CLASSES` and `SUBJECTS` — classes and subjects (a subject only shows for a class that has sheets in it).
- `SHEETS` — each sheet's class, subject, pages, price (`0` = free access sheet), blurb and skills.
- `LICENCES` — print allowance and price factor per licence type.

## Commerce flow

Free sheet → *Open free* → (sign in) → Library. Paid sheet → *Unlock* (bag) or *Pay now* (one
click) → (sign in) → Library. In the Library a sheet opens in the protected viewer and prints
with a confirmation; one print session uses one licence copy and the sheet locks when the
copies are gone, keeping only its purchase record. A guest who clicks Pay now or Open free is
asked to sign in and the action completes by itself afterwards.

**Payment is not wired yet** — checkout creates licences without charging. The `checkout`
database function marks where a Razorpay/Stripe payment id must be verified.

## Backend (optional)

Without `.env.local` the site runs as a front-end demo (accounts, bag and Library in
localStorage). To go online, create a Supabase project, copy `.env.example` to `.env.local`,
run `supabase/migrations/20260916000000_library.sql`, upload master PDFs to the private
`masters` bucket (`<sheet id>.pdf`), and deploy `supabase/functions/drm-protect` with
`VERYPDF_EMAIL` set — VeryPDF DRM Protector then prepares a protected copy per purchase whose
print count is enforced by their secure reader.

## Motion

CSS handles class-driven reveals (`.split`) and hover; Motion handles mount/unmount, springs,
scroll-linked values (`useScroll` drives the frame scrub and the About parallax) and drag.
`prefers-reduced-motion` turns transforms off in both, stops the ring from turning and the
testimonials from auto-advancing.
