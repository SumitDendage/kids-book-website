// Builder F: staff security screens (routes/admin_security.ts): the account-security zip's
// E3–E8, incidents, warnings, appeals, sharing rules and the old log pages.
import { assert, assertEquals, assertMatch, assertStatus, startHarness, test, type TestUser } from './harness.ts';
import { decodeClaims } from '../../functions/api/lib/gotrue.ts';

const h = await startHarness();
await h.uploadPdfFor('az-C');   // a paid sheet with its PDF

const owner = await h.staff('owner');
const admin = await h.staff('admin');
const support = await h.staff('support');
const developer = await h.staff('developer');
const bare = await h.staff('content', []);   // staff, but no permissions at all

const ANDROID_FIREFOX = 'Mozilla/5.0 (Android 14; Mobile; rv:128.0) Gecko/128.0 Firefox/128.0';

const audits = (action: string, targetId?: string | number) =>
  h.sql<{ id: number; actor_id: string | null; detail: Record<string, unknown> | null }[]>`
    select id, actor_id, detail from audit_logs
    where action = ${action} and (${targetId == null ? null : String(targetId)}::text is null or target_id = ${targetId == null ? null : String(targetId)})
    order by id`;

/** A second sign-in of the same customer on another device (fake Auth session + app_sessions row). */
async function anotherSignIn(u: TestUser, ua = ANDROID_FIREFOX) {
  const t = await h.fake.auth.issueSession(u.id, { userAgent: ua });
  const sid = String(decodeClaims(t.access_token).session_id);
  await h.sql`
    insert into app_sessions (id, user_id, remember, expires_at, ip, ip_network, user_agent, device_label, device_id_hash, is_staff)
    values (${sid}, ${u.id}, false, now() + interval '12 hours', '10.77.0.5', '10.77.0.0/24', ${ua}, 'Firefox on Android',
            ${await h.deviceHash('second-device-0000')}, false)`;
  return { token: t.access_token as string, refreshToken: t.refresh_token as string, sessionId: sid };
}

async function incident(userId: string, rule = 'concurrent_devices', summary = 'Used on 4 devices from 3 networks within 15 minutes.') {
  const r = await h.sql<{ id: number }[]>`
    insert into security_incidents (user_id, rule_id, dedupe_key, evidence)
    values (${userId}, ${rule}, ${`${rule}:${userId}:${crypto.randomUUID()}`}, ${h.sql.json({ summary, devices: 4 })})
    returning id`;
  return r[0].id;
}

async function appeal(userId: string, kind: 'warning' | 'suspension' | 'block', warningId: number | null = null) {
  const r = await h.sql<{ id: number }[]>`
    insert into account_appeals (user_id, warning_id, kind, message)
    values (${userId}, ${warningId}, ${kind}, ${'I only use my own phone and laptop, please check again.'})
    returning id`;
  return r[0].id;
}

let reportNo = 0;
/** A confirmed staff report. Each call is a different violation (its own reason): the same reason
 *  again within a few minutes is the same report and gives no second warning. */
async function report(userId: string, reason = `A teacher reported a shared password (report ${++reportNo}).`) {
  const r = await h.call('POST', `/api/admin/security/customers/${userId}/report`, { token: admin.token, body: { reason, confirm: true } });
  assertStatus(r, 200);
  return r.body;
}

// ── permissions ─────────────────────────────────────────────────────────────────────────

test('admin security: who may call what', async () => {
  const c = await h.customer();
  let r = await h.call('GET', '/api/admin/security/customers');
  assertStatus(r, 401);
  r = await h.call('GET', '/api/admin/security/customers', { token: c.token });
  assertStatus(r, 403);
  assertEquals(r.body.code, 'not_staff');
  // staff without any permission
  for (const [m, p] of [
    ['GET', '/api/admin/security/customers'],
    ['GET', `/api/admin/security/customers/${c.id}/sessions`],
    ['POST', `/api/admin/security/sessions/${c.sessionId}/block`],
    ['POST', `/api/admin/security/customers/${c.id}/block`],
    ['GET', '/api/admin/security/incidents'],
    ['GET', '/api/admin/security/rules'],
    ['GET', '/api/admin/security-events'],
  ] as const) {
    r = await h.call(m, p, { token: bare.token });
    assertStatus(r, 403, `${m} ${p}`);
    assertEquals(r.body.code, 'forbidden');
  }
  // support reads (security.read) but cannot block or suspend
  assertStatus(await h.call('GET', '/api/admin/security/customers', { token: support.token }), 200);
  assertStatus(await h.call('GET', `/api/admin/security/customers/${c.id}/sessions`, { token: support.token }), 200);
  for (const [m, p, body] of [
    ['POST', `/api/admin/security/sessions/${c.sessionId}/block`, undefined],
    ['POST', `/api/admin/security/sessions/${c.sessionId}/unblock`, undefined],
    ['POST', `/api/admin/security/customers/${c.id}/block`, undefined],
    ['POST', `/api/admin/security/customers/${c.id}/unblock`, undefined],
    ['POST', `/api/admin/security/customers/${c.id}/report`, { reason: 'seen sharing', confirm: true }],
    ['POST', '/api/admin/security/incidents/1/confirm', {}],
    ['POST', '/api/admin/security/warnings/1/revoke', { reason: 'mistake' }],
    ['POST', '/api/admin/security/appeals/1/decide', { accept: true }],
    ['PUT', '/api/admin/security/rules/concurrent_devices', { enabled: false }],
  ] as const) {
    r = await h.call(m, p, { token: support.token, body });
    assertStatus(r, 403, `${m} ${p}`);
  }
  const s = await h.sql<{ blocked_at: Date | null }[]>`select blocked_at from app_sessions where id = ${c.sessionId}`;
  assertEquals(s[0].blocked_at, null);
  // developer reads the logs (logs.read) but not the security screens
  for (const p of ['/api/admin/security-events', '/api/admin/login-activity', '/api/admin/access-log']) {
    assertStatus(await h.call('GET', p, { token: developer.token }), 200, p);
  }
  assertStatus(await h.call('GET', '/api/admin/security/customers', { token: developer.token }), 403);
});

test('admin security: permission matrix — each call opens with its own permission and no other', async () => {
  const c = await h.customer();
  const ghost = crypto.randomUUID();
  const all = (await h.sql<{ id: string }[]>`select id from staff_permissions order by id`).map((r) => r.id);
  // [method, path, body, the permissions that open it (any one), the answer once one is held]
  const probes: [string, string, unknown, string[], number][] = [
    ['GET', '/api/admin/security/customers', undefined, ['security.read'], 200],
    ['GET', `/api/admin/security/customers/${ghost}/sessions`, undefined, ['security.read'], 404],
    ['GET', '/api/admin/security/incidents', undefined, ['security.read'], 200],
    ['GET', '/api/admin/security/warnings', undefined, ['security.read'], 200],
    ['GET', '/api/admin/security/appeals', undefined, ['security.read'], 200],
    ['GET', '/api/admin/security/rules', undefined, ['security.read'], 200],
    ['GET', '/api/admin/security/rules/concurrent_devices', undefined, ['security.read'], 200],
    ['POST', `/api/admin/security/sessions/${ghost}/block`, undefined, ['security.write'], 404],
    ['POST', `/api/admin/security/sessions/${ghost}/unblock`, undefined, ['security.write'], 404],
    ['POST', `/api/admin/security/customers/${ghost}/block`, undefined, ['security.write'], 404],
    ['POST', `/api/admin/security/customers/${ghost}/unblock`, undefined, ['security.write'], 404],
    ['POST', `/api/admin/security/customers/${ghost}/report`, { reason: 'Seen sharing' }, ['security.write'], 404],
    ['POST', '/api/admin/security/incidents/999999999/confirm', {}, ['security.write'], 404],
    ['POST', '/api/admin/security/incidents/999999999/dismiss', {}, ['security.write'], 404],
    ['POST', '/api/admin/security/warnings/999999999/revoke', { reason: 'Permission matrix' }, ['security.write'], 404],
    ['POST', '/api/admin/security/appeals/999999999/decide', { accept: true }, ['security.write'], 404],
    ['PUT', '/api/admin/security/rules/nope_rule', { enabled: true }, ['security.write'], 404],
    ['PUT', '/api/admin/security/rules', { rules: [{ id: 'nope_rule', enabled: true }] }, ['security.write'], 404],
    ['GET', '/api/admin/security-events', undefined, ['logs.read', 'security.read'], 200],
    ['GET', '/api/admin/login-activity', undefined, ['logs.read', 'security.read'], 200],
    ['GET', '/api/admin/access-log', undefined, ['logs.read', 'security.read'], 200],
  ];
  const only = new Map<string, TestUser>();
  const allBut = new Map<string, TestUser>();
  for (const perms of probes.map((x) => x[3])) {
    for (const p of perms) if (!only.has(p)) only.set(p, await h.staff('support', [p]));
    const key = perms.join('+');
    if (!allBut.has(key)) allBut.set(key, await h.staff('support', all.filter((k) => !perms.includes(k))));
  }
  for (const [m, path, body, perms, okStatus] of probes) {
    const label = `${m} ${path}`;
    let r = await h.call(m, path, { body });
    assertStatus(r, 401, label);
    assertEquals(r.body.code, 'staff_signin', label);
    r = await h.call(m, path, { token: c.token, body });
    assertStatus(r, 403, label);
    assertEquals(r.body.code, 'not_staff', label);
    r = await h.call(m, path, { token: allBut.get(perms.join('+'))!.token, body });
    assertStatus(r, 403, `${label} without ${perms.join(' / ')}`);
    assertEquals([r.body.code, r.body.permission], ['forbidden', perms[0]], label);
    for (const p of perms) {
      r = await h.call(m, path, { token: only.get(p)!.token, body });
      assertStatus(r, okStatus, `${label} with only ${p}`);
    }
    r = await h.call(m, path, { token: owner.token, body });
    assertStatus(r, okStatus, `${label} as owner`);
  }
  // the refused calls changed nothing
  const s = await h.sql<{ blocked_at: Date | null }[]>`select blocked_at from app_sessions where id = ${c.sessionId}`;
  assertEquals(s[0].blocked_at, null);
});

// ── E3 / E4 ─────────────────────────────────────────────────────────────────────────────

test('E3: customer list shape (times in ms), staff left out', async () => {
  const c = await h.customer({ name: 'Ishaan E3' });
  const two = await anotherSignIn(c);
  await h.sql`update app_sessions set blocked_at = now() where id = ${two.sessionId}`;
  const r = await h.call('GET', `/api/admin/security/customers?q=${encodeURIComponent(c.email)}`, { token: support.token });
  assertStatus(r, 200);
  assertEquals(r.body.customers.length, 1);
  const x = r.body.customers[0];
  assertEquals(x.id, c.id);
  assertEquals(x.name, 'Ishaan E3');
  assertEquals(x.email, c.email);
  assertEquals(x.accessStatus, 'active');
  assertEquals(x.warningCount, 0);
  assertEquals(x.maxWarnings, 3);
  assertEquals(typeof x.lastLoginAt, 'number');
  assertEquals(x.activeSessionCount, 1);
  assertEquals(x.blockedSessionCount, 1);
  const all = await h.call('GET', '/api/admin/security/customers?limit=1000', { token: support.token });
  const ids = all.body.customers.map((y: { id: string }) => y.id);
  assert(!ids.includes(owner.id) && !ids.includes(support.id), 'staff are not listed');
  assertStatus(await h.call('GET', '/api/admin/security/customers?access=odd', { token: support.token }), 400);
});

test('E4: sessions of one customer — opaque ids, device/browser parsed, nothing invented', async () => {
  const c = await h.customer();
  const two = await anotherSignIn(c);
  await h.sql`insert into app_sessions (id, user_id, expires_at, revoked_at, revoke_reason) values (${crypto.randomUUID()}, ${c.id}, now() + interval '1 hour', now(), 'logout')`;
  await h.sql`insert into app_sessions (id, user_id, expires_at) values (${crypto.randomUUID()}, ${c.id}, now() + interval '1 hour')`; // nothing known
  const r = await h.call('GET', `/api/admin/security/customers/${c.id}/sessions`, { token: support.token });
  assertStatus(r, 200);
  assertEquals(r.body.sessions.length, 3, 'ended sign-ins are not listed');
  const first = r.body.sessions.find((s: { id: string }) => s.id === c.sessionId);
  assertEquals(first.device, 'Windows');
  assertEquals(first.browser, 'Chrome');
  assertEquals(typeof first.ip, 'string');
  assertEquals(typeof first.lastActiveAt, 'number');
  assertEquals(first.status, 'active');
  const second = r.body.sessions.find((s: { id: string }) => s.id === two.sessionId);
  assertEquals(second.device, 'Android');
  assertEquals(second.browser, 'Firefox');
  assertEquals(second.ip, '10.77.0.5');
  const unknown = r.body.sessions.find((s: { id: string }) => s.id !== c.sessionId && s.id !== two.sessionId);
  assertEquals([unknown.device, unknown.browser, unknown.ip], [null, null, null]);
  // never a token
  assert(!r.text.includes(c.token) && !r.text.includes(c.refreshToken), 'no tokens');
  const withEnded = await h.call('GET', `/api/admin/security/customers/${c.id}/sessions?all=1`, { token: support.token });
  assertEquals(withEnded.body.sessions.length, 4);

  assertStatus(await h.call('GET', `/api/admin/security/customers/${crypto.randomUUID()}/sessions`, { token: support.token }), 404);
  assertStatus(await h.call('GET', '/api/admin/security/customers/nope/sessions', { token: support.token }), 404);
  const st = await h.call('GET', `/api/admin/security/customers/${owner.id}/sessions`, { token: admin.token });
  assertStatus(st, 409);
  assertEquals(st.body.code, 'staff_account');
});

test('E3 filters: access=suspended|active|warned, search by exact id', async () => {
  const s = await h.customer({ name: 'Filtertest Suspended' });
  const w = await h.customer({ name: 'Filtertest Warned' });
  const p = await h.customer({ name: 'Filtertest Plain' });
  assertStatus(await h.call('POST', `/api/admin/security/customers/${s.id}/block`, { token: admin.token }), 200);
  await report(w.id);
  const ids = async (qs: string) => {
    const r = await h.call('GET', `/api/admin/security/customers?q=Filtertest&limit=1000&${qs}`, { token: support.token });
    assertStatus(r, 200, qs);
    return (r.body.customers as { id: string }[]).map((x) => x.id).sort();
  };
  const sorted = (...xs: string[]) => [...xs].sort();
  assertEquals(await ids(''), sorted(s.id, w.id, p.id));
  assertEquals(await ids('access=suspended'), [s.id]);
  assertEquals(await ids('access=active'), sorted(w.id, p.id));
  assertEquals(await ids('access=warned'), [w.id]);
  const byId = await h.call('GET', `/api/admin/security/customers?q=${p.id.toUpperCase()}`, { token: support.token });
  assertEquals(byId.body.customers.map((x: { id: string }) => x.id), [p.id]);
  // paging
  const page = await h.call('GET', '/api/admin/security/customers?q=Filtertest&limit=2&offset=1', { token: support.token });
  assertEquals([page.body.customers.length, page.body.limit, page.body.offset], [2, 2, 1]);
});

// The zip's own adapter (security-zip frontend/src/services/security.js, normalizeCustomer and
// normalizeSession), copied as it is: the staff page keeps only what these return, so every
// E3–E8 value must come through unchanged (only a warning count above the maximum is clamped).
const zNum = (v: unknown) => (Number.isFinite(+(v as number)) ? +(v as number) : 0);
const zText = (v: unknown) => (v == null || v === '' ? null : String(v));
const zTime = (v: unknown) => (v == null || v === '' || !Number.isFinite(+(v as number)) ? null : +(v as number));
const zAccess = (v: unknown) => (v === 'suspended' ? 'suspended' : v === 'active' ? 'active' : 'unknown');
// deno-lint-ignore no-explicit-any
function normalizeCustomer(raw: any) {
  const max = zNum(raw.maxWarnings) || 3;
  return {
    id: String(raw.id), name: zText(raw.name) || '', email: zText(raw.email) || '', accessStatus: zAccess(raw.accessStatus),
    warningCount: Math.max(0, Math.min(max, Math.floor(zNum(raw.warningCount)))), maxWarnings: max, lastLoginAt: zTime(raw.lastLoginAt),
    activeSessionCount: raw.activeSessionCount == null ? null : zNum(raw.activeSessionCount), sample: !!raw.sample,
  };
}
// deno-lint-ignore no-explicit-any
function normalizeSession(raw: any) {
  return {
    id: String(raw.id), device: zText(raw.device), browser: zText(raw.browser), ip: zText(raw.ip), lastActiveAt: zTime(raw.lastActiveAt),
    status: raw.status === 'blocked' ? 'blocked' : 'active', sample: !!raw.sample,
  };
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// deno-lint-ignore no-explicit-any
function zipCustomer(raw: any, label: string) {
  assert(UUID.test(raw.id) && typeof raw.name === 'string' && typeof raw.email === 'string' && raw.email.includes('@'), `${label}: id/name/email`);
  assert(raw.accessStatus === 'active' || raw.accessStatus === 'suspended', `${label}: accessStatus ${raw.accessStatus}`);
  assert(Number.isInteger(raw.warningCount) && raw.warningCount >= 0, `${label}: warningCount`);
  assert(Number.isInteger(raw.maxWarnings) && raw.maxWarnings >= 1, `${label}: maxWarnings`);
  assert(raw.lastLoginAt === null || (Number.isInteger(raw.lastLoginAt) && raw.lastLoginAt > 1e12), `${label}: lastLoginAt in ms`);
  assert(Number.isInteger(raw.activeSessionCount) && raw.activeSessionCount >= 0, `${label}: activeSessionCount`);
  assertEquals(normalizeCustomer(raw), {
    id: raw.id, name: raw.name, email: raw.email, accessStatus: raw.accessStatus, warningCount: Math.min(raw.warningCount, raw.maxWarnings),
    maxWarnings: raw.maxWarnings, lastLoginAt: raw.lastLoginAt, activeSessionCount: raw.activeSessionCount, sample: false,
  }, `${label}: the zip adapter would change a value`);
}
// deno-lint-ignore no-explicit-any
function zipSession(raw: any, label: string) {
  assert(UUID.test(raw.id), `${label}: opaque session id`);
  assert(raw.status === 'active' || raw.status === 'blocked', `${label}: status ${raw.status}`);
  assert(Number.isInteger(raw.lastActiveAt) && raw.lastActiveAt > 1e12, `${label}: lastActiveAt in ms`);
  for (const k of ['device', 'browser', 'ip']) assert(raw[k] === null || (typeof raw[k] === 'string' && raw[k] !== ''), `${label}: ${k}`);
  assertEquals(normalizeSession(raw), {
    id: raw.id, device: raw.device, browser: raw.browser, ip: raw.ip, lastActiveAt: raw.lastActiveAt, status: raw.status, sample: false,
  }, `${label}: the zip adapter would change a value`);
}

test('E3–E8 answers come through the zip adapter unchanged (ms times, opaque ids, no tokens)', async () => {
  const c = await h.customer({ name: 'Zip Shape' });
  const two = await anotherSignIn(c);
  const quiet = await h.customer({ name: 'Never Signed In' });
  await h.sql`update profiles set last_login_at = null where id = ${quiet.id}`;
  const tokens = [c.token, c.refreshToken, two.token, two.refreshToken];
  const noTokens = (r: { text: string }, label: string) => assert(!tokens.some((t) => r.text.includes(t)), `${label}: no token in the answer`);

  // E3
  for (const u of [c, quiet]) {
    const r = await h.call('GET', `/api/admin/security/customers?q=${encodeURIComponent(u.email)}`, { token: support.token });
    assertStatus(r, 200);
    assertEquals(r.body.customers.length, 1);
    zipCustomer(r.body.customers[0], `E3 ${u.email}`);
  }
  const listed = await h.call('GET', '/api/admin/security/customers?q=' + encodeURIComponent(quiet.email), { token: support.token });
  assertEquals(listed.body.customers[0].lastLoginAt, null);
  const every = await h.call('GET', '/api/admin/security/customers?limit=1000', { token: support.token });
  assert(every.body.customers.length >= 2);
  for (const x of every.body.customers) zipCustomer(x, `E3 list ${x.email}`);

  // E4: the ids are the sign-ins' own session ids (the access token's session_id claim)
  const r4 = await h.call('GET', `/api/admin/security/customers/${c.id}/sessions`, { token: support.token });
  assertStatus(r4, 200);
  assertEquals(r4.body.sessions.map((s: { id: string }) => s.id).sort(), [c.sessionId, two.sessionId].sort());
  assertEquals(String(decodeClaims(c.token).session_id), c.sessionId);
  for (const s of r4.body.sessions) zipSession(s, 'E4');
  noTokens(r4, 'E4');

  // E5 / E6 answer { session }
  const r5 = await h.call('POST', `/api/admin/security/sessions/${two.sessionId}/block`, { token: admin.token });
  assertStatus(r5, 200);
  zipSession(r5.body.session, 'E5');
  assertEquals([r5.body.session.id, r5.body.session.status], [two.sessionId, 'blocked']);
  const r4b = await h.call('GET', `/api/admin/security/customers/${c.id}/sessions`, { token: support.token });
  for (const s of r4b.body.sessions) zipSession(s, 'E4 with a blocked sign-in');
  const r6 = await h.call('POST', `/api/admin/security/sessions/${two.sessionId}/unblock`, { token: admin.token });
  assertStatus(r6, 200);
  zipSession(r6.body.session, 'E6');
  assertEquals(r6.body.session.status, 'active');

  // E7 / E8 answer { customer }
  const r7 = await h.call('POST', `/api/admin/security/customers/${c.id}/block`, { token: admin.token });
  assertStatus(r7, 200);
  zipCustomer(r7.body.customer, 'E7');
  assertEquals([r7.body.customer.accessStatus, r7.body.customer.activeSessionCount], ['suspended', 2]);
  const r8 = await h.call('POST', `/api/admin/security/customers/${c.id}/unblock`, { token: admin.token });
  assertStatus(r8, 200);
  zipCustomer(r8.body.customer, 'E8');
  assertEquals([r8.body.customer.accessStatus, r8.body.customer.activeSessionCount], ['active', 2]);
  for (const [r, l] of [[r5, 'E5'], [r6, 'E6'], [r7, 'E7'], [r8, 'E8']] as const) noTokens(r, l);
});

// ── E5 / E6 ─────────────────────────────────────────────────────────────────────────────

test('E5/E6: blocking one sign-in stops only that sign-in; unblock restores it', async () => {
  const c = await h.customer();
  const two = await anotherSignIn(c);
  let r = await h.call('POST', `/api/admin/security/sessions/${c.sessionId}/block`, { token: admin.token, body: { reason: 'Seen in another city' } });
  assertStatus(r, 200);
  assertEquals(r.body.changed, true);
  assertEquals(r.body.session.id, c.sessionId);
  assertEquals(r.body.session.status, 'blocked');
  assertEquals(r.body.session.device, 'Windows');
  assertEquals(r.body.customer.activeSessionCount, 1);
  assertEquals(r.body.customer.accessStatus, 'active');

  const blocked = await h.call('GET', '/api/me/security', { token: c.token });
  assertStatus(blocked, 403);
  assertEquals(blocked.body.code, 'session_blocked');
  assertStatus(await h.call('GET', '/api/me/security', { token: two.token }), 200);
  // paid sheets: refused on the blocked sign-in only; the account's access is not touched
  await h.grant(c.id, { productId: 'az-C', days: 30 });
  assertEquals((await h.call('POST', '/api/access/az-C', { token: c.token })).body.code, 'session_blocked');
  assertStatus(await h.call('POST', '/api/access/az-C', { token: two.token }), 200);
  assertEquals((await h.sql<{ s: Date | null }[]>`select subscription_suspended_at as s from profiles where id = ${c.id}`)[0].s, null);
  // refresh of the blocked sign-in is refused too (it is kept for the unblock)
  const ref = await h.call('POST', '/api/auth/refresh-token', { body: { refreshToken: c.refreshToken } });
  assertStatus(ref, 403);
  assertEquals(ref.body.code, 'session_blocked');
  // only that row changed; nothing revoked
  const rows = await h.sql<{ id: string; blocked_at: Date | null; blocked_by: string | null; block_reason: string | null; revoked_at: Date | null }[]>`
    select id, blocked_at, blocked_by, block_reason, revoked_at from app_sessions where user_id = ${c.id} order by created_at`;
  assertEquals(rows.filter((x) => x.blocked_at).map((x) => x.id), [c.sessionId]);
  assert(rows.every((x) => !x.revoked_at));
  const b = rows.find((x) => x.id === c.sessionId)!;
  assertEquals(b.blocked_by, admin.id);
  assertEquals(b.block_reason, 'Seen in another city');
  assertEquals((await audits('session.block', c.sessionId)).length, 1);
  const ev = await h.sql`select 1 from security_events where user_id = ${c.id} and event_type = 'session.blocked'`;
  assertEquals(ev.length, 1);

  // twice is harmless
  r = await h.call('POST', `/api/admin/security/sessions/${c.sessionId}/block`, { token: admin.token });
  assertStatus(r, 200);
  assertEquals(r.body.changed, false);
  assertEquals((await audits('session.block', c.sessionId)).length, 1);

  r = await h.call('POST', `/api/admin/security/sessions/${c.sessionId}/unblock`, { token: admin.token });
  assertStatus(r, 200);
  assertEquals(r.body.changed, true);
  assertEquals(r.body.session.status, 'active');
  assertEquals(r.body.customer.activeSessionCount, 2);
  assertStatus(await h.call('GET', '/api/me/security', { token: c.token }), 200);
  assertEquals((await audits('session.unblock', c.sessionId)).length, 1);
});

test('E5: unknown, ended and staff sign-ins', async () => {
  const c = await h.customer();
  assertStatus(await h.call('POST', `/api/admin/security/sessions/${crypto.randomUUID()}/block`, { token: admin.token }), 404);
  assertStatus(await h.call('POST', '/api/admin/security/sessions/12/block', { token: admin.token }), 404);
  let r = await h.call('POST', `/api/admin/security/sessions/${owner.sessionId}/block`, { token: admin.token });
  assertStatus(r, 409);
  assertEquals(r.body.code, 'staff_account');
  r = await h.call('POST', `/api/admin/security/sessions/${admin.sessionId}/block`, { token: admin.token });
  assertStatus(r, 409);
  await h.sql`update app_sessions set revoked_at = now(), revoke_reason = 'logout' where id = ${c.sessionId}`;
  r = await h.call('POST', `/api/admin/security/sessions/${c.sessionId}/block`, { token: admin.token });
  assertStatus(r, 409);
  assertEquals(r.body.code, 'session_ended');
  r = await h.call('POST', `/api/admin/security/sessions/${c.sessionId}/block`, { token: admin.token, body: { reason: 'x'.repeat(301) } });
  assertStatus(r, 400);
});

test('E6 brings the blocked sign-in fully back: its refresh works again', async () => {
  const c = await h.customer();
  let r = await h.call('POST', `/api/admin/security/sessions/${c.sessionId}/block`, { token: admin.token, body: { reason: 'Checking a report' } });
  assertStatus(r, 200);
  // while blocked, refresh is refused; Supabase Auth has rotated the token, and the browser keeps the new one
  const refused = await h.call('POST', '/api/auth/refresh-token', { body: { refreshToken: c.refreshToken } });
  assertStatus(refused, 403);
  assertEquals(refused.body.code, 'session_blocked');
  const kept = refused.body.refreshToken as string;
  assert(typeof kept === 'string' && kept.length > 10 && kept !== c.refreshToken, 'the rotated refresh token is handed back');
  assertEquals((await h.sql`select 1 from auth.sessions where id = ${c.sessionId}`).length, 1, 'the Supabase Auth session is kept');

  r = await h.call('POST', `/api/admin/security/sessions/${c.sessionId}/unblock`, { token: admin.token });
  assertStatus(r, 200);
  assertEquals(r.body.session.status, 'active');
  const again = await h.call('POST', '/api/auth/refresh-token', { body: { refreshToken: kept } });
  assertStatus(again, 200);
  const token = again.body.session.accessToken as string;
  assertEquals(String(decodeClaims(token).session_id), c.sessionId, 'the same sign-in, not a new one');
  assertStatus(await h.call('GET', '/api/me/security', { token }), 200);
  assertStatus(await h.call('GET', '/api/me/security', { token: c.token }), 200);
  const a = await audits('session.unblock', c.sessionId);
  assertEquals(a.length, 1);
  assertEquals(a[0].actor_id, admin.id);
  assertEquals(a[0].detail?.previousReason, 'Checking a report');
});

test('E5/E6 on a sign-in that has ended or expired: 409 session_ended, nothing changes', async () => {
  const c = await h.customer();
  const two = await anotherSignIn(c);
  // blocked, then signed out: there is nothing left to unblock
  assertStatus(await h.call('POST', `/api/admin/security/sessions/${two.sessionId}/block`, { token: admin.token }), 200);
  await h.sql`update app_sessions set revoked_at = now(), revoke_reason = 'logout' where id = ${two.sessionId}`;
  let r = await h.call('POST', `/api/admin/security/sessions/${two.sessionId}/unblock`, { token: admin.token });
  assertStatus(r, 409);
  assertEquals(r.body.code, 'session_ended');
  // expired
  await h.sql`update app_sessions set expires_at = now() - interval '1 minute' where id = ${c.sessionId}`;
  for (const act of ['block', 'unblock']) {
    r = await h.call('POST', `/api/admin/security/sessions/${c.sessionId}/${act}`, { token: admin.token });
    assertStatus(r, 409, act);
    assertEquals(r.body.code, 'session_ended');
  }
  assertEquals((await audits('session.unblock', two.sessionId)).length, 0);
  assertEquals((await audits('session.block', c.sessionId)).length, 0);
  const rows = await h.sql<{ blocked_at: Date | null }[]>`select blocked_at from app_sessions where id = ${c.sessionId}`;
  assertEquals(rows[0].blocked_at, null);
  // E4 leaves both out; the ?all=1 history shows them as ended
  const live = await h.call('GET', `/api/admin/security/customers/${c.id}/sessions`, { token: support.token });
  assertEquals(live.body.sessions.length, 0);
  const hist = await h.call('GET', `/api/admin/security/customers/${c.id}/sessions?all=1`, { token: support.token });
  assertEquals(hist.body.sessions.map((s: { status: string }) => s.status), ['ended', 'ended']);
  const e3 = await h.call('GET', `/api/admin/security/customers?q=${encodeURIComponent(c.email)}`, { token: support.token });
  assertEquals([e3.body.customers[0].activeSessionCount, e3.body.customers[0].blockedSessionCount], [0, 0]);
});

// ── E7 / E8 ─────────────────────────────────────────────────────────────────────────────

test('E7/E8: paid-access suspension keeps every sign-in; paid sheets refused, then restored', async () => {
  const c = await h.customer();
  await h.grant(c.id, { productId: 'az-C', days: 30 });
  assertStatus(await h.call('POST', '/api/access/az-C', { token: c.token }), 200);

  let r = await h.call('POST', `/api/admin/security/customers/${c.id}/block`, { token: admin.token, body: { note: 'Checking a report' } });
  assertStatus(r, 200);
  assertEquals(r.body.changed, true);
  const x = r.body.customer;
  assertEquals(x.id, c.id);
  assertEquals(x.accessStatus, 'suspended');
  assertEquals(x.activeSessionCount, 1);
  assertEquals(x.suspensionReason, 'staff');
  for (const k of ['name', 'email', 'warningCount', 'maxWarnings', 'lastLoginAt']) assert(k in x, k);

  // still signed in; My Account works; paid sheet refused
  const sec = await h.call('GET', '/api/me/security', { token: c.token });
  assertStatus(sec, 200);
  assertEquals(sec.body.accessStatus, 'suspended');
  const paid = await h.call('POST', '/api/access/az-C', { token: c.token });
  assertStatus(paid, 403);
  assertEquals(paid.body.code, 'access_suspended');
  const live = await h.sql`select 1 from app_sessions where user_id = ${c.id} and revoked_at is null and blocked_at is null`;
  assertEquals(live.length, 1);
  assertEquals((await audits('access.suspend', c.id)).length, 1);
  assertEquals((await audits('access.suspend', c.id))[0].actor_id, admin.id);
  const mail = await h.sql`select 1 from email_outbox where template = 'access_suspended' and to_user_id = ${c.id}`;
  assertEquals(mail.length, 1);

  r = await h.call('POST', `/api/admin/security/customers/${c.id}/block`, { token: admin.token });
  assertStatus(r, 200);
  assertEquals(r.body.changed, false);

  r = await h.call('POST', `/api/admin/security/customers/${c.id}/unblock`, { token: admin.token });
  assertStatus(r, 200);
  assertEquals(r.body.changed, true);
  assertEquals(r.body.customer.accessStatus, 'active');
  assertStatus(await h.call('POST', '/api/access/az-C', { token: c.token }), 200);
  assertEquals((await audits('access.restore', c.id)).length, 1);

  // unknown customer, staff account, bad body
  assertStatus(await h.call('POST', `/api/admin/security/customers/${crypto.randomUUID()}/block`, { token: admin.token }), 404);
  r = await h.call('POST', `/api/admin/security/customers/${support.id}/block`, { token: admin.token });
  assertStatus(r, 409);
  assertEquals(r.body.code, 'staff_account');
  assertStatus(await h.call('POST', `/api/admin/security/customers/${c.id}/unblock`, { token: admin.token, body: { resetWarnings: 'yes' } }), 400);
});

test('E8 with resetWarnings revokes the active warnings (audited)', async () => {
  const c = await h.customer();
  await report(c.id);
  await report(c.id);
  const third = await report(c.id);
  assertEquals(third.warning.level, 3);
  assertEquals(third.warning.suspended, true);
  const r = await h.call('POST', `/api/admin/security/customers/${c.id}/unblock`, { token: admin.token, body: { resetWarnings: true, note: 'Spoke to the parent' } });
  assertStatus(r, 200);
  assertEquals(r.body.customer.accessStatus, 'active');
  assertEquals(r.body.customer.warningCount, 0);
  assertEquals((await audits('security.warnings_reset', c.id)).length, 1);
});

test('E7/E8 leave every sign-in as it was: two working sign-ins keep working, a blocked one stays blocked', async () => {
  const c = await h.customer();
  await h.grant(c.id, { productId: 'az-C', days: 30 });
  const two = await anotherSignIn(c);
  const three = await anotherSignIn(c, 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1');
  assertStatus(await h.call('POST', `/api/admin/security/sessions/${three.sessionId}/block`, { token: admin.token, body: { reason: 'Unknown phone' } }), 200);

  let r = await h.call('POST', `/api/admin/security/customers/${c.id}/block`, { token: admin.token, body: { note: 'Checking a report' } });
  assertStatus(r, 200);
  assertEquals([r.body.customer.accessStatus, r.body.customer.activeSessionCount, r.body.customer.blockedSessionCount], ['suspended', 2, 1]);
  for (const t of [c.token, two.token]) {
    const me = await h.call('GET', '/api/me/security', { token: t });
    assertStatus(me, 200);
    assertEquals(me.body.accessStatus, 'suspended');
    const paid = await h.call('POST', '/api/access/az-C', { token: t });
    assertStatus(paid, 403);
    assertEquals(paid.body.code, 'access_suspended');
  }
  assertEquals((await h.call('GET', '/api/me/security', { token: three.token })).body.code, 'session_blocked');

  r = await h.call('POST', `/api/admin/security/customers/${c.id}/unblock`, { token: admin.token });
  assertStatus(r, 200);
  assertEquals([r.body.customer.accessStatus, r.body.customer.activeSessionCount, r.body.customer.blockedSessionCount], ['active', 2, 1]);
  for (const t of [c.token, two.token]) assertStatus(await h.call('POST', '/api/access/az-C', { token: t }), 200);
  // "Blocked sessions stay blocked until you unblock them one by one"
  const still = await h.call('GET', '/api/me/security', { token: three.token });
  assertStatus(still, 403);
  assertEquals(still.body.code, 'session_blocked');
  const rows = await h.sql<{ id: string; blocked_at: Date | null; revoked_at: Date | null }[]>`
    select id, blocked_at, revoked_at from app_sessions where user_id = ${c.id}`;
  assertEquals(rows.length, 3);
  assert(rows.every((x) => !x.revoked_at), 'no sign-in ended');
  assertEquals(rows.filter((x) => x.blocked_at).map((x) => x.id), [three.sessionId]);
  assertEquals((await h.sql`select 1 from auth.sessions where user_id = ${c.id}`).length, 3, 'Supabase Auth sessions untouched');
  const list = await h.call('GET', `/api/admin/security/customers/${c.id}/sessions`, { token: support.token });
  assertEquals(list.body.sessions.find((s: { id: string }) => s.id === three.sessionId).status, 'blocked');
  // both audited, by the staff member, with the note
  const sus = await audits('access.suspend', c.id);
  assertEquals(sus.length, 1);
  assertEquals(sus[0].actor_id, admin.id);
  const res = await audits('access.restore', c.id);
  assertEquals(res.length, 1);
  assertEquals(res[0].actor_id, admin.id);
  assertEquals(res[0].detail?.resetWarnings, false);
  // the customer is told both times
  const mails = await h.sql<{ template: string }[]>`select template from email_outbox where to_user_id = ${c.id} and template in ('access_suspended', 'access_restored') order by id`;
  assertEquals(mails.map((m) => m.template), ['access_suspended', 'access_restored']);
});

// ── incidents, reports, warnings ────────────────────────────────────────────────────────

test('incidents: list, confirm (one warning), dismiss, no double decision', async () => {
  const c = await h.customer();
  const i1 = await incident(c.id);
  const i2 = await incident(c.id, 'many_devices_day', 'Used on 7 devices today.');
  let r = await h.call('GET', `/api/admin/security/incidents?status=open&user=${c.id}`, { token: support.token });
  assertStatus(r, 200);
  assertEquals(r.body.incidents.map((x: { id: number }) => x.id).sort(), [i1, i2].sort());
  const one = r.body.incidents.find((x: { id: number }) => x.id === i1);
  assertEquals(one.email, c.email);
  assertEquals(one.ruleName.length > 0, true);
  assertEquals(one.summary, 'Used on 4 devices from 3 networks within 15 minutes.');
  assertEquals(typeof one.firstSeenAt, 'number');
  assertStatus(await h.call('GET', '/api/admin/security/incidents?status=weird', { token: support.token }), 400);
  assertStatus(await h.call('GET', '/api/admin/security/incidents?user=nope', { token: support.token }), 400);

  r = await h.call('POST', `/api/admin/security/incidents/${i1}/confirm`, { token: admin.token, body: { note: 'Checked the networks' } });
  assertStatus(r, 200);
  assertEquals(r.body.incident.status, 'confirmed');
  assertEquals(r.body.incident.decisionNote, 'Checked the networks');
  assertEquals(r.body.warning.level, 1);
  assertEquals(r.body.incident.warningId, r.body.warning.warningId);
  assertEquals(r.body.security.warningCount, 1);
  assertEquals((await audits('security.incident_confirm', i1)).length, 1);

  r = await h.call('POST', `/api/admin/security/incidents/${i1}/confirm`, { token: admin.token, body: {} });
  assertStatus(r, 409);
  assertEquals(r.body.code, 'already_confirmed');

  r = await h.call('POST', `/api/admin/security/incidents/${i2}/dismiss`, { token: admin.token, body: { note: 'New school tablets' } });
  assertStatus(r, 200);
  assertEquals(r.body.incident.status, 'dismissed');
  assertEquals(r.body.warning, null);
  assertEquals(r.body.security.warningCount, 1);
  assertEquals((await audits('security.incident_dismiss', i2)).length, 1);
  r = await h.call('POST', `/api/admin/security/incidents/${i2}/confirm`, { token: admin.token });
  assertStatus(r, 409);

  assertStatus(await h.call('POST', '/api/admin/security/incidents/99999999/confirm', { token: admin.token }), 404);
  assertStatus(await h.call('POST', '/api/admin/security/incidents/abc/dismiss', { token: admin.token }), 404);
  assertStatus(await h.call('POST', `/api/admin/security/incidents/${i2}/dismiss`, { token: admin.token, body: { note: 5 } }), 400);
});

test('report by staff: incident (+ warning when confirmed); validation', async () => {
  const c = await h.customer();
  let r = await h.call('POST', `/api/admin/security/customers/${c.id}/report`, { token: admin.token, body: { reason: 'no' } });
  assertStatus(r, 400);
  r = await h.call('POST', `/api/admin/security/customers/${c.id}/report`, { token: admin.token, body: { reason: 'Password posted in a parents group', confirm: 'yes' } });
  assertStatus(r, 400);
  r = await h.call('POST', `/api/admin/security/customers/${c.id}/report`, { token: admin.token, body: { reason: 'Password posted in a parents group' } });
  assertStatus(r, 200);
  assertEquals(r.body.incident.status, 'open');
  assertEquals(r.body.incident.rule, 'manual_report');
  assertEquals(r.body.warning, null);
  r = await h.call('POST', `/api/admin/security/customers/${c.id}/report`, { token: admin.token, body: { reason: 'Second report, confirmed', confirm: true } });
  assertStatus(r, 200);
  assertEquals(r.body.incident.status, 'confirmed');
  assertEquals(r.body.warning.level, 1);
  assertEquals((await audits('security.report')).filter((a) => a.detail?.userId === c.id).length, 2);
  r = await h.call('POST', `/api/admin/security/customers/${owner.id}/report`, { token: admin.token, body: { reason: 'Owner sharing?' } });
  assertStatus(r, 409);
});

test('warnings: list and revoke (audited, customer told, suspension left to staff)', async () => {
  const c = await h.customer();
  const w = (await report(c.id)).warning;
  let r = await h.call('GET', `/api/admin/security/warnings?user=${c.id}`, { token: support.token });
  assertStatus(r, 200);
  assertEquals(r.body.warnings.length, 1);
  const x = r.body.warnings[0];
  assertEquals(x.id, w.warningId);
  assertEquals(x.level, 1);
  assertEquals(x.status, 'active');
  assertEquals(typeof x.issuedAt, 'number');
  assertEquals(typeof x.expiresAt, 'number');
  assertStatus(await h.call('GET', '/api/admin/security/warnings?status=nope', { token: support.token }), 400);

  r = await h.call('POST', `/api/admin/security/warnings/${w.warningId}/revoke`, { token: admin.token, body: { reason: 'x' } });
  assertStatus(r, 400);
  r = await h.call('POST', `/api/admin/security/warnings/${w.warningId}/revoke`, { token: admin.token, body: { reason: 'Same family, one tablet' } });
  assertStatus(r, 200);
  assertEquals(r.body.warning.status, 'revoked');
  assertEquals(r.body.warning.revokeReason, 'Same family, one tablet');
  assertEquals(r.body.security.warningCount, 0);
  assertEquals((await audits('security.warning_revoke', w.warningId)).length, 1);
  const n = await h.sql`select 1 from notifications where user_id = ${c.id} and kind = 'security.warning_revoked'`;
  assertEquals(n.length, 1);
  r = await h.call('POST', `/api/admin/security/warnings/${w.warningId}/revoke`, { token: admin.token, body: { reason: 'Again please' } });
  assertStatus(r, 409);
  assertStatus(await h.call('POST', '/api/admin/security/warnings/987654321/revoke', { token: admin.token, body: { reason: 'Missing one' } }), 404);
  const active = await h.call('GET', `/api/admin/security/warnings?user=${c.id}&status=active`, { token: support.token });
  assertEquals(active.body.warnings.length, 0);
});

// ── appeals ─────────────────────────────────────────────────────────────────────────────

test('appeals: accept lifts the suspension (and resets warnings when asked), customer emailed', async () => {
  const c = await h.customer();
  await report(c.id);
  await report(c.id);
  await report(c.id);
  const id = await appeal(c.id, 'suspension');
  let r = await h.call('GET', '/api/admin/security/appeals?status=open', { token: support.token });
  assertStatus(r, 200);
  const listed = r.body.appeals.find((a: { id: number }) => a.id === id);
  assertEquals(listed.accessStatus, 'suspended');
  assertEquals(listed.warningCount, 3);
  assertEquals(listed.email, c.email);
  assertStatus(await h.call('GET', '/api/admin/security/appeals?status=maybe', { token: support.token }), 400);

  r = await h.call('POST', `/api/admin/security/appeals/${id}/decide`, { token: admin.token, body: { response: 'ok' } });
  assertStatus(r, 400);
  h.mail.clear();
  r = await h.call('POST', `/api/admin/security/appeals/${id}/decide`, { token: admin.token, body: { accept: true, response: 'Thanks for explaining.', resetWarnings: true } });
  assertStatus(r, 200);
  assertEquals(r.body.appeal.status, 'accepted');
  assertEquals(r.body.appeal.response, 'Thanks for explaining.');
  assertEquals(r.body.restored, true);
  assertEquals(r.body.security.accessStatus, 'active');
  assertEquals(r.body.security.warningCount, 0);
  assertEquals((await audits('security.appeal_decide', id)).length, 1);
  assertEquals((await audits('access.restore', c.id)).length, 1);
  const out = await h.sql`select 1 from email_outbox where template = 'appeal_decision' and to_user_id = ${c.id}`;
  assertEquals(out.length, 1);
  await h.processOutbox();
  assert(h.mail.to(c.email).some((m) => /your note about account security/.test(m.subject)), 'decision emailed');
  const sec = await h.call('GET', '/api/me/security', { token: c.token });
  assertEquals(sec.body.accessStatus, 'active');

  r = await h.call('POST', `/api/admin/security/appeals/${id}/decide`, { token: admin.token, body: { accept: false, response: 'Changed my mind' } });
  assertStatus(r, 409);
  assertEquals(r.body.code, 'already_decided');
  assertStatus(await h.call('POST', '/api/admin/security/appeals/77777777/decide', { token: admin.token, body: { accept: true } }), 404);
});

test('appeals: a warning appeal — accept removes that warning only; reject needs a reason', async () => {
  const c = await h.customer();
  const w1 = (await report(c.id, 'First report')).warning;
  const w2 = (await report(c.id, 'Second report')).warning;
  const a1 = await appeal(c.id, 'warning', w1.warningId);
  let r = await h.call('POST', `/api/admin/security/appeals/${a1}/decide`, { token: admin.token, body: { accept: true } });
  assertStatus(r, 200);
  assertEquals(r.body.revokedWarning, w1.warningId);
  assertEquals(r.body.restored, false);
  assertEquals(r.body.security.warningCount, 1);
  assertEquals(r.body.security.warnings[0].id, w2.warningId);

  const a2 = await appeal(c.id, 'warning', w2.warningId);
  r = await h.call('POST', `/api/admin/security/appeals/${a2}/decide`, { token: admin.token, body: { accept: false } });
  assertStatus(r, 400);
  r = await h.call('POST', `/api/admin/security/appeals/${a2}/decide`, { token: admin.token, body: { accept: false, response: 'The devices were in three cities on one evening.' } });
  assertStatus(r, 200);
  assertEquals(r.body.appeal.status, 'rejected');
  assertEquals(r.body.security.warningCount, 1);
  const n = await h.sql`select 1 from notifications where user_id = ${c.id} and kind = 'appeal.decided'`;
  assertEquals(n.length, 2);
});

test('appeals: accept without resetWarnings restores access but keeps the warnings; decision emails', async () => {
  const c = await h.customer({ name: 'Rohan' });
  await report(c.id);
  await report(c.id);
  const third = await report(c.id);
  assertEquals(third.warning.suspended, true);
  const id = await appeal(c.id, 'suspension');
  h.mail.clear();
  let r = await h.call('POST', `/api/admin/security/appeals/${id}/decide`, { token: admin.token, body: { accept: true, response: 'Thanks — <b>noted</b>.' } });
  assertStatus(r, 200);
  assertEquals(r.body.appeal.status, 'accepted');
  assertEquals(r.body.restored, true);
  assertEquals(r.body.revokedWarning, null, 'a suspension appeal removes no warning by itself');
  assertEquals(r.body.security.accessStatus, 'active');
  assertEquals(r.body.security.warningCount, 3);
  assertEquals((await audits('security.warnings_reset', c.id)).length, 0);
  const a = await audits('security.appeal_decide', id);
  assertEquals(a.length, 1);
  assertEquals(a[0].actor_id, admin.id);
  assertEquals([a[0].detail?.accept, a[0].detail?.restored, a[0].detail?.resetWarnings], [true, true, false]);
  assertEquals((await audits('access.restore', c.id)).length, 1);
  const paid = await h.call('GET', '/api/me/security', { token: c.token });
  assertEquals([paid.body.accessStatus, paid.body.warningCount], ['active', 3]);
  await h.processOutbox();
  const mail = h.mail.to(c.email).find((m) => /your note about account security/.test(m.subject));
  assert(mail, 'decision emailed');
  assertMatch(mail!.text, /Hello Rohan/);
  assertMatch(mail!.text, /We accepted your note/);
  assertMatch(mail!.text, /Thanks — <b>noted<\/b>\./);
  assert(!mail!.html.includes('<b>noted</b>'), 'the response is escaped in the HTML part');
  const n = await h.sql<{ title: string }[]>`select title from notifications where user_id = ${c.id} and kind = 'appeal.decided'`;
  assertEquals(n.map((x) => x.title), ['We accepted your note']);

  // a rejected warning appeal: the warning stays, the email says so (sent once, even if retried)
  const id2 = await appeal(c.id, 'warning');
  h.mail.clear();
  r = await h.call('POST', `/api/admin/security/appeals/${id2}/decide`, { token: admin.token, body: { accept: false, response: 'The devices were in three cities.' } });
  assertStatus(r, 200);
  assertEquals([r.body.appeal.status, r.body.revokedWarning, r.body.restored, r.body.security.warningCount], ['rejected', null, false, 3]);
  await h.processOutbox();
  const no = h.mail.to(c.email).filter((m) => /your note about account security/.test(m.subject));
  assertEquals(no.length, 1);
  assertMatch(no[0].text, /We kept the warning\./);
  assertMatch(no[0].text, /three cities/);
  const out = await h.sql<{ n: number }[]>`select count(*)::int as n from email_outbox where dedupe_key = ${`appeal-decision:${id2}`}`;
  assertEquals(out[0].n, 1);
});

// ── rules ───────────────────────────────────────────────────────────────────────────────

test('rules: read, change with validated params (audited)', async () => {
  let r = await h.call('GET', '/api/admin/security/rules', { token: support.token });
  assertStatus(r, 200);
  assertEquals(r.body.rules.map((x: { id: string }) => x.id), ['concurrent_devices', 'manual_report', 'many_countries_day', 'many_devices_day', 'rapid_page_requests']);
  r = await h.call('GET', '/api/admin/security/rules/concurrent_devices', { token: support.token });
  assertStatus(r, 200);
  assertEquals(r.body.rule.params, { devices: 3, networks: 2, windowMinutes: 15 });
  assertStatus(await h.call('GET', '/api/admin/security/rules/nope_rule', { token: support.token }), 404);

  // a new IP or one device alone must never trip a rule: devices below 3 is refused
  r = await h.call('PUT', '/api/admin/security/rules/concurrent_devices', { token: admin.token, body: { params: { devices: 1 } } });
  assertStatus(r, 400);
  r = await h.call('PUT', '/api/admin/security/rules/concurrent_devices', { token: admin.token, body: { params: { hours: 3 } } });
  assertStatus(r, 400);
  r = await h.call('PUT', '/api/admin/security/rules/concurrent_devices', { token: admin.token, body: { severity: 'extreme' } });
  assertStatus(r, 400);
  r = await h.call('PUT', '/api/admin/security/rules/manual_report', { token: admin.token, body: { autoConfirm: true } });
  assertStatus(r, 400);
  r = await h.call('PUT', '/api/admin/security/rules/concurrent_devices', { token: admin.token, body: {} });
  assertStatus(r, 400);

  r = await h.call('PUT', '/api/admin/security/rules/concurrent_devices', { token: admin.token, body: { params: { devices: 4 }, autoConfirm: true, severity: 'medium' } });
  assertStatus(r, 200);
  assertEquals(r.body.rule.params, { devices: 4, networks: 2, windowMinutes: 15 });
  assertEquals(r.body.rule.autoConfirm, true);
  assertEquals(r.body.rule.severity, 'medium');
  const a = await audits('security.rule_update', 'concurrent_devices');
  assertEquals(a.length, 1);
  assertEquals((a[0].detail?.before as { params: Record<string, number> }).params.devices, 3);

  r = await h.call('PUT', '/api/admin/security/rules', { token: admin.token, body: { rules: [{ id: 'many_devices_day', enabled: false }, { id: 'concurrent_devices', autoConfirm: false }] } });
  assertStatus(r, 200);
  assertEquals(r.body.rules.length, 2);
  // all or nothing: one bad entry changes nothing
  r = await h.call('PUT', '/api/admin/security/rules', { token: admin.token, body: { rules: [{ id: 'many_devices_day', enabled: true }, { id: 'rapid_page_requests', params: { requests: 1 } }] } });
  assertStatus(r, 400);
  const row = await h.sql<{ enabled: boolean }[]>`select enabled from security_rules where id = 'many_devices_day'`;
  assertEquals(row[0].enabled, false);
});

test('rules: every limit holds — a rule can never need fewer than 3 devices or 2 networks', async () => {
  const saved = await h.sql<{ id: string; enabled: boolean; auto_confirm: boolean; severity: string; params: Record<string, number> }[]>`
    select id, enabled, auto_confirm, severity, params from security_rules order by id`;
  const auditsBefore = (await audits('security.rule_update')).length;
  const r0 = await h.call('GET', '/api/admin/security/rules/concurrent_devices', { token: support.token });
  assertEquals(r0.body.rule.limits, { devices: [3, 100], networks: [2, 100], windowMinutes: [1, 1440] });

  const refused: [string, unknown][] = [
    ['concurrent_devices', { devices: 2 }],
    ['concurrent_devices', { devices: 0 }],
    ['concurrent_devices', { devices: -3 }],
    ['concurrent_devices', { networks: 1 }],
    ['concurrent_devices', { networks: 0 }],
    ['concurrent_devices', { windowMinutes: 0 }],
    ['concurrent_devices', { windowMinutes: 1441 }],
    ['concurrent_devices', { devices: 101 }],
    ['concurrent_devices', { devices: 3.5 }],
    ['concurrent_devices', { devices: '4' }],
    ['concurrent_devices', { devices: null }],
    ['concurrent_devices', { devices: true }],
    ['concurrent_devices', { devices: 4, networks: 1 }],   // one bad value spoils the whole change
    ['concurrent_devices', [3]],
    ['concurrent_devices', 'devices=3'],
    ['concurrent_devices', null],
    ['many_devices_day', { devices: 2 }],
    ['many_devices_day', { windowHours: 0 }],
    ['many_devices_day', { windowHours: 169 }],
    ['many_countries_day', { countries: 2 }],
    ['many_countries_day', { countries: 51 }],
    ['rapid_page_requests', { requests: 49 }],
    ['rapid_page_requests', { windowMinutes: 0 }],
    ['manual_report', { devices: 3 }],
  ];
  for (const [id, params] of refused) {
    const r = await h.call('PUT', `/api/admin/security/rules/${id}`, { token: admin.token, body: { params } });
    assertStatus(r, 400, `${id} ${JSON.stringify(params)}`);
    assert(r.body.errors?.params, `${id}: errors.params`);
  }
  // the same through the several-at-once call: nothing changes
  let r = await h.call('PUT', '/api/admin/security/rules', { token: admin.token, body: { rules: [{ id: 'many_devices_day', enabled: !saved.find((x) => x.id === 'many_devices_day')!.enabled }, { id: 'concurrent_devices', params: { networks: 1 } }] } });
  assertStatus(r, 400);
  r = await h.call('PUT', '/api/admin/security/rules', { token: admin.token, body: { rules: [{ id: 'many_devices_day', enabled: !saved.find((x) => x.id === 'many_devices_day')!.enabled }, { id: 'nope_rule', enabled: true }] } });
  assertStatus(r, 404);
  for (const bad of [{}, { rules: [] }, { rules: 'all' }, { rules: [null] }, { rules: [{ id: 'Bad Id!' }] }]) {
    assertStatus(await h.call('PUT', '/api/admin/security/rules', { token: admin.token, body: bad }), 400, JSON.stringify(bad));
  }
  const unchanged = await h.sql<{ id: string; enabled: boolean; auto_confirm: boolean; severity: string; params: Record<string, number> }[]>`
    select id, enabled, auto_confirm, severity, params from security_rules order by id`;
  assertEquals(unchanged, saved);
  assertEquals((await audits('security.rule_update')).length, auditsBefore, 'no audit row for a refused change');

  // the lowest allowed values are accepted
  r = await h.call('PUT', '/api/admin/security/rules/concurrent_devices', { token: admin.token, body: { params: { devices: 3, networks: 2, windowMinutes: 1440 } } });
  assertStatus(r, 200);
  assertEquals(r.body.rule.params, { devices: 3, networks: 2, windowMinutes: 1440 });
  r = await h.call('PUT', '/api/admin/security/rules', {
    token: admin.token,
    body: { rules: [
      { id: 'many_devices_day', params: { devices: 3, windowHours: 1 } },
      { id: 'many_countries_day', params: { countries: 3 } },
      { id: 'rapid_page_requests', params: { requests: 50 }, severity: 'low' },
    ] },
  });
  assertStatus(r, 200);
  assertEquals(r.body.rules.map((x: { id: string; params: Record<string, number> }) => [x.id, x.params.devices ?? x.params.countries ?? x.params.requests]), [
    ['many_devices_day', 3], ['many_countries_day', 3], ['rapid_page_requests', 50],
  ]);
  const after = await audits('security.rule_update');
  assertEquals(after.length, auditsBefore + 4);
  assert(after.slice(auditsBefore).every((x) => x.actor_id === admin.id), 'audited as the staff member');
  // unknown rules
  assertStatus(await h.call('GET', '/api/admin/security/rules/nope_rule', { token: support.token }), 404);
  assertStatus(await h.call('PUT', '/api/admin/security/rules/nope_rule', { token: admin.token, body: { enabled: false } }), 404);
  assertStatus(await h.call('PUT', '/api/admin/security/rules/Bad-Id', { token: admin.token, body: { enabled: false } }), 404);

  // put everything back as it was
  for (const s of saved) {
    await h.sql`update security_rules set enabled = ${s.enabled}, auto_confirm = ${s.auto_confirm}, severity = ${s.severity}, params = ${h.sql.json(s.params)} where id = ${s.id}`;
  }
});

// ── old log pages ───────────────────────────────────────────────────────────────────────

test('old logs: security-events, login-activity and access-log keep their shapes (ms times)', async () => {
  const c = await h.customer();
  await h.grant(c.id, { productId: 'az-C', days: 30 });
  assertStatus(await h.call('POST', '/api/access/az-C', { token: c.token }), 200);
  await h.login(c.email, 'wrong-password-1A');
  await h.sql`insert into security_events (user_id, event_type, detail) values (${c.id}, 'test.event', ${h.sql.json({ a: 1 })})`;

  let r = await h.call('GET', `/api/admin/security-events?user=${c.id}`, { token: developer.token });
  assertStatus(r, 200);
  const e = r.body.events.find((x: { event_type: string }) => x.event_type === 'test.event');
  assertEquals(e.user_id, c.id);
  assertEquals(e.email, c.email);
  assertEquals(e.detail, { a: 1 });
  assertEquals(typeof e.created_at, 'number');

  r = await h.call('GET', `/api/admin/login-activity?email=${encodeURIComponent(c.email)}&success=false`, { token: developer.token });
  assertStatus(r, 200);
  assert(r.body.logins.length >= 1, 'failed login listed');
  const l = r.body.logins[0];
  assertEquals(l.success, false);
  assertEquals(typeof l.created_at, 'number');
  for (const k of ['id', 'user_id', 'email', 'failure_reason', 'ip', 'user_agent']) assert(k in l, k);

  r = await h.call('GET', `/api/admin/access-log?user=${c.id}`, { token: developer.token });
  assertStatus(r, 200);
  const a = r.body.log[0];
  assertEquals(a.user_id, c.id);
  assertEquals(a.worksheet_id, 'az-C');
  assertEquals(a.action, 'access');
  assertEquals(a.ok, true);
  assertEquals(a.email, c.email);
  assertEquals(typeof a.at, 'number');

  assertStatus(await h.call('GET', '/api/admin/security-events?limit=-5', { token: developer.token }), 200);
  assertStatus(await h.call('GET', '/api/admin/security-events?limit=abc', { token: developer.token }), 200);
  assertStatus(await h.call('GET', '/api/admin/security-events?user=bad', { token: developer.token }), 400);
  assertStatus(await h.call('GET', '/api/admin/security-events', { token: (await h.staff('content')).token }), 403);
});

test('old logs: filters by type, success and worksheet; bad filters refused', async () => {
  const c = await h.customer();
  await h.grant(c.id, { productId: 'az-C', days: 30 });
  await h.sql`insert into security_events (user_id, event_type, detail) values (${c.id}, 'test.other', ${h.sql.json({ b: 2 })})`;
  await h.sql`insert into security_events (user_id, event_type, detail) values (${c.id}, 'test.event', ${h.sql.json({ a: 1 })})`;
  let r = await h.call('GET', `/api/admin/security-events?user=${c.id}&type=test.other`, { token: support.token });
  assertStatus(r, 200);
  assertEquals(r.body.events.map((e: { type: string; event_type: string }) => [e.type, e.event_type]), [['test.other', 'test.other']]);
  assertStatus(await h.call('GET', '/api/admin/security-events?type=DROP%20TABLE', { token: support.token }), 400);

  assertStatus(await h.login(c.email, c.password), 200);
  await h.login(c.email, 'wrong-password-2B');
  r = await h.call('GET', `/api/admin/login-activity?user=${c.id}&success=true`, { token: support.token });
  assertStatus(r, 200);
  assert(r.body.logins.length >= 1 && r.body.logins.every((l: { success: boolean; user_id: string }) => l.success && l.user_id === c.id), 'only good sign-ins');
  r = await h.call('GET', `/api/admin/login-activity?email=${encodeURIComponent(c.email.toUpperCase())}&success=0`, { token: support.token });
  assert(r.body.logins.length >= 1 && r.body.logins.every((l: { success: boolean; failure_reason: string }) => !l.success && l.failure_reason === 'bad_credentials'), 'only failed sign-ins');
  assertStatus(await h.call('GET', '/api/admin/login-activity?user=not-a-uuid', { token: support.token }), 400);

  assertStatus(await h.call('POST', '/api/access/az-C', { token: c.token }), 200);
  r = await h.call('GET', `/api/admin/access-log?user=${c.id}&worksheet=az-C`, { token: support.token });
  assertStatus(r, 200);
  assert(r.body.log.length >= 1 && r.body.log.every((a: { worksheet_id: string; productId: string }) => a.worksheet_id === 'az-C' && a.productId === 'az-C'), 'one sheet only');
  r = await h.call('GET', `/api/admin/access-log?user=${c.id}&worksheet=az-D`, { token: support.token });
  assertEquals(r.body.log.length, 0);
  assertStatus(await h.call('GET', '/api/admin/access-log?worksheet=../../x', { token: support.token }), 400);
  // never a token in the log answers
  for (const p of [`/api/admin/security-events?user=${c.id}`, `/api/admin/login-activity?user=${c.id}`, `/api/admin/access-log?user=${c.id}`]) {
    const x = await h.call('GET', p, { token: support.token });
    assertStatus(x, 200, p);
    assert(!x.text.includes(c.token) && !x.text.includes(c.refreshToken), `${p}: no token`);
  }
});
