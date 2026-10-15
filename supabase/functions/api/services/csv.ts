// CSV files for staff exports (RFC 4180: comma separated, CRLF line ends, fields with a quote,
// comma or line break wrapped in double quotes with inner quotes doubled).
// Spreadsheet apps run a cell that starts with = + - @ (or a tab / carriage return) as a formula,
// so such text cells get a leading single quote — also when spaces come first or the character is
// the full-width form some Excel locales accept. Numbers are written as numbers and never changed.

export type CsvValue = string | number | boolean | Date | null | undefined | Record<string, unknown> | unknown[];

export type CsvColumn<T> = { header: string; value: (row: T) => CsvValue };

const BOM = '\uFEFF';
// = + - @ tab CR, their full-width forms (U+FF1D, U+FF0B, U+FF0D, U+FF20), optionally after spaces
const FORMULA_START = /^[\s\u00a0\u3000]*[=+\-@\uff1d\uff0b\uff0d\uff20]|^[\t\r]/;
const NEEDS_QUOTES = /[",\r\n]|^\s|\s$/;

/** One cell as text: escaped, quoted when needed, formula-safe. */
export function csvCell(v: CsvValue): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  let s: string;
  if (v instanceof Date) s = Number.isFinite(v.getTime()) ? v.toISOString() : '';
  else if (typeof v === 'object') s = JSON.stringify(v);
  else s = String(v);
  // NUL bytes break some readers; nothing legitimate needs them
  s = s.replace(/\u0000/g, '');
  if (FORMULA_START.test(s)) s = "'" + s;
  return NEEDS_QUOTES.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

export function csvRow(values: CsvValue[]): string {
  return values.map(csvCell).join(',') + '\r\n';
}

/** A whole file. Starts with a UTF-8 byte-order mark so Excel shows ₹ and non-English names correctly. */
export function toCsv<T>(columns: CsvColumn<T>[], rows: T[], o: { bom?: boolean } = {}): string {
  const parts: string[] = [];
  if (o.bom !== false) parts.push(BOM);
  parts.push(csvRow(columns.map((c) => c.header)));
  for (const r of rows) parts.push(csvRow(columns.map((c) => c.value(r))));
  return parts.join('');
}

/** "lww-orders-2026-10-07.csv" style names; only safe characters reach the header. */
export function attachmentName(base: string, ext: string, at = new Date()): string {
  const clean = base.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'export';
  return `${clean}-${at.toISOString().slice(0, 10)}.${ext}`;
}

/** A file download response (never cached, never shown inline). */
export function downloadResponse(body: string, filename: string, contentType: string, extra: Record<string, string> = {}): Response {
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename="${filename.replace(/[^A-Za-z0-9._-]/g, '_')}"`,
      'Cache-Control': 'no-store, private',
      'X-Content-Type-Options': 'nosniff',
      ...extra,
    },
  });
}

/** Parses CSV text back into rows (used by tests and for sanity checks; handles quotes and CRLF). */
export function parseCsv(text: string): string[][] {
  const src = text.startsWith(BOM) ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
      } else cell += c;
      continue;
    }
    if (c === '"' && cell === '') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\r' && src[i + 1] === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; i++; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}
