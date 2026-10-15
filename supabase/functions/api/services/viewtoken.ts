// Viewer tokens. POST /api/access/:id hands one out; every /api/view/* request must send it
// (X-View-Token header, or ?t= as the old site allowed) together with the bearer token.
// The token says which sheet, which access record and which sign-in it was issued for, and when
// it stops working. It is never trusted alone: each viewer request checks the database again.
//
// Format: base64url("userId|productId|entitlementId|sessionId|exp") "." base64url(HMAC-SHA256)
// The key is private.app_secrets.view_token_key (generated in the database, never typed in).
import type { Tx } from '../lib/db.ts';
import { b64url, b64urlDecode } from '../lib/util.ts';

export type ViewClaims = {
  userId: string;
  productId: string;
  entitlementId: number;
  sessionId: string;
  exp: number;          // epoch ms
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const PRODUCT_RE = /^[A-Za-z0-9][A-Za-z0-9-]{1,63}$/;
const TOKEN_RE = /^[A-Za-z0-9_-]{20,400}\.[A-Za-z0-9_-]{43}$/;
const enc = new TextEncoder();

// The key rarely changes; keep it for a few minutes so most requests skip the extra query.
let cached: { hex: string; key: CryptoKey; until: number } | null = null;
const KEY_TTL = 5 * 60_000;

export function resetViewKeyForTests() {
  cached = null;
}

async function viewKey(q: Tx): Promise<CryptoKey> {
  if (cached && cached.until > Date.now()) return cached.key;
  const rows = await q<{ value: string }[]>`select value from private.app_secrets where name = 'view_token_key'`;
  const hex = rows[0]?.value ?? '';
  if (!/^[0-9a-f]{32,}$/i.test(hex)) throw new Error('view token key is missing');
  if (cached && cached.hex === hex) {
    cached.until = Date.now() + KEY_TTL;
    return cached.key;
  }
  const raw = new Uint8Array(hex.match(/../g)!.map((h) => parseInt(h, 16)));
  const key = await crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
  cached = { hex, key, until: Date.now() + KEY_TTL };
  return key;
}

/** Signs a token for these claims. */
export async function makeViewToken(q: Tx, c: ViewClaims): Promise<string> {
  if (!UUID_RE.test(c.userId) || !UUID_RE.test(c.sessionId) || !PRODUCT_RE.test(c.productId)
      || !Number.isSafeInteger(c.entitlementId) || c.entitlementId <= 0 || !Number.isSafeInteger(c.exp)) {
    throw new Error('makeViewToken: bad claims');
  }
  const payload = [c.userId, c.productId, c.entitlementId, c.sessionId, c.exp].join('|');
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', await viewKey(q), enc.encode(payload)));
  return `${b64url(enc.encode(payload))}.${b64url(sig)}`;
}

/** Checks the signature and shape. Returns the claims (even when `exp` has passed — the caller
 *  decides what an old token means) or null when the token is not one of ours. */
export async function readViewToken(q: Tx, token: string | null | undefined): Promise<ViewClaims | null> {
  if (!token || !TOKEN_RE.test(token)) return null;
  const [body, sig] = token.split('.');
  let payloadBytes: Uint8Array, sigBytes: Uint8Array;
  try {
    payloadBytes = b64urlDecode(body);
    sigBytes = b64urlDecode(sig);
  } catch {
    return null;
  }
  if (sigBytes.length !== 32) return null;
  // crypto.subtle.verify compares in constant time
  const ok = await crypto.subtle.verify('HMAC', await viewKey(q), sigBytes as BufferSource, payloadBytes as BufferSource);
  if (!ok) return null;
  const parts = new TextDecoder().decode(payloadBytes).split('|');
  if (parts.length !== 5) return null;
  const [userId, productId, ent, sessionId, exp] = parts;
  const entitlementId = Number(ent), expMs = Number(exp);
  if (!UUID_RE.test(userId) || !UUID_RE.test(sessionId) || !PRODUCT_RE.test(productId)) return null;
  if (!/^[1-9][0-9]{0,15}$/.test(ent) || !/^[0-9]{1,16}$/.test(exp)) return null;
  return { userId, productId, entitlementId, sessionId, exp: expMs };
}

/** The token from the request: X-View-Token header, else ?t= (old <img> links). */
export function viewTokenFrom(req: Request, query: URLSearchParams): string | null {
  const h = req.headers.get('x-view-token');
  if (h && h.trim()) return h.trim();
  const t = query.get('t');
  return t && t.trim() ? t.trim() : null;
}
