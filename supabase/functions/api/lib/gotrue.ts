// Supabase Auth (GoTrue) over its REST API. Supabase Auth stores and checks every password;
// this file never logs or keeps one.
import { env } from './env.ts';
import { HttpError } from './http.ts';

export type AuthSession = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;     // epoch ms
  expiresIn: number;     // seconds
  userId: string;
  sessionId: string;
  emailConfirmed: boolean;
};

export class AuthApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const isJwt = (k: string) => /^eyJ[\w-]+\.[\w-]+\.[\w-]+$/.test(k);

function serverHeaders(clientIp?: string | null): Record<string, string> {
  const e = env();
  const h: Record<string, string> = { apikey: e.secretKey, 'Content-Type': 'application/json' };
  if (isJwt(e.secretKey)) h.Authorization = `Bearer ${e.secretKey}`;
  if (clientIp && e.forwardIpToAuth && e.secretKey.startsWith('sb_secret_')) h['Sb-Forwarded-For'] = clientIp;
  return h;
}

async function call(path: string, init: RequestInit & { timeoutMs?: number }): Promise<Record<string, unknown>> {
  const base = env().supabaseUrl;
  if (!base || !env().secretKey) throw new HttpError(503, 'Sign-in is not set up on the server yet.', { code: 'auth_unavailable' });
  let res: Response;
  try {
    res = await fetch(`${base}/auth/v1${path}`, { ...init, signal: AbortSignal.timeout(init.timeoutMs ?? 10000) });
  } catch {
    throw new HttpError(503, 'Sign-in is briefly unavailable — please try again in a minute.', { code: 'auth_unavailable' });
  }
  const text = await res.text();
  let body: Record<string, unknown> = {};
  try { body = text ? JSON.parse(text) : {}; } catch { body = {}; }
  if (!res.ok) {
    const code = String(body.error_code ?? body.code ?? body.error ?? res.status);
    const msg = String(body.msg ?? body.message ?? body.error_description ?? body.error ?? 'auth error');
    if (res.status >= 500) throw new HttpError(503, 'Sign-in is briefly unavailable — please try again in a minute.', { code: 'auth_unavailable' });
    throw new AuthApiError(res.status, code, msg);
  }
  return body;
}

function decodeClaims(token: string): Record<string, unknown> {
  try {
    const p = token.split('.')[1];
    return JSON.parse(atob(p.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((p.length + 3) % 4)));
  } catch {
    return {};
  }
}

function toSession(b: Record<string, unknown>): AuthSession {
  const accessToken = String(b.access_token ?? '');
  const claims = decodeClaims(accessToken);
  const expiresIn = Number(b.expires_in ?? 3600);
  const user = (b.user ?? {}) as Record<string, unknown>;
  return {
    accessToken,
    refreshToken: String(b.refresh_token ?? ''),
    expiresIn,
    expiresAt: Number(b.expires_at ?? 0) ? Number(b.expires_at) * 1000 : Date.now() + expiresIn * 1000,
    userId: String(user.id ?? claims.sub ?? ''),
    sessionId: String(claims.session_id ?? ''),
    emailConfirmed: !!(user.email_confirmed_at ?? user.confirmed_at),
  };
}

export async function adminCreateUser(o: { email: string; password: string; name: string; via: 'signup' | 'staff'; confirmed?: boolean }) {
  const b = await call('/admin/users', {
    method: 'POST',
    headers: serverHeaders(),
    body: JSON.stringify({
      email: o.email,
      password: o.password,
      email_confirm: !!o.confirmed,
      user_metadata: { name: o.name },
      app_metadata: { lww_created_via: o.via },
    }),
  });
  return { id: String(b.id ?? (b.user as Record<string, unknown> | undefined)?.id ?? '') };
}

export async function adminUpdateUser(id: string, patch: { password?: string; emailConfirm?: boolean; ban?: string | null; name?: string }) {
  const body: Record<string, unknown> = {};
  if (patch.password !== undefined) body.password = patch.password;
  if (patch.emailConfirm) body.email_confirm = true;
  if (patch.ban !== undefined) body.ban_duration = patch.ban ?? 'none';
  if (patch.name !== undefined) body.user_metadata = { name: patch.name };
  await call(`/admin/users/${encodeURIComponent(id)}`, { method: 'PUT', headers: serverHeaders(), body: JSON.stringify(body) });
}

export async function adminDeleteUser(id: string) {
  await call(`/admin/users/${encodeURIComponent(id)}`, { method: 'DELETE', headers: serverHeaders() });
}

/** Checks the password with Supabase Auth and opens a session. */
export async function passwordGrant(email: string, password: string, clientIp?: string | null): Promise<AuthSession> {
  const b = await call('/token?grant_type=password', {
    method: 'POST',
    headers: serverHeaders(clientIp),
    body: JSON.stringify({ email, password }),
  });
  return toSession(b);
}

export async function refreshGrant(refreshToken: string, clientIp?: string | null): Promise<AuthSession> {
  const b = await call('/token?grant_type=refresh_token', {
    method: 'POST',
    headers: serverHeaders(clientIp),
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
  return toSession(b);
}

/** Ends one session in Supabase Auth (best effort). */
export async function logoutSession(accessToken: string) {
  try {
    await call('/logout?scope=local', {
      method: 'POST',
      headers: { apikey: env().publishableKey || env().secretKey, Authorization: `Bearer ${accessToken}` },
      timeoutMs: 5000,
    });
  } catch { /* the session may already be gone */ }
}

/** Asks Supabase Auth whether an access token is valid (used when the token can't be checked locally). */
export async function getUser(accessToken: string): Promise<{ id: string; email: string } | null> {
  try {
    const b = await call('/user', {
      method: 'GET',
      headers: { apikey: env().publishableKey || env().secretKey, Authorization: `Bearer ${accessToken}` },
      timeoutMs: 6000,
    });
    return { id: String(b.id ?? ''), email: String(b.email ?? '') };
  } catch (e) {
    if (e instanceof AuthApiError) return null;
    throw e;
  }
}

export { decodeClaims };
