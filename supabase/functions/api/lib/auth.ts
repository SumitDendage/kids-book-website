// Who is calling? Every protected request carries "Authorization: Bearer <Supabase access token>".
// The token is checked (locally when the project's keys allow it, otherwise by Supabase Auth),
// then the database decides: the session must be one this API opened, not ended, not blocked,
// and the account must be confirmed and not blocked. Staff routes also need the permission.
import * as jose from 'jose';
import { env } from './env.ts';
import { HttpError } from './http.ts';
import { tx } from './db.ts';
import { getUser, decodeClaims } from './gotrue.ts';
import { sha256Hex } from './util.ts';
import type { Settings } from './settings.ts';
import type { AuthedUser, Ctx, Profile, SessionRow, StaffInfo } from './context.ts';
import { accountTypeOf, printsPerSheet } from '../services/entitlements.ts';

export const SIGN_IN = 'Sign in to continue.';
export const BLOCKED_MESSAGE = 'This account is suspended. Write to us if you think this is a mistake.';
export const UNVERIFIED_MESSAGE = 'Confirm your email address first. Open the email we sent you and press Accept & Continue.';

type Claims = { sub: string; sessionId: string; exp: number };

const verified = new Map<string, { claims: Claims; until: number }>();

let jwkSet: ReturnType<typeof jose.createLocalJWKSet> | null = null;
let jwkSource: string | null = null;

function localJwks() {
  const raw = env().jwks;
  if (!raw) return null;
  if (raw !== jwkSource) {
    try {
      const parsed = JSON.parse(raw);
      const keys = Array.isArray(parsed?.keys) ? parsed.keys : [];
      jwkSet = keys.length ? jose.createLocalJWKSet({ keys }) : null;
    } catch {
      jwkSet = null;
    }
    jwkSource = raw;
  }
  return jwkSet;
}

export function resetAuthCachesForTests() {
  verified.clear();
  jwkSet = null;
  jwkSource = null;
}

/** Verifies a Supabase access token. Returns null when it is not valid. */
export async function verifyAccessToken(token: string): Promise<Claims | null> {
  if (!/^[\w-]+\.[\w-]+\.[\w-]+$/.test(token) || token.length > 4096) return null;
  const now = Date.now();
  const key = await sha256Hex(token);
  const hit = verified.get(key);
  if (hit && hit.until > now) return hit.claims;

  let header: { alg?: string } = {};
  try { header = jose.decodeProtectedHeader(token) as { alg?: string }; } catch { return null; }
  const issuer = `${env().supabaseUrl}/auth/v1`;
  let payload: Record<string, unknown> | null = null;
  try {
    const jwks = localJwks();
    if (header.alg && header.alg !== 'HS256' && jwks) {
      payload = (await jose.jwtVerify(token, jwks, { issuer, audience: 'authenticated' })).payload as Record<string, unknown>;
    } else if (header.alg === 'HS256' && env().jwtSecret) {
      payload = (await jose.jwtVerify(token, new TextEncoder().encode(env().jwtSecret!), { issuer, audience: 'authenticated' })).payload as Record<string, unknown>;
    } else {
      // No local key: Supabase Auth checks the signature and that the session still exists.
      const u = await getUser(token);
      if (!u) return null;
      payload = decodeClaims(token);
      if (String(payload.sub ?? '') !== u.id) return null;
      const exp = Number(payload.exp ?? 0) * 1000;
      if (!exp || exp <= now) return null;
    }
  } catch (e) {
    if (e instanceof HttpError) throw e;
    return null;
  }
  const sub = String(payload?.sub ?? '');
  const sessionId = String(payload?.session_id ?? '');
  const exp = Number(payload?.exp ?? 0) * 1000;
  if (!/^[0-9a-f-]{36}$/.test(sub) || !/^[0-9a-f-]{36}$/.test(sessionId) || exp <= now) return null;
  const claims = { sub, sessionId, exp };
  if (verified.size > 2000) verified.clear();
  verified.set(key, { claims, until: Math.min(exp, now + 30_000) });
  return claims;
}

export function bearer(ctx: Ctx): string | null {
  const h = ctx.req.headers.get('authorization') ?? '';
  const m = /^Bearer\s+(\S+)$/i.exec(h);
  return m ? m[1] : null;
}

type Row = Profile & {
  s_id: string | null; s_remember: boolean; s_created_at: Date; s_last_seen_at: Date; s_expires_at: Date;
  s_revoked_at: Date | null; s_blocked_at: Date | null; s_is_staff: boolean; s_device_id_hash: string | null;
  staff_role: string | null; staff_permissions: string[] | null; staff_active: boolean | null;
};

export async function loadAccount(userId: string, sessionId: string | null) {
  const rows = await tx((q) => q<Row[]>`
    select p.*,
      s.id as s_id, s.remember as s_remember, s.created_at as s_created_at, s.last_seen_at as s_last_seen_at,
      s.expires_at as s_expires_at, s.revoked_at as s_revoked_at, s.blocked_at as s_blocked_at,
      s.is_staff as s_is_staff, s.device_id_hash as s_device_id_hash,
      st.role as staff_role, st.permissions as staff_permissions, st.active as staff_active
    from profiles p
    left join app_sessions s on s.id = ${sessionId} and s.user_id = p.id
    left join staff_members st on st.user_id = p.id
    where p.id = ${userId}`);
  const r = rows[0];
  if (!r) return null;
  const staff: StaffInfo | null = r.staff_role && r.staff_active ? { role: r.staff_role, permissions: r.staff_permissions ?? [], active: true } : null;
  const session: SessionRow | null = r.s_id ? {
    id: r.s_id, remember: r.s_remember, created_at: r.s_created_at, last_seen_at: r.s_last_seen_at, expires_at: r.s_expires_at,
    revoked_at: r.s_revoked_at, blocked_at: r.s_blocked_at, is_staff: r.s_is_staff, device_id_hash: r.s_device_id_hash,
  } : null;
  const profile = r as Profile;
  return { profile, session, staff };
}

/** The signed-in customer (or staff member). Throws 401/403 with the site's usual codes. */
export async function requireUser(ctx: Ctx, opts: { allowUnverified?: boolean } = {}): Promise<AuthedUser> {
  if (ctx.user) return ctx.user;
  const token = bearer(ctx);
  if (!token) throw new HttpError(401, SIGN_IN, { code: 'signin' });
  const claims = await verifyAccessToken(token);
  if (!claims) throw new HttpError(401, SIGN_IN, { code: 'signin' });
  const acct = await loadAccount(claims.sub, claims.sessionId);
  if (!acct) throw new HttpError(401, SIGN_IN, { code: 'signin' });
  const { profile, session, staff } = acct;
  // A blocked account says so first: the block also ends its sessions, and an open page must
  // learn that the account is suspended (403), not just that it was signed out (401).
  if (profile.blocked_at) throw new HttpError(403, BLOCKED_MESSAGE, { code: 'account_suspended' });
  if (!session || session.revoked_at || new Date(session.expires_at).getTime() <= Date.now()) {
    throw new HttpError(401, SIGN_IN, { code: 'signin' });
  }
  if (session.blocked_at) {
    throw new HttpError(403, 'This sign-in was stopped by Learn With Why. Sign in again on your own device, or write to us if you think this is a mistake.', { code: 'session_blocked' });
  }
  if (!opts.allowUnverified && !profile.email_verified_at) {
    throw new HttpError(403, UNVERIFIED_MESSAGE, { code: 'email_unverified' });
  }
  const user: AuthedUser = { id: profile.id, profile, session, sessionId: session.id, accessToken: token, staff };
  ctx.user = user;
  // keep "last seen" fresh, at most every 5 minutes, after the response
  if (Date.now() - new Date(session.last_seen_at).getTime() > 5 * 60_000) {
    ctx.later(() => tx((q) => q`update app_sessions set last_seen_at = now(), ip = ${ctx.ip}, ip_network = ${ctx.ipNetwork}, country = coalesce(${ctx.country}, country) where id = ${session.id}`));
  }
  return user;
}

/** Signed in, if a valid token was sent; otherwise null (never throws for a bad token). */
export async function optionalUser(ctx: Ctx): Promise<AuthedUser | null> {
  if (!bearer(ctx)) return null;
  try {
    return await requireUser(ctx);
  } catch (e) {
    if (e instanceof HttpError && (e.status === 401 || e.status === 403)) return null;
    throw e;
  }
}

export function hasPermission(staff: StaffInfo | null, perm: string): boolean {
  if (!staff || !staff.active) return false;
  if (staff.role === 'owner') return true;
  return staff.permissions.includes(perm);
}

/** A staff member holding `perm` (or any of them, when an array is given). */
export async function requireStaff(ctx: Ctx, perm: string | string[]): Promise<AuthedUser> {
  const token = bearer(ctx);
  if (!token) throw new HttpError(401, 'Staff sign-in required.', { code: 'staff_signin' });
  let user: AuthedUser;
  try {
    user = await requireUser(ctx);
  } catch (e) {
    if (e instanceof HttpError && e.status === 401) throw new HttpError(401, 'Staff sign-in required.', { code: 'staff_signin' });
    throw e;
  }
  if (!user.staff) throw new HttpError(403, 'This account is not a staff account.', { code: 'not_staff' });
  const perms = Array.isArray(perm) ? perm : [perm];
  if (!perms.some((p) => hasPermission(user.staff, p))) {
    throw new HttpError(403, 'Your staff role does not allow this.', { code: 'forbidden', permission: perms[0] });
  }
  return user;
}

export function effectivePermissions(staff: StaffInfo | null, all: string[]): string[] {
  if (!staff) return [];
  return staff.role === 'owner' ? all : staff.permissions.filter((p) => all.includes(p));
}

/** The user object the website already understands, plus the new fields. Times are epoch ms.
 *  `role` is what is stored ('parent' | 'teacher' | 'tutor' | 'school' | null); `accountType` is
 *  what the site shows ('parent' | 'teacher' | 'organization' | null = not chosen yet), and
 *  `printsPerSheet` the prints of each sheet this account gets (settings.prints). */
export function publicUser(p: Profile, staff: StaffInfo | null = null, maxWarnings?: number, prints?: Settings['prints']) {
  return {
    id: p.id,
    name: p.name,
    email: p.email,
    role: p.role,
    accountType: accountTypeOf(p.role),
    printsPerSheet: printsPerSheet(prints, p.role),
    emailVerified: !!p.email_verified_at,
    status: p.blocked_at ? 'suspended' : p.status,
    accessStatus: p.subscription_suspended_at ? 'suspended' : 'active',
    created: new Date(p.created_at).getTime(),
    lastLogin: p.last_login_at ? new Date(p.last_login_at).getTime() : null,
    timeZone: p.time_zone,
    agreementVersion: p.agreement_version,
    staff: staff ? { role: staff.role } : null,
    ...(maxWarnings ? { maxWarnings } : {}),
  };
}
