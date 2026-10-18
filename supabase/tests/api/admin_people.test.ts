// Builder F: staff "people" screens (routes/admin_people.ts): /api/admin/me, customers (list,
// profile, users/status compat, account block, end sessions, reset link), staff management
// rules and the contact inbox.
import { assert, assertEquals, assertMatch, assertStatus, startHarness, test, uniqueEmail, type TestUser } from './harness.ts';
import { HttpError } from '../../functions/api/lib/http.ts';
import { staffDbError } from '../../functions/api/routes/admin_people.ts';

const h = await startHarness();

const owner = await h.staff('owner');
const admin = await h.staff('admin');
const support = await h.staff('support');
const content = await h.staff('content');

const audits = (action: string, targetId?: string | number) =>
  h.sql<{ id: number; actor_id: string | null; actor_role: string | null; detail: Record<string, unknown> | null }[]>`
    select id, actor_id, actor_role, detail from audit_logs
    where action = ${action} and (${targetId == null ? null : String(targetId)}::text is null or target_id = ${targetId == null ? null : String(targetId)})
    order by id`;

const liveSessions = (userId: string) =>
  h.sql<{ id: string; revoke_reason: string | null }[]>`
    select id, revoke_reason from app_sessions where user_id = ${userId} and revoked_at is null`;

function orderId() {
  const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return 'LWO-' + Array.from(crypto.getRandomValues(new Uint8Array(10)), (x) => a[x % a.length]).join('');
}

async function message(o: { name?: string; email?: string; body?: string; userId?: string | null } = {}) {
  const r = await h.sql<{ id: number }[]>`
    insert into contact_messages (name, email, body, user_id, ip)
    values (${o.name ?? 'Asha'}, ${o.email ?? uniqueEmail('note')}, ${o.body ?? 'Do you have Class 1 sheets yet? Thank you.'}, ${o.userId ?? null}, '10.1.1.1')
    returning id`;
  return r[0].id;
}

/** Second sign-in of the same customer (fake Auth session + app_sessions row). */
async function anotherSignIn(u: TestUser) {
  const t = await h.fake.auth.issueSession(u.id, { userAgent: h.userAgent });
  const sid = JSON.parse(atob(t.access_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).session_id as string;
  await h.sql`
    insert into app_sessions (id, user_id, remember, expires_at, ip, ip_network, user_agent, device_label, is_staff)
    values (${sid}, ${u.id}, false, now() + interval '12 hours', '10.9.9.9', '10.9.9.0/24', ${h.userAgent}, 'Chrome on Windows', false)`;
  return { token: t.access_token as string, sessionId: sid };
}

// ── who may call what ───────────────────────────────────────────────────────────────────

test('admin people: no token, customer token and missing permissions are refused', async () => {
  const c = await h.customer();
  let r = await h.call('GET', '/api/admin/users');
  assertStatus(r, 401);
  assertEquals(r.body.code, 'staff_signin');
  r = await h.call('GET', '/api/admin/users', { token: c.token });
  assertStatus(r, 403);
  assertEquals(r.body.code, 'not_staff');
  r = await h.call('GET', '/api/admin/me', { token: c.token });
  assertStatus(r, 403);
  assertEquals(r.body.code, 'not_staff');

  // support reads customers but cannot change them, nor manage staff
  r = await h.call('GET', '/api/admin/users', { token: support.token });
  assertStatus(r, 200);
  r = await h.call('GET', `/api/admin/users/${c.id}`, { token: support.token });
  assertStatus(r, 200);
  for (const [m, p, body] of [
    ['POST', `/api/admin/users/${c.id}/block`, { reason: 'test reason' }],
    ['POST', `/api/admin/users/${c.id}/unblock`, {}],
    ['PUT', '/api/admin/users/status', { id: c.id, status: 'suspended' }],
    ['POST', `/api/admin/users/${c.id}/sessions/end-all`, {}],
    ['POST', `/api/admin/users/${c.id}/password-reset`, {}],
    ['GET', '/api/admin/staff', undefined],
    ['GET', '/api/admin/staff/roles', undefined],
    ['POST', '/api/admin/staff', { email: uniqueEmail('x'), role: 'support' }],
    ['PUT', `/api/admin/staff/${content.id}`, { note: 'x' }],
    ['DELETE', `/api/admin/staff/${content.id}`, undefined],
  ] as const) {
    r = await h.call(m, p, { token: support.token, body });
    assertStatus(r, 403, `${m} ${p}`);
    assertEquals(r.body.code, 'forbidden');
  }
  assertEquals((await liveSessions(c.id)).length, 1);

  // content has no customers.read and no messages
  r = await h.call('GET', '/api/admin/users', { token: content.token });
  assertStatus(r, 403);
  r = await h.call('GET', '/api/admin/messages', { token: content.token });
  assertStatus(r, 403);

  // a staff member with no permissions still sees who they are, and nothing else
  const bare = await h.staff('developer', []);
  r = await h.call('GET', '/api/admin/me', { token: bare.token });
  assertStatus(r, 200);
  assertEquals(r.body.staff, { role: 'developer', permissions: [] });
  r = await h.call('GET', '/api/admin/users', { token: bare.token });
  assertStatus(r, 403);
});

test('admin people: permission matrix — each call opens with its own permission and no other', async () => {
  const c = await h.customer();
  const ghost = crypto.randomUUID();
  const all = (await h.sql<{ id: string }[]>`select id from staff_permissions order by id`).map((r) => r.id);
  // [method, path, body, the permission it needs, the answer once that permission is held]
  const probes: [string, string, unknown, string, number][] = [
    ['GET', '/api/admin/users', undefined, 'customers.read', 200],
    ['GET', `/api/admin/users/${ghost}`, undefined, 'customers.read', 404],
    ['PUT', '/api/admin/users/status', { id: ghost, status: 'paused' }, 'customers.write', 400],
    ['POST', `/api/admin/users/${ghost}/block`, { reason: 'Permission matrix' }, 'customers.write', 404],
    ['POST', `/api/admin/users/${ghost}/unblock`, {}, 'customers.write', 404],
    ['POST', `/api/admin/users/${ghost}/sessions/end-all`, {}, 'customers.write', 404],
    ['POST', `/api/admin/users/${ghost}/password-reset`, {}, 'customers.write', 404],
    ['GET', '/api/admin/staff', undefined, 'staff.manage', 200],
    ['GET', '/api/admin/staff/roles', undefined, 'staff.manage', 200],
    ['POST', '/api/admin/staff', { email: 'not-an-email', role: 'support' }, 'staff.manage', 400],
    ['PUT', `/api/admin/staff/${ghost}`, { note: 'x' }, 'staff.manage', 404],
    ['DELETE', `/api/admin/staff/${ghost}`, undefined, 'staff.manage', 404],
    ['GET', '/api/admin/messages', undefined, 'messages.read', 200],
    ['POST', '/api/admin/messages/read', { id: 999999999 }, 'messages.write', 404],
    ['POST', '/api/admin/messages/replied', { id: 999999999 }, 'messages.write', 404],
    ['POST', '/api/admin/messages/999999999/status', { status: 'read' }, 'messages.write', 404],
    ['POST', '/api/admin/messages/999999999/reply', { body: 'Hello there' }, 'messages.write', 404],
  ];
  const only = new Map<string, TestUser>();
  const allBut = new Map<string, TestUser>();
  for (const p of new Set(probes.map((x) => x[3]))) {
    only.set(p, await h.staff('support', [p]));
    allBut.set(p, await h.staff('support', all.filter((k) => k !== p)));
  }
  for (const [m, path, body, perm, okStatus] of probes) {
    const label = `${m} ${path}`;
    let r = await h.call(m, path, { body });
    assertStatus(r, 401, label);
    assertEquals(r.body.code, 'staff_signin', label);
    r = await h.call(m, path, { token: c.token, body });
    assertStatus(r, 403, label);
    assertEquals(r.body.code, 'not_staff', label);
    r = await h.call(m, path, { token: allBut.get(perm)!.token, body });
    assertStatus(r, 403, `${label} without ${perm}`);
    assertEquals([r.body.code, r.body.permission], ['forbidden', perm], label);
    r = await h.call(m, path, { token: only.get(perm)!.token, body });
    assertStatus(r, okStatus, `${label} with only ${perm}`);
    r = await h.call(m, path, { token: owner.token, body });
    assertStatus(r, okStatus, `${label} as owner`);
  }
  // who am I: any active staff member, whatever they hold
  for (const u of [...only.values()]) assertStatus(await h.call('GET', '/api/admin/me', { token: u.token }), 200);
  // nothing was written by the refused calls
  assertEquals((await liveSessions(c.id)).length, 1);
});

test('GET /api/admin/me: effective permissions (owner = every key)', async () => {
  let r = await h.call('GET', '/api/admin/me', { token: owner.token });
  assertStatus(r, 200);
  assertEquals(r.body.permissions.length, 27);
  assertEquals(r.body.staff.role, 'owner');
  assertEquals(r.body.staff.permissions, r.body.permissions);
  assertEquals(r.body.user.email, owner.email);
  assertEquals(r.body.user.staff, { role: 'owner' });
  r = await h.call('GET', '/api/admin/me', { token: support.token });
  assertStatus(r, 200);
  assertEquals([...r.body.staff.permissions].sort(), ['catalogue.read', 'customers.read', 'dashboard.view', 'emails.read', 'messages.read', 'messages.write', 'orders.read', 'security.read']);
});

// ── customers ───────────────────────────────────────────────────────────────────────────

test('GET /api/admin/users: old fields plus the new ones, search and paging', async () => {
  const c = await h.customer({ name: 'Meera Search' });
  await h.grant(c.id, { productId: 'az-C', days: 30 });
  await h.sql`
    insert into orders (id, user_id, kind, status, currency, rate, total, total_inr, amount_minor, lines, method, paid_at)
    values (${orderId()}, ${c.id}, 'worksheet', 'paid', 'INR', 1, 99, 99, 9900, ${h.sql.json([])}, 'razorpay', now())`;
  const r = await h.call('GET', `/api/admin/users?q=${encodeURIComponent(c.email)}`, { token: support.token });
  assertStatus(r, 200);
  assertEquals(r.body.users.length, 1);
  assertEquals(r.body.total, 1);
  const u = r.body.users[0];
  assertEquals(u.id, c.id);
  assertEquals(u.email, c.email);
  assertEquals(u.name, 'Meera Search');
  assertEquals(u.role, 'parent');
  assertEquals(typeof u.created_at, 'number');
  assertEquals(typeof u.last_login_at, 'number');
  assertEquals(u.email_verified, true);
  assertEquals(u.account_status, 'active');
  assertEquals(u.locked_until, null);
  assertEquals(u.orders, 1);
  assertEquals(u.spent_inr, 99);
  assertEquals(u.active, 1);
  assertEquals(u.accessStatus, 'active');
  assertEquals(u.warningCount, 0);
  assertEquals(u.blocked, false);
  assertEquals(u.lastLoginAt, u.last_login_at);
  assertEquals(u.activeSessionCount, 1);
  assertEquals(u.staffRole, null);

  // search wildcards are literal
  const none = await h.call('GET', '/api/admin/users?q=%25%25%25zz_none', { token: support.token });
  assertStatus(none, 200);
  assertEquals(none.body.users.length, 0);

  const page = await h.call('GET', '/api/admin/users?limit=1&type=customers', { token: support.token });
  assertStatus(page, 200);
  assertEquals(page.body.users.length, 1);
  assert(page.body.total >= 2);
  assertEquals(page.body.nextOffset, 1);
  const staffOnly = await h.call('GET', '/api/admin/users?type=staff', { token: support.token });
  assert(staffOnly.body.users.every((x: { staffRole: string | null }) => x.staffRole), 'type=staff lists staff only');
  const badStatus = await h.call('GET', '/api/admin/users?status=weird', { token: support.token });
  assertStatus(badStatus, 400);
  const negative = await h.call('GET', '/api/admin/users?limit=-5', { token: support.token });
  assertStatus(negative, 200);
});

test('GET /api/admin/users filters: status = the account block, access = paid access, exact id', async () => {
  const blocked = await h.customer({ name: 'Filtertest Blocked' });
  const paused = await h.customer({ name: 'Filtertest Paused' });
  const plain = await h.customer({ name: 'Filtertest Plain' });
  const pending = await h.customer({ name: 'Filtertest Pending', verified: false });
  assertStatus(await h.call('POST', `/api/admin/users/${blocked.id}/block`, { token: admin.token, body: { reason: 'Filter test' } }), 200);
  assertStatus(await h.call('POST', `/api/admin/security/customers/${paused.id}/block`, { token: admin.token }), 200);
  const ids = async (qs: string) => {
    const r = await h.call('GET', `/api/admin/users?q=Filtertest&limit=1000&${qs}`, { token: support.token });
    assertStatus(r, 200, qs);
    return (r.body.users as { id: string }[]).map((u) => u.id).sort();
  };
  const sorted = (...xs: string[]) => [...xs].sort();
  assertEquals(await ids(''), sorted(blocked.id, paused.id, plain.id, pending.id));
  // the old panel's "suspended" is the account block; "blocked" says the same
  assertEquals(await ids('status=suspended'), [blocked.id]);
  assertEquals(await ids('status=blocked'), [blocked.id]);
  assertEquals(await ids('status=active'), sorted(paused.id, plain.id));
  assertEquals(await ids('status=pending_verification'), [pending.id]);
  // paid access is its own filter
  assertEquals(await ids('access=suspended'), [paused.id]);
  assertEquals(await ids('access=active'), sorted(blocked.id, plain.id, pending.id));
  assertEquals(await ids('status=active&access=suspended'), [paused.id]);
  // each row says what the filter matched on
  const row = async (email: string) => (await h.call('GET', `/api/admin/users?q=${encodeURIComponent(email)}`, { token: support.token })).body.users[0];
  const b = await row(blocked.email);
  assertEquals([b.status, b.account_status, b.blocked, b.accessStatus], ['suspended', 'suspended', true, 'active']);
  const p = await row(paused.email);
  assertEquals([p.status, p.account_status, p.blocked, p.accessStatus, p.suspensionReason], ['active', 'active', false, 'suspended', 'staff']);
  assertEquals(p.activeSessionCount, 1, 'paused paid access leaves the sign-in alone');
  // an exact id (any case) finds that one account
  const byId = await h.call('GET', `/api/admin/users?q=${plain.id.toUpperCase()}`, { token: support.token });
  assertEquals(byId.body.users.map((u: { id: string }) => u.id), [plain.id]);
  assertEquals(byId.body.total, 1);
  for (const qs of ['access=blocked', 'access=warned', 'type=robots']) {
    const r = await h.call('GET', `/api/admin/users?${qs}`, { token: support.token });
    assertStatus(r, 400, qs);
  }
});

test('GET /api/admin/users/:id: profile with orders, access, sessions, warnings and logins', async () => {
  const c = await h.customer();
  await h.grant(c.id, { productId: 'az-C', days: 10 });
  await h.grant(c.id, { productId: 'az-D', days: -1 });  // expired
  const r = await h.call('GET', `/api/admin/users/${c.id}`, { token: support.token });
  assertStatus(r, 200);
  assertEquals(r.body.user.id, c.id);
  assertEquals(r.body.security.warningCount, 0);
  assertEquals(r.body.entitlements.length, 2);
  assertEquals(r.body.entitlements.map((e: { status: string }) => e.status).sort(), ['active', 'expired']);
  assertEquals(r.body.sessions.length, 1);
  assertEquals(r.body.sessions[0].id, c.sessionId);
  assertEquals(r.body.sessions[0].status, 'active');
  for (const k of ['orders', 'warnings', 'incidents', 'appeals', 'logins']) assert(Array.isArray(r.body[k]), k);

  let nf = await h.call('GET', `/api/admin/users/${crypto.randomUUID()}`, { token: support.token });
  assertStatus(nf, 404);
  assertEquals(nf.body.error, 'No such customer.');
  nf = await h.call('GET', '/api/admin/users/not-a-uuid', { token: support.token });
  assertStatus(nf, 404);
});

test('PUT /api/admin/users/status keeps the old contract (suspend = account block)', async () => {
  const c = await h.customer();
  let r = await h.call('PUT', '/api/admin/users/status', { token: admin.token, body: { id: c.id, status: 'paused' } });
  assertStatus(r, 400);
  assertEquals(r.body.error, 'Status is active or suspended.');
  r = await h.call('PUT', '/api/admin/users/status', { token: admin.token, body: { id: crypto.randomUUID(), status: 'suspended' } });
  assertStatus(r, 404);
  assertEquals(r.body.error, 'No such customer.');
  r = await h.call('PUT', '/api/admin/users/status', { token: admin.token, body: { id: 12, status: 'suspended' } });
  assertStatus(r, 404);

  r = await h.call('PUT', '/api/admin/users/status', { token: admin.token, body: { id: c.id, status: 'suspended' } });
  assertStatus(r, 200);
  assertEquals(r.body.user.id, c.id);
  assertEquals(r.body.user.status, 'suspended');
  assertEquals(typeof r.body.user.created, 'number');
  assertEquals((await liveSessions(c.id)).length, 0);
  const s = await h.sql<{ revoke_reason: string }[]>`select revoke_reason from app_sessions where id = ${c.sessionId}`;
  assertEquals(s[0].revoke_reason, 'account_blocked');
  // the sign-in has ended, and an open page learns why (403 account_suspended before the 401
  // of an ended sign-in); signing in again is refused with the old code
  const after = await h.call('GET', '/api/me/security', { token: c.token });
  assertStatus(after, 403);
  assertEquals(after.body.code, 'account_suspended');
  const refused = await h.otpLogin(c.email);
  assertStatus(refused, 403);
  assertEquals(refused.body.code, 'account_suspended');
  assertEquals((await audits('account.block', c.id)).length, 1);
  assertEquals((await audits('account.block', c.id))[0].actor_id, admin.id);

  // by email, back to active
  r = await h.call('PUT', '/api/admin/users/status', { token: admin.token, body: { email: c.email.toUpperCase(), status: 'active' } });
  assertStatus(r, 200);
  assertEquals(r.body.user.status, 'active');
  assertEquals((await audits('account.unblock', c.id)).length, 1);
  const login = await h.otpLogin(c.email);
  assertStatus(login, 200);

  // activating someone who never confirmed the email: old message
  const u = await h.customer({ verified: false });
  r = await h.call('PUT', '/api/admin/users/status', { token: admin.token, body: { id: u.id, status: 'active' } });
  assertStatus(r, 400);
  assertEquals(r.body.error, 'This customer has not confirmed their email yet.');

  // not on yourself
  r = await h.call('PUT', '/api/admin/users/status', { token: admin.token, body: { id: admin.id, status: 'suspended' } });
  assertStatus(r, 403);
});

test('account block / unblock: every sign-in ends, staff accounts protected, audited', async () => {
  const c = await h.customer();
  const other = await anotherSignIn(c);
  let r = await h.call('POST', `/api/admin/users/${c.id}/block`, { token: admin.token, body: {} });
  assertStatus(r, 400);
  assert(r.body.errors?.reason);

  r = await h.call('POST', `/api/admin/users/${c.id}/block`, { token: admin.token, body: { reason: 'Chargeback fraud' } });
  assertStatus(r, 200);
  assertEquals(r.body.changed, true);
  assertEquals(r.body.user.blocked, true);
  assertEquals(r.body.user.account_status, 'suspended');
  assertEquals(r.body.user.blockedReason, 'Chargeback fraud');
  assertEquals(r.body.user.activeSessionCount, 0);
  // every sign-in has ended; open pages are told the account is suspended (403, not just 401)
  for (const t of [c.token, other.token]) {
    const x = await h.call('GET', '/api/me/security', { token: t });
    assertStatus(x, 403);
    assertEquals(x.body.code, 'account_suspended');
  }
  // the Supabase Auth sessions are gone as well, so no refresh brings a sign-in back
  assertEquals((await h.sql`select 1 from auth.sessions where user_id = ${c.id}`).length, 0);
  const ref = await h.call('POST', '/api/auth/refresh-token', { body: { refreshToken: c.refreshToken } });
  assertStatus(ref, 401);
  const ended = await h.sql<{ revoke_reason: string }[]>`select revoke_reason from app_sessions where user_id = ${c.id}`;
  assertEquals(ended.map((x) => x.revoke_reason), ['account_blocked', 'account_blocked']);
  const blockAudit = await audits('account.block', c.id);
  assertEquals(blockAudit[0].actor_id, admin.id);
  assertEquals(blockAudit[0].detail?.sessionsEnded, 2);
  assertEquals(blockAudit[0].detail?.reason, 'Chargeback fraud');
  const again = await h.call('POST', `/api/admin/users/${c.id}/block`, { token: admin.token, body: { reason: 'Chargeback fraud' } });
  assertStatus(again, 200);
  assertEquals(again.body.changed, false);
  const blockedLogin = await h.otpLogin(c.email);
  assertStatus(blockedLogin, 403);
  assertEquals(blockedLogin.body.code, 'account_suspended');

  r = await h.call('POST', `/api/admin/users/${c.id}/unblock`, { token: admin.token });
  assertStatus(r, 200);
  assertEquals(r.body.changed, true);
  assertEquals(r.body.user.blocked, false);
  assertStatus(await h.otpLogin(c.email), 200);
  assertEquals((await audits('account.block', c.id)).length, 1);
  assertEquals((await audits('account.unblock', c.id)).length, 1);

  // staff accounts: an admin cannot block an owner; nobody blocks themselves
  r = await h.call('POST', `/api/admin/users/${owner.id}/block`, { token: admin.token, body: { reason: 'nope nope' } });
  assertStatus(r, 403);
  assertEquals(r.body.code, 'owner_only');
  r = await h.call('POST', `/api/admin/users/${admin.id}/block`, { token: admin.token, body: { reason: 'nope nope' } });
  assertStatus(r, 403);
  assertEquals(r.body.code, 'self_change');
  r = await h.call('POST', `/api/admin/users/${crypto.randomUUID()}/block`, { token: admin.token, body: { reason: 'nope nope' } });
  assertStatus(r, 404);
  assertEquals((await liveSessions(owner.id)).length, 1);
});

test('end every sign-in of a customer', async () => {
  const c = await h.customer();
  const other = await anotherSignIn(c);
  const r = await h.call('POST', `/api/admin/users/${c.id}/sessions/end-all`, { token: admin.token });
  assertStatus(r, 200);
  assertEquals(r.body.ended, 2);
  assertEquals(r.body.user.activeSessionCount, 0);
  for (const t of [c.token, other.token]) assertStatus(await h.call('GET', '/api/me/security', { token: t }), 401);
  const rows = await h.sql<{ revoke_reason: string }[]>`select revoke_reason from app_sessions where user_id = ${c.id}`;
  assert(rows.every((x) => x.revoke_reason === 'staff'));
  // refresh tokens die too (Supabase Auth sessions deleted)
  const auth = await h.sql`select 1 from auth.sessions where user_id = ${c.id}`;
  assertEquals(auth.length, 0);
  const a = await audits('account.sessions_end', c.id);
  assertEquals(a.length, 1);
  assertEquals(a[0].detail?.sessionsEnded, 2);
});

test('end every sign-in of your own account: the one in use stays', async () => {
  const s = await h.staff('support', ['customers.read', 'customers.write']);
  const other = await anotherSignIn(s);
  const r = await h.call('POST', `/api/admin/users/${s.id}/sessions/end-all`, { token: s.token });
  assertStatus(r, 200);
  assertEquals(r.body.ended, 1);
  assertEquals(r.body.user.activeSessionCount, 1);
  assertStatus(await h.call('GET', '/api/admin/me', { token: s.token }), 200);
  assertStatus(await h.call('GET', '/api/admin/me', { token: other.token }), 401);
  const auth = await h.sql<{ id: string }[]>`select id from auth.sessions where user_id = ${s.id}`;
  assertEquals(auth.map((x) => x.id), [s.sessionId]);
  const a = await audits('account.sessions_end', s.id);
  assertEquals(a.length, 1);
  assertEquals(a[0].detail?.keptCurrent, true);
  // but blocking your own account, or anyone else's staff account without staff.manage, is refused
  let x = await h.call('POST', `/api/admin/users/${s.id}/block`, { token: s.token, body: { reason: 'Locking myself out' } });
  assertStatus(x, 403);
  assertEquals(x.body.code, 'self_change');
  x = await h.call('POST', `/api/admin/users/${support.id}/sessions/end-all`, { token: s.token });
  assertStatus(x, 403);
  assertEquals(x.body.permission, 'staff.manage');
  x = await h.call('PUT', '/api/admin/users/status', { token: s.token, body: { id: support.id, status: 'suspended' } });
  assertStatus(x, 403);
  assertEquals(x.body.permission, 'staff.manage');
  assertEquals((await liveSessions(support.id)).length, 1);
});

test('password-reset: the "Forgot password" link (sendResetLink), never a password; own audit row; failures', async () => {
  const c = await h.customer();
  h.mail.clear();
  let r = await h.call('POST', `/api/admin/users/${c.id}/password-reset`, { token: admin.token });
  assertStatus(r, 200);
  assertEquals(r.body, { ok: true, sent: true, email: c.email });
  const mail = h.mail.last(c.email);
  assert(mail, 'reset email sent');
  assertMatch(mail!.subject, /new password/i);
  assert(!mail!.text.includes(c.password), 'no password in the email');
  const link = h.mail.linkParam(c.email, 'reset');
  assert(link, 'link carries ?reset=');
  const tok = await h.sql<{ n: number }[]>`select count(*)::int as n from auth_tokens where user_id = ${c.id} and purpose = 'reset_password' and expires_at > now()`;
  assertEquals(tok[0].n, 1);
  // the staff member's own audit row, plus the service's security event
  const a = await audits('account.password_reset_link', c.id);
  assertEquals(a.length, 1);
  assertEquals(a[0].actor_id, admin.id);
  assertEquals(a[0].actor_role, 'admin');
  assertEquals(a[0].detail?.email, c.email);
  const ev = await h.sql`select 1 from security_events where user_id = ${c.id} and event_type = 'password_reset_requested'`;
  assertEquals(ev.length, 1);
  const out = await h.sql<{ sensitive: boolean; body_text: string | null; body_html: string | null }[]>`
    select sensitive, body_text, body_html from email_outbox where to_user_id = ${c.id} and template = 'password_reset'`;
  assert(out.length === 1 && out[0].sensitive && out[0].body_text === null && out[0].body_html === null, 'sensitive mail body never stored');

  // the link still sets a password, but customers sign in with an emailed code, never a password
  const reset = await h.call('POST', '/api/auth/reset-password', { body: { token: link, password: 'Brand-New-Pass-42' } });
  assertStatus(reset, 200);
  const pw = await h.login(c.email, 'Brand-New-Pass-42');
  assertStatus(pw, 403);
  assertEquals(pw.body.code, 'otp_required');

  // the email service fails: 502 and a second audit row says so
  h.mail.failNext(1, true);
  r = await h.call('POST', `/api/admin/users/${c.id}/password-reset`, { token: admin.token });
  assertStatus(r, 502);
  assertEquals(r.body.code, 'mail_failed');
  assertEquals((await audits('account.password_reset_link', c.id)).length, 2);
  const failed = await audits('account.password_reset_failed', c.id);
  assertEquals(failed.length, 1);
  assertEquals(failed[0].actor_id, admin.id);
  const rec = await h.sql<{ status: string }[]>`select status from email_outbox where to_user_id = ${c.id} and template = 'password_reset' order by id desc limit 1`;
  assertEquals(rec[0].status, 'failed');

  // email not set up: nothing is made or audited
  h.setEnv({ MAIL_PROVIDER: 'none' });
  try {
    r = await h.call('POST', `/api/admin/users/${c.id}/password-reset`, { token: admin.token });
    assertStatus(r, 503);
    assertEquals(r.body.code, 'mail_unavailable');
  } finally {
    h.resetEnv();
  }
  assertEquals((await audits('account.password_reset_link', c.id)).length, 2);

  // unknown customer; a staff account needs staff.manage (an owner for an owner or admin)
  assertStatus(await h.call('POST', `/api/admin/users/${crypto.randomUUID()}/password-reset`, { token: admin.token }), 404);
  const writer = await h.staff('support', ['customers.read', 'customers.write']);
  r = await h.call('POST', `/api/admin/users/${support.id}/password-reset`, { token: writer.token });
  assertStatus(r, 403);
  assertEquals(r.body.permission, 'staff.manage');
  r = await h.call('POST', `/api/admin/users/${owner.id}/password-reset`, { token: admin.token });
  assertStatus(r, 403);
  assertEquals(r.body.code, 'owner_only');

  await h.sql`update profiles set blocked_at = now(), blocked_reason = 'x' where id = ${c.id}`;
  r = await h.call('POST', `/api/admin/users/${c.id}/password-reset`, { token: admin.token });
  assertStatus(r, 409);
  assertEquals(r.body.code, 'account_blocked');
});

// ── staff ───────────────────────────────────────────────────────────────────────────────

test('GET /api/admin/staff and /staff/roles', async () => {
  let r = await h.call('GET', '/api/admin/staff/roles', { token: admin.token });
  assertStatus(r, 200);
  assertEquals(r.body.roles.map((x: { role: string }) => x.role), ['owner', 'admin', 'support', 'content', 'developer']);
  assertEquals(r.body.permissions.length, 27);
  r = await h.call('GET', '/api/admin/staff', { token: admin.token });
  assertStatus(r, 200);
  const me = r.body.staff.find((s: { userId: string }) => s.userId === support.id);
  assertEquals(me.role, 'support');
  assertEquals(me.active, true);
  assertEquals(me.email, support.email);
  assertEquals(typeof me.createdAt, 'number');
});

test('staff create: a new account gets a generated password by email and can sign in', async () => {
  const email = uniqueEmail('newstaff');
  h.mail.clear();
  const r = await h.call('POST', '/api/admin/staff', { token: owner.token, body: { email, name: 'Ravi Support', role: 'support', note: 'Weekend inbox' } });
  assertStatus(r, 200);
  assertEquals(r.body.created, true);
  assertEquals(r.body.promoted, false);
  assertEquals(r.body.passwordEmailed, true);
  assertEquals(r.body.staff.role, 'support');
  assertEquals(r.body.staff.email, email);
  assertEquals(r.body.staff.note, 'Weekend inbox');
  const mail = h.mail.last(email);
  assert(mail, 'staff welcome sent');
  assertMatch(mail!.subject, /staff account/);
  const pw = /Password: (\S+)/.exec(mail!.text)?.[1];
  assert(pw, 'password in the email');
  assert(!JSON.stringify(r.body).includes(pw!), 'no password in the response');
  const login = await h.login(email, pw!, { staff: true });
  assertStatus(login, 200);
  assertEquals(login.body.staff.role, 'support');
  const st = await h.sql<{ created_by: string; active: boolean }[]>`select created_by, active from staff_members where user_id = ${r.body.staff.userId}`;
  assertEquals(st[0].created_by, owner.id);
  const p = await h.sql<{ status: string; created_via: string; email_verified_at: Date | null }[]>`select status, created_via, email_verified_at from profiles where id = ${r.body.staff.userId}`;
  assertEquals(p[0].status, 'active');
  assertEquals(p[0].created_via, 'staff');
  const a = await audits('staff.create', r.body.staff.userId);
  assertEquals(a.length, 1);
  assertEquals(a[0].actor_id, owner.id);
  const out = await h.sql<{ sensitive: boolean; body_html: string | null }[]>`select sensitive, body_html from email_outbox where template = 'staff_welcome' and to_email = ${email}`;
  assert(out.length === 1 && out[0].sensitive && out[0].body_html === null, 'password email body never stored');
});

test('staff create: promotion of an existing account sends no password', async () => {
  const c = await h.customer();
  h.mail.clear();
  let r = await h.call('POST', '/api/admin/staff', { token: admin.token, body: { email: c.email, role: 'content' } });
  assertStatus(r, 200);
  assertEquals(r.body.created, false);
  assertEquals(r.body.promoted, true);
  assertEquals(r.body.passwordEmailed, false);
  assertEquals(h.mail.to(c.email).length, 0);
  // the same sign-in now works for staff screens
  const me = await h.call('GET', '/api/admin/me', { token: c.token });
  assertStatus(me, 200);
  assertEquals(me.body.staff.role, 'content');
  assertEquals((await audits('staff.create', c.id))[0].detail?.promoted, true);

  r = await h.call('POST', '/api/admin/staff', { token: admin.token, body: { email: c.email, role: 'content' } });
  assertStatus(r, 409);
  assertEquals(r.body.code, 'staff_exists');

  const u = await h.customer({ verified: false });
  r = await h.call('POST', '/api/admin/staff', { token: admin.token, body: { email: u.email, role: 'content' } });
  assertStatus(r, 409);
  assertEquals(r.body.code, 'email_unverified');
});

test('staff create: owner-only roles and permissions, validation', async () => {
  for (const role of ['owner', 'admin']) {
    const r = await h.call('POST', '/api/admin/staff', { token: admin.token, body: { email: uniqueEmail('x'), role } });
    assertStatus(r, 403, role);
    assertEquals(r.body.code, 'owner_only');
  }
  let r = await h.call('POST', '/api/admin/staff', { token: admin.token, body: { email: uniqueEmail('x'), role: 'support', permissions: ['customers.read', 'staff.manage'] } });
  assertStatus(r, 403);
  assertEquals(r.body.code, 'owner_only');
  r = await h.call('POST', '/api/admin/staff', { token: admin.token, body: { email: 'not-an-email', role: 'support' } });
  assertStatus(r, 400);
  assert(r.body.errors.email);
  r = await h.call('POST', '/api/admin/staff', { token: admin.token, body: { email: uniqueEmail('x'), role: 'boss' } });
  assertStatus(r, 400);
  assert(r.body.errors.role);
  r = await h.call('POST', '/api/admin/staff', { token: admin.token, body: { email: uniqueEmail('x'), role: 'support', permissions: ['customers.read', 'root.all'] } });
  assertStatus(r, 400);
  assert(r.body.errors.permissions);

  // an owner may create an admin (with a fresh account)
  r = await h.call('POST', '/api/admin/staff', { token: owner.token, body: { email: uniqueEmail('admin2'), role: 'admin' } });
  assertStatus(r, 200);
  assertEquals(r.body.staff.role, 'admin');
  assert(r.body.staff.permissions.includes('staff.manage'));

  // a staff manager who is not an owner gives only what they hold
  const mgr = await h.staff('support', ['staff.manage', 'customers.read']);
  r = await h.call('POST', '/api/admin/staff', { token: mgr.token, body: { email: uniqueEmail('x'), role: 'content', permissions: ['catalogue.write'] } });
  assertStatus(r, 403);
  assertEquals(r.body.code, 'forbidden');
  r = await h.call('POST', '/api/admin/staff', { token: mgr.token, body: { email: uniqueEmail('x'), role: 'support', permissions: ['customers.read'] } });
  assertStatus(r, 200);
});

test('staff create: email off → 503 before anything is made; failed send → account removed', async () => {
  const email = uniqueEmail('nomail');
  h.setEnv({ MAIL_PROVIDER: 'none' });
  try {
    const r = await h.call('POST', '/api/admin/staff', { token: owner.token, body: { email, role: 'support' } });
    assertStatus(r, 503);
    assertEquals(r.body.code, 'mail_unavailable');
  } finally {
    h.resetEnv();
  }
  assertEquals((await h.sql`select 1 from auth.users where email = ${email}`).length, 0);

  const email2 = uniqueEmail('mailfail');
  h.mail.failNext(1, true);
  const r = await h.call('POST', '/api/admin/staff', { token: owner.token, body: { email: email2, role: 'support' } });
  assertStatus(r, 502);
  assertEquals(r.body.code, 'mail_failed');
  assertEquals((await h.sql`select 1 from auth.users where email = ${email2}`).length, 0);
  assertEquals((await h.sql`select 1 from profiles where email = ${email2}`).length, 0);
  const failed = await h.sql<{ detail: Record<string, unknown> }[]>`select detail from audit_logs where action = 'staff.create_failed' and detail->>'email' = ${email2}`;
  assertEquals(failed.length, 1);
  assertEquals(failed[0].detail.removed, true);
});

test('staff create: failed email and a failed removal → the staff record is switched off, audited removed:false', async () => {
  const email = uniqueEmail('stuck');
  const deletesBefore = h.fake.calls('/auth/v1/admin/users', 'DELETE').length;
  const off = h.fake.route('DELETE', '/auth/v1/admin/users', () =>
    new Response(JSON.stringify({ code: 500, error_code: 'unexpected_failure', msg: 'Database error deleting user' }), {
      status: 500, headers: { 'content-type': 'application/json' },
    }));
  h.mail.failNext(1, true);
  let r;
  try {
    r = await h.call('POST', '/api/admin/staff', { token: owner.token, body: { email, role: 'support' } });
  } finally {
    off();
  }
  assertStatus(r, 502);
  assertEquals(r.body.code, 'mail_failed');
  assert(h.fake.calls('/auth/v1/admin/users', 'DELETE').length > deletesBefore, 'removal was tried');
  const p = await h.sql<{ id: string }[]>`select id from profiles where email = ${email}`;
  assertEquals(p.length, 1, 'the account could not be removed');
  const st = await h.sql<{ active: boolean }[]>`select active from staff_members where user_id = ${p[0].id}`;
  assertEquals(st[0].active, false, 'but it holds no staff access');
  assertEquals((await liveSessions(p[0].id)).length, 0);
  const failed = await audits('staff.create_failed', p[0].id);
  assertEquals(failed.length, 1);
  assertEquals(failed[0].actor_id, owner.id);
  assertEquals(failed[0].detail?.removed, false);
  assertEquals(failed[0].detail?.email, email);
  // the response never carries the password, and no copy of the email body is kept
  const out = await h.sql<{ status: string; body_text: string | null; body_html: string | null }[]>`
    select status, body_text, body_html from email_outbox where template = 'staff_welcome' and to_email = ${email}`;
  assertEquals(out.length, 1);
  assertEquals([out[0].status, out[0].body_text, out[0].body_html], ['failed', null, null]);
});

test('staff change and deactivate: self, owner-only and audit rules', async () => {
  const sup = await h.staff('support');
  const adm2 = await h.staff('admin');
  const own2 = await h.staff('owner');

  // nobody changes their own role or switches themselves off
  let r = await h.call('PUT', `/api/admin/staff/${admin.id}`, { token: admin.token, body: { role: 'support' } });
  assertStatus(r, 403);
  assertEquals(r.body.code, 'self_change');
  r = await h.call('DELETE', `/api/admin/staff/${owner.id}`, { token: owner.token });
  assertStatus(r, 403);
  assertEquals(r.body.code, 'self_change');

  // an admin cannot change an owner or deactivate an admin
  r = await h.call('PUT', `/api/admin/staff/${own2.id}`, { token: admin.token, body: { note: 'hi' } });
  assertStatus(r, 403);
  assertEquals(r.body.code, 'owner_only');
  r = await h.call('DELETE', `/api/admin/staff/${adm2.id}`, { token: admin.token });
  assertStatus(r, 403);
  assertEquals(r.body.code, 'owner_only');
  // nor promote someone to admin, nor hand out staff.manage
  r = await h.call('PUT', `/api/admin/staff/${sup.id}`, { token: admin.token, body: { role: 'admin' } });
  assertStatus(r, 403);
  r = await h.call('PUT', `/api/admin/staff/${sup.id}`, { token: admin.token, body: { permissions: ['customers.read', 'staff.manage'] } });
  assertStatus(r, 403);
  assertEquals(r.body.code, 'owner_only');

  // allowed: an admin moves support to content (template permissions follow the role)
  r = await h.call('PUT', `/api/admin/staff/${sup.id}`, { token: admin.token, body: { role: 'content', note: 'moved to content' } });
  assertStatus(r, 200);
  assertEquals(r.body.staff.role, 'content');
  assert(r.body.staff.permissions.includes('catalogue.write'));
  assert(!r.body.staff.permissions.includes('customers.read'));
  const upd = await audits('staff.update', sup.id);
  assertEquals(upd.length, 1);
  assertEquals((upd[0].detail?.before as { role: string }).role, 'support');
  // the change applies to the live sign-in at once
  assertStatus(await h.call('GET', '/api/admin/users', { token: sup.token }), 403);

  // deactivate: sessions end
  r = await h.call('DELETE', `/api/admin/staff/${sup.id}`, { token: admin.token });
  assertStatus(r, 200);
  assertEquals(r.body.staff.active, false);
  assertEquals(r.body.sessionsEnded, 1);
  assertStatus(await h.call('GET', '/api/admin/me', { token: sup.token }), 401);
  assertEquals((await audits('staff.deactivate', sup.id)).length, 1);

  // an owner may demote another owner and deactivate an admin
  r = await h.call('PUT', `/api/admin/staff/${own2.id}`, { token: owner.token, body: { role: 'admin' } });
  assertStatus(r, 200);
  assertEquals(r.body.staff.role, 'admin');
  r = await h.call('DELETE', `/api/admin/staff/${adm2.id}`, { token: owner.token });
  assertStatus(r, 200);

  // validation and unknown ids
  r = await h.call('PUT', `/api/admin/staff/${own2.id}`, { token: owner.token, body: { active: 'yes' } });
  assertStatus(r, 400);
  r = await h.call('PUT', `/api/admin/staff/${own2.id}`, { token: owner.token, body: {} });
  assertStatus(r, 400);
  r = await h.call('PUT', `/api/admin/staff/${crypto.randomUUID()}`, { token: owner.token, body: { note: 'x' } });
  assertStatus(r, 404);
  r = await h.call('PUT', '/api/admin/staff/abc', { token: owner.token, body: { note: 'x' } });
  assertStatus(r, 404);
});

test('staff: two owners demoting each other at the same moment — one wins, the other is refused', async () => {
  for (let round = 0; round < 3; round++) {
    const a = await h.staff('owner');
    const b = await h.staff('owner');
    const [ra, rb] = await Promise.all([
      h.call('PUT', `/api/admin/staff/${b.id}`, { token: a.token, body: { role: 'admin' } }),
      h.call('PUT', `/api/admin/staff/${a.id}`, { token: b.token, body: { role: 'admin' } }),
    ]);
    assertEquals([ra.status, rb.status].sort((x, y) => x - y), [200, 403], `round ${round}: ${ra.text} | ${rb.text}`);
    const loser = ra.status === 403 ? ra : rb;
    assertEquals(loser.body.code, 'owner_only');
    const rows = await h.sql<{ role: string }[]>`select role from staff_members where user_id in (${a.id}, ${b.id})`;
    assertEquals(rows.map((x) => x.role).sort(), ['admin', 'owner'], 'exactly one of the two is still an owner');
    assertEquals((await audits('staff.update', a.id)).length + (await audits('staff.update', b.id)).length, 1);
  }
  // a demoted owner's next staff change is judged by the role they hold now
  const a = await h.staff('owner');
  const b = await h.staff('owner');
  assertStatus(await h.call('PUT', `/api/admin/staff/${a.id}`, { token: b.token, body: { role: 'admin' } }), 200);
  const r = await h.call('PUT', `/api/admin/staff/${b.id}`, { token: a.token, body: { role: 'support' } });
  assertStatus(r, 403);
  assertEquals(r.body.code, 'owner_only');
  const still = await h.sql<{ c: number }[]>`select count(*)::int as c from staff_members where role = 'owner' and active`;
  assert(still[0].c >= 1, 'an owner remains');
});

test('AUTH-2 two owners blocking each other\'s accounts at the same moment: one wins, the other is refused', async () => {
  const a = await h.staff('owner');
  const b = await h.staff('owner');
  try {
    // hold both profile rows so the two requests are sure to overlap
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let locked!: () => void;
    const isLocked = new Promise<void>((r) => (locked = r));
    const holder = h.sql.begin(async (q) => {
      await q`select id from profiles where id in (${a.id}, ${b.id}) for update`;
      locked();
      await gate;
    });
    await isLocked;
    const pa = h.call('POST', `/api/admin/users/${b.id}/block`, { token: a.token, body: { reason: 'block the other owner' } });
    const pb = h.call('POST', `/api/admin/users/${a.id}/block`, { token: b.token, body: { reason: 'block the other owner' } });
    for (let i = 0; i < 100; i++) {
      const w = await h.sql<{ n: number }[]>`
        select count(*)::int as n from pg_stat_activity
        where datname = current_database() and application_name = 'lww-api-test' and wait_event_type = 'Lock'`;
      if (w[0].n >= 2) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    release();
    await holder;
    const [ra, rb] = await Promise.all([pa, pb]);
    assertEquals([ra.status, rb.status].sort((x, y) => x - y), [200, 403], `${ra.text} | ${rb.text}`);
    const loser = ra.status === 403 ? ra : rb;
    assertEquals(loser.body.code, 'account_suspended');
    const owners = await h.sql<{ id: string; blocked: boolean }[]>`
      select p.id, p.blocked_at is not null as blocked from profiles p where p.id in (${a.id}, ${b.id})`;
    assertEquals(owners.filter((o) => !o.blocked).length, 1, 'exactly one of the two owners is still usable');
    const winner = ra.status === 200 ? a : b;
    const l = await h.login(winner.email, winner.password, { staff: true });
    assertStatus({ status: l.status, text: l.text }, 200);
  } finally {
    await h.sql`update profiles set blocked_at = null, blocked_reason = null, blocked_by = null where id in (${a.id}, ${b.id})`;
  }
});

test('staff re-activation and promotion: staff.manage and former admins need an owner; a blocked account stays off', async () => {
  const mgr = await h.staff('support', ['staff.manage', 'customers.read', 'customers.write']);
  const holder = await h.staff('support', ['customers.read', 'staff.manage']);
  const plain = await h.staff('support', ['customers.read']);
  const exAdmin = await h.staff('admin');
  for (const t of [holder, plain, exAdmin]) assertStatus(await h.call('DELETE', `/api/admin/staff/${t.id}`, { token: owner.token }), 200);

  // switching someone back on counts as handing out everything they hold
  let r = await h.call('PUT', `/api/admin/staff/${holder.id}`, { token: mgr.token, body: { active: true } });
  assertStatus(r, 403);
  assertEquals(r.body.code, 'owner_only');
  // a former admin, through either door
  r = await h.call('PUT', `/api/admin/staff/${exAdmin.id}`, { token: mgr.token, body: { active: true, role: 'support', permissions: ['customers.read'] } });
  assertStatus(r, 403);
  assertEquals(r.body.code, 'owner_only');
  r = await h.call('POST', '/api/admin/staff', { token: mgr.token, body: { email: exAdmin.email, role: 'support', permissions: ['customers.read'] } });
  assertStatus(r, 403);
  assertEquals(r.body.code, 'owner_only');
  // nor yourself, through the add form
  r = await h.call('POST', '/api/admin/staff', { token: mgr.token, body: { email: mgr.email, role: 'support', permissions: ['customers.read'] } });
  assertStatus(r, 403);
  assertEquals(r.body.code, 'self_change');
  assertEquals((await h.sql<{ active: boolean }[]>`select active from staff_members where user_id = ${exAdmin.id}`)[0].active, false);

  // a blocked account cannot be switched back on until it is unblocked
  assertStatus(await h.call('POST', `/api/admin/users/${plain.id}/block`, { token: mgr.token, body: { reason: 'Left the company' } }), 200);
  r = await h.call('PUT', `/api/admin/staff/${plain.id}`, { token: mgr.token, body: { active: true } });
  assertStatus(r, 409);
  assertEquals(r.body.code, 'account_blocked');
  assertStatus(await h.call('POST', `/api/admin/users/${plain.id}/unblock`, { token: mgr.token }), 200);
  r = await h.call('PUT', `/api/admin/staff/${plain.id}`, { token: mgr.token, body: { active: true } });
  assertStatus(r, 200);
  assertEquals(r.body.staff.active, true);
  assertEquals(r.body.staff.permissions, ['customers.read']);
  const a = await audits('staff.update', plain.id);
  assertEquals(a.length, 1);
  assertEquals(a[0].actor_id, mgr.id);
  assertEquals((a[0].detail?.before as { active: boolean }).active, false);
  assertEquals((a[0].detail?.after as { active: boolean }).active, true);

  // what the manager could not do, an owner can
  r = await h.call('PUT', `/api/admin/staff/${holder.id}`, { token: owner.token, body: { active: true } });
  assertStatus(r, 200);
  r = await h.call('POST', '/api/admin/staff', { token: owner.token, body: { email: exAdmin.email, role: 'admin' } });
  assertStatus(r, 200);
  assertEquals([r.body.promoted, r.body.passwordEmailed, r.body.staff.role], [true, false, 'admin']);
  assertEquals(((await audits('staff.create', exAdmin.id))[0].detail?.before as { role: string; active: boolean }), {
    role: 'admin', permissions: (await h.sql<{ permissions: string[] }[]>`select permissions from staff_role_templates where role = 'admin'`)[0].permissions, active: false,
  });
});

test('the last-owner trigger maps to 409 last_owner', async () => {
  let caught: unknown = null;
  try {
    await h.sql.begin(async (q) => {
      // switching every owner off must hit the trigger on the last one
      await q`update staff_members set active = false where role = 'owner'`;
    });
  } catch (e) {
    caught = e;
  }
  assert(caught, 'trigger fired');
  const mapped = staffDbError(caught);
  assert(mapped instanceof HttpError, 'mapped to HttpError');
  assertEquals((mapped as HttpError).status, 409);
  assertEquals((mapped as HttpError).extra.code, 'last_owner');
  const other = new Error('x');
  assertEquals(staffDbError(other), other);
});

// ── contact inbox ───────────────────────────────────────────────────────────────────────

test('GET /api/admin/messages: old Message shape plus status', async () => {
  const id = await message({ name: 'Kavya', body: 'Is there a sheet for the letter Q please?' });
  const r = await h.call('GET', '/api/admin/messages', { token: support.token });
  assertStatus(r, 200);
  const m = r.body.messages.find((x: { id: number }) => x.id === id);
  assert(m, 'message listed');
  assertEquals(m.name, 'Kavya');
  assertEquals(typeof m.at, 'number');
  assertEquals(m.read, null);
  assertEquals(m.replied, null);
  assertEquals(m.mailed, false);
  assertEquals(m.mailError, null);
  assertEquals(m.user, null);
  assertEquals(m.status, 'new');
  assertEquals(typeof r.body.inbox, 'string');
  assertEquals(typeof r.body.mail, 'boolean');
  const filtered = await h.call('GET', '/api/admin/messages?status=archived', { token: support.token });
  assertStatus(filtered, 200);
  assert(!filtered.body.messages.some((x: { id: number }) => x.id === id));
  assertStatus(await h.call('GET', '/api/admin/messages?status=bogus', { token: support.token }), 400);
});

test('messages read / replied / status (old calls kept), audited', async () => {
  const id = await message();
  let r = await h.call('POST', '/api/admin/messages/read', { token: support.token, body: { id } });
  assertStatus(r, 200);
  assertEquals(r.body.ok, true);
  assertEquals(typeof r.body.message.read, 'number');
  assertEquals(r.body.message.status, 'read');
  assertEquals(r.body.message.readBy, support.id);
  r = await h.call('POST', '/api/admin/messages/replied', { token: support.token, body: { id: String(id) } });
  assertStatus(r, 200);
  assertEquals(typeof r.body.message.replied, 'number');
  assertEquals(r.body.message.status, 'replied');
  r = await h.call('POST', '/api/admin/messages/read', { token: support.token, body: { id } });
  assertEquals(r.body.message.status, 'replied', 'read never moves a replied note back');
  r = await h.call('POST', `/api/admin/messages/${id}/status`, { token: support.token, body: { status: 'archived' } });
  assertStatus(r, 200);
  assertEquals(r.body.message.status, 'archived');
  r = await h.call('POST', `/api/admin/messages/${id}/status`, { token: support.token, body: { status: 'new' } });
  assertStatus(r, 200);
  assertEquals(r.body.message.status, 'new');
  assertEquals(r.body.message.read, null);
  r = await h.call('POST', `/api/admin/messages/${id}/status`, { token: support.token, body: { status: 'deleted' } });
  assertStatus(r, 400);

  r = await h.call('POST', '/api/admin/messages/read', { token: support.token, body: { id: 99999999 } });
  assertStatus(r, 404);
  assertEquals(r.body.error, 'No such message.');
  r = await h.call('POST', '/api/admin/messages/read', { token: support.token, body: {} });
  assertStatus(r, 404);
  r = await h.call('POST', '/api/admin/messages/x/status', { token: support.token, body: { status: 'read' } });
  assertStatus(r, 404);

  assertEquals((await audits('message.read', id)).length, 2);
  assertEquals((await audits('message.replied', id)).length, 1);
  assertEquals((await audits('message.status', id)).length, 2);

  // a developer may not change messages
  const dev = await h.staff('developer');
  r = await h.call('POST', '/api/admin/messages/read', { token: dev.token, body: { id } });
  assertStatus(r, 403);
});

test('messages reply: email queued to the sender with reply-to = the inbox, note marked replied', async () => {
  await h.setSetting('contact', { inbox: 'inbox@test.local' });
  const c = await h.customer();
  const sender = c.email;
  const id = await message({ name: 'Nisha', email: sender, body: 'My download stopped half way.\nCan you help?', userId: c.id });
  let r = await h.call('POST', `/api/admin/messages/${id}/reply`, { token: support.token, body: { body: 'x' } });
  assertStatus(r, 400);
  h.mail.clear();
  r = await h.call('POST', `/api/admin/messages/${id}/reply`, { token: support.token, body: { body: 'Sorry about that — please try again now. <b>Thanks</b>' } });
  assertStatus(r, 200);
  assertEquals(r.body.queued, true);
  assertEquals(r.body.message.status, 'replied');
  assertEquals(r.body.message.repliedBy, support.id);
  await h.processOutbox();
  const mail = h.mail.last(sender);
  assert(mail, 'reply delivered');
  assertEquals(mail!.replyTo, 'inbox@test.local');
  assertMatch(mail!.subject, /^Re: your note/);
  assertMatch(mail!.text, /please try again now/);
  assertMatch(mail!.text, /> My download stopped half way\./);
  assert(!mail!.html.includes('<b>Thanks</b>'), 'reply text is escaped in HTML');
  // the note's own "mailed" flag (the inbox copy) is untouched by the reply
  const row = await h.sql<{ mailed: boolean; status: string }[]>`select mailed, status from contact_messages where id = ${id}`;
  assertEquals(row[0].mailed, false);
  assertEquals(row[0].status, 'replied');
  const replied = await audits('message.reply', id);
  assertEquals(replied.length, 1);
  assertEquals(replied[0].detail?.to, sender);
  assertEquals(typeof replied[0].detail?.outboxId, 'number');
  const n = await h.sql`select 1 from notifications where user_id = ${c.id} and kind = 'message.reply'`;
  assertEquals(n.length, 1);

  r = await h.call('POST', '/api/admin/messages/424242/reply', { token: support.token, body: { body: 'Hello there' } });
  assertStatus(r, 404);
});
