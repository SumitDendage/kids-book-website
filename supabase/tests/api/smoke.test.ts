// Smoke tests for the test harness itself: the in-process API, the fake Supabase Auth/Storage
// server, the mail capture and the helpers other test files rely on.
import {
  assert, assertEquals, assertMatch, assertRejects, assertStatus, randomIp, startHarness, test, uniqueEmail,
} from './harness.ts';
import { router } from '../../functions/api/lib/app.ts';
import { env, mailReady } from '../../functions/api/lib/env.ts';
import { makeCtx } from '../../functions/api/lib/context.ts';
import { requireStaff, requireUser } from '../../functions/api/lib/auth.ts';
import { HttpError } from '../../functions/api/lib/http.ts';
import { getSettings } from '../../functions/api/lib/settings.ts';
import { sendNow } from '../../functions/api/lib/mail.ts';
import { tx } from '../../functions/api/lib/db.ts';
import * as gotrue from '../../functions/api/lib/gotrue.ts';
import * as storage from '../../functions/api/lib/storage.ts';

const h = await startHarness();

// Temporary routes that exist only in this test process.
router.get('/api/__smoke/me', async (ctx) => {
  const u = await requireUser(ctx);
  return { id: u.id, sessionId: u.sessionId, staff: u.staff };
});
router.get('/api/__smoke/staff', async (ctx) => {
  const u = await requireStaff(ctx, 'orders.write');
  return { id: u.id, role: u.staff?.role };
});
router.post('/api/__smoke/echo', async (ctx) => ({
  ip: ctx.ip, deviceIdHash: ctx.deviceIdHash, ua: ctx.ua, body: await ctx.req.json(), q: ctx.query.get('q'),
}));

async function ctxFor(token: string | null) {
  const headers: Record<string, string> = { 'x-forwarded-for': randomIp() };
  if (token) headers.authorization = `Bearer ${token}`;
  const req = new Request('http://api.local/functions/v1/api/x', { headers });
  return await makeCtx(req, new URL(req.url), '/api/x', env());
}

async function httpErr(p: Promise<unknown>): Promise<HttpError> {
  try {
    await p;
  } catch (e) {
    if (e instanceof HttpError) return e;
    throw e;
  }
  throw new Error('expected an HttpError');
}

test('env points the API at the fakes', async () => {
  assertEquals(env().supabaseUrl, h.fake.url);
  assert(env().secretKey.startsWith('sb_secret_'));
  assert((env().jwtSecret ?? '').length >= 40);
  assert(mailReady());
  assertEquals(env().siteUrl, 'http://localhost:5173');
  const r = await h.sql<{ n: number }[]>`select count(*)::bigint as n from products`;
  assert(typeof r[0].n === 'number' && r[0].n > 0, 'bigint comes back as a number');
});

test('unknown route is 404 and CORS preflight is 204', async () => {
  const r = await h.call('GET', '/api/no-such-route');
  assertStatus(r, 404);
  assertEquals(r.body, { error: 'Not found' });
  assertEquals(r.headers.get('x-content-type-options'), 'nosniff');

  const pre = await h.call('OPTIONS', '/api/auth/login', { headers: { origin: 'http://localhost:5173', 'access-control-request-method': 'POST' } });
  assertStatus(pre, 204);
  assertEquals(pre.headers.get('access-control-allow-origin'), '*');
  assertMatch(pre.headers.get('access-control-allow-methods') ?? '', /POST/);

  h.setEnv({ ALLOWED_ORIGINS: 'https://learnwithwhy.in' });
  try {
    const bad = await h.call('OPTIONS', '/api/auth/login', { headers: { origin: 'https://evil.example' } });
    assertStatus(bad, 403);
    const good = await h.call('OPTIONS', '/api/auth/login', { headers: { origin: 'https://learnwithwhy.in' } });
    assertStatus(good, 204);
    assertEquals(good.headers.get('access-control-allow-origin'), 'https://learnwithwhy.in');
  } finally {
    h.resetEnv();
  }
});

test('h.call: paths, JSON body, ip, device and query reach the handler', async () => {
  const a = await h.call('POST', '/api/__smoke/echo?q=hi', { body: { x: 1 }, ip: '10.9.8.7', device: 'dev_abcdefghijklmnop' });
  assertStatus(a, 200);
  assertEquals(a.body.ip, '10.9.8.7');
  assertEquals(a.body.body, { x: 1 });
  assertEquals(a.body.q, 'hi');
  assertEquals(a.body.deviceIdHash, await h.deviceHash('dev_abcdefghijklmnop'));
  assertMatch(a.body.ua, /Chrome/);
  const b = await h.call('POST', '__smoke/echo', { body: { y: 2 } });
  assertEquals(b.body.body, { y: 2 });
  assertEquals(b.body.deviceIdHash, await h.deviceHash());
  const c = await h.call('POST', '/functions/v1/api/__smoke/echo', { body: { z: 3 } });
  assertEquals(c.body.body, { z: 3 });
});

test('fake GoTrue through lib/gotrue.ts: create, password grant, refresh, logout', async () => {
  const email = uniqueEmail('gt');
  const { id } = await gotrue.adminCreateUser({ email, password: 'Secret-Pass-1', name: 'Gee Tee', via: 'signup', confirmed: true });
  assertMatch(id, /^[0-9a-f-]{36}$/);
  const prof = await h.sql`select email, name, created_via, status from profiles where id = ${id}`;
  assertEquals(prof[0].email, email);
  assertEquals(prof[0].name, 'Gee Tee');
  assertEquals(prof[0].created_via, 'signup');

  const dup = await assertRejects(() => gotrue.adminCreateUser({ email, password: 'Secret-Pass-1', name: 'x', via: 'signup' }));
  assertEquals((dup as gotrue.AuthApiError).code, 'email_exists');
  // two sign-ups racing for one address: exactly one wins
  const race = uniqueEmail('race');
  const both = await Promise.allSettled([1, 2].map(() => gotrue.adminCreateUser({ email: race, password: 'Secret-Pass-1', name: 'r', via: 'signup' })));
  assertEquals(both.filter((x) => x.status === 'fulfilled').length, 1);
  const lost = both.find((x) => x.status === 'rejected') as PromiseRejectedResult;
  assertEquals((lost.reason as gotrue.AuthApiError).code, 'email_exists');

  const bad = await assertRejects(() => gotrue.passwordGrant(email, 'wrong-password'));
  assertEquals((bad as gotrue.AuthApiError).status, 400);
  assertEquals((bad as gotrue.AuthApiError).code, 'invalid_credentials');

  const s = await gotrue.passwordGrant(email, 'Secret-Pass-1');
  assertEquals(s.userId, id);
  assert(s.emailConfirmed);
  assertMatch(s.sessionId, /^[0-9a-f-]{36}$/);
  assertEquals((await h.sql`select user_id from auth.sessions where id = ${s.sessionId}`)[0].user_id, id);
  const claims = gotrue.decodeClaims(s.accessToken);
  assertEquals(claims.iss, `${h.fake.url}/auth/v1`);
  assertEquals(claims.aud, 'authenticated');
  assertEquals(claims.sub, id);
  assertEquals(claims.email, email);

  const me = await gotrue.getUser(s.accessToken);
  assertEquals(me, { id, email });

  const r = await gotrue.refreshGrant(s.refreshToken);
  assertEquals(r.sessionId, s.sessionId);
  assert(r.refreshToken !== s.refreshToken, 'refresh tokens rotate');

  await gotrue.logoutSession(r.accessToken);
  assertEquals((await h.sql`select 1 from auth.sessions where id = ${s.sessionId}`).length, 0);
  const gone = await assertRejects(() => gotrue.refreshGrant(r.refreshToken));
  assertEquals((gone as gotrue.AuthApiError).status, 400);
  assertEquals((gone as gotrue.AuthApiError).code, 'refresh_token_not_found');
  assertEquals(await gotrue.getUser(r.accessToken), null);
});

test('fake GoTrue: unconfirmed, ban, password change, deleted session, delete user', async () => {
  const email = uniqueEmail('gt2');
  const { id } = await gotrue.adminCreateUser({ email, password: 'First-Pass-1', name: 'Unconfirmed', via: 'signup', confirmed: false });
  const nc = await assertRejects(() => gotrue.passwordGrant(email, 'First-Pass-1'));
  assertEquals((nc as gotrue.AuthApiError).code, 'email_not_confirmed');
  // a wrong password on an unconfirmed account is still "invalid credentials"
  assertEquals(((await assertRejects(() => gotrue.passwordGrant(email, 'nope-nope'))) as gotrue.AuthApiError).code, 'invalid_credentials');

  await gotrue.adminUpdateUser(id, { emailConfirm: true, password: 'Second-Pass-2' });
  await assertRejects(() => gotrue.passwordGrant(email, 'First-Pass-1'));
  const s = await gotrue.passwordGrant(email, 'Second-Pass-2');

  // deleting the auth.sessions row (what private.end_auth_sessions does) kills the refresh token
  await tx((q) => q`select private.end_auth_sessions(${id}::uuid, null)`);
  const rf = await assertRejects(() => gotrue.refreshGrant(s.refreshToken));
  assertEquals((rf as gotrue.AuthApiError).code, 'refresh_token_not_found');

  await gotrue.adminUpdateUser(id, { ban: '876000h' });
  assertEquals(((await assertRejects(() => gotrue.passwordGrant(email, 'Second-Pass-2'))) as gotrue.AuthApiError).code, 'user_banned');
  await gotrue.adminUpdateUser(id, { ban: null });
  await gotrue.passwordGrant(email, 'Second-Pass-2');

  await gotrue.adminUpdateUser(id, { name: 'Renamed' });
  assertEquals((await h.sql`select raw_user_meta_data->>'name' as n from auth.users where id = ${id}`)[0].n, 'Renamed');

  await gotrue.adminDeleteUser(id);
  assertEquals((await h.sql`select 1 from profiles where id = ${id}`).length, 0);
  const missing = await assertRejects(() => gotrue.adminUpdateUser(id, { password: 'Third-Pass-3' }));
  assertEquals((missing as gotrue.AuthApiError).status, 404);
});

test('fake GoTrue: refresh reuse window and logout scopes', async () => {
  const email = uniqueEmail('gt3');
  await gotrue.adminCreateUser({ email, password: 'Reuse-Pass-1', name: 'R', via: 'signup', confirmed: true });
  const s1 = await gotrue.passwordGrant(email, 'Reuse-Pass-1');
  const r1 = await gotrue.refreshGrant(s1.refreshToken);
  // a second tab refreshing with the old token within 10 s gets the current token, same session
  const again = await gotrue.refreshGrant(s1.refreshToken);
  assertEquals(again.refreshToken, r1.refreshToken);
  assertEquals(again.sessionId, s1.sessionId);

  const s2 = await gotrue.passwordGrant(email, 'Reuse-Pass-1');
  const s3 = await gotrue.passwordGrant(email, 'Reuse-Pass-1');
  const others = await fetch(`${h.fake.url}/auth/v1/logout?scope=others`, {
    method: 'POST', headers: { apikey: h.env().SUPABASE_ANON_KEY!, Authorization: `Bearer ${s3.accessToken}` },
  });
  assertEquals(others.status, 204);
  const left = await h.sql`select id from auth.sessions where user_id = ${s1.userId}`;
  assertEquals(left.map((r) => r.id), [s3.sessionId]);
  await assertRejects(() => gotrue.refreshGrant(s2.refreshToken), /Not Found/);
  await gotrue.refreshGrant(s3.refreshToken);
  const global = await fetch(`${h.fake.url}/auth/v1/logout`, {
    method: 'POST', headers: { apikey: h.env().SUPABASE_ANON_KEY!, Authorization: `Bearer ${s3.accessToken}` },
  });
  assertEquals(global.status, 204);
  assertEquals((await h.sql`select 1 from auth.sessions where user_id = ${s1.userId}`).length, 0);
  // the access token's session is gone: GoTrue answers 403 session_not_found
  const after = await fetch(`${h.fake.url}/auth/v1/user`, { headers: { apikey: h.env().SUPABASE_ANON_KEY!, Authorization: `Bearer ${s3.accessToken}` } });
  assertEquals(after.status, 403);
  assertEquals((await after.json()).error_code, 'session_not_found');
});

test('fake GoTrue checks keys', async () => {
  const res = await fetch(`${h.fake.url}/auth/v1/admin/users`, {
    method: 'POST', headers: { apikey: h.env().SUPABASE_ANON_KEY!, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: uniqueEmail('k'), password: 'whatever-1' }),
  });
  assertEquals(res.status, 403);
  await res.body?.cancel();
  const none = await fetch(`${h.fake.url}/auth/v1/token?grant_type=password`, { method: 'POST', body: '{}' });
  assertEquals(none.status, 401);
  await none.body?.cancel();
  const unknown = await fetch(`${h.fake.url}/nothing/here`);
  assertEquals(unknown.status, 404);
  await unknown.body?.cancel();
});

test('customer() and staff() tokens pass lib/auth.ts', async () => {
  const c = await h.customer({ name: 'Asha' });
  const u = await requireUser(await ctxFor(c.token));
  assertEquals(u.id, c.id);
  assertEquals(u.sessionId, c.sessionId);
  assertEquals(u.staff, null);
  assertEquals(u.profile.name, 'Asha');
  assertEquals(u.profile.status, 'active');
  const ag = (await getSettings()).agreement.version;
  assertEquals(u.profile.agreement_version, ag);
  const sess = await h.sql`select is_staff, remember, device_id_hash, expires_at > now() + interval '11 hours' as long_enough,
                                  expires_at < now() + interval '13 hours' as short from app_sessions where id = ${c.sessionId}`;
  assertEquals(sess[0].is_staff, false);
  assertEquals(sess[0].remember, false);
  assertEquals(sess[0].device_id_hash, await h.deviceHash());
  assert(sess[0].long_enough && sess[0].short, 'a 12 hour session');

  // through the router as well
  const me = await h.call('GET', '/api/__smoke/me', { token: c.token });
  assertStatus(me, 200);
  assertEquals(me.body.id, c.id);
  assertStatus(await h.call('GET', '/api/__smoke/me'), 401);
  assertEquals((await h.call('GET', '/api/__smoke/me', { token: 'not-a-jwt' })).body.code, 'signin');

  const remembered = await h.customer({ remember: true });
  const rs = await h.sql`select expires_at > now() + interval '29 days' as ok from app_sessions where id = ${remembered.sessionId}`;
  assert(rs[0].ok, 'remember → 30 days');

  const owner = await h.staff('owner');
  const so = await h.call('GET', '/api/__smoke/staff', { token: owner.token });
  assertStatus(so, 200);
  assertEquals(so.body.role, 'owner');
  assertEquals((await h.sql`select is_staff from app_sessions where id = ${owner.sessionId}`)[0].is_staff, true);

  const support = await h.staff('support');
  const ss = await h.call('GET', '/api/__smoke/staff', { token: support.token });
  assertStatus(ss, 403);
  assertEquals(ss.body.code, 'forbidden');
  const custom = await h.staff('support', ['orders.read', 'orders.write']);
  assertStatus(await h.call('GET', '/api/__smoke/staff', { token: custom.token }), 200);
  assertEquals((await h.call('GET', '/api/__smoke/staff', { token: c.token })).body.code, 'not_staff');
});

test('requireUser refusals: unverified, revoked, blocked session, blocked account, expired token', async () => {
  const un = await h.customer({ verified: false });
  assertEquals((await httpErr(requireUser(await ctxFor(un.token)))).extra.code, 'email_unverified');
  const ok = await requireUser(await ctxFor(un.token), { allowUnverified: true });
  assertEquals(ok.id, un.id);

  const a = await h.customer();
  await h.sql`update app_sessions set blocked_at = now() where id = ${a.sessionId}`;
  assertEquals((await httpErr(requireUser(await ctxFor(a.token)))).extra.code, 'session_blocked');
  await h.sql`update app_sessions set revoked_at = now(), revoke_reason = 'logout' where id = ${a.sessionId}`;
  assertEquals((await httpErr(requireUser(await ctxFor(a.token)))).status, 401);

  const b = await h.customer();
  await h.sql`update profiles set blocked_at = now() where id = ${b.id}`;
  assertEquals((await httpErr(requireUser(await ctxFor(b.token)))).extra.code, 'account_suspended');

  const c = await h.customer();
  const expired = await h.fake.auth.mintAccessToken({ userId: c.id, sessionId: c.sessionId, email: c.email, expiresIn: -60 });
  assertEquals((await httpErr(requireUser(await ctxFor(expired)))).extra.code, 'signin');
  const forged = await h.fake.auth.mintAccessToken({ userId: c.id, sessionId: c.sessionId, secret: 'another-secret-another-secret-another-secret' });
  assertEquals((await httpErr(requireUser(await ctxFor(forged)))).status, 401);
  const fresh = await h.fake.auth.mintAccessToken({ userId: c.id, sessionId: c.sessionId, email: c.email });
  assertEquals((await requireUser(await ctxFor(fresh))).id, c.id);
});

test('customer refresh token works with the fake and dies with the session', async () => {
  const c = await h.customer();
  const r = await gotrue.refreshGrant(c.refreshToken);
  assertEquals(r.sessionId, c.sessionId);
  assertEquals((await requireUser(await ctxFor(r.accessToken))).id, c.id);
  await h.sql`delete from auth.sessions where id = ${c.sessionId}`;
  assertEquals(((await assertRejects(() => gotrue.refreshGrant(r.refreshToken))) as gotrue.AuthApiError).code, 'refresh_token_not_found');
});

test('storage: put, private.worksheet_objects, lib/storage.ts round trip', async () => {
  const bytes = new TextEncoder().encode('%PDF-1.4 not really');
  await h.storage.put('worksheets', 'smoke/one.pdf', bytes, 'application/pdf');
  assert(h.storage.has('worksheets', 'smoke/one.pdf'));
  const seen = await tx((q) => q<{ name: string; size: number }[]>`select name, size from private.worksheet_objects(${['smoke/one.pdf', 'smoke/none.pdf']}::text[])`);
  assertEquals(seen.map((r) => [r.name, r.size]), [['smoke/one.pdf', bytes.byteLength]]);

  // the API's own client against the fake
  const pdf = await h.samplePdf(2);
  await storage.upload(storage.WORKSHEETS, 'smoke/two words.pdf', pdf, 'application/pdf');
  assert(h.storage.has('worksheets', 'smoke/two words.pdf'));
  const back = await storage.downloadBytes(storage.WORKSHEETS, 'smoke/two words.pdf');
  assertEquals(back?.byteLength, pdf.byteLength);
  assertEquals(await storage.downloadBytes(storage.WORKSHEETS, 'smoke/missing.pdf'), null);
  const signed = await storage.signedUrl(storage.WORKSHEETS, 'smoke/two words.pdf', 60, null);
  const viaLink = await fetch(signed);
  assertEquals(viaLink.status, 200);
  assertEquals(new Uint8Array(await viaLink.arrayBuffer()).byteLength, pdf.byteLength);
  const tampered = await fetch(signed.replace('two%20words', 'one'));
  assertEquals(tampered.status, 400);
  await tampered.body?.cancel();
  // private bucket objects are not public
  const pub = await fetch(storage.publicUrl(storage.WORKSHEETS, 'smoke/two words.pdf'));
  assertEquals(pub.status, 404);
  await pub.body?.cancel();
  await storage.upload(storage.COVERS, 'smoke/c.png', new Uint8Array([137, 80, 78, 71]), 'image/png');
  const cov = await fetch(storage.publicUrl(storage.COVERS, 'smoke/c.png'));
  assertEquals(cov.status, 200);
  assertEquals(cov.headers.get('content-type'), 'image/png');
  await cov.body?.cancel();
  // bucket rules: mime types and size limit (covers: 5 MB)
  await assertRejects(() => storage.upload(storage.COVERS, 'smoke/c.pdf', pdf, 'application/pdf'), /refused/);
  await assertRejects(() => storage.upload(storage.COVERS, 'smoke/big.png', new Uint8Array(5 * 1024 * 1024 + 1), 'image/png'), /refused/);
  assert(!h.storage.has('covers', 'smoke/big.png'));
  // without the secret key, storage refuses
  const anon = await fetch(`${h.fake.url}/storage/v1/object/worksheets/smoke/two%20words.pdf`, { headers: { apikey: h.env().SUPABASE_ANON_KEY! } });
  assertEquals(anon.status, 403);
  await anon.body?.cancel();

  await storage.remove(storage.WORKSHEETS, ['smoke/one.pdf', 'smoke/two words.pdf']);
  assert(!h.storage.has('worksheets', 'smoke/one.pdf'));
  assertEquals((await h.sql`select 1 from storage.objects where bucket_id = 'worksheets' and name like 'smoke/%'`).length, 0);
});

test('uploadPdfFor puts a real PDF at the product path', async () => {
  const before = await tx((q) => q<{ has_pdf: boolean }[]>`select has_pdf from private.product_file_status() where product_id = 'az-C'`);
  assertEquals(before[0].has_pdf, false);
  await h.uploadPdfFor('az-C', 3);
  const after = await tx((q) => q<{ has_pdf: boolean; pdf_bytes: number }[]>`select has_pdf, pdf_bytes from private.product_file_status() where product_id = 'az-C'`);
  assertEquals(after[0].has_pdf, true);
  assert(after[0].pdf_bytes > 500);
  const f = h.storage.get('worksheets', 'a-to-z/C.pdf');
  assertEquals(new TextDecoder().decode(f!.bytes.slice(0, 5)), '%PDF-');
});

test('grant() inserts live, expired and scheduled access', async () => {
  const c = await h.customer();
  const live = await h.grant(c.id, { productId: 'az-D' });
  const old = await h.grant(c.id, { productId: 'az-E', days: -1 });
  const later = await h.grant(c.id, { classId: 'kg', startsInDays: 5, days: 35 });
  const rows = await h.sql`select id, starts_at <= now() as started, expires_at > now() as open from entitlements where user_id = ${c.id} order by id`;
  assertEquals(rows.map((r) => [r.id, r.started, r.open]), [[live, true, true], [old, true, false], [later, false, true]]);
  await assertRejects(() => h.grant(c.id, {}), /productId or classId/);
});

test('mail capture: transport, failNext, outbox, and the HTTP path', async () => {
  h.mail.clear();
  const ok = await sendNow({ to: 'Parent@Test.Local', subject: 'Hi', html: '<p>Open <a href="http://localhost:5173/?verify=abc123">this</a></p>', text: 'Open http://localhost:5173/?verify=abc123' });
  assert(ok.ok);
  assertEquals(h.mail.last('parent@test.local')?.subject, 'Hi');
  assertEquals(h.mail.linkParam('parent@test.local', 'verify'), 'abc123');

  h.mail.failNext(1, true);
  const bad = await sendNow({ to: 'x@test.local', subject: 'Nope', html: '', text: '' });
  assert(!bad.ok && bad.permanent === true);
  h.mail.failNext(1);
  const soft = await sendNow({ to: 'x@test.local', subject: 'Nope', html: '', text: '' });
  assert(!soft.ok && !soft.permanent);
  assertEquals(h.mail.to('x@test.local').length, 0);
  assertEquals(h.mail.failed.length, 2);

  // outbox: one sends, one fails (temporary → retried later)
  await h.sql`insert into email_outbox (template, to_email, subject, body_html, body_text) values
    ('test_one', 'o1@test.local', 'Outbox one', '<p>1</p>', '1'), ('test_two', 'o2@test.local', 'Outbox two', '<p>2</p>', '2')`;
  h.mail.failNext(1);
  const r = await h.processOutbox();
  assertEquals(r, { sent: 1, failed: 1 });
  const rows = await h.sql`select template, status, attempts from email_outbox where template like 'test_%' order by id`;
  assertEquals(rows.map((x) => x.status), ['failed', 'sent']);

  // real provider code path (Brevo over HTTP) against the fake
  h.mail.off();
  try {
    const viaHttp = await sendNow({ to: 'http@test.local', subject: 'Over HTTP', html: '<b>x</b>', text: 'x', replyTo: 'r@test.local' });
    assert(viaHttp.ok);
    assertEquals(h.mail.last('http@test.local')?.via, 'brevo');
    assertEquals(h.mail.last('http@test.local')?.replyTo, 'r@test.local');
    h.mail.failNext(1, true);
    const refused = await sendNow({ to: 'http@test.local', subject: 'x', html: 'x', text: 'x' });
    assert(!refused.ok && refused.permanent === true);
    h.setEnv({ MAIL_PROVIDER: 'resend', RESEND_API_KEY: 'test' });
    const viaResend = await sendNow({ to: 'resend@test.local', subject: 'Resend', html: 'x', text: 'x' });
    assert(viaResend.ok);
    assertEquals(h.mail.last('resend@test.local')?.via, 'resend');
  } finally {
    h.mail.on();
    h.resetEnv();
  }
});

test('setSetting writes the row and clears the cache', async () => {
  assertEquals((await getSettings()).worksheet_access, { days: 1, hours: 1 });
  await h.setSetting('worksheet_access', { days: 30 });
  assertEquals((await getSettings()).worksheet_access, { days: 30, hours: 720 }, 'days only still mean those days');
  await h.setSetting('worksheet_access', { days: 1, hours: 1 });
  assertEquals((await getSettings()).worksheet_access, { days: 1, hours: 1 });
});

test('fake.route adds and overrides endpoints', async () => {
  const off = h.fake.route('GET', '/v1/things', () => Response.json({ ok: 1 }));
  const r = await fetch(`${h.fake.url}/v1/things/7`);
  assertEquals(await r.json(), { ok: 1 });
  off();
  const gone = await fetch(`${h.fake.url}/v1/things/7`);
  assertEquals(gone.status, 404);
  await gone.body?.cancel();
  // override Auth to simulate an outage: the API maps it to 503 auth_unavailable
  const down = h.fake.route('POST', '/auth/v1/token', () => new Response('down', { status: 502 }));
  try {
    const e = await httpErr(gotrue.passwordGrant('a@test.local', 'x'));
    assertEquals(e.status, 503);
    assertEquals(e.extra.code, 'auth_unavailable');
  } finally {
    down();
  }
  assert(h.fake.calls('/auth/v1/token', 'POST').length > 0);
});

test('h.login goes through /api/auth/login (needs routes/auth.ts)', async () => {
  const c = await h.customer();
  const r = await h.login(c.email, c.password);
  assert(r.status === 200, `login: ${r.status} ${JSON.stringify(r.body)}`);
  assert(r.token && r.refreshToken, 'tokens in body.session');
  assertEquals(r.body.user.email, c.email);
  const me = await h.call('GET', '/api/__smoke/me', { token: r.token });
  assertStatus(me, 200);
  const wrong = await h.login(c.email, 'Wrong-Password-9');
  assert(wrong.status >= 400 && wrong.status < 500 && !wrong.token);
});

// keep last: closes the pools and the fake server
test('close() shuts everything down', async () => {
  const url = h.fake.url;
  await h.close();
  const r = await fetch(`${url}/auth/v1/user`).then(() => 'open', () => 'closed');
  assertEquals(r, 'closed');
});
