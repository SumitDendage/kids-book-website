/* Drawing the licensed pages. Canvas pixels are drawn straight into the stage
   element (not through React state): each page is a canvas, the watermark overlay
   and the page number. Moved from site/dist/viewer.html; the only change is that
   PDF.js is bundled (pdfjs-dist, loaded on demand) instead of fetched from a CDN. */

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
  onPages(pdf.numPages); stage.replaceChildren();
  for (let n = 0; n < pdf.numPages; n++) {
    if (isEnded()) break;
    const page = await pdf.getPage(n + 1), vp = page.getViewport({ scale: 1 }), scale = Math.min(2, 1600 / vp.width);
    const v = page.getViewport({ scale }), cv = pageEl(stage, n, pdf.numPages, stamp); cv.width = v.width; cv.height = v.height;
    const ctx = cv.getContext('2d'); await page.render({ canvasContext: ctx, viewport: v }).promise; bake(ctx, v.width, v.height, stamp);
  }
  return pdf;
}

/* page images from the server (when there is no PDF, or PDF.js could not draw it) */
export async function renderImages(stage, { pages, stamp, isEnded, fetchPage, onDenied }) {
  stage.replaceChildren();
  for (let n = 0; n < pages; n++) {
    if (isEnded()) return;
    const r = await fetchPage(n);
    if (!r.ok) { if (r.status === 401 || r.status === 403) { const e = await r.json().catch(() => ({})); onDenied(e.error); } return; }
    const bmp = await createImageBitmap(await r.blob()), cv = pageEl(stage, n, pages, stamp); cv.width = bmp.width; cv.height = bmp.height;
    const ctx = cv.getContext('2d'); ctx.drawImage(bmp, 0, 0); bake(ctx, bmp.width, bmp.height, stamp); bmp.close();
  }
}

/* a worksheet whose PDF has not been uploaded yet: a placeholder page, so the flow can be tried end to end */
export function renderDemo(stage, meta, stamp) {
  stage.replaceChildren();
  const W = 1240, H = 1754, cv = pageEl(stage, 0, 1, stamp); cv.width = W; cv.height = H; const ctx = cv.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#1d2126'; ctx.font = '500 64px "Cormorant Garamond", serif'; ctx.fillText(meta.title, 110, 180);
  ctx.font = '26px Inter, sans-serif'; ctx.fillStyle = '#5d636b'; ctx.fillText(meta.cls.toUpperCase() + ' · ' + meta.subject, 110, 240);
  ctx.setLineDash([12, 12]); ctx.strokeStyle = '#c7c2b6'; ctx.lineWidth = 2; for (let y = 420; y < 1600; y += 120) { ctx.beginPath(); ctx.moveTo(110, y); ctx.lineTo(W - 110, y); ctx.stroke(); } ctx.setLineDash([]);
  ctx.fillStyle = '#8a8f96'; ctx.font = '20px Inter, sans-serif'; ctx.fillText('Learn With Why · ' + meta.subject, 110, H - 80); ctx.textAlign = 'right'; ctx.fillText('Placeholder page — the PDF for this sheet has not been uploaded yet', W - 110, H - 80); ctx.textAlign = 'left';
  bake(ctx, W, H, stamp);
}
