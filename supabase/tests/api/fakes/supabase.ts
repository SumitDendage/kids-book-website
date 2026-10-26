// A small local stand-in for the hosted Supabase services the API calls over HTTP:
//  * Auth (GoTrue): the routes lib/gotrue.ts uses. Users and sessions are real rows in auth.users
//    and auth.sessions (written as role sb_fake_services), so database triggers and
//    private.end_auth_sessions() behave as they do on Supabase. Access tokens are HS256 JWTs
//    signed with the test LWW_JWT_SECRET, so lib/auth.ts verifies them locally.
//  * Storage: the routes lib/storage.ts uses. Bytes live in memory; every object also gets a
//    storage.objects row (metadata.size, mimetype) so private.worksheet_objects() etc. see it.
//  * Brevo/Resend mail APIs (when a mail capture is given), and any extra fake a test registers
//    with route() (payment gateways in fakes/gateways.ts).
// It is a test double: passwords are hashed with salted SHA-256, which is fine here only.
import postgres from 'postgres';
import * as jose from 'jose';
import { mailProviderRoutes, type MailCapture } from './mail.ts';

export type FakeHandler = (req: Request, url: URL) => Response | Promise<Response>;

export type TokenResponse = {
  access_token: string;
  token_type: 'bearer';
  expires_in: number;
  expires_at: number;
  refresh_token: string;
  // deno-lint-ignore no-explicit-any
  user: Record<string, any>;
};

export type FakeSupabaseOptions = {
  db: string;                 // database name on the local server
  jwtSecret: string;
  secretKey: string;          // the "service" key the API sends as apikey
  publishableKey: string;
  mail?: MailCapture;
  pgHost?: string;
  pgPort?: number;
};

export type FakeSupabase = {
  url: string;
  /** Adds (or overrides) a fake endpoint. The longest matching prefix wins; on a tie the newest.
   *  method '*' matches any method. Returns a function that removes the route again. */
  route(method: string, pathPrefix: string, fn: FakeHandler): () => void;
  /** Every request the fake received (newest last, capped at 1000). */
  requests: { method: string; path: string; search: string; at: number }[];
  /** Requests whose path starts with `prefix` (and method, when given). */
  calls(prefix: string, method?: string): { method: string; path: string; search: string; at: number }[];
  storage: {
    put(bucket: string, path: string, bytes: Uint8Array, type: string): Promise<void>;
    has(bucket: string, path: string): boolean;
    get(bucket: string, path: string): { bytes: Uint8Array; type: string } | null;
    remove(bucket: string, path: string): Promise<void>;
  };
  auth: {
    /** Same as POST /auth/v1/admin/users. */
    createUser(o: { email: string; password: string; name?: string; confirmed?: boolean; via?: string }): Promise<{ id: string }>;
    /** Opens an Auth session for any user, skipping the password and confirmation checks. */
    issueSession(userId: string, o?: { userAgent?: string }): Promise<TokenResponse>;
    /** A signed access token with any claims (for expired/forged-token tests). */
    mintAccessToken(o: { userId: string; sessionId: string; email?: string; expiresIn?: number; secret?: string; issuer?: string; audience?: string }): Promise<string>;
    /** Access-token lifetime in seconds for new tokens (default 3600). */
    setAccessTtl(seconds: number): void;
    /** Forget every refresh token (as if the Auth server lost them). */
    clearRefreshTokens(): void;
  };
  sql: postgres.Sql;
  close(): Promise<void>;
};

const enc = new TextEncoder();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
}

// GoTrue's current error shape (lib/gotrue.ts reads error_code, then code, then error).
const authError = (status: number, errorCode: string, msg: string, extra: Record<string, unknown> = {}) =>
  json(status, { code: status, error_code: errorCode, msg, ...extra });
// The token endpoint also carries the OAuth fields older clients read.
const grantError = (errorCode: string, msg: string) =>
  authError(400, errorCode, msg, { error: 'invalid_grant', error_description: msg });
// Storage error shape
const storageError = (status: number, error: string, message: string) =>
  json(status, { statusCode: String(status), error, message });

function randomToken(bytes = 30): string {
  const b = new Uint8Array(bytes);
  crypto.getRandomValues(b);
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function sha256Hex(data: Uint8Array | string): Promise<string> {
  const d = typeof data === 'string' ? enc.encode(data) : data;
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', d as BufferSource));
  return Array.from(h, (x) => x.toString(16).padStart(2, '0')).join('');
}

async function hashPassword(pw: string): Promise<string> {
  const salt = randomToken(12);
  return `fake-sha256$${salt}$${await sha256Hex(salt + '\u0000' + pw)}`;
}

async function checkPassword(pw: string, stored: string | null): Promise<boolean> {
  if (!stored) return false;
  const [kind, salt, want] = stored.split('$');
  if (kind !== 'fake-sha256' || !salt || !want) return false;
  const got = await sha256Hex(salt + '\u0000' + pw);
  let diff = got.length ^ want.length;
  for (let i = 0; i < Math.max(got.length, want.length); i++) diff |= (got.charCodeAt(i) || 0) ^ (want.charCodeAt(i) || 0);
  return diff === 0;
}

/** Go-style duration ("876000h", "1h30m", "90s") → milliseconds, or null when malformed. */
export function parseGoDuration(s: string): number | null {
  const unit: Record<string, number> = { ns: 1e-6, us: 1e-3, 'µs': 1e-3, ms: 1, s: 1000, m: 60_000, h: 3_600_000 };
  const re = /(\d+(?:\.\d+)?)(ns|us|µs|ms|s|m|h)/gy;
  let total = 0, pos = 0, m: RegExpExecArray | null;
  if (!s) return null;
  while ((m = re.exec(s))) { total += Number(m[1]) * unit[m[2]]; pos = re.lastIndex; }
  return pos === s.length ? total : null;
}

function bearerOf(req: Request): string | null {
  const m = /^Bearer\s+(\S+)$/i.exec(req.headers.get('authorization') ?? '');
  return m ? m[1] : null;
}

function iso(d: unknown): string | null {
  if (d == null) return null;
  const t = d instanceof Date ? d : new Date(String(d));
  return Number.isNaN(t.getTime()) ? null : t.toISOString();
}

function validIp(v: string | null): string | null {
  if (!v) return null;
  const ip = v.split(',')[0].trim();
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(ip) || /^[0-9a-f:]+$/i.test(ip) ? ip : null;
}

type UserRow = {
  id: string; aud: string | null; role: string | null; email: string | null; encrypted_password: string | null;
  email_confirmed_at: Date | null; last_sign_in_at: Date | null;
  // deno-lint-ignore no-explicit-any
  raw_app_meta_data: Record<string, any> | null; raw_user_meta_data: Record<string, any> | null;
  banned_until: Date | null; created_at: Date; updated_at: Date; deleted_at: Date | null; is_anonymous: boolean;
};

type RefreshEntry = { sessionId: string; userId: string; revokedAt: number | null; next: string | null };

export async function startFakeSupabase(o: FakeSupabaseOptions): Promise<FakeSupabase> {
  const sql = postgres(`postgres://sb_fake_services:sb_fake_services@${o.pgHost ?? '127.0.0.1'}:${o.pgPort ?? 5433}/${o.db}`, {
    max: 3,
    prepare: false,
    idle_timeout: 30,
    onnotice: () => {},
    connection: { application_name: 'lww-fake-supabase' },
  });
  const secret = enc.encode(o.jwtSecret);
  let accessTtl = 3600;
  const refresh = new Map<string, RefreshEntry>();
  const objects = new Map<string, { bytes: Uint8Array; type: string; cacheControl: string; updated: number }>();
  const extra: { method: string; prefix: string; fn: FakeHandler; seq: number }[] = [];
  const requests: FakeSupabase['requests'] = [];
  let routeSeq = 0;
  let url = '';

  // Objects from an earlier run of this database have no bytes here, so start both empty.
  await sql`delete from storage.objects`;

  // ── auth helpers ────────────────────────────────────────────────────────────────────────
  const loadUser = async (id: string) => (await sql<UserRow[]>`select * from auth.users where id = ${id} and deleted_at is null`)[0] ?? null;
  const userByEmail = async (email: string) =>
    (await sql<UserRow[]>`select * from auth.users where lower(email) = ${email.toLowerCase()} and deleted_at is null`)[0] ?? null;

  function userJson(u: UserRow) {
    const out: Record<string, unknown> = {
      id: u.id,
      aud: u.aud ?? 'authenticated',
      role: u.role ?? 'authenticated',
      email: u.email ?? '',
      email_confirmed_at: iso(u.email_confirmed_at),
      confirmed_at: iso(u.email_confirmed_at),
      phone: '',
      last_sign_in_at: iso(u.last_sign_in_at),
      app_metadata: u.raw_app_meta_data ?? {},
      user_metadata: u.raw_user_meta_data ?? {},
      identities: [],
      created_at: iso(u.created_at),
      updated_at: iso(u.updated_at),
      is_anonymous: !!u.is_anonymous,
    };
    if (u.banned_until) out.banned_until = iso(u.banned_until);
    return out;
  }

  const isBanned = (u: UserRow) => !!u.banned_until && new Date(u.banned_until).getTime() > Date.now();

  async function mint(m: { userId: string; sessionId: string; email?: string; expiresIn?: number; secret?: string; issuer?: string; audience?: string;
    // deno-lint-ignore no-explicit-any
    appMeta?: Record<string, any>; userMeta?: Record<string, any> }): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    return await new jose.SignJWT({
      email: m.email ?? '',
      phone: '',
      app_metadata: m.appMeta ?? { provider: 'email', providers: ['email'] },
      user_metadata: m.userMeta ?? {},
      role: 'authenticated',
      aal: 'aal1',
      amr: [{ method: 'password', timestamp: now }],
      session_id: m.sessionId,
      is_anonymous: false,
    })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(m.userId)
      .setIssuer(m.issuer ?? `${url}/auth/v1`)
      .setAudience(m.audience ?? 'authenticated')
      .setIssuedAt(now)
      .setExpirationTime(now + (m.expiresIn ?? accessTtl))
      .setJti(crypto.randomUUID()) // every token differs, even two minted in the same second
      .sign(m.secret ? enc.encode(m.secret) : secret);
  }

  async function tokenResponse(u: UserRow, sessionId: string, refreshToken: string): Promise<TokenResponse> {
    const now = Math.floor(Date.now() / 1000);
    const access = await mint({ userId: u.id, sessionId, email: u.email ?? '', appMeta: u.raw_app_meta_data ?? {}, userMeta: u.raw_user_meta_data ?? {} });
    return { access_token: access, token_type: 'bearer', expires_in: accessTtl, expires_at: now + accessTtl, refresh_token: refreshToken, user: userJson(u) };
  }

  async function openAuthSession(u: UserRow, ua: string | null, ip: string | null): Promise<TokenResponse> {
    const sessionId = crypto.randomUUID();
    await sql.begin(async (t) => {
      await t`insert into auth.sessions (id, user_id, created_at, updated_at, user_agent, ip)
              values (${sessionId}, ${u.id}, now(), now(), ${ua ? ua.slice(0, 400) : null}, ${ip})`;
      await t`update auth.users set last_sign_in_at = now(), updated_at = now() where id = ${u.id}`;
    });
    const rt = randomToken();
    refresh.set(rt, { sessionId, userId: u.id, revokedAt: null, next: null });
    const fresh = (await loadUser(u.id)) ?? u;
    return tokenResponse(fresh, sessionId, rt);
  }

  async function createUser(b: { email: string; password?: string; name?: string; confirmed?: boolean; via?: string;
    // deno-lint-ignore no-explicit-any
    userMeta?: Record<string, any>; appMeta?: Record<string, any>; banDuration?: string }): Promise<Response> {
    const email = String(b.email ?? '').trim().toLowerCase();
    if (!EMAIL_RE.test(email) || email.length > 255) return authError(400, 'validation_failed', 'Unable to validate email address: invalid format');
    if (b.password !== undefined && (typeof b.password !== 'string' || b.password.length < 6)) {
      return authError(422, 'weak_password', 'Password should be at least 6 characters.', { weak_password: { reasons: ['length'] } });
    }
    if (await userByEmail(email)) return authError(422, 'email_exists', 'A user with this email address has already been registered');
    let banned: Date | null = null;
    if (b.banDuration && b.banDuration !== 'none') {
      const ms = parseGoDuration(b.banDuration);
      if (ms === null) return authError(400, 'validation_failed', `invalid format for ban duration: ${b.banDuration}`);
      banned = new Date(Date.now() + ms);
    }
    const id = crypto.randomUUID();
    const appMeta = { provider: 'email', providers: ['email'], ...(b.appMeta ?? {}), ...(b.via ? { lww_created_via: b.via } : {}) };
    const userMeta = { ...(b.userMeta ?? {}), ...(b.name !== undefined ? { name: b.name } : {}) };
    const pw = b.password ? await hashPassword(b.password) : null;
    try {
      await sql`
        insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                                raw_app_meta_data, raw_user_meta_data, banned_until, created_at, updated_at)
        values ('00000000-0000-0000-0000-000000000000', ${id}, 'authenticated', 'authenticated', ${email}, ${pw},
                ${b.confirmed ? new Date() : null}, ${sql.json(appMeta)}, ${sql.json(userMeta)}, ${banned}, now(), now())`;
    } catch (e) {
      // two sign-ups racing for one address: the profiles.email unique index stops the second
      if ((e as { code?: string }).code === '23505') return authError(422, 'email_exists', 'A user with this email address has already been registered');
      console.error('[fake-auth] create user failed:', (e as Error).message);
      return authError(500, 'unexpected_failure', 'Database error creating new user');
    }
    return json(200, userJson((await loadUser(id))!));
  }

  // deno-lint-ignore no-explicit-any
  async function readBody(req: Request): Promise<Record<string, any> | null> {
    const t = await req.text();
    if (!t) return {};
    try {
      const v = JSON.parse(t);
      return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
    } catch {
      return null;
    }
  }

  const keyOf = (req: Request) => req.headers.get('apikey') ?? '';
  const isSecret = (req: Request) => keyOf(req) === o.secretKey || bearerOf(req) === o.secretKey;
  const isAnyKey = (req: Request) => [o.secretKey, o.publishableKey].includes(keyOf(req));

  /** The caller's JWT → claims, or an error response (GoTrue's codes). */
  async function authedSession(req: Request): Promise<{ claims: jose.JWTPayload & { session_id?: string }; user: UserRow } | Response> {
    if (!isAnyKey(req)) return json(401, { message: keyOf(req) ? 'Invalid API key' : 'No API key found in request' });
    const token = bearerOf(req);
    if (!token) return authError(401, 'no_authorization', 'This endpoint requires a Bearer token');
    let claims: jose.JWTPayload & { session_id?: string };
    try {
      claims = (await jose.jwtVerify(token, secret, { algorithms: ['HS256'] })).payload as typeof claims;
    } catch (e) {
      const expired = (e as { code?: string }).code === 'ERR_JWT_EXPIRED';
      return authError(403, 'bad_jwt', expired ? 'invalid JWT: unable to parse or verify signature, token has invalid claims: token is expired'
        : 'invalid JWT: unable to parse or verify signature, signature is invalid');
    }
    const sid = String(claims.session_id ?? '');
    if (!UUID_RE.test(sid) || !(await sql`select 1 from auth.sessions where id = ${sid}`).length) {
      return authError(403, 'session_not_found', 'Session from session_id claim in JWT does not exist');
    }
    const user = UUID_RE.test(String(claims.sub ?? '')) ? await loadUser(String(claims.sub)) : null;
    if (!user) return authError(403, 'user_not_found', 'User from sub claim in JWT does not exist');
    return { claims, user };
  }

  function dropRefreshTokens(pred: (e: RefreshEntry) => boolean) {
    for (const [k, v] of refresh) if (pred(v)) refresh.delete(k);
  }

  async function handleAuth(req: Request, u: URL, path: string): Promise<Response> {
    const method = req.method.toUpperCase();

    // admin routes: the server's secret key only
    if (path.startsWith('/admin/')) {
      if (!keyOf(req) && !bearerOf(req)) return json(401, { message: 'No API key found in request' });
      if (!isSecret(req)) return authError(403, 'not_admin', 'User not allowed');
      if (path === '/admin/users' && method === 'POST') {
        const b = await readBody(req);
        if (!b) return authError(400, 'bad_json', 'Could not parse request body as JSON');
        return createUser({
          email: b.email, password: b.password, confirmed: b.email_confirm === true,
          userMeta: b.user_metadata && typeof b.user_metadata === 'object' ? b.user_metadata : {},
          appMeta: b.app_metadata && typeof b.app_metadata === 'object' ? b.app_metadata : {},
          banDuration: typeof b.ban_duration === 'string' ? b.ban_duration : undefined,
        });
      }
      const m = /^\/admin\/users\/([^/]+)$/.exec(path);
      if (m) {
        const id = decodeURIComponent(m[1]);
        if (!UUID_RE.test(id)) return authError(404, 'user_not_found', 'User not found');
        const user = await loadUser(id);
        if (!user) return authError(404, 'user_not_found', 'User not found');
        if (method === 'GET') return json(200, userJson(user));
        if (method === 'PUT') {
          const b = await readBody(req);
          if (!b) return authError(400, 'bad_json', 'Could not parse request body as JSON');
          if (b.password !== undefined && (typeof b.password !== 'string' || b.password.length < 6)) {
            return authError(422, 'weak_password', 'Password should be at least 6 characters.', { weak_password: { reasons: ['length'] } });
          }
          let banned: Date | null | undefined;
          if (typeof b.ban_duration === 'string' && b.ban_duration !== '') {
            if (b.ban_duration === 'none') banned = null;
            else {
              const ms = parseGoDuration(b.ban_duration);
              if (ms === null) return authError(400, 'validation_failed', `invalid format for ban duration: ${b.ban_duration}`);
              banned = new Date(Date.now() + ms);
            }
          }
          let email: string | undefined;
          if (typeof b.email === 'string') {
            email = b.email.trim().toLowerCase();
            if (!EMAIL_RE.test(email)) return authError(400, 'validation_failed', 'Unable to validate email address: invalid format');
            const other = await userByEmail(email);
            if (other && other.id !== id) return authError(422, 'email_exists', 'A user with this email address has already been registered');
          }
          const pw = typeof b.password === 'string' ? await hashPassword(b.password) : null;
          const userMeta = b.user_metadata && typeof b.user_metadata === 'object' ? { ...(user.raw_user_meta_data ?? {}), ...b.user_metadata } : null;
          const appMeta = b.app_metadata && typeof b.app_metadata === 'object' ? { ...(user.raw_app_meta_data ?? {}), ...b.app_metadata } : null;
          try {
            await sql`
              update auth.users set
                encrypted_password = coalesce(${pw}, encrypted_password),
                email_confirmed_at = case when ${b.email_confirm === true} then coalesce(email_confirmed_at, now()) else email_confirmed_at end,
                banned_until = case when ${banned !== undefined} then ${banned ?? null}::timestamptz else banned_until end,
                email = coalesce(${email ?? null}, email),
                raw_user_meta_data = coalesce(${userMeta ? sql.json(userMeta) : null}::jsonb, raw_user_meta_data),
                raw_app_meta_data = coalesce(${appMeta ? sql.json(appMeta) : null}::jsonb, raw_app_meta_data),
                updated_at = now()
              where id = ${id}`;
          } catch (e) {
            console.error('[fake-auth] update user failed:', (e as Error).message);
            return authError(500, 'unexpected_failure', 'Database error updating user');
          }
          return json(200, userJson((await loadUser(id))!));
        }
        if (method === 'DELETE') {
          try {
            await sql`delete from auth.users where id = ${id}`;
          } catch (e) {
            console.error('[fake-auth] delete user failed:', (e as Error).message);
            return authError(500, 'unexpected_failure', 'Database error deleting user');
          }
          dropRefreshTokens((e) => e.userId === id);
          return json(200, {});
        }
      }
      return authError(404, 'not_found', 'Not found');
    }

    // sign-up from the website (supabase.auth.signUp) with "Confirm email" off, as on the live
    // project: the account is confirmed at once and the answer carries a session
    if (path === '/signup' && method === 'POST') {
      if (!isAnyKey(req)) return json(401, { message: keyOf(req) ? 'Invalid API key' : 'No API key found in request' });
      const b = await readBody(req);
      if (!b) return authError(400, 'bad_json', 'Could not parse request body as JSON');
      const made = await createUser({
        email: b.email, password: String(b.password ?? ''), confirmed: true,
        userMeta: b.data && typeof b.data === 'object' ? b.data : {},
      });
      if (made.status !== 200) return made;
      const user = await userByEmail(String(b.email).trim().toLowerCase());
      const out = await openAuthSession(user!, req.headers.get('user-agent'), validIp(req.headers.get('sb-forwarded-for')));
      // a new account has its email identity (supabase-js reads an empty list as "address taken")
      // deno-lint-ignore no-explicit-any
      const u = (out as any).user;
      if (u && !(Array.isArray(u.identities) && u.identities.length)) {
        u.identities = [{ id: u.id, user_id: u.id, provider: 'email', identity_data: { email: u.email, sub: u.id } }];
      }
      return json(200, out);
    }

    if (path === '/token' && method === 'POST') {
      if (!isAnyKey(req)) return json(401, { message: keyOf(req) ? 'Invalid API key' : 'No API key found in request' });
      const grant = u.searchParams.get('grant_type');
      const b = await readBody(req);
      if (!b) return authError(400, 'bad_json', 'Could not parse request body as JSON');
      const ip = validIp(req.headers.get('sb-forwarded-for'));
      const ua = req.headers.get('user-agent');
      if (grant === 'password') {
        const email = String(b.email ?? '').trim().toLowerCase();
        const password = String(b.password ?? '');
        const user = email ? await userByEmail(email) : null;
        if (!user || !(await checkPassword(password, user.encrypted_password))) {
          return grantError('invalid_credentials', 'Invalid login credentials');
        }
        if (!user.email_confirmed_at) return grantError('email_not_confirmed', 'Email not confirmed');
        if (isBanned(user)) return grantError('user_banned', 'User is banned');
        return json(200, await openAuthSession(user, ua, ip));
      }
      if (grant === 'refresh_token') {
        const rt = String(b.refresh_token ?? '');
        let entry = refresh.get(rt);
        if (!entry) return grantError('refresh_token_not_found', 'Invalid Refresh Token: Refresh Token Not Found');
        const s = (await sql<{ id: string; not_after: Date | null }[]>`select id, not_after from auth.sessions where id = ${entry.sessionId}`)[0];
        if (!s) {
          dropRefreshTokens((e) => e.sessionId === entry!.sessionId);
          return grantError('refresh_token_not_found', 'Invalid Refresh Token: Refresh Token Not Found');
        }
        if (s.not_after && new Date(s.not_after).getTime() <= Date.now()) return grantError('session_expired', 'Invalid Refresh Token: Session Expired');
        const user = await loadUser(entry.userId);
        if (!user) return grantError('refresh_token_not_found', 'Invalid Refresh Token: Refresh Token Not Found');
        if (isBanned(user)) return grantError('user_banned', 'Invalid Refresh Token: User Banned');
        if (entry.revokedAt !== null) {
          // GoTrue lets a just-rotated token be reused for 10 s (parallel tabs) and returns the
          // current token of the family; later reuse is refused.
          if (Date.now() - entry.revokedAt > 10_000) return grantError('refresh_token_already_used', 'Invalid Refresh Token: Already Used');
          let cur = entry.next!;
          while (refresh.get(cur)?.next) cur = refresh.get(cur)!.next!;
          if (!refresh.has(cur)) return grantError('refresh_token_not_found', 'Invalid Refresh Token: Refresh Token Not Found');
          return json(200, await tokenResponse(user, entry.sessionId, cur));
        }
        const next = randomToken();
        entry.revokedAt = Date.now();
        entry.next = next;
        refresh.set(next, { sessionId: entry.sessionId, userId: entry.userId, revokedAt: null, next: null });
        entry = undefined;
        await sql`update auth.sessions set refreshed_at = now(), updated_at = now() where id = ${s.id}`;
        return json(200, await tokenResponse(user, s.id, next));
      }
      return authError(400, 'validation_failed', 'unsupported_grant_type');
    }

    if (path === '/logout' && method === 'POST') {
      const a = await authedSession(req);
      if (a instanceof Response) return a;
      const scope = u.searchParams.get('scope') ?? 'global';
      const sid = String(a.claims.session_id);
      if (scope === 'local') {
        await sql`delete from auth.sessions where id = ${sid}`;
        dropRefreshTokens((e) => e.sessionId === sid);
      } else if (scope === 'others') {
        await sql`delete from auth.sessions where user_id = ${a.user.id} and id <> ${sid}`;
        dropRefreshTokens((e) => e.userId === a.user.id && e.sessionId !== sid);
      } else if (scope === 'global') {
        await sql`delete from auth.sessions where user_id = ${a.user.id}`;
        dropRefreshTokens((e) => e.userId === a.user.id);
      } else {
        return authError(400, 'validation_failed', 'Unsupported logout scope');
      }
      return new Response(null, { status: 204 });
    }

    if (path === '/user' && method === 'GET') {
      const a = await authedSession(req);
      if (a instanceof Response) return a;
      return json(200, userJson(a.user));
    }

    return authError(404, 'not_found', 'Not found');
  }

  // ── storage ─────────────────────────────────────────────────────────────────────────────
  type Bucket = { id: string; public: boolean; file_size_limit: number | null; allowed_mime_types: string[] | null };
  const bucketOf = async (id: string) =>
    (await sql<Bucket[]>`select id, public, file_size_limit::float8 as file_size_limit, allowed_mime_types from storage.buckets where id = ${id}`)[0] ?? null;
  const objKey = (bucket: string, path: string) => `${bucket}/${path}`;

  async function putObject(bucket: string, path: string, bytes: Uint8Array, type: string, cacheControl = 'max-age=3600') {
    const etag = (await sha256Hex(bytes)).slice(0, 32);
    const now = new Date();
    const metadata = {
      eTag: `"${etag}"`, size: bytes.byteLength, mimetype: type, cacheControl,
      lastModified: now.toISOString(), contentLength: bytes.byteLength, httpStatusCode: 200,
    };
    await sql`
      insert into storage.objects (bucket_id, name, metadata, created_at, updated_at, last_accessed_at)
      values (${bucket}, ${path}, ${sql.json(metadata)}, now(), now(), now())
      on conflict (bucket_id, name) do update set metadata = excluded.metadata, updated_at = now(), last_accessed_at = now()`;
    objects.set(objKey(bucket, path), { bytes: bytes.slice(), type, cacheControl, updated: now.getTime() });
  }

  async function deleteObjects(bucket: string, names: string[]) {
    const rows = await sql<{ name: string; metadata: unknown }[]>`
      delete from storage.objects where bucket_id = ${bucket} and name = any(${names}::text[]) returning name, metadata`;
    for (const n of names) objects.delete(objKey(bucket, n));
    return rows;
  }

  function objectResponse(bucket: string, path: string, head = false): Response {
    const ob = objects.get(objKey(bucket, path));
    if (!ob) return storageError(404, 'not_found', 'Object not found');
    return new Response(head ? null : ob.bytes as BodyInit, {
      status: 200,
      headers: {
        'Content-Type': ob.type,
        'Content-Length': String(ob.bytes.byteLength),
        'Cache-Control': ob.cacheControl,
        'Last-Modified': new Date(ob.updated).toUTCString(),
      },
    });
  }

  /** "<bucket>/<a>/<b>.pdf" (still URI-encoded) → parts, or null. */
  function splitObjectPath(rest: string): { bucket: string; path: string } | null {
    const parts = rest.split('/').filter((p) => p !== '');
    if (parts.length < 2) return null;
    try {
      const dec = parts.map((p) => decodeURIComponent(p));
      if (dec.some((p) => p === '..' || p === '.')) return null;
      return { bucket: dec[0], path: dec.slice(1).join('/') };
    } catch {
      return null;
    }
  }

  async function handleStorage(req: Request, u: URL, path: string): Promise<Response> {
    const method = req.method.toUpperCase();

    // public bucket objects and signed links need no key
    if (path.startsWith('/object/public/') && (method === 'GET' || method === 'HEAD')) {
      const p = splitObjectPath(path.slice('/object/public/'.length));
      if (!p) return storageError(400, 'invalid_key', 'Invalid object path');
      const b = await bucketOf(p.bucket);
      if (!b || !b.public) return storageError(404, 'not_found', 'Object not found');
      return objectResponse(p.bucket, p.path, method === 'HEAD');
    }
    if (path.startsWith('/object/sign/') && (method === 'GET' || method === 'HEAD')) {
      const p = splitObjectPath(path.slice('/object/sign/'.length));
      if (!p) return storageError(400, 'invalid_key', 'Invalid object path');
      const token = u.searchParams.get('token') ?? '';
      try {
        const { payload } = await jose.jwtVerify(token, secret, { algorithms: ['HS256'] });
        if (payload.url !== `${p.bucket}/${p.path}`) return storageError(400, 'InvalidSignature', 'The url do not match the signature');
      } catch (e) {
        const expired = (e as { code?: string }).code === 'ERR_JWT_EXPIRED';
        return storageError(400, 'InvalidJWT', expired ? 'jwt expired' : 'invalid signature');
      }
      return objectResponse(p.bucket, p.path, method === 'HEAD');
    }

    if (!keyOf(req) && !bearerOf(req)) return storageError(400, 'Unauthorized', 'headers must have required property \'authorization\'');
    if (!isSecret(req)) return storageError(403, 'Unauthorized', 'new row violates row-level security policy');

    if (path.startsWith('/object/sign/') && method === 'POST') {
      const p = splitObjectPath(path.slice('/object/sign/'.length));
      if (!p) return storageError(400, 'invalid_key', 'Invalid object path');
      const b = await readBody(req);
      const expiresIn = Number(b?.expiresIn);
      if (!Number.isInteger(expiresIn) || expiresIn < 1) return storageError(400, 'invalid_request', 'expiresIn must be a positive integer');
      if (!objects.has(objKey(p.bucket, p.path))) return storageError(404, 'not_found', 'Object not found');
      const now = Math.floor(Date.now() / 1000);
      const token = await new jose.SignJWT({ url: `${p.bucket}/${p.path}` })
        .setProtectedHeader({ alg: 'HS256', typ: 'JWT' }).setIssuedAt(now).setExpirationTime(now + expiresIn).sign(secret);
      const encPath = p.path.split('/').map(encodeURIComponent).join('/');
      return json(200, { signedURL: `/object/sign/${encodeURIComponent(p.bucket)}/${encPath}?token=${token}` });
    }

    // DELETE /object/<bucket> {prefixes}
    const bulk = /^\/object\/([^/]+)\/?$/.exec(path);
    if (bulk && method === 'DELETE') {
      const bucket = decodeURIComponent(bulk[1]);
      if (!(await bucketOf(bucket))) return storageError(404, 'Bucket not found', 'Bucket not found');
      const b = await readBody(req);
      const prefixes = b?.prefixes;
      if (!Array.isArray(prefixes) || !prefixes.every((x) => typeof x === 'string') || prefixes.length > 1000) {
        return storageError(400, 'invalid_request', 'body must have required property \'prefixes\'');
      }
      const rows = await deleteObjects(bucket, prefixes as string[]);
      return json(200, rows.map((r) => ({ bucket_id: bucket, name: r.name, metadata: r.metadata })));
    }

    const rest = path.startsWith('/object/authenticated/') ? path.slice('/object/authenticated/'.length)
      : path.startsWith('/object/') ? path.slice('/object/'.length) : null;
    const p = rest !== null ? splitObjectPath(rest) : null;
    if (!p) return storageError(404, 'not_found', 'Not found');
    const bucket = await bucketOf(p.bucket);
    if (!bucket) return storageError(404, 'Bucket not found', 'Bucket not found');

    if (method === 'GET' || method === 'HEAD') return objectResponse(p.bucket, p.path, method === 'HEAD');

    if (method === 'POST' || method === 'PUT') {
      const exists = objects.has(objKey(p.bucket, p.path));
      const upsert = (req.headers.get('x-upsert') ?? '').toLowerCase() === 'true';
      if (method === 'POST' && exists && !upsert) return storageError(409, 'Duplicate', 'The resource already exists');
      if (method === 'PUT' && !exists) return storageError(404, 'not_found', 'Object not found');
      const type = (req.headers.get('content-type') ?? 'application/octet-stream').trim();
      const bytes = new Uint8Array(await req.arrayBuffer());
      if (bucket.file_size_limit && bytes.byteLength > bucket.file_size_limit) {
        return storageError(413, 'Payload too large', 'The object exceeded the maximum allowed size');
      }
      const baseType = type.split(';')[0].trim().toLowerCase();
      if (bucket.allowed_mime_types?.length && !bucket.allowed_mime_types.includes(baseType)) {
        return storageError(415, 'invalid_mime_type', `mime type ${type} is not supported`);
      }
      await putObject(p.bucket, p.path, bytes, type, req.headers.get('cache-control') ?? 'max-age=3600');
      return json(200, { Key: `${p.bucket}/${p.path}`, Id: crypto.randomUUID() });
    }

    if (method === 'DELETE') {
      if (!objects.has(objKey(p.bucket, p.path))) return storageError(404, 'not_found', 'Object not found');
      await deleteObjects(p.bucket, [p.path]);
      return json(200, { message: 'Successfully deleted' });
    }
    return storageError(405, 'method_not_allowed', 'Method not allowed');
  }

  // ── the server ──────────────────────────────────────────────────────────────────────────
  const mailRoutes = o.mail ? mailProviderRoutes(o.mail) : null;

  async function dispatch(req: Request): Promise<Response> {
    const u = new URL(req.url);
    const method = req.method.toUpperCase();
    requests.push({ method, path: u.pathname, search: u.search, at: Date.now() });
    if (requests.length > 1000) requests.splice(0, requests.length - 1000);

    let best: (typeof extra)[number] | null = null;
    for (const r of extra) {
      if ((r.method === '*' || r.method === method) && u.pathname.startsWith(r.prefix)) {
        if (!best || r.prefix.length > best.prefix.length || (r.prefix.length === best.prefix.length && r.seq > best.seq)) best = r;
      }
    }
    if (best) return await best.fn(req, u);

    if (u.pathname.startsWith('/auth/v1/')) return await handleAuth(req, u, u.pathname.slice('/auth/v1'.length));
    if (u.pathname.startsWith('/storage/v1/')) return await handleStorage(req, u, u.pathname.slice('/storage/v1'.length));
    if (mailRoutes && method === 'POST' && u.pathname === '/v3/smtp/email') return await mailRoutes.brevo(req);
    if (mailRoutes && method === 'POST' && u.pathname === '/emails') return await mailRoutes.resend(req);
    return json(404, { error: 'not_found', message: `no fake route for ${method} ${u.pathname}` });
  }

  const ac = new AbortController();
  const server = Deno.serve({ hostname: '127.0.0.1', port: 0, signal: ac.signal, onListen() {} }, async (req) => {
    try {
      return await dispatch(req);
    } catch (e) {
      console.error('[fake-supabase] handler error:', (e as Error)?.stack ?? e);
      return json(500, { error: 'fake_error', message: String((e as Error)?.message ?? e) });
    }
  });
  url = `http://127.0.0.1:${server.addr.port}`;

  const fake: FakeSupabase = {
    url,
    route(method, pathPrefix, fn) {
      const r = { method: method.toUpperCase(), prefix: pathPrefix, fn, seq: ++routeSeq };
      extra.push(r);
      return () => {
        const i = extra.indexOf(r);
        if (i >= 0) extra.splice(i, 1);
      };
    },
    requests,
    calls(prefix, method) {
      return requests.filter((r) => r.path.startsWith(prefix) && (!method || r.method === method.toUpperCase()));
    },
    storage: {
      put: (bucket, path, bytes, type) => putObject(bucket, path, bytes, type),
      has: (bucket, path) => objects.has(objKey(bucket, path)),
      get: (bucket, path) => {
        const ob = objects.get(objKey(bucket, path));
        return ob ? { bytes: ob.bytes, type: ob.type } : null;
      },
      remove: async (bucket, path) => { await deleteObjects(bucket, [path]); },
    },
    auth: {
      async createUser(c) {
        const res = await createUser({ email: c.email, password: c.password, name: c.name, confirmed: c.confirmed !== false, via: c.via });
        const b = await res.json();
        if (!res.ok) throw new Error(`fake createUser failed: ${res.status} ${b.msg ?? ''}`);
        return { id: String(b.id) };
      },
      async issueSession(userId, so) {
        const u = await loadUser(userId);
        if (!u) throw new Error('fake issueSession: no such user');
        return openAuthSession(u, so?.userAgent ?? null, null);
      },
      mintAccessToken: (m) => mint(m),
      setAccessTtl(seconds) { accessTtl = Math.max(1, Math.floor(seconds)); },
      clearRefreshTokens() { refresh.clear(); },
    },
    sql,
    async close() {
      ac.abort();
      await server.finished.catch(() => {});
      await sql.end({ timeout: 2 }).catch(() => {});
    },
  };
  return fake;
}
