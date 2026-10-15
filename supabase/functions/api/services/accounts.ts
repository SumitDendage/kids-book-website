// Accounts: the sessions this API opens, ending them, whole-account blocks and one-time links.
// Supabase Auth keeps passwords and its own sessions; app_sessions is our record of each sign-in
// (its end, device, network, block). Both are ended together so a refresh token stops working too.
import type { Tx } from '../lib/db.ts';
import { tx } from '../lib/db.ts';
import type { Ctx } from '../lib/context.ts';
import type { AuthSession } from '../lib/gotrue.ts';
import { getSettings } from '../lib/settings.ts';
import { audit, securityEvent } from '../lib/guard.ts';
import { sendSensitive } from '../lib/mail.ts';
import { env } from '../lib/env.ts';
import { cleanText, newLinkToken, sha256Hex } from '../lib/util.ts';
import { passwordReset } from './emails.ts';

export type EndReason = 'logout' | 'password_reset' | 'account_blocked' | 'staff' | 'expired' | 'replaced';

export type SessionBody = { accessToken: string; refreshToken: string; expiresAt: number; expiresIn: number; sessionExpiresAt: number };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, Math.floor(Number.isFinite(n) ? n : min)));

/** The hard limit for one sign-in (SECURITY.md: "never more than 90 days"). Settings can shorten
 *  it, never lengthen it; app_sessions has a check constraint with the same limit. */
export const MAX_SESSION_DAYS = 90;

/** How long a new sign-in lasts, in seconds: "remember me" days or short hours, never past maxDays
 *  and never past MAX_SESSION_DAYS, whatever the settings row says. */
export async function sessionSeconds(q: Tx, remember: boolean): Promise<number> {
  const s = (await getSettings(q)).sessions;
  const maxSeconds = clamp(s.maxDays, 1, MAX_SESSION_DAYS) * 86400;
  const ttl = remember ? clamp(s.rememberDays, 1, MAX_SESSION_DAYS) * 86400 : clamp(s.shortHours, 1, 24 * MAX_SESSION_DAYS) * 3600;
  return Math.min(ttl, maxSeconds);
}

/** Records the Supabase Auth session in app_sessions (end from settings.sessions) and returns its end. */
export async function openSession(q: Tx, ctx: Ctx, o: { userId: string; sessionId: string; remember: boolean; isStaff: boolean }): Promise<{ expiresAt: Date }> {
  if (!UUID_RE.test(o.sessionId) || !UUID_RE.test(o.userId)) throw new Error('openSession: bad session or user id');
  const seconds = await sessionSeconds(q, o.remember);
  // The end is fixed here; refreshing never moves it (the cap counts from sign-in).
  const rows = await q<{ expires_at: Date }[]>`
    insert into app_sessions (id, user_id, remember, expires_at, ip, ip_network, country, user_agent, device_label, device_id_hash, is_staff)
    values (${o.sessionId}, ${o.userId}, ${o.remember}, now() + make_interval(secs => ${seconds}),
            ${ctx.ip}, ${ctx.ipNetwork}, ${ctx.country}, ${ctx.ua || null}, ${ctx.deviceLabel.slice(0, 80)},
            ${ctx.deviceIdHash}, ${o.isStaff})
    returning expires_at`;
  return { expiresAt: new Date(rows[0].expires_at) };
}

/** Ends every session of a user except keepSessionId: app_sessions revoked with `reason` and the
 *  Supabase Auth sessions deleted (private.end_auth_sessions), so refresh tokens stop working. */
export async function endAllSessions(q: Tx, userId: string, reason: EndReason, keepSessionId?: string | null): Promise<number> {
  const keep = keepSessionId && UUID_RE.test(keepSessionId) ? keepSessionId : null;
  const ended = await q`
    update app_sessions set revoked_at = now(), revoke_reason = ${reason}
    where user_id = ${userId} and revoked_at is null and (${keep}::uuid is null or id <> ${keep}::uuid)`;
  await q`select private.end_auth_sessions(${userId}::uuid, ${keep}::uuid)`;
  return ended.count;
}

/** Whole-account block (sign-in refused, every session ended, audit row + security event).
 *  Returns false when the account was already blocked. */
export async function blockAccount(q: Tx, ctx: Ctx, userId: string, reason: string): Promise<boolean> {
  const why = cleanText(reason, 500) || null;
  const rows = await q<{ id: string }[]>`
    update profiles set blocked_at = now(), blocked_reason = ${why}, blocked_by = ${ctx.user?.id ?? null}
    where id = ${userId} and blocked_at is null
    returning id`;
  if (!rows.length) return false;
  const sessions = await endAllSessions(q, userId, 'account_blocked');
  await audit(ctx, { action: 'account.block', targetType: 'profile', targetId: userId, detail: { reason: why, sessionsEnded: sessions } }, q);
  await securityEvent(ctx, userId, 'account_blocked', { by: ctx.user?.id ?? null, reason: why, sessionsEnded: sessions }, q);
  return true;
}

/** Lifts a whole-account block (audit row + security event). False when it was not blocked. */
export async function unblockAccount(q: Tx, ctx: Ctx, userId: string): Promise<boolean> {
  const old = await q<{ blocked_reason: string | null }[]>`
    select blocked_reason from profiles where id = ${userId} and blocked_at is not null for update`;
  if (!old.length) return false;
  await q`update profiles set blocked_at = null, blocked_reason = null, blocked_by = null where id = ${userId}`;
  await audit(ctx, { action: 'account.unblock', targetType: 'profile', targetId: userId, detail: { previousReason: old[0].blocked_reason } }, q);
  await securityEvent(ctx, userId, 'account_unblocked', { by: ctx.user?.id ?? null }, q);
  return true;
}

/** The `session` object returned by login and refresh. */
export function sessionBody(s: AuthSession, appExpiresAt: Date): SessionBody {
  return {
    accessToken: s.accessToken,
    refreshToken: s.refreshToken,
    expiresAt: s.expiresAt,
    expiresIn: s.expiresIn,
    sessionExpiresAt: new Date(appExpiresAt).getTime(),
  };
}

export type LinkPurpose = 'verify_email' | 'reset_password';

/** Creates a one-time link token (only its SHA-256 is stored). Earlier unused links for the same
 *  purpose stop working, so only the newest email counts. Returns the raw token for the email. */
export async function issueLinkToken(q: Tx, ctx: Ctx | null, userId: string, purpose: LinkPurpose, minutes: number): Promise<string> {
  const token = newLinkToken();
  const life = clamp(minutes, 1, 60 * 24 * 30);
  await q`update auth_tokens set expires_at = least(expires_at, now())
          where user_id = ${userId} and purpose = ${purpose} and used_at is null`;
  await q`insert into auth_tokens (user_id, purpose, token_hash, expires_at, created_ip)
          values (${userId}, ${purpose}, ${await sha256Hex(token)}, now() + make_interval(mins => ${life}), ${ctx?.ip ?? null})`;
  return token;
}

/** The link the website reads: /?verify=<token> or /?reset=<token>. */
export function linkUrl(param: 'verify' | 'reset', token: string): string {
  return `${env().siteUrl}/?${param}=${token}`;
}

/** Emails a password-reset link to an existing, not-blocked account (sent now, the body is never
 *  stored). Used by forgot-password and by staff tools. Returns false when nothing was sent. */
export async function sendResetLink(ctx: Ctx, userId: string): Promise<boolean> {
  const out = await tx(async (q) => {
    const p = await q<{ id: string; email: string; name: string; blocked_at: Date | null }[]>`
      select id, email, name, blocked_at from profiles where id = ${userId}`;
    if (!p.length || p[0].blocked_at) return null;
    const minutes = (await getSettings(q)).auth_links.resetMinutes;
    const token = await issueLinkToken(q, ctx, userId, 'reset_password', minutes);
    await securityEvent(ctx, userId, 'password_reset_requested', null, q);
    return { profile: p[0], token, minutes: clamp(minutes, 1, 60 * 24 * 30) };
  });
  if (!out) return false;
  const mail = passwordReset({ name: out.profile.name || 'there', resetUrl: linkUrl('reset', out.token), minutes: out.minutes });
  const r = await sendSensitive({ ...mail, to: out.profile.email, template: 'password_reset', userId, relatedType: 'profile', relatedId: userId });
  if (!r.ok) console.error('[auth] reset email not sent:', r.error);
  return r.ok;
}
