# Learn With Why — React (Vite) version

The same website as `site/dist`, rebuilt with React and Vite. The design, words,
animations and features are unchanged; only the way the code is organised is new.
The original `site/` folder is left exactly as it was.

## What you need

- Node.js 20.19 or newer (Node 22 recommended) — https://nodejs.org

## Run it on your computer (Windows)

1. Open the `react-app` folder in File Explorer.
2. Click the address bar, type `cmd`, press Enter. A black window opens in that folder.
3. Type these, pressing Enter after each:

   ```
   npm install
   npm run dev
   ```

4. Open http://localhost:5173 in your browser.

Sign-in, the shop, checkout and the sheet viewer talk to the Node backend
(`node site/server.cjs`, on http://127.0.0.1:4173). Start it in a second window
and the React dev server forwards every `/api/...` call to it. Without the
backend the pages still open, but anything that needs the server shows its
normal "could not reach the server" messages.

## Build the files for Hostinger

```
npm run build
```

This creates a `dist` folder. Upload **everything inside `dist`** (including the
hidden `.htaccess` file) into `public_html` on Hostinger. `npm run preview`
shows the built site locally first.

The `.htaccess` file makes `/admin`, `/developer` and any other page address
open the site, keeps images and fonts working, and sends `/viewer` to the
sheet viewer.

## Settings

Copy `.env.example` to `.env` if you need to change anything:

- `VITE_API_BASE_URL` — leave empty when the API is on the same domain (normal).
  Set it only if the Node backend runs on another address.
- `VITE_DEV_API_PROXY` — where `npm run dev` finds the backend.

Never put secret keys (Razorpay secret, admin key, database passwords) in `.env`
for this app: everything starting with `VITE_` ends up inside the public website.
Secrets belong only in the backend's own `site/.env`.

## Where things are

| Folder | What is in it |
| --- | --- |
| `src/components` | The pieces of the page: navbar, chapters, sheet cards, store, checkout, modals, dashboard parts |
| `src/pages` | The staff pages (`Admin/`, `Developer/`, `Portal/`) and the sheet `Viewer/` |
| `src/layouts` | The site layout that holds every chapter and overlay |
| `src/context` | Shared state: who is signed in, which popup is open, toasts |
| `src/services` | Talking to the server (`api.js`), the 960-frame scroll animation, the viewer drawing |
| `src/hooks` | Reusable behaviour: scroll input, the fox-and-rabbit preview, My Worksheets |
| `src/data` | The words, classes, sheets and prices shown on the site |
| `src/styles` | The original CSS, split into files but not changed |
| `public` | Fonts, the 960 landscape frames, the 50 preview frames, sheet pictures, SEO files, `.htaccess` |

The private PDFs in `site/protected` are **not** in this app on purpose: they are
only ever sent by the backend to a signed-in customer who owns the sheet.
