/* Copyright (c) 2026 Learn With Why. All rights reserved. Proprietary — see LICENSE. This notice may not be removed. */
/* HTTP helpers shared by every API module: JSON responses, request bodies
   (JSON or raw bytes for the webhook and PDF uploads), cookies, the client
   IP, a small in-memory rate limiter and the same-origin check that keeps a
   foreign page from posting to the API with the customer's cookie. */
const crypto = require('node:crypto');

class HttpError extends Error { constructor(status, message, extra) { super(message); this.status = status; this.extra = extra || null; } }
const fail = (status, message, extra) => { throw new HttpError(status, message, extra); };

function json(res, code, body, headers) {
  const s = JSON.stringify(body);
  res.writeHead(code, Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(s), 'Cache-Control': 'no-store' }, headers || {}));
  res.end(s);
}
function readRaw(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    /* too large: stop keeping the bytes (the rest is read and dropped) so a proper 413 answer can still be sent */
    req.on('data', c => { if (size > limit) return; size += c.length; if (size > limit) { chunks.length = 0; reject(new HttpError(413, 'Request too large')); return; } chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
async function readBody(req, limit = 64 * 1024) {
  const raw = await readRaw(req, limit);
  if (!raw.length) return {};
  try { const v = JSON.parse(raw.toString('utf8')); return v && typeof v === 'object' ? v : {}; } catch (_) { throw new HttpError(400, 'Body must be JSON'); }
}
function cookies(req) {
  const out = {};
  String(req.headers.cookie || '').split(';').forEach(p => { const i = p.indexOf('='); if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); });
  return out;
}
function isSecure(req) { return req.headers['x-forwarded-proto'] === 'https' || (process.env.SITE_URL || '').startsWith('https://'); }
function setCookie(res, req, name, value, opts) {
  const parts = [name + '=' + encodeURIComponent(value), 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  if (opts && opts.maxAge != null) parts.push('Max-Age=' + Math.max(0, Math.floor(opts.maxAge / 1000)));
  if (isSecure(req)) parts.push('Secure');
  const prev = res.getHeader('Set-Cookie');
  res.setHeader('Set-Cookie', (prev ? [].concat(prev) : []).concat(parts.join('; ')));
}
function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  return (fwd ? String(fwd).split(',')[0].trim() : '') || req.socket.remoteAddress || '';
}
/* CORS_ORIGINS: other sites allowed to call the API with the customer's cookie (only needed when
   the React build sets VITE_API_BASE_URL to a different domain). Comma-separated, exact origins. */
const allowedOrigins = () => String(process.env.CORS_ORIGINS || '').split(',').map(s => s.trim().replace(/\/+$/, '')).filter(Boolean);
const corsAllowed = origin => !!origin && allowedOrigins().includes(String(origin).replace(/\/+$/, ''));
/* the browser sends Origin on every cross-site POST; a value that is not our own host (or listed in CORS_ORIGINS) is refused */
function sameOrigin(req) {
  const origin = req.headers.origin; if (!origin) return true;
  try { return new URL(origin).host === req.headers.host || corsAllowed(origin); } catch (_) { return false; }
}
/* a sliding window per key: `limit` hits in `windowMs` */
function rateLimiter(limit, windowMs) {
  const hits = new Map();
  setInterval(() => { const cut = Date.now() - windowMs; for (const [k, v] of hits) { const keep = v.filter(t => t > cut); if (keep.length) hits.set(k, keep); else hits.delete(k); } }, windowMs).unref();
  return key => { const now = Date.now(), list = (hits.get(key) || []).filter(t => t > now - windowMs); list.push(now); hits.set(key, list); return list.length <= limit; };
}
const sha256 = s => crypto.createHash('sha256').update(s).digest('hex');
const timingEqual = (a, b) => { const A = Buffer.from(String(a)), B = Buffer.from(String(b)); return A.length === B.length && crypto.timingSafeEqual(A, B); };
const b64url = buf => Buffer.from(buf).toString('base64url');
const isEmail = v => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(v || '').trim());

module.exports = { HttpError, fail, json, readBody, readRaw, cookies, setCookie, clientIp, isSecure, sameOrigin, corsAllowed, rateLimiter, sha256, timingEqual, b64url, isEmail };
