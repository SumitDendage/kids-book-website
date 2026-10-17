// The admin product manager (Oct 17): scheduled publishing, labels, sections (Admin → Categories),
// sales per sheet, and what the public catalogue (GET /api/worksheets) shows of each.
import { assert, assertEquals, assertStatus, startHarness, test, type Harness } from './harness.ts';

const h: Harness = await startHarness();
const admin = await h.staff('admin');
const support = await h.staff('support');
const IN_ADDR = { country: 'IN', line1: '12 MG Road', city: 'Pune', state: 'Maharashtra', postal: '411001' };

// deno-lint-ignore no-explicit-any
const listed = async (): Promise<any> => (await h.call('GET', '/api/worksheets')).body;
const put = (id: string, body: Record<string, unknown>, token = admin.token) => h.call('PUT', '/api/admin/worksheets/' + id, { token, body });

test('a scheduled sheet stays out of the shop, cannot be bought, and appears once its time comes', async () => {
  await h.uploadPdfFor('az-F');
  const later = Date.now() + 3 * 86400_000;
  const r = await put('az-F', { publishAt: new Date(later).toISOString() });
  assertStatus(r, 200);
  assertEquals([r.body.worksheet.status, r.body.worksheet.publishAt, r.body.worksheet.scheduled], ['active', later, true]);
  assert(!(await listed()).worksheets.some((w: { id: string }) => w.id === 'az-F'), 'not listed while scheduled');
  const c = await h.customer();
  const q = await h.call('POST', '/api/quote', { token: c.token, body: { worksheet: 'az-F', address: IN_ADDR } });
  assert(q.status !== 200 || q.body.valid === false, 'a scheduled sheet cannot be bought');

  const now = await put('az-F', { publishAt: Date.now() - 1000 });
  assertEquals(now.body.worksheet.scheduled, false);
  assert((await listed()).worksheets.some((w: { id: string }) => w.id === 'az-F'), 'listed once the time has passed');
  const clear = await put('az-F', { publishAt: null });
  assertEquals(clear.body.worksheet.publishAt, null);
  assertStatus(await put('az-F', { publishAt: 'next tuesday' }), 400);
});

test('labels are tags: the catalogue carries them, and the Best Seller label starts on the old Bestselling seven', async () => {
  const best = (await listed()).worksheets.filter((w: { tags: string[] }) => w.tags.includes('bestseller')).map((w: { id: string }) => w.id).sort();
  assertEquals(best, ['az-A', 'az-B', 'az-C', 'cl-A', 'mt-AE', 'rc-A', 'sp-AE']);
  const r = await put('vc-4', { tags: ['new', 'featured', 'home', 'popular'] });
  assertStatus(r, 200);
  const w = (await listed()).worksheets.find((x: { id: string }) => x.id === 'vc-4');
  assertEquals(w.tags, ['new', 'featured', 'home', 'popular']);
  assert(typeof (await listed()).worksheets[0].sort === 'number', 'display order is in the catalogue');
});

test('discount: worked out from the original and the selling price', async () => {
  const r = await put('az-H', { wasPrice: 40, price: 30 });
  assertStatus(r, 200);
  assertEquals([r.body.worksheet.price, r.body.worksheet.wasPrice, r.body.worksheet.discountPct], [30, 40, 25]);
  const none = await put('az-H', { wasPrice: null, price: 19 });
  assertEquals(none.body.worksheet.discountPct, 0);
});

test('sections: builtin ones listed, staff add, rename, hide and delete their own', async () => {
  const all = await h.call('GET', '/api/admin/sections', { token: support.token });
  assertStatus(all, 200);
  const tracing = all.body.sections.find((s: { id: string }) => s.id === 'letter-tracing');
  assertEquals([tracing.builtin, tracing.group, tracing.products >= 26], [true, 'alpha', true]);

  assertStatus(await h.call('POST', '/api/admin/sections', { token: support.token, body: { label: 'Nope' } }), 403);
  assertStatus(await h.call('POST', '/api/admin/sections', { token: admin.token, body: {} }), 400);
  const made = await h.call('POST', '/api/admin/sections', { token: admin.token, body: { label: 'Story Books', description: 'Short stories to read together' } });
  assertStatus(made, 201);
  const id = made.body.section.id;
  assertEquals([id, made.body.section.builtin, made.body.section.visible], ['story-books', false, true]);
  const again = await h.call('POST', '/api/admin/sections', { token: admin.token, body: { label: 'Story books' } });
  assertEquals(again.body.section.id, 'story-books-2');

  // a sheet put in it takes its name and group
  const s = await put('az-I', { section: id });
  assertEquals([s.body.worksheet.section, s.body.worksheet.sectionLabel, s.body.worksheet.group], [id, 'Story Books', null]);
  const pub = (await listed()).sections.find((x: { id: string }) => x.id === id);
  assertEquals([pub.label, pub.builtin], ['Story Books', false]);

  const ren = await h.call('PUT', '/api/admin/sections/' + id, { token: admin.token, body: { label: 'Bedtime stories', sort: 9 } });
  assertStatus(ren, 200);
  assertEquals([ren.body.section.label, ren.body.section.sort], ['Bedtime stories', 9]);
  assertEquals((await h.sql`select section_label from products where id = 'az-I'`)[0].section_label, 'Bedtime stories');

  const hide = await h.call('PUT', '/api/admin/sections/' + id, { token: admin.token, body: { visible: false } });
  assertEquals(hide.body.section.visible, false);
  assert(!(await listed()).sections.some((x: { id: string }) => x.id === id), 'hidden sections leave the public list');

  const inUse = await h.call('DELETE', '/api/admin/sections/' + id, { token: admin.token });
  assertStatus(inUse, 409);
  assertEquals(inUse.body.code, 'in_use');
  const builtin = await h.call('DELETE', '/api/admin/sections/letter-tracing', { token: admin.token });
  assertStatus(builtin, 409);
  assertEquals(builtin.body.code, 'builtin');
  const gone = await h.call('DELETE', '/api/admin/sections/story-books-2', { token: admin.token });
  assertStatus(gone, 200);
  assertEquals((await h.sql`select action from audit_logs where target_type = 'section' order by id`).map((r) => r.action),
    ['section.create', 'section.create', 'section.update', 'section.update', 'section.delete']);
});

test('sales per sheet: paid orders count, unpaid ones do not', async () => {
  const c = await h.customer();
  const mk = async (status: string) => {
    const oid = `LWO-S${Math.random().toString(36).slice(2, 8).toUpperCase()}X`;
    await h.sql`
      insert into orders (id, user_id, kind, status, currency, rate, total, total_inr, amount_minor, lines, method, paid_at)
      values (${oid}, ${c.id}, 'worksheet', ${status}, 'INR', 1, 25.8, 25.8, 2580, ${h.sql.json([])}, 'razorpay', ${status === 'paid' ? new Date() : null})`;
    await h.sql`insert into order_items (order_id, kind, product_id, title, access_days, unit_price_inr) values (${oid}, 'worksheet', 'az-J', 'J', 1, 19)`;
  };
  await mk('paid'); await mk('paid'); await mk('created');
  const r = await h.call('GET', '/api/admin/worksheets/az-J', { token: admin.token });
  assertEquals([r.body.worksheet.sold, r.body.worksheet.revenue], [2, 38]);
  const list = await h.call('GET', '/api/admin/worksheets', { token: admin.token });
  assertEquals(list.body.worksheets.find((w: { id: string }) => w.id === 'az-J').sold, 2);
});
