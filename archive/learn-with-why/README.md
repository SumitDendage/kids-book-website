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
  authStore.js           auth: accounts and sessions in localStorage (demo)
  libraryStore.js        licences: checkout, consume a print (localStorage demo)
  pages.js               draws a sheet's pages in the browser
public/frames/           frame_001.jpg … frame_050.jpg
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

**Payment is not wired in this build** — checkout creates licences without charging.

## Backend

This build has no hosted backend: accounts, the bag and the Library live in the browser's
localStorage. The live site in `../../site/` has the real backend.

## Motion

CSS handles class-driven reveals (`.split`) and hover; Motion handles mount/unmount, springs,
scroll-linked values (`useScroll` drives the frame scrub and the About parallax) and drag.
`prefers-reduced-motion` turns transforms off in both, stops the ring from turning and the
testimonials from auto-advancing.
