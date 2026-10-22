// Customer and staff accounts. Customers sign up and sign in with a 6-digit code emailed by
// Supabase Auth (otp/send, otp/verify); staff sign in with a password, with lockout. Sessions
// (Supabase Auth tokens + our app_sessions row), profile edits, and staff password reset. Request and response shapes follow the old site.
import type { Router } from '../lib/router.ts';
import type { Ctx, Profile, StaffInfo } from '../lib/context.ts';
import { tx } from '../lib/db.ts';
import { HttpError, ms, readJson } from '../lib/http.ts';
import { analytics, loginActivity, rateLimit, securityEvent } from '../lib/guard.ts';
import { enqueue, kickOutbox } from '../lib/mail.ts';
import { mailReady } from '../lib/env.ts';
import { getSettings } from '../lib/settings.ts';
import {
  adminUpdateUser, AuthApiError, logoutSession, passwordGrant, refreshGrant,
  decodeClaims,
  type AuthSession,
} from '../lib/gotrue.ts';
import {
  BLOCKED_MESSAGE, bearer, effectivePermissions, loadAccount, publicUser, requireUser, SIGN_IN, UNVERIFIED_MESSAGE, verifyAccessToken,
} from '../lib/auth.ts';
import { cleanName, isTimeZone, LINK_TOKEN_RE, normEmail, passwordProblem, sha256Hex, validEmail } from '../lib/util.ts';
import { passwordChanged } from '../services/emails.ts';
import { endAllSessions, openSession, sendResetLink, sessionBody } from '../services/accounts.ts';
import { evaluateRules, securityStatus, type SecurityStatus } from '../services/sharing.ts';
import { ROLE_LOCKED, roleFromInput } from '../services/entitlements.ts';
const OTP_REQUIRED = 'Customers sign in with a 6-digit code sent to their email.';
const BAD_LOGIN = 'We could not match that email and password. New here? Sign up instead.';
const SESSION_BLOCKED = 'This sign-in was stopped by Learn With Why. Sign in again on your own device, or write to us if you think this is a mistake.';
const MAIL_OFF = 'The server cannot send email yet. Please try again later.';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ipKey = (ctx: Ctx) => ctx.ip ?? '-';
const clampInt = (n: number, min: number, max: number) => Math.max(min, Math.min(max, Math.floor(Number.isFinite(n) ? n : min)));
const signIn = () => new HttpError(401, SIGN_IN, { code: 'signin' });
const badLogin = () => new HttpError(401, BAD_LOGIN, { code: 'bad_credentials' });
const unverified = (email: string) => new HttpError(403, `Please confirm your email first: open the email we sent to ${email} and press Accept & Continue.`, { code: 'email_unverified', email });
const suspended = () => new HttpError(403, BLOCKED_MESSAGE, { code: 'account_suspended' });
const truthy = (v: unknown) => v === true || v === 1 || v === 'true' || v === '1' || v === 'on';
const str = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v));

function lockedError(until: Date | string | number): HttpError {
  const untilMs = new Date(until).getTime();
  const minutes = Math.max(1, Math.ceil((untilMs - Date.now()) / 60_000));
  return new HttpError(429, `Too many wrong passwords. This account is locked for ${minutes} more minute(s). You can unlock it now with Forgot password.`,
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
      throw new HttpError(429, 'Too many attempts. Wait a few minutes and try again.', { code: 'rate_limited' });
    }
    await fail('auth_unavailable');
    if (g.err instanceof HttpError) throw g.err;
    console.error('[auth] sign-in failed in Supabase Auth:', (g.err as Error)?.message ?? g.err);
    throw new HttpError(503, 'Sign-in is briefly unavailable. Please try again in a minute.', { code: 'auth_unavailable' });
  }

  return finishSignIn(ctx, g.s, { userId, email, remember, wantStaff, agreement: b.agreement === true, staffOnly: true, fail, resetCounters });
}

/** The end of every sign-in, once Supabase Auth has opened session `s` for `userId`: the account
 *  checks (blocked, confirmed, staff, agreement), then our app_sessions row and the response. */
async function finishSignIn(ctx: Ctx, s: AuthSession, o: {
  userId: string; email: string; remember: boolean; wantStaff: boolean; agreement: boolean; staffOnly: boolean; keepGrantForAgreement?: boolean;
  fail: (reason: string) => Promise<unknown>; resetCounters: () => Promise<unknown>;
}) {
  const { userId, email, remember, wantStaff, fail, resetCounters } = o;
  const settings = await getSettings();
  const endGrant = () => logoutSession(s.accessToken);
  const acct = await loadAccount(userId, null);
  if (!acct || (s.userId && s.userId !== userId) || !UUID_RE.test(s.sessionId)) {
    await endGrant();
    console.error('[auth] sign-in returned an unexpected session');
    throw new HttpError(503, 'Sign-in is briefly unavailable. Please try again in a minute.', { code: 'auth_unavailable' });
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
  if (o.staffOnly && !staff) {
    await endGrant();
    await resetCounters();
    await fail('otp_required');
    throw new HttpError(403, OTP_REQUIRED, { code: 'otp_required' });
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
  if (reaccept && !o.agreement) {
    // a code sign-in keeps its session so the customer can tick the agreement without a new code
    if (!o.keepGrantForAgreement) await endGrant();
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
    user: publicUser(done.profile, staff, isCustomer ? settings.security.maxWarnings : undefined, settings.prints),
    session: sessionBody(s, done.expiresAt),
    staff: staffBody(staff, done.keys),
    security: isCustomer ? await securityFor(userId) : null,
  };
}

// ── POST /api/auth/otp/session ───────────────────────────────────────────────────────────
// Customers sign up and sign in with a 6-digit code: the website asks Supabase Auth for it
// (signInWithOtp) and checks it there (verifyOtp, which confirms the address). Supabase Auth makes,
// hashes, expires and rate-limits the code. The fresh session then comes here, as the bearer token
// plus its refresh token, and becomes a sign-in of this site (our checks + an app_sessions row).
const OTP_FRESH_MS = 15 * 60_000;
const OTP_METHODS = new Set(['otp', 'magiclink', 'email/signup']);

async function otpSession(ctx: Ctx) {
  await rateLimit(ctx, 'otp_session_ip', ipKey(ctx), 60, 900);
  const token = bearer(ctx);
  const claims = token ? await verifyAccessToken(token) : null;
  if (!token || !claims) throw signIn();
  const b = await readJson(ctx.req);
  const refreshToken = str(b.refreshToken).trim();
  if (!refreshToken || refreshToken.length > 1024 || /\s/.test(refreshToken)) throw signIn();
  // only a session that an emailed code opened a moment ago (not a password or an old session)
  const payload = decodeClaims(token);
  const amr = Array.isArray(payload.amr) ? payload.amr as { method?: string; timestamp?: number }[] : [];
  const byCode = amr.some((m) => OTP_METHODS.has(String(m?.method)) && Number(m?.timestamp) * 1000 > Date.now() - OTP_FRESH_MS);
  if (!byCode) throw new HttpError(401, 'Please sign in with the code from your email.', { code: 'otp_required' });

  const userId = claims.sub;
  const known = await tx((q) => q<{ id: string }[]>`select id from app_sessions where id = ${claims.sessionId}`);
  if (known.length) throw new HttpError(409, 'This sign-in is already open.', { code: 'already_signed_in' });
  const found = await tx((q) => q<{ email: string }[]>`
    update profiles set email_verified_at = coalesce(email_verified_at, now()) where id = ${userId} returning email`);
  if (!found.length) throw signIn();
  const email = found[0].email;
  const s: AuthSession = {
    accessToken: token, refreshToken, expiresAt: claims.exp, expiresIn: Math.max(0, Math.round((claims.exp - Date.now()) / 1000)),
    userId, sessionId: claims.sessionId, emailConfirmed: true,
  };
  return finishSignIn(ctx, s, {
    userId, email, remember: b.remember === undefined ? true : truthy(b.remember), wantStaff: false,
    agreement: b.agreement === true, staffOnly: false, keepGrantForAgreement: true,
    fail: (reason: string) => loginActivity(ctx, { userId, email, success: false, reason }), resetCounters: () => Promise.resolve(),
  });
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
    user: publicUser(u.profile, u.staff, u.staff ? undefined : settings.security.maxWarnings, settings.prints),
    staff: staffBody(u.staff, keys),
    security: u.staff ? null : await securityFor(u.id),
  };
}

/** PATCH /api/auth/me {name?, role?, timeZone?}. The account type (role) is chosen once: while it
 *  is empty a customer may set it; after that only staff change it (Admin -> Customers), and a
 *  different value here is 409 role_locked. Sending the same value again changes nothing. */
async function updateMe(ctx: Ctx) {
  const u = await requireUser(ctx);
  const b = await readJson(ctx.req);
  let name = u.profile.name, timeZone = u.profile.time_zone;
  let wantRole: string | null | undefined;   // undefined = not sent
  if (b.role !== undefined) {
    wantRole = roleFromInput(b.role);
    if (wantRole === undefined) throw new HttpError(400, 'Unknown role.', { errors: { role: 'Unknown role.' } });
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
  const rows = await tx(async (q) => {
    // read the stored type under a lock, so two first choices at once cannot both win
    const cur = await q<{ role: string | null }[]>`select role from profiles where id = ${u.id} for update`;
    let role = cur[0]?.role ?? null;
    if (wantRole !== undefined && wantRole !== role) {
      if (role !== null) throw new HttpError(409, ROLE_LOCKED, { code: 'role_locked', role });
      role = wantRole;
      await securityEvent(ctx, u.id, 'account_type.set', { role }, q);
    }
    return await q<Profile[]>`
      update profiles set role = ${role}, name = ${name}, time_zone = ${timeZone} where id = ${u.id} returning *`;
  });
  if (name !== u.profile.name) {
    // keep the name Supabase Auth shows in the dashboard in step (best effort)
    ctx.later(() => adminUpdateUser(u.id, { name }));
  }
  const settings = await getSettings();
  return { user: publicUser(rows[0], u.staff, u.staff ? undefined : settings.security.maxWarnings, settings.prints) };
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
      if (e.status === 429) throw new HttpError(429, 'Too many attempts. Wait a few minutes and try again.', { code: 'rate_limited' });
      throw signIn();
    }
    throw e;
  }
  const acct = UUID_RE.test(s.userId) && UUID_RE.test(s.sessionId) ? await loadAccount(s.userId, s.sessionId) : null;
  const session = acct?.session ?? null;
  // a blocked account says so first (the block also ended its sessions), as requireUser does
  if (acct?.profile.blocked_at) {
    await logoutSession(s.accessToken);
    throw suspended();
  }
  if (!acct || !session || session.revoked_at || new Date(session.expires_at).getTime() <= Date.now()) {
    // our sign-in has ended, so the Supabase Auth session ends too
    await logoutSession(s.accessToken);
    throw signIn();
  }
  const { profile, staff } = acct;
  if (session.blocked_at) {
    // The Supabase Auth session is kept so staff can unblock it. Supabase Auth has already
    // rotated the refresh token, so the browser gets the new one to keep (nothing else).
    throw new HttpError(403, SESSION_BLOCKED, { code: 'session_blocked', refreshToken: s.refreshToken });
  }
  if (!profile.email_verified_at) {
    await logoutSession(s.accessToken);
    throw new HttpError(403, UNVERIFIED_MESSAGE, { code: 'email_unverified' });
  }
  ctx.later(() => tx((q) => q`
    update app_sessions set last_seen_at = now(), ip = ${ctx.ip}, ip_network = ${ctx.ipNetwork}, country = coalesce(${ctx.country}::text, country)
    where id = ${session.id}`));
  const settings = await getSettings();
  const keys = staff ? await allPermissionKeys() : [];
  return {
    session: sessionBody(s, session.expires_at),   // the end does not move: it was fixed at sign-in
    user: publicUser(profile, staff, staff ? undefined : settings.security.maxWarnings, settings.prints),
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
    throw new HttpError(503, 'Sign-in is briefly unavailable. Please try again in a minute.', { code: 'auth_unavailable' });
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
  r.post('/api/auth/otp/session', otpSession);
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
