/* Every call the front end makes to the backend lives here.
   The backend is one Supabase Edge Function ("api") that answers /api/*. By default the site
   talks to the live one (LIVE_API below). VITE_SUPABASE_URL (frontend/.env.production) names
   the Supabase project whose "api" it calls. VITE_API_BASE_URL (see .env.example) wins over it
   and points the site anywhere else: another https://<project>.supabase.co/functions/v1, a
   local dev API, or "/" (also "same-origin") when the API is served from the site's own domain.
   No secret is ever stored in the browser. The browser keeps the customer's own sign-in tokens
   (they open only this customer's account, end when the server says so, and are refreshed
   here); prices come from the server's stored quote and payments are verified by the server. */
import { BRAND, WEB3FORMS_KEY } from '../data/content.js';

const LIVE_API = 'https://wjqmrcglzqemrvafjeel.supabase.co/functions/v1';
function baseOf(v, project) {
  const s = String(v == null ? '' : v).trim();
  if (!s) {
    const p = String(project == null ? '' : project).trim().replace(/\/+$/, '');
    return /^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(p) ? p + '/functions/v1' : LIVE_API;
  }
  if (s === '/' || s.toLowerCase() === 'same-origin') return '';
  return s.replace(/\/+$/, '');
}
export const API_BASE = baseOf(import.meta.env.VITE_API_BASE_URL, import.meta.env.VITE_SUPABASE_URL);
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
  const msg = plain(b.error || fallback || (status >= 500 ? 'Something went wrong on our side. Please try again in a minute.' : 'That did not work. Please try again.'));
  /* the words under each field too (errors: { agreement: '...' }) */
  if (b.errors && typeof b.errors === 'object' && !Array.isArray(b.errors)) b.errors = Object.fromEntries(Object.entries(b.errors).map(([k, v]) => [k, typeof v === 'string' ? plain(v) : v]));
  return Object.assign(new Error(msg), { status, code: b.code || null, body: b });
}
const offline = cause => Object.assign(new Error(OFFLINE), { status: 0, code: 'network', body: {}, cause });
async function bodyOf(r) { try { return await r.json(); } catch (_) { return {}; } }

/* ---------- sign-in tokens ----------
   One slot for the customer and one for staff, so signing in to /admin never signs a customer
   out in the same browser. Kept in localStorage so the viewer tab sees them; the server ends a
   session after 12 hours, or 30 days with "Keep me signed in".
   A slot holds { accessToken, refreshToken, expiresAt, expiresIn, sessionExpiresAt, skew, localExp }.
   After staff stop one sign-in the slot keeps only { refreshToken, blocked: true }: the API hands
   the browser the new refresh token so the same sign-in can carry on if staff lift the stop. */
const memory = {};
function slot(key) {
  return {
    key,
    get() { if (key in memory) return memory[key]; try { const r = localStorage.getItem(key); memory[key] = r ? JSON.parse(r) : null; } catch (_) { memory[key] = null; } return memory[key]; },
    set(t) { memory[key] = t || null; try { if (t) localStorage.setItem(key, JSON.stringify(t)); else localStorage.removeItem(key); } catch (_) {} },
    /* what another tab may have written a moment ago */
    reload() { delete memory[key]; return this.get(); },
  };
}
export const customerTokens = slot('lww_tokens');
export const staffTokens = slot('lww_staff_tokens');
const tokenListeners = new Set();
/* another tab signed in, refreshed or signed out: forget the copy held in memory and tell the site */
if (typeof addEventListener === 'function') {
  addEventListener('storage', e => {
    if (e.key !== null && e.key !== 'lww_tokens' && e.key !== 'lww_staff_tokens') return;
    delete memory.lww_tokens; delete memory.lww_staff_tokens;
    if (e.key === null || e.key === 'lww_tokens') tokenListeners.forEach(fn => { try { fn(customerTokens.get()); } catch (_) {} });
  });
}
/* the site store listens: (tokens | null) => void. Returns the unsubscribe function. */
export const onCustomerTokensChange = fn => { tokenListeners.add(fn); return () => tokenListeners.delete(fn); };
/* true when the slot can still sign in (a stopped sign-in or an empty slot cannot) */
const usable = t => !!(t && !t.blocked && (t.accessToken || t.refreshToken));

/* The server's clock may differ from this device's: the access token was issued "now" on the
   server, so expiresAt - expiresIn tells the difference. Times kept here are on this device's clock. */
function withClock(s) {
  if (!s || !s.accessToken) return s;
  const now = Date.now(), inMs = Number(s.expiresIn) > 0 ? Number(s.expiresIn) * 1000 : 3600e3;
  const skew = Number(s.expiresAt) > 0 ? Number(s.expiresAt) - inMs - now : 0;
  return Object.assign({}, s, { skew, localExp: now + inMs });
}
/* the end of the sign-in itself (12 hours or 30 days from sign-in) on this device's clock, or null */
export function sessionEndOf(t) {
  if (!t || !t.sessionExpiresAt) return null;
  return Number(t.sessionExpiresAt) - (Number(t.skew) || 0);
}

/* a random id per browser, so the server can tell this device from another one (never personal) */
function randomId() { const b = new Uint8Array(18); crypto.getRandomValues(b); return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function stableId(key) { try { let v = localStorage.getItem(key); if (!v || !/^[A-Za-z0-9_-]{16,64}$/.test(v)) { v = randomId(); localStorage.setItem(key, v); } return v; } catch (_) { return randomId(); } }
export const deviceId = () => stableId('lww_device');
export const visitorId = () => stableId('lww_visitor');
function idHeaders() { return { 'X-Device-Id': deviceId(), 'X-Visitor-Id': visitorId() }; }

/* Someone outside this file wants to know when the server ends or stops a sign-in, or blocks the
   account: the site store registers (code, error) => void. Codes: 'account_suspended',
   'session_blocked', 'access_suspended', 'email_unverified'. Only the customer slot reports. */
let onAuthProblem = null;
export const setAuthProblemHandler = fn => { onAuthProblem = fn; };
const PROBLEMS = ['account_suspended', 'session_blocked', 'access_suspended', 'email_unverified'];
function report(store, err) {
  if (store !== customerTokens || !err || !PROBLEMS.includes(err.code)) return;
  if (err.code === 'account_suspended') store.set(null);   /* the server ended every sign-in of the account */
  else if (err.code === 'session_blocked') { const t = store.get(); if (t && t.refreshToken && !t.blocked) store.set({ refreshToken: t.refreshToken, blocked: true, at: Date.now() }); }
  if (onAuthProblem) { try { onAuthProblem(err.code, err); } catch (_) {} }
}

const refreshing = new Map();
/* Swaps the refresh token for a fresh pair; one request at a time per slot. A real "no" from the
   server (401, or 403 for a blocked account, an unconfirmed email or a stopped sign-in) ends the
   slot; a network blip, a busy server or a rate limit keeps it for the next try. */
export function refreshTokens(store = customerTokens) {
  const t = store.get();
  if (!t || !t.refreshToken) return Promise.reject(httpError(401, { error: 'Sign in to continue.', code: 'signin' }));
  if (refreshing.has(store)) return refreshing.get(store);
  const p = (async () => {
    let r;
    try {
      r = await fetch(apiUrl('/api/auth/refresh-token'), { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, idHeaders()), body: JSON.stringify({ refreshToken: t.refreshToken }), cache: 'no-store', credentials: CREDENTIALS });
    } catch (e) { throw offline(e); }
    const out = await bodyOf(r);
    if (!r.ok) {
      const err = httpError(r.status, out, 'Sign in to continue.');
      if (r.status === 401 || r.status === 403) {
        /* another tab used the same refresh token a moment ago: its new tokens are the good ones */
        const now = store.reload();
        if (usable(now) && now.refreshToken !== t.refreshToken) return { session: now, raced: true };
        /* a stopped sign-in: keep only the new refresh token the API sent, as it intends */
        if (err.code === 'session_blocked' && typeof out.refreshToken === 'string' && out.refreshToken) store.set({ refreshToken: out.refreshToken, blocked: true, at: Date.now() });
        else store.set(null);
        report(store, err);
      }
      throw err;
    }
    if (out.session && out.session.accessToken) store.set(withClock(out.session));
    return out;
  })();
  refreshing.set(store, p);
  p.then(() => refreshing.delete(store), () => refreshing.delete(store));
  return p;
}

/* Authorization for the slot, refreshing first when the access token is about to run out */
async function authHeaders(store) {
  let t = store.get();
  if (!t || !t.accessToken || t.blocked) return {};
  if ((t.localExp || t.expiresAt || 0) - Date.now() < 60e3) { try { await refreshTokens(store); } catch (_) { /* the call below answers 401 */ } t = store.get(); }
  return t && t.accessToken && !t.blocked ? { Authorization: 'Bearer ' + t.accessToken } : {};
}

/* One request with the device ids and this slot's sign-in. A 401 while signed in tries one refresh
   and the request again; `stuck` is the refresh error when the refresh could not get an answer
   (offline, busy), so the sign-in is not given up for that. Network failures throw the friendly
   offline error (status 0). */
async function send(path, opt, store) {
  const go = async () => {
    try { return await fetch(apiUrl(path), Object.assign({ cache: 'no-store', credentials: CREDENTIALS }, opt, { headers: Object.assign({}, idHeaders(), await authHeaders(store), opt.headers || {}) })); }
    catch (e) { if (e && e.name === 'AbortError') throw e; throw offline(e); }
  };
  let r = await go(), stuck = null;
  if (r.status === 401 && usable(store.get()) && store.get().refreshToken && !path.startsWith('/api/auth/')) {
    const body = await r.clone().json().catch(() => ({}));
    if (!body.code || body.code === 'signin' || body.code === 'staff_signin') {
      try { await refreshTokens(store); r = await go(); }
      catch (e) { if (usable(store.get())) stuck = e; /* else the server said no: the slot is empty now */ }
    }
  }
  return { r, stuck };
}
export async function authFetch(path, opt = {}, store = customerTokens) { return (await send(path, opt, store)).r; }

let onUnauthorized = null;
/* the site store registers this: a 401 outside /api/auth/* means the sign-in is gone */
export const setUnauthorizedHandler = fn => { onUnauthorized = fn; };

/* JSON calls to our own API */
export async function api(method, path, body, store = customerTokens) {
  const { r, stuck } = await send(path, { method, headers: body !== undefined ? { 'Content-Type': 'application/json' } : {}, body: body !== undefined ? JSON.stringify(body) : undefined }, store);
  const out = await bodyOf(r);
  if (r.ok) return out;
  /* the refresh could not reach the server: still signed in, try again later */
  if (r.status === 401 && stuck) throw stuck;
  const err = httpError(r.status, out);
  if (r.status === 401 && store === customerTokens && !path.startsWith('/api/auth/')) {
    const t = store.get();
    if (t && !t.blocked) store.set(null);   /* a fresh token refused as well: this sign-in is over */
    if (onUnauthorized) onUnauthorized(err);
  }
  if (r.status === 403) report(store, err);
  throw err;
}

/* ---------- accounts (Supabase Auth behind the API) ---------- */
/* keeps the tokens a sign-in or refresh answers with */
const keep = (store, r) => { if (r && r.session && r.session.accessToken) store.set(withClock(r.session)); return r; };
/* Ends the sign-in on the server: the access token when it is still good, else the refresh token
   (the API accepts { refreshToken } as proof), so signing out works after a long sleep too. The
   slot is emptied whatever the answer. Never refreshes first. */
async function endSignIn(store) {
  const t = store.get();
  store.set(null);
  if (!t || (!t.accessToken && !t.refreshToken)) return { ok: true };
  const headers = Object.assign({ 'Content-Type': 'application/json' }, idHeaders());
  if (t.accessToken && !t.blocked && (t.localExp || t.expiresAt || 0) > Date.now()) headers.Authorization = 'Bearer ' + t.accessToken;
  try {
    const r = await fetch(apiUrl('/api/auth/logout'), { method: 'POST', headers, body: JSON.stringify({ refreshToken: t.refreshToken || '' }), cache: 'no-store', credentials: CREDENTIALS, keepalive: true });
    return await bodyOf(r);
  } catch (_) { return { ok: false }; }
}
export const authApi = {
  /* { name, email, agreement: true, agreementVersion?, timeZone?, role? }: the password arrives by email */
  signup: body => api('POST', '/api/auth/signup', body),
  /* { email, password, remember, agreement? } → { user, session, staff, security } */
  login: async body => keep(customerTokens, await api('POST', '/api/auth/login', body)),
  logout: () => endSignIn(customerTokens),
  me: () => api('GET', '/api/auth/me'),                                             /* { user, staff, security } */
  /* a fresh pair from the refresh token → { session, user, staff, expiresAt } (401 when signed out) */
  refresh: () => refreshTokens(customerTokens),
  updateMe: body => api('PATCH', '/api/auth/me', body),                             /* { role?, name?, timeZone? } */
  verifyEmail: body => api('POST', '/api/auth/verify-email', body),                 /* { token } from the Accept & Continue link */
  resendVerification: body => api('POST', '/api/auth/resend-verification', body),   /* { email }: a fresh password and link */
  forgotPassword: body => api('POST', '/api/auth/forgot-password', body),           /* { email }: a reset link is emailed */
  resetPassword: body => api('POST', '/api/auth/reset-password', body),             /* { token, password } */
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

/* ---------- checkout: quote, order, verify ---------- */
export const payApi = {
  quote: body => api('POST', '/api/quote', body),                 /* → { quoteId, sig, expiresAt, total, lines, items, ... } */
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

/* ---------- staff: their own sign-in (the shared admin key is gone) ---------- */
export const staffAuth = {
  login: async body => keep(staffTokens, await api('POST', '/api/auth/login', Object.assign({}, body, { staff: true }), staffTokens)),
  logout: () => endSignIn(staffTokens),
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
