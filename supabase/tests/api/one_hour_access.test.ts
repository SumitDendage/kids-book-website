// One-hour access to a bought sheet (migration 20261022040000_one_hour_access.sql): the end is
// set by the database at the verified payment, every viewer request checks it, customers cannot
// see or change other people's records or their own end, and a failed payment opens nothing.
import { assert, assertEquals, assertStatus, startHarness, test, type TestUser } from './harness.ts';
import { installGatewayFakes } from './fakes/gateways.ts';
import { getSettings } from '../../functions/api/lib/settings.ts';

const h = await startHarness();
const gw = await installGatewayFakes(h);
const IN_ADDR = { country: 'IN', line1: '12 MG Road', city: 'Pune', state: 'Maharashtra', postal: '411001' };
for (const id of ['az-C', 'az-D', 'az-E', 'az-F']) await h.uploadPdfFor(id);

// deno-lint-ignore no-explicit-any
type Any = any;
const HOUR = 3_600_000;

async function order(c: TestUser, worksheet: string) {
  const q = await h.call('POST', '/api/quote', { token: c.token, body: { worksheet, address: IN_ADDR } });
  assertStatus(q, 200, 'quote');
  const r = await h.call('POST', '/api/pay/order', { token: c.token, body: { quoteId: q.body.quoteId, method: 'razorpay' } });
  assertStatus(r, 200, 'order');
  return { q: q.body, orderId: r.body.order.id as string, rzp: r.body.gateway.razorpay_order_id as string };
}

async function buy(c: TestUser, worksheet: string) {
  const o = await order(c, worksheet);
  const pay = await gw.razorpay.pay(o.rzp);
  const v = await h.call('POST', '/api/pay/verify', { token: c.token, body: { order_id: o.orderId, razorpay_order_id: o.rzp, razorpay_payment_id: pay.paymentId, razorpay_signature: pay.signature } });
  assertStatus(v, 200, 'verify');
  return { ...o, paymentId: pay.paymentId };
}

const entOf = async (orderId: string): Promise<Any> => (await h.sql<Any[]>`
  select e.*, extract(epoch from (e.expires_at - e.purchased_at))::int as secs from entitlements e where order_id = ${orderId}`)[0];
const view = (c: TestUser, vt: string, path: string) => h.call('GET', path, { token: c.token, headers: { 'x-view-token': vt } });

test('the shop-wide setting is 1 hour and the quote says so', async () => {
  assertEquals((await getSettings()).worksheet_access.hours, 1);
  const c = await h.customer();
  const q = await h.call('POST', '/api/quote', { token: c.token, body: { worksheet: 'az-C', address: IN_ADDR } });
  assertStatus(q, 200);
  assertEquals(q.body.items[0].accessHours, 1);
  assert(/1 hour\b/.test(JSON.stringify(q.body)), 'the quote words it as 1 hour');
});

test('valid access: a verified payment opens the sheet until the database time + 1 hour', async () => {
  const c = await h.customer();
  const { orderId } = await buy(c, 'az-C');
  const e = await entOf(orderId);
  assertEquals(e.user_id, c.id);
  assertEquals(e.product_id, 'az-C');
  assertEquals(e.kind, 'paid');
  assertEquals(e.secs, 3600, 'expires_at = purchased_at + 1 hour');
  assert(Math.abs(new Date(e.purchased_at).getTime() - Date.now()) < 60_000, 'purchased_at is the payment time');

  const r = await h.call('POST', '/api/access/az-C', { token: c.token });
  assertStatus(r, 200);
  assert(r.body.tokenExpiresAt <= new Date(e.expires_at).getTime(), 'the viewer link never outlasts the access');
  assert(r.body.tokenExpiresAt > Date.now() + HOUR - 120_000, 'the viewer link lasts the hour');
  for (const path of ['/api/view/meta', '/api/view/file']) assertStatus(await view(c, r.body.token, path), 200, path);

  const mine = await h.call('GET', '/api/me/entitlements', { token: c.token });
  assertStatus(mine, 200);
  const row = mine.body.entitlements.find((x: Any) => x.order === orderId || x.orderId === orderId);
  assert(row, 'listed in My Worksheets');
  assertEquals(row.status, 'active');
  assertEquals(row.end, new Date(e.expires_at).getTime());
});

test('expired access: after the hour every open, view, print and download is refused, and the order is kept', async () => {
  const c = await h.customer();
  const { orderId, paymentId } = await buy(c, 'az-D');
  const r = await h.call('POST', '/api/access/az-D', { token: c.token });
  assertStatus(r, 200);
  const vt = r.body.token;

  // the hour passes (by the database clock; the browser's clock or time zone plays no part)
  await h.sql`update entitlements set purchased_at = now() - interval '61 minutes', starts_at = now() - interval '61 minutes', expires_at = now() - interval '1 minute' where order_id = ${orderId}`;
  for (const path of ['/api/view/meta', '/api/view/file', '/api/view/page?n=0']) {
    const d = await view(c, vt, path);
    assertStatus(d, 403, path);
    assertEquals(d.body.code, 'expired', path);
  }
  for (const path of ['/api/view/print', '/api/view/download']) {
    const d = await h.call('POST', path, { token: c.token, headers: { 'x-view-token': vt }, body: {} });
    assert(d.status === 403, `${path} refused after expiry (got ${d.status})`);
  }
  const again = await h.call('POST', '/api/access/az-D', { token: c.token });
  assertStatus(again, 402);
  assertEquals(again.body.expired, true);

  const mine = await h.call('GET', '/api/me/entitlements', { token: c.token });
  const row = mine.body.entitlements.find((x: Any) => x.order === orderId || x.orderId === orderId);
  assertEquals(row.status, 'expired', 'My Worksheets is told it has ended (the site hides it)');

  // order history, payment and the record stay; the sheet stays in the shop
  const o = (await h.sql<Any[]>`select status from orders where id = ${orderId}`)[0];
  assertEquals(o.status, 'paid');
  assert((await h.sql`select 1 from payments where order_id = ${orderId}`).length >= 1, 'payment kept');
  assert(JSON.stringify(await h.sql`select * from payments where order_id = ${orderId}`).includes(paymentId), 'transaction id kept');
  assertEquals((await h.sql<Any[]>`select status from products where id = 'az-D'`)[0].status, 'active');
  const orders = await h.call('GET', '/api/orders', { token: c.token });
  if (orders.status === 200) assert(JSON.stringify(orders.body).includes(orderId), 'still in order history');
});

test('unauthorized users: signed out, another customer, or another customer\'s viewer link get nothing', async () => {
  const a = await h.customer();
  const b = await h.customer();
  const { orderId } = await buy(a, 'az-E');
  const r = await h.call('POST', '/api/access/az-E', { token: a.token });
  assertStatus(r, 200);

  assertStatus(await h.call('POST', '/api/access/az-E'), 401, 'signed out');
  assertStatus(await h.call('POST', '/api/access/az-E', { token: b.token }), 402, 'B has not bought it');
  for (const path of ['/api/view/meta', '/api/view/file']) {
    const d = await view(b, r.body.token, path);
    assert(d.status === 401 || d.status === 403, `${path}: A's link refused for B (got ${d.status})`);
  }
  const mine = await h.call('GET', '/api/me/entitlements', { token: b.token });
  assert(!JSON.stringify(mine.body).includes(orderId), 'B never sees A\'s purchase');
  // a client-supplied user id is ignored: the account comes from the sign-in only
  const forged = await h.call('POST', '/api/access/az-E', { token: b.token, body: { userId: a.id, user_id: a.id } });
  assertStatus(forged, 402);
});

test('row level security: a customer reads only their own records and cannot change any expiry', async () => {
  const a = await h.customer();
  const b = await h.customer();
  const { orderId } = await buy(a, 'az-F');
  const claims = (u: TestUser) => JSON.stringify({ sub: u.id, role: 'authenticated', session_id: u.sessionId });
  const asUser = async (u: TestUser, fn: (q: Any) => Promise<unknown>) => {
    try {
      return await h.sql.begin(async (q: Any) => {
        await q`select set_config('request.jwt.claims', ${claims(u)}, true), set_config('request.jwt.claim.sub', ${u.id}, true)`;
        await q`set local role authenticated`;
        return await fn(q);
      });
    } catch (e) { return e; }
  };
  const seenByB = await asUser(b, (q) => q`select id from entitlements where order_id = ${orderId}`) as Any[];
  assertEquals(seenByB.length, 0, 'B cannot read A\'s purchase');
  const seenByA = await asUser(a, (q) => q`select id from entitlements where order_id = ${orderId}`) as Any[];
  assertEquals(seenByA.length, 1, 'A can read their own');
  const ordersByB = await asUser(b, (q) => q`select id from orders where id = ${orderId}`) as Any[];
  assertEquals(ordersByB.length, 0, 'B cannot read A\'s order');

  const before = (await entOf(orderId)).expires_at;
  const upd = await asUser(a, (q) => q`update entitlements set expires_at = now() + interval '10 years' where order_id = ${orderId} returning id`);
  assert(upd instanceof Error || (Array.isArray(upd) && upd.length === 0), 'A cannot extend their own expiry');
  const ins = await asUser(a, (q) => q`insert into entitlements (user_id, scope, product_id, kind, order_id, expires_at) values (${a.id}, 'worksheet', 'az-C', 'grant', ${orderId}, now() + interval '1 year') returning id`);
  assert(ins instanceof Error, 'A cannot add a record');
  const del = await asUser(a, (q) => q`delete from orders where id = ${orderId} returning id`);
  assert(del instanceof Error || (Array.isArray(del) && del.length === 0), 'A cannot delete the order');
  assertEquals((await entOf(orderId)).expires_at.getTime(), before.getTime(), 'expiry unchanged');
});

test('failed payments, retries and duplicate notifications: a failure opens nothing; a retry opens exactly one hour once', async () => {
  const c = await h.customer();
  const o = await order(c, 'az-C');
  const bad = await gw.razorpay.pay(o.rzp, { status: 'failed' });
  const v1 = await h.call('POST', '/api/pay/verify', { token: c.token, body: { order_id: o.orderId, razorpay_order_id: o.rzp, razorpay_payment_id: bad.paymentId, razorpay_signature: bad.signature } });
  assertStatus(v1, 400);
  assertEquals((await h.sql`select 1 from entitlements where user_id = ${c.id}`).length, 0, 'nothing opened');
  assertStatus(await h.call('POST', '/api/access/az-C', { token: c.token }), 402);

  const good = await gw.razorpay.pay(o.rzp);
  const body = { order_id: o.orderId, razorpay_order_id: o.rzp, razorpay_payment_id: good.paymentId, razorpay_signature: good.signature };
  assertStatus(await h.call('POST', '/api/pay/verify', { token: c.token, body }), 200);
  const replay = await h.call('POST', '/api/pay/verify', { token: c.token, body });
  assert(replay.status === 200 || replay.status === 409, `replay answered ${replay.status}`);
  const ents = await h.sql<Any[]>`select extract(epoch from (expires_at - purchased_at))::int as secs from entitlements where user_id = ${c.id}`;
  assertEquals(ents.length, 1, 'one record, however many times it is confirmed');
  assertEquals(ents[0].secs, 3600);
});
