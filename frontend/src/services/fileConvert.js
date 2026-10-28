/* Admin uploads take PDF, JPG and PNG in every box (Sumit, Oct 28). The server keeps a sheet's file as
   a PDF and its cover and page pictures as pictures, so the browser turns one kind into the other:
   a picture becomes a one-page PDF, and a PDF gives its pages as JPG pictures (drawn with PDF.js). */
import { loadPdfjs } from './viewerRender.js';

export const PICTURE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
export const ANY_ACCEPT = 'application/pdf,.pdf,image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp';
export const isPdfFile = f => !!f && (f.type === 'application/pdf' || /\.pdf$/i.test(f.name));
export const isPictureFile = f => !!f && (PICTURE_TYPES.includes(f.type) || /\.(jpe?g|png|webp)$/i.test(f.name));
const baseName = name => String(name || 'file').replace(/\.(pdf|jpe?g|png|webp)$/i, '');

const jpeg = (canvas, q) => new Promise((res, rej) => canvas.toBlob(b => b ? res(b) : rej(new Error('The picture could not be made.')), 'image/jpeg', q));
/* draw on white (a see-through PNG would turn black as a JPG), shrinking to maxSide */
function flatCanvas(w, h, maxSide) {
  const k = Math.min(1, maxSide / Math.max(w, h)), c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(h * k));
  const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  return { c, ctx, k };
}
/* a JPG under maxBytes: lower the quality, then the size, until it fits */
async function jpegUnder(draw, w, h, maxBytes, maxSide) {
  for (let side = maxSide; side >= 600; side = Math.round(side * 0.75)) {
    const { c, ctx, k } = flatCanvas(w, h, side); await draw(ctx, k, c);
    for (const q of [0.9, 0.8, 0.7]) { const b = await jpeg(c, q); if (b.size <= maxBytes) return { blob: b, width: c.width, height: c.height }; }
  }
  throw new Error('That file is too big to turn into a picture.');
}

/* a picture → a one-page PDF the size of an A4 page's width (595 pt), the picture filling the page */
export async function pictureToPdf(file) {
  const bmp = await createImageBitmap(file);
  const { blob, width, height } = await jpegUnder(ctx => ctx.drawImage(bmp, 0, 0, ctx.canvas.width, ctx.canvas.height), bmp.width, bmp.height, 30 * 1024 * 1024, 3000);
  bmp.close && bmp.close();
  const img = new Uint8Array(await blob.arrayBuffer());
  const pw = 595, ph = Math.round(595 * height / width * 100) / 100;
  const content = `q ${pw} 0 0 ${ph} 0 0 cm /Im0 Do Q`;
  const enc = new TextEncoder(), parts = [], offsets = [];
  let len = 0;
  const put = x => { const b = typeof x === 'string' ? enc.encode(x) : x; parts.push(b); len += b.length; };
  const obj = (n, body) => { offsets[n] = len; put(`${n} 0 obj\n`); body(); put('\nendobj\n'); };
  put('%PDF-1.4\n'); put(new Uint8Array([0x25, 0xE2, 0xE3, 0xCF, 0xD3, 0x0A]));   /* the usual "this file is binary" line */
  obj(1, () => put('<< /Type /Catalog /Pages 2 0 R >>'));
  obj(2, () => put('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'));
  obj(3, () => put(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pw} ${ph}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`));
  obj(4, () => { put(`<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${img.length} >>\nstream\n`); put(img); put('\nendstream'); });
  obj(5, () => put(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`));
  const xref = len;
  put('xref\n0 6\n0000000000 65535 f \n' + offsets.slice(1).map(o => String(o).padStart(10, '0') + ' 00000 n \n').join(''));
  put(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new File(parts, baseName(file.name) + '.pdf', { type: 'application/pdf' });
}

/* a PDF → JPG pictures of its pages (from page `from`, at most `count`), each under maxBytes */
export async function pdfToPictures(file, { from = 1, count = 1, maxBytes = 5 * 1024 * 1024 } = {}) {
  const lib = await loadPdfjs();
  const pdf = await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false }).promise;
  const out = [], last = Math.min(pdf.numPages, from + count - 1);
  try {
    for (let n = from; n <= last; n++) {
      const page = await pdf.getPage(n), vp = page.getViewport({ scale: 1 });
      const { blob } = await jpegUnder(async (ctx, k, c) => {
        const v = page.getViewport({ scale: c.width / vp.width });
        await page.render({ canvasContext: ctx, viewport: v }).promise;
      }, vp.width * 2, vp.height * 2, maxBytes, 1600);
      out.push(new File([blob], baseName(file.name) + (last > from ? '-' + n : '') + '.jpg', { type: 'image/jpeg' }));
    }
  } finally { pdf.destroy(); }
  return out;
}
