// Staff commerce: orders, refunds, payments and the webhook log, access records (grant, revoke,
// extend), plans, rates, coupons and site settings.
// Access only ever comes from a verified payment (services/fulfil.ts) or from an explicit, audited
// staff grant with an end date: staff can never mark an order paid here. A refund recorded here
// is one already made in the gateway's dashboard; no money moves from this API.
// Old shapes from backend/src/routes/admin.cjs are kept; every write is audited (before/after)
// in the same transaction.
import type { Router } from '../lib/router.ts';
import type { Ctx } from '../lib/context.ts';
import { isUnique, tx, type Tx } from '../lib/db.ts';
import { HttpError, intParam, readJson } from '../lib/http.ts';
import { hasPermission, requireStaff } from '../lib/auth.ts';
import { analytics, audit, notify } from '../lib/guard.ts';
import { clearSettingsCache, getSettings, type Settings } from '../lib/settings.ts';
import { enqueue, kickOutbox } from '../lib/mail.ts';
import { cleanName, cleanText, fmtDateTime, fmtMoney, fromMinor, normEmail, UNSUPPORTED_CURRENCIES, validEmail } from '../lib/util.ts';
import { pubEntitlement, type EntRow } from '../services/entitlements.ts';
import { orderRefunded } from '../services/emails.ts';
import { accessDaysFor, accessHoursFor, MAX_ACCESS_HOURS, PAYMENT_METHODS } from '../services/pricing.ts';
import { MAX_SESSION_DAYS } from '../services/accounts.ts';

const ORDER_ID_RE = /^LWO-[A-Z0-9]{6,16}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PRODUCT_RE = /^[A-Za-z0-9][A-Za-z0-9-]{1,63}$/;
const CLASS_RE = /^[a-z0-9]{1,12}$/;
const PLAN_RE = /^[a-z0-9]{1,8}$/;
const COUPON_RE = /^[A-Za-z0-9_-]{3,32}$/;
const CURRENCY_RE = /^[A-Z]{3}$/;
const ORDER_STATUSES = ['created', 'paid', 'failed', 'cancelled', 'refunded', 'expired'] as const;
const PROVIDER_LABEL: Record<string, string> = { razorpay: 'Razorpay', stripe: 'Stripe', paypal: 'PayPal' };
const DAY = 86_400_000;
const MAX_GRANT_DAYS = 3650;

const NO_ORDER = 'No such order.';
const NO_ACCESS = 'No such access record.';
const FORBIDDEN = 'Your staff role does not allow this.';
const USE_GATEWAY = 'Orders become paid only through a verified payment. To give access without a payment, use Grant access (it needs an end date).';

const ms = (d: Date | string | null | undefined) => (d == null ? null : new Date(d).getTime());
const iso = (d: Date | string | null | undefined) => (d == null ? null : new Date(d).toISOString());
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const has = (b: Record<string, unknown>, ...keys: string[]) => keys.find((k) => b[k] !== undefined);

const forbidden = (permission: string, message = FORBIDDEN) => new HttpError(403, message, { code: 'forbidden', permission });
const invalid = (errors: Record<string, string>, message?: string, extra: Record<string, unknown> = {}) =>
  new HttpError(400, message ?? Object.values(errors)[0], { errors, ...extra });
const notFound = (message = 'Not found') => new HttpError(404, message, { code: 'not_found' });

function needPermission(ctx: Ctx, perm: string, message?: string) {
  if (!hasPermission(ctx.user!.staff, perm)) throw forbidden(perm, message);
}

/** A reason staff must give for changes to someone's access or money (kept in the audit log). */
function reasonOf(v: unknown): string {
  const r = cleanText(v, 300);
  if (r.length < 3) throw invalid({ reason: 'Say why (at least 3 characters) — it goes in the audit log.' });
  if (r.length > 200) throw invalid({ reason: 'Keep the reason under 200 characters.' });
  return r;
}

/** Whole number in range from a number or numeric string; null when missing. Throws on bad input. */
function intOf(v: unknown, field: string, min: number, max: number, label: string): number | null {
  if (v === undefined || v === null || v === '') return null;
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^\s*-?\d{1,9}\s*$/.test(v) ? Number(v) : NaN;
  if (!Number.isInteger(n) || n < min || n > max) throw invalid({ [field]: `${label} must be a whole number from ${min} to ${max}.` });
  return n;
}

/** A finite number with up to `dp` decimals in [min, max] (exclusive min when `gt`). */
function numOk(v: unknown, min: number, max: number, dp = 6, gt = false): v is number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return false;
  if (gt ? v <= min : v < min) return false;
  if (v > max) return false;
  const f = Math.pow(10, dp);
  return Math.abs(Math.round(v * f) - v * f) < 1e-6;
}

/** A date from an ISO string, a date-only string or epoch ms. Undefined/'' → null. */
function dateOf(v: unknown, field: string): Date | null {
  if (v === undefined || v === null || v === '') return null;
  let d: Date;
  if (typeof v === 'number') d = new Date(v);
  else if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}([T ][\d:.]+(Z|[+-]\d{2}:?\d{2})?)?$/.test(v.trim())) d = new Date(v.trim());
  else if (typeof v === 'string' && /^\d{10,14}$/.test(v.trim())) d = new Date(Number(v.trim()));
  else throw invalid({ [field]: 'Use a date like 2027-03-31 or 2027-03-31T18:30:00Z.' });
  if (!Number.isFinite(d.getTime()) || d.getUTCFullYear() < 2000 || d.getUTCFullYear() > 2100) {
    throw invalid({ [field]: 'Use a real date between 2000 and 2100.' });
  }
  return d;
}

const likePattern = (s: string) => '%' + s.replace(/[\\%_]/g, (c) => '\\' + c) + '%';

// ── orders ───────────────────────────────────────────────────────────────────────────────

type OrderRow = {
  id: string; user_id: string; kind: string; status: string; currency: string; rate: number; total: number;
  total_inr: number; discount_inr: number; amount_minor: number; coupon_code: string | null; address: unknown;
  country: string | null; method: string; gateway_mode: string | null; gateway_order_id: string | null;
  gateway_payment_id: string | null; failure_reason: string | null; created_at: Date; updated_at: Date;
  paid_at: Date | null; cancelled_at: Date | null; refunded_at: Date | null; refunded_by: string | null;
  staff_note: string | null; price_lines: unknown; email: string; name: string;
};

type ItemRow = {
  id: number; order_id: string; kind: 'worksheet' | 'class'; product_id: string | null; class_id: string | null;
  plan_id: string | null; title: string; months: number | null; access_days: number | null; access_hours: number | null; unit_price_inr: number;
  discount_inr: number; product_class: string | null; price_inr: number | null;
  e_id: number | null; e_user_id: string | null; e_scope: 'worksheet' | 'class' | null; e_kind: 'free' | 'paid' | 'grant' | null;
  e_purchased_at: Date | null; e_starts_at: Date | null; e_expires_at: Date | null; e_revoked_at: Date | null;
};

type OrderFilter = {
  id?: string | null; status?: string | null; like?: string | null; from?: Date | null; to?: Date | null;
  userId?: string | null; method?: string | null; limit: number; offset: number;
};

async function findOrders(q: Tx, f: OrderFilter): Promise<OrderRow[]> {
  return await q<OrderRow[]>`
    select o.id, o.user_id, o.kind, o.status, o.currency, o.rate::float8 as rate, o.total::float8 as total,
           o.total_inr::float8 as total_inr, o.discount_inr::float8 as discount_inr, o.amount_minor,
           o.coupon_code::text as coupon_code, o.address, o.country, o.method, o.gateway_mode, o.gateway_order_id,
           o.gateway_payment_id, o.failure_reason, o.created_at, o.updated_at, o.paid_at, o.cancelled_at,
           o.refunded_at, o.refunded_by, o.staff_note, qt.payload -> 'priceLines' as price_lines,
           p.email::text as email, p.name
    from orders o
    join profiles p on p.id = o.user_id
    left join quotes qt on qt.id = o.quote_id
    where (${f.id ?? null}::text is null or o.id = ${f.id ?? null})
      and (${f.status ?? null}::text is null or o.status = ${f.status ?? null})
      and (${f.userId ?? null}::uuid is null or o.user_id = ${f.userId ?? null}::uuid)
      and (${f.method ?? null}::text is null or o.method = ${f.method ?? null})
      and (${f.from ?? null}::timestamptz is null or o.created_at >= ${f.from ?? null}::timestamptz)
      and (${f.to ?? null}::timestamptz is null or o.created_at < ${f.to ?? null}::timestamptz)
      and (${f.like ?? null}::text is null
           or o.id ilike ${f.like ?? null} or p.email::text ilike ${f.like ?? null} or p.name ilike ${f.like ?? null}
           or o.gateway_order_id ilike ${f.like ?? null} or o.gateway_payment_id ilike ${f.like ?? null}
           or o.coupon_code::text ilike ${f.like ?? null})
    order by o.created_at desc, o.id desc
    limit ${f.limit} offset ${f.offset}`;
}

async function countOrders(q: Tx, f: OrderFilter): Promise<number> {
  const r = await q<{ n: number }[]>`
    select count(*)::int as n
    from orders o join profiles p on p.id = o.user_id
    where (${f.status ?? null}::text is null or o.status = ${f.status ?? null})
      and (${f.userId ?? null}::uuid is null or o.user_id = ${f.userId ?? null}::uuid)
      and (${f.method ?? null}::text is null or o.method = ${f.method ?? null})
      and (${f.from ?? null}::timestamptz is null or o.created_at >= ${f.from ?? null}::timestamptz)
      and (${f.to ?? null}::timestamptz is null or o.created_at < ${f.to ?? null}::timestamptz)
      and (${f.like ?? null}::text is null
           or o.id ilike ${f.like ?? null} or p.email::text ilike ${f.like ?? null} or p.name ilike ${f.like ?? null}
           or o.gateway_order_id ilike ${f.like ?? null} or o.gateway_payment_id ilike ${f.like ?? null}
           or o.coupon_code::text ilike ${f.like ?? null})`;
  return r[0]?.n ?? 0;
}

/** Orders in the old admin shape (Order + email, name) plus lines with their access records. */
async function orderViews(q: Tx, orders: OrderRow[]) {
  if (!orders.length) return [];
  const ids = orders.map((o) => o.id);
  const items = await q<ItemRow[]>`
    select it.id, it.order_id, it.kind, it.product_id, it.class_id, it.plan_id, it.title, it.months, it.access_days, it.access_hours,
           it.unit_price_inr, it.discount_inr::float8 as discount_inr, pr.class_id as product_class, pr.price_inr,
           e.id as e_id, e.user_id as e_user_id, e.scope as e_scope, e.kind as e_kind, e.purchased_at as e_purchased_at,
           e.starts_at as e_starts_at, e.expires_at as e_expires_at, e.revoked_at as e_revoked_at
    from order_items it
    left join products pr on pr.id = it.product_id
    left join entitlements e on e.order_item_id = it.id
    where it.order_id = any(${ids}::text[])
    order by it.id`;
  const byOrder = new Map<string, ItemRow[]>();
  for (const it of items) byOrder.set(it.order_id, [...(byOrder.get(it.order_id) ?? []), it]);
  return orders.map((o) => {
    const its = byOrder.get(o.id) ?? [];
    const first = its[0];
    const lines = its.map((it) => {
      let entitlement: Record<string, unknown> | null = null;
      if (it.e_id !== null) {
        const e: EntRow = {
          id: it.e_id, user_id: it.e_user_id!, scope: it.e_scope!, product_id: it.product_id,
          class_id: it.e_scope === 'class' ? it.class_id : null, plan_id: it.plan_id, kind: it.e_kind!, order_id: o.id,
          purchased_at: it.e_purchased_at!, starts_at: it.e_starts_at!, expires_at: it.e_expires_at, revoked_at: it.e_revoked_at,
          revoke_reason: null,
        };
        const pub = pubEntitlement(e, it.e_scope === 'worksheet' ? it.price_inr : null);
        entitlement = { id: pub.id, purchasedAt: pub.purchasedAt, startsAt: pub.start, end: pub.end, expiresAt: pub.expiresAt, status: pub.status, active: pub.active };
      }
      return {
        kind: it.kind, worksheet: it.product_id, cls: it.class_id ?? it.product_class, plan: it.plan_id, title: it.title,
        months: it.months, accessDays: it.access_days, accessHours: it.access_hours, unitPriceInr: it.unit_price_inr, discountInr: it.discount_inr, entitlement,
      };
    });
    return {
      // the old admin order shape
      id: o.id,
      at: ms(o.created_at),
      kind: o.kind,
      cls: first ? (first.class_id ?? first.product_class) : null,
      plan: first?.plan_id ?? null,
      worksheet: first?.product_id ?? null,
      currency: o.currency,
      total: o.total,
      totalInr: o.total_inr,
      coupon: o.coupon_code,
      address: o.address ?? null,
      method: o.method,
      status: o.status,
      paidAt: ms(o.paid_at),
      gatewayOrderId: o.gateway_order_id,
      paymentId: o.gateway_payment_id,
      email: o.email,
      name: o.name,
      // new
      userId: o.user_id,
      lines,
      priceLines: Array.isArray(o.price_lines) ? o.price_lines : [],
      amountMinor: o.amount_minor,
      discountInr: o.discount_inr,
      rate: o.rate,
      country: o.country,
      gatewayMode: o.gateway_mode,
      failureReason: o.failure_reason,
      cancelledAt: ms(o.cancelled_at),
      refundedAt: ms(o.refunded_at),
      refundedBy: o.refunded_by,
      note: o.staff_note,
      updatedAt: ms(o.updated_at),
    };
  });
}

async function orderView(q: Tx, id: string) {
  const rows = await findOrders(q, { id, limit: 1, offset: 0 });
  return (await orderViews(q, rows))[0] ?? null;
}

/** GET /api/admin/orders?status=&q=&from=&to=&user=&method=&limit=&offset= (newest first). */
async function listOrders(ctx: Ctx) {
  await requireStaff(ctx, 'orders.read');
  const sp = ctx.query;
  const status = sp.get('status') || null;
  if (status && !(ORDER_STATUSES as readonly string[]).includes(status)) throw invalid({ status: 'Unknown status.' }, 'Unknown status.');
  const method = sp.get('method') || null;
  if (method && !(PAYMENT_METHODS as readonly string[]).includes(method)) throw invalid({ method: 'Unknown payment method.' });
  const user = sp.get('user') || null;
  if (user && !UUID_RE.test(user)) throw invalid({ user: 'Unknown customer id.' });
  const from = dateOf(sp.get('from'), 'from');
  let to = dateOf(sp.get('to'), 'to');
  // a date without a time means "up to the end of that day" (UTC)
  if (to && /^\d{4}-\d{2}-\d{2}$/.test((sp.get('to') ?? '').trim())) to = new Date(to.getTime() + DAY);
  const text = cleanText(sp.get('q'), 100);
  const limit = intParam(sp.get('limit'), 500, 1, 500);
  const offset = intParam(sp.get('offset'), 0, 0, 1_000_000);
  const f: OrderFilter = { status, method, userId: user, from, to, like: text ? likePattern(text) : null, limit, offset };
  const { orders, total } = await tx(async (q) => {
    const rows = await findOrders(q, f);
    return { orders: await orderViews(q, rows), total: await countOrders(q, f) };
  });
  return { orders, total, limit, offset, nextOffset: offset + orders.length < total ? offset + orders.length : null };
}

type PaymentRow = {
  id: number; order_id: string; provider: string; provider_payment_id: string; amount_minor: number; currency: string;
  status: string; source: string; created_at: Date; email?: string | null; order_total_inr?: number | null;
};

const paymentView = (p: PaymentRow) => ({
  id: p.id, orderId: p.order_id, provider: p.provider, paymentId: p.provider_payment_id, amountMinor: p.amount_minor,
  amount: fromMinor(p.amount_minor, p.currency), currency: p.currency, status: p.status,
  source: p.source, at: ms(p.created_at), email: p.email ?? null,
  // the order's total in rupees (the payment itself is in the customer's currency)
  ...(p.order_total_inr !== undefined ? { orderTotalInr: p.order_total_inr === null ? null : Number(p.order_total_inr) } : {}),
});

type EventRow = {
  id: number; provider: string; event_id: string | null; event_type: string; order_id: string | null; ok: boolean;
  status: string; signature_ok: boolean | null; detail: unknown; payload_sha256: string | null; received_at: Date;
  processed_at: Date | null;
};

const eventView = (e: EventRow) => ({
  id: e.id, provider: e.provider, eventId: e.event_id, type: e.event_type, event: e.event_type, orderId: e.order_id,
  ok: e.ok, status: e.status, signatureOk: e.signature_ok, detail: e.detail ?? null, payloadSha256: e.payload_sha256,
  at: ms(e.received_at), receivedAt: ms(e.received_at), processedAt: ms(e.processed_at),
});

type AdminEntRow = EntRow & {
  email: string; name: string; class_name: string | null; plan_label: string | null; revoked_by: string | null;
  granted_by: string | null; created_at: Date;
};

function adminEntitlement(e: AdminEntRow) {
  return {
    ...pubEntitlement(e, e.scope === 'worksheet' ? e.price_inr : null),
    // old admin fields
    email: e.email,
    revoked: ms(e.revoked_at),
    // new
    userId: e.user_id,
    name: e.name,
    className: e.class_name,
    planLabel: e.plan_label,
    revokedAt: ms(e.revoked_at),
    revokeReason: e.revoke_reason,
    revokedBy: e.revoked_by,
    grantedBy: e.granted_by,
    created: ms(e.created_at),
  };
}

const ENT_SELECT = (q: Tx) => q`
  select e.id, e.user_id, e.scope, e.product_id, e.class_id, e.plan_id, e.kind, e.order_id, e.purchased_at,
         e.starts_at, e.expires_at, e.revoked_at, e.revoke_reason, e.revoked_by, e.granted_by, e.created_at,
         p.email::text as email, p.name, pr.title, pr.price_inr, pr.class_id as product_class,
         c.name as class_name, pl.label as plan_label
  from entitlements e
  join profiles p on p.id = e.user_id
  left join products pr on pr.id = e.product_id
  left join classes c on c.id = coalesce(e.class_id, pr.class_id)
  left join plans pl on pl.id = e.plan_id`;

async function loadEntitlement(q: Tx, id: number): Promise<AdminEntRow | null> {
  const r = await q<AdminEntRow[]>`${ENT_SELECT(q)} where e.id = ${id}`;
  return r[0] ?? null;
}

/** GET /api/admin/orders/:id — the order, its lines, payments, gateway events and access records. */
async function getOrder(ctx: Ctx) {
  const u = await requireStaff(ctx, 'orders.read');
  const id = ctx.params.id ?? '';
  if (!ORDER_ID_RE.test(id)) throw notFound(NO_ORDER);
  const out = await tx(async (q) => {
    const order = await orderView(q, id);
    if (!order) throw notFound(NO_ORDER);
    const customer = (await q<{ id: string; email: string; name: string; blocked_at: Date | null; subscription_suspended_at: Date | null; time_zone: string | null }[]>`
      select id, email::text as email, name, blocked_at, subscription_suspended_at, time_zone from profiles where id = ${order.userId}`)[0];
    const payments = await q<PaymentRow[]>`
      select id, order_id, provider, provider_payment_id, amount_minor, currency, status, source, created_at
      from payments where order_id = ${id} order by id`;
    const events = await q<EventRow[]>`
      select id, provider, event_id, event_type, order_id, ok, status, signature_ok, detail, payload_sha256, received_at, processed_at
      from payment_events where order_id = ${id} order by received_at desc, id desc limit 200`;
    const ents = await q<AdminEntRow[]>`${ENT_SELECT(q)} where e.order_id = ${id} order by e.id`;
    const redemption = (await q<{ coupon_code: string; discount_inr: number; redeemed_at: Date }[]>`
      select coupon_code::text as coupon_code, discount_inr::float8 as discount_inr, redeemed_at
      from coupon_redemptions where order_id = ${id}`)[0] ?? null;
    const history = hasPermission(u.staff, 'audit.read')
      ? await q<{ at: Date; actor_email: string | null; actor_role: string | null; action: string; detail: unknown }[]>`
          select at, actor_email, actor_role, action, detail from audit_logs
          where target_type = 'order' and target_id = ${id} order by at desc, id desc limit 50`
      : null;
    return { order, customer, payments, events, ents, redemption, history };
  });
  return {
    order: out.order,
    customer: out.customer ? {
      id: out.customer.id, email: out.customer.email, name: out.customer.name, blocked: !!out.customer.blocked_at,
      accessStatus: out.customer.subscription_suspended_at ? 'suspended' : 'active', timeZone: out.customer.time_zone,
    } : null,
    payments: out.payments.map(paymentView),
    events: out.events.map(eventView),
    entitlements: out.ents.map(adminEntitlement),
    coupon: out.redemption ? { code: out.redemption.coupon_code, discountInr: out.redemption.discount_inr, redeemedAt: ms(out.redemption.redeemed_at) } : null,
    audit: out.history ? out.history.map((h) => ({ at: ms(h.at), actor: h.actor_email, role: h.actor_role, action: h.action, detail: h.detail })) : null,
  };
}

/** PUT /api/admin/orders {id, status?, note?} — only created → cancelled, and a staff note.
 *  'paid' is refused (use_gateway); 'refunded' goes through the refund endpoint. */
async function putOrder(ctx: Ctx) {
  await requireStaff(ctx, 'orders.write');
  const b = await readJson(ctx.req, 16 * 1024);
  const id = typeof b.id === 'string' ? b.id.trim() : '';
  const status = b.status === undefined || b.status === null || b.status === '' ? null : String(b.status);
  if (status !== null && !(ORDER_STATUSES as readonly string[]).includes(status)) throw new HttpError(400, 'Unknown status.', { errors: { status: 'Unknown status.' } });
  let note: string | null | undefined;
  if (b.note !== undefined) {
    if (b.note !== null && typeof b.note !== 'string') throw invalid({ note: 'The note must be text.' });
    if (typeof b.note === 'string' && b.note.length > 2000) throw invalid({ note: 'Keep the note under 2000 characters.' });
    note = b.note === null ? null : (cleanText(b.note, 2000) || null);
  }
  if (status === null && note === undefined) throw invalid({ status: 'Send a status or a note.' });

  if (!ORDER_ID_RE.test(id)) throw notFound(NO_ORDER);
  const order = await tx(async (q) => {
    const cur = (await q<{ id: string; status: string; staff_note: string | null }[]>`
      select id, status, staff_note from orders where id = ${id} for update`)[0];
    if (!cur) throw notFound(NO_ORDER);
    const nextStatus = status ?? cur.status;
    if (nextStatus !== cur.status) {
      if (nextStatus === 'paid') throw new HttpError(400, USE_GATEWAY, { code: 'use_gateway' });
      if (nextStatus === 'refunded') {
        throw new HttpError(400, 'Record a refund with the Refund action on the order (POST /api/admin/orders/:id/refund).', { code: 'use_refund' });
      }
      if (!(nextStatus === 'cancelled' && cur.status === 'created')) {
        throw new HttpError(409, `Only an unpaid order (status created) can be cancelled here; this one is ${cur.status}.`, { code: 'bad_transition', status: cur.status });
      }
    }
    const nextNote = note === undefined ? cur.staff_note : note;
    const before: Record<string, unknown> = {}, after: Record<string, unknown> = {};
    if (nextStatus !== cur.status) { before.status = cur.status; after.status = nextStatus; }
    if (nextNote !== cur.staff_note) { before.note = cur.staff_note; after.note = nextNote; }
    if (Object.keys(after).length) {
      if (nextStatus !== cur.status) {
        // the status check stops a payment that landed a moment ago from being undone
        const r = await q`
          update orders set status = 'cancelled', cancelled_at = now(), staff_note = ${nextNote}
          where id = ${id} and status = 'created' returning id`;
        if (!r.length) throw new HttpError(409, 'The order changed — reload it and try again.', { code: 'bad_transition' });
      } else {
        await q`update orders set staff_note = ${nextNote} where id = ${id}`;
      }
      await audit(ctx, { action: 'order.update', targetType: 'order', targetId: id, detail: { before, after } }, q);
    }
    return await orderView(q, id);
  });
  return { order };
}

/** POST /api/admin/orders/:id/refund {reason} — records a refund already made in the gateway's
 *  dashboard: the order becomes refunded and the access it bought ends now. No money moves. */
async function refundOrder(ctx: Ctx) {
  await requireStaff(ctx, 'orders.write');
  const id = ctx.params.id ?? '';
  const b = await readJson(ctx.req, 8 * 1024);
  if (!ORDER_ID_RE.test(id)) throw notFound(NO_ORDER);
  const reason = reasonOf(b.reason);
  const s = await getSettings();
  const out = await tx(async (q) => {
    const cur = (await q<{ status: string; user_id: string; method: string; total: number; total_inr: number; currency: string; email: string; name: string; time_zone: string | null }[]>`
      select o.status, o.user_id, o.method, o.total::float8 as total, o.total_inr::float8 as total_inr, o.currency,
             p.email::text as email, p.name, p.time_zone
      from orders o join profiles p on p.id = o.user_id where o.id = ${id} for update of o`)[0];
    if (!cur) throw notFound(NO_ORDER);
    if (cur.status === 'refunded') throw new HttpError(409, 'This order is already marked refunded.', { code: 'already_refunded' });
    const r = (await q<{ r: { status: string; reason?: string; revoked?: number } }[]>`
      select private.refund_order(${id}, ${ctx.user!.id}::uuid, ${reason}) as r`)[0].r;
    if (r.status !== 'refunded') {
      throw new HttpError(409, 'Only a paid order can be marked refunded.', { code: 'not_paid', status: cur.status });
    }
    const revoked = Number(r.revoked ?? 0);
    const label = PROVIDER_LABEL[cur.method] ?? cur.method;
    const total = fmtMoney(cur.total, cur.currency);
    const titles = (await q<{ title: string }[]>`select title from order_items where order_id = ${id} order by id`).map((t) => t.title);
    await audit(ctx, {
      action: 'order.refund', targetType: 'order', targetId: id,
      detail: { before: { status: cur.status }, after: { status: 'refunded' }, reason, revoked, provider: cur.method, recordedOnly: true, userId: cur.user_id },
    }, q);
    await analytics(q, null, { kind: 'refund', userId: cur.user_id, orderId: id, valueInr: cur.total_inr, meta: { provider: cur.method, source: 'staff' } });
    await notify(q, {
      audience: 'customer', userId: cur.user_id, kind: 'order.refunded', title: 'Order refunded',
      body: `Order ${id} (${total}) was refunded. Access bought with this order has ended.`, link: '/?account=orders', data: { orderId: id },
    });
    await notify(q, {
      audience: 'staff', kind: 'order.refunded', title: `Order ${id} marked refunded — ${total}`,
      body: `${ctx.user!.profile.email} recorded a ${label} refund: ${reason}. ${revoked} access record(s) ended.`,
      data: { orderId: id, provider: cur.method, revoked, by: ctx.user!.id },
    });
    const mail = orderRefunded({ name: cur.name || 'there', orderId: id, total, method: label, titles });
    await enqueue(q, {
      ...mail, template: 'order_refunded', to: cur.email, userId: cur.user_id, replyTo: s.contact.inbox,
      dedupeKey: `refund:${id}`, relatedType: 'order', relatedId: id,
    });
    return { order: await orderView(q, id), revoked, label };
  });
  kickOutbox(ctx);
  return {
    ok: true,
    order: out.order,
    revoked: out.revoked,
    recordedOnly: true,
    note: `Recorded. This marks a refund you already made in the ${out.label} dashboard — no money was moved by this action. Access bought with the order ended now.`,
  };
}

/** GET /api/admin/payments?order=&provider=&limit= — verified payments (old: { events }). */
async function listPayments(ctx: Ctx) {
  await requireStaff(ctx, ['orders.read', 'logs.read']);
  const order = ctx.query.get('order') || null;
  if (order && !ORDER_ID_RE.test(order)) throw invalid({ order: 'Unknown order id.' });
  const provider = ctx.query.get('provider') || null;
  if (provider && !(PAYMENT_METHODS as readonly string[]).includes(provider)) throw invalid({ provider: 'Unknown provider.' });
  const limit = intParam(ctx.query.get('limit'), 300, 1, 2000);
  const rows = await tx((q) => q<PaymentRow[]>`
    select pa.id, pa.order_id, pa.provider, pa.provider_payment_id, pa.amount_minor, pa.currency, pa.status, pa.source,
           pa.created_at, p.email::text as email, o.total_inr::float8 as order_total_inr
    from payments pa join orders o on o.id = pa.order_id join profiles p on p.id = o.user_id
    where (${order}::text is null or pa.order_id = ${order})
      and (${provider}::text is null or pa.provider = ${provider})
    order by pa.created_at desc, pa.id desc limit ${limit}`);
  const payments = rows.map(paymentView);
  return { payments, events: payments };
}

/** GET /api/admin/payment-events?provider=&ok=&order=&type=&limit= — the gateway/webhook log. */
async function listPaymentEvents(ctx: Ctx) {
  await requireStaff(ctx, ['logs.read', 'orders.read']);
  const sp = ctx.query;
  const provider = sp.get('provider') || null;
  if (provider && !(PAYMENT_METHODS as readonly string[]).includes(provider)) throw invalid({ provider: 'Unknown provider.' });
  const okRaw = sp.get('ok');
  const ok = okRaw === 'true' || okRaw === '1' ? true : okRaw === 'false' || okRaw === '0' ? false : null;
  const order = sp.get('order') || null;
  if (order && !ORDER_ID_RE.test(order)) throw invalid({ order: 'Unknown order id.' });
  const type = cleanText(sp.get('type'), 80) || null;
  const limit = intParam(sp.get('limit'), 300, 1, 2000);
  const rows = await tx((q) => q<EventRow[]>`
    select id, provider, event_id, event_type, order_id, ok, status, signature_ok, detail, payload_sha256, received_at, processed_at
    from payment_events
    where (${provider}::text is null or provider = ${provider})
      and (${ok}::boolean is null or ok = ${ok}::boolean)
      and (${order}::text is null or order_id = ${order})
      and (${type}::text is null or event_type = ${type})
    order by received_at desc, id desc limit ${limit}`);
  return { events: rows.map(eventView) };
}

// ── access records ───────────────────────────────────────────────────────────────────────

const ENT_STATUSES = ['active', 'scheduled', 'expired', 'revoked', 'lapsed'] as const;

/** GET /api/admin/entitlements?user=&email=&worksheet=&cls=&kind=&status=&order=&limit=&offset= */
async function listEntitlements(ctx: Ctx) {
  await requireStaff(ctx, ['orders.read', 'customers.read', 'entitlements.grant', 'entitlements.revoke']);
  const sp = ctx.query;
  const user = sp.get('user') || null;
  if (user && !UUID_RE.test(user)) throw invalid({ user: 'Unknown customer id.' });
  const email = sp.get('email') ? normEmail(sp.get('email')) : null;
  const worksheet = sp.get('worksheet') || null;
  if (worksheet && !PRODUCT_RE.test(worksheet)) throw invalid({ worksheet: 'Unknown worksheet.' });
  const cls = sp.get('cls') || null;
  if (cls && !CLASS_RE.test(cls)) throw invalid({ cls: 'Unknown class.' });
  const kind = sp.get('kind') || null;
  if (kind && !['free', 'paid', 'grant'].includes(kind)) throw invalid({ kind: 'Kind is free, paid or grant.' });
  const status = sp.get('status') || null;
  if (status && !(ENT_STATUSES as readonly string[]).includes(status)) throw invalid({ status: 'Unknown status.' });
  const order = sp.get('order') || null;
  if (order && !ORDER_ID_RE.test(order)) throw invalid({ order: 'Unknown order id.' });
  const limit = intParam(sp.get('limit'), 500, 1, 1000);
  const offset = intParam(sp.get('offset'), 0, 0, 1_000_000);
  const rows = await tx((q) => q<AdminEntRow[]>`
    ${ENT_SELECT(q)}
    where (${user}::uuid is null or e.user_id = ${user}::uuid)
      and (${email}::text is null or p.email::text = ${email}::text)
      and (${worksheet}::text is null or e.product_id = ${worksheet}::text)
      and (${cls}::text is null or e.class_id = ${cls}::text or pr.class_id = ${cls}::text)
      and (${kind}::text is null or e.kind = ${kind}::text)
      and (${order}::text is null or e.order_id = ${order}::text)
      and (${status}::text is null
           or (${status}::text = 'revoked' and e.revoked_at is not null)
           or (${status}::text = 'scheduled' and e.revoked_at is null and e.starts_at > now())
           or (${status}::text = 'expired' and e.revoked_at is null and e.starts_at <= now() and e.expires_at <= now())
           or (${status}::text in ('active', 'lapsed') and e.revoked_at is null and e.starts_at <= now()
               and (e.expires_at is null or e.expires_at > now())
               and ((e.kind = 'free' and coalesce(pr.price_inr, 0) > 0) = (${status}::text = 'lapsed'))))
    order by e.starts_at desc, e.id desc
    limit ${limit} offset ${offset}`);
  return { entitlements: rows.map(adminEntitlement), limit, offset };
}

/** End date for a grant or an extension: `until`, or `days` from `base`. */
function endFrom(b: Record<string, unknown>, base: Date): Date | null {
  const hasDays = b.days !== undefined && b.days !== null && b.days !== '';
  const hasUntil = b.until !== undefined && b.until !== null && b.until !== '';
  if (hasDays && hasUntil) throw invalid({ until: 'Give days or an end date, not both.' });
  const days = intOf(b.days, 'days', 1, MAX_GRANT_DAYS, 'Days');
  const until = dateOf(b.until, 'until');
  const end = until ?? (days !== null ? new Date(base.getTime() + days * DAY) : null);
  if (!end) return null;
  if (end.getTime() <= Date.now() + 60_000) throw invalid({ until: 'The end must be in the future.' });
  if (end.getTime() > Date.now() + MAX_GRANT_DAYS * DAY) throw invalid({ until: 'The end can be at most 10 years away.' });
  return end;
}

/** POST /api/admin/entitlements/grant {user|email, worksheet|cls, plan?, days?|until?, reason}
 *  (old: {email, scope, ref, plan}). Always kind 'grant' with an end date. */
async function grant(ctx: Ctx) {
  await requireStaff(ctx, 'entitlements.grant');
  const b = await readJson(ctx.req, 8 * 1024);
  // who
  const who = typeof b.user === 'string' ? b.user.trim() : typeof b.userId === 'string' ? b.userId.trim() : '';
  const email = normEmail(b.email ?? (who.includes('@') ? who : ''));
  const userId = who && !who.includes('@') ? who : null;
  if (userId && !UUID_RE.test(userId)) throw invalid({ user: 'Unknown customer id.' });
  if (!userId && !validEmail(email)) throw invalid({ email: 'Enter the customer\'s email address.' });
  // what
  let worksheet = typeof b.worksheet === 'string' ? b.worksheet.trim() : '';
  let cls = typeof b.cls === 'string' ? b.cls.trim() : '';
  if (!worksheet && !cls && typeof b.ref === 'string') {
    if (b.scope === 'class') cls = b.ref.trim(); else worksheet = b.ref.trim();
  }
  if (!!worksheet === !!cls) throw invalid({ worksheet: 'Pick one worksheet or one class.' });
  if (worksheet && !PRODUCT_RE.test(worksheet)) throw notFound('No such worksheet.');
  if (cls && !CLASS_RE.test(cls)) throw notFound('No such class.');
  const plan = typeof b.plan === 'string' && b.plan.trim() ? b.plan.trim() : null;
  if (plan && (!cls || !PLAN_RE.test(plan))) throw invalid({ plan: cls ? 'Unknown plan.' : 'A plan only goes with a class.' });
  const reason = reasonOf(b.reason);
  const end = endFrom(b, new Date());

  const out = await tx(async (q) => {
    const prof = (await q<{ id: string; email: string; name: string }[]>`
      select id, email::text as email, name from profiles
      where ${userId ? q`id = ${userId}::uuid` : q`email = ${email}::citext`}`)[0];
    if (!prof) throw notFound(userId ? 'No such customer.' : 'No customer with that email.');
    let months: number | null = null;
    if (worksheet) {
      const p = (await q<{ status: string }[]>`select status from products where id = ${worksheet}`)[0];
      if (!p) throw notFound('No such worksheet.');
      if (p.status === 'draft') throw new HttpError(400, 'This sheet is still a draft — put it on sale first.', { code: 'draft' });
    } else {
      if (!(await q`select 1 from classes where id = ${cls}`).length) throw notFound('No such class.');
      if (plan) {
        const pl = (await q<{ months: number }[]>`select months from plans where id = ${plan}`)[0];
        if (!pl) throw invalid({ plan: 'Unknown plan.' });
        months = pl.months;
      }
    }
    // an end date is required: days/until, or a class plan's own length
    if (!end && !months) throw invalid({ until: 'Give the access an end date (days or until).' }, undefined, { code: 'expiry_required' });
    const row = (await q<{ id: number }[]>`
      insert into entitlements (user_id, scope, product_id, class_id, plan_id, kind, purchased_at, starts_at, expires_at, granted_by)
      values (${prof.id}, ${worksheet ? 'worksheet' : 'class'}, ${worksheet || null}, ${cls || null}, ${plan}, 'grant',
              now(), now(), coalesce(${end}::timestamptz, now() + make_interval(months => ${months ?? 0})), ${ctx.user!.id})
      returning id`)[0];
    const e = (await loadEntitlement(q, row.id))!;
    await audit(ctx, {
      action: 'entitlement.grant', targetType: 'entitlement', targetId: row.id,
      detail: {
        before: null,
        after: { userId: prof.id, email: prof.email, scope: e.scope, worksheet: e.product_id, cls: e.class_id, plan: e.plan_id, kind: 'grant', startsAt: iso(e.starts_at), expiresAt: iso(e.expires_at) },
        reason,
      },
    }, q);
    await notify(q, {
      audience: 'customer', userId: prof.id, kind: 'access.granted', title: 'Access added',
      body: `${e.title ?? e.class_name ?? 'New access'} is open for you until ${fmtDateTime(e.expires_at!)}.`,
      link: '/?account=worksheets', data: { entitlementId: row.id },
    });
    return e;
  });
  return { ok: true, entitlement: adminEntitlement(out) };
}

/** POST /api/admin/entitlements/revoke {id, reason} → old { ok, revoked: 0|1 } plus the record. */
async function revoke(ctx: Ctx) {
  await requireStaff(ctx, 'entitlements.revoke');
  const b = await readJson(ctx.req, 8 * 1024);
  const id = intOf(b.id, 'id', 1, Number.MAX_SAFE_INTEGER, 'id');
  if (id === null) throw invalid({ id: 'Which access record?' });
  const reason = reasonOf(b.reason);
  const out = await tx(async (q) => {
    const cur = (await q<{ revoked_at: Date | null }[]>`select revoked_at from entitlements where id = ${id} for update`)[0];
    if (!cur) throw notFound(NO_ACCESS);
    if (cur.revoked_at) return { revoked: 0, e: (await loadEntitlement(q, id))! };
    await q`update entitlements set revoked_at = now(), revoked_by = ${ctx.user!.id}, revoke_reason = ${reason} where id = ${id}`;
    const e = (await loadEntitlement(q, id))!;
    await audit(ctx, {
      action: 'entitlement.revoke', targetType: 'entitlement', targetId: id,
      detail: { before: { revokedAt: null }, after: { revokedAt: iso(e.revoked_at) }, reason, userId: e.user_id, worksheet: e.product_id, cls: e.class_id, order: e.order_id },
    }, q);
    await notify(q, {
      audience: 'customer', userId: e.user_id, kind: 'access.revoked', title: 'Access ended',
      body: `${e.title ?? e.class_name ?? 'An access record'} was closed by Learn With Why. Write to us if you have questions.`,
      link: '/?account=worksheets', data: { entitlementId: id },
    });
    return { revoked: 1, e };
  });
  return { ok: true, revoked: out.revoked, entitlement: adminEntitlement(out.e) };
}

/** POST /api/admin/entitlements/:id/extend {days|until, reason} — a later end date. */
async function extend(ctx: Ctx) {
  await requireStaff(ctx, 'entitlements.grant');
  const raw = ctx.params.id ?? '';
  const id = /^\d{1,15}$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isSafeInteger(id) || id < 1) throw notFound(NO_ACCESS);
  const b = await readJson(ctx.req, 8 * 1024);
  const reason = reasonOf(b.reason);
  const out = await tx(async (q) => {
    const cur = (await q<{ expires_at: Date | null; revoked_at: Date | null; kind: string }[]>`
      select expires_at, revoked_at, kind from entitlements where id = ${id} for update`)[0];
    if (!cur) throw notFound(NO_ACCESS);
    if (cur.revoked_at) throw new HttpError(409, 'This access was revoked — grant new access instead.', { code: 'revoked' });
    if (!cur.expires_at) throw new HttpError(400, 'Free passes do not expire.', { code: 'free_pass' });
    // days count from the current end, or from now if it has already ended
    const base = new Date(Math.max(new Date(cur.expires_at).getTime(), Date.now()));
    const end = endFrom(b, base);
    if (!end) throw invalid({ days: 'Give the number of days to add, or the new end date.' }, undefined, { code: 'expiry_required' });
    if (end.getTime() <= new Date(cur.expires_at).getTime()) throw invalid({ until: 'Pick a date after the current end.' });
    await q`update entitlements set expires_at = ${end} where id = ${id}`;
    const e = (await loadEntitlement(q, id))!;
    await audit(ctx, {
      action: 'entitlement.extend', targetType: 'entitlement', targetId: id,
      detail: { before: { expiresAt: iso(cur.expires_at) }, after: { expiresAt: iso(end) }, reason, userId: e.user_id },
    }, q);
    await notify(q, {
      audience: 'customer', userId: e.user_id, kind: 'access.extended', title: 'Access extended',
      body: `${e.title ?? e.class_name ?? 'Your access'} is now open until ${fmtDateTime(end)}.`,
      link: '/?account=worksheets', data: { entitlementId: id },
    });
    return e;
  });
  return { ok: true, entitlement: adminEntitlement(out) };
}

// ── plans, coupons and class discounts ───────────────────────────────────────────────────

type PlanRow = { id: string; label: string; months: number; price_inr: number; discount_pct: number; regions: string[]; note: string | null; active: boolean; sort: number; updated_at: Date };

async function loadPlans(q: Tx): Promise<PlanRow[]> {
  return await q<PlanRow[]>`
    select id, label, months, price_inr, discount_pct::float8 as discount_pct, regions, note, active, sort, updated_at
    from plans order by sort, id`;
}

const planView = (p: PlanRow) => ({
  id: p.id, label: p.label, months: p.months, price: p.price_inr, discountPct: p.discount_pct, regions: p.regions,
  note: p.note, active: p.active, sort: p.sort, updatedAt: ms(p.updated_at),
});
const oldPlans = (rows: PlanRow[]) => Object.fromEntries(rows.map((p) => [p.id, { label: p.label, months: p.months, price: p.price_inr }]));

type CouponRow = {
  code: string; pct: number; max_uses: number; per_user_limit: number; applies_to: string; class_id: string | null;
  valid_from: Date | null; valid_until: Date | null; active: boolean; note: string | null; created_at: Date;
  updated_at: Date; created_by: string | null; uses: number;
};

async function loadCoupons(q: Tx, code?: string): Promise<CouponRow[]> {
  return await q<CouponRow[]>`
    select c.code::text as code, c.pct::float8 as pct, c.max_uses, c.per_user_limit, c.applies_to, c.class_id,
           c.valid_from, c.valid_until, c.active, c.note, c.created_at, c.updated_at, c.created_by,
           (select count(*) from (
              select r.order_id from coupon_redemptions r where r.coupon_code = c.code
              union
              select o.id from orders o where o.coupon_code = c.code and o.status in ('paid', 'refunded')) u)::int as uses
    from coupons c
    where (${code ?? null}::text is null or c.code = ${code ?? null}::citext)
    order by c.created_at desc, c.code`;
}

const couponView = (c: CouponRow) => ({
  code: c.code, pct: c.pct, max: c.max_uses, maxUses: c.max_uses, uses: c.uses, active: c.active,
  perUserLimit: c.per_user_limit, appliesTo: c.applies_to, cls: c.class_id, classId: c.class_id,
  validFrom: ms(c.valid_from), validUntil: ms(c.valid_until), note: c.note,
  usedUp: c.max_uses > 0 && c.uses >= c.max_uses, created: ms(c.created_at), updated: ms(c.updated_at), createdBy: c.created_by,
});
const oldCoupons = (rows: CouponRow[]) => Object.fromEntries(rows.map((c) => [c.code.toUpperCase(), { pct: c.pct, max: c.max_uses, uses: c.uses, active: c.active }]));

type CouponFields = {
  pct: number; max_uses: number; per_user_limit: number; applies_to: string; class_id: string | null;
  valid_from: Date | null; valid_until: Date | null; active: boolean; note: string | null;
};

/** Coupon fields present in a body (new and old names). */
function parseCoupon(b: Record<string, unknown>, field = (f: string) => f): Partial<CouponFields> {
  const set: Partial<CouponFields> = {};
  const errors: Record<string, string> = {};
  if (b.pct !== undefined) {
    const n = typeof b.pct === 'string' && b.pct.trim() !== '' ? Number(b.pct) : b.pct;
    if (!numOk(n, 0, 100, 2, true)) errors[field('pct')] = 'The discount is a percentage above 0 and at most 100.';
    else set.pct = n as number;
  }
  const maxKey = has(b, 'maxUses', 'max', 'max_uses');
  if (maxKey) {
    try { set.max_uses = intOf(b[maxKey], field('maxUses'), 0, 1_000_000, 'Uses (0 = no limit)') ?? 0; } catch (e) { Object.assign(errors, (e as HttpError).extra.errors); }
  }
  const perKey = has(b, 'perUserLimit', 'per_user_limit');
  if (perKey) {
    try { set.per_user_limit = intOf(b[perKey], field('perUserLimit'), 0, 1000, 'Uses per customer (0 = no limit)') ?? 0; } catch (e) { Object.assign(errors, (e as HttpError).extra.errors); }
  }
  const appliesKey = has(b, 'appliesTo', 'applies_to');
  if (appliesKey) {
    if (!['all', 'worksheet', 'class'].includes(b[appliesKey] as string)) errors[field('appliesTo')] = 'Applies to all, worksheet or class.';
    else set.applies_to = b[appliesKey] as string;
  }
  const clsKey = has(b, 'classId', 'cls', 'class_id');
  if (clsKey) {
    const v = b[clsKey];
    if (v === null || v === '') set.class_id = null;
    else if (typeof v === 'string' && CLASS_RE.test(v)) set.class_id = v;
    else errors[field('cls')] = 'Unknown class.';
  }
  for (const [key, col] of [['validFrom', 'valid_from'], ['validUntil', 'valid_until']] as const) {
    if (b[key] === undefined) continue;
    try { set[col] = dateOf(b[key], field(key)); } catch (e) { Object.assign(errors, (e as HttpError).extra.errors); }
  }
  if (b.active !== undefined) {
    if (typeof b.active !== 'boolean') errors[field('active')] = 'active is true or false.';
    else set.active = b.active;
  }
  if (b.note !== undefined) {
    if (b.note !== null && typeof b.note !== 'string') errors[field('note')] = 'The note must be text.';
    else if (typeof b.note === 'string' && b.note.length > 200) errors[field('note')] = 'Keep the note under 200 characters.';
    else set.note = b.note === null ? null : (cleanText(b.note, 200) || null);
  }
  if (Object.keys(errors).length) throw invalid(errors);
  return set;
}

function couponCode(v: unknown, field = 'code'): string {
  const code = typeof v === 'string' ? v.trim().toUpperCase() : '';
  if (!COUPON_RE.test(code)) throw invalid({ [field]: 'Codes are 3 to 32 letters, digits, dashes or underscores.' });
  return code;
}

/** Final checks on a whole coupon (window order, class exists). */
async function checkCoupon(q: Tx, c: CouponFields, field = (f: string) => f) {
  if (c.valid_from && c.valid_until && c.valid_until.getTime() <= c.valid_from.getTime()) {
    throw invalid({ [field('validUntil')]: 'The end must be after the start.' });
  }
  if (c.class_id && !(await q`select 1 from classes where id = ${c.class_id}`).length) throw invalid({ [field('cls')]: 'Unknown class.' });
}

function couponSnapshot(c: Partial<CouponFields>) {
  return {
    pct: c.pct, maxUses: c.max_uses, perUserLimit: c.per_user_limit, appliesTo: c.applies_to, cls: c.class_id,
    validFrom: iso(c.valid_from ?? null), validUntil: iso(c.valid_until ?? null), active: c.active, note: c.note,
  };
}

async function insertCoupon(q: Tx, ctx: Ctx, code: string, v: CouponFields) {
  try {
    await q`
      insert into coupons (code, pct, max_uses, per_user_limit, applies_to, class_id, valid_from, valid_until, active, note, created_by)
      values (${code}, ${v.pct}, ${v.max_uses}, ${v.per_user_limit}, ${v.applies_to}, ${v.class_id}, ${v.valid_from},
              ${v.valid_until}, ${v.active}, ${v.note}, ${ctx.user!.id})`;
  } catch (e) {
    if (isUnique(e, 'coupons_pkey')) throw new HttpError(409, 'That code already exists.', { code: 'coupon_exists', errors: { code: 'That code already exists.' } });
    throw e;
  }
  await audit(ctx, { action: 'coupon.create', targetType: 'coupon', targetId: code, detail: { before: null, after: couponSnapshot(v) } }, q);
}

async function updateCoupon(q: Tx, ctx: Ctx, cur: CouponRow, set: Partial<CouponFields>, field = (f: string) => f) {
  const next: CouponFields = {
    pct: set.pct ?? cur.pct, max_uses: set.max_uses ?? cur.max_uses, per_user_limit: set.per_user_limit ?? cur.per_user_limit,
    applies_to: set.applies_to ?? cur.applies_to, class_id: set.class_id !== undefined ? set.class_id : cur.class_id,
    valid_from: set.valid_from !== undefined ? set.valid_from : cur.valid_from,
    valid_until: set.valid_until !== undefined ? set.valid_until : cur.valid_until,
    active: set.active ?? cur.active, note: set.note !== undefined ? set.note : cur.note,
  };
  await checkCoupon(q, next, field);
  const a = couponSnapshot(next), bf = couponSnapshot(cur);
  const before: Record<string, unknown> = {}, after: Record<string, unknown> = {};
  for (const k of Object.keys(a) as (keyof typeof a)[]) if (JSON.stringify(a[k] ?? null) !== JSON.stringify(bf[k] ?? null)) { before[k] = bf[k] ?? null; after[k] = a[k] ?? null; }
  if (!Object.keys(after).length) return;
  await q`
    update coupons set pct = ${next.pct}, max_uses = ${next.max_uses}, per_user_limit = ${next.per_user_limit},
      applies_to = ${next.applies_to}, class_id = ${next.class_id}, valid_from = ${next.valid_from},
      valid_until = ${next.valid_until}, active = ${next.active}, note = ${next.note}
    where code = ${cur.code}::citext`;
  await audit(ctx, { action: 'coupon.update', targetType: 'coupon', targetId: cur.code, detail: { before, after } }, q);
}

/** Deletes a coupon nobody used; one with uses is switched off instead (history stays). */
async function dropCoupon(q: Tx, ctx: Ctx, cur: CouponRow): Promise<'deleted' | 'deactivated' | 'unchanged'> {
  const usedSomewhere = cur.uses > 0 || (await q`select 1 from coupon_redemptions where coupon_code = ${cur.code}::citext limit 1`).length > 0;
  if (usedSomewhere) {
    if (!cur.active) return 'unchanged';
    await q`update coupons set active = false where code = ${cur.code}::citext`;
    await audit(ctx, { action: 'coupon.deactivate', targetType: 'coupon', targetId: cur.code, detail: { before: { active: true }, after: { active: false }, uses: cur.uses } }, q);
    return 'deactivated';
  }
  await q`delete from coupons where code = ${cur.code}::citext`;
  await audit(ctx, { action: 'coupon.delete', targetType: 'coupon', targetId: cur.code, detail: { before: couponSnapshot(cur), after: null } }, q);
  return 'deleted';
}

const COUPON_READ = ['coupons.write', 'pricing.write', 'orders.read'];

async function listCoupons(ctx: Ctx) {
  await requireStaff(ctx, COUPON_READ);
  const rows = await tx((q) => loadCoupons(q));
  return { coupons: rows.map(couponView) };
}

async function createCoupon(ctx: Ctx) {
  await requireStaff(ctx, 'coupons.write');
  const b = await readJson(ctx.req, 8 * 1024);
  const code = couponCode(b.code);
  const set = parseCoupon(b);
  if (set.pct === undefined) throw invalid({ pct: 'The discount is a percentage above 0 and at most 100.' });
  const v: CouponFields = {
    pct: set.pct, max_uses: set.max_uses ?? 0, per_user_limit: set.per_user_limit ?? 0, applies_to: set.applies_to ?? 'all',
    class_id: set.class_id ?? null, valid_from: set.valid_from ?? null, valid_until: set.valid_until ?? null,
    active: set.active ?? true, note: set.note ?? null,
  };
  const row = await tx(async (q) => {
    await checkCoupon(q, v);
    await insertCoupon(q, ctx, code, v);
    return (await loadCoupons(q, code))[0];
  });
  return { ok: true, coupon: couponView(row) };
}

function codeParam(ctx: Ctx): string {
  const code = (ctx.params.code ?? '').trim();
  if (!COUPON_RE.test(code)) throw notFound('No such coupon.');
  return code;
}

async function putCoupon(ctx: Ctx) {
  await requireStaff(ctx, 'coupons.write');
  const code = codeParam(ctx);
  const b = await readJson(ctx.req, 8 * 1024);
  if (b.code !== undefined && String(b.code).trim().toUpperCase() !== code.toUpperCase()) {
    throw invalid({ code: 'A code cannot be renamed — make a new coupon instead.' });
  }
  const set = parseCoupon(b);
  const row = await tx(async (q) => {
    const locked = await q`select 1 from coupons where code = ${code}::citext for update`;
    const cur = locked.length ? (await loadCoupons(q, code))[0] : null;
    if (!cur) throw notFound('No such coupon.');
    await updateCoupon(q, ctx, cur, set);
    return (await loadCoupons(q, code))[0];
  });
  return { ok: true, coupon: couponView(row) };
}

async function deleteCoupon(ctx: Ctx) {
  await requireStaff(ctx, 'coupons.write');
  const code = codeParam(ctx);
  const out = await tx(async (q) => {
    const locked = await q`select 1 from coupons where code = ${code}::citext for update`;
    const cur = locked.length ? (await loadCoupons(q, code))[0] : null;
    if (!cur) throw notFound('No such coupon.');
    const result = await dropCoupon(q, ctx, cur);
    const after = result === 'deleted' ? null : (await loadCoupons(q, code))[0];
    return { result, after };
  });
  return {
    ok: true,
    deleted: out.result === 'deleted',
    deactivated: out.result !== 'deleted',
    ...(out.result !== 'deleted' ? { note: 'This code was used on orders, so it was switched off instead of deleted.' } : {}),
    coupon: out.after ? couponView(out.after) : null,
  };
}

/** PUT /api/admin/coupons — the old bulk form {coupons:[{code,pct,max,uses,active}], discounts:{cls:pct}}.
 *  Listed coupons are created or updated; coupons left out are deleted, or switched off when used.
 *  `uses` is counted by the server and ignored here. Class discounts need pricing.write. */
async function putCouponsBulk(ctx: Ctx) {
  await requireStaff(ctx, 'coupons.write');
  const b = await readJson(ctx.req, 64 * 1024);
  const list = b.coupons === undefined ? null : b.coupons;
  if (list !== null && (!Array.isArray(list) || list.length > 500)) throw invalid({ coupons: 'coupons is a list (500 at most).' });
  const discounts = b.discounts === undefined ? null : b.discounts;
  if (discounts !== null && !isObj(discounts)) throw invalid({ discounts: 'discounts is an object like {"kg": 10}.' });
  if (list === null && discounts === null) throw invalid({ coupons: 'Send coupons and/or discounts.' });
  if (discounts !== null) needPermission(ctx, 'pricing.write', 'Your staff role does not allow price changes.');

  // parse everything before writing anything
  const wanted = new Map<string, Partial<CouponFields>>();
  for (const [i, c] of (list ?? []).entries()) {
    if (!isObj(c)) throw invalid({ [`coupons[${i}]`]: 'Each coupon is an object.' });
    const code = couponCode(c.code, `coupons[${i}].code`);
    if (wanted.has(code)) throw invalid({ [`coupons[${i}].code`]: 'Each code only once, please.' });
    const set = parseCoupon(c, (f) => `coupons[${i}].${f}`);
    if (set.pct === undefined) throw invalid({ [`coupons[${i}].pct`]: 'The discount is a percentage above 0 and at most 100.' });
    wanted.set(code, set);
  }
  const pcts = new Map<string, number>();
  for (const [cls, v] of Object.entries(discounts ?? {})) {
    const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
    if (!CLASS_RE.test(cls)) throw invalid({ [`discounts.${cls}`]: 'Unknown class.' });
    if (!numOk(n, 0, 90, 2)) throw invalid({ [`discounts.${cls}`]: 'A class discount is from 0 to 90 percent.' });
    pcts.set(cls, n as number);
  }

  const out = await tx(async (q) => {
    if (list !== null) {
      const existing = await loadCoupons(q);
      const byCode = new Map(existing.map((c) => [c.code.toUpperCase(), c]));
      for (const [code, set] of wanted) {
        const cur = byCode.get(code);
        if (cur) {
          await updateCoupon(q, ctx, cur, set);
        } else {
          const v: CouponFields = {
            pct: set.pct!, max_uses: set.max_uses ?? 0, per_user_limit: set.per_user_limit ?? 0, applies_to: set.applies_to ?? 'all',
            class_id: set.class_id ?? null, valid_from: set.valid_from ?? null, valid_until: set.valid_until ?? null,
            active: set.active ?? true, note: set.note ?? null,
          };
          await checkCoupon(q, v);
          await insertCoupon(q, ctx, code, v);
        }
      }
      for (const cur of existing) if (!wanted.has(cur.code.toUpperCase())) await dropCoupon(q, ctx, cur);
    }
    if (discounts !== null) {
      const classes = await q<{ id: string; discount_pct: number }[]>`select id, discount_pct::float8 as discount_pct from classes for update`;
      const known = new Set(classes.map((c) => c.id));
      for (const cls of pcts.keys()) if (!known.has(cls)) throw invalid({ [`discounts.${cls}`]: 'Unknown class.' });
      // as before: a class left out of the list has no discount
      for (const c of classes) {
        const next = pcts.get(c.id) ?? 0;
        if (next === c.discount_pct) continue;
        await q`update classes set discount_pct = ${next} where id = ${c.id}`;
        await audit(ctx, { action: 'class.update', targetType: 'class', targetId: c.id, detail: { before: { discountPct: c.discount_pct }, after: { discountPct: next } } }, q);
      }
    }
    const coupons = await loadCoupons(q);
    const cls = await q<{ id: string; discount_pct: number }[]>`select id, discount_pct::float8 as discount_pct from classes order by sort, id`;
    return { coupons, cls };
  });
  return {
    ok: true,
    coupons: oldCoupons(out.coupons),
    discounts: Object.fromEntries(out.cls.filter((c) => c.discount_pct > 0).map((c) => [c.id, c.discount_pct])),
    couponList: out.coupons.map(couponView),
  };
}

type PlanFields = { label: string; months: number; price_inr: number; discount_pct: number; regions: string[]; note: string | null; active: boolean; sort: number };

/** PUT /api/admin/plans — old {m1: 249, ...} (price only), or {m1: {price, label, ...}}, or
 *  {plans: [{id, price?, label?, months?, discountPct?, regions?, note?, active?, sort?}]}.
 *  An unknown id with label, months and price adds a plan. */
async function putPlans(ctx: Ctx) {
  await requireStaff(ctx, 'pricing.write');
  const b = await readJson(ctx.req, 16 * 1024);
  const entries: [string, unknown][] = Array.isArray(b.plans)
    ? b.plans.map((p, i) => [isObj(p) && typeof p.id === 'string' ? p.id : `#${i + 1}`, p] as [string, unknown])
    : Object.entries(b);
  if (!entries.length || entries.length > 20) throw invalid({ plans: 'Send the plans to change.' });
  const changes = new Map<string, Partial<PlanFields>>();
  const errors: Record<string, string> = {};
  for (const [id, raw] of entries) {
    if (!PLAN_RE.test(id)) { errors[id] = 'Plan ids are lower-case letters and digits (8 at most).'; continue; }
    const v: Record<string, unknown> = isObj(raw) ? raw : { price: raw };
    const set: Partial<PlanFields> = {};
    try {
      const priceKey = has(v, 'price', 'priceInr');
      if (priceKey) set.price_inr = intOf(v[priceKey], id, 0, 1_000_000, 'The price (whole rupees)') ?? undefined;
      if (priceKey && set.price_inr === undefined) throw invalid({ [id]: 'The price (whole rupees) is required.' });
      if (v.months !== undefined) set.months = intOf(v.months, id, 1, 36, 'Months') ?? undefined;
      if (v.sort !== undefined) set.sort = intOf(v.sort, id, -1000, 1000, 'Sort') ?? 0;
    } catch (e) { Object.assign(errors, (e as HttpError).extra.errors); continue; }
    if (v.label !== undefined) {
      const l = cleanName(v.label);
      if (!l || l.length > 40) { errors[id] = 'A plan label is 1 to 40 characters.'; continue; }
      set.label = l;
    }
    const pctKey = has(v, 'discountPct', 'discount_pct');
    if (pctKey) {
      const n = typeof v[pctKey] === 'string' ? Number(v[pctKey]) : v[pctKey];
      if (!numOk(n, 0, 90, 2)) { errors[id] = 'A plan discount is from 0 to 90 percent.'; continue; }
      set.discount_pct = n as number;
    }
    if (v.regions !== undefined) {
      const r = v.regions;
      if (!Array.isArray(r) || !r.length || !r.every((x) => x === 'IN' || x === 'INTL')) { errors[id] = 'Regions are IN and/or INTL.'; continue; }
      set.regions = [...new Set(r as string[])];
    }
    if (v.note !== undefined) {
      if (v.note !== null && (typeof v.note !== 'string' || v.note.length > 60)) { errors[id] = 'A plan note is up to 60 characters.'; continue; }
      set.note = v.note === null ? null : (cleanName(v.note) || null);
    }
    if (v.active !== undefined) {
      if (typeof v.active !== 'boolean') { errors[id] = 'active is true or false.'; continue; }
      set.active = v.active;
    }
    if (changes.has(id)) { errors[id] = 'Each plan only once, please.'; continue; }
    changes.set(id, set);
  }
  if (Object.keys(errors).length) throw invalid(errors);

  const rows = await tx(async (q) => {
    const current = new Map((await q<PlanRow[]>`
      select id, label, months, price_inr, discount_pct::float8 as discount_pct, regions, note, active, sort, updated_at
      from plans for update`).map((p) => [p.id, p]));
    for (const [id, set] of changes) {
      const cur = current.get(id);
      if (!cur) {
        if (!set.label || !set.months || set.price_inr === undefined) throw invalid({ [id]: 'Unknown plan — give label, months and price to add it.' });
        const v: PlanFields = {
          label: set.label, months: set.months, price_inr: set.price_inr, discount_pct: set.discount_pct ?? 0,
          regions: set.regions ?? ['IN', 'INTL'], note: set.note ?? null, active: set.active ?? true, sort: set.sort ?? 0,
        };
        await q`
          insert into plans (id, label, months, price_inr, discount_pct, regions, note, active, sort)
          values (${id}, ${v.label}, ${v.months}, ${v.price_inr}, ${v.discount_pct}, ${v.regions}::text[], ${v.note}, ${v.active}, ${v.sort})`;
        await audit(ctx, { action: 'plan.create', targetType: 'plan', targetId: id, detail: { before: null, after: v } }, q);
        continue;
      }
      const prev: PlanFields = { label: cur.label, months: cur.months, price_inr: cur.price_inr, discount_pct: cur.discount_pct, regions: cur.regions, note: cur.note, active: cur.active, sort: cur.sort };
      const next: PlanFields = { ...prev, ...Object.fromEntries(Object.entries(set).filter(([, x]) => x !== undefined)) };
      const before: Record<string, unknown> = {}, after: Record<string, unknown> = {};
      for (const k of Object.keys(next) as (keyof PlanFields)[]) {
        if (JSON.stringify(next[k]) !== JSON.stringify(prev[k])) { before[k] = prev[k]; after[k] = next[k]; }
      }
      if (!Object.keys(after).length) continue;
      await q`
        update plans set label = ${next.label}, months = ${next.months}, price_inr = ${next.price_inr},
          discount_pct = ${next.discount_pct}, regions = ${next.regions}::text[], note = ${next.note}, active = ${next.active}, sort = ${next.sort}
        where id = ${id}`;
      await audit(ctx, { action: 'plan.update', targetType: 'plan', targetId: id, detail: { before, after } }, q);
    }
    return await loadPlans(q);
  });
  return { plans: oldPlans(rows), planList: rows.map(planView) };
}

// ── settings ─────────────────────────────────────────────────────────────────────────────

type Validated = { value: unknown; errors: Record<string, string> };
type Rule = { perm: string; read: string[]; check: (input: unknown, cur: Settings) => Validated };

const PRICING_READ = ['pricing.write', 'catalogue.read', 'orders.read', 'coupons.write'];
const SITE_READ = ['settings.write', 'developer.read'];
const SECURITY_READ = ['security.read', 'security.write'];

/** Field-by-field check of a fixed-shape object: unknown fields are refused; missing fields keep
 *  their current value. */
function fields(input: unknown, cur: Record<string, unknown>, spec: Record<string, (v: unknown) => string | null>): Validated {
  const errors: Record<string, string> = {};
  if (!isObj(input)) return { value: null, errors: { value: 'Send an object.' } };
  for (const k of Object.keys(input)) if (!(k in spec)) errors[k] = 'Unknown field.';
  const value: Record<string, unknown> = {};
  for (const [k, test] of Object.entries(spec)) {
    const v = input[k] !== undefined ? input[k] : cur[k];
    const problem = test(v);
    if (problem) errors[k] = problem; else value[k] = v;
  }
  return { value, errors };
}

const int = (min: number, max: number, label = 'Use') => (v: unknown) =>
  typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? null : `${label} a whole number from ${min} to ${max}.`;
const dec = (min: number, max: number) => (v: unknown) => numOk(v, min, max, 4) ? null : `Use a number from ${min} to ${max}.`;
const bool = (v: unknown) => (typeof v === 'boolean' ? null : 'Use true or false.');
const emailRule = (v: unknown) => (typeof v === 'string' && validEmail(v.trim().toLowerCase()) && v === v.trim() ? null : 'Use a valid email address.');

const UNSUPPORTED = (c: string) => `${c} cannot be used: the payment gateways count its amounts differently, so no single charge would be right.`;

function checkRates(input: unknown, s: Settings): Validated {
  const errors: Record<string, string> = {};
  if (!isObj(input)) return { value: null, errors: { value: 'Send an object like {"USD": 0.012}.' } };
  const keys = Object.keys(input);
  if (keys.length > 60) errors.value = 'At most 60 currencies.';
  const value: Record<string, number> = { INR: 1 };
  for (const k of keys) {
    const v = input[k];
    if (!CURRENCY_RE.test(k)) { errors[k] = 'Currency codes are 3 capital letters.'; continue; }
    if (UNSUPPORTED_CURRENCIES.has(k)) { errors[k] = UNSUPPORTED(k); continue; }
    if (k === 'INR') { if (v !== 1) errors[k] = 'INR is always 1.'; continue; }
    if (!numOk(v, 0, 1_000_000, 8, true)) { errors[k] = 'A rate is a positive number (currency units per rupee).'; continue; }
    value[k] = v as number;
  }
  // every country's currency needs a rate, or its checkout stops working
  for (const c of Array.isArray(s.countries) ? s.countries : []) {
    const cur = isObj(c) && typeof c.currency === 'string' ? c.currency : '';
    if (cur && cur !== 'INR' && value[cur] === undefined) errors[cur] = `A rate for ${cur} is needed (used by ${String((c as Record<string, unknown>).name ?? (c as Record<string, unknown>).code)}).`;
  }
  return { value, errors };
}

function checkCountries(input: unknown, s: Settings): Validated {
  const errors: Record<string, string> = {};
  if (!Array.isArray(input) || input.length < 2 || input.length > 250) return { value: null, errors: { value: 'Send the list of countries (India and OTHER at least).' } };
  const seen = new Set<string>();
  const out: Record<string, unknown>[] = [];
  const rates = s.currency_rates as Record<string, unknown>;
  input.forEach((c, i) => {
    const at = (f: string) => `${i}.${f}`;
    if (!isObj(c)) { errors[String(i)] = 'Each country is an object.'; return; }
    const allowed = ['code', 'name', 'currency', 'tax', 'postal', 'state', 'states', 'methods'];
    for (const k of Object.keys(c)) if (!allowed.includes(k)) errors[at(k)] = 'Unknown field.';
    const code = typeof c.code === 'string' ? c.code : '';
    if (!/^[A-Z]{2}$|^OTHER$/.test(code)) errors[at('code')] = 'Two capital letters, or OTHER.';
    else if (seen.has(code)) errors[at('code')] = 'Each country only once.';
    seen.add(code);
    const name = typeof c.name === 'string' ? cleanName(c.name) : '';
    if (!name || name.length > 80) errors[at('name')] = 'A name of 1 to 80 characters.';
    const currency = typeof c.currency === 'string' ? c.currency : '';
    if (!CURRENCY_RE.test(currency)) errors[at('currency')] = 'Three capital letters, e.g. USD.';
    else if (UNSUPPORTED_CURRENCIES.has(currency)) errors[at('currency')] = UNSUPPORTED(currency);
    else if (currency !== 'INR' && !numOk(rates[currency], 0, 1_000_000, 8, true)) errors[at('currency')] = `Add a rate for ${currency} first.`;
    const tax = isObj(c.tax) ? c.tax : null;
    if (!tax || typeof tax.label !== 'string' || !tax.label.trim() || tax.label.length > 60 || !numOk(tax.pct, 0, 100, 2)) {
      errors[at('tax')] = 'Tax is {label (1–60 characters), pct (0–100)}.';
    }
    const postal = isObj(c.postal) ? c.postal : null;
    if (!postal || typeof postal.label !== 'string' || !postal.label.trim() || postal.label.length > 60
      || typeof (postal.hint ?? '') !== 'string' || String(postal.hint ?? '').length > 80
      || typeof (postal.pattern ?? '') !== 'string' || String(postal.pattern ?? '').length > 200
      || typeof (postal.flags ?? '') !== 'string' || !/^[imsu]{0,4}$/.test(String(postal.flags ?? ''))) {
      errors[at('postal')] = 'Postal is {label, hint, pattern, flags}.';
    } else {
      try { new RegExp(String(postal.pattern ?? ''), String(postal.flags ?? '')); } catch { errors[at('postal')] = 'The postal pattern is not a valid regular expression.'; }
    }
    if (typeof c.state !== 'string' || !c.state.trim() || c.state.length > 40) errors[at('state')] = 'The state label is 1 to 40 characters.';
    if (c.states !== null && c.states !== undefined
      && (!Array.isArray(c.states) || c.states.length > 100 || !c.states.every((x) => typeof x === 'string' && x.trim() && x.length <= 80))) {
      errors[at('states')] = 'states is null or a list of names (100 at most).';
    }
    const methods = c.methods;
    if (!Array.isArray(methods) || !methods.length || new Set(methods).size !== methods.length
      || !methods.every((m) => (PAYMENT_METHODS as readonly unknown[]).includes(m))) {
      errors[at('methods')] = 'methods is a list of razorpay, stripe and/or paypal.';
    }
    out.push({
      code, name, currency, tax: tax ? { label: String(tax.label).trim(), pct: tax.pct } : null,
      postal: postal ? { label: String(postal.label).trim(), hint: String(postal.hint ?? ''), pattern: String(postal.pattern ?? ''), flags: String(postal.flags ?? '') } : null,
      state: typeof c.state === 'string' ? c.state.trim() : '', states: Array.isArray(c.states) ? c.states.map((x) => String(x).trim()) : null,
      methods,
    });
  });
  if (!seen.has('IN')) errors.IN = 'India (IN) must stay in the list.';
  if (!seen.has('OTHER')) errors.OTHER = 'OTHER (every other country) must stay in the list.';
  return { value: out, errors };
}

const RULES: Record<string, Rule> = {
  worksheet_access: {
    perm: 'pricing.write', read: PRICING_READ,
    // staff set hours (24 = one day); days is kept in step, rounded up, for older readers
    check: (v, s) => {
      // an older form sends days only: those days in hours (still checked as days)
      if (isObj(v) && v.hours === undefined && v.days !== undefined) {
        const bad = int(1, 3650)(v.days);
        if (bad) return { value: null, errors: { days: bad } };
        v = { ...v, hours: (v.days as number) * 24 };
      }
      const { days: _days, ...input } = isObj(v) ? v : { days: undefined };
      const out = fields(isObj(v) ? input : v, { hours: s.worksheet_access.hours }, { hours: int(1, MAX_ACCESS_HOURS) });
      const val = out.value as Record<string, unknown> | null;
      if (val && typeof val.hours === 'number') val.days = Math.max(1, Math.ceil(val.hours / 24));
      return out;
    },
  },
  fees: {
    perm: 'pricing.write', read: PRICING_READ,
    check: (v, s) => {
      if (!isObj(v)) return { value: null, errors: { value: 'Send {"IN": {pct, fixed}, "INTL": {pct, fixed}}.' } };
      const errors: Record<string, string> = {};
      for (const k of Object.keys(v)) if (k !== 'IN' && k !== 'INTL') errors[k] = 'Unknown field.';
      const IN = fields(v.IN ?? {}, s.fees.IN, { pct: dec(0, 50), fixed: dec(0, 10000) });
      const INTL = fields(v.INTL ?? {}, s.fees.INTL, { pct: dec(0, 50), fixed: dec(0, 1000) });
      for (const [k, m] of Object.entries(IN.errors)) errors[`IN.${k}`] = m;
      for (const [k, m] of Object.entries(INTL.errors)) errors[`INTL.${k}`] = m;
      return { value: { IN: IN.value, INTL: INTL.value }, errors };
    },
  },
  currency_rates: { perm: 'pricing.write', read: PRICING_READ, check: checkRates },
  quote: { perm: 'pricing.write', read: PRICING_READ, check: (v, s) => fields(v, s.quote, { ttlMinutes: int(5, 1440) }) },
  // prints of each sheet per access record, by account type (sheets whose print rule is 'account')
  prints: {
    perm: 'pricing.write', read: [...PRICING_READ, 'customers.read'],
    check: (v, s) => fields(v, s.prints, { parent: int(0, 1000), teacher: int(0, 1000), organization: int(0, 1000) }),
  },
  countries: { perm: 'pricing.write', read: PRICING_READ, check: checkCountries },
  sessions: {
    perm: 'settings.write', read: SITE_READ,
    check: (v, s) => {
      const r = fields(v, s.sessions, { rememberDays: int(1, MAX_SESSION_DAYS), shortHours: int(1, 168), maxDays: int(1, MAX_SESSION_DAYS) });
      const x = r.value as Record<string, number> | null;
      if (x && !Object.keys(r.errors).length) {
        if (x.rememberDays > x.maxDays) r.errors.rememberDays = 'Cannot be longer than maxDays.';
        if (x.shortHours > x.maxDays * 24) r.errors.shortHours = 'Cannot be longer than maxDays.';
      }
      return r;
    },
  },
  login: { perm: 'settings.write', read: SITE_READ, check: (v, s) => fields(v, s.login, { maxFailed: int(3, 50), lockMinutes: int(1, 1440) }) },
  auth_links: { perm: 'settings.write', read: SITE_READ, check: (v, s) => fields(v, s.auth_links, { verifyHours: int(1, 168), resetMinutes: int(5, 1440) }) },
  viewer: { perm: 'settings.write', read: SITE_READ, check: (v, s) => fields(v, s.viewer, { tokenHours: int(1, 72), recheckSeconds: int(15, 3600) }) },
  contact: { perm: 'settings.write', read: SITE_READ, check: (v, s) => fields(v, s.contact, { inbox: emailRule }) },
  email: {
    perm: 'settings.write', read: SITE_READ,
    check: (v, s) => fields(v, s.email, {
      fromName: (x) => (typeof x === 'string' && x === cleanName(x) && x.length >= 1 && x.length <= 60 && !/["\\@]/.test(x) ? null : 'A sender name of 1 to 60 plain characters.'),
      adminAlerts: (x) => (Array.isArray(x) && x.length >= 1 && x.length <= 10 && x.every((e) => emailRule(e) === null && e === String(e).toLowerCase())
        && new Set(x).size === x.length ? null : 'A list of 1 to 10 different email addresses (lower case).'),
    }),
  },
  agreement: {
    perm: 'settings.write', read: SITE_READ,
    check: (v, s) => {
      const r = fields(v, s.agreement, {
        version: (x) => (typeof x === 'string' && /^[A-Za-z0-9._-]{1,40}$/.test(x) ? null : 'A version of 1 to 40 letters, digits, dots or dashes.'),
        text: (x) => (typeof x === 'string' && x === cleanText(x, 2000) && x.length >= 10 && x.length <= 2000 ? null : 'The agreement text is 10 to 2000 characters.'),
      });
      const x = r.value as { version: string; text: string } | null;
      // customers accept a version; new words need a new version so everyone accepts them again
      if (x && !Object.keys(r.errors).length && x.text !== s.agreement.text && x.version === s.agreement.version) {
        r.errors.version = 'Change the version when the text changes, so customers accept the new text.';
      }
      return r;
    },
  },
  security: {
    perm: 'security.write', read: SECURITY_READ,
    check: (v, s) => fields(v, s.security, { maxWarnings: int(1, 20), warningExpiryDays: int(1, 3650), autoSuspend: bool }),
  },
};

const canRead = (ctx: Ctx, key: string) => {
  const r = RULES[key];
  return hasPermission(ctx.user!.staff, r.perm) || r.read.some((p) => hasPermission(ctx.user!.staff, p));
};

/** GET /api/admin/settings — old {plans, classes, coupons, discounts, rates, fees} plus every
 *  setting this staff member may see (value, description, whether they may change it). */
async function getAdminSettings(ctx: Ctx) {
  const u = await requireStaff(ctx, ['dashboard.view', 'catalogue.read', 'orders.read', 'pricing.write', 'settings.write', 'security.read', 'security.write', 'coupons.write']);
  const showCoupons = COUPON_READ.some((p) => hasPermission(u.staff, p));
  clearSettingsCache();
  const out = await tx(async (q) => {
    const s = await getSettings(q);
    const plans = await loadPlans(q);
    const classes = await q<{ id: string; name: string; status: string; discount_pct: number; sort: number }[]>`
      select id, name, status, discount_pct::float8 as discount_pct, sort from classes order by sort, id`;
    const coupons = showCoupons ? await loadCoupons(q) : [];
    const rows = await q<{ key: string; description: string | null; updated_at: Date; updated_by: string | null }[]>`
      select key, description, updated_at, updated_by from settings`;
    return { s, plans, classes, coupons, rows };
  });
  const meta = new Map(out.rows.map((r) => [r.key, r]));
  const settings: Record<string, unknown> = {};
  const editable: string[] = [];
  for (const key of Object.keys(RULES)) {
    if (!canRead(ctx, key)) continue;
    const m = meta.get(key);
    const canEdit = hasPermission(u.staff, RULES[key].perm);
    if (canEdit) editable.push(key);
    settings[key] = {
      value: out.s[key as keyof Settings], description: m?.description ?? null, updatedAt: ms(m?.updated_at), updatedBy: m?.updated_by ?? null,
      editable: canEdit, permission: RULES[key].perm,
    };
  }
  return {
    // the old shape
    plans: oldPlans(out.plans),
    classes: Object.fromEntries(out.classes.map((c) => [c.id, c.name])),
    coupons: oldCoupons(out.coupons),
    discounts: Object.fromEntries(out.classes.filter((c) => c.discount_pct > 0).map((c) => [c.id, c.discount_pct])),
    rates: out.s.currency_rates,
    fees: out.s.fees,
    // new
    planList: out.plans.map(planView),
    classList: out.classes.map((c) => ({ id: c.id, name: c.name, status: c.status, discountPct: c.discount_pct, sort: c.sort })),
    couponList: showCoupons ? out.coupons.map(couponView) : null,
    settings,
    editable,
    accessDays: accessDaysFor(out.s, null),
    accessHours: accessHoursFor(out.s, null),
  };
}

/** Validates and stores one settings key, audited with before/after. */
async function writeSetting(ctx: Ctx, key: string, input: unknown): Promise<unknown> {
  const rule = RULES[key];
  const value = await tx(async (q) => {
    // fresh values (not the 20-second cache) so a check never runs against stale settings
    clearSettingsCache();
    const s = await getSettings(q);
    const r = rule.check(input, s);
    if (Object.keys(r.errors).length) throw invalid(r.errors, `Check the ${key.replace(/_/g, ' ')} values: ${Object.values(r.errors)[0]}`);
    // jsonb equality ignores key order, so an unchanged value writes nothing
    const cur = (await q<{ value: unknown; same: boolean }[]>`
      select value, value = ${q.json(r.value as never)}::jsonb as same from settings where key = ${key} for update`)[0];
    const before = cur?.value ?? null;
    if (cur?.same) return r.value;
    await q`
      insert into settings (key, value, updated_by) values (${key}, ${q.json(r.value as never)}, ${ctx.user!.id})
      on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by`;
    await audit(ctx, { action: 'settings.update', targetType: 'setting', targetId: key, detail: { before, after: r.value } }, q);
    return r.value;
  });
  clearSettingsCache();
  return value;
}

/** PUT /api/admin/settings/:key {value} (or the value's fields directly for object settings). */
async function putSetting(ctx: Ctx) {
  const key = ctx.params.key ?? '';
  const rule = Object.prototype.hasOwnProperty.call(RULES, key) ? RULES[key] : null;
  if (!rule) {
    await requireStaff(ctx, ['pricing.write', 'settings.write', 'security.write']);
    throw new HttpError(404, 'That setting cannot be changed here.', { code: 'unknown_setting' });
  }
  await requireStaff(ctx, rule.perm);
  const b = await readJson(ctx.req, 64 * 1024);
  const input = b.value !== undefined ? b.value : b;
  const value = await writeSetting(ctx, key, input);
  return { ok: true, key, value };
}

/** PUT /api/admin/rates {USD: 0.012, ...} — old shape; returns { rates }. null removes a code. */
async function putRates(ctx: Ctx) {
  await requireStaff(ctx, 'pricing.write');
  const b = await readJson(ctx.req, 16 * 1024);
  if (!Object.keys(b).length) throw invalid({ rates: 'Send rates like {"USD": 0.012}.' });
  clearSettingsCache();
  const cur = (await getSettings()).currency_rates as Record<string, number>;
  const merged: Record<string, unknown> = { ...cur };
  for (const [k, v] of Object.entries(b)) {
    if (v === null) delete merged[k];
    else merged[k] = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  }
  merged.INR = 1;
  const rates = await writeSetting(ctx, 'currency_rates', merged);
  return { rates };
}

export function register(r: Router) {
  r.get('/api/admin/orders', listOrders);
  r.put('/api/admin/orders', putOrder);
  r.get('/api/admin/orders/:id', getOrder);
  r.post('/api/admin/orders/:id/refund', refundOrder);
  r.get('/api/admin/payments', listPayments);
  r.get('/api/admin/payment-events', listPaymentEvents);
  r.get('/api/admin/entitlements', listEntitlements);
  r.post('/api/admin/entitlements/grant', grant);
  r.post('/api/admin/entitlements/revoke', revoke);
  r.post('/api/admin/entitlements/:id/extend', extend);
  r.get('/api/admin/settings', getAdminSettings);
  r.put('/api/admin/settings/:key', putSetting);
  r.put('/api/admin/plans', putPlans);
  r.put('/api/admin/rates', putRates);
  r.put('/api/admin/coupons', putCouponsBulk);
  r.get('/api/admin/coupons', listCoupons);
  r.post('/api/admin/coupons', createCoupon);
  r.put('/api/admin/coupons/:code', putCoupon);
  r.delete('/api/admin/coupons/:code', deleteCoupon);
}

