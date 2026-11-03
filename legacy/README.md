# Legacy: the original website

## `old-static-site/`

The **original plain-HTML version** of [www.learnwithwhy.com](https://www.learnwithwhy.com), from before the React website in [`frontend/`](../frontend/). Until October 2026 it was the folder `site/dist`.

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

### Status

It is **not used by the live website**, which is built from [`frontend/`](../frontend/). It also calls
API routes of the old Node server that no longer exist, so sign-in and the shop do not work in it.

To look at its design, open `old-static-site/index.html` with any static file server, for example
`npx serve legacy/old-static-site`.

Nothing loads this folder, and it takes about 230 MB. It can be removed with the owner's agreement;
git history keeps every file.
