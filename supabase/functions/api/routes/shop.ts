// The shop: the public catalogue, price quotes, and the customer's own orders and access records.
// Shapes follow the old site (see /var/tmp/sb/map/backend-api.md §11.3, §12.2, §12.3, §12.4);
// new fields are only ever added.
import type { Router } from '../lib/router.ts';
import type { Ctx } from '../lib/context.ts';
import { tx, type Tx } from '../lib/db.ts';
import { json, readJson } from '../lib/http.ts';
import { optionalUser, requireUser } from '../lib/auth.ts';
import { rateLimit } from '../lib/guard.ts';
import { getSettings } from '../lib/settings.ts';
import { accessDaysFor, accessHoursFor, buildQuote } from '../services/pricing.ts';
import { entStatus, type PrintRule, pubEntitlement, sheetPrints, type EntRow } from '../services/entitlements.ts';

const ms = (d: Date | string | null | undefined) => (d == null ? null : new Date(d).getTime());
const iso = (d: Date | string | null | undefined) => (d == null ? null : new Date(d).toISOString());

// ── GET /api/worksheets ──────────────────────────────────────────────────────────────────

type ListRow = {
  id: string; title: string; description: string; class_id: string; subject: string; group_id: string | null;
  section: string | null; section_label: string | null; pages: number; price_inr: number; was_price_inr: number | null;
  thumb_url: string | null; audience: string | null; rating: number | null; rating_count: number;
  review_avg: number | null; review_count: number; print_limit: number; download_limit: number; stock: number | null;
  access_days: number | null; landscape: boolean; tags: string[]; has_pdf: boolean; class_status: string;
  print_rule: PrintRule;
};

async function catalogue(_ctx: Ctx) {
  const s = await getSettings();
  const { rows, classes, plans } = await tx(async (q) => {
    // one call tells which PDFs are uploaded (never the storage paths themselves)
    const rows = await q<ListRow[]>`
      select p.id, p.title, p.description, p.class_id, p.subject, p.group_id, p.section, p.section_label, p.pages,
             p.price_inr, p.was_price_inr, p.thumb_url, p.audience, p.rating::float8 as rating, p.rating_count,
             p.review_avg::float8 as review_avg, p.review_count, p.print_limit, p.print_rule, p.download_limit, p.stock,
             p.access_days, p.landscape, p.tags, coalesce(f.has_pdf, false) as has_pdf, c.status as class_status
      from products p
      join classes c on c.id = p.class_id
      left join private.product_file_status() f on f.product_id = p.id
      where p.status = 'active' and c.status <> 'hidden'
      order by c.sort, c.id, p.sort, p.id`;
    const classes = await q<{ id: string; name: string; status: string; pct: number; sort: number }[]>`
      select id, name, status, discount_pct::float8 as pct, sort from classes where status <> 'hidden' order by sort, id`;
    const plans = await q<{ id: string; label: string; months: number; price_inr: number; pct: number; regions: string[]; note: string | null }[]>`
      select id, label, months, price_inr, discount_pct::float8 as pct, regions, note from plans where active order by sort, id`;
    return { rows, classes, plans };
  });
  const worksheets = rows.map((w) => {
    const soldOut = w.stock !== null && w.stock <= 0;
    return {
      // the old fields
      id: w.id,
      title: w.title,
      cls: w.class_id,
      subject: w.subject,
      pages: w.pages,
      price: w.price_inr,
      free: w.price_inr === 0,
      real: w.has_pdf,
      thumb: w.thumb_url,
      // new
      available: w.has_pdf,
      comingSoon: w.class_status === 'coming_soon',
      onSale: w.has_pdf && w.class_status === 'available' && !soldOut,
      accessDays: accessDaysFor(s, w.access_days),
      accessHours: accessHoursFor(s, w.access_days),
      printLimit: w.print_limit,
      // prints of this sheet per account type ('account' rule: settings.prints; 'sheet': printLimit)
      printRule: w.print_rule,
      prints: sheetPrints(w, s.prints),
      downloadLimit: w.download_limit,
      rating: w.rating,
      ratingCount: w.rating_count,
      reviewAvg: w.review_avg,
      reviewCount: w.review_count,
      audience: w.audience,
      stock: w.stock,
      description: w.description,
      wasPrice: w.was_price_inr,
      group: w.group_id,
      section: w.section,
      sectionLabel: w.section_label,
      tags: w.tags,
      landscape: w.landscape,
    };
  });
  return json(200, {
    worksheets,
    classes: classes.map((c) => ({
      id: c.id, name: c.name, label: c.name, status: c.status,
      available: c.status === 'available', comingSoon: c.status === 'coming_soon', discountPct: c.pct,
    })),
    plans: plans.map((p) => ({ id: p.id, label: p.label, months: p.months, price: p.price_inr, discountPct: p.pct, regions: p.regions, note: p.note })),
    accessDays: accessDaysFor(s, null),
    accessHours: accessHoursFor(s, null),
  }, { 'Cache-Control': 'no-cache' });
}

// ── POST /api/quote ──────────────────────────────────────────────────────────────────────

async function quote(ctx: Ctx) {
  await rateLimit(ctx, 'quote', ctx.ip, 60, 60);
  const body = await readJson(ctx.req, 16 * 1024);
  // a signed-in customer's own coupon uses and running plans count (looked up before the transaction)
  await optionalUser(ctx);
  return await tx((q) => buildQuote(q, ctx, body));
}

// ── GET /api/me/orders ───────────────────────────────────────────────────────────────────

type OrderRow = {
  id: string; kind: string; status: string; currency: string; rate: number; total: number; total_inr: number;
  discount_inr: number; amount_minor: number; coupon_code: string | null; address: unknown; country: string | null;
  method: string; gateway_order_id: string | null; gateway_payment_id: string | null; created_at: Date;
  paid_at: Date | null; cancelled_at: Date | null; refunded_at: Date | null; price_lines: unknown;
};

type ItemRow = {
  id: number; order_id: string; kind: 'worksheet' | 'class'; product_id: string | null; class_id: string | null;
  plan_id: string | null; title: string; months: number | null; access_days: number | null; access_hours: number | null; unit_price_inr: number;
  discount_inr: number; product_class: string | null; price_inr: number | null;
  e_id: number | null; e_scope: 'worksheet' | 'class' | null; e_kind: 'free' | 'paid' | 'grant' | null;
  e_purchased_at: Date | null; e_starts_at: Date | null; e_expires_at: Date | null; e_revoked_at: Date | null;
};

/** The customer's orders as the website shows them (newest first): the old order shape, plus each
 *  line with its access record. Exported so payment routes can answer with the same shape. */
export async function orderViews(q: Tx, userId: string, orderIds?: string[], limit = 100) {
  const orders = orderIds
    ? await q<OrderRow[]>`
        select o.id, o.kind, o.status, o.currency, o.rate::float8 as rate, o.total::float8 as total,
               o.total_inr::float8 as total_inr, o.discount_inr::float8 as discount_inr, o.amount_minor,
               o.coupon_code::text as coupon_code, o.address, o.country, o.method, o.gateway_order_id,
               o.gateway_payment_id, o.created_at, o.paid_at, o.cancelled_at, o.refunded_at,
               qt.payload -> 'priceLines' as price_lines
        from orders o left join quotes qt on qt.id = o.quote_id
        where o.user_id = ${userId} and o.id = any(${orderIds}::text[])
        order by o.created_at desc, o.id
        limit ${limit}`
    : await q<OrderRow[]>`
        select o.id, o.kind, o.status, o.currency, o.rate::float8 as rate, o.total::float8 as total,
               o.total_inr::float8 as total_inr, o.discount_inr::float8 as discount_inr, o.amount_minor,
               o.coupon_code::text as coupon_code, o.address, o.country, o.method, o.gateway_order_id,
               o.gateway_payment_id, o.created_at, o.paid_at, o.cancelled_at, o.refunded_at,
               qt.payload -> 'priceLines' as price_lines
        from orders o left join quotes qt on qt.id = o.quote_id
        where o.user_id = ${userId}
        order by o.created_at desc, o.id
        limit ${limit}`;
  if (!orders.length) return [];
  const ids = orders.map((o) => o.id);
  const items = await q<ItemRow[]>`
    select it.id, it.order_id, it.kind, it.product_id, it.class_id, it.plan_id, it.title, it.months, it.access_days, it.access_hours,
           it.unit_price_inr, it.discount_inr::float8 as discount_inr, pr.class_id as product_class, pr.price_inr,
           e.id as e_id, e.scope as e_scope, e.kind as e_kind, e.purchased_at as e_purchased_at,
           e.starts_at as e_starts_at, e.expires_at as e_expires_at, e.revoked_at as e_revoked_at
    from order_items it
    left join products pr on pr.id = it.product_id
    left join entitlements e on e.order_item_id = it.id and e.user_id = ${userId}
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
          id: it.e_id, user_id: userId, scope: it.e_scope!, product_id: it.product_id, class_id: it.e_scope === 'class' ? it.class_id : null,
          plan_id: it.plan_id, kind: it.e_kind!, order_id: o.id, purchased_at: it.e_purchased_at!, starts_at: it.e_starts_at!,
          expires_at: it.e_expires_at, revoked_at: it.e_revoked_at, revoke_reason: null,
        };
        const status = entStatus(e, it.price_inr);
        entitlement = {
          id: it.e_id,
          purchasedAt: ms(it.e_purchased_at),
          startsAt: ms(it.e_starts_at),
          end: ms(it.e_expires_at),
          expiresAt: iso(it.e_expires_at),
          status,
          active: status === 'active',
        };
      }
      return {
        kind: it.kind,
        worksheet: it.product_id,
        cls: it.class_id ?? it.product_class,
        plan: it.plan_id,
        title: it.title,
        months: it.months,
        accessDays: it.access_days, accessHours: it.access_hours,
        unitPriceInr: it.unit_price_inr,
        discountInr: it.discount_inr,
        entitlement,
      };
    });
    return {
      // the old order shape
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
      // new
      lines,
      priceLines: Array.isArray(o.price_lines) ? o.price_lines : [],
      amountMinor: o.amount_minor,
      discountInr: o.discount_inr,
      country: o.country,
      cancelledAt: ms(o.cancelled_at),
      refundedAt: ms(o.refunded_at),
    };
  });
}

async function myOrders(ctx: Ctx) {
  const u = await requireUser(ctx);
  const orders = await tx((q) => orderViews(q, u.id));
  return { orders };
}

// ── GET /api/me/entitlements ─────────────────────────────────────────────────────────────

type MyEntRow = EntRow & { class_name: string | null; plan_label: string | null; plan_months: number | null };

async function myEntitlements(ctx: Ctx) {
  const u = await requireUser(ctx);
  const s = await getSettings();
  const rows = await tx((q) => q<MyEntRow[]>`
    select e.id, e.user_id, e.scope, e.product_id, e.class_id, e.plan_id, e.kind, e.order_id, e.purchased_at,
           e.starts_at, e.expires_at, e.revoked_at, null::text as revoke_reason,
           pr.title, pr.price_inr, pr.class_id as product_class,
           c.name as class_name, pl.label as plan_label, pl.months as plan_months
    from entitlements e
    left join products pr on pr.id = e.product_id
    left join classes c on c.id = coalesce(e.class_id, pr.class_id)
    left join plans pl on pl.id = e.plan_id
    where e.user_id = ${u.id}
    order by e.starts_at desc, e.id desc
    limit 500`);
  // every record (active, scheduled, expired, revoked, lapsed); `status` and `active` say which
  const entitlements = rows.map((e) => ({
    ...pubEntitlement(e, e.scope === 'worksheet' ? e.price_inr : null),
    className: e.class_name,
    planLabel: e.plan_label,
    months: e.plan_months,
  }));
  return {
    entitlements,
    now: Date.now(),
    accessDays: accessDaysFor(s, null),
    accessHours: accessHoursFor(s, null),
    accessStatus: u.profile.subscription_suspended_at ? 'suspended' : 'active',
  };
}

export function register(r: Router) {
  r.get('/api/worksheets', catalogue);
  r.post('/api/quote', quote);
  r.get('/api/me/orders', myOrders);
  r.get('/api/me/entitlements', myEntitlements);
}
