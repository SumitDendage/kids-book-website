// Shop routes (routes/shop.ts) and the pricing service (services/pricing.ts): the catalogue, quotes,
// the order-time re-checks, and the customer's own orders and access records.
import { assert, assertEquals, assertMatch, assertStatus, randomIp, startHarness, test, type Harness, type TestUser } from './harness.ts';
import { tx } from '../../functions/api/lib/db.ts';
import { HttpError } from '../../functions/api/lib/http.ts';
import { loadQuote, revalidateQuote, type StoredQuote } from '../../functions/api/services/pricing.ts';

const h: Harness = await startHarness();

const IN_ADDR = { country: 'IN', line1: '12 MG Road', city: 'Pune', state: 'Maharashtra', postal: '411001' };
const US_ADDR = { country: 'US', line1: '1 Market Street', city: 'San Francisco' };
const JP_ADDR = { country: 'JP', line1: '1-1 Chiyoda', city: 'Tokyo' };

// sheets used here get their PDF once
const uploaded = new Set<string>();
async function withPdf(id: string) {
  if (uploaded.has(id)) return;
  await h.uploadPdfFor(id);
  uploaded.add(id);
}

async function quote(body: Record<string, unknown>, o: { token?: string; ip?: string } = {}) {
  return await h.call('POST', '/api/quote', { body, token: o.token, ip: o.ip });
}

async function stored(id: string): Promise<StoredQuote> {
  return await tx((q) => loadQuote(q, id));
}

async function httpError(p: Promise<unknown>): Promise<HttpError> {
  try {
    await p;
  } catch (e) {
    if (e instanceof HttpError) return e;
    throw e;
  }
  throw new Error('expected an HttpError');
}

let couponSeq = 0;
async function coupon(o: { pct?: number; max?: number; perUser?: number; appliesTo?: string; classId?: string | null; from?: string | null; until?: string | null; active?: boolean } = {}) {
  const code = `T${Date.now().toString(36).toUpperCase()}${++couponSeq}`;
  await h.sql`
    insert into coupons (code, pct, max_uses, per_user_limit, applies_to, class_id, valid_from, valid_until, active)
    values (${code}, ${o.pct ?? 10}, ${o.max ?? 0}, ${o.perUser ?? 0}, ${o.appliesTo ?? 'all'}, ${o.classId ?? null},
            ${o.from ?? null}, ${o.until ?? null}, ${o.active ?? true})`;
  return code;
}

let orderSeq = 0;
/** A paid order straight in the database (with its order item; optionally the coupon redemption). */
async function paidOrder(user: TestUser, o: { productId?: string; coupon?: string; redeem?: boolean; status?: string; createdAgo?: string } = {}) {
  const id = `LWO-T${Date.now().toString(36).toUpperCase().slice(-6)}${(++orderSeq).toString().padStart(3, '0')}`;
  const status = o.status ?? 'paid';
  const paid = status === 'paid' || status === 'refunded';
  await h.sql`
    insert into orders (id, user_id, kind, status, currency, rate, total, total_inr, amount_minor, lines, coupon_code, method, paid_at, created_at)
    values (${id}, ${user.id}, 'worksheet', ${status}, 'INR', 1, 25.80, 25.80, 2580, ${h.sql.json([])}, ${o.coupon ?? null}, 'razorpay',
            ${paid ? new Date() : null}, now() - ${o.createdAgo ?? '0 minutes'}::interval)`;
  const it = await h.sql<{ id: number }[]>`
    insert into order_items (order_id, kind, product_id, title, access_days, unit_price_inr)
    values (${id}, 'worksheet', ${o.productId ?? 'az-C'}, 'Alphabet C — tracing sheet', 365, 19)
    returning id`;
  if (o.coupon && o.redeem !== false && paid) {
    await h.sql`insert into coupon_redemptions (coupon_code, order_id, user_id, discount_inr) values (${o.coupon}, ${id}, ${user.id}, 1.9)`;
  }
  return { id, itemId: it[0].id };
}

// ── GET /api/worksheets ──────────────────────────────────────────────────────────────────

test('catalogue: active sheets only, never a storage path, available follows the uploaded PDF', async () => {
  const r = await h.call('GET', '/api/worksheets');
  assertStatus(r, 200);
  assertEquals(r.headers.get('cache-control'), 'no-cache');
  const all = r.body.worksheets as Record<string, unknown>[];
  assert(all.length >= 100, 'the seeded catalogue is listed');
  assert(!/pdf_path|pdfPath|\.pdf/i.test(r.text), 'no PDF path in the listing');
  const d = all.find((w) => w.id === 'az-D')!;
  assertEquals([d.cls, d.price, d.free, d.subject, d.pages], ['kg', 19, false, 'English', 1]);
  assertEquals(d.available, false);
  assertEquals(d.real, false);
  assertEquals(d.onSale, false);
  assertEquals([d.accessDays, d.accessHours], [1, 24]);
  for (const k of ['printLimit', 'downloadLimit', 'rating', 'ratingCount', 'reviewAvg', 'reviewCount', 'audience', 'stock', 'thumb']) assert(k in d, `field ${k}`);
  assertEquals(all.find((w) => w.id === 'az-A')!.free, true);
  // classes and plans ride along; Class 1 is coming soon
  const c1 = (r.body.classes as Record<string, unknown>[]).find((c) => c.id === 'c1')!;
  assertEquals([c1.status, c1.comingSoon, c1.available], ['coming_soon', true, false]);
  assertEquals((r.body.plans as { id: string }[]).map((p) => p.id), ['m1', 'm3', 'm6', 'y1']);

  await withPdf('az-D');
  await h.sql`update products set access_days = 30 where id = 'az-D'`;
  const r2 = await h.call('GET', '/api/worksheets');
  const d2 = (r2.body.worksheets as Record<string, unknown>[]).find((w) => w.id === 'az-D')!;
  assertEquals([d2.available, d2.real, d2.onSale, d2.accessDays], [true, true, true, 30]);
  await h.sql`update products set access_days = null where id = 'az-D'`;
});

test('catalogue: drafts, archived sheets and hidden classes are not listed', async () => {
  await h.sql`update products set status = 'draft' where id = 'az-E'`;
  await h.sql`update products set status = 'archived' where id = 'az-F'`;
  await h.sql`insert into classes (id, name, status, sort) values ('hid', 'Hidden class', 'hidden', 99)`;
  await h.sql`insert into products (id, title, class_id, subject, price_inr, status) values ('hid-1', 'Secret sheet', 'hid', 'English', 19, 'active')`;
  try {
    const r = await h.call('GET', '/api/worksheets');
    const ids = new Set((r.body.worksheets as { id: string }[]).map((w) => w.id));
    assert(!ids.has('az-E') && !ids.has('az-F') && !ids.has('hid-1'));
    assert(!(r.body.classes as { id: string }[]).some((c) => c.id === 'hid'));
  } finally {
    await h.sql`update products set status = 'active' where id in ('az-E', 'az-F')`;
    await h.sql`delete from products where id = 'hid-1'`;
    await h.sql`delete from classes where id = 'hid'`;
  }
});

// ── POST /api/quote ──────────────────────────────────────────────────────────────────────

test('quote: India — base, GST 18% and fee from database prices; stored as quoted', async () => {
  await withPdf('az-C');
  const r = await quote({ worksheet: 'az-C', address: IN_ADDR });
  assertStatus(r, 200);
  const b = r.body;
  assertEquals([b.kind, b.worksheet, b.cls, b.className, b.country, b.region, b.currency, b.rate], ['worksheet', 'az-C', 'kg', 'Kindergarten', 'IN', 'IN', 'INR', 1]);
  assertEquals(b.lines.map((l: { amount: number }) => l.amount), [19, 3.42, 3.38]);
  assertEquals(b.lines[1].label, 'GST 18%');
  assertEquals(b.lines[2].note, '2% + ₹3');
  assertEquals([b.total, b.amountMinor, b.valid, b.discountInr, b.coupon], [25.8, 2580, true, 0, null]);
  assertEquals(b.errors, {});
  assertMatch(b.quoteId, /^[0-9a-f-]{36}$/);
  assertEquals(b.sig, b.quoteId);
  assert(b.expiresAt === b.exp && b.exp > Date.now() + 14 * 60_000 && b.exp <= Date.now() + 15 * 60_000 + 5000, 'expires in 15 minutes');
  assertEquals([b.accessDays, b.accessHours], [1, 24]);
  assertEquals(b.items[0].expiry, 'Yours to keep: it opens as soon as your payment is verified and stays on your account for good.');
  assertEquals(b.items[0].endsAt, null, 'a bought sheet has no end');
  assertEquals(b.methods, [], 'no gateway is configured in the test env');

  const row = (await h.sql`select * from quotes where id = ${b.quoteId}`)[0];
  assertEquals([row.kind, row.product_id, row.country, row.currency, Number(row.total), Number(row.amount_minor), row.valid], ['worksheet', 'az-C', 'IN', 'INR', 25.8, 2580, true]);
  assertEquals(row.payload.lines[0].unitPriceInr, 19);
  assertEquals([row.payload.lines[0].accessDays, row.payload.lines[0].accessHours], [1, 24]);

  const s = await stored(b.quoteId);
  assertEquals([s.amountMinor, s.total, s.currency, s.rate, s.lines.length, s.lines[0].productId, s.title], [2580, 25.8, 'INR', 1, 1, 'az-C', 'Alphabet C — tracing sheet']);
});

test('quote: the browser cannot set the price, and client totals are ignored', async () => {
  await withPdf('az-C');
  const r = await quote({ worksheet: 'az-C', address: IN_ADDR, total: 0.01, amountMinor: 1, price: 1, lines: [{ amount: 0 }] });
  assertStatus(r, 200);
  assertEquals(r.body.amountMinor, 2580);
});

test('quote: abroad — converted to the local currency, minor units, JPY without decimals', async () => {
  await withPdf('az-C');
  const us = await quote({ worksheet: 'az-C', address: US_ADDR });
  assertStatus(us, 200);
  assertEquals([us.body.currency, us.body.rate, us.body.region, us.body.total, us.body.amountMinor, us.body.valid], ['USD', 0.012, 'INTL', 0.54, 54, true]);
  assertEquals(us.body.lines.map((l: { amount: number }) => l.amount), [0.23, 0, 0.31]);
  assertEquals(us.body.lines[0].note, 'converted from ₹19');
  assertEquals(us.body.lines[1].note, 'No tax collected for this region');

  const jp = await quote({ worksheet: 'az-C', address: JP_ADDR });
  assertEquals([jp.body.currency, jp.body.total, jp.body.amountMinor], ['JPY', 83, 83]);
  assertEquals(jp.body.lines.map((l: { amount: number }) => l.amount), [34, 3, 46]);

  const gb = await quote({ worksheet: 'az-C', address: { country: 'GB', line1: '10 Downing St', city: 'London' } });
  assertEquals(gb.body.lines[1].label, 'VAT 20%');
  assertEquals(gb.body.amountMinor, Math.round(gb.body.total * 100));

  // an unknown country is priced as OTHER (USD, no tax)
  const xx = await quote({ worksheet: 'az-C', address: { country: 'ZZ', line1: '1 Some Road', city: 'Somewhere' } });
  assertEquals([xx.body.country, xx.body.currency, xx.body.total], ['OTHER', 'USD', 0.54]);
});

test('quote: class plans in India and abroad; 12 months is refused for India', async () => {
  const m1 = await quote({ cls: 'kg', plan: 'm1', address: IN_ADDR });
  assertStatus(m1, 200);
  assertEquals([m1.body.kind, m1.body.plan, m1.body.planLabel, m1.body.months, m1.body.total, m1.body.amountMinor], ['class', 'm1', '1 month', 1, 241.8, 24180]);
  assertMatch(m1.body.items[0].expiry, /Every Kindergarten sheet for 1 month/);
  assertEquals((await quote({ cls: 'kg', plan: 'm3', address: IN_ADDR })).body.total, 601.8);

  const y1 = await quote({ cls: 'kg', plan: 'y1', address: US_ADDR });
  assertStatus(y1, 200);
  assertEquals([y1.body.total, y1.body.amountMinor], [18.99, 1899]);

  const no = await quote({ cls: 'kg', plan: 'y1', address: IN_ADDR });
  assertStatus(no, 400);
  assertEquals(no.body.error, 'The 12 months plan is not offered in India — choose 1, 3 or 6 months.');
  assertEquals(no.body.code, 'plan_region');
});

test('quote: things that are not for sale', async () => {
  // a coming-soon class cannot be quoted, neither its plans nor its sheets
  const c1 = await quote({ cls: 'c1', plan: 'm1', address: IN_ADDR });
  assertStatus(c1, 400);
  assertEquals(c1.body.code, 'unavailable');
  assertMatch(c1.body.error, /coming soon/);
  await h.sql`insert into products (id, title, class_id, subject, price_inr, status, pdf_path) values ('c1-test', 'Class 1 sheet', 'c1', 'Maths', 19, 'active', 'uploads/c1-test.pdf')`;
  await withPdf('c1-test');
  const c1s = await quote({ worksheet: 'c1-test', address: IN_ADDR });
  assertStatus(c1s, 400);
  assertEquals(c1s.body.code, 'unavailable');

  // no PDF yet
  const noPdf = await quote({ worksheet: 'az-G', address: IN_ADDR });
  assertStatus(noPdf, 400);
  assertEquals(noPdf.body.code, 'unavailable');
  assertMatch(noPdf.body.error, /being prepared/);

  // archived, draft, unknown, free, sold out
  await withPdf('az-H');
  await h.sql`update products set status = 'archived' where id = 'az-H'`;
  assertEquals((await quote({ worksheet: 'az-H', address: IN_ADDR })).body.code, 'unavailable');
  await h.sql`update products set status = 'draft' where id = 'az-H'`;
  const draft = await quote({ worksheet: 'az-H', address: IN_ADDR });
  assertEquals([draft.status, draft.body.error], [400, 'Unknown worksheet.']);
  await h.sql`update products set status = 'active', stock = 0 where id = 'az-H'`;
  assertMatch((await quote({ worksheet: 'az-H', address: IN_ADDR })).body.error, /sold out/);
  await h.sql`update products set stock = null where id = 'az-H'`;
  assertEquals((await quote({ worksheet: 'nope-1', address: IN_ADDR })).body.error, 'Unknown worksheet.');
  assertEquals((await quote({ worksheet: { id: 'az-C' }, address: IN_ADDR })).body.error, 'Unknown worksheet.');
  const free = await quote({ worksheet: 'az-A', address: IN_ADDR });
  assertEquals([free.status, free.body.error], [400, 'That sheet is free — just open it.']);
  assertEquals((await quote({ cls: 'kg', plan: 'zz', address: IN_ADDR })).body.error, 'Unknown plan or class.');
  assertEquals((await quote({})).body.error, 'Unknown plan or class.');
  await h.sql`update plans set active = false where id = 'm6'`;
  assertEquals((await quote({ cls: 'kg', plan: 'm6', address: IN_ADDR })).body.error, 'Unknown plan or class.');
  await h.sql`update plans set active = true where id = 'm6'`;
});

test('quote: an incomplete address gives a price but no payable quote', async () => {
  await withPdf('az-C');
  const r = await quote({ worksheet: 'az-C', address: { country: 'IN', line1: '12', city: '', state: 'Nowhere', postal: '12' } });
  assertStatus(r, 200);
  assertEquals(r.body.valid, false);
  assertEquals(Object.keys(r.body.errors).sort(), ['city', 'line1', 'postal', 'state']);
  assertEquals(r.body.errors.postal, 'PIN code — 6 digits, e.g. 411001.');
  assertEquals([r.body.quoteId, r.body.sig], [null, null]);
  assertEquals(r.body.total, 25.8);
  // abroad, a postal code is optional but checked when given
  const us = await quote({ worksheet: 'az-C', address: { ...US_ADDR, postal: 'ABC' } });
  assertEquals([us.body.valid, Object.keys(us.body.errors)], [false, ['postal']]);
});

test('quote: payment methods are the country’s methods that the server has configured', async () => {
  await withPdf('az-C');
  h.setEnv({ RAZORPAY_KEY_ID: 'rzp_test_abc', RAZORPAY_KEY_SECRET: 'rzp-secret-value', STRIPE_SECRET_KEY: 'sk_test_abc' });
  try {
    const r = await quote({ worksheet: 'az-C', address: IN_ADDR });
    assertEquals(r.body.methods, ['razorpay', 'stripe']);
    assert(!r.text.includes('rzp-secret-value') && !r.text.includes('sk_test_abc'));
    const s = await stored(r.body.quoteId);
    assertEquals(s.methods, ['razorpay', 'stripe']);
  } finally {
    h.resetEnv();
  }
});

test('quote: class discount and coupons (active, dates, kind, class)', async () => {
  await withPdf('az-C');
  const code = await coupon({ pct: 10 });
  const r = await quote({ worksheet: 'az-C', coupon: code.toLowerCase(), address: IN_ADDR });
  assertStatus(r, 200);
  assertEquals([r.body.coupon, r.body.discountInr, r.body.couponError], [code, 1.9, null]);
  assertEquals(r.body.lines[0].label, 'Base price (after discount)');
  assertEquals(r.body.lines[0].amount, 17.1);
  assertEquals((await stored(r.body.quoteId)).couponCode, code);

  const expired = await coupon({ until: new Date(Date.now() - 60_000).toISOString(), from: new Date(Date.now() - 3600_000).toISOString() });
  const e = await quote({ worksheet: 'az-C', coupon: expired, address: IN_ADDR });
  assertEquals([e.body.coupon, e.body.couponError, e.body.total], [null, 'That code has expired.', 25.8]);
  const later = await coupon({ from: new Date(Date.now() + 3600_000).toISOString() });
  assertEquals((await quote({ worksheet: 'az-C', coupon: later, address: IN_ADDR })).body.couponError, 'That code is not valid yet.');
  const off = await coupon({ active: false });
  assertEquals((await quote({ worksheet: 'az-C', coupon: off, address: IN_ADDR })).body.coupon, null);
  const plansOnly = await coupon({ appliesTo: 'class' });
  assertEquals((await quote({ worksheet: 'az-C', coupon: plansOnly, address: IN_ADDR })).body.couponError, 'That code is only for class plans.');
  assertEquals((await quote({ cls: 'kg', plan: 'm1', coupon: plansOnly, address: IN_ADDR })).body.coupon, plansOnly);
  const c1Only = await coupon({ classId: 'c1' });
  assertEquals((await quote({ worksheet: 'az-C', coupon: c1Only, address: IN_ADDR })).body.couponError, 'That code is only for Class 1.');
  assertEquals((await quote({ worksheet: 'az-C', coupon: 'NO-SUCH-CODE', address: IN_ADDR })).body.couponError, 'That code is not valid.');

  // class discount first, then the coupon on what is left
  await h.sql`update classes set discount_pct = 50 where id = 'kg'`;
  try {
    const d = await quote({ worksheet: 'az-C', coupon: code, address: IN_ADDR });
    assertEquals([d.body.discountInr, d.body.lines[0].amount], [10.45, 8.55]);
  } finally {
    await h.sql`update classes set discount_pct = 0 where id = 'kg'`;
  }
});

test('quote: 60 per minute per IP', async () => {
  const ip = randomIp();
  for (let i = 0; i < 60; i++) assertStatus(await quote({}, { ip }), 400);
  const r = await quote({}, { ip });
  assertStatus(r, 429);
  assertEquals(r.body.code, 'rate_limited');
});

// ── loadQuote / revalidateQuote ──────────────────────────────────────────────────────────

test('loadQuote: expired, unknown or malformed quotes are refused with 409 quote_expired', async () => {
  await withPdf('az-C');
  const r = await quote({ worksheet: 'az-C', address: IN_ADDR });
  await stored(r.body.quoteId);   // fine while fresh
  await h.sql`update quotes set expires_at = now() - interval '1 second' where id = ${r.body.quoteId}`;
  const e = await httpError(stored(r.body.quoteId));
  assertEquals([e.status, e.extra.code], [409, 'quote_expired']);
  assertEquals(e.message, 'This quote is not valid any more — refresh the price and try again.');
  assertEquals((await httpError(stored(crypto.randomUUID()))).extra.code, 'quote_expired');
  assertEquals((await httpError(stored('not-a-uuid'))).extra.code, 'quote_expired');
  // a stored quote that was not payable
  const bad = await h.sql<{ id: string }[]>`
    insert into quotes (expires_at, kind, product_id, country, currency, total, total_inr, amount_minor, valid, payload)
    values (now() + interval '5 minutes', 'worksheet', 'az-C', 'IN', 'INR', 25.8, 25.8, 2580, false, '{}'::jsonb) returning id`;
  const e2 = await httpError(stored(bad[0].id));
  assertEquals([e2.status, e2.extra.code], [400, 'quote_invalid']);
});

test('revalidateQuote: a fresh quote passes; an owned sheet is 409 already_owned', async () => {
  await withPdf('az-C');
  const c = await h.customer();
  const r = await quote({ worksheet: 'az-C', address: IN_ADDR });
  await tx(async (q) => revalidateQuote(q, await loadQuote(q, r.body.quoteId), c.id));

  const gid = await h.grant(c.id, { productId: 'az-C', days: 30 });
  const e = await httpError(tx(async (q) => revalidateQuote(q, await loadQuote(q, r.body.quoteId), c.id)));
  assertEquals([e.status, e.extra.code, e.extra.worksheet], [409, 'already_owned', 'az-C']);
  // expired access can be bought again
  await h.sql`update entitlements set expires_at = now() - interval '1 minute', starts_at = now() - interval '2 days', purchased_at = now() - interval '2 days' where id = ${gid}`;
  await tx(async (q) => revalidateQuote(q, await loadQuote(q, r.body.quoteId), c.id));
});

test('revalidateQuote: sheet withdrawn or price changed since the quote', async () => {
  await withPdf('az-I');
  const c = await h.customer();
  const r = await quote({ worksheet: 'az-I', address: IN_ADDR });
  const check = () => httpError(tx(async (q) => revalidateQuote(q, await loadQuote(q, r.body.quoteId), c.id)));
  await h.sql`update products set price_inr = 29 where id = 'az-I'`;
  assertEquals((await check()).extra.code, 'price_changed');
  await h.sql`update products set price_inr = 19, status = 'archived' where id = 'az-I'`;
  const gone = await check();
  assertEquals([gone.status, gone.extra.code], [410, 'unavailable']);
  await h.sql`update products set status = 'active' where id = 'az-I'`;
  await h.sql`update classes set status = 'coming_soon' where id = 'kg'`;
  try {
    assertEquals((await check()).extra.code, 'unavailable');
  } finally {
    await h.sql`update classes set status = 'available' where id = 'kg'`;
  }
  await h.setSetting('fees', { IN: { pct: 3, fixed: 3 }, INTL: { pct: 3.9, fixed: 0.3 } });
  try {
    assertEquals((await check()).extra.code, 'price_changed');
  } finally {
    await h.setSetting('fees', { IN: { pct: 2, fixed: 3 }, INTL: { pct: 3.9, fixed: 0.3 } });
  }
  await tx(async (q) => revalidateQuote(q, await loadQuote(q, r.body.quoteId), c.id));
});

test('revalidateQuote: coupon applied, expired since, and usage limits counted at order time', async () => {
  await withPdf('az-J');
  const a = await h.customer();
  const b = await h.customer();
  const run = (id: string, userId: string) => tx(async (q) => revalidateQuote(q, await loadQuote(q, id), userId));

  // applied and still valid
  const ok = await coupon({ pct: 20, max: 5 });
  const qOk = await quote({ worksheet: 'az-J', coupon: ok, address: IN_ADDR });
  assertEquals(qOk.body.coupon, ok);
  await run(qOk.body.quoteId, a.id);

  // expired after the quote was made
  const soon = await coupon({ pct: 20 });
  const qSoon = await quote({ worksheet: 'az-J', coupon: soon, address: IN_ADDR });
  assertEquals(qSoon.body.coupon, soon);
  await h.sql`update coupons set valid_until = now() - interval '1 second', valid_from = now() - interval '1 day' where code = ${soon}`;
  const e1 = await httpError(run(qSoon.body.quoteId, a.id));
  assertEquals([e1.status, e1.extra.code], [400, 'coupon_invalid']);
  assertMatch(e1.message, /expired/);

  // max_uses: used up by another customer's paid order
  const once = await coupon({ pct: 20, max: 1 });
  const qOnce = await quote({ worksheet: 'az-J', coupon: once, address: IN_ADDR });
  assertEquals(qOnce.body.coupon, once);
  await paidOrder(b, { coupon: once });
  const e2 = await httpError(run(qOnce.body.quoteId, a.id));
  assertEquals([e2.status, e2.extra.code], [400, 'coupon_invalid']);
  assertMatch(e2.message, /used up/);
  // ...and the quote no longer applies it either
  const again = await quote({ worksheet: 'az-J', coupon: once, address: IN_ADDR });
  assertEquals([again.body.coupon, again.body.couponError], [null, 'That code has been used up.']);

  // a paid order without a redemption row counts too (paid orders + redemptions, not twice)
  const two = await coupon({ pct: 20, max: 2 });
  const qTwo = await quote({ worksheet: 'az-J', coupon: two, address: IN_ADDR });
  await paidOrder(b, { coupon: two, redeem: false });
  await run(qTwo.body.quoteId, a.id);   // 1 of 2 used
  await paidOrder(b, { coupon: two });
  assertEquals((await httpError(run(qTwo.body.quoteId, a.id))).extra.code, 'coupon_invalid');

  // an unpaid order holds a use for as long as the gateway can still take its payment (until it is
  // paid, cancelled or expires after 48 hours) — the customer's own unpaid order included
  const held = await coupon({ pct: 20, max: 1 });
  const qHeld = await quote({ worksheet: 'az-J', coupon: held, address: IN_ADDR });
  await paidOrder(b, { coupon: held, status: 'created' });
  assertEquals((await httpError(run(qHeld.body.quoteId, a.id))).extra.code, 'coupon_invalid');
  const own = await httpError(run(qHeld.body.quoteId, b.id));
  assertEquals(own.extra.code, 'coupon_invalid');
  assertMatch(own.message, /unpaid order of yours/);
  await h.sql`update orders set created_at = now() - interval '2 hours' where coupon_code = ${held}`;
  assertEquals((await httpError(run(qHeld.body.quoteId, a.id))).extra.code, 'coupon_invalid', 'still payable after 2 hours');
  await h.sql`update orders set created_at = now() - interval '49 hours' where coupon_code = ${held}`;
  await run(qHeld.body.quoteId, a.id);
  await h.sql`update orders set created_at = now(), status = 'cancelled', cancelled_at = now() where coupon_code = ${held}`;
  await run(qHeld.body.quoteId, a.id);   // a cancelled order holds nothing

  // per-customer limit
  const perUser = await coupon({ pct: 20, perUser: 1 });
  const qPer = await quote({ worksheet: 'az-J', coupon: perUser, address: IN_ADDR });
  await paidOrder(a, { coupon: perUser, productId: 'az-K' });
  const e3 = await httpError(run(qPer.body.quoteId, a.id));
  assertEquals(e3.extra.code, 'coupon_invalid');
  assertMatch(e3.message, /already used/);
  await run(qPer.body.quoteId, b.id);

  // deactivated
  await h.sql`update coupons set active = false where code = ${ok}`;
  assertEquals((await httpError(run(qOk.body.quoteId, a.id))).extra.code, 'coupon_invalid');
});

// ── GET /api/me/orders ───────────────────────────────────────────────────────────────────

test('me/orders: only the caller’s orders, newest first, with each line’s access record', async () => {
  const a = await h.customer();
  const b = await h.customer();
  const old = await paidOrder(a, { productId: 'az-L', createdAgo: '2 days' });
  const recent = await paidOrder(a, { productId: 'az-M' });
  await paidOrder(b, { productId: 'az-N' });
  await h.sql`
    insert into entitlements (user_id, scope, product_id, kind, order_id, order_item_id, purchased_at, starts_at, expires_at)
    values (${a.id}, 'worksheet', 'az-M', 'paid', ${recent.id}, ${recent.itemId}, now(), now(), now() + interval '365 days'),
           (${a.id}, 'worksheet', 'az-L', 'paid', ${old.id}, ${old.itemId}, now() - interval '400 days', now() - interval '400 days', now() - interval '35 days')`;

  const r = await h.call('GET', '/api/me/orders', { token: a.token });
  assertStatus(r, 200);
  const orders = r.body.orders as Record<string, any>[];
  assertEquals(orders.map((o) => o.id), [recent.id, old.id]);
  const o = orders[0];
  for (const k of ['id', 'at', 'kind', 'cls', 'plan', 'worksheet', 'currency', 'total', 'totalInr', 'lines', 'coupon', 'address', 'method', 'status', 'paidAt', 'gatewayOrderId', 'paymentId']) assert(k in o, `field ${k}`);
  assertEquals([o.worksheet, o.cls, o.status, o.total, o.totalInr, o.currency], ['az-M', 'kg', 'paid', 25.8, 25.8, 'INR']);
  assert(typeof o.paidAt === 'number' && typeof o.at === 'number');
  assertEquals(o.lines[0].entitlement.status, 'active');
  assert(typeof o.lines[0].entitlement.purchasedAt === 'number' && typeof o.lines[0].entitlement.startsAt === 'number');
  assertMatch(o.lines[0].entitlement.expiresAt, /^\d{4}-\d\d-\d\dT/);
  assertEquals(orders[1].lines[0].entitlement.status, 'expired');
  assert(!r.text.includes(b.id) && !r.text.includes('az-N'), 'nothing of the other customer');

  const rb = await h.call('GET', '/api/me/orders', { token: b.token });
  assertEquals((rb.body.orders as { worksheet: string }[]).map((x) => x.worksheet), ['az-N']);

  const anon = await h.call('GET', '/api/me/orders');
  assertStatus(anon, 401);
  assertEquals(anon.body.code, 'signin');
});

// ── GET /api/me/entitlements ─────────────────────────────────────────────────────────────

test('me/entitlements: every record of the caller with its status (expired, revoked, scheduled)', async () => {
  const a = await h.customer();
  const b = await h.customer();
  const live = await h.grant(a.id, { productId: 'az-O', days: 30 });
  const expired = await h.grant(a.id, { productId: 'az-P', days: -1 });
  const revoked = await h.grant(a.id, { productId: 'az-Q', days: 30 });
  await h.sql`update entitlements set revoked_at = now(), revoke_reason = 'refund' where id = ${revoked}`;
  const plan = await h.grant(a.id, { classId: 'kg', days: 60, startsInDays: 10 });
  const free = (await h.sql<{ id: number }[]>`
    insert into entitlements (user_id, scope, product_id, kind) values (${a.id}, 'worksheet', 'az-R', 'free') returning id`)[0].id;
  const others = await h.grant(b.id, { productId: 'az-S', days: 30 });

  const r = await h.call('GET', '/api/me/entitlements', { token: a.token });
  assertStatus(r, 200);
  const list = r.body.entitlements as Record<string, any>[];
  const byId = new Map(list.map((e) => [e.id, e]));
  const get = (id: number): Record<string, any> => byId.get(id) ?? {};
  assertEquals(list.length, 5);
  assert(!byId.has(others), 'never another customer’s record');
  assertEquals(get(live).status, 'active');
  assertEquals(get(live).active, true);
  assertEquals([get(expired).status, get(expired).active], ['expired', false]);
  assertEquals(get(revoked).status, 'revoked');
  assertEquals([get(plan).status, get(plan).scope, get(plan).cls], ['scheduled', 'class', 'kg']);
  assertEquals(get(free).status, 'lapsed', 'a free pass for a sheet that costs money now');
  assertEquals(get(live).worksheet, 'az-O');
  assertEquals(get(live).title, 'Alphabet O — tracing sheet');
  assertMatch(get(live).expiresAt, /^\d{4}-/);
  assert(typeof get(live).end === 'number' && typeof get(live).start === 'number');
  assert(!/revoke_reason|refund|user_id/.test(r.text));
  assertEquals([r.body.accessDays, r.body.accessHours, r.body.accessStatus], [1, 24, 'active']);
  assert(Math.abs(r.body.now - Date.now()) < 60_000);

  // works while paid access is suspended, and says so
  await h.sql`update profiles set subscription_suspended_at = now(), suspension_reason = 'staff' where id = ${a.id}`;
  const s = await h.call('GET', '/api/me/entitlements', { token: a.token });
  assertStatus(s, 200);
  assertEquals(s.body.accessStatus, 'suspended');

  const rb = await h.call('GET', '/api/me/entitlements', { token: b.token });
  assertEquals((rb.body.entitlements as { id: number }[]).map((e) => e.id), [others]);
  assertStatus(await h.call('GET', '/api/me/entitlements'), 401);
});

test('a running plan: a new quote says when the next plan would start', async () => {
  const a = await h.customer();
  await h.grant(a.id, { classId: 'kg', days: 20 });
  const r = await quote({ cls: 'kg', plan: 'm1', address: IN_ADDR }, { token: a.token });
  assertStatus(r, 200);
  assertMatch(r.body.items[0].expiry, /^Starts .*when your current plan ends/);
  assert(r.body.items[0].startsAt > Date.now() + 19 * 86_400_000);
});

test('DATA-2 per-customer entitlement reads use an index (me/entitlements, live-access counts)', async () => {
  // with sequential scans priced out the planner takes any usable index; a Seq Scan left over means there is none
  const plans = await h.sql.begin(async (q) => {
    await q`set local enable_seqscan = off`;
    const u = '00000000-0000-4000-8000-000000000001';
    const mine = await q<{ 'QUERY PLAN': string }[]>`
      explain select e.id from entitlements e where e.user_id = ${u}::uuid order by e.starts_at desc, e.id desc limit 500`;
    const live = await q<{ 'QUERY PLAN': string }[]>`
      explain select count(*) from entitlements e where e.user_id = ${u}::uuid and e.revoked_at is null
        and e.starts_at <= now() and (e.expires_at is null or e.expires_at > now())`;
    return { mine: mine.map((r) => r['QUERY PLAN']).join('\n'), live: live.map((r) => r['QUERY PLAN']).join('\n') };
  });
  assert(!/Seq Scan on entitlements/.test(plans.mine), plans.mine);
  assert(!/Seq Scan on entitlements/.test(plans.live), plans.live);
  assertMatch(plans.mine, /entitlements_user/);
});
