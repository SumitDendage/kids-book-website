// Customer and staff accounts: sign-up (the server makes the password and emails it once),
// email confirmation, sign-in with lockout, sessions (Supabase Auth tokens + our app_sessions
// row), profile edits, and password reset. Request and response shapes follow the old site.
import type { Router } from '../lib/router.ts';
import type { Ctx, Profile, StaffInfo } from '../lib/context.ts';
import { tx } from '../lib/db.ts';
import { HttpError, json, ms, readJson } from '../lib/http.ts';
import { analytics, loginActivity, rateLimit, securityEvent } from '../lib/guard.ts';
import { enqueue, kickOutbox, sendSensitive } from '../lib/mail.ts';
import { mailReady } from '../lib/env.ts';
import { getSettings } from '../lib/settings.ts';
import {
  adminCreateUser, adminDeleteUser, adminUpdateUser, AuthApiError, logoutSession, passwordGrant, refreshGrant,
  type AuthSession,
} from '../lib/gotrue.ts';
import { BLOCKED_MESSAGE, bearer, effectivePermissions, loadAccount, publicUser, requireUser, SIGN_IN, verifyAccessToken } from '../lib/auth.ts';
import { cleanName, generatePassword, isTimeZone, LINK_TOKEN_RE, normEmail, passwordProblem, sha256Hex, validEmail } from '../lib/util.ts';
import { passwordChanged, resendVerification as resendVerificationMail, welcome } from '../services/emails.ts';
import { endAllSessions, issueLinkToken, linkUrl, openSession, sendResetLink, sessionBody } from '../services/accounts.ts';
import { evaluateRules, securityStatus, type SecurityStatus } from '../services/sharing.ts';

const ROLES = ['parent', 'teacher', 'tutor', 'school'];
const BAD_LOGIN = 'We could not match that email and password. New here? Sign up instead.';
const SESSION_BLOCKED = 'This sign-in was stopped by Learn With Why. Sign in again on your own device, or write to us if you think this is a mistake.';
const AGREEMENT_NEEDED = 'Please accept the agreement: your account is personal and must not be shared.';
const MAIL_OFF = 'The server cannot send email yet. Please try again later.';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ipKey = (ctx: Ctx) => ctx.ip ?? '-';
const clampInt = (n: number, min: number, max: number) => Math.max(min, Math.min(max, Math.floor(Number.isFinite(n) ? n : min)));
const signIn = () => new HttpError(401, SIGN_IN, { code: 'signin' });
const badLogin = () => new HttpError(401, BAD_LOGIN, { code: 'bad_credentials' });
const emailTaken = () => new HttpError(409, 'That email already has an account. Sign in instead — or use Forgot password.', {
  code: 'email_taken', errors: { email: 'That email already has an account.' },
});
const unverified = (email: string) => new HttpError(403, `Please confirm your email first: open the email we sent to ${email} and press Accept & Continue.`, { code: 'email_unverified', email });
const suspended = () => new HttpError(403, BLOCKED_MESSAGE, { code: 'account_suspended' });
const truthy = (v: unknown) => v === true || v === 1 || v === 'true' || v === '1' || v === 'on';
const str = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v));

function lockedError(until: Date | string | number): HttpError {
  const untilMs = new Date(until).getTime();
  const minutes = Math.max(1, Math.ceil((untilMs - Date.now()) / 60_000));
  return new HttpError(429, `Too many wrong passwords — this account is locked for ${minutes} more minute(s). You can unlock it now with Forgot password.`,
    { code: 'account_locked', lockedUntil: untilMs }, { 'Retry-After': String(Math.max(1, Math.ceil((untilMs - Date.now()) / 1000))) });
}

/** The customer's security summary; null if it cannot be built (it never blocks sign-in). */
async function securityFor(userId: string): Promise<SecurityStatus | null> {
  try {
    return await tx((q) => securityStatus(q, userId));
  } catch (e) {
    console.error('[auth] security status unavailable:', (e as Error)?.message ?? e);
    return null;
  }
}

async function allPermissionKeys(): Promise<string[]> {
  const rows = await tx((q) => q<{ id: string }[]>`select id from staff_permissions order by id`);
  return rows.map((r) => r.id);
}

function staffBody(staff: StaffInfo | null, keys: string[]) {
  return staff ? { role: staff.role, permissions: effectivePermissions(staff, keys) } : null;
}

/** Email links and reset/resend share these limits, like the old server. */
async function mailLimits(ctx: Ctx, email: string) {
  await rateLimit(ctx, 'mail_ip', ipKey(ctx), 20, 3600);
  await rateLimit(ctx, 'mail_email', email, 3, 3600);
}

// ── POST /api/auth/signup ────────────────────────────────────────────────────────────────
async function signup(ctx: Ctx) {
  const b = await readJson(ctx.req);
  const settings = await getSettings();
  const agreement = settings.agreement;
  const name = cleanName(b.name);
  const email = normEmail(b.email);
  const errors: Record<string, string> = {};
  if (!name) errors.name = 'Tell us your name.';
  else if (name.length > 80) errors.name = 'Keep the name under 80 characters.';
  if (!validEmail(email)) errors.email = 'Enter a valid email address.';
  let role: string | null = null;
  if (b.role !== undefined && b.role !== null && b.role !== '') {
    if (typeof b.role === 'string' && ROLES.includes(b.role)) role = b.role;
    else errors.role = 'Unknown role.';
  }
  const versionSent = b.agreementVersion == null || b.agreementVersion === '' ? null : str(b.agreementVersion).slice(0, 40);
  if (b.agreement !== true) errors.agreement = AGREEMENT_NEEDED;
  else if (versionSent !== null && versionSent !== agreement.version) errors.agreement = 'The agreement was updated — please read it again and accept it.';
  if (Object.keys(errors).length) {
    const extra = errors.agreement ? { code: 'agreement_required', agreement: { version: agreement.version, text: agreement.text } } : {};
    throw new HttpError(400, Object.values(errors)[0], { errors, ...extra });
  }
  const timeZone = typeof b.timeZone === 'string' && isTimeZone(b.timeZone) ? b.timeZone : null;

  await rateLimit(ctx, 'signup_ip', ipKey(ctx), 20, 3600);
  await rateLimit(ctx, 'signup_email', email, 3, 3600);
  if (!mailReady()) {
    throw new HttpError(503, 'Sign-up is paused because the server cannot send email yet. Please try again later.', { code: 'mail_unavailable' });
  }
  const existing = await tx((q) => q`select 1 from profiles where email = ${email}`);
  if (existing.length) throw emailTaken();

  // The password exists only in this request and in the welcome email; Supabase Auth hashes it.
  const password = generatePassword();
  let userId: string;
  try {
    userId = (await adminCreateUser({ email, password, name, via: 'signup', confirmed: false })).id;
  } catch (e) {
    if (e instanceof AuthApiError) {
      if (['email_exists', 'user_already_exists'].includes(e.code) || /already (been )?(registered|exists)/i.test(e.message)) throw emailTaken();
      if (e.status === 400 || e.status === 422) {
        throw new HttpError(400, 'Enter a valid email address.', { errors: { email: 'Enter a valid email address.' } });
      }
      console.error('[auth] sign-up refused by Supabase Auth:', e.status, e.code);
      throw new HttpError(502, 'We could not create your account just now. Please try again in a few minutes.', { code: 'signup_failed' });
    }
    throw e;
  }
  if (!UUID_RE.test(userId)) throw new HttpError(502, 'We could not create your account just now. Please try again in a few minutes.', { code: 'signup_failed' });

  const undo = async (why: string) => {
    try {
      await adminDeleteUser(userId);
    } catch (err) {
      // The account stays unconfirmed; "Send the email again" or Forgot password can recover it.
      console.error('[auth] sign-up could not be undone after', why, (err as Error)?.message ?? err);
    }
  };

  const hours = clampInt(settings.auth_links.verifyHours, 1, 24 * 30);
  let token: string;
  try {
    const textHash = await sha256Hex(agreement.text);
    token = await tx(async (q) => {
      const rows = await q`
        update profiles set name = ${name}, role = ${role}, time_zone = coalesce(${timeZone}::text, time_zone),
          agreement_version = ${agreement.version}, agreement_accepted_at = now()
        where id = ${userId} returning id`;
      if (!rows.length) throw new Error('profile row missing after sign-up');
      await q`
        insert into agreement_acceptances (user_id, version, text_sha256, context, ip, user_agent)
        values (${userId}, ${agreement.version}, ${textHash}, 'signup', ${ctx.ip}, ${ctx.ua || null})`;
      return await issueLinkToken(q, ctx, userId, 'verify_email', hours * 60);
    });
  } catch (e) {
    await undo('a database error');
    throw e;
  }

  const mail = welcome({ name, email, password, verifyUrl: linkUrl('verify', token), hours });
  const sent = await sendSensitive({ ...mail, to: email, template: 'welcome', userId, relatedType: 'profile', relatedId: userId })
    .catch((e) => ({ ok: false as const, error: String((e as Error)?.message ?? e) }));
  if (!sent.ok) {
    // nobody can sign in to an account whose password never arrived: take it back
    console.error('[auth] welcome email not sent, sign-up undone:', sent.error);
    await undo('a failed welcome email');
    throw new HttpError(502, 'We could not send your welcome email just now, so the account was not created. Please try again in a few minutes.', { code: 'mail_failed' });
  }
  await tx(async (q) => {
    await analytics(q, ctx, { kind: 'signup', userId });
    await securityEvent(ctx, userId, 'signup', { emailDelivered: true }, q);
  }).catch((e) => console.error('[auth] sign-up trail not saved:', (e as Error)?.message ?? e));

  return json(201, {
    ok: true,
    verificationRequired: true,
    passwordEmailed: true,
    email,
    message: `Account created! We have emailed your password to ${email}. Open that email and press Accept & Continue to confirm your address, then sign in here.`,
  });
}

// ── POST /api/auth/verify-email ──────────────────────────────────────────────────────────
async function verifyEmail(ctx: Ctx) {
  await rateLimit(ctx, 'auth_token', ipKey(ctx), 30, 900);
  const b = await readJson(ctx.req);
  const token = str(b.token);
  const invalid = () => new HttpError(400, 'This confirmation link is not valid. Sign in to get a new one sent to you.', { code: 'token_invalid' });
  if (!LINK_TOKEN_RE.test(token)) throw invalid();
  const hash = await sha256Hex(token);
  type Out = { error: 'invalid' } | { error: 'expired'; email: string } | { already: true; email: string } | { verified: true; email: string; userId: string };
  const out = await tx<Out>(async (q) => {
    const t = await q<{ id: number; user_id: string; used_at: Date | null; expired: boolean }[]>`
      select id, user_id, used_at, expires_at <= now() as expired from auth_tokens
      where token_hash = ${hash} and purpose = 'verify_email' for update`;
    if (!t.length) return { error: 'invalid' };
    // read the account after the lock, so a second click that waited sees it confirmed
    const p = await q<{ email: string; email_verified_at: Date | null }[]>`
      select email, email_verified_at from profiles where id = ${t[0].user_id}`;
    if (!p.length) return { error: 'invalid' };
    if (p[0].email_verified_at) return { already: true, email: p[0].email };
    if (t[0].used_at) return { error: 'invalid' };
    if (t[0].expired) return { error: 'expired', email: p[0].email };
    await q`update auth_tokens set used_at = now() where user_id = ${t[0].user_id} and purpose = 'verify_email' and used_at is null`;
    await q`update profiles set email_verified_at = now(), status = 'active' where id = ${t[0].user_id}`;
    await securityEvent(ctx, t[0].user_id, 'email_verified', null, q);
    return { verified: true, email: p[0].email, userId: t[0].user_id };
  });
  if ('error' in out) {
    if (out.error === 'expired') {
      throw new HttpError(400, 'This confirmation link has expired. Sign in and choose "Send the email again" to get a new one.', { code: 'token_expired', email: out.email });
    }
    throw invalid();
  }
  if ('verified' in out) {
    // Supabase Auth must agree that the address is confirmed; sign-in repairs it if this fails.
    try {
      await adminUpdateUser(out.userId, { emailConfirm: true });
    } catch (e) {
      console.error('[auth] could not mark the email confirmed in Supabase Auth:', (e as Error)?.message ?? e);
    }
  }
  const already = 'already' in out;
  return {
    ok: true,
    verified: true,
    alreadyVerified: already,
    email: out.email,
    message: already ? 'Your email is already confirmed — sign in with your password.' : 'Email confirmed! Sign in with the password from your welcome email.',
  };
}

// ── POST /api/auth/resend-verification ───────────────────────────────────────────────────
async function resendVerification(ctx: Ctx) {
  const b = await readJson(ctx.req);
  const email = normEmail(b.email);
  if (!validEmail(email)) throw new HttpError(400, 'Enter a valid email address.', { errors: { email: 'Enter a valid email address.' } });
  await mailLimits(ctx, email);
  if (!mailReady()) throw new HttpError(503, MAIL_OFF, { code: 'mail_unavailable' });
  // The same answer, at the same speed, whether or not the address has an account.
  ctx.later(() => resendWork(ctx, email));
  return { ok: true, message: `If ${email} has an account that still needs confirming, a new email with a fresh password and confirmation link is on its way.` };
}

async function resendWork(ctx: Ctx, email: string) {
  const rows = await tx((q) => q<{ id: string; name: string; email: string; email_verified_at: Date | null; blocked_at: Date | null }[]>`
    select id, name, email, email_verified_at, blocked_at from profiles where email = ${email}`);
  const p = rows[0];
  if (!p || p.email_verified_at || p.blocked_at) return;
  const settings = await getSettings();
  const hours = clampInt(settings.auth_links.verifyHours, 1, 24 * 30);
  // a fresh password: the old one may never have arrived, and it stops working now
  const password = generatePassword();
  await adminUpdateUser(p.id, { password });
  const token = await tx(async (q) => {
    await q`update profiles set failed_login_attempts = 0, locked_until = null where id = ${p.id}`;
    const t = await issueLinkToken(q, ctx, p.id, 'verify_email', hours * 60);
    await securityEvent(ctx, p.id, 'verification_resent', null, q);
    return t;
  });
  const mail = resendVerificationMail({ name: p.name || 'there', password, verifyUrl: linkUrl('verify', token), hours });
  const r = await sendSensitive({ ...mail, to: p.email, template: 'resend_verification', userId: p.id, relatedType: 'profile', relatedId: p.id });
  if (!r.ok) console.error('[auth] verification email not sent:', r.error);
}

// ── POST /api/auth/login (alias /api/auth/signin) ────────────────────────────────────────
type Grant = { ok: true; s: AuthSession } | { ok: false; kind: 'bad' | 'unconfirmed' | 'banned' | 'busy' | 'down'; err?: unknown };

async function tryGrant(email: string, password: string, ip: string | null): Promise<Grant> {
  try {
    return { ok: true, s: await passwordGrant(email, password, ip) };
  } catch (e) {
    if (e instanceof AuthApiError) {
      if (e.code === 'email_not_confirmed') return { ok: false, kind: 'unconfirmed' };
      if (e.code === 'user_banned') return { ok: false, kind: 'banned' };
      if (e.status === 429) return { ok: false, kind: 'busy' };
      if (e.status >= 400 && e.status < 500) return { ok: false, kind: 'bad' };
      return { ok: false, kind: 'down', err: e };
    }
    if (e instanceof HttpError) return { ok: false, kind: 'down', err: e };
    throw e;
  }
}

async function login(ctx: Ctx) {
  const b = await readJson(ctx.req);
  const email = normEmail(b.email);
  const password = str(b.password);
  const errors: Record<string, string> = {};
  if (!validEmail(email)) errors.email = 'Enter a valid email address.';
  if (!password) errors.password = 'Enter your password.';
  if (Object.keys(errors).length) throw new HttpError(400, Object.values(errors)[0], { errors });
  if (password.length > 128) throw badLogin();
  const remember = truthy(b.remember);
  const wantStaff = b.staff === true;

  try {
    await rateLimit(ctx, 'login_ip', ipKey(ctx), 100, 900);
    await rateLimit(ctx, 'login', `${ipKey(ctx)}|${email}`, 10, 900);
  } catch (e) {
    if (e instanceof HttpError && e.status === 429) {
      await loginActivity(ctx, { userId: null, email, success: false, reason: 'rate_limited' }).catch(() => {});
    }
    throw e;
  }

  const settings = await getSettings();
  const maxFailed = clampInt(settings.login.maxFailed, 1, 100);
  const lockMinutes = clampInt(settings.login.lockMinutes, 1, 24 * 60);

  const found = await tx((q) => q<{ id: string }[]>`select id from profiles where email = ${email}`);
  if (!found.length) {
    // Sign-up already tells whether an address is registered, so no Supabase Auth call is spent here.
    await loginActivity(ctx, { userId: null, email, success: false, reason: 'bad_credentials' });
    throw badLogin();
  }
  const userId = found[0].id;
  const fail = (reason: string) => loginActivity(ctx, { userId, email, success: false, reason });
  const resetCounters = () => tx((q) => q`update profiles set failed_login_attempts = 0, locked_until = null where id = ${userId}`);

  // Take a numbered attempt BEFORE the password check, in one statement, so a burst of parallel
  // guesses cannot slip past the lock. A lock that has run out starts the count again.
  const slot = await tx(async (q) => {
    const r = await q<{ n: number }[]>`
      update profiles set
        failed_login_attempts = case when locked_until is not null and locked_until <= now() then 1 else failed_login_attempts + 1 end,
        locked_until = case when locked_until is not null and locked_until <= now() then null else locked_until end
      where id = ${userId} and (locked_until is null or locked_until <= now())
      returning failed_login_attempts as n`;
    if (r.length) return { n: r[0].n, lockedUntil: null as Date | null };
    const l = await q<{ locked_until: Date }[]>`select locked_until from profiles where id = ${userId}`;
    return { n: 0, lockedUntil: l[0]?.locked_until ?? new Date(Date.now() + 60_000) };
  });
  const lock = () => tx(async (q) => {
    const r = await q<{ locked_until: Date }[]>`
      update profiles set locked_until = coalesce(locked_until, now() + make_interval(mins => ${lockMinutes}))
      where id = ${userId} returning locked_until`;
    return r[0].locked_until;
  });
  if (slot.lockedUntil) {
    await fail('account_locked');
    throw lockedError(slot.lockedUntil);
  }
  if (slot.n > maxFailed) {
    const until = await lock();
    await fail('account_locked');
    throw lockedError(until);
  }

  let g = await tryGrant(email, password, ctx.ip);
  if (!g.ok && g.kind === 'unconfirmed') {
    // Right password, but Supabase Auth still holds the address unconfirmed. If we already
    // confirmed it (verify-email could not reach Supabase Auth), repair that and try again.
    const v = await tx((q) => q<{ email_verified_at: Date | null }[]>`select email_verified_at from profiles where id = ${userId}`);
    if (v[0]?.email_verified_at) {
      try {
        await adminUpdateUser(userId, { emailConfirm: true });
        g = await tryGrant(email, password, ctx.ip);
      } catch (e) {
        g = { ok: false, kind: 'down', err: e };
      }
    }
  }
  if (!g.ok) {
    if (g.kind === 'bad') {
      await fail('bad_credentials');
      // the Nth wrong password in a row locks the account
      if (slot.n >= maxFailed) {
        const until = await lock();
        await securityEvent(ctx, userId, 'account_locked', { attempts: slot.n, minutes: lockMinutes });
        throw lockedError(until);
      }
      throw badLogin();
    }
    if (g.kind === 'unconfirmed') {
      await resetCounters();
      await fail('email_unverified');
      throw unverified(email);
    }
    if (g.kind === 'banned') {
      await resetCounters();
      await fail('account_blocked');
      throw suspended();
    }
    // Supabase Auth was busy or down: this attempt does not count against the customer.
    await tx((q) => q`update profiles set failed_login_attempts = greatest(failed_login_attempts - 1, 0) where id = ${userId} and locked_until is null`);
    if (g.kind === 'busy') {
      await fail('rate_limited');
      throw new HttpError(429, 'Too many attempts — wait a few minutes and try again.', { code: 'rate_limited' });
    }
    await fail('auth_unavailable');
    if (g.err instanceof HttpError) throw g.err;
    console.error('[auth] sign-in failed in Supabase Auth:', (g.err as Error)?.message ?? g.err);
    throw new HttpError(503, 'Sign-in is briefly unavailable — please try again in a minute.', { code: 'auth_unavailable' });
  }

  const s = g.s;
  const endGrant = () => logoutSession(s.accessToken);
  const acct = await loadAccount(userId, null);
  if (!acct || (s.userId && s.userId !== userId) || !UUID_RE.test(s.sessionId)) {
    await endGrant();
    console.error('[auth] sign-in returned an unexpected session');
    throw new HttpError(503, 'Sign-in is briefly unavailable — please try again in a minute.', { code: 'auth_unavailable' });
  }
  const { profile, staff } = acct;
  if (profile.blocked_at) {
    await endGrant();
    await resetCounters();
    await fail('account_blocked');
    throw suspended();
  }
  if (!profile.email_verified_at) {
    await endGrant();
    await resetCounters();
    await fail('email_unverified');
    throw unverified(email);
  }
  if (wantStaff && !staff) {
    await endGrant();
    await resetCounters();
    await fail('staff_only');
    throw new HttpError(403, 'This account is not a staff account.', { code: 'not_staff' });
  }
  // Customers accept the account-sharing agreement again whenever its version changes.
  const isCustomer = !staff;
  const agreement = settings.agreement;
  const reaccept = isCustomer && profile.agreement_version !== agreement.version;
  if (reaccept && b.agreement !== true) {
    await endGrant();
    await resetCounters();
    await fail('agreement_required');
    throw new HttpError(403, 'Please read and accept the account agreement to continue.', {
      code: 'agreement_required', agreement: { version: agreement.version, text: agreement.text },
    });
  }

  const textHash = reaccept ? await sha256Hex(agreement.text) : null;
  let done: { profile: Profile; expiresAt: Date; keys: string[] };
  try {
    done = await tx(async (q) => {
      const { expiresAt } = await openSession(q, ctx, { userId, sessionId: s.sessionId, remember, isStaff: !!staff });
      const rows = await q<Profile[]>`
        update profiles set failed_login_attempts = 0, locked_until = null, last_login_at = now(),
          agreement_version = case when ${reaccept}::boolean then ${agreement.version}::text else agreement_version end,
          agreement_accepted_at = case when ${reaccept}::boolean then now() else agreement_accepted_at end
        where id = ${userId} returning *`;
      if (reaccept) {
        await q`
          insert into agreement_acceptances (user_id, version, text_sha256, context, ip, user_agent)
          values (${userId}, ${agreement.version}, ${textHash}, 'reaccept', ${ctx.ip}, ${ctx.ua || null})`;
      }
      await loginActivity(ctx, { userId, email, success: true, sessionId: s.sessionId }, q);
      await analytics(q, ctx, { kind: 'login', userId, meta: staff ? { staff: true } : undefined });
      const keys = staff ? (await q<{ id: string }[]>`select id from staff_permissions order by id`).map((r) => r.id) : [];
      return { profile: rows[0], expiresAt, keys };
    });
  } catch (e) {
    await endGrant();
    throw e;
  }

  if (isCustomer) {
    // sharing rules look at the new sign-in after the response; a rule problem never blocks sign-in
    ctx.later(async () => {
      try {
        await evaluateRules(ctx, userId);
      } catch (e) {
        console.error('[auth] sharing rules not evaluated:', (e as Error)?.message ?? e);
      }
    });
  }
  return {
    user: publicUser(done.profile, staff, isCustomer ? settings.security.maxWarnings : undefined),
    session: sessionBody(s, done.expiresAt),
    staff: staffBody(staff, done.keys),
    security: isCustomer ? await securityFor(userId) : null,
  };
}

// ── POST /api/auth/logout (alias /api/auth/signout) ──────────────────────────────────────
async function endAppSession(ctx: Ctx, userId: string, sessionId: string) {
  await tx(async (q) => {
    const r = await q`
      update app_sessions set revoked_at = now(), revoke_reason = 'logout'
      where id = ${sessionId} and user_id = ${userId} and revoked_at is null
      returning id`;
    if (r.length) await securityEvent(ctx, userId, 'logout', null, q);
  }).catch((e) => console.error('[auth] logout not recorded:', (e as Error)?.message ?? e));
}

/** Always 200. Ends the session named by a valid bearer token; when the access token has already
 *  expired, the browser can send its refresh token instead (proof that it holds the session). */
async function logout(ctx: Ctx) {
  const token = bearer(ctx);
  const claims = token ? await verifyAccessToken(token).catch(() => null) : null;
  if (token && claims) {
    await endAppSession(ctx, claims.sub, claims.sessionId);
    await logoutSession(token);
    return { ok: true };
  }
  const b = await readJson(ctx.req).catch(() => ({} as Record<string, unknown>));
  const rt = str(b.refreshToken).trim();
  if (rt && rt.length <= 1024 && !/\s/.test(rt)) {
    try {
      await rateLimit(ctx, 'logout_refresh', ipKey(ctx), 60, 900);
      const s = await refreshGrant(rt, ctx.ip);
      if (UUID_RE.test(s.userId) && UUID_RE.test(s.sessionId)) await endAppSession(ctx, s.userId, s.sessionId);
      await logoutSession(s.accessToken);
    } catch {
      // unknown, spent or rate-limited token: nothing to end
    }
  }
  return { ok: true };
}

// ── GET /api/auth/me · PATCH /api/auth/me ────────────────────────────────────────────────
async function me(ctx: Ctx) {
  const u = await requireUser(ctx);
  const settings = await getSettings();
  const keys = u.staff ? await allPermissionKeys() : [];
  return {
    user: publicUser(u.profile, u.staff, u.staff ? undefined : settings.security.maxWarnings),
    staff: staffBody(u.staff, keys),
    security: u.staff ? null : await securityFor(u.id),
  };
}

async function updateMe(ctx: Ctx) {
  const u = await requireUser(ctx);
  const b = await readJson(ctx.req);
  let role = u.profile.role, name = u.profile.name, timeZone = u.profile.time_zone;
  if (b.role !== undefined) {
    role = b.role == null || b.role === '' ? null : str(b.role);
    if (role && !ROLES.includes(role)) throw new HttpError(400, 'Unknown role.', { errors: { role: 'Unknown role.' } });
  }
  if (b.name !== undefined) {
    name = cleanName(b.name);
    if (!name || name.length > 80) throw new HttpError(400, 'Enter a name of 1 to 80 characters.', { errors: { name: 'Enter a name of 1 to 80 characters.' } });
  }
  if (b.timeZone !== undefined) {
    if (b.timeZone == null || b.timeZone === '') timeZone = null;
    else if (typeof b.timeZone === 'string' && isTimeZone(b.timeZone)) timeZone = b.timeZone;
    else throw new HttpError(400, 'Unknown time zone.', { errors: { timeZone: 'Unknown time zone.' } });
  }
  const rows = await tx((q) => q<Profile[]>`
    update profiles set role = ${role}, name = ${name}, time_zone = ${timeZone} where id = ${u.id} returning *`);
  if (name !== u.profile.name) {
    // keep the name Supabase Auth shows in the dashboard in step (best effort)
    ctx.later(() => adminUpdateUser(u.id, { name }));
  }
  const settings = await getSettings();
  return { user: publicUser(rows[0], u.staff, u.staff ? undefined : settings.security.maxWarnings) };
}

// ── POST /api/auth/refresh-token ─────────────────────────────────────────────────────────
async function refresh(ctx: Ctx) {
  await rateLimit(ctx, 'refresh_ip', ipKey(ctx), 300, 900);
  const b = await readJson(ctx.req);
  const rt = str(b.refreshToken).trim();
  if (!rt || rt.length > 1024 || /\s/.test(rt)) throw signIn();
  let s: AuthSession;
  try {
    s = await refreshGrant(rt, ctx.ip);
  } catch (e) {
    if (e instanceof AuthApiError) {
      if (e.status === 429) throw new HttpError(429, 'Too many attempts — wait a few minutes and try again.', { code: 'rate_limited' });
      throw signIn();
    }
    throw e;
  }
  const acct = UUID_RE.test(s.userId) && UUID_RE.test(s.sessionId) ? await loadAccount(s.userId, s.sessionId) : null;
  const session = acct?.session ?? null;
  if (!acct || !session || session.revoked_at || new Date(session.expires_at).getTime() <= Date.now()) {
    // our sign-in has ended, so the Supabase Auth session ends too
    await logoutSession(s.accessToken);
    throw signIn();
  }
  const { profile, staff } = acct;
  if (profile.blocked_at) {
    await logoutSession(s.accessToken);
    throw suspended();
  }
  if (session.blocked_at) {
    // The Supabase Auth session is kept so staff can unblock it. Supabase Auth has already
    // rotated the refresh token, so the browser gets the new one to keep (nothing else).
    throw new HttpError(403, SESSION_BLOCKED, { code: 'session_blocked', refreshToken: s.refreshToken });
  }
  if (!profile.email_verified_at) {
    await logoutSession(s.accessToken);
    throw new HttpError(403, 'Confirm your email address first — open the email we sent you and press Accept & Continue.', { code: 'email_unverified' });
  }
  ctx.later(() => tx((q) => q`
    update app_sessions set last_seen_at = now(), ip = ${ctx.ip}, ip_network = ${ctx.ipNetwork}, country = coalesce(${ctx.country}::text, country)
    where id = ${session.id}`));
  const settings = await getSettings();
  const keys = staff ? await allPermissionKeys() : [];
  return {
    session: sessionBody(s, session.expires_at),   // the end does not move: it was fixed at sign-in
    user: publicUser(profile, staff, staff ? undefined : settings.security.maxWarnings),
    staff: staffBody(staff, keys),
    expiresAt: ms(session.expires_at),
  };
}

// ── POST /api/auth/forgot-password ───────────────────────────────────────────────────────
async function forgotPassword(ctx: Ctx) {
  const b = await readJson(ctx.req);
  const email = normEmail(b.email);
  if (!validEmail(email)) throw new HttpError(400, 'Enter a valid email address.', { errors: { email: 'Enter a valid email address.' } });
  await mailLimits(ctx, email);
  if (!mailReady()) throw new HttpError(503, MAIL_OFF, { code: 'mail_unavailable' });
  const minutes = clampInt((await getSettings()).auth_links.resetMinutes, 1, 60 * 24 * 30);
  // the same answer, at the same speed, for every address
  ctx.later(async () => {
    const p = await tx((q) => q<{ id: string }[]>`select id from profiles where email = ${email} and blocked_at is null`);
    if (p.length) await sendResetLink(ctx, p[0].id);
  });
  return { ok: true, message: `If ${email} has an account, a password reset link is on its way. It works once, for ${minutes} minutes.` };
}

// ── POST /api/auth/reset-password ────────────────────────────────────────────────────────
async function resetPassword(ctx: Ctx) {
  await rateLimit(ctx, 'auth_token', ipKey(ctx), 30, 900);
  const b = await readJson(ctx.req);
  const token = str(b.token);
  const password = str(b.password);
  const invalid = () => new HttpError(400, 'This reset link is not valid. Ask for a new one with Forgot password.', { code: 'token_invalid' });
  if (!LINK_TOKEN_RE.test(token)) throw invalid();
  const weak = passwordProblem(password);
  if (weak) throw new HttpError(400, weak, { errors: { password: weak } });
  const hash = await sha256Hex(token);

  type Row = { id: number; user_id: string; email: string; name: string; time_zone: string | null };
  // claim the link first (one use), then change the password in Supabase Auth, then end sessions
  const claim = await tx<{ error: 'invalid' | 'used' | 'expired' } | { row: Row }>(async (q) => {
    const t = await q<(Row & { used_at: Date | null; expired: boolean; blocked_at: Date | null })[]>`
      select t.id, t.user_id, t.used_at, t.expires_at <= now() as expired, p.blocked_at, p.email, p.name, p.time_zone
      from auth_tokens t join profiles p on p.id = t.user_id
      where t.token_hash = ${hash} and t.purpose = 'reset_password'
      for update of t`;
    if (!t.length || t[0].blocked_at) return { error: 'invalid' };
    if (t[0].used_at) return { error: 'used' };
    if (t[0].expired) return { error: 'expired' };
    await q`update auth_tokens set used_at = now() where id = ${t[0].id}`;
    const { id, user_id, email, name, time_zone } = t[0];
    return { row: { id, user_id, email, name, time_zone } };
  });
  if ('error' in claim) {
    if (claim.error === 'used') throw new HttpError(400, 'This reset link was already used. Ask for a new one with Forgot password.', { code: 'token_used' });
    if (claim.error === 'expired') throw new HttpError(400, 'This reset link has expired. Ask for a new one with Forgot password.', { code: 'token_expired' });
    throw invalid();
  }
  const row = claim.row;
  try {
    // the link came through the inbox, so it also confirms the email address
    await adminUpdateUser(row.user_id, { password, emailConfirm: true });
  } catch (e) {
    // give the link back so the customer can try again
    await tx((q) => q`update auth_tokens set used_at = null where id = ${row.id}`).catch(() => {});
    if (e instanceof AuthApiError && (e.code === 'weak_password' || e.status === 422)) {
      const msg = 'Choose a stronger password.';
      throw new HttpError(400, msg, { errors: { password: msg } });
    }
    if (e instanceof HttpError) throw e;
    console.error('[auth] password not changed in Supabase Auth:', (e as Error)?.message ?? e);
    throw new HttpError(503, 'Sign-in is briefly unavailable — please try again in a minute.', { code: 'auth_unavailable' });
  }
  await tx(async (q) => {
    await q`update auth_tokens set used_at = now() where user_id = ${row.user_id} and purpose = 'reset_password' and used_at is null`;
    await q`
      update profiles set password_changed_at = now(), failed_login_attempts = 0, locked_until = null,
        email_verified_at = coalesce(email_verified_at, now()), status = 'active'
      where id = ${row.user_id}`;
    const ended = await endAllSessions(q, row.user_id, 'password_reset');
    await securityEvent(ctx, row.user_id, 'password_reset', { sessionsEnded: ended }, q);
    const mail = passwordChanged({ name: row.name || 'there', at: new Date(), timeZone: row.time_zone });
    await enqueue(q, { ...mail, to: row.email, template: 'password_changed', userId: row.user_id, relatedType: 'profile', relatedId: row.user_id });
  });
  kickOutbox(ctx);
  return { ok: true, message: 'Password updated. Sign in with your new password.' };
}

export function register(r: Router) {
  r.post('/api/auth/signup', signup);
  r.post('/api/auth/verify-email', verifyEmail);
  r.post('/api/auth/resend-verification', resendVerification);
  r.post('/api/auth/login', login);
  r.post('/api/auth/signin', login);
  r.post('/api/auth/logout', logout);
  r.post('/api/auth/signout', logout);
  r.get('/api/auth/me', me);
  r.patch('/api/auth/me', updateMe);
  r.post('/api/auth/refresh-token', refresh);
  r.post('/api/auth/forgot-password', forgotPassword);
  r.post('/api/auth/reset-password', resetPassword);
}
