# `legacy/` — old copies, kept for reference

## `old-static-site/`

This is the **original plain-HTML website** of Learn With Why, from before the React version in [`frontend/`](../frontend/). Until October 2026 it was the folder `site/dist`.

| File or folder | What it is |
|---|---|
| `index.html` | The whole old site in one page: the landscape, the sheets, sign-in, the shop and checkout. |
| `viewer.html` | The old protected PDF viewer. |
| `admin.js` | The old staff dashboards (Admin and Developer). |
| `frames-webp/`, `preview-frames/` | The 960 landscape frames, and 50 preview frames. |
| `fonts/` | Cormorant Garamond and Inter. |
| `sheets/` | The sheet thumbnails (`a-to-z`, `colour`, `matching`, `reading`, `spot`). |
| `favicon.svg`, `og.jpg`, `robots.txt`, `sitemap.xml` | The small extras every site has. |

It is kept **for reference only**. The React website was built from it: some files in `frontend/src` say in their first lines which part of this folder they were moved from.

### It is not served any more

The server only serves the React website built in `frontend\dist`. It used to fall back to this folder when the React site was not built; now an unbuilt site shows "Not found: the website is not built yet", and the server window says how to build it.

The old site would not work properly with today's server anyway:

- **It calls API routes that have since been renamed.** For example, its "Forgot password?" form calls `/api/auth/forgot` and `/api/auth/reset`; the server now has `/api/auth/forgot-password` and `/api/auth/reset-password` instead (and sends a link by email rather than a code).
- **It lacks the newest sheets.** It has no thumbnails for the `sound` and `sound-exercise` sheets and does not list them.

### Looking at it anyway

If you really want to see it in the browser, add this line to `backend\.env`:

```
STATIC_DIR=../legacy/old-static-site
```

Then restart the server (Ctrl+C in its window, then `npm start` in the `backend` folder) and open http://127.0.0.1:4173. The path is read from the `backend` folder, and the `site` line in the server window shows which folder is served.

While that line is there, the server shows the old site **instead of** the React one. To go back, delete the line (or put `#` in front of it) and restart the server.

### Deleting it

Nothing in the website or the server loads this folder, and it takes about 230 MB. Deleting it is fine **once the owner agrees**: git history keeps every file, so it can always be brought back.
