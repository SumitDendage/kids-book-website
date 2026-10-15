// OWNER: agent D. My Account → Security and friends (customer routes): security status (E1),
// acknowledging warnings (E2), appeals, notifications, the customer's own sign-ins and reviews.
// All of these keep working while paid access is suspended.
import type { Router } from '../lib/router.ts';
import type { Ctx } from '../lib/context.ts';
import { isUnique, tx } from '../lib/db.ts';
import { HttpError, intParam, readJson } from '../lib/http.ts';
import { requireUser } from '../lib/auth.ts';
import { notify, rateLimit, securityEvent } from '../lib/guard.ts';
import { getSettings } from '../lib/settings.ts';
import { enqueue, kickOutbox } from '../lib/mail.ts';
import { env } from '../lib/env.ts';
import { cleanText, validEmail } from '../lib/util.ts';
import { staffAlert } from '../services/emails.ts';
import { acknowledgeWarnings, securityStatus } from '../services/sharing.ts';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const PRODUCT_RE = /^[A-Za-z0-9][A-Za-z0-9-]{1,63}$/;
const ms = (d: Date | string | null | undefined) => (d == null ? null : new Date(d).getTime());

const bad = (field: string, msg: string): never => {
  throw new HttpError(400, msg, { errors: { [field]: msg } });
};

/** A whole number in [min, max] or null (numbers and digit strings only). */
function intIn(v: unknown, min: number, max: number): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^-?\d{1,9}$/.test(v.trim()) ? Number(v) : NaN;
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
}

// ── security (E1, E2) ────────────────────────────────────────────────────────────────────

async function getSecurity(ctx: Ctx) {
  const u = await requireUser(ctx);
  return await tx((q) => securityStatus(q, u.id));
}

async function acknowledge(ctx: Ctx) {
  const u = await requireUser(ctx);
  const b = await readJson(ctx.req, 4096);
  const level = intIn(b.warning, 0, 20);
  if (level === null) bad('warning', 'Send the warning number you have read (0 to 20).');
  await rateLimit(ctx, 'ack', u.id, 60, 3600);
  const status = await tx((q) => acknowledgeWarnings(q, u.id, level!));
  return { ok: true, ...status };
}

// ── appeals ─────────────────────────────────────────────────────────────────────────────

const APPEAL_KINDS = ['warning', 'suspension', 'block'] as const;

type AppealRow = { id: number; kind: string; message: string; status: string; staff_response: string | null; warning_id: number | null; created_at: Date; decided_at: Date | null };

const pubAppeal = (a: AppealRow) => ({
  id: a.id, kind: a.kind, message: a.message, status: a.status, response: a.staff_response,
  warningId: a.warning_id, createdAt: ms(a.created_at), decidedAt: ms(a.decided_at),
});

async function listAppeals(ctx: Ctx) {
  const u = await requireUser(ctx);
  const rows = await tx((q) => q<AppealRow[]>`
    select id, kind, message, status, staff_response, warning_id, created_at, decided_at
    from account_appeals where user_id = ${u.id}
    order by created_at desc, id desc limit 50`);
  return { appeals: rows.map(pubAppeal) };
}

async function createAppeal(ctx: Ctx) {
  const u = await requireUser(ctx);
  const b = await readJson(ctx.req, 16 * 1024);
  const kind = String(b.kind ?? '');
  if (!(APPEAL_KINDS as readonly string[]).includes(kind)) bad('kind', 'Choose what the note is about: warning, suspension or block.');
  const message = cleanText(b.message, 4000);
  if (message.length < 10) bad('message', 'Write a few words (10 characters or more).');
  let warningId: number | null = null;
  if (b.warningId !== undefined && b.warningId !== null && b.warningId !== '') {
    warningId = intIn(b.warningId, 1, Number.MAX_SAFE_INTEGER);
    if (warningId === null) bad('warningId', 'Unknown warning.');
  }
  await rateLimit(ctx, 'appeal', u.id, 5, 3600);
  const settings = await getSettings();

  let appeal: AppealRow;
  try {
    appeal = await tx(async (q) => {
      if (warningId !== null) {
        const w = await q`select 1 from account_warnings where id = ${warningId} and user_id = ${u.id}`;
        if (!w.length) bad('warningId', 'Unknown warning.');
      }
      const rows = await q<AppealRow[]>`
        insert into account_appeals (user_id, warning_id, kind, message)
        values (${u.id}, ${warningId}, ${kind}, ${message})
        returning id, kind, message, status, staff_response, warning_id, created_at, decided_at`;
      const a = rows[0];
      await securityEvent(ctx, u.id, 'appeal.created', { appealId: a.id, kind, warningId }, q);
      await notify(q, {
        audience: 'staff', kind: 'appeal.new', title: `New note about account security: ${u.profile.email}`,
        body: message.slice(0, 300), link: '/admin', data: { userId: u.id, appealId: a.id, kind, warningId },
      });
      const mail = staffAlert({
        title: `New security note from ${u.profile.email}`,
        lines: [
          `Customer: ${u.profile.name || '(no name)'} <${u.profile.email}>`,
          `About: ${kind}${warningId ? ` (warning #${warningId})` : ''}`,
          `Paid access: ${u.profile.subscription_suspended_at ? 'suspended' : 'open'}`,
          'Message:', message,
        ],
        link: `${env().siteUrl}/admin`,
      });
      const to = [...new Set((settings.email.adminAlerts ?? []).map((x) => String(x).trim().toLowerCase()).filter(validEmail))].slice(0, 10);
      for (let i = 0; i < to.length; i++) {
        await enqueue(q, {
          template: 'staff_alert', to: to[i], subject: mail.subject, html: mail.html, text: mail.text, replyTo: u.profile.email,
          dedupeKey: i === 0 ? `appeal-staff:${a.id}` : `appeal-staff:${a.id}:${i}`, relatedType: 'account_appeal', relatedId: a.id,
        });
      }
      return a;
    });
  } catch (e) {
    if (isUnique(e, 'account_appeals_one_open')) {
      throw new HttpError(409, 'You already sent us a note that is waiting for an answer — we will reply soon.', { code: 'appeal_open' });
    }
    throw e;
  }
  kickOutbox(ctx);
  return { ok: true, appeal: pubAppeal(appeal) };
}

// ── notifications ───────────────────────────────────────────────────────────────────────

async function listNotifications(ctx: Ctx) {
  const u = await requireUser(ctx);
  const limit = intParam(ctx.query.get('limit'), 50, 1, 100);
  const unreadOnly = ['1', 'true'].includes(ctx.query.get('unread') ?? '');
  const out = await tx(async (q) => {
    const rows = await q<{ id: number; kind: string; title: string; body: string | null; link: string | null; data: unknown; created_at: Date; read_at: Date | null }[]>`
      select id, kind, title, body, link, data, created_at, read_at from notifications
      where audience = 'customer' and user_id = ${u.id} and (${!unreadOnly} or read_at is null)
      order by created_at desc, id desc limit ${limit}`;
    const c = await q<{ n: number }[]>`
      select count(*)::int as n from notifications where audience = 'customer' and user_id = ${u.id} and read_at is null`;
    return { rows, unread: c[0]?.n ?? 0 };
  });
  return {
    notifications: out.rows.map((n) => ({
      id: n.id, kind: n.kind, title: n.title, body: n.body, link: n.link, data: n.data ?? null,
      createdAt: ms(n.created_at), read: !!n.read_at, readAt: ms(n.read_at),
    })),
    unread: out.unread,
  };
}

async function readNotifications(ctx: Ctx) {
  const u = await requireUser(ctx);
  const b = await readJson(ctx.req, 16 * 1024);
  const all = b.all === true;
  let ids: number[] = [];
  if (!all) {
    if (!Array.isArray(b.ids) || b.ids.length === 0 || b.ids.length > 200) bad('ids', 'Send ids (1 to 200) or all: true.');
    ids = (b.ids as unknown[]).map((x) => intIn(x, 1, Number.MAX_SAFE_INTEGER)).filter((x): x is number => x !== null);
    if (ids.length !== (b.ids as unknown[]).length) bad('ids', 'Every id must be a notification number.');
  }
  const r = await tx((q) => all
    ? q`update notifications set read_at = now() where audience = 'customer' and user_id = ${u.id} and read_at is null`
    : q`update notifications set read_at = now()
        where audience = 'customer' and user_id = ${u.id} and read_at is null and id = any(${ids}::bigint[])`);
  return { ok: true, updated: r.count };
}

// ── the customer's own sign-ins ─────────────────────────────────────────────────────────

/** "10.1.2.x" / "2001:db8:1::x": enough to recognise a place, not the full address. */
function maskIp(ip: string | null): string | null {
  if (!ip) return null;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) return ip.split('.').slice(0, 3).join('.') + '.x';
  if (ip.includes(':')) return ip.split(':').slice(0, 3).join(':') + '::x';
  return null;
}

async function listSessions(ctx: Ctx) {
  const u = await requireUser(ctx);
  const rows = await tx((q) => q<{ id: string; device_label: string | null; created_at: Date; last_seen_at: Date; expires_at: Date; ip: string | null; country: string | null; blocked_at: Date | null; remember: boolean }[]>`
    select id, device_label, created_at, last_seen_at, expires_at, ip, country, blocked_at, remember
    from app_sessions
    where user_id = ${u.id} and revoked_at is null and expires_at > now()
    order by last_seen_at desc limit 50`);
  return {
    sessions: rows.map((s) => ({
      id: s.id,
      device: s.device_label,
      ip: maskIp(s.ip),
      country: s.country,
      createdAt: ms(s.created_at),
      lastSeenAt: ms(s.last_seen_at),
      lastActiveAt: ms(s.last_seen_at),
      expiresAt: ms(s.expires_at),
      remember: s.remember,
      current: s.id === u.sessionId,
      blocked: !!s.blocked_at,
      status: s.blocked_at ? 'blocked' : 'active',
    })),
  };
}

async function endSession(ctx: Ctx) {
  const u = await requireUser(ctx);
  const id = String(ctx.params.id ?? '').toLowerCase();
  if (!UUID_RE.test(id)) throw new HttpError(404, 'Not found');
  if (id === u.sessionId) throw new HttpError(400, 'This is the sign-in you are using now — use Sign out instead.', { code: 'current_session' });
  await rateLimit(ctx, 'end-session', u.id, 20, 3600);
  const ended = await tx(async (q) => {
    const rows = await q<{ id: string }[]>`
      update app_sessions set revoked_at = now(), revoke_reason = 'logout'
      where id = ${id} and user_id = ${u.id} and revoked_at is null
      returning id`;
    if (!rows.length) return false;
    // also end it in Supabase Auth, so its refresh token stops working
    await q`select private.end_auth_session(${u.id}::uuid, ${id}::uuid)`;
    await securityEvent(ctx, u.id, 'session.ended_by_customer', { sessionId: id }, q);
    return true;
  });
  if (!ended) throw new HttpError(404, 'Not found');
  return { ok: true, sessionId: id };
}

// ── reviews ─────────────────────────────────────────────────────────────────────────────

async function postReview(ctx: Ctx) {
  const u = await requireUser(ctx);
  const b = await readJson(ctx.req, 16 * 1024);
  const worksheet = String(b.worksheet ?? b.worksheetId ?? '');
  if (!PRODUCT_RE.test(worksheet)) bad('worksheet', 'Choose a sheet.');
  const rating = intIn(b.rating, 1, 5);
  if (rating === null) bad('rating', 'Give 1 to 5 stars.');
  const title = b.title == null ? '' : cleanText(b.title, 1000);
  if (title.length > 120) bad('title', 'Keep the title under 120 characters.');
  const body = b.body == null ? '' : cleanText(b.body, 5000);
  if (body.length > 2000) bad('body', 'Keep the review under 2000 characters.');
  await rateLimit(ctx, 'review', u.id, 10, 3600);

  const review = await tx(async (q) => {
    const p = await q<{ id: string; class_id: string }[]>`select id, class_id from products where id = ${worksheet}`;
    if (!p[0]) throw new HttpError(404, 'No such worksheet.');
    // only someone who bought or opened it (now or before), not counting refunded/revoked access
    const has = await q`
      select 1 from entitlements e
      where e.user_id = ${u.id} and e.revoked_at is null and e.starts_at <= now()
        and ((e.scope = 'worksheet' and e.product_id = ${p[0].id}) or (e.scope = 'class' and e.class_id = ${p[0].class_id}))
      limit 1`;
    if (!has.length) {
      throw new HttpError(403, 'You can review a sheet after you have bought or opened it.', { code: 'not_eligible' });
    }
    const rows = await q<{ id: number; rating: number; title: string | null; body: string | null; status: string; created_at: Date; updated_at: Date }[]>`
      insert into reviews (product_id, user_id, rating, title, body)
      values (${p[0].id}, ${u.id}, ${rating}, ${title || null}, ${body || null})
      on conflict (product_id, user_id) do update
        set rating = excluded.rating, title = excluded.title, body = excluded.body,
            status = 'pending', moderated_by = null, moderated_at = null
      returning id, rating, title, body, status, created_at, updated_at`;
    return rows[0];
  });
  return {
    ok: true,
    review: {
      id: review.id, worksheet, rating: review.rating, title: review.title, body: review.body, status: review.status,
      createdAt: ms(review.created_at), updatedAt: ms(review.updated_at),
    },
  };
}

export function register(r: Router) {
  r.get('/api/me/security', getSecurity);
  r.post('/api/me/security/acknowledge', acknowledge);
  r.get('/api/me/appeals', listAppeals);
  r.post('/api/me/appeals', createAppeal);
  r.get('/api/me/notifications', listNotifications);
  r.post('/api/me/notifications/read', readNotifications);
  r.get('/api/me/sessions', listSessions);
  r.post('/api/me/sessions/:id/end', endSession);
  r.post('/api/me/reviews', postReview);
}
