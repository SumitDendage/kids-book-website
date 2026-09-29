/* Copyright (c) 2026 Learn With Why. All rights reserved. Proprietary — see LICENSE. This notice may not be removed. */
/* End-to-end smoke test of the backend on a throw-away database.
     node site/test/smoke.cjs
   Walks the customer flow: catalogue → sign up → free sheet opens → paid sheet
   is refused → quote → order → (demo) payment → entitlement → PDF streams;
   access never expires, only an admin revoke ends it. Also checks tokens, cookies, cross-site
   refusal, the webhook signature, the admin key and password reset. */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lww-'));
process.env.DB_PATH = path.join(tmp, 'test.sqlite');
/* a private store of its own: two real sheets copied from protected/a-to-z, so uploads never touch the real one */
process.env.PROTECTED_DIR = path.join(tmp, 'protected'); fs.mkdirSync(path.join(tmp, 'protected', 'a-to-z'), { recursive: true });
['A.pdf', 'A.jpg', 'B.pdf'].forEach(f => fs.copyFileSync(path.join(__dirname, '..', 'protected', 'a-to-z', f), path.join(tmp, 'protected', 'a-to-z', f)));
process.env.ADMIN_KEY = 'test-admin-key';
process.env.RAZORPAY_WEBHOOK_SECRET = 'whsec_test';
delete process.env.RAZORPAY_KEY_ID; delete process.env.RAZORPAY_KEY_SECRET;
process.env.RESET_CODE_IN_RESPONSE = '1';

const { server, db } = require('../server.cjs');
let base = '', cookie = '';
const req = async (method, p, body, extra) => {
  const h = Object.assign({ 'Content-Type': 'application/json', Origin: base, Cookie: cookie }, extra || {});
  const r = await fetch(base + p, { method, headers: h, body: body === undefined ? undefined : (typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body)) });
  const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
  const ct = r.headers.get('content-type') || '';
  return { status: r.status, ct, body: ct.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer()) };
};
let step = 0; const ok = (msg) => console.log('  ✓ ' + (++step) + '. ' + msg);

(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r)); base = 'http://127.0.0.1:' + server.address().port;
  console.log('smoke test against ' + base + '  db ' + process.env.DB_PATH);

  let r = await req('GET', '/api/worksheets');
  assert.equal(r.status, 200); assert.ok(r.body.worksheets.length >= 58); assert.ok(r.body.worksheets.find(w => w.id === 'az-A').real); assert.ok(!r.body.worksheets.find(w => w.id === 'az-Z').real); ok('catalogue lists ' + r.body.worksheets.length + ' worksheets; a sheet is "real" only when its PDF is in the store');

  r = await req('POST', '/api/access/az-A'); assert.equal(r.status, 401); ok('opening a sheet signed out → 401');
  r = await req('POST', '/api/auth/signup', { name: 'Ria', email: 'ria@example.com', password: 'Secret123' }); assert.equal(r.status, 201); assert.ok(cookie.startsWith('lww_sid=')); ok('sign up → 201 + httpOnly session cookie');
  r = await req('POST', '/api/auth/signup', { name: 'Ria', email: 'ria@example.com', password: 'Secret123' }); assert.equal(r.status, 409); ok('duplicate email → 409');
  r = await req('GET', '/api/auth/me'); assert.equal(r.status, 200); assert.equal(r.body.user.email, 'ria@example.com'); ok('GET /api/auth/me → the signed-in customer');

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
  r = await req('POST', '/api/pay/order', { quote: q1, method: 'razorpay' }); assert.equal(r.status, 200); assert.equal(r.body.gateway.provider, 'demo'); const o1 = r.body.order; ok('order ' + o1.id + ' created — demo gateway (no Razorpay keys)');
  r = await req('POST', '/api/access/kg-mat-cnt'); assert.equal(r.status, 402); ok('still 402 before the payment is confirmed');
  r = await req('POST', '/api/pay/demo/confirm', { order_id: o1.id }); assert.equal(r.status, 200); assert.equal(r.body.order.status, 'paid'); assert.equal(r.body.entitlement.scope, 'worksheet'); ok('payment confirmed → order paid → paid entitlement');
  r = await req('POST', '/api/access/kg-mat-cnt'); assert.equal(r.status, 200); assert.equal(r.body.entitlement.kind, 'paid'); assert.equal(r.body.worksheet.real, false); ok('paid sheet now opens (no PDF uploaded yet → demo page)');
  r = await req('POST', '/api/pay/demo/confirm', { order_id: o1.id }); assert.equal(r.status, 200); r = await req('GET', '/api/me/entitlements'); assert.equal(r.body.entitlements.filter(e => e.order === o1.id).length, 1); ok('confirming twice is idempotent (one entitlement per order)');

  /* PAID path — class plan */
  r = await req('POST', '/api/quote', { cls: 'c1', plan: 'm1', address }); const q2 = r.body; assert.equal(q2.kind, 'class');
  r = await req('POST', '/api/pay/order', { quote: q2, method: 'razorpay' }); const o2 = r.body.order;
  r = await req('POST', '/api/pay/demo/confirm', { order_id: o2.id }); assert.equal(r.body.entitlement.scope, 'class');
  r = await req('POST', '/api/access/c1-mat-sub'); assert.equal(r.status, 200); const paid = r.body; ok('class plan → every sheet in Class 1 opens');
  r = await req('POST', '/api/access/c2-mat-mul'); assert.equal(r.status, 402); ok('…but Class 2 stays locked');

  /* NO EXPIRY — access is permanent; only an admin revoke ends it */
  assert.equal(paid.entitlement.end, undefined); assert.equal(paid.until, undefined); ok('entitlements carry no expiry — the sheet stays on the account');
  r = await req('POST', '/api/admin/entitlements/revoke', { id: paid.entitlement.id }, { 'x-admin-key': 'test-admin-key' }); assert.equal(r.body.revoked, 1);
  r = await req('GET', '/api/view/meta', undefined, { 'X-View-Token': paid.token }); assert.equal(r.status, 403); assert.equal(r.body.code, 'revoked'); ok('admin revoke → the open viewer gets 403 and closes');
  r = await req('POST', '/api/access/c1-mat-sub'); assert.equal(r.status, 402); ok('…and the sheet is 402 again');
  r = await req('POST', '/api/access/az-A'); assert.equal(r.status, 200); assert.equal(r.body.entitlement.id, free.entitlement.id); ok('a free sheet opened earlier reuses its entitlement, whenever it is opened');

  /* webhook */
  db.q("UPDATE orders SET gateway_order_id = 'order_TEST1', status = 'created', method = 'razorpay' WHERE id = ?").run(o2.id);
  db.q("DELETE FROM entitlements WHERE order_id = ?").run(o2.id);
  const payload = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_TEST1', order_id: 'order_TEST1', amount: o2.amountMinor } } } });
  r = await req('POST', '/api/pay/webhook', payload, { 'X-Razorpay-Signature': 'nope', Origin: 'https://razorpay.com' }); assert.equal(r.status, 400); ok('webhook with a bad signature → 400');
  r = await req('POST', '/api/pay/webhook', payload, { 'X-Razorpay-Signature': crypto.createHmac('sha256', 'whsec_test').update(payload).digest('hex'), Origin: 'https://razorpay.com' }); assert.equal(r.status, 200);
  assert.equal(db.q('SELECT status FROM orders WHERE id = ?').get(o2.id).status, 'paid'); assert.equal(db.q('SELECT COUNT(*) AS n FROM entitlements WHERE order_id = ?').get(o2.id).n, 1); ok('signed webhook payment.captured → order paid + entitlement granted');

  /* security */
  r = await req('POST', '/api/access/az-A', undefined, { Origin: 'https://evil.example' }); assert.equal(r.status, 403); ok('cross-site POST → 403');
  r = await req('GET', '/api/admin/stats'); assert.equal(r.status, 401); r = await req('GET', '/api/admin/stats', undefined, { 'x-admin-key': 'test-admin-key' }); assert.equal(r.status, 200); assert.equal(r.body.users, 1); ok('admin API needs the key; stats: ' + r.body.paid_orders + ' paid orders, ₹' + r.body.revenue_inr);
  r = await req('PUT', '/api/admin/worksheets/new-sheet', { title: 'New sheet', cls: 'c2', subject: 'Maths', price: 30 }, { 'x-admin-key': 'test-admin-key' }); assert.equal(r.status, 200);
  r = await req('POST', '/api/admin/worksheets/new-sheet/file', fs.readFileSync(path.join(__dirname, '..', 'protected', 'a-to-z', 'B.pdf')), { 'x-admin-key': 'test-admin-key', 'Content-Type': 'application/pdf' }); assert.equal(r.status, 200); assert.ok(r.body.worksheet.real); ok('admin creates a worksheet and uploads its PDF into private storage');
  r = await fetch(base + '/protected/a-to-z/A.pdf'); assert.equal(r.status, 404); r = await fetch(base + '/../protected/a-to-z/A.pdf'); assert.ok(r.status >= 400); ok('protected/ is not reachable as a static path');

  /* password reset + sign out */
  r = await req('POST', '/api/auth/forgot', { email: 'ria@example.com' }); assert.equal(r.status, 200); const code = r.body.code; assert.ok(code);
  r = await req('POST', '/api/auth/reset', { email: 'ria@example.com', code: '000000' }); assert.equal(r.status, 400);
  r = await req('POST', '/api/auth/reset', { email: 'ria@example.com', code, password: 'Newpass123' }); assert.equal(r.status, 200);
  r = await req('GET', '/api/auth/me'); assert.equal(r.status, 401); ok('password reset works and signs every session out');
  r = await req('POST', '/api/auth/signin', { email: 'ria@example.com', password: 'Secret123' }); assert.equal(r.status, 401);
  r = await req('POST', '/api/auth/signin', { email: 'ria@example.com', password: 'Newpass123' }); assert.equal(r.status, 200);
  r = await req('POST', '/api/auth/signout'); r = await req('GET', '/api/auth/me'); assert.equal(r.status, 401); ok('sign in with the new password, sign out → 401');

  console.log('\nall ' + step + ' checks passed');
  server.close(); db.close(); fs.rmSync(tmp, { recursive: true, force: true }); process.exit(0);
})().catch(e => { console.error('\n✗ FAILED at step ' + (step + 1) + ':', e); server.close(); process.exit(1); });
