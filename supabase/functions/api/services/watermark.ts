// A light stamp on every page of a delivered PDF: who it was licensed to (the account email), the
// order and the UTC date, measured to stay on the page, with the customer's name on its own line
// under it. The identifying line holds nothing the customer can change, so a long or misleading
// display name can never push it off the page. It does not stop copying; it makes a shared copy
// traceable. The original file in storage is never changed.
import { degrees, PDFDocument, rgb, StandardFonts } from 'pdf-lib';

/** Larger files are sent unstamped (and reported) so one request cannot exhaust the function's memory. */
export const MAX_STAMP_BYTES = 20 * 1024 * 1024;

/** guest: a free sheet opened without an account (email is then the site's address). */
export type StampInfo = { name?: string | null; email: string; orderId: string | null; kind: 'free' | 'paid' | 'grant'; at: Date; guest?: boolean };

// Standard PDF fonts only cover Latin-1; anything else becomes "?" so stamping never fails on a name.
const latin = (s: string, max: number) => s.replace(/[^\x20-\x7e]/g, '?').slice(0, max);
const plain = (s: string) => latin(s, 160);

/** The customer's name as the standard fonts can draw it, or '' when nothing readable is left
 *  (a name in a non-Latin script would only come out as question marks). */
export function stampName(name: string | null | undefined): string {
  const n = plain(String(name ?? '').replace(/\s+/g, ' ').trim()).slice(0, 60).trim();
  return /[A-Za-z0-9]/.test(n) && n.replace(/[^?]/g, '').length * 2 < n.length ? n : '';
}

/** The parts of the stamp the customer cannot change, in the order they are drawn:
 *  "Licensed to a@b.c", "Order LWO-…" (or "Free sheet" / "Granted access"), "2026-10-07 12:30 UTC". */
export function stampParts(o: StampInfo): string[] {
  if (o.guest) return [`Free sheet from ${latin(o.email, 254)}`, o.at.toISOString().replace('T', ' ').slice(0, 16) + ' UTC'];
  const ref = o.orderId ? `Order ${o.orderId}` : o.kind === 'free' ? 'Free sheet' : 'Granted access';
  const when = o.at.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
  return [`Licensed to ${latin(o.email, 254)}`, latin(ref, 80), when];
}

/** "Licensed to a@b.c - Order LWO-… - 2026-10-07 12:30 UTC": the identifying line. It holds only
 *  what the customer cannot change (the account email, the order and the time), so a chosen
 *  display name can never push it off the page or stand in for it. */
export function stampText(o: StampInfo): string {
  return stampParts(o).join(' - ');
}

/** "Name on account: Meera Iyer", drawn on its own line under the identifying line; '' when the
 *  name cannot be printed. */
export function stampNameLine(o: Pick<StampInfo, 'name'>): string {
  const name = stampName(o.name);
  return name ? `Name on account: ${name}` : '';
}

type Font = { widthOfTextAtSize(text: string, size: number): number };

/** Packs the parts into as few lines as fit maxWidth at this size, joined with " - ". A part too
 *  long for a line of its own (a very long email) is split where the line is full. */
export function packLines(font: Font, parts: string[], maxWidth: number, size: number): string[] {
  const fits = (t: string) => font.widthOfTextAtSize(t, size) <= maxWidth;
  const lines: string[] = [];
  let cur = '';
  for (const part of parts) {
    const joined = cur ? `${cur} - ${part}` : part;
    if (fits(joined)) {
      cur = joined;
      continue;
    }
    if (cur) lines.push(cur);
    let rest = part;
    while (rest.length > 1 && !fits(rest)) {
      // the longest prefix that fits (at least one character, so this always ends)
      let lo = 1, hi = rest.length - 1;
      while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        if (fits(rest.slice(0, mid))) lo = mid; else hi = mid - 1;
      }
      lines.push(rest.slice(0, lo));
      rest = rest.slice(lo);
    }
    cur = rest;
  }
  if (cur) lines.push(cur);
  return lines;
}

/** The text cut (by measured width, with "...") so it fits maxWidth at this size. */
export function fitWidth(font: Font, text: string, maxWidth: number, size: number): string {
  if (font.widthOfTextAtSize(text, size) <= maxWidth) return text;
  let n = text.length;
  while (n > 0 && font.widthOfTextAtSize(text.slice(0, n).trimEnd() + '...', size) > maxWidth) n--;
  return n > 0 ? text.slice(0, n).trimEnd() + '...' : '';
}

/** The footer lines for a page maxWidth wide, top to bottom, and their size: the identifying line
 *  (shrunk down to minSize to stay on one line, wrapped below that), then the name line cut to fit. */
export function footerLines(font: Font, o: StampInfo, maxWidth: number, base: number, minSize: number): { size: number; lines: string[] } {
  const parts = stampParts(o);
  const full = font.widthOfTextAtSize(parts.join(' - '), 1);
  const size = Math.max(minSize, Math.min(base, full > 0 ? maxWidth / full : base));
  const lines = packLines(font, parts, maxWidth, size);
  const nameLine = stampNameLine(o);
  if (nameLine) {
    const cut = fitWidth(font, nameLine, maxWidth, size);
    if (cut) lines.push(cut);
  }
  return { size, lines };
}

export class StampError extends Error {
  reason: string;
  constructor(reason: string, message: string) {
    super(message);
    this.reason = reason;
  }
}

/** Returns a stamped copy and its page count. Throws StampError when the file cannot be stamped
 *  (too large, encrypted, damaged); the caller then sends the original and records why. */
export async function stampPdf(bytes: Uint8Array, o: StampInfo): Promise<{ bytes: Uint8Array; pages: number }> {
  if (bytes.byteLength > MAX_STAMP_BYTES) throw new StampError('too_large', `PDF is ${bytes.byteLength} bytes`);
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(bytes, { updateMetadata: false });
  } catch (e) {
    const msg = String((e as Error)?.message ?? e);
    throw new StampError(/encrypt/i.test(msg) ? 'encrypted' : 'unreadable', msg.slice(0, 200));
  }
  try {
    const font = await doc.embedFont(StandardFonts.Helvetica);
    // the diagonal stamp is the email alone: the one thing on it the customer cannot change
    const email = latin(o.email, 254);
    const green = rgb(0.12, 0.42, 0.28);
    const angle = 35, cos = Math.cos(angle * Math.PI / 180), sin = Math.sin(angle * Math.PI / 180);
    const pages = doc.getPages();
    for (const page of pages) {
      const box = page.getCropBox();
      const w = box.width, h = box.height;
      const room = Math.max(20, w - 16);
      // footer, small and readable, inside the page: the identifying line(s) first, the name under them
      const { size, lines } = footerLines(font, o, room, Math.max(6, Math.min(9, w / 70)), 5);
      const lead = size * 1.25;
      const bottom = box.y + Math.max(6, h * 0.012);
      lines.forEach((line, i) => {
        const tw = font.widthOfTextAtSize(line, size);
        page.drawText(line, {
          x: box.x + Math.max(8, (w - tw) / 2), y: bottom + (lines.length - 1 - i) * lead,
          size, font, color: green, opacity: 0.55,
        });
      });
      // a faint diagonal email across the page, sized so it stays on the page
      const one = font.widthOfTextAtSize(email, 1);
      const big = Math.max(6, Math.min(28, w / 22, one > 0 ? room / (one * cos) : 28));
      const bw = one * big;
      for (const f of [0.25, 0.55, 0.85]) {
        page.drawText(email, {
          x: box.x + (w - bw * cos) / 2, y: box.y + h * f - (bw * sin) / 2,
          size: big, font, color: green, opacity: 0.07, rotate: degrees(angle),
        });
      }
    }
    const out = await doc.save();
    return { bytes: out, pages: pages.length };
  } catch (e) {
    throw new StampError('stamp_failed', String((e as Error)?.message ?? e).slice(0, 200));
  }
}
