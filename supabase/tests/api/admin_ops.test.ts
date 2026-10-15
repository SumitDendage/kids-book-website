// Staff operations (routes/admin_ops.ts, services/analytics.ts, services/csv.ts): dashboard and
// analytics numbers from real rows (with an India/UTC day boundary), the email outbox (retry, skip
// and process through the mail capture), the audit log, staff notifications, CSV exports
// (permissions, formula escaping), the configuration backup (no secrets), developer health
// (names, never values), site text with its publish flag, FAQ answers (planned and staff answers
// never public) and review moderation (review_avg) — permissions and the audit trail throughout.
import {
  assert, assertEquals, assertMatch, assertStatus, startHarness, test, uniqueEmail,
  type CallResult, type Harness, type TestUser,
} from './harness.ts';
import { attachmentName, csvCell, parseCsv, toCsv } from '../../functions/api/services/csv.ts';
import { sanitizeHeadline } from '../../functions/api/routes/admin_ops.ts';

const h: Harness = await startHarness();
const owner = await h.staff('owner');
const admin = await h.staff('admin');
const support = await h.staff('support');
const content = await h.staff('content');
const developer = await h.staff('developer');

// deno-lint-ignore no-explicit-any
type Any = any;

const round2 = (n: number) => Math.round(n * 100) / 100;
/** YYYY-MM-DD of a moment in a time zone. */
const dayIn = (tz: string, at = new Date()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);

let seq = 0;
function orderId(): string {
  const tail = crypto.randomUUID().replace(/-/g, '').slice(0, 6).toUpperCase();
  return `LWO-G${(++seq).toString().padStart(3, '0')}${tail}`;
}

type RawOrder = {
  user: TestUser; totalInr: number; createdAt: string; paidAt?: string | null; refundedAt?: string | null;
  country?: string | null; productId?: string; plan?: { classId: string; planId: string; months: number };
};

/** An order written straight to the database with the given times (status follows the times). */
async function rawOrder(o: RawOrder): Promise<string> {
  const id = orderId();
  const status = o.refundedAt ? 'refunded' : o.paidAt ? 'paid' : 'created';
  await h.sql`
    insert into orders (id, user_id, kind, status, currency, rate, total, total_inr, amount_minor, lines, method, country,
                        created_at, paid_at, refunded_at)
    values (${id}, ${o.user.id}, ${o.plan ? 'class' : 'worksheet'}, ${status}, 'INR', 1, ${o.totalInr}, ${o.totalInr},
            ${Math.round(o.totalInr * 100)}, ${h.sql.json([])}, 'razorpay', ${o.country ?? null},
            ${o.createdAt}, ${o.paidAt ?? null}, ${o.refundedAt ?? null})`;
  if (o.plan) {
    await h.sql`
      insert into order_items (order_id, kind, class_id, plan_id, title, months, unit_price_inr)
      values (${id}, 'class', ${o.plan.classId}, ${o.plan.planId}, 'Kindergarten plan', ${o.plan.months}, ${Math.round(o.totalInr)})`;
  } else {
    const pid = o.productId ?? 'az-C';
    await h.sql`
      insert into order_items (order_id, kind, product_id, title, access_days, unit_price_inr)
      values (${id}, 'worksheet', ${pid}, ${'Sheet ' + pid}, 365, ${Math.round(o.totalInr)})`;
  }
  return id;
}

async function event(kind: string, at: string, visitor: string, o: { country?: string | null; device?: string; productId?: string } = {}) {
  await h.sql`
    insert into analytics_events (at, kind, source, visitor_id, product_id, country, device)
    values (${at}, ${kind}, 'client', ${visitor}, ${o.productId ?? null}, ${o.country ?? null}, ${o.device ?? 'desktop'})`;
}

async function auditRows(action: string, targetId?: string | number): Promise<Any[]> {
  const t = targetId == null ? null : String(targetId);
  return await h.sql<Any[]>`
    select actor_id, actor_email, actor_role, target_type, target_id, detail from audit_logs
    where action = ${action} and (${t}::text is null or target_id = ${t}::text)
    order by id`;
}

type OutboxRow = {
  to: string; template?: string; status?: string; sensitive?: boolean; attempts?: number; maxAttempts?: number;
  text?: string; html?: string; dueLater?: boolean; lockedMinutesAgo?: number; lastError?: string;
};

/** An email_outbox row as lib/mail.ts would leave it (sensitive rows never have bodies). */
async function outbox(o: OutboxRow): Promise<number> {
  const sensitive = o.sensitive ?? false;
  const status = o.status ?? 'queued';
  const r = await h.sql<{ id: number }[]>`
    insert into email_outbox (template, to_email, subject, body_html, body_text, sensitive, status, attempts, max_attempts,
                              next_attempt_at, locked_at, last_error, sent_at)
    values (${o.template ?? 'gtest'}, ${o.to}, ${'Test subject for ' + o.to}, ${sensitive ? null : (o.html ?? '<p>Hello</p>')},
            ${sensitive ? null : (o.text ?? 'Hello')}, ${sensitive}, ${status}, ${o.attempts ?? 0}, ${o.maxAttempts ?? 6},
            ${new Date(Date.now() + (o.dueLater ? 3_600_000 : -1_000))},
            ${o.lockedMinutesAgo == null ? null : new Date(Date.now() - o.lockedMinutesAgo * 60_000)},
            ${o.lastError ?? null}, ${status === 'sent' ? new Date() : null})
    returning id`;
  return r[0].id;
}

/** A CSV download as header + rows, with column lookup by name. */
function table(text: string) {
  const all = parseCsv(text);
  const header = all[0] ?? [];
  const col = (name: string) => {
    const i = header.indexOf(name);
    if (i < 0) throw new Error(`no column ${name} in ${header.join(',')}`);
    return i;
  };
  return { header, rows: all.slice(1), col };
}

// ── who may call ─────────────────────────────────────────────────────────────────────────

test('every route group: no token → 401, customer → 403 not_staff, staff without the permission → 403 forbidden', async () => {
  const c = await h.customer();
  const noDashboard = await h.staff('support', ['messages.read']);
  const catalogueOnly = await h.staff('content', ['catalogue.read']);
  const cases: [string, string, TestUser, string][] = [
    ['GET', '/api/admin/stats', noDashboard, 'dashboard.view'],
    ['GET', '/api/admin/analytics', support, 'analytics.read'],
    ['GET', '/api/admin/emails', content, 'emails.read'],
    ['POST', '/api/admin/emails/process', support, 'emails.write'],
    ['POST', '/api/admin/emails/1/retry', support, 'emails.write'],
    ['POST', '/api/admin/emails/1/skip', developer, 'emails.write'],
    ['GET', '/api/admin/audit', support, 'audit.read'],
    ['GET', '/api/admin/notifications', catalogueOnly, 'dashboard.view'],
    ['POST', '/api/admin/notifications/read', catalogueOnly, 'dashboard.view'],
    ['GET', '/api/admin/export/orders', support, 'exports.run'],
    ['GET', '/api/admin/backup', content, 'exports.run'],
    ['GET', '/api/admin/developer/health', support, 'developer.read'],
    ['GET', '/api/admin/content', support, 'content.write'],
    ['PUT', '/api/admin/content', developer, 'content.write'],
    ['GET', '/api/admin/faq', support, 'content.write'],
    ['POST', '/api/admin/faq', developer, 'content.write'],
    ['PUT', '/api/admin/faq/1', support, 'content.write'],
    ['DELETE', '/api/admin/faq/1', support, 'content.write'],
    ['GET', '/api/admin/reviews', support, 'reviews.moderate'],
    ['POST', '/api/admin/reviews/1/status', developer, 'reviews.moderate'],
  ];
  for (const [m, p, staff, perm] of cases) {
    const body = m === 'GET' || m === 'DELETE' ? undefined : {};
    const anon = await h.call(m, p, { body });
    assertStatus(anon, 401, `${m} ${p} anonymous`);
    assertEquals(anon.body.code, 'staff_signin');
    const cust = await h.call(m, p, { token: c.token, body });
    assertStatus(cust, 403, `${m} ${p} customer`);
    assertEquals(cust.body.code, 'not_staff');
    const denied = await h.call(m, p, { token: staff.token, body });
    assertStatus(denied, 403, `${m} ${p} without ${perm}`);
    assertEquals([denied.body.code, denied.body.permission], ['forbidden', perm], `${m} ${p}`);
  }
  // the roles that hold each read permission get through
  const allowed: [string, TestUser][] = [
    ['/api/admin/stats', support], ['/api/admin/analytics', content], ['/api/admin/emails', developer],
    ['/api/admin/audit', admin], ['/api/admin/notifications', content], ['/api/admin/developer/health', developer],
    ['/api/admin/content', content], ['/api/admin/faq', content], ['/api/admin/reviews', content],
  ];
  for (const [p, staff] of allowed) assertStatus(await h.call('GET', p, { token: staff.token }), 200, p);
});

// ── dashboard numbers ────────────────────────────────────────────────────────────────────

test('stats: the old fields from real rows, plus today and the last 14 days in the time zone', async () => {
  const before = await h.call('GET', '/api/admin/stats', { token: support.token });
  assertStatus(before, 200);
  for (const k of ['gateway', 'gateways', 'users', 'paid_orders', 'revenue_inr', 'active_entitlements', 'worksheets', 'with_pdf', 'opens_24h', 'messages', 'messages_unread']) {
    assert(k in before.body, `old field ${k}`);
  }
  assertEquals([before.body.tz, before.body.revenueByDay.length], ['Asia/Kolkata', 14]);

  const c = await h.customer();
  const now = new Date().toISOString();
  await rawOrder({ user: c, totalInr: 19, createdAt: now, paidAt: now, productId: 'az-F' });
  await rawOrder({ user: c, totalInr: 25.8, createdAt: now });                                     // not paid: no sale
  await rawOrder({ user: c, totalInr: 40, createdAt: now, paidAt: now, refundedAt: now, productId: 'az-G' }); // refunded
  await h.grant(c.id, { productId: 'az-H', days: 30 });
  await h.grant(c.id, { productId: 'az-I', days: -1 });                                            // expired: not active
  await h.sql`insert into contact_messages (name, email, body) values ('Stats Test', ${c.email}, 'A question about the sheets.')`;
  await h.sql`insert into reviews (product_id, user_id, rating) values ('az-F', ${c.id}, 4)`;
  await event('page_view', now, `vstats${Date.now().toString(36)}`);

  const after = await h.call('GET', '/api/admin/stats', { token: support.token });
  assertStatus(after, 200);
  const a = after.body, b = before.body;
  assertEquals(a.users - b.users, 1, 'one more customer (staff are not counted)');
  assertEquals([a.paid_orders - b.paid_orders, round2(a.revenue_inr - b.revenue_inr)], [1, 19]);
  assertEquals(a.active_entitlements - b.active_entitlements, 1);
  assertEquals([a.messages - b.messages, a.messages_unread - b.messages_unread], [1, 1]);
  assertEquals(a.pendingOrders - b.pendingOrders, 1);
  assertEquals([a.refundedOrders - b.refundedOrders, round2(a.refundedInr - b.refundedInr)], [1, 40]);
  assertEquals(a.pendingReviews - b.pendingReviews, 1);
  // today: both paid orders were paid today (one later refunded, so it is not revenue)
  assertEquals([a.today.paidOrders - b.today.paidOrders, round2(a.today.revenueInr - b.today.revenueInr)], [2, 19]);
  assertEquals(a.today.visitors - b.today.visitors, 1);
  assertEquals(a.today.start, new Date(`${dayIn('Asia/Kolkata')}T00:00:00+05:30`).getTime());
  const lastA = a.revenueByDay.at(-1), lastB = b.revenueByDay.at(-1);
  assertEquals(lastA.day, dayIn('Asia/Kolkata'));
  assertEquals([lastA.paidOrders - lastB.paidOrders, round2(lastA.revenueInr - lastB.revenueInr)], [2, 19]);

  const utc = await h.call('GET', '/api/admin/stats?tz=UTC', { token: support.token });
  assertEquals([utc.body.tz, utc.body.revenueByDay.at(-1).day], ['UTC', dayIn('UTC')]);
  const bad = await h.call('GET', '/api/admin/stats?tz=Mars/Olympus', { token: support.token });
  assertStatus(bad, 400);
  assertEquals(bad.body.code, 'bad_range');
});

// ── analytics ────────────────────────────────────────────────────────────────────────────

test('analytics: real rows only; days in the time zone (IST vs UTC boundary); products, plans, countries, conversion', async () => {
  const c1 = await h.customer(), c2 = await h.customer(), signup = await h.customer();
  const staffSignup = await h.staff('support');
  await h.sql`update profiles set created_at = '2025-03-01T18:45:00Z' where id = ${signup.id}`;     // 2 March in India, 1 March in UTC
  await h.sql`update profiles set created_at = '2025-03-01T12:00:00Z' where id = ${staffSignup.id}`; // staff are never sign-ups
  // visitors a–d, a bot, and one visitor just outside each end of the India range
  await event('page_view', '2025-03-01T10:00:00Z', 'visitor_a_01', { country: 'IN' });
  await event('product_view', '2025-03-01T10:05:00Z', 'visitor_a_01', { country: 'IN', productId: 'az-C' });
  await event('checkout_start', '2025-03-01T10:06:00Z', 'visitor_a_01', { country: 'IN' });
  await event('page_view', '2025-03-01T19:00:00Z', 'visitor_b_01', { country: 'US', device: 'mobile' });     // 00:30 on 2 March in India
  await event('checkout_start', '2025-03-01T19:10:00Z', 'visitor_b_01', { country: 'US', device: 'mobile' });
  await event('page_view', '2025-03-02T03:00:00Z', 'visitor_c_01', { country: 'IN', device: 'mobile' });
  await event('checkout_start', '2025-03-02T03:05:00Z', 'visitor_c_01', { country: 'IN', device: 'mobile' });
  await event('page_view', '2025-03-02T17:00:00Z', 'visitor_d_01', { country: 'IN' });                       // 22:30 on 2 March in India
  await event('checkout_start', '2025-03-02T17:05:00Z', 'visitor_d_01', { country: 'IN' });
  await event('page_view', '2025-03-01T12:00:00Z', 'visitor_bot_1', { device: 'bot' });
  await event('page_view', '2025-02-28T18:00:00Z', 'visitor_e_01', { country: 'IN' });                       // 23:30 on 28 Feb in India
  await event('page_view', '2025-03-02T19:00:00Z', 'visitor_f_01', { country: 'IN' });                       // 00:30 on 3 March in India
  // A paid (1 Mar), B plan paid at 01:30 on 2 March in India, C never paid, D paid then refunded, E paid on 3 March in India
  await rawOrder({ user: c1, totalInr: 19, createdAt: '2025-03-01T09:00:00Z', paidAt: '2025-03-01T09:05:00Z', country: 'IN', productId: 'az-C' });
  await rawOrder({ user: c2, totalInr: 199, createdAt: '2025-03-01T20:00:00Z', paidAt: '2025-03-01T20:00:30Z', country: 'US', plan: { classId: 'kg', planId: 'm1', months: 1 } });
  await rawOrder({ user: c1, totalInr: 19, createdAt: '2025-03-01T21:00:00Z', country: 'IN', productId: 'az-D' });
  await rawOrder({ user: c1, totalInr: 25.8, createdAt: '2025-03-01T08:00:00Z', paidAt: '2025-03-01T08:01:00Z', refundedAt: '2025-03-02T05:00:00Z', country: 'IN', productId: 'az-E' });
  await rawOrder({ user: c2, totalInr: 50, createdAt: '2025-03-02T19:00:00Z', paidAt: '2025-03-02T19:01:00Z', country: 'IN', productId: 'az-C' });

  const ist = await h.call('GET', '/api/admin/analytics?from=2025-03-01&to=2025-03-02&tz=Asia/Kolkata', { token: content.token });
  assertStatus(ist, 200);
  const r = ist.body;
  assertEquals([r.range.tz, r.range.days, r.range.firstDay, r.range.lastDay], ['Asia/Kolkata', 2, '2025-03-01', '2025-03-02']);
  assertEquals([r.range.fromIso, r.range.toIso], ['2025-02-28T18:30:00.000Z', '2025-03-02T18:30:00.000Z']);
  const t = r.totals;
  assertEquals([t.visitors, t.pageViews, t.productViews, t.checkoutStarts, t.checkoutVisitors, t.botEvents], [4, 4, 1, 4, 4, 1]);
  assertEquals([t.ordersCreated, t.paidOrders, t.buyers, t.revenueInr, t.grossRevenueInr, t.refunds, t.refundedInr], [4, 3, 2, 218, 243.8, 1, 25.8]);
  assertEquals([t.signups, t.averageOrderInr], [1, 81.27]);
  assertEquals(r.conversion, { visitorsPct: 75, checkoutsPct: 75, signupsPct: 25 });
  assertEquals(r.byDay.map((d: Any) => d.day), ['2025-03-01', '2025-03-02']);
  const [d1, d2] = r.byDay;
  assertEquals([d1.visitors, d1.pageViews, d1.productViews, d1.checkoutStarts, d1.signups], [1, 1, 1, 1, 0]);
  assertEquals([d1.ordersCreated, d1.paidOrders, d1.revenueInr, d1.grossRevenueInr, d1.refunds], [2, 2, 19, 44.8, 0]);
  assertEquals([d2.visitors, d2.pageViews, d2.checkoutStarts, d2.signups], [3, 3, 3, 1]);
  assertEquals([d2.ordersCreated, d2.paidOrders, d2.revenueInr, d2.grossRevenueInr, d2.refunds], [2, 1, 199, 199, 1]);
  assertEquals(r.topProducts, [{ id: 'az-C', title: 'Sheet az-C', units: 1, revenueInr: 19, buyers: 1, views: 1 }]);
  assertEquals(r.topPlans, [{ cls: 'kg', plan: 'm1', units: 1, revenueInr: 199 }]);
  assertEquals(r.mostViewed.map((p: Any) => [p.id, p.views, p.visitors]), [['az-C', 1, 1]]);
  assertEquals(r.byCountry, [
    { country: 'US', visitors: 1, paidOrders: 1, revenueInr: 199 },
    { country: 'IN', visitors: 3, paidOrders: 1, revenueInr: 19 },
  ]);
  assertEquals(r.devices, [{ device: 'desktop', visitors: 2 }, { device: 'mobile', visitors: 2 }]);
  assertEquals(r.referrers, [{ host: 'direct', visitors: 4, pageViews: 4 }]);
  assertEquals([r.hasData, r.note], [true, null]);

  // the same two dates in UTC: B, the late visitors and the sign-up move to 1 March; E and f come in
  const utc = await h.call('GET', '/api/admin/analytics?from=2025-03-01&to=2025-03-02&tz=UTC', { token: content.token });
  assertStatus(utc, 200);
  const u = utc.body;
  assertEquals([u.range.fromIso, u.range.toIso], ['2025-03-01T00:00:00.000Z', '2025-03-03T00:00:00.000Z']);
  assertEquals([u.totals.visitors, u.totals.pageViews, u.totals.checkoutStarts], [5, 5, 4]);
  assertEquals([u.totals.ordersCreated, u.totals.paidOrders, u.totals.revenueInr, u.totals.refunds, u.totals.signups], [5, 4, 268, 1, 1]);
  const [u1, u2] = u.byDay;
  assertEquals([u1.day, u1.visitors, u1.checkoutStarts, u1.ordersCreated, u1.paidOrders, u1.revenueInr, u1.signups, u1.refunds], ['2025-03-01', 2, 2, 4, 3, 218, 1, 0]);
  assertEquals([u2.day, u2.visitors, u2.checkoutStarts, u2.ordersCreated, u2.paidOrders, u2.revenueInr, u2.signups, u2.refunds], ['2025-03-02', 3, 2, 1, 1, 50, 0, 1]);
  assertEquals(u.topProducts.map((p: Any) => [p.id, p.units, p.revenueInr, p.buyers]), [['az-C', 2, 69, 2]]);

  // exact instants: the end is exclusive
  const morning = await h.call('GET', '/api/admin/analytics?from=2025-03-01T00:00:00Z&to=2025-03-01T12:00:00Z', { token: content.token });
  assertStatus(morning, 200);
  assertEquals([morning.body.totals.visitors, morning.body.totals.botEvents, morning.body.totals.paidOrders, morning.body.range.days], [1, 0, 2, 1]);
});

test('analytics: bad ranges and zones are refused; an empty period says so; default is the last 30 days', async () => {
  const cases = [
    'tz=Mars/Olympus', `tz=${encodeURIComponent('Not a zone')}`, 'from=2025-02-30', 'from=yesterday', 'from=1999-12-31',
    'from=2025-03-05&to=2025-03-01', 'from=2024-01-01&to=2025-06-01', 'days=0', 'days=400', 'days=abc',
    'from=2025-03-01T10:00:00',
  ];
  for (const qs of cases) {
    const r = await h.call('GET', `/api/admin/analytics?${qs}`, { token: content.token });
    assertStatus(r, 400, qs);
    assertEquals(r.body.code, 'bad_range', qs);
    assert(r.body.errors && typeof r.body.error === 'string', qs);
  }
  const empty = await h.call('GET', '/api/admin/analytics?from=2024-01-01&to=2024-01-31&tz=UTC', { token: content.token });
  assertStatus(empty, 200);
  assertEquals([empty.body.hasData, empty.body.note, empty.body.totals.visitors, empty.body.totals.revenueInr, empty.body.byDay.length],
    [false, 'No data for this period yet.', 0, 0, 31]);
  assertEquals(empty.body.conversion, { visitorsPct: null, checkoutsPct: null, signupsPct: null });
  assertEquals([empty.body.totals.averageOrderInr, empty.body.topProducts, empty.body.byCountry], [null, [], []]);
  const def = await h.call('GET', '/api/admin/analytics', { token: content.token });
  assertEquals([def.body.range.tz, def.body.range.days, def.body.range.lastDay], ['Asia/Kolkata', 30, dayIn('Asia/Kolkata')]);
  const week = await h.call('GET', '/api/admin/analytics?days=7&tz=UTC', { token: content.token });
  assertEquals([week.body.range.days, week.body.byDay.length, week.body.range.lastDay], [7, 7, dayIn('UTC')]);
  const leapYear = await h.call('GET', '/api/admin/analytics?from=2024-01-01&to=2024-12-31&tz=UTC', { token: content.token });
  assertStatus(leapYear, 200, '366 days is the longest range');
  assertEquals(leapYear.body.range.days, 366);
});

// ── the email outbox ─────────────────────────────────────────────────────────────────────

test('emails: the list never carries a body; filters, counts and paging', async () => {
  const to1 = uniqueEmail('mail-list'), to2 = uniqueEmail('mail-list');
  const sent = await outbox({ to: to1, template: 'gtest_list', status: 'sent', attempts: 1, text: 'LIST-BODY-MARKER text', html: '<p>LIST-BODY-MARKER</p>' });
  const secret = await outbox({ to: to2, template: 'gtest_list', status: 'sent', attempts: 1, sensitive: true });
  const gaveUp = await outbox({ to: to2, template: 'gtest_list', status: 'failed', attempts: 6, maxAttempts: 6, lastError: '503 test: temporary failure', text: 'LIST-BODY-MARKER again' });
  const r = await h.call('GET', '/api/admin/emails?template=gtest_list', { token: support.token });
  assertStatus(r, 200);
  assert(!r.text.includes('LIST-BODY-MARKER'), 'no body in the list');
  assertEquals(r.body.emails.map((e: Any) => e.id), [gaveUp, secret, sent]);
  for (const e of r.body.emails) for (const k of Object.keys(e)) assert(!/body|html|text/i.test(k), `no body field (${k})`);
  const g = r.body.emails[0];
  assertEquals([g.status, g.gaveUp, g.attempts, g.maxAttempts, g.lastError, g.canRetry, g.canSkip, g.to, g.template, g.nextAttemptAt],
    ['failed', true, 6, 6, '503 test: temporary failure', true, true, to2, 'gtest_list', null]);
  assertEquals(g.subject, `Test subject for ${to2}`);
  const s = r.body.emails[1];
  assertEquals([s.sensitive, s.status, s.canRetry, s.canSkip], [true, 'sent', false, false]);
  assertEquals(r.body.total, 3);
  for (const k of ['queued', 'sending', 'sent', 'failed', 'skipped', 'gaveUp', 'waiting', 'due', 'total']) assert(typeof r.body.counts[k] === 'number', k);
  assertEquals(r.body.mail, 'brevo');
  const ids = async (qs: string) => (await h.call('GET', `/api/admin/emails?${qs}`, { token: support.token })).body.emails.map((e: Any) => e.id);
  assertEquals(await ids('template=gtest_list&status=sent'), [secret, sent]);
  assertEquals(await ids('template=gtest_list&status=gave_up'), [gaveUp]);
  assertEquals(await ids('template=gtest_list&status=due'), []);
  assertEquals(await ids('template=gtest_list&sensitive=true'), [secret]);
  assertEquals(await ids(`q=${encodeURIComponent(to1)}`), [sent]);
  const waiting = await outbox({ to: to1, template: 'gtest_wait', dueLater: true });
  assertEquals(await ids('template=gtest_wait&status=waiting'), [waiting]);
  assertEquals(await ids('template=gtest_wait&status=due'), [], 'not due for another hour');
  await h.sql`update email_outbox set status = 'skipped' where id = ${waiting}`;
  const page = await h.call('GET', '/api/admin/emails?template=gtest_list&limit=2', { token: support.token });
  assertEquals([page.body.emails.length, page.body.total, page.body.nextOffset], [2, 3, 2]);
  const page2 = await h.call('GET', '/api/admin/emails?template=gtest_list&limit=2&offset=2', { token: support.token });
  assertEquals([page2.body.emails.map((e: Any) => e.id), page2.body.nextOffset], [[sent], null]);
  for (const qs of ['status=bounced', 'template=Bad-Name', 'sensitive=maybe']) {
    assertStatus(await h.call('GET', `/api/admin/emails?${qs}`, { token: support.token }), 400, qs);
  }
});

test('emails: retry sends a failed email again through the mail capture (audited); sensitive, sent and busy ones are refused', async () => {
  await h.processOutbox(); // nothing else due
  const to = uniqueEmail('mail-retry');
  const id = await outbox({ to, status: 'failed', attempts: 6, maxAttempts: 6, lastError: '503 test', text: 'RETRY-MARKER body', html: '<p>RETRY-MARKER</p>' });
  await h.processOutbox();
  assertEquals(h.mail.to(to).length, 0, 'an email that gave up is not sent by the sweep');
  const r = await h.call('POST', `/api/admin/emails/${id}/retry`, { token: admin.token });
  assertStatus(r, 200);
  assertEquals([r.body.ok, r.body.queued, r.body.email.id, r.body.email.status, r.body.email.maxAttempts], [true, true, id, 'queued', 9]);
  // sent right after the answer, outside the transaction
  const mails = h.mail.to(to);
  assertEquals(mails.length, 1);
  assertMatch(mails[0].text, /RETRY-MARKER/);
  const row = (await h.sql<Any[]>`select status, attempts, last_error from email_outbox where id = ${id}`)[0];
  assertEquals([row.status, row.attempts, row.last_error], ['sent', 7, null]);
  const au = await auditRows('email.retry', id);
  assertEquals(au.length, 1);
  assertEquals([au[0].actor_id, au[0].actor_role, au[0].target_type, au[0].detail.before.status, au[0].detail.after.status, au[0].detail.to],
    [admin.id, 'admin', 'email', 'failed', 'queued', to]);

  const again = await h.call('POST', `/api/admin/emails/${id}/retry`, { token: admin.token });
  assertStatus(again, 409);
  assertEquals(again.body.code, 'already_sent');
  const sens = await outbox({ to, status: 'failed', attempts: 1, maxAttempts: 1, sensitive: true });
  const rs = await h.call('POST', `/api/admin/emails/${sens}/retry`, { token: admin.token });
  assertStatus(rs, 409);
  assertEquals(rs.body.code, 'sensitive');
  const busy = await outbox({ to, status: 'sending', attempts: 0, lockedMinutesAgo: 1 });
  const rb = await h.call('POST', `/api/admin/emails/${busy}/retry`, { token: admin.token });
  assertEquals([rb.status, rb.body.code], [409, 'sending']);
  const tired = await outbox({ to, status: 'failed', attempts: 20, maxAttempts: 20 });
  const rt = await h.call('POST', `/api/admin/emails/${tired}/retry`, { token: admin.token });
  assertEquals([rt.status, rt.body.code], [409, 'too_many_attempts']);
  for (const x of [sens, busy, tired]) assertEquals((await auditRows('email.retry', x)).length, 0, 'refusals are not audited');
  for (const bad of ['999999999', 'abc', '0', '1e3']) {
    const nf = await h.call('POST', `/api/admin/emails/${bad}/retry`, { token: admin.token });
    assertStatus(nf, 404, bad);
    assertEquals(nf.body.error, 'No such email.');
  }
  // a send stuck in 'sending' for over 10 minutes may be retried
  const stuck = await outbox({ to, status: 'sending', attempts: 1, lockedMinutesAgo: 30, text: 'STUCK-MARKER' });
  assertStatus(await h.call('POST', `/api/admin/emails/${stuck}/retry`, { token: admin.token }), 200);
  assertEquals(h.mail.to(to).map((m) => m.text), ['RETRY-MARKER body', 'STUCK-MARKER']);
  await h.sql`update email_outbox set status = 'skipped', locked_at = null where id in (${busy}, ${tired})`;
});

test('emails: skip stops a queued email (audited, with the reason); a skipped email can be retried', async () => {
  await h.processOutbox();
  const to = uniqueEmail('mail-skip');
  const id = await outbox({ to, status: 'queued', dueLater: true, text: 'SKIP-MARKER' });
  const r = await h.call('POST', `/api/admin/emails/${id}/skip`, { token: admin.token, body: { reason: 'The customer asked us not to send it.' } });
  assertStatus(r, 200);
  assertEquals([r.body.ok, r.body.changed, r.body.email.status, r.body.email.canRetry, r.body.email.canSkip], [true, true, 'skipped', true, false]);
  await h.sql`update email_outbox set next_attempt_at = now() - interval '1 minute' where id = ${id}`;
  await h.processOutbox();
  assertEquals(h.mail.to(to).length, 0, 'a skipped email is never sent');
  const au = await auditRows('email.skip', id);
  assertEquals([au.length, au[0].actor_id, au[0].detail.reason, au[0].detail.before.status, au[0].detail.after.status],
    [1, admin.id, 'The customer asked us not to send it.', 'queued', 'skipped']);
  const twice = await h.call('POST', `/api/admin/emails/${id}/skip`, { token: admin.token });
  assertEquals([twice.status, twice.body.changed], [200, false]);
  assertEquals((await auditRows('email.skip', id)).length, 1, 'no change, no audit row');
  assertStatus(await h.call('POST', `/api/admin/emails/${id}/skip`, { token: admin.token, body: { reason: 42 } }), 400);
  const sent = await outbox({ to, status: 'sent', attempts: 1 });
  const rs = await h.call('POST', `/api/admin/emails/${sent}/skip`, { token: admin.token });
  assertEquals([rs.status, rs.body.code], [409, 'already_sent']);
  // a change of mind: retry the skipped email
  assertStatus(await h.call('POST', `/api/admin/emails/${id}/retry`, { token: admin.token }), 200);
  assertEquals(h.mail.to(to).map((m) => m.text), ['SKIP-MARKER']);
});

test('emails: process sends what is due now and reports failures (audited); it needs email set up', async () => {
  await h.processOutbox();
  const to = uniqueEmail('mail-process');
  const a = await outbox({ to, text: 'PROCESS-A' });
  const b = await outbox({ to, text: 'PROCESS-B' });
  const later = await outbox({ to, dueLater: true, text: 'PROCESS-LATER' });
  h.mail.failNext(1); // the first send fails for a while
  const r = await h.call('POST', '/api/admin/emails/process', { token: admin.token, body: { limit: 5 } });
  assertStatus(r, 200);
  assertEquals([r.body.ok, r.body.sent, r.body.failed, r.body.processed, r.body.stoppedEarly], [true, 1, 1, 2, false]);
  assert(typeof r.body.counts.waiting === 'number');
  // which of the two takes the injected failure depends on the claim order (UPDATE … RETURNING)
  const rows = await h.sql<Any[]>`select id, status, attempts, last_error, body_text from email_outbox where id in (${a}, ${b}, ${later})`;
  const st = Object.fromEntries(rows.map((x) => [x.id, x]));
  assertEquals([st[a].status, st[b].status].sort(), ['failed', 'sent']);
  assertEquals([st[a].attempts, st[b].attempts, st[later].status, st[later].attempts], [1, 1, 'queued', 0]);
  const failedRow = st[a].status === 'failed' ? st[a] : st[b];
  const sentRow = failedRow === st[a] ? st[b] : st[a];
  assertMatch(failedRow.last_error, /temporary/);
  assertEquals(h.mail.to(to).map((m) => m.text), [sentRow.body_text]);
  const au = (await auditRows('email.process')).at(-1);
  assertEquals([au.actor_id, au.target_type, au.detail.sent, au.detail.failed, au.detail.limit, au.detail.stoppedEarly], [admin.id, 'email_outbox', 1, 1, 5, false]);
  for (const limit of [26, 0, 'lots', 2.5]) {
    assertStatus(await h.call('POST', '/api/admin/emails/process', { token: admin.token, body: { limit } }), 400, String(limit));
  }
  // the failed one goes out when retried by hand
  assertStatus(await h.call('POST', `/api/admin/emails/${failedRow.id}/retry`, { token: admin.token }), 200);
  assertEquals(h.mail.to(to).map((m) => m.text).sort(), ['PROCESS-A', 'PROCESS-B']);
  // limit is respected; the rest waits for the next run
  const to3 = uniqueEmail('mail-process');
  const three = [await outbox({ to: to3, text: 'P1' }), await outbox({ to: to3, text: 'P2' }), await outbox({ to: to3, text: 'P3' })];
  const two = await h.call('POST', '/api/admin/emails/process', { token: admin.token, body: { limit: 2 } });
  assertEquals([two.body.sent, two.body.failed, h.mail.to(to3).length], [2, 0, 2]);
  const left = await h.sql<Any[]>`select id from email_outbox where id = any(${three}::bigint[]) and status = 'queued'`;
  assertEquals(left.length, 1);
  const rest = await h.call('POST', '/api/admin/emails/process', { token: admin.token, body: {} });
  assertEquals([rest.body.sent, rest.body.processed, h.mail.to(to3).length], [1, 1, 3]);
  const idle = await h.call('POST', '/api/admin/emails/process', { token: admin.token });
  assertEquals([idle.status, idle.body.processed], [200, 0]);
  // without an email provider nothing is sent and the answer says why
  h.mail.off();
  h.setEnv({ BREVO_API_KEY: undefined, RESEND_API_KEY: undefined });
  try {
    const off = await h.call('POST', '/api/admin/emails/process', { token: admin.token, body: {} });
    assertStatus(off, 503);
    assertEquals(off.body.code, 'mail_unavailable');
  } finally {
    h.mail.on();
    h.resetEnv();
  }
  await h.sql`update email_outbox set status = 'skipped' where id = ${later}`;
});

// ── audit log ────────────────────────────────────────────────────────────────────────────

test('audit: filters by action, group, actor, system, target and dates; pages; refuses bad filters', async () => {
  const f1 = await h.call('POST', '/api/admin/faq', { token: admin.token, body: { question: 'Audit filter question one?', answer: 'One.', status: 'draft' } });
  const f2 = await h.call('POST', '/api/admin/faq', { token: admin.token, body: { question: 'Audit filter question two?', answer: 'Two.', status: 'draft' } });
  assertStatus(f1, 201);
  const id1 = f1.body.faq.id, id2 = f2.body.faq.id;
  assertStatus(await h.call('PUT', `/api/admin/faq/${id1}`, { token: content.token, body: { answer: 'One, changed.' } }), 200);
  await h.sql`insert into audit_logs (action, target_type, target_id, detail) values ('housekeeping.run', 'job', 'gtest', '{"rows":3}'::jsonb)`;
  const get = (qs: string) => h.call('GET', `/api/admin/audit?${qs}`, { token: owner.token });

  const byTarget = await get(`targetType=faq&targetId=${id1}`);
  assertStatus(byTarget, 200);
  assertEquals(byTarget.body.audit.map((a: Any) => a.action), ['faq.update', 'faq.create']);
  const row = byTarget.body.audit[0];
  assertEquals([row.actor, row.actorId, row.role, row.targetType, row.targetId], [content.email, content.id, 'content', 'faq', String(id1)]);
  assert(typeof row.at === 'number' && typeof row.id === 'number' && typeof row.ip === 'string');
  assertEquals(row.detail, { before: { answer: 'One.' }, after: { answer: 'One, changed.' } });
  const exact = await get(`action=faq.create&actor=${encodeURIComponent(admin.email.toUpperCase())}`);
  assert(exact.body.audit.length >= 2 && exact.body.audit.every((a: Any) => a.action === 'faq.create' && a.actor === admin.email));
  const group = await get(`action=faq.*&actor=${content.id}`);
  assert(group.body.audit.length >= 1 && group.body.audit.every((a: Any) => a.action.startsWith('faq.') && a.actorId === content.id));
  const sys = await get('actor=system&action=housekeeping.run');
  assertEquals(sys.body.audit.map((a: Any) => [a.actor, a.actorId, a.targetId]), [['system', null, 'gtest']]);
  const page = await get(`action=faq.create&actor=${encodeURIComponent(admin.email)}&limit=1`);
  assertEquals([page.body.audit.length, page.body.limit, page.body.offset, page.body.nextOffset], [1, 1, 0, 1]);
  assertEquals(page.body.audit[0].targetId, String(id2), 'newest first');
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  assertEquals((await get(`targetType=faq&targetId=${id1}&from=${tomorrow}&tz=UTC`)).body.total, 0);
  assertEquals((await get(`targetType=faq&targetId=${id1}&to=${dayIn('UTC')}&tz=UTC`)).body.total, 2);
  assert((await get('q=housekeeping')).body.audit.some((a: Any) => a.targetId === 'gtest'));
  for (const qs of ['action=DROP%20TABLE', 'actor=nobody', 'targetType=Bad-Type', 'from=yesterday', 'tz=Mars%2FOlympus']) {
    assertStatus(await get(qs), 400, qs);
  }
});

// ── staff notifications ──────────────────────────────────────────────────────────────────

test('notifications: staff see the kinds their permissions cover; read marks only what they can see (audited)', async () => {
  const ins = async (kind: string, o: { userId?: string; audience?: string } = {}) => (await h.sql<{ id: number }[]>`
    insert into notifications (audience, user_id, kind, title, body, link, data)
    values (${o.audience ?? 'staff'}, ${o.userId ?? null}, ${kind}, ${'Note ' + kind}, 'Body', '/admin', '{"x":1}'::jsonb)
    returning id`)[0].id;
  const c = await h.customer();
  const order = await ins('order.paid');
  const contact = await ins('contact.new');
  const incident = await ins('security.incident');
  const general = await ins('system.notice');
  const staffOnly = await ins('staff.added');
  const review = await ins('review.pending');
  const forAdmin = await ins('system.notice', { userId: admin.id });
  const customerNote = await ins('order.paid', { audience: 'customer', userId: c.id });
  const mine = [order, contact, incident, general, staffOnly, review, forAdmin, customerNote];
  const sorted = (xs: number[]) => [...xs].sort((x, y) => x - y);
  const ids = (r: CallResult): number[] => r.body.notifications.map((n: Any) => n.id);
  const seen = async (u: TestUser) => {
    const r = await h.call('GET', '/api/admin/notifications?limit=200', { token: u.token });
    assertStatus(r, 200);
    return sorted(ids(r).filter((id) => mine.includes(id)));
  };
  assertEquals(await seen(support), sorted([order, contact, incident, general]));
  assertEquals(await seen(content), sorted([general, review]));
  assertEquals(await seen(admin), sorted([order, contact, incident, general, staffOnly, review, forAdmin]));
  const list = await h.call('GET', '/api/admin/notifications?limit=200', { token: support.token });
  const n = list.body.notifications.find((x: Any) => x.id === order);
  assertEquals([n.kind, n.title, n.body, n.link, n.data, n.read, n.readAt], ['order.paid', 'Note order.paid', 'Body', '/admin', { x: 1 }, false, null]);
  assert(typeof n.createdAt === 'number' && typeof list.body.unread === 'number' && typeof list.body.total === 'number');

  // support marks two read, one of which they cannot see
  const r = await h.call('POST', '/api/admin/notifications/read', { token: support.token, body: { ids: [order, staffOnly] } });
  assertStatus(r, 200);
  assertEquals(r.body, { ok: true, updated: 1 });
  const states = async () => Object.fromEntries((await h.sql<Any[]>`
    select id, read_at is not null as read from notifications where id = any(${mine}::bigint[])`).map((x) => [x.id, x.read]));
  let s = await states();
  assertEquals([s[order], s[staffOnly]], [true, false]);
  const au = await auditRows('notification.read', order);
  assertEquals([au.length, au[0].actor_id, au[0].detail.count, au[0].detail.ids], [1, support.id, 1, [order]]);
  // again: nothing changes, nothing is audited
  assertEquals((await h.call('POST', '/api/admin/notifications/read', { token: support.token, body: { id: order } })).body.updated, 0);
  assertEquals((await auditRows('notification.read', order)).length, 1);
  const unread = await h.call('GET', '/api/admin/notifications?unread=1&limit=200', { token: support.token });
  assert(!ids(unread).includes(order) && ids(unread).includes(contact));
  // "mark all read" for the content editor touches only what they can see
  const all = await h.call('POST', '/api/admin/notifications/read', { token: content.token, body: { all: true } });
  assertStatus(all, 200);
  assert(all.body.updated >= 2);
  s = await states();
  assertEquals([s[general], s[review], s[contact], s[incident], s[staffOnly], s[forAdmin], s[customerNote]], [true, true, false, false, false, false, false]);
  const tooMany = Array.from({ length: 201 }, (_, i) => i + 1);
  for (const body of [{}, { ids: [] }, { ids: ['x'] }, { ids: [1.5] }, { ids: tooMany }, { all: 'yes' }]) {
    assertStatus(await h.call('POST', '/api/admin/notifications/read', { token: support.token, body }), 400, JSON.stringify(body).slice(0, 40));
  }
  assertStatus(await h.call('GET', '/api/admin/notifications?unread=maybe', { token: support.token }), 400);
});

// ── CSV exports ──────────────────────────────────────────────────────────────────────────

test('exports: need exports.run and the permission for that data; CSV attachment with formulas defused; audited', async () => {
  const exporter = await h.staff('support', ['exports.run', 'messages.read']);
  const no = await h.call('GET', '/api/admin/export/messages', { token: support.token });
  assertStatus(no, 403);
  assertEquals([no.body.code, no.body.permission], ['forbidden', 'exports.run']);
  const noOrders = await h.call('GET', '/api/admin/export/orders', { token: exporter.token });
  assertStatus(noOrders, 403);
  assertEquals([noOrders.body.code, noOrders.body.permission], ['forbidden', 'orders.read']);
  for (const kind of ['customers', 'payments', 'entitlements', 'coupons', 'audit']) {
    assertStatus(await h.call('GET', `/api/admin/export/${kind}`, { token: exporter.token }), 403, kind);
  }
  assertEquals((await auditRows('export.run')).filter((a) => a.actor_id === exporter.id).length, 0, 'refusals are not audited');
  // the same permission that shows the data on screen: payments are also visible with logs.read
  const logReader = await h.staff('developer', ['exports.run', 'logs.read']);
  assertStatus(await h.call('GET', '/api/admin/export/payments', { token: logReader.token }), 200);
  assertEquals((await h.call('GET', '/api/admin/export/orders', { token: logReader.token })).body.permission, 'orders.read');

  const email = uniqueEmail('formula');
  await h.sql`
    insert into contact_messages (name, email, body) values
      (${'=HYPERLINK("http://evil.test","click")'}, ${email}, ${'+SUM(A1:A9) please call me back'}),
      (${'@ME'}, ${email}, ${'-2+3 is what my child wrote'}),
      (${'＝1+1 wide'}, ${email}, ${'  =1+2 after two spaces'}),
      (${'Plain, "quoted" name'}, ${email}, ${'Line one\nline two of the message'})`;
  const r = await h.call('GET', '/api/admin/export/messages?status=new', { token: exporter.token });
  assertStatus(r, 200);
  assertEquals(r.headers.get('content-type'), 'text/csv; charset=utf-8');
  assertEquals(r.headers.get('content-disposition'), `attachment; filename="lww-messages-${new Date().toISOString().slice(0, 10)}.csv"`);
  assertMatch(r.headers.get('cache-control') ?? '', /no-store/);
  assertEquals([...r.bytes.slice(0, 3)], [0xef, 0xbb, 0xbf], 'UTF-8 byte-order mark for Excel');
  assert(r.text.includes(`"'=HYPERLINK(""http://evil.test"",""click"")"`), 'quoted and defused in the file itself');
  const t = table(r.text);
  assertEquals(t.header.slice(0, 5), ['message_id', 'created_at', 'name', 'email', 'status']);
  assertEquals(t.rows.length, Number(r.headers.get('x-row-count')));
  const mine = t.rows.filter((x) => x[t.col('email')] === email);
  assertEquals(mine.length, 4);
  const cells = (col: string) => mine.map((x) => x[t.col(col)]).sort();
  assertEquals(cells('name'), [`'=HYPERLINK("http://evil.test","click")`, "'@ME", "'＝1+1 wide", 'Plain, "quoted" name'].sort());
  assertEquals(cells('message'), [`'  =1+2 after two spaces`, "'+SUM(A1:A9) please call me back", "'-2+3 is what my child wrote", 'Line one\nline two of the message'].sort());
  for (const row of t.rows) for (const cell of row) assert(!/^[\s]*[=+\-@＝＋－＠]/.test(cell), `cell ${JSON.stringify(cell)} would run as a formula`);
  const au = (await auditRows('export.run', 'messages')).filter((a) => a.actor_id === exporter.id);
  assertEquals(au.length, 1);
  assertEquals([au[0].target_type, au[0].detail.kind, au[0].detail.rows, au[0].detail.truncated, au[0].detail.filters.status],
    ['export', 'messages', t.rows.length, false, 'new']);

  assertStatus(await h.call('GET', '/api/admin/export/messages?status=spam', { token: exporter.token }), 400);
  assertStatus(await h.call('GET', '/api/admin/export/coupons?status=new', { token: admin.token }), 400);
  for (const kind of ['passwords', '__proto__', 'constructor', 'toString']) {
    const nf = await h.call('GET', `/api/admin/export/${kind}`, { token: admin.token });
    assertStatus(nf, 404, kind);
  }
  for (const qs of ['from=yesterday', 'tz=Mars%2FOlympus', 'from=2025-03-02&to=2025-03-01']) {
    assertStatus(await h.call('GET', `/api/admin/export/orders?${qs}`, { token: admin.token }), 400, qs);
  }
});

test('exports: every kind downloads with its columns; date and status filters; the row cap says it cut', async () => {
  const evil = "=cmd|' /C calc'!A0";
  const c = await h.customer({ name: evil });
  const o1 = await rawOrder({ user: c, totalInr: 19, createdAt: '2024-07-10T05:00:00Z', paidAt: '2024-07-10T05:01:00Z', productId: 'az-J', country: 'IN' });
  const o2 = await rawOrder({ user: c, totalInr: 25.8, createdAt: '2024-07-10T06:00:00Z', productId: 'az-K', country: 'IN' });
  const o3 = await rawOrder({ user: c, totalInr: 19, createdAt: '2024-07-11T06:00:00Z', productId: 'az-L' });
  const get = (path: string, u: TestUser = admin) => h.call('GET', path, { token: u.token });

  const orders = await get('/api/admin/export/orders?from=2024-07-10&to=2024-07-10&tz=UTC');
  assertStatus(orders, 200);
  const ot = table(orders.text);
  assertEquals(ot.rows.map((x) => x[ot.col('order_id')]), [o2, o1]);
  const p1 = ot.rows[1];
  assertEquals([p1[ot.col('status')], p1[ot.col('customer_email')], p1[ot.col('customer_name')], p1[ot.col('total_inr')], p1[ot.col('items')], p1[ot.col('item_ids')], p1[ot.col('country')]],
    ['paid', c.email, `'${evil}`, '19', 'Sheet az-J', 'az-J', 'IN']);
  assertEquals(ot.rows[0][ot.col('total_inr')], '25.8');
  const paidOnly = table((await get('/api/admin/export/orders?from=2024-07-10&to=2024-07-11&tz=UTC&status=paid')).text);
  assertEquals(paidOnly.rows.map((x) => x[paidOnly.col('order_id')]), [o1]);
  const capped = await get('/api/admin/export/orders?from=2024-07-10&to=2024-07-11&tz=UTC&limit=2');
  assertEquals(table(capped.text).rows.map((x) => x[0]), [o3, o2]);
  assertEquals([capped.headers.get('x-row-count'), capped.headers.get('x-truncated')], ['2', 'true']);
  const capAudit = (await auditRows('export.run', 'orders')).at(-1);
  assertEquals([capAudit.actor_id, capAudit.detail.rows, capAudit.detail.truncated, capAudit.detail.filters.limit, capAudit.detail.filters.tz],
    [admin.id, 2, true, 2, 'UTC']);
  assertEquals(capAudit.detail.filters.from, '2024-07-10T00:00:00.000Z');

  const cu = table((await get('/api/admin/export/customers')).text);
  const crow = cu.rows.find((x) => x[cu.col('email')] === c.email)!;
  assertEquals([crow[cu.col('name')], crow[cu.col('paid_orders')], crow[cu.col('spent_inr')], crow[cu.col('status')]], [`'${evil}`, '1', '19', 'active']);
  assert(!cu.rows.some((x) => x[cu.col('email')] === admin.email), 'staff accounts are not customers');

  const o4 = await rawOrder({ user: c, totalInr: 25.8, createdAt: new Date().toISOString(), productId: 'az-M' });
  await h.sql`select private.fulfil_order(${o4}, 'razorpay', ${'pay_' + o4.slice(4)}, 2580::bigint, 'INR', 'test', ${h.sql.json({ note: 'RAW-GATEWAY-PAYLOAD' })})`;
  const pay = await get('/api/admin/export/payments?status=captured');
  assertStatus(pay, 200);
  const pt = table(pay.text);
  const prow = pt.rows.find((x) => x[pt.col('order_id')] === o4)!;
  assertEquals([prow[pt.col('amount')], prow[pt.col('amount_minor')], prow[pt.col('currency')], prow[pt.col('status')], prow[pt.col('customer_email')], prow[pt.col('provider_payment_id')]],
    ['25.8', '2580', 'INR', 'captured', c.email, `pay_${o4.slice(4)}`]);
  assert(!pay.text.includes('RAW-GATEWAY-PAYLOAD'), 'never the raw gateway payload');

  const gid = await h.grant(c.id, { productId: 'az-N', days: 10 });
  const et = table((await get('/api/admin/export/entitlements')).text);
  const grow = et.rows.find((x) => x[et.col('access_id')] === String(gid))!;
  assertEquals([grow[et.col('customer_email')], grow[et.col('worksheet')], grow[et.col('kind')], grow[et.col('status')], grow[et.col('class')]],
    [c.email, 'az-N', 'grant', 'active', 'kg']);
  const prow2 = et.rows.find((x) => x[et.col('order_id')] === o4)!;
  assertEquals([prow2[et.col('worksheet')], prow2[et.col('kind')], prow2[et.col('status')]], ['az-M', 'paid', 'active']);

  await h.sql`insert into coupons (code, pct, note) values ('GTESTCSV', 10, '=1+1 note')`;
  const cp = table((await get('/api/admin/export/coupons')).text);
  const cprow = cp.rows.find((x) => x[cp.col('code')] === 'GTESTCSV')!;
  assertEquals([cprow[cp.col('percent_off')], cprow[cp.col('active')], cprow[cp.col('uses')], cprow[cp.col('note')]], ['10', 'true', '0', "'=1+1 note"]);

  const ae = await get('/api/admin/export/audit', owner);
  assertStatus(ae, 200);
  const at = table(ae.text);
  const arow = at.rows.find((x) => x[at.col('action')] === 'export.run' && x[at.col('actor')] === admin.email)!;
  assert(arow, 'earlier exports are in the audit export');
  assertEquals(typeof JSON.parse(arow[at.col('detail')]).kind, 'string');
  const kinds = new Set((await auditRows('export.run')).filter((a) => a.actor_id === admin.id).map((a) => a.detail.kind));
  for (const k of ['orders', 'customers', 'payments', 'entitlements', 'coupons']) assert(kinds.has(k), `export of ${k} audited`);
});

// ── backup ───────────────────────────────────────────────────────────────────────────────

test('backup: owner or admin only; configuration tables, never secrets, accounts or email text (audited)', async () => {
  await h.setSetting('smtp_password', { value: 'BACKUP-SECRET-ONE' });
  await h.setSetting('payment_api_key', 'BACKUP-SECRET-TWO');
  const appSecret = (await h.sql<{ value: string }[]>`select value from private.app_secrets order by name limit 1`)[0].value;
  const c = await h.customer();
  await outbox({ to: c.email, status: 'sent', attempts: 1, text: 'BACKUP-BODY-MARKER', html: '<p>BACKUP-BODY-MARKER</p>' });
  await h.sql`insert into site_content (key, value) values ('gtest.backup', '{"text":"hello backup"}'::jsonb) on conflict do nothing`;

  const devExporter = await h.staff('developer', ['developer.read', 'exports.run']);
  const refused = await h.call('GET', '/api/admin/backup', { token: devExporter.token });
  assertStatus(refused, 403);
  assertEquals([refused.body.code, refused.body.permission, refused.body.roles], ['forbidden', 'exports.run', ['owner', 'admin']]);
  const noRun = await h.call('GET', '/api/admin/backup', { token: support.token });
  assertEquals([noRun.status, noRun.body.permission], [403, 'exports.run']);

  for (const u of [owner, admin]) {
    const r = await h.call('GET', '/api/admin/backup', { token: u.token });
    assertStatus(r, 200);
    assertMatch(r.headers.get('content-type') ?? '', /^application\/json/);
    assertEquals(r.headers.get('content-disposition'), `attachment; filename="lww-backup-${new Date().toISOString().slice(0, 10)}.json"`);
    const b = r.body;
    assertEquals([b.kind, b.version, b.apiVersion], ['learn-with-why-config-backup', 1, 'test']);
    assertEquals(Object.keys(b.tables).sort(), ['classes', 'coupons', 'faq', 'plans', 'products', 'securityRules', 'settings', 'siteContent', 'staffPermissions', 'staffRoleTemplates']);
    for (const [k, v] of Object.entries(b.tables)) assertEquals(b.counts[k], (v as unknown[]).length, k);
    assert(b.tables.products.length >= 100 && b.tables.plans.length >= 3 && b.tables.classes.length >= 4);
    assert(b.tables.products.some((p: Any) => p.id === 'az-A' && p.pdf_path === 'a-to-z/A.pdf'));
    assert(b.tables.faq.some((f: Any) => f.status === 'planned'), 'every answer, planned ones too');
    assert(b.tables.siteContent.some((s: Any) => s.key === 'gtest.backup'));
    assert(b.tables.staffRoleTemplates.some((s: Any) => s.role === 'owner'));
    const keys = b.tables.settings.map((s: Any) => s.key);
    assert(keys.includes('viewer') && !keys.includes('smtp_password') && !keys.includes('payment_api_key'), keys.join(','));
    const env = h.env();
    for (const secret of ['BACKUP-SECRET-ONE', 'BACKUP-SECRET-TWO', appSecret, 'BACKUP-BODY-MARKER', c.email, c.id, c.token, c.refreshToken, c.sessionId, env.LWW_JWT_SECRET!, env.SUPABASE_SERVICE_ROLE_KEY!]) {
      assert(!r.text.includes(secret), `the backup must not contain ${secret.slice(0, 14)}…`);
    }
    for (const word of ['app_secrets', 'auth_tokens', 'app_sessions', 'email_outbox', 'encrypted_password', 'body_html']) assert(!r.text.includes(word), word);
  }
  const au = (await auditRows('backup.download')).filter((a) => a.actor_id === owner.id || a.actor_id === admin.id);
  assertEquals(au.length, 2);
  assert(au[0].detail.counts.products >= 100);
});

// ── developer health ─────────────────────────────────────────────────────────────────────

test('developer health: names and counts only, never values; migrations when readable; outbox, payments and errors', async () => {
  await h.sql`insert into security_events (event_type, detail) values ('payment.rejected', '{"reason":"amount_mismatch"}'::jsonb)`;
  await h.sql`insert into payment_events (provider, event_id, event_type, ok, status, signature_ok) values ('razorpay', ${'evt_g_' + Date.now()}, 'payment.captured', false, 'failed', false)`;
  const r = await h.call('GET', '/api/admin/developer/health', { token: developer.token });
  assertStatus(r, 200);
  const b = r.body;
  assertEquals([b.ok, b.db.ok, b.version], [true, true, 'test']);
  assert(typeof b.db.time === 'number' && Math.abs(b.db.time - Date.now()) < 60_000);
  assert(Object.values(b.env).every((v) => typeof v === 'boolean'), 'presence only');
  assertEquals([b.env.LWW_JWT_SECRET, b.env.SUPABASE_SERVICE_ROLE_KEY, b.env.RAZORPAY_KEY_SECRET], [true, true, false]);
  assert(b.envMissing.includes('RAZORPAY_KEY_ID') && !b.envMissing.includes('LWW_JWT_SECRET'));
  for (const [name, value] of Object.entries(h.env())) {
    if (value && value.length >= 8) assert(!r.text.includes(value), `${name}'s value must not appear`);
  }
  assert(!r.text.includes('postgres://'));
  // migrations applied with psql (as here) leave no CLI history: the page says so instead of "0"
  assertEquals(b.migrations, { readable: false, reason: 'no_history_table', count: null, latest: null, list: [] });
  assert(b.tables.some((t: Any) => t.name === 'orders' && typeof t.rows === 'number' && typeof t.bytes === 'number'));
  for (const k of ['queued', 'failed', 'gaveUp', 'waiting', 'due', 'oldestWaitingAt', 'lastSentAt', 'sent24h', 'failed24h']) assert(k in b.outbox, k);
  assertEquals([b.payments.lastEvent.type, b.payments.lastEvent.ok, b.payments.lastEvent.signatureOk, b.payments.lastEvent.status], ['payment.captured', false, false, 'failed']);
  assert(b.payments.badSignatures24h >= 1 && b.payments.notOk24h >= 1 && b.payments.events24h >= 1);
  const pr = b.errors.byType.find((x: Any) => x.type === 'payment.rejected');
  assert(pr && pr.last24h >= 1 && pr.last7d >= 1);
  assert(b.errors.recent.some((x: Any) => x.type === 'payment.rejected' && x.reason === 'amount_mismatch'));
  assertEquals(b.mail, { provider: 'brevo', ready: true, fromSet: true });
  assertEquals(b.gateways, { razorpay: false, stripe: false, paypal: false });
  assert(b.warnings.some((w: string) => /payment gateway/.test(w)));
  assert(typeof b.files.products === 'number' && typeof b.files.onSaleWithoutPdf === 'number');
  // the migration history appears once the CLI's table exists (names and versions, never the SQL)
  await h.sql`create schema if not exists supabase_migrations`;
  await h.sql`create table if not exists supabase_migrations.schema_migrations (version text primary key, statements text[], name text)`;
  await h.sql`
    insert into supabase_migrations.schema_migrations (version, statements, name)
    values ('20261007120000', '{"select 1"}', 'foundation'), ('20261007121600', '{"select 2"}', 'g_ops')
    on conflict do nothing`;
  const m = (await h.call('GET', '/api/admin/developer/health', { token: developer.token })).body.migrations;
  assertEquals([m.readable, m.count, m.latest, m.list.length], [true, 2, { version: '20261007121600', name: 'g_ops' }, 2]);
  assert(!JSON.stringify(m).includes('select 2'), 'never the SQL');
});

// ── site text ────────────────────────────────────────────────────────────────────────────

test('content: the home page text (old shape), headline allow-list, publish flag drives GET /api/content; audited', async () => {
  const put = (body: unknown, u: TestUser = content) => h.call('PUT', '/api/admin/content', { token: u.token, body });
  const publicHome = async () => (await h.call('GET', '/api/content')).body.home;
  const r = await put({
    badge: '  New:   Kindergarten  ',
    heroTitle: 'Learn <em class="hl x" onclick="alert(1)">why</em>, <script>alert(1)</script><b>every</b> <a href="javascript:x">day</a><img src=x onerror=alert(1)>',
    heroLede: 'Printable sheets\nfor curious kids.',
    whys: 'Why is the sky blue?\n\nWhy do cats purr?\n',
  });
  assertStatus(r, 200);
  assertEquals([r.body.ok, r.body.changed, r.body.key], [true, true, 'home']);
  const home = {
    badge: 'New: Kindergarten',
    heroTitle: 'Learn <em class="hl x">why</em>, <b>every</b> day',
    heroLede: 'Printable sheets for curious kids.',
    whys: ['Why is the sky blue?', 'Why do cats purr?'],
  };
  assertEquals(r.body.content.home, home);
  assertEquals([r.body.home.published, r.body.published.home, r.body.home.badge], [true, true, home.badge]);
  assertEquals(await publicHome(), home);
  // a partial save keeps the other fields
  const r2 = await put({ badge: 'Back to school', whys: ['Why is ice slippery?'] });
  assertEquals(r2.body.content.home, { ...home, badge: 'Back to school', whys: ['Why is ice slippery?'] });
  // hidden: the site falls back to its built-in text
  const hide = await put({ key: 'home', published: false });
  assertStatus(hide, 200);
  assertEquals([hide.body.changed, hide.body.published.home], [true, false]);
  assertEquals(await publicHome(), undefined);
  const adminView = await h.call('GET', '/api/admin/content', { token: content.token });
  assertEquals([adminView.body.home.published, adminView.body.home.badge, adminView.body.items.find((i: Any) => i.key === 'home').updatedBy], [false, 'Back to school', content.email]);
  // saving text while hidden keeps it hidden
  await put({ heroLede: 'Still hidden.' });
  assertEquals(await publicHome(), undefined);
  // publish again (the old page sends just { published })
  const show = await put({ published: true });
  assertEquals([show.body.changed, show.body.published.home], [true, true]);
  assertEquals((await publicHome()).heroLede, 'Still hidden.');
  const same = await put({ published: true });
  assertEquals(same.body.changed, false);
  const sameText = await put({ badge: 'Back to school' });
  assertEquals(sameText.body.changed, false);
  const updates = await auditRows('content.update', 'home');
  const pubs = await auditRows('content.publish', 'home');
  assertEquals([updates.length, pubs.length], [3, 2]);
  assertEquals([updates[0].actor_id, updates[0].detail.before, updates[0].detail.after.value.heroTitle], [content.id, null, home.heroTitle]);
  assertEquals(pubs.map((p) => [p.detail.before.published, p.detail.after.published]), [[true, false], [false, true]]);
  // reset: the built-in text again
  const reset = await put({ reset: true });
  assertEquals([reset.body.changed, reset.body.home], [true, null]);
  assertEquals(await publicHome(), undefined);
  assertEquals((await auditRows('content.reset', 'home')).length, 1);
  const bad: unknown[] = [
    { badge: 42 }, { colour: 'red' }, { badge: 'x'.repeat(121) }, { heroTitle: 'x'.repeat(2001) },
    { whys: Array.from({ length: 31 }, (_, i) => `Why ${i}?`) }, { whys: [1, 2] }, { whys: ['x'.repeat(161)] },
    { key: 'Bad Key!', value: 'x' }, { published: 'yes' }, { key: 'home', value: 'just text' },
    { key: 'home', value: { badge: 'ok', extra: 1 } },
  ];
  for (const body of bad) assertStatus(await put(body), 400, JSON.stringify(body).slice(0, 60));
  assertEquals((await auditRows('content.update', 'home')).length, 3, 'refused saves are not audited');
});

test('content: other keys hold small JSON; *Html fields get the allow-list; reset removes a key', async () => {
  const put = (body: unknown) => h.call('PUT', '/api/admin/content', { token: content.token, body });
  const r = await put({
    key: 'footer.note',
    value: { text: '  Made with care  ', linksHtml: 'See <b>this</b><script>x()</script>', n: 3, on: true, list: ['a', 'b'] },
    published: false,
  });
  assertStatus(r, 200);
  assertEquals(r.body.content['footer.note'], { text: 'Made with care', linksHtml: 'See <b>this</b>', n: 3, on: true, list: ['a', 'b'] });
  assertEquals(r.body.published['footer.note'], false);
  assertEquals('footer.note' in (await h.call('GET', '/api/content')).body, false, 'saved hidden');
  assertEquals((await put({ key: 'footer.note', published: true })).body.changed, true);
  assertEquals((await h.call('GET', '/api/content')).body['footer.note'].text, 'Made with care');
  const del = await put({ key: 'footer.note', value: null });
  assertEquals([del.body.changed, 'footer.note' in del.body.content], [true, false]);
  assertEquals((await auditRows('content.reset', 'footer.note')).length, 1);
  assertEquals((await put({ key: 'footer.note', value: null })).body.changed, false, 'already gone');
  const nf = await put({ key: 'nothing.here', published: true });
  assertStatus(nf, 404);
  const tooDeep = { a: { b: { c: { d: { e: { f: { g: 1 } } } } } } };
  for (const value of [tooDeep, { 'bad key!': 1 }, 'x'.repeat(9000), { list: Array.from({ length: 201 }, () => 1) }]) {
    assertStatus(await put({ key: 'gtest.bad', value }), 400, JSON.stringify(value).slice(0, 40));
  }
  assertEquals((await h.sql`select 1 from site_content where key = 'gtest.bad'`).length, 0);
});

// ── FAQ answers ──────────────────────────────────────────────────────────────────────────

test('faq: create, edit and delete (audited); planned, draft and staff answers never reach GET /api/faq', async () => {
  const create = (body: unknown) => h.call('POST', '/api/admin/faq', { token: content.token, body });
  const tag = `t${Date.now().toString(36)}`;
  const pub = await create({ question: `Public answer ${tag}?`, answer: 'Yes, public.', keywords: 'alpha, Beta ,alpha', sort: 3 });
  assertStatus(pub, 201);
  assertEquals([pub.body.faq.audience, pub.body.faq.status, pub.body.faq.public, pub.body.faq.keywords, pub.body.faq.sort, pub.body.faq.updatedBy],
    ['public', 'published', true, ['alpha', 'beta'], 3, content.email]);
  const planned = await create({ question: `Planned answer ${tag}?`, answer: 'Not yet.', status: 'planned' });
  const draft = await create({ question: `Draft answer ${tag}?`, answer: 'Draft.', status: 'draft' });
  const staffOnly = await create({ question: `Staff answer ${tag}?`, answer: 'Staff only.', audience: 'staff' });
  for (const x of [planned, draft, staffOnly]) {
    assertStatus(x, 201);
    assertEquals(x.body.faq.public, false);
  }
  const publicQuestions = async (): Promise<string[]> => (await h.call('GET', '/api/faq')).body.faq.map((f: Any) => f.question);
  let qs = await publicQuestions();
  assert(qs.includes(`Public answer ${tag}?`));
  for (const x of [planned, draft, staffOnly]) assert(!qs.includes(x.body.faq.question), x.body.faq.question);
  assert(!qs.includes('Do you offer refunds?') && !qs.includes('How do staff grant access by hand?'), 'the seeded planned and staff answers are not public');
  // publishing the planned answer makes it public; making the public one staff-only hides it
  const up = await h.call('PUT', `/api/admin/faq/${planned.body.faq.id}`, { token: content.token, body: { status: 'published', answer: 'Now ready.' } });
  assertStatus(up, 200);
  assertEquals([up.body.faq.status, up.body.faq.answer, up.body.faq.public], ['published', 'Now ready.', true]);
  const hide = await h.call('PUT', `/api/admin/faq/${pub.body.faq.id}`, { token: content.token, body: { audience: 'staff' } });
  assertEquals(hide.body.faq.public, false);
  qs = await publicQuestions();
  assert(qs.includes(`Planned answer ${tag}?`) && !qs.includes(`Public answer ${tag}?`));
  // the staff list and its filters
  const list = await h.call('GET', `/api/admin/faq?q=${tag}`, { token: content.token });
  assertStatus(list, 200);
  assertEquals([list.body.faq.length, list.body.counts.total, list.body.counts.public], [4, 4, 1]);
  const staffList = await h.call('GET', `/api/admin/faq?audience=staff&q=${tag}`, { token: content.token });
  assertEquals(staffList.body.faq.map((f: Any) => f.id).sort(), [pub.body.faq.id, staffOnly.body.faq.id].sort());
  const draftList = await h.call('GET', `/api/admin/faq?status=draft&q=${tag}`, { token: content.token });
  assertEquals(draftList.body.faq.map((f: Any) => f.id), [draft.body.faq.id]);
  assertStatus(await h.call('GET', '/api/admin/faq?status=live', { token: content.token }), 400);
  // an edit that changes nothing writes nothing
  const same = await h.call('PUT', `/api/admin/faq/${draft.body.faq.id}`, { token: content.token, body: { status: 'draft', answer: 'Draft.' } });
  assertStatus(same, 200);
  assertEquals((await auditRows('faq.update', draft.body.faq.id)).length, 0);
  const del = await h.call('DELETE', `/api/admin/faq/${draft.body.faq.id}`, { token: content.token });
  assertEquals(del.body, { ok: true, deleted: true, id: draft.body.faq.id });
  assertStatus(await h.call('DELETE', `/api/admin/faq/${draft.body.faq.id}`, { token: content.token }), 404);
  // the audit trail
  const cr = await auditRows('faq.create', pub.body.faq.id);
  assertEquals([cr.length, cr[0].actor_id, cr[0].detail.after.question, cr[0].detail.after.audience], [1, content.id, `Public answer ${tag}?`, 'public']);
  const ud = await auditRows('faq.update', planned.body.faq.id);
  assertEquals(ud[0].detail, { before: { status: 'planned', answer: 'Not yet.' }, after: { status: 'published', answer: 'Now ready.' } });
  const dl = await auditRows('faq.delete', draft.body.faq.id);
  assertEquals([dl.length, dl[0].detail.before.question, dl[0].detail.after], [1, `Draft answer ${tag}?`, null]);
  const bad: unknown[] = [
    {}, { question: 'Hi', answer: 'x' }, { question: 'Fine question?', answer: '' }, { question: 'Fine question?', answer: 'ok', audience: 'everyone' },
    { question: 'Fine question?', answer: 'ok', status: 'live' }, { question: 'Fine question?', answer: 'ok', sort: 1.5 },
    { question: 'Fine question?', answer: 'ok', keywords: [1] }, { question: 'Q'.repeat(301), answer: 'ok' }, { question: 'Fine question?', answer: 'a'.repeat(2001) },
  ];
  for (const body of bad) assertStatus(await create(body), 400, JSON.stringify(body).slice(0, 60));
  assertStatus(await h.call('PUT', `/api/admin/faq/${pub.body.faq.id}`, { token: content.token, body: {} }), 400);
  const nf = await h.call('PUT', '/api/admin/faq/999999999', { token: content.token, body: { answer: 'x' } });
  assertEquals([nf.status, nf.body.error], [404, 'No such answer.']);
  // nor does the assistant use them; once public, it does
  const word = `zq${tag}`;
  const internal = await create({ question: `Internal process ${tag}?`, answer: `INTERNAL-${tag}`, keywords: [word], audience: 'staff' });
  await create({ question: `Future plan ${tag}?`, answer: `PLANNED-${tag}`, keywords: [word], status: 'planned' });
  const ask = () => h.call('POST', '/api/ai/chat', { body: { message: `Tell me about ${word}` } });
  const before = await ask();
  assertStatus(before, 200);
  assert(!before.text.includes(`INTERNAL-${tag}`) && !before.text.includes(`PLANNED-${tag}`), before.text.slice(0, 200));
  assertStatus(await h.call('PUT', `/api/admin/faq/${internal.body.faq.id}`, { token: content.token, body: { audience: 'public' } }), 200);
  assert((await ask()).text.includes(`INTERNAL-${tag}`), 'a published public answer is used');
});

// ── reviews ──────────────────────────────────────────────────────────────────────────────

test('reviews: moderation keeps review_avg and review_count right and controls the public list (audited)', async () => {
  const pid = 'az-Q';
  const c1 = await h.customer({ name: 'Priya Sharma' }), c2 = await h.customer(), c3 = await h.customer();
  const ins = async (u: TestUser, rating: number) => (await h.sql<{ id: number }[]>`
    insert into reviews (product_id, user_id, rating, title, body) values (${pid}, ${u.id}, ${rating}, 'Title', 'Body text') returning id`)[0].id;
  const r5 = await ins(c1, 5), r2 = await ins(c2, 2), r4 = await ins(c3, 4);
  const stats = async () => (await h.sql<Any[]>`select review_avg::float8 as avg, review_count as n from products where id = ${pid}`)[0];
  assertEquals(await stats(), { avg: null, n: 0 });
  const set = (id: number, status: string, u: TestUser = content) =>
    h.call('POST', `/api/admin/reviews/${id}/status`, { token: u.token, body: { status, note: 'checked' } });
  let r = await set(r5, 'published');
  assertStatus(r, 200);
  assertEquals([r.body.ok, r.body.changed, r.body.review.status, r.body.worksheet], [true, true, 'published', { id: pid, reviewAvg: 5, reviewCount: 1 }]);
  assertEquals([r.body.review.customer.email, r.body.review.customer.initials, r.body.review.moderatedBy], [null, 'P. S.', content.email]);
  r = await set(r2, 'published');
  assertEquals(r.body.worksheet, { id: pid, reviewAvg: 3.5, reviewCount: 2 });
  r = await set(r5, 'hidden');
  assertEquals(r.body.worksheet, { id: pid, reviewAvg: 2, reviewCount: 1 });
  r = await set(r4, 'published', admin);
  assertEquals(r.body.worksheet, { id: pid, reviewAvg: 3, reviewCount: 2 });
  assertEquals(r.body.review.customer.email, c3.email, 'staff who may see customers see the email');
  assertEquals(await stats(), { avg: 3, n: 2 });
  const pub = await h.call('GET', `/api/worksheets/${pid}/reviews`);
  assertStatus(pub, 200);
  assertEquals([pub.body.avg, pub.body.count, pub.body.reviews.map((x: Any) => x.id).sort()], [3, 2, [r2, r4].sort()]);
  // back to pending: out of the average again
  r = await set(r2, 'pending');
  assertEquals(r.body.worksheet, { id: pid, reviewAvg: 4, reviewCount: 1 });
  const same = await set(r4, 'published');
  assertEquals([same.status, same.body.changed], [200, false]);
  const au = await auditRows('review.status', r5);
  assertEquals(au.map((a) => [a.detail.before.status, a.detail.after.status]), [['pending', 'published'], ['published', 'hidden']]);
  assertEquals([au[0].actor_id, au[0].detail.worksheet, au[0].detail.rating, au[0].detail.note], [content.id, pid, 5, 'checked']);
  assertEquals((await auditRows('review.status', r4)).length, 1, 'no change, no audit row');
  const row = (await h.sql<Any[]>`select moderated_by, moderated_at from reviews where id = ${r4}`)[0];
  assert(row.moderated_by === admin.id && row.moderated_at);
  // the queue
  const q = await h.call('GET', `/api/admin/reviews?worksheet=${pid}`, { token: content.token });
  assertStatus(q, 200);
  assertEquals([q.body.counts, q.body.total], [{ pending: 1, published: 1, hidden: 1 }, 3]);
  const hidden = await h.call('GET', `/api/admin/reviews?worksheet=${pid}&status=hidden`, { token: content.token });
  assertEquals([hidden.body.reviews.map((x: Any) => x.id), hidden.body.total], [[r5], 1]);
  assertEquals(hidden.body.reviews[0].worksheetTitle, 'Alphabet Q — tracing sheet');
  for (const body of [{ status: 'deleted' }, {}, { status: 'hidden', note: 5 }]) {
    assertStatus(await h.call('POST', `/api/admin/reviews/${r5}/status`, { token: content.token, body }), 400, JSON.stringify(body));
  }
  assertEquals((await set(999999999, 'hidden')).status, 404);
  assertStatus(await h.call('GET', '/api/admin/reviews?status=spam', { token: content.token }), 400);
  assertStatus(await h.call('GET', '/api/admin/reviews?worksheet=bad%20id', { token: content.token }), 400);
});

// ── pure helpers ─────────────────────────────────────────────────────────────────────────

test('sanitizeHeadline: only the site renderer\'s tags, always well formed, scripts dropped with their text', async () => {
  const cases: [string, string][] = [
    ['Plain & simple', 'Plain &amp; simple'],
    ['Keep &amp; and &#8217; and &nbsp;', 'Keep &amp; and &#8217; and &nbsp;'],
    ['a < b > c', 'a &lt; b &gt; c'],
    ['<em>open', '<em>open</em>'],
    ['</b>stray close', 'stray close'],
    ['<b><i>x</b>y', '<b><i>x</i></b>y'],
    ['<EM>Caps</EM>', '<em>Caps</em>'],
    ['<style>body{}</style>ok', 'ok'],
    ['<svg><script>1</script></svg>ok', 'ok'],
    ['<script>never closed', ''],
    ['<!-- c -->x<![CDATA[y]]>', 'x'],
    ['<span class="a" style="color:red">t</span>', '<span class="a">t</span>'],
    ['<span class="a&quot;b" onclick=x>t</span>', '<span class="aquotb">t</span>'],
    ['<em onmouseover=alert(1)>x</em>', '<em>x</em>'],
    ['<a href="javascript:alert(1)">link</a>', 'link'],
    ['<img src=x onerror="alert(1)">', ''],
    ['line<br/>break<br>', 'line<br>break<br>'],
    ['<scr<script>ipt>alert(1)</script>', '&lt;scr'],
    ['<b>'.repeat(10) + 'x', '<b>'.repeat(8) + 'x' + '</b>'.repeat(8)],
  ];
  for (const [input, want] of cases) assertEquals(sanitizeHeadline(input), want, input);
});

test('csv: formulas defused, quoting per RFC 4180, numbers untouched, round trip, safe file names', async () => {
  const cases: [unknown, string][] = [
    ['=1+1', "'=1+1"], ['+1', "'+1"], ['-1', "'-1"], ['@x', "'@x"], [' =1', "' =1"], ['\t=1', "'\t=1"], ['＝1', "'＝1"],
    ['\rx', `"'\rx"`], [-5, '-5'], [2.5, '2.5'], [Number.NaN, ''], [null, ''], [undefined, ''], [true, 'true'],
    ['a,b', '"a,b"'], ['say "hi"', '"say ""hi"""'], [' padded ', '" padded "'], ['plain', 'plain'],
    [new Date('2026-01-02T03:04:05Z'), '2026-01-02T03:04:05.000Z'], [{ a: 1 }, '"{""a"":1}"'], ['nul\u0000byte', 'nulbyte'],
  ];
  for (const [v, want] of cases) assertEquals(csvCell(v as never), want, JSON.stringify(v));
  const cols = [0, 1, 2, 3, 4].map((i) => ({ header: `h${i}`, value: (r: string[]) => r[i] }));
  const text = toCsv(cols, [['=x', 'a,b', 'line\r\nbreak', '"q"', '']]);
  assert(text.startsWith('﻿') && text.endsWith('\r\n'));
  assertEquals(parseCsv(text), [['h0', 'h1', 'h2', 'h3', 'h4'], ["'=x", 'a,b', 'line\r\nbreak', '"q"', '']]);
  assert(!toCsv(cols, [], { bom: false }).startsWith('﻿'));
  const d = new Date('2026-10-08T00:00:00Z');
  assertEquals([attachmentName('lww-orders', 'csv', d), attachmentName('Weird Name!!/..', 'csv', d), attachmentName('***', 'json', d)],
    ['lww-orders-2026-10-08.csv', 'weird-name-2026-10-08.csv', 'export-2026-10-08.json']);
});
