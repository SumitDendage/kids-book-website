// Staff commerce routes (routes/admin_commerce.ts): orders (never paid by staff), refunds,
// payments and the webhook log, access grants/revokes/extensions, coupons, plans, rates and
// settings — permissions, validation and the audit trail.
import { assert, assertEquals, assertMatch, assertStatus, startHarness, test, type Harness, type TestUser } from './harness.ts';

const h: Harness = await startHarness();
const admin = await h.staff('admin');
const support = await h.staff('support');
const content = await h.staff('content');
const developer = await h.staff('developer');

let seq = 0;
/** An order straight in the database; 'paid' goes through private.fulfil_order like a verified payment. */
async function order(user: TestUser, o: { productId?: string; status?: 'created' | 'paid'; method?: string; coupon?: string } = {}) {
  const id = `LWO-E${Date.now().toString(36).toUpperCase().slice(-6)}${(++seq).toString().padStart(3, '0')}`;
  const method = o.method ?? 'razorpay';
  await h.sql`
    insert into orders (id, user_id, kind, status, currency, rate, total, total_inr, amount_minor, lines, method, coupon_code)
    values (${id}, ${user.id}, 'worksheet', 'created', 'INR', 1, 25.80, 25.80, 2580, ${h.sql.json([])}, ${method}, ${o.coupon ?? null})`;
  await h.sql`
    insert into order_items (order_id, kind, product_id, title, access_days, unit_price_inr)
    values (${id}, 'worksheet', ${o.productId ?? 'az-C'}, 'Alphabet C — tracing sheet', 365, 19)`;
  if (o.status === 'paid') {
    await h.sql`select private.fulfil_order(${id}, ${method}, ${'pay_' + id.slice(4)}, 2580::bigint, 'INR', 'test')`;
  }
  return id;
}

async function auditRows(action: string, targetId: string | number) {
  // deno-lint-ignore no-explicit-any
  return await h.sql<any[]>`select actor_id, actor_role, detail from audit_logs where action = ${action} and target_id = ${String(targetId)} order by id`;
}

const DAY = 86_400_000;
const near = (a: number, b: number, slack = 120_000) => Math.abs(a - b) <= slack;

// ── who may call ─────────────────────────────────────────────────────────────────────────

test('commerce admin: no token → 401 staff_signin, customer → 403 not_staff, roles limited', async () => {
  const c = await h.customer();
  for (const [m, p] of [['GET', '/api/admin/orders'], ['PUT', '/api/admin/orders'], ['GET', '/api/admin/settings'], ['POST', '/api/admin/entitlements/grant'], ['GET', '/api/admin/coupons']]) {
    const anon = await h.call(m, p, { body: m === 'GET' ? undefined : {} });
    assertStatus(anon, 401, `${m} ${p}`);
    assertEquals(anon.body.code, 'staff_signin');
    const cust = await h.call(m, p, { token: c.token, body: m === 'GET' ? undefined : {} });
    assertStatus(cust, 403, `${m} ${p}`);
    assertEquals(cust.body.code, 'not_staff');
  }
  const id = await order(c, { status: 'paid' });
  assertStatus(await h.call('GET', '/api/admin/orders', { token: support.token }), 200);
  const w = await h.call('PUT', '/api/admin/orders', { token: support.token, body: { id, note: 'x' } });
  assertStatus(w, 403);
  assertEquals(w.body.permission, 'orders.write');
  assertStatus(await h.call('POST', `/api/admin/orders/${id}/refund`, { token: support.token, body: { reason: 'test' } }), 403);
  assertStatus(await h.call('POST', '/api/admin/entitlements/grant', { token: support.token, body: { email: c.email, worksheet: 'az-D', days: 3, reason: 'test' } }), 403);
  assertStatus(await h.call('GET', '/api/admin/orders', { token: content.token }), 403);
  // a deactivated staff member is no longer staff
  await h.sql`update staff_members set active = false where user_id = ${developer.id}`;
  const off = await h.call('GET', '/api/admin/payment-events', { token: developer.token });
  assertStatus(off, 403);
  assertEquals(off.body.code, 'not_staff');
  await h.sql`update staff_members set active = true where user_id = ${developer.id}`;
});

// ── orders ───────────────────────────────────────────────────────────────────────────────

test('orders list: old shape plus email/name, filters, pagination; detail has lines, payments and access', async () => {
  const c = await h.customer({ name: 'Order Lister' });
  const paid = await order(c, { status: 'paid' });
  const open = await order(c, { productId: 'az-D' });
  const r = await h.call('GET', `/api/admin/orders?q=${encodeURIComponent(c.email)}`, { token: support.token });
  assertStatus(r, 200);
  assertEquals(r.body.orders.map((o: { id: string }) => o.id).sort(), [paid, open].sort());
  assertEquals(r.body.total, 2);
  const o = r.body.orders.find((x: { id: string }) => x.id === paid);
  for (const k of ['id', 'at', 'kind', 'cls', 'plan', 'worksheet', 'currency', 'total', 'totalInr', 'lines', 'coupon', 'address', 'method', 'status', 'paidAt', 'gatewayOrderId', 'paymentId', 'email', 'name']) {
    assert(k in o, `old field ${k}`);
  }
  assertEquals([o.email, o.name, o.status, o.worksheet, o.cls, o.totalInr, o.paymentId], [c.email, 'Order Lister', 'paid', 'az-C', 'kg', 25.8, `pay_${paid.slice(4)}`]);
  assertEquals(o.lines[0].entitlement.status, 'active');

  const onlyPaid = await h.call('GET', `/api/admin/orders?status=paid&user=${c.id}`, { token: support.token });
  assertEquals(onlyPaid.body.orders.map((x: { id: string }) => x.id), [paid]);
  const page = await h.call('GET', `/api/admin/orders?user=${c.id}&limit=1`, { token: support.token });
  assertEquals([page.body.orders.length, page.body.total, page.body.nextOffset], [1, 2, 1]);
  const tomorrow = new Date(Date.now() + DAY).toISOString().slice(0, 10);
  const later = await h.call('GET', `/api/admin/orders?user=${c.id}&from=${tomorrow}`, { token: support.token });
  assertEquals(later.body.orders.length, 0);
  const today = new Date().toISOString().slice(0, 10);
  const upToToday = await h.call('GET', `/api/admin/orders?user=${c.id}&to=${today}`, { token: support.token });
  assertEquals(upToToday.body.orders.length, 2);
  assertStatus(await h.call('GET', '/api/admin/orders?status=shipped', { token: support.token }), 400);
  assertStatus(await h.call('GET', '/api/admin/orders?from=yesterday', { token: support.token }), 400);
  // LIKE wildcards in q are taken literally
  const wild = await h.call('GET', '/api/admin/orders?q=%25', { token: support.token });
  assertStatus(wild, 200);

  const d = await h.call('GET', `/api/admin/orders/${paid}`, { token: support.token });
  assertStatus(d, 200);
  assertEquals([d.body.order.id, d.body.customer.email, d.body.payments.length, d.body.entitlements.length], [paid, c.email, 1, 1]);
  assertEquals([d.body.payments[0].provider, d.body.payments[0].amountMinor, d.body.payments[0].status], ['razorpay', 2580, 'captured']);
  assert(!('raw' in d.body.payments[0]), 'no raw gateway payload');
  assertEquals(d.body.audit, null, 'support has no audit.read');
  const da = await h.call('GET', `/api/admin/orders/${paid}`, { token: admin.token });
  assert(Array.isArray(da.body.audit));
  const none = await h.call('GET', '/api/admin/orders/LWO-NOPE1234', { token: support.token });
  assertStatus(none, 404);
  assertEquals(none.body.error, 'No such order.');
});

test('staff can never mark an order paid; only created → cancelled, and notes (audited)', async () => {
  const c = await h.customer();
  const id = await order(c);
  const paid = await h.call('PUT', '/api/admin/orders', { token: admin.token, body: { id, status: 'paid' } });
  assertStatus(paid, 400);
  assertEquals(paid.body.code, 'use_gateway');
  const row = (await h.sql<{ status: string }[]>`select status from orders where id = ${id}`)[0];
  assertEquals(row.status, 'created');
  assertEquals((await h.sql`select 1 from entitlements where order_id = ${id}`).length, 0, 'no access granted');
  const ref = await h.call('PUT', '/api/admin/orders', { token: admin.token, body: { id, status: 'refunded' } });
  assertStatus(ref, 400);
  assertEquals(ref.body.code, 'use_refund');
  const unknown = await h.call('PUT', '/api/admin/orders', { token: admin.token, body: { id, status: 'shipped' } });
  assertStatus(unknown, 400);
  assertEquals(unknown.body.error, 'Unknown status.');

  const cancel = await h.call('PUT', '/api/admin/orders', { token: admin.token, body: { id, status: 'cancelled', note: 'customer asked by phone' } });
  assertStatus(cancel, 200);
  assertEquals([cancel.body.order.status, cancel.body.order.note], ['cancelled', 'customer asked by phone']);
  assert(cancel.body.order.cancelledAt > 0);
  const a = await auditRows('order.update', id);
  assertEquals(a.length, 1);
  assertEquals(a[0].actor_id, admin.id);
  assertEquals(a[0].detail, { before: { status: 'created', note: null }, after: { status: 'cancelled', note: 'customer asked by phone' } });

  const paidId = await order(c, { status: 'paid' });
  const back = await h.call('PUT', '/api/admin/orders', { token: admin.token, body: { id: paidId, status: 'cancelled' } });
  assertStatus(back, 409);
  assertEquals(back.body.code, 'bad_transition');
  const sameStatus = await h.call('PUT', '/api/admin/orders', { token: admin.token, body: { id: paidId, status: 'paid', note: 'VIP' } });
  assertStatus(sameStatus, 200, 'an unchanged status with a note is fine');
  assertEquals(sameStatus.body.order.note, 'VIP');
  const missing = await h.call('PUT', '/api/admin/orders', { token: admin.token, body: { id: 'LWO-NOPE1234', status: 'cancelled' } });
  assertStatus(missing, 404);
  assertEquals(missing.body.error, 'No such order.');
  assertStatus(await h.call('PUT', '/api/admin/orders', { token: admin.token, body: { id: paidId } }), 400);
  assertStatus(await h.call('PUT', '/api/admin/orders', { token: admin.token, body: { id: paidId, note: 'x'.repeat(2001) } }), 400);
});

test('refund records a gateway refund: order refunded, access revoked, customer told, audited', async () => {
  const c = await h.customer({ name: 'Refund Parent' });
  const id = await order(c, { status: 'paid' });
  const ent = (await h.sql<{ id: number }[]>`select id from entitlements where order_id = ${id}`)[0];
  assert(ent, 'fulfil granted access');

  const noReason = await h.call('POST', `/api/admin/orders/${id}/refund`, { token: admin.token, body: {} });
  assertStatus(noReason, 400);
  assert(noReason.body.errors.reason);

  const r = await h.call('POST', `/api/admin/orders/${id}/refund`, { token: admin.token, body: { reason: 'Refunded in Razorpay, duplicate purchase' } });
  assertStatus(r, 200);
  assertEquals([r.body.ok, r.body.recordedOnly, r.body.revoked, r.body.order.status], [true, true, 1, 'refunded']);
  assertMatch(r.body.note, /already made in the Razorpay dashboard/);
  assertMatch(r.body.note, /no money was moved/);

  const o = (await h.sql<{ status: string; refunded_by: string; refunded_at: Date }[]>`select status, refunded_by, refunded_at from orders where id = ${id}`)[0];
  assertEquals([o.status, o.refunded_by], ['refunded', admin.id]);
  const e = (await h.sql<{ revoked_at: Date | null; revoked_by: string; revoke_reason: string }[]>`select revoked_at, revoked_by, revoke_reason from entitlements where id = ${ent.id}`)[0];
  assert(e.revoked_at, 'access ended');
  assertEquals([e.revoked_by, e.revoke_reason], [admin.id, 'Refunded in Razorpay, duplicate purchase']);
  assertEquals((await h.sql<{ status: string }[]>`select status from payments where order_id = ${id}`)[0].status, 'refunded');

  const a = await auditRows('order.refund', id);
  assertEquals(a.length, 1);
  assertEquals([a[0].actor_id, a[0].detail.before.status, a[0].detail.after.status, a[0].detail.revoked, a[0].detail.recordedOnly], [admin.id, 'paid', 'refunded', 1, true]);
  const n = await h.sql`select 1 from notifications where user_id = ${c.id} and kind = 'order.refunded'`;
  assertEquals(n.length, 1);
  const mail = h.mail.last(c.email);
  assert(mail, 'refund email sent');
  assertMatch(mail!.subject, new RegExp(`order ${id} refunded`));
  assertMatch(mail!.text, /Alphabet C/);
  assertEquals((await h.sql`select 1 from analytics_events where kind = 'refund' and order_id = ${id}`).length, 1);

  // customer side: the order shows refunded and the access record is revoked
  const mine = await h.call('GET', '/api/me/entitlements', { token: c.token });
  if (mine.status === 200) {
    const me = mine.body.entitlements.find((x: { id: number }) => x.id === ent.id);
    assertEquals(me.status, 'revoked');
  }

  const twice = await h.call('POST', `/api/admin/orders/${id}/refund`, { token: admin.token, body: { reason: 'again' } });
  assertStatus(twice, 409);
  assertEquals(twice.body.code, 'already_refunded');
  const unpaid = await order(c);
  const np = await h.call('POST', `/api/admin/orders/${unpaid}/refund`, { token: admin.token, body: { reason: 'not paid yet' } });
  assertStatus(np, 409);
  assertEquals(np.body.code, 'not_paid');
  assertStatus(await h.call('POST', '/api/admin/orders/LWO-NOPE1234/refund', { token: admin.token, body: { reason: 'nope' } }), 404);
});

test('payments and the payment-event log', async () => {
  const c = await h.customer();
  const id = await order(c, { status: 'paid', method: 'stripe' });
  await h.sql`
    insert into payment_events (provider, event_id, event_type, order_id, ok, status, signature_ok, detail, payload_sha256)
    values ('stripe', ${'evt_' + id}, 'checkout.session.completed', ${id}, true, 'processed', true, ${h.sql.json({ note: 'x' })}, ${'a'.repeat(64)}),
           ('stripe', null, 'webhook.bad_signature', ${id}, false, 'failed', false, null, null)`;
  const p = await h.call('GET', `/api/admin/payments?order=${id}`, { token: support.token });
  assertStatus(p, 200);
  assertEquals(p.body.payments.length, 1);
  assertEquals([p.body.payments[0].orderId, p.body.payments[0].provider, p.body.payments[0].amount, p.body.payments[0].email], [id, 'stripe', 25.8, c.email]);
  assertEquals(p.body.events, p.body.payments, 'old field name kept');
  const ev = await h.call('GET', `/api/admin/payment-events?order=${id}`, { token: developer.token });
  assertStatus(ev, 200);
  assertEquals(ev.body.events.length, 2);
  const bad = await h.call('GET', `/api/admin/payment-events?order=${id}&ok=false`, { token: developer.token });
  assertEquals(bad.body.events.map((x: { type: string }) => x.type), ['webhook.bad_signature']);
  assertStatus(await h.call('GET', '/api/admin/payment-events?provider=bitcoin', { token: developer.token }), 400);
  assertStatus(await h.call('GET', '/api/admin/payment-events', { token: content.token }), 403);
});

// ── access records ───────────────────────────────────────────────────────────────────────

test('grant needs an end date and a reason, and creates kind grant (audited, customer notified)', async () => {
  const c = await h.customer();
  const noEnd = await h.call('POST', '/api/admin/entitlements/grant', { token: admin.token, body: { email: c.email, worksheet: 'az-M', reason: 'goodwill' } });
  assertStatus(noEnd, 400);
  assertEquals(noEnd.body.code, 'expiry_required');
  const noReason = await h.call('POST', '/api/admin/entitlements/grant', { token: admin.token, body: { email: c.email, worksheet: 'az-M', days: 30 } });
  assertStatus(noReason, 400);
  assert(noReason.body.errors.reason);
  for (const body of [
    { email: c.email, worksheet: 'az-M', days: 0, reason: 'r1x' }, { email: c.email, worksheet: 'az-M', days: 5000, reason: 'r1x' },
    { email: c.email, worksheet: 'az-M', until: '2001-01-01', reason: 'r1x' }, { email: c.email, worksheet: 'az-M', days: 3, until: '2030-01-01', reason: 'r1x' },
    { email: c.email, worksheet: 'az-M', cls: 'kg', days: 3, reason: 'r1x' }, { email: 'not-an-email', worksheet: 'az-M', days: 3, reason: 'r1x' },
    { email: c.email, worksheet: 'az-M', plan: 'm1', days: 3, reason: 'r1x' },
  ]) {
    assertStatus(await h.call('POST', '/api/admin/entitlements/grant', { token: admin.token, body }), 400, JSON.stringify(body));
  }
  const nobody = await h.call('POST', '/api/admin/entitlements/grant', { token: admin.token, body: { email: 'nobody@test.local', worksheet: 'az-M', days: 3, reason: 'goodwill' } });
  assertStatus(nobody, 404);
  assertEquals(nobody.body.error, 'No customer with that email.');
  const noSheet = await h.call('POST', '/api/admin/entitlements/grant', { token: admin.token, body: { email: c.email, worksheet: 'zz-nope', days: 3, reason: 'goodwill' } });
  assertStatus(noSheet, 404);
  assertEquals(noSheet.body.error, 'No such worksheet.');

  const r = await h.call('POST', '/api/admin/entitlements/grant', { token: admin.token, body: { email: c.email.toUpperCase(), worksheet: 'az-M', days: 30, reason: 'school pilot' } });
  assertStatus(r, 200);
  const e = r.body.entitlement;
  assertEquals([r.body.ok, e.grant, e.kind, e.worksheet, e.email, e.status, e.order], [true, true, 'paid', 'az-M', c.email, 'active', null]);
  assert(near(e.end, Date.now() + 30 * DAY), 'ends in 30 days');
  const row = (await h.sql<{ kind: string; granted_by: string; expires_at: Date }[]>`select kind, granted_by, expires_at from entitlements where id = ${e.id}`)[0];
  assertEquals([row.kind, row.granted_by], ['grant', admin.id]);
  const a = await auditRows('entitlement.grant', e.id);
  assertEquals([a.length, a[0].detail.before, a[0].detail.after.kind, a[0].detail.reason, a[0].detail.after.userId], [1, null, 'grant', 'school pilot', c.id]);
  assertEquals((await h.sql`select 1 from notifications where user_id = ${c.id} and kind = 'access.granted'`).length, 1);

  const until = new Date(Date.now() + 10 * DAY);
  const byDate = await h.call('POST', '/api/admin/entitlements/grant', { token: admin.token, body: { user: c.id, worksheet: 'az-N', until: until.toISOString(), reason: 'replacement' } });
  assertStatus(byDate, 200);
  assertEquals(byDate.body.entitlement.end, until.getTime());

  // old request shape: {email, scope, ref, plan}; a class plan's months give the end date
  const old = await h.call('POST', '/api/admin/entitlements/grant', { token: admin.token, body: { email: c.email, scope: 'class', ref: 'kg', plan: 'm3', reason: 'teacher trial' } });
  assertStatus(old, 200);
  const ce = old.body.entitlement;
  assertEquals([ce.scope, ce.cls, ce.plan, ce.grant], ['class', 'kg', 'm3', true]);
  const months = new Date(ce.start);
  months.setUTCMonth(months.getUTCMonth() + 3);
  assert(near(ce.end, months.getTime(), DAY + 60_000), 'plan length');

  // a draft sheet cannot be granted
  await h.sql`insert into products (id, title, class_id, subject, status) values ('t-draft-grant', 'Draft', 'kg', 'English', 'draft') on conflict do nothing`;
  const draft = await h.call('POST', '/api/admin/entitlements/grant', { token: admin.token, body: { email: c.email, worksheet: 't-draft-grant', days: 3, reason: 'goodwill' } });
  assertStatus(draft, 400);
  assertEquals(draft.body.code, 'draft');
});

test('revoke and extend access records (audited); entitlement list filters', async () => {
  const c = await h.customer();
  const g = await h.call('POST', '/api/admin/entitlements/grant', { token: admin.token, body: { email: c.email, worksheet: 'az-O', days: 5, reason: 'trial' } });
  assertStatus(g, 200);
  const id = g.body.entitlement.id;
  const end0 = g.body.entitlement.end;

  const ext = await h.call('POST', `/api/admin/entitlements/${id}/extend`, { token: admin.token, body: { days: 10, reason: 'more time' } });
  assertStatus(ext, 200);
  assert(near(ext.body.entitlement.end, end0 + 10 * DAY, 5_000), 'days added to the current end');
  const xa = await auditRows('entitlement.extend', id);
  assertEquals([xa.length, xa[0].detail.before.expiresAt, xa[0].detail.after.expiresAt], [1, new Date(end0).toISOString(), new Date(ext.body.entitlement.end).toISOString()]);
  const earlier = await h.call('POST', `/api/admin/entitlements/${id}/extend`, { token: admin.token, body: { until: new Date(Date.now() + 2 * DAY).toISOString(), reason: 'shorter' } });
  assertStatus(earlier, 400);
  assertStatus(await h.call('POST', `/api/admin/entitlements/${id}/extend`, { token: admin.token, body: { reason: 'nothing' } }), 400);
  assertStatus(await h.call('POST', `/api/admin/entitlements/${id}/extend`, { token: content.token, body: { days: 3, reason: 'x1x' } }), 403);
  assertStatus(await h.call('POST', '/api/admin/entitlements/99999999/extend', { token: admin.token, body: { days: 3, reason: 'x1x' } }), 404);

  // an expired paid record can be extended from today
  const pid = await order(c, { status: 'paid', productId: 'az-P' });
  const paidEnt = (await h.sql<{ id: number }[]>`select id from entitlements where order_id = ${pid}`)[0].id;
  await h.sql`update entitlements set expires_at = now() - interval '2 days', starts_at = now() - interval '40 days', purchased_at = now() - interval '40 days' where id = ${paidEnt}`;
  const revive = await h.call('POST', `/api/admin/entitlements/${paidEnt}/extend`, { token: admin.token, body: { days: 7, reason: 'support case' } });
  assertStatus(revive, 200);
  assert(near(revive.body.entitlement.end, Date.now() + 7 * DAY));
  assertEquals(revive.body.entitlement.status, 'active');

  // a free pass never expires
  const free = (await h.sql<{ id: number }[]>`
    insert into entitlements (user_id, scope, product_id, kind) values (${c.id}, 'worksheet', 'az-A', 'free') returning id`)[0].id;
  const fp = await h.call('POST', `/api/admin/entitlements/${free}/extend`, { token: admin.token, body: { days: 3, reason: 'x1x' } });
  assertStatus(fp, 400);
  assertEquals(fp.body.code, 'free_pass');

  const noReason = await h.call('POST', '/api/admin/entitlements/revoke', { token: admin.token, body: { id } });
  assertStatus(noReason, 400);
  const rv = await h.call('POST', '/api/admin/entitlements/revoke', { token: admin.token, body: { id, reason: 'shared the account' } });
  assertStatus(rv, 200);
  assertEquals([rv.body.ok, rv.body.revoked, rv.body.entitlement.status, rv.body.entitlement.revokeReason], [true, 1, 'revoked', 'shared the account']);
  assert(rv.body.entitlement.revoked > 0, 'old field revoked = ms');
  const ra = await auditRows('entitlement.revoke', id);
  assertEquals([ra.length, ra[0].detail.before.revokedAt, ra[0].detail.reason], [1, null, 'shared the account']);
  const again = await h.call('POST', '/api/admin/entitlements/revoke', { token: admin.token, body: { id, reason: 'again' } });
  assertEquals([again.status, again.body.revoked], [200, 0]);
  assertEquals((await auditRows('entitlement.revoke', id)).length, 1);
  const after = await h.call('POST', `/api/admin/entitlements/${id}/extend`, { token: admin.token, body: { days: 3, reason: 'x1x' } });
  assertStatus(after, 409);
  assertEquals(after.body.code, 'revoked');
  const unknown = await h.call('POST', '/api/admin/entitlements/revoke', { token: admin.token, body: { id: 99999999, reason: 'x1x' } });
  assertStatus(unknown, 404);
  assertStatus(await h.call('POST', '/api/admin/entitlements/revoke', { token: support.token, body: { id, reason: 'x1x' } }), 403);

  const list = await h.call('GET', `/api/admin/entitlements?email=${encodeURIComponent(c.email)}`, { token: support.token });
  assertStatus(list, 200);
  assertEquals(list.body.entitlements.length, 3);
  for (const k of ['id', 'scope', 'worksheet', 'title', 'cls', 'plan', 'kind', 'order', 'start', 'end', 'active', 'email', 'revoked']) {
    assert(k in list.body.entitlements[0], `old field ${k}`);
  }
  const revoked = await h.call('GET', `/api/admin/entitlements?user=${c.id}&status=revoked`, { token: support.token });
  assertEquals(revoked.body.entitlements.map((x: { id: number }) => x.id), [id]);
  const active = await h.call('GET', `/api/admin/entitlements?user=${c.id}&status=active`, { token: support.token });
  assertEquals(active.body.entitlements.map((x: { id: number }) => x.id).sort(), [paidEnt, free].sort());
  const grants = await h.call('GET', `/api/admin/entitlements?user=${c.id}&kind=grant`, { token: support.token });
  assertEquals(grants.body.entitlements.length, 1);
  assertStatus(await h.call('GET', '/api/admin/entitlements?status=weird', { token: support.token }), 400);
  assertStatus(await h.call('GET', '/api/admin/entitlements?user=not-a-uuid', { token: support.token }), 400);
});

// ── coupons ──────────────────────────────────────────────────────────────────────────────

test('coupons: create, validate, update, list; delete removes unused codes and switches off used ones', async () => {
  const code = `SAVE${Date.now().toString(36).toUpperCase()}`;
  const r = await h.call('POST', '/api/admin/coupons', { token: content.token, body: { code: code.toLowerCase(), pct: 10, maxUses: 5, appliesTo: 'worksheet', note: 'launch' } });
  assertStatus(r, 200);
  assertEquals([r.body.coupon.code, r.body.coupon.pct, r.body.coupon.max, r.body.coupon.uses, r.body.coupon.active, r.body.coupon.appliesTo], [code, 10, 5, 0, true, 'worksheet']);
  assertEquals((await auditRows('coupon.create', code)).length, 1);
  const dup = await h.call('POST', '/api/admin/coupons', { token: content.token, body: { code, pct: 20 } });
  assertStatus(dup, 409);
  assertEquals(dup.body.code, 'coupon_exists');
  for (const body of [
    { code: 'ok-code-1', pct: 0 }, { code: 'ok-code-1', pct: 101 }, { code: 'x', pct: 10 }, { code: 'bad code', pct: 10 },
    { code: 'ok-code-1', pct: 10, cls: 'zz' }, { code: 'ok-code-1', pct: 10, appliesTo: 'everything' },
    { code: 'ok-code-1', pct: 10, validFrom: '2027-02-01', validUntil: '2027-01-01' }, { code: 'ok-code-1', pct: 10, maxUses: -1 },
  ]) {
    assertStatus(await h.call('POST', '/api/admin/coupons', { token: admin.token, body }), 400, JSON.stringify(body));
  }
  assertStatus(await h.call('POST', '/api/admin/coupons', { token: support.token, body: { code: 'SUPPORT1', pct: 10 } }), 403);

  const up = await h.call('PUT', `/api/admin/coupons/${code.toLowerCase()}`, { token: content.token, body: { maxUses: 50, active: false, validUntil: '2030-12-31' } });
  assertStatus(up, 200);
  assertEquals([up.body.coupon.maxUses, up.body.coupon.active, up.body.coupon.validUntil], [50, false, Date.UTC(2030, 11, 31)]);
  const ua = await auditRows('coupon.update', code);
  assertEquals(ua[0].detail, { before: { maxUses: 5, validUntil: null, active: true }, after: { maxUses: 50, validUntil: '2030-12-31T00:00:00.000Z', active: false } });
  assertStatus(await h.call('PUT', '/api/admin/coupons/NOPE-NOPE', { token: admin.token, body: { pct: 5 } }), 404);
  assertStatus(await h.call('PUT', `/api/admin/coupons/${code}`, { token: admin.token, body: { code: 'RENAMED' } }), 400);

  const list = await h.call('GET', '/api/admin/coupons', { token: support.token });
  assertStatus(list, 200, 'support (orders.read) may see coupons');
  assert(list.body.coupons.some((x: { code: string }) => x.code === code));

  const del = await h.call('DELETE', `/api/admin/coupons/${code}`, { token: content.token });
  assertStatus(del, 200);
  assertEquals([del.body.deleted, del.body.deactivated], [true, false]);
  assertEquals((await h.sql`select 1 from coupons where code = ${code}`).length, 0);
  assertEquals((await auditRows('coupon.delete', code)).length, 1);

  // a code used on a paid order is switched off, not deleted
  const used = `USED${Date.now().toString(36).toUpperCase()}`;
  assertStatus(await h.call('POST', '/api/admin/coupons', { token: admin.token, body: { code: used, pct: 15 } }), 200);
  const c = await h.customer();
  await order(c, { status: 'paid', coupon: used });
  assertEquals((await h.sql`select 1 from coupon_redemptions where coupon_code = ${used}`).length, 1);
  const d2 = await h.call('DELETE', `/api/admin/coupons/${used}`, { token: admin.token });
  assertStatus(d2, 200);
  assertEquals([d2.body.deleted, d2.body.deactivated, d2.body.coupon.active, d2.body.coupon.uses], [false, true, false, 1]);
  assertEquals((await h.sql<{ active: boolean }[]>`select active from coupons where code = ${used}`)[0].active, false);
  assertEquals((await auditRows('coupon.deactivate', used)).length, 1);
  assertStatus(await h.call('DELETE', '/api/admin/coupons/NOPE-NOPE', { token: admin.token }), 404);
});

test('old bulk PUT /api/admin/coupons: replaces the list, class discounts need pricing.write', async () => {
  const keep = `KEEP${Date.now().toString(36).toUpperCase()}`;
  const drop = `DROP${Date.now().toString(36).toUpperCase()}`;
  assertStatus(await h.call('POST', '/api/admin/coupons', { token: admin.token, body: { code: keep, pct: 5 } }), 200);
  assertStatus(await h.call('POST', '/api/admin/coupons', { token: admin.token, body: { code: drop, pct: 5 } }), 200);
  const r = await h.call('PUT', '/api/admin/coupons', {
    token: content.token,
    body: { coupons: [{ code: keep.toLowerCase(), pct: 12, max: 3, uses: 99, active: true }, { code: 'bulknew', pct: 20, max: 0, active: false }] },
  });
  assertStatus(r, 200);
  assertEquals(r.body.ok, true);
  assertEquals(r.body.coupons[keep], { pct: 12, max: 3, uses: 0, active: true });
  assertEquals(r.body.coupons.BULKNEW, { pct: 20, max: 0, uses: 0, active: false });
  assert(!(drop in r.body.coupons), 'left-out unused code removed');
  assertEquals((await h.sql`select 1 from coupons where code = ${drop}`).length, 0);

  const disc = await h.call('PUT', '/api/admin/coupons', { token: content.token, body: { discounts: { kg: 5 } } });
  assertStatus(disc, 403);
  assertEquals(disc.body.permission, 'pricing.write');
  const bad = await h.call('PUT', '/api/admin/coupons', { token: admin.token, body: { discounts: { kg: 95 } } });
  assertStatus(bad, 400);
  const ok = await h.call('PUT', '/api/admin/coupons', { token: admin.token, body: { discounts: { kg: 5 } } });
  assertStatus(ok, 200);
  assertEquals(ok.body.discounts, { kg: 5 });
  assertEquals(ok.body.coupons[keep].pct, 12, 'coupons untouched when only discounts are sent');
  assertEquals((await h.sql<{ d: number }[]>`select discount_pct::float8 as d from classes where id = 'kg'`)[0].d, 5);
  const reset = await h.call('PUT', '/api/admin/coupons', { token: admin.token, body: { discounts: {} } });
  assertEquals(reset.body.discounts, {});
  const dupe = await h.call('PUT', '/api/admin/coupons', { token: admin.token, body: { coupons: [{ code: 'AAA1', pct: 5 }, { code: 'aaa1', pct: 6 }] } });
  assertStatus(dupe, 400);
});

// ── plans, rates, settings ───────────────────────────────────────────────────────────────

test('GET /api/admin/settings: old shape plus the settings each role may see', async () => {
  const r = await h.call('GET', '/api/admin/settings', { token: admin.token });
  assertStatus(r, 200);
  assertEquals(r.body.plans.m1, { label: '1 month', months: 1, price: 199 });
  assertEquals(r.body.classes.kg, 'Kindergarten');
  assertEquals(r.body.rates.INR, 1);
  assertEquals(r.body.fees.IN, { pct: 2, fixed: 3 });
  assertEquals(typeof r.body.coupons, 'object');
  assertEquals(typeof r.body.discounts, 'object');
  assertEquals(r.body.settings.worksheet_access.value, { days: 1, hours: 1 });
  assert(r.body.editable.includes('security') && r.body.editable.includes('countries') && r.body.editable.includes('agreement'));

  const s = await h.call('GET', '/api/admin/settings', { token: support.token });
  assertStatus(s, 200);
  assertEquals(s.body.editable, []);
  assert('security' in s.body.settings, 'support has security.read');
  assert(!('agreement' in s.body.settings), 'site settings need settings.write');
  const ct = await h.call('GET', '/api/admin/settings', { token: content.token });
  assert(!('security' in ct.body.settings));
  assertEquals(ct.body.editable, []);
});

test('settings writes: whitelist, permission split, validation, audit, cache cleared', async () => {
  const put = (key: string, value: unknown, token = admin.token) => h.call('PUT', `/api/admin/settings/${key}`, { token, body: { value } });
  for (const v of [{ days: 0 }, { days: 3651 }, { days: '30' }, { days: 30.5 }, { days: 30, extra: 1 }, 'thirty']) {
    const r = await put('worksheet_access', v);
    assertStatus(r, 400, JSON.stringify(v));
    assert(r.body.errors, 'field errors');
  }
  assertStatus(await put('worksheet_access', { days: 30 }, content.token), 403);
  assertStatus(await put('worksheet_access', { days: 30 }, support.token), 403);
  const ok = await put('worksheet_access', { days: 30 });
  assertStatus(ok, 200);
  assertEquals(ok.body.value, { hours: 720, days: 30 }, 'days only (an older form) are stored as hours');
  const a = await auditRows('settings.update', 'worksheet_access');
  assertEquals([a.length, a[0].actor_id], [1, admin.id]);
  assertEquals(a[0].detail, { before: { days: 1, hours: 1 }, after: { hours: 720, days: 30 } });
  // the new length is used straight away (cache cleared)
  const shop = await h.call('GET', '/api/worksheets');
  if (shop.status === 200) assertEquals(shop.body.accessDays, 30);
  const g = await h.call('GET', '/api/admin/settings', { token: admin.token });
  assertEquals([g.body.accessDays, g.body.accessHours], [30, 720]);
  // hours: what the Admin form sends now
  for (const v of [{ hours: 0 }, { hours: 87601 }, { hours: '6' }, { hours: 1.5 }, { hours: 6, extra: 1 }]) assertStatus(await put('worksheet_access', v), 400, JSON.stringify(v));
  const six = await put('worksheet_access', { hours: 6 });
  assertStatus(six, 200);
  assertEquals(six.body.value, { hours: 6, days: 1 });
  const quick = await h.call('GET', '/api/worksheets');
  if (quick.status === 200) assertEquals([quick.body.accessHours, quick.body.accessDays], [6, 1]);
  // also accepts the fields directly (no { value } wrapper)
  assertStatus(await h.call('PUT', '/api/admin/settings/worksheet_access', { token: admin.token, body: { days: 365 } }), 200);

  const unknown = await put('secret_key', { x: 1 });
  assertStatus(unknown, 404);
  assertEquals(unknown.body.code, 'unknown_setting');
  assertStatus(await h.call('PUT', '/api/admin/settings/__proto__', { token: admin.token, body: { value: {} } }), 404);

  // security → security.write
  assertStatus(await put('security', { maxWarnings: 0 }), 400);
  assertStatus(await put('security', { autoSuspend: 'yes' }), 400);
  assertStatus(await put('security', { maxWarnings: 4 }, support.token), 403);
  const sec = await put('security', { maxWarnings: 4 });
  assertStatus(sec, 200);
  assertEquals(sec.body.value, { maxWarnings: 4, warningExpiryDays: 365, autoSuspend: true });
  assertStatus(await put('security', { maxWarnings: 3 }), 200);

  // site settings → settings.write
  assertStatus(await put('sessions', { rememberDays: 100, maxDays: 90 }), 400);
  assertStatus(await put('login', { maxFailed: 1 }), 400);
  assertStatus(await put('viewer', { recheckSeconds: 5 }), 400);
  assertStatus(await put('contact', { inbox: 'not-an-email' }), 400);
  assertStatus(await put('email', { adminAlerts: [] }), 400);
  assertStatus(await put('email', { adminAlerts: ['a@b.co', 'a@b.co'] }), 400);
  assertStatus(await put('email', { fromName: 'Evil <x@y.z>' }), 400);
  const em = await put('email', { adminAlerts: ['alerts@test.local', 'owner@test.local'] });
  assertStatus(em, 200);
  assertEquals(em.body.value.fromName, 'Learn With Why');
  const sameVersion = await put('agreement', { text: 'A brand new agreement text that customers must accept.' });
  assertStatus(sameVersion, 400);
  assert(sameVersion.body.errors.version);
  const agr = await put('agreement', { version: '2026-11-01', text: 'A brand new agreement text that customers must accept.' });
  assertStatus(agr, 200);
  assertEquals(agr.body.value.version, '2026-11-01');

  // pricing → pricing.write
  assertStatus(await put('fees', { IN: { pct: 60 } }), 400);
  assertStatus(await put('fees', { EU: { pct: 1, fixed: 1 } }), 400);
  const fees = await put('fees', { INTL: { pct: 4 } });
  assertStatus(fees, 200);
  assertEquals(fees.body.value, { IN: { pct: 2, fixed: 3 }, INTL: { pct: 4, fixed: 0.3 } });
  assertStatus(await put('quote', { ttlMinutes: 2 }), 400);
  assertStatus(await put('currency_rates', { INR: 1, USD: -1 }), 400);
  const noUsd = await put('currency_rates', { INR: 1, EUR: 0.011 });
  assertStatus(noUsd, 400, 'countries still use USD, GBP, …');
  const countries = (await h.sql<{ value: Record<string, unknown>[] }[]>`select value from settings where key = 'countries'`)[0].value;
  const broken = countries.map((c) => (c.code === 'GB' ? { ...c, postal: { ...(c.postal as object), pattern: '([A-Z' } } : c));
  assertStatus(await put('countries', broken), 400);
  assertStatus(await put('countries', countries.filter((c) => c.code !== 'OTHER')), 400);
  assertStatus(await put('countries', countries.map((c) => (c.code === 'US' ? { ...c, methods: ['bitcoin'] } : c))), 400);
  const same = await put('countries', countries);
  assertStatus(same, 200);
  assertEquals((await auditRows('settings.update', 'countries')).length, 0, 'unchanged value → no write');
});

test('old PUT /api/admin/plans and /api/admin/rates', async () => {
  const p = await h.call('PUT', '/api/admin/plans', { token: admin.token, body: { m1: 249 } });
  assertStatus(p, 200);
  assertEquals(p.body.plans.m1, { label: '1 month', months: 1, price: 249 });
  assertEquals((await auditRows('plan.update', 'm1'))[0].detail, { before: { price_inr: 199 }, after: { price_inr: 249 } });
  assertStatus(await h.call('PUT', '/api/admin/plans', { token: admin.token, body: { m1: -1 } }), 400);
  assertStatus(await h.call('PUT', '/api/admin/plans', { token: admin.token, body: { m1: 'cheap' } }), 400);
  assertStatus(await h.call('PUT', '/api/admin/plans', { token: admin.token, body: { zz: 10 } }), 400);
  assertStatus(await h.call('PUT', '/api/admin/plans', { token: content.token, body: { m1: 10 } }), 403);
  const np = await h.call('PUT', '/api/admin/plans', { token: admin.token, body: { plans: [{ id: 'm1', price: 199, note: 'intro' }, { id: 'm2', label: '2 months', months: 2, price: 349, regions: ['IN'] }] } });
  assertStatus(np, 200);
  assertEquals(np.body.plans.m2, { label: '2 months', months: 2, price: 349 });
  assertEquals(np.body.planList.find((x: { id: string }) => x.id === 'm1').note, 'intro');

  const r = await h.call('PUT', '/api/admin/rates', { token: admin.token, body: { USD: 0.0125 } });
  assertStatus(r, 200);
  assertEquals([r.body.rates.USD, r.body.rates.INR, r.body.rates.EUR], [0.0125, 1, 0.011]);
  assertEquals((await auditRows('settings.update', 'currency_rates')).length, 1);
  assertStatus(await h.call('PUT', '/api/admin/rates', { token: admin.token, body: { USD: 0 } }), 400);
  assertStatus(await h.call('PUT', '/api/admin/rates', { token: admin.token, body: { usd: 1 } }), 400);
  assertStatus(await h.call('PUT', '/api/admin/rates', { token: admin.token, body: { USD: null } }), 400);
  assertStatus(await h.call('PUT', '/api/admin/rates', { token: content.token, body: { USD: 0.012 } }), 403);
  assertStatus(await h.call('PUT', '/api/admin/rates', { token: admin.token, body: { USD: 0.012 } }), 200);
});

test('every commerce write is audited with the acting staff member', async () => {
  const rows = await h.sql<{ action: string; actor_id: string | null; detail: Record<string, unknown> }[]>`
    select action, actor_id, detail from audit_logs
    where action in ('order.update', 'order.refund', 'entitlement.grant', 'entitlement.revoke', 'entitlement.extend',
                     'coupon.create', 'coupon.update', 'coupon.delete', 'coupon.deactivate', 'plan.update', 'plan.create',
                     'settings.update', 'class.update')`;
  const seen = new Set(rows.map((r) => r.action));
  for (const a of ['order.update', 'order.refund', 'entitlement.grant', 'entitlement.revoke', 'entitlement.extend', 'coupon.create', 'coupon.update', 'coupon.delete', 'coupon.deactivate', 'plan.update', 'plan.create', 'settings.update', 'class.update']) {
    assert(seen.has(a), `audit ${a}`);
  }
  const staffIds = new Set([admin.id, content.id]);
  assert(rows.every((r) => r.actor_id && staffIds.has(r.actor_id)), 'a staff member is named on each row');
  assert(rows.every((r) => 'before' in r.detail && 'after' in r.detail), 'before/after on each row');
});
