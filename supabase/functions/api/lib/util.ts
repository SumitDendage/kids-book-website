// Small pure helpers: randomness, hashing, encodings, ids, passwords, money and dates.

const enc = new TextEncoder();

export function randomBytes(n: number): Uint8Array {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return b;
}

export function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const x of bytes) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64urlDecode(s: string): Uint8Array {
  const pad = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (x) => x.toString(16).padStart(2, '0')).join('');
}

export async function sha256Hex(s: string | Uint8Array): Promise<string> {
  const data = typeof s === 'string' ? enc.encode(s) : s;
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', data as BufferSource)));
}

export async function hmacSha256(key: string | Uint8Array, msg: string | Uint8Array): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey('raw', (typeof key === 'string' ? enc.encode(key) : key) as BufferSource, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, (typeof msg === 'string' ? enc.encode(msg) : msg) as BufferSource));
}

export async function hmacHex(key: string | Uint8Array, msg: string | Uint8Array): Promise<string> {
  return hex(await hmacSha256(key, msg));
}

/** Constant-time comparison of two strings. */
export function safeEqual(a: string, b: string): boolean {
  const x = enc.encode(a), y = enc.encode(b);
  let diff = x.length ^ y.length;
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

/** 43-character URL-safe one-time token (verification / reset links). */
export const newLinkToken = () => b64url(randomBytes(32));
export const LINK_TOKEN_RE = /^[A-Za-z0-9_-]{32,128}$/;

/** Server-generated password: XXXX-XXXX-XXXX-XXXX from an alphabet without look-alikes
 *  (no 0/O, 1/I/l). Has upper case and digits so it passes the strength rule. */
export function generatePassword(): string {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ', digits = '23456789', lower = 'abcdefghijkmnopqrstuvwxyz';
  const all = upper + digits + lower;
  for (;;) {
    const r = randomBytes(16);
    const chars = Array.from(r, (x) => all[x % all.length]);
    const pw = [0, 4, 8, 12].map((i) => chars.slice(i, i + 4).join('')).join('-');
    if (/[A-Z]/.test(pw) && /[0-9]/.test(pw) && /[a-z]/.test(pw)) return pw;
  }
}

/** Order id: LWO- + 10 characters (about 50 bits), no look-alikes. */
export function newOrderId(): string {
  const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return 'LWO-' + Array.from(randomBytes(10), (x) => a[x % a.length]).join('');
}

export function passwordProblem(pw: unknown): string | null {
  if (typeof pw !== 'string' || pw.length < 8) return 'At least 8 characters.';
  if (pw.length > 128) return 'Too long — 128 characters at most.';
  if (!/[A-Z]/.test(pw) || !/[0-9]/.test(pw)) return 'Add a capital letter and a number.';
  return null;
}

export const normEmail = (v: unknown) => String(v ?? '').trim().toLowerCase();
export const validEmail = (e: string) => e.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);
export const cleanName = (v: unknown) => String(v ?? '').replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim();
export const cleanText = (v: unknown, max: number) => String(v ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, max);

// Currencies without a minor unit: Razorpay, Stripe and PayPal take whole units for these.
const ZERO_DECIMAL = new Set(['BIF', 'CLP', 'DJF', 'GNF', 'JPY', 'KMF', 'KRW', 'MGA', 'PYG', 'RWF', 'VND', 'VUV', 'XAF', 'XOF', 'XPF']);
// Currencies whose minor unit is a thousandth (fils, baisa): the gateways take 1.234 KWD as 1234.
const THREE_DECIMAL = new Set(['BHD', 'JOD', 'KWD', 'OMR', 'TND']);
/** Currencies the three gateways count differently (PayPal whole units, Stripe hundredths, …):
 *  staff cannot set them up, because no single amount would be right for every gateway. */
export const UNSUPPORTED_CURRENCIES = new Set(['HUF', 'ISK', 'TWD', 'UGX']);

/** Decimals a price is shown and rounded with: 0 for zero-decimal currencies, otherwise 2
 *  (three-decimal currencies are still priced to 2, so their gateway amount always ends in 0,
 *  which Stripe and Razorpay require). */
export const decimals = (c: string) => (ZERO_DECIMAL.has(c) ? 0 : 2);
/** The exponent of the currency's minor unit as the gateways count it (ISO 4217). */
export const minorExponent = (c: string) => (ZERO_DECIMAL.has(c) ? 0 : THREE_DECIMAL.has(c) ? 3 : 2);
export function roundMoney(n: number, currency: string): number {
  const f = Math.pow(10, decimals(currency));
  return Math.round(n * f) / f;
}
/** A price in the currency's minor units (paise, cents, fils; whole won and yen). */
export const minorUnits = (n: number, currency: string) => Math.round(roundMoney(n, currency) * Math.pow(10, minorExponent(currency)));
/** Minor units back to an amount in the currency. */
export const fromMinor = (minor: number, currency: string) => minor / Math.pow(10, minorExponent(currency));

export function fmtMoney(n: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency, maximumFractionDigits: decimals(currency) }).format(n);
  } catch {
    return `${currency} ${n}`;
  }
}

/** "7 Oct 2027, 6:15 pm IST" in the customer's time zone (default India), with the zone named. */
export function fmtDateTime(d: Date | string | number, timeZone?: string | null): string {
  const date = new Date(d);
  const tz = timeZone && isTimeZone(timeZone) ? timeZone : 'Asia/Kolkata';
  const main = new Intl.DateTimeFormat('en-GB', { timeZone: tz, day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }).format(date);
  const zone = tz === 'Asia/Kolkata' ? 'IST' : (new Intl.DateTimeFormat('en-GB', { timeZone: tz, timeZoneName: 'short' }).formatToParts(date).find((p) => p.type === 'timeZoneName')?.value ?? tz);
  return `${main} ${zone}`;
}

export function fmtUtc(d: Date | string | number): string {
  return new Date(d).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
}

export function isTimeZone(tz: string): boolean {
  if (!/^[A-Za-z_+-]+(\/[A-Za-z0-9_+-]+){0,2}$/.test(tz) || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

export function clampInt(v: unknown, min: number, max: number): number | null {
  const n = typeof v === 'number' ? v : Number.parseInt(String(v ?? ''), 10);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < min || n > max) return null;
  return n;
}
