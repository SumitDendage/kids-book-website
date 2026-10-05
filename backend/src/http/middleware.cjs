/* Copyright (c) 2026 Learn With Why. All rights reserved. Proprietary — see LICENSE. This notice may not be removed. */
/* MIDDLEWARE — what every request passes before it reaches a handler.

   securityHeaders  on every response: no MIME sniffing, no framing by other sites, a strict
                    referrer policy, no camera / microphone / location, HSTS over HTTPS, and a
                    CSP that allows nothing for JSON answers.
   cors             only origins listed in CORS_ORIGINS may call the API with the cookie.
   sameOrigin       a POST / PUT / PATCH / DELETE from another site is refused (the browser
                    sends Origin; the Razorpay webhook is the one exception).
   requireAuth      the AUTHENTICATION MIDDLEWARE: the routes in PROTECTED need a signed-in
                    customer with a confirmed, active account — 401 / 403 otherwise. Handlers
                    then read the customer from req.user. */
const { corsAllowed, sameOrigin, isSecure } = require('./http.cjs');

function securityHeaders(req, res, isApi) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), interest-cohort=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
  if (isSecure(req)) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  if (isApi) res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
}

/* true when the request was a preflight and has been answered */
function cors(req, res) {
  if (!corsAllowed(req.headers.origin)) return false;
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin); res.setHeader('Access-Control-Allow-Credentials', 'true'); res.setHeader('Vary', 'Origin');
  if (req.method !== 'OPTIONS') return false;
  res.writeHead(204, { 'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE', 'Access-Control-Allow-Headers': 'Content-Type, X-View-Token, X-Admin-Key', 'Access-Control-Max-Age': '600' });
  res.end(); return true;
}

const crossSiteRefused = (req, pathname) => req.method !== 'GET' && req.method !== 'HEAD' && pathname !== '/api/pay/webhook' && !sameOrigin(req);

/* [method, path or pattern] — everything that needs a signed-in customer */
const PROTECTED = [
  ['GET', '/api/auth/me'], ['PATCH', '/api/auth/me'], ['POST', '/api/auth/refresh-token'],
  ['GET', /^\/api\/me\//],
  ['POST', /^\/api\/access\/[^/]+$/],
  ['GET', /^\/api\/view\//],
  ['POST', /^\/api\/pay\/(order|verify|cancel|stripe\/confirm|paypal\/capture)$/],
];
const isProtected = (method, pathname) => PROTECTED.some(([m, p]) => m === method && (typeof p === 'string' ? p === pathname : p.test(pathname)));
function requireAuth(auth) {
  return (req, pathname) => { if (isProtected(req.method, pathname)) req.user = auth.requireUser(req); };
}

module.exports = { securityHeaders, cors, crossSiteRefused, requireAuth, isProtected, PROTECTED };
