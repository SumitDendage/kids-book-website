/* SDK-managed Auth; existing Edge Function contracts await target-project inspection. */
import * as sdkAuth from './supabaseAuth.js';
import { BRAND, WEB3FORMS_KEY } from '../data/content.js';

export const API_BASE = import.meta.env.VITE_SUPABASE_URL.replace(/\/+$/, '') + '/functions/v1';
export const apiUrl = path => API_BASE + path;
/* Sign-in travels as a bearer token, never as a cookie, so nothing needs cookies across sites
   (the API does not allow them). 'same-origin' only matters when the API is on this domain. */
const CREDENTIALS = 'same-origin';

/* ---------- errors ----------
   Every failed call throws an Error whose message can be shown to a parent, with
   .status (0 when the server could not be reached), .code (the API's stable code, e.g.
   'account_suspended') and .body (the whole answer: errors, agreement, expiredAt, ...). */
const OFFLINE = 'We could not reach Learn With Why just now. Check your internet connection and try again.';
/* the server's words, read by parents: a long dash between two thoughts becomes a comma */
const plain = s => String(s).replace(/\s+\u2014\s+/g, ', ');
function httpError(status, body, fallback) {
  const b = body && typeof body === 'object' ? body : {};
  const msg = plain(b.error || b.message || fallback || (status >= 500 ? 'Something went wrong on our side. Please try again in a minute.' : 'That did not work. Please try again.'));
  /* the words under each field too (errors: { agreement: '...' }) */
  if (b.errors && typeof b.errors === 'object' && !Array.isArray(b.errors)) b.errors = Object.fromEntries(Object.entries(b.errors).map(([k, v]) => [k, typeof v === 'string' ? plain(v) : v]));
  return Object.assign(new Error(msg), { status, code: b.code || null, body: b });
}
const offline = cause => Object.assign(new Error(OFFLINE), { status: 0, code: 'network', body: {}, cause });
async function bodyOf(r) {
  if (r.status === 204) return {};
  const out = await r.json().catch(() => null);
  if (r.ok && (!out || typeof out !== 'object' || Array.isArray(out))) {
    throw httpError(502, { code: 'invalid_response', error: 'The server returned an unexpected response. Please try again later.' });
  }
  return out || {};
}

// Validate the actual UI contract; HTTP 200 alone does not prove integration.
function validateResponse(path, out) {
  const route = path.split('?')[0];
  const fields = { '/api/worksheets': 'worksheets', '/api/me/orders': 'orders', '/api/me/entitlements': 'entitlements' };
  const field = fields[route];
  if (field && !Array.isArray(out[field])) {
    throw httpError(502, { code: 'invalid_response', error: 'The server response is missing ' + field + '.' });
  }
  if (route === '/api/worksheets' && out.worksheets.some(w => !w || typeof w.id !== 'string' || !Number.isFinite(w.price) || w.price < 0)) {
    throw httpError(502, { code: 'invalid_response', error: 'The catalogue contains an invalid product or price.' });
  }
  return out;
}

// Read-only compatibility snapshots. Only the SDK stores and refreshes tokens.
export const customerTokens = { get: sdkAuth.snapshot };
export const staffTokens = customerTokens;
export const onCustomerTokensChange = sdkAuth.subscribe;
export const signedOutHere = sdkAuth.signedOutHere;
export const sessionEndOf = () => null;
const usable = t => !!t?.accessToken;
/* the account as the server sees it (role, prints, warnings). Signed out → 401 'signin'. */
const signedOut = () => Object.assign(new Error('Sign in to continue.'), { status: 401, code: 'signin', body: {} });
export const refreshTokens = async () => {
  await sdkAuth.authReady;
  if (!usable(sdkAuth.snapshot())) throw signedOut();
  return api('GET', '/api/auth/me');
};
/* Sign-in goes through our server: it checks the password lock, a blocked account, a confirmed
   email and the agreement, and opens the server's own record of this sign-in. Without that record
   every signed-in call answers 401. The tokens it returns are then handed to the Supabase client,
   which keeps them fresh (a refresh keeps the same sign-in, so the record stays valid). */
async function serverLogin(body) {
  const r = await api('POST', '/api/auth/login', body);

  if (r.otpRequired) return r;

  await sdkAuth.adoptSession(r.session);
  return r;
}
async function serverLogout() {
  try { if (usable(sdkAuth.snapshot())) await api('POST', '/api/auth/logout'); }
  catch (_) { /* already ended or offline: this browser still forgets it below */ }
  await sdkAuth.logout().catch(() => {});
  return { ok: true };
}

/* a random id per browser, so the server can tell this device from another one (never personal) */
function randomId() { const b = new Uint8Array(18); crypto.getRandomValues(b); return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function stableId(key) { try { let v = localStorage.getItem(key); if (!v || !/^[A-Za-z0-9_-]{16,64}$/.test(v)) { v = randomId(); localStorage.setItem(key, v); } return v; } catch (_) { return randomId(); } }
export const deviceId = () => stableId('lww_device');
export const visitorId = () => stableId('lww_visitor');
function idHeaders() { return { apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY, 'X-Device-Id': deviceId(), 'X-Visitor-Id': visitorId() }; }

/* Someone outside this file wants to know when the server ends or stops a sign-in, or blocks the
   account: the site store registers (code, error) => void. Codes: 'account_suspended',
   'session_blocked', 'access_suspended', 'email_unverified'. Only the customer slot reports. */
let onAuthProblem = null;
export const setAuthProblemHandler = fn => { onAuthProblem = fn; };
const PROBLEMS = ['account_suspended', 'session_blocked', 'access_suspended', 'email_unverified'];
function report(store, err) {
  if (!PROBLEMS.includes(err?.code)) return;
  /* the server ended every sign-in of the account, or stopped this one: this browser forgets it too */
  if (err.code === 'account_suspended' || err.code === 'session_blocked') sdkAuth.logout().catch(() => {});
  if (onAuthProblem) { try { onAuthProblem(err.code, err); } catch (_) {} }
}
async function send(path, opt) {
  try {
    const headers = { ...idHeaders(), ...await sdkAuth.getHeaders(), ...opt.headers };
    return { r: await fetch(apiUrl(path), { cache: 'no-store', credentials: CREDENTIALS, ...opt, headers }), stuck: null };
  } catch (e) { if (e?.name === 'AbortError' || e?.status) throw e; throw offline(e); }
}
export async function authFetch(path, opt = {}, store = customerTokens) { return (await send(path, opt, store)).r; }

let onUnauthorized = null;
/* the site store registers this: a 401 outside /api/auth/* means the sign-in is gone */
export const setUnauthorizedHandler = fn => { onUnauthorized = fn; };

/* JSON calls to our own API */
export async function api(method, path, body, store = customerTokens) {
  const { r, stuck } = await send(path, { method, headers: body !== undefined ? { 'Content-Type': 'application/json' } : {}, body: body !== undefined ? JSON.stringify(body) : undefined }, store);
  const out = await bodyOf(r);
  if (r.ok) return validateResponse(path, out);
  /* the refresh could not reach the server: still signed in, try again later */
  if (r.status === 401 && stuck) throw stuck;
  const err = httpError(r.status, out);
  if (r.status === 401 && ['signin', 'staff_signin'].includes(err.code) && store === customerTokens && !path.startsWith('/api/auth/')) {
    /* the client already sent a fresh token (it refreshes before each call), so 'signin' means the
       server ended this sign-in (signed out elsewhere, ended from Devices): forget it here too */
    if (usable(sdkAuth.snapshot())) await sdkAuth.logout().catch(() => {});
    if (onUnauthorized) onUnauthorized(err);
  }
  if (r.status === 403) report(store, err);
  throw err;
}
async function serverVerifyLoginOtp(body) {
  const r = await api('POST', '/api/auth/verify-login-otp', body);
  await sdkAuth.adoptSession(r.session);
  return r;
}
/* Sign-up, sign-in, sign-out and the account go through our server; the Supabase client keeps the tokens fresh and runs the password-reset link. */
export const authApi = {
  /* { name, email, password, timeZone? } → { email, ready }: Supabase Auth makes the account (no email
     service needed); ready means it can sign in at once */
  signup: body => sdkAuth.signUp(body),
  /* { challengeId, code } → { user, session, staff, security }: the 6-digit code emailed after the password */
  verifyLoginOtp: serverVerifyLoginOtp,
  /* { email, password, remember, agreement? } → { user, session, staff, security } */
  login: serverLogin,
  logout: serverLogout,
  me: refreshTokens,                                             /* { user, staff, security } */
  /* a fresh pair from the refresh token → { session, user, staff, expiresAt } (401 when signed out) */
  refresh: () => refreshTokens(customerTokens),
  /* { role?, name?, timeZone? }. The account type (role) is set once: a second, different one is
     409 { code: 'role_locked' } and only staff can change it */
  updateMe: body => api('PATCH', '/api/auth/me', body),
  verifyEmail: body => api('POST', '/api/auth/verify-email', body),                 /* { token } from the Accept & Continue link */
  verifySignupCode: sdkAuth.verifySignupCode,    /* { email, code }: the 6-digit code from the sign-up email */
  resendVerification: sdkAuth.resendVerification, /* { email }: Supabase emails a new sign-up code */
  forgotPassword: sdkAuth.forgotPassword,           /* { email }: a reset link is emailed */
  resetPassword: sdkAuth.resetPassword,             /* { token, password } */
  hasTokens: () => usable(customerTokens.get()),
};

/* ---------- My Account (every call needs the customer's sign-in) ---------- */
const enc = encodeURIComponent;
export const meApi = {
  entitlements: () => api('GET', '/api/me/entitlements'),                           /* every record: active, expired, revoked */
  orders: () => api('GET', '/api/me/orders'),
  security: () => api('GET', '/api/me/security'),
  /* marks the oldest `upTo` active warnings as read; answers the new security status */
  acknowledgeWarnings: upTo => api('POST', '/api/me/security/acknowledge', { warning: upTo }),
  appeals: () => api('GET', '/api/me/appeals'),
  sendAppeal: body => api('POST', '/api/me/appeals', body),                         /* { kind: 'warning'|'suspension'|'block', message, warningId? } */
  notifications: (opts = {}) => api('GET', '/api/me/notifications' + (opts.unread ? '?unread=1' : '')),
  readNotifications: body => api('POST', '/api/me/notifications/read', body),       /* { ids: [..] } or { all: true } */
  sessions: () => api('GET', '/api/me/sessions'),
  endSession: id => api('POST', '/api/me/sessions/' + enc(id) + '/end'),
  review: body => api('POST', '/api/me/reviews', body),                             /* { worksheet, rating, title?, body? } */
  reviews: () => api('GET', '/api/me/reviews'),                                     /* my own reviews, any status */
};

/* ---------- the cart (kept on the server for a signed-in customer) ----------
   Every answer is the whole cart: { items: [{ worksheet, title, priceInr, wasPriceInr, cls, subject,
   thumb, accessDays, problem }], count, totalInr }. problem is null, or why a line cannot be bought
   now: 'owned' | 'free' | 'unavailable'. A visitor who is not signed in keeps a cart in this browser
   (SiteContext), merged here once they sign in. */
export const cartApi = {
  get: () => api('GET', '/api/cart'),
  /* 409 already_owned · 400 is_free · 400 cart_full (over 50 lines) · 404 unknown sheet; adding twice is fine */
  add: worksheet => api('POST', '/api/cart', { worksheet }),
  remove: id => api('DELETE', '/api/cart/' + enc(id)),
  empty: () => api('DELETE', '/api/cart'),
  /* the browser's cart after signing in: owned, free and unknown sheets are skipped quietly */
  merge: worksheets => api('POST', '/api/cart/merge', { worksheets }),
};

/* ---------- catalogue, entitlements, access ---------- */
export const catalogueApi = {
  worksheets: () => api('GET', '/api/worksheets'),
  entitlements: () => meApi.entitlements(),
  access: id => api('POST', '/api/access/' + enc(id)),
  reviews: id => api('GET', '/api/worksheets/' + enc(id) + '/reviews'),
};

/* ---------- public reads that need no sign-in ---------- */
async function publicGet(path, fallback) {
  let r;
  try { r = await fetch(apiUrl(path), { headers: idHeaders(), credentials: CREDENTIALS }); } catch (e) { throw offline(e); }
  const out = await bodyOf(r);
  if (!r.ok) throw httpError(r.status, out, fallback);
  return out;
}
/* countries, plans, rates, gateways, features, the account agreement ... One answer is shared for
   a minute, so the checkout and the sign-up form do not ask twice; a failure is never kept. */
let configCache = null;
export function fetchConfig() {
  if (configCache && Date.now() - configCache.at < 60e3) return configCache.p;
  const p = publicGet('/api/config', 'Prices are not available just now. Please try again in a minute.');
  configCache = { at: Date.now(), p };
  p.catch(() => { if (configCache && configCache.p === p) configCache = null; });
  return p;
}
export const fetchGeo = () => publicGet('/api/geo');
export const fetchContent = () => publicGet('/api/content');
export const fetchFaq = () => publicGet('/api/faq');
/* the newest published reviews of every sheet, with the shop-wide { avg, count, stars: {1..5} } */
export const fetchReviews = (limit = 12) => publicGet('/api/reviews?limit=' + limit);

/* ---------- checkout: quote, order, verify ---------- */
export const payApi = {
  /* { worksheet } · { worksheets: [ids] } (a cart: 1 to 50 paid sheets, one order) · { cls, plan };
     plus { coupon, address } → { quoteId, sig, expiresAt, total, lines, items, ... } */
  quote: body => api('POST', '/api/quote', body),
  order: body => api('POST', '/api/pay/order', body),             /* { quoteId, method } → { order, gateway, orderId } */
  verify: body => api('POST', '/api/pay/verify', body),           /* → { ok, status, order, entitlement, entitlements } */
  cancel: body => api('POST', '/api/pay/cancel', body),           /* { order_id } */
  stripeConfirm: body => api('POST', '/api/pay/stripe/confirm', body),
  paypalCapture: body => api('POST', '/api/pay/paypal/capture', body),
};

/* ---------- contact: the note lands in the staff inbox (and is emailed once email is set up) ---------- */
export const contactApi = {
  send: body => api('POST', '/api/contact', body),                /* { name, email, message } → 201 { ok, id, mailed, queued } */
};
/* the older way: Web3Forms sends the note straight to the shop's inbox */
export async function sendContact({ name, email, message }) {
  const form = new FormData();
  form.append('access_key', WEB3FORMS_KEY);
  form.append('subject', 'A little note from ' + name + ' · ' + BRAND);
  form.append('from_name', BRAND);
  form.append('name', name);
  form.append('email', email);
  form.append('message', message);
  const r = await fetch('https://api.web3forms.com/submit', { method: 'POST', body: form }).catch(() => null);
  const j = r ? await r.json().catch(() => ({})) : {};
  /* Web3Forms says why it refused (a wrong key, too many notes); a failed fetch means no connection */
  if (!r || !j.success) throw new Error('We could not send that just now' + (r && j.message ? ' (' + j.message + ')' : '') + '. Please try again in a moment.');
  return j;
}

/* ---------- the AI assistant on the landing page: { message } in, { reply } out ---------- */
export const aiApi = {
  chat: async (message, signal) => {
    let r;
    try { r = await fetch(apiUrl('/api/ai/chat'), { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, idHeaders()), body: JSON.stringify({ message }), credentials: CREDENTIALS, signal }); }
    catch (e) { if (e && e.name === 'AbortError') throw e; throw offline(e); }
    const j = await bodyOf(r);
    if (!r.ok) throw httpError(r.status, j, 'The assistant could not answer just now.');
    return j;
  },
};

/* ---------- visit statistics: fire and forget, never throws, never waits for a refresh ---------- */
export const eventsApi = {
  /* kind: 'page_view' | 'product_view' | 'checkout_start' | 'search'; extra: { productId?, meta?, path? } */
  track(kind, extra = {}) {
    try {
      const t = customerTokens.get();
      const headers = Object.assign({ 'Content-Type': 'application/json' }, idHeaders());
      if (t && t.accessToken && !t.blocked && (t.localExp || t.expiresAt || 0) - Date.now() > 5e3) headers.Authorization = 'Bearer ' + t.accessToken;
      const body = { kind, path: extra.path || location.pathname, referrer: document.referrer || undefined };
      if (extra.productId) body.productId = extra.productId;
      if (extra.meta) body.meta = extra.meta;
      fetch(apiUrl('/api/events'), { method: 'POST', headers, body: JSON.stringify(body), credentials: CREDENTIALS, keepalive: true }).catch(() => {});
    } catch (_) { /* statistics never get in the way */ }
  },
};

/* Staff sign in through the server like customers (staff: true refuses a customer account). */
export const staffAuth = {
  /* the password step: { otpRequired, challengeId, email } when the server emails a sign-in code
     (finish with verifyOtp), otherwise the staff account at once */
  login: async body => {
    const r = await serverLogin({ ...body, staff: true });
    return r && r.otpRequired ? r : api('GET', '/api/admin/me');
  },
  /* { challengeId, code } → the staff account */
  verifyOtp: async body => { await serverVerifyLoginOtp(body); return api('GET', '/api/admin/me'); },
  logout: serverLogout,
  me: () => api('GET', '/api/admin/me', undefined, staffTokens),
  signedIn: () => usable(staffTokens.get()),
};
export async function staffApi(method, path, body) {
  const r = await authFetch(path, { method, headers: body !== undefined ? { 'Content-Type': 'application/json' } : {}, body: body !== undefined ? JSON.stringify(body) : undefined }, staffTokens);
  const out = await bodyOf(r);
  if (!r.ok) throw httpError(r.status, out, 'HTTP ' + r.status);
  return out;
}
/* uploads and downloads for staff (PDFs, pictures, CSV exports) */
export const staffFetch = (path, opt) => authFetch(path, opt || {}, staffTokens);

/* ---------- the protected viewer: the view token travels in a header, never in a URL sent to a server ---------- */
export const viewerFetch = (token, path, opt) => authFetch(path, Object.assign({}, opt || {}, { headers: Object.assign({ 'X-View-Token': token }, (opt && opt.headers) || {}) }));
