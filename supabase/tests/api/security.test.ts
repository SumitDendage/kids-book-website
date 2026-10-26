// Builder D: sharing rules, incidents, warnings, suspension (services/sharing.ts) and the customer
// security endpoints in routes/account.ts (E1, E2, appeals, notifications, sessions, reviews).
import { assert, assertEquals, assertMatch, assertRejects, assertStatus, startHarness, test, type TestUser } from './harness.ts';
import { tx } from '../../functions/api/lib/db.ts';
import { env } from '../../functions/api/lib/env.ts';
import { makeCtx, type Ctx } from '../../functions/api/lib/context.ts';
import { requireUser } from '../../functions/api/lib/auth.ts';
import { HttpError } from '../../functions/api/lib/http.ts';
import { decodeClaims } from '../../functions/api/lib/gotrue.ts';
import {
  confirmIncident, dismissIncident, evaluateRules, liftSuspension, reportViolation, suspendAccess,
} from '../../functions/api/services/sharing.ts';

const h = await startHarness();
await h.uploadPdfFor('az-A');   // free
await h.uploadPdfFor('az-C');   // paid

/** A request context signed in as this user (staff services read ctx.user). */
async function ctxAs(u: TestUser): Promise<Ctx> {
  const req = new Request('http://api.local/functions/v1/api/x', { headers: { authorization: `Bearer ${u.token}`, 'x-forwarded-for': '10.250.0.1' } });
  const ctx = await makeCtx(req, new URL(req.url), '/api/x', env());
  await requireUser(ctx);
  return ctx;
}
const settle = (ctx: Ctx) => Promise.allSettled(ctx.background);

/** Records that the account was used from this device and network `minutesAgo` minutes ago. */
async function seen(userId: string, device: string, net: string, o: { country?: string; minutesAgo?: number; staff?: boolean } = {}) {
  const at = new Date(Date.now() - (o.minutesAgo ?? 1) * 60_000);
  const id = crypto.randomUUID();
  await h.sql`
    insert into app_sessions (id, user_id, remember, created_at, last_seen_at, expires_at, ip, ip_network, country, user_agent, device_label, device_id_hash, is_staff)
    values (${id}, ${userId}, false, ${at}, ${at}, now() + interval '12 hours', ${net.replace('.0/24', '.9')}, ${net},
            ${o.country ?? null}, ${h.userAgent}, 'Chrome on Windows', ${await h.deviceHash(device)}, ${o.staff ?? false})`;
  return id;
}

const paidGrants = new Map<string, number>();
/** A sign-in from this device and network `minutesAgo` minutes ago that OPENED A PAID SHEET (an app_sessions
 *  row plus an allowed access_log row on a paid grant) — what the paid-sheet rules count. */
async function usedPaid(userId: string, device: string, net: string, o: { country?: string; minutesAgo?: number; staff?: boolean } = {}) {
  const sid = await seen(userId, device, net, o);
  let ent = paidGrants.get(userId);
  if (!ent) {
    ent = await h.grant(userId, { productId: 'az-C', days: 30 });
    paidGrants.set(userId, ent);
  }
  const at = new Date(Date.now() - (o.minutesAgo ?? 1) * 60_000);
  await h.sql`
    insert into access_log (at, user_id, product_id, entitlement_id, session_id, action, ok, ip, ip_network, device_id_hash, country)
    values (${at}, ${userId}, 'az-C', ${ent}, ${sid}, 'access', true, ${net.replace('.0/24', '.9')}, ${net},
            ${await h.deviceHash(device)}, ${o.country ?? null})`;
  return sid;
}

/** A second sign-in for the same account (fake Auth session + app_sessions row). */
async function anotherSignIn(userId: string) {
  const t = await h.fake.auth.issueSession(userId, { userAgent: h.userAgent });
  const sid = String(decodeClaims(t.access_token).session_id);
  await h.sql`
    insert into app_sessions (id, user_id, remember, expires_at, ip, ip_network, user_agent, device_label, device_id_hash, is_staff)
    values (${sid}, ${userId}, false, now() + interval '12 hours', '10.99.0.1', '10.99.0.0/24', ${h.userAgent},
            'Firefox on Android', ${await h.deviceHash('other-device-xxxxxxxx')}, false)`;
  return { token: t.access_token as string, sessionId: sid };
}

/** Runs a test with concurrent_devices waiting for staff to confirm (it confirms itself live). */
const withStaffConfirm = (fn: () => Promise<void>) => async () => {
  await h.sql`update security_rules set auto_confirm = false where id = 'concurrent_devices'`;
  try {
    await fn();
  } finally {
    await h.sql`update security_rules set auto_confirm = true where id = 'concurrent_devices'`;
  }
};

const incidents = (userId: string) =>
  h.sql<{ id: number; rule_id: string; status: string; evidence: Record<string, unknown> }[]>`
    select id, rule_id, status, evidence from security_incidents where user_id = ${userId} order by id`;
const warnings = (userId: string) =>
  h.sql<{ id: number; level: number; revoked_at: Date | null; incident_id: number | null }[]>`
    select id, level, revoked_at, incident_id from account_warnings where user_id = ${userId} order by id`;
const outbox = (where: { template?: string; to?: string; dedupe?: string }) =>
  h.sql<{ id: number; to_email: string; subject: string; body_text: string; dedupe_key: string | null; template: string }[]>`
    select id, to_email, subject, body_text, dedupe_key, template from email_outbox
    where (${where.template ?? null}::text is null or template = ${where.template ?? null})
      and (${where.to ?? null}::text is null or to_email = ${where.to ?? null})
      and (${where.dedupe ?? null}::text is null or dedupe_key like ${(where.dedupe ?? '') + '%'})
    order by id`;

async function httpErr(p: Promise<unknown>): Promise<HttpError> {
  const e = await assertRejects(() => p);
  assert(e instanceof HttpError, `expected HttpError, got ${e}`);
  return e as HttpError;
}

let staffUser: TestUser;
let staffCtx: Ctx;
async function staff() {
  if (!staffUser) {
    staffUser = await h.staff('admin');
  }
  staffCtx = await ctxAs(staffUser);
  return staffCtx;
}

let reportNo = 0;
/** Report + confirm by hand. Each call is a different violation (its own reason): the same reason
 *  again within a few minutes is the same report. */
async function confirmedWarning(userId: string, reason = `Shared password reported by a teacher (report ${++reportNo}).`) {
  const ctx = await staff();
  const r = await reportViolation(ctx, userId, { reason, confirm: false });
  const c = await confirmIncident(ctx, r.incidentId, 'checked');
  await settle(ctx);
  return c;
}

// ── rules ───────────────────────────────────────────────────────────────────────────────

test('a new IP alone or a new device alone never opens an incident', async () => {
  const c = await h.customer();
  // same device, another network (a new IP)
  await usedPaid(c.id, h.device, '10.201.1.0/24');
  await usedPaid(c.id, h.device, '10.201.2.0/24');
  assertEquals(await evaluateRules(null, c.id), []);
  // one new device on the home network
  await usedPaid(c.id, 'second-device-aaaaaa', '10.201.1.0/24');
  assertEquals(await evaluateRules(null, c.id), []);
  assertEquals((await incidents(c.id)).length, 0);
});

test('two devices on networks they never shared (a sign-in code passed on) give a warning at once', async () => {
  const c = await h.customer();
  await usedPaid(c.id, 'own-phone-aaaaaaaaa', '10.211.1.0/24');
  await usedPaid(c.id, 'friend-pc-bbbbbbbbb', '10.211.2.0/24');
  const ids = await evaluateRules(null, c.id);
  assertEquals(ids.length, 1);
  const inc = await incidents(c.id);
  assertEquals(inc.map((x) => [x.rule_id, x.status]), [['concurrent_devices', 'confirmed']]);
  assertMatch(String(inc[0].evidence.summary), /2 devices from 2 different networks/);
  const w = await warnings(c.id);
  assertEquals(w.length, 1);
  assertEquals(w[0].level, 1);
  assertEquals((await outbox({ dedupe: `warning:${w[0].id}` })).length, 1, 'the customer is emailed');
  // the same sharing carrying on is the same warning
  await usedPaid(c.id, 'friend-pc-bbbbbbbbb', '10.211.2.0/24');
  await evaluateRules(null, c.id);
  assertEquals((await warnings(c.id)).length, 1);
});

test('two devices that were on the same network are not sharing (a phone that left the home wifi)', async () => {
  const c = await h.customer();
  await usedPaid(c.id, 'home-laptop-aaaaaaa', '10.212.1.0/24');
  await usedPaid(c.id, 'home-phone-bbbbbbbb', '10.212.1.0/24');
  await usedPaid(c.id, 'home-phone-bbbbbbbb', '10.212.2.0/24');
  assertEquals(await evaluateRules(null, c.id), []);
  assertEquals((await incidents(c.id)).length, 0);
});

test('the concurrent_devices pattern opens exactly one incident (repeat evaluations dedupe)', async () => {
  await h.sql`update security_rules set auto_confirm = false where id = 'concurrent_devices'`;
  try {
  const c = await h.customer();
  await usedPaid(c.id, 'dev-one-aaaaaaaaaaa', '10.202.1.0/24');
  await usedPaid(c.id, 'dev-two-bbbbbbbbbbb', '10.202.2.0/24');
  await usedPaid(c.id, 'dev-three-ccccccccc', '10.202.3.0/24');
  const first = await evaluateRules(null, c.id);
  assertEquals(first.length, 1);
  const again = await evaluateRules(null, c.id);
  assertEquals(again, first);
  const racing = await Promise.all([evaluateRules(null, c.id), evaluateRules(null, c.id), evaluateRules(null, c.id)]);
  for (const r of racing) assertEquals(r, first);
  const inc = await incidents(c.id);
  assertEquals(inc.length, 1);
  assertEquals(inc[0].rule_id, 'concurrent_devices');
  assertEquals(inc[0].status, 'open');
  assertEquals(inc[0].evidence.devices, 3);
  assertEquals(inc[0].evidence.networks, 3);
  assertMatch(String(inc[0].evidence.summary), /3 devices from 3 different networks/);
  assertEquals((await warnings(c.id)).length, 0, 'an incident alone is no warning');
  const staffNote = await h.sql`select 1 from notifications where audience = 'staff' and kind = 'security.incident' and (data->>'incidentId')::bigint = ${inc[0].id}`;
  assertEquals(staffNote.length, 1);
  const ev = await h.sql`select 1 from security_events where user_id = ${c.id} and event_type = 'security.incident_opened'`;
  assertEquals(ev.length, 1);  } finally {
    await h.sql`update security_rules set auto_confirm = true where id = 'concurrent_devices'`;
  }
});

test('activity older than the window does not count', async () => {
  const c = await h.customer();
  await usedPaid(c.id, 'old-one-aaaaaaaaaaa', '10.203.1.0/24', { minutesAgo: 120 });
  await usedPaid(c.id, 'old-two-bbbbbbbbbbb', '10.203.2.0/24', { minutesAgo: 90 });
  await usedPaid(c.id, 'old-three-cccccccccc', '10.203.3.0/24', { minutesAgo: 60 });
  assertEquals(await evaluateRules(null, c.id), []);
});

test('SHARING-4 many devices in a day: exactly six do not open an incident ("more than 6"), seven do', async () => {
  const c = await h.customer();
  // the harness's own sign-in is the first device; the rule trips above 6
  for (let i = 1; i <= 5; i++) await seen(c.id, `day-dev-${i}-aaaaaaaa`, '10.209.1.0/24', { minutesAgo: 60 * i });
  assertEquals(await evaluateRules(null, c.id), [], 'six devices are not more than six');
  await seen(c.id, 'day-dev-6-bbbbbbbb', '10.209.1.0/24', { minutesAgo: 20 });
  const ids = await evaluateRules(null, c.id);
  assertEquals(ids.length, 1);
  const inc = await incidents(c.id);
  assertEquals(inc.map((x) => x.rule_id), ['many_devices_day']);
  assertEquals(inc[0].evidence.devices, 7);
  assertEquals(inc[0].evidence.networks, 2);   // one network does not matter for this rule
  assertEquals(inc[0].status, 'open');
});

test('other rules: many countries in a day and very many viewer requests', async () => {
  const c = await h.customer();
  await usedPaid(c.id, h.device, '10.204.1.0/24', { country: 'IN', minutesAgo: 300 });
  await usedPaid(c.id, h.device, '10.204.2.0/24', { country: 'AE', minutesAgo: 200 });
  await usedPaid(c.id, h.device, '10.204.3.0/24', { country: 'GB', minutesAgo: 100 });
  assertEquals(await evaluateRules(null, c.id), [], 'three countries are not more than three');
  // signing in from a fourth country without opening a paid sheet does not count
  await seen(c.id, h.device, '10.204.5.0/24', { country: 'FR', minutesAgo: 60 });
  assertEquals(await evaluateRules(null, c.id), []);
  await usedPaid(c.id, h.device, '10.204.4.0/24', { country: 'US', minutesAgo: 50 });
  const ids = await evaluateRules(null, c.id);
  assertEquals((await incidents(c.id)).map((x) => x.rule_id), ['many_countries_day']);
  assertEquals(ids.length, 1);

  const d = await h.customer();
  const old = (await h.sql`select params from security_rules where id = 'rapid_page_requests'`)[0].params;
  await h.sql`update security_rules set params = ${h.sql.json({ requests: 50, windowMinutes: 60 })} where id = 'rapid_page_requests'`;
  try {
    await h.sql`
      insert into access_log (user_id, product_id, session_id, action, ok, ip, ip_network, device_id_hash)
      select ${d.id}, 'az-C', ${d.sessionId}, 'page', true, '10.205.1.1', '10.205.1.0/24', ${await h.deviceHash()}
      from generate_series(1, 55)`;
    await evaluateRules(null, d.id);
    assertEquals((await incidents(d.id)).map((x) => x.rule_id), ['rapid_page_requests']);
  } finally {
    await h.sql`update security_rules set params = ${h.sql.json(old)} where id = 'rapid_page_requests'`;
  }
});

test('disabled rules are not run; an auto-confirm rule issues the warning at once', async () => {
  const c = await h.customer();
  await usedPaid(c.id, 'auto-one-aaaaaaaaaa', '10.206.1.0/24');
  await usedPaid(c.id, 'auto-two-bbbbbbbbbb', '10.206.2.0/24');
  await usedPaid(c.id, 'auto-three-cccccccc', '10.206.3.0/24');
  await h.sql`update security_rules set enabled = false, auto_confirm = false where id = 'concurrent_devices'`;
  try {
    assertEquals(await evaluateRules(null, c.id), []);
    await h.sql`update security_rules set enabled = true, auto_confirm = true where id = 'concurrent_devices'`;
    const ids = await evaluateRules(null, c.id);
    assertEquals(ids.length, 1);
    const inc = await incidents(c.id);
    assertEquals(inc[0].status, 'confirmed');
    const w = await warnings(c.id);
    assertEquals(w.length, 1);
    assertEquals(w[0].incident_id, inc[0].id);
    assertEquals((await outbox({ dedupe: `warning:${w[0].id}` })).length, 1);
    // evaluating again changes nothing
    await evaluateRules(null, c.id);
    assertEquals((await warnings(c.id)).length, 1);
    const sysAudit = await h.sql`select actor_role from audit_logs where action = 'security.warning_issue' and target_id = ${String(w[0].id)}`;
    assertEquals(sysAudit[0].actor_role, 'system');
  } finally {
    await h.sql`update security_rules set enabled = true, auto_confirm = true where id = 'concurrent_devices'`;
  }
});

test('staff accounts are never evaluated or reported', async () => {
  const s = await h.staff('support');
  await usedPaid(s.id, 'staff-one-aaaaaaaaa', '10.207.1.0/24', { staff: true });
  await usedPaid(s.id, 'staff-two-bbbbbbbbb', '10.207.2.0/24', { staff: true });
  await usedPaid(s.id, 'staff-three-ccccccc', '10.207.3.0/24');
  assertEquals(await evaluateRules(null, s.id), []);
  assertEquals((await incidents(s.id)).length, 0);
  const owner = await h.staff('owner');
  const e = await httpErr(reportViolation(await staff(), owner.id, { reason: 'test report', confirm: true }));
  assertEquals(e.status, 409);
  assertEquals(e.extra.code, 'staff_account');
});

test('SHARING-1 one sign-in whose X-Device-Id changes on every request is one device, not many', async () => {
  const c = await h.customer({ ip: '10.61.1.10' });
  await h.grant(c.id, { productId: 'az-C', days: 30 });
  // what the site's stableId() hands out on every call when the browser blocks site data
  const fresh = (i: number) => `nostorage-${i}-${crypto.randomUUID().slice(0, 8)}`;
  const open = await h.call('POST', '/api/access/az-C', { token: c.token, ip: '10.61.1.10', device: fresh(0) });
  assertStatus(open, 200);
  for (let i = 1; i <= 8; i++) {
    const m = await h.call('GET', '/api/view/meta', { token: c.token, ip: '10.61.1.10', device: fresh(i), headers: { 'x-view-token': open.body.viewToken } });
    assertStatus(m, 200);
  }
  await evaluateRules(null, c.id);
  assertEquals((await h.sql`select 1 from app_sessions where user_id = ${c.id}`).length, 1);
  const inc = await incidents(c.id);
  assertEquals(inc.length, 0, `one sign-in on one network opened: ${inc.map((i) => `${i.rule_id} "${i.evidence.summary}"`).join('; ')}`);
});

test('SHARING-2 a decided incident keeps its evidence; bigger activity after the decision opens a new incident for staff', withStaffConfirm(async () => {
  const c = await h.customer();
  await usedPaid(c.id, 'sh2-dev-a-aaaaaaaaaa', '10.62.1.0/24');
  await usedPaid(c.id, 'sh2-dev-b-bbbbbbbbbb', '10.62.2.0/24');
  await usedPaid(c.id, 'sh2-dev-c-cccccccccc', '10.62.3.0/24');
  const [incId] = await evaluateRules(null, c.id);
  assert(incId, 'the first pattern opens an incident');
  const before = (await incidents(c.id))[0].evidence;
  const ctx = await staff();
  await dismissIncident(ctx, incId, 'Family laptop, phone and tablet');
  const notes = () => h.sql`select id from notifications where audience = 'staff' and kind = 'security.incident' and data->>'userId' = ${c.id}`;
  const notesBefore = (await notes()).length;

  // the same activity carrying on: the decision stands, nothing new for staff
  assertEquals(await evaluateRules(null, c.id), [incId]);
  assertEquals((await incidents(c.id)).length, 1);
  assertEquals((await notes()).length, notesBefore);

  // two MORE devices on two MORE networks
  await usedPaid(c.id, 'sh2-dev-d-dddddddddd', '10.62.4.0/24');
  await usedPaid(c.id, 'sh2-dev-e-eeeeeeeeee', '10.62.5.0/24');
  const ids = await evaluateRules(null, c.id);
  const all = await incidents(c.id);
  const dismissed = all.find((i) => i.id === incId)!;
  assertEquals(dismissed.status, 'dismissed');
  assertEquals([dismissed.evidence.devices, dismissed.evidence.networks], [before.devices, before.networks], 'the dismissed evidence is unchanged');
  const open = all.filter((i) => i.status === 'open');
  assertEquals(open.length, 1);
  assertEquals(open[0].rule_id, 'concurrent_devices');
  assertEquals(open[0].evidence.devices, 5);
  assertEquals(ids, [open[0].id]);
  assertEquals((await notes()).length, notesBefore + 1, 'staff are told about the new activity');
  // a follow-up never confirms itself, even on an auto-confirm rule
  assertEquals((await warnings(c.id)).length, 0);
  // and evaluating again keeps the one open follow-up
  await evaluateRules(null, c.id);
  assertEquals((await incidents(c.id)).filter((i) => i.status === 'open').length, 1);
}));

test('SHARING-3 signing in on several devices and opening only free sheets opens no "paid sheets" incident', async () => {
  const c = await h.customer({ ip: '10.63.1.10' });   // parent's laptop at home
  const phone = await h.login(c.email, c.password, { ip: '10.63.2.20', device: 'sh3-phone-device-0001' });
  assertStatus({ status: phone.status, text: phone.text }, 200);
  const tablet = await h.login(c.email, c.password, { ip: '10.63.3.11', device: 'sh3-tablet-device-001' });
  assertStatus({ status: tablet.status, text: tablet.text }, 200);
  assertStatus(await h.call('POST', '/api/access/az-A', { token: tablet.token, ip: '10.63.3.11', device: 'sh3-tablet-device-001' }), 200);
  assertStatus(await h.call('POST', '/api/access/az-A', { token: phone.token, ip: '10.63.2.20', device: 'sh3-phone-device-0001' }), 200);
  // a refused paid request is not an opened paid sheet either
  assertStatus(await h.call('POST', '/api/access/az-C', { token: phone.token, ip: '10.63.2.20', device: 'sh3-phone-device-0001' }), 402);
  await evaluateRules(null, c.id);
  const inc = await incidents(c.id);
  assertEquals(inc.length, 0, `no paid sheet was opened, yet: ${inc.map((i) => `${i.rule_id} "${i.evidence.summary}"`).join('; ')}`);
});

// ── warnings ────────────────────────────────────────────────────────────────────────────

test('confirming an incident issues one warning, emails the customer and alerts staff; a second confirm does not', withStaffConfirm(async () => {
  const c = await h.customer();
  await usedPaid(c.id, 'conf-one-aaaaaaaaaa', '10.208.1.0/24');
  await usedPaid(c.id, 'conf-two-bbbbbbbbbb', '10.208.2.0/24');
  await usedPaid(c.id, 'conf-three-cccccccc', '10.208.3.0/24');
  const [incId] = await evaluateRules(null, c.id);
  const ctx = await staff();
  const r = await confirmIncident(ctx, incId, 'looked at the evidence');
  await settle(ctx);
  assertEquals(r.incidentId, incId);
  assert(r.warning, 'a warning was issued');
  assertEquals(r.warning!.level, 1);
  assertEquals(r.warning!.active, 1);
  assertEquals(r.warning!.max, 3);
  assertEquals(r.warning!.suspended, false);

  const again = await httpErr(confirmIncident(ctx, incId));
  assertEquals(again.status, 409);
  assertEquals(again.extra.code, 'already_confirmed');
  assertEquals((await warnings(c.id)).length, 1);

  const mine = await outbox({ template: 'security_warning', to: c.email });
  assertEquals(mine.length, 1);
  assertEquals(mine[0].dedupe_key, `warning:${r.warning!.warningId}`);
  assertMatch(mine[0].subject, /security warning 1 of 3/);
  assertMatch(mine[0].body_text, /Please do not share your password/);
  const staffMail = await outbox({ template: 'staff_alert', dedupe: `warning-staff:${r.warning!.warningId}` });
  assertEquals(staffMail.length, 1);
  assertEquals(staffMail[0].to_email, 'learnwithwhy6@gmail.com');
  const notes = await h.sql`select audience from notifications where kind = 'security.warning' and (user_id = ${c.id} or (data->>'userId') = ${c.id}) order by audience`;
  assertEquals(notes.map((n) => n.audience), ['customer', 'staff']);
  const aud = await h.sql`select action, actor_id from audit_logs where target_id in (${String(incId)}, ${String(r.warning!.warningId)}) order by id`;
  assert(aud.some((a) => a.action === 'security.incident_confirm' && a.actor_id === staffUser.id), 'confirm audited with the staff actor');
  assert(aud.some((a) => a.action === 'security.warning_issue' && a.actor_id === staffUser.id), 'warning audited');

  // emails really go out
  await h.processOutbox();
  assert(h.mail.sent.some((m) => m.to === c.email && /security warning 1 of 3/.test(m.subject)), 'customer email sent');
}));

test('SHARING-5 a warning to a customer whose access staff already paused says so, not "third warning"', async () => {
  const c = await h.customer();
  const ctx = await staff();
  assertEquals(await tx((q) => suspendAccess(q, ctx, c.id, { reason: 'staff', by: staffUser.id, note: 'Chargeback under review' })), true);
  const r = await reportViolation(ctx, c.id, { reason: 'A teacher reported a shared password (SHARING-5).', confirm: true });
  await settle(ctx);
  assertEquals(r.warning!.level, 1);
  const mail = await outbox({ dedupe: `warning:${r.warning!.warningId}` });
  assertEquals(mail.length, 1);
  assertMatch(mail[0].subject, /security warning 1 of 3/);
  assert(!/third warning|warning 3 of 3|now paused/i.test(mail[0].body_text), mail[0].body_text);
  assertMatch(mail[0].body_text, /already paused/);
  const html = (await h.sql`select body_html from email_outbox where id = ${mail[0].id}`)[0].body_html as string;
  assert(!/third warning|now paused/i.test(html), html);
});

test('SHARING-6 one report sent twice at once gives one incident and one warning', async () => {
  const c = await h.customer();
  await staff();
  const body = { reason: 'Teacher saw the login shared in the class WhatsApp group.', confirm: true };
  const send = () => h.call('POST', `/api/admin/security/customers/${c.id}/report`, { token: staffUser.token, body });
  const [a, b] = await Promise.all([send(), send()]);
  assertStatus(a, 200);
  assertStatus(b, 200);
  assertEquals(a.body.incidentId, b.body.incidentId);
  assertEquals([a.body.repeat, b.body.repeat].sort(), [false, true]);
  assertEquals(a.body.warning?.warningId, b.body.warning?.warningId);
  const w = await warnings(c.id);
  assertEquals(w.length, 1);
  assertEquals(w[0].level, 1);
  assertEquals((await incidents(c.id)).length, 1);
  // sent again a moment later (a retry): still the same report
  const again = await send();
  assertStatus(again, 200);
  assertEquals(again.body.repeat, true);
  assertEquals((await warnings(c.id)).length, 1);
  // an unconfirmed report confirmed by a second send gives its one warning then
  const d = await h.customer();
  const first = await h.call('POST', `/api/admin/security/customers/${d.id}/report`, { token: staffUser.token, body: { reason: 'Seen sharing (SHARING-6).', confirm: false } });
  assertStatus(first, 200);
  assertEquals(first.body.warning, null);
  const confirm = await h.call('POST', `/api/admin/security/customers/${d.id}/report`, { token: staffUser.token, body: { reason: 'Seen sharing (SHARING-6).', confirm: true } });
  assertStatus(confirm, 200);
  assertEquals(confirm.body.incidentId, first.body.incidentId);
  assertEquals(confirm.body.warning.level, 1);
  assertEquals((await warnings(d.id)).length, 1);
  // a different violation is a new report
  const other = await h.call('POST', `/api/admin/security/customers/${c.id}/report`, { token: staffUser.token, body: { reason: 'A second, different report.', confirm: true } });
  assertStatus(other, 200);
  assertEquals(other.body.repeat, false);
  assertEquals((await warnings(c.id)).length, 2);
});

test('three confirmed incidents suspend paid access; free sheets and the security pages keep working', async () => {
  const c = await h.customer();
  await h.grant(c.id, { productId: 'az-C', days: 30 });
  const w1 = await confirmedWarning(c.id, 'First report.');
  const w2 = await confirmedWarning(c.id, 'Second report.');
  assertEquals([w1.warning!.level, w2.warning!.level], [1, 2]);
  assertEquals(w2.warning!.suspended, false);
  const w3 = await confirmedWarning(c.id, 'Third report.');
  assertEquals(w3.warning!.level, 3);
  assertEquals(w3.warning!.suspended, true);

  const p = (await h.sql`select subscription_suspended_at, suspension_reason from profiles where id = ${c.id}`)[0];
  assert(p.subscription_suspended_at, 'suspended');
  assertEquals(p.suspension_reason, 'warnings');
  const third = await outbox({ dedupe: `warning:${w3.warning!.warningId}` });
  assertEquals(third.length, 1);
  assertMatch(third[0].body_text, /paused/);
  assertEquals((await outbox({ template: 'staff_alert', dedupe: `warning-staff:${w3.warning!.warningId}` })).length, 1);
  // the warnings path does not send a second "paused" email
  assertEquals((await outbox({ template: 'access_suspended', to: c.email })).length, 0);
  const sn = await h.sql`select 1 from notifications where audience = 'staff' and kind = 'access.suspended' and data->>'userId' = ${c.id}`;
  assertEquals(sn.length, 1);

  const paid = await h.call('POST', '/api/access/az-C', { token: c.token });
  assertStatus(paid, 403);
  assertEquals(paid.body.code, 'access_suspended');
  assertStatus(await h.call('POST', '/api/access/az-A', { token: c.token }), 200);

  const s = await h.call('GET', '/api/me/security', { token: c.token });
  assertStatus(s, 200);
  assertEquals(s.body.warningCount, 3);
  assertEquals(s.body.accessStatus, 'suspended');
  assertEquals(s.body.suspensionReason, 'warnings');
  assertStatus(await h.call('GET', '/api/me/notifications', { token: c.token }), 200);
  assertStatus(await h.call('GET', '/api/me/sessions', { token: c.token }), 200);
  const ap = await h.call('POST', '/api/me/appeals', { token: c.token, body: { kind: 'suspension', message: 'Nobody else uses my account, please check.' } });
  assertStatus(ap, 200);
});

test('liftSuspension with resetWarnings restores access and clears the warnings', async () => {
  const c = await h.customer();
  await h.grant(c.id, { productId: 'az-C', days: 30 });
  for (let i = 0; i < 3; i++) await confirmedWarning(c.id, `Report ${i + 1}.`);
  assertStatus(await h.call('POST', '/api/access/az-C', { token: c.token }), 403);

  const ctx = await staff();
  const lifted = await tx((q) => liftSuspension(q, ctx, c.id, { resetWarnings: true, note: 'talked to the parent' }));
  assertEquals(lifted, true);
  await settle(ctx);
  const w = await warnings(c.id);
  assertEquals(w.length, 3);
  assert(w.every((x) => x.revoked_at), 'warnings revoked');
  const s = await h.call('GET', '/api/me/security', { token: c.token });
  assertEquals(s.body.warningCount, 0);
  assertEquals(s.body.accessStatus, 'active');
  assertStatus(await h.call('POST', '/api/access/az-C', { token: c.token }), 200);
  assertEquals((await outbox({ template: 'access_restored', to: c.email })).length, 1);
  const aud = await h.sql`select action from audit_logs where target_id = ${c.id} and actor_id = ${staffUser.id} order by id`;
  assertEquals(aud.map((a) => a.action).filter((a) => a === 'security.warnings_reset' || a === 'access.restore'), ['security.warnings_reset', 'access.restore']);
  // lifting again changes nothing
  assertEquals(await tx((q) => liftSuspension(q, ctx, c.id, { resetWarnings: false })), false);
  // a new warning starts again at level 1
  const next = await confirmedWarning(c.id, 'New report.');
  assertEquals(next.warning!.level, 1);
});

test('staff suspension and lifting without a reset keep the warnings', async () => {
  const c = await h.customer();
  await confirmedWarning(c.id);
  const ctx = await staff();
  assertEquals(await tx((q) => suspendAccess(q, ctx, c.id, { reason: 'staff', by: staffUser.id, note: 'chargeback' })), true);
  assertEquals(await tx((q) => suspendAccess(q, ctx, c.id, { reason: 'staff', by: staffUser.id })), false);
  const s = await h.call('GET', '/api/me/security', { token: c.token });
  assertEquals(s.body.accessStatus, 'suspended');
  assertEquals(s.body.suspensionReason, 'staff');
  assertEquals((await outbox({ template: 'access_suspended', to: c.email })).length, 1);
  assertEquals(await tx((q) => liftSuspension(q, ctx, c.id, { resetWarnings: false })), true);
  const after = await h.call('GET', '/api/me/security', { token: c.token });
  assertEquals(after.body.accessStatus, 'active');
  assertEquals(after.body.warningCount, 1);
});

test('dismissing an incident; decisions are final; unknown ids are 404; customers cannot decide', async () => {
  const c = await h.customer();
  const ctx = await staff();
  const r = await reportViolation(ctx, c.id, { reason: 'Odd sign-ins, probably travel.', evidence: { note: 'airport wifi' }, confirm: false });
  assertEquals(r.warning, null);
  assertEquals(await dismissIncident(ctx, r.incidentId, 'travel'), { incidentId: r.incidentId });
  assertEquals((await httpErr(confirmIncident(ctx, r.incidentId))).extra.code, 'already_dismissed');
  assertEquals((await httpErr(dismissIncident(ctx, r.incidentId))).status, 409);
  assertEquals((await httpErr(confirmIncident(ctx, 99_999_999))).status, 404);
  assertEquals((await warnings(c.id)).length, 0);
  const inc = await incidents(c.id);
  assertEquals(inc[0].status, 'dismissed');
  assertEquals((inc[0].evidence.detail as Record<string, unknown>).note, 'airport wifi');
  const cust = await ctxAs(c);
  assertEquals((await httpErr(confirmIncident(cust, r.incidentId))).status, 403);
  assertEquals((await httpErr(reportViolation(ctx, c.id, { reason: 'x', confirm: false }))).status, 400);
  assertEquals((await httpErr(reportViolation(ctx, crypto.randomUUID(), { reason: 'nobody', confirm: false }))).status, 404);
});

test('expired and revoked warnings stop counting; levels follow the active count', async () => {
  const c = await h.customer();
  const a = await confirmedWarning(c.id);
  const b = await confirmedWarning(c.id);
  assertEquals(b.warning!.level, 2);
  await h.sql`update account_warnings set expires_at = now() - interval '1 minute' where id = ${a.warning!.warningId}`;
  const s = await h.call('GET', '/api/me/security', { token: c.token });
  assertEquals(s.body.warningCount, 1);
  assertEquals(s.body.warnings.map((w: { id: number }) => w.id), [b.warning!.warningId]);
  const n = await confirmedWarning(c.id);
  assertEquals(n.warning!.level, 2);
});

// ── E1 / E2 ─────────────────────────────────────────────────────────────────────────────

test('E1: GET /api/me/security for a new customer', async () => {
  const c = await h.customer();
  const r = await h.call('GET', '/api/me/security', { token: c.token });
  assertStatus(r, 200);
  assertEquals(r.body, {
    warningCount: 0, maxWarnings: 3, accessStatus: 'active', acknowledgedWarningCount: 0, updatedAt: null,
    suspendedAt: null, suspensionReason: null, warnings: [], openAppeal: null,
  });
  assertStatus(await h.call('GET', '/api/me/security'), 401);
});

test('E2: acknowledging warnings never lowers a count', async () => {
  const c = await h.customer();
  await confirmedWarning(c.id);
  await confirmedWarning(c.id);
  const ack = (body: unknown) => h.call('POST', '/api/me/security/acknowledge', { token: c.token, body });
  let r = await ack({ warning: 1 });
  assertStatus(r, 200);
  assertEquals([r.body.warningCount, r.body.acknowledgedWarningCount], [2, 1]);
  r = await ack({ warning: 2 });
  assertEquals([r.body.warningCount, r.body.acknowledgedWarningCount], [2, 2]);
  assert(typeof r.body.updatedAt === 'number');
  r = await ack({ warning: 1 });
  assertEquals([r.body.warningCount, r.body.acknowledgedWarningCount], [2, 2]);
  r = await ack({ warning: 0 });
  assertEquals([r.body.warningCount, r.body.acknowledgedWarningCount], [2, 2]);
  r = await ack({ warning: 9 });
  assertEquals([r.body.warningCount, r.body.acknowledgedWarningCount], [2, 2]);
  assertStatus(await ack({}), 400);
  const bad = await ack({ warning: 'two' });
  assertStatus(bad, 400);
  assert(bad.body.errors.warning, 'field error');
  // a new warning is unacknowledged until seen
  await confirmedWarning(c.id);
  const s = await h.call('GET', '/api/me/security', { token: c.token });
  assertEquals([s.body.warningCount, s.body.acknowledgedWarningCount], [3, 2]);
});

// ── appeals ─────────────────────────────────────────────────────────────────────────────

test('appeals: validated, one open at a time, staff told by notification and email', async () => {
  const c = await h.customer();
  const other = await h.customer();
  const ow = await confirmedWarning(other.id);
  const w = await confirmedWarning(c.id);
  const post = (body: unknown) => h.call('POST', '/api/me/appeals', { token: c.token, body });
  assertStatus(await post({ kind: 'warning', message: 'short' }), 400);
  assertStatus(await post({ kind: 'nonsense', message: 'This is long enough to send.' }), 400);
  const foreign = await post({ kind: 'warning', message: 'This is long enough to send.', warningId: ow.warning!.warningId });
  assertStatus(foreign, 400);
  assert(foreign.body.errors.warningId);

  const ok = await post({ kind: 'warning', message: 'My husband and I share one laptop.', warningId: w.warning!.warningId });
  assertStatus(ok, 200);
  assertEquals(ok.body.appeal.status, 'open');
  assertEquals(ok.body.appeal.warningId, w.warning!.warningId);
  const dup = await post({ kind: 'suspension', message: 'A second note while the first waits.' });
  assertStatus(dup, 409);
  assertEquals(dup.body.code, 'appeal_open');

  const list = await h.call('GET', '/api/me/appeals', { token: c.token });
  assertStatus(list, 200);
  assertEquals(list.body.appeals.length, 1);
  const s = await h.call('GET', '/api/me/security', { token: c.token });
  assertEquals(s.body.openAppeal.id, ok.body.appeal.id);
  const note = await h.sql`select 1 from notifications where audience = 'staff' and kind = 'appeal.new' and (data->>'appealId')::bigint = ${ok.body.appeal.id}`;
  assertEquals(note.length, 1);
  const mail = await outbox({ template: 'staff_alert', dedupe: `appeal-staff:${ok.body.appeal.id}` });
  assertEquals(mail.length, 1);
  assertMatch(mail[0].body_text, /share one laptop/);

  // once staff answer it, a new note can be sent
  await h.sql`update account_appeals set status = 'rejected', decided_at = now() where id = ${ok.body.appeal.id}`;
  assertStatus(await post({ kind: 'suspension', message: 'One more note after the answer.' }), 200);
  assertEquals((await h.call('GET', '/api/me/appeals', { token: other.token })).body.appeals.length, 0);
});

// ── notifications ───────────────────────────────────────────────────────────────────────

test('notifications: own only, mark some or all as read', async () => {
  const c = await h.customer();
  const other = await h.customer();
  await confirmedWarning(c.id);
  await confirmedWarning(c.id);
  await confirmedWarning(other.id);
  const r = await h.call('GET', '/api/me/notifications', { token: c.token });
  assertStatus(r, 200);
  assertEquals(r.body.unread, 2);
  assertEquals(r.body.notifications.length, 2);
  assertEquals(r.body.notifications[0].kind, 'security.warning');
  const theirs = (await h.call('GET', '/api/me/notifications', { token: other.token })).body.notifications[0].id;

  const one = await h.call('POST', '/api/me/notifications/read', { token: c.token, body: { ids: [r.body.notifications[0].id, theirs] } });
  assertStatus(one, 200);
  assertEquals(one.body.updated, 1);
  assertEquals((await h.call('GET', '/api/me/notifications?unread=1', { token: c.token })).body.notifications.length, 1);
  assertEquals((await h.call('GET', '/api/me/notifications', { token: other.token })).body.unread, 1);
  const all = await h.call('POST', '/api/me/notifications/read', { token: c.token, body: { all: true } });
  assertEquals(all.body.updated, 1);
  assertEquals((await h.call('GET', '/api/me/notifications', { token: c.token })).body.unread, 0);
  assertStatus(await h.call('POST', '/api/me/notifications/read', { token: c.token, body: { ids: ['x'] } }), 400);
  assertStatus(await h.call('POST', '/api/me/notifications/read', { token: c.token, body: {} }), 400);
});

// ── own sessions ────────────────────────────────────────────────────────────────────────

test('sessions: list own sign-ins and end another one (its tokens stop working)', async () => {
  const c = await h.customer();
  const other = await h.customer();
  const second = await anotherSignIn(c.id);
  const list = await h.call('GET', '/api/me/sessions', { token: c.token });
  assertStatus(list, 200);
  assertEquals(list.body.sessions.length, 2);
  const cur = list.body.sessions.find((s: { current: boolean }) => s.current);
  assertEquals(cur.id, c.sessionId);
  const sec = list.body.sessions.find((s: { id: string }) => s.id === second.sessionId);
  assertEquals(sec.current, false);
  assertEquals(sec.device, 'Firefox on Android');
  assertEquals(sec.ip, '10.99.0.x');
  assertEquals(sec.blocked, false);

  const self = await h.call('POST', `/api/me/sessions/${c.sessionId}/end`, { token: c.token });
  assertStatus(self, 400);
  assertEquals(self.body.code, 'current_session');
  assertStatus(await h.call('POST', `/api/me/sessions/${other.sessionId}/end`, { token: c.token }), 404);
  assertStatus(await h.call('POST', '/api/me/sessions/not-a-uuid/end', { token: c.token }), 404);

  assertStatus(await h.call('GET', '/api/me/security', { token: second.token }), 200);
  const end = await h.call('POST', `/api/me/sessions/${second.sessionId}/end`, { token: c.token });
  assertStatus(end, 200);
  assertEquals(end.body, { ok: true, sessionId: second.sessionId });
  assertStatus(await h.call('GET', '/api/me/security', { token: second.token }), 401);
  assertEquals((await h.sql`select 1 from auth.sessions where id = ${second.sessionId}`).length, 0);
  assertEquals((await h.sql`select 1 from auth.sessions where id = ${c.sessionId}`).length, 1);
  assertEquals((await h.call('GET', '/api/me/sessions', { token: c.token })).body.sessions.length, 1);
  // the other customer's sign-in was untouched
  assertStatus(await h.call('GET', '/api/me/security', { token: other.token }), 200);
  assertStatus(await h.call('POST', `/api/me/sessions/${second.sessionId}/end`, { token: c.token }), 404);
});

// ── reviews ─────────────────────────────────────────────────────────────────────────────

test('reviews need past or present access; one per sheet, edits go back to pending', async () => {
  const c = await h.customer();
  const post = (body: unknown) => h.call('POST', '/api/me/reviews', { token: c.token, body });
  const no = await post({ worksheet: 'az-C', rating: 5 });
  assertStatus(no, 403);
  assertEquals(no.body.code, 'not_eligible');
  assertStatus(await post({ worksheet: 'az-C', rating: 6 }), 400);
  assertStatus(await post({ worksheet: 'bad id', rating: 4 }), 400);
  assertStatus(await post({ worksheet: 'no-such-sheet', rating: 4 }), 404);

  assertStatus(await h.call('POST', '/api/access/az-A', { token: c.token }), 200);
  const ok = await post({ worksheet: 'az-A', rating: 5, title: 'Lovely', body: 'My son traced it twice.' });
  assertStatus(ok, 200);
  assertEquals(ok.body.review.status, 'pending');
  await h.sql`update reviews set status = 'published' where id = ${ok.body.review.id}`;
  const edit = await post({ worksheet: 'az-A', rating: 4 });
  assertStatus(edit, 200);
  assertEquals(edit.body.review.id, ok.body.review.id);
  assertEquals(edit.body.review.status, 'pending');
  assertEquals(edit.body.review.rating, 4);

  // expired access still counts as "past"
  const ent = await h.grant(c.id, { productId: 'az-C', days: 10 });
  await h.sql`update entitlements set starts_at = now() - interval '20 days', expires_at = now() - interval '1 day' where id = ${ent}`;
  assertStatus(await post({ worksheet: 'az-C', rating: 3 }), 200);
  const n = await h.sql`select count(*)::int as n from reviews where user_id = ${c.id}`;
  assertEquals(n[0].n, 2);
});

test('reviews: a free sheet can be rated without opening it first; GET /api/me/reviews lists my own', async () => {
  const c = await h.customer();
  const other = await h.customer();
  const free = await h.call('POST', '/api/me/reviews', { token: c.token, body: { worksheet: 'az-B', rating: 4, body: 'Nice and clear.' } });
  assertStatus(free, 200);
  assertEquals(free.body.review.status, 'pending');
  await h.call('POST', '/api/me/reviews', { token: other.token, body: { worksheet: 'az-B', rating: 1 } });
  const mine = await h.call('GET', '/api/me/reviews', { token: c.token });
  assertStatus(mine, 200);
  assertEquals(mine.body.reviews.map((r: { worksheet: string; rating: number; body: string; status: string }) => [r.worksheet, r.rating, r.body, r.status]), [['az-B', 4, 'Nice and clear.', 'pending']]);
  assertStatus(await h.call('GET', '/api/me/reviews'), 401);
});
