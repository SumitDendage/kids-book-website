// The full admin panel (Oct 22): subjects, academic sessions, the new product fields, duplicate and
// gallery, the website's lists (Admin → Homepage) and the bigger coupons (fixed amount, minimum
// order, largest discount, chosen products or categories), checked through the real API.
import { assert, assertEquals, assertStatus, samplePdf, startHarness, test, type Harness, type TestUser } from './harness.ts';
import { installGatewayFakes } from './fakes/gateways.ts';

const h: Harness = await startHarness();
const gw = await installGatewayFakes(h);
const admin = await h.staff('admin');
const support = await h.staff('support');
const IN_ADDR = { country: 'IN', line1: '12 MG Road', city: 'Pune', state: 'Maharashtra', postal: '411001' };
for (const id of ['az-C', 'az-D', 'az-E', 'az-F', 'az-G', 'az-H']) await h.uploadPdfFor(id);

// deno-lint-ignore no-explicit-any
type Any = any;
const listed = async (): Promise<Any> => (await h.call('GET', '/api/worksheets')).body;
const put = (id: string, body: Record<string, unknown>, token = admin.token) => h.call('PUT', '/api/admin/worksheets/' + id, { token, body });
const auditRows = (action: string, id: string) => h.sql<Any[]>`select * from audit_logs where action = ${action} and target_id = ${id}`;
const png = () => {
  const b = new Uint8Array(64);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return b;
};

// ── subjects ─────────────────────────────────────────────────────────────────────────────────

test('subjects: listed with counts, staff add, rename (follows to products), switch off, and delete only when unused', async () => {
  const all = await h.call('GET', '/api/admin/subjects', { token: support.token });
  assertStatus(all, 200);
  assertEquals(all.body.subjects.map((s: Any) => s.name), ['English', 'Maths', 'Science']);
  assert(all.body.subjects[0].products > 100, 'English counts its products');
  assertStatus(await h.call('POST', '/api/admin/subjects', { token: support.token, body: { name: 'Hindi' } }), 403);

  const made = await h.call('POST', '/api/admin/subjects', { token: admin.token, body: { name: 'General Knowledge', sort: 40 } });
  assertStatus(made, 201);
  assertEquals([made.body.subject.id, made.body.subject.name], ['general-knowledge', 'General Knowledge']);
  assertStatus(await h.call('POST', '/api/admin/subjects', { token: admin.token, body: { name: 'General Knowledge' } }), 409);
  assertEquals((await auditRows('subject.create', 'general-knowledge')).length, 1);

  // a product moved to it; a rename follows to the product
  assertStatus(await put('az-J', { subject: 'General Knowledge' }), 200);
  const ren = await h.call('PUT', '/api/admin/subjects/general-knowledge', { token: admin.token, body: { name: 'GK' } });
  assertStatus(ren, 200);
  assertEquals((await h.sql`select subject from products where id = 'az-J'`)[0].subject, 'GK');

  // in use: cannot delete; switched off it leaves the public list and new products cannot pick it
  const del = await h.call('DELETE', '/api/admin/subjects/general-knowledge', { token: admin.token });
  assertEquals([del.status, del.body.code], [409, 'in_use']);
  assertStatus(await h.call('PUT', '/api/admin/subjects/general-knowledge', { token: admin.token, body: { active: false } }), 200);
  assert(!(await listed()).subjects.some((s: Any) => s.name === 'GK'), 'switched-off subjects leave the public list');
  const bad = await h.call('POST', '/api/admin/worksheets', { token: admin.token, body: { title: 'Quiz', subject: 'GK', cls: 'kg' } });
  assertEquals([bad.status, Object.keys(bad.body.errors)], [400, ['subject']]);
  // the product that already has it can still be saved
  assertStatus(await put('az-J', { title: 'J tracing' }), 200);
  // a subject nobody uses can be deleted
  assertStatus(await put('az-J', { subject: 'English' }), 200);
  const gone = await h.call('DELETE', '/api/admin/subjects/general-knowledge', { token: admin.token });
  assertStatus(gone, 200);
  assertEquals(gone.body.subjects.length, 3);
});

// ── academic sessions ────────────────────────────────────────────────────────────────────────

test('academic sessions: one current at a time, products join them, the catalogue shows them, delete only when unused', async () => {
  const all = await h.call('GET', '/api/admin/sessions', { token: support.token });
  assertEquals(all.body.sessions.map((s: Any) => [s.id, s.current]), [['2026-27', true]]);
  const made = await h.call('POST', '/api/admin/sessions', { token: admin.token, body: { label: '2027-28', startsOn: '2027-04-01', endsOn: '2028-03-31', current: true } });
  assertStatus(made, 201);
  assertEquals(made.body.sessions.map((s: Any) => [s.id, s.current]), [['2026-27', false], ['2027-28', true]]);
  assertStatus(await h.call('POST', '/api/admin/sessions', { token: admin.token, body: { label: 'Bad', startsOn: '2027-04-01', endsOn: '2027-01-01' } }), 400);

  assertStatus(await put('az-K', { sessions: ['2026-27', '2027-28'] }), 200);
  assertStatus(await put('az-K', { sessions: ['1999-00'] }), 400);
  const w = (await listed()).worksheets.find((x: Any) => x.id === 'az-K');
  assertEquals(w.sessions, ['2026-27', '2027-28']);
  assertEquals((await listed()).sessions.map((s: Any) => s.id), ['2026-27', '2027-28']);
  const a = await auditRows('worksheet.update', 'az-K');
  assertEquals(a[a.length - 1].detail.after.sessions, ['2026-27', '2027-28']);

  const del = await h.call('DELETE', '/api/admin/sessions/2027-28', { token: admin.token });
  assertEquals([del.status, del.body.code], [409, 'in_use']);
  assertStatus(await put('az-K', { sessions: [] }), 200);
  assertStatus(await h.call('DELETE', '/api/admin/sessions/2027-28', { token: admin.token }), 200);
});

// ── product fields, duplicate, gallery ───────────────────────────────────────────────────────

test('product fields: short description, SKU (unique), language, age group, SEO; shown to staff and in the catalogue', async () => {
  const r = await put('az-L', {
    shortDescription: 'Trace big and small L.', sku: 'KG-AZ-L', language: 'English', ageGroup: '3-5 years',
    seoTitle: 'Letter L tracing worksheet', seoDescription: 'Printable letter L tracing for kindergarten.',
  });
  assertStatus(r, 200);
  const ws = r.body.worksheet;
  assertEquals([ws.shortDescription, ws.sku, ws.language, ws.ageGroup, ws.seoTitle], ['Trace big and small L.', 'KG-AZ-L', 'English', '3-5 years', 'Letter L tracing worksheet']);
  const dup = await put('az-M', { sku: 'kg-az-l' });
  assertEquals([dup.status, dup.body.code], [409, 'sku_taken']);
  assertStatus(await put('az-M', { sku: 'has space' }), 400);
  assertStatus(await put('az-M', { seoTitle: 'x'.repeat(71) }), 400);
  const pub = (await listed()).worksheets.find((x: Any) => x.id === 'az-L');
  assertEquals([pub.shortDescription, pub.ageGroup, pub.seoDescription], ['Trace big and small L.', '3-5 years', 'Printable letter L tracing for kindergarten.']);
  assert(pub.sku === undefined, 'the SKU is for staff only');
});

test('duplicate: a draft copy with the same details and sessions, no PDF, no labels, no gallery', async () => {
  await put('az-N', { sessions: ['2026-27'], tags: ['featured'], wasPrice: 30, price: 25 });
  const r = await h.call('POST', '/api/admin/worksheets/az-N/duplicate', { token: admin.token });
  assertStatus(r, 201);
  const c = r.body.worksheet;
  assert(c.id !== 'az-N' && c.title.endsWith('(copy)'), 'a new id and "(copy)" in the title');
  assertEquals([c.status, c.available, c.price, c.wasPrice, c.sessions, c.tags, c.gallery], ['draft', false, 25, 30, ['2026-27'], [], []]);
  assert(!(await listed()).worksheets.some((x: Any) => x.id === c.id), 'the copy is not on the website');
  assertStatus(await h.call('POST', '/api/admin/worksheets/az-N/duplicate', { token: support.token }), 403);
  // a copy nobody bought can be deleted for good; the original stays
  assertStatus(await h.call('DELETE', '/api/admin/worksheets/' + c.id + '?hard=1', { token: admin.token }), 200);
  assertEquals((await h.sql`select count(*)::int as n from products where id = 'az-N'`)[0].n, 1);
});

test('gallery: pictures upload to the public covers bucket, reorder and remove through PUT, at most 8', async () => {
  const up = await h.call('POST', '/api/admin/worksheets/az-O/gallery', { token: admin.token, raw: png(), contentType: 'image/png' });
  assertStatus(up, 200);
  const p1 = up.body.picture.path;
  assert(/^az-O\/gallery\/[a-z0-9]+\.png$/.test(p1), p1);
  const up2 = await h.call('POST', '/api/admin/worksheets/az-O/gallery', { token: admin.token, raw: png(), contentType: 'image/png' });
  const p2 = up2.body.picture.path;
  assertEquals(up2.body.worksheet.gallery, [p1, p2]);
  assertStatus(await h.call('POST', '/api/admin/worksheets/az-O/gallery', { token: admin.token, raw: new TextEncoder().encode('not a picture at all, sorry, not at all'), contentType: 'image/png' }), 400);

  const re = await put('az-O', { gallery: [p2, p1] });
  assertEquals(re.body.worksheet.gallery, [p2, p1]);
  assertStatus(await put('az-O', { gallery: [p2, 'az-O/gallery/abcdef1.png'] }), 400);
  const rm = await put('az-O', { gallery: [p2] });
  assertEquals(rm.body.worksheet.gallery, [p2]);
  assert(!h.storage.has('covers', p1) && h.storage.has('covers', p2), 'a removed picture leaves storage');
  const pub = (await listed()).worksheets.find((x: Any) => x.id === 'az-O');
  assertEquals(pub.gallery.length, 1);
  assert(pub.gallery[0].includes('/covers/' + p2), pub.gallery[0]);
});

// ── the website's lists (Admin → Homepage) ───────────────────────────────────────────────────

test('lists: the six built-in ones start from today\'s labels; staff pick and order sheets, and labels follow', async () => {
  const all = await h.call('GET', '/api/admin/home-sections', { token: support.token });
  assertStatus(all, 200);
  assertEquals(all.body.sections.map((s: Any) => s.id), ['picked', 'new', 'bestsellers', 'featured', 'popular', 'recommended']);
  const best = all.body.sections.find((s: Any) => s.id === 'bestsellers');
  assertEquals([best.mode, best.items.length], ['manual', 7]);

  assertStatus(await h.call('PUT', '/api/admin/home-sections/picked/items', { token: support.token, body: { products: ['az-C'] } }), 403);
  const r = await h.call('PUT', '/api/admin/home-sections/picked/items', { token: admin.token, body: { products: ['az-E', 'az-C', 'az-D'] } });
  assertStatus(r, 200);
  assertEquals([r.body.section.items, r.body.section.shown], [['az-E', 'az-C', 'az-D'], ['az-E', 'az-C', 'az-D']]);
  // the 'home' label follows the list, both ways
  assertEquals((await h.sql`select id from products where 'home' = any(tags) order by id`).map((x) => x.id), ['az-C', 'az-D', 'az-E']);
  await put('az-F', { tags: ['home'] });
  const after = (await h.call('GET', '/api/admin/home-sections', { token: admin.token })).body.sections.find((s: Any) => s.id === 'picked');
  assertEquals(after.items, ['az-E', 'az-C', 'az-D', 'az-F']);
  // taking a sheet off the list leaves the sheet alone
  const r2 = await h.call('PUT', '/api/admin/home-sections/picked/items', { token: admin.token, body: { products: ['az-D', 'az-E'] } });
  assertEquals(r2.body.section.items, ['az-D', 'az-E']);
  assertEquals((await h.sql`select status, tags from products where id = 'az-C'`)[0].status, 'active');
  assert(!(await h.sql`select tags from products where id = 'az-C'`)[0].tags.includes('home'), 'the label goes with it');
  // the public catalogue gives each visible list with its sheets in order
  const pub = (await listed()).homeSections.find((s: Any) => s.id === 'picked');
  assertEquals([pub.title, pub.placement, pub.products], ['Picked for you', 'home', ['az-D', 'az-E']]);
  // a sheet taken off the website drops out of every list by itself
  await put('az-D', { status: 'draft' });
  assertEquals((await listed()).homeSections.find((s: Any) => s.id === 'picked').products, ['az-E']);
  await put('az-D', { status: 'active' });
  assertStatus(await h.call('PUT', '/api/admin/home-sections/picked/items', { token: admin.token, body: { products: ['no-such-sheet'] } }), 400);
  assertEquals((await auditRows('home_section.items', 'picked')).length, 2);
});

test('lists: headings, visibility and order change; built-in ones cannot change kind or be deleted; hand-picked lists stay manual', async () => {
  const r = await h.call('PUT', '/api/admin/home-sections/featured', { token: admin.token, body: { title: 'Teacher favourites', subtitle: 'Loved in class', sort: 5 } });
  assertStatus(r, 200);
  assertEquals([r.body.section.title, r.body.section.subtitle, r.body.section.sort], ['Teacher favourites', 'Loved in class', 5]);
  const hide = await h.call('PUT', '/api/admin/home-sections/popular', { token: admin.token, body: { visible: false } });
  assertEquals(hide.body.section.visible, false);
  assert(!(await listed()).homeSections.some((s: Any) => s.id === 'popular'), 'hidden lists leave the website');
  assertEquals((await h.call('PUT', '/api/admin/home-sections/featured', { token: admin.token, body: { mode: 'auto' } })).status, 400);
  assertEquals((await h.call('PUT', '/api/admin/home-sections/new', { token: admin.token, body: { kind: 'free' } })).body.code, 'builtin');
  assertEquals((await h.call('DELETE', '/api/admin/home-sections/new', { token: admin.token })).body.code, 'builtin');
});

test('lists: staff add automatic rows (class, subject, section, free, discounted) and delete them', async () => {
  const mk = (body: Record<string, unknown>) => h.call('POST', '/api/admin/home-sections', { token: admin.token, body });
  const kg = await mk({ title: 'Kindergarten picks', kind: 'class', filter: 'kg', maxItems: 4 });
  assertStatus(kg, 201);
  assertEquals([kg.body.section.id, kg.body.section.mode, kg.body.section.shown.length], ['kindergarten-picks', 'auto', 4]);
  assertStatus(await mk({ title: 'Nowhere', kind: 'class', filter: 'zz' }), 400);
  assertStatus(await mk({ title: 'No filter', kind: 'subject' }), 400);
  const free = await mk({ title: 'Try these free', kind: 'free', maxItems: 48 });
  const freeIds = new Set(((await listed()).worksheets as Any[]).filter((w) => w.price === 0).map((w) => w.id));
  assert(free.body.section.shown.length > 0 && free.body.section.shown.every((id: string) => freeIds.has(id)), 'only free sheets');
  await put('az-G', { wasPrice: 40, price: 20 });
  const disc = await mk({ title: 'On offer', kind: 'discounted', placement: 'shop' });
  assertEquals(disc.body.section.shown[0], 'az-G');
  const sec = await mk({ title: 'Tracing', kind: 'section', filter: 'letter-tracing', maxItems: 3 });
  assertEquals(sec.body.section.shown.length, 3);
  const pub = (await listed()).homeSections.map((s: Any) => s.id);
  assert(pub.includes('kindergarten-picks') && pub.includes('on-offer'), pub.join());
  assertStatus(await h.call('DELETE', '/api/admin/home-sections/on-offer', { token: admin.token }), 200);
  assertEquals((await h.sql`select count(*)::int as n from products where id = 'az-G'`)[0].n, 1);
});

test('best sellers: automatic mode counts paid orders only, manual mode keeps the hand-picked list', async () => {
  const buyer = await h.customer();
  const order = async (id: string, product: string, status: 'paid' | 'created') => {
    await h.sql`
      insert into orders (id, user_id, kind, status, currency, rate, total, total_inr, amount_minor, lines, method, paid_at)
      values (${id}, ${buyer.id}, 'worksheet', ${status}, 'INR', 1, 25, 25, 2500, ${h.sql.json([])}, 'razorpay', ${status === 'paid' ? new Date() : null})`;
    await h.sql`insert into order_items (order_id, kind, product_id, title, access_days, unit_price_inr) values (${id}, 'worksheet', ${product}, 'x', 1, 19)`;
  };
  await order('LWO-BEST01', 'az-H', 'paid');
  await order('LWO-BEST02', 'az-H', 'paid');
  await order('LWO-BEST03', 'az-G', 'paid');
  await order('LWO-BEST04', 'az-F', 'created');
  await order('LWO-BEST05', 'az-F', 'created');
  await order('LWO-BEST06', 'az-F', 'created');
  const auto = await h.call('PUT', '/api/admin/home-sections/bestsellers', { token: admin.token, body: { mode: 'auto', autoDays: 30 } });
  assertStatus(auto, 200);
  assertEquals(auto.body.section.shown, ['az-H', 'az-G']);
  assertEquals((await listed()).homeSections.find((s: Any) => s.id === 'bestsellers').products, ['az-H', 'az-G']);
  const manual = await h.call('PUT', '/api/admin/home-sections/bestsellers', { token: admin.token, body: { mode: 'manual' } });
  assertEquals(manual.body.section.shown.length, 7);
});

// ── coupons ──────────────────────────────────────────────────────────────────────────────────

const coupon = (body: Record<string, unknown>) => h.call('POST', '/api/admin/coupons', { token: admin.token, body });
const quote = (c: TestUser, worksheets: string[], code: string) =>
  h.call('POST', '/api/quote', { token: c.token, body: { worksheets, address: IN_ADDR, coupon: code } });
const discounts = (r: Any) => r.body.items.map((i: Any) => i.discountInr);

test('coupons: a fixed amount comes off the order, shared across the sheets, never below zero', async () => {
  const r = await coupon({ code: 'TENOFF', kind: 'fixed', amountInr: 10 });
  assertStatus(r, 200);
  assertEquals([r.body.coupon.kind, r.body.coupon.pct, r.body.coupon.amountInr], ['fixed', null, 10]);
  const c = await h.customer();
  const q = await quote(c, ['az-C', 'az-D'], 'TENOFF');
  assertStatus(q, 200);
  assertEquals([q.body.coupon, q.body.discountInr, discounts(q)], ['TENOFF', 10, [5, 5]]);
  const big = await coupon({ code: 'HUNDREDOFF', kind: 'fixed', amountInr: 100 });
  assertStatus(big, 200);
  const q2 = await quote(c, ['az-C'], 'HUNDREDOFF');
  // never more than the sheet's price
  assertEquals(q2.body.discountInr, 19);
  assertStatus(await coupon({ code: 'NOAMOUNT', kind: 'fixed' }), 400);
  assertStatus(await coupon({ code: 'NEGATIVE', kind: 'fixed', amountInr: -5 }), 400);
});

test('coupons: a percentage with a largest discount, and a minimum order', async () => {
  await coupon({ code: 'HALFCAP', pct: 50, maxDiscountInr: 12 });
  const c = await h.customer();
  const q = await quote(c, ['az-C', 'az-D'], 'HALFCAP');
  assertEquals([q.body.discountInr, discounts(q)], [12, [6, 6]]);
  await coupon({ code: 'MIN30', pct: 10, minOrderInr: 30 });
  const one = await quote(c, ['az-C'], 'MIN30');
  assertEquals([one.body.coupon, one.body.couponError], [null, 'That code needs an order of at least ₹30.']);
  const two = await quote(c, ['az-C', 'az-D'], 'MIN30');
  assertEquals([two.body.coupon, two.body.discountInr], ['MIN30', 3.8]);
});

test('coupons: limited to chosen products or categories, only those sheets get the discount', async () => {
  const bad = await coupon({ code: 'NOSUCH', pct: 10, productIds: ['nope-nope'] });
  assertStatus(bad, 400);
  assertStatus(await coupon({ code: 'PLANSONLY', pct: 10, productIds: ['az-C'], appliesTo: 'class' }), 400);
  await coupon({ code: 'ONLYC', pct: 50, productIds: ['az-C'] });
  const c = await h.customer();
  const q = await quote(c, ['az-C', 'az-D'], 'ONLYC');
  assertEquals(discounts(q), [9.5, 0]);
  const none = await quote(c, ['az-D'], 'ONLYC');
  assertEquals(none.body.couponError, 'That code does not work on these sheets.');
  await coupon({ code: 'TRACING', pct: 10, sectionIds: ['letter-tracing'] });
  await put('az-D', { section: 'letter-tracing' });
  await put('az-E', { section: 'missing-letters' });
  const s = await quote(c, ['az-D', 'az-E'], 'TRACING');
  assertEquals(discounts(s), [1.9, 0]);
  const list = await h.call('GET', '/api/admin/coupons', { token: admin.token });
  const onlyc = list.body.coupons.find((x: Any) => x.code === 'ONLYC');
  assertEquals([onlyc.productIds, onlyc.sectionIds, onlyc.minOrderInr, onlyc.maxDiscountInr], [['az-C'], [], 0, null]);
});

test('coupons: the order keeps the price and discount; a paid order redeems the code once; changing the coupon after the quote refuses the order', async () => {
  await coupon({ code: 'ORDER5', kind: 'fixed', amountInr: 5, perUserLimit: 1 });
  const c = await h.customer();
  const q = await quote(c, ['az-E'], 'ORDER5');
  assertEquals(q.body.discountInr, 5);
  const o = await h.call('POST', '/api/pay/order', { token: c.token, body: { quoteId: q.body.quoteId, method: 'razorpay' } });
  assertStatus(o, 200);
  const pay = await gw.razorpay.pay(o.body.gateway.razorpay_order_id);
  const v = await h.call('POST', '/api/pay/verify', { token: c.token, body: { order_id: o.body.order.id, razorpay_order_id: o.body.gateway.razorpay_order_id, razorpay_payment_id: pay.paymentId, razorpay_signature: pay.signature } });
  assertStatus(v, 200);
  const row = (await h.sql<Any[]>`select status, discount_inr::float8 as d, coupon_code::text as code from orders where id = ${o.body.order.id}`)[0];
  assertEquals([row.status, row.d, row.code], ['paid', 5, 'ORDER5']);
  const item = (await h.sql<Any[]>`select unit_price_inr, discount_inr::float8 as d from order_items where order_id = ${o.body.order.id}`)[0];
  assertEquals([item.unit_price_inr, item.d], [19, 5]);
  assertEquals((await h.sql`select count(*)::int as n from coupon_redemptions where coupon_code = 'ORDER5'`)[0].n, 1);
  // the same customer cannot use it again
  const again = await quote(c, ['az-F'], 'ORDER5');
  assertEquals(again.body.couponError, 'You have already used that code.');

  // a coupon changed between quote and order: the order is refused, never charged the old price
  await coupon({ code: 'SHRINK', kind: 'fixed', amountInr: 8 });
  const d = await h.customer();
  const q2 = await quote(d, ['az-F'], 'SHRINK');
  assertStatus(await h.call('PUT', '/api/admin/coupons/SHRINK', { token: admin.token, body: { amountInr: 2 } }), 200);
  const o2 = await h.call('POST', '/api/pay/order', { token: d.token, body: { quoteId: q2.body.quoteId, method: 'razorpay' } });
  assertEquals([o2.status, o2.body.code], [409, 'price_changed']);
  // an edited product keeps the order history: the paid order still shows what was paid
  await put('az-E', { title: 'Renamed E', price: 29 });
  assertEquals((await h.sql<Any[]>`select unit_price_inr from order_items where order_id = ${o.body.order.id}`)[0].unit_price_inr, 19);
});

test('coupons: switching between percentage and fixed clears the other value', async () => {
  await coupon({ code: 'SWITCH', pct: 15 });
  const f = await h.call('PUT', '/api/admin/coupons/SWITCH', { token: admin.token, body: { kind: 'fixed', amountInr: 7 } });
  assertEquals([f.body.coupon.kind, f.body.coupon.pct, f.body.coupon.amountInr], ['fixed', null, 7]);
  const p = await h.call('PUT', '/api/admin/coupons/SWITCH', { token: admin.token, body: { pct: 20 } });
  assertEquals([p.body.coupon.kind, p.body.coupon.pct, p.body.coupon.amountInr], ['percent', 20, null]);
  assertStatus(await h.call('PUT', '/api/admin/coupons/SWITCH', { token: admin.token, body: { kind: 'fixed' } }), 400);
  assertStatus(await h.call('POST', '/api/admin/coupons', { token: support.token, body: { code: 'NOPE1', kind: 'fixed', amountInr: 5 } }), 403);
});

// ── who may read what directly (row security) ────────────────────────────────────────────────

test('row security: browsers read only visible lists and active subjects; they write nothing', async () => {
  await h.sql`update home_sections set visible = false where id = 'recommended'`;
  const rows = await h.sql.begin(async (q) => {
    await q`set local role anon`;
    const lists = await q<{ id: string }[]>`select id from home_sections order by id`;
    const subjects = await q<{ name: string }[]>`select name from subjects order by name`;
    let wrote = true;
    try { await q.savepoint((sp) => sp`insert into subjects (id, name) values ('hack', 'Hack')`); } catch { wrote = false; }
    return { lists: lists.map((x) => x.id), subjects: subjects.map((x) => x.name), wrote };
  }).catch((e) => ({ error: String(e) }));
  assert(!('error' in rows), JSON.stringify(rows));
  const r = rows as { lists: string[]; subjects: string[]; wrote: boolean };
  assert(!r.lists.includes('recommended') && r.lists.includes('picked'), r.lists.join());
  assert(!r.wrote, 'anon cannot write');
  void samplePdf;
});
