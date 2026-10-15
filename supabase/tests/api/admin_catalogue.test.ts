// Staff catalogue routes (routes/admin_catalogue.ts): permissions, worksheet create/update/archive/
// restore/delete, PDF/page/cover uploads, the files report, classes, and the audit trail.
import { PDFDocument } from 'pdf-lib';
import { assert, assertEquals, assertMatch, assertStatus, startHarness, test, type Harness } from './harness.ts';

const h: Harness = await startHarness();
const admin = await h.staff('admin');
const support = await h.staff('support');
const content = await h.staff('content');

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Array(56).fill(7)]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new Array(60).fill(3)]);

let seq = 0;
const newId = (tag: string) => `t-${tag}-${Date.now().toString(36)}${++seq}`;

async function auditRows(action: string, targetId: string) {
  // deno-lint-ignore no-explicit-any
  return await h.sql<any[]>`select actor_id, actor_role, action, target_type, target_id, detail from audit_logs where action = ${action} and target_id = ${targetId} order by id`;
}

async function create(body: Record<string, unknown>, token = admin.token) {
  return await h.call('POST', '/api/admin/worksheets', { token, body });
}

async function product(id: string) {
  // deno-lint-ignore no-explicit-any
  return (await h.sql<any[]>`select * from products where id = ${id}`)[0];
}

// ── who may call ─────────────────────────────────────────────────────────────────────────

test('catalogue admin: no token → 401 staff_signin, customer → 403 not_staff', async () => {
  const anon = await h.call('GET', '/api/admin/worksheets');
  assertStatus(anon, 401);
  assertEquals(anon.body.code, 'staff_signin');
  const c = await h.customer();
  const r = await h.call('GET', '/api/admin/worksheets', { token: c.token });
  assertStatus(r, 403);
  assertEquals(r.body.code, 'not_staff');
  const w = await h.call('PUT', '/api/admin/worksheets/az-D', { token: c.token, body: { price: 1 } });
  assertStatus(w, 403);
  assertEquals(w.body.code, 'not_staff');
  const up = await h.call('POST', '/api/admin/worksheets/az-D/file', { raw: await h.samplePdf(1) });
  assertStatus(up, 401);
});

test('support can read the catalogue (old shape) but cannot edit sheets or prices', async () => {
  const r = await h.call('GET', '/api/admin/worksheets', { token: support.token });
  assertStatus(r, 200);
  const d = r.body.worksheets.find((w: { id: string }) => w.id === 'az-D');
  assert(d, 'az-D is listed');
  for (const k of ['id', 'title', 'cls', 'subject', 'pages', 'price', 'file', 'thumb', 'active', 'real', 'updated']) assert(k in d, `old field ${k}`);
  assertEquals([d.cls, d.price, d.file, d.active, d.status, d.available], ['kg', 19, 'a-to-z/D.pdf', true, 'active', false]);
  const put = await h.call('PUT', '/api/admin/worksheets/az-D', { token: support.token, body: { price: 25 } });
  assertStatus(put, 403);
  assertEquals([put.body.code, put.body.permission], ['forbidden', 'catalogue.write']);
  const title = await h.call('PUT', '/api/admin/worksheets/az-D', { token: support.token, body: { title: 'Nope' } });
  assertStatus(title, 403);
  assertEquals((await product('az-D')).price_inr, 19);
});

test('content editor can change titles but not prices; admin can change prices (audited)', async () => {
  const t = await h.call('PUT', '/api/admin/worksheets/az-E', { token: content.token, body: { title: 'Alphabet E — trace and say' } });
  assertStatus(t, 200);
  assertEquals(t.body.worksheet.title, 'Alphabet E — trace and say');
  const a = await auditRows('worksheet.update', 'az-E');
  assertEquals(a.length, 1);
  assertEquals(a[0].actor_id, content.id);
  assertEquals(a[0].detail, { before: { title: 'Alphabet E — tracing sheet' }, after: { title: 'Alphabet E — trace and say' } });

  const p = await h.call('PUT', '/api/admin/worksheets/az-E', { token: content.token, body: { price: 99 } });
  assertStatus(p, 403);
  assertEquals([p.body.code, p.body.permission], ['forbidden', 'pricing.write']);
  const was = await h.call('PUT', '/api/admin/worksheets/az-E', { token: content.token, body: { wasPrice: 50 } });
  assertStatus(was, 403);
  assertEquals((await product('az-E')).price_inr, 19);

  // the studio sends the whole form: an unchanged price is fine
  const whole = await h.call('PUT', '/api/admin/worksheets/az-E', { token: content.token, body: { title: 'Alphabet E — tracing sheet', price: 19, subject: 'English', cls: 'kg' } });
  assertStatus(whole, 200);

  const ap = await h.call('PUT', '/api/admin/worksheets/az-E', { token: admin.token, body: { price: '25', wasPrice: 29 } });
  assertStatus(ap, 200);
  assertEquals([ap.body.worksheet.price, ap.body.worksheet.wasPrice], [25, 29]);
  const rows = await auditRows('worksheet.update', 'az-E');
  assertEquals(rows.at(-1).detail, { before: { price: 19, wasPrice: null }, after: { price: 25, wasPrice: 29 } });
  // nothing changed → no write, no audit row
  const again = await h.call('PUT', '/api/admin/worksheets/az-E', { token: admin.token, body: { price: 25 } });
  assertStatus(again, 200);
  assertEquals((await auditRows('worksheet.update', 'az-E')).length, rows.length);
  await h.sql`update products set price_inr = 19, was_price_inr = null where id = 'az-E'`;
});

test('worksheet field validation', async () => {
  const bad: [Record<string, unknown>, string][] = [
    [{ pages: 0 }, 'pages'], [{ pages: 501 }, 'pages'], [{ price: 'abc' }, 'price'], [{ price: 19.5 }, 'price'],
    [{ price: 100001 }, 'price'], [{ thumb: 'javascript:alert(1)' }, 'thumb'], [{ thumb: '//evil.example/x.png' }, 'thumb'],
    [{ tags: ['ok', 'BAD TAG!'] }, 'tags'], [{ status: 'live' }, 'status'], [{ audience: 'kids' }, 'audience'],
    [{ printLimit: -1 }, 'printLimit'], [{ downloadLimit: 101 }, 'downloadLimit'], [{ accessDays: 0 }, 'accessDays'],
    [{ title: '' }, 'title'], [{ section: 'Has Spaces' }, 'section'], [{ landscape: 'yes' }, 'landscape'],
  ];
  for (const [body, field] of bad) {
    const r = await h.call('PUT', '/api/admin/worksheets/az-I', { token: admin.token, body });
    assertStatus(r, 400, JSON.stringify(body));
    assert(r.body.errors?.[field], `errors.${field} for ${JSON.stringify(body)}: ${r.text}`);
  }
  const unknownClass = await h.call('PUT', '/api/admin/worksheets/az-I', { token: admin.token, body: { cls: 'zz9' } });
  assertStatus(unknownClass, 400);
  assertEquals(unknownClass.body.error, 'Title, subject and a known class are required.');
  const badId = await h.call('PUT', '/api/admin/worksheets/bad_id!', { token: admin.token, body: { title: 'x' } });
  assertStatus(badId, 400);
  assertEquals(badId.body.error, 'Worksheet ids are letters, digits and dashes.');
  const ok = await h.call('PUT', '/api/admin/worksheets/az-I', {
    token: admin.token,
    body: { accessDays: 30, stock: 5, tags: ['Best', 'new'], printLimit: 2, downloadLimit: 1, audience: 'both', thumb: '/sheets/x.jpg', sort: 7 },
  });
  assertStatus(ok, 200);
  const w = ok.body.worksheet;
  assertEquals([w.accessDays, w.effectiveAccessDays, w.stock, w.tags, w.printLimit, w.downloadLimit, w.audience, w.thumb, w.sort],
    [30, 30, 5, ['best', 'new'], 2, 1, 'both', '/sheets/x.jpg', 7]);
  const clear = await h.call('PUT', '/api/admin/worksheets/az-I', { token: admin.token, body: { accessDays: null, stock: null } });
  assertStatus(clear, 200);
  assertEquals([clear.body.worksheet.accessDays, clear.body.worksheet.effectiveAccessDays, clear.body.worksheet.stock], [null, 365, null]);
});

// ── create → upload → publish ────────────────────────────────────────────────────────────

test('a new sheet is a draft until its PDF is uploaded; upload makes it available, then it can go on sale', async () => {
  const id = newId('new');
  const r = await create({ id, title: 'Counting to ten', cls: 'kg', subject: 'Maths', price: 29, pages: 2, status: 'active', description: 'Count the apples.' });
  assertStatus(r, 201);
  const w = r.body.worksheet;
  assertEquals([w.id, w.status, w.active, w.available, w.real, w.price, w.file, w.description], [id, 'draft', false, false, false, 29, null, 'Count the apples.']);
  const created = await auditRows('worksheet.create', id);
  assertEquals(created.length, 1);
  assertEquals(created[0].detail.before, null);
  assertEquals(created[0].detail.after.title, 'Counting to ten');

  const dup = await create({ id, title: 'Again', cls: 'kg', subject: 'Maths' });
  assertStatus(dup, 409);
  assertEquals(dup.body.code, 'exists');

  const missing = await create({ cls: 'kg', subject: 'Maths' });
  assertStatus(missing, 400);
  assertEquals(missing.body.error, 'Title, subject and a known class are required.');
  assert(missing.body.errors.title);
  const noClass = await create({ title: 'X', cls: 'zz', subject: 'Maths' });
  assertStatus(noClass, 400);

  const live = await h.call('PUT', `/api/admin/worksheets/${id}`, { token: admin.token, body: { status: 'active' } });
  assertStatus(live, 400);
  assertEquals(live.body.code, 'pdf_missing');

  const pdf = await h.samplePdf(3);
  const up = await h.call('POST', `/api/admin/worksheets/${id}/file`, { token: content.token, raw: pdf, contentType: 'application/pdf' });
  assertStatus(up, 200);
  assertEquals([up.body.worksheet.available, up.body.worksheet.real, up.body.worksheet.pages, up.body.worksheet.file, up.body.worksheet.status],
    [true, true, 3, `uploads/${id}.pdf`, 'draft']);
  assertEquals(up.body.worksheet.pdfBytes, pdf.byteLength);
  assert(h.storage.has('worksheets', `uploads/${id}.pdf`), 'stored in the private bucket');
  assertEquals(h.storage.get('worksheets', `uploads/${id}.pdf`)!.bytes.byteLength, pdf.byteLength);
  const ua = await auditRows('worksheet.file_upload', id);
  assertEquals(ua.length, 1);
  assertEquals([ua[0].detail.before.file, ua[0].detail.after.file, ua[0].detail.after.pages, ua[0].detail.pageCount], [null, `uploads/${id}.pdf`, 3, 'pdf-lib']);
  assertMatch(ua[0].detail.after.sha256, /^[0-9a-f]{64}$/);

  const pub = await h.call('PUT', `/api/admin/worksheets/${id}`, { token: admin.token, body: { status: 'active' } });
  assertStatus(pub, 200);
  assertEquals([pub.body.worksheet.status, pub.body.worksheet.active], ['active', true]);

  const shop = await h.call('GET', '/api/worksheets');
  assertStatus(shop, 200);
  const listed = shop.body.worksheets.find((x: { id: string }) => x.id === id);
  assert(listed, 'on sale in the public catalogue');
  assertEquals(listed.available, true);
  assert(!shop.text.includes(`uploads/${id}.pdf`), 'no storage path for customers');
});

test('POST without an id makes one from the title; old PUT on an unknown id creates (upsert)', async () => {
  const r = await create({ title: 'Shapes: circle!', cls: 'kg', subject: 'Maths' });
  assertStatus(r, 201);
  assertMatch(r.body.worksheet.id, /^shapes-circle-[a-z0-9]{4,5}$/);
  assertEquals(r.body.worksheet.price, 19);
  const id = newId('upsert');
  const p = await h.call('PUT', `/api/admin/worksheets/${id}`, { token: admin.token, body: { title: 'Old studio sheet', cls: 'kg', subject: 'English', price: 0 } });
  assertStatus(p, 201);
  assertEquals([p.body.worksheet.id, p.body.worksheet.status, p.body.worksheet.free], [id, 'draft', true]);
  // a content editor may create, but not set a price other than the default
  const c = await create({ title: 'Content sheet', cls: 'kg', subject: 'English', price: 0 }, content.token);
  assertStatus(c, 403);
  assertEquals(c.body.permission, 'pricing.write');
  const c2 = await create({ title: 'Content sheet', cls: 'kg', subject: 'English' }, content.token);
  assertStatus(c2, 201);
});

test('PDF upload refuses non-PDFs, cut-off files, oversize bodies, unknown sheets and roles without files.upload', async () => {
  const id = newId('pdf');
  assertStatus(await create({ id, title: 'Upload checks', cls: 'kg', subject: 'English' }), 201);
  const text = await h.call('POST', `/api/admin/worksheets/${id}/file`, { token: admin.token, raw: new TextEncoder().encode('hello, not a pdf') });
  assertStatus(text, 400);
  assertEquals(text.body.error, 'That is not a PDF.');
  const png = await h.call('POST', `/api/admin/worksheets/${id}/file`, { token: admin.token, raw: PNG, contentType: 'application/pdf' });
  assertStatus(png, 400);
  const cut = (await h.samplePdf(1)).slice(0, 300);
  const half = await h.call('POST', `/api/admin/worksheets/${id}/file`, { token: admin.token, raw: cut });
  assertStatus(half, 400);
  assertEquals(half.body.code, 'pdf_incomplete');
  const empty = await h.call('POST', `/api/admin/worksheets/${id}/file`, { token: admin.token, raw: new Uint8Array(0) });
  assertStatus(empty, 400);

  const big = new Uint8Array(40 * 1024 * 1024 + 1);
  big.set(new TextEncoder().encode('%PDF-1.7\n'));
  const over = await h.call('POST', `/api/admin/worksheets/${id}/file`, { token: admin.token, raw: big });
  assertStatus(over, 413);
  assertEquals(over.body.error, 'Request too large');

  assert(!h.storage.has('worksheets', `uploads/${id}.pdf`), 'nothing stored for refused uploads');
  assertEquals((await product(id)).pdf_path, null);

  const unknown = await h.call('POST', '/api/admin/worksheets/no-such-sheet/file', { token: admin.token, raw: await h.samplePdf(1) });
  assertStatus(unknown, 404);
  assertEquals(unknown.body.error, 'Create the worksheet first (PUT /api/admin/worksheets/:id).');
  const sup = await h.call('POST', `/api/admin/worksheets/${id}/file`, { token: support.token, raw: await h.samplePdf(1) });
  assertStatus(sup, 403);
  assertEquals(sup.body.permission, 'files.upload');
  // publishing on upload also needs catalogue.write
  const files = await h.staff('content', ['files.upload']);
  const pub = await h.call('POST', `/api/admin/worksheets/${id}/file?publish=1`, { token: files.token, raw: await h.samplePdf(1) });
  assertStatus(pub, 403);
  assertEquals(pub.body.permission, 'catalogue.write');
  const ok = await h.call('POST', `/api/admin/worksheets/${id}/file?publish=1`, { token: admin.token, raw: await h.samplePdf(2) });
  assertStatus(ok, 200);
  assertEquals([ok.body.worksheet.status, ok.body.worksheet.available, ok.body.worksheet.pages], ['active', true, 2]);
});

test('uploading for a catalogue sheet keeps its existing file name', async () => {
  const r = await h.call('POST', '/api/admin/worksheets/az-F/file', { token: admin.token, raw: await h.samplePdf(1) });
  assertStatus(r, 200);
  assertEquals([r.body.worksheet.file, r.body.worksheet.available], ['a-to-z/F.pdf', true]);
  assert(h.storage.has('worksheets', 'a-to-z/F.pdf'));
  assert(!h.storage.has('worksheets', 'uploads/az-F.pdf'));
});

// ── archive, restore, delete ─────────────────────────────────────────────────────────────

test('archive hides a sheet, restore brings it back (draft without a PDF), hard delete only when never ordered', async () => {
  const id = newId('arch');
  assertStatus(await create({ id, title: 'Archive me', cls: 'kg', subject: 'English' }), 201);
  assertStatus(await h.call('POST', `/api/admin/worksheets/${id}/file?publish=1`, { token: admin.token, raw: await h.samplePdf(1) }), 200);

  const del = await h.call('DELETE', `/api/admin/worksheets/${id}`, { token: content.token });
  assertStatus(del, 200);
  assertEquals([del.body.ok, del.body.archived, del.body.deleted, del.body.worksheet.status, del.body.worksheet.active], [true, true, false, 'archived', false]);
  assertEquals((await auditRows('worksheet.archive', id))[0].detail, { before: { status: 'active' }, after: { status: 'archived' } });
  const shop = await h.call('GET', '/api/worksheets');
  assert(!shop.body.worksheets.some((x: { id: string }) => x.id === id), 'archived sheets leave the shop');
  // the admin list still has it
  const list = await h.call('GET', '/api/admin/worksheets?status=archived', { token: support.token });
  assert(list.body.worksheets.some((x: { id: string }) => x.id === id));

  const res = await h.call('POST', `/api/admin/worksheets/${id}/restore`, { token: content.token });
  assertStatus(res, 200);
  assertEquals([res.body.restored, res.body.worksheet.status], [true, 'active']);
  assertEquals((await auditRows('worksheet.restore', id))[0].detail.after, { status: 'active' });
  const again = await h.call('POST', `/api/admin/worksheets/${id}/restore`, { token: content.token });
  assertEquals(again.body.restored, false);

  // no PDF → restored as a draft
  const id2 = newId('arch2');
  assertStatus(await create({ id: id2, title: 'No file yet', cls: 'kg', subject: 'English' }), 201);
  assertStatus(await h.call('DELETE', `/api/admin/worksheets/${id2}`, { token: admin.token }), 200);
  const res2 = await h.call('POST', `/api/admin/worksheets/${id2}/restore`, { token: admin.token });
  assertEquals(res2.body.worksheet.status, 'draft');

  // hard delete: never ordered → gone with its uploaded file
  const hard = await h.call('DELETE', `/api/admin/worksheets/${id}?hard=1`, { token: admin.token });
  assertStatus(hard, 200);
  assertEquals([hard.body.deleted, hard.body.archived], [true, false]);
  assertEquals(await product(id), undefined);
  assert(!h.storage.has('worksheets', `uploads/${id}.pdf`), 'uploaded PDF removed');
  const gone = await auditRows('worksheet.delete', id);
  assertEquals([gone.length, gone[0].detail.after, gone[0].detail.before.title], [1, null, 'Archive me']);

  // ordered → only archive
  const c = await h.customer();
  const oid = `LWO-E${Date.now().toString(36).toUpperCase().slice(-6)}X`;
  await h.sql`
    insert into orders (id, user_id, kind, status, currency, rate, total, total_inr, amount_minor, lines, method)
    values (${oid}, ${c.id}, 'worksheet', 'created', 'INR', 1, 25.8, 25.8, 2580, ${h.sql.json([])}, 'razorpay')`;
  await h.sql`insert into order_items (order_id, kind, product_id, title, access_days, unit_price_inr) values (${oid}, 'worksheet', 'az-G', 'G', 365, 19)`;
  const used = await h.call('DELETE', '/api/admin/worksheets/az-G?hard=1', { token: admin.token });
  assertStatus(used, 409);
  assertEquals(used.body.code, 'in_use');
  assert(await product('az-G'), 'still there');

  assertStatus(await h.call('DELETE', '/api/admin/worksheets/no-such-sheet', { token: admin.token }), 404);
  assertStatus(await h.call('DELETE', '/api/admin/worksheets/az-G', { token: support.token }), 403);
});

// ── page pictures and covers ─────────────────────────────────────────────────────────────

test('page pictures go next to the PDF; one format per page; only images', async () => {
  const r = await h.call('POST', '/api/admin/worksheets/az-H/pages/2', { token: content.token, raw: PNG, contentType: 'image/png' });
  assertStatus(r, 200);
  assertEquals([r.body.page, r.body.type], [2, 'image/png']);
  assert(h.storage.has('worksheets', 'a-to-z/H-2.png'));
  assert(r.body.pages.includes(2));
  const j = await h.call('POST', '/api/admin/worksheets/az-H/pages/2', { token: content.token, raw: JPEG });
  assertStatus(j, 200);
  assert(h.storage.has('worksheets', 'a-to-z/H-2.jpg'));
  assert(!h.storage.has('worksheets', 'a-to-z/H-2.png'), 'the old format of the same page is removed');
  const audits = await auditRows('worksheet.page_upload', 'az-H');
  assertEquals(audits.length, 2);
  assertEquals(audits[1].detail.replaced, ['a-to-z/H-2.png']);

  const txt = await h.call('POST', '/api/admin/worksheets/az-H/pages/1', { token: admin.token, raw: new TextEncoder().encode('<svg onload=alert(1)>'.padEnd(64, ' ')) });
  assertStatus(txt, 400);
  assertEquals(txt.body.code, 'bad_image');
  assertStatus(await h.call('POST', '/api/admin/worksheets/az-H/pages/0', { token: admin.token, raw: PNG }), 400);
  assertStatus(await h.call('POST', '/api/admin/worksheets/az-H/pages/abc', { token: admin.token, raw: PNG }), 400);
  const big = new Uint8Array(5 * 1024 * 1024 + 1);
  big.set(PNG);
  assertStatus(await h.call('POST', '/api/admin/worksheets/az-H/pages/1', { token: admin.token, raw: big }), 413);
  assertStatus(await h.call('POST', '/api/admin/worksheets/az-H/pages/1', { token: support.token, raw: PNG }), 403);
});

test('cover upload: public covers bucket, sets thumb and cover path, removes the previous cover', async () => {
  const r = await h.call('POST', '/api/admin/worksheets/az-J/cover', { token: content.token, raw: PNG });
  assertStatus(r, 200);
  const w = r.body.worksheet;
  assertMatch(w.coverPath, /^az-J\/[a-z0-9]+\.png$/);
  assertEquals(w.thumb, `${h.fake.url}/storage/v1/object/public/covers/${w.coverPath}`);
  assert(h.storage.has('covers', w.coverPath));
  const r2 = await h.call('POST', '/api/admin/worksheets/az-J/cover', { token: content.token, raw: JPEG });
  assertStatus(r2, 200);
  assert(h.storage.has('covers', r2.body.worksheet.coverPath));
  assert(!h.storage.has('covers', w.coverPath), 'old cover removed');
  const a = await auditRows('worksheet.cover_upload', 'az-J');
  assertEquals(a.length, 2);
  assertEquals(a[1].detail.before.coverPath, w.coverPath);
  assertStatus(await h.call('POST', '/api/admin/worksheets/az-J/cover', { token: admin.token, raw: new Uint8Array(100) }), 400);
});

// ── files report and classes ─────────────────────────────────────────────────────────────

test('GET /api/admin/files says which sheets still need a PDF', async () => {
  await h.uploadPdfFor('az-K');
  const r = await h.call('GET', '/api/admin/files', { token: support.token });
  assertStatus(r, 200);
  const k = r.body.files.find((f: { id: string }) => f.id === 'az-K');
  assertEquals([k.hasPdf, k.file], [true, 'a-to-z/K.pdf']);
  assert(k.pdfBytes > 0);
  assert(r.body.missing.includes('az-L'));
  assert(!r.body.missing.includes('az-K'));
  assertEquals(r.body.counts.total, r.body.files.length);
  const c = await h.customer();
  assertStatus(await h.call('GET', '/api/admin/files', { token: c.token }), 403);
});

test('classes: content can rename and change status; discounts need pricing.write; every change audited', async () => {
  const g = await h.call('GET', '/api/admin/classes', { token: support.token });
  assertStatus(g, 200);
  const kg = g.body.classes.find((c: { id: string }) => c.id === 'kg');
  assertEquals([kg.name, kg.status, kg.discountPct], ['Kindergarten', 'available', 0]);
  assert(kg.products >= 100);

  const ren = await h.call('PUT', '/api/admin/classes', { token: content.token, body: { id: 'c1', name: 'Class One', status: 'coming_soon' } });
  assertStatus(ren, 200);
  assertEquals(ren.body.classes.find((c: { id: string }) => c.id === 'c1').name, 'Class One');
  assertEquals((await auditRows('class.update', 'c1'))[0].detail, { before: { name: 'Class 1' }, after: { name: 'Class One' } });

  const disc = await h.call('PUT', '/api/admin/classes', { token: content.token, body: { id: 'kg', discountPct: 10 } });
  assertStatus(disc, 403);
  assertEquals(disc.body.permission, 'pricing.write');
  const ok = await h.call('PUT', '/api/admin/classes', { token: admin.token, body: { classes: [{ id: 'kg', discountPct: 12.5 }, { id: 'c1', name: 'Class 1' }] } });
  assertStatus(ok, 200);
  assertEquals(ok.body.classes.find((c: { id: string }) => c.id === 'kg').discountPct, 12.5);
  assertStatus(await h.call('PUT', '/api/admin/classes', { token: admin.token, body: { id: 'kg', discountPct: 91 } }), 400);
  assertStatus(await h.call('PUT', '/api/admin/classes', { token: admin.token, body: { id: 'kg', status: 'open' } }), 400);
  assertStatus(await h.call('PUT', '/api/admin/classes', { token: admin.token, body: { id: 'c9' } }), 400);
  assertStatus(await h.call('PUT', '/api/admin/classes', { token: support.token, body: { id: 'c1', name: 'x' } }), 403);
  const add = await h.call('PUT', '/api/admin/classes', { token: content.token, body: { id: 'c4', name: 'Class 4' } });
  assertStatus(add, 200);
  assertEquals(add.body.classes.find((c: { id: string }) => c.id === 'c4').status, 'coming_soon');
  assertEquals((await auditRows('class.create', 'c4')).length, 1);
  await h.sql`update classes set discount_pct = 0 where id = 'kg'`;
});

test('every catalogue write leaves an audit row with the staff member and before/after', async () => {
  const rows = await h.sql<{ action: string; actor_role: string; detail: Record<string, unknown> }[]>`
    select action, actor_role, detail from audit_logs where target_type in ('product', 'class') order by id`;
  const actions = new Set(rows.map((r) => r.action));
  for (const a of ['worksheet.create', 'worksheet.update', 'worksheet.file_upload', 'worksheet.archive', 'worksheet.restore', 'worksheet.delete', 'worksheet.page_upload', 'worksheet.cover_upload', 'class.update', 'class.create']) {
    assert(actions.has(a), `audit ${a}`);
  }
  assert(rows.every((r) => r.actor_role === 'admin' || r.actor_role === 'content'), 'actor role recorded');
  assert(rows.every((r) => 'before' in r.detail && 'after' in r.detail), 'before/after');
});

// ── review fixes ────────────────────────────────────────────────────────────────────────

function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  for (let off = 0; off < n; off += 65536) crypto.getRandomValues(out.subarray(off, Math.min(n, off + 65536)));
  return out;
}

test('DATA-1 a PDF the stamp cannot handle is refused at upload (over 20 MB, password-protected); nothing is stored', async () => {
  const id = newId('stamp');
  assertStatus(await create({ id, title: 'Stamp checks', cls: 'kg', subject: 'English', price: 19 }), 201);
  // a valid one-page PDF over the 20 MB stamping limit but under the 40 MB body limit
  const doc = await PDFDocument.create();
  doc.addPage([595, 842]).drawText('Big sheet', { x: 60, y: 760, size: 18 });
  await doc.attach(randomBytes(21 * 1024 * 1024), 'scan.bin', { mimeType: 'application/octet-stream' });
  const big = await doc.save({ useObjectStreams: false });
  assert(big.byteLength > 20 * 1024 * 1024 && big.byteLength < 40 * 1024 * 1024);
  const large = await h.call('POST', `/api/admin/worksheets/${id}/file?publish=1`, { token: admin.token, raw: big, contentType: 'application/pdf' });
  assertStatus(large, 400);
  assertEquals(large.body.code, 'pdf_too_large');
  assertMatch(large.body.error, /20 MB/);

  // an owner-password (permissions) PDF: its trailer carries an /Encrypt dictionary
  const small = await PDFDocument.create();
  small.addPage([595, 842]).drawText('Protected sheet', { x: 60, y: 760, size: 18 });
  const plain = new TextDecoder('latin1').decode(await small.save({ useObjectStreams: false }));
  assert(plain.includes('trailer\n<<'));
  const enc = plain.replace('trailer\n<<', 'trailer\n<<\n/Encrypt << /Filter /Standard /V 1 /R 2 /O <00> /U <00> /P -3904 >>');
  const locked = await h.call('POST', `/api/admin/worksheets/${id}/file?publish=1`, { token: admin.token, raw: Uint8Array.from(enc, (ch) => ch.charCodeAt(0)), contentType: 'application/pdf' });
  assertStatus(locked, 400);
  assertEquals(locked.body.code, 'pdf_encrypted');

  assert(!h.storage.has('worksheets', `uploads/${id}.pdf`), 'nothing stored for refused uploads');
  const p = await product(id);
  assertEquals([p.pdf_path, p.status], [null, 'draft']);
  // a normal PDF still goes through
  assertStatus(await h.call('POST', `/api/admin/worksheets/${id}/file?publish=1`, { token: admin.token, raw: await h.samplePdf(1) }), 200);
});

test('DATA-3 page pictures uploaded for a sheet that still has a legacy single <base>.jpg are what the viewer shows', async () => {
  // az-X is a one-page catalogue sheet whose original files are a-to-z/X.pdf and a-to-z/X.jpg
  await h.storage.put('worksheets', 'a-to-z/X.pdf', await h.samplePdf(1), 'application/pdf');
  await h.storage.put('worksheets', 'a-to-z/X.jpg', JPEG, 'image/jpeg');
  const c = await h.customer();
  await h.grant(c.id, { productId: 'az-X', days: 30 });
  const before = await h.call('POST', '/api/access/az-X', { token: c.token });
  assertStatus(before, 200);
  const m0 = await h.call('GET', '/api/view/meta', { token: c.token, headers: { 'x-view-token': before.body.viewToken } });
  assertEquals([m0.body.hasImages, m0.body.pages], [true, 1], 'the legacy single picture still shows while there are no numbered ones');

  // staff replace it with a two-page version and its two pictures
  const up = await h.call('POST', '/api/admin/worksheets/az-X/file', { token: admin.token, raw: await h.samplePdf(2), contentType: 'application/pdf' });
  assertStatus(up, 200);
  assertEquals(up.body.worksheet.pages, 2);
  const pic = (fill: number) => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Array(56).fill(fill)]);
  assertStatus(await h.call('POST', '/api/admin/worksheets/az-X/pages/1', { token: admin.token, raw: pic(5), contentType: 'image/png' }), 200);
  const p2 = await h.call('POST', '/api/admin/worksheets/az-X/pages/2', { token: admin.token, raw: pic(6), contentType: 'image/png' });
  assertStatus(p2, 200);
  assertEquals(p2.body.pages, [1, 2]);

  const o = await h.call('POST', '/api/access/az-X', { token: c.token });
  const vt = { 'x-view-token': o.body.viewToken };
  const meta = await h.call('GET', '/api/view/meta', { token: c.token, headers: vt });
  assertEquals(meta.body.pages, 2);
  const page1 = await h.call('GET', '/api/view/page?n=0', { token: c.token, headers: vt });
  assertStatus(page1, 200);
  assertEquals(Array.from(page1.bytes), Array.from(pic(5)), 'page 1 is the new picture, not the legacy one');
  const page2 = await h.call('GET', '/api/view/page?n=1', { token: c.token, headers: vt });
  assertStatus(page2, 200);
  assertEquals(Array.from(page2.bytes), Array.from(pic(6)));
});
