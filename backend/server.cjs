/* Copyright (c) 2026 Learn With Why. All rights reserved. Proprietary — see LICENSE. This notice may not be removed. */
/* Learn With Why — the backend.   npm start (node server.cjs)  →  http://127.0.0.1:4173

   The React site (frontend/dist, or STATIC_DIR) + JSON API (/api/*) + private
   PDF storage (backend/protected/), on one Node process. Every folder is in
   src/config/paths.cjs; the code is grouped as src/config, src/http (helpers and
   middleware), src/routes (one file per part of the API), src/services (prices,
   email, passwords) and src/database (PostgreSQL, the SQLite shop, the seed).

   Two stores:
     PostgreSQL (DATABASE_URL)   customer accounts: users, email confirmation and password
                                 reset tokens, sessions, login activity, security events.
                                 Schema = database/postgresql/migrations, applied at every start.
     SQLite (database/data/lww.sqlite)
                                 the shop: catalogue, orders, payments, entitlements, access
                                 log, contact notes, store settings. Rows point at a customer
                                 by the PostgreSQL users.id.

   The customer flow the API implements:

     catalogue  GET  /api/worksheets
     account    POST /api/auth/signup → email: generated password + Accept & Continue link
                POST /api/auth/verify-email (the link) → POST /api/auth/login → httpOnly cookie
                GET  /api/auth/me · POST /api/auth/refresh-token · POST /api/auth/logout
                POST /api/auth/forgot-password → email link → POST /api/auth/reset-password
                POST /api/auth/resend-verification
     free ───── POST /api/access/:id  → server access check → free entitlement → view token
     paid ───── POST /api/quote → POST /api/pay/order → Razorpay Checkout →
                POST /api/pay/verify (signature) or POST /api/pay/webhook → paid entitlement
                → POST /api/access/:id → view token
                (Stripe / PayPal: hosted page → back at /?pay=… → POST /api/pay/stripe/confirm
                 or /api/pay/paypal/capture; /?pay=cancel → POST /api/pay/cancel)
     viewer     GET  /api/view/meta · file · page  (cookie + token + entitlement, every request)
     contact    POST /api/contact → messages table (+ email copy)   staff: /api/admin/messages
     A sheet that was opened or bought stays on the account; a class plan runs for its months.

   Every /api request: security headers → CORS → cross-site check → session loaded from
   PostgreSQL → requireAuth on protected routes (middleware.cjs) → handler. Full reference: API.md.

   Pages: every path that is not a file (/, /admin, /developer, …) gets index.html so
   the React router can draw it; a missing file with an extension (/assets/x.js) is a 404.

   Configuration is read from backend/.env (see .env.example). */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

/* backend/.env (or the old site/.env while backend/.env does not exist yet) */
const Paths = require('./src/config/paths.cjs');
if (require.main === module) Paths.needInstall();
Paths.loadEnv();

const { HttpError, json, readBody } = require('./src/http/http.cjs');
const Config = require('./src/config/config.cjs');
const PG = require('./src/database/pg.cjs');
const { migrate } = require('./src/database/migrate.cjs');
const { importAccounts } = require('./src/database/legacy.cjs');
const { securityHeaders, cors, crossSiteRefused, requireAuth } = require('./src/http/middleware.cjs');
const DB = require('./src/database/db.cjs');
const Auth = require('./src/routes/auth.cjs');
const Pricing = require('./src/services/pricing.cjs');
const Access = require('./src/routes/access.cjs');
const Payments = require('./src/routes/payments.cjs');
const Admin = require('./src/routes/admin.cjs');
const Mail = require('./src/services/mail.cjs');
const Contact = require('./src/routes/contact.cjs');

const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json', '.webp': 'image/webp', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.xml': 'application/xml; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.ico': 'image/x-icon', '.gif': 'image/gif', '.mp4': 'video/mp4', '.webm': 'video/webm', '.webmanifest': 'application/manifest+json', '.map': 'application/json', '.wasm': 'application/wasm' };

async function createApp() {
  const cfg = Config.load();
  /* the built site (frontend/dist), the private PDFs and the shop database — checked before anything is opened */
  const root = Paths.staticRoot();
  const protectedDir = Paths.protectedDir();
  const dbFile = Paths.shopDb();

  const pg = PG.connect(cfg.db);
  let db = null, imported;
  try {
    await migrate(pg.pool);
    db = DB.open(dbFile);
    imported = await importAccounts(pg, db);
  } catch (e) { await pg.close().catch(() => {}); if (db) db.close(); throw e; }
  const attached = DB.attachFiles(db, protectedDir);
  const mail = Mail.make(cfg);
  const auth = Auth.make(pg, mail, cfg, db);
  const pricing = Pricing.make(db);
  const access = Access.make(db, auth, protectedDir);
  const payments = Payments.make(db, auth, access);
  const contact = Contact.make(db, auth, mail);
  const admin = Admin.make(db, access, payments, protectedDir, contact, auth);
  const guard = requireAuth(auth);

  async function api(req, res, pathname, url) {
    const m = req.method;
    if (cors(req, res)) return;
    /* state-changing calls must come from our own pages (the webhook is Razorpay's) */
    if (crossSiteRefused(req, pathname)) return json(res, 403, { error: 'Cross-site request refused.' });
    await auth.load(req);   /* who is calling (PostgreSQL session) — read synchronously from here on */
    guard(req, pathname);   /* protected routes: 401 / 403 before any handler runs */

    /* ---- public ---- */
    /* the checkout reads countries, rates (prices shown in the customer's currency) and gateways (false = not connected) */
    if (m === 'GET' && pathname === '/api/config') { const rates = db.get('rates'); return json(res, 200, { countries: Pricing.publicCountries(), plans: db.get('plans'), plansByRegion: Pricing.PLANS_BY_REGION, classes: db.get('classes'), rates, currencies: Object.keys(rates), gateways: payments.gateways, server: 'learn-with-why', version: '4' }); }
    if (m === 'GET' && pathname === '/api/geo') { const hdr = req.headers['cf-ipcountry'] || req.headers['x-vercel-ip-country'] || req.headers['x-country-code']; return json(res, 200, { country: hdr && Pricing.COUNTRIES[String(hdr).toUpperCase()] ? String(hdr).toUpperCase() : null }); }
    if (m === 'GET' && pathname === '/api/worksheets') return access.catalogue(req, res);
    if (m === 'GET' && pathname === '/api/health') { let database = true; try { await pg.one('SELECT 1'); } catch (_) { database = false; } return json(res, database ? 200 : 503, { ok: database, database, gateway: payments.mode, gateways: payments.gateways, mail: mail.mode, time: Date.now() }); }
    if (m === 'POST' && pathname === '/api/contact') return contact.post(req, res);

    /* ---- accounts ---- */
    if (pathname.startsWith('/api/auth/')) {
      if (m === 'POST' && pathname === '/api/auth/signup') return auth.signup(req, res);
      if (m === 'POST' && (pathname === '/api/auth/login' || pathname === '/api/auth/signin')) return auth.login(req, res);
      if (m === 'POST' && (pathname === '/api/auth/logout' || pathname === '/api/auth/signout')) return auth.logout(req, res);
      if (m === 'GET' && pathname === '/api/auth/me') return auth.me(req, res);
      if (m === 'PATCH' && pathname === '/api/auth/me') return auth.update(req, res);
      if (m === 'POST' && pathname === '/api/auth/refresh-token') return auth.refreshToken(req, res);
      if (m === 'POST' && pathname === '/api/auth/verify-email') return auth.verifyEmail(req, res);
      if (m === 'POST' && pathname === '/api/auth/resend-verification') return auth.resendVerification(req, res);
      if (m === 'POST' && pathname === '/api/auth/forgot-password') return auth.forgotPassword(req, res);
      if (m === 'POST' && pathname === '/api/auth/reset-password') return auth.resetPassword(req, res);
    }

    /* ---- pricing & payments ---- */
    if (m === 'POST' && pathname === '/api/quote') { const q = pricing.quote(await readBody(req)); return json(res, q.error ? 400 : 200, q); }
    if (m === 'POST' && pathname === '/api/pay/order') return payments.createOrder(req, res, pricing);
    if (m === 'POST' && pathname === '/api/pay/verify') return payments.verify(req, res);
    if (m === 'POST' && pathname === '/api/pay/webhook') return payments.webhook(req, res);
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
    const isApi = pathname.startsWith('/api/');
    securityHeaders(req, res, isApi);
    if (isApi) {
      return api(req, res, pathname, url).catch(err => {
        if (res.headersSent) { res.destroy(); return; }
        if (err instanceof HttpError) return json(res, err.status, Object.assign({ error: err.message }, err.extra || {}));
        if (databaseDown(err)) { console.error('[api] database unavailable:', req.method, pathname, err.message); return json(res, 503, { error: 'The service is briefly unavailable — please try again in a minute.', code: 'service_unavailable' }); }
        console.error('[api]', req.method, pathname, err);
        json(res, 500, { error: 'Something went wrong on the server.' });
      });
    }
    /* static files — the built site only; backend/protected is never reachable here */
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { Allow: 'GET, HEAD' }); return res.end(); }
    const file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (file !== root && !file.startsWith(root + path.sep)) { res.writeHead(403); return res.end(); }
    if (/(^|\/)\./.test(pathname)) { res.writeHead(404); return res.end('Not found'); }   /* dotfiles (.htaccess, .env, …) are never served */
    fs.stat(file, (error, stat) => {
      if (!error && stat.isFile()) return sendFile(req, res, root, file, stat);
      /* not a file: a page of the single-page app (/admin, /developer, …) gets index.html; a missing asset is a 404 */
      if (path.extname(pathname)) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Not found'); }
      const index = path.join(root, 'index.html');
      fs.stat(index, (e2, st2) => { if (e2 || !st2.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Not found: the website is not built yet (see the server window).'); } sendFile(req, res, root, index, st2); });
    });
  });

  async function close() {
    auth.close();
    await new Promise(r => server.close(() => r()));
    await pg.close();
    db.close();
  }
  return { server, db, pg, auth, access, payments, pricing, contact, mail, cfg, root, dbFile, attached, imported, close };
}

/* PostgreSQL unreachable (refused, dropped, timed out, shutting down) — a 503, not a 500 */
const databaseDown = err => ['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EHOSTUNREACH', 'EAI_AGAIN'].includes(err.code) || /^(08|57P0)/.test(String(err.code || '')) ||
  /Connection terminated|timeout exceeded when trying to connect/i.test(String(err.message || ''));

/* every static response carries nosniff (securityHeaders); Vite's hashed files in /assets/ never change, so they are cached for a year */
function sendFile(req, res, root, file, stat) {
  const ext = path.extname(file);
  const headers = { 'Content-Type': types[ext] || 'application/octet-stream', 'Content-Length': stat.size };
  if (ext === '.html') headers['Cache-Control'] = 'no-cache';
  else if (file.startsWith(path.join(root, 'assets') + path.sep)) headers['Cache-Control'] = 'public, max-age=31536000, immutable';
  else headers['Cache-Control'] = 'public, max-age=86400';
  res.writeHead(200, headers);
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(file).pipe(res);
}

async function start() {
  const app = await createApp();
  const { cfg, mail, payments } = app;
  app.server.listen(cfg.port, cfg.host, async () => {
    console.log('Learn With Why: http://' + cfg.host + ':' + cfg.port + '   (links in emails: ' + cfg.siteUrl + ')');
    const built = fs.existsSync(path.join(app.root, 'index.html'));
    console.log('  site       ' + app.root + (built ? '' : '  (NOT BUILT YET)'));
    if (!built) Paths.notes.push('the website is not built yet, so every page says "Not found". Build it once: cd ' + path.relative(process.cwd(), path.join(Paths.ROOT, 'frontend')) + '  →  npm install  →  npm run build   and then start the server again.');
    if (fs.existsSync(path.join(Paths.ROOT, 'react-app', 'dist', 'index.html'))) Paths.notes.push('react-app' + path.sep + 'dist is an OLD build from before the folders moved and is not used. The website is built in frontend now.');
    console.log('  accounts   PostgreSQL (migrations applied' + (app.imported.length ? '; ' + app.imported.length + ' account(s) carried over from SQLite' : '') + ')');
    console.log('  shop       ' + app.dbFile + (app.attached ? '  (' + app.attached + ' PDF' + (app.attached === 1 ? '' : 's') + ' attached from backend/protected)' : ''));
    const mc = await mail.check();
    console.log('  mail       ' + (mail.mode === 'smtp' ? 'SMTP ' + (mc.ok ? 'ready' : 'NOT READY — ' + mc.problem) : mail.mode === 'console' ? 'console — emails are printed here, not sent (set SMTP_* for real mail)' : mail.mode + (mail.problem ? ' — ' + mail.problem : '')));
    console.log('  gateway    Razorpay ' + (payments.mode || 'off — set RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET in backend/.env to take payments'));
    console.log('  stripe     ' + (payments.gateways.stripe || 'off — set STRIPE_SECRET_KEY to turn it on') + '   paypal ' + (payments.gateways.paypal || 'off — set PAYPAL_CLIENT_ID / PAYPAL_SECRET'));
    console.log('  admin key  ' + (process.env.ADMIN_KEY && process.env.ADMIN_KEY !== 'change-me' ? 'set' : '"change-me" — choose your own ADMIN_KEY in backend/.env'));
    if (cfg.production && !process.env.SITE_URL) console.warn('  WARNING    SITE_URL is not set: links in emails point at ' + cfg.siteUrl);
    if (Paths.notes.length) console.log('\n' + Paths.notes.map(n => '  !! ' + n).join('\n') + '\n');
  });
  const stop = sig => { console.log('\n' + sig + ' — shutting down'); app.close().then(() => process.exit(0), () => process.exit(1)); setTimeout(() => process.exit(1), 10000).unref(); };
  process.on('SIGTERM', () => stop('SIGTERM')); process.on('SIGINT', () => stop('SIGINT'));
  return app;
}

if (require.main === module) start().catch(e => { console.error('Could not start: ' + e.message); process.exit(1); });

module.exports = { createApp, start };
