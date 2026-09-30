/* Every call the front end makes to the backend lives here.
   URLs are relative (/api/...) so the site works when the backend is served from
   the same domain. Set VITE_API_BASE_URL (see .env.example) only if the API is
   hosted elsewhere. No secret is ever sent from or stored in the browser: the
   session is an httpOnly cookie set by the server, prices are signed by the
   server, and payments are verified by the server. */
export const API_BASE = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/+$/, '');
export const apiUrl = path => API_BASE + path;
/* the cookie only travels to another domain when the API is explicitly configured there */
const CREDENTIALS = API_BASE ? 'include' : 'same-origin';

let onUnauthorized = null;
/* the site store registers this: a 401 outside /api/auth/* means the cookie is gone */
export const setUnauthorizedHandler = fn => { onUnauthorized = fn; };

/* JSON calls to our own API; the session cookie travels with every one of them */
export async function api(method, path, body) {
  const r = await fetch(apiUrl(path), { method, headers: body !== undefined ? { 'Content-Type': 'application/json' } : {}, body: body !== undefined ? JSON.stringify(body) : undefined, credentials: CREDENTIALS, cache: 'no-store' });
  let out = {}; try { out = await r.json(); } catch (_) {}
  if (r.status === 401 && onUnauthorized && !path.startsWith('/api/auth/')) onUnauthorized();
  if (!r.ok) { const e = new Error(out.error || ('Request failed (' + r.status + ')')); e.status = r.status; e.body = out; throw e; }
  return out;
}

/* ---------- accounts ---------- */
export const authApi = {
  signup: body => api('POST', '/api/auth/signup', body),
  signin: body => api('POST', '/api/auth/signin', body),
  signout: () => api('POST', '/api/auth/signout'),
  me: () => api('GET', '/api/auth/me'),
  updateMe: body => api('PATCH', '/api/auth/me', body),
  forgot: body => api('POST', '/api/auth/forgot', body),
  reset: body => api('POST', '/api/auth/reset', body),
};

/* ---------- catalogue, entitlements, access ---------- */
export const catalogueApi = {
  worksheets: () => api('GET', '/api/worksheets'),
  entitlements: () => api('GET', '/api/me/entitlements'),
  access: id => api('POST', '/api/access/' + encodeURIComponent(id)),
};

/* ---------- checkout: config, geo, quote, order, verify ---------- */
export async function fetchConfig() { const r = await fetch(apiUrl('/api/config'), { credentials: CREDENTIALS }); if (!r.ok) throw new Error('Pricing service unavailable'); return r.json(); }
export async function fetchGeo() { return (await fetch(apiUrl('/api/geo'), { credentials: CREDENTIALS })).json(); }
export const payApi = {
  quote: body => api('POST', '/api/quote', body),
  order: body => api('POST', '/api/pay/order', body),
  verify: body => api('POST', '/api/pay/verify', body),
  demoConfirm: body => api('POST', '/api/pay/demo/confirm', body),
  cancel: body => api('POST', '/api/pay/cancel', body),
  stripeConfirm: body => api('POST', '/api/pay/stripe/confirm', body),
  paypalCapture: body => api('POST', '/api/pay/paypal/capture', body),
};

/* ---------- contact form ---------- */
export async function sendContact(body) {
  const r = await fetch(apiUrl('/api/contact'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), credentials: CREDENTIALS });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'We could not send that just now.');
  return j;
}

/* ---------- staff: the admin key is typed in by staff and kept in their browser only ---------- */
export async function adminApi(key, method, path, body) {
  const r = await fetch(apiUrl(path), { method, headers: Object.assign({ 'x-admin-key': key }, body ? { 'Content-Type': 'application/json' } : {}), body: body ? JSON.stringify(body) : undefined, cache: 'no-store', credentials: CREDENTIALS });
  const out = await r.json().catch(() => ({})); if (!r.ok) throw new Error(out.error || ('HTTP ' + r.status)); return out;
}

/* ---------- the protected viewer: the view token travels in a header, never in a URL sent to a server ---------- */
export const viewerFetch = (token, path, opt) => fetch(apiUrl(path), Object.assign({ headers: { 'X-View-Token': token }, credentials: CREDENTIALS, cache: 'no-store' }, opt || {}));
