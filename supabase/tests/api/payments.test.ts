// Payments (routes/payments.ts, services/fulfil.ts, gateways/*): orders from stored quotes, Razorpay
// verify, Stripe confirm, PayPal capture, the three webhooks, refunds and the Purchase Successful
// email. The gateways are fakes on the harness server (fakes/gateways.ts); quotes come from the
// real POST /api/quote (builder B's pricing service).
import { assert, assertEquals, assertMatch, assertStatus, startHarness, test, type Harness, type TestUser } from './harness.ts';
import { installGatewayFakes, type Delivery } from './fakes/gateways.ts';
import { fmtDateTime } from '../../functions/api/lib/util.ts';

const h: Harness = await startHarness();
const gw = await installGatewayFakes(h);

const IN_ADDR = { country: 'IN', line1: '12 MG Road', city: 'Pune', state: 'Maharashtra', postal: '411001' };
const US_ADDR = { country: 'US', line1: '1 Market Street', city: 'San Francisco' };
for (const id of ['az-C', 'az-D', 'az-E', 'az-F', 'az-G']) await h.uploadPdfFor(id);

// deno-lint-ignore no-explicit-any
type Any = any;

async function quoteFor(c: TestUser, o: { worksheet?: string; cls?: string; plan?: string; address?: Record<string, string> } = {}): Promise<Any> {
  const body = o.cls
    ? { cls: o.cls, plan: o.plan ?? 'm1', address: o.address ?? IN_ADDR }
    : { worksheet: o.worksheet ?? 'az-C', address: o.address ?? IN_ADDR };
  const r = await h.call('POST', '/api/quote', { token: c.token, body });
  assertStatus(r, 200, 'quote');
  assert(r.body.valid === true && typeof r.body.quoteId === 'string', `quote is not payable: ${r.text.slice(0, 300)}`);
  return r.body;
}

async function newOrder(c: TestUser, method = 'razorpay', o: Parameters<typeof quoteFor>[1] = {}) {
  const q = await quoteFor(c, o);
  const r = await h.call('POST', '/api/pay/order', { token: c.token, body: { quoteId: q.quoteId, method } });
  assertStatus(r, 200, 'order');
  return { q, r, orderId: r.body.order.id as string, gateway: r.body.gateway as Any };
}

async function verify(c: TestUser, body: Record<string, unknown>) {
  return await h.call('POST', '/api/pay/verify', { token: c.token, body });
}

/** A Razorpay order paid in the fake and verified through the API. */
async function paidRazorpay(c: TestUser, o: Parameters<typeof quoteFor>[1] = {}) {
  const made = await newOrder(c, 'razorpay', o);
  const pay = await gw.razorpay.pay(made.gateway.razorpay_order_id);
  const v = await verify(c, { order_id: made.orderId, razorpay_order_id: made.gateway.razorpay_order_id, razorpay_payment_id: pay.paymentId, razorpay_signature: pay.signature });
  assertStatus(v, 200, 'verify');
  return { ...made, pay, v };
}

async function deliver(path: string, d: Delivery) {
  return await h.call('POST', path, { raw: d.raw, headers: d.headers, contentType: 'application/json' });
}

const entsOf = (userId: string) => h.sql<Any[]>`select * from entitlements where user_id = ${userId} order by id`;
const orderRow = async (id: string): Promise<Any> => (await h.sql<Any[]>`select * from orders where id = ${id}`)[0];
const count = async (p: Promise<Any[]>) => (await p).length;

// ── Razorpay ─────────────────────────────────────────────────────────────────────────────

test('razorpay: order, then verify with a correct signature grants exactly once', async () => {
  const c = await h.customer();
  const { q, r, orderId, gateway } = await newOrder(c);
  assertEquals(gateway.provider, 'razorpay');
  assertEquals(gateway.mode, 'test');
  assertEquals(gateway.key, gw.keys.razorpayKeyId);
  assertEquals(gateway.amount, q.amountMinor);
  assertEquals(gateway.currency, 'INR');
  assertEquals(gateway.name, 'Learn With Why');
  assertEquals(gateway.prefill.email, c.email);
  assertMatch(gateway.razorpay_order_id, /^order_/);
  assertMatch(orderId, /^LWO-[A-Z0-9]{10}$/);
  assertEquals(r.body.order.status, 'created');
  assertEquals(r.body.order.worksheet, 'az-C');
  assert(!JSON.stringify(r.body).includes(gw.keys.razorpayKeySecret), 'the key secret never leaves the server');

  const fake = gw.razorpay.orders.get(gateway.razorpay_order_id)!;
  assertEquals(fake.receipt, orderId);
  assertEquals(fake.amount, q.amountMinor);
  const row = await orderRow(orderId);
  assertEquals(row.status, 'created');
  assertEquals(row.gateway_order_id, gateway.razorpay_order_id);
  assertEquals(row.amount_minor, q.amountMinor);
  assertEquals(row.quote_id, q.quoteId);
  assertEquals(row.gateway_mode, 'test');
  const items = await h.sql<Any[]>`select * from order_items where order_id = ${orderId}`;
  assertEquals(items.length, 1);
  assertEquals(items[0].product_id, 'az-C');
  assertEquals((await h.sql<Any[]>`select used_by_order from quotes where id = ${q.quoteId}`)[0].used_by_order, orderId);

  const pay = await gw.razorpay.pay(gateway.razorpay_order_id);
  const fetchesBefore = h.fake.calls(`/v1/payments/${pay.paymentId}`, 'GET').length;
  const v = await verify(c, { order_id: orderId, razorpay_order_id: gateway.razorpay_order_id, razorpay_payment_id: pay.paymentId, razorpay_signature: pay.signature });
  assertStatus(v, 200);
  assertEquals(v.body.ok, true);
  assertEquals(v.body.status, 'paid');
  assertEquals(v.body.order.status, 'paid');
  assertEquals(v.body.order.paymentId, pay.paymentId);
  assertEquals(v.body.entitlement.worksheet, 'az-C');
  assertEquals(v.body.entitlement.status, 'active');
  const hours = (v.body.entitlement.end - Date.now()) / 3_600_000;
  assert(hours > 23.9 && hours <= 24.01, `a bought sheet is open for 24 hours, got ${hours}`);
  const line = (await h.sql<{ access_days: number; access_hours: number }[]>`select access_days, access_hours from order_items where order_id = ${orderId}`)[0];
  assertEquals([line.access_hours, line.access_days], [24, 1], 'the order line keeps the hours it was sold with');
  assertEquals(h.fake.calls(`/v1/payments/${pay.paymentId}`, 'GET').length, fetchesBefore + 1, 'the payment is fetched from Razorpay');

  const ents = await entsOf(c.id);
  assertEquals(ents.length, 1);
  assertEquals(ents[0].kind, 'paid');
  assertEquals(ents[0].order_id, orderId);
  assertEquals(await count(h.sql`select 1 from payments where order_id = ${orderId}`), 1);
  const audit = await h.sql<Any[]>`select * from audit_logs where action = 'order.paid' and target_id = ${orderId}`;
  assertEquals(audit.length, 1);
  assertEquals(audit[0].actor_role, 'system');
  assertEquals(audit[0].actor_id, null);
  const an = await h.sql<Any[]>`select value_inr from analytics_events where kind = 'purchase' and order_id = ${orderId}`;
  assertEquals(an.length, 1);
  assertEquals(Number(an[0].value_inr), Number(row.total_inr));
  assertEquals(await count(h.sql`select 1 from notifications where audience = 'customer' and user_id = ${c.id} and kind = 'purchase.success'`), 1);
  assertEquals(await count(h.sql`select 1 from notifications where audience = 'staff' and kind = 'order.paid' and data ->> 'orderId' = ${orderId}`), 1);
  assertEquals(await count(h.sql`select 1 from analytics_events where kind = 'order_created' and order_id = ${orderId}`), 1);
});

test('razorpay: verify with a wrong signature is 400 and grants nothing', async () => {
  const c = await h.customer();
  const { orderId, gateway } = await newOrder(c);
  const pay = await gw.razorpay.pay(gateway.razorpay_order_id);
  const wrongSecret = await gw.razorpay.signature(gateway.razorpay_order_id, pay.paymentId, 'not-the-key-secret');
  const base = { order_id: orderId, razorpay_order_id: gateway.razorpay_order_id, razorpay_payment_id: pay.paymentId };
  for (const sig of [wrongSecret, pay.signature.replace(/^./, (ch) => (ch === '0' ? '1' : '0')).toUpperCase(), '', 'x'.repeat(64)]) {
    const v = await verify(c, { ...base, razorpay_signature: sig });
    assertStatus(v, 400);
    assertEquals(v.body.error, 'Payment signature did not verify.');
    assertEquals(v.body.code, 'bad_signature');
  }
  // a valid signature for a different payment id does not carry over
  const other = await gw.razorpay.signature(gateway.razorpay_order_id, 'pay_SomethingElse12');
  assertStatus(await verify(c, { ...base, razorpay_signature: other }), 400);
  assertEquals((await entsOf(c.id)).length, 0);
  assertEquals((await orderRow(orderId)).status, 'created');
  assertEquals(h.fake.calls(`/v1/payments/${pay.paymentId}`, 'GET').length, 0, 'nothing is asked of Razorpay before the signature checks out');
  const ev = await h.sql<Any[]>`select * from payment_events where order_id = ${orderId} and event_type = 'verify.bad_signature'`;
  assert(ev.length >= 1);
  assertEquals(ev[0].signature_ok, false);
  assert(await count(h.sql`select 1 from security_events where user_id = ${c.id} and event_type = 'payment.bad_signature'`) >= 1);
  // the right signature still works afterwards
  assertStatus(await verify(c, { ...base, razorpay_signature: pay.signature }), 200);
  assertEquals((await entsOf(c.id)).length, 1);
});

test('razorpay: a verify replay answers already_paid with no second grant; a second payment is flagged', async () => {
  const c = await h.customer();
  const { orderId, gateway, pay, v } = await paidRazorpay(c);
  const body = { order_id: orderId, razorpay_order_id: gateway.razorpay_order_id, razorpay_payment_id: pay.paymentId, razorpay_signature: pay.signature };
  const again = await verify(c, body);
  assertStatus(again, 200);
  assertEquals(again.body.status, 'already_paid');
  assertEquals(again.body.entitlement.id, v.body.entitlement.id);
  // without order_id: found by the Razorpay order id
  const { order_id: _drop, ...noId } = body;
  const third = await verify(c, noId);
  assertStatus(third, 200);
  assertEquals(third.body.status, 'already_paid');
  assertEquals((await entsOf(c.id)).length, 1);

  // the customer somehow paid the same order twice: no new access, staff are told to refund
  const second = await gw.razorpay.pay(gateway.razorpay_order_id);
  const dup = await verify(c, { ...body, razorpay_payment_id: second.paymentId, razorpay_signature: second.signature });
  assertStatus(dup, 200);
  assertEquals(dup.body.status, 'already_paid');
  assertEquals((await entsOf(c.id)).length, 1);
  assertEquals(await count(h.sql`select 1 from payments where order_id = ${orderId}`), 2);
  assertEquals(await count(h.sql`select 1 from payment_events where order_id = ${orderId} and event_type = 'payment.duplicate'`), 1);
  assertEquals(await count(h.sql`select 1 from notifications where audience = 'staff' and kind = 'payment.duplicate' and data ->> 'orderId' = ${orderId}`), 1);
  assertEquals(await count(h.sql`select 1 from email_outbox where dedupe_key = ${'purchase:' + orderId}`), 1);
});

test('razorpay: an authorized payment is captured for the order amount, then granted', async () => {
  const c = await h.customer();
  const { orderId, gateway } = await newOrder(c);
  const pay = await gw.razorpay.pay(gateway.razorpay_order_id, { status: 'authorized' });
  const v = await verify(c, { order_id: orderId, razorpay_order_id: gateway.razorpay_order_id, razorpay_payment_id: pay.paymentId, razorpay_signature: pay.signature });
  assertStatus(v, 200);
  assertEquals(v.body.status, 'paid');
  const cap = gw.log.filter((l) => l.path === `/v1/payments/${pay.paymentId}/capture`);
  assertEquals(cap.length, 1);
  assertEquals((cap[0].body as Any).amount, gateway.amount);
  assertEquals(gw.razorpay.payments.get(pay.paymentId)!.status, 'captured');
  assertEquals((await entsOf(c.id)).length, 1);
});

test('razorpay: a payment that failed is not accepted', async () => {
  const c = await h.customer();
  const { orderId, gateway } = await newOrder(c);
  const pay = await gw.razorpay.pay(gateway.razorpay_order_id, { status: 'failed' });
  const v = await verify(c, { order_id: orderId, razorpay_order_id: gateway.razorpay_order_id, razorpay_payment_id: pay.paymentId, razorpay_signature: pay.signature });
  assertStatus(v, 400);
  assertEquals(v.body.error, 'Payment is failed — not accepted.');
  assertEquals(v.body.code, 'not_paid');
  assertEquals((await entsOf(c.id)).length, 0);
});

test('a payment captured for a different amount is rejected and grants nothing (verify and webhook)', async () => {
  const c = await h.customer();
  const { orderId, gateway } = await newOrder(c);
  const pay = await gw.razorpay.pay(gateway.razorpay_order_id, { amount: gateway.amount - 100 });
  const v = await verify(c, { order_id: orderId, razorpay_order_id: gateway.razorpay_order_id, razorpay_payment_id: pay.paymentId, razorpay_signature: pay.signature });
  assertStatus(v, 400);
  assertEquals(v.body.code, 'payment_rejected');
  assertEquals(v.body.reason, 'amount_mismatch');
  assertEquals((await entsOf(c.id)).length, 0);
  assertEquals((await orderRow(orderId)).status, 'created');
  assertEquals(await count(h.sql`select 1 from payments where order_id = ${orderId}`), 0);
  const ev = await h.sql<Any[]>`select detail from payment_events where order_id = ${orderId} and event_type = 'payment.rejected'`;
  assertEquals(ev.length, 1);
  assertEquals(ev[0].detail.reason, 'amount_mismatch');
  assertEquals(await count(h.sql`select 1 from security_events where user_id = ${c.id} and event_type = 'payment.rejected'`), 1);
  assertEquals(await count(h.sql`select 1 from notifications where audience = 'staff' and kind = 'payment.rejected' and data ->> 'orderId' = ${orderId}`), 1);
  // trying the same payment again is refused again, logged, but staff are alerted only once
  const again = await verify(c, { order_id: orderId, razorpay_order_id: gateway.razorpay_order_id, razorpay_payment_id: pay.paymentId, razorpay_signature: pay.signature });
  assertStatus(again, 400);
  assertEquals(again.body.code, 'payment_rejected');
  assertEquals(await count(h.sql`select 1 from payment_events where order_id = ${orderId} and event_type = 'payment.rejected'`), 2);
  assertEquals(await count(h.sql`select 1 from security_events where user_id = ${c.id} and event_type = 'payment.rejected'`), 1);
  assertEquals(await count(h.sql`select 1 from notifications where audience = 'staff' and kind = 'payment.rejected' and data ->> 'orderId' = ${orderId}`), 1);

  // the same through a (genuinely signed) webhook, in another currency this time
  const other = await gw.razorpay.pay(gateway.razorpay_order_id, { currency: 'USD' });
  const d = await gw.razorpay.webhook('payment.captured', { payment: { entity: other.payment } });
  const w = await deliver('/api/pay/webhook', d);
  assertStatus(w, 200);
  assertEquals((await entsOf(c.id)).length, 0);
  const row = await h.sql<Any[]>`select ok, status, detail from payment_events where event_id = ${d.headers['x-razorpay-event-id']}`;
  assertEquals(row[0].status, 'processed');
  assertEquals(row[0].ok, false);
  assertEquals(row[0].detail.result, 'rejected');
});

test('razorpay webhook: payment.captured grants once; the same event id again is a duplicate', async () => {
  const c = await h.customer();
  const { orderId, gateway } = await newOrder(c);
  const pay = await gw.razorpay.pay(gateway.razorpay_order_id);
  const d = await gw.razorpay.webhook('payment.captured', { payment: { entity: pay.payment } });
  const first = await deliver('/api/pay/webhook', d);
  assertStatus(first, 200);
  assertEquals(first.body, { ok: true });
  assertEquals((await entsOf(c.id)).length, 1);
  assertEquals((await orderRow(orderId)).status, 'paid');

  const again = await deliver('/api/pay/webhook', d);
  assertStatus(again, 200);
  assertEquals(again.body, { ok: true, duplicate: true });
  const rows = await h.sql<Any[]>`select * from payment_events where provider = 'razorpay' and event_id = ${d.headers['x-razorpay-event-id']}`;
  assertEquals(rows.length, 1);
  assertEquals(rows[0].status, 'processed');
  assertEquals(rows[0].order_id, orderId);
  assertEquals(rows[0].signature_ok, true);
  assertMatch(rows[0].payload_sha256, /^[0-9a-f]{64}$/);
  assert(!JSON.stringify(rows[0].detail).includes(c.email), 'no payload copy in the log');

  // order.paid for the same payment (another event id): processed, nothing new
  const d2 = await gw.razorpay.webhook('order.paid', { payment: { entity: pay.payment }, order: { entity: gw.razorpay.orders.get(gateway.razorpay_order_id) } });
  assertStatus(await deliver('/api/pay/webhook', d2), 200);
  assertEquals((await entsOf(c.id)).length, 1);
  assertEquals(await count(h.sql`select 1 from email_outbox where dedupe_key = ${'purchase:' + orderId}`), 1);
  // and the browser's verify afterwards just reports it
  const v = await verify(c, { order_id: orderId, razorpay_order_id: gateway.razorpay_order_id, razorpay_payment_id: pay.paymentId, razorpay_signature: pay.signature });
  assertStatus(v, 200);
  assertEquals(v.body.status, 'already_paid');
});

test('razorpay webhook: a bad signature is 400 and logged, and does not block the genuine delivery', async () => {
  const c = await h.customer();
  const { orderId, gateway } = await newOrder(c);
  const pay = await gw.razorpay.pay(gateway.razorpay_order_id);
  const eventId = `evt_bad${Date.now()}`;
  const forged = await gw.razorpay.webhook('payment.captured', { payment: { entity: pay.payment } }, { eventId, secret: 'not-the-webhook-secret' });
  const r = await deliver('/api/pay/webhook', forged);
  assertStatus(r, 400);
  assertEquals(r.body, { error: 'bad signature' });
  const noSig = await deliver('/api/pay/webhook', { ...forged, headers: { 'content-type': 'application/json', 'x-razorpay-event-id': eventId } });
  assertStatus(noSig, 400);
  assertEquals((await entsOf(c.id)).length, 0);
  const logged = await h.sql<Any[]>`select * from payment_events where provider = 'razorpay' and event_type = 'webhook.bad_signature' and detail ->> 'eventId' = ${eventId}`;
  assertEquals(logged.length, 2);
  assertEquals(logged[0].signature_ok, false);
  assertEquals(logged[0].event_id, null);
  assertMatch(logged[0].payload_sha256, /^[0-9a-f]{64}$/);

  // a tampered body with the original signature fails too
  const genuine = await gw.razorpay.webhook('payment.captured', { payment: { entity: pay.payment } }, { eventId });
  const tampered = new TextEncoder().encode(genuine.text.replace(`"amount":${pay.payment.amount}`, '"amount":100'));
  assertStatus(await deliver('/api/pay/webhook', { ...genuine, raw: tampered }), 400);

  const ok = await deliver('/api/pay/webhook', genuine);
  assertStatus(ok, 200);
  assertEquals(ok.body, { ok: true });
  assertEquals((await entsOf(c.id)).length, 1);
  assertEquals((await orderRow(orderId)).status, 'paid');
});

test('razorpay webhook: payment.failed marks a created order failed; without the secret deliveries are ignored', async () => {
  const c = await h.customer();
  const { orderId, gateway } = await newOrder(c);
  const pay = await gw.razorpay.pay(gateway.razorpay_order_id, { status: 'failed' });
  assertStatus(await deliver('/api/pay/webhook', await gw.razorpay.webhook('payment.failed', { payment: { entity: pay.payment } })), 200);
  const row = await orderRow(orderId);
  assertEquals(row.status, 'failed');
  assertMatch(row.failure_reason, /declined/);

  h.setEnv({ RAZORPAY_WEBHOOK_SECRET: undefined });
  try {
    const r = await deliver('/api/pay/webhook', await gw.razorpay.webhook('payment.captured', { payment: { entity: pay.payment } }));
    assertStatus(r, 200);
    assertEquals(r.body, { ok: true, ignored: true });
  } finally {
    gw.configure(['razorpay']);
  }
  // a later successful retry of the payment still opens the sheet (money arrived)
  const retry = await gw.razorpay.pay(gateway.razorpay_order_id);
  const v = await verify(c, { order_id: orderId, razorpay_order_id: gateway.razorpay_order_id, razorpay_payment_id: retry.paymentId, razorpay_signature: retry.signature });
  assertStatus(v, 200);
  assertEquals(v.body.status, 'paid');
});

test('razorpay refund webhook: a full refund revokes the access, a partial one only tells staff', async () => {
  const c = await h.customer();
  const { orderId, pay } = await paidRazorpay(c);
  const partial = gw.razorpay.refund(pay.paymentId, 100);
  const p1 = gw.razorpay.payments.get(pay.paymentId)!;
  assertStatus(await deliver('/api/pay/webhook', await gw.razorpay.webhook('refund.processed', { refund: { entity: partial }, payment: { entity: { ...p1 } } })), 200);
  assertEquals((await entsOf(c.id))[0].revoked_at, null);
  assertEquals((await orderRow(orderId)).status, 'paid');
  assertEquals(await count(h.sql`select 1 from notifications where audience = 'staff' and kind = 'order.partial_refund' and data ->> 'orderId' = ${orderId}`), 1);

  const rest = gw.razorpay.refund(pay.paymentId);
  const p2 = gw.razorpay.payments.get(pay.paymentId)!;
  assertEquals(p2.refund_status, 'full');
  const r = await deliver('/api/pay/webhook', await gw.razorpay.webhook('refund.processed', { refund: { entity: rest }, payment: { entity: { ...p2 } } }));
  assertStatus(r, 200);
  const ents = await entsOf(c.id);
  assert(ents[0].revoked_at !== null, 'the access ended');
  const row = await orderRow(orderId);
  assertEquals(row.status, 'refunded');
  assert(row.refunded_at !== null);
  assertEquals((await h.sql<Any[]>`select status from payments where order_id = ${orderId}`)[0].status, 'refunded');
  assertEquals(await count(h.sql`select 1 from audit_logs where action = 'order.refunded' and target_id = ${orderId} and actor_role = 'system'`), 1);
  assertEquals(await count(h.sql`select 1 from notifications where audience = 'customer' and user_id = ${c.id} and kind = 'order.refunded'`), 1);
  assertEquals(await count(h.sql`select 1 from analytics_events where kind = 'refund' and order_id = ${orderId}`), 1);
  // the customer's own list shows it as revoked
  const mine = await h.call('GET', '/api/me/entitlements', { token: c.token });
  if (mine.status === 200) {
    const list = Array.isArray(mine.body) ? mine.body : mine.body.entitlements;
    assertEquals(list.find((e: Any) => e.order === orderId)?.status, 'revoked');
  }
});

test('another customer cannot verify, cancel, confirm or capture someone else\'s order', async () => {
  const a = await h.customer();
  const b = await h.customer();
  const { orderId, gateway } = await newOrder(a);
  const pay = await gw.razorpay.pay(gateway.razorpay_order_id);
  const body = { order_id: orderId, razorpay_order_id: gateway.razorpay_order_id, razorpay_payment_id: pay.paymentId, razorpay_signature: pay.signature };
  for (const r of [
    await verify(b, body),
    await verify(b, { ...body, order_id: undefined }),
    await h.call('POST', '/api/pay/cancel', { token: b.token, body: { order_id: orderId } }),
    await h.call('POST', '/api/pay/stripe/confirm', { token: b.token, body: { order_id: orderId } }),
    await h.call('POST', '/api/pay/paypal/capture', { token: b.token, body: { order_id: orderId } }),
  ]) {
    assertStatus(r, 404);
    assertEquals(r.body.error, 'No such order.');
  }
  assertEquals((await entsOf(a.id)).length, 0);
  assertEquals((await entsOf(b.id)).length, 0);
  assertEquals((await orderRow(orderId)).status, 'created');
  // signed out: 401
  assertStatus(await h.call('POST', '/api/pay/verify', { body }), 401);
  assertStatus(await h.call('POST', '/api/pay/order', { body: { quoteId: crypto.randomUUID() } }), 401);
});

// ── order creation rules ─────────────────────────────────────────────────────────────────

test('order: the old site\'s body (whole quote object) works; fields that disagree with the stored quote are refused', async () => {
  const c = await h.customer();
  const q = await quoteFor(c, { worksheet: 'az-D' });
  const mismatch = await h.call('POST', '/api/pay/order', { token: c.token, body: { quoteId: q.quoteId, worksheet: 'az-E', method: 'razorpay' } });
  assertStatus(mismatch, 400);
  assertEquals(mismatch.body.code, 'quote_mismatch');
  assertEquals(mismatch.body.error, 'This quote is not valid any more — refresh the price and try again.');
  const tampered = await h.call('POST', '/api/pay/order', { token: c.token, body: { quote: { ...q, total: 1, amountMinor: 100, coupon: 'FREE100' }, method: 'razorpay' } });
  assertStatus(tampered, 400, 'a coupon the quote did not have');
  const unknown = await h.call('POST', '/api/pay/order', { token: c.token, body: { quoteId: q.quoteId, method: 'bitcoin' } });
  assertStatus(unknown, 400);
  assertEquals(unknown.body.error, 'Unknown payment method.');
  const missing = await h.call('POST', '/api/pay/order', { token: c.token, body: { method: 'razorpay' } });
  assertStatus(missing, 400);

  // what Checkout.jsx posts: { quote, method, via } — total/amount in it are ignored
  const ok = await h.call('POST', '/api/pay/order', { token: c.token, body: { quote: { ...q, total: 1, amountMinor: 100 }, method: 'razorpay', via: 'qr' } });
  assertStatus(ok, 200);
  assertEquals(ok.body.gateway.amount, q.amountMinor, 'the stored quote decides the amount');
  assertEquals(ok.body.order.worksheet, 'az-D');

  // an expired quote
  await h.sql`update quotes set expires_at = now() - interval '1 minute' where id = ${q.quoteId}`;
  const stale = await h.call('POST', '/api/pay/order', { token: c.token, body: { quoteId: q.quoteId, method: 'razorpay' } });
  assertStatus(stale, 409);
  assertEquals(stale.body.code, 'quote_expired');
});

test('order: a sheet already bought is not charged twice (409 already_owned)', async () => {
  const c = await h.customer();
  await paidRazorpay(c, { worksheet: 'az-E' });
  const q = await quoteFor(c, { worksheet: 'az-E' });
  const r = await h.call('POST', '/api/pay/order', { token: c.token, body: { quoteId: q.quoteId, method: 'razorpay' } });
  assertStatus(r, 409);
  assertEquals(r.body.code, 'already_owned');
  assertEquals(r.body.worksheet, 'az-E');
});

test('order: gateways that are not configured answer 503 and nothing is created', async () => {
  const c = await h.customer();
  const q = await quoteFor(c);
  gw.unconfigure();
  try {
    for (const method of ['razorpay', 'stripe', 'paypal']) {
      const r = await h.call('POST', '/api/pay/order', { token: c.token, body: { quoteId: q.quoteId, method } });
      assertStatus(r, 503, method);
      assertEquals(r.body.code, 'payments_unavailable');
    }
    for (const path of ['/api/pay/verify', '/api/pay/stripe/confirm', '/api/pay/paypal/capture']) {
      const r = await h.call('POST', path, { token: c.token, body: { order_id: 'LWO-ABCDEFGHJK' } });
      assertStatus(r, 503, path);
      assertEquals(r.body.code, 'payments_unavailable');
    }
    assertEquals(await count(h.sql`select 1 from orders where user_id = ${c.id}`), 0);
  } finally {
    gw.configure();
  }
  // one gateway off, the others still work
  gw.unconfigure(['stripe']);
  try {
    assertStatus(await h.call('POST', '/api/pay/order', { token: c.token, body: { quoteId: q.quoteId, method: 'stripe' } }), 503);
    assertStatus(await h.call('POST', '/api/pay/order', { token: c.token, body: { quoteId: q.quoteId, method: 'razorpay' } }), 200);
  } finally {
    gw.configure();
  }
});

test('order: a customer whose paid access is suspended cannot buy; a blocked account cannot either', async () => {
  const c = await h.customer();
  const q = await quoteFor(c);
  await h.sql`update profiles set subscription_suspended_at = now(), suspension_reason = 'staff' where id = ${c.id}`;
  const r = await h.call('POST', '/api/pay/order', { token: c.token, body: { quoteId: q.quoteId, method: 'razorpay' } });
  assertStatus(r, 403);
  assertEquals(r.body.code, 'access_suspended');
  assertEquals(await count(h.sql`select 1 from orders where user_id = ${c.id}`), 0);
  assertEquals(gw.razorpay.orders.size >= 0, true);

  const d = await h.customer();
  const q2 = await quoteFor(d);
  await h.sql`update profiles set blocked_at = now(), blocked_reason = 'test' where id = ${d.id}`;
  const blocked = await h.call('POST', '/api/pay/order', { token: d.token, body: { quoteId: q2.quoteId, method: 'razorpay' } });
  assertStatus(blocked, 403);
  assertEquals(blocked.body.code, 'account_suspended');
});

test('order: a gateway failure marks the order failed and answers 502 gateway_error', async () => {
  const c = await h.customer();
  const q = await quoteFor(c);
  gw.failNext('razorpay', { status: 500, body: { error: { code: 'SERVER_ERROR', description: 'We are facing some trouble completing your request at the moment.' } }, path: '/v1/orders' });
  const r = await h.call('POST', '/api/pay/order', { token: c.token, body: { quoteId: q.quoteId, method: 'razorpay' } });
  assertStatus(r, 502);
  assertEquals(r.body.code, 'gateway_error');
  assertEquals(r.body.error, 'Could not reach the payment gateway: We are facing some trouble completing your request at the moment.');
  const row = (await h.sql<Any[]>`select * from orders where user_id = ${c.id}`)[0];
  assertEquals(row.status, 'failed');
  assertMatch(row.failure_reason, /trouble/);
  assertEquals(await count(h.sql`select 1 from payment_events where order_id = ${row.id} and event_type = 'order.create_failed'`), 1);

  gw.failNext('stripe', { status: 402, body: { error: { type: 'card_error', message: 'Your account cannot currently make live charges.' } } });
  const s = await h.call('POST', '/api/pay/order', { token: c.token, body: { quoteId: q.quoteId, method: 'stripe' } });
  assertStatus(s, 502);
  assertEquals(s.body.error, 'Could not start the Stripe payment: Your account cannot currently make live charges.');
});

test('order: a class plan is bought through Razorpay and runs its months', async () => {
  const c = await h.customer();
  const { v, orderId } = await paidRazorpay(c, { cls: 'kg', plan: 'm1' });
  assertEquals(v.body.entitlement.scope, 'class');
  assertEquals(v.body.entitlement.cls, 'kg');
  assertEquals(v.body.entitlement.plan, 'm1');
  const days = (v.body.entitlement.end - Date.now()) / 86_400_000;
  assert(days >= 27.9 && days <= 31.01, `one month, got ${days}`);
  const items = await h.sql<Any[]>`select * from order_items where order_id = ${orderId}`;
  assertEquals(items[0].kind, 'class');
  assertEquals(items[0].months, 1);
  // a second plan starts when the first ends
  const second = await paidRazorpay(c, { cls: 'kg', plan: 'm1' });
  assertEquals(second.v.body.entitlement.start, v.body.entitlement.end);
});

test('cancel: created → cancelled (Stripe page closed too); a paid order stays paid', async () => {
  const c = await h.customer();
  const { orderId, gateway } = await newOrder(c, 'stripe');
  const r = await h.call('POST', '/api/pay/cancel', { token: c.token, body: { order_id: orderId } });
  assertStatus(r, 200);
  assertEquals(r.body.ok, true);
  assertEquals(r.body.cancelled, true);
  assertEquals(r.body.order.status, 'cancelled');
  assertEquals(gw.stripe.sessions.get(gateway.session)!.status, 'expired');
  assertEquals(await count(h.sql`select 1 from payment_events where order_id = ${orderId} and event_type = 'order.cancelled'`), 1);

  const paid = await paidRazorpay(c, { worksheet: 'az-F' });
  const p = await h.call('POST', '/api/pay/cancel', { token: c.token, body: { order_id: paid.orderId } });
  assertStatus(p, 200);
  assertEquals(p.body.cancelled, false);
  assertEquals(p.body.note, 'This order is already paid.');
  assertEquals((await orderRow(paid.orderId)).status, 'paid');
  assertStatus(await h.call('POST', '/api/pay/cancel', { token: c.token, body: { order_id: 'LWO-NOSUCHORDER' } }), 404);
});

// ── Stripe ───────────────────────────────────────────────────────────────────────────────

test('stripe: hosted checkout, then confirm grants once; the webhook for the same session changes nothing', async () => {
  const c = await h.customer();
  const { orderId, gateway, q } = await newOrder(c, 'stripe', { worksheet: 'az-C', address: US_ADDR });
  assertEquals(gateway.provider, 'stripe');
  assertEquals(gateway.mode, 'test');
  assertMatch(gateway.session, /^cs_test_/);
  assertMatch(gateway.url, /^https:\/\//);
  const s = gw.stripe.sessions.get(gateway.session)!;
  assertEquals(s.client_reference_id, orderId);
  assertEquals(s.metadata.order_id, orderId);
  assertEquals(s.amount_total, q.amountMinor);
  assertEquals(s.currency, 'usd');
  assertEquals(s.success_url, `http://localhost:5173/?pay=stripe&order=${orderId}&session={CHECKOUT_SESSION_ID}`);
  assertEquals(s.cancel_url, `http://localhost:5173/?pay=cancel&order=${orderId}`);
  assertEquals(s.idempotency_key, `lww-session-${orderId}`);

  const early = await h.call('POST', '/api/pay/stripe/confirm', { token: c.token, body: { order_id: orderId, session_id: gateway.session } });
  assertStatus(early, 402);
  assertEquals(early.body.code, 'not_paid');
  assertEquals(early.body.error, 'Stripe has not received this payment yet — nothing was charged.');

  const wrong = await h.call('POST', '/api/pay/stripe/confirm', { token: c.token, body: { order_id: orderId, session_id: 'cs_test_SomeoneElsesSession1234' } });
  assertStatus(wrong, 400);
  assertEquals(wrong.body.error, 'This payment does not belong to that order.');

  gw.stripe.pay(gateway.session);
  const ok = await h.call('POST', '/api/pay/stripe/confirm', { token: c.token, body: { order_id: orderId, session_id: gateway.session } });
  assertStatus(ok, 200);
  assertEquals(ok.body.status, 'paid');
  assertEquals(ok.body.order.status, 'paid');
  assertEquals(ok.body.order.paymentId, s.payment_intent);
  assertEquals(ok.body.entitlement.worksheet, 'az-C');
  const gets = h.fake.calls(`/v1/checkout/sessions/${gateway.session}`, 'GET').length;
  // the return page reloaded (session only): no gateway call, same answer
  const again = await h.call('POST', '/api/pay/stripe/confirm', { token: c.token, body: { session_id: gateway.session } });
  assertStatus(again, 200);
  assertEquals(again.body.status, 'already_paid');
  assertEquals(h.fake.calls(`/v1/checkout/sessions/${gateway.session}`, 'GET').length, gets);

  const ev = await gw.stripe.event('checkout.session.completed', { ...s });
  const w = await deliver('/api/pay/stripe/webhook', ev);
  assertStatus(w, 200);
  assertEquals((await h.sql<Any[]>`select detail from payment_events where event_id = ${ev.id}`)[0].detail.result, 'already_paid');
  assertEquals((await entsOf(c.id)).length, 1);
});

test('stripe webhook: settles a paid session without the browser; refuses bad and stale signatures; refund revokes', async () => {
  const c = await h.customer();
  const { orderId, gateway } = await newOrder(c, 'stripe', { worksheet: 'az-D' });
  const s = gw.stripe.pay(gateway.session);

  const forged = await gw.stripe.event('checkout.session.completed', { ...s }, { secret: 'whsec_wrong' });
  const bad = await deliver('/api/pay/stripe/webhook', forged);
  assertStatus(bad, 400);
  assertEquals(bad.body, { error: 'bad signature' });
  const stale = await gw.stripe.event('checkout.session.completed', { ...s }, { timestamp: Math.floor(Date.now() / 1000) - 600 });
  assertStatus(await deliver('/api/pay/stripe/webhook', stale), 400);
  assertStatus(await deliver('/api/pay/stripe/webhook', { ...stale, headers: { 'content-type': 'application/json' } }), 400);
  assertEquals((await entsOf(c.id)).length, 0);
  assert(await count(h.sql`select 1 from payment_events where provider = 'stripe' and event_type = 'webhook.bad_signature' and signature_ok = false`) >= 3);

  // an unpaid (delayed payment) completion waits; the async success settles it
  const ev = await gw.stripe.event('checkout.session.completed', { ...s });
  const r = await deliver('/api/pay/stripe/webhook', ev);
  assertStatus(r, 200);
  assertEquals(r.body, { ok: true });
  assertEquals((await entsOf(c.id)).length, 1);
  assertEquals((await orderRow(orderId)).status, 'paid');
  assertEquals((await deliver('/api/pay/stripe/webhook', ev)).body, { ok: true, duplicate: true });
  assertEquals(await count(h.sql`select 1 from email_outbox where dedupe_key = ${'purchase:' + orderId}`), 1);

  // charge.refunded (full) revokes
  const refund = await gw.stripe.event('charge.refunded', gw.stripe.charge(gateway.session));
  assertStatus(await deliver('/api/pay/stripe/webhook', refund), 200);
  assert((await entsOf(c.id))[0].revoked_at !== null);
  assertEquals((await orderRow(orderId)).status, 'refunded');
});

test('stripe webhook: a session paid for another amount is rejected', async () => {
  const c = await h.customer();
  const { orderId, gateway } = await newOrder(c, 'stripe', { worksheet: 'az-E' });
  const s = gw.stripe.pay(gateway.session, { amountTotal: 100 });
  assertStatus(await deliver('/api/pay/stripe/webhook', await gw.stripe.event('checkout.session.completed', { ...s })), 200);
  assertEquals((await entsOf(c.id)).length, 0);
  const confirm = await h.call('POST', '/api/pay/stripe/confirm', { token: c.token, body: { order_id: orderId } });
  assertStatus(confirm, 400);
  assertEquals(confirm.body.code, 'payment_rejected');
  assertEquals((await orderRow(orderId)).status, 'created');
});

// ── PayPal ───────────────────────────────────────────────────────────────────────────────

test('paypal: approve, then capture grants once; unapproved, pending or wrong-amount captures grant nothing', async () => {
  const c = await h.customer();
  const { orderId, gateway, q } = await newOrder(c, 'paypal', { worksheet: 'az-C', address: US_ADDR });
  assertEquals(gateway.provider, 'paypal');
  assertEquals(gateway.mode, 'sandbox');
  assertMatch(gateway.url, /checkoutnow\?token=/);
  const o = gw.paypal.orders.get(gateway.paypal_order_id)!;
  assertEquals(o.purchase_units[0].custom_id, orderId);
  assertEquals(o.purchase_units[0].amount, { currency_code: 'USD', value: (q.amountMinor / 100).toFixed(2) });
  assertEquals(o.purchase_units[0].experience_context, undefined);

  const early = await h.call('POST', '/api/pay/paypal/capture', { token: c.token, body: { order_id: orderId, token: gateway.paypal_order_id } });
  assertStatus(early, 402);
  assertEquals(early.body.code, 'not_paid');
  assertMatch(early.body.error, /^PayPal did not complete the payment: Payer has not yet approved/);

  gw.paypal.approve(gateway.paypal_order_id);
  const ok = await h.call('POST', '/api/pay/paypal/capture', { token: c.token, body: { order_id: orderId, token: gateway.paypal_order_id } });
  assertStatus(ok, 200);
  assertEquals(ok.body.status, 'paid');
  assertEquals(ok.body.entitlement.worksheet, 'az-C');
  const capId = o.purchase_units[0].payments.captures[0].id;
  assertEquals(ok.body.order.paymentId, capId);
  const again = await h.call('POST', '/api/pay/paypal/capture', { token: c.token, body: { token: gateway.paypal_order_id } });
  assertStatus(again, 200);
  assertEquals(again.body.status, 'already_paid');
  assertEquals((await entsOf(c.id)).length, 1);

  // a reload after PayPal captured but before we recorded it: ORDER_ALREADY_CAPTURED → read the order
  const second = await newOrder(c, 'paypal', { worksheet: 'az-D', address: US_ADDR });
  gw.paypal.approve(second.gateway.paypal_order_id);
  gw.paypal.captureNow(second.gateway.paypal_order_id);
  const reread = await h.call('POST', '/api/pay/paypal/capture', { token: c.token, body: { order_id: second.orderId } });
  assertStatus(reread, 200);
  assertEquals(reread.body.status, 'paid');

  const pending = await newOrder(c, 'paypal', { worksheet: 'az-E', address: US_ADDR });
  gw.paypal.approve(pending.gateway.paypal_order_id);
  gw.paypal.setCapture(pending.gateway.paypal_order_id, { status: 'PENDING' });
  const pr = await h.call('POST', '/api/pay/paypal/capture', { token: c.token, body: { order_id: pending.orderId } });
  assertStatus(pr, 402);
  assertEquals(pr.body.error, 'PayPal has not completed this payment (PENDING).');

  const cheap = await newOrder(c, 'paypal', { worksheet: 'az-F', address: US_ADDR });
  gw.paypal.approve(cheap.gateway.paypal_order_id);
  gw.paypal.setCapture(cheap.gateway.paypal_order_id, { value: '0.01' });
  const cr = await h.call('POST', '/api/pay/paypal/capture', { token: c.token, body: { order_id: cheap.orderId } });
  assertStatus(cr, 400);
  assertEquals(cr.body.code, 'payment_rejected');
  const ents = await entsOf(c.id);
  assertEquals(ents.map((e: Any) => e.product_id).sort(), ['az-C', 'az-D']);
});

test('paypal webhook: verified with PayPal on the raw text; capture completed grants, refunded revokes, forged is 400', async () => {
  const c = await h.customer();
  const { orderId, gateway } = await newOrder(c, 'paypal', { worksheet: 'az-G', address: US_ADDR });
  gw.paypal.approve(gateway.paypal_order_id);
  const capture = gw.paypal.captureNow(gateway.paypal_order_id);

  const forged = gw.paypal.webhook('PAYMENT.CAPTURE.COMPLETED', capture, { valid: false });
  const bad = await deliver('/api/pay/paypal/webhook', forged);
  assertStatus(bad, 400);
  assertEquals(bad.body, { error: 'bad signature' });
  assertEquals((await entsOf(c.id)).length, 0);

  gw.paypal.verifyDown = true;
  try {
    const down = await deliver('/api/pay/paypal/webhook', gw.paypal.webhook('PAYMENT.CAPTURE.COMPLETED', capture));
    assertStatus(down, 503, 'PayPal cannot be asked: try again later');
  } finally {
    gw.paypal.verifyDown = false;
  }

  const d = gw.paypal.webhook('PAYMENT.CAPTURE.COMPLETED', capture);
  const r = await deliver('/api/pay/paypal/webhook', d);
  assertStatus(r, 200);
  assertEquals(r.body, { ok: true });
  assert(gw.paypal.lastVerifyText!.includes(`"webhook_event":${d.text}}`), 'the event is passed on byte for byte');
  assertEquals(gw.paypal.lastVerify!.webhook_id, gw.keys.paypalWebhookId);
  assertEquals((await entsOf(c.id)).length, 1);
  assertEquals((await orderRow(orderId)).status, 'paid');
  assertEquals((await deliver('/api/pay/paypal/webhook', d)).body, { ok: true, duplicate: true });

  const refund = gw.paypal.webhook('PAYMENT.CAPTURE.REFUNDED', gw.paypal.refundResource(gateway.paypal_order_id));
  assertStatus(await deliver('/api/pay/paypal/webhook', refund), 200);
  assert((await entsOf(c.id))[0].revoked_at !== null);
  assertEquals((await orderRow(orderId)).status, 'refunded');
});

// ── the Purchase Successful email ────────────────────────────────────────────────────────

test('Purchase Successful email: queued once per order, with the title, the expiry and My Account → My Worksheets', async () => {
  const c = await h.customer();
  await h.sql`update profiles set time_zone = 'America/New_York' where id = ${c.id}`;
  const { orderId, gateway, pay } = await paidRazorpay(c, { worksheet: 'az-F' });
  // replays and the webhook do not queue it again
  const body = { order_id: orderId, razorpay_order_id: gateway.razorpay_order_id, razorpay_payment_id: pay.paymentId, razorpay_signature: pay.signature };
  assertStatus(await verify(c, body), 200);
  assertStatus(await deliver('/api/pay/webhook', await gw.razorpay.webhook('payment.captured', { payment: { entity: pay.payment } })), 200);
  await h.processOutbox();

  const rows = await h.sql<Any[]>`select * from email_outbox where dedupe_key = ${'purchase:' + orderId}`;
  assertEquals(rows.length, 1);
  assertEquals(rows[0].template, 'purchase_successful');
  assertEquals(rows[0].status, 'sent');
  const mails = h.mail.to(c.email).filter((m) => m.subject.startsWith('Purchase Successful'));
  assertEquals(mails.length, 1);
  const m = mails[0];
  const title = (await h.sql<Any[]>`select title from products where id = 'az-F'`)[0].title as string;
  assert(m.subject.includes(title), `subject names the sheet: ${m.subject}`);
  const exp = (await entsOf(c.id))[0].expires_at as Date;
  const when = fmtDateTime(exp, 'America/New_York');
  assert(when !== fmtDateTime(exp, 'UTC'), `shown in the customer's zone, not UTC: ${when}`);
  assert(m.text.includes(title) && m.text.includes(when), `text has the title and the expiry in the customer's zone:\n${m.text}`);
  assert(m.text.includes('My Account → My Worksheets'), 'text points to My Account → My Worksheets');
  assert(m.html.includes('My Account → My Worksheets'), 'html points to My Account → My Worksheets');
  assert(m.text.includes(orderId));
});

// ── review fixes: coupons, refunds out of order, duplicate refunds, plans paid together, currencies ──

async function newCoupon(o: { pct?: number; max?: number; perUser?: number }) {
  const code = `RV${crypto.randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase()}`;
  await h.sql`insert into coupons (code, pct, max_uses, per_user_limit) values (${code}, ${o.pct ?? 50}, ${o.max ?? 0}, ${o.perUser ?? 0})`;
  return code;
}

/** Quote + order with a coupon; the order answer is returned whatever its status. */
async function couponOrder(c: TestUser, worksheet: string, coupon: string) {
  const q = await h.call('POST', '/api/quote', { token: c.token, body: { worksheet, coupon, address: IN_ADDR } });
  assertStatus(q, 200, 'quote');
  const r = await h.call('POST', '/api/pay/order', { token: c.token, body: { quoteId: q.body.quoteId, method: 'razorpay' } });
  return { q: q.body as Any, r, orderId: r.body?.order?.id as string, gateway: r.body?.gateway as Any };
}

/** Razorpay tells us (signed webhook) that a payment for this Razorpay order was captured. */
async function rzCaptured(rzOrderId: string) {
  const pay = await gw.razorpay.pay(rzOrderId);
  assertStatus(await deliver('/api/pay/webhook', await gw.razorpay.webhook('payment.captured', { payment: { entity: pay.payment } })), 200, 'payment.captured');
  return pay;
}

const liveEnts = (userId: string) => h.sql<Any[]>`
  select * from entitlements where user_id = ${userId} and revoked_at is null and expires_at > now() order by id`;

test('coupon: a per-customer limit cannot be beaten by opening a second discounted order before paying the first (MONEY-1a)', async () => {
  const c = await h.customer();
  const code = await newCoupon({ pct: 50, perUser: 1 });
  // the second quote is made first, while the code is still free...
  const early = await h.call('POST', '/api/quote', { token: c.token, body: { worksheet: 'az-D', coupon: code, address: IN_ADDR } });
  assertEquals(early.body.coupon, code);
  const a = await couponOrder(c, 'az-C', code);
  assertStatus(a.r, 200, 'first discounted order');
  // ...but the order made from it is refused: the first order still holds the code
  const b = await h.call('POST', '/api/pay/order', { token: c.token, body: { quoteId: early.body.quoteId, method: 'razorpay' } });
  assertStatus(b, 400);
  assertEquals(b.body.code, 'coupon_invalid');
  assertMatch(b.body.error, /unpaid order of yours/);
  // a fresh quote no longer applies it
  const q2 = await couponOrder(c, 'az-D', code);
  assertEquals([q2.q.coupon, q2.q.couponError], [null, 'That code is already on an unpaid order of yours — finish paying that order, or cancel it, before using the code again.']);
  assertEquals(q2.r.body.order.coupon, null, 'an order made from it is at the full price');
  await rzCaptured(a.gateway.razorpay_order_id);
  await rzCaptured(q2.gateway.razorpay_order_id);
  assertEquals(await count(h.sql`select 1 from orders where coupon_code = ${code} and status = 'paid'`), 1);
  assertEquals(await count(h.sql`select 1 from coupon_redemptions where coupon_code = ${code}`), 1);
  const again = await couponOrder(c, 'az-E', code);
  assertEquals(again.q.couponError, 'You have already used that code.');
  // cancelling an unpaid order gives the hold back
  const d = await newCoupon({ pct: 50, perUser: 1 });
  const first = await couponOrder(c, 'az-F', d);
  assertEquals(first.r.body.order.coupon, d);
  assertStatus(await h.call('POST', '/api/pay/cancel', { token: c.token, body: { order_id: first.orderId } }), 200);
  assertEquals((await couponOrder(c, 'az-F', d)).r.body.order.coupon, d, 'free to use the code again after cancelling');
});

test('coupon: a single-use code stays held by an unpaid order past 30 minutes, so it is redeemed once (MONEY-1b)', async () => {
  const a = await h.customer();
  const b = await h.customer();
  const code = await newCoupon({ pct: 50, max: 1 });
  const first = await couponOrder(b, 'az-E', code);
  assertEquals(first.r.body.order.coupon, code);
  // B leaves the Razorpay window open / pays by a slow method; 31 minutes pass
  await h.sql`update orders set created_at = now() - interval '31 minutes' where id = ${first.orderId}`;
  const second = await couponOrder(a, 'az-E', code);
  assertEquals([second.q.coupon, second.q.couponError], [null, 'That code has been used up.'], 'B\'s order can still be paid, so the code is still held');
  await rzCaptured(first.gateway.razorpay_order_id);
  assertEquals(await count(h.sql`select 1 from orders where coupon_code = ${code} and status = 'paid'`), 1);
  assertEquals(await count(h.sql`select 1 from coupon_redemptions where coupon_code = ${code}`), 1);
});

test('coupon: a late payment of a cancelled order after the code ran out opens access but is not redeemed again; staff are told', async () => {
  const a = await h.customer();
  const b = await h.customer();
  const code = await newCoupon({ pct: 50, max: 1 });
  const late = await couponOrder(b, 'az-F', code);
  assertStatus(late.r, 200);
  assertStatus(await h.call('POST', '/api/pay/cancel', { token: b.token, body: { order_id: late.orderId } }), 200);
  const taken = await couponOrder(a, 'az-F', code);
  assertStatus(taken.r, 200, 'the cancelled order no longer holds the code');
  await rzCaptured(taken.gateway.razorpay_order_id);
  // B's UPI approval lands after all: the money arrived, so access opens, but the use is not counted twice
  await rzCaptured(late.gateway.razorpay_order_id);
  assertEquals((await orderRow(late.orderId)).status, 'paid');
  assertEquals((await liveEnts(b.id)).length, 1);
  assertEquals(await count(h.sql`select 1 from coupon_redemptions where coupon_code = ${code}`), 1, 'one redemption of a one-use code');
  assertEquals(await count(h.sql`select 1 from payment_events where order_id = ${late.orderId} and event_type = 'coupon.over_limit'`), 1);
  const note = await h.sql<Any[]>`select body from notifications where audience = 'staff' and kind = 'coupon.over_limit' and data ->> 'orderId' = ${late.orderId}`;
  assertEquals(note.length, 1);
  assertMatch(note[0].body, /limit of 1 uses/);
});

test('refund before capture (out of order): the later capture never opens access — Razorpay, Stripe and PayPal (MONEY-2)', async () => {
  // Razorpay: refund.processed arrives first, then the retried payment.captured
  const c = await h.customer();
  const o = await newOrder(c, 'razorpay', { worksheet: 'az-F' });
  const pay = await gw.razorpay.pay(o.gateway.razorpay_order_id);
  const capturedSnapshot = structuredClone(pay.payment);
  const refund = gw.razorpay.refund(pay.paymentId);
  const rf = await deliver('/api/pay/webhook', await gw.razorpay.webhook('refund.processed', { payment: { entity: gw.razorpay.payments.get(pay.paymentId) }, refund: { entity: refund } }));
  assertStatus(rf, 200);
  const cap = await deliver('/api/pay/webhook', await gw.razorpay.webhook('payment.captured', { payment: { entity: capturedSnapshot } }));
  assertStatus(cap, 200);
  assert((await orderRow(o.orderId)).status !== 'paid', 'the order is not paid');
  assertEquals((await liveEnts(c.id)).length, 0, 'no access for a refunded payment');
  assertEquals(await count(h.sql`select 1 from gateway_refunds where provider = 'razorpay' and payment_id = ${pay.paymentId}`), 1);
  const rej = await h.sql<Any[]>`select detail from payment_events where order_id = ${o.orderId} and event_type = 'payment.rejected'`;
  assertEquals(rej[0]?.detail?.reason, 'payment_refunded');
  assertEquals(await count(h.sql`select 1 from notifications where audience = 'staff' and kind = 'payment.rejected' and data ->> 'orderId' = ${o.orderId}`), 0,
    'nothing for staff to refund: the money already went back');
  // verify from the browser later cannot open it either (Razorpay now says refunded)
  const v = await verify(c, { order_id: o.orderId, razorpay_order_id: o.gateway.razorpay_order_id, razorpay_payment_id: pay.paymentId, razorpay_signature: pay.signature });
  assertStatus(v, 400);
  assertEquals((await liveEnts(c.id)).length, 0);

  // Stripe: charge.refunded before checkout.session.completed
  const s1 = await h.customer();
  const so = await newOrder(s1, 'stripe', { worksheet: 'az-G' });
  const sess = gw.stripe.pay(so.gateway.session);
  assertStatus(await deliver('/api/pay/stripe/webhook', await gw.stripe.event('charge.refunded', gw.stripe.charge(so.gateway.session))), 200);
  assertStatus(await deliver('/api/pay/stripe/webhook', await gw.stripe.event('checkout.session.completed', { ...sess })), 200);
  assert((await orderRow(so.orderId)).status !== 'paid');
  assertEquals((await liveEnts(s1.id)).length, 0);

  // PayPal: PAYMENT.CAPTURE.REFUNDED before PAYMENT.CAPTURE.COMPLETED
  const p1 = await h.customer();
  const po = await newOrder(p1, 'paypal', { worksheet: 'az-G', address: US_ADDR });
  gw.paypal.approve(po.gateway.paypal_order_id);
  const capture = gw.paypal.captureNow(po.gateway.paypal_order_id);
  assertStatus(await deliver('/api/pay/paypal/webhook', gw.paypal.webhook('PAYMENT.CAPTURE.REFUNDED', gw.paypal.refundResource(po.gateway.paypal_order_id))), 200);
  assertStatus(await deliver('/api/pay/paypal/webhook', gw.paypal.webhook('PAYMENT.CAPTURE.COMPLETED', capture)), 200);
  assert((await orderRow(po.orderId)).status !== 'paid');
  assertEquals((await liveEnts(p1.id)).length, 0);
});

test('refunding a duplicate Razorpay payment keeps the order paid and its access open (MONEY-3)', async () => {
  const c = await h.customer();
  const o = await paidRazorpay(c, { worksheet: 'az-G' });
  // the customer pays the same Razorpay order a second time (retry in the modal)
  const p2 = await rzCaptured(o.gateway.razorpay_order_id);
  assertEquals(await count(h.sql`select 1 from notifications where audience = 'staff' and kind = 'payment.duplicate' and data ->> 'orderId' = ${o.orderId}`), 1);
  // staff refund ONLY the duplicate in the dashboard; Razorpay reports it
  const refund = gw.razorpay.refund(p2.paymentId);
  assertStatus(await deliver('/api/pay/webhook', await gw.razorpay.webhook('refund.processed', { payment: { entity: gw.razorpay.payments.get(p2.paymentId) }, refund: { entity: refund } })), 200);
  assertEquals((await orderRow(o.orderId)).status, 'paid');
  assertEquals((await liveEnts(c.id)).length, 1, 'the first payment still pays for the sheet');
  const pays = await h.sql<Any[]>`select provider_payment_id as pid, status from payments where order_id = ${o.orderId} order by id`;
  assertEquals(pays.map((p) => [p.pid, p.status]), [[o.pay.paymentId, 'captured'], [p2.paymentId, 'refunded']]);
  assertEquals(await count(h.sql`select 1 from notifications where audience = 'customer' and user_id = ${c.id} and kind = 'order.refunded'`), 0);
  assertEquals(await count(h.sql`select 1 from analytics_events where kind = 'refund' and order_id = ${o.orderId}`), 0);
  assertEquals(await count(h.sql`select 1 from notifications where audience = 'staff' and kind = 'payment.refunded' and data ->> 'orderId' = ${o.orderId}`), 1);
  // refunding the payment that paid the order does end the access
  const refund1 = gw.razorpay.refund(o.pay.paymentId);
  assertStatus(await deliver('/api/pay/webhook', await gw.razorpay.webhook('refund.processed', { payment: { entity: gw.razorpay.payments.get(o.pay.paymentId) }, refund: { entity: refund1 } })), 200);
  assertEquals((await orderRow(o.orderId)).status, 'refunded');
  assertEquals((await liveEnts(c.id)).length, 0);
});

test('refunding the FIRST of two captured payments keeps the order paid by the second and its access open (MONEY-6)', async () => {
  const c = await h.customer();
  const o = await paidRazorpay(c, { worksheet: 'az-G' });
  assertEquals((await orderRow(o.orderId)).gateway_payment_id, o.pay.paymentId);
  // the same Razorpay order is paid a second time (the case MONEY-3 is about) …
  const p2 = await rzCaptured(o.gateway.razorpay_order_id);
  // … and staff refund the FIRST payment, the one the order was booked with
  const refund1 = gw.razorpay.refund(o.pay.paymentId);
  assertStatus(await deliver('/api/pay/webhook', await gw.razorpay.webhook('refund.processed', { payment: { entity: gw.razorpay.payments.get(o.pay.paymentId) }, refund: { entity: refund1 } })), 200);

  const pays = await h.sql<Any[]>`select provider_payment_id as pid, status from payments where order_id = ${o.orderId} order by id`;
  assertEquals(pays.map((p) => [p.pid, p.status]), [[o.pay.paymentId, 'refunded'], [p2.paymentId, 'captured']]);
  const ord = await orderRow(o.orderId);
  assertEquals(ord.status, 'paid', 'the second payment of the full amount still pays for the order');
  assertEquals(ord.gateway_payment_id, p2.paymentId, 'the order is booked against the payment that is still captured');
  assertEquals(ord.refunded_at, null);
  assertEquals((await liveEnts(c.id)).length, 1, 'the sheet the customer still pays for stays open');
  // nothing tells the customer their order was refunded, nothing is counted as a refund; staff are told why
  assertEquals(await count(h.sql`select 1 from notifications where audience = 'customer' and user_id = ${c.id} and kind = 'order.refunded'`), 0);
  assertEquals(await count(h.sql`select 1 from analytics_events where kind = 'refund' and order_id = ${o.orderId}`), 0);
  const staff = await h.sql<Any[]>`select body, data from notifications where audience = 'staff' and kind = 'payment.refunded' and data ->> 'orderId' = ${o.orderId}`;
  assertEquals(staff.length, 1);
  assertEquals(staff[0].data.nowPaidBy, p2.paymentId);
  assertMatch(staff[0].body, /paid twice/);
  const audit = await h.sql<Any[]>`select detail from audit_logs where action = 'payment.refunded' and target_id = ${o.orderId}`;
  assertEquals(audit.map((a) => a.detail.nowPaidBy), [p2.paymentId]);
  // the customer's order list still shows it paid, by the surviving payment
  const mine = await h.call('GET', '/api/me/orders', { token: c.token });
  assertStatus(mine, 200);
  const view = (mine.body.orders ?? mine.body).find((x: Any) => x.id === o.orderId);
  assertEquals([view.status, view.paymentId], ['paid', p2.paymentId]);

  // a capture of the refunded first payment arriving again opens nothing new
  assertStatus(await deliver('/api/pay/webhook', await gw.razorpay.webhook('payment.captured', { payment: { entity: o.pay.payment } })), 200);
  assertEquals((await orderRow(o.orderId)).gateway_payment_id, p2.paymentId);
  assertEquals((await liveEnts(c.id)).length, 1);

  // refunding the second payment too leaves nothing paying for the order: it is refunded and the access ends
  const refund2 = gw.razorpay.refund(p2.paymentId);
  assertStatus(await deliver('/api/pay/webhook', await gw.razorpay.webhook('refund.processed', { payment: { entity: gw.razorpay.payments.get(p2.paymentId) }, refund: { entity: refund2 } })), 200);
  assertEquals((await orderRow(o.orderId)).status, 'refunded');
  assertEquals((await liveEnts(c.id)).length, 0);
  assertEquals(await count(h.sql`select 1 from notifications where audience = 'customer' and user_id = ${c.id} and kind = 'order.refunded'`), 1);
});

test('a refund of the booked payment still refunds the order when the other payment is for less than the order (MONEY-6)', async () => {
  const c = await h.customer();
  const o = await paidRazorpay(c, { worksheet: 'az-F' });
  // a second payment row on the order that does NOT cover it (recorded for less than the order amount)
  await h.sql`
    insert into payments (order_id, provider, provider_payment_id, amount_minor, currency, status, source)
    select id, 'razorpay', 'pay_partialXXXXXXXX', amount_minor - 1, currency, 'captured', 'test' from orders where id = ${o.orderId}`;
  const refund1 = gw.razorpay.refund(o.pay.paymentId);
  assertStatus(await deliver('/api/pay/webhook', await gw.razorpay.webhook('refund.processed', { payment: { entity: gw.razorpay.payments.get(o.pay.paymentId) }, refund: { entity: refund1 } })), 200);
  assertEquals((await orderRow(o.orderId)).status, 'refunded');
  assertEquals((await liveEnts(c.id)).length, 0);
});

test('two class plans settled at the same moment chain instead of overlapping (MONEY-4)', async () => {
  const c = await h.customer();
  const o1 = await newOrder(c, 'razorpay', { cls: 'kg', plan: 'm1' });
  const o2 = await newOrder(c, 'razorpay', { cls: 'kg', plan: 'm1' });
  const p1 = await gw.razorpay.pay(o1.gateway.razorpay_order_id);
  const p2 = await gw.razorpay.pay(o2.gateway.razorpay_order_id);
  // order 1 is inside private.fulfil_order (not yet committed) when the webhook for order 2 arrives
  let hook!: Promise<Awaited<ReturnType<typeof deliver>>>;
  await h.sql.begin(async (sql) => {
    const r1 = await sql<Any[]>`select private.fulfil_order(${o1.orderId}, 'razorpay', ${p1.paymentId}, ${p1.payment.amount}::bigint, 'INR', 'webhook:payment.captured', null) as r`;
    assertEquals(r1[0].r.status, 'paid');
    hook = deliver('/api/pay/webhook', await gw.razorpay.webhook('payment.captured', { payment: { entity: p2.payment } }));
    // the webhook's grant waits for this one
    let waiting = 0;
    for (let i = 0; i < 100 && !waiting; i++) {
      await new Promise((r) => setTimeout(r, 50));
      waiting = (await h.sql<{ n: number }[]>`
        select count(*)::int as n from pg_stat_activity
        where datname = current_database() and application_name = 'lww-api-test' and wait_event_type = 'Lock'`)[0].n;
    }
    assert(waiting > 0, 'the second grant waits for the first');
  });
  assertStatus(await hook, 200);
  const ents = await h.sql<Any[]>`select starts_at, expires_at from entitlements where user_id = ${c.id} and scope = 'class' order by starts_at, id`;
  assertEquals(ents.length, 2);
  assertEquals(new Date(ents[1].starts_at).getTime(), new Date(ents[0].expires_at).getTime(), 'plan 2 starts when plan 1 ends');
});

test('currencies: whole-unit (KRW) and three-decimal (KWD) amounts reach the gateway as the quote shows; mixed ones are refused (MONEY-5)', async () => {
  const owner = await h.staff('owner');
  const before = await h.sql<Any[]>`select key, value from settings where key in ('currency_rates', 'countries')`;
  try {
    const rates = (before.find((r) => r.key === 'currency_rates')?.value ?? {}) as Record<string, number>;
    const bad = await h.call('PUT', '/api/admin/rates', { token: owner.token, body: { ...rates, HUF: 4.1 } });
    assertStatus(bad, 400, 'HUF is counted differently by the gateways');
    assertStatus(await h.call('PUT', '/api/admin/rates', { token: owner.token, body: { ...rates, KRW: 16.5, KWD: 0.0037 } }), 200, 'rates accepted');
    const cur = (before.find((r) => r.key === 'countries')?.value ?? []) as Any[];
    const extra = [
      { code: 'KR', name: 'South Korea', currency: 'KRW', tax: { label: 'VAT 10%', pct: 10 }, postal: { label: 'Postal code', hint: '5 digits', pattern: '^\\d{5}$', flags: '' }, state: 'Province', states: null, methods: ['razorpay', 'stripe', 'paypal'] },
      { code: 'KW', name: 'Kuwait', currency: 'KWD', tax: { label: 'VAT', pct: 0 }, postal: { label: 'Postal code', hint: '5 digits', pattern: '^\\d{5}$', flags: '' }, state: 'Governorate', states: null, methods: ['razorpay', 'stripe', 'paypal'] },
    ];
    const list = [...cur.filter((c) => c.code !== 'OTHER'), ...extra, cur.find((c) => c.code === 'OTHER')];
    assertStatus(await h.call('PUT', '/api/admin/settings/countries', { token: owner.token, body: { value: list } }), 200, 'countries accepted');

    const c = await h.customer();
    const kr = await quoteFor(c, { cls: 'kg', plan: 'm6', address: { country: 'KR', line1: '1 Sejong-daero', city: 'Seoul' } });
    const kw = await quoteFor(c, { cls: 'kg', plan: 'm6', address: { country: 'KW', line1: '1 Gulf Road', city: 'Kuwait City' } });
    assertEquals(kr.total, Math.round(kr.total), 'won are whole');
    assertEquals({ KRW: kr.amountMinor, KWD: kw.amountMinor }, { KRW: kr.total, KWD: Math.round(kw.total * 1000) });
    assertEquals(kw.amountMinor % 10, 0, 'three-decimal amounts end in 0, as Stripe and Razorpay require');
    const o = await h.call('POST', '/api/pay/order', { token: c.token, body: { quoteId: kr.quoteId, method: 'stripe' } });
    assertStatus(o, 200);
    assertEquals(gw.stripe.sessions.get(o.body.gateway.session)!.amount_total, kr.total, 'Stripe is asked for the quoted won');
  } finally {
    for (const r of before) await h.setSetting(r.key, r.value);
  }
});
