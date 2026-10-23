// Test harness for the api Edge Function (DESIGN.md §6). One harness per test file:
//
//   import { startHarness, test, uniqueEmail, assertEquals, assertStatus } from './harness.ts';
//   const h = await startHarness();
//   test('signed-in customer sees their orders', async () => {
//     const c = await h.customer();
//     const r = await h.call('GET', '/api/me/orders', { token: c.token });
//     assertStatus(r, 200);
//   });
//
// The API runs in-process (lib/app.ts handle()) against the local test database (env LWW_TEST_DB),
// with a fake Supabase Auth/Storage server (fakes/supabase.ts) and a mail capture (fakes/mail.ts).
// Nothing here touches the internet.
import postgres from 'postgres';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { AssertionError, deepStrictEqual } from 'node:assert';
import { handle, resetSweepClockForTests } from '../../functions/api/lib/app.ts';
import '../../functions/api/routes/index.ts';
import { setPoolForTests, type Sql } from '../../functions/api/lib/db.ts';
import { setEnvForTests } from '../../functions/api/lib/env.ts';
import { resetAuthCachesForTests } from '../../functions/api/lib/auth.ts';
import { clearSettingsCache, DEFAULTS } from '../../functions/api/lib/settings.ts';
import { processOutbox as runOutbox, setMailTransportForTests } from '../../functions/api/lib/mail.ts';
import { decodeClaims } from '../../functions/api/lib/gotrue.ts';
import { deviceLabel, ipNetwork } from '../../functions/api/lib/http.ts';
import { sha256Hex } from '../../functions/api/lib/util.ts';
import { startFakeSupabase, type FakeHandler, type FakeSupabase } from './fakes/supabase.ts';
import { createMailCapture, type MailCapture } from './fakes/mail.ts';

export type CallOptions = {
  token?: string | null;
  body?: unknown;
  raw?: Uint8Array;
  headers?: Record<string, string>;
  ip?: string;
  device?: string;
  contentType?: string;
};

export type CallResult = {
  status: number;
  // deno-lint-ignore no-explicit-any
  body: any;            // parsed JSON when the response is JSON; text for text/*; otherwise null
  text: string;
  bytes: Uint8Array;
  headers: Headers;
};

export type LoginResult = {
  status: number;
  // deno-lint-ignore no-explicit-any
  body: any;
  text: string;
  token?: string;
  refreshToken?: string;
  /** the email-code step, when the password was accepted (code = the one in the email) */
  challenge?: { challengeId: string; code: string | null };
};

export type TestUser = { id: string; email: string; password: string; token: string; refreshToken: string; sessionId: string; name: string };

export type StaffRole = 'owner' | 'admin' | 'support' | 'content' | 'developer';

export type Harness = {
  call(method: string, path: string, o?: CallOptions): Promise<CallResult>;
  sql: Sql;                       // connection as sb_postgres (bypasses RLS) for setup and checks
  mail: MailCapture & {
    /** Detach the test transport: lib/mail.ts then uses its real HTTP path against the fake
     *  Brevo/Resend endpoints (MAIL_API_BASE = fake url). Mail still lands in `sent`. */
    off(): void;
    /** Re-attach the test transport (the default). */
    on(): void;
  };
  fake: {
    route(method: string, pathPrefix: string, fn: FakeHandler): () => void;
    url: string;
    /** the key the website sends as apikey (the dev server forwards /auth/v1 with it) */
    publishableKey: string;
    calls: FakeSupabase['calls'];
    requests: FakeSupabase['requests'];
    auth: FakeSupabase['auth'];
    storage: FakeSupabase['storage'];
  };
  storage: {
    put(bucket: string, path: string, bytes: Uint8Array, type: string): Promise<void>;
    has(bucket: string, path: string): boolean;
    get(bucket: string, path: string): { bytes: Uint8Array; type: string } | null;
  };
  customer(o?: { email?: string; name?: string; verified?: boolean; agreement?: boolean; remember?: boolean; ip?: string; device?: string }): Promise<TestUser>;
  staff(role: StaffRole, permissions?: string[], o?: { email?: string; name?: string; remember?: boolean }): Promise<TestUser>;
  /** POST /api/auth/login (the real route); token/refreshToken come from body.session. */
  /** POST /api/auth/login, then (unless `otp: false`) the emailed 6-digit code through
   *  POST /api/auth/verify-login-otp, as the website does. `challenge` is the first answer. */
  login(email: string, password: string, o?: { remember?: boolean; staff?: boolean; agreement?: boolean; ip?: string; device?: string; otp?: boolean })
    : Promise<LoginResult>;
  /** Merges over the test env (undefined removes a name) and clears the env/auth/settings caches. */
  setEnv(vars: Record<string, string | undefined>): void;
  /** Back to the env the harness started with. */
  resetEnv(): void;
  /** The env currently in force (test values only). */
  env(): Record<string, string | undefined>;
  setSetting(key: string, value: unknown): Promise<void>;
  samplePdf(pages?: number): Promise<Uint8Array>;
  uploadPdfFor(productId: string, pages?: number): Promise<void>;
  processOutbox(): Promise<{ sent: number; failed: number }>;
  /** Inserts a staff-style access grant straight into entitlements (kind 'grant', no order)
   *  for a sheet or a class; `days` from now (negative = already expired). Returns its id. */
  grant(userId: string, o: { productId?: string; classId?: string; days?: number; startsInDays?: number }): Promise<number>;
  /** The harness's own X-Device-Id (used when a call does not name a device). */
  device: string;
  /** User-Agent sent with every call unless a header overrides it. */
  userAgent: string;
  /** sha256 device hash the API stores for a device id (as lib/context.ts computes it). */
  deviceHash(device?: string): Promise<string>;
  db: string;
  close(): Promise<void>;
};

const PG_HOST = Deno.env.get('PGHOST') ?? '127.0.0.1';
const PG_PORT = Number(Deno.env.get('PGPORT') ?? 5433);
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

function rnd(n: number): string {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

let emailSeq = 0;
/** A fresh address on test.local, e.g. "cust.lx2k3a1.4f2c@test.local". */
export function uniqueEmail(tag = 'user'): string {
  const t = tag.toLowerCase().replace(/[^a-z0-9._+-]/g, '').slice(0, 30) || 'user';
  return `${t}.${Date.now().toString(36)}${(++emailSeq).toString(36)}.${rnd(2)}@test.local`;
}

/** A password Supabase Auth and passwordProblem() both accept. */
export function testPassword(): string {
  return `Tp-${rnd(5)}-Q7x`;
}

/** A random private address, so per-IP rate limits do not leak between tests. */
export function randomIp(): string {
  const b = new Uint8Array(3);
  crypto.getRandomValues(b);
  return `10.${b[0]}.${b[1]}.${1 + (b[2] % 254)}`;
}

/** Deno.test with the op/resource sanitizers off (pools and the fake server stay open). */
export function test(name: string, fn: () => Promise<void>): void {
  Deno.test({ name, fn, sanitizeOps: false, sanitizeResources: false, sanitizeExit: false });
}

// ── small assertion helpers (there is no std library in the offline cache) ──────────────────
export function assert(cond: unknown, msg = 'assertion failed'): asserts cond {
  if (!cond) throw new AssertionError({ message: msg });
}
export function assertEquals<T>(actual: unknown, expected: T, msg?: string): asserts actual is T {
  deepStrictEqual(actual, expected, msg);
}
export function assertNotEquals(actual: unknown, expected: unknown, msg?: string) {
  let same = false;
  try { deepStrictEqual(actual, expected); same = true; } catch { /* differ */ }
  if (same) throw new AssertionError({ message: msg ?? `expected a value other than ${JSON.stringify(expected)}` });
}
export function assertMatch(actual: string, re: RegExp, msg?: string) {
  if (!re.test(actual)) throw new AssertionError({ message: msg ?? `${JSON.stringify(actual)} does not match ${re}` });
}
/** Status check that prints the response body when it fails (much easier to debug). */
export function assertStatus(r: { status: number; text: string }, status: number, msg?: string) {
  if (r.status !== status) {
    throw new AssertionError({ message: `${msg ? msg + ': ' : ''}expected HTTP ${status}, got ${r.status}: ${r.text.slice(0, 600)}` });
  }
}
/** Awaits fn and checks it throws; returns the error (optionally its message must match). */
export async function assertRejects(fn: () => Promise<unknown>, match?: RegExp): Promise<Error> {
  try {
    await fn();
  } catch (e) {
    if (match && !match.test(String((e as Error)?.message ?? e))) {
      throw new AssertionError({ message: `error ${JSON.stringify(String((e as Error)?.message))} does not match ${match}` });
    }
    return e as Error;
  }
  throw new AssertionError({ message: 'expected the call to throw' });
}

// Same connection options as lib/db.ts (bigint → number, undefined → null, no prepared statements).
function pg(db: string, max: number, appName: string): Sql {
  return postgres(`postgres://sb_postgres:sb_postgres@${PG_HOST}:${PG_PORT}/${db}`, {
    max,
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: false,
    connection: { application_name: appName },
    types: {
      bigint: { to: 20, from: [20], serialize: (x: unknown) => String(x), parse: (x: string) => Number(x) },
    },
    transform: { undefined: null },
    onnotice: () => {},
  }) as Sql;
}

export async function startHarness(): Promise<Harness> {
  const db = Deno.env.get('LWW_TEST_DB') ?? 'lww_sb';
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(db)) throw new Error(`LWW_TEST_DB must be a plain database name, got ${JSON.stringify(db)}`);

  const sql = pg(db, 2, 'lww-test-harness');
  try {
    await sql`select 1`;
  } catch (e) {
    throw new Error(`Test database "${db}" is not reachable (${(e as Error).message}). Rebuild it with: LWW_TEST_DB=${db} tests/local/reset-db.sh`);
  }

  const secretKey = `sb_secret_lwwtest_${rnd(12)}`;
  const publishableKey = `sb_publishable_lwwtest_${rnd(12)}`;
  const jwtSecret = `lww-test-jwt-secret-${rnd(24)}`;
  const mail = createMailCapture();
  const fake = await startFakeSupabase({ db, jwtSecret, secretKey, publishableKey, mail, pgHost: PG_HOST, pgPort: PG_PORT });

  const baseEnv: Record<string, string | undefined> = {
    SUPABASE_URL: fake.url,
    SUPABASE_SERVICE_ROLE_KEY: secretKey,
    SUPABASE_ANON_KEY: publishableKey,
    SUPABASE_DB_URL: `postgres://sb_postgres:sb_postgres@${PG_HOST}:${PG_PORT}/${db}`,
    LWW_JWT_SECRET: jwtSecret,
    MAIL_PROVIDER: 'brevo',
    BREVO_API_KEY: 'test',
    MAIL_FROM: 'Learn With Why <hello@test.local>',
    MAIL_API_BASE: fake.url,
    SITE_URL: 'http://localhost:5173',
    LWW_VERSION: 'test',
    LOGIN_OTP_ENCRYPTION_KEY: btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))),
  };
  let currentEnv = { ...baseEnv };
  const applyEnv = () => {
    setEnvForTests({ ...currentEnv });
    resetAuthCachesForTests();
    clearSettingsCache();
  };
  applyEnv();
  resetSweepClockForTests();
  setMailTransportForTests(mail.transport);

  const pool = pg(db, 3, 'lww-api-test'); // same size as lib/db.ts, so pool starvation shows up in tests too
  setPoolForTests(pool);

  const device = `hdev_${rnd(12)}`;

  async function call(method: string, path: string, o: CallOptions = {}): Promise<CallResult> {
    const url = /^https?:\/\//.test(path) ? path
      : path.startsWith('/functions/v1/') ? `http://api.local${path}`
      : path.startsWith('/api/') ? `http://api.local/functions/v1${path}`
      : `http://api.local/functions/v1/api/${path.replace(/^\/+/, '')}`;
    const headers = new Headers({ 'user-agent': UA, 'x-forwarded-for': o.ip ?? randomIp(), 'x-device-id': o.device ?? device });
    if (o.token) headers.set('authorization', `Bearer ${o.token}`);
    let body: BodyInit | undefined;
    if (o.raw !== undefined) {
      body = o.raw as BodyInit;
      headers.set('content-type', o.contentType ?? 'application/octet-stream');
      headers.set('content-length', String(o.raw.byteLength));
    } else if (o.body !== undefined) {
      const s = typeof o.body === 'string' ? o.body : JSON.stringify(o.body);
      body = s;
      headers.set('content-type', o.contentType ?? 'application/json');
      headers.set('content-length', String(new TextEncoder().encode(s).byteLength));
    } else if (o.contentType) {
      headers.set('content-type', o.contentType);
    }
    for (const [k, v] of Object.entries(o.headers ?? {})) headers.set(k, v);
    // No implicit outbox sweeps during tests: they would send mail at surprising moments.
    // Tests that need the outbox call h.processOutbox().
    resetSweepClockForTests();
    const res = await handle(new Request(url, { method: method.toUpperCase(), headers, body }), { awaitBackground: true });
    const bytes = new Uint8Array(await res.arrayBuffer());
    const text = new TextDecoder().decode(bytes);
    const type = res.headers.get('content-type') ?? '';
    let parsed: unknown = null;
    if (/[/+]json\b/i.test(type)) {
      try { parsed = text ? JSON.parse(text) : null; } catch { parsed = null; }
    } else if (/^text\//i.test(type)) {
      parsed = text;
    }
    return { status: res.status, body: parsed, text, bytes, headers: res.headers };
  }

  // Direct calls to the fake Auth server, as the API makes them (exercises the fake's HTTP routes).
  async function authFetch(path: string, body: unknown) {
    const res = await fetch(`${fake.url}/auth/v1${path}`, {
      method: 'POST',
      headers: { apikey: secretKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    // deno-lint-ignore no-explicit-any
    const b = await res.json().catch(() => ({})) as any;
    if (!res.ok) throw new Error(`fake auth ${path} failed: ${res.status} ${b.error_code ?? ''} ${b.msg ?? ''}`);
    return b;
  }

  async function agreementNow(): Promise<{ version: string; text: string }> {
    const r = await sql<{ value: { version?: string; text?: string } }[]>`select value from settings where key = 'agreement'`;
    return { version: r[0]?.value?.version || DEFAULTS.agreement.version, text: r[0]?.value?.text || DEFAULTS.agreement.text };
  }

  async function sessionHours(remember: boolean): Promise<number> {
    const r = await sql<{ value: { rememberDays?: number; shortHours?: number; maxDays?: number } }[]>`select value from settings where key = 'sessions'`;
    const s = { ...DEFAULTS.sessions, ...(r[0]?.value ?? {}) };
    return Math.min(remember ? s.rememberDays * 24 : s.shortHours, s.maxDays * 24);
  }

  async function makeUser(o: { email?: string; name?: string; verified?: boolean; agreement?: boolean; remember?: boolean; ip?: string; device?: string; isStaff: boolean }): Promise<TestUser> {
    const email = (o.email ?? uniqueEmail(o.isStaff ? 'staff' : 'cust')).toLowerCase();
    const name = o.name ?? (o.isStaff ? 'Test Staff' : 'Test Parent');
    const password = testPassword();
    const verified = o.verified !== false;
    const withAgreement = o.agreement !== false;
    const remember = o.remember === true;
    const ip = o.ip ?? randomIp();
    const dev = o.device ?? device;

    const created = await authFetch('/admin/users', {
      email, password, email_confirm: verified,
      user_metadata: { name }, app_metadata: { lww_created_via: o.isStaff ? 'staff' : 'signup' },
    });
    const id = String(created.id);
    const ag = await agreementNow();
    await sql`
      update profiles set
        name = ${name},
        role = ${o.isStaff ? null : 'parent'},
        status = ${verified ? 'active' : 'pending_verification'},
        email_verified_at = ${verified ? new Date() : null},
        agreement_version = ${withAgreement ? ag.version : null},
        agreement_accepted_at = ${withAgreement ? new Date() : null}
      where id = ${id}`;
    if (withAgreement) {
      await sql`
        insert into agreement_acceptances (user_id, version, text_sha256, context, ip, user_agent)
        values (${id}, ${ag.version}, ${await sha256Hex(ag.text)}, 'signup', ${ip}, ${UA})`;
    }
    // Supabase Auth refuses unconfirmed accounts, so an unverified user's session is opened
    // directly in the fake (lets tests check the API's own email_unverified refusal).
    // deno-lint-ignore no-explicit-any
    const t: any = verified
      ? await authFetch('/token?grant_type=password', { email, password })
      : await fake.auth.issueSession(id, { userAgent: UA });
    const sessionId = String(decodeClaims(t.access_token).session_id ?? '');
    const hours = await sessionHours(remember);
    await sql`
      insert into app_sessions (id, user_id, remember, expires_at, ip, ip_network, country, user_agent, device_label, device_id_hash, is_staff)
      values (${sessionId}, ${id}, ${remember}, now() + make_interval(hours => ${hours}), ${ip}, ${ipNetwork(ip)}, ${null},
              ${UA}, ${deviceLabel(UA)}, ${await sha256Hex('device:' + dev)}, ${o.isStaff})`;
    await sql`update profiles set last_login_at = now() where id = ${id}`;
    return { id, email, password, token: t.access_token, refreshToken: t.refresh_token, sessionId, name };
  }

  const h: Harness = {
    call,
    sql,
    mail: Object.assign(mail, {
      off() { setMailTransportForTests(null); },
      on() { setMailTransportForTests(mail.transport); },
    }),
    fake: {
      route: (m, p, fn) => fake.route(m, p, fn),
      url: fake.url,
      publishableKey,
      calls: fake.calls,
      requests: fake.requests,
      auth: fake.auth,
      storage: fake.storage,
    },
    storage: {
      put: (bucket, path, bytes, type) => fake.storage.put(bucket, path, bytes, type),
      has: (bucket, path) => fake.storage.has(bucket, path),
      get: (bucket, path) => fake.storage.get(bucket, path),
    },
    customer: (o = {}) => makeUser({ ...o, isStaff: false }),
    async staff(role, permissions, o = {}) {
      const tpl = await sql<{ permissions: string[] }[]>`select permissions from staff_role_templates where role = ${role}`;
      if (!tpl.length) throw new Error(`unknown staff role ${role}`);
      const u = await makeUser({ email: o.email ?? uniqueEmail(`staff-${role}`), name: o.name ?? `Test ${role}`, remember: o.remember, isStaff: true });
      await sql`
        insert into staff_members (user_id, role, permissions, active)
        values (${u.id}, ${role}, ${permissions ?? tpl[0].permissions}::text[], true)`;
      return u;
    },
    async login(email, password, o = {}) {
      const body: Record<string, unknown> = { email, password, remember: o.remember ?? false };
      if (o.staff !== undefined) body.staff = o.staff;
      if (o.agreement !== undefined) body.agreement = o.agreement;
      let r = await call('POST', '/api/auth/login', { body, ip: o.ip, device: o.device });
      let challenge: { challengeId: string; code: string | null } | undefined;
      if (r.status === 200 && r.body?.otpRequired && o.otp !== false) {
        const m = mail.last(email)?.text.match(/code is: (\d{6})/);
        challenge = { challengeId: r.body.challengeId, code: m ? m[1] : null };
        r = await call('POST', '/api/auth/verify-login-otp', { body: { challengeId: challenge.challengeId, code: challenge.code ?? '' }, ip: o.ip, device: o.device });
      }
      return { status: r.status, body: r.body, text: r.text, token: r.body?.session?.accessToken, refreshToken: r.body?.session?.refreshToken, challenge };
    },
    setEnv(vars) {
      for (const [k, v] of Object.entries(vars)) {
        if (v === undefined) delete currentEnv[k];
        else currentEnv[k] = v;
      }
      applyEnv();
    },
    resetEnv() {
      currentEnv = { ...baseEnv };
      applyEnv();
    },
    env: () => ({ ...currentEnv }),
    async setSetting(key, value) {
      await sql`
        insert into settings (key, value) values (${key}, ${sql.json(value as never)})
        on conflict (key) do update set value = excluded.value`;
      clearSettingsCache();
    },
    samplePdf,
    async uploadPdfFor(productId, pages = 1) {
      const r = await sql<{ pdf_path: string | null }[]>`select pdf_path from products where id = ${productId}`;
      if (!r.length) throw new Error(`uploadPdfFor: no product ${productId}`);
      let path = r[0].pdf_path;
      if (!path) {
        path = `uploads/${productId}.pdf`;
        await sql`update products set pdf_path = ${path} where id = ${productId}`;
      }
      await fake.storage.put('worksheets', path, await samplePdf(pages), 'application/pdf');
    },
    async processOutbox() {
      let sent = 0, failed = 0;
      for (let i = 0; i < 50; i++) {
        const r = await runOutbox(50);
        sent += r.sent;
        failed += r.failed;
        if (r.sent + r.failed === 0) break;
      }
      return { sent, failed };
    },
    async grant(userId, o) {
      if (!!o.productId === !!o.classId) throw new Error('grant: give productId or classId');
      const start = o.startsInDays ?? Math.min(0, (o.days ?? 30) - 1);
      const end = o.days ?? 30;
      const r = await sql<{ id: number }[]>`
        insert into entitlements (user_id, scope, product_id, class_id, kind, purchased_at, starts_at, expires_at)
        values (${userId}, ${o.productId ? 'worksheet' : 'class'}, ${o.productId ?? null}, ${o.classId ?? null}, 'grant',
                now() + make_interval(days => ${Math.min(start, 0)}), now() + make_interval(days => ${start}),
                now() + make_interval(days => ${end}))
        returning id`;
      return r[0].id;
    },
    device,
    userAgent: UA,
    deviceHash: (d?: string) => sha256Hex('device:' + (d ?? device)),
    db,
    async close() {
      setMailTransportForTests(null);
      setPoolForTests(null);
      setEnvForTests(null);
      await Promise.allSettled([pool.end({ timeout: 2 }), sql.end({ timeout: 2 }), fake.close()]);
    },
  };
  return h;
}

/** A real, small PDF (one line of text per page) made with pdf-lib. */
export async function samplePdf(pages = 1): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= Math.max(1, Math.min(pages, 200)); i++) {
    const page = doc.addPage([595, 842]);
    page.drawText(`Learn With Why test sheet, page ${i}`, { x: 60, y: 760, size: 18, font });
  }
  doc.setTitle('LWW test sheet');
  return await doc.save();
}
