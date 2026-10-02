/* Copyright (c) 2026 Learn With Why. All rights reserved. Proprietary — see LICENSE. This notice may not be removed. */
/* Learn With Why — the backend.   node server.cjs  →  http://127.0.0.1:4173

   The React site (react-app/dist, or STATIC_DIR) + JSON API (/api/*) + private
   PDF storage (protected/), all on one Node process with no npm packages. The
   database is SQLite through node:sqlite at data/lww.sqlite.

   The customer flow the API implements:

     catalogue  GET  /api/worksheets
     login      POST /api/auth/signup · signin · signout · forgot · reset   GET /api/auth/me
     free ───── POST /api/access/:id  → server access check → free entitlement → view token
     paid ───── POST /api/quote → POST /api/pay/order → Razorpay Checkout →
                POST /api/pay/verify (signature) or POST /api/pay/webhook → paid entitlement
                → POST /api/access/:id → view token
                (Stripe / PayPal: hosted page → back at /?pay=… → POST /api/pay/stripe/confirm
                 or /api/pay/paypal/capture; /?pay=cancel → POST /api/pay/cancel)
     viewer     GET  /api/view/meta · file · page  (cookie + token + entitlement, every request)
     contact    POST /api/contact → messages table (+ email copy)   staff: /api/admin/messages
     Entitlements do not expire: a sheet that was opened or bought stays on the account.

   Pages: every path that is not a file (/, /admin, /developer, …) gets index.html so
   the React router can draw it; a missing file with an extension (/assets/x.js) is a 404.

   Configuration is read from site/.env (see .env.example): RAZORPAY_KEY_ID,
   RAZORPAY_KEY_SECRET, RAZORPAY_WEBHOOK_SECRET, STRIPE_SECRET_KEY, PAYPAL_CLIENT_ID,
   PAYPAL_SECRET, PAYPAL_MODE, ADMIN_KEY, PORT, HOST, SITE_URL, STATIC_DIR, DB_PATH,
   PROTECTED_DIR, CONTACT_INBOX, RESEND_API_KEY, MAIL_FROM, CORS_ORIGINS. */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

try { process.loadEnvFile(path.join(__dirname, '.env')); } catch (_) { /* no .env yet: demo gateway, default admin key */ }

const { HttpError, json, readBody, sameOrigin, corsAllowed } = require('./server/http.cjs');
const DB = require('./server/db.cjs');
const Auth = require('./server/auth.cjs');
const Pricing = require('./server/pricing.cjs');
const Access = require('./server/access.cjs');
const Payments = require('./server/payments.cjs');
const Admin = require('./server/admin.cjs');
const Mail = require('./server/mail.cjs');
const Contact = require('./server/contact.cjs');

/* the built site: STATIC_DIR (relative to site/), else the React build next door, else the old site/dist */
const reactBuild = path.join(__dirname, '..', 'react-app', 'dist');
const root = path.resolve(__dirname, process.env.STATIC_DIR || (fs.existsSync(path.join(reactBuild, 'index.html')) ? reactBuild : 'dist'));
const protectedDir = path.resolve(process.env.PROTECTED_DIR || path.join(__dirname, 'protected'));
const dbFile = process.env.DB_PATH || path.join(__dirname, 'data', 'lww.sqlite');
const PORT = +(process.env.PORT || 4173);
const HOST = process.env.HOST || '127.0.0.1';
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json', '.webp': 'image/webp', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.xml': 'application/xml; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.ico': 'image/x-icon', '.gif': 'image/gif', '.mp4': 'video/mp4', '.webm': 'video/webm', '.webmanifest': 'application/manifest+json', '.map': 'application/json', '.wasm': 'application/wasm' };

const db = DB.open(dbFile);
const attached = DB.attachFiles(db, protectedDir);
const mail = Mail.make();
const auth = Auth.make(db, mail);
const pricing = Pricing.make(db);
const access = Access.make(db, auth, protectedDir);
const payments = Payments.make(db, auth, access);
const contact = Contact.make(db, auth, mail);
const admin = Admin.make(db, access, payments, protectedDir, contact);
const authLog = (req) => (action, userId, ok, detail) => access.log(req, action, userId, null, ok, detail);

async function api(req, res, pathname, url) {
  const m = req.method;
  /* another site listed in CORS_ORIGINS may call with the cookie (the React build on a different domain) */
  if (corsAllowed(req.headers.origin)) {
    res.setHeader('Access-Control-Allow-Origin', req.headers.origin); res.setHeader('Access-Control-Allow-Credentials', 'true'); res.setHeader('Vary', 'Origin');
    if (m === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE', 'Access-Control-Allow-Headers': 'Content-Type, X-View-Token, X-Admin-Key', 'Access-Control-Max-Age': '600' }); return res.end(); }
  }
  /* state-changing calls must come from our own pages (the webhook is Razorpay's) */
  if (m !== 'GET' && pathname !== '/api/pay/webhook' && !sameOrigin(req)) return json(res, 403, { error: 'Cross-site request refused.' });

  /* ---- public ---- */
  /* the checkout reads countries, rates (prices shown in the customer's currency) and gateways (false = not connected) */
  if (m === 'GET' && pathname === '/api/config') { const rates = db.get('rates'); return json(res, 200, { countries: Pricing.publicCountries(), plans: db.get('plans'), classes: db.get('classes'), rates, currencies: Object.keys(rates), gateways: payments.gateways, server: 'learn-with-why', version: '3' }); }
  if (m === 'GET' && pathname === '/api/geo') { const hdr = req.headers['cf-ipcountry'] || req.headers['x-vercel-ip-country'] || req.headers['x-country-code']; return json(res, 200, { country: hdr && Pricing.COUNTRIES[String(hdr).toUpperCase()] ? String(hdr).toUpperCase() : null }); }
  if (m === 'GET' && pathname === '/api/worksheets') return access.catalogue(req, res);
  if (m === 'GET' && pathname === '/api/health') return json(res, 200, { ok: true, gateway: payments.mode, gateways: payments.gateways, mail: mail.configured, time: Date.now() });
  if (m === 'POST' && pathname === '/api/contact') return contact.post(req, res);

  /* ---- auth ---- */
  if (pathname.startsWith('/api/auth/')) {
    const log = authLog(req);
    if (m === 'POST' && pathname === '/api/auth/signup') return auth.signup(req, res, log);
    if (m === 'POST' && pathname === '/api/auth/signin') return auth.signin(req, res, log);
    if (m === 'POST' && pathname === '/api/auth/signout') return auth.signout(req, res);
    if (m === 'GET' && pathname === '/api/auth/me') return auth.me(req, res);
    if (m === 'PATCH' && pathname === '/api/auth/me') return auth.update(req, res);
    if (m === 'POST' && pathname === '/api/auth/forgot') return auth.forgot(req, res, log);
    if (m === 'POST' && pathname === '/api/auth/reset') return auth.reset(req, res, log);
  }

  /* ---- pricing & payments ---- */
  if (m === 'POST' && pathname === '/api/quote') { const q = pricing.quote(await readBody(req)); return json(res, q.error ? 400 : 200, q); }
  if (m === 'POST' && pathname === '/api/pay/order') return payments.createOrder(req, res, pricing);
  if (m === 'POST' && pathname === '/api/pay/verify') return payments.verify(req, res);
  if (m === 'POST' && pathname === '/api/pay/webhook') return payments.webhook(req, res);
  if (m === 'POST' && pathname === '/api/pay/demo/confirm') return payments.demoConfirm(req, res);
  if (m === 'POST' && pathname === '/api/pay/cancel') return payments.cancel(req, res);
  if (m === 'POST' && pathname === '/api/pay/stripe/confirm') return payments.stripeConfirm(req, res);
  if (m === 'POST' && pathname === '/api/pay/paypal/capture') return payments.paypalCapture(req, res);
  if (m === 'GET' && pathname === '/api/me/orders') return payments.mine(req, res);
  if (m === 'GET' && pathname === '/api/me/entitlements') return access.mine(req, res);

  /* ---- access & the viewer ---- */
  const acc = /^\/api\/access\/([A-Za-z0-9-]{1,64})$/.exec(pathname);
  if (m === 'POST' && acc) return access.open(req, res, acc[1]);
  if (m === 'GET' && pathname === '/api/view/meta') return access.meta(req, res);
  if (m === 'GET' && pathname === '/api/view/file') return access.file(req, res);
  if (m === 'GET' && pathname === '/api/view/page') return access.page(req, res, url);

  /* ---- staff ---- */
  if (pathname.startsWith('/api/admin/')) return admin.handle(req, res, pathname, url);

  json(res, 404, { error: 'Not found' });
}

const server = http.createServer((req, res) => {
  let url; try { url = new URL(req.url, 'http://localhost'); } catch { res.writeHead(400); return res.end(); }
  let pathname; try { pathname = decodeURIComponent(url.pathname); } catch { res.writeHead(400); return res.end(); }
  if (pathname.startsWith('/api/')) {
    return api(req, res, pathname, url).catch(err => {
      if (err instanceof HttpError) return json(res, err.status, Object.assign({ error: err.message }, err.extra || {}));
      console.error('[api]', req.method, pathname, err);
      json(res, 500, { error: 'Something went wrong on the server.' });
    });
  }
  /* static files — the built site only; protected/ is never reachable here */
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { Allow: 'GET, HEAD' }); return res.end(); }
  const file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
  if (file !== root && !file.startsWith(root + path.sep)) { res.writeHead(403); return res.end(); }
  if (/(^|\/)\./.test(pathname)) { res.writeHead(404); return res.end('Not found'); }   /* dotfiles (.htaccess, .env, …) are never served */
  fs.stat(file, (error, stat) => {
    if (!error && stat.isFile()) return sendFile(req, res, file, stat);
    /* not a file: a page of the single-page app (/admin, /developer, …) gets index.html; a missing asset is a 404 */
    if (path.extname(pathname) || pathname.startsWith('/api/')) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'X-Content-Type-Options': 'nosniff' }); return res.end('Not found'); }
    const index = path.join(root, 'index.html');
    fs.stat(index, (e2, st2) => { if (e2 || !st2.isFile()) { res.writeHead(404); return res.end('Not found'); } sendFile(req, res, index, st2); });
  });
});

/* every static response carries nosniff; pages also refuse to be framed by other sites.
   Vite's hashed files in /assets/ never change, so they are cached for a year. */
function sendFile(req, res, file, stat) {
  const ext = path.extname(file);
  const headers = { 'Content-Type': types[ext] || 'application/octet-stream', 'Content-Length': stat.size, 'X-Content-Type-Options': 'nosniff' };
  if (ext === '.html') { headers['Cache-Control'] = 'no-cache'; headers['X-Frame-Options'] = 'SAMEORIGIN'; headers['Referrer-Policy'] = 'strict-origin-when-cross-origin'; }
  else if (file.startsWith(path.join(root, 'assets') + path.sep)) headers['Cache-Control'] = 'public, max-age=31536000, immutable';
  else headers['Cache-Control'] = 'public, max-age=86400';
  res.writeHead(200, headers);
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(file).pipe(res);
}

if (require.main === module) {
  server.listen(PORT, HOST, () => {
    console.log('Learn With Why: http://' + HOST + ':' + PORT);
    console.log('  site       ' + root + (fs.existsSync(path.join(root, 'index.html')) ? '' : '  (no index.html — build react-app first: cd react-app && npm run build)'));
    console.log('  database   ' + dbFile + (attached ? '  (' + attached + ' PDF' + (attached === 1 ? '' : 's') + ' attached from protected/)' : ''));
    console.log('  gateway    Razorpay ' + payments.mode + (payments.mode === 'demo' ? '  — set RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET in site/.env for real payments' : ''));
    console.log('  stripe     ' + (payments.gateways.stripe || 'off — set STRIPE_SECRET_KEY to turn it on') + '   paypal ' + (payments.gateways.paypal || 'off — set PAYPAL_CLIENT_ID / PAYPAL_SECRET'));
    console.log('  mail       ' + (mail.configured ? 'Resend → contact notes go to ' + contact.INBOX : 'off — contact notes are kept in the admin Messages panel only'));
    console.log('  admin key  ' + (process.env.ADMIN_KEY ? 'set' : 'default "change-me" — set ADMIN_KEY in site/.env'));
  });
}

module.exports = { server, db, auth, access, payments, pricing, contact, root };
