/* Copyright (c) 2026 Learn With Why. All rights reserved. Proprietary — see LICENSE. This notice may not be removed. */
/* PAYMENTS — Razorpay, plus hosted Stripe Checkout and PayPal Checkout.

   1. POST /api/pay/order    the browser sends a signed quote; the server records an
                             order and creates the matching Razorpay order (amount in
                             paise). The browser opens Razorpay Checkout with its id.
   2. POST /api/pay/verify   Checkout hands back order id, payment id and a signature;
                             the server recomputes HMAC-SHA256(order|payment, key secret)
                             and only then marks the order paid and GRANTS THE ENTITLEMENT (permanent).
   3. POST /api/pay/webhook  Razorpay also calls this (payment.captured / order.paid),
                             signed with the webhook secret — the same grant happens
                             here if the browser closed before step 2. Idempotent.

   Without RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET Razorpay is not connected: no
   order can be paid through it and no access is granted without a real payment.

   STRIPE and PAYPAL are hosted pages (the checkout sends the browser away and it
   comes back to /?pay=…). Each switches on only when its keys are set:
     stripe  STRIPE_SECRET_KEY                        order → Checkout Session (gateway.url) →
             back at /?pay=stripe&order=…&session=…  → POST /api/pay/stripe/confirm asks Stripe
             for the session and settles only when it is paid, for this order, for this amount.
     paypal  PAYPAL_CLIENT_ID + PAYPAL_SECRET (+ PAYPAL_MODE sandbox | live)
             order → PayPal order (gateway.url = the approve link) →
             back at /?pay=paypal&order=…&token=…    → POST /api/pay/paypal/capture captures it
             and settles only when PayPal says COMPLETED for this amount and currency.
     cancel  back at /?pay=cancel&order=…            → POST /api/pay/cancel marks the order cancelled.
   /api/config reports each gateway (Razorpay included) as false while it is not
   configured, and the checkout shows it as "coming soon"; calling it anyway answers 503. */
const crypto = require('node:crypto');
const { fail, json, readBody, readRaw, timingEqual } = require('./http.cjs');

const RZP_API = 'https://api.razorpay.com/v1';
const STRIPE_API = 'https://api.stripe.com/v1';
const PAYPAL_API = { sandbox: 'https://api-m.sandbox.paypal.com', live: 'https://api-m.paypal.com' };
/* thrown by the gateway helpers: a message for the customer, kept apart from our own HttpErrors */
class GatewayError extends Error { constructor(message, status, body) { super(message); this.gwStatus = status; this.body = body; } }

function make(db, auth, access) {
  const KEY_ID = process.env.RAZORPAY_KEY_ID || '', KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || '', WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET || '';
  const live = !!(KEY_ID && KEY_SECRET);
  const mode = !live ? false : KEY_ID.startsWith('rzp_live_') ? 'live' : 'test';
  const STRIPE_KEY = process.env.STRIPE_SECRET_KEY || '';
  const stripeMode = !STRIPE_KEY ? false : STRIPE_KEY.startsWith('sk_live_') || STRIPE_KEY.startsWith('rk_live_') ? 'live' : 'test';
  const PP_ID = process.env.PAYPAL_CLIENT_ID || '', PP_SECRET = process.env.PAYPAL_SECRET || '';
  const paypalMode = !(PP_ID && PP_SECRET) ? false : String(process.env.PAYPAL_MODE || 'sandbox').toLowerCase() === 'live' ? 'live' : 'sandbox';
  /* what /api/config tells the checkout: false = not connected (shown as "coming soon") */
  const gateways = { razorpay: mode, stripe: stripeMode, paypal: paypalMode };
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
  /* Stripe's API takes form-encoded bodies with bracketed keys: line_items[0][price_data][currency]=usd */
  const form = (obj, prefix, out = []) => { Object.keys(obj).forEach(k => { const v = obj[k], key = prefix ? prefix + '[' + k + ']' : k; if (v == null) return; if (typeof v === 'object') form(v, key, out); else out.push(encodeURIComponent(key) + '=' + encodeURIComponent(String(v))); }); return out.join('&'); };
  async function stripe(method, endpoint, body) {
    const r = await fetch(STRIPE_API + endpoint, { method, headers: { Authorization: 'Bearer ' + STRIPE_KEY, 'Content-Type': 'application/x-www-form-urlencoded' }, body: body ? form(body) : undefined, signal: AbortSignal.timeout(20000) });
    const out = await r.json().catch(() => ({}));
    if (!r.ok) throw new GatewayError((out.error && out.error.message) || ('Stripe ' + r.status), r.status, out);
    return out;
  }
  let ppToken = null;   /* { value, exp } — PayPal access tokens last hours; refreshed a minute early */
  async function paypal(method, endpoint, body) {
    const base = PAYPAL_API[paypalMode];
    if (!ppToken || ppToken.exp < Date.now() + 60e3) {
      const t = await fetch(base + '/v1/oauth2/token', { method: 'POST', headers: { Authorization: 'Basic ' + Buffer.from(PP_ID + ':' + PP_SECRET).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'grant_type=client_credentials', signal: AbortSignal.timeout(20000) });
      const tj = await t.json().catch(() => ({}));
      if (!t.ok || !tj.access_token) throw new GatewayError('PayPal sign-in failed: ' + (tj.error_description || t.status), t.status, tj);
      ppToken = { value: tj.access_token, exp: Date.now() + (+tj.expires_in || 3000) * 1000 };
    }
    const r = await fetch(base + endpoint, { method, headers: { Authorization: 'Bearer ' + ppToken.value, 'Content-Type': 'application/json', Prefer: 'return=representation' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000) });
    const out = await r.json().catch(() => ({}));
    if (!r.ok) { const d = out.details && out.details[0]; throw new GatewayError((d && (d.description || d.issue)) || out.message || ('PayPal ' + r.status), r.status, out); }
    return out;
  }
  /* where the hosted pages send the customer back: SITE_URL, or the host this request came to */
  const siteBase = req => (process.env.SITE_URL || ((req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http') + '://' + req.headers.host)).replace(/\/+$/, '');
  /* PayPal wants a decimal string with the currency's own number of decimals */
  const ppValue = (order) => { const d = order.currency === 'JPY' ? 0 : 2; return (order.amount_minor / Math.pow(10, d)).toFixed(d); };
  function ownOrder(user, id) { const o = q.byId.get(String(id || '')); if (!o || o.user_id !== user.id) fail(404, 'No such order.'); return o; }

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
    if (!['razorpay', 'stripe', 'paypal'].includes(method)) fail(400, 'Unknown payment method.');
    if (!qt.methods.includes(method)) fail(400, 'That payment method is not available in ' + qt.countryName + '.');
    if (method === 'razorpay' && !live) fail(503, 'Razorpay is not connected on this server yet — online payment is not available.', { code: 'gateway_off' });
    if (method === 'stripe' && !stripeMode) fail(503, 'Stripe is not connected on this server yet — pick another way to pay.', { code: 'gateway_off' });
    if (method === 'paypal' && !paypalMode) fail(503, 'PayPal is not connected on this server yet — pick another way to pay.', { code: 'gateway_off' });
    if (qt.amountMinor < 100 && qt.currency === 'INR') fail(400, 'The amount is below the gateway minimum (₹1).');
    const id = newId();
    q.insert.run(id, user.id, qt.kind, qt.cls || null, qt.plan || null, qt.worksheet || null, qt.currency, qt.total, pricing.round(qt.total / qt.rate, 'INR'), qt.amountMinor, JSON.stringify(qt.lines), qt.coupon || null, JSON.stringify(qt.address), method, Date.now());
    const order = q.byId.get(id);
    const description = qt.kind === 'worksheet' ? qt.title : qt.className + ' plan · ' + qt.planLabel;
    if (method === 'stripe' || method === 'paypal') return hostedOrder(req, res, user, order, method, description);
    let rz;
    try { rz = await rzp('POST', '/orders', { amount: qt.amountMinor, currency: qt.currency, receipt: id, notes: { order: id, email: user.email, kind: qt.kind, cls: qt.cls || '', worksheet: qt.worksheet || '' } }); }
    catch (e) { q.setStatus.run('failed', id); event(id, 'razorpay', 'order.create_failed', false, e.message); fail(502, 'Could not reach the payment gateway: ' + e.message); }
    q.setGateway.run(rz.id, id); event(id, 'razorpay', 'order.created', true, rz.id);
    json(res, 200, { order: pub(q.byId.get(id)), gateway: { provider: 'razorpay', mode, key: KEY_ID, razorpay_order_id: rz.id, amount: rz.amount, currency: rz.currency, name: 'Learn With Why', description, prefill: { name: user.name, email: user.email }, theme: { color: '#1f6b47' } } });
  }

  /* POST /api/pay/verify — from Razorpay Checkout's success handler */
  async function verify(req, res) {
    if (!live) fail(503, 'Razorpay is not connected on this server.', { code: 'gateway_off' });
    const user = auth.requireUser(req); const b = await readBody(req);
    const order = q.byId.get(String(b.order_id || '')); if (!order || order.user_id !== user.id) fail(404, 'No such order.');
    if (order.method !== 'razorpay') fail(400, 'This order does not use Razorpay.');
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

  /* the hosted pages: create the Stripe Checkout Session / PayPal order and hand back its URL */
  async function hostedOrder(req, res, user, order, method, description) {
    const base = siteBase(req), id = order.id, cancelUrl = base + '/?pay=cancel&order=' + encodeURIComponent(id);
    try {
      if (method === 'stripe') {
        const s = await stripe('POST', '/checkout/sessions', {
          mode: 'payment', client_reference_id: id, customer_email: user.email,
          success_url: base + '/?pay=stripe&order=' + encodeURIComponent(id) + '&session={CHECKOUT_SESSION_ID}', cancel_url: cancelUrl,
          line_items: [{ quantity: 1, price_data: { currency: order.currency.toLowerCase(), unit_amount: order.amount_minor, product_data: { name: description.slice(0, 200) } } }],
          metadata: { order: id, kind: order.kind, worksheet: order.worksheet_id || '' }, payment_intent_data: { metadata: { order: id } },
        });
        q.setGateway.run(s.id, id); event(id, 'stripe', 'session.created', true, s.id);
        return json(res, 200, { order: pub(q.byId.get(id)), gateway: { provider: 'stripe', mode: stripeMode, url: s.url, session: s.id, description } });
      }
      const p = await paypal('POST', '/v2/checkout/orders', {
        intent: 'CAPTURE',
        purchase_units: [{ reference_id: id, custom_id: id, invoice_id: id, description: description.slice(0, 127), amount: { currency_code: order.currency, value: ppValue(order) } }],
        payment_source: { paypal: { experience_context: { brand_name: 'Learn With Why', user_action: 'PAY_NOW', shipping_preference: 'NO_SHIPPING', return_url: base + '/?pay=paypal&order=' + encodeURIComponent(id), cancel_url: cancelUrl } } },
      });
      const link = (p.links || []).find(l => l.rel === 'payer-action' || l.rel === 'approve');
      if (!link) throw new GatewayError('PayPal did not return an approval link.', 502, p);
      q.setGateway.run(p.id, id); event(id, 'paypal', 'order.created', true, p.id);
      return json(res, 200, { order: pub(q.byId.get(id)), gateway: { provider: 'paypal', mode: paypalMode, url: link.href, paypal_order_id: p.id, description } });
    } catch (e) {
      if (!(e instanceof GatewayError)) throw e;
      q.setStatus.run('failed', id); event(id, method, 'order.create_failed', false, e.message);
      fail(502, 'Could not start the ' + (method === 'stripe' ? 'Stripe' : 'PayPal') + ' payment: ' + e.message);
    }
  }

  /* POST /api/pay/stripe/confirm { order_id, session_id } — back from Stripe Checkout */
  async function stripeConfirm(req, res) {
    if (!stripeMode) fail(503, 'Stripe is not connected on this server.', { code: 'gateway_off' });
    const user = auth.requireUser(req); const b = await readBody(req);
    const order = ownOrder(user, b.order_id);
    if (order.method !== 'stripe') fail(400, 'This order does not use Stripe.');
    const sid = String(b.session_id || '') || order.gateway_order_id || '';
    if (!sid || sid !== order.gateway_order_id) { event(order.id, 'stripe', 'confirm.mismatch', false, sid); fail(400, 'This payment does not belong to that order.'); }
    if (order.status === 'paid') { const s = settle(order, order.gateway_payment_id, 'stripe.confirm'); return json(res, 200, { ok: true, order: pub(s.order), entitlement: access.pub(s.ent) }); }
    let s; try { s = await stripe('GET', '/checkout/sessions/' + encodeURIComponent(sid)); }
    catch (e) { if (!(e instanceof GatewayError)) throw e; event(order.id, 'stripe', 'confirm.lookup_failed', false, e.message); fail(502, 'Could not reach Stripe to confirm the payment: ' + e.message); }
    const good = s.payment_status === 'paid' && s.client_reference_id === order.id && +s.amount_total === order.amount_minor && String(s.currency || '').toUpperCase() === order.currency;
    if (!good) { event(order.id, 'stripe', 'confirm.not_paid', false, { status: s.status, payment_status: s.payment_status, amount: s.amount_total, currency: s.currency }); fail(402, s.payment_status === 'unpaid' ? 'Stripe has not received this payment yet — nothing was charged.' : 'Stripe did not confirm this payment.', { code: 'not_paid' }); }
    const done = settle(order, typeof s.payment_intent === 'string' ? s.payment_intent : (s.payment_intent && s.payment_intent.id) || s.id, 'stripe.confirm');
    json(res, 200, { ok: true, order: pub(done.order), entitlement: access.pub(done.ent) });
  }

  /* POST /api/pay/paypal/capture { order_id, token } — back from PayPal (token = the PayPal order id) */
  async function paypalCapture(req, res) {
    if (!paypalMode) fail(503, 'PayPal is not connected on this server.', { code: 'gateway_off' });
    const user = auth.requireUser(req); const b = await readBody(req);
    const order = ownOrder(user, b.order_id);
    if (order.method !== 'paypal') fail(400, 'This order does not use PayPal.');
    const ppId = String(b.token || '') || order.gateway_order_id || '';
    if (!ppId || ppId !== order.gateway_order_id) { event(order.id, 'paypal', 'capture.mismatch', false, ppId); fail(400, 'This payment does not belong to that order.'); }
    if (order.status === 'paid') { const s = settle(order, order.gateway_payment_id, 'paypal.capture'); return json(res, 200, { ok: true, order: pub(s.order), entitlement: access.pub(s.ent) }); }
    let p;
    try { p = await paypal('POST', '/v2/checkout/orders/' + encodeURIComponent(ppId) + '/capture', {}); }
    catch (e) {
      if (!(e instanceof GatewayError)) throw e;
      /* captured already (a reload of the return page): read the order instead */
      if (e.body && JSON.stringify(e.body).includes('ORDER_ALREADY_CAPTURED')) { try { p = await paypal('GET', '/v2/checkout/orders/' + encodeURIComponent(ppId)); } catch (e2) { e = e2; } }
      if (!p) { event(order.id, 'paypal', 'capture.failed', false, e.message); fail(e.gwStatus === 422 ? 402 : 502, 'PayPal did not complete the payment: ' + e.message, { code: 'not_paid' }); }
    }
    const unit = (p.purchase_units || [])[0] || {}, cap = ((unit.payments || {}).captures || [])[0] || {};
    const amt = cap.amount || unit.amount || {};
    const good = p.status === 'COMPLETED' && cap.status === 'COMPLETED' && amt.currency_code === order.currency && amt.value === ppValue(order) && (!unit.reference_id || unit.reference_id === order.id || unit.custom_id === order.id || cap.custom_id === order.id);
    if (!good) { event(order.id, 'paypal', 'capture.not_completed', false, { status: p.status, capture: cap.status, amount: amt }); fail(402, 'PayPal has not completed this payment (' + (cap.status || p.status || 'unknown') + ').', { code: 'not_paid' }); }
    const done = settle(order, cap.id || p.id, 'paypal.capture');
    json(res, 200, { ok: true, order: pub(done.order), entitlement: access.pub(done.ent) });
  }

  /* POST /api/pay/cancel { order_id } — the customer came back from a hosted page without paying */
  async function cancel(req, res) {
    const user = auth.requireUser(req); const b = await readBody(req);
    const order = ownOrder(user, b.order_id);
    if (order.status === 'paid') return json(res, 200, { ok: true, cancelled: false, order: pub(order), note: 'This order is already paid.' });
    if (order.status === 'created') {
      q.setStatus.run('cancelled', order.id); event(order.id, order.method, 'order.cancelled', true, 'customer returned without paying');
      /* close the hosted Stripe page too, so it cannot be paid later by accident (best effort) */
      if (order.method === 'stripe' && stripeMode && order.gateway_order_id) stripe('POST', '/checkout/sessions/' + encodeURIComponent(order.gateway_order_id) + '/expire').catch(() => {});
    }
    json(res, 200, { ok: true, cancelled: true, order: pub(q.byId.get(order.id)) });
  }

  function mine(req, res) { const u = auth.requireUser(req); json(res, 200, { orders: q.mine.all(u.id).map(pub) }); }

  return { mode, live, gateways, createOrder, verify, webhook, stripeConfirm, paypalCapture, cancel, mine, pub, settle };
}

module.exports = { make };
