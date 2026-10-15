// Staff operations (DESIGN.md §4.G): the dashboard and analytics numbers, the email outbox, the
// audit log, staff notifications, CSV exports and the configuration backup, developer
// diagnostics, the site text, FAQ answers and review moderation.
// Numbers come from real rows only (services/analytics.ts). Lists never show email bodies, and
// nothing here returns a secret, a token or an environment value. Every staff write is audited in
// the same transaction; emails are sent outside transactions (lib/mail.ts).
import type { Router } from '../lib/router.ts';
import type { Ctx } from '../lib/context.ts';
import { tx, type Tx } from '../lib/db.ts';
import { env, envReport, gatewayModes, mailReady } from '../lib/env.ts';
import { HttpError, intParam, json, readJson } from '../lib/http.ts';
import { hasPermission, requireStaff } from '../lib/auth.ts';
import { audit, rateLimit } from '../lib/guard.ts';
import { kickOutbox, processOutbox } from '../lib/mail.ts';
import { cleanText, fromMinor } from '../lib/util.ts';
import { analyticsReport, dashboardStats, resolveBounds, resolveRange, tzOf } from '../services/analytics.ts';
import { attachmentName, downloadResponse, toCsv, type CsvColumn } from '../services/csv.ts';
import { entStatus, type EntRow } from '../services/entitlements.ts';

const FORBIDDEN = 'Your staff role does not allow this.';
const NO_EMAIL = 'No such email.';
const NO_FAQ = 'No such answer.';
const NO_REVIEW = 'No such review.';
const ID_RE = /^[1-9][0-9]{0,15}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PRODUCT_RE = /^[A-Za-z0-9][A-Za-z0-9-]{1,63}$/;
const TEMPLATE_RE = /^[a-z_]{2,40}$/;
const CONTENT_KEY_RE = /^[a-z0-9_.-]{1,64}$/;
const ORDER_STATUSES = ['created', 'paid', 'failed', 'cancelled', 'refunded', 'expired'] as const;
const PAYMENT_STATUSES = ['captured', 'authorized', 'refunded'] as const;
const MESSAGE_STATUSES = ['new', 'read', 'replied', 'archived'] as const;
// gave_up = failed for good; waiting = will be tried again; due = waiting and its time has come
const EMAIL_FILTERS = ['queued', 'sending', 'sent', 'failed', 'skipped', 'gave_up', 'waiting', 'due'] as const;
const FAQ_AUDIENCES = ['public', 'staff'] as const;
const FAQ_STATUSES = ['published', 'draft', 'planned'] as const;
const REVIEW_STATUSES = ['pending', 'published', 'hidden'] as const;
// email_outbox.max_attempts is 1..20 (table check)
const MAX_ATTEMPTS_CAP = 20;
const EXPORT_MAX = 25_000;
const CONTENT_MAX_KEYS = 100;

const ms = (d: Date | string | null | undefined) => (d == null ? null : new Date(d).getTime());
const iso = (d: Date | string | null | undefined) => (d == null ? null : new Date(d).toISOString());
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const forbidden = (permission: string, message = FORBIDDEN) => new HttpError(403, message, { code: 'forbidden', permission });
const invalid = (errors: Record<string, string>, message?: string) => new HttpError(400, message ?? Object.values(errors)[0], { errors });
const notFound = (message = 'Not found') => new HttpError(404, message, { code: 'not_found' });
const likePattern = (s: string) => '%' + s.replace(/[\\%_]/g, (c) => '\\' + c) + '%';
const nextOffset = (offset: number, n: number, total: number) => (offset + n < total ? offset + n : null);

/** A positive row id from a number or numeric string; null otherwise. */
function idOf(v: unknown): number | null {
  const s = typeof v === 'number' ? String(v) : typeof v === 'string' ? v.trim() : '';
  if (!ID_RE.test(s)) return null;
  const n = Number(s);
  return Number.isSafeInteger(n) ? n : null;
}

function idParam(ctx: Ctx, message: string): number {
  const id = idOf(ctx.params.id);
  if (id === null) throw notFound(message);
  return id;
}

function oneOf<T extends string>(v: string | null, list: readonly T[], field: string, message: string): T | null {
  if (v === null || v === '') return null;
  if (!(list as readonly string[]).includes(v)) throw invalid({ [field]: message });
  return v as T;
}

function flag(v: string | null, field: string): boolean | null {
  if (v === null || v === '') return null;
  if (['1', 'true', 'yes'].includes(v)) return true;
  if (['0', 'false', 'no'].includes(v)) return false;
  throw invalid({ [field]: `${field} is true or false.` });
}

function paging(ctx: Ctx, def: number, max: number) {
  return { limit: intParam(ctx.query.get('limit'), def, 1, max), offset: intParam(ctx.query.get('offset'), 0, 0, 1_000_000) };
}

/** JSON with object keys sorted, so a value read back from jsonb compares equal to the same value. */
function stable(v: unknown): string {
  if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
  if (isObj(v)) return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}';
  return JSON.stringify(v ?? null);
}

// ── GET /api/admin/stats ─────────────────────────────────────────────────────────────────

async function stats(ctx: Ctx) {
  await requireStaff(ctx, 'dashboard.view');
  const tz = tzOf(ctx.query.get('tz'));
  const modes = gatewayModes();
  const s = await tx((q) => dashboardStats(q, tz));
  // the old body first ({ gateway, gateways, users, paid_orders, revenue_inr, … }), then the new fields
  return { gateway: modes.razorpay, gateways: modes, ...s, mail: mailReady() ? env().mail.provider : 'none', generatedAt: Date.now() };
}

// ── GET /api/admin/analytics?from=&to=&tz=&days= ─────────────────────────────────────────

async function analyticsPage(ctx: Ctx) {
  const u = await requireStaff(ctx, 'analytics.read');
  const sp = ctx.query;
  const input = { from: sp.get('from'), to: sp.get('to'), tz: sp.get('tz'), days: sp.get('days') };
  tzOf(input.tz); // a bad zone is a 400 before anything is counted
  await rateLimit(ctx, 'admin_analytics', u.id, 60, 60);
  return await tx(async (q) => analyticsReport(q, await resolveRange(q, input)), { timeoutMs: 30_000 });
}

// ── the email outbox ─────────────────────────────────────────────────────────────────────

type EmailRow = {
  id: number; template: string; to_email: string; to_user_id: string | null; reply_to: string | null; subject: string;
  sensitive: boolean; status: string; attempts: number; max_attempts: number; next_attempt_at: Date; locked_at: Date | null;
  last_error: string | null; provider: string | null; provider_message_id: string | null; dedupe_key: string | null;
  related_type: string | null; related_id: string | null; created_at: Date; sent_at: Date | null; stale: boolean;
};

// Never the bodies: sensitive rows have none, and lists do not show them for any row.
const EMAIL_SELECT = (q: Tx) => q`
  select id, template, to_email::text as to_email, to_user_id, reply_to, subject, sensitive, status, attempts,
         max_attempts, next_attempt_at, locked_at, last_error, provider, provider_message_id, dedupe_key,
         related_type, related_id, created_at, sent_at,
         (status = 'sending' and locked_at < now() - interval '10 minutes') as stale
  from email_outbox`;

function emailView(e: EmailRow) {
  const waiting = !e.sensitive && (e.status === 'queued' || e.status === 'failed') && e.attempts < e.max_attempts;
  const sendingStuck = e.status === 'sending' && e.stale;
  return {
    id: e.id,
    template: e.template,
    to: e.to_email,
    userId: e.to_user_id,
    replyTo: e.reply_to,
    subject: e.subject,
    sensitive: e.sensitive,
    status: e.status,
    attempts: e.attempts,
    maxAttempts: e.max_attempts,
    gaveUp: e.status === 'failed' && e.attempts >= e.max_attempts,
    lastError: e.last_error,
    provider: e.provider,
    providerMessageId: e.provider_message_id,
    dedupeKey: e.dedupe_key,
    related: e.related_type ? { type: e.related_type, id: e.related_id } : null,
    createdAt: ms(e.created_at),
    sentAt: ms(e.sent_at),
    nextAttemptAt: waiting ? ms(e.next_attempt_at) : null,
    lockedAt: ms(e.locked_at),
    // what the buttons may do (checked again by the server)
    canRetry: !e.sensitive && e.attempts < MAX_ATTEMPTS_CAP && (['queued', 'failed', 'skipped'].includes(e.status) || sendingStuck),
    canSkip: e.status === 'queued' || e.status === 'failed' || sendingStuck,
  };
}

async function outboxCounts(q: Tx) {
  const r = (await q<{ queued: number; sending: number; sent: number; failed: number; skipped: number; gave_up: number; waiting: number; due: number; total: number }[]>`
    select count(*) filter (where status = 'queued')::int as queued,
           count(*) filter (where status = 'sending')::int as sending,
           count(*) filter (where status = 'sent')::int as sent,
           count(*) filter (where status = 'failed')::int as failed,
           count(*) filter (where status = 'skipped')::int as skipped,
           count(*) filter (where status = 'failed' and attempts >= max_attempts)::int as gave_up,
           count(*) filter (where not sensitive and status in ('queued', 'failed') and attempts < max_attempts)::int as waiting,
           count(*) filter (where not sensitive and status in ('queued', 'failed') and attempts < max_attempts
                              and next_attempt_at <= now())::int as due,
           count(*)::int as total
    from email_outbox`)[0];
  return {
    queued: r.queued, sending: r.sending, sent: r.sent, failed: r.failed, skipped: r.skipped, gaveUp: r.gave_up,
    waiting: r.waiting, due: r.due, total: r.total,
  };
}

/** GET /api/admin/emails?status=&template=&sensitive=&q=&limit=&offset= (newest first). */
async function listEmails(ctx: Ctx) {
  await requireStaff(ctx, 'emails.read');
  const sp = ctx.query;
  const status = oneOf(sp.get('status'), EMAIL_FILTERS, 'status', `Status is ${EMAIL_FILTERS.join(', ')}.`);
  const template = sp.get('template') || null;
  if (template && !TEMPLATE_RE.test(template)) throw invalid({ template: 'Unknown template.' });
  const sensitive = flag(sp.get('sensitive'), 'sensitive');
  const text = cleanText(sp.get('q'), 100);
  const like = text ? likePattern(text) : null;
  const { limit, offset } = paging(ctx, 100, 500);
  const where = (q: Tx) => q`
    where (${status}::text is null
           or (${status}::text = 'gave_up' and status = 'failed' and attempts >= max_attempts)
           or (${status}::text in ('waiting', 'due') and not sensitive and status in ('queued', 'failed') and attempts < max_attempts
               and (${status}::text = 'waiting' or next_attempt_at <= now()))
           or status = ${status}::text)
      and (${template}::text is null or template = ${template}::text)
      and (${sensitive}::boolean is null or sensitive = ${sensitive}::boolean)
      and (${like}::text is null or to_email::text ilike ${like}::text or subject ilike ${like}::text)`;
  const out = await tx(async (q) => {
    const rows = await q<EmailRow[]>`${EMAIL_SELECT(q)} ${where(q)} order by created_at desc, id desc limit ${limit} offset ${offset}`;
    const total = (await q<{ n: number }[]>`select count(*)::int as n from email_outbox ${where(q)}`)[0].n;
    return { rows, total, counts: await outboxCounts(q) };
  });
  return {
    emails: out.rows.map(emailView), counts: out.counts, total: out.total, limit, offset,
    nextOffset: nextOffset(offset, out.rows.length, out.total), mail: mailReady() ? env().mail.provider : 'none',
  };
}

async function lockEmail(q: Tx, id: number): Promise<EmailRow> {
  const r = await q<EmailRow[]>`${EMAIL_SELECT(q)} where id = ${id} for update`;
  if (!r[0]) throw notFound(NO_EMAIL);
  return r[0];
}

async function reloadEmail(q: Tx, id: number) {
  return emailView((await q<EmailRow[]>`${EMAIL_SELECT(q)} where id = ${id}`)[0]);
}

/** POST /api/admin/emails/:id/retry — queue a failed, skipped or waiting email to go out now. */
async function retryEmail(ctx: Ctx) {
  await requireStaff(ctx, 'emails.write');
  const id = idParam(ctx, NO_EMAIL);
  const email = await tx(async (q) => {
    const cur = await lockEmail(q, id);
    if (cur.sensitive) {
      throw new HttpError(409, 'This email held a password or a one-time link, so its text was never stored and it cannot be sent again. Ask the customer to request a new link, or send a password reset.', { code: 'sensitive' });
    }
    if (cur.status === 'sent') throw new HttpError(409, 'This email was already sent.', { code: 'already_sent' });
    if (cur.status === 'sending' && !cur.stale) throw new HttpError(409, 'This email is being sent right now — check again in a minute.', { code: 'sending' });
    if (cur.attempts >= MAX_ATTEMPTS_CAP) {
      throw new HttpError(409, `This email was tried ${cur.attempts} times — skip it and send a fresh one instead.`, { code: 'too_many_attempts' });
    }
    // a few more tries with the usual back-off if this one fails too
    const maxAttempts = Math.min(MAX_ATTEMPTS_CAP, Math.max(cur.max_attempts, cur.attempts + 3));
    await q`
      update email_outbox set status = 'queued', next_attempt_at = now(), locked_at = null, max_attempts = ${maxAttempts}
      where id = ${id}`;
    await audit(ctx, {
      action: 'email.retry', targetType: 'email', targetId: id,
      detail: {
        template: cur.template, to: cur.to_email,
        before: { status: cur.status, attempts: cur.attempts, maxAttempts: cur.max_attempts, lastError: cur.last_error },
        after: { status: 'queued', maxAttempts },
      },
    }, q);
    return await reloadEmail(q, id);
  });
  kickOutbox(ctx); // sent just after this answer (outside any transaction)
  return { ok: true, queued: true, email };
}

/** POST /api/admin/emails/:id/skip {reason?} — this email will not be sent. */
async function skipEmail(ctx: Ctx) {
  await requireStaff(ctx, 'emails.write');
  const id = idParam(ctx, NO_EMAIL);
  const b = await readJson(ctx.req, 4096);
  if (b.reason !== undefined && b.reason !== null && typeof b.reason !== 'string') throw invalid({ reason: 'The reason must be text.' });
  const reason = typeof b.reason === 'string' ? cleanText(b.reason, 300) || null : null;
  const out = await tx(async (q) => {
    const cur = await lockEmail(q, id);
    if (cur.status === 'skipped') return { changed: false, email: emailView(cur) };
    if (cur.status === 'sent') throw new HttpError(409, 'This email was already sent.', { code: 'already_sent' });
    if (cur.status === 'sending' && !cur.stale) throw new HttpError(409, 'This email is being sent right now — check again in a minute.', { code: 'sending' });
    await q`update email_outbox set status = 'skipped', locked_at = null where id = ${id}`;
    await audit(ctx, {
      action: 'email.skip', targetType: 'email', targetId: id,
      detail: { template: cur.template, to: cur.to_email, before: { status: cur.status, attempts: cur.attempts }, after: { status: 'skipped' }, reason },
    }, q);
    return { changed: true, email: await reloadEmail(q, id) };
  });
  return { ok: true, ...out };
}

// A send can take up to 15 s when the provider hangs (lib/mail.ts), so a manual run stops
// claiming new emails after this long; whatever is left goes out on the next run or sweep.
const PROCESS_BUDGET_MS = 20_000;

/** POST /api/admin/emails/process {limit?} — send the emails that are due now (up to `limit`). */
async function processEmails(ctx: Ctx) {
  const u = await requireStaff(ctx, 'emails.write');
  const b = await readJson(ctx.req, 4096);
  const limit = b.limit === undefined || b.limit === null ? 10 : idOf(b.limit);
  if (limit === null || limit > 25) throw invalid({ limit: 'limit is a whole number from 1 to 25.' });
  await rateLimit(ctx, 'admin_outbox', u.id, 30, 60);
  // No transaction is open while emails go out: lib/mail.ts claims each row (SKIP LOCKED) and
  // records the result in transactions of its own. One email per claim, so a stop for time
  // never leaves claimed rows waiting for the 10-minute stale-lock rescue.
  const started = Date.now();
  let sent = 0, failed = 0, stoppedEarly = false;
  for (let i = 0; i < limit; i++) {
    if (Date.now() - started > PROCESS_BUDGET_MS) { stoppedEarly = true; break; }
    const r = await processOutbox(1);
    if (r.waiting) {
      throw new HttpError(503, 'Email is not set up yet — add BREVO_API_KEY or RESEND_API_KEY and MAIL_FROM to the function secrets.', { code: 'mail_unavailable' });
    }
    if (r.sent + r.failed === 0) break; // nothing more is due
    sent += r.sent;
    failed += r.failed;
  }
  const counts = await tx(async (q) => {
    await audit(ctx, { action: 'email.process', targetType: 'email_outbox', detail: { sent, failed, limit, stoppedEarly } }, q);
    return await outboxCounts(q);
  });
  return { ok: true, sent, failed, processed: sent + failed, stoppedEarly, counts };
}

// ── GET /api/admin/audit ─────────────────────────────────────────────────────────────────

type AuditRow = {
  id: number; at: Date; actor_id: string | null; actor_email: string | null; actor_role: string | null; action: string;
  target_type: string | null; target_id: string | null; ip: string | null; detail: unknown;
};

const auditView = (a: AuditRow) => ({
  // the old panel's { at, actor, action, detail }
  id: a.id,
  at: ms(a.at),
  actor: a.actor_email ?? (a.actor_id ? null : 'system'),
  action: a.action,
  detail: a.detail ?? null,
  // new
  actorId: a.actor_id,
  role: a.actor_role,
  targetType: a.target_type,
  targetId: a.target_id,
  ip: a.ip,
});

/** GET /api/admin/audit?action=order.refund|order.*&actor=<id|email|system>&targetType=&targetId=&q=&from=&to=&tz=&limit=&offset= */
async function listAudit(ctx: Ctx) {
  await requireStaff(ctx, 'audit.read');
  const sp = ctx.query;
  const actionRaw = (sp.get('action') ?? '').trim();
  let action: string | null = null, actionPrefix: string | null = null;
  if (actionRaw) {
    if (!/^[a-z_.]{1,80}\*?$/.test(actionRaw)) throw invalid({ action: 'Actions look like order.refund (or order.* for a group).' });
    if (actionRaw.endsWith('*') || actionRaw.endsWith('.')) actionPrefix = actionRaw.replace(/\*$/, '');
    else action = actionRaw;
  }
  const actorRaw = (sp.get('actor') ?? '').trim().toLowerCase();
  let actorId: string | null = null, actorEmail: string | null = null;
  const systemOnly = actorRaw === 'system';
  if (actorRaw && !systemOnly) {
    if (UUID_RE.test(actorRaw)) actorId = actorRaw;
    else if (actorRaw.length <= 254 && actorRaw.includes('@')) actorEmail = actorRaw;
    else throw invalid({ actor: 'Give a staff email, a user id or "system".' });
  }
  const targetType = sp.get('targetType') || sp.get('target_type') || null;
  if (targetType && !/^[a-z_]{1,40}$/.test(targetType)) throw invalid({ targetType: 'Unknown target type.' });
  const targetIdRaw = sp.get('targetId') ?? sp.get('target_id');
  const targetId = targetIdRaw ? cleanText(targetIdRaw, 200) || null : null;
  const text = cleanText(sp.get('q'), 100);
  const like = text ? likePattern(text) : null;
  const { limit, offset } = paging(ctx, 100, 500);
  tzOf(sp.get('tz'));
  const out = await tx(async (q) => {
    const b = await resolveBounds(q, { from: sp.get('from'), to: sp.get('to'), tz: sp.get('tz') });
    const where = (t: Tx) => t`
      where (${action}::text is null or a.action = ${action}::text)
        and (${actionPrefix}::text is null or starts_with(a.action, ${actionPrefix}::text))
        and (${actorId}::uuid is null or a.actor_id = ${actorId}::uuid)
        and (${actorEmail}::text is null or lower(coalesce(a.actor_email, p.email::text)) = ${actorEmail}::text)
        and (not ${systemOnly}::boolean or a.actor_id is null)
        and (${targetType}::text is null or a.target_type = ${targetType}::text)
        and (${targetId}::text is null or a.target_id = ${targetId}::text)
        and (${b.from}::timestamptz is null or a.at >= ${b.from}::timestamptz)
        and (${b.to}::timestamptz is null or a.at < ${b.to}::timestamptz)
        and (${like}::text is null or a.action ilike ${like}::text or a.actor_email ilike ${like}::text
             or a.target_type ilike ${like}::text or a.target_id ilike ${like}::text)`;
    const rows = await q<AuditRow[]>`
      select a.id, a.at, a.actor_id, coalesce(a.actor_email, p.email::text) as actor_email, a.actor_role, a.action,
             a.target_type, a.target_id, a.ip, a.detail
      from audit_logs a left join profiles p on p.id = a.actor_id
      ${where(q)}
      order by a.at desc, a.id desc limit ${limit} offset ${offset}`;
    const total = (await q<{ n: number }[]>`
      select count(*)::int as n from audit_logs a left join profiles p on p.id = a.actor_id ${where(q)}`)[0].n;
    return { rows, total };
  });
  return { audit: out.rows.map(auditView), total: out.total, limit, offset, nextOffset: nextOffset(offset, out.rows.length, out.total) };
}

// ── staff notifications ──────────────────────────────────────────────────────────────────

// A notification is shown to staff who may see what it is about (by the first part of its kind).
const NOTE_GROUPS: Record<string, string> = {
  order: 'orders.read', payment: 'orders.read', refund: 'orders.read',
  contact: 'messages.read', message: 'messages.read',
  security: 'security.read', appeal: 'security.read', access: 'security.read', warning: 'security.read', incident: 'security.read',
  review: 'reviews.moderate', email: 'emails.read', staff: 'staff.manage',
};
const NOTE_PERMS = [...new Set(['dashboard.view', ...Object.values(NOTE_GROUPS)])];

type NoteScope = { me: string; allowed: string[]; known: string[]; other: boolean };

function noteScope(ctx: Ctx): NoteScope {
  const st = ctx.user!.staff;
  return {
    me: ctx.user!.id,
    allowed: Object.entries(NOTE_GROUPS).filter(([, perm]) => hasPermission(st, perm)).map(([group]) => group),
    known: Object.keys(NOTE_GROUPS),
    // anything else (general notices) goes to staff who see the dashboard
    other: hasPermission(st, 'dashboard.view'),
  };
}

const noteWhere = (q: Tx, s: NoteScope) => q`
  n.audience = 'staff' and (n.user_id is null or n.user_id = ${s.me}::uuid)
  and (split_part(n.kind, '.', 1) = any(${s.allowed}::text[])
       or (${s.other}::boolean and split_part(n.kind, '.', 1) <> all(${s.known}::text[])))`;

type NoteRow = { id: number; kind: string; title: string; body: string | null; link: string | null; data: unknown; created_at: Date; read_at: Date | null };

const noteView = (n: NoteRow) => ({
  id: n.id, kind: n.kind, title: n.title, body: n.body, link: n.link, data: n.data ?? null,
  createdAt: ms(n.created_at), read: !!n.read_at, readAt: ms(n.read_at),
});

/** GET /api/admin/notifications?unread=1&limit=&offset= — the shared staff inbox (newest first). */
async function listNotifications(ctx: Ctx) {
  await requireStaff(ctx, NOTE_PERMS);
  const unreadOnly = flag(ctx.query.get('unread'), 'unread') === true;
  const { limit, offset } = paging(ctx, 50, 200);
  const s = noteScope(ctx);
  const out = await tx(async (q) => {
    const rows = await q<NoteRow[]>`
      select n.id, n.kind, n.title, n.body, n.link, n.data, n.created_at, n.read_at
      from notifications n
      where ${noteWhere(q, s)} and (${!unreadOnly}::boolean or n.read_at is null)
      order by n.created_at desc, n.id desc limit ${limit} offset ${offset}`;
    const c = (await q<{ total: number; unread: number }[]>`
      select count(*)::int as total, count(*) filter (where n.read_at is null)::int as unread
      from notifications n where ${noteWhere(q, s)}`)[0];
    return { rows, total: unreadOnly ? c.unread : c.total, unread: c.unread };
  });
  return {
    notifications: out.rows.map(noteView), unread: out.unread, total: out.total, limit, offset,
    nextOffset: nextOffset(offset, out.rows.length, out.total),
  };
}

/** POST /api/admin/notifications/read {ids: [..]} | {all: true} */
async function readNotifications(ctx: Ctx) {
  await requireStaff(ctx, NOTE_PERMS);
  const b = await readJson(ctx.req, 16 * 1024);
  const all = b.all === true;
  let ids: number[] = [];
  if (!all) {
    const raw = Array.isArray(b.ids) ? b.ids : b.id !== undefined ? [b.id] : null;
    if (!raw || raw.length === 0 || raw.length > 200) throw invalid({ ids: 'Send ids (1 to 200) or all: true.' });
    ids = raw.map(idOf).filter((x): x is number => x !== null);
    if (ids.length !== raw.length) throw invalid({ ids: 'Every id must be a notification number.' });
  }
  const s = noteScope(ctx);
  const updated = await tx(async (q) => {
    const r = await q<{ id: number }[]>`
      update notifications n set read_at = now()
      where ${noteWhere(q, s)} and n.read_at is null and (${all}::boolean or n.id = any(${ids}::bigint[]))
      returning n.id`;
    if (r.length) {
      await audit(ctx, {
        action: 'notification.read', targetType: 'notification', targetId: r.length === 1 ? r[0].id : null,
        detail: { count: r.length, all, ids: r.slice(0, 50).map((x) => x.id) },
      }, q);
    }
    return r.length;
  });
  return { ok: true, updated };
}

// ── CSV exports: GET /api/admin/export/:kind ─────────────────────────────────────────────

type ExportFilter = { from: Date | null; to: Date | null; status: string | null; limit: number };
type ExportResult = { csv: string; rows: number; truncated: boolean };
type ExportSpec = { perms: string[]; statuses: readonly string[] | null; run(q: Tx, f: ExportFilter): Promise<ExportResult> };

/** One export: its rows (newest first, one more than the cap to notice truncation) and columns. */
function exporter<T>(perms: string[], statuses: readonly string[] | null, load: (q: Tx, f: ExportFilter) => Promise<T[]>, columns: CsvColumn<T>[]): ExportSpec {
  return {
    perms,
    statuses,
    async run(q, f) {
      const rows = await load(q, { ...f, limit: f.limit + 1 });
      const truncated = rows.length > f.limit;
      const kept = truncated ? rows.slice(0, f.limit) : rows;
      return { csv: toCsv(columns, kept), rows: kept.length, truncated };
    },
  };
}

const inRange = (q: Tx, column: string, f: ExportFilter) => q`
  (${f.from}::timestamptz is null or ${q(column)} >= ${f.from}::timestamptz)
  and (${f.to}::timestamptz is null or ${q(column)} < ${f.to}::timestamptz)`;

type Address = { line1?: unknown; city?: unknown; state?: unknown; postal?: unknown; country?: unknown };
const addr = (v: unknown, k: keyof Address) => (isObj(v) && typeof v[k] === 'string' ? v[k] as string : null);

type OrderX = {
  id: string; created_at: Date; status: string; kind: string; email: string; name: string; user_id: string; items: string | null;
  item_ids: string | null; currency: string; total: number; total_inr: number; discount_inr: number; coupon_code: string | null;
  method: string; gateway_mode: string | null; gateway_order_id: string | null; gateway_payment_id: string | null;
  country: string | null; address: unknown; paid_at: Date | null; cancelled_at: Date | null; refunded_at: Date | null;
  failure_reason: string | null; staff_note: string | null;
};

const ordersExport = exporter<OrderX>(['orders.read'], ORDER_STATUSES, (q, f) => q<OrderX[]>`
  select o.id, o.created_at, o.status, o.kind, p.email::text as email, p.name, o.user_id,
         (select string_agg(it.title, ' | ' order by it.id) from order_items it where it.order_id = o.id) as items,
         (select string_agg(coalesce(it.product_id, it.class_id || ':' || it.plan_id), ' ' order by it.id)
            from order_items it where it.order_id = o.id) as item_ids,
         o.currency, o.total::float8 as total, o.total_inr::float8 as total_inr, o.discount_inr::float8 as discount_inr,
         o.coupon_code::text as coupon_code, o.method, o.gateway_mode, o.gateway_order_id, o.gateway_payment_id, o.country,
         o.address, o.paid_at, o.cancelled_at, o.refunded_at, o.failure_reason, o.staff_note
  from orders o join profiles p on p.id = o.user_id
  where ${inRange(q, 'o.created_at', f)} and (${f.status}::text is null or o.status = ${f.status}::text)
  order by o.created_at desc, o.id desc limit ${f.limit}`, [
  { header: 'order_id', value: (r) => r.id },
  { header: 'created_at', value: (r) => r.created_at },
  { header: 'status', value: (r) => r.status },
  { header: 'kind', value: (r) => r.kind },
  { header: 'customer_email', value: (r) => r.email },
  { header: 'customer_name', value: (r) => r.name },
  { header: 'customer_id', value: (r) => r.user_id },
  { header: 'items', value: (r) => r.items },
  { header: 'item_ids', value: (r) => r.item_ids },
  { header: 'currency', value: (r) => r.currency },
  { header: 'total', value: (r) => r.total },
  { header: 'total_inr', value: (r) => r.total_inr },
  { header: 'discount_inr', value: (r) => r.discount_inr },
  { header: 'coupon', value: (r) => r.coupon_code },
  { header: 'method', value: (r) => r.method },
  { header: 'gateway_mode', value: (r) => r.gateway_mode },
  { header: 'gateway_order_id', value: (r) => r.gateway_order_id },
  { header: 'gateway_payment_id', value: (r) => r.gateway_payment_id },
  { header: 'country', value: (r) => r.country ?? addr(r.address, 'country') },
  { header: 'address_line1', value: (r) => addr(r.address, 'line1') },
  { header: 'city', value: (r) => addr(r.address, 'city') },
  { header: 'state', value: (r) => addr(r.address, 'state') },
  { header: 'postal_code', value: (r) => addr(r.address, 'postal') },
  { header: 'paid_at', value: (r) => r.paid_at },
  { header: 'cancelled_at', value: (r) => r.cancelled_at },
  { header: 'refunded_at', value: (r) => r.refunded_at },
  { header: 'failure_reason', value: (r) => r.failure_reason },
  { header: 'staff_note', value: (r) => r.staff_note },
]);

type CustomerX = {
  id: string; email: string; name: string; role: string | null; status: string; created_via: string; email_verified_at: Date | null;
  created_at: Date; last_login_at: Date | null; blocked_at: Date | null; blocked_reason: string | null;
  subscription_suspended_at: Date | null; suspension_reason: string | null; country: string | null; time_zone: string | null;
  agreement_version: string | null; paid_orders: number; spent_inr: number; live_access: number; active_warnings: number;
};

// customers only: staff accounts are left out
const customersExport = exporter<CustomerX>(['customers.read'], null, (q, f) => q<CustomerX[]>`
  select p.id, p.email::text as email, p.name, p.role, p.status, p.created_via, p.email_verified_at, p.created_at,
         p.last_login_at, p.blocked_at, p.blocked_reason, p.subscription_suspended_at, p.suspension_reason, p.country,
         p.time_zone, p.agreement_version,
         coalesce(os.paid_orders, 0) as paid_orders, coalesce(os.spent_inr, 0)::float8 as spent_inr,
         (select count(*)::int from entitlements e
           where e.user_id = p.id and e.revoked_at is null and e.starts_at <= now()
             and (e.expires_at is null or e.expires_at > now())) as live_access,
         private.active_warning_count(p.id) as active_warnings
  from profiles p
  left join lateral (
    select count(*)::int as paid_orders, sum(o.total_inr) as spent_inr from orders o where o.user_id = p.id and o.status = 'paid'
  ) os on true
  where not exists (select 1 from staff_members sm where sm.user_id = p.id) and ${inRange(q, 'p.created_at', f)}
  order by p.created_at desc, p.id limit ${f.limit}`, [
  { header: 'customer_id', value: (r) => r.id },
  { header: 'email', value: (r) => r.email },
  { header: 'name', value: (r) => r.name },
  { header: 'role', value: (r) => r.role },
  { header: 'status', value: (r) => (r.blocked_at ? 'blocked' : r.status) },
  { header: 'paid_access', value: (r) => (r.subscription_suspended_at ? 'suspended' : 'active') },
  { header: 'suspension_reason', value: (r) => r.suspension_reason },
  { header: 'created_via', value: (r) => r.created_via },
  { header: 'email_verified_at', value: (r) => r.email_verified_at },
  { header: 'created_at', value: (r) => r.created_at },
  { header: 'last_login_at', value: (r) => r.last_login_at },
  { header: 'blocked_at', value: (r) => r.blocked_at },
  { header: 'blocked_reason', value: (r) => r.blocked_reason },
  { header: 'suspended_at', value: (r) => r.subscription_suspended_at },
  { header: 'country', value: (r) => r.country },
  { header: 'time_zone', value: (r) => r.time_zone },
  { header: 'agreement_version', value: (r) => r.agreement_version },
  { header: 'paid_orders', value: (r) => r.paid_orders },
  { header: 'spent_inr', value: (r) => r.spent_inr },
  { header: 'live_access_records', value: (r) => r.live_access },
  { header: 'active_warnings', value: (r) => r.active_warnings },
]);

type PaymentX = {
  id: number; order_id: string; provider: string; provider_payment_id: string; amount_minor: number; currency: string;
  status: string; source: string; created_at: Date; email: string; order_status: string; order_total_inr: number;
};

// never the raw gateway payload (same permissions as GET /api/admin/payments)
const paymentsExport = exporter<PaymentX>(['orders.read', 'logs.read'], PAYMENT_STATUSES, (q, f) => q<PaymentX[]>`
  select pa.id, pa.order_id, pa.provider, pa.provider_payment_id, pa.amount_minor, pa.currency, pa.status, pa.source,
         pa.created_at, p.email::text as email, o.status as order_status, o.total_inr::float8 as order_total_inr
  from payments pa join orders o on o.id = pa.order_id join profiles p on p.id = o.user_id
  where ${inRange(q, 'pa.created_at', f)} and (${f.status}::text is null or pa.status = ${f.status}::text)
  order by pa.created_at desc, pa.id desc limit ${f.limit}`, [
  { header: 'payment_id', value: (r) => r.id },
  { header: 'created_at', value: (r) => r.created_at },
  { header: 'order_id', value: (r) => r.order_id },
  { header: 'customer_email', value: (r) => r.email },
  { header: 'provider', value: (r) => r.provider },
  { header: 'provider_payment_id', value: (r) => r.provider_payment_id },
  { header: 'amount', value: (r) => fromMinor(r.amount_minor, r.currency) },
  { header: 'amount_minor', value: (r) => r.amount_minor },
  { header: 'currency', value: (r) => r.currency },
  { header: 'status', value: (r) => r.status },
  { header: 'source', value: (r) => r.source },
  { header: 'order_status', value: (r) => r.order_status },
  { header: 'order_total_inr', value: (r) => r.order_total_inr },
]);

type EntitlementX = EntRow & { email: string; class_name: string | null; granted_by: string | null; created_at: Date };

const entitlementsExport = exporter<EntitlementX>(['orders.read', 'customers.read', 'entitlements.grant', 'entitlements.revoke'], null, (q, f) => q<EntitlementX[]>`
  select e.id, e.user_id, e.scope, e.product_id, e.class_id, e.plan_id, e.kind, e.order_id, e.purchased_at, e.starts_at,
         e.expires_at, e.revoked_at, e.revoke_reason, e.granted_by, e.created_at, p.email::text as email,
         pr.title, pr.price_inr, pr.class_id as product_class, c.name as class_name
  from entitlements e
  join profiles p on p.id = e.user_id
  left join products pr on pr.id = e.product_id
  left join classes c on c.id = coalesce(e.class_id, pr.class_id)
  where ${inRange(q, 'e.created_at', f)}
  order by e.created_at desc, e.id desc limit ${f.limit}`, [
  { header: 'access_id', value: (r) => r.id },
  { header: 'customer_email', value: (r) => r.email },
  { header: 'customer_id', value: (r) => r.user_id },
  { header: 'scope', value: (r) => r.scope },
  { header: 'worksheet', value: (r) => r.product_id },
  { header: 'title', value: (r) => r.title ?? null },
  { header: 'class', value: (r) => r.class_id ?? r.product_class ?? null },
  { header: 'class_name', value: (r) => r.class_name },
  { header: 'plan', value: (r) => r.plan_id },
  { header: 'kind', value: (r) => r.kind },
  { header: 'status', value: (r) => entStatus(r, r.scope === 'worksheet' ? r.price_inr : null) },
  { header: 'order_id', value: (r) => r.order_id },
  { header: 'purchased_at', value: (r) => r.purchased_at },
  { header: 'starts_at', value: (r) => r.starts_at },
  { header: 'expires_at', value: (r) => r.expires_at },
  { header: 'revoked_at', value: (r) => r.revoked_at },
  { header: 'revoke_reason', value: (r) => r.revoke_reason },
  { header: 'granted_by', value: (r) => r.granted_by },
]);

type MessageX = {
  id: number; created_at: Date; name: string; email: string; status: string; read_at: Date | null; replied_at: Date | null;
  mailed: boolean; mail_error: string | null; user_id: string | null; body: string;
};

const messagesExport = exporter<MessageX>(['messages.read'], MESSAGE_STATUSES, (q, f) => q<MessageX[]>`
  select id, created_at, name, email::text as email, status, read_at, replied_at, mailed, mail_error, user_id, body
  from contact_messages
  where ${inRange(q, 'created_at', f)} and (${f.status}::text is null or status = ${f.status}::text)
  order by created_at desc, id desc limit ${f.limit}`, [
  { header: 'message_id', value: (r) => r.id },
  { header: 'created_at', value: (r) => r.created_at },
  { header: 'name', value: (r) => r.name },
  { header: 'email', value: (r) => r.email },
  { header: 'status', value: (r) => r.status },
  { header: 'read_at', value: (r) => r.read_at },
  { header: 'replied_at', value: (r) => r.replied_at },
  { header: 'emailed_to_inbox', value: (r) => r.mailed },
  { header: 'mail_error', value: (r) => r.mail_error },
  { header: 'customer_id', value: (r) => r.user_id },
  { header: 'message', value: (r) => r.body },
]);

type CouponX = {
  code: string; pct: number; max_uses: number; per_user_limit: number; applies_to: string; class_id: string | null;
  valid_from: Date | null; valid_until: Date | null; active: boolean; note: string | null; created_at: Date; updated_at: Date;
  uses: number; discount_inr: number;
};

const couponsExport = exporter<CouponX>(['coupons.write', 'pricing.write', 'orders.read'], null, (q, f) => q<CouponX[]>`
  select c.code::text as code, c.pct::float8 as pct, c.max_uses, c.per_user_limit, c.applies_to, c.class_id, c.valid_from,
         c.valid_until, c.active, c.note, c.created_at, c.updated_at,
         coalesce(r.uses, 0) as uses, coalesce(r.discount_inr, 0)::float8 as discount_inr
  from coupons c
  left join lateral (
    select count(*)::int as uses, sum(x.discount_inr) as discount_inr from coupon_redemptions x where x.coupon_code = c.code
  ) r on true
  where ${inRange(q, 'c.created_at', f)}
  order by c.created_at desc, c.code limit ${f.limit}`, [
  { header: 'code', value: (r) => r.code },
  { header: 'percent_off', value: (r) => r.pct },
  { header: 'active', value: (r) => r.active },
  { header: 'applies_to', value: (r) => r.applies_to },
  { header: 'class', value: (r) => r.class_id },
  { header: 'max_uses', value: (r) => r.max_uses },
  { header: 'per_customer_limit', value: (r) => r.per_user_limit },
  { header: 'uses', value: (r) => r.uses },
  { header: 'discount_given_inr', value: (r) => r.discount_inr },
  { header: 'valid_from', value: (r) => r.valid_from },
  { header: 'valid_until', value: (r) => r.valid_until },
  { header: 'note', value: (r) => r.note },
  { header: 'created_at', value: (r) => r.created_at },
  { header: 'updated_at', value: (r) => r.updated_at },
]);

const auditExport = exporter<AuditRow>(['audit.read'], null, (q, f) => q<AuditRow[]>`
  select a.id, a.at, a.actor_id, coalesce(a.actor_email, p.email::text) as actor_email, a.actor_role, a.action,
         a.target_type, a.target_id, a.ip, a.detail
  from audit_logs a left join profiles p on p.id = a.actor_id
  where ${inRange(q, 'a.at', f)}
  order by a.at desc, a.id desc limit ${f.limit}`, [
  { header: 'id', value: (r) => r.id },
  { header: 'at', value: (r) => r.at },
  { header: 'actor', value: (r) => r.actor_email ?? (r.actor_id ? null : 'system') },
  { header: 'actor_id', value: (r) => r.actor_id },
  { header: 'role', value: (r) => r.actor_role },
  { header: 'action', value: (r) => r.action },
  { header: 'target_type', value: (r) => r.target_type },
  { header: 'target_id', value: (r) => r.target_id },
  { header: 'ip', value: (r) => r.ip },
  { header: 'detail', value: (r) => (r.detail ?? null) as Record<string, unknown> | null },
]);

const EXPORTS: Record<string, ExportSpec> = {
  orders: ordersExport,
  customers: customersExport,
  payments: paymentsExport,
  entitlements: entitlementsExport,
  messages: messagesExport,
  coupons: couponsExport,
  audit: auditExport,
};

/** GET /api/admin/export/:kind?from=&to=&tz=&status=&limit= — a CSV download (exports.run plus
 *  the permission that shows that data on screen). */
async function exportCsv(ctx: Ctx) {
  const u = await requireStaff(ctx, 'exports.run');
  const kind = ctx.params.kind ?? '';
  const spec = Object.hasOwn(EXPORTS, kind) ? EXPORTS[kind] : null;
  if (!spec) throw notFound(`Unknown export. Choose ${Object.keys(EXPORTS).join(', ')}.`);
  if (!spec.perms.some((p) => hasPermission(u.staff, p))) {
    throw forbidden(spec.perms[0], `Exporting ${kind} also needs the ${spec.perms.join(' or ')} permission.`);
  }
  const sp = ctx.query;
  const status = sp.get('status') || null;
  if (status && !(spec.statuses ?? []).includes(status)) {
    throw invalid({ status: spec.statuses ? `Status is ${spec.statuses.join(', ')}.` : 'This export has no status filter.' });
  }
  const limit = intParam(sp.get('limit'), EXPORT_MAX, 1, EXPORT_MAX);
  tzOf(sp.get('tz'));
  await rateLimit(ctx, 'admin_export', u.id, 30, 3600);
  const out = await tx(async (q) => {
    const b = await resolveBounds(q, { from: sp.get('from'), to: sp.get('to'), tz: sp.get('tz') });
    const r = await spec.run(q, { from: b.from, to: b.to, status, limit });
    await audit(ctx, {
      action: 'export.run', targetType: 'export', targetId: kind,
      detail: { kind, rows: r.rows, truncated: r.truncated, filters: { from: iso(b.from), to: iso(b.to), tz: b.tz, status, limit } },
    }, q);
    return r;
  }, { timeoutMs: 60_000 });
  return downloadResponse(out.csv, attachmentName(`lww-${kind}`, 'csv'), 'text/csv; charset=utf-8', {
    'X-Row-Count': String(out.rows),
    'X-Truncated': String(out.truncated),
  });
}

// ── GET /api/admin/backup ────────────────────────────────────────────────────────────────

// settings keys that could ever hold a credential never leave the database
const SECRETISH_KEY = /secret|token|password|passwd|api_?key|private|credential/i;

/** Configuration tables as one JSON file (owner or admin with exports.run). Never accounts,
 *  sessions, tokens, secrets (private.app_secrets), orders, logs or email bodies. */
async function backup(ctx: Ctx) {
  const u = await requireStaff(ctx, 'exports.run');
  if (u.staff!.role !== 'owner' && u.staff!.role !== 'admin') {
    throw new HttpError(403, 'Only an owner or an admin can download a backup.', { code: 'forbidden', permission: 'exports.run', roles: ['owner', 'admin'] });
  }
  await rateLimit(ctx, 'admin_backup', u.id, 10, 3600);
  const tables = await tx(async (q) => {
    const settings = (await q<{ key: string; value: unknown; description: string | null; updated_at: Date }[]>`
      select key, value, description, updated_at from settings order by key`).filter((s) => !SECRETISH_KEY.test(s.key));
    const t = {
      settings: settings.map((s) => ({ key: s.key, value: s.value, description: s.description, updatedAt: iso(s.updated_at) })),
      plans: await q`
        select id, label, months, price_inr, discount_pct::float8 as discount_pct, regions, note, active, sort, updated_at
        from plans order by sort, id`,
      classes: await q`
        select id, name, status, discount_pct::float8 as discount_pct, sort, updated_at from classes order by sort, id`,
      products: await q`
        select id, title, description, class_id, subject, group_id, section, section_label, pages, price_inr, was_price_inr,
               status, pdf_path, thumb_url, cover_path, audience, rating::float8 as rating, rating_count, print_limit,
               print_rule, download_limit, stock, access_days, landscape, tags, sort, created_at, updated_at
        from products order by class_id, sort, id`,
      coupons: await q`
        select code::text as code, pct::float8 as pct, max_uses, per_user_limit, applies_to, class_id, valid_from, valid_until,
               active, note, created_at, updated_at
        from coupons order by code`,
      faq: await q`
        select id, question, answer, keywords, audience, status, sort, created_at, updated_at from faq_entries order by sort, id`,
      siteContent: await q`select key, value, published, updated_at from site_content order by key`,
      securityRules: await q`
        select id, name, description, enabled, auto_confirm, severity, params, updated_at from security_rules order by id`,
      staffRoleTemplates: await q`select role, label, permissions from staff_role_templates order by role`,
      staffPermissions: await q`select id, description from staff_permissions order by id`,
    };
    const counts = Object.fromEntries(Object.entries(t).map(([k, v]) => [k, (v as unknown[]).length]));
    await audit(ctx, { action: 'backup.download', targetType: 'backup', detail: { counts } }, q);
    return { t, counts };
  });
  const now = new Date();
  const body = JSON.stringify({
    kind: 'learn-with-why-config-backup',
    version: 1,
    createdAt: now.toISOString(),
    apiVersion: env().version,
    note: 'Configuration only. Accounts, sign-ins, orders, payments, logs, email text and secrets are not included: restore those from the Supabase database backups.',
    counts: tables.counts,
    tables: tables.t,
  }, null, 2);
  return downloadResponse(body, attachmentName('lww-backup', 'json', now), 'application/json; charset=utf-8');
}

// ── GET /api/admin/developer/health ──────────────────────────────────────────────────────

type MigrationHistory = { readable: boolean; reason?: string; list: { version: string; name: string | null }[] };

// security events that point at something going wrong (shown to developers, counts only)
const ERRORISH = ['payment.rejected', 'payment.bad_signature', 'watermark.failed', 'account_locked'];
const ERRORISH_RE = '(fail|error|reject|bad_|invalid|mismatch)';

/** Names, flags and counts only — never a value from the environment or a secret. */
async function developerHealth(ctx: Ctx) {
  await requireStaff(ctx, 'developer.read');
  const e = env();
  const report = envReport();
  const modes = gatewayModes();
  const started = performance.now();
  const out = await tx(async (q) => {
    const db = (await q<{ now: Date; tz: string; version: string }[]>`
      select now() as now, current_setting('TimeZone') as tz, current_setting('server_version') as version`)[0];
    const latencyMs = Math.round((performance.now() - started) * 10) / 10;
    // run in a savepoint, so a missing helper cannot spoil the rest of the report
    let migrations: MigrationHistory = { readable: false, reason: 'unavailable', list: [] };
    try {
      const m = await q.savepoint((sp) => sp<{ m: MigrationHistory | null }[]>`select private.applied_migrations() as m`);
      if (m[0]?.m && Array.isArray(m[0].m.list)) migrations = m[0].m;
    } catch {
      // keep "unavailable"
    }
    const tables = await q<{ name: string; rows: number; bytes: number }[]>`
      select c.relname as name,
             (case when c.reltuples >= 0 then greatest(c.reltuples::bigint, coalesce(s.n_live_tup, 0)) else coalesce(s.n_live_tup, 0) end)::bigint as rows,
             pg_total_relation_size(c.oid)::bigint as bytes
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      left join pg_stat_user_tables s on s.relid = c.oid
      where n.nspname = 'public' and c.relkind in ('r', 'p')
      order by c.relname`;
    const outbox = await outboxCounts(q);
    const outboxTimes = (await q<{ oldest_waiting: Date | null; last_sent: Date | null; sent_24h: number; failed_24h: number }[]>`
      select min(created_at) filter (where not sensitive and status in ('queued', 'failed') and attempts < max_attempts) as oldest_waiting,
             max(sent_at) as last_sent,
             count(*) filter (where status = 'sent' and sent_at > now() - interval '24 hours')::int as sent_24h,
             count(*) filter (where status = 'failed' and created_at > now() - interval '24 hours')::int as failed_24h
      from email_outbox`)[0];
    const lastEvent = (await q<{ id: number; provider: string; event_type: string; ok: boolean; status: string; signature_ok: boolean | null; received_at: Date; processed_at: Date | null }[]>`
      select id, provider, event_type, ok, status, signature_ok, received_at, processed_at
      from payment_events order by received_at desc, id desc limit 1`)[0] ?? null;
    const pay = (await q<{ events_24h: number; not_ok_24h: number; bad_signatures_24h: number; last_paid_at: Date | null }[]>`
      select (select count(*)::int from payment_events where received_at > now() - interval '24 hours') as events_24h,
             (select count(*)::int from payment_events where received_at > now() - interval '24 hours' and not ok) as not_ok_24h,
             (select count(*)::int from payment_events where received_at > now() - interval '24 hours' and signature_ok = false) as bad_signatures_24h,
             (select max(paid_at) from orders) as last_paid_at`)[0];
    const errorTypes = await q<{ type: string; day: number; week: number; last_at: Date }[]>`
      select event_type as type, count(*) filter (where created_at > now() - interval '24 hours')::int as day,
             count(*)::int as week, max(created_at) as last_at
      from security_events
      where created_at > now() - interval '7 days' and (event_type = any(${ERRORISH}::text[]) or event_type ~ ${ERRORISH_RE})
      group by event_type order by max(created_at) desc limit 50`;
    const recentErrors = await q<{ id: number; type: string; at: Date; reason: string | null }[]>`
      select id, event_type as type, created_at as at, left(detail ->> 'reason', 200) as reason
      from security_events
      where created_at > now() - interval '7 days' and (event_type = any(${ERRORISH}::text[]) or event_type ~ ${ERRORISH_RE})
      order by created_at desc, id desc limit 20`;
    const jobs = await q<{ name: string; ran_at: Date }[]>`select name, ran_at from private.job_marks order by name`;
    const files = (await q<{ products: number; with_pdf: number; active_missing: number }[]>`
      select count(*)::int as products, count(*) filter (where f.has_pdf)::int as with_pdf,
             count(*) filter (where not f.has_pdf and p.status = 'active')::int as active_missing
      from private.product_file_status() f join products p on p.id = f.product_id`)[0];
    return { db, latencyMs, migrations, tables, outbox, outboxTimes, lastEvent, pay, errorTypes, recentErrors, jobs, files };
  });

  const warnings: string[] = [];
  if (!mailReady()) warnings.push('Email is not set up: add BREVO_API_KEY or RESEND_API_KEY, and MAIL_FROM.');
  if (!modes.razorpay && !modes.stripe && !modes.paypal) warnings.push('No payment gateway is configured, so nothing can be bought.');
  if (!report.SITE_URL) warnings.push('SITE_URL is not set: links in emails point to the local development address.');
  if (!e.allowedOrigins.length) warnings.push('ALLOWED_ORIGINS is empty: any website may call the API from a browser.');
  if (!e.jwks && !e.jwtSecret) warnings.push('Neither SUPABASE_JWKS nor LWW_JWT_SECRET is set: every request asks Supabase Auth to check the token (slower).');
  if (out.outbox.gaveUp > 0) warnings.push(`${out.outbox.gaveUp} email(s) gave up after repeated failures — see Emails.`);
  if (out.files.active_missing > 0) warnings.push(`${out.files.active_missing} sheet(s) on sale have no PDF uploaded.`);

  return {
    ok: true,
    time: Date.now(),
    version: e.version,
    runtime: { deno: Deno.version.deno },
    db: { ok: true, time: ms(out.db.now), timeZone: out.db.tz, serverVersion: out.db.version, latencyMs: out.latencyMs },
    env: report,
    envMissing: Object.entries(report).filter(([, set]) => !set).map(([name]) => name),
    migrations: out.migrations.readable
      ? { readable: true, count: out.migrations.list.length, latest: out.migrations.list.at(-1) ?? null, list: out.migrations.list }
      : { readable: false, reason: out.migrations.reason ?? 'unavailable', count: null, latest: null, list: [] },
    tables: out.tables.map((t) => ({ name: t.name, rows: t.rows, bytes: t.bytes, estimated: true })),
    outbox: {
      ...out.outbox,
      oldestWaitingAt: ms(out.outboxTimes.oldest_waiting), lastSentAt: ms(out.outboxTimes.last_sent),
      sent24h: out.outboxTimes.sent_24h, failed24h: out.outboxTimes.failed_24h,
    },
    payments: {
      lastEvent: out.lastEvent ? {
        id: out.lastEvent.id, provider: out.lastEvent.provider, type: out.lastEvent.event_type, ok: out.lastEvent.ok,
        status: out.lastEvent.status, signatureOk: out.lastEvent.signature_ok, at: ms(out.lastEvent.received_at),
        processedAt: ms(out.lastEvent.processed_at),
      } : null,
      events24h: out.pay.events_24h, notOk24h: out.pay.not_ok_24h, badSignatures24h: out.pay.bad_signatures_24h,
      lastPaidAt: ms(out.pay.last_paid_at),
    },
    errors: {
      byType: out.errorTypes.map((t) => ({ type: t.type, last24h: t.day, last7d: t.week, lastAt: ms(t.last_at) })),
      recent: out.recentErrors.map((r) => ({ id: r.id, type: r.type, at: ms(r.at), reason: r.reason })),
    },
    gateways: modes,
    mail: { provider: e.mail.provider, ready: mailReady(), fromSet: !!e.mail.from },
    jobs: Object.fromEntries(out.jobs.map((j) => [j.name, ms(j.ran_at)])),
    files: { products: out.files.products, withPdf: out.files.with_pdf, onSaleWithoutPdf: out.files.active_missing },
    warnings,
  };
}

// ── site text: GET/PUT /api/admin/content ────────────────────────────────────────────────

// The headline may hold a little HTML. Like the site's renderer (frontend AnimatedText.jsx), only
// these tags are kept, with no attribute but class; other tags go and their words stay. The text
// of script/style/iframe-like elements is dropped altogether.
const KEEP_TAGS = new Set(['em', 'i', 'strong', 'b', 'u', 'mark', 'small', 'span']);
const DROP_WITH_TEXT = new Set([
  'script', 'style', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'noscript', 'noembed', 'noframes',
  'template', 'textarea', 'title', 'xmp', 'plaintext', 'svg', 'math', 'select', 'option', 'head', 'canvas', 'video', 'audio',
]);
const TAG_RE = /<(\/?)([A-Za-z][A-Za-z0-9-]*)((?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*(\/?)>/y;
const CLASS_RE = /(?:^|\s)class\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/i;
const MAX_NESTING = 8;

function escapeText(t: string): string {
  // keep entities the editor typed (&nbsp; &amp; &#8217; …); escape everything else
  return t
    .replace(/&(?!(?:#\d{1,7}|#x[0-9a-f]{1,6}|[a-z][a-z0-9]{1,31});)/gi, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function classOf(attrs: string): string | null {
  const m = CLASS_RE.exec(attrs);
  if (!m) return null;
  const v = (m[1] ?? m[2] ?? m[3] ?? '').replace(/[^A-Za-z0-9_ -]/g, '').replace(/\s+/g, ' ').trim().slice(0, 60);
  return v || null;
}

/** The headline with only the allowed markup (always well-formed: every kept tag is closed). */
export function sanitizeHeadline(html: string): string {
  const s = html.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
  const out: string[] = [];
  const open: string[] = [];
  let i = 0;
  while (i < s.length) {
    const lt = s.indexOf('<', i);
    if (lt < 0) { out.push(escapeText(s.slice(i))); break; }
    if (lt > i) out.push(escapeText(s.slice(i, lt)));
    if (s.startsWith('<!--', lt)) {
      const end = s.indexOf('-->', lt + 4);
      i = end < 0 ? s.length : end + 3;
      continue;
    }
    if (s[lt + 1] === '!' || s[lt + 1] === '?') {
      const end = s.indexOf('>', lt);
      i = end < 0 ? s.length : end + 1;
      continue;
    }
    TAG_RE.lastIndex = lt;
    const m = TAG_RE.exec(s);
    if (!m) { out.push('&lt;'); i = lt + 1; continue; }
    i = lt + m[0].length;
    const closing = m[1] === '/';
    const name = m[2].toLowerCase();
    if (DROP_WITH_TEXT.has(name)) {
      if (!closing && m[4] !== '/') {
        const end = s.toLowerCase().indexOf(`</${name}`, i);
        if (end < 0) { i = s.length; continue; }
        const gt = s.indexOf('>', end);
        i = gt < 0 ? s.length : gt + 1;
      }
      continue;
    }
    if (name === 'br') { if (!closing) out.push('<br>'); continue; }
    if (!KEEP_TAGS.has(name)) continue; // the tag goes, its words stay
    if (closing) {
      const at = open.lastIndexOf(name);
      if (at < 0) continue;
      while (open.length > at) out.push(`</${open.pop()}>`);
      continue;
    }
    if (m[4] === '/' || open.length >= MAX_NESTING) continue;
    const cls = classOf(m[3]);
    out.push(cls ? `<${name} class="${cls}">` : `<${name}>`);
    open.push(name);
  }
  while (open.length) out.push(`</${open.pop()}>`);
  return out.join('').trim();
}

const HOME_FIELDS = ['badge', 'heroTitle', 'heroLede', 'whys'] as const;
type HomeField = typeof HOME_FIELDS[number];
type Home = { badge?: string; heroTitle?: string; heroLede?: string; whys?: string[] };

const oneLine = (v: string, max: number) => cleanText(v, max * 4).replace(/\s+/g, ' ').trim();

/** The home-page fields the old Content page edits ({ badge, heroTitle, heroLede, whys }). */
function cleanHomeFields(v: Record<string, unknown>): Home {
  const errors: Record<string, string> = {};
  const out: Home = {};
  const unknown = Object.keys(v).filter((k) => !(HOME_FIELDS as readonly string[]).includes(k));
  if (unknown.length) errors[unknown[0]] = `Unknown field — the home page has ${HOME_FIELDS.join(', ')}.`;
  const text = (field: HomeField, max: number) => {
    const raw = v[field];
    if (raw === undefined) return;
    if (raw === null) { out[field as 'badge'] = ''; return; }
    if (typeof raw !== 'string') { errors[field] = 'This must be text.'; return; }
    if (raw.length > max * 4) { errors[field] = `Keep this under ${max} characters.`; return; }
    const t = oneLine(raw, max);
    if (t.length > max) errors[field] = `Keep this under ${max} characters.`;
    else out[field as 'badge'] = t;
  };
  text('badge', 120);
  text('heroLede', 600);
  if (v.heroTitle !== undefined) {
    const raw = v.heroTitle;
    if (raw === null) out.heroTitle = '';
    else if (typeof raw !== 'string') errors.heroTitle = 'The headline must be text.';
    else if (raw.length > 2000) errors.heroTitle = 'Keep the headline under 300 characters.';
    else {
      const t = sanitizeHeadline(raw.replace(/\s+/g, ' '));
      if (t.length > 300) errors.heroTitle = 'Keep the headline under 300 characters.';
      else out.heroTitle = t;
    }
  }
  if (v.whys !== undefined) {
    const raw = v.whys;
    // one question per line, as the old form sent it, or a list
    const list = raw === null ? [] : typeof raw === 'string' ? raw.split(/\r?\n/) : Array.isArray(raw) ? raw : null;
    if (!list || !list.every((x) => typeof x === 'string')) errors.whys = 'Send the questions as a list of text lines.';
    else {
      const lines = (list as string[]).map((x) => oneLine(x, 160)).filter(Boolean);
      if (lines.length > 30) errors.whys = 'Keep it to 30 questions at most.';
      else if (lines.some((x) => x.length > 160)) errors.whys = 'Keep each question under 160 characters.';
      else out.whys = lines;
    }
  }
  if (Object.keys(errors).length) throw invalid(errors);
  return out;
}

const HTMLISH_FIELD = /(^heroTitle$|Html$|_html$)/;

/** Any other content key: JSON of text, numbers, true/false and lists, kept small. Text is plain
 *  (the site shows it as text); fields named *Html or heroTitle get the headline allow-list. */
function cleanGeneric(v: unknown): unknown {
  let count = 0;
  const walk = (x: unknown, depth: number, path: string, field: string): unknown => {
    if (++count > 2000) throw invalid({ value: 'This content is too large.' });
    if (depth > 6) throw invalid({ value: 'This content is nested too deeply.' });
    if (x === null || typeof x === 'boolean') return x;
    if (typeof x === 'number') {
      if (!Number.isFinite(x)) throw invalid({ value: `${path || 'value'} must be a real number.` });
      return x;
    }
    if (typeof x === 'string') {
      if (x.length > 8000) throw invalid({ value: `${path || 'value'} is too long (4000 characters at most).` });
      const t = HTMLISH_FIELD.test(field) ? sanitizeHeadline(x) : cleanText(x, 8000);
      if (t.length > 4000) throw invalid({ value: `${path || 'value'} is too long (4000 characters at most).` });
      return t;
    }
    if (Array.isArray(x)) {
      if (x.length > 200) throw invalid({ value: `${path || 'value'} has too many items (200 at most).` });
      return x.map((y, i) => walk(y, depth + 1, `${path}[${i}]`, field));
    }
    if (isObj(x)) {
      const keys = Object.keys(x);
      if (keys.length > 100) throw invalid({ value: `${path || 'value'} has too many fields (100 at most).` });
      const o: Record<string, unknown> = {};
      for (const k of keys) {
        if (!/^[A-Za-z0-9_.-]{1,64}$/.test(k)) throw invalid({ value: `Field names are letters, digits, dots, dashes and underscores (${JSON.stringify(k.slice(0, 40))}).` });
        o[k] = walk(x[k], depth + 1, path ? `${path}.${k}` : k, k);
      }
      return o;
    }
    throw invalid({ value: 'Unsupported value.' });
  };
  if (v === null || v === undefined) throw invalid({ value: 'Send the content to save.' });
  const out = walk(v, 0, '', '');
  if (JSON.stringify(out).length > 32 * 1024) throw invalid({ value: 'This content is too large (32 KB at most).' });
  return out;
}

type ContentRow = { key: string; value: unknown; published: boolean; updated_at: Date; updated_by: string | null; updated_by_email: string | null };

async function loadContent(q: Tx): Promise<ContentRow[]> {
  return await q<ContentRow[]>`
    select c.key, c.value, c.published, c.updated_at, c.updated_by, p.email::text as updated_by_email
    from site_content c left join profiles p on p.id = c.updated_by
    order by c.key`;
}

function contentPayload(rows: ContentRow[]) {
  const home = rows.find((r) => r.key === 'home');
  return {
    content: Object.fromEntries(rows.map((r) => [r.key, r.value])),
    published: Object.fromEntries(rows.map((r) => [r.key, r.published])),
    items: rows.map((r) => ({
      key: r.key, value: r.value, published: r.published, updatedAt: ms(r.updated_at), updatedBy: r.updated_by_email ?? r.updated_by,
    })),
    // the old Content page's shape; null = the site shows its built-in text
    home: home ? { ...(isObj(home.value) ? home.value : {}), published: home.published, updatedAt: ms(home.updated_at) } : null,
  };
}

async function getContent(ctx: Ctx) {
  await requireStaff(ctx, 'content.write');
  return contentPayload(await tx((q) => loadContent(q)));
}

/** PUT /api/admin/content
 *   {key, value, published?}       save one key (value null = remove it: the site shows its built-in text)
 *   {key, published}               publish or hide a saved key
 *   {badge?, heroTitle?, heroLede?, whys?, published?}   the old Content page: the "home" key
 *   {key?, reset: true}            remove a key (default "home") */
async function putContent(ctx: Ctx) {
  await requireStaff(ctx, 'content.write');
  const b = await readJson(ctx.req, 64 * 1024);
  if (b.published !== undefined && typeof b.published !== 'boolean') throw invalid({ published: 'published is true or false.' });
  const published = b.published as boolean | undefined;
  let key = 'home';
  if (b.key !== undefined) {
    if (typeof b.key !== 'string' || !CONTENT_KEY_RE.test(b.key.trim())) {
      throw invalid({ key: 'Keys are lower-case letters, digits, dots, dashes and underscores (64 at most).' });
    }
    key = b.key.trim();
  }
  const homeShape = b.key === undefined && HOME_FIELDS.some((f) => b[f] !== undefined);
  let mode: 'set' | 'publish' | 'reset';
  let partial: Home | null = null;
  let value: unknown = undefined;
  if (b.reset === true || (b.key !== undefined && b.value === null)) {
    mode = 'reset';
  } else if (homeShape || (b.key !== undefined && b.value !== undefined)) {
    mode = 'set';
    const raw = homeShape ? Object.fromEntries(HOME_FIELDS.filter((f) => b[f] !== undefined).map((f) => [f, b[f]])) : b.value;
    if (key === 'home') {
      if (!isObj(raw)) throw invalid({ value: `The home page text is an object with ${HOME_FIELDS.join(', ')}.` });
      partial = cleanHomeFields(raw);
    } else {
      value = cleanGeneric(raw);
    }
  } else if (published !== undefined) {
    mode = 'publish';
  } else {
    throw invalid({ value: 'Send the text to save, or published: true/false.' });
  }

  const out = await tx(async (q) => {
    const cur = (await q<{ value: unknown; published: boolean }[]>`
      select value, published from site_content where key = ${key} for update`)[0] ?? null;
    let changed = false;
    if (mode === 'reset') {
      if (cur) {
        await q`delete from site_content where key = ${key}`;
        await audit(ctx, { action: 'content.reset', targetType: 'site_content', targetId: key, detail: { before: { value: cur.value, published: cur.published }, after: null } }, q);
        changed = true;
      }
    } else if (mode === 'publish') {
      if (!cur) throw notFound('Nothing is saved under this key yet — save its text first.');
      if (cur.published !== published) {
        await q`update site_content set published = ${published!}, updated_by = ${ctx.user!.id} where key = ${key}`;
        await audit(ctx, { action: 'content.publish', targetType: 'site_content', targetId: key, detail: { before: { published: cur.published }, after: { published } } }, q);
        changed = true;
      }
    } else {
      const next = partial ? { ...(isObj(cur?.value) ? cur!.value as Record<string, unknown> : {}), ...partial } : value;
      const pub = published ?? cur?.published ?? true;
      if (!cur || stable(cur.value) !== stable(next) || cur.published !== pub) {
        if (!cur) {
          const n = (await q<{ n: number }[]>`select count(*)::int as n from site_content`)[0].n;
          if (n >= CONTENT_MAX_KEYS) throw new HttpError(409, `There are already ${CONTENT_MAX_KEYS} content keys — remove one first.`, { code: 'too_many_keys' });
        }
        await q`
          insert into site_content (key, value, published, updated_by)
          values (${key}, ${q.json(next as never)}, ${pub}, ${ctx.user!.id})
          on conflict (key) do update set value = excluded.value, published = excluded.published, updated_by = excluded.updated_by`;
        await audit(ctx, {
          action: 'content.update', targetType: 'site_content', targetId: key,
          detail: { before: cur ? { value: cur.value, published: cur.published } : null, after: { value: next, published: pub } },
        }, q);
        changed = true;
      }
    }
    return { changed, rows: await loadContent(q) };
  });
  return { ok: true, changed: out.changed, key, ...contentPayload(out.rows) };
}

// ── FAQ answers: GET/POST /api/admin/faq, PUT/DELETE /api/admin/faq/:id ──────────────────

type FaqRow = {
  id: number; question: string; answer: string; keywords: string[]; audience: string; status: string; sort: number;
  created_at: Date; updated_at: Date; updated_by: string | null; updated_by_email: string | null;
};
type FaqFields = { question: string; answer: string; keywords: string[]; audience: string; status: string; sort: number };

const faqView = (f: FaqRow) => ({
  id: f.id, question: f.question, answer: f.answer, keywords: f.keywords, audience: f.audience, status: f.status, sort: f.sort,
  // only published public answers are ever shown on the site or used by the assistant
  public: f.audience === 'public' && f.status === 'published',
  createdAt: ms(f.created_at), updatedAt: ms(f.updated_at), updatedBy: f.updated_by_email ?? f.updated_by,
});

const FAQ_SELECT = (q: Tx) => q`
  select f.id, f.question, f.answer, f.keywords, f.audience, f.status, f.sort, f.created_at, f.updated_at, f.updated_by,
         p.email::text as updated_by_email
  from faq_entries f left join profiles p on p.id = f.updated_by`;

function parseFaq(b: Record<string, unknown>): Partial<FaqFields> {
  const set: Partial<FaqFields> = {};
  const errors: Record<string, string> = {};
  if (b.question !== undefined) {
    if (typeof b.question !== 'string') errors.question = 'The question must be text.';
    else {
      const t = cleanText(b.question, 2000).replace(/\s+/g, ' ');
      if (t.length < 3) errors.question = 'Write the question (at least 3 characters).';
      else if (t.length > 300) errors.question = 'Keep the question under 300 characters.';
      else set.question = t;
    }
  }
  if (b.answer !== undefined) {
    if (typeof b.answer !== 'string') errors.answer = 'The answer must be text.';
    else {
      const t = cleanText(b.answer, 8000);
      if (!t) errors.answer = 'Write the answer.';
      else if (t.length > 2000) errors.answer = 'Keep the answer under 2000 characters.';
      else set.answer = t;
    }
  }
  if (b.keywords !== undefined) {
    const raw = b.keywords;
    const list = raw === null ? [] : typeof raw === 'string' ? raw.split(',') : Array.isArray(raw) ? raw : null;
    if (!list || !list.every((k) => typeof k === 'string')) errors.keywords = 'Keywords are a list of words or short phrases.';
    else {
      const words = [...new Set((list as string[]).map((k) => cleanText(k, 200).toLowerCase().replace(/\s+/g, ' ')).filter(Boolean))];
      if (words.length > 30) errors.keywords = 'Use 30 keywords at most.';
      else if (words.some((k) => k.length > 60)) errors.keywords = 'Keep each keyword under 60 characters.';
      else set.keywords = words;
    }
  }
  if (b.audience !== undefined) {
    if ((FAQ_AUDIENCES as readonly unknown[]).includes(b.audience)) set.audience = b.audience as string;
    else errors.audience = 'Audience is public or staff.';
  }
  if (b.status !== undefined) {
    if ((FAQ_STATUSES as readonly unknown[]).includes(b.status)) set.status = b.status as string;
    else errors.status = 'Status is published, draft or planned.';
  }
  if (b.sort !== undefined) {
    const n = typeof b.sort === 'number' ? b.sort : typeof b.sort === 'string' && /^\s*-?\d{1,6}\s*$/.test(b.sort) ? Number(b.sort) : NaN;
    if (!Number.isInteger(n) || n < -100000 || n > 100000) errors.sort = 'Sort is a whole number from -100000 to 100000.';
    else set.sort = n;
  }
  if (Object.keys(errors).length) throw invalid(errors);
  return set;
}

async function listFaq(ctx: Ctx) {
  await requireStaff(ctx, 'content.write');
  const sp = ctx.query;
  const audience = oneOf(sp.get('audience'), FAQ_AUDIENCES, 'audience', 'Audience is public or staff.');
  const status = oneOf(sp.get('status'), FAQ_STATUSES, 'status', 'Status is published, draft or planned.');
  const text = cleanText(sp.get('q'), 100);
  const like = text ? likePattern(text) : null;
  const rows = await tx((q) => q<FaqRow[]>`
    ${FAQ_SELECT(q)}
    where (${audience}::text is null or f.audience = ${audience}::text)
      and (${status}::text is null or f.status = ${status}::text)
      and (${like}::text is null or f.question ilike ${like}::text or f.answer ilike ${like}::text)
    order by f.sort, f.id limit 1000`);
  const faq = rows.map(faqView);
  return { faq, counts: { total: faq.length, public: faq.filter((f) => f.public).length } };
}

async function createFaq(ctx: Ctx) {
  await requireStaff(ctx, 'content.write');
  const b = await readJson(ctx.req, 32 * 1024);
  const set = parseFaq(b);
  const errors: Record<string, string> = {};
  if (!set.question) errors.question = 'Write the question (at least 3 characters).';
  if (!set.answer) errors.answer = 'Write the answer.';
  if (Object.keys(errors).length) throw invalid(errors);
  const v: FaqFields = {
    question: set.question!, answer: set.answer!, keywords: set.keywords ?? [], audience: set.audience ?? 'public',
    status: set.status ?? 'published', sort: set.sort ?? 0,
  };
  const row = await tx(async (q) => {
    const n = (await q<{ n: number }[]>`select count(*)::int as n from faq_entries`)[0].n;
    if (n >= 1000) throw new HttpError(409, 'There are already 1000 answers — remove some first.', { code: 'too_many' });
    const r = await q<{ id: number }[]>`
      insert into faq_entries (question, answer, keywords, audience, status, sort, updated_by)
      values (${v.question}, ${v.answer}, ${v.keywords}::text[], ${v.audience}, ${v.status}, ${v.sort}, ${ctx.user!.id})
      returning id`;
    await audit(ctx, { action: 'faq.create', targetType: 'faq', targetId: r[0].id, detail: { before: null, after: v } }, q);
    return (await q<FaqRow[]>`${FAQ_SELECT(q)} where f.id = ${r[0].id}`)[0];
  });
  return json(201, { ok: true, faq: faqView(row) });
}

async function updateFaq(ctx: Ctx) {
  await requireStaff(ctx, 'content.write');
  const id = idParam(ctx, NO_FAQ);
  const b = await readJson(ctx.req, 32 * 1024);
  const set = parseFaq(b);
  if (!Object.keys(set).length) throw invalid({ question: 'Send what to change (question, answer, keywords, audience, status or sort).' });
  const row = await tx(async (q) => {
    const cur = (await q<FaqRow[]>`${FAQ_SELECT(q)} where f.id = ${id} for update of f`)[0];
    if (!cur) throw notFound(NO_FAQ);
    const before: Record<string, unknown> = {}, after: Record<string, unknown> = {};
    for (const k of Object.keys(set) as (keyof FaqFields)[]) {
      if (stable(cur[k]) === stable(set[k])) continue;
      before[k] = cur[k];
      after[k] = set[k];
    }
    if (!Object.keys(after).length) return cur;
    const next: FaqFields = {
      question: set.question ?? cur.question, answer: set.answer ?? cur.answer, keywords: set.keywords ?? cur.keywords,
      audience: set.audience ?? cur.audience, status: set.status ?? cur.status, sort: set.sort ?? cur.sort,
    };
    await q`
      update faq_entries set question = ${next.question}, answer = ${next.answer}, keywords = ${next.keywords}::text[],
        audience = ${next.audience}, status = ${next.status}, sort = ${next.sort}, updated_by = ${ctx.user!.id}
      where id = ${id}`;
    await audit(ctx, { action: 'faq.update', targetType: 'faq', targetId: id, detail: { before, after } }, q);
    return (await q<FaqRow[]>`${FAQ_SELECT(q)} where f.id = ${id}`)[0];
  });
  return { ok: true, faq: faqView(row) };
}

async function deleteFaq(ctx: Ctx) {
  await requireStaff(ctx, 'content.write');
  const id = idParam(ctx, NO_FAQ);
  await tx(async (q) => {
    const cur = (await q<FaqRow[]>`${FAQ_SELECT(q)} where f.id = ${id} for update of f`)[0];
    if (!cur) throw notFound(NO_FAQ);
    await q`delete from faq_entries where id = ${id}`;
    await audit(ctx, {
      action: 'faq.delete', targetType: 'faq', targetId: id,
      detail: { before: { question: cur.question, answer: cur.answer, keywords: cur.keywords, audience: cur.audience, status: cur.status, sort: cur.sort }, after: null },
    }, q);
  });
  return { ok: true, deleted: true, id };
}

// ── reviews: GET /api/admin/reviews, POST /api/admin/reviews/:id/status ─────────────────

type ReviewRow = {
  id: number; product_id: string; product_title: string; user_id: string; user_name: string; user_email: string;
  rating: number; title: string | null; body: string | null; status: string; moderated_by: string | null;
  moderated_by_email: string | null; moderated_at: Date | null; created_at: Date; updated_at: Date;
};

const REVIEW_SELECT = (q: Tx) => q`
  select r.id, r.product_id, pr.title as product_title, r.user_id, u.name as user_name, u.email::text as user_email,
         r.rating, r.title, r.body, r.status, r.moderated_by, m.email::text as moderated_by_email, r.moderated_at,
         r.created_at, r.updated_at
  from reviews r
  join products pr on pr.id = r.product_id
  join profiles u on u.id = r.user_id
  left join profiles m on m.id = r.moderated_by`;

function initialsOf(name: string): string {
  const words = String(name ?? '').replace(/[^\p{L}\p{N}\s'-]/gu, ' ').split(/\s+/).filter(Boolean).slice(0, 3);
  return words.length ? words.map((w) => Array.from(w)[0].toUpperCase() + '.').join(' ') : 'A customer';
}

/** Reviewers' email addresses only for staff who may see customer accounts. */
function reviewView(r: ReviewRow, showEmail: boolean) {
  return {
    id: r.id,
    worksheet: r.product_id,
    worksheetTitle: r.product_title,
    rating: r.rating,
    title: r.title,
    body: r.body,
    status: r.status,
    createdAt: ms(r.created_at),
    updatedAt: ms(r.updated_at),
    moderatedAt: ms(r.moderated_at),
    moderatedBy: r.moderated_by_email ?? r.moderated_by,
    customer: { id: r.user_id, name: r.user_name, initials: initialsOf(r.user_name), email: showEmail ? r.user_email : null },
  };
}

/** GET /api/admin/reviews?status=pending|published|hidden&worksheet=&limit=&offset= */
async function listReviews(ctx: Ctx) {
  const u = await requireStaff(ctx, 'reviews.moderate');
  const sp = ctx.query;
  const status = oneOf(sp.get('status'), REVIEW_STATUSES, 'status', 'Status is pending, published or hidden.');
  const product = sp.get('worksheet') || sp.get('product') || null;
  if (product && !PRODUCT_RE.test(product)) throw invalid({ worksheet: 'Unknown worksheet.' });
  const { limit, offset } = paging(ctx, 100, 500);
  const showEmail = hasPermission(u.staff, 'customers.read');
  const out = await tx(async (q) => {
    const rows = await q<ReviewRow[]>`
      ${REVIEW_SELECT(q)}
      where (${status}::text is null or r.status = ${status}::text) and (${product}::text is null or r.product_id = ${product}::text)
      order by r.created_at desc, r.id desc limit ${limit} offset ${offset}`;
    const c = (await q<{ pending: number; published: number; hidden: number; total: number }[]>`
      select count(*) filter (where status = 'pending')::int as pending, count(*) filter (where status = 'published')::int as published,
             count(*) filter (where status = 'hidden')::int as hidden,
             count(*) filter (where (${status}::text is null or status = ${status}::text))::int as total
      from reviews where (${product}::text is null or product_id = ${product}::text)`)[0];
    return { rows, c };
  });
  return {
    reviews: out.rows.map((r) => reviewView(r, showEmail)),
    counts: { pending: out.c.pending, published: out.c.published, hidden: out.c.hidden },
    total: out.c.total, limit, offset, nextOffset: nextOffset(offset, out.rows.length, out.c.total),
  };
}

/** POST /api/admin/reviews/:id/status {status, note?} — the product's average and count are kept
 *  by the reviews_stats trigger (published reviews only). */
async function setReviewStatus(ctx: Ctx) {
  const u = await requireStaff(ctx, 'reviews.moderate');
  const id = idParam(ctx, NO_REVIEW);
  const b = await readJson(ctx.req, 4096);
  if (!(REVIEW_STATUSES as readonly unknown[]).includes(b.status)) throw invalid({ status: 'Status is pending, published or hidden.' });
  const status = b.status as string;
  if (b.note !== undefined && b.note !== null && typeof b.note !== 'string') throw invalid({ note: 'The note must be text.' });
  const note = typeof b.note === 'string' ? cleanText(b.note, 300) || null : null;
  const out = await tx(async (q) => {
    const cur = (await q<{ id: number; status: string; product_id: string; rating: number }[]>`
      select id, status, product_id, rating from reviews where id = ${id} for update`)[0];
    if (!cur) throw notFound(NO_REVIEW);
    let changed = false;
    if (cur.status !== status) {
      await q`update reviews set status = ${status}, moderated_by = ${u.id}, moderated_at = now() where id = ${id}`;
      await audit(ctx, {
        action: 'review.status', targetType: 'review', targetId: id,
        detail: { worksheet: cur.product_id, rating: cur.rating, before: { status: cur.status }, after: { status }, note },
      }, q);
      changed = true;
    }
    const review = (await q<ReviewRow[]>`${REVIEW_SELECT(q)} where r.id = ${id}`)[0];
    const p = (await q<{ review_avg: number | null; review_count: number }[]>`
      select review_avg::float8 as review_avg, review_count from products where id = ${cur.product_id}`)[0];
    return { changed, review, p };
  });
  return {
    ok: true,
    changed: out.changed,
    review: reviewView(out.review, hasPermission(u.staff, 'customers.read')),
    worksheet: { id: out.review.product_id, reviewAvg: out.p?.review_avg ?? null, reviewCount: out.p?.review_count ?? 0 },
  };
}

export function register(r: Router) {
  r.get('/api/admin/stats', stats);
  r.get('/api/admin/analytics', analyticsPage);
  r.get('/api/admin/emails', listEmails);
  r.post('/api/admin/emails/process', processEmails);
  r.post('/api/admin/emails/:id/retry', retryEmail);
  r.post('/api/admin/emails/:id/skip', skipEmail);
  r.get('/api/admin/audit', listAudit);
  r.get('/api/admin/notifications', listNotifications);
  r.post('/api/admin/notifications/read', readNotifications);
  r.get('/api/admin/export/:kind', exportCsv);
  r.get('/api/admin/backup', backup);
  r.get('/api/admin/developer/health', developerHealth);
  r.get('/api/admin/content', getContent);
  r.put('/api/admin/content', putContent);
  r.get('/api/admin/faq', listFaq);
  r.post('/api/admin/faq', createFaq);
  r.put('/api/admin/faq/:id', updateFaq);
  r.delete('/api/admin/faq/:id', deleteFaq);
  r.get('/api/admin/reviews', listReviews);
  r.post('/api/admin/reviews/:id/status', setReviewStatus);
}
