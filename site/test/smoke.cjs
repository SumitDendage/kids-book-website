/* Copyright (c) 2026 Learn With Why. All rights reserved. Proprietary — see LICENSE. This notice may not be removed. */
/* End-to-end smoke test of the backend on throw-away databases (PostgreSQL for accounts,
   SQLite for the shop).
     TEST_DATABASE_URL=postgres://… node site/test/smoke.cjs
   Walks the customer flow: catalogue → sign up → password and Accept & Continue link by
   email → confirm → sign in → free sheet opens → paid sheet
   is refused → quote → order → Razorpay payment (its API stubbed here) → entitlement → PDF streams;
   a bought sheet never expires, a class plan ends after its months (a renewal carries on), and an
   admin revoke ends either. Also checks tokens, cookies, cross-site
   refusal, the webhook signature, the admin key and password reset; that an OLD database is
   upgraded to the new catalogue without losing admin edits; the 79 printable PDFs; the contact
   form and the admin inbox; cancelling an order; Razorpay, Stripe and PayPal answering 503 while
   they are not configured (there is no demo gateway); and the React site (index.html for app
   routes, 404 for missing files); and that a customer of the SQLite-only backend is carried
   over to PostgreSQL with the same id, signs in with the old password and keeps their sheets.
   Needs Node 22.13+, the PDFs in site/protected/ and TEST_DATABASE_URL (see test/helpers.cjs). */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const H = require('./helpers.cjs');
H.needDatabase();

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lww-'));
process.env.DB_PATH = path.join(tmp, 'test.sqlite');
/* a private store of its own: a copy of site/protected, so admin uploads never touch the real one */
const realProtected = path.join(__dirname, '..', 'protected');
process.env.PROTECTED_DIR = path.join(tmp, 'protected');
fs.cpSync(realProtected, process.env.PROTECTED_DIR, { recursive: true, dereference: true, filter: src => !/[\\/]uploads([\\/]|$)/.test(src.slice(realProtected.length)) });
process.env.ADMIN_KEY = 'test-admin-key';
process.env.RAZORPAY_WEBHOOK_SECRET = 'whsec_test';
process.env.RAZORPAY_KEY_ID = 'rzp_test_smoke'; process.env.RAZORPAY_KEY_SECRET = 'rzp_secret_smoke';
['STRIPE_SECRET_KEY', 'PAYPAL_CLIENT_ID', 'PAYPAL_SECRET', 'RESEND_API_KEY', 'SMTP_HOST', 'MAIL_FROM', 'CORS_ORIGINS'].forEach(k => delete process.env[k]);
Object.assign(process.env, { MAIL_TRANSPORT: 'memory', SITE_URL: 'https://site.test', LWW_NO_DOTENV: '1', NODE_ENV: 'test' });
/* a stand-in for the Razorpay API, which the server reaches with fetch: orders are created, and a
   payment pay_X belongs to order_X and is captured for that order's amount. Nothing leaves the machine. */
const RZP_API = 'https://api.razorpay.com/v1', rzpOrders = new Map(), realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  const u = String(url); if (!u.startsWith(RZP_API + '/')) return realFetch(url, init);
  const ep = u.slice(RZP_API.length);
  if (init.method === 'POST' && ep === '/orders') { const b = JSON.parse(init.body), o = { id: 'order_T' + (rzpOrders.size + 1), amount: b.amount, currency: b.currency, receipt: b.receipt, status: 'created' }; rzpOrders.set(o.id, o); return Response.json(o); }
  const pay = /^\/payments\/pay_(\w+)$/.exec(ep), o = pay && rzpOrders.get('order_' + pay[1]);
  if (o) return Response.json({ id: 'pay_' + pay[1], order_id: o.id, amount: o.amount, currency: o.currency, status: 'captured' });
  return Response.json({ error: { description: 'not found' } }, { status: 404 });
};

/* the site: the React build when it has been made (cd react-app && npm run build), else a tiny stand-in */
const reactBuild = path.join(__dirname, '..', '..', 'react-app', 'dist');
const realBuild = fs.existsSync(path.join(reactBuild, 'index.html'));
if (!realBuild) {
  const st = path.join(tmp, 'static'); fs.mkdirSync(path.join(st, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(st, 'index.html'), '<!doctype html><div id="root"></div>'); fs.writeFileSync(path.join(st, 'viewer.html'), '<!doctype html><div id="viewer-root"></div>');
  fs.writeFileSync(path.join(st, 'assets', 'main-test.js'), 'console.log(1)'); process.env.STATIC_DIR = st;
} else delete process.env.STATIC_DIR;

/* AN OLD DATABASE, as the first version of the server left it: no seed tracking, Nursery,
   Hindi and Art sheets, and two things the admin changed by hand (a price and a title). */
const { DatabaseSync } = require('node:sqlite');
const { SEED_V1 } = require('../server/seed.cjs');
{
  const old = new DatabaseSync(process.env.DB_PATH);
  old.exec(`CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE worksheets (id TEXT PRIMARY KEY, title TEXT NOT NULL, cls TEXT NOT NULL, subject TEXT NOT NULL, pages INTEGER NOT NULL DEFAULT 1, price INTEGER NOT NULL DEFAULT 0, file TEXT, thumb TEXT, active INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);`);
  const ins = old.prepare('INSERT INTO worksheets (id, title, cls, subject, pages, price, file, thumb, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 1, 1)');
  Object.keys(SEED_V1).forEach(id => { const w = SEED_V1[id]; ins.run(id, w.title, w.cls, w.subject, w.pages, w.price, id.startsWith('az-') ? 'a-to-z/' + id.slice(3) + '.pdf' : null, w.thumb || null); });
  old.prepare("UPDATE worksheets SET price = 120 WHERE id = 'c2-mat-mul'").run();                       /* admin price edit */
  old.prepare("UPDATE worksheets SET title = 'Animal homes (edited)' WHERE id = 'kg-evs-ani'").run();   /* admin title edit */
  old.prepare("UPDATE worksheets SET price = 25 WHERE id = 'az-Z'").run();                              /* admin price edit on a PDF */
  old.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('classes', JSON.stringify({ nursery: 'Nursery', kg: 'Kindergarten', c1: 'Class 1', c2: 'Class 2', c3: 'Class 3' }));
  /* a customer of the SQLite-only backend (scrypt password) who bought kg-mat-cnt */
  old.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL, role TEXT, pw_hash TEXT NOT NULL, created_at INTEGER NOT NULL, last_login_at INTEGER);
    CREATE TABLE entitlements (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id), scope TEXT NOT NULL, worksheet_id TEXT, cls TEXT, plan TEXT, order_id TEXT, kind TEXT NOT NULL, starts_at INTEGER NOT NULL, revoked_at INTEGER);`);
  const salt = crypto.randomBytes(16);
  old.prepare('INSERT INTO users (id, email, name, role, pw_hash, created_at) VALUES (5, ?, ?, ?, ?, ?)').run('old@example.com', 'Old Customer', 'parent', salt.toString('hex') + ':' + crypto.scryptSync('Oldpass123', salt, 64).toString('hex'), Date.now() - 86400e3);
  old.prepare("INSERT INTO entitlements (user_id, scope, worksheet_id, kind, starts_at) VALUES (5, 'worksheet', 'kg-mat-cnt', 'paid', ?)").run(Date.now() - 3600e3);
  old.close();
}

let app, server, db, auth, access, pricing, pdb;
let base = '', cookie = '', lastSetCookie = '';
const req = async (method, p, body, extra) => {
  const h = Object.assign({ 'Content-Type': 'application/json', Origin: base, Cookie: cookie }, extra || {});
  const r = await fetch(base + p, { method, headers: h, body: body === undefined ? undefined : (typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body)) });
  const sc = r.headers.get('set-cookie'); if (sc) { cookie = sc.split(';')[0]; lastSetCookie = sc; }
  const ct = r.headers.get('content-type') || '';
  return { status: r.status, ct, body: ct.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer()) };
};
let step = 0; const ok = (msg) => console.log('  ✓ ' + (++step) + '. ' + msg);
/* what Razorpay Checkout hands the browser after a payment: the ids and HMAC-SHA256(order|payment, key secret) */
const rzpPaid = (order, gateway, secret = process.env.RAZORPAY_KEY_SECRET) => {
  const rzOrder = gateway.razorpay_order_id, payId = 'pay_' + rzOrder.slice('order_'.length);
  return { order_id: order.id, razorpay_order_id: rzOrder, razorpay_payment_id: payId, razorpay_signature: crypto.createHmac('sha256', secret).update(rzOrder + '|' + payId).digest('hex') };
};

(async () => {
  pdb = await H.freshDatabase(); process.env.DATABASE_URL = pdb.url;
  app = await require('../server.cjs').createApp(); ({ server, db, auth, access, pricing } = app);
  await new Promise(r => server.listen(0, '127.0.0.1', r)); base = 'http://127.0.0.1:' + server.address().port;
  console.log('smoke test against ' + base + '  shop ' + process.env.DB_PATH + '  accounts ' + pdb.name);
  assert.deepEqual(app.imported, [5]); ok('the SQLite customer (id 5) was carried over to PostgreSQL with the same id');

  /* the old database was brought up to date on start */
  const row = id => db.q('SELECT * FROM worksheets WHERE id = ?').get(id);
  assert.equal(row('c2-mat-mul').price, 120); assert.equal(row('az-Z').price, 25); ok('upgrade: prices the admin changed are kept (c2-mat-mul ₹120, az-Z ₹25)');
  assert.equal(row('kg-evs-ani').title, 'Animal homes (edited)'); assert.equal(row('kg-evs-ani').subject, 'Science'); ok('upgrade: an edited title is kept while the untouched subject moves EVS → Science');
  assert.equal(row('az-D').price, 19); assert.equal(row('az-C').price, 0); assert.equal(row('counting').cls, 'kg'); assert.equal(row('nur-eng-abc').cls, 'kg'); assert.equal(row('alphabet').subject, 'English'); ok('upgrade: untouched fields follow the new seed (az-D now ₹19, Nursery sheets now Kindergarten)');
  ['nur-art-col', 'c1-hin-var', 'c2-hin-mat', 'c3-art-pat'].forEach(id => assert.equal(row(id).active, 0)); ok('upgrade: the Hindi and Art sheets are inactive');
  assert.equal(db.get('classes').nursery, undefined); assert.equal(db.get('seed_version'), 2); ok('upgrade: Nursery removed from the classes setting, seed version 2 recorded');
  /* the frontend's built-in defaults: then put the two edited prices back so the rest of the test sees the stock catalogue */
  db.q("UPDATE worksheets SET price = 99 WHERE id = 'c2-mat-mul'").run(); db.q("UPDATE worksheets SET price = 19 WHERE id = 'az-Z'").run();

  let r = await req('GET', '/api/config');
  assert.equal(r.status, 200); assert.deepEqual(r.body.gateways, { razorpay: 'test', stripe: false, paypal: false }); assert.equal(r.body.rates.INR, 1); assert.ok(r.body.rates.USD > 0); assert.deepEqual(Object.keys(r.body.classes), ['kg', 'c1', 'c2', 'c3']);
  ok('config: gateways razorpay=test, stripe=false, paypal=false; rates for the currency display; classes kg c1 c2 c3');

  r = await req('GET', '/api/worksheets');
  assert.equal(r.status, 200); const cat = r.body.worksheets, byId = Object.fromEntries(cat.map(w => [w.id, w]));
  assert.equal(cat.length, 107); assert.ok(!byId['nur-art-col'] && !byId['c1-hin-var']); assert.deepEqual([...new Set(cat.map(w => w.subject))].sort(), ['English', 'Maths', 'Science']);
  assert.ok(!byId['kg-mat-cnt'].real); ok('catalogue lists ' + cat.length + ' active worksheets, subjects English / Maths / Science only; a sheet is "real" only when its PDF is in the store');
  const PDF_IDS = [].concat('ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map(L => 'az-' + L), 'AINPST'.split('').map(L => 'rc-' + L), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map(L => 'cl-' + L),
    ['AE', 'FJ', 'KO', 'PT', 'UZ'].map(x => 'mt-' + x), ['AE', 'FJ', 'KO', 'PT', 'UZ'].map(x => 'sp-' + x), 'ABCDE'.split('').map(L => 'sd-' + L), [1, 2, 3].map(n => 'bx-' + n), [1, 2, 3].map(n => 'ex-' + n));
  assert.equal(PDF_IDS.length, 79);
  PDF_IDS.forEach(id => { assert.ok(byId[id], id + ' missing'); assert.ok(byId[id].real, id + ' has no PDF'); assert.equal(byId[id].cls, 'kg'); const f = row(id).file; assert.ok(f && fs.statSync(path.join(process.env.PROTECTED_DIR, f)).size > 1000, id + ' file ' + f); });
  ok('all 79 printable PDFs are in the catalogue with a real file in protected/ (az, rc, cl, mt, sp, sd, bx, ex)');
  const FREE = ['az-A', 'az-B', 'az-C', 'rc-A', 'rc-I', 'rc-N', 'cl-A', 'cl-B', 'cl-C', 'mt-AE', 'mt-FJ', 'mt-KO', 'sp-AE', 'sp-FJ', 'sp-KO', 'bx-1', 'bx-2', 'bx-3', 'ex-1', 'ex-2', 'ex-3'];
  PDF_IDS.forEach(id => assert.equal(byId[id].price, FREE.includes(id) ? 0 : 19, id + ' price'));
  ok('free / paid defaults match the shelf: ' + FREE.length + ' free samples, ' + (79 - FREE.length) + ' PDFs at ₹19');

  r = await req('POST', '/api/access/az-A'); assert.equal(r.status, 401); ok('opening a sheet signed out → 401');
  r = await req('POST', '/api/auth/signup', { name: 'Ria', email: 'ria@example.com' }); assert.equal(r.status, 201); assert.equal(cookie, ''); ok('sign up → 201, no session yet');
  r = await req('POST', '/api/auth/signup', { name: 'Ria', email: 'ria@example.com' }); assert.equal(r.status, 409); ok('duplicate email → 409');
  const welcome = H.lastMail(app, 'ria@example.com'), riaPass = H.passwordIn(welcome);
  r = await req('POST', '/api/auth/login', { email: 'ria@example.com', password: riaPass }); assert.equal(r.status, 403); assert.equal(r.body.code, 'email_unverified'); ok('generated password emailed; sign-in refused until the email is confirmed');
  r = await req('POST', '/api/auth/verify-email', { token: H.tokenIn(welcome, 'verify') }); assert.equal(r.status, 200);
  r = await req('POST', '/api/auth/login', { email: 'ria@example.com', password: riaPass, remember: true }); assert.equal(r.status, 200); assert.ok(cookie.startsWith('lww_sid=')); assert.ok(r.body.user.id > 5);
  ok('Accept & Continue confirms the email → sign in → httpOnly session cookie (new id ' + r.body.user.id + ' is past every old SQLite id)');
  r = await req('GET', '/api/auth/me'); assert.equal(r.status, 200); assert.equal(r.body.user.email, 'ria@example.com'); ok('GET /api/auth/me → the signed-in customer');
  r = await req('PATCH', '/api/auth/me', { role: 'teacher' }); assert.equal(r.status, 200); assert.equal(r.body.user.role, 'teacher'); ok('PATCH /api/auth/me saves the role picked after sign-up');

  /* FREE path */
  r = await req('POST', '/api/access/az-A'); assert.equal(r.status, 200); const free = r.body;
  assert.equal(free.entitlement.kind, 'free'); assert.ok(free.token && free.entitlement.active); ok('free sheet → server access check passes, free entitlement granted, view token issued');
  const T = { 'X-View-Token': free.token };
  r = await req('GET', '/api/view/meta', undefined, T); assert.equal(r.status, 200); assert.equal(r.body.user.email, 'ria@example.com'); assert.ok(r.body.hasPdf); ok('viewer meta → watermark identity + expiry');
  r = await req('GET', '/api/view/file', undefined, T); assert.equal(r.status, 200); assert.ok(r.ct.startsWith('application/pdf')); assert.equal(r.body.subarray(0, 4).toString(), '%PDF'); ok('PDF streams from private storage (' + r.body.length + ' bytes)');
  r = await req('GET', '/api/view/page?n=0', undefined, T); assert.equal(r.status, 200); assert.ok(r.ct.startsWith('image/jpeg')); ok('pre-rendered page image streams too');
  r = await req('GET', '/api/view/file', undefined, { 'X-View-Token': free.token.slice(0, -3) + 'abc' }); assert.equal(r.status, 403); ok('tampered token → 403');
  const saved = cookie; cookie = '';
  r = await req('GET', '/api/view/file', undefined, T); assert.equal(r.status, 401); cookie = saved; ok('valid token without the session cookie → 401 (links cannot be shared)');
  r = await req('POST', '/api/access/az-A'); assert.equal(r.body.entitlement.id, free.entitlement.id); ok('opening again reuses the running free entitlement');

  /* PAID path — single PDF */
  r = await req('POST', '/api/access/kg-mat-cnt'); assert.equal(r.status, 402); assert.equal(r.body.code, 'payment_required'); assert.equal(r.body.price, 59); ok('paid sheet without payment → 402 payment_required');
  const address = { country: 'IN', line1: '12 Lane', city: 'Pune', state: 'Maharashtra', postal: '411001' };
  r = await req('POST', '/api/quote', { worksheet: 'kg-mat-cnt', address }); assert.equal(r.status, 200); assert.ok(r.body.valid && r.body.sig); assert.equal(r.body.kind, 'worksheet'); const q1 = r.body; ok('signed quote for one PDF: ' + q1.currency + ' ' + q1.total + ' (' + q1.amountMinor + ' paise)');
  r = await req('POST', '/api/pay/order', { quote: Object.assign({}, q1, { total: 1 }), method: 'razorpay' }); assert.equal(r.status, 400); ok('edited quote → 400 (price cannot be changed in the browser)');
  {
    /* the same server without Razorpay keys: no gateway at all, so nothing can be ordered or settled */
    const keys = [process.env.RAZORPAY_KEY_ID, process.env.RAZORPAY_KEY_SECRET];
    delete process.env.RAZORPAY_KEY_ID; delete process.env.RAZORPAY_KEY_SECRET;
    const off = require('../server/payments.cjs').make(db, auth, access);
    [process.env.RAZORPAY_KEY_ID, process.env.RAZORPAY_KEY_SECRET] = keys;
    const call = async body => { const r = Object.assign(Readable.from([Buffer.from(JSON.stringify(body))]), { headers: { cookie } }); await auth.load(r); return r; };
    assert.deepEqual(off.gateways, { razorpay: false, stripe: false, paypal: false });
    await assert.rejects(off.createOrder(await call({ quote: q1, method: 'razorpay' }), null, pricing), e => e.status === 503 && e.extra.code === 'gateway_off');
    await assert.rejects(off.verify(await call({ order_id: 'LWO-000000' }), null), e => e.status === 503 && e.extra.code === 'gateway_off');
    ok('no Razorpay keys → razorpay=false in config; pay/order and pay/verify answer 503 gateway_off (no demo gateway)');
  }
  r = await req('POST', '/api/pay/order', { quote: q1, method: 'razorpay' }); assert.equal(r.status, 200); const o1 = r.body.order, g1 = r.body.gateway;
  assert.equal(g1.provider, 'razorpay'); assert.equal(g1.key, 'rzp_test_smoke'); assert.equal(g1.amount, q1.amountMinor); assert.equal(o1.method, 'razorpay'); ok('order ' + o1.id + ' created with Razorpay order ' + g1.razorpay_order_id + ' for ' + g1.amount + ' paise');
  r = await req('POST', '/api/access/kg-mat-cnt'); assert.equal(r.status, 402); ok('still 402 before the payment is confirmed');
  r = await req('POST', '/api/pay/demo/confirm', { order_id: o1.id }); assert.equal(r.status, 404); ok('there is no demo gateway: /api/pay/demo/confirm → 404');
  r = await req('POST', '/api/pay/verify', rzpPaid(o1, g1, 'not-the-secret')); assert.equal(r.status, 400); r = await req('POST', '/api/access/kg-mat-cnt'); assert.equal(r.status, 402); ok('a payment with a forged signature → 400, the sheet stays locked');
  r = await req('POST', '/api/pay/verify', rzpPaid(o1, g1)); assert.equal(r.status, 200); assert.equal(r.body.order.status, 'paid'); assert.equal(r.body.entitlement.scope, 'worksheet'); ok('payment verified → order paid → paid entitlement');
  r = await req('POST', '/api/access/kg-mat-cnt'); assert.equal(r.status, 200); assert.equal(r.body.entitlement.kind, 'paid'); assert.equal(r.body.worksheet.real, false); ok('paid sheet now opens (no PDF uploaded yet → placeholder page)');
  r = await req('POST', '/api/pay/verify', rzpPaid(o1, g1)); assert.equal(r.status, 200); r = await req('GET', '/api/me/entitlements'); assert.equal(r.body.entitlements.filter(e => e.order === o1.id).length, 1); ok('verifying twice is idempotent (one entitlement per order)');
  r = await req('POST', '/api/pay/order', { quote: q1, method: 'razorpay' }); assert.equal(r.status, 409); assert.equal(r.body.code, 'already_owned'); ok('a second order for a sheet already on the account → 409, nothing is charged twice');

  /* PAID path — class plan */
  r = await req('POST', '/api/quote', { cls: 'c1', plan: 'm1', address }); const q2 = r.body; assert.equal(q2.kind, 'class');
  r = await req('POST', '/api/pay/order', { quote: q2, method: 'razorpay' }); const o2 = r.body.order;
  r = await req('POST', '/api/pay/verify', rzpPaid(o2, r.body.gateway)); assert.equal(r.body.entitlement.scope, 'class');
  r = await req('POST', '/api/access/c1-mat-sub'); assert.equal(r.status, 200); const paid = r.body; ok('class plan → every sheet in Class 1 opens');
  r = await req('POST', '/api/access/c2-mat-mul'); assert.equal(r.status, 402); ok('…but Class 2 stays locked');

  /* PLAN LENGTH — a class plan runs for its months; a renewal starts when it ends; a sheet bought on its own never ends */
  const { addMonths } = require('../server/access.cjs');
  assert.equal(addMonths(Date.UTC(2027, 0, 31, 10), 1), Date.UTC(2027, 1, 28, 10)); assert.equal(addMonths(Date.UTC(2027, 4, 5, 9), 6), Date.UTC(2027, 10, 5, 9)); ok('months are calendar months (31 January + 1 month = 28 February)');
  assert.equal(paid.entitlement.end, addMonths(paid.entitlement.start, 1)); assert.equal(paid.entitlement.active, true); ok('a 1-month Class 1 plan ends one month after it starts');
  r = await req('GET', '/api/me/entitlements'); assert.equal(r.body.entitlements.find(e => e.order === o1.id).end, null); ok('a sheet bought on its own has no end');
  r = await req('POST', '/api/quote', { cls: 'c1', plan: 'm3', address }); r = await req('POST', '/api/pay/order', { quote: r.body, method: 'razorpay' }); const oRenew = r.body.order;
  r = await req('POST', '/api/pay/verify', rzpPaid(oRenew, r.body.gateway)); const renew = r.body.entitlement;
  assert.equal(renew.start, paid.entitlement.end); assert.equal(renew.end, addMonths(paid.entitlement.end, 3)); assert.equal(renew.active, false); ok('a 3-month renewal bought while the plan runs starts the day it ends — no day lost');
  r = await req('GET', '/api/view/meta', undefined, { 'X-View-Token': paid.token }); assert.equal(r.status, 200); assert.equal(r.body.scope, 'class'); assert.equal(r.body.until, paid.entitlement.end); ok('the viewer is told the plan and when it ends');
  /* time passes: the first month is over, the renewal has begun — the open tab carries on with it */
  const shift = (id, ms) => db.q('UPDATE entitlements SET starts_at = starts_at - ? WHERE id = ?').run(ms, id);
  const month = paid.entitlement.end - paid.entitlement.start + 1000;
  shift(paid.entitlement.id, month); shift(renew.id, month);
  r = await req('GET', '/api/view/meta', undefined, { 'X-View-Token': paid.token }); assert.equal(r.status, 200); assert.equal(r.body.until, addMonths(renew.start - month, 3)); ok('first month over → the open sheet keeps going on the renewal');
  r = await req('POST', '/api/access/c1-mat-sub'); assert.equal(r.status, 200); assert.equal(r.body.entitlement.id, renew.id); ok('…and opening it again uses the renewal');
  /* …and the renewal is over too: the plan has ended */
  shift(paid.entitlement.id, 120 * 864e5); shift(renew.id, 120 * 864e5);
  r = await req('GET', '/api/view/meta', undefined, { 'X-View-Token': paid.token }); assert.equal(r.status, 403); assert.equal(r.body.code, 'expired'); ok('plan over → the open viewer gets 403 "plan has ended" and closes');
  r = await req('POST', '/api/access/c1-mat-sub'); assert.equal(r.status, 402); ok('…and Class 1 sheets ask for payment again');
  r = await req('POST', '/api/access/kg-mat-cnt'); assert.equal(r.status, 200); ok('…while the sheet bought on its own still opens');
  r = await req('GET', '/api/me/entitlements'); assert.ok(r.body.entitlements.filter(e => e.scope === 'class').every(e => e.active === false)); ok('My plans shows the ended plans as not active');
  shift(paid.entitlement.id, -(month + 120 * 864e5)); db.q('DELETE FROM entitlements WHERE id = ?').run(renew.id);   /* back to the running 1-month plan for the checks below */

  /* ADMIN REVOKE ends any entitlement at once */
  r = await req('POST', '/api/admin/entitlements/revoke', { id: paid.entitlement.id }, { 'x-admin-key': 'test-admin-key' }); assert.equal(r.body.revoked, 1);
  r = await req('GET', '/api/view/meta', undefined, { 'X-View-Token': paid.token }); assert.equal(r.status, 403); assert.equal(r.body.code, 'revoked'); ok('admin revoke → the open viewer gets 403 and closes');
  r = await req('POST', '/api/access/c1-mat-sub'); assert.equal(r.status, 402); ok('…and the sheet is 402 again');
  r = await req('POST', '/api/access/az-A'); assert.equal(r.status, 200); assert.equal(r.body.entitlement.id, free.entitlement.id); ok('a free sheet opened earlier reuses its entitlement, whenever it is opened');

  /* PAID path — one printable PDF (₹19) with a real file */
  r = await req('POST', '/api/access/az-D'); assert.equal(r.status, 402); assert.equal(r.body.price, 19);
  r = await req('POST', '/api/quote', { worksheet: 'az-D', address }); assert.equal(r.status, 200); const q3 = r.body; assert.ok(q3.valid);
  r = await req('POST', '/api/pay/order', { quote: q3, method: 'razorpay', via: 'qr' }); assert.equal(r.status, 200); assert.equal(r.body.gateway.provider, 'razorpay'); const o3 = r.body.order;
  r = await req('POST', '/api/pay/verify', rzpPaid(o3, r.body.gateway)); assert.equal(r.status, 200); assert.equal(r.body.order.status, 'paid'); assert.equal(r.body.order.worksheet, 'az-D');
  r = await req('POST', '/api/access/az-D'); assert.equal(r.status, 200); assert.equal(r.body.worksheet.real, true);
  const T3 = { 'X-View-Token': r.body.token };
  r = await req('GET', '/api/view/meta', undefined, T3); assert.equal(r.status, 200); assert.equal(r.body.kind, 'paid'); assert.ok(r.body.hasPdf && r.body.hasImages);
  r = await req('GET', '/api/view/file', undefined, T3); assert.equal(r.status, 200); assert.equal(r.body.subarray(0, 4).toString(), '%PDF');
  r = await req('GET', '/api/view/page?n=0', undefined, T3); assert.equal(r.status, 200); assert.ok(r.ct.startsWith('image/jpeg'));
  ok('paid PDF az-D: 402 → quote ' + q3.currency + ' ' + q3.total + ' → Razorpay order → verified payment → opens; meta, PDF and page image stream');
  r = await req('POST', '/api/access/rc-I'); assert.equal(r.status, 200); assert.equal(r.body.entitlement.kind, 'free'); r = await req('POST', '/api/access/sd-A'); assert.equal(r.status, 402); ok('rc-I is a free sample, sd-A needs payment');

  /* cancel — back from a hosted page without paying */
  r = await req('POST', '/api/quote', { worksheet: 'az-E', address }); const q4 = r.body;
  r = await req('POST', '/api/pay/order', { quote: q4, method: 'razorpay' }); const o4 = r.body.order;
  r = await req('POST', '/api/pay/cancel', { order_id: o4.id }); assert.equal(r.status, 200); assert.equal(r.body.order.status, 'cancelled');
  r = await req('POST', '/api/access/az-E'); assert.equal(r.status, 402);
  r = await req('POST', '/api/pay/cancel', { order_id: o3.id }); assert.equal(r.status, 200); assert.equal(r.body.order.status, 'paid'); assert.equal(r.body.cancelled, false);
  r = await req('POST', '/api/pay/cancel', { order_id: 'LWO-000000' }); assert.equal(r.status, 404);
  ok('pay/cancel: an unpaid order becomes cancelled and its sheet stays locked; a paid order is left alone; unknown order → 404');

  /* Stripe and PayPal are not configured in this test */
  r = await req('POST', '/api/pay/order', { quote: q4, method: 'stripe', via: 'stripe' }); assert.equal(r.status, 503); assert.equal(r.body.code, 'gateway_off');
  r = await req('POST', '/api/pay/order', { quote: q4, method: 'paypal', via: 'paypal' }); assert.equal(r.status, 503);
  r = await req('POST', '/api/pay/stripe/confirm', { order_id: o4.id, session_id: 'cs_test' }); assert.equal(r.status, 503);
  r = await req('POST', '/api/pay/paypal/capture', { order_id: o4.id, token: 'PP123' }); assert.equal(r.status, 503);
  ok('Stripe / PayPal not configured → order, stripe/confirm and paypal/capture answer 503 gateway_off');

  /* webhook */
  db.q("UPDATE orders SET gateway_order_id = 'order_TEST1', status = 'created', method = 'razorpay' WHERE id = ?").run(o2.id);
  db.q("DELETE FROM entitlements WHERE order_id = ?").run(o2.id);
  const payload = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_TEST1', order_id: 'order_TEST1', amount: o2.amountMinor } } } });
  r = await req('POST', '/api/pay/webhook', payload, { 'X-Razorpay-Signature': 'nope', Origin: 'https://razorpay.com' }); assert.equal(r.status, 400); ok('webhook with a bad signature → 400');
  r = await req('POST', '/api/pay/webhook', payload, { 'X-Razorpay-Signature': crypto.createHmac('sha256', 'whsec_test').update(payload).digest('hex'), Origin: 'https://razorpay.com' }); assert.equal(r.status, 200);
  assert.equal(db.q('SELECT status FROM orders WHERE id = ?').get(o2.id).status, 'paid'); assert.equal(db.q('SELECT COUNT(*) AS n FROM entitlements WHERE order_id = ?').get(o2.id).n, 1); ok('signed webhook payment.captured → order paid + entitlement granted');

  /* security */
  r = await req('POST', '/api/access/az-A', undefined, { Origin: 'https://evil.example' }); assert.equal(r.status, 403); ok('cross-site POST → 403');
  r = await req('GET', '/api/admin/stats'); assert.equal(r.status, 401); r = await req('GET', '/api/admin/stats', undefined, { 'x-admin-key': 'test-admin-key' }); assert.equal(r.status, 200); assert.equal(r.body.users, 2); ok('admin API needs the key; stats: ' + r.body.paid_orders + ' paid orders, ₹' + r.body.revenue_inr);
  r = await req('PUT', '/api/admin/worksheets/new-sheet', { title: 'New sheet', cls: 'c2', subject: 'Maths', price: 30 }, { 'x-admin-key': 'test-admin-key' }); assert.equal(r.status, 200);
  r = await req('POST', '/api/admin/worksheets/new-sheet/file', fs.readFileSync(path.join(__dirname, '..', 'protected', 'a-to-z', 'B.pdf')), { 'x-admin-key': 'test-admin-key', 'Content-Type': 'application/pdf' }); assert.equal(r.status, 200); assert.ok(r.body.worksheet.real); ok('admin creates a worksheet and uploads its PDF into private storage');
  r = await fetch(base + '/protected/a-to-z/A.pdf'); assert.equal(r.status, 404); r = await fetch(base + '/../protected/a-to-z/A.pdf'); assert.ok(r.status >= 400); ok('protected/ is not reachable as a static path');

  /* contact form → messages table → admin inbox */
  const A = { 'x-admin-key': 'test-admin-key' };
  r = await req('POST', '/api/contact', { name: 'Asha', email: 'not-an-email', message: 'hi' }); assert.equal(r.status, 400); assert.ok(r.body.errors.email && r.body.errors.message);
  r = await req('POST', '/api/contact', { name: 'Asha Rao', email: 'asha@example.com', message: 'Do you have Class 2 Hindi sheets?' }); assert.equal(r.status, 201); assert.ok(r.body.id); assert.equal(r.body.mailed, true); assert.ok(H.lastMail(app, 'learnwithwhy6@gmail.com')); const msgId = r.body.id;
  r = await req('POST', '/api/contact', { name: 'Evil', email: 'e@example.com', message: 'posted from another site' }, { Origin: 'https://evil.example' }); assert.equal(r.status, 403);
  ok('contact: invalid note → 400 with field errors; valid note → 201 (saved and emailed to the inbox); cross-site → 403');
  r = await req('GET', '/api/admin/messages'); assert.equal(r.status, 401);
  r = await req('GET', '/api/admin/messages', undefined, A); assert.equal(r.status, 200); assert.equal(r.body.inbox, 'learnwithwhy6@gmail.com');
  let note = r.body.messages.find(x => x.id === msgId); assert.ok(note); assert.equal(note.name, 'Asha Rao'); assert.equal(note.email, 'asha@example.com'); assert.equal(note.body, 'Do you have Class 2 Hindi sheets?'); assert.equal(note.read, null); assert.equal(note.replied, null); assert.equal(note.mailed, true);
  r = await req('GET', '/api/admin/stats', undefined, A); assert.equal(r.body.messages_unread, 1);
  r = await req('POST', '/api/admin/messages/read', { id: msgId }, A); assert.equal(r.status, 200); assert.ok(r.body.message.read); assert.equal(r.body.message.replied, null);
  r = await req('POST', '/api/admin/messages/replied', { id: msgId }, A); assert.equal(r.status, 200); assert.ok(r.body.message.replied);
  r = await req('POST', '/api/admin/messages/read', { id: 99999 }, A); assert.equal(r.status, 404);
  r = await req('GET', '/api/admin/messages', undefined, A); note = r.body.messages.find(x => x.id === msgId); assert.ok(note.read && note.replied);
  ok('admin inbox: list (needs the key) → mark read → mark replied; unknown id → 404');
  for (let i = 0; i < 4; i++) { r = await req('POST', '/api/contact', { name: 'Asha', email: 'asha@example.com', message: 'Another note number ' + i }); assert.equal(r.status, 201); }
  r = await req('POST', '/api/contact', { name: 'Asha', email: 'asha@example.com', message: 'One note too many' }); assert.equal(r.status, 429); ok('contact is rate limited: the 6th note in 10 minutes → 429');

  /* the React site */
  const page = async p => { const x = await fetch(base + p); return { status: x.status, ct: x.headers.get('content-type') || '', text: await x.text(), h: x.headers }; };
  let pg = await page('/'); assert.equal(pg.status, 200); assert.ok(pg.ct.startsWith('text/html')); assert.ok(pg.text.includes('id="root"')); assert.equal(pg.h.get('x-frame-options'), 'SAMEORIGIN'); assert.equal(pg.h.get('x-content-type-options'), 'nosniff');
  const index = pg.text;
  for (const p of ['/admin', '/developer', '/some/deep/route']) { pg = await page(p); assert.equal(pg.status, 200); assert.equal(pg.text, index); }
  pg = await page('/viewer.html'); assert.equal(pg.status, 200); assert.ok(pg.text.includes('viewer-root'));
  pg = await page('/assets/does-not-exist.js'); assert.equal(pg.status, 404); pg = await page('/missing.png'); assert.equal(pg.status, 404); pg = await page('/.htaccess'); assert.equal(pg.status, 404);
  const asset = (index.match(/\/assets\/[^"']+\.js/) || ['/assets/main-test.js'])[0]; pg = await page(asset); assert.equal(pg.status, 200); assert.ok(pg.ct.startsWith('text/javascript')); if (realBuild) assert.ok(/immutable/.test(pg.h.get('cache-control')));
  r = await req('GET', '/api/nope'); assert.equal(r.status, 404); assert.ok(r.ct.includes('json'));
  ok('site (' + (realBuild ? 'react-app/dist' : 'stand-in build') + '): / , /admin, /developer → index.html; viewer.html served; missing assets and dotfiles → 404; unknown /api → JSON 404');

  /* password reset + sign out */
  r = await req('POST', '/api/auth/forgot-password', { email: 'ria@example.com' }); assert.equal(r.status, 200); const resetToken = H.tokenIn(H.lastMail(app, 'ria@example.com'), 'reset'); assert.ok(resetToken);
  r = await req('POST', '/api/auth/reset-password', { token: 'A'.repeat(43), password: 'Newpass123' }); assert.equal(r.status, 400);
  r = await req('POST', '/api/auth/reset-password', { token: resetToken, password: 'Newpass123' }); assert.equal(r.status, 200);
  r = await req('GET', '/api/auth/me'); assert.equal(r.status, 401); ok('password reset by email link works and signs every session out');
  r = await req('POST', '/api/auth/login', { email: 'ria@example.com', password: riaPass }); assert.equal(r.status, 401);
  r = await req('POST', '/api/auth/login', { email: 'ria@example.com', password: 'Newpass123' }); assert.equal(r.status, 200);
  r = await req('POST', '/api/auth/logout'); assert.equal(r.status, 200); assert.ok(/Max-Age=0/.test(lastSetCookie)); cookie = ''; r = await req('GET', '/api/auth/me'); assert.equal(r.status, 401); ok('sign in with the new password, sign out clears the cookie → 401');
  r = await req('POST', '/api/auth/login', { email: 'ria@example.com', password: 'Newpass123', remember: true }); assert.equal(r.status, 200); assert.ok(/HttpOnly/.test(lastSetCookie) && /SameSite=Lax/.test(lastSetCookie)); ok('the session cookie is HttpOnly + SameSite=Lax');

  /* the customer from the SQLite-only backend */
  cookie = '';
  r = await req('POST', '/api/auth/login', { email: 'old@example.com', password: 'Oldpass123' }); assert.equal(r.status, 200); assert.equal(r.body.user.id, 5);
  assert.match((await app.pg.one('SELECT password_hash FROM users WHERE id = 5')).password_hash, /^\$argon2id\$/);
  r = await req('GET', '/api/me/entitlements'); assert.ok(r.body.entitlements.some(e => e.worksheet === 'kg-mat-cnt' && e.kind === 'paid'));
  r = await req('POST', '/api/access/kg-mat-cnt'); assert.equal(r.status, 200); assert.equal(r.body.entitlement.kind, 'paid');
  ok('the old customer signs in with their old password (now re-hashed with Argon2id) and still has the sheet they bought');

  console.log('\nall ' + step + ' checks passed');
  await app.close(); await pdb.drop(); fs.rmSync(tmp, { recursive: true, force: true }); process.exit(0);
})().catch(async e => { console.error('\n✗ FAILED at step ' + (step + 1) + ':', e); if (app) await app.close().catch(() => {}); if (pdb) await pdb.drop().catch(() => {}); process.exit(1); });
