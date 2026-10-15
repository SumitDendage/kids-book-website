// Numbers for the staff dashboard and the Analytics page, computed from real rows only:
// analytics_events (visits and shop events), orders (sales and refunds), profiles (sign-ups) and
// access_log (sheet opens). Nothing is estimated or filled in: a rate whose base is zero is null,
// and an empty period says so.
//
// Days are calendar days in the requested IANA time zone (India by default), so an order paid at
// 20:00 UTC on 1 October counts on 2 October in IST. Range bounds are resolved by Postgres, which
// knows the same time-zone database and handles daylight-saving changes.
import type { Tx } from '../lib/db.ts';
import { HttpError } from '../lib/http.ts';
import { isTimeZone } from '../lib/util.ts';

export const DEFAULT_TZ = 'Asia/Kolkata';
export const MAX_RANGE_DAYS = 366;
const DEFAULT_DAYS = 30;

export type RangeInput = { from?: string | null; to?: string | null; tz?: string | null; days?: string | null };
export type Range = { from: Date; to: Date; tz: string; days: string[] };

type Bound = { date: string | null; at: Date | null };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:?\d{2})$/;

const bad = (field: string, message: string) => new HttpError(400, message, { code: 'bad_range', errors: { [field]: message } });
const UNKNOWN_ZONE = 'This time zone is not known to the database — use another name for it.';

/** The time zone from a query value: a valid IANA name, or the default when missing. */
export function tzOf(v: string | null | undefined): string {
  const t = (v ?? '').trim();
  if (!t) return DEFAULT_TZ;
  if (!isTimeZone(t)) throw bad('tz', 'Use an IANA time zone such as Asia/Kolkata or UTC.');
  return t;
}

/** Postgres refuses a zone name the browser's list knows but its own does not (SQLSTATE 22023). */
function zoneError(e: unknown): unknown {
  return (e as { code?: string }).code === '22023' ? bad('tz', UNKNOWN_ZONE) : e;
}

/** A range end: a calendar day (YYYY-MM-DD, read in the time zone), an ISO time with a zone, or epoch ms. */
function boundOf(v: string | null | undefined, field: string): Bound {
  const s = (v ?? '').trim();
  if (!s) return { date: null, at: null };
  if (DATE_RE.test(s)) {
    const d = new Date(s + 'T00:00:00Z');
    if (!Number.isFinite(d.getTime()) || d.toISOString().slice(0, 10) !== s) throw bad(field, 'Use a real date like 2026-10-07.');
    const y = d.getUTCFullYear();
    if (y < 2000 || y > 2100) throw bad(field, 'Use a date between 2000 and 2100.');
    return { date: s, at: null };
  }
  let d: Date | null = null;
  if (ISO_RE.test(s)) d = new Date(s);
  else if (/^\d{10,14}$/.test(s)) d = new Date(Number(s));
  if (!d || !Number.isFinite(d.getTime())) throw bad(field, 'Use a date like 2026-10-07 or a time like 2026-10-07T18:30:00Z.');
  const y = d.getUTCFullYear();
  if (y < 2000 || y > 2100) throw bad(field, 'Use a date between 2000 and 2100.');
  return { date: null, at: d };
}

/** Validates the query and resolves it to UTC instants plus the list of local days.
 *  `to` given as a day is inclusive (the whole day). Default: the last 30 days including today. */
export async function resolveRange(q: Tx, input: RangeInput, o: { defaultDays?: number; maxDays?: number } = {}): Promise<Range> {
  const tz = tzOf(input.tz);
  const maxDays = o.maxDays ?? MAX_RANGE_DAYS;
  const from = boundOf(input.from, 'from');
  const to = boundOf(input.to, 'to');
  let days = o.defaultDays ?? DEFAULT_DAYS;
  if (input.days != null && input.days !== '') {
    const n = /^\d{1,4}$/.test(input.days.trim()) ? Number(input.days.trim()) : NaN;
    if (!Number.isInteger(n) || n < 1 || n > maxDays) throw bad('days', `Days must be a whole number from 1 to ${maxDays}.`);
    days = n;
  }
  let rows: { f: Date; t: Date; span_days: number; days: string[] }[];
  try {
    rows = await q`
      with b as (
        select case
          when ${to.at}::timestamptz is not null then ${to.at}::timestamptz
          else ((coalesce(${to.date}::date, (now() at time zone ${tz}::text)::date) + 1)::timestamp at time zone ${tz}::text)
        end as t
      ), r as (
        select b.t,
          case
            when ${from.at}::timestamptz is not null then ${from.at}::timestamptz
            when ${from.date}::date is not null then (${from.date}::date::timestamp at time zone ${tz}::text)
            else ((((b.t - interval '1 microsecond') at time zone ${tz}::text)::date - ${days - 1}::int)::timestamp at time zone ${tz}::text)
          end as f
        from b
      )
      select r.f, r.t, extract(epoch from (r.t - r.f))::float8 / 86400 as span_days,
        case when r.t > r.f and r.t - r.f <= make_interval(days => ${maxDays + 1}::int) then
          array(select d::date::text from generate_series(
            (r.f at time zone ${tz}::text)::date::timestamp,
            ((r.t - interval '1 microsecond') at time zone ${tz}::text)::date::timestamp,
            interval '1 day') d)
        else '{}'::text[] end as days
      from r`;
  } catch (e) {
    // a zone the browser knows but this Postgres does not
    throw zoneError(e);
  }
  const r = rows[0];
  if (!(r.t > r.f)) throw bad('to', 'The end of the range must be after its start.');
  // a little slack for daylight-saving days (23 or 25 hours)
  if (r.span_days > maxDays + 0.1 || r.days.length > maxDays) throw bad('from', `Choose a range of at most ${maxDays} days.`);
  return { from: new Date(r.f), to: new Date(r.t), tz, days: r.days };
}

export type Bounds = { from: Date | null; to: Date | null; tz: string };

/** Optional from/to for exports and log filters: same formats as resolveRange (a day is read in
 *  the time zone, `to` as a day includes that whole day), but no default range and no length cap.
 *  Missing ends stay null (no limit on that side). */
export async function resolveBounds(q: Tx, input: { from?: string | null; to?: string | null; tz?: string | null }): Promise<Bounds> {
  const tz = tzOf(input.tz);
  const from = boundOf(input.from, 'from');
  const to = boundOf(input.to, 'to');
  if (!from.date && !from.at && !to.date && !to.at) return { from: null, to: null, tz };
  let rows: { f: Date | null; t: Date | null }[];
  try {
    rows = await q`
      select
        coalesce(${from.at}::timestamptz, (${from.date}::date::timestamp at time zone ${tz}::text)) as f,
        coalesce(${to.at}::timestamptz, ((${to.date}::date + 1)::timestamp at time zone ${tz}::text)) as t`;
  } catch (e) {
    throw zoneError(e);
  }
  const f = rows[0].f ? new Date(rows[0].f) : null;
  const t = rows[0].t ? new Date(rows[0].t) : null;
  if (f && t && !(t > f)) throw bad('to', 'The end of the range must be after its start.');
  return { from: f, to: t, tz };
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const pct = (num: number, den: number) => (den > 0 ? round2((num / den) * 100) : null);

type DayEvents = { day: string | null; g: number; visitors: number; page_views: number; product_views: number; checkout_starts: number; searches: number; checkout_visitors: number; bots: number };
type DayOrders = { day: string | null; g: number; created: number; paid: number; gross_inr: number; net_inr: number; refunds: number; refunded_inr: number; buyers: number };
type DaySignups = { day: string | null; g: number; signups: number; verified: number };
type DayOpens = { day: string | null; g: number; opens: number; openers: number };

/** The Analytics page: totals, conversion, a row per local day, top products, countries, sources. */
export async function analyticsReport(q: Tx, range: Range) {
  const { from: f, to: t, tz } = range;

  // Visits and shop events. Bots are left out of every visitor number; one browser = one visitor id.
  const ev = await q<DayEvents[]>`
    select s.day::text as day, grouping(s.day)::int as g,
      count(distinct s.visitor_id) filter (where not s.bot)::int as visitors,
      count(*) filter (where s.kind = 'page_view' and not s.bot)::int as page_views,
      count(*) filter (where s.kind = 'product_view' and not s.bot)::int as product_views,
      count(*) filter (where s.kind = 'checkout_start' and not s.bot)::int as checkout_starts,
      count(*) filter (where s.kind = 'search' and not s.bot)::int as searches,
      count(distinct s.visitor_id) filter (where s.kind = 'checkout_start' and not s.bot)::int as checkout_visitors,
      count(*) filter (where s.bot)::int as bots
    from (
      select (e.at at time zone ${tz}::text)::date as day, e.kind, e.visitor_id, coalesce(e.device = 'bot', false) as bot
      from analytics_events e
      where e.at >= ${f} and e.at < ${t}
    ) s
    group by grouping sets ((s.day), ())`;

  // Orders: created (any outcome), paid (by payment time; net excludes later refunds), refunded.
  const od = await q<DayOrders[]>`
    select s.day::text as day, grouping(s.day)::int as g,
      sum(s.created)::int as created, sum(s.paid)::int as paid,
      round(coalesce(sum(s.gross), 0), 2)::float8 as gross_inr, round(coalesce(sum(s.net), 0), 2)::float8 as net_inr,
      sum(s.refunded)::int as refunds, round(coalesce(sum(s.refunded_inr), 0), 2)::float8 as refunded_inr,
      count(distinct s.buyer)::int as buyers
    from (
      select (o.created_at at time zone ${tz}::text)::date as day, 1 as created, 0 as paid, 0::numeric as gross, 0::numeric as net,
             0 as refunded, 0::numeric as refunded_inr, null::uuid as buyer
      from orders o where o.created_at >= ${f} and o.created_at < ${t}
      union all
      select (o.paid_at at time zone ${tz}::text)::date, 0, 1, o.total_inr,
             case when o.status = 'paid' then o.total_inr else 0 end, 0, 0, o.user_id
      from orders o where o.paid_at >= ${f} and o.paid_at < ${t} and o.status in ('paid', 'refunded')
      union all
      select (o.refunded_at at time zone ${tz}::text)::date, 0, 0, 0, 0, 1, o.total_inr, null
      from orders o where o.refunded_at >= ${f} and o.refunded_at < ${t} and o.status = 'refunded'
    ) s
    group by grouping sets ((s.day), ())`;

  // Customer sign-ups (staff accounts are not customers).
  const su = await q<DaySignups[]>`
    select s.day::text as day, grouping(s.day)::int as g, count(*)::int as signups, count(*) filter (where s.verified)::int as verified
    from (
      select (p.created_at at time zone ${tz}::text)::date as day, p.email_verified_at is not null as verified
      from profiles p
      where p.created_at >= ${f} and p.created_at < ${t} and p.created_via <> 'staff'
        and not exists (select 1 from staff_members sm where sm.user_id = p.id)
    ) s
    group by grouping sets ((s.day), ())`;

  // Sheets opened in the viewer (allowed opens only).
  const op = await q<DayOpens[]>`
    select s.day::text as day, grouping(s.day)::int as g, count(*)::int as opens, count(distinct s.user_id)::int as openers
    from (
      select (a.at at time zone ${tz}::text)::date as day, a.user_id
      from access_log a where a.at >= ${f} and a.at < ${t} and a.action = 'access' and a.ok
    ) s
    group by grouping sets ((s.day), ())`;

  const topProducts = await q<{ id: string; title: string; units: number; revenue_inr: number; buyers: number; views: number }[]>`
    with sold as (
      select it.product_id as id, max(it.title) as title, count(*)::int as units,
             round(sum(it.unit_price_inr - it.discount_inr), 2)::float8 as revenue_inr, count(distinct o.user_id)::int as buyers
      from order_items it join orders o on o.id = it.order_id
      where it.kind = 'worksheet' and o.status = 'paid' and o.paid_at >= ${f} and o.paid_at < ${t}
      group by it.product_id
      order by units desc, revenue_inr desc, it.product_id
      limit 10
    )
    select sold.*, (select count(*)::int from analytics_events e
                    where e.kind = 'product_view' and e.product_id = sold.id and e.at >= ${f} and e.at < ${t}
                      and e.device is distinct from 'bot') as views
    from sold order by units desc, revenue_inr desc, id`;

  const mostViewed = await q<{ id: string; title: string | null; views: number; visitors: number }[]>`
    select e.product_id as id, p.title, count(*)::int as views, count(distinct e.visitor_id)::int as visitors
    from analytics_events e left join products p on p.id = e.product_id
    where e.kind = 'product_view' and e.product_id is not null and e.at >= ${f} and e.at < ${t}
      and e.device is distinct from 'bot'
    group by e.product_id, p.title
    order by views desc, e.product_id
    limit 10`;

  const topPlans = await q<{ cls: string; plan: string; units: number; revenue_inr: number }[]>`
    select it.class_id as cls, it.plan_id as plan, count(*)::int as units,
           round(sum(it.unit_price_inr - it.discount_inr), 2)::float8 as revenue_inr
    from order_items it join orders o on o.id = it.order_id
    where it.kind = 'class' and o.status = 'paid' and o.paid_at >= ${f} and o.paid_at < ${t}
    group by it.class_id, it.plan_id
    order by units desc, revenue_inr desc, it.class_id, it.plan_id
    limit 10`;

  const byCountry = await q<{ country: string; visitors: number; paid_orders: number; revenue_inr: number }[]>`
    select coalesce(s.country, 'unknown') as country, sum(s.visitors)::int as visitors,
           sum(s.paid_orders)::int as paid_orders, round(coalesce(sum(s.revenue), 0), 2)::float8 as revenue_inr
    from (
      select e.country, count(distinct e.visitor_id) as visitors, 0 as paid_orders, 0::numeric as revenue
      from analytics_events e
      where e.at >= ${f} and e.at < ${t} and e.device is distinct from 'bot'
      group by e.country
      union all
      select o.country, 0, count(*), sum(o.total_inr)
      from orders o where o.status = 'paid' and o.paid_at >= ${f} and o.paid_at < ${t}
      group by o.country
    ) s
    group by coalesce(s.country, 'unknown')
    having sum(s.visitors) > 0 or sum(s.paid_orders) > 0
    order by revenue_inr desc, visitors desc, country
    limit 50`;

  const referrers = await q<{ host: string; visitors: number; page_views: number }[]>`
    select coalesce(e.referrer_host, 'direct') as host, count(distinct e.visitor_id)::int as visitors, count(*)::int as page_views
    from analytics_events e
    where e.kind = 'page_view' and e.at >= ${f} and e.at < ${t} and e.device is distinct from 'bot'
    group by coalesce(e.referrer_host, 'direct')
    order by visitors desc, page_views desc, host
    limit 15`;

  const devices = await q<{ device: string; visitors: number }[]>`
    select coalesce(e.device, 'unknown') as device, count(distinct e.visitor_id)::int as visitors
    from analytics_events e
    where e.at >= ${f} and e.at < ${t} and e.device is distinct from 'bot'
    group by coalesce(e.device, 'unknown')
    order by visitors desc, device`;

  const total = <T extends { g: number }>(rows: T[]) => rows.find((r) => r.g === 1);
  const perDay = <T extends { g: number; day: string | null }>(rows: T[]) => new Map(rows.filter((r) => r.g === 0 && r.day).map((r) => [r.day!, r]));
  const evT = total(ev), odT = total(od), suT = total(su), opT = total(op);
  const evD = perDay(ev), odD = perDay(od), suD = perDay(su), opD = perDay(op);

  const totals = {
    visitors: evT?.visitors ?? 0,
    pageViews: evT?.page_views ?? 0,
    productViews: evT?.product_views ?? 0,
    checkoutStarts: evT?.checkout_starts ?? 0,
    checkoutVisitors: evT?.checkout_visitors ?? 0,
    searches: evT?.searches ?? 0,
    botEvents: evT?.bots ?? 0,
    signups: suT?.signups ?? 0,
    verifiedSignups: suT?.verified ?? 0,
    ordersCreated: odT?.created ?? 0,
    paidOrders: odT?.paid ?? 0,
    buyers: odT?.buyers ?? 0,
    revenueInr: odT?.net_inr ?? 0,
    grossRevenueInr: odT?.gross_inr ?? 0,
    refunds: odT?.refunds ?? 0,
    refundedInr: odT?.refunded_inr ?? 0,
    sheetOpens: opT?.opens ?? 0,
    averageOrderInr: odT && odT.paid > 0 ? round2(odT.gross_inr / odT.paid) : null,
  };

  const byDay = range.days.map((day) => {
    const e = evD.get(day), o = odD.get(day), s = suD.get(day), a = opD.get(day);
    return {
      day,
      visitors: e?.visitors ?? 0,
      pageViews: e?.page_views ?? 0,
      productViews: e?.product_views ?? 0,
      checkoutStarts: e?.checkout_starts ?? 0,
      signups: s?.signups ?? 0,
      ordersCreated: o?.created ?? 0,
      paidOrders: o?.paid ?? 0,
      revenueInr: o?.net_inr ?? 0,
      grossRevenueInr: o?.gross_inr ?? 0,
      refunds: o?.refunds ?? 0,
      sheetOpens: a?.opens ?? 0,
    };
  });

  const hasData = Object.entries(totals).some(([k, v]) => k !== 'averageOrderInr' && typeof v === 'number' && v > 0);
  return {
    range: {
      from: range.from.getTime(), to: range.to.getTime(), fromIso: range.from.toISOString(), toIso: range.to.toISOString(),
      tz, days: range.days.length, firstDay: range.days[0] ?? null, lastDay: range.days[range.days.length - 1] ?? null,
    },
    totals,
    conversion: {
      // paid orders per 100 visitors, and per 100 checkout starts; null when there is nothing to divide by
      visitorsPct: pct(totals.paidOrders, totals.visitors),
      checkoutsPct: pct(totals.paidOrders, totals.checkoutStarts),
      signupsPct: pct(totals.signups, totals.visitors),
    },
    byDay,
    topProducts: topProducts.map((p) => ({ id: p.id, title: p.title, units: p.units, revenueInr: p.revenue_inr, buyers: p.buyers, views: p.views })),
    mostViewed: mostViewed.map((p) => ({ id: p.id, title: p.title, views: p.views, visitors: p.visitors })),
    topPlans: topPlans.map((p) => ({ cls: p.cls, plan: p.plan, units: p.units, revenueInr: p.revenue_inr })),
    byCountry: byCountry.map((c) => ({ country: c.country, visitors: c.visitors, paidOrders: c.paid_orders, revenueInr: c.revenue_inr })),
    referrers: referrers.map((r) => ({ host: r.host, visitors: r.visitors, pageViews: r.page_views })),
    devices: devices.map((d) => ({ device: d.device, visitors: d.visitors })),
    hasData,
    note: hasData ? null : 'No data for this period yet.',
    generatedAt: Date.now(),
  };
}

type StatsRow = {
  users: number; staff: number; paid_orders: number; revenue_inr: number; active_entitlements: number;
  active_plans: number; worksheets: number; with_pdf: number; opens_24h: number; messages: number; messages_unread: number;
  pending_orders: number; refunded_orders: number; refunded_inr: number; open_incidents: number; open_appeals: number;
  suspended_customers: number; blocked_customers: number; outbox_due: number; outbox_failed: number; pending_reviews: number;
  staff_unread: number; today_start: Date;
  today_paid: number; today_revenue: number; today_signups: number; today_visitors: number; hour_visitors: number;
  day_paid: number; day_revenue: number; day_signups: number; day_visitors: number;
};

/** The dashboard numbers: the old /api/admin/stats fields (all-time, from real rows) plus today's
 *  figures in the time zone and the last 14 days of sales for the chart. */
export async function dashboardStats(q: Tx, tz: string) {
  try {
    return await statsFor(q, tz);
  } catch (e) {
    throw zoneError(e);
  }
}

async function statsFor(q: Tx, tz: string) {
  const r = (await q<StatsRow[]>`
    with t as (select ((now() at time zone ${tz}::text)::date::timestamp at time zone ${tz}::text) as today_start)
    select t.today_start,
      (select count(*)::int from profiles p where not exists (select 1 from staff_members sm where sm.user_id = p.id)) as users,
      (select count(*)::int from staff_members where active) as staff,
      (select count(*)::int from orders where status = 'paid') as paid_orders,
      (select round(coalesce(sum(total_inr), 0), 2)::float8 from orders where status = 'paid') as revenue_inr,
      (select count(*)::int from entitlements e left join products p on p.id = e.product_id
        where e.revoked_at is null and e.starts_at <= now() and (e.expires_at is null or e.expires_at > now())
          and (e.kind <> 'free' or coalesce(p.price_inr, 0) = 0)) as active_entitlements,
      (select count(*)::int from entitlements e
        where e.scope = 'class' and e.revoked_at is null and e.starts_at <= now() and e.expires_at > now()) as active_plans,
      (select count(*)::int from products where status = 'active') as worksheets,
      (select count(*)::int from private.product_file_status() fs join products p on p.id = fs.product_id
        where p.status = 'active' and fs.has_pdf) as with_pdf,
      (select count(*)::int from access_log where action = 'access' and ok and at > now() - interval '24 hours') as opens_24h,
      (select count(*)::int from contact_messages) as messages,
      (select count(*)::int from contact_messages where read_at is null) as messages_unread,
      (select count(*)::int from orders where status = 'created') as pending_orders,
      (select count(*)::int from orders where status = 'refunded') as refunded_orders,
      (select round(coalesce(sum(total_inr), 0), 2)::float8 from orders where status = 'refunded') as refunded_inr,
      (select count(*)::int from security_incidents where status = 'open') as open_incidents,
      (select count(*)::int from account_appeals where status = 'open') as open_appeals,
      (select count(*)::int from profiles where subscription_suspended_at is not null) as suspended_customers,
      (select count(*)::int from profiles where blocked_at is not null) as blocked_customers,
      (select count(*)::int from email_outbox where not sensitive and status in ('queued', 'failed') and attempts < max_attempts) as outbox_due,
      (select count(*)::int from email_outbox where status = 'failed' and attempts >= max_attempts) as outbox_failed,
      (select count(*)::int from reviews where status = 'pending') as pending_reviews,
      (select count(*)::int from notifications where audience = 'staff' and read_at is null) as staff_unread,
      (select count(*)::int from orders where paid_at >= t.today_start and status in ('paid', 'refunded')) as today_paid,
      (select round(coalesce(sum(total_inr), 0), 2)::float8 from orders where paid_at >= t.today_start and status = 'paid') as today_revenue,
      (select count(*)::int from profiles p where p.created_at >= t.today_start and p.created_via <> 'staff'
        and not exists (select 1 from staff_members sm where sm.user_id = p.id)) as today_signups,
      (select count(distinct visitor_id)::int from analytics_events where at >= t.today_start and device is distinct from 'bot') as today_visitors,
      (select count(distinct visitor_id)::int from analytics_events where at >= now() - interval '1 hour' and device is distinct from 'bot') as hour_visitors,
      (select count(*)::int from orders where paid_at >= now() - interval '24 hours' and status in ('paid', 'refunded')) as day_paid,
      (select round(coalesce(sum(total_inr), 0), 2)::float8 from orders where paid_at >= now() - interval '24 hours' and status = 'paid') as day_revenue,
      (select count(*)::int from profiles p where p.created_at >= now() - interval '24 hours' and p.created_via <> 'staff'
        and not exists (select 1 from staff_members sm where sm.user_id = p.id)) as day_signups,
      (select count(distinct visitor_id)::int from analytics_events where at >= now() - interval '24 hours' and device is distinct from 'bot') as day_visitors
    from t`)[0];

  const days = await q<{ day: string; paid: number; revenue_inr: number }[]>`
    with d as (
      select generate_series(((now() at time zone ${tz}::text)::date - 13)::timestamp, (now() at time zone ${tz}::text)::date::timestamp,
                             interval '1 day')::date as day
    )
    select d.day::text as day, count(o.id)::int as paid, round(coalesce(sum(o.total_inr) filter (where o.status = 'paid'), 0), 2)::float8 as revenue_inr
    from d left join orders o
      on o.paid_at >= (d.day::timestamp at time zone ${tz}::text)
     and o.paid_at < ((d.day + 1)::timestamp at time zone ${tz}::text)
     and o.status in ('paid', 'refunded')
    group by d.day order by d.day`;

  return {
    // the old /api/admin/stats fields
    users: r.users,
    paid_orders: r.paid_orders,
    revenue_inr: r.revenue_inr,
    active_entitlements: r.active_entitlements,
    worksheets: r.worksheets,
    with_pdf: r.with_pdf,
    opens_24h: r.opens_24h,
    messages: r.messages,
    messages_unread: r.messages_unread,
    // new
    tz,
    staff: r.staff,
    activePlans: r.active_plans,
    pendingOrders: r.pending_orders,
    refundedOrders: r.refunded_orders,
    refundedInr: r.refunded_inr,
    openIncidents: r.open_incidents,
    openAppeals: r.open_appeals,
    suspendedCustomers: r.suspended_customers,
    blockedCustomers: r.blocked_customers,
    emailsWaiting: r.outbox_due,
    emailsFailed: r.outbox_failed,
    pendingReviews: r.pending_reviews,
    unreadNotifications: r.staff_unread,
    today: {
      start: new Date(r.today_start).getTime(),
      paidOrders: r.today_paid, revenueInr: r.today_revenue, signups: r.today_signups, visitors: r.today_visitors,
      visitorsLastHour: r.hour_visitors,
    },
    last24h: { paidOrders: r.day_paid, revenueInr: r.day_revenue, signups: r.day_signups, visitors: r.day_visitors },
    revenueByDay: days.map((d) => ({ day: d.day, paidOrders: d.paid, revenueInr: d.revenue_inr })),
  };
}
