// OWNER: agent F. Staff security screens: the account-security zip's E3–E8 (customers, their
// sign-ins, blocking ONE sign-in, pausing paid access), incidents, warnings, appeals, the sharing
// rules, and the old log pages. Times are epoch ms. Session ids are the opaque app_sessions ids
// (the Supabase Auth session id, never a token).
//
// Three separate controls, kept apart on purpose (DESIGN.md §2):
//  * session block (E5/E6): one app_sessions row; that sign-in gets 403 session_blocked;
//  * paid-access suspension (E7/E8): profiles.subscription_suspended_at; sessions are untouched;
//  * whole-account block: /api/admin/users/:id/block in admin_people.ts.
// Staff accounts are not handled here (the sharing rules never look at them).
import type { Router } from '../lib/router.ts';
import type { Ctx } from '../lib/context.ts';
import { tx, type Tx } from '../lib/db.ts';
import { deviceLabel, HttpError, intParam, readJson } from '../lib/http.ts';
import { requireStaff } from '../lib/auth.ts';
import { audit, notify, securityEvent } from '../lib/guard.ts';
import { getSettings } from '../lib/settings.ts';
import { enqueue, kickOutbox } from '../lib/mail.ts';
import { cleanText } from '../lib/util.ts';
import { appealDecision } from '../services/emails.ts';
import {
  confirmIncident, dismissIncident, liftSuspension, reportViolation, securityStatus, suspendAccess,
} from '../services/sharing.ts';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const NOT_FOUND = 'Not found';

const ms = (d: Date | string | null | undefined) => (d == null ? null : new Date(d).getTime());
const clamp = (v: unknown, def: number, min: number, max: number) => {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.floor(v) : def;
  return Math.max(min, Math.min(max, n));
};
const bad = (field: string, msg: string): never => {
  throw new HttpError(400, msg, { errors: { [field]: msg } });
};
const likePattern = (s: string) => `%${s.replace(/[\\%_]/g, (c) => '\\' + c)}%`;

function uuidParam(ctx: Ctx, name = 'id'): string {
  const v = String(ctx.params[name] ?? '').toLowerCase();
  if (!UUID_RE.test(v)) throw new HttpError(404, NOT_FOUND);
  return v;
}

function numParam(ctx: Ctx, name = 'id'): number {
  const v = String(ctx.params[name] ?? '');
  const n = /^\d{1,15}$/.test(v) ? Number(v) : NaN;
  if (!Number.isSafeInteger(n) || n <= 0) throw new HttpError(404, NOT_FOUND);
  return n;
}

/** Optional short note from a body field; 400 when too long. */
function noteOf(v: unknown, field: string, max: number): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v !== 'string') bad(field, `${field[0].toUpperCase()}${field.slice(1)} must be text.`);
  const n = cleanText(v, max + 1);
  if (n.length > max) bad(field, `Keep the ${field} under ${max} characters.`);
  return n || null;
}

function boolOf(v: unknown, field: string): boolean {
  if (v === undefined || v === null) return false;
  if (typeof v !== 'boolean') bad(field, `${field} is true or false.`);
  return v as boolean;
}

const STAFF_ACCOUNT = () => new HttpError(409, 'This is a staff account — staff are managed under Staff, not here.', { code: 'staff_account' });

/** The customer must exist and must not be active staff. */
async function lockCustomer(q: Tx, userId: string, lock = false) {
  const r = lock
    ? await q<{ id: string; staff: boolean }[]>`
        select p.id, exists (select 1 from staff_members st where st.user_id = p.id and st.active) as staff
        from profiles p where p.id = ${userId} for update of p`
    : await q<{ id: string; staff: boolean }[]>`
        select p.id, exists (select 1 from staff_members st where st.user_id = p.id and st.active) as staff
        from profiles p where p.id = ${userId}`;
  if (!r[0]) throw new HttpError(404, NOT_FOUND);
  if (r[0].staff) throw STAFF_ACCOUNT();
}

// ── E3: customers ───────────────────────────────────────────────────────────────────────

type CustomerRow = {
  id: string; name: string; email: string; status: string; blocked_at: Date | null; subscription_suspended_at: Date | null;
  suspension_reason: string | null; last_login_at: Date | null; created_at: Date; warning_count: number; active_sessions: number;
  blocked_sessions: number; open_incidents: number; open_appeal: boolean;
};

async function findCustomers(q: Tx, f: { id?: string | null; like?: string | null; exact?: string | null; access?: string | null; limit: number; offset: number }) {
  const id = f.id ?? null, like = f.like ?? null, exact = f.exact ?? null, access = f.access ?? null;
  return await q<CustomerRow[]>`
    select p.id, p.name, p.email, p.status, p.blocked_at, p.subscription_suspended_at, p.suspension_reason, p.last_login_at, p.created_at,
      private.active_warning_count(p.id) as warning_count,
      (select count(*)::int from app_sessions s where s.user_id = p.id and s.revoked_at is null
         and s.blocked_at is null and s.expires_at > now()) as active_sessions,
      (select count(*)::int from app_sessions s where s.user_id = p.id and s.revoked_at is null
         and s.blocked_at is not null and s.expires_at > now()) as blocked_sessions,
      (select count(*)::int from security_incidents i where i.user_id = p.id and i.status = 'open') as open_incidents,
      exists (select 1 from account_appeals a where a.user_id = p.id and a.status = 'open') as open_appeal
    from profiles p
    where not exists (select 1 from staff_members st where st.user_id = p.id and st.active)
      and (${id}::uuid is null or p.id = ${id}::uuid)
      and (${like}::text is null or p.email::text ilike ${like}::text or p.name ilike ${like}::text or p.id::text = ${exact}::text)
      and (${access}::text is null
           or (${access}::text = 'suspended' and p.subscription_suspended_at is not null)
           or (${access}::text = 'active' and p.subscription_suspended_at is null)
           or (${access}::text = 'warned' and private.active_warning_count(p.id) > 0))
    order by p.last_login_at desc nulls last, p.created_at desc, p.id
    limit ${f.limit} offset ${f.offset}`;
}

/** E3 shape: { id, name, email, accessStatus, warningCount, maxWarnings, lastLoginAt, activeSessionCount } + extras. */
function customerView(r: CustomerRow, maxWarnings: number) {
  return {
    id: r.id,
    name: r.name,
    email: r.email,
    accessStatus: r.subscription_suspended_at ? 'suspended' : 'active',
    warningCount: r.warning_count,
    maxWarnings,
    lastLoginAt: ms(r.last_login_at),
    activeSessionCount: r.active_sessions,
    // extras
    blockedSessionCount: r.blocked_sessions,
    status: r.blocked_at ? 'suspended' : r.status,
    blocked: !!r.blocked_at,
    suspendedAt: ms(r.subscription_suspended_at),
    suspensionReason: r.suspension_reason,
    openIncidents: r.open_incidents,
    openAppeal: r.open_appeal,
    createdAt: ms(r.created_at),
  };
}

const maxWarningsOf = async (q: Tx) => clamp((await getSettings(q)).security.maxWarnings, 3, 1, 20);

async function oneCustomer(q: Tx, id: string) {
  const r = await findCustomers(q, { id, limit: 1, offset: 0 });
  if (!r[0]) throw new HttpError(404, NOT_FOUND);
  return customerView(r[0], await maxWarningsOf(q));
}

async function listCustomers(ctx: Ctx) {
  await requireStaff(ctx, 'security.read');
  const text = cleanText(ctx.query.get('q'), 100);
  // `access` (not `status`): rows carry `status` for the account itself, a different thing
  const access = ctx.query.get('access') || null;
  if (access && !['active', 'suspended', 'warned'].includes(access)) bad('access', 'Access is active, suspended or warned.');
  const limit = intParam(ctx.query.get('limit'), 200, 1, 1000);
  const offset = intParam(ctx.query.get('offset'), 0, 0, 1_000_000);
  return await tx(async (q) => {
    const max = await maxWarningsOf(q);
    const rows = await findCustomers(q, { like: text ? likePattern(text) : null, exact: text ? text.toLowerCase() : null, access, limit, offset });
    return { customers: rows.map((r) => customerView(r, max)), limit, offset };
  });
}

// ── E4–E6: one customer's sign-ins ──────────────────────────────────────────────────────

type SessionRow = {
  id: string; user_id: string; remember: boolean; created_at: Date; last_seen_at: Date; expires_at: Date; ip: string | null;
  ip_network: string | null; country: string | null; user_agent: string | null; device_label: string | null; is_staff: boolean;
  revoked_at: Date | null; blocked_at: Date | null; blocked_by: string | null; block_reason: string | null;
};

/** "Chrome on Windows" → browser Chrome, device Windows; unknown parts are null (never guessed). */
function uaParts(ua: string | null, label: string | null): { device: string | null; browser: string | null } {
  const l = ua ? deviceLabel(ua) : label;
  if (!l) return { device: null, browser: null };
  const i = l.lastIndexOf(' on ');
  const browser = i > 0 ? l.slice(0, i) : l;
  const os = i > 0 ? l.slice(i + 4) : '';
  return { browser: browser && browser !== 'Browser' ? browser : null, device: os && os !== 'Unknown OS' ? os : null };
}

const hasEnded = (s: SessionRow) => !!s.revoked_at || new Date(s.expires_at).getTime() <= Date.now();

/** E4 shape: { id, device, browser, ip, lastActiveAt, status: active|blocked } + extras. Only
 *  the ?all=1 history (never the zip's calls) can show status 'ended'. */
function sessionView(s: SessionRow) {
  const ended = hasEnded(s);
  return {
    id: s.id,
    ...uaParts(s.user_agent, s.device_label),
    ip: s.ip,
    lastActiveAt: ms(s.last_seen_at),
    status: ended ? 'ended' : s.blocked_at ? 'blocked' : 'active',
    // extras
    ended,
    label: s.device_label,
    network: s.ip_network,
    country: s.country,
    createdAt: ms(s.created_at),
    expiresAt: ms(s.expires_at),
    remember: s.remember,
    blockedAt: ms(s.blocked_at),
    blockReason: s.block_reason,
    endedAt: ms(s.revoked_at),
  };
}

const SESSION_COLS = 'id, user_id, remember, created_at, last_seen_at, expires_at, ip, ip_network, country, user_agent, device_label, is_staff, revoked_at, blocked_at, blocked_by, block_reason';

async function listSessions(ctx: Ctx) {
  await requireStaff(ctx, 'security.read');
  const id = uuidParam(ctx);
  const all = ['1', 'true'].includes(ctx.query.get('all') ?? '');
  return await tx(async (q) => {
    await lockCustomer(q, id);
    const rows = await q<SessionRow[]>`
      select ${q.unsafe(SESSION_COLS)} from app_sessions
      where user_id = ${id} and (${all} or (revoked_at is null and expires_at > now()))
      order by last_seen_at desc, id limit 100`;
    return { sessions: rows.map(sessionView) };
  });
}

/** E5/E6: blocks or unblocks ONE sign-in. The Supabase Auth session is kept, so an unblock
 *  brings it back; while blocked the API answers 403 session_blocked and refresh is refused.
 *  A sign-in that has ended (signed out, expired, account blocked) can be neither: it can never
 *  be used again, and the answer always carries an E4 status of active or blocked. */
function sessionAction(blockIt: boolean) {
  return async (ctx: Ctx) => {
    const staff = await requireStaff(ctx, 'security.write');
    const id = uuidParam(ctx);
    const b = await readJson(ctx.req, 4096);
    const reason = blockIt ? noteOf(b.reason ?? b.note, 'reason', 300) : null;
    return await tx(async (q) => {
      const r = await q<SessionRow[]>`select ${q.unsafe(SESSION_COLS)} from app_sessions where id = ${id} for update`;
      const s = r[0];
      if (!s) throw new HttpError(404, NOT_FOUND);
      if (s.is_staff || s.user_id === staff.id) throw STAFF_ACCOUNT();
      await lockCustomer(q, s.user_id);
      if (hasEnded(s)) throw new HttpError(409, 'This sign-in has already ended.', { code: 'session_ended' });
      let changed = false;
      if (blockIt && !s.blocked_at) {
        await q`update app_sessions set blocked_at = now(), blocked_by = ${staff.id}, block_reason = ${reason} where id = ${id}`;
        changed = true;
      } else if (!blockIt && s.blocked_at) {
        await q`update app_sessions set blocked_at = null, blocked_by = null, block_reason = null where id = ${id}`;
        changed = true;
      }
      if (changed) {
        const action = blockIt ? 'session.block' : 'session.unblock';
        await audit(ctx, { action, targetType: 'app_session', targetId: id, detail: { userId: s.user_id, reason, previousReason: blockIt ? null : s.block_reason } }, q);
        await securityEvent(ctx, s.user_id, blockIt ? 'session.blocked' : 'session.unblocked', { sessionId: id, by: staff.id }, q);
      }
      const fresh = await q<SessionRow[]>`select ${q.unsafe(SESSION_COLS)} from app_sessions where id = ${id}`;
      return { ok: true, changed, session: sessionView(fresh[0]), customer: await oneCustomer(q, s.user_id) };
    });
  };
}

// ── E7/E8: paid-access suspension (sessions untouched) ──────────────────────────────────

async function suspend(ctx: Ctx) {
  const staff = await requireStaff(ctx, 'security.write');
  const id = uuidParam(ctx);
  const b = await readJson(ctx.req, 4096);
  const note = noteOf(b.note ?? b.reason, 'note', 300);
  const out = await tx(async (q) => {
    await lockCustomer(q, id, true);
    const changed = await suspendAccess(q, ctx, id, { reason: 'staff', by: staff.id, note });
    return { ok: true, changed, customer: await oneCustomer(q, id) };
  });
  kickOutbox(ctx);
  return out;
}

async function restore(ctx: Ctx) {
  await requireStaff(ctx, 'security.write');
  const id = uuidParam(ctx);
  const b = await readJson(ctx.req, 4096);
  const note = noteOf(b.note ?? b.reason, 'note', 300);
  const resetWarnings = boolOf(b.resetWarnings, 'resetWarnings');
  const out = await tx(async (q) => {
    await lockCustomer(q, id, true);
    const changed = await liftSuspension(q, ctx, id, { resetWarnings, note });
    return { ok: true, changed, customer: await oneCustomer(q, id) };
  });
  kickOutbox(ctx);
  return out;
}

// ── incidents ───────────────────────────────────────────────────────────────────────────

type IncidentRow = {
  id: number; user_id: string; rule_id: string; status: string; evidence: Record<string, unknown> | null; first_seen_at: Date;
  last_seen_at: Date; decided_at: Date | null; decided_by: string | null; decision_note: string | null; created_at: Date;
  email: string; name: string; rule_name: string; severity: string; warning_id: number | null; decided_by_email: string | null;
};

const incidentView = (i: IncidentRow) => ({
  id: i.id, userId: i.user_id, email: i.email, name: i.name, rule: i.rule_id, ruleName: i.rule_name, severity: i.severity,
  status: i.status, summary: typeof i.evidence?.summary === 'string' ? i.evidence.summary : null, evidence: i.evidence ?? {},
  firstSeenAt: ms(i.first_seen_at), lastSeenAt: ms(i.last_seen_at), createdAt: ms(i.created_at), decidedAt: ms(i.decided_at),
  decidedBy: i.decided_by, decidedByEmail: i.decided_by_email, decisionNote: i.decision_note, warningId: i.warning_id,
});

async function findIncidents(q: Tx, f: { id?: number | null; status?: string | null; user?: string | null; limit: number; offset: number }) {
  const id = f.id ?? null, status = f.status ?? null, user = f.user ?? null;
  return await q<IncidentRow[]>`
    select i.id, i.user_id, i.rule_id, i.status, i.evidence, i.first_seen_at, i.last_seen_at, i.decided_at, i.decided_by,
      i.decision_note, i.created_at, p.email, p.name, r.name as rule_name, r.severity, w.id as warning_id, d.email as decided_by_email
    from security_incidents i
    join profiles p on p.id = i.user_id
    join security_rules r on r.id = i.rule_id
    left join account_warnings w on w.incident_id = i.id
    left join profiles d on d.id = i.decided_by
    where (${id}::bigint is null or i.id = ${id}::bigint)
      and (${status}::text is null or i.status = ${status}::text)
      and (${user}::uuid is null or i.user_id = ${user}::uuid)
    order by i.last_seen_at desc, i.id desc
    limit ${f.limit} offset ${f.offset}`;
}

function userFilter(ctx: Ctx): string | null {
  const u = (ctx.query.get('user') || ctx.query.get('userId') || '').toLowerCase();
  if (!u) return null;
  if (!UUID_RE.test(u)) bad('user', 'Unknown customer id.');
  return u;
}

async function listIncidents(ctx: Ctx) {
  await requireStaff(ctx, 'security.read');
  const s = ctx.query.get('status') || 'all';
  if (!['open', 'confirmed', 'dismissed', 'all'].includes(s)) bad('status', 'Status is open, confirmed, dismissed or all.');
  const user = userFilter(ctx);
  const limit = intParam(ctx.query.get('limit'), 200, 1, 1000);
  const offset = intParam(ctx.query.get('offset'), 0, 0, 1_000_000);
  const rows = await tx((q) => findIncidents(q, { status: s === 'all' ? null : s, user, limit, offset }));
  return { incidents: rows.map(incidentView), limit, offset };
}

function incidentDecision(confirm: boolean) {
  return async (ctx: Ctx) => {
    await requireStaff(ctx, 'security.write');
    const id = numParam(ctx);
    const b = await readJson(ctx.req, 8192);
    const note = noteOf(b.note, 'note', 1000);
    // the services decide and audit in their own transaction; this only reads the result back
    const result = confirm ? await confirmIncident(ctx, id, note) : { ...(await dismissIncident(ctx, id, note)), warning: null };
    return { ok: true, incidentId: result.incidentId, warning: result.warning, ...(await incidentAfter(id)) };
  };
}

/** The incident and its customer's security status after a decision (null if since deleted). */
async function incidentAfter(incidentId: number) {
  return await tx(async (q) => {
    const inc = (await findIncidents(q, { id: incidentId, limit: 1, offset: 0 }))[0];
    if (!inc) return { incident: null, security: null };
    return { incident: incidentView(inc), security: await securityStatus(q, inc.user_id) };
  });
}

async function report(ctx: Ctx) {
  await requireStaff(ctx, 'security.write');
  const id = uuidParam(ctx);
  const b = await readJson(ctx.req, 16 * 1024);
  if (typeof b.reason !== 'string') bad('reason', 'Say what was seen (3 to 500 characters).');
  if ((b.reason as string).trim().length > 500) bad('reason', 'Say what was seen (3 to 500 characters).');
  const confirm = boolOf(b.confirm, 'confirm');
  const evidence = b.evidence === undefined || b.evidence === null ? undefined : b.evidence as Record<string, unknown>;
  const r = await reportViolation(ctx, id, { reason: b.reason as string, evidence, confirm });
  return { ok: true, incidentId: r.incidentId, warning: r.warning, repeat: !!r.repeat, ...(await incidentAfter(r.incidentId)) };
}

// ── warnings ────────────────────────────────────────────────────────────────────────────

type WarningRow = {
  id: number; user_id: string; incident_id: number | null; level: number; reason: string; issued_at: Date; issued_by: string | null;
  expires_at: Date | null; acknowledged_at: Date | null; revoked_at: Date | null; revoked_by: string | null; revoke_reason: string | null;
  email: string; name: string;
};

function warningView(w: WarningRow) {
  const expired = !!w.expires_at && new Date(w.expires_at).getTime() <= Date.now();
  return {
    id: w.id, userId: w.user_id, email: w.email, name: w.name, incidentId: w.incident_id, level: w.level, reason: w.reason,
    issuedAt: ms(w.issued_at), issuedBy: w.issued_by, automatic: !w.issued_by, expiresAt: ms(w.expires_at),
    acknowledgedAt: ms(w.acknowledged_at), acknowledged: !!w.acknowledged_at, revokedAt: ms(w.revoked_at), revokedBy: w.revoked_by,
    revokeReason: w.revoke_reason, status: w.revoked_at ? 'revoked' : expired ? 'expired' : 'active',
  };
}

async function listWarnings(ctx: Ctx) {
  await requireStaff(ctx, 'security.read');
  const s = ctx.query.get('status') || 'all';
  if (!['active', 'revoked', 'expired', 'all'].includes(s)) bad('status', 'Status is active, revoked, expired or all.');
  const user = userFilter(ctx);
  const limit = intParam(ctx.query.get('limit'), 200, 1, 1000);
  const offset = intParam(ctx.query.get('offset'), 0, 0, 1_000_000);
  const rows = await tx((q) => q<WarningRow[]>`
    select w.*, p.email, p.name
    from account_warnings w join profiles p on p.id = w.user_id
    where (${user}::uuid is null or w.user_id = ${user}::uuid)
      and (${s}::text = 'all'
           or (${s}::text = 'revoked' and w.revoked_at is not null)
           or (${s}::text = 'expired' and w.revoked_at is null and w.expires_at is not null and w.expires_at <= now())
           or (${s}::text = 'active' and w.revoked_at is null and (w.expires_at is null or w.expires_at > now())))
    order by w.issued_at desc, w.id desc
    limit ${limit} offset ${offset}`);
  return { warnings: rows.map(warningView), limit, offset };
}

/** Revokes one warning (it stops counting). A suspension is not lifted here: that stays a
 *  separate staff decision (E8), as the policy says; the answer shows the new count. */
async function revokeWarning(ctx: Ctx) {
  const staff = await requireStaff(ctx, 'security.write');
  const id = numParam(ctx);
  const b = await readJson(ctx.req, 4096);
  const reason = cleanText(b.reason, 400);
  if (reason.length < 3 || reason.length > 300) bad('reason', 'Say why the warning is removed (3 to 300 characters).');
  return await tx(async (q) => {
    const r = await q<WarningRow[]>`
      select w.*, p.email, p.name from account_warnings w join profiles p on p.id = w.user_id
      where w.id = ${id} for update of w`;
    const w = r[0];
    if (!w) throw new HttpError(404, NOT_FOUND);
    if (w.revoked_at) throw new HttpError(409, 'This warning was already removed.', { code: 'already_revoked' });
    await q`update account_warnings set revoked_at = now(), revoked_by = ${staff.id}, revoke_reason = ${reason} where id = ${id}`;
    await audit(ctx, { action: 'security.warning_revoke', targetType: 'account_warning', targetId: id, detail: { userId: w.user_id, level: w.level, reason } }, q);
    await securityEvent(ctx, w.user_id, 'security.warning_revoked', { warningId: id, by: staff.id }, q);
    await notify(q, {
      audience: 'customer', userId: w.user_id, kind: 'security.warning_revoked', title: 'A security warning was removed',
      body: 'We looked again and removed one warning from your account.', data: { warningId: id },
    });
    const fresh = await q<WarningRow[]>`select w.*, p.email, p.name from account_warnings w join profiles p on p.id = w.user_id where w.id = ${id}`;
    return { ok: true, warning: warningView(fresh[0]), security: await securityStatus(q, w.user_id) };
  });
}

// ── appeals ─────────────────────────────────────────────────────────────────────────────

type AppealRow = {
  id: number; user_id: string; warning_id: number | null; kind: string; message: string; status: string; staff_response: string | null;
  decided_by: string | null; decided_at: Date | null; created_at: Date; email: string; name: string; suspended_at: Date | null;
  warning_count: number;
};

const appealView = (a: AppealRow) => ({
  id: a.id, userId: a.user_id, email: a.email, name: a.name, warningId: a.warning_id, kind: a.kind, message: a.message,
  status: a.status, response: a.staff_response, decidedBy: a.decided_by, decidedAt: ms(a.decided_at), createdAt: ms(a.created_at),
  accessStatus: a.suspended_at ? 'suspended' : 'active', warningCount: a.warning_count,
});

async function findAppeals(q: Tx, f: { id?: number | null; status?: string | null; user?: string | null; limit: number; offset: number; lock?: boolean }) {
  const id = f.id ?? null, status = f.status ?? null, user = f.user ?? null;
  return await q<AppealRow[]>`
    select a.*, p.email, p.name, p.subscription_suspended_at as suspended_at, private.active_warning_count(a.user_id) as warning_count
    from account_appeals a join profiles p on p.id = a.user_id
    where (${id}::bigint is null or a.id = ${id}::bigint)
      and (${status}::text is null or a.status = ${status}::text)
      and (${user}::uuid is null or a.user_id = ${user}::uuid)
    order by (a.status = 'open') desc, a.created_at desc, a.id desc
    limit ${f.limit} offset ${f.offset}`;
}

async function listAppeals(ctx: Ctx) {
  await requireStaff(ctx, 'security.read');
  const s = ctx.query.get('status') || 'all';
  if (!['open', 'accepted', 'rejected', 'all'].includes(s)) bad('status', 'Status is open, accepted, rejected or all.');
  const user = userFilter(ctx);
  const limit = intParam(ctx.query.get('limit'), 200, 1, 1000);
  const offset = intParam(ctx.query.get('offset'), 0, 0, 1_000_000);
  const rows = await tx((q) => findAppeals(q, { status: s === 'all' ? null : s, user, limit, offset }));
  return { appeals: rows.map(appealView), limit, offset };
}

/** POST /api/admin/security/appeals/:id/decide {accept, response, resetWarnings}.
 *  Accept: the linked warning is removed (for a warning appeal without a link, the newest
 *  active one) and paid access is restored (liftSuspension). Either way the customer is emailed. */
async function decideAppeal(ctx: Ctx) {
  const staff = await requireStaff(ctx, 'security.write');
  const id = numParam(ctx);
  const b = await readJson(ctx.req, 16 * 1024);
  if (typeof b.accept !== 'boolean') bad('accept', 'Choose accept (true) or reject (false).');
  const accept = b.accept as boolean;
  const response = noteOf(b.response, 'response', 4000) ?? '';
  if (!accept && response.length < 3) bad('response', 'Tell the customer why (3 characters or more).');
  const resetWarnings = boolOf(b.resetWarnings, 'resetWarnings');
  const out = await tx(async (q) => {
    const lock = await q<{ id: number; user_id: string; status: string; kind: string; warning_id: number | null }[]>`
      select id, user_id, status, kind, warning_id from account_appeals where id = ${id} for update`;
    const a = lock[0];
    if (!a) throw new HttpError(404, NOT_FOUND);
    if (a.status !== 'open') throw new HttpError(409, 'This note was already answered.', { code: 'already_decided' });
    const prof = await q<{ email: string; name: string }[]>`select email, name from profiles where id = ${a.user_id} for update`;
    await q`
      update account_appeals set status = ${accept ? 'accepted' : 'rejected'}, staff_response = ${response || null},
        decided_by = ${staff.id}, decided_at = now()
      where id = ${id}`;
    let revokedWarning: number | null = null;
    let restored = false;
    if (accept) {
      const target = a.warning_id ?? (a.kind === 'warning'
        ? (await q<{ id: number }[]>`
            select id from account_warnings where user_id = ${a.user_id} and revoked_at is null
              and (expires_at is null or expires_at > now())
            order by issued_at desc, id desc limit 1`)[0]?.id ?? null
        : null);
      if (target !== null) {
        const r = await q<{ id: number }[]>`
          update account_warnings set revoked_at = now(), revoked_by = ${staff.id},
            revoke_reason = ${`Appeal #${id} accepted`}
          where id = ${target} and user_id = ${a.user_id} and revoked_at is null
          returning id`;
        revokedWarning = r[0]?.id ?? null;
      }
      restored = await liftSuspension(q, ctx, a.user_id, { resetWarnings, note: `Appeal #${id} accepted` });
    }
    await audit(ctx, {
      action: 'security.appeal_decide', targetType: 'account_appeal', targetId: id,
      detail: { userId: a.user_id, accept, kind: a.kind, revokedWarning, restored, resetWarnings: accept ? resetWarnings : false },
    }, q);
    await securityEvent(ctx, a.user_id, accept ? 'appeal.accepted' : 'appeal.rejected', { appealId: id, by: staff.id }, q);
    const mail = appealDecision({ name: prof[0]?.name || 'there', accepted: accept, response });
    await enqueue(q, {
      template: 'appeal_decision', to: prof[0].email, userId: a.user_id, subject: mail.subject, html: mail.html, text: mail.text,
      dedupeKey: `appeal-decision:${id}`, relatedType: 'account_appeal', relatedId: id,
    });
    await notify(q, {
      audience: 'customer', userId: a.user_id, kind: 'appeal.decided',
      title: accept ? 'We accepted your note' : 'We answered your note', body: response || undefined, data: { appealId: id, accepted: accept },
    });
    const fresh = (await findAppeals(q, { id, limit: 1, offset: 0 }))[0];
    return { ok: true, appeal: appealView(fresh), revokedWarning, restored, security: await securityStatus(q, a.user_id) };
  });
  kickOutbox(ctx);
  return out;
}

// ── sharing rules ───────────────────────────────────────────────────────────────────────

// What each rule's params may hold (same limits sharing.ts applies when it reads them).
const RULE_PARAMS: Record<string, Record<string, [number, number]>> = {
  concurrent_devices: { devices: [3, 100], networks: [2, 100], windowMinutes: [1, 1440] },
  many_devices_day: { devices: [3, 100], windowHours: [1, 168] },
  many_countries_day: { countries: [3, 50], windowHours: [1, 168] },
  rapid_page_requests: { requests: [50, 100000], windowMinutes: [1, 1440] },
  manual_report: {},
};

type RuleRow = {
  id: string; name: string; description: string; enabled: boolean; auto_confirm: boolean; severity: string;
  params: Record<string, unknown>; updated_at: Date; updated_by: string | null;
};

const ruleView = (r: RuleRow) => ({
  id: r.id, name: r.name, description: r.description, enabled: r.enabled, autoConfirm: r.auto_confirm, auto_confirm: r.auto_confirm,
  severity: r.severity, params: r.params ?? {}, limits: RULE_PARAMS[r.id] ?? null, updatedAt: ms(r.updated_at), updatedBy: r.updated_by,
});

async function listRules(ctx: Ctx) {
  await requireStaff(ctx, 'security.read');
  const rows = await tx((q) => q<RuleRow[]>`select * from security_rules order by id`);
  return { rules: rows.map(ruleView) };
}

async function getRule(ctx: Ctx) {
  await requireStaff(ctx, 'security.read');
  const id = String(ctx.params.id ?? '');
  if (!/^[a-z_]{3,40}$/.test(id)) throw new HttpError(404, NOT_FOUND);
  const rows = await tx((q) => q<RuleRow[]>`select * from security_rules where id = ${id}`);
  if (!rows[0]) throw new HttpError(404, NOT_FOUND);
  return { rule: ruleView(rows[0]) };
}

type RuleChange = { enabled?: boolean; auto_confirm?: boolean; severity?: string; params?: Record<string, number> };

function parseRuleChange(id: string, b: Record<string, unknown>): RuleChange {
  const c: RuleChange = {};
  if (b.enabled !== undefined) {
    if (typeof b.enabled !== 'boolean') bad('enabled', 'Enabled is true or false.');
    c.enabled = b.enabled as boolean;
  }
  const ac = b.autoConfirm !== undefined ? b.autoConfirm : b.auto_confirm;
  if (ac !== undefined) {
    if (typeof ac !== 'boolean') bad('autoConfirm', 'Auto-confirm is true or false.');
    if (ac && id === 'manual_report') bad('autoConfirm', 'Staff reports are confirmed by the person reporting them.');
    c.auto_confirm = ac as boolean;
  }
  if (b.severity !== undefined) {
    if (!['low', 'medium', 'high'].includes(String(b.severity))) bad('severity', 'Severity is low, medium or high.');
    c.severity = String(b.severity);
  }
  if (b.params !== undefined) {
    const p = b.params;
    if (!p || typeof p !== 'object' || Array.isArray(p)) bad('params', 'Params must be an object.');
    const limits = RULE_PARAMS[id];
    if (!limits) bad('params', 'This rule has no settings that can be changed here.');
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(p as Record<string, unknown>)) {
      const lim = limits[k];
      if (!lim) bad('params', `Unknown setting "${k.slice(0, 40)}" for this rule.`);
      if (typeof v !== 'number' || !Number.isInteger(v) || v < lim[0] || v > lim[1]) {
        bad('params', `${k} must be a whole number from ${lim[0]} to ${lim[1]}.`);
      }
      out[k] = v as number;
    }
    c.params = out;
  }
  if (!Object.keys(c).length) bad('enabled', 'Send enabled, autoConfirm, severity or params.');
  return c;
}

async function applyRule(q: Tx, ctx: Ctx, id: string, c: RuleChange): Promise<RuleRow> {
  const cur = await q<RuleRow[]>`select * from security_rules where id = ${id} for update`;
  if (!cur[0]) throw new HttpError(404, NOT_FOUND);
  const before = cur[0];
  const params = c.params ? { ...(before.params ?? {}), ...c.params } : before.params ?? {};
  const after = await q<RuleRow[]>`
    update security_rules set
      enabled = ${c.enabled ?? before.enabled},
      auto_confirm = ${c.auto_confirm ?? before.auto_confirm},
      severity = ${c.severity ?? before.severity},
      params = ${q.json(params as never)},
      updated_by = ${ctx.user!.id}
    where id = ${id}
    returning *`;
  await audit(ctx, {
    action: 'security.rule_update', targetType: 'security_rule', targetId: id,
    detail: {
      before: { enabled: before.enabled, autoConfirm: before.auto_confirm, severity: before.severity, params: before.params },
      after: { enabled: after[0].enabled, autoConfirm: after[0].auto_confirm, severity: after[0].severity, params: after[0].params },
    },
  }, q);
  return after[0];
}

async function putRule(ctx: Ctx) {
  await requireStaff(ctx, 'security.write');
  const id = String(ctx.params.id ?? '');
  if (!/^[a-z_]{3,40}$/.test(id)) throw new HttpError(404, NOT_FOUND);
  const change = parseRuleChange(id, await readJson(ctx.req, 16 * 1024));
  const row = await tx((q) => applyRule(q, ctx, id, change));
  return { ok: true, rule: ruleView(row) };
}

/** PUT /api/admin/security/rules {rules: [{id, ...}]} — several at once, all or nothing. */
async function putRules(ctx: Ctx) {
  await requireStaff(ctx, 'security.write');
  const b = await readJson(ctx.req, 32 * 1024);
  const list = Array.isArray(b.rules) ? b.rules as unknown[] : (typeof b.id === 'string' ? [b] : null);
  if (!list || !list.length || list.length > 50) bad('rules', 'Send rules: [{ id, enabled?, autoConfirm?, severity?, params? }].');
  const changes = list!.map((x) => {
    if (!x || typeof x !== 'object' || Array.isArray(x)) bad('rules', 'Each rule must be an object with an id.');
    const o = x as Record<string, unknown>;
    const id = String(o.id ?? '');
    if (!/^[a-z_]{3,40}$/.test(id)) bad('rules', 'Each rule needs a known id.');
    return { id, change: parseRuleChange(id, o) };
  });
  const rows = await tx(async (q) => {
    const out: RuleRow[] = [];
    for (const c of changes) out.push(await applyRule(q, ctx, c.id, c.change));
    return out;
  });
  return { ok: true, rules: rows.map(ruleView) };
}

// ── old log pages ───────────────────────────────────────────────────────────────────────

const LOG_PERMS = ['logs.read', 'security.read'];
const logLimit = (ctx: Ctx) => intParam(ctx.query.get('limit'), 300, 1, 2000);

async function securityEvents(ctx: Ctx) {
  await requireStaff(ctx, LOG_PERMS);
  const user = userFilter(ctx);
  const type = ctx.query.get('type') || null;
  if (type && !/^[a-z_.]{2,60}$/.test(type)) bad('type', 'Unknown event type.');
  const limit = logLimit(ctx);
  const offset = intParam(ctx.query.get('offset'), 0, 0, 1_000_000);
  const rows = await tx((q) => q<{ id: number; user_id: string | null; event_type: string; detail: unknown; ip: string | null; user_agent: string | null; created_at: Date; email: string | null; by_email: string | null }[]>`
    select e.id, e.user_id, e.event_type, e.detail, e.ip, e.user_agent, e.created_at, p.email, b.email::text as by_email
    from security_events e left join profiles p on p.id = e.user_id
    left join profiles b on b.id::text = e.detail ->> 'by'
    where (${user}::uuid is null or e.user_id = ${user}::uuid) and (${type}::text is null or e.event_type = ${type}::text)
    order by e.created_at desc, e.id desc limit ${limit} offset ${offset}`);
  return {
    events: rows.map((e) => ({
      id: e.id, user_id: e.user_id, event_type: e.event_type, detail: e.detail ?? null, ip: e.ip, user_agent: e.user_agent,
      created_at: ms(e.created_at), email: e.email,
      userId: e.user_id, type: e.event_type, at: ms(e.created_at),
      // detail.by names the staff member who acted (a user id); their email for the log page
      byEmail: e.by_email ?? null,
    })),
  };
}

async function loginActivity(ctx: Ctx) {
  await requireStaff(ctx, LOG_PERMS);
  const user = userFilter(ctx);
  const s = ctx.query.get('success');
  const success = s === 'true' || s === '1' ? true : s === 'false' || s === '0' ? false : null;
  const email = cleanText(ctx.query.get('email'), 254).toLowerCase() || null;
  const limit = logLimit(ctx);
  const offset = intParam(ctx.query.get('offset'), 0, 0, 1_000_000);
  const rows = await tx((q) => q<{ id: number; user_id: string | null; email: string; success: boolean; failure_reason: string | null; ip: string | null; user_agent: string | null; session_id: string | null; created_at: Date }[]>`
    select id, user_id, email, success, failure_reason, ip, user_agent, session_id, created_at
    from login_activity
    where (${user}::uuid is null or user_id = ${user}::uuid)
      and (${success}::boolean is null or success = ${success}::boolean)
      and (${email}::text is null or email = ${email}::text)
    order by created_at desc, id desc limit ${limit} offset ${offset}`);
  return {
    logins: rows.map((l) => ({
      id: l.id, user_id: l.user_id, email: l.email, success: l.success, failure_reason: l.failure_reason, ip: l.ip,
      user_agent: l.user_agent, session_id: l.session_id, created_at: ms(l.created_at),
      userId: l.user_id, reason: l.failure_reason, at: ms(l.created_at),
    })),
  };
}

async function accessLog(ctx: Ctx) {
  await requireStaff(ctx, LOG_PERMS);
  const user = userFilter(ctx);
  const product = ctx.query.get('worksheet') || ctx.query.get('product') || null;
  if (product && !/^[A-Za-z0-9][A-Za-z0-9-]{1,63}$/.test(product)) bad('worksheet', 'Unknown worksheet id.');
  const limit = logLimit(ctx);
  const offset = intParam(ctx.query.get('offset'), 0, 0, 1_000_000);
  const rows = await tx((q) => q<{ id: number; at: Date; user_id: string | null; product_id: string | null; entitlement_id: number | null; session_id: string | null; action: string; ok: boolean; detail: string | null; ip: string | null; ip_network: string | null; device_id_hash: string | null; country: string | null; email: string | null }[]>`
    select a.id, a.at, a.user_id, a.product_id, a.entitlement_id, a.session_id, a.action, a.ok, a.detail, a.ip, a.ip_network,
           a.device_id_hash, a.country, p.email
    from access_log a left join profiles p on p.id = a.user_id
    where (${user}::uuid is null or a.user_id = ${user}::uuid) and (${product}::text is null or a.product_id = ${product}::text)
    order by a.at desc, a.id desc limit ${limit} offset ${offset}`);
  return {
    log: rows.map((a) => ({
      id: a.id, at: ms(a.at), user_id: a.user_id, worksheet_id: a.product_id, action: a.action, ok: a.ok, detail: a.detail, ip: a.ip,
      email: a.email,
      userId: a.user_id, productId: a.product_id, entitlementId: a.entitlement_id, sessionId: a.session_id, network: a.ip_network,
      country: a.country, device: a.device_id_hash ? a.device_id_hash.slice(0, 12) : null,
    })),
  };
}

export function register(r: Router) {
  // E3–E8
  r.get('/api/admin/security/customers', listCustomers);
  r.get('/api/admin/security/customers/:id/sessions', listSessions);
  r.post('/api/admin/security/sessions/:id/block', sessionAction(true));
  r.post('/api/admin/security/sessions/:id/unblock', sessionAction(false));
  r.post('/api/admin/security/customers/:id/block', suspend);
  r.post('/api/admin/security/customers/:id/unblock', restore);
  r.post('/api/admin/security/customers/:id/report', report);

  r.get('/api/admin/security/incidents', listIncidents);
  r.post('/api/admin/security/incidents/:id/confirm', incidentDecision(true));
  r.post('/api/admin/security/incidents/:id/dismiss', incidentDecision(false));

  r.get('/api/admin/security/warnings', listWarnings);
  r.post('/api/admin/security/warnings/:id/revoke', revokeWarning);

  r.get('/api/admin/security/appeals', listAppeals);
  r.post('/api/admin/security/appeals/:id/decide', decideAppeal);

  r.get('/api/admin/security/rules', listRules);
  r.put('/api/admin/security/rules', putRules);
  r.get('/api/admin/security/rules/:id', getRule);
  r.put('/api/admin/security/rules/:id', putRule);

  r.get('/api/admin/security-events', securityEvents);
  r.get('/api/admin/login-activity', loginActivity);
  r.get('/api/admin/access-log', accessLog);
}
