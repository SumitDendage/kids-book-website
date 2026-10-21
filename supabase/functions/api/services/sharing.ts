// OWNER: agent D (access & security).
// Account-sharing rules, incidents, warnings and the paid-access suspension.
// The policy (see migrations/20261007120400_security.sql):
//  * the API records what it sees (sessions, devices, networks, viewer use) in access_log;
//  * enabled security_rules turn patterns into INCIDENTS — only a suspicion; a new IP or one new
//    device never opens one on its own (thresholds are clamped so that cannot happen);
//  * an incident becomes a WARNING when staff confirm it, or at once for auto-confirm rules;
//    one warning per incident at most;
//  * at settings.security.maxWarnings active warnings (and autoSuspend) paid access is
//    suspended; sign-in, free sheets, orders and appeals keep working;
//  * staff accounts are never evaluated.
import type { Tx } from '../lib/db.ts';
import { tx } from '../lib/db.ts';
import type { AuthedUser, Ctx } from '../lib/context.ts';
import { HttpError } from '../lib/http.ts';
import { audit, notify, type AuditInput } from '../lib/guard.ts';
import { getSettings, type Settings } from '../lib/settings.ts';
import { enqueue, kickOutbox } from '../lib/mail.ts';
import { env } from '../lib/env.ts';
import { cleanText, escapeHtml, validEmail } from '../lib/util.ts';
import { accessRestored, securityWarning, staffAlert, type Email } from './emails.ts';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ms = (d: Date | string | null | undefined) => (d == null ? null : new Date(d).getTime());
const clamp = (v: unknown, def: number, min: number, max: number) => {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.floor(v) : def;
  return Math.max(min, Math.min(max, n));
};

/** E1 shape (security zip) plus details. Times are epoch ms. */
export type SecurityStatus = {
  warningCount: number;            // active warnings (not revoked, not expired)
  maxWarnings: number;
  accessStatus: 'active' | 'suspended';
  acknowledgedWarningCount: number;
  updatedAt: number | null;
  suspendedAt: number | null;
  suspensionReason: 'warnings' | 'staff' | null;
  warnings: { id: number; level: number; reason: string; issuedAt: number; expiresAt: number | null; acknowledged: boolean }[];
  openAppeal: { id: number; kind: string; createdAt: number } | null;
};

function maxWarningsOf(s: Settings) {
  return clamp(s.security.maxWarnings, 3, 1, 20);
}

export async function securityStatus(q: Tx, userId: string): Promise<SecurityStatus> {
  const settings = await getSettings(q);
  const rows = await q<{ suspended_at: Date | null; reason: 'warnings' | 'staff' | null; warn_at: Date | null; appeal_id: number | null; appeal_kind: string | null; appeal_at: Date | null }[]>`
    select p.subscription_suspended_at as suspended_at, p.suspension_reason as reason,
      (select greatest(max(w.issued_at), max(w.acknowledged_at), max(w.revoked_at))
         from account_warnings w where w.user_id = p.id) as warn_at,
      a.id as appeal_id, a.kind as appeal_kind, a.created_at as appeal_at
    from profiles p
    left join account_appeals a on a.user_id = p.id and a.status = 'open'
    where p.id = ${userId}
    limit 1`;
  const p = rows[0];
  if (!p) throw new HttpError(404, 'Not found');
  const ws = await q<{ id: number; level: number; reason: string; issued_at: Date; expires_at: Date | null; acknowledged_at: Date | null }[]>`
    select id, level, reason, issued_at, expires_at, acknowledged_at
    from account_warnings
    where user_id = ${userId} and revoked_at is null and (expires_at is null or expires_at > now())
    order by issued_at, id`;
  const times = [ms(p.warn_at), ms(p.suspended_at)].filter((x): x is number => x != null);
  return {
    warningCount: ws.length,
    maxWarnings: maxWarningsOf(settings),
    accessStatus: p.suspended_at ? 'suspended' : 'active',
    acknowledgedWarningCount: ws.filter((w) => w.acknowledged_at).length,
    updatedAt: times.length ? Math.max(...times) : null,
    suspendedAt: ms(p.suspended_at),
    suspensionReason: p.suspended_at ? p.reason : null,
    warnings: ws.map((w) => ({
      id: w.id, level: w.level, reason: w.reason, issuedAt: ms(w.issued_at)!, expiresAt: ms(w.expires_at), acknowledged: !!w.acknowledged_at,
    })),
    openAppeal: p.appeal_id ? { id: p.appeal_id, kind: p.appeal_kind!, createdAt: ms(p.appeal_at)! } : null,
  };
}

/** E2: marks the oldest `upTo` active warnings as seen. Never un-acknowledges anything and never
 *  changes how many warnings count. Returns the new status. */
export async function acknowledgeWarnings(q: Tx, userId: string, upTo: number): Promise<SecurityStatus> {
  const n = Math.max(0, Math.min(20, Math.floor(upTo)));
  if (n > 0) {
    await q`
      update account_warnings set acknowledged_at = now()
      where id in (
        select id from account_warnings
        where user_id = ${userId} and revoked_at is null and (expires_at is null or expires_at > now())
        order by issued_at, id
        limit ${n})
        and acknowledged_at is null`;
  }
  return await securityStatus(q, userId);
}

export type AccessAction = 'access' | 'meta' | 'pdf' | 'page' | 'print' | 'download' | 'view';

/** Writes one access_log row for a customer request (allowed or refused). Staff are not logged as
 *  customers. Call it inside the request (pass q) or via ctx.later (no q). */
export async function observeAccess(ctx: Ctx, user: AuthedUser, o: { action: AccessAction; productId?: string | null; entitlementId?: number | null; ok: boolean; detail?: string | null }, q?: Tx): Promise<void> {
  // staff rows are kept for the audit trail but marked, and the rules never read them
  const base = o.detail ? cleanText(o.detail, 280) : null;
  const detail = user.staff ? (base ? `staff · ${base}` : 'staff') : base;
  const run = (t: Tx) => t`
    insert into access_log (user_id, product_id, entitlement_id, session_id, action, ok, detail, ip, ip_network, device_id_hash, country)
    values (${user.id}, ${o.productId ? String(o.productId).slice(0, 64) : null}, ${o.entitlementId ?? null}, ${user.sessionId},
            ${o.action}, ${o.ok}, ${detail}, ${ctx.ip}, ${ctx.ipNetwork}, ${ctx.deviceIdHash}, ${ctx.country})`;
  if (q) await run(q); else await tx(run);
}

// ── small writers that also work without a request (rules run in the background) ──────────

async function auditAs(q: Tx, ctx: Ctx | null, by: string | null, a: AuditInput) {
  if (ctx && by && ctx.user?.id === by) return await audit(ctx, a, q);
  await q`
    insert into audit_logs (actor_id, actor_email, actor_role, action, target_type, target_id, ip, detail)
    values (${by}, ${null}, ${by ? 'staff' : 'system'}, ${a.action}, ${a.targetType ?? null},
            ${a.targetId == null ? null : String(a.targetId)}, ${ctx?.ip ?? null}, ${a.detail ? q.json(a.detail as never) : null})`;
}

async function secEvent(q: Tx, ctx: Ctx | null, userId: string | null, type: string, detail: Record<string, unknown> | null) {
  await q`
    insert into security_events (user_id, event_type, detail, ip, user_agent)
    values (${userId}, ${type}, ${detail ? q.json(detail as never) : null}, ${ctx?.ip ?? null}, ${ctx?.ua || null})`;
}

function staffInbox(s: Settings): string[] {
  const list = Array.isArray(s.email.adminAlerts) ? s.email.adminAlerts : [];
  return [...new Set(list.map((x) => String(x ?? '').trim().toLowerCase()).filter(validEmail))].slice(0, 10);
}

/** Queues one email to every staff alert address (dedupe key per address). */
async function alertStaff(q: Tx, s: Settings, mail: Email, dedupe: string, related: { type: string; id: string | number }) {
  const to = staffInbox(s);
  for (let i = 0; i < to.length; i++) {
    await enqueue(q, {
      template: 'staff_alert', to: to[i], subject: mail.subject, html: mail.html, text: mail.text,
      dedupeKey: i === 0 ? dedupe : `${dedupe}:${i}`, relatedType: related.type, relatedId: related.id,
    });
  }
}

/** Customer email when staff pause paid access (the warnings path explains it in the warning email). */
function accessPausedEmail(name: string): Email {
  const subject = 'Learn With Why: access to paid sheets is paused';
  const body = [
    `Hello ${escapeHtml(name)},`,
    'Access to the paid sheets and class plans on your account has been paused while we review how the account is used.',
    'You can still sign in, see your orders and open free sheets. If you think this is a mistake, send us a note from My Account → Security, or reply to this email.',
  ];
  const html = `<!doctype html><html><body style="font-family:Arial,Helvetica,sans-serif;color:#24312a;line-height:1.55">` +
    body.map((l) => `<p>${l}</p>`).join('') + '</body></html>';
  const text = `Hello ${name},\n\nAccess to the paid sheets and class plans on your account has been paused while we review how the account is used.\nYou can still sign in, see your orders and open free sheets. If you think this is a mistake, send us a note from My Account → Security.\n`;
  return { subject, html, text };
}

const siteLink = (path: string) => `${env().siteUrl}${path}`;

// ── rules ──────────────────────────────────────────────────────────────────────────────────

type RuleRow = { id: string; name: string; auto_confirm: boolean; params: Record<string, unknown> | null };
type Hit = { windowSeconds: number; summary: string; evidence: Record<string, unknown> };
type Activity = { devices: number; networks: number; countries: number; nets: string[] | null; cs: string[] | null };

/** Distinct devices, networks and countries this customer used since `since`.
 *  A device is the device of the sign-in the request came with (one sign-in is always one device,
 *  even when a browser cannot keep its device id and sends a new one with every request), else the
 *  request's own device id, else the sign-in, else the address.
 *  paidOnly=false: sign-ins seen in the window plus every viewer/access request.
 *  paidOnly=true: only requests that opened a PAID access record (a bought or granted sheet or a
 *  class plan) — what "paid sheets opened on several devices / from several countries" means. */
async function activity(q: Tx, userId: string, since: Date, o: { paidOnly?: boolean } = {}): Promise<Activity> {
  const paidOnly = !!o.paidOnly;
  const r = await q<Activity[]>`
    with ev as (
      select coalesce(s.device_id_hash, 'session:' || s.id::text) as dev, s.ip_network as net, s.country
      from app_sessions s
      where not ${paidOnly}::boolean
        and s.user_id = ${userId} and not s.is_staff and greatest(s.created_at, s.last_seen_at) >= ${since}
      union all
      select coalesce(s.device_id_hash, a.device_id_hash, 'session:' || a.session_id::text, 'ip:' || a.ip) as dev,
             a.ip_network as net, a.country
      from access_log a
      left join app_sessions s on s.id = a.session_id
      where a.user_id = ${userId} and a.at >= ${since} and coalesce(s.is_staff, false) = false
        and (not ${paidOnly}::boolean
             or (a.ok and exists (select 1 from entitlements e where e.id = a.entitlement_id and e.kind <> 'free')))
    )
    select count(distinct dev)::int as devices, count(distinct net)::int as networks, count(distinct country)::int as countries,
           (array_agg(distinct net) filter (where net is not null))[1:10] as nets,
           (array_agg(distinct country) filter (where country is not null))[1:10] as cs
    from ev`;
  return r[0] ?? { devices: 0, networks: 0, countries: 0, nets: null, cs: null };
}

async function detect(q: Tx, rule: RuleRow, userId: string): Promise<Hit | null> {
  const p = rule.params ?? {};
  const now = Date.now();
  switch (rule.id) {
    case 'concurrent_devices': {
      // needs BOTH several devices and several networks: one new device or a new IP never trips it
      const mins = clamp(p.windowMinutes, 15, 1, 1440);
      const needDevices = clamp(p.devices, 3, 3, 100);
      const needNetworks = clamp(p.networks, 2, 2, 100);
      const a = await activity(q, userId, new Date(now - mins * 60_000), { paidOnly: true });
      if (a.devices < needDevices || a.networks < needNetworks) return null;
      return {
        windowSeconds: mins * 60,
        summary: `Your account was used on ${a.devices} devices from ${a.networks} different networks within ${mins} minutes.`,
        evidence: { devices: a.devices, networks: a.networks, countries: a.countries, networkList: a.nets ?? [], countryList: a.cs ?? [], windowMinutes: mins },
      };
    }
    case 'many_devices_day': {
      const hours = clamp(p.windowHours, 24, 1, 168);
      const need = clamp(p.devices, 6, 3, 100);
      const a = await activity(q, userId, new Date(now - hours * 3_600_000));
      if (a.devices <= need) return null;   // "more than 6 devices in a day"
      return {
        windowSeconds: hours * 3600,
        summary: `Your account was used on ${a.devices} different devices within ${hours} hours.`,
        evidence: { devices: a.devices, networks: a.networks, networkList: a.nets ?? [], windowHours: hours },
      };
    }
    case 'many_countries_day': {
      const hours = clamp(p.windowHours, 24, 1, 168);
      const need = clamp(p.countries, 3, 3, 50);
      const a = await activity(q, userId, new Date(now - hours * 3_600_000), { paidOnly: true });
      if (a.countries <= need) return null;   // "paid sheets opened from more than 3 countries"
      return {
        windowSeconds: hours * 3600,
        summary: `Your account was used from ${a.countries} different countries within ${hours} hours.`,
        evidence: { countries: a.countries, countryList: a.cs ?? [], devices: a.devices, windowHours: hours },
      };
    }
    case 'rapid_page_requests': {
      const mins = clamp(p.windowMinutes, 60, 1, 1440);
      const need = clamp(p.requests, 600, 50, 100000);
      const r = await q<{ n: number }[]>`
        select count(*)::int as n from access_log
        where user_id = ${userId} and at >= ${new Date(now - mins * 60_000)}
          and action in ('meta', 'pdf', 'page', 'view', 'print', 'download')`;
      const n = r[0]?.n ?? 0;
      if (n <= need) return null;   // "more than 600 viewer requests in an hour"
      return {
        windowSeconds: mins * 60,
        summary: `Your account made ${n} sheet-viewer requests within ${mins} minutes, far more than reading needs.`,
        evidence: { requests: n, windowMinutes: mins },
      };
    }
    default:
      return null;   // manual_report and rules without code are never evaluated
  }
}

const EVIDENCE_COUNTS = ['devices', 'networks', 'countries', 'requests'] as const;

/** Does this hit show more than the evidence staff decided on (more devices, networks, …)? */
function goesBeyond(now: Record<string, unknown>, decided: Record<string, unknown> | null): boolean {
  return EVIDENCE_COUNTS.some((k) => {
    const a = now[k], b = decided?.[k];
    return typeof a === 'number' && a > (typeof b === 'number' ? b : 0);
  });
}

type Upserted = { id: number; created: boolean; followUp: boolean };

/** Opens a new incident for this hit, or refreshes the one still open for the same pattern.
 *  An incident staff already decided on is never changed (its evidence is what they decided on):
 *  the same activity carrying on stays with it, and activity beyond its evidence opens a new
 *  follow-up incident for staff to look at. Returns its id, whether it is new and whether it is a
 *  follow-up. */
async function upsertIncident(q: Tx, ctx: Ctx | null, rule: RuleRow, userId: string, hit: Hit): Promise<Upserted> {
  const win = hit.windowSeconds * 1000;
  const now = Date.now();
  const bucket = Math.floor(now / win) * win;
  const evidence = { summary: hit.summary, rule: rule.id, ...hit.evidence, observedAt: new Date(now).toISOString() };
  // still the same pattern (also when it crosses a bucket edge)
  const recent = await q<{ id: number; status: string; evidence: Record<string, unknown> | null }[]>`
    select id, status, evidence from security_incidents
    where user_id = ${userId} and rule_id = ${rule.id}
      and created_at >= ${new Date(bucket - win)} and last_seen_at >= ${new Date(now - win)}
    order by id desc limit 1`;
  const prior = recent[0];
  if (prior?.status === 'open') {
    await q`update security_incidents set last_seen_at = now(), evidence = ${q.json(evidence as never)} where id = ${prior.id}`;
    return { id: prior.id, created: false, followUp: false };
  }
  let dedupe = `${rule.id}:${userId}:${new Date(bucket).toISOString()}`;
  if (prior) {
    if (!goesBeyond(hit.evidence, prior.evidence)) {
      // what staff decided on, carrying on: the decision and its evidence stand
      await q`update security_incidents set last_seen_at = now() where id = ${prior.id}`;
      return { id: prior.id, created: false, followUp: false };
    }
    dedupe = `${dedupe}:after:${prior.id}`;
  }
  const ins = await q<{ id: number; created: boolean }[]>`
    insert into security_incidents (user_id, rule_id, dedupe_key, evidence)
    values (${userId}, ${rule.id}, ${dedupe}, ${q.json(evidence as never)})
    on conflict (dedupe_key) do update set last_seen_at = now(), evidence = excluded.evidence
      where security_incidents.status = 'open'
    returning id, (xmax::text = '0') as created`;
  if (!ins[0]) {
    // this bucket's incident was decided already: leave it exactly as staff left it
    const ex = await q<{ id: number }[]>`select id from security_incidents where dedupe_key = ${dedupe}`;
    return { id: ex[0].id, created: false, followUp: false };
  }
  const inc = { id: ins[0].id, created: ins[0].created, followUp: !!prior };
  if (inc.created) {
    await auditAs(q, ctx, null, {
      action: 'security.incident_open', targetType: 'security_incident', targetId: inc.id,
      detail: { userId, rule: rule.id, summary: hit.summary, ...(prior ? { after: prior.id, afterStatus: prior.status } : {}) },
    });
    await secEvent(q, ctx, userId, 'security.incident_opened', { incidentId: inc.id, rule: rule.id, ...(prior ? { after: prior.id } : {}) });
    const who = await q<{ email: string }[]>`select email from profiles where id = ${userId}`;
    await notify(q, {
      audience: 'staff', kind: 'security.incident',
      title: `${prior ? 'More sharing after a decision' : 'Possible account sharing'}: ${who[0]?.email ?? userId}`,
      body: `${rule.name}. ${hit.summary}` + (prior ? ` Incident #${prior.id} was ${prior.status}; this is new activity beyond what it showed.` : ''),
      link: '/admin', data: { userId, incidentId: inc.id, rule: rule.id, ...(prior ? { after: prior.id } : {}) },
    });
  }
  return inc;
}

async function isActiveStaff(q: Tx, userId: string): Promise<boolean> {
  const r = await q<{ active: boolean }[]>`select active from staff_members where user_id = ${userId}`;
  return !!r[0]?.active;
}

async function evaluate(ctx: Ctx | null, userId: string): Promise<{ ids: number[]; warned: boolean }> {
  return await tx(async (q) => {
    // one evaluation per customer at a time, so a burst of requests cannot open twin incidents
    await q`select pg_advisory_xact_lock(hashtext(${'lww-rules:' + userId}))`;
    const who = await q<{ id: string }[]>`select id from profiles where id = ${userId}`;
    if (!who[0] || await isActiveStaff(q, userId)) return { ids: [], warned: false };
    const rules = await q<RuleRow[]>`
      select id, name, auto_confirm, params from security_rules
      where enabled and id <> 'manual_report' order by id`;
    const ids: number[] = [];
    let warned = false;
    for (const rule of rules) {
      try {
        await q.savepoint(async (sq) => {
          const hit = await detect(sq, rule, userId);
          if (!hit) return;
          const inc = await upsertIncident(sq, ctx, rule, userId, hit);
          ids.push(inc.id);
          // Signals require staff review; they never prove account sharing.

        });
      } catch (e) {
        console.error('[sharing] rule failed', rule.id, (e as Error)?.message ?? e);
      }
    }
    return { ids, warned };
  });
}

/** Runs the enabled security_rules for one customer and opens/updates incidents (deduplicated).
 *  Auto-confirming rules issue warnings. Returns the ids of incidents opened or updated. Never
 *  throws for rule problems (logs them). Staff accounts are skipped. */
export async function evaluateRules(ctx: Ctx | null, userId: string): Promise<number[]> {
  if (!UUID_RE.test(userId)) return [];
  try {
    const r = await evaluate(ctx, userId);
    if (r.warned && ctx) kickOutbox(ctx);
    return r.ids;
  } catch (e) {
    console.error('[sharing] rules not evaluated:', (e as Error)?.message ?? e);
    return [];
  }
}

/** For busy routes (the viewer): evaluates at most once a minute per customer unless forced.
 *  Meant for ctx.later; never throws. */
export async function maybeEvaluateRules(ctx: Ctx, userId: string, o: { force?: boolean } = {}): Promise<void> {
  try {
    if (!o.force) {
      const r = await tx((q) => q<{ ok: boolean }[]>`select private.rate_limit_hit(${'rules:' + userId}, 1, 60) as ok`);
      if (!r[0]?.ok) return;
    }
    await evaluateRules(ctx, userId);
  } catch (e) {
    console.error('[sharing] rules not evaluated:', (e as Error)?.message ?? e);
  }
}

// ── warnings and suspension ────────────────────────────────────────────────────────────────

export type WarningResult = { warningId: number; level: number; active: number; max: number; suspended: boolean };

/** Issues the warning for a confirmed incident (at most one per incident), emails the customer,
 *  alerts staff (email + notification), and suspends paid access at the limit. Null when the
 *  incident already has a warning. */
export async function issueWarning(q: Tx, ctx: Ctx | null, o: { userId: string; incidentId: number; reason: string; issuedBy: string | null }): Promise<WarningResult | null> {
  const settings = await getSettings(q);
  const max = maxWarningsOf(settings);
  // the profile lock serialises warnings for one customer, so levels never collide
  const prof = await q<{ email: string; name: string; suspended_at: Date | null }[]>`
    select email, name, subscription_suspended_at as suspended_at from profiles where id = ${o.userId} for update`;
  const p = prof[0];
  if (!p) throw new HttpError(404, 'Not found');
  if ((await q`select 1 from account_warnings where incident_id = ${o.incidentId}`).length) return null;

  const before = (await q<{ n: number }[]>`select private.active_warning_count(${o.userId}::uuid) as n`)[0]?.n ?? 0;
  const level = Math.min(20, before + 1);
  const days = clamp(settings.security.warningExpiryDays, 365, 1, 3650);
  const reason = cleanText(o.reason, 500) || 'Signs that this account is used by more than one person.';
  const by = o.issuedBy && UUID_RE.test(o.issuedBy) ? o.issuedBy : null;
  const ins = await q<{ id: number }[]>`
    insert into account_warnings (user_id, incident_id, level, reason, issued_by, expires_at)
    values (${o.userId}, ${o.incidentId}, ${level}, ${reason}, ${by}, now() + make_interval(days => ${days}))
    on conflict (incident_id) do nothing
    returning id`;
  if (!ins[0]) return null;
  const warningId = ins[0].id;
  const active = before + 1;

  const alreadyPaused = !!p.suspended_at;
  let pausedNow = false;
  if (!alreadyPaused && active >= max && settings.security.autoSuspend) {
    await suspendAccess(q, ctx, o.userId, { reason: 'warnings', by, note: `${active} active warnings` });
    pausedNow = true;
  }
  const suspended = alreadyPaused || pausedNow;

  const mail = securityWarning({ name: p.name || 'there', level, max, reason, pausedNow, alreadyPaused });
  await enqueue(q, {
    template: 'security_warning', to: p.email, userId: o.userId, subject: mail.subject, html: mail.html, text: mail.text,
    dedupeKey: `warning:${warningId}`, relatedType: 'account_warning', relatedId: warningId,
  });
  const alert = staffAlert({
    title: `Security warning ${level} of ${max} for ${p.email}`,
    lines: [
      `Customer: ${p.name || '(no name)'} <${p.email}>`,
      `Reason: ${reason}`,
      `Active warnings: ${active} of ${max}.`,
      suspended ? 'Paid access is suspended.' : 'Paid access is still open.',
      by ? 'Issued by staff.' : 'Issued automatically by a sharing rule.',
    ],
    link: siteLink('/admin'),
  });
  await alertStaff(q, settings, alert, `warning-staff:${warningId}`, { type: 'account_warning', id: warningId });
  await notify(q, {
    audience: 'customer', userId: o.userId, kind: 'security.warning', title: `Security warning ${level} of ${max}`,
    body: reason + (suspended ? ' Access to paid sheets is paused.' : ''), data: { warningId, level, max, suspended },
  });
  await notify(q, {
    audience: 'staff', kind: 'security.warning', title: `Warning ${level}/${max}: ${p.email}`, body: reason, link: '/admin',
    data: { userId: o.userId, warningId, incidentId: o.incidentId, level, active, suspended },
  });
  await auditAs(q, ctx, by, {
    action: 'security.warning_issue', targetType: 'account_warning', targetId: warningId,
    detail: { userId: o.userId, incidentId: o.incidentId, level, active, max, suspended },
  });
  await secEvent(q, ctx, o.userId, 'security.warning', { warningId, incidentId: o.incidentId, level, active, max });
  return { warningId, level, active, max, suspended };
}

type IncidentRow = { id: number; user_id: string; rule_id: string; status: 'open' | 'confirmed' | 'dismissed'; evidence: Record<string, unknown> | null; rule_name: string };

function requireStaffCtx(ctx: Ctx): AuthedUser {
  const u = ctx.user;
  if (!u?.staff) throw new HttpError(403, 'Your staff role does not allow this.', { code: 'forbidden' });
  return u;
}

async function lockIncident(q: Tx, incidentId: number): Promise<IncidentRow> {
  if (!Number.isSafeInteger(incidentId) || incidentId <= 0) throw new HttpError(404, 'Not found');
  const r = await q<IncidentRow[]>`
    select i.id, i.user_id, i.rule_id, i.status, i.evidence, r.name as rule_name
    from security_incidents i join security_rules r on r.id = i.rule_id
    where i.id = ${incidentId}
    for update of i`;
  if (!r[0]) throw new HttpError(404, 'Not found');
  return r[0];
}

function decided(status: string): HttpError {
  return status === 'confirmed'
    ? new HttpError(409, 'This incident was already confirmed.', { code: 'already_confirmed' })
    : new HttpError(409, 'This incident was already dismissed.', { code: 'already_dismissed' });
}

const STAFF_ACCOUNT = () => new HttpError(409, 'Staff accounts are not checked by the sharing rules.', { code: 'staff_account' });

/** Staff confirm an open incident → one warning. 404/409 errors as HttpError. */
export async function confirmIncident(ctx: Ctx, incidentId: number, note?: string | null): Promise<{ incidentId: number; warning: WarningResult | null }> {
  const staff = requireStaffCtx(ctx);
  const why = note ? cleanText(note, 1000) || null : null;
  const out = await tx(async (q) => {
    const inc = await lockIncident(q, incidentId);
    if (inc.status !== 'open') throw decided(inc.status);
    if (await isActiveStaff(q, inc.user_id)) throw STAFF_ACCOUNT();
    await q`
      update security_incidents set status = 'confirmed', decided_at = now(), decided_by = ${staff.id}, decision_note = ${why}
      where id = ${inc.id}`;
    await audit(ctx, { action: 'security.incident_confirm', targetType: 'security_incident', targetId: inc.id, detail: { userId: inc.user_id, rule: inc.rule_id, note: why } }, q);
    await secEvent(q, ctx, inc.user_id, 'security.incident_confirmed', { incidentId: inc.id, by: staff.id });
    const summary = typeof inc.evidence?.summary === 'string' ? inc.evidence.summary : '';
    const reason = summary || inc.rule_name;
    const warning = await issueWarning(q, ctx, { userId: inc.user_id, incidentId: inc.id, reason, issuedBy: staff.id });
    return { incidentId: inc.id, warning };
  });
  kickOutbox(ctx);
  return out;
}

export async function dismissIncident(ctx: Ctx, incidentId: number, note?: string | null): Promise<{ incidentId: number }> {
  const staff = requireStaffCtx(ctx);
  const why = note ? cleanText(note, 1000) || null : null;
  return await tx(async (q) => {
    const inc = await lockIncident(q, incidentId);
    if (inc.status !== 'open') throw decided(inc.status);
    await q`
      update security_incidents set status = 'dismissed', decided_at = now(), decided_by = ${staff.id}, decision_note = ${why}
      where id = ${inc.id}`;
    await audit(ctx, { action: 'security.incident_dismiss', targetType: 'security_incident', targetId: inc.id, detail: { userId: inc.user_id, rule: inc.rule_id, note: why } }, q);
    await secEvent(q, ctx, inc.user_id, 'security.incident_dismissed', { incidentId: inc.id, by: staff.id });
    return { incidentId: inc.id };
  });
}

/** Staff report a violation by hand (rule manual_report). confirm=true issues the warning now. */
export async function reportViolation(ctx: Ctx, userId: string, o: { reason: string; evidence?: Record<string, unknown>; confirm: boolean }): Promise<{ incidentId: number; warning: WarningResult | null; repeat?: boolean }> {
  const staff = requireStaffCtx(ctx);
  if (!UUID_RE.test(String(userId))) throw new HttpError(404, 'Not found');
  const reason = cleanText(o.reason, 500);
  if (reason.length < 3) throw new HttpError(400, 'Say what was seen (3 to 500 characters).', { errors: { reason: 'Say what was seen (3 to 500 characters).' } });
  let detail: Record<string, unknown> | null = null;
  if (o.evidence !== undefined && o.evidence !== null) {
    const raw = JSON.stringify(o.evidence);
    if (typeof o.evidence !== 'object' || Array.isArray(o.evidence) || raw.length > 4000) {
      throw new HttpError(400, 'Evidence must be a small JSON object.', { errors: { evidence: 'Evidence must be a small JSON object (4 KB at most).' } });
    }
    detail = o.evidence;
  }
  const out = await tx(async (q) => {
    const p = await q`select 1 from profiles where id = ${userId}`;
    if (!p.length) throw new HttpError(404, 'Not found');
    if (await isActiveStaff(q, userId)) throw STAFF_ACCOUNT();
    // one report at a time per customer, and the same report again within a few minutes (a double
    // click, a retry after a slow answer) is the same violation: it returns the first incident
    // instead of opening a second one and issuing a second warning
    await q`select pg_advisory_xact_lock(hashtext(${'lww-report:' + userId}))`;
    const same = await q<{ id: number; status: string }[]>`
      select id, status from security_incidents
      where user_id = ${userId} and rule_id = 'manual_report' and evidence ->> 'summary' = ${reason}
        and created_at > now() - make_interval(mins => ${REPORT_REPEAT_MINUTES})
      order by id desc limit 1`;
    if (same[0]) {
      const incidentId = same[0].id;
      if (o.confirm && same[0].status === 'open') {
        await q`
          update security_incidents set status = 'confirmed', decided_at = now(), decided_by = ${staff.id},
            decision_note = 'Reported and confirmed by staff.'
          where id = ${incidentId}`;
        await audit(ctx, { action: 'security.incident_confirm', targetType: 'security_incident', targetId: incidentId, detail: { userId, rule: 'manual_report', repeatReport: true } }, q);
        return { incidentId, warning: await issueWarning(q, ctx, { userId, incidentId, reason, issuedBy: staff.id }), repeat: true };
      }
      return { incidentId, warning: await warningOf(q, incidentId), repeat: true };
    }
    const evidence = { summary: reason, rule: 'manual_report', reportedBy: staff.id, ...(detail ? { detail } : {}) };
    const ins = await q<{ id: number }[]>`
      insert into security_incidents (user_id, rule_id, status, dedupe_key, evidence, decided_at, decided_by, decision_note)
      values (${userId}, 'manual_report', ${o.confirm ? 'confirmed' : 'open'}, ${`manual_report:${userId}:${crypto.randomUUID()}`},
              ${q.json(evidence as never)}, ${o.confirm ? new Date() : null}, ${o.confirm ? staff.id : null},
              ${o.confirm ? 'Reported and confirmed by staff.' : null})
      returning id`;
    const incidentId = ins[0].id;
    await audit(ctx, { action: 'security.report', targetType: 'security_incident', targetId: incidentId, detail: { userId, reason, confirm: o.confirm } }, q);
    await secEvent(q, ctx, userId, 'security.incident_reported', { incidentId, by: staff.id, confirm: o.confirm });
    const warning = o.confirm ? await issueWarning(q, ctx, { userId, incidentId, reason, issuedBy: staff.id }) : null;
    return { incidentId, warning, repeat: false };
  });
  kickOutbox(ctx);
  return out;
}

/** The same report again within this many minutes counts as the first one. */
const REPORT_REPEAT_MINUTES = 10;

/** The warning an incident already gave, in issueWarning's shape (null when it gave none). */
async function warningOf(q: Tx, incidentId: number): Promise<WarningResult | null> {
  const w = await q<{ id: number; level: number; user_id: string; suspended: boolean }[]>`
    select w.id, w.level, w.user_id, p.subscription_suspended_at is not null as suspended
    from account_warnings w join profiles p on p.id = w.user_id
    where w.incident_id = ${incidentId}`;
  if (!w[0]) return null;
  const active = (await q<{ n: number }[]>`select private.active_warning_count(${w[0].user_id}::uuid) as n`)[0]?.n ?? 0;
  return { warningId: w[0].id, level: w[0].level, active, max: maxWarningsOf(await getSettings(q)), suspended: w[0].suspended };
}

/** Suspends paid access (profiles.subscription_suspended_at). False when already suspended. */
export async function suspendAccess(q: Tx, ctx: Ctx | null, userId: string, o: { reason: 'warnings' | 'staff'; by: string | null; note?: string | null }): Promise<boolean> {
  if (o.reason !== 'warnings' && o.reason !== 'staff') throw new Error('suspendAccess: bad reason');
  const by = o.by && UUID_RE.test(o.by) ? o.by : null;
  const note = o.note ? cleanText(o.note, 300) || null : null;
  const rows = await q<{ email: string; name: string; at: Date }[]>`
    update profiles set subscription_suspended_at = now(), suspension_reason = ${o.reason}, suspended_by = ${by}
    where id = ${userId} and subscription_suspended_at is null
    returning email, name, subscription_suspended_at as at`;
  const p = rows[0];
  if (!p) return false;
  await auditAs(q, ctx, by, { action: 'access.suspend', targetType: 'profile', targetId: userId, detail: { reason: o.reason, note } });
  await secEvent(q, ctx, userId, 'access.suspended', { reason: o.reason, by, note });
  await notify(q, {
    audience: 'customer', userId, kind: 'access.suspended', title: 'Access to paid sheets is paused',
    body: 'You can still sign in, see your orders and open free sheets. Send us a note from My Account → Security if you think this is a mistake.',
    data: { reason: o.reason },
  });
  await notify(q, {
    audience: 'staff', kind: 'access.suspended', title: `Paid access suspended: ${p.email}`,
    body: o.reason === 'warnings' ? 'Reached the warning limit.' : `Suspended by staff${note ? `: ${note}` : '.'}`,
    link: '/admin', data: { userId, reason: o.reason, by },
  });
  if (o.reason === 'staff') {
    // the warnings path tells the customer in the warning email itself
    const mail = accessPausedEmail(p.name || 'there');
    await enqueue(q, {
      template: 'access_suspended', to: p.email, userId, subject: mail.subject, html: mail.html, text: mail.text,
      dedupeKey: `suspended:${userId}:${new Date(p.at).getTime()}`, relatedType: 'profile', relatedId: userId,
    });
  }
  return true;
}

/** Lifts a suspension; resetWarnings also revokes the active warnings. Emails the customer. */
export async function liftSuspension(q: Tx, ctx: Ctx, userId: string, o: { resetWarnings: boolean; note?: string | null }): Promise<boolean> {
  const by = ctx.user?.id ?? null;
  const note = o.note ? cleanText(o.note, 300) || null : null;
  const prof = await q<{ email: string; name: string; at: Date | null; reason: string | null }[]>`
    select email, name, subscription_suspended_at as at, suspension_reason as reason from profiles where id = ${userId} for update`;
  const p = prof[0];
  if (!p) throw new HttpError(404, 'Not found');
  if (o.resetWarnings) {
    const why = `Reset by staff when access was restored${note ? `: ${note}` : ''}`.slice(0, 300);
    const reset = await q<{ id: number }[]>`
      update account_warnings set revoked_at = now(), revoked_by = ${by}, revoke_reason = ${why}
      where user_id = ${userId} and revoked_at is null and (expires_at is null or expires_at > now())
      returning id`;
    if (reset.length) {
      await auditAs(q, ctx, by, { action: 'security.warnings_reset', targetType: 'profile', targetId: userId, detail: { count: reset.length, warnings: reset.map((r) => r.id), note } });
      await secEvent(q, ctx, userId, 'security.warnings_reset', { count: reset.length, by });
    }
  }
  if (!p.at) return false;
  await q`
    update profiles set subscription_suspended_at = null, suspension_reason = null, suspended_by = null
    where id = ${userId}`;
  await auditAs(q, ctx, by, { action: 'access.restore', targetType: 'profile', targetId: userId, detail: { previousReason: p.reason, resetWarnings: o.resetWarnings, note } });
  await secEvent(q, ctx, userId, 'access.restored', { by, resetWarnings: o.resetWarnings });
  await notify(q, { audience: 'customer', userId, kind: 'access.restored', title: 'Your paid sheets open again', data: { resetWarnings: o.resetWarnings } });
  const mail = accessRestored({ name: p.name || 'there' });
  await enqueue(q, {
    template: 'access_restored', to: p.email, userId, subject: mail.subject, html: mail.html, text: mail.text,
    dedupeKey: `restored:${userId}:${new Date(p.at).getTime()}`, relatedType: 'profile', relatedId: userId,
  });
  return true;
}
