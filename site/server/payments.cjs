/* Copyright (c) 2026 Learn With Why. All rights reserved. Proprietary — see LICENSE. This notice may not be removed. */
/* PAYMENTS — Razorpay.

   1. POST /api/pay/order    the browser sends a signed quote; the server records an
                             order and creates the matching Razorpay order (amount in
                             paise). The browser opens Razorpay Checkout with its id.
   2. POST /api/pay/verify   Checkout hands back order id, payment id and a signature;
                             the server recomputes HMAC-SHA256(order|payment, key secret)
                             and only then marks the order paid and GRANTS THE ENTITLEMENT (permanent).
   3. POST /api/pay/webhook  Razorpay also calls this (payment.captured / order.paid),
                             signed with the webhook secret — the same grant happens
                             here if the browser closed before step 2. Idempotent.

   Without RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET the server runs a clearly
   labelled DEMO gateway so the site can be tried locally; nothing is charged. */
const crypto = require('node:crypto');
const { fail, json, readBody, readRaw, timingEqual } = require('./http.cjs');

const RZP_API = 'https://api.razorpay.com/v1';

function make(db, auth, access) {
  const KEY_ID = process.env.RAZORPAY_KEY_ID || '', KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || '', WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET || '';
  const live = !!(KEY_ID && KEY_SECRET);
  const mode = !live ? 'demo' : KEY_ID.startsWith('rzp_live_') ? 'live' : 'test';
  const q = {
    insert: db.q(`INSERT INTO orders (id, user_id, kind, cls, plan, worksheet_id, currency, total, total_inr, amount_minor, lines, coupon, address, method, status, gateway_order_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'created', NULL, ?)`),
    byId: db.q('SELECT * FROM orders WHERE id = ?'),
    byGateway: db.q('SELECT * FROM orders WHERE gateway_order_id = ?'),
    setGateway: db.q('UPDATE orders SET gateway_order_id = ? WHERE id = ?'),
    markPaid: db.q("UPDATE orders SET status = 'paid', paid_at = ?, gateway_payment_id = ? WHERE id = ? AND status <> 'paid'"),
    setStatus: db.q('UPDATE orders SET status = ? WHERE id = ?'),
    entOfOrder: db.q('SELECT * FROM entitlements WHERE order_id = ? LIMIT 1'),
    mine: db.q('SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC LIMIT 100'),
    event: db.q('INSERT INTO payments (at, order_id, gateway, event, ok, detail) VALUES (?, ?, ?, ?, ?, ?)'),
  };
  const event = (orderId, gateway, ev, ok, detail) => { try { q.event.run(Date.now(), orderId || null, gateway, ev, ok ? 1 : 0, detail ? String(typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 2000) : null); } catch (_) {} };
  const pub = o => ({ id: o.id, at: o.created_at, kind: o.kind, cls: o.cls, plan: o.plan, worksheet: o.worksheet_id, currency: o.currency, total: o.total, totalInr: o.total_inr, lines: JSON.parse(o.lines || '[]'), coupon: o.coupon, address: JSON.parse(o.address || 'null'), method: o.method, status: o.status, paidAt: o.paid_at, gatewayOrderId: o.gateway_order_id, paymentId: o.gateway_payment_id });
  const newId = () => 'LWO-' + crypto.randomInt(100000, 1000000);

  async function rzp(method, endpoint, body) {
    const r = await fetch(RZP_API + endpoint, { method, headers: { Authorization: 'Basic ' + Buffer.from(KEY_ID + ':' + KEY_SECRET).toString('base64'), 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000) });
    const out = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error((out.error && out.error.description) || ('Razorpay ' + r.status));
    return out;
  }

  /* the one place an order becomes paid — idempotent, in a transaction, grants the entitlement */
  function settle(order, paymentId, source) {
    return db.tx(() => {
      const fresh = q.byId.get(order.id);
      if (fresh.status === 'paid') { const e = q.entOfOrder.get(order.id); event(order.id, order.method, source + ' (already paid)', true, paymentId); return { order: fresh, ent: e, already: true }; }
      const now = Date.now();
      q.markPaid.run(now, paymentId || null, order.id);
      const scope = fresh.kind === 'worksheet' ? 'worksheet' : 'class';
      const g = access.grant(fresh.user_id, scope, scope === 'worksheet' ? fresh.worksheet_id : fresh.cls, 'paid', fresh.id, fresh.plan, now);
      if (fresh.coupon) { const cs = db.get('coupons'); if (cs[fresh.coupon]) { cs[fresh.coupon].uses = (cs[fresh.coupon].uses || 0) + 1; db.set('coupons', cs); } }
      event(order.id, fresh.method, source, true, paymentId);
      return { order: q.byId.get(order.id), ent: db.q('SELECT * FROM entitlements WHERE id = ?').get(g.id), already: false };
    });
  }

  /* POST /api/pay/order */
  async function createOrder(req, res, pricing) {
    const user = auth.requireUser(req); const b = await readBody(req); const qt = b.quote;
    if (!pricing.verify(qt)) fail(400, 'This quote is not valid any more — refresh the price and try again.');
    const method = String(b.method || 'razorpay');
    if (!qt.methods.includes(method)) fail(400, 'That payment method is not available in ' + qt.countryName + '.');
    if (method !== 'razorpay') fail(501, 'Only Razorpay is connected right now — pick Razorpay to pay by UPI, card or net banking.');
    if (qt.amountMinor < 100 && qt.currency === 'INR') fail(400, 'The amount is below the gateway minimum (₹1).');
    const id = newId();
    q.insert.run(id, user.id, qt.kind, qt.cls || null, qt.plan || null, qt.worksheet || null, qt.currency, qt.total, pricing.round(qt.total / qt.rate, 'INR'), qt.amountMinor, JSON.stringify(qt.lines), qt.coupon || null, JSON.stringify(qt.address), live ? 'razorpay' : 'demo', Date.now());
    const order = q.byId.get(id);
    const description = qt.kind === 'worksheet' ? qt.title : qt.className + ' plan · ' + qt.planLabel;
    if (!live) { event(id, 'demo', 'order.created', true, 'demo gateway — no Razorpay keys configured'); return json(res, 200, { order: pub(order), gateway: { provider: 'demo', description, note: 'Demo gateway — set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET to take real payments.' } }); }
    let rz;
    try { rz = await rzp('POST', '/orders', { amount: qt.amountMinor, currency: qt.currency, receipt: id, notes: { order: id, email: user.email, kind: qt.kind, cls: qt.cls || '', worksheet: qt.worksheet || '' } }); }
    catch (e) { q.setStatus.run('failed', id); event(id, 'razorpay', 'order.create_failed', false, e.message); fail(502, 'Could not reach the payment gateway: ' + e.message); }
    q.setGateway.run(rz.id, id); event(id, 'razorpay', 'order.created', true, rz.id);
    json(res, 200, { order: pub(q.byId.get(id)), gateway: { provider: 'razorpay', mode, key: KEY_ID, razorpay_order_id: rz.id, amount: rz.amount, currency: rz.currency, name: 'Learn With Why', description, prefill: { name: user.name, email: user.email }, theme: { color: '#1f6b47' } } });
  }

  /* POST /api/pay/verify — from Razorpay Checkout's success handler */
  async function verify(req, res) {
    const user = auth.requireUser(req); const b = await readBody(req);
    const order = q.byId.get(String(b.order_id || '')); if (!order || order.user_id !== user.id) fail(404, 'No such order.');
    if (order.method !== 'razorpay' || !live) fail(400, 'This order does not use Razorpay.');
    const rzOrder = String(b.razorpay_order_id || ''), payId = String(b.razorpay_payment_id || ''), sig = String(b.razorpay_signature || '');
    if (rzOrder !== order.gateway_order_id) { event(order.id, 'razorpay', 'verify.mismatch', false, rzOrder); fail(400, 'Payment does not belong to this order.'); }
    const expect = crypto.createHmac('sha256', KEY_SECRET).update(rzOrder + '|' + payId).digest('hex');
    if (!timingEqual(expect, sig)) { event(order.id, 'razorpay', 'verify.bad_signature', false, payId); fail(400, 'Payment signature did not verify.'); }
    /* belt and braces: ask Razorpay about the payment when we can reach it */
    try { const p = await rzp('GET', '/payments/' + encodeURIComponent(payId)); if (p.order_id !== rzOrder || +p.amount !== order.amount_minor || !['captured', 'authorized'].includes(p.status)) { event(order.id, 'razorpay', 'verify.payment_check', false, p); fail(400, 'Payment is ' + (p.status || 'unknown') + ' — not accepted.'); } }
    catch (e) { if (e.status) throw e; event(order.id, 'razorpay', 'verify.payment_check_skipped', true, e.message); }
    const s = settle(order, payId, 'verify');
    json(res, 200, { ok: true, order: pub(s.order), entitlement: access.pub(s.ent) });
  }

  /* POST /api/pay/webhook — raw body, signed with the webhook secret */
  async function webhook(req, res) {
    const raw = await readRaw(req, 256 * 1024);
    if (!WEBHOOK_SECRET) { event(null, 'razorpay', 'webhook.ignored', false, 'RAZORPAY_WEBHOOK_SECRET not set'); return json(res, 200, { ok: true, ignored: true }); }
    const sig = String(req.headers['x-razorpay-signature'] || '');
    const expect = crypto.createHmac('sha256', WEBHOOK_SECRET).update(raw).digest('hex');
    if (!timingEqual(expect, sig)) { event(null, 'razorpay', 'webhook.bad_signature', false, null); return json(res, 400, { error: 'bad signature' }); }
    let ev; try { ev = JSON.parse(raw.toString('utf8')); } catch (_) { return json(res, 400, { error: 'bad json' }); }
    const pay = ev.payload && ev.payload.payment && ev.payload.payment.entity;
    if (['payment.captured', 'order.paid'].includes(ev.event) && pay && pay.order_id) {
      const order = q.byGateway.get(pay.order_id);
      if (order) { settle(order, pay.id, 'webhook:' + ev.event); } else event(null, 'razorpay', ev.event, false, 'unknown order ' + pay.order_id);
    } else if (ev.event === 'payment.failed' && pay && pay.order_id) {
      const order = q.byGateway.get(pay.order_id); if (order && order.status === 'created') { q.setStatus.run('failed', order.id); event(order.id, 'razorpay', ev.event, false, pay.error_description || null); }
    } else event(null, 'razorpay', ev.event || 'unknown', true, null);
    json(res, 200, { ok: true });
  }

  /* POST /api/pay/demo/confirm — only exists while no gateway keys are configured */
  async function demoConfirm(req, res) {
    if (live) fail(404, 'Not found');
    const user = auth.requireUser(req); const b = await readBody(req);
    const order = q.byId.get(String(b.order_id || '')); if (!order || order.user_id !== user.id) fail(404, 'No such order.');
    const s = settle(order, 'demo_' + crypto.randomBytes(6).toString('hex'), 'demo.confirm');
    json(res, 200, { ok: true, demo: true, order: pub(s.order), entitlement: access.pub(s.ent) });
  }
  function mine(req, res) { const u = auth.requireUser(req); json(res, 200, { orders: q.mine.all(u.id).map(pub) }); }

  return { mode, live, createOrder, verify, webhook, demoConfirm, mine, pub, settle };
}

module.exports = { make };
