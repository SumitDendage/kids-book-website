// The per-request context every route receives.
import { clientIp, deviceKind, deviceLabel, ipNetwork, requestCountry, userAgent } from './http.ts';
import { sha256Hex } from './util.ts';
import type { Env } from './env.ts';

export type StaffInfo = { role: string; permissions: string[]; active: boolean };

export type Profile = {
  id: string;
  email: string;
  name: string;
  role: string | null;
  status: 'pending_verification' | 'active';
  email_verified_at: Date | null;
  created_via: string;
  agreement_version: string | null;
  agreement_accepted_at: Date | null;
  failed_login_attempts: number;
  locked_until: Date | null;
  last_login_at: Date | null;
  password_changed_at: Date | null;
  blocked_at: Date | null;
  blocked_reason: string | null;
  subscription_suspended_at: Date | null;
  suspension_reason: string | null;
  country: string | null;
  time_zone: string | null;
  created_at: Date;
  updated_at: Date;
};

export type SessionRow = {
  id: string;
  remember: boolean;
  created_at: Date;
  last_seen_at: Date;
  expires_at: Date;
  revoked_at: Date | null;
  blocked_at: Date | null;
  is_staff: boolean;
  device_id_hash: string | null;
};

export type AuthedUser = {
  id: string;
  profile: Profile;
  session: SessionRow;
  sessionId: string;
  accessToken: string;
  staff: StaffInfo | null;
};

export type Ctx = {
  req: Request;
  url: URL;
  method: string;
  path: string;
  params: Record<string, string>;
  query: URLSearchParams;
  ip: string | null;
  ipNetwork: string | null;
  ua: string;
  device: ReturnType<typeof deviceKind>;
  deviceLabel: string;
  country: string | null;
  deviceIdHash: string | null;   // sha256 of the browser's random X-Device-Id
  visitorId: string | null;      // X-Visitor-Id for analytics
  user: AuthedUser | null;
  env: Env;
  started: number;
  background: Promise<unknown>[];
  /** Work that may finish after the response is sent (emails, last-seen updates). */
  later(p: Promise<unknown> | (() => Promise<unknown>)): void;
};

export async function makeCtx(req: Request, url: URL, path: string, e: Env): Promise<Ctx> {
  const ua = userAgent(req);
  const ip = clientIp(req);
  const rawDevice = req.headers.get('x-device-id');
  const deviceIdHash = rawDevice && /^[A-Za-z0-9_-]{16,128}$/.test(rawDevice) ? await sha256Hex('device:' + rawDevice) : null;
  const visitor = req.headers.get('x-visitor-id');
  const background: Promise<unknown>[] = [];
  const ctx: Ctx = {
    req,
    url,
    method: req.method.toUpperCase(),
    path,
    params: {},
    query: url.searchParams,
    ip,
    ipNetwork: ipNetwork(ip),
    ua,
    device: deviceKind(ua),
    deviceLabel: deviceLabel(ua),
    country: e.trustProxyCountryHeader ? requestCountry(req) : null,
    deviceIdHash,
    visitorId: visitor && /^[A-Za-z0-9_-]{8,64}$/.test(visitor) ? visitor : null,
    user: null,
    env: e,
    started: Date.now(),
    background,
    later(p) {
      const run = typeof p === 'function' ? Promise.resolve().then(p) : p;
      background.push(run.catch((err) => console.error('[later]', (err as Error)?.message ?? err)));
    },
  };
  return ctx;
}
