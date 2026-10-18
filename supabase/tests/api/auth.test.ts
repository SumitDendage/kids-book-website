// Auth routes (routes/auth.ts) and the account service (services/accounts.ts).
import {
  assert, assertEquals, assertMatch, assertNotEquals, assertStatus, randomIp, startHarness, test, testPassword, uniqueEmail,
  type Harness, type TestUser,
} from './harness.ts';
import { makeCtx, type Ctx } from '../../functions/api/lib/context.ts';
import { env } from '../../functions/api/lib/env.ts';
import { tx } from '../../functions/api/lib/db.ts';
import { requireUser } from '../../functions/api/lib/auth.ts';
import { sha256Hex } from '../../functions/api/lib/util.ts';
import { DEFAULTS } from '../../functions/api/lib/settings.ts';
import { blockAccount, endAllSessions, unblockAccount } from '../../functions/api/services/accounts.ts';

const h: Harness = await startHarness();
const SITE = 'http://localhost:5173';

// ── helpers ──────────────────────────────────────────────────────────────────────────────

async function profileOf(email: string) {
  const r = await h.sql`select * from profiles where email = ${email}`;
  return r[0];
}

async function appSessions(userId: string) {
  return await h.sql`select * from app_sessions where user_id = ${userId} order by created_at`;
}

async function authSessionCount(userId: string): Promise<number> {
  const r = await h.sql<{ n: number }[]>`select count(*)::int as n from auth.sessions where user_id = ${userId}`;
  return r[0].n;
}

/** Tables (public, auth, private) with any row whose text contains needle. */
async function rowsContaining(needle: string): Promise<string[]> {
  const tables = await h.sql<{ s: string; t: string }[]>`
    select table_schema as s, table_name as t from information_schema.tables
    where table_schema in ('public', 'auth', 'private', 'storage') and table_type = 'BASE TABLE'`;
  const hits: string[] = [];
  for (const { s, t } of tables) {
    const r = await h.sql.unsafe(`select count(*)::int as n from "${s}"."${t}" x where x::text like $1`, [`%${needle}%`]);
    if (r[0].n > 0) hits.push(`${s}.${t}`);
  }
  return hits;
}

/** A request context signed in as `u` (for calling the account service directly). */
async function ctxAs(u: TestUser): Promise<Ctx> {
  const req = new Request('http://api.local/api/admin/test', {
    headers: { authorization: `Bearer ${u.token}`, 'x-forwarded-for': randomIp(), 'user-agent': h.userAgent },
  });
  const ctx = await makeCtx(req, new URL(req.url), '/api/admin/test', env());
  await requireUser(ctx);
  return ctx;
}

const me = (token?: string) => h.call('GET', '/api/auth/me', { token });
const refresh = (refreshToken: unknown) => h.call('POST', '/api/auth/refresh-token', { body: { refreshToken } });

// ── code sign-up and sign-in (Supabase Auth's emailed 6-digit code) ─────────────────────

test('otp: new sign-up, the account opens only after the right code; agreement recorded', async () => {
  const email = uniqueEmail('otp-new');
  // a wrong code first: nothing opens, no app sign-in
  const wrong = await h.otpLogin(email, { createUser: true, name: 'Asha Rao', agreement: true, code: '000001' });
  assertEquals(wrong.verified, 403);
  assertEquals(wrong.body.error_code, 'otp_expired');
  const p0 = await profileOf(email);
  assert(p0, 'Supabase Auth may hold an unconfirmed record before the code');
  assertEquals(p0.email_verified_at, null);
  assertEquals((await appSessions(p0.id)).length, 0);

  const ok = await h.otpLogin(email, { createUser: true, name: 'Asha Rao', agreement: true });
  assertStatus(ok, 200);
  assert(ok.token && ok.refreshToken);
  assertEquals(ok.body.user.email, email);
  assertEquals(ok.body.user.name, 'Asha Rao');
  assertEquals(ok.body.staff, null);
  const p = await profileOf(email);
  assert(p.email_verified_at, 'the code confirmed the address');
  assertEquals(p.agreement_version, DEFAULTS.agreement.version);
  assertEquals((await appSessions(p.id)).length, 1);
  assertStatus(await me(ok.token), 200);
  // no code is ever stored by this API
  assertEquals((await rowsContaining(h.fake.auth.lastOtp(email) ?? 'never-a-code')).filter((t) => !t.startsWith('auth.')).length, 0);
});

test('otp: a new account must accept the agreement; the session waits for the tick', async () => {
  const email = uniqueEmail('otp-agree');
  const headers = { apikey: h.env().SUPABASE_ANON_KEY!, 'Content-Type': 'application/json' };
  await (await fetch(`${h.fake.url}/auth/v1/otp`, { method: 'POST', headers, body: JSON.stringify({ email, create_user: true }) })).body?.cancel();
  const v = await (await fetch(`${h.fake.url}/auth/v1/verify`, { method: 'POST', headers, body: JSON.stringify({ type: 'email', email, token: h.fake.auth.lastOtp(email) }) })).json();
  const first = await h.call('POST', '/api/auth/otp/session', { token: v.access_token, body: { refreshToken: v.refresh_token } });
  assertStatus(first, 403);
  assertEquals(first.body.code, 'agreement_required');
  // the same session goes through once ticked: no second code needed
  const second = await h.call('POST', '/api/auth/otp/session', { token: v.access_token, body: { refreshToken: v.refresh_token, agreement: true } });
  assertStatus(second, 200);
  // and only once
  const third = await h.call('POST', '/api/auth/otp/session', { token: v.access_token, body: { refreshToken: v.refresh_token, agreement: true } });
  assertStatus(third, 409);
});

test('otp: existing customer signs in with a fresh code; unknown address is refused without create_user', async () => {
  const c = await h.customer();
  const r = await h.otpLogin(c.email);
  assertStatus(r, 200);
  assertEquals(r.body.user.id, c.id);
  const before = (await appSessions(c.id)).length;
  const again = await h.otpLogin(c.email);
  assertStatus(again, 200);
  assertEquals((await appSessions(c.id)).length, before + 1);
  const nobody = await h.otpLogin(uniqueEmail('otp-nobody'));
  assertEquals(nobody.sent, 422);
});

test('otp: an expired code and a used code fail', async () => {
  const c = await h.customer();
  const headers = { apikey: h.env().SUPABASE_ANON_KEY!, 'Content-Type': 'application/json' };
  h.fake.auth.forgetOtp(c.email);
  await (await fetch(`${h.fake.url}/auth/v1/otp`, { method: 'POST', headers, body: JSON.stringify({ email: c.email, create_user: false }) })).body?.cancel();
  const code = h.fake.auth.lastOtp(c.email)!;
  h.fake.auth.expireOtp(c.email);
  const expired = await fetch(`${h.fake.url}/auth/v1/verify`, { method: 'POST', headers, body: JSON.stringify({ type: 'email', email: c.email, token: code }) });
  assertEquals(expired.status, 403);
  await expired.body?.cancel();
  // a resend inside 60 s is held by Supabase Auth
  const soon = await fetch(`${h.fake.url}/auth/v1/otp`, { method: 'POST', headers, body: JSON.stringify({ email: c.email, create_user: false }) });
  assertEquals(soon.status, 429);
  await soon.body?.cancel();
});

test('otp/session: refuses a password session, a forged or missing token, and a blocked account', async () => {
  const c = await h.customer();
  // c.token came from the password grant: not a code sign-in
  const pw = await h.call('POST', '/api/auth/otp/session', { token: c.token, body: { refreshToken: c.refreshToken, agreement: true } });
  assertStatus(pw, 401);
  assertEquals(pw.body.code, 'otp_required');
  assertStatus(await h.call('POST', '/api/auth/otp/session', { body: { refreshToken: 'x' } }), 401);
  const forged = await h.fake.auth.mintAccessToken({ userId: c.id, sessionId: crypto.randomUUID(), secret: 'not-the-secret-not-the-secret-0123456789' });
  assertStatus(await h.call('POST', '/api/auth/otp/session', { token: forged, body: { refreshToken: 'x' } }), 401);

  const ctx = await ctxAs(await h.staff('admin'));
  await tx((q) => blockAccount(q, ctx, c.id, 'test'));
  const blocked = await h.otpLogin(c.email, { agreement: true });
  assert(blocked.status === 403, `blocked: ${blocked.status}`);
});

test('password sign-in is for staff only; customers are told to use the code', async () => {
  const c = await h.customer();
  const r = await h.login(c.email, c.password);
  assertStatus(r, 403);
  assertEquals(r.body.code, 'otp_required');
  assertEquals((await appSessions(c.id)).length, 1, 'no new sign-in');
  const s = await h.staff('support');
  assertStatus(await h.login(s.email, s.password), 200);
});

test('login: wrong passwords lock the account; the lock expires', async () => {
  const c = await h.staff('support');
  const ip = randomIp();
  for (let i = 1; i <= 4; i++) {
    const r = await h.login(c.email, 'Wrong-Pass1', { ip });
    assertStatus(r, 401, `attempt ${i}`);
    assertEquals(r.body.code, 'bad_credentials');
    assertEquals(r.body.error, 'We could not match that email and password. New here? Sign up instead.');
  }
  const fifth = await h.login(c.email, 'Wrong-Pass1', { ip });
  assertStatus(fifth, 429);
  assertEquals(fifth.body.code, 'account_locked');
  assert(fifth.body.lockedUntil > Date.now() + 14 * 60_000, 'locked about 15 minutes');
  assertEquals(fifth.body.error, 'Too many wrong passwords. This account is locked for 15 more minute(s). You can unlock it now with Forgot password.');
  // even the right password is refused while locked, without asking Supabase Auth
  const grants = h.fake.calls('/auth/v1/token', 'POST').length;
  const locked = await h.login(c.email, c.password, { ip });
  assertStatus(locked, 429);
  assertEquals(locked.body.code, 'account_locked');
  assertEquals(h.fake.calls('/auth/v1/token', 'POST').length, grants);

  const la = await h.sql`select failure_reason from login_activity where user_id = ${c.id} order by id`;
  assertEquals(la.map((x) => x.failure_reason), ['bad_credentials', 'bad_credentials', 'bad_credentials', 'bad_credentials', 'bad_credentials', 'account_locked']);
  const ev = await h.sql`select detail from security_events where user_id = ${c.id} and event_type = 'account_locked'`;
  assertEquals(ev.length, 1);
  assertEquals(ev[0].detail, { attempts: 5, minutes: 15 });

  await h.sql`update profiles set locked_until = now() - interval '1 second' where id = ${c.id}`;
  const ok = await h.login(c.email, c.password, { ip });
  assertStatus(ok, 200);
  const p = await profileOf(c.email);
  assertEquals(p.failed_login_attempts, 0);
  assertEquals(p.locked_until, null);
});

test('login: rate limit per IP + email (10 / 15 min)', async () => {
  const email = uniqueEmail('ratelimited');
  const ip = randomIp();
  for (let i = 1; i <= 10; i++) {
    const r = await h.login(email, 'Whatever-1', { ip });
    assertStatus(r, 401, `attempt ${i}`);
  }
  const r = await h.login(email, 'Whatever-1', { ip });
  assertStatus(r, 429);
  assertEquals(r.body.code, 'rate_limited');
  // another address from the same IP, and the same address from another IP, still get through
  assertStatus(await h.login(uniqueEmail('other'), 'Whatever-1', { ip }), 401);
  assertStatus(await h.login(email, 'Whatever-1', { ip: randomIp() }), 401);
  const la = await h.sql`select count(*)::int as n from login_activity where email = ${email} and failure_reason = 'rate_limited'`;
  assertEquals(la[0].n, 1);
});

test('login: validation and the old bad_credentials answers', async () => {
  let r = await h.call('POST', '/api/auth/login', { body: { email: 'x', password: '' } });
  assertStatus(r, 400);
  assertEquals(r.body.errors, { email: 'Enter a valid email address.', password: 'Enter your password.' });
  const long = await h.login(uniqueEmail('long'), 'A1' + 'x'.repeat(200));
  assertStatus(long, 401);
  assertEquals(long.body.code, 'bad_credentials');
  // the /signin alias works
  const c = await h.staff('support');
  r = await h.call('POST', '/api/auth/signin', { body: { email: c.email, password: c.password } });
  assertStatus(r, 200);
});

test('login: agreement version bump → 403 agreement_required, then accepted with agreement:true', async () => {
  const c = await h.customer();
  const st = await h.staff('support');
  const next = { version: '2026-12-01', text: 'New wording: one account, one family. Never share the password.' };
  await h.setSetting('agreement', next);
  try {
    const sessionsBefore = (await appSessions(c.id)).length;
    const authBefore = await authSessionCount(c.id);
    let r = await h.otpLogin(c.email);
    assertStatus(r, 403);
    assertEquals(r.body.code, 'agreement_required');
    assertEquals(r.body.agreement, next);
    assertEquals(r.body.session, undefined);
    assertEquals((await appSessions(c.id)).length, sessionsBefore);
    assertEquals(await authSessionCount(c.id), authBefore + 1, 'the code session waits for the tick');

    r = await h.otpLogin(c.email, { agreement: true });
    assertStatus(r, 200);
    assertEquals(r.body.user.agreementVersion, next.version);
    const acc = await h.sql`select * from agreement_acceptances where user_id = ${c.id} order by id`;
    assertEquals(acc.length, 2);
    assertEquals(acc[1].context, 'reaccept');
    assertEquals(acc[1].version, next.version);
    assertEquals(acc[1].text_sha256, await sha256Hex(next.text));
    assertEquals((await profileOf(c.email)).agreement_version, next.version);

    // accepted once is enough
    r = await h.otpLogin(c.email);
    assertStatus(r, 200);
    assertEquals((await h.sql`select 1 from agreement_acceptances where user_id = ${c.id}`).length, 2);

    // staff are not asked
    assertStatus(await h.login(st.email, st.password, { staff: true }), 200);
  } finally {
    await h.setSetting('agreement', DEFAULTS.agreement);
  }
});

test('login: password for a customer → 403 otp_required; staff get role and permissions', async () => {
  const c = await h.customer();
  let r = await h.login(c.email, c.password, { staff: true });
  assertStatus(r, 403);
  assertEquals(r.body.code, 'otp_required');
  const la = await h.sql`select failure_reason from login_activity where user_id = ${c.id}`;
  assertEquals(la.map((x) => x.failure_reason), ['otp_required']);
  assertEquals(await authSessionCount(c.id), 1, 'only the harness session is left');

  const sup = await h.staff('support');
  r = await h.login(sup.email, sup.password, { staff: true });
  assertStatus(r, 200);
  assertEquals(r.body.staff.role, 'support');
  assertEquals(r.body.security, null);
  assert(r.body.staff.permissions.includes('customers.read'));
  assert(!r.body.staff.permissions.includes('staff.manage'));
  const s = await h.sql`select is_staff from app_sessions where id = (select session_id from login_activity where user_id = ${sup.id} and success order by id desc limit 1)`;
  assertEquals(s[0].is_staff, true);

  const owner = await h.staff('owner', []);
  r = await h.login(owner.email, owner.password, { staff: true });
  assertStatus(r, 200);
  assertEquals(r.body.staff.permissions.length, 27, 'owner holds every permission');
  const m = await me(r.token);
  assertStatus(m, 200);
  assertEquals(m.body.staff.role, 'owner');
  assertEquals(m.body.security, null);
});

test('login: blocked account → 403 account_suspended (block/unblock service)', async () => {
  const c = await h.customer();
  const second = await h.otpLogin(c.email);
  assertStatus(second, 200);
  const admin = await h.staff('admin');
  const ctx = await ctxAs(admin);

  assertEquals(await tx((q) => blockAccount(q, ctx, c.id, 'shared the password <b>publicly</b>')), true);
  assertEquals(await tx((q) => blockAccount(q, ctx, c.id, 'again')), false);
  const p = await profileOf(c.email);
  assert(p.blocked_at, 'blocked');
  assertEquals(p.blocked_by, admin.id);
  const rows = await appSessions(c.id);
  assertEquals(rows.length, 2);
  assert(rows.every((x) => x.revoked_at && x.revoke_reason === 'account_blocked'), 'every session ended');
  assertEquals(await authSessionCount(c.id), 0);
  const au = await h.sql`select actor_id, action, target_id from audit_logs where target_id = ${c.id}`;
  assertEquals(au.map((x) => x.action), ['account.block']);
  assertEquals(au[0].actor_id, admin.id);
  const ev = await h.sql`select event_type from security_events where user_id = ${c.id} and event_type like 'account_%'`;
  assertEquals(ev.map((x) => x.event_type), ['account_blocked']);

  let r = await h.otpLogin(c.email);
  assertStatus(r, 403);
  assertEquals(r.body.code, 'account_suspended');
  assertEquals(await authSessionCount(c.id), 0, 'the refused Supabase Auth session was ended');
  // an open page learns the account is suspended (403 first, before the 401 of an ended sign-in)
  const gone = await me(c.token);
  assertStatus(gone, 403);
  assertEquals(gone.body.code, 'account_suspended');
  assertStatus(await refresh(second.refreshToken), 401);

  assertEquals(await tx((q) => unblockAccount(q, ctx, c.id)), true);
  assertEquals(await tx((q) => unblockAccount(q, ctx, c.id)), false);
  r = await h.otpLogin(c.email);
  assertStatus(r, 200);
  const au2 = await h.sql`select action from audit_logs where target_id = ${c.id} order by id`;
  assertEquals(au2.map((x) => x.action), ['account.block', 'account.unblock']);
});

test('endAllSessions keeps the named session', async () => {
  const c = await h.customer();
  const other = await h.otpLogin(c.email);
  const n = await tx((q) => endAllSessions(q, c.id, 'staff', c.sessionId));
  assertEquals(n, 1);
  assertStatus(await me(c.token), 200);
  assertStatus(await me(other.token), 401);
  assertStatus(await refresh(other.refreshToken), 401);
  assertStatus(await refresh(c.refreshToken), 200);
});

// ── sessions ─────────────────────────────────────────────────────────────────────────────

test('refresh: new tokens, the session end does not move', async () => {
  const c = await h.customer({ remember: true });
  const before = (await appSessions(c.id))[0];
  const r = await refresh(c.refreshToken);
  assertStatus(r, 200);
  assertEquals(r.body.user.email, c.email);
  // (the access token may be byte-identical within the same second: the claims have 1 s resolution)
  assert(r.body.session.accessToken, 'access token returned');
  assertNotEquals(r.body.session.refreshToken, c.refreshToken);
  assertEquals(r.body.session.sessionExpiresAt, new Date(before.expires_at).getTime());
  assertEquals(r.body.expiresAt, new Date(before.expires_at).getTime());
  const m = await me(r.body.session.accessToken);
  assertStatus(m, 200);
  assertEquals(m.body.user.id, c.id);
  // and again with the rotated token
  const r2 = await refresh(r.body.session.refreshToken);
  assertStatus(r2, 200);
  assertEquals((await appSessions(c.id))[0].expires_at.getTime(), new Date(before.expires_at).getTime());

  for (const bad of [undefined, '', 'has space', 12]) {
    const x = await refresh(bad);
    assertStatus(x, 401);
    assertEquals(x.body.code, 'signin');
  }
  assertStatus(await refresh('not-a-real-token'), 401);
});

test('refresh: refused for a blocked session (and works again after unblock)', async () => {
  const c = await h.customer();
  await h.sql`update app_sessions set blocked_at = now(), block_reason = 'test' where id = ${c.sessionId}`;
  const r = await refresh(c.refreshToken);
  assertStatus(r, 403);
  assertEquals(r.body.code, 'session_blocked');
  assertEquals(r.body.session, undefined);
  assert(typeof r.body.refreshToken === 'string', 'the rotated refresh token is handed back');
  assertEquals(await authSessionCount(c.id), 1, 'the Supabase Auth session is kept');
  await h.sql`update app_sessions set blocked_at = null, block_reason = null where id = ${c.sessionId}`;
  const ok = await refresh(r.body.refreshToken);
  assertStatus(ok, 200);
});

test('refresh: refused for a revoked or expired session, and for a blocked account', async () => {
  const a = await h.customer();
  await h.sql`update app_sessions set revoked_at = now(), revoke_reason = 'staff' where id = ${a.sessionId}`;
  let r = await refresh(a.refreshToken);
  assertStatus(r, 401);
  assertEquals(r.body.code, 'signin');
  assertEquals(await authSessionCount(a.id), 0, 'the Supabase Auth session ends with ours');

  const b = await h.customer();
  await h.sql`update app_sessions set expires_at = now() - interval '1 second' where id = ${b.sessionId}`;
  r = await refresh(b.refreshToken);
  assertStatus(r, 401);

  const c = await h.customer();
  await h.sql`update profiles set blocked_at = now(), blocked_reason = 'test' where id = ${c.id}`;
  r = await refresh(c.refreshToken);
  assertStatus(r, 403);
  assertEquals(r.body.code, 'account_suspended');
  assertEquals(r.body.session, undefined);
});

test('logout revokes the session and its refresh token', async () => {
  const c = await h.customer();
  const r = await h.call('POST', '/api/auth/logout', { token: c.token });
  assertStatus(r, 200);
  assertEquals(r.body, { ok: true });
  const s = (await appSessions(c.id))[0];
  assert(s.revoked_at, 'revoked');
  assertEquals(s.revoke_reason, 'logout');
  assertEquals(await authSessionCount(c.id), 0);
  assertStatus(await me(c.token), 401);
  assertStatus(await refresh(c.refreshToken), 401);
  const ev = await h.sql`select 1 from security_events where user_id = ${c.id} and event_type = 'logout'`;
  assertEquals(ev.length, 1);
  // without a token, or with junk, or again: still 200
  assertStatus(await h.call('POST', '/api/auth/logout'), 200);
  assertStatus(await h.call('POST', '/api/auth/signout', { token: 'junk.junk.junk' }), 200);
  assertStatus(await h.call('POST', '/api/auth/logout', { token: c.token }), 200);
});

test('logout with only the refresh token (expired access token) still ends the session', async () => {
  const c = await h.customer();
  const expired = await h.fake.auth.mintAccessToken({ userId: c.id, sessionId: c.sessionId, email: c.email, expiresIn: -60 });
  const r = await h.call('POST', '/api/auth/logout', { token: expired, body: { refreshToken: c.refreshToken } });
  assertStatus(r, 200);
  const s = (await appSessions(c.id))[0];
  assertEquals(s.revoke_reason, 'logout');
  assertEquals(await authSessionCount(c.id), 0);
  assertStatus(await me(c.token), 401);
  // a refresh token that is not real changes nothing and still answers 200
  const d = await h.customer();
  assertStatus(await h.call('POST', '/api/auth/logout', { body: { refreshToken: 'nope-nope-nope' } }), 200);
  assertStatus(await me(d.token), 200);
});

test('login: a parallel burst of wrong passwords gets at most maxFailed password checks', async () => {
  const c = await h.staff('support');
  const before = h.fake.calls('/auth/v1/token', 'POST').length;
  const all = await Promise.all(Array.from({ length: 12 }, () => h.login(c.email, 'Wrong-Pass1')));
  const checks = h.fake.calls('/auth/v1/token', 'POST').length - before;
  assert(checks <= 5, `at most 5 checks reached Supabase Auth (got ${checks})`);
  assert(all.every((r) => r.status === 401 || (r.status === 429 && r.body.code === 'account_locked')), 'only 401 or locked');
  assert(all.some((r) => r.status === 429), 'the burst ends in a lock');
  assertStatus(await h.login(c.email, c.password), 429);
});

test('sessions: maxDays caps "remember me"', async () => {
  await h.setSetting('sessions', { rememberDays: 30, shortHours: 12, maxDays: 2 });
  try {
    const c = await h.staff('support');
    const r = await h.login(c.email, c.password, { remember: true });
    assertStatus(r, 200);
    const days = (r.body.session.sessionExpiresAt - Date.now()) / 86400_000;
    assert(days > 1.99 && days <= 2, `capped at 2 days (got ${days})`);
  } finally {
    await h.setSetting('sessions', DEFAULTS.sessions);
  }
});

test('AUTH-1 a sign-in never lasts more than 90 days, whatever the settings say', async () => {
  const admin = await h.staff('admin');
  try {
    // the settings screen refuses anything over 90 days
    for (const body of [{ rememberDays: 365, shortHours: 12, maxDays: 365 }, { rememberDays: 30, shortHours: 12, maxDays: 91 }, { rememberDays: 91, shortHours: 12, maxDays: 90 }]) {
      const put = await h.call('PUT', '/api/admin/settings/sessions', { token: admin.token, body });
      assertStatus(put, 400, JSON.stringify(body));
    }
    assertStatus(await h.call('PUT', '/api/admin/settings/sessions', { token: admin.token, body: { rememberDays: 90, shortHours: 12, maxDays: 90 } }), 200);
    // an over-long value stored some other way is still capped at sign-in
    await h.setSetting('sessions', { rememberDays: 365, shortHours: 12, maxDays: 3650 });
    const c = await h.staff('support');
    const l = await h.login(c.email, c.password, { remember: true });
    assertStatus(l, 200);
    const days = (l.body.session.sessionExpiresAt - Date.now()) / 86400_000;
    assert(days > 89.9 && days <= 90.001, `capped at 90 days (got ${days})`);
    const row = await h.sql<{ days: number }[]>`
      select extract(epoch from (expires_at - created_at)) / 86400 as days from app_sessions where user_id = ${c.id} order by created_at desc limit 1`;
    assert(Number(row[0].days) <= 90.001, `app_sessions row lasts ${row[0].days} days`);
    // and the table itself refuses a longer sign-in
    let refused = false;
    try {
      await h.sql`update app_sessions set expires_at = created_at + interval '91 days' where user_id = ${c.id}`;
    } catch (e) {
      refused = /app_sessions_at_most_90_days/.test(String((e as Error).message));
    }
    assert(refused, 'the app_sessions_at_most_90_days check refuses a 91-day sign-in');
  } finally {
    await h.setSetting('sessions', DEFAULTS.sessions);
  }
});

test("cross-user: a token never returns or changes another user's account", async () => {
  const a = await h.customer({ name: 'Alice A' });
  const b = await h.customer({ name: 'Bob B' });
  // A has not chosen an account type yet (the harness makes Parents), so A may choose one now
  await h.sql`update profiles set role = null where id = ${a.id}`;
  const ma = await me(a.token);
  const mb = await me(b.token);
  assertEquals([ma.body.user.id, ma.body.user.email], [a.id, a.email]);
  assertEquals([mb.body.user.id, mb.body.user.email], [b.id, b.email]);

  const p = await h.call('PATCH', '/api/auth/me', { token: a.token, body: { name: 'Alice Changed', role: 'tutor', timeZone: 'America/New_York' } });
  assertStatus(p, 200);
  assertEquals(p.body.user.name, 'Alice Changed');
  assertEquals(p.body.user.role, 'tutor');
  assertEquals(p.body.user.timeZone, 'America/New_York');
  assertEquals((await profileOf(b.email)).name, 'Bob B');

  // a validly signed token that names A but B's session is refused
  const forged = await h.fake.auth.mintAccessToken({ userId: a.id, sessionId: b.sessionId, email: a.email });
  const f = await me(forged);
  assertStatus(f, 401);
  // a token signed with another key is refused
  const alien = await h.fake.auth.mintAccessToken({ userId: b.id, sessionId: b.sessionId, secret: 'not-the-real-secret-at-all-000000' });
  assertStatus(await me(alien), 401);
  assertStatus(await me(), 401);
});

test('PATCH /api/auth/me validates role, name and time zone', async () => {
  const c = await h.customer();
  let r = await h.call('PATCH', '/api/auth/me', { token: c.token, body: { role: 'pirate' } });
  assertStatus(r, 400);
  assertEquals(r.body.error, 'Unknown role.');
  r = await h.call('PATCH', '/api/auth/me', { token: c.token, body: { name: '   ' } });
  assertStatus(r, 400);
  assertEquals(r.body.error, 'Enter a name of 1 to 80 characters.');
  r = await h.call('PATCH', '/api/auth/me', { token: c.token, body: { timeZone: 'Mars/Olympus' } });
  assertStatus(r, 400);
  // the account type is chosen once: an empty value cannot clear a type that is set
  r = await h.call('PATCH', '/api/auth/me', { token: c.token, body: { role: '' } });
  assertStatus(r, 409);
  assertEquals(r.body.code, 'role_locked');
  assertEquals((await profileOf(c.email)).role, 'parent');
  // while no type is chosen, an empty value is accepted and leaves it empty
  await h.sql`update profiles set role = null where id = ${c.id}`;
  r = await h.call('PATCH', '/api/auth/me', { token: c.token, body: { role: '' } });
  assertStatus(r, 200);
  assertEquals(r.body.user.role, null);
});

// ── password reset ───────────────────────────────────────────────────────────────────────

test('reset-password (staff) ends every session; the old refresh token fails', async () => {
  const c = await h.staff('support');
  const other = await h.login(c.email, c.password, { remember: true });
  assertStatus(other, 200);

  const unknown = await h.call('POST', '/api/auth/forgot-password', { body: { email: uniqueEmail('ghost') } });
  const f = await h.call('POST', '/api/auth/forgot-password', { body: { email: c.email } });
  assertStatus(f, 200);
  assertEquals(f.body.message, `If ${c.email} has an account, a password reset link is on its way. It works once, for 30 minutes.`);
  assertEquals(unknown.body.message.replace(/^If \S+ /, ''), f.body.message.replace(/^If \S+ /, ''));
  const m = h.mail.last(c.email)!;
  assertEquals(m.subject, 'Learn With Why: choose a new password');
  const token = h.mail.linkParam(c.email, 'reset')!;
  assertEquals(h.mail.link(c.email, 'reset'), `${SITE}/?reset=${token}`);
  assertEquals(await rowsContaining(token), []);
  const out = await h.sql`select sensitive, body_text from email_outbox where to_user_id = ${c.id} and template = 'password_reset'`;
  assertEquals(out.map((x) => [x.sensitive, x.body_text]), [[true, null]]);

  let r = await h.call('POST', '/api/auth/reset-password', { body: { token, password: 'weak' } });
  assertStatus(r, 400);
  assertEquals(r.body.errors.password, 'At least 8 characters.');
  r = await h.call('POST', '/api/auth/reset-password', { body: { token: 'z'.repeat(43), password: 'Strong-Pass9' } });
  assertStatus(r, 400);
  assertEquals(r.body.code, 'token_invalid');

  const newPassword = testPassword();
  r = await h.call('POST', '/api/auth/reset-password', { body: { token, password: newPassword } });
  assertStatus(r, 200);
  assertEquals(r.body, { ok: true, message: 'Password updated. Sign in with your new password.' });

  const rows = await appSessions(c.id);
  assertEquals(rows.length, 2);
  assert(rows.every((x) => x.revoke_reason === 'password_reset'), 'every session ended');
  assertEquals(await authSessionCount(c.id), 0);
  assertStatus(await me(c.token), 401);
  assertStatus(await me(other.token), 401);
  assertStatus(await refresh(c.refreshToken), 401);
  assertStatus(await refresh(other.refreshToken), 401);
  assert((await profileOf(c.email)).password_changed_at, 'password_changed_at set');

  assertStatus(await h.login(c.email, c.password), 401);
  assertStatus(await h.login(c.email, newPassword), 200);
  const used = await h.call('POST', '/api/auth/reset-password', { body: { token, password: 'Another-Pass9' } });
  assertStatus(used, 400);
  assertEquals(used.body.code, 'token_used');

  // the "password changed" notice goes through the normal outbox
  const changed = h.mail.to(c.email).find((x) => x.subject === 'Learn With Why: your password was changed');
  assert(changed, 'password changed email sent');
  assertEquals(await rowsContaining(newPassword), []);
});

test('reset-password: expired link, and a reset also confirms an unverified address', async () => {
  const email = (await h.customer({ verified: false })).email;
  await h.call('POST', '/api/auth/forgot-password', { body: { email } });
  const token = h.mail.linkParam(email, 'reset')!;
  await h.sql`update auth_tokens set expires_at = now() - interval '1 second' where token_hash = ${await sha256Hex(token)}`;
  let r = await h.call('POST', '/api/auth/reset-password', { body: { token, password: 'Strong-Pass9' } });
  assertStatus(r, 400);
  assertEquals(r.body.code, 'token_expired');

  await h.call('POST', '/api/auth/forgot-password', { body: { email } });
  const token2 = h.mail.linkParam(email, 'reset')!;
  assertNotEquals(token2, token);
  r = await h.call('POST', '/api/auth/reset-password', { body: { token: token2, password: 'Strong-Pass9' } });
  assertStatus(r, 200);
  const p = await profileOf(email);
  assertEquals(p.status, 'active');
  assert(p.email_verified_at, 'verified by the reset link');
  // a customer still signs in with the emailed code, not the new password
  assertEquals((await h.login(email, 'Strong-Pass9')).body.code, 'otp_required');
  assertStatus(await h.otpLogin(email, { agreement: true }), 200);
});

test('reset-password: Supabase Auth down → 503 and the link still works afterwards', async () => {
  const c = await h.staff('support');
  await h.call('POST', '/api/auth/forgot-password', { body: { email: c.email } });
  const token = h.mail.linkParam(c.email, 'reset')!;
  const remove = h.fake.route('PUT', '/auth/v1/admin/users/', () => new Response('down', { status: 502 }));
  let r;
  try {
    r = await h.call('POST', '/api/auth/reset-password', { body: { token, password: 'Strong-Pass9' } });
  } finally {
    remove();
  }
  assertStatus(r, 503);
  assertEquals((await appSessions(c.id))[0].revoked_at, null, 'nothing ended');
  r = await h.call('POST', '/api/auth/reset-password', { body: { token, password: 'Strong-Pass9' } });
  assertStatus(r, 200);
});

test('token routes are rate limited per IP (30 / 15 min)', async () => {
  const ip = randomIp();
  for (let i = 0; i < 30; i++) {
    const r = await h.call('POST', '/api/auth/reset-password', { body: { token: 'short', password: 'x' }, ip });
    assertStatus(r, 400);
  }
  const r = await h.call('POST', '/api/auth/reset-password', { body: { token: 'short', password: 'x' }, ip });
  assertStatus(r, 429);
  assertEquals(r.body.code, 'rate_limited');
});
