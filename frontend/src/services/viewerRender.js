/* Drawing the licensed pages. Canvas pixels are drawn straight into the stage
   element (not through React state): each page is a canvas, the watermark overlay
   and the page number. Moved from legacy/old-static-site/viewer.html; PDF.js is
   bundled (pdfjs-dist, loaded on demand) instead of fetched from a CDN. The PDF itself
   arrives already stamped by the server with the customer's details. */

/* one page: canvas + 24 watermark stamps + "n / total" */
export function pageEl(stage, n, total, stamp) {
  const d = document.createElement('div'); d.className = 'page';
  const cv = document.createElement('canvas');
  const wm = document.createElement('div'); wm.className = 'wm';
  for (let i = 0; i < 24; i++) { const s = document.createElement('span'); s.textContent = stamp; wm.appendChild(s); }
  const pn = document.createElement('span'); pn.className = 'pn'; pn.textContent = (n + 1) + ' / ' + total;
  d.append(cv, wm, pn); stage.appendChild(d);
  return cv;
}
/* the page keeps the shape of what was drawn (a landscape chart stays landscape) */
const shape = (cv, W, H) => { if (cv.parentElement && W > 0 && H > 0) cv.parentElement.style.aspectRatio = W + ' / ' + H; };

/* a second, lighter stamp is baked into the pixels themselves, so a screenshot carries it */
export function bake(ctx, W, H, stamp) {
  ctx.save(); ctx.globalAlpha = 0.12; ctx.fillStyle = '#1f6b47'; ctx.font = 'bold ' + Math.round(W / 36) + 'px Inter, sans-serif';
  ctx.translate(W / 2, H / 2); ctx.rotate(-0.5);
  for (let y = -H * 0.6; y < H * 0.6; y += H / 10) ctx.fillText(stamp, -W * 0.5, y);
  ctx.restore();
}

let pdfjs = null;
async function loadPdfjs() {
  if (!pdfjs) {
    const [lib, worker] = await Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')]);
    lib.GlobalWorkerOptions.workerSrc = worker.default;
    pdfjs = lib;
  }
  return pdfjs;
}

/* the real PDF, page by page (scale capped at 2 and 1600 px wide) */
export async function renderPdf(stage, data, { stamp, isEnded, onPages }) {
  const lib = await loadPdfjs();
  const pdf = await lib.getDocument({ data, isEvalSupported: false }).promise;
  if (isEnded()) return pdf;
  onPages(pdf.numPages); stage.replaceChildren();
  for (let n = 0; n < pdf.numPages; n++) {
    if (isEnded()) break;
    const page = await pdf.getPage(n + 1), vp = page.getViewport({ scale: 1 }), scale = Math.min(2, 1600 / vp.width);
    const v = page.getViewport({ scale }), cv = pageEl(stage, n, pdf.numPages, stamp); cv.width = v.width; cv.height = v.height; shape(cv, v.width, v.height);
    const ctx = cv.getContext('2d'); await page.render({ canvasContext: ctx, viewport: v }).promise; bake(ctx, v.width, v.height, stamp);
  }
  if (isEnded()) stage.replaceChildren();   /* access ended while the pages were drawing */
  return pdf;
}

/* page images from the server (when PDF.js could not draw the PDF). onDenied(status, body) when the
   server says no (signed out, access ended, blocked); any other failure is thrown, never a blank page */
export async function renderImages(stage, { pages, stamp, isEnded, fetchPage, onDenied }) {
  stage.replaceChildren();
  for (let n = 0; n < pages; n++) {
    if (isEnded()) return;
    const r = await fetchPage(n);
    if (!r.ok) {
      const e = await r.json().catch(() => ({}));
      if (r.status === 401 || r.status === 403 || r.status === 410) { onDenied(r.status, e); return; }
      throw new Error(e.error || 'Page ' + (n + 1) + ' could not be loaded');
    }
    const bmp = await createImageBitmap(await r.blob()), cv = pageEl(stage, n, pages, stamp); cv.width = bmp.width; cv.height = bmp.height; shape(cv, bmp.width, bmp.height);
    const ctx = cv.getContext('2d'); ctx.drawImage(bmp, 0, 0); bake(ctx, bmp.width, bmp.height, stamp); bmp.close();
  }
}
