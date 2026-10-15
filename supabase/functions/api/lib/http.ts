// HTTP helpers shared by every route. Error bodies keep the old server's shape:
// { error: "<message for people>", code?: "<stable code>", errors?: { field: message }, ...extra }

export class HttpError extends Error {
  status: number;
  extra: Record<string, unknown>;
  headers: Record<string, string>;
  constructor(status: number, message: string, extra: Record<string, unknown> = {}, headers: Record<string, string> = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
    this.headers = headers;
  }
}

export const fail = (status: number, message: string, extra: Record<string, unknown> = {}): never => {
  throw new HttpError(status, message, extra);
};

export const RATE_LIMITED = 'Too many attempts — wait a few minutes and try again.';

export function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...headers,
    },
  });
}

export function errorResponse(err: HttpError): Response {
  return json(err.status, Object.assign({ error: err.message }, err.extra), err.headers);
}

/** Reads a JSON object body (max `limit` bytes). Empty body → {}. Arrays and scalars → {}. */
export async function readJson(req: Request, limit = 64 * 1024): Promise<Record<string, unknown>> {
  const raw = await readRaw(req, limit);
  if (raw.length === 0) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    throw new HttpError(400, 'Body must be JSON');
  }
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
}

export async function readRaw(req: Request, limit: number): Promise<Uint8Array> {
  const declared = Number(req.headers.get('content-length') ?? '0');
  if (declared > limit) throw new HttpError(413, 'Request too large');
  if (!req.body) return new Uint8Array(0);
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      try { await reader.cancel(); } catch { /* ignore */ }
      throw new HttpError(413, 'Request too large');
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.byteLength; }
  return out;
}

/** Client address as seen by the platform proxy (first X-Forwarded-For entry). */
export function clientIp(req: Request): string | null {
  const direct = req.headers.get('cf-connecting-ip') ?? req.headers.get('x-real-ip');
  if (direct) return direct.trim().slice(0, 64);
  const xff = req.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim().slice(0, 64) || null;
  return null;
}

/** /24 for IPv4, /48 for IPv6: "the same network" for the sharing rules. */
export function ipNetwork(ip: string | null): string | null {
  if (!ip) return null;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) return ip.split('.').slice(0, 3).join('.') + '.0/24';
  if (ip.includes(':')) {
    const parts = ip.split('::')[0].split(':').filter(Boolean);
    return parts.slice(0, 3).join(':') + '::/48';
  }
  return null;
}

export function userAgent(req: Request): string {
  return (req.headers.get('user-agent') ?? '').slice(0, 400);
}

/** A short label like "Chrome on Windows" for staff screens. */
export function deviceLabel(ua: string): string {
  const os = /Android/i.test(ua) ? 'Android' : /iPhone|iPad|iPod/i.test(ua) ? 'iOS' : /Windows/i.test(ua) ? 'Windows'
    : /Mac OS X|Macintosh/i.test(ua) ? 'macOS' : /CrOS/i.test(ua) ? 'ChromeOS' : /Linux/i.test(ua) ? 'Linux' : 'Unknown OS';
  const br = /Edg\//.test(ua) ? 'Edge' : /OPR\/|Opera/.test(ua) ? 'Opera' : /SamsungBrowser/.test(ua) ? 'Samsung Internet'
    : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  return `${br} on ${os}`;
}

export function deviceKind(ua: string): 'mobile' | 'tablet' | 'desktop' | 'bot' | 'unknown' {
  if (!ua) return 'unknown';
  if (/bot|crawler|spider|crawling|headless/i.test(ua)) return 'bot';
  if (/iPad|Tablet/i.test(ua) || (/Android/i.test(ua) && !/Mobile/i.test(ua))) return 'tablet';
  if (/Mobi|iPhone|Android/i.test(ua)) return 'mobile';
  return 'desktop';
}

/** Two-letter country from the platform's headers, when it provides one. */
export function requestCountry(req: Request): string | null {
  const c = req.headers.get('cf-ipcountry') ?? req.headers.get('x-vercel-ip-country') ?? req.headers.get('x-country-code');
  if (!c) return null;
  const u = c.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(u) && u !== 'XX' && u !== 'T1' ? u : null;
}

export const ms = (d: Date | string | null | undefined): number | null =>
  d == null ? null : (d instanceof Date ? d.getTime() : new Date(d).getTime());

export function intParam(v: string | null, def: number, min: number, max: number): number {
  const n = Number.parseInt(v ?? '', 10);
  if (!Number.isFinite(n)) return def;
  return Math.max(min, Math.min(max, n));
}

export function streamResponse(body: ReadableStream<Uint8Array> | Uint8Array, contentType: string, extra: Record<string, string> = {}): Response {
  return new Response(body as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'no-store, private',
      'X-Robots-Tag': 'noindex, nofollow',
      'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': 'inline',
      'Referrer-Policy': 'no-referrer',
      ...extra,
    },
  });
}
