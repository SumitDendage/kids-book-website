/* Drawing the licensed pages. Canvas pixels are drawn straight into the stage
   element (not through React state): each page is a canvas and the page number. Moved from legacy/old-static-site/viewer.html; PDF.js is
   bundled (pdfjs-dist, loaded on demand) instead of fetched from a CDN. No watermark
   is drawn on the pages (Sumit, Oct 26). */

/* one page: canvas + "n / total" */
export function pageEl(stage, n, total) {
  const d = document.createElement('div'); d.className = 'page';
  const cv = document.createElement('canvas');
  const pn = document.createElement('span'); pn.className = 'pn'; pn.textContent = (n + 1) + ' / ' + total;
  d.append(cv, pn); stage.appendChild(d);
  return cv;
}
/* the page keeps the shape of what was drawn (a landscape chart stays landscape) */
const shape = (cv, W, H) => { if (cv.parentElement && W > 0 && H > 0) cv.parentElement.style.aspectRatio = W + ' / ' + H; };

let pdfjs = null;
export async function loadPdfjs() {
  if (!pdfjs) {
    const [lib, worker] = await Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')]);
    lib.GlobalWorkerOptions.workerSrc = worker.default;
    pdfjs = lib;
  }
  return pdfjs;
}

/* the real PDF, page by page (scale capped at 2 and 1600 px wide) */
export async function renderPdf(stage, data, { isEnded, onPages }) {
  const lib = await loadPdfjs();
  const pdf = await lib.getDocument({ data, isEvalSupported: false }).promise;
  if (isEnded()) return pdf;
  onPages(pdf.numPages); stage.replaceChildren();
  for (let n = 0; n < pdf.numPages; n++) {
    if (isEnded()) break;
    const page = await pdf.getPage(n + 1), vp = page.getViewport({ scale: 1 }), scale = Math.min(2, 1600 / vp.width);
    const v = page.getViewport({ scale }), cv = pageEl(stage, n, pdf.numPages); cv.width = v.width; cv.height = v.height; shape(cv, v.width, v.height);
    const ctx = cv.getContext('2d'); await page.render({ canvasContext: ctx, viewport: v }).promise;
  }
  if (isEnded()) stage.replaceChildren();   /* access ended while the pages were drawing */
  return pdf;
}

/* page images from the server (when PDF.js could not draw the PDF). onDenied(status, body) when the
   server says no (signed out, access ended, blocked); any other failure is thrown, never a blank page */
export async function renderImages(stage, { pages, isEnded, fetchPage, onDenied }) {
  stage.replaceChildren();
  for (let n = 0; n < pages; n++) {
    if (isEnded()) return;
    const r = await fetchPage(n);
    if (!r.ok) {
      const e = await r.json().catch(() => ({}));
      if (r.status === 401 || r.status === 403 || r.status === 410) { onDenied(r.status, e); return; }
      throw new Error(e.error || 'Page ' + (n + 1) + ' could not be loaded');
    }
    const bmp = await createImageBitmap(await r.blob()), cv = pageEl(stage, n, pages); cv.width = bmp.width; cv.height = bmp.height; shape(cv, bmp.width, bmp.height);
    const ctx = cv.getContext('2d'); ctx.drawImage(bmp, 0, 0); bmp.close();
  }
}
