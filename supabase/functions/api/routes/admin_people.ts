// OWNER: agent F. Staff screens for people: who am I, customers (list, profile, account block,
// sign-outs, password-reset links), staff members (add, promote, change, deactivate) and the
// contact inbox. Old shapes from backend/src/routes/admin.cjs and contact.cjs are kept.
// Every write is audited in the same transaction; email goes out after the transaction.
//
// Staff rules (DESIGN.md §2): staff.manage is needed for any staff change; only an owner may
// give the owner/admin role or staff.manage, or touch an owner's or admin's staff record; nobody
// changes their own role or switches off their own access; the last owner is kept by a trigger.
// The manager's own staff row is re-read and locked inside each staff change, so a role taken
// away a moment ago counts, and two owners demoting each other at once cannot leave none.
import type { Router } from '../lib/router.ts';
import type { Ctx, Profile, StaffInfo } from '../lib/context.ts';
import { tx, type Tx } from '../lib/db.ts';
import { HttpError, intParam, readJson } from '../lib/http.ts';
import { BLOCKED_MESSAGE, bearer, effectivePermissions, hasPermission, publicUser, requireStaff, requireUser } from '../lib/auth.ts';
import { audit, notify, rateLimit, securityEvent } from '../lib/guard.ts';
import { getSettings } from '../lib/settings.ts';
import { enqueue, kickOutbox, sendSensitive } from '../lib/mail.ts';
import { env, mailReady } from '../lib/env.ts';
import { adminCreateUser, adminDeleteUser, AuthApiError } from '../lib/gotrue.ts';
import { cleanName, cleanText, escapeHtml, fmtDateTime, generatePassword, normEmail, validEmail } from '../lib/util.ts';
import { blockAccount, endAllSessions, sendResetLink, unblockAccount } from '../services/accounts.ts';
import { securityStatus } from '../services/sharing.ts';
import { staffWelcome, type Email } from '../services/emails.ts';
import { pubEntitlement, type EntRow } from '../services/entitlements.ts';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ROLES = ['owner', 'admin', 'support', 'content', 'developer'] as const;
const MESSAGE_STATUSES = ['new', 'read', 'replied', 'archived'] as const;
const NO_CUSTOMER = 'No such customer.';
const NO_MESSAGE = 'No such message.';

const ms = (d: Date | string | null | undefined) => (d == null ? null : new Date(d).getTime());
const clamp = (v: unknown, def: number, min: number, max: number) => {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.floor(v) : def;
  return Math.max(min, Math.min(max, n));
};

const bad = (field: string, msg: string): never => {
  throw new HttpError(400, msg, { errors: { [field]: msg } });
};
const ownerOnly = (msg: string) => new HttpError(403, msg, { code: 'owner_only' });
const SELF = () => new HttpError(403, 'You cannot change your own staff role or switch off your own access — ask another staff manager.', { code: 'self_change' });

/** A uuid path parameter (lower case), or 404 with the given text. */
function uuidParam(ctx: Ctx, name: string, notFound = 'Not found'): string {
  const v = String(ctx.params[name] ?? '').toLowerCase();
  if (!UUID_RE.test(v)) throw new HttpError(404, notFound);
  return v;
}

/** A positive whole number from a number or a digit string; null otherwise. */
function idOf(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^\s*\d{1,15}\s*$/.test(v) ? Number(v) : NaN;
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/** ILIKE pattern for a search box (wildcards typed by staff are matched literally). */
const likePattern = (s: string) => `%${s.replace(/[\\%_]/g, (c) => '\\' + c)}%`;

const maxWarningsOf = (s: { security: { maxWarnings: number } }) => clamp(s.security.maxWarnings, 3, 1, 20);

/** Any active staff member (no particular permission). */
async function requireAnyStaff(ctx: Ctx) {
  if (!bearer(ctx)) throw new HttpError(401, 'Staff sign-in required.', { code: 'staff_signin' });
  let u;
  try {
    u = await requireUser(ctx);
  } catch (e) {
    if (e instanceof HttpError && e.status === 401) throw new HttpError(401, 'Staff sign-in required.', { code: 'staff_signin' });
    throw e;
  }
  if (!u.staff) throw new HttpError(403, 'This account is not a staff account.', { code: 'not_staff' });
  return u;
}

/** The 409 for the last-owner trigger (and the error itself for anything else). */
export function staffDbError(e: unknown): unknown {
  const err = e as { code?: string; message?: string };
  if (err?.code === '23514' && /last owner/i.test(String(err.message ?? ''))) {
    return new HttpError(409, 'The last owner cannot be removed or demoted — make someone else an owner first.', { code: 'last_owner' });
  }
  return e;
}

type StaffRec = { user_id: string; role: string; permissions: string[]; active: boolean; note: string | null };

const isTop = (role: string | null | undefined) => role === 'owner' || role === 'admin';

/** The acting manager as the database says now (null when no longer active staff). */
function asInfo(r: StaffRec | undefined): StaffInfo | null {
  return r?.active ? { role: r.role, permissions: r.permissions, active: true } : null;
}

/** Locks the profile rows of the acting staff member and the target, in id order, and refuses when
 *  the actor's own account has been blocked meanwhile. Every account block/unblock and staff change
 *  takes this lock first, so two owners blocking (or switching off) each other at the same moment
 *  queue up: the second one finds its own account blocked and is refused, and an owner always
 *  remains. Returns the target's profile (null when there is none). */
async function lockProfilePair(q: Tx, actorId: string, targetId: string): Promise<Profile | null> {
  const rows = await q<Profile[]>`
    select * from profiles where id = any(${[actorId, targetId]}::uuid[]) order by id for update`;
  const actor = rows.find((r) => r.id === actorId);
  if (!actor || actor.blocked_at) throw new HttpError(403, BLOCKED_MESSAGE, { code: 'account_suspended' });
  return rows.find((r) => r.id === targetId) ?? null;
}

/** Locks the staff rows of the manager and the target, in id order (two managers acting on
 *  each other queue up instead of deadlocking), and re-checks that the manager still holds
 *  staff.manage. Returns the manager's current staff info and the target's row (if any). */
async function lockStaffPair(q: Tx, actorId: string, targetId: string): Promise<{ actor: StaffInfo; target: StaffRec | null }> {
  await lockProfilePair(q, actorId, targetId);
  const rows = await q<StaffRec[]>`
    select user_id, role, permissions, active, note from staff_members
    where user_id = any(${[actorId, targetId]}::uuid[])
    order by user_id
    for update`;
  const actor = asInfo(rows.find((r) => r.user_id === actorId));
  if (!hasPermission(actor, 'staff.manage')) {
    throw new HttpError(403, 'Your staff role does not allow this.', { code: 'forbidden', permission: 'staff.manage' });
  }
  return { actor: actor!, target: rows.find((r) => r.user_id === targetId) ?? null };
}

// ── who am I ────────────────────────────────────────────────────────────────────────────

async function allPermissions(q: Tx) {
  return await q<{ id: string; description: string }[]>`select id, description from staff_permissions order by id`;
}

async function me(ctx: Ctx) {
  const u = await requireAnyStaff(ctx);
  const perms = await tx((q) => allPermissions(q));
  const keys = perms.map((p) => p.id);
  return {
    user: publicUser(u.profile, u.staff),
    staff: { role: u.staff!.role, permissions: effectivePermissions(u.staff, keys) },
    permissions: keys,
    permissionInfo: perms,
  };
}

// ── customers ───────────────────────────────────────────────────────────────────────────

type UserRow = Profile & {
  staff_role: string | null; staff_active: boolean | null; paid_orders: number; spent_inr: string | number;
  live_ents: number; warning_count: number; active_sessions: number;
};

/** `status` filters on the row's own `status` field (suspended = the whole-account block, as the
 *  old panel shows it; "blocked" is accepted as a synonym); `access` on paid-access suspension. */
type UserFilter = {
  id?: string | null; like?: string | null; exact?: string | null; status?: string | null; access?: string | null;
  type?: string | null; limit: number; offset: number;
};

const USER_STATUSES = ['active', 'pending_verification', 'suspended', 'blocked'];
const USER_ACCESS = ['active', 'suspended'];
const USER_TYPES = ['customers', 'staff'];

// findUsers and countUsers share one WHERE clause: change them together.
async function findUsers(q: Tx, f: UserFilter): Promise<UserRow[]> {
  const id = f.id ?? null, like = f.like ?? null, exact = f.exact ?? null, status = f.status ?? null, access = f.access ?? null, type = f.type ?? null;
  return await q<UserRow[]>`
    select p.*, st.role as staff_role, st.active as staff_active,
      (select count(*)::int from orders o where o.user_id = p.id and o.status = 'paid') as paid_orders,
      (select coalesce(sum(o.total_inr), 0) from orders o where o.user_id = p.id and o.status = 'paid') as spent_inr,
      (select count(*)::int from entitlements e where e.user_id = p.id and e.revoked_at is null
         and e.starts_at <= now() and (e.expires_at is null or e.expires_at > now())) as live_ents,
      private.active_warning_count(p.id) as warning_count,
      (select count(*)::int from app_sessions s where s.user_id = p.id and s.revoked_at is null
         and s.blocked_at is null and s.expires_at > now()) as active_sessions
    from profiles p
    left join staff_members st on st.user_id = p.id
    where (${id}::uuid is null or p.id = ${id}::uuid)
      and (${like}::text is null or p.email::text ilike ${like}::text or p.name ilike ${like}::text or p.id::text = ${exact}::text)
      and (${status}::text is null
           or (${status}::text in ('suspended', 'blocked') and p.blocked_at is not null)
           or (${status}::text = 'pending_verification' and p.status = 'pending_verification' and p.blocked_at is null)
           or (${status}::text = 'active' and p.status = 'active' and p.blocked_at is null))
      and (${access}::text is null
           or (${access}::text = 'suspended' and p.subscription_suspended_at is not null)
           or (${access}::text = 'active' and p.subscription_suspended_at is null))
      and (${type}::text is null
           or (${type}::text = 'staff' and coalesce(st.active, false))
           or (${type}::text = 'customers' and not coalesce(st.active, false)))
    order by p.created_at desc, p.id
    limit ${f.limit} offset ${f.offset}`;
}

async function countUsers(q: Tx, f: UserFilter): Promise<number> {
  const like = f.like ?? null, exact = f.exact ?? null, status = f.status ?? null, access = f.access ?? null, type = f.type ?? null;
  const r = await q<{ n: number }[]>`
    select count(*)::int as n
    from profiles p
    left join staff_members st on st.user_id = p.id
    where (${like}::text is null or p.email::text ilike ${like}::text or p.name ilike ${like}::text or p.id::text = ${exact}::text)
      and (${status}::text is null
           or (${status}::text in ('suspended', 'blocked') and p.blocked_at is not null)
           or (${status}::text = 'pending_verification' and p.status = 'pending_verification' and p.blocked_at is null)
           or (${status}::text = 'active' and p.status = 'active' and p.blocked_at is null))
      and (${access}::text is null
           or (${access}::text = 'suspended' and p.subscription_suspended_at is not null)
           or (${access}::text = 'active' and p.subscription_suspended_at is null))
      and (${type}::text is null
           or (${type}::text = 'staff' and coalesce(st.active, false))
           or (${type}::text = 'customers' and not coalesce(st.active, false)))`;
  return r[0]?.n ?? 0;
}

/** Old admin user row (snake_case, ms times) plus the new fields. */
function userView(r: UserRow, maxWarnings: number) {
  const blocked = !!r.blocked_at;
  return {
    id: r.id,
    email: r.email,
    name: r.name,
    role: r.role,
    created_at: ms(r.created_at),
    last_login_at: ms(r.last_login_at),
    email_verified: !!r.email_verified_at,
    account_status: blocked ? 'suspended' : r.status,
    locked_until: ms(r.locked_until),
    orders: r.paid_orders,
    spent_inr: Number(r.spent_inr) || 0,
    active: r.live_ents,
    // new
    status: blocked ? 'suspended' : r.status,
    emailVerified: !!r.email_verified_at,
    createdAt: ms(r.created_at),
    lastLoginAt: ms(r.last_login_at),
    blocked,
    blockedAt: ms(r.blocked_at),
    blockedReason: r.blocked_reason,
    accessStatus: r.subscription_suspended_at ? 'suspended' : 'active',
    suspendedAt: ms(r.subscription_suspended_at),
    suspensionReason: r.suspension_reason,
    warningCount: r.warning_count,
    maxWarnings,
    activeSessionCount: r.active_sessions,
    staffRole: r.staff_active ? r.staff_role : null,
    country: r.country,
    timeZone: r.time_zone,
  };
}

async function oneUser(q: Tx, id: string) {
  const rows = await findUsers(q, { id, limit: 1, offset: 0 });
  if (!rows[0]) throw new HttpError(404, NO_CUSTOMER);
  return userView(rows[0], maxWarningsOf(await getSettings(q)));
}

async function listUsers(ctx: Ctx) {
  await requireStaff(ctx, 'customers.read');
  const sp = ctx.query;
  const text = cleanText(sp.get('q'), 100);
  const status = sp.get('status') || null;
  if (status && !USER_STATUSES.includes(status)) bad('status', 'Status is active, pending_verification or suspended.');
  const access = sp.get('access') || null;
  if (access && !USER_ACCESS.includes(access)) bad('access', 'Access is active or suspended.');
  const type = sp.get('type') || null;
  if (type && type !== 'all' && !USER_TYPES.includes(type)) bad('type', 'Type is customers, staff or all.');
  const f: UserFilter = {
    like: text ? likePattern(text) : null, exact: text ? text.toLowerCase() : null, status, access,
    type: type === 'all' ? null : type,
    limit: intParam(sp.get('limit'), 1000, 1, 1000), offset: intParam(sp.get('offset'), 0, 0, 1_000_000),
  };
  const out = await tx(async (q) => {
    const max = maxWarningsOf(await getSettings(q));
    const rows = await findUsers(q, f);
    return { users: rows.map((r) => userView(r, max)), total: await countUsers(q, f) };
  });
  return { ...out, limit: f.limit, offset: f.offset, nextOffset: f.offset + out.users.length < out.total ? f.offset + out.users.length : null };
}

function sessionStatus(s: { revoked_at: Date | null; expires_at: Date; blocked_at: Date | null }) {
  if (s.revoked_at) return 'ended';
  if (new Date(s.expires_at).getTime() <= Date.now()) return 'expired';
  return s.blocked_at ? 'blocked' : 'active';
}

async function getUser(ctx: Ctx) {
  await requireStaff(ctx, 'customers.read');
  const id = uuidParam(ctx, 'id', NO_CUSTOMER);
  return await tx(async (q) => {
    const user = await oneUser(q, id);
    const orders = await q<{ id: string; kind: string; status: string; currency: string; total: string; total_inr: string; method: string; lines: unknown; coupon_code: string | null; created_at: Date; paid_at: Date | null; refunded_at: Date | null }[]>`
      select id, kind, status, currency, total, total_inr, method, lines, coupon_code, created_at, paid_at, refunded_at
      from orders where user_id = ${id} order by created_at desc limit 200`;
    const ents = await q<(EntRow & { revoke_reason: string | null })[]>`
      select e.*, pr.title, pr.price_inr from entitlements e
      left join products pr on pr.id = e.product_id
      where e.user_id = ${id} order by e.starts_at desc, e.id desc limit 500`;
    const sessions = await q<{ id: string; remember: boolean; created_at: Date; last_seen_at: Date; expires_at: Date; ip: string | null; country: string | null; device_label: string | null; is_staff: boolean; revoked_at: Date | null; revoke_reason: string | null; blocked_at: Date | null; block_reason: string | null }[]>`
      select id, remember, created_at, last_seen_at, expires_at, ip, country, device_label, is_staff, revoked_at, revoke_reason, blocked_at, block_reason
      from app_sessions where user_id = ${id} order by last_seen_at desc limit 50`;
    const warnings = await q<{ id: number; incident_id: number | null; level: number; reason: string; issued_at: Date; expires_at: Date | null; acknowledged_at: Date | null; revoked_at: Date | null; revoke_reason: string | null }[]>`
      select id, incident_id, level, reason, issued_at, expires_at, acknowledged_at, revoked_at, revoke_reason
      from account_warnings where user_id = ${id} order by issued_at desc, id desc limit 100`;
    const incidents = await q<{ id: number; rule_id: string; status: string; evidence: Record<string, unknown> | null; first_seen_at: Date; last_seen_at: Date; decided_at: Date | null; decision_note: string | null }[]>`
      select id, rule_id, status, evidence, first_seen_at, last_seen_at, decided_at, decision_note
      from security_incidents where user_id = ${id} order by created_at desc, id desc limit 50`;
    const appeals = await q<{ id: number; kind: string; message: string; status: string; staff_response: string | null; warning_id: number | null; created_at: Date; decided_at: Date | null }[]>`
      select id, kind, message, status, staff_response, warning_id, created_at, decided_at
      from account_appeals where user_id = ${id} order by created_at desc, id desc limit 50`;
    const logins = await q<{ id: number; success: boolean; failure_reason: string | null; ip: string | null; user_agent: string | null; created_at: Date }[]>`
      select id, success, failure_reason, ip, user_agent, created_at
      from login_activity where user_id = ${id} order by created_at desc, id desc limit 50`;
    const now = Date.now();
    return {
      user,
      security: await securityStatus(q, id),
      orders: orders.map((o) => ({
        id: o.id, at: ms(o.created_at), kind: o.kind, status: o.status, currency: o.currency, total: Number(o.total),
        totalInr: Number(o.total_inr), method: o.method, lines: o.lines, coupon: o.coupon_code, paidAt: ms(o.paid_at), refundedAt: ms(o.refunded_at),
      })),
      entitlements: ents.map((e) => ({ ...pubEntitlement(e, e.scope === 'worksheet' ? e.price_inr : null), revoked: ms(e.revoked_at), revokeReason: e.revoke_reason })),
      sessions: sessions.map((s) => ({
        id: s.id, device: s.device_label, ip: s.ip, country: s.country, createdAt: ms(s.created_at), lastActiveAt: ms(s.last_seen_at),
        expiresAt: ms(s.expires_at), remember: s.remember, staff: s.is_staff, status: sessionStatus(s), revokedAt: ms(s.revoked_at),
        revokeReason: s.revoke_reason, blockedAt: ms(s.blocked_at), blockReason: s.block_reason,
      })),
      warnings: warnings.map((w) => ({
        id: w.id, incidentId: w.incident_id, level: w.level, reason: w.reason, issuedAt: ms(w.issued_at), expiresAt: ms(w.expires_at),
        acknowledgedAt: ms(w.acknowledged_at), revokedAt: ms(w.revoked_at), revokeReason: w.revoke_reason,
        status: w.revoked_at ? 'revoked' : w.expires_at && new Date(w.expires_at).getTime() <= now ? 'expired' : 'active',
      })),
      incidents: incidents.map((i) => ({
        id: i.id, rule: i.rule_id, status: i.status, summary: typeof i.evidence?.summary === 'string' ? i.evidence.summary : null,
        evidence: i.evidence, firstSeenAt: ms(i.first_seen_at), lastSeenAt: ms(i.last_seen_at), decidedAt: ms(i.decided_at), decisionNote: i.decision_note,
      })),
      appeals: appeals.map((a) => ({
        id: a.id, kind: a.kind, message: a.message, status: a.status, response: a.staff_response, warningId: a.warning_id,
        createdAt: ms(a.created_at), decidedAt: ms(a.decided_at),
      })),
      logins: logins.map((l) => ({ id: l.id, success: l.success, reason: l.failure_reason, ip: l.ip, userAgent: l.user_agent, at: ms(l.created_at) })),
    };
  });
}

/** Account-level actions on a staff account need staff.manage too (and an owner for an owner
 *  or admin); nobody blocks or signs out their own account this way. The acting staff
 *  member's rights are read again here, inside the transaction. */
async function guardTarget(q: Tx, ctx: Ctx, userId: string, o: { allowSelf?: boolean } = {}) {
  const actorId = ctx.user!.id;
  if (userId === actorId && !o.allowSelf) {
    throw new HttpError(403, 'You cannot do this to your own account.', { code: 'self_change' });
  }
  if (userId === actorId) return;
  const rows = await q<StaffRec[]>`
    select user_id, role, permissions, active, note from staff_members where user_id = any(${[actorId, userId]}::uuid[])`;
  const target = rows.find((r) => r.user_id === userId);
  if (!target?.active) return;
  const actor = asInfo(rows.find((r) => r.user_id === actorId));
  if (!hasPermission(actor, 'staff.manage')) {
    throw new HttpError(403, 'This is a staff account — ask someone who manages staff.', { code: 'forbidden', permission: 'staff.manage' });
  }
  if (isTop(target.role) && actor!.role !== 'owner') {
    throw ownerOnly('Only an owner can do this to an owner or admin account.');
  }
}

/** PUT /api/admin/users/status {id|email, status, reason?} — the old switch, now the account block. */
async function setStatus(ctx: Ctx) {
  await requireStaff(ctx, 'customers.write');
  const b = await readJson(ctx.req, 16 * 1024);
  const status = String(b.status ?? '');
  if (status !== 'active' && status !== 'suspended') throw new HttpError(400, 'Status is active or suspended.');
  const rawId = String(b.id ?? '').trim().toLowerCase();
  const email = normEmail(b.email);
  const id = UUID_RE.test(rawId) ? rawId : null;
  if (!id && !validEmail(email)) throw new HttpError(404, NO_CUSTOMER);
  const reason = cleanText(b.reason, 500) || 'Suspended by staff';
  const user = await tx(async (q) => {
    const rows = id
      ? await q<{ id: string }[]>`select id from profiles where id = ${id}`
      : await q<{ id: string }[]>`select id from profiles where email = ${email}`;
    const p = rows[0] ? await lockProfilePair(q, ctx.user!.id, rows[0].id) : null;
    if (!p) throw new HttpError(404, NO_CUSTOMER);
    await guardTarget(q, ctx, p.id);
    if (status === 'suspended') {
      await blockAccount(q, ctx, p.id, reason);
    } else if (p.blocked_at) {
      await unblockAccount(q, ctx, p.id);
    } else if (!p.email_verified_at) {
      throw new HttpError(400, 'This customer has not confirmed their email yet.');
    }
    const fresh = await q<Profile[]>`select * from profiles where id = ${p.id}`;
    const st = await q<StaffInfo[]>`select role, permissions, active from staff_members where user_id = ${p.id} and active`;
    return publicUser(fresh[0], st[0] ?? null);
  });
  return { user };
}

async function block(ctx: Ctx) {
  await requireStaff(ctx, 'customers.write');
  const id = uuidParam(ctx, 'id', NO_CUSTOMER);
  const b = await readJson(ctx.req, 16 * 1024);
  const reason = cleanText(b.reason, 500);
  if (reason.length < 3) bad('reason', 'Say why the account is blocked (3 to 500 characters) — it goes in the audit log.');
  return await tx(async (q) => {
    if (!(await lockProfilePair(q, ctx.user!.id, id))) throw new HttpError(404, NO_CUSTOMER);
    await guardTarget(q, ctx, id);
    const changed = await blockAccount(q, ctx, id, reason);
    return { ok: true, changed, user: await oneUser(q, id) };
  });
}

async function unblock(ctx: Ctx) {
  await requireStaff(ctx, 'customers.write');
  const id = uuidParam(ctx, 'id', NO_CUSTOMER);
  return await tx(async (q) => {
    if (!(await lockProfilePair(q, ctx.user!.id, id))) throw new HttpError(404, NO_CUSTOMER);
    await guardTarget(q, ctx, id);
    const changed = await unblockAccount(q, ctx, id);
    return { ok: true, changed, user: await oneUser(q, id) };
  });
}

async function endSessions(ctx: Ctx) {
  const staff = await requireStaff(ctx, 'customers.write');
  const id = uuidParam(ctx, 'id', NO_CUSTOMER);
  return await tx(async (q) => {
    if (!(await q`select 1 from profiles where id = ${id}`).length) throw new HttpError(404, NO_CUSTOMER);
    await guardTarget(q, ctx, id, { allowSelf: true });
    // your own: every other sign-in ends, this one stays
    const keep = id === staff.id ? staff.sessionId : null;
    const ended = await endAllSessions(q, id, 'staff', keep);
    await audit(ctx, { action: 'account.sessions_end', targetType: 'profile', targetId: id, detail: { sessionsEnded: ended, keptCurrent: !!keep } }, q);
    await securityEvent(ctx, id, 'sessions.ended_by_staff', { by: staff.id, count: ended }, q);
    return { ok: true, ended, user: await oneUser(q, id) };
  });
}

/** Emails a password-reset link (never a password) through services/accounts.ts sendResetLink,
 *  the same path as "Forgot password". That service makes the one-time link (only its hash is
 *  stored) in its own transaction and sends the email after it, so the staff member's audit
 *  row is written first, with the checks, and a failed send gets a second row. */
async function sendPasswordReset(ctx: Ctx) {
  const staff = await requireStaff(ctx, 'customers.write');
  const id = uuidParam(ctx, 'id', NO_CUSTOMER);
  if (!mailReady()) throw new HttpError(503, 'Email is not set up yet, so no reset link can be sent.', { code: 'mail_unavailable' });
  await rateLimit(ctx, 'staff-reset', staff.id, 30, 3600);
  await rateLimit(ctx, 'staff-reset-user', id, 5, 3600, 'A reset link was sent to this customer several times already — wait an hour.');
  const email = await tx(async (q) => {
    const p = await q<{ email: string; blocked_at: Date | null }[]>`select email, blocked_at from profiles where id = ${id}`;
    if (!p[0]) throw new HttpError(404, NO_CUSTOMER);
    if (p[0].blocked_at) throw new HttpError(409, 'This account is blocked — unblock it before sending a reset link.', { code: 'account_blocked' });
    await guardTarget(q, ctx, id, { allowSelf: true });
    await audit(ctx, { action: 'account.password_reset_link', targetType: 'profile', targetId: id, detail: { email: p[0].email } }, q);
    return p[0].email;
  });
  if (!(await sendResetLink(ctx, id))) {
    // The link is left as it is: only its hash is stored, so an unsent link opens nothing, and
    // one the provider delivered despite reporting an error still works for the customer.
    await audit(ctx, { action: 'account.password_reset_failed', targetType: 'profile', targetId: id, detail: { email, error: 'mail_failed' } })
      .catch((e) => console.error('[admin] could not record the failed reset email:', (e as Error).message));
    throw new HttpError(502, 'We could not send the email — try again in a few minutes.', { code: 'mail_failed' });
  }
  return { ok: true, sent: true, email };
}

// ── staff ───────────────────────────────────────────────────────────────────────────────

type StaffRow = {
  user_id: string; role: string; permissions: string[]; active: boolean; note: string | null; created_at: Date; updated_at: Date;
  created_by: string | null; updated_by: string | null; email: string; name: string; last_login_at: Date | null; blocked_at: Date | null;
  label: string | null;
};

type Refs = { templates: Map<string, { label: string; permissions: string[] }>; keys: string[] };

async function loadRefs(q: Tx): Promise<Refs> {
  const t = await q<{ role: string; label: string; permissions: string[] }[]>`select role, label, permissions from staff_role_templates`;
  const keys = (await q<{ id: string }[]>`select id from staff_permissions order by id`).map((r) => r.id);
  return { templates: new Map(t.map((r) => [r.role, { label: r.label, permissions: r.permissions }])), keys };
}

function staffView(r: StaffRow, keys: string[]) {
  const info: StaffInfo = { role: r.role, permissions: r.permissions, active: r.active };
  return {
    userId: r.user_id,
    id: r.user_id,
    email: r.email,
    name: r.name,
    role: r.role,
    roleLabel: r.label,
    permissions: r.permissions,
    effectivePermissions: r.active ? effectivePermissions(info, keys) : [],
    active: r.active,
    note: r.note,
    createdAt: ms(r.created_at),
    updatedAt: ms(r.updated_at),
    createdBy: r.created_by,
    updatedBy: r.updated_by,
    lastLoginAt: ms(r.last_login_at),
    blocked: !!r.blocked_at,
  };
}

async function staffRows(q: Tx, userId: string | null): Promise<StaffRow[]> {
  return await q<StaffRow[]>`
    select st.user_id, st.role, st.permissions, st.active, st.note, st.created_at, st.updated_at, st.created_by, st.updated_by,
           p.email, p.name, p.last_login_at, p.blocked_at, t.label
    from staff_members st
    join profiles p on p.id = st.user_id
    left join staff_role_templates t on t.role = st.role
    where (${userId}::uuid is null or st.user_id = ${userId}::uuid)
    order by st.active desc, array_position(array['owner','admin','support','content','developer'], st.role), p.email`;
}

async function listStaff(ctx: Ctx) {
  await requireStaff(ctx, 'staff.manage');
  return await tx(async (q) => {
    const refs = await loadRefs(q);
    return { staff: (await staffRows(q, null)).map((r) => staffView(r, refs.keys)) };
  });
}

async function roles(ctx: Ctx) {
  await requireStaff(ctx, 'staff.manage');
  return await tx(async (q) => {
    const t = await q<{ role: string; label: string; permissions: string[] }[]>`
      select role, label, permissions from staff_role_templates
      order by array_position(array['owner','admin','support','content','developer'], role)`;
    return { roles: t, permissions: await allPermissions(q) };
  });
}

function parsePermissions(v: unknown, keys: string[]): string[] {
  if (!Array.isArray(v) || v.length > 100) bad('permissions', 'Permissions must be a list of permission names.');
  const out: string[] = [];
  for (const p of v as unknown[]) {
    if (typeof p !== 'string' || !keys.includes(p)) bad('permissions', `Unknown permission: ${String(p).slice(0, 40)}.`);
    if (!out.includes(p as string)) out.push(p as string);
  }
  return out.sort();
}

function parseRole(v: unknown, refs: Refs): string {
  const role = String(v ?? '');
  if (!(ROLES as readonly string[]).includes(role) || !refs.templates.has(role)) bad('role', 'Choose a role: owner, admin, support, content or developer.');
  return role;
}

/** What a staff manager may hand out: owner/admin roles and staff.manage only by an owner;
 *  a non-owner only gives permissions they hold themselves. */
function checkGrant(actor: StaffInfo, newRole: string, newPerms: string[], oldPerms: string[]) {
  if (actor.role === 'owner') return;
  if (newRole === 'owner' || newRole === 'admin') throw ownerOnly('Only an owner can give the owner or admin role.');
  const added = newPerms.filter((p) => !oldPerms.includes(p));
  if (added.includes('staff.manage')) throw ownerOnly('Only an owner can give the staff.manage permission.');
  const notHeld = added.filter((p) => !actor.permissions.includes(p));
  if (notHeld.length) {
    throw new HttpError(403, 'You can only give permissions you hold yourself.', { code: 'forbidden', permissions: notHeld });
  }
}

function noteOf(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  const n = cleanText(v, 1000);
  if (n.length > 300) bad('note', 'Keep the note under 300 characters.');
  return n || null;
}

/** POST /api/admin/staff {email, name?, role, permissions?, note?}: promotes an existing account,
 *  or creates one with a generated password that is emailed once (never shown or stored). */
async function createStaff(ctx: Ctx) {
  const actor = await requireStaff(ctx, 'staff.manage');
  const b = await readJson(ctx.req, 16 * 1024);
  const email = normEmail(b.email);
  if (!validEmail(email)) bad('email', 'Enter a valid email address.');
  const refs = await tx((q) => loadRefs(q));
  const role = parseRole(b.role, refs);
  const tpl = refs.templates.get(role)!;
  const perms = b.permissions === undefined || b.permissions === null ? [...tpl.permissions].sort() : parsePermissions(b.permissions, refs.keys);
  const note = noteOf(b.note);
  const name = b.name === undefined || b.name === null ? '' : cleanName(b.name);
  if (name.length > 80) bad('name', 'Keep the name under 80 characters.');
  checkGrant(actor.staff!, role, perms, []);
  await rateLimit(ctx, 'staff-create', actor.id, 20, 3600);

  const existing = await tx((q) => q<{ id: string; name: string; blocked_at: Date | null; email_verified_at: Date | null; st_role: string | null; st_active: boolean | null }[]>`
    select p.id, p.name, p.blocked_at, p.email_verified_at, st.role as st_role, st.active as st_active
    from profiles p left join staff_members st on st.user_id = p.id
    where p.email = ${email}`);
  const ex = existing[0];
  if (ex) {
    // promote (or re-activate) an existing account: no password is sent
    if (ex.id === actor.id) throw SELF();
    if (ex.st_active) throw new HttpError(409, 'This account is already on the staff list — change its role instead.', { code: 'staff_exists' });
    if (ex.blocked_at) throw new HttpError(409, 'This account is blocked — unblock it first.', { code: 'account_blocked' });
    if (!ex.email_verified_at) throw new HttpError(409, 'This account has not confirmed its email yet.', { code: 'email_unverified' });
    if (isTop(ex.st_role) && actor.staff!.role !== 'owner') throw ownerOnly('Only an owner can re-activate an owner or admin.');
    const view = await tx(async (q) => {
      // the same checks again, on locked rows
      const { actor: me, target: before } = await lockStaffPair(q, actor.id, ex.id);
      if (before?.active) throw new HttpError(409, 'This account is already on the staff list — change its role instead.', { code: 'staff_exists' });
      if (isTop(before?.role) && me.role !== 'owner') throw ownerOnly('Only an owner can re-activate an owner or admin.');
      checkGrant(me, role, perms, []);
      await q`
        insert into staff_members (user_id, role, permissions, active, note, created_by, updated_by)
        values (${ex.id}, ${role}, ${perms}::text[], true, ${note}, ${actor.id}, ${actor.id})
        on conflict (user_id) do update set role = excluded.role, permissions = excluded.permissions, active = true,
          note = coalesce(excluded.note, staff_members.note), updated_by = excluded.updated_by`;
      if (name) await q`update profiles set name = ${name} where id = ${ex.id}`;
      await audit(ctx, {
        action: 'staff.create', targetType: 'profile', targetId: ex.id,
        detail: { email, role, permissions: perms, promoted: true, before: before ? { role: before.role, permissions: before.permissions, active: before.active } : null },
      }, q);
      await securityEvent(ctx, ex.id, 'staff.added', { by: actor.id, role }, q);
      return staffView((await staffRows(q, ex.id))[0], refs.keys);
    });
    return { ok: true, created: false, promoted: true, passwordEmailed: false, staff: view };
  }

  // a new account: the password is generated here and emailed once
  if (!mailReady()) {
    throw new HttpError(503, 'Email is not set up yet, so a new staff account cannot get its password. Set up email, or add someone who already has an account.', { code: 'mail_unavailable' });
  }
  const password = generatePassword();
  const displayName = name || email.split('@')[0].slice(0, 80);
  let userId: string;
  try {
    userId = (await adminCreateUser({ email, password, name: displayName, via: 'staff', confirmed: true })).id;
  } catch (e) {
    if (e instanceof AuthApiError && /exist|registered/i.test(`${e.code} ${e.message}`)) {
      throw new HttpError(409, 'An account with this email already exists — try again to add it.', { code: 'staff_exists' });
    }
    if (e instanceof AuthApiError) {
      console.error('[admin] staff account not created:', e.status, e.code);
      throw new HttpError(502, 'Sign-in service refused the new account — try again later.', { code: 'auth_error' });
    }
    throw e;
  }
  if (!UUID_RE.test(userId)) throw new HttpError(502, 'Sign-in service returned an unexpected answer.', { code: 'auth_error' });

  let view;
  try {
    view = await tx(async (q) => {
      checkGrant((await lockStaffPair(q, actor.id, userId)).actor, role, perms, []);
      await q`
        update profiles set name = ${displayName}, status = 'active', email_verified_at = coalesce(email_verified_at, now()),
          created_via = 'staff'
        where id = ${userId}`;
      await q`
        insert into staff_members (user_id, role, permissions, active, note, created_by, updated_by)
        values (${userId}, ${role}, ${perms}::text[], true, ${note}, ${actor.id}, ${actor.id})`;
      await audit(ctx, { action: 'staff.create', targetType: 'profile', targetId: userId, detail: { email, role, permissions: perms, promoted: false } }, q);
      await securityEvent(ctx, userId, 'staff.added', { by: actor.id, role, newAccount: true }, q);
      return staffView((await staffRows(q, userId))[0], refs.keys);
    });
  } catch (e) {
    await adminDeleteUser(userId).catch((err) => console.error('[admin] could not remove half-made staff account:', (err as Error).message));
    throw e;
  }

  const mail = staffWelcome({ name: displayName, email, password, role: tpl.label, adminUrl: `${env().siteUrl}/admin` });
  const sent = await sendSensitive({ ...mail, to: email, template: 'staff_welcome', userId, relatedType: 'staff_member', relatedId: userId });
  if (!sent.ok) {
    // nobody knows the password: remove the account again
    let removed = true;
    try {
      await adminDeleteUser(userId);
    } catch (err) {
      removed = false;
      console.error('[admin] could not remove staff account after a failed email:', (err as Error).message);
    }
    await tx(async (q) => {
      if (!removed) {
        await q`update staff_members set active = false, updated_by = ${actor.id} where user_id = ${userId}`;
        await endAllSessions(q, userId, 'staff');
      }
      await audit(ctx, { action: 'staff.create_failed', targetType: 'profile', targetId: userId, detail: { email, removed, error: 'mail_failed' } }, q);
    }).catch((err) => console.error('[admin] could not record the failed staff email:', (err as Error).message));
    throw new HttpError(502, 'We could not send the email with the password, so the staff account was not created. Try again in a few minutes.', { code: 'mail_failed' });
  }
  return { ok: true, created: true, promoted: false, passwordEmailed: true, staff: view };
}

/** Changes a staff record. `change` holds only the fields that were sent. */
async function changeStaff(ctx: Ctx, userId: string, change: { role?: string; permissions?: string[]; active?: boolean; note?: string | null }, action: string) {
  const actor = ctx.user!;
  const touchesAccess = change.role !== undefined || change.permissions !== undefined || change.active !== undefined;
  if (userId === actor.id && touchesAccess) throw SELF();
  try {
    return await tx(async (q) => {
      const refs = await loadRefs(q);
      const { actor: me, target: c } = await lockStaffPair(q, actor.id, userId);
      if (!c) throw new HttpError(404, 'Not found');
      if (isTop(c.role) && me.role !== 'owner') throw ownerOnly('Only an owner can change an owner or admin.');
      const role = change.role ?? c.role;
      const permissions = change.permissions ?? (change.role !== undefined && change.role !== c.role
        ? [...refs.templates.get(role)!.permissions].sort()
        : c.permissions);
      const active = change.active ?? c.active;
      const note = change.note !== undefined ? change.note : c.note;
      checkGrant(me, role, permissions, c.active ? c.permissions : []);
      if (active && !c.active) {
        const p = await q<{ blocked_at: Date | null }[]>`select blocked_at from profiles where id = ${userId}`;
        if (p[0]?.blocked_at) throw new HttpError(409, 'This account is blocked — unblock it first.', { code: 'account_blocked' });
      }
      await q`
        update staff_members set role = ${role}, permissions = ${permissions}::text[], active = ${active}, note = ${note},
          updated_by = ${actor.id}
        where user_id = ${userId}`;
      const ended = c.active && !active ? await endAllSessions(q, userId, 'staff') : 0;
      await audit(ctx, {
        action, targetType: 'profile', targetId: userId,
        detail: { before: { role: c.role, permissions: c.permissions, active: c.active, note: c.note }, after: { role, permissions, active, note }, sessionsEnded: ended },
      }, q);
      if (c.active !== active || c.role !== role) {
        await securityEvent(ctx, userId, active ? 'staff.changed' : 'staff.deactivated', { by: actor.id, role, active }, q);
      }
      return { ok: true, sessionsEnded: ended, staff: staffView((await staffRows(q, userId))[0], refs.keys) };
    });
  } catch (e) {
    throw staffDbError(e);
  }
}

async function updateStaff(ctx: Ctx) {
  await requireStaff(ctx, 'staff.manage');
  const userId = uuidParam(ctx, 'userId');
  const b = await readJson(ctx.req, 16 * 1024);
  const refs = await tx((q) => loadRefs(q));
  const change: { role?: string; permissions?: string[]; active?: boolean; note?: string | null } = {};
  if (b.role !== undefined) change.role = parseRole(b.role, refs);
  if (b.permissions !== undefined) change.permissions = parsePermissions(b.permissions, refs.keys);
  if (b.active !== undefined) {
    if (typeof b.active !== 'boolean') bad('active', 'Active is true or false.');
    change.active = b.active as boolean;
  }
  if (b.note !== undefined) change.note = noteOf(b.note);
  if (!Object.keys(change).length) bad('role', 'Send role, permissions, active or note.');
  return await changeStaff(ctx, userId, change, 'staff.update');
}

async function deactivateStaff(ctx: Ctx) {
  await requireStaff(ctx, 'staff.manage');
  const userId = uuidParam(ctx, 'userId');
  return await changeStaff(ctx, userId, { active: false }, 'staff.deactivate');
}

// ── contact inbox ───────────────────────────────────────────────────────────────────────

type MessageRow = {
  id: number; created_at: Date; name: string; email: string; body: string; user_id: string | null; status: string;
  read_at: Date | null; read_by: string | null; replied_at: Date | null; replied_by: string | null; mailed: boolean; mail_error: string | null;
};

/** The old Message shape plus status and who handled it. */
const messageView = (m: MessageRow) => ({
  id: m.id, at: ms(m.created_at), name: m.name, email: m.email, body: m.body, read: ms(m.read_at), replied: ms(m.replied_at),
  mailed: m.mailed, mailError: m.mail_error, user: m.user_id,
  status: m.status, readBy: m.read_by, repliedBy: m.replied_by,
});

async function listMessages(ctx: Ctx) {
  await requireStaff(ctx, 'messages.read');
  const status = ctx.query.get('status') || null;
  if (status && !(MESSAGE_STATUSES as readonly string[]).includes(status)) bad('status', 'Status is new, read, replied or archived.');
  const limit = intParam(ctx.query.get('limit'), 500, 1, 2000);
  const offset = intParam(ctx.query.get('offset'), 0, 0, 1_000_000);
  const out = await tx(async (q) => {
    const rows = await q<MessageRow[]>`
      select id, created_at, name, email, body, user_id, status, read_at, read_by, replied_at, replied_by, mailed, mail_error
      from contact_messages where (${status}::text is null or status = ${status}::text)
      order by created_at desc, id desc limit ${limit} offset ${offset}`;
    const c = await q<{ total: number; unread: number }[]>`
      select count(*)::int as total, count(*) filter (where read_at is null)::int as unread from contact_messages`;
    return { rows, total: c[0]?.total ?? 0, unread: c[0]?.unread ?? 0, inbox: (await getSettings(q)).contact.inbox };
  });
  return { messages: out.rows.map(messageView), inbox: out.inbox, mail: mailReady(), total: out.total, unread: out.unread, limit, offset };
}

async function lockMessage(q: Tx, id: number | null): Promise<MessageRow> {
  if (id === null) throw new HttpError(404, NO_MESSAGE);
  const r = await q<MessageRow[]>`
    select id, created_at, name, email, body, user_id, status, read_at, read_by, replied_at, replied_by, mailed, mail_error
    from contact_messages where id = ${id} for update`;
  if (!r[0]) throw new HttpError(404, NO_MESSAGE);
  return r[0];
}

async function reloadMessage(q: Tx, id: number) {
  const r = await q<MessageRow[]>`
    select id, created_at, name, email, body, user_id, status, read_at, read_by, replied_at, replied_by, mailed, mail_error
    from contact_messages where id = ${id}`;
  return messageView(r[0]);
}

/** Moves a message to `status` (timestamps kept consistent) and audits the change. */
async function applyStatus(q: Tx, ctx: Ctx, m: MessageRow, status: typeof MESSAGE_STATUSES[number], action: string, extra: Record<string, unknown> = {}) {
  const by = ctx.user!.id;
  if (status === 'new') {
    await q`update contact_messages set status = 'new', read_at = null, read_by = null where id = ${m.id}`;
  } else if (status === 'read') {
    // the old "read" never moves a replied or archived note back
    await q`
      update contact_messages set read_at = coalesce(read_at, now()), read_by = coalesce(read_by, ${by}),
        status = case when status = 'new' then 'read' else status end
      where id = ${m.id}`;
  } else if (status === 'replied') {
    await q`
      update contact_messages set replied_at = now(), replied_by = ${by}, read_at = coalesce(read_at, now()),
        read_by = coalesce(read_by, ${by}), status = 'replied'
      where id = ${m.id}`;
  } else {
    await q`
      update contact_messages set status = 'archived', read_at = coalesce(read_at, now()), read_by = coalesce(read_by, ${by})
      where id = ${m.id}`;
  }
  const after = status === 'read' && m.status !== 'new' ? m.status : status;
  await audit(ctx, { action, targetType: 'contact_message', targetId: m.id, detail: { before: m.status, after, ...extra } }, q);
}

/** POST /api/admin/messages/read|replied {id} — the old panel calls. */
function oldMark(kind: 'read' | 'replied') {
  return async (ctx: Ctx) => {
    await requireStaff(ctx, 'messages.write');
    const b = await readJson(ctx.req, 4096);
    const id = idOf(b.id);
    const message = await tx(async (q) => {
      const m = await lockMessage(q, id);
      await applyStatus(q, ctx, m, kind, kind === 'read' ? 'message.read' : 'message.replied');
      return await reloadMessage(q, m.id);
    });
    return { ok: true, message };
  };
}

async function setMessageStatus(ctx: Ctx) {
  await requireStaff(ctx, 'messages.write');
  const id = idOf(ctx.params.id);
  const b = await readJson(ctx.req, 4096);
  const status = String(b.status ?? '');
  if (!(MESSAGE_STATUSES as readonly string[]).includes(status)) bad('status', 'Status is new, read, replied or archived.');
  const message = await tx(async (q) => {
    const m = await lockMessage(q, id);
    await applyStatus(q, ctx, m, status as typeof MESSAGE_STATUSES[number], 'message.status');
    return await reloadMessage(q, m.id);
  });
  return { ok: true, message };
}

function replyEmail(o: { name: string; body: string; original: string; at: Date; staffName: string }): Email {
  const subject = 'Re: your note to Learn With Why';
  const para = (s: string) => `<p style="margin:0 0 12px;white-space:pre-wrap">${escapeHtml(s)}</p>`;
  const html = `<!doctype html><html><body style="margin:0;background:#f6f3ea;font-family:Arial,Helvetica,sans-serif;color:#24312a">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:14px;padding:28px">
<tr><td style="font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#1f6b47;font-weight:bold">Learn With Why</td></tr>
<tr><td style="padding-top:14px;font-size:15px;line-height:1.55">${para(`Hello ${o.name},`)}${para(o.body)}${para(`— ${o.staffName}, Learn With Why`)}
<blockquote style="margin:18px 0 0;padding:12px 16px;background:#f1efe6;border-radius:10px;color:#4b5a51;white-space:pre-wrap">${escapeHtml(`Your note of ${fmtDateTime(o.at)}:\n\n${o.original}`)}</blockquote></td></tr>
</table></td></tr></table></body></html>`;
  const quoted = o.original.split('\n').map((l) => `> ${l}`).join('\n');
  const text = `Hello ${o.name},\n\n${o.body}\n\n— ${o.staffName}, Learn With Why\n\nYour note of ${fmtDateTime(o.at)}:\n${quoted}\n`;
  return { subject, html, text };
}

/** POST /api/admin/messages/:id/reply {body}: emails the sender (reply-to = the shop inbox). */
async function replyMessage(ctx: Ctx) {
  const staff = await requireStaff(ctx, 'messages.write');
  const id = idOf(ctx.params.id);
  const b = await readJson(ctx.req, 32 * 1024);
  const body = cleanText(b.body ?? b.message, 6000);
  if (body.length < 2) bad('body', 'Write the reply first.');
  if (body.length > 5000) bad('body', 'Keep the reply under 5000 characters.');
  await rateLimit(ctx, 'staff-reply', staff.id, 60, 3600);
  const out = await tx(async (q) => {
    const m = await lockMessage(q, id);
    const settings = await getSettings(q);
    const inbox = validEmail(normEmail(settings.contact.inbox)) ? normEmail(settings.contact.inbox) : null;
    const mail = replyEmail({ name: m.name, body, original: m.body, at: m.created_at, staffName: staff.profile.name || 'The team' });
    // related_type is not 'contact_message', so the outbox never overwrites the note's own mailed flag
    const outboxId = await enqueue(q, {
      template: 'contact_reply', to: m.email, userId: m.user_id, replyTo: inbox, subject: mail.subject, html: mail.html, text: mail.text,
      relatedType: 'contact_reply', relatedId: m.id,
    });
    await applyStatus(q, ctx, m, 'replied', 'message.reply', { outboxId, to: m.email, chars: body.length });
    if (m.user_id) {
      await notify(q, { audience: 'customer', userId: m.user_id, kind: 'message.reply', title: 'We answered your note', body: 'Check your email for our reply.' });
    }
    return { message: await reloadMessage(q, m.id), outboxId };
  });
  kickOutbox(ctx);
  return { ok: true, queued: true, outboxId: out.outboxId, message: out.message };
}

export function register(r: Router) {
  r.get('/api/admin/me', me);

  r.get('/api/admin/users', listUsers);
  r.put('/api/admin/users/status', setStatus);
  r.get('/api/admin/users/:id', getUser);
  r.post('/api/admin/users/:id/block', block);
  r.post('/api/admin/users/:id/unblock', unblock);
  r.post('/api/admin/users/:id/sessions/end-all', endSessions);
  r.post('/api/admin/users/:id/password-reset', sendPasswordReset);

  r.get('/api/admin/staff/roles', roles);
  r.get('/api/admin/staff', listStaff);
  r.post('/api/admin/staff', createStaff);
  r.put('/api/admin/staff/:userId', updateStaff);
  r.delete('/api/admin/staff/:userId', deactivateStaff);

  r.get('/api/admin/messages', listMessages);
  r.post('/api/admin/messages/read', oldMark('read'));
  r.post('/api/admin/messages/replied', oldMark('replied'));
  r.post('/api/admin/messages/:id/status', setMessageStatus);
  r.post('/api/admin/messages/:id/reply', replyMessage);
}
