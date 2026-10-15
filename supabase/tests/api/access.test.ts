// Builder D: POST /api/access/:id and the protected viewer /api/view/* (DESIGN.md §4.D).
import { PDFDocument, PDFName, PDFRawStream, StandardFonts } from 'pdf-lib';
import { assert, assertEquals, assertMatch, assertStatus, startHarness, test } from './harness.ts';
import { tx } from '../../functions/api/lib/db.ts';
import { decodeClaims } from '../../functions/api/lib/gotrue.ts';
import { makeViewToken } from '../../functions/api/services/viewtoken.ts';
import { FILE_LIMIT } from '../../functions/api/routes/access.ts';
import { footerLines, stampText } from '../../functions/api/services/watermark.ts';

const h = await startHarness();

// Sheets used below (kg class). Free: az-A, az-B, vc-1, vc-2, vc-3, vs-1, vs-2, vs-3.
const uploaded = new Set<string>();
async function ready(id: string, pages = 1) {
  if (!uploaded.has(id)) {
    await h.uploadPdfFor(id, pages);
    uploaded.add(id);
  }
}

async function open(token: string, id: string, o: { device?: string; ip?: string } = {}) {
  return await h.call('POST', `/api/access/${id}`, { token, ...o });
}

function viewHeaders(viewToken: string) {
  return { 'x-view-token': viewToken };
}

async function view(token: string, viewToken: string, path: string, o: { device?: string; ip?: string } = {}) {
  return await h.call('GET', path, { token, headers: viewHeaders(viewToken), ...o });
}

/** A second sign-in for the same account (fake Auth session + app_sessions row). */
async function anotherSignIn(userId: string) {
  const t = await h.fake.auth.issueSession(userId, { userAgent: h.userAgent });
  const sid = String(decodeClaims(t.access_token).session_id);
  await h.sql`
    insert into app_sessions (id, user_id, remember, expires_at, ip, ip_network, user_agent, device_label, device_id_hash, is_staff)
    values (${sid}, ${userId}, false, now() + interval '12 hours', '10.99.0.1', '10.99.0.0/24', ${h.userAgent},
            'Chrome on Windows', ${await h.deviceHash('other-device-xxxxxxxx')}, false)`;
  return { token: t.access_token as string, sessionId: sid };
}

const accessRows = (userId: string) =>
  h.sql<{ action: string; ok: boolean; detail: string | null; product_id: string | null }[]>`
    select action, ok, detail, product_id from access_log where user_id = ${userId} order by id`;

/** All text inside the PDF's content streams (inflated), upper-cased. */
async function pdfContent(bytes: Uint8Array): Promise<string> {
  const doc = await PDFDocument.load(bytes);
  let all = '';
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;
    let data: Uint8Array = obj.contents;
    if (String(obj.dict.get(PDFName.of('Filter')) ?? '') === '/FlateDecode') {
      const s = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate'));
      data = new Uint8Array(await new Response(s).arrayBuffer());
    }
    all += Array.from(data, (b) => String.fromCharCode(b)).join('');
  }
  return all.toUpperCase();
}
const hexOf = (s: string) => Array.from(new TextEncoder().encode(s), (b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();

// ── free sheets ─────────────────────────────────────────────────────────────────────────

test('a free sheet opens without a purchase and creates exactly one free pass', async () => {
  await ready('az-A');
  const c = await h.customer();
  const r = await open(c.token, 'az-A');
  assertStatus(r, 200);
  assertEquals(r.body.ok, true);
  assert(typeof r.body.token === 'string' && r.body.token === r.body.viewToken, 'token and viewToken are the same');
  assertEquals(r.body.entitlement.kind, 'free');
  assertEquals(r.body.entitlement.worksheet, 'az-A');
  assertEquals(r.body.expiresAt, null);
  assertEquals(r.body.worksheet.id, 'az-A');
  assertEquals(r.body.worksheet.price, 0);
  assertEquals(r.body.printsLeft, 0);
  assertEquals(r.body.downloadsLeft, 0);
  assert(r.body.tokenExpiresAt > Date.now() + 3_600_000, 'token lasts hours');
  assertEquals(r.body.recheckSeconds, 60);
  // opening again reuses the pass
  assertStatus(await open(c.token, 'az-A'), 200);
  const rows = await h.sql`select kind from entitlements where user_id = ${c.id}`;
  assertEquals(rows.length, 1);
  const log = await accessRows(c.id);
  assertEquals(log.filter((x) => x.action === 'access' && x.ok).length, 2);
});

test('two simultaneous opens of a free sheet still make one free pass', async () => {
  await ready('az-B');
  const c = await h.customer();
  const rs = await Promise.all([open(c.token, 'az-B'), open(c.token, 'az-B'), open(c.token, 'az-B')]);
  for (const r of rs) assertStatus(r, 200);
  const rows = await h.sql`select id from entitlements where user_id = ${c.id} and product_id = 'az-B' and kind = 'free'`;
  assertEquals(rows.length, 1);
  assertEquals(new Set(rs.map((r) => r.body.entitlement.id)).size, 1);
});

test('signed out → 401; unknown or malformed sheet → 404; no PDF yet → 410 unavailable', async () => {
  const anon = await h.call('POST', '/api/access/az-C');
  assertStatus(anon, 401);
  assertEquals(anon.body.code, 'signin');
  const c = await h.customer();
  const missing = await open(c.token, 'no-such-sheet');
  assertStatus(missing, 404);
  assertEquals(missing.body.error, 'No such worksheet.');
  assertStatus(await open(c.token, 'bad_id'), 404);
  // vs-1 is free but its PDF was never uploaded
  const noPdf = await open(c.token, 'vs-1');
  assertStatus(noPdf, 410);
  assertEquals(noPdf.body.code, 'unavailable');
  assertEquals((await h.sql`select count(*)::int as n from entitlements where user_id = ${c.id}`)[0].n, 0);
  const log = await accessRows(c.id);
  assert(log.length >= 2 && log.every((x) => !x.ok), 'refusals are logged');
});

// ── paid sheets ─────────────────────────────────────────────────────────────────────────

test('a paid sheet without access is refused with the price (old 402 body)', async () => {
  await ready('az-C');
  const c = await h.customer();
  const r = await open(c.token, 'az-C');
  assertStatus(r, 402);
  assertEquals(r.body.code, 'payment_required');
  assertEquals(r.body.error, 'Payment required to open this sheet.');
  assertEquals(r.body.worksheet, 'az-C');
  assertEquals(r.body.cls, 'kg');
  assertEquals(r.body.price, 19);
  assertEquals(r.body.expired, undefined);
  assertEquals((await h.sql`select count(*)::int as n from entitlements where user_id = ${c.id}`)[0].n, 0);
  const log = await accessRows(c.id);
  assertEquals(log.at(-1)?.ok, false);
});

test('a paid sheet with live access opens; meta has the old shape plus the new fields', async () => {
  await ready('az-D', 2);
  const c = await h.customer({ name: 'Asha Rao' });
  const entId = await h.grant(c.id, { productId: 'az-D', days: 30 });
  const r = await open(c.token, 'az-D');
  assertStatus(r, 200);
  assertEquals(r.body.entitlement.id, entId);
  assertEquals(r.body.entitlement.grant, true);
  assertMatch(r.body.expiresAt, /^\d{4}-\d\d-\d\dT/);
  assert(r.body.tokenExpiresAt <= r.body.expiresAtMs, 'token never outlives the access');

  const m = await view(c.token, r.body.token, '/api/view/meta');
  assertStatus(m, 200);
  for (const k of ['title', 'cls', 'subject', 'pages', 'kind', 'scope', 'since', 'until', 'real', 'hasPdf', 'hasImages', 'now', 'user']) {
    assert(k in m.body, `meta has ${k}`);
  }
  assertEquals(m.body.user, { name: 'Asha Rao', email: c.email });
  assertEquals(m.body.kind, 'paid');
  assertEquals(m.body.scope, 'worksheet');
  assertEquals(m.body.hasPdf, true);
  assertEquals(m.body.hasImages, false);
  assertEquals(m.body.watermark.email, c.email);
  assertEquals(m.body.watermark.name, 'Asha Rao');
  assertEquals(m.body.watermark.orderId, null);
  assertEquals(m.body.recheckSeconds, 60);
  assertEquals(m.body.printsLeft, 0);
  assertEquals(m.body.downloadsLeft, 0);
  assertEquals(typeof m.body.expiresAt, 'string');

  // ?t= works too (old <img> links), still with the bearer
  const q = await h.call('GET', `/api/view/meta?t=${encodeURIComponent(r.body.token)}`, { token: c.token });
  assertStatus(q, 200);
  // the bearer is still required
  const noBearer = await h.call('GET', '/api/view/meta', { headers: viewHeaders(r.body.token) });
  assertStatus(noBearer, 401);
  const log = await accessRows(c.id);
  assert(log.some((x) => x.action === 'meta' && x.ok), 'meta is logged');
});

test('the PDF is streamed from private storage with the watermark on every page', async () => {
  await ready('az-E', 3);
  const c = await h.customer();
  await h.grant(c.id, { productId: 'az-E', days: 30 });
  const r = await open(c.token, 'az-E');
  assertStatus(r, 200);
  const f = await view(c.token, r.body.token, '/api/view/file');
  assertStatus(f, 200);
  assertEquals(f.headers.get('content-type'), 'application/pdf');
  assertMatch(f.headers.get('cache-control') ?? '', /no-store/);
  assertEquals(f.headers.get('content-disposition'), 'inline');
  assertEquals(f.headers.get('x-pages'), '3');
  assertEquals(new TextDecoder().decode(f.bytes.slice(0, 5)), '%PDF-');
  // the stored original is untouched; the delivered copy differs and carries the stamp
  const original = h.storage.get('worksheets', 'a-to-z/E.pdf')!.bytes;
  assert(original.byteLength !== f.bytes.byteLength, 'delivered copy is stamped');
  const content = await pdfContent(f.bytes);
  const stamp = hexOf(`Licensed to ${c.email} - Granted access - `);
  assertEquals(content.split(stamp).length - 1, 3, 'one footer stamp per page');
  assertEquals(content.split(`<${hexOf(`Name on account: ${c.name}`)}>`).length - 1, 3, 'one name line per page');
  assertEquals(content.split(`<${hexOf(c.email)}>`).length - 1, 9, 'three diagonal email stamps per page');
  const doc = await PDFDocument.load(f.bytes);
  assertEquals(doc.getPageCount(), 3);
  const log = await accessRows(c.id);
  assert(log.some((x) => x.action === 'pdf' && x.ok), 'pdf delivery is logged');
});

test('a file that cannot be stamped is sent as it is and recorded as watermark.failed', async () => {
  const c = await h.customer();
  await h.sql`update products set pdf_path = 'uploads/az-F-broken.pdf' where id = 'az-F'`;
  const junk = new TextEncoder().encode('%PDF-1.4\nthis is not really a pdf\n%%EOF\n');
  await h.storage.put('worksheets', 'uploads/az-F-broken.pdf', junk, 'application/pdf');
  await h.grant(c.id, { productId: 'az-F', days: 5 });
  const r = await open(c.token, 'az-F');
  assertStatus(r, 200);
  const f = await view(c.token, r.body.token, '/api/view/file');
  assertStatus(f, 200);
  assertEquals(f.bytes, junk);
  const ev = await h.sql`select detail from security_events where user_id = ${c.id} and event_type = 'watermark.failed'`;
  assertEquals(ev.length, 1);
  assertEquals(ev[0].detail.productId, 'az-F');
});

test('page pictures stream by 0-based number; missing pages are 404', async () => {
  await ready('az-G');
  await h.storage.put('worksheets', 'a-to-z/G-1.jpg', new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3]), 'image/jpeg');
  await h.storage.put('worksheets', 'a-to-z/G-2.jpg', new Uint8Array([0xff, 0xd8, 0xff, 4, 5, 6]), 'image/jpeg');
  const c = await h.customer();
  await h.grant(c.id, { productId: 'az-G', days: 30 });
  const r = await open(c.token, 'az-G');
  const m = await view(c.token, r.body.token, '/api/view/meta');
  assertStatus(m, 200);
  assertEquals(m.body.hasImages, true);
  assertEquals(m.body.pages, 2);
  const p1 = await view(c.token, r.body.token, '/api/view/page?n=1');
  assertStatus(p1, 200);
  assertEquals(p1.headers.get('content-type'), 'image/jpeg');
  assertEquals(Array.from(p1.bytes), [0xff, 0xd8, 0xff, 4, 5, 6]);
  assertEquals(p1.headers.get('x-pages'), '2');
  const p0 = await view(c.token, r.body.token, '/api/view/page?n=abc');
  assertStatus(p0, 200);
  assertEquals(Array.from(p0.bytes), [0xff, 0xd8, 0xff, 1, 2, 3]);
  const none = await view(c.token, r.body.token, '/api/view/page?n=5');
  assertStatus(none, 404);
  assertEquals(none.body.error, 'No such page.');
});

// ── expiry, revocation, lapsed free passes ──────────────────────────────────────────────

test('expired access: /api/access says expired (Buy Access Again) and an open viewer closes', async () => {
  await ready('az-H');
  const c = await h.customer();
  const entId = await h.grant(c.id, { productId: 'az-H', days: 30 });
  const r = await open(c.token, 'az-H');
  assertStatus(r, 200);
  const vt = r.body.token;
  assertStatus(await view(c.token, vt, '/api/view/meta'), 200);

  await h.sql`update entitlements set starts_at = now() - interval '40 days', expires_at = now() - interval '1 minute' where id = ${entId}`;
  for (const path of ['/api/view/meta', '/api/view/file', '/api/view/page?n=0']) {
    const d = await view(c.token, vt, path);
    assertStatus(d, 403, path);
    assertEquals(d.body.code, 'expired', path);
    assertEquals(d.body.expired, true);
    assert(typeof d.body.expiredAt === 'number');
    assertMatch(d.body.error, /buy access again/i);
  }
  const again = await open(c.token, 'az-H');
  assertStatus(again, 402);
  assertEquals(again.body.code, 'payment_required');
  assertEquals(again.body.expired, true);
  assertEquals(typeof again.body.expiredAt, 'number');
  assertEquals(again.body.price, 19);
  const log = await accessRows(c.id);
  assert(log.filter((x) => !x.ok && x.detail === 'access ended').length >= 3, 'viewer refusals logged');
});

test('a renewal carries an open viewer on after the first record ends', async () => {
  await ready('az-I');
  const c = await h.customer();
  const first = await h.grant(c.id, { productId: 'az-I', days: 30 });
  const r = await open(c.token, 'az-I');
  await h.sql`update entitlements set starts_at = now() - interval '40 days', expires_at = now() - interval '1 minute' where id = ${first}`;
  const second = await h.grant(c.id, { productId: 'az-I', days: 60 });
  const m = await view(c.token, r.body.token, '/api/view/meta');
  assertStatus(m, 200);
  assertEquals(m.body.entitlement.id, second);
});

test('revoked access is refused (access check and open viewer)', async () => {
  await ready('az-J');
  const c = await h.customer();
  const entId = await h.grant(c.id, { productId: 'az-J', days: 30 });
  const r = await open(c.token, 'az-J');
  assertStatus(r, 200);
  await h.sql`update entitlements set revoked_at = now(), revoke_reason = 'test' where id = ${entId}`;
  const d = await view(c.token, r.body.token, '/api/view/meta');
  assertStatus(d, 403);
  assertEquals(d.body.code, 'revoked');
  assertEquals(d.body.error, 'This sheet is no longer available on your account.');
  const again = await open(c.token, 'az-J');
  assertStatus(again, 402);
  assertEquals(again.body.expired, undefined);
});

test('a class plan opens every sheet of its class and closes when it ends', async () => {
  await ready('az-K');
  const c = await h.customer();
  const plan = await h.grant(c.id, { classId: 'kg', days: 30 });
  const r = await open(c.token, 'az-K');
  assertStatus(r, 200);
  assertEquals(r.body.entitlement.scope, 'class');
  await h.sql`update entitlements set starts_at = now() - interval '40 days', expires_at = now() - interval '1 minute' where id = ${plan}`;
  const d = await view(c.token, r.body.token, '/api/view/meta');
  assertStatus(d, 403);
  assertEquals(d.body.code, 'expired');
  assertMatch(d.body.error, /Kindergarten plan has ended/);
});

test('a free pass lapses when the sheet becomes paid', async () => {
  await ready('vc-1', 2);
  const c = await h.customer();
  const r = await open(c.token, 'vc-1');
  assertStatus(r, 200);
  await h.sql`update products set price_inr = 25 where id = 'vc-1'`;
  try {
    const d = await view(c.token, r.body.token, '/api/view/meta');
    assertStatus(d, 403);
    assertEquals(d.body.code, 'expired');
    assertEquals(d.body.error, 'This sheet is not free any more — buy it on the site to open it.');
    const again = await open(c.token, 'vc-1');
    assertStatus(again, 402);
    assertEquals(again.body.price, 25);
  } finally {
    await h.sql`update products set price_inr = 0 where id = 'vc-1'`;
  }
  // free again: the same pass counts again, no second row
  assertStatus(await open(c.token, 'vc-1'), 200);
  assertEquals((await h.sql`select count(*)::int as n from entitlements where user_id = ${c.id}`)[0].n, 1);
});

// ── tokens: forged, foreign, other sign-in, old ─────────────────────────────────────────

test('view tokens are bound to the account and the sign-in; forged or old ones are refused', async () => {
  await ready('az-L');
  const a = await h.customer();
  const b = await h.customer();
  await h.grant(a.id, { productId: 'az-L', days: 30 });
  await h.grant(b.id, { productId: 'az-L', days: 30 });
  const ra = await open(a.token, 'az-L');
  assertStatus(ra, 200);

  // B's bearer with A's token (even though B also owns the sheet)
  const cross = await view(b.token, ra.body.token, '/api/view/meta');
  assertStatus(cross, 403);
  assertEquals(cross.body.code, 'invalid');
  const crossFile = await view(b.token, ra.body.token, '/api/view/file');
  assertStatus(crossFile, 403);

  // A's token used from another sign-in of A
  const second = await anotherSignIn(a.id);
  const other = await view(second.token, ra.body.token, '/api/view/meta');
  assertStatus(other, 403);
  assertEquals(other.body.code, 'invalid');

  // missing and tampered tokens
  const none = await h.call('GET', '/api/view/meta', { token: a.token });
  assertStatus(none, 403);
  assertEquals(none.body.code, 'invalid');
  const [body, sig] = ra.body.token.split('.');
  const tampered = `${body.slice(0, -2)}${body.endsWith('A') ? 'B' : 'A'}${body.slice(-1)}.${sig}`;
  assertStatus(await view(a.token, tampered, '/api/view/meta'), 403);
  assertStatus(await view(a.token, `${body}.${'A'.repeat(43)}`, '/api/view/meta'), 403);

  // a token whose own time ran out (signed with the real key) while access is still live
  const ent = (await h.sql`select id from entitlements where user_id = ${a.id} and product_id = 'az-L'`)[0].id;
  const old = await tx((q) => makeViewToken(q, { userId: a.id, productId: 'az-L', entitlementId: ent, sessionId: a.sessionId, exp: Date.now() - 1000 }));
  const stale = await view(a.token, old, '/api/view/meta');
  assertStatus(stale, 403);
  assertEquals(stale.body.code, 'invalid');
  assertEquals(stale.body.tokenExpired, true);

  // a token naming B's access record but signed for A is refused as revoked/not found
  const bEnt = (await h.sql`select id from entitlements where user_id = ${b.id} and product_id = 'az-L'`)[0].id;
  const foreign = await tx((q) => makeViewToken(q, { userId: a.id, productId: 'az-L', entitlementId: bEnt, sessionId: a.sessionId, exp: Date.now() + 60_000 }));
  const fr = await view(a.token, foreign, '/api/view/meta');
  assertStatus(fr, 403);
  assertEquals(fr.body.code, 'revoked');

  // the genuine token still works
  assertStatus(await view(a.token, ra.body.token, '/api/view/meta'), 200);
  const log = await accessRows(a.id);
  assert(log.some((x) => !x.ok && x.detail === 'token of another sign-in'), 'other sign-in logged');
  const logB = await accessRows(b.id);
  assert(logB.some((x) => !x.ok && x.detail === 'token of another account'), 'cross-account attempt logged');
});

test('a blocked sign-in gets 403 session_blocked on viewer requests', async () => {
  await ready('az-M');
  const c = await h.customer();
  await h.grant(c.id, { productId: 'az-M', days: 30 });
  const r = await open(c.token, 'az-M');
  assertStatus(r, 200);
  await h.sql`update app_sessions set blocked_at = now() where id = ${c.sessionId}`;
  for (const path of ['/api/view/meta', '/api/view/file', '/api/view/page?n=0']) {
    const d = await view(c.token, r.body.token, path);
    assertStatus(d, 403, path);
    assertEquals(d.body.code, 'session_blocked');
  }
  const a = await open(c.token, 'az-M');
  assertStatus(a, 403);
  assertEquals(a.body.code, 'session_blocked');
});

// ── paid-access suspension ──────────────────────────────────────────────────────────────

test('suspended paid access: paid sheets refused (403 access_suspended), free sheets still open', async () => {
  await ready('az-N');
  await ready('vc-2', 2);
  const c = await h.customer();
  await h.grant(c.id, { productId: 'az-N', days: 30 });
  const paid = await open(c.token, 'az-N');
  assertStatus(paid, 200);
  await h.sql`update profiles set subscription_suspended_at = now(), suspension_reason = 'staff' where id = ${c.id}`;

  const a = await open(c.token, 'az-N');
  assertStatus(a, 403);
  assertEquals(a.body.code, 'access_suspended');
  const v = await view(c.token, paid.body.token, '/api/view/meta');
  assertStatus(v, 403);
  assertEquals(v.body.code, 'access_suspended');
  const unpaid = await open(c.token, 'az-C');
  assertStatus(unpaid, 403);
  assertEquals(unpaid.body.code, 'access_suspended');

  const free = await open(c.token, 'vc-2');
  assertStatus(free, 200);
  assertEquals(free.body.entitlement.kind, 'free');
  assertStatus(await view(c.token, free.body.token, '/api/view/meta'), 200);
  assertStatus(await view(c.token, free.body.token, '/api/view/file'), 200);

  // lifting it restores the same access (entitlements were never touched)
  await h.sql`update profiles set subscription_suspended_at = null, suspension_reason = null where id = ${c.id}`;
  assertStatus(await view(c.token, paid.body.token, '/api/view/meta'), 200);
  assertStatus(await open(c.token, 'az-N'), 200);
});

// ── server-delivered copies ─────────────────────────────────────────────────────────────

test('print: 0 = not allowed (403), then the limit is counted and 429 when used up', async () => {
  await ready('az-O');
  const c = await h.customer();
  await h.grant(c.id, { productId: 'az-O', days: 30 });
  const r = await open(c.token, 'az-O');
  const none = await h.call('POST', '/api/view/print', { token: c.token, headers: viewHeaders(r.body.token) });
  assertStatus(none, 403);
  assertEquals(none.body.code, 'not_allowed');

  await h.sql`update products set print_limit = 2 where id = 'az-O'`;
  const p1 = await h.call('POST', '/api/view/print', { token: c.token, headers: viewHeaders(r.body.token) });
  assertStatus(p1, 200);
  assertEquals(p1.body, { ok: true, printsLeft: 1, printLimit: 2, counts: 'server_deliveries' });
  const p2 = await h.call('POST', '/api/view/print', { token: c.token, headers: viewHeaders(r.body.token) });
  assertEquals(p2.body.printsLeft, 0);
  const p3 = await h.call('POST', '/api/view/print', { token: c.token, headers: viewHeaders(r.body.token) });
  assertStatus(p3, 429);
  assertEquals(p3.body.code, 'quota_exhausted');
  const m = await view(c.token, r.body.token, '/api/view/meta');
  assertEquals(m.body.printsLeft, 0);
  assertEquals(m.body.printLimit, 2);
  const log = await accessRows(c.id);
  assertEquals(log.filter((x) => x.action === 'print').map((x) => x.ok), [false, true, true, false]);
});

test('concurrent downloads never exceed the limit; each copy is a stamped attachment', async () => {
  await ready('az-P');
  await h.sql`update products set download_limit = 3 where id = 'az-P'`;
  const c = await h.customer();
  const ent = await h.grant(c.id, { productId: 'az-P', days: 30 });
  const r = await open(c.token, 'az-P');
  assertEquals(r.body.downloadsLeft, 3);
  const rs = await Promise.all(Array.from({ length: 8 }, () =>
    h.call('POST', '/api/view/download', { token: c.token, headers: viewHeaders(r.body.token) })));
  const ok = rs.filter((x) => x.status === 200);
  const limited = rs.filter((x) => x.status === 429);
  assertEquals(ok.length, 3);
  assertEquals(limited.length, 5);
  for (const x of limited) assertEquals(x.body.code, 'quota_exhausted');
  for (const x of ok) {
    assertEquals(x.headers.get('content-type'), 'application/pdf');
    assertEquals(x.headers.get('content-disposition'), 'attachment; filename="learn-with-why-az-P.pdf"');
    assert((await pdfContent(x.bytes)).includes(hexOf(`Licensed to ${c.email} - Granted access - `)), 'download is stamped');
  }
  const used = await h.sql`select used from delivery_counts where entitlement_id = ${ent} and product_id = 'az-P' and kind = 'download'`;
  assertEquals(used[0].used, 3);
});

test('a download whose file has gone missing does not use up a copy', async () => {
  const c = await h.customer();
  await h.sql`update products set download_limit = 1, pdf_path = 'uploads/az-Q-tmp.pdf' where id = 'az-Q'`;
  await h.storage.put('worksheets', 'uploads/az-Q-tmp.pdf', await h.samplePdf(1), 'application/pdf');
  const ent = await h.grant(c.id, { productId: 'az-Q', days: 30 });
  const r = await open(c.token, 'az-Q');
  assertStatus(r, 200);
  // the object disappears from storage after the access check (row kept, bytes gone)
  const unroute = h.fake.route('GET', '/storage/v1/object/worksheets/uploads/az-Q-tmp.pdf', () => new Response(JSON.stringify({ error: 'not_found' }), { status: 404 }));
  const d = await h.call('POST', '/api/view/download', { token: c.token, headers: viewHeaders(r.body.token) }).finally(unroute);
  assertStatus(d, 404);
  assertEquals(d.body.code, 'nofile');
  const used = await h.sql`select used from delivery_counts where entitlement_id = ${ent} and product_id = 'az-Q' and kind = 'download'`;
  assertEquals(used[0].used, 0);
});

// ── catalogue status ────────────────────────────────────────────────────────────────────

test('archived sheets stay open for holders only; drafts only for staff with catalogue.read', async () => {
  await ready('az-R');
  const holder = await h.customer();
  const other = await h.customer();
  await h.grant(holder.id, { productId: 'az-R', days: 30 });
  await h.sql`update products set status = 'archived' where id = 'az-R'`;
  assertStatus(await open(holder.token, 'az-R'), 200);
  assertStatus(await open(other.token, 'az-R'), 404);

  await h.sql`update products set status = 'draft' where id = 'az-R'`;
  assertStatus(await open(holder.token, 'az-R'), 404);
  const staff = await h.staff('content');
  await h.grant(staff.id, { productId: 'az-R', days: 3 });
  const s = await open(staff.token, 'az-R');
  assertStatus(s, 200);
  const log = await h.sql`select detail from access_log where user_id = ${staff.id} and action = 'access'`;
  assertMatch(log[0].detail, /^staff/);
  await h.sql`update products set status = 'active' where id = 'az-R'`;
});

test('opening a paid sheet runs the sharing rules after the response', async () => {
  await ready('az-S');
  const c = await h.customer({ device: 'device-one-aaaaaaaa', ip: '10.10.1.4' });
  await h.grant(c.id, { productId: 'az-S', days: 30 });
  // one sign-in per device (a device is a sign-in; the X-Device-Id of a request does not add devices)
  const signIn = async (device: string, ip: string) => {
    const r = await h.login(c.email, c.password, { device, ip });
    assertStatus({ status: r.status, text: r.text }, 200);
    return r.token as string;
  };
  // three devices on two networks within minutes, each opening the paid sheet → one incident (from the background check)
  assertStatus(await open(c.token, 'az-S', { device: 'device-one-aaaaaaaa', ip: '10.10.1.5' }), 200);
  const two = await signIn('device-two-bbbbbbbb', '10.10.1.6');
  assertStatus(await open(two, 'az-S', { device: 'device-two-bbbbbbbb', ip: '10.10.1.6' }), 200);
  assertEquals((await h.sql`select count(*)::int as n from security_incidents where user_id = ${c.id}`)[0].n, 0);
  const three = await signIn('device-three-cccccc', '10.20.2.7');
  assertStatus(await open(three, 'az-S', { device: 'device-three-cccccc', ip: '10.20.2.7' }), 200);
  const inc = await h.sql`select rule_id, status from security_incidents where user_id = ${c.id}`;
  assertEquals(inc.length, 1);
  assertEquals(inc[0].rule_id, 'concurrent_devices');
  assertEquals(inc[0].status, 'open');
  // still one incident after more requests
  const four = await signIn('device-four-dddddd', '10.30.3.8');
  assertStatus(await open(four, 'az-S', { device: 'device-four-dddddd', ip: '10.30.3.8' }), 200);
  assertEquals((await h.sql`select count(*)::int as n from security_incidents where user_id = ${c.id}`)[0].n, 1);
});

// ── review fixes ────────────────────────────────────────────────────────────────────────

test('ACCESS-1 sheet "<id>-2" shows its own page pictures, never page 2 of the sheet "<id>"', async () => {
  const staff = await h.staff('owner');
  async function make(id: string, title: string, price: number, pages: number) {
    assertStatus(await h.call('POST', '/api/admin/worksheets', { token: staff.token, body: { id, title, subject: 'Maths', cls: 'kg', price, pages } }), 201, `create ${id}`);
    const f = await h.call('POST', `/api/admin/worksheets/${id}/file?publish=1`, { token: staff.token, raw: await h.samplePdf(pages), contentType: 'application/pdf' });
    assertStatus(f, 200, `pdf for ${id}`);
  }
  await make('rv-maths', 'Maths practice (paid, 3 pages)', 49, 3);
  await make('rv-maths-2', 'Maths practice 2 (free taster)', 0, 1);
  await make('rv-maths-3', 'Maths practice 3 (free, no pictures)', 0, 1);
  const pic = (n: number) => new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new Array(60).fill(n)]);
  for (const n of [1, 2, 3]) {
    assertStatus(await h.call('POST', `/api/admin/worksheets/rv-maths/pages/${n}`, { token: staff.token, raw: pic(n), contentType: 'image/jpeg' }), 200);
  }
  assertStatus(await h.call('POST', '/api/admin/worksheets/rv-maths-2/pages/1', { token: staff.token, raw: pic(99), contentType: 'image/jpeg' }), 200);

  const c = await h.customer();
  assertStatus(await open(c.token, 'rv-maths'), 402, 'rv-maths was never bought');
  const r = await open(c.token, 'rv-maths-2');
  assertStatus(r, 200);
  const m = await view(c.token, r.body.token, '/api/view/meta');
  assertEquals(m.body.pages, 1);
  const p = await view(c.token, r.body.token, '/api/view/page?n=0');
  assertStatus(p, 200);
  assertEquals(Array.from(p.bytes), Array.from(pic(99)), 'rv-maths-2 shows its own picture');
  assertStatus(await view(c.token, r.body.token, '/api/view/page?n=1'), 404);
  // a sheet with no pictures of its own shows none (not page 3 of rv-maths)
  const r3 = await open(c.token, 'rv-maths-3');
  assertStatus(r3, 200);
  const m3 = await view(c.token, r3.body.token, '/api/view/meta');
  assertEquals(m3.body.hasImages, false);
  assertStatus(await view(c.token, r3.body.token, '/api/view/page?n=0'), 404);
});

test('ACCESS-2 every sheet of a class plan has its own print and download allowance', async () => {
  await ready('az-T');
  await ready('az-U');
  await h.sql`update products set print_limit = 1, download_limit = 1 where id in ('az-T', 'az-U')`;
  const c = await h.customer();
  const plan = await h.grant(c.id, { classId: 'kg', days: 30 });
  const a = await open(c.token, 'az-T');
  assertStatus(a, 200);
  assertEquals(a.body.entitlement.scope, 'class');
  assertStatus(await h.call('POST', '/api/view/print', { token: c.token, headers: viewHeaders(a.body.token) }), 200);
  assertStatus(await h.call('POST', '/api/view/download', { token: c.token, headers: viewHeaders(a.body.token) }), 200);
  assertStatus(await h.call('POST', '/api/view/print', { token: c.token, headers: viewHeaders(a.body.token) }), 429);
  // az-U has never been printed or downloaded
  const b = await open(c.token, 'az-U');
  assertStatus(b, 200);
  assertEquals([b.body.printsLeft, b.body.downloadsLeft], [1, 1]);
  assertStatus(await h.call('POST', '/api/view/print', { token: c.token, headers: viewHeaders(b.body.token) }), 200);
  assertStatus(await h.call('POST', '/api/view/download', { token: c.token, headers: viewHeaders(b.body.token) }), 200);
  const counts = await h.sql`select product_id, kind, used from delivery_counts where entitlement_id = ${plan} order by product_id, kind`;
  assertEquals(counts.map((x) => `${x.product_id}:${x.kind}:${x.used}`), ['az-T:download:1', 'az-T:print:1', 'az-U:download:1', 'az-U:print:1']);
  // reopening az-T still shows its own allowance used up
  const again = await open(c.token, 'az-T');
  assertEquals([again.body.printsLeft, again.body.downloadsLeft], [0, 0]);
});

test('ACCESS-3 a view-only sheet: the viewer copy is stamped, logged and rate-limited; downloading is refused', async () => {
  await ready('az-V', 2);
  const c = await h.customer({ name: 'Meera Iyer' });
  await h.grant(c.id, { productId: 'az-V', days: 30 });
  const r = await open(c.token, 'az-V');
  assertStatus(r, 200);
  assertEquals([r.body.printsLeft, r.body.downloadsLeft], [0, 0]);
  const d = await h.call('POST', '/api/view/download', { token: c.token, headers: viewHeaders(r.body.token) });
  assertStatus(d, 403);
  assertEquals(d.body.code, 'not_allowed');
  // the website draws the sheet from this copy, so it is never refused to an allowed viewer for a 0 limit
  const f = await view(c.token, r.body.token, '/api/view/file');
  assertStatus(f, 200);
  assertEquals(f.headers.get('content-disposition'), 'inline');
  const viewed = await pdfContent(f.bytes);
  assert(viewed.includes(hexOf(`Licensed to ${c.email} - Granted access - `)), 'viewer copy carries the email');
  assert(viewed.includes(hexOf('Name on account: Meera Iyer')), 'viewer copy carries the name');
  assertEquals((await accessRows(c.id)).filter((x) => x.action === 'pdf').map((x) => x.ok), [true]);
  // the copy is not sent without limit: at most FILE_LIMIT.count an hour per account
  await h.sql`
    insert into private.rate_limits (bucket, window_start, hits)
    values (${'view_file:' + c.id}, to_timestamp(floor(extract(epoch from now()) / ${FILE_LIMIT.seconds}) * ${FILE_LIMIT.seconds}), ${FILE_LIMIT.count})
    on conflict (bucket, window_start) do update set hits = excluded.hits`;
  const limited = await view(c.token, r.body.token, '/api/view/file');
  assertStatus(limited, 429);
  assertEquals(limited.body.code, 'rate_limited');
  assertEquals((await accessRows(c.id)).filter((x) => x.action === 'pdf').map((x) => [x.ok, x.detail]), [[true, null], [false, 'file rate limit']]);
  // unauthenticated or without a view token: refused
  assertStatus(await h.call('GET', '/api/view/file', { headers: viewHeaders(r.body.token) }), 401);
  assertEquals((await h.call('GET', '/api/view/file', { token: c.token })).body.code, 'invalid');
});

test('ACCESS-4 delivered copies carry the customer\'s name and email; an unreadable name falls back to the email', async () => {
  await ready('az-W');
  await h.sql`update products set download_limit = 5 where id = 'az-W'`;
  const c = await h.customer({ name: 'Meera Iyer' });
  await h.grant(c.id, { productId: 'az-W', days: 30 });
  const r = await open(c.token, 'az-W');
  const d = await h.call('POST', '/api/view/download', { token: c.token, headers: viewHeaders(r.body.token) });
  assertStatus(d, 200);
  const content = await pdfContent(d.bytes);
  assert(content.includes(hexOf(`Licensed to ${c.email} - Granted access - `)), 'footer stamp has the email');
  assert(content.includes(`<${hexOf('Name on account: Meera Iyer')}>`), 'and the name on its own line');
  assert(content.includes(`<${hexOf(c.email)}>`), 'diagonal stamp has the email');

  const t = await h.customer({ name: 'मीरा अय्यर' });
  await h.grant(t.id, { productId: 'az-W', days: 30 });
  const rt = await open(t.token, 'az-W');
  const dt = await h.call('POST', '/api/view/download', { token: t.token, headers: viewHeaders(rt.body.token) });
  assertStatus(dt, 200);
  const tc = await pdfContent(dt.bytes);
  assert(tc.includes(hexOf(`Licensed to ${t.email} - Granted access - `)), 'the email line is always there');
  assert(!tc.includes(hexOf('Name on account')), 'no name line when the name cannot be printed');
});

/** The text a reader of the PDF can see (pdftotext drops what is drawn outside the page), or null
 *  when poppler's pdftotext is not installed. */
async function visibleText(bytes: Uint8Array): Promise<string | null> {
  const f = await Deno.makeTempFile({ suffix: '.pdf' });
  try {
    await Deno.writeFile(f, bytes);
    const r = await new Deno.Command('pdftotext', { args: ['-layout', f, '-'] }).output();
    return new TextDecoder().decode(r.stdout);
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return null;
    throw e;
  } finally {
    await Deno.remove(f).catch(() => {});
  }
}

test('ACCESS-6 a long or misleading name chosen in PATCH /api/auth/me never pushes the email, order or time off a stamped page', async () => {
  // the layout itself, with the real font metrics: every footer line fits the page, the identifying
  // line comes first and holds the email, the order and the time; the name is cut by measured width
  const font = await (await PDFDocument.create()).embedFont(StandardFonts.Helvetica);
  const at = new Date('2026-10-07T12:30:00Z');
  const room = 595 - 16;
  for (const email of ['meera@example.com', `${'a'.repeat(60)}@${'b'.repeat(60)}.example.com`, `${'x'.repeat(240)}@e.co`]) {
    const o = { name: 'W'.repeat(80), email, orderId: 'LWO-20261007-ABCDEFGH', kind: 'paid' as const, at };
    const { size, lines } = footerLines(font, o, room, 8.5, 5);
    for (const l of lines) assert(font.widthOfTextAtSize(l, size) <= room + 0.01, `line fits the page: ${l}`);
    assert(size >= 5, 'readable size');
    const ids = lines.slice(0, -1).join('');
    assert(ids.replace(/ - /g, '').includes(`Licensed to ${email}`.replace(/ - /g, '')), `the email is drawn in full: ${lines.join(' | ')}`);
    assert(ids.includes('Order LWO-20261007-ABCDEFGH') && ids.includes('2026-10-07 12:30 UTC'), 'order and time are drawn');
    assertMatch(lines[lines.length - 1], /^Name on account: W+\.\.\.$|^Name on account: W{60}$/);
  }
  assertEquals(stampText({ name: 'Priya Sharma priya@x.com', email: 'a@b.co', orderId: null, kind: 'grant', at }),
    'Licensed to a@b.co - Granted access - 2026-10-07 12:30 UTC', 'the identifying line never carries the chosen name');

  // end to end: the customer renames themself to a long name, then opens and downloads the sheet
  await ready('az-X');
  await h.sql`update products set download_limit = 5 where id = 'az-X'`;
  const c = await h.customer({ name: 'Meera Iyer' });
  await h.grant(c.id, { productId: 'az-X', days: 30 });
  for (const name of ['W'.repeat(60), `Priya Sharma priya@x.com ${'.'.repeat(54)}`]) {
    assertStatus(await h.call('PATCH', '/api/auth/me', { token: c.token, body: { name } }), 200, 'rename');
    const r = await open(c.token, 'az-X');
    assertStatus(r, 200);
    const f = await view(c.token, r.body.token, '/api/view/file');
    assertStatus(f, 200);
    const d = await h.call('POST', '/api/view/download', { token: c.token, headers: viewHeaders(r.body.token) });
    assertStatus(d, 200);
    for (const bytes of [f.bytes, d.bytes]) {
      const content = await pdfContent(bytes);
      assert(content.includes(`<${hexOf(`Licensed to ${c.email} - Granted access - `)}`), 'the identifying line is drawn on its own');
      assert(content.includes(`<${hexOf(c.email)}>`), 'the diagonal stamp is the email alone');
      const seen = await visibleText(bytes);
      if (seen === null) continue; // pdftotext is not installed: the layout checks above still ran
      const flat = seen.replace(/\s+/g, ' ');
      assert(flat.includes(`Licensed to ${c.email} - Granted access - `), `the email stays readable on the page; visible text was: ${flat.slice(0, 400)}`);
      assertMatch(flat, /Granted access - \d{4}-\d\d-\d\d \d\d:\d\d UTC/, 'and the time');
      assert(flat.includes('Name on account: '), 'the name is labelled as the name on the account');
    }
  }
});

test('ACCESS-5 a free sheet opens on its own free pass for a class-plan holder, also when paid access is paused or the plan ends', async () => {
  await ready('vc-3');
  const c = await h.customer();
  const plan = await h.grant(c.id, { classId: 'kg', days: 30 });
  const r = await open(c.token, 'vc-3');
  assertStatus(r, 200);
  assertEquals([r.body.entitlement.scope, r.body.entitlement.kind], ['worksheet', 'free']);

  await h.sql`update profiles set subscription_suspended_at = now(), suspension_reason = 'staff' where id = ${c.id}`;
  assertStatus(await view(c.token, r.body.token, '/api/view/meta'), 200);
  assertStatus(await open(c.token, 'vc-3'), 200);
  await h.sql`update profiles set subscription_suspended_at = null, suspension_reason = null where id = ${c.id}`;

  await h.sql`update entitlements set starts_at = now() - interval '40 days', expires_at = now() - interval '1 minute' where id = ${plan}`;
  assertStatus(await view(c.token, r.body.token, '/api/view/meta'), 200);

  // a viewer opened through the plan before this fix carries on with the free pass
  const d = await h.customer();
  const oldPlan = await h.grant(d.id, { classId: 'kg', days: 30 });
  const oldToken = await tx((q) => makeViewToken(q, { userId: d.id, productId: 'vc-3', entitlementId: oldPlan, sessionId: d.sessionId, exp: Date.now() + 60_000 }));
  await h.sql`update entitlements set starts_at = now() - interval '40 days', expires_at = now() - interval '1 minute' where id = ${oldPlan}`;
  const carried = await view(d.token, oldToken, '/api/view/meta');
  assertStatus(carried, 200);
  assertEquals((await h.sql`select count(*)::int as n from entitlements where user_id = ${d.id} and product_id = 'vc-3' and kind = 'free'`)[0].n, 1);
});
