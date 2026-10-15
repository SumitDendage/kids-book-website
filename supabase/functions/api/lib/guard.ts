// Rate limits (shared by every copy of the API, stored in Postgres) and the audit trail helpers.
import { tx, type Tx } from './db.ts';
import { HttpError, RATE_LIMITED } from './http.ts';
import type { Ctx } from './context.ts';

/** Counts one hit; throws 429 when the bucket is over its limit for the current window. */
export async function rateLimit(ctx: Ctx, name: string, key: string | null, limit: number, windowSeconds: number, message = RATE_LIMITED, code: string | null = 'rate_limited') {
  const bucket = `${name}:${key ?? ctx.ip ?? '-'}`;
  const ok = await tx((q) => q<{ ok: boolean }[]>`select private.rate_limit_hit(${bucket}, ${limit}, ${windowSeconds}) as ok`);
  if (!ok[0]?.ok) {
    throw new HttpError(429, message, code ? { code } : {}, { 'Retry-After': String(windowSeconds) });
  }
}

/** Is this bucket already over its limit? (does not count a hit) */
export async function overLimit(name: string, key: string, limit: number, windowSeconds: number): Promise<boolean> {
  const bucket = `${name}:${key}`;
  const r = await tx((q) => q<{ hits: number }[]>`
    select hits from private.rate_limits
    where bucket = ${bucket} and window_start = to_timestamp(floor(extract(epoch from now()) / ${windowSeconds}) * ${windowSeconds})`);
  return (r[0]?.hits ?? 0) >= limit;
}

export type AuditInput = { action: string; targetType?: string; targetId?: string | number | null; detail?: Record<string, unknown> };

/** Writes one audit row (inside the caller's transaction when given). */
export async function audit(ctx: Ctx, a: AuditInput, q?: Tx) {
  const u = ctx.user;
  const run = (t: Tx) => t`
    insert into audit_logs (actor_id, actor_email, actor_role, action, target_type, target_id, ip, detail)
    values (${u?.id ?? null}, ${u?.profile.email ?? null}, ${u?.staff?.role ?? (u ? 'customer' : 'system')},
            ${a.action}, ${a.targetType ?? null}, ${a.targetId == null ? null : String(a.targetId)}, ${ctx.ip},
            ${a.detail ? t.json(a.detail as never) : null})`;
  if (q) await run(q); else await tx(run);
}

export async function securityEvent(ctx: Ctx, userId: string | null, type: string, detail: Record<string, unknown> | null = null, q?: Tx) {
  const run = (t: Tx) => t`
    insert into security_events (user_id, event_type, detail, ip, user_agent)
    values (${userId}, ${type}, ${detail ? t.json(detail as never) : null}, ${ctx.ip}, ${ctx.ua || null})`;
  if (q) await run(q); else await tx(run);
}

export async function loginActivity(ctx: Ctx, o: { userId: string | null; email: string; success: boolean; reason?: string | null; sessionId?: string | null }, q?: Tx) {
  const run = (t: Tx) => t`
    insert into login_activity (user_id, email, success, failure_reason, ip, user_agent, session_id)
    values (${o.userId}, ${o.email.slice(0, 254) || '-'}, ${o.success}, ${o.success ? null : (o.reason ?? 'bad_credentials')},
            ${ctx.ip}, ${ctx.ua || null}, ${o.sessionId ?? null})`;
  if (q) await run(q); else await tx(run);
}

export async function notify(q: Tx, n: { audience: 'customer' | 'staff'; userId?: string | null; kind: string; title: string; body?: string; link?: string; data?: Record<string, unknown> }) {
  await q`
    insert into notifications (audience, user_id, kind, title, body, link, data)
    values (${n.audience}, ${n.userId ?? null}, ${n.kind}, ${n.title.slice(0, 160)}, ${n.body?.slice(0, 2000) ?? null},
            ${n.link ?? null}, ${n.data ? q.json(n.data as never) : null})`;
}

export async function analytics(q: Tx, ctx: Ctx | null, e: { kind: string; userId?: string | null; productId?: string | null; orderId?: string | null; valueInr?: number | null; meta?: Record<string, unknown> }) {
  await q`
    insert into analytics_events (kind, source, visitor_id, user_id, path, product_id, order_id, value_inr, country, device, meta)
    values (${e.kind}, 'server', ${ctx?.visitorId ?? null}, ${e.userId ?? null}, ${null}, ${e.productId ?? null},
            ${e.orderId ?? null}, ${e.valueInr ?? null}, ${ctx?.country ?? null}, ${ctx?.device ?? null},
            ${e.meta ? q.json(e.meta as never) : null})`;
}
