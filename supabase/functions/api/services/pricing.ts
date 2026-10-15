// Prices and quotes: the only place a price is computed. Base prices are whole rupees from the
// database (products, plans, class discounts, coupons); countries, tax, fees and exchange rates
// come from settings. A quote is stored in `quotes` and the browser only ever sends back its id,
// so the amount checkout charges is exactly what the server worked out here.
import type { Tx } from '../lib/db.ts';
import type { Ctx } from '../lib/context.ts';
import { DEFAULTS, getSettings, type Country, type Settings } from '../lib/settings.ts';
import { gatewayModes } from '../lib/env.ts';
import { HttpError } from '../lib/http.ts';
import { cleanText, decimals, fmtDateTime, minorUnits, roundMoney } from '../lib/util.ts';
import { hasPdf, ownsSheet } from './entitlements.ts';

export type QuoteLine = {
  kind: 'worksheet' | 'class';
  productId: string | null;
  classId: string | null;
  planId: string | null;
  title: string;
  months: number | null;       // class plans
  accessDays: number | null;   // worksheets (product.access_days ?? settings.worksheet_access.days)
  unitPriceInr: number;        // before discounts
  discountInr: number;         // coupon + plan/class discount on this line
};

/** One row of the price breakdown the checkout shows (base, tax, fee). */
export type PriceLine = { label: string; amount: number; note: string };

export type QuoteAddress = { country: string; line1: string; city: string; state: string; postal: string };

/** A stored quote (table quotes), as checkout reads it. */
export type StoredQuote = {
  id: string;
  expiresAt: Date;
  kind: 'worksheet' | 'class';
  country: string;
  currency: string;
  rate: number;                // currency units per INR
  total: number;               // in `currency`, what the customer pays (tax and fees included)
  totalInr: number;
  discountInr: number;
  amountMinor: number;         // total in the currency's minor units (paise, cents)
  couponCode: string | null;
  methods: string[];           // gateways allowed for the country and configured on the server
  lines: QuoteLine[];
  valid: boolean;
  // Extra details (optional, for the order and the gateway's description)
  title?: string;              // e.g. "Alphabet C — tracing sheet" or "Kindergarten plan · 3 months"
  countryName?: string;
  region?: 'IN' | 'INTL';
  address?: QuoteAddress | null;
  priceLines?: PriceLine[];
  usedAt?: Date | null;
  usedByOrder?: string | null;
};

export const PAYMENT_METHODS = ['razorpay', 'stripe', 'paypal'] as const;
export const STALE_QUOTE = 'This quote is not valid any more — refresh the price and try again.';
/** The most sheets one order (and the cart) can hold. */
export const MAX_SHEETS_PER_ORDER = 50;
export const OWNED_MESSAGE = 'This sheet is already on your account. Open it from My Worksheets.';
export const FREE_MESSAGE = 'This sheet is free. Just open it, there is nothing to pay.';

const PRODUCT_RE = /^[A-Za-z0-9][A-Za-z0-9-]{1,63}$/;
const CLASS_RE = /^[a-z0-9]{1,12}$/;
const PLAN_RE = /^[a-z0-9]{1,8}$/;
const COUPON_RE = /^[A-Za-z0-9_-]{3,32}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// A coupon on an unpaid order holds one use for as long as the gateway can still take the payment:
// until the order is paid, cancelled or failed, or until housekeeping marks it expired (2 days).
// private.fulfil_order checks the limits again when the code is actually redeemed.
const COUPON_HOLD_HOURS = 48;

// ── countries ────────────────────────────────────────────────────────────────────────────

// Used only when the countries setting is missing or broken, so checkout keeps working.
const FALLBACK_OTHER: Country = {
  code: 'OTHER', name: 'Other country', currency: 'USD', tax: { label: 'Tax', pct: 0 },
  postal: { label: 'Postal / ZIP code', hint: '3–10 characters', pattern: '^[A-Z\\d \\-]{3,10}$', flags: 'i' },
  state: 'State / region', states: null, methods: ['razorpay', 'stripe', 'paypal'],
};
const FALLBACK_IN: Country = {
  code: 'IN', name: 'India', currency: 'INR', tax: { label: 'GST 18%', pct: 18 },
  postal: { label: 'PIN code', hint: '6 digits, e.g. 411001', pattern: '^[1-9][0-9]{5}$', flags: '' },
  state: 'State', states: null, methods: ['razorpay', 'paypal', 'stripe'],
};

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown, max = 200) => (typeof v === 'string' ? v.slice(0, max) : '');

/** A country from settings, checked field by field (a bad staff edit must not break checkout). */
function cleanCountry(v: unknown): Country | null {
  if (!isObj(v)) return null;
  const code = str(v.code, 8).toUpperCase();
  const currency = str(v.currency, 3).toUpperCase();
  if (!/^[A-Z]{2}$|^OTHER$/.test(code) || !/^[A-Z]{3}$/.test(currency)) return null;
  const tax = isObj(v.tax) ? v.tax : {};
  const pct = typeof tax.pct === 'number' && Number.isFinite(tax.pct) ? Math.min(100, Math.max(0, tax.pct)) : 0;
  const postal = isObj(v.postal) ? v.postal : {};
  const methods = Array.isArray(v.methods) ? v.methods.filter((m): m is string => (PAYMENT_METHODS as readonly unknown[]).includes(m)) : [...PAYMENT_METHODS];
  const states = Array.isArray(v.states) ? v.states.filter((s): s is string => typeof s === 'string' && s.length > 0).map((s) => s.slice(0, 80)) : null;
  return {
    code,
    name: str(v.name, 80) || code,
    currency,
    tax: { label: str(tax.label, 60) || 'Tax', pct },
    postal: {
      label: str(postal.label, 60) || 'Postal code',
      hint: str(postal.hint, 80),
      pattern: str(postal.pattern, 200),
      flags: str(postal.flags, 4).replace(/[^imsu]/g, ''),
    },
    state: str(v.state, 40) || 'State',
    states: states && states.length ? states : null,
    methods,
  };
}

const countryCache = new WeakMap<Settings, Country[]>();

/** Every country offered at checkout (never empty; always ends with OTHER). */
export function countryList(s: Settings): Country[] {
  const hit = countryCache.get(s);
  if (hit) return hit;
  const seen = new Set<string>();
  const list: Country[] = [];
  for (const raw of Array.isArray(s.countries) ? s.countries : []) {
    const c = cleanCountry(raw);
    if (c && !seen.has(c.code)) { seen.add(c.code); list.push(c); }
  }
  if (!seen.has('IN')) list.unshift(FALLBACK_IN);
  if (!seen.has('OTHER')) list.push(FALLBACK_OTHER);
  countryCache.set(s, list);
  return list;
}

/** The country for a code; unknown or missing codes are priced as OTHER (as the old site did). */
export function countryFor(s: Settings, code: string | null | undefined): Country {
  const list = countryList(s);
  const want = String(code ?? '').trim().toUpperCase();
  return list.find((c) => c.code === want) ?? list.find((c) => c.code === 'OTHER') ?? FALLBACK_OTHER;
}

export const regionOf = (c: Pick<Country, 'code'>): 'IN' | 'INTL' => (c.code === 'IN' ? 'IN' : 'INTL');

/** Currency units per rupee, or null when the rate is missing or not a sane number. */
export function rateFor(s: Settings, currency: string): number | null {
  if (currency === 'INR') return 1;
  const r = Number((s.currency_rates as Record<string, unknown>)[currency]);
  return Number.isFinite(r) && r > 0 && r < 1_000_000 ? r : null;
}

/** Days a bought sheet stays open: the product's own number, else the site-wide setting. */
export function accessDaysFor(s: Settings, productDays: number | null | undefined): number {
  if (Number.isInteger(productDays) && productDays! >= 1 && productDays! <= 3650) return productDays!;
  const d = Math.round(Number(s.worksheet_access.days));
  return d >= 1 && d <= 3650 ? d : DEFAULTS.worksheet_access.days;
}

/** The gateways a customer in this country may use right now (allowed there AND configured). */
export function methodsFor(c: Country): string[] {
  const modes = gatewayModes();
  return c.methods.filter((m) => !!modes[m as keyof typeof modes]);
}

// ── money ────────────────────────────────────────────────────────────────────────────────

const clampNum = (v: number, min: number, max: number) => (Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : min);

/** Prices exactly as the old site's text did ("$0.30", "¥45"). */
function fmtEn(n: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency, maximumFractionDigits: decimals(currency) }).format(n);
  } catch {
    return `${currency} ${n}`;
  }
}

/** Class discount, then plan discount, then coupon — each on what is left (rupees, unrounded). */
function rawDiscount(priceInr: number, classPct: number, planPct: number, couponPct: number): number {
  let d = 0;
  if (classPct > 0) d += priceInr * clampNum(classPct, 0, 100) / 100;
  if (planPct > 0) d += (priceInr - d) * clampNum(planPct, 0, 100) / 100;
  if (couponPct > 0) d += (priceInr - d) * clampNum(couponPct, 0, 100) / 100;
  return Math.min(priceInr, Math.max(0, d));
}

type Priced = {
  currency: string; rate: number; base: number; tax: number; fee: number; total: number;
  totalInr: number; amountMinor: number; discountInr: number; priceLines: PriceLine[];
};

/** base → tax → fee → total, in the customer's currency (same formula as the old site). */
function priceIn(s: Settings, c: Country, rate: number, listInr: number, discount: number): Priced {
  const currency = c.currency;
  const india = c.code === 'IN';
  const netInr = Math.max(0, listInr - discount);
  const base = roundMoney(netInr * rate, currency);
  const taxPct = clampNum(c.tax.pct, 0, 100);
  const tax = roundMoney(base * taxPct / 100, currency);
  const inPct = clampNum(s.fees.IN.pct, 0, 50), inFixed = clampNum(s.fees.IN.fixed, 0, 10_000);
  const intlPct = clampNum(s.fees.INTL.pct, 0, 50), intlFixedUsd = clampNum(s.fees.INTL.fixed, 0, 1000);
  const usd = rateFor(s, 'USD') ?? DEFAULTS.currency_rates.USD;
  // the INTL fixed fee is set in US dollars; India's in rupees
  const intlFixed = intlFixedUsd * (currency === 'USD' ? 1 : rate / usd);
  const fee = india
    ? roundMoney(base * inPct / 100 + inFixed * rate, currency)
    : roundMoney(base * intlPct / 100 + intlFixed, currency);
  const total = roundMoney(base + tax + fee, currency);
  const priceLines: PriceLine[] = [
    {
      label: 'Base price' + (discount ? ' (after discount)' : ''),
      amount: base,
      note: discount ? 'List ' + fmtEn(roundMoney(listInr * rate, currency), currency) : (currency !== 'INR' ? 'converted from ₹' + listInr : ''),
    },
    { label: c.tax.label, amount: tax, note: taxPct ? `${taxPct}% of the base price` : 'No tax collected for this region' },
    {
      label: 'Platform & payment fee',
      amount: fee,
      note: india ? `${inPct}% + ₹${inFixed}` : `${intlPct}% + ${fmtEn(roundMoney(intlFixed, currency), currency)}`,
    },
  ];
  return {
    currency, rate, base, tax, fee, total,
    totalInr: roundMoney(total / rate, 'INR'),
    amountMinor: minorUnits(total, currency),
    discountInr: roundMoney(discount, 'INR'),
    priceLines,
  };
}

// ── what is being bought ─────────────────────────────────────────────────────────────────

type SaleProblem = { message: string; code: string };

type Item = {
  kind: 'worksheet' | 'class';
  productId: string | null;
  classId: string;
  className: string;
  planId: string | null;
  planLabel: string | null;
  planRegions: string[];
  months: number | null;
  title: string;
  priceInr: number;
  classPct: number;
  planPct: number;
  accessDays: number | null;
  problem: SaleProblem | null;   // set when it exists but cannot be sold right now
};

type ProductSaleRow = {
  id: string; title: string; class_id: string; price_inr: number; status: string; pdf_path: string | null;
  stock: number | null; access_days: number | null; class_name: string; class_status: string; class_pct: number;
};

/** A sheet as a thing to buy; null when it does not exist for customers (unknown, draft, hidden class). */
async function worksheetItem(q: Tx, s: Settings, id: string): Promise<Item | null> {
  if (!PRODUCT_RE.test(id)) return null;
  const r = await q<ProductSaleRow[]>`
    select p.id, p.title, p.class_id, p.price_inr, p.status, p.pdf_path, p.stock, p.access_days,
           c.name as class_name, c.status as class_status, c.discount_pct::float8 as class_pct
    from products p join classes c on c.id = p.class_id
    where p.id = ${id}`;
  const p = r[0];
  if (!p || p.status === 'draft' || p.class_status === 'hidden') return null;
  let problem: SaleProblem | null = null;
  if (p.status !== 'active') problem = { message: 'This sheet is no longer for sale.', code: 'unavailable' };
  else if (p.class_status !== 'available') problem = { message: `${p.class_name} sheets are coming soon — they are not for sale yet.`, code: 'unavailable' };
  else if (p.stock !== null && p.stock <= 0) problem = { message: 'This sheet is sold out.', code: 'unavailable' };
  else if (!(await hasPdf(q, p))) problem = { message: 'This sheet is being prepared — it is not for sale yet.', code: 'unavailable' };
  return {
    kind: 'worksheet', productId: p.id, classId: p.class_id, className: p.class_name, planId: null, planLabel: null,
    planRegions: [], months: null, title: p.title, priceInr: p.price_inr, classPct: Number(p.class_pct) || 0, planPct: 0,
    accessDays: accessDaysFor(s, p.access_days), problem,
  };
}

/** A class plan as a thing to buy; null when the class or plan does not exist for customers. */
async function planItem(q: Tx, classId: string, planId: string): Promise<Item | null> {
  if (!CLASS_RE.test(classId) || !PLAN_RE.test(planId)) return null;
  const c = (await q<{ id: string; name: string; status: string; pct: number }[]>`
    select id, name, status, discount_pct::float8 as pct from classes where id = ${classId}`)[0];
  const p = (await q<{ id: string; label: string; months: number; price_inr: number; pct: number; regions: string[]; active: boolean }[]>`
    select id, label, months, price_inr, discount_pct::float8 as pct, regions, active from plans where id = ${planId}`)[0];
  if (!c || c.status === 'hidden' || !p || !p.active) return null;
  const problem = c.status !== 'available' ? { message: `${c.name} is coming soon — its plans are not for sale yet.`, code: 'unavailable' } : null;
  return {
    kind: 'class', productId: null, classId: c.id, className: c.name, planId: p.id, planLabel: p.label,
    planRegions: p.regions ?? [], months: p.months, title: `${c.name} plan · ${p.label}`, priceInr: p.price_inr,
    classPct: Number(c.pct) || 0, planPct: Number(p.pct) || 0, accessDays: null, problem,
  };
}

/** "The 12 months plan is not offered in India — choose 1, 3 or 6 months." (old wording) */
async function regionMessage(q: Tx, item: Item, region: 'IN' | 'INTL', countryName: string): Promise<string> {
  const rows = await q<{ months: number }[]>`
    select months from plans where active and ${region} = any(regions) order by months, sort`;
  const months = [...new Set(rows.map((r) => r.months))];
  const where = region === 'IN' ? 'India' : countryName;
  if (!months.length) return `The ${item.planLabel} plan is not offered in ${where}.`;
  const list = months.length === 1 ? String(months[0]) : months.slice(0, -1).join(', ') + ' or ' + months[months.length - 1];
  return `The ${item.planLabel} plan is not offered in ${where} — choose ${list} month${months.length === 1 && months[0] === 1 ? '' : 's'}.`;
}

// ── coupons ──────────────────────────────────────────────────────────────────────────────

type CouponRow = {
  code: string; pct: number; max_uses: number; per_user_limit: number; applies_to: string; class_id: string | null;
  active: boolean; started: boolean; ended: boolean; class_name: string | null;
};

async function loadCoupon(q: Tx, code: string, lock: boolean): Promise<CouponRow | null> {
  if (!COUPON_RE.test(code)) return null;
  const rows = lock
    ? await q<CouponRow[]>`
        select c.code::text as code, c.pct::float8 as pct, c.max_uses, c.per_user_limit, c.applies_to, c.class_id, c.active,
               (c.valid_from is null or c.valid_from <= now()) as started,
               (c.valid_until is not null and c.valid_until <= now()) as ended,
               (select name from classes where id = c.class_id) as class_name
        from coupons c where c.code = ${code}::citext for update`
    : await q<CouponRow[]>`
        select c.code::text as code, c.pct::float8 as pct, c.max_uses, c.per_user_limit, c.applies_to, c.class_id, c.active,
               (c.valid_from is null or c.valid_from <= now()) as started,
               (c.valid_until is not null and c.valid_until <= now()) as ended,
               (select name from classes where id = c.class_id) as class_name
        from coupons c where c.code = ${code}::citext`;
  return rows[0] ?? null;
}

/** Why this coupon cannot be used on these items now (active, dates, kind, class), or null. */
function couponRuleProblem(c: CouponRow, items: Item[]): string | null {
  if (!c.active) return 'That code is not valid.';
  if (!c.started) return 'That code is not valid yet.';
  if (c.ended) return 'That code has expired.';
  for (const it of items) {
    if (c.applies_to === 'worksheet' && it.kind !== 'worksheet') return 'That code is only for single sheets.';
    if (c.applies_to === 'class' && it.kind !== 'class') return 'That code is only for class plans.';
    if (c.class_id && it.classId !== c.class_id) return `That code is only for ${c.class_name ?? c.class_id}.`;
  }
  return null;
}

type CouponUses = { used: number; held: number; mine: number; myHeld: number };

/** Uses so far: redeemed (or paid) orders, plus unpaid orders that still hold the code — the
 *  customer's own included, so one customer cannot open several discounted orders before paying. */
async function couponUses(q: Tx, code: string, userId: string | null): Promise<CouponUses> {
  const r = await q<{ used: number; held: number; mine: number; my_held: number }[]>`
    select
      (select count(*) from (
         select r.order_id from coupon_redemptions r where r.coupon_code = ${code}::citext
         union
         select o.id from orders o where o.coupon_code = ${code}::citext and o.status in ('paid', 'refunded')
       ) u)::int as used,
      (select count(*) from orders o
         where o.coupon_code = ${code}::citext and o.status = 'created'
           and o.created_at > now() - make_interval(hours => ${COUPON_HOLD_HOURS}))::int as held,
      (select count(*) from (
         select r.order_id from coupon_redemptions r where r.coupon_code = ${code}::citext and r.user_id = ${userId}::uuid
         union
         select o.id from orders o where o.coupon_code = ${code}::citext and o.user_id = ${userId}::uuid
           and (o.status in ('paid', 'refunded')
                or (o.status = 'created' and o.created_at > now() - make_interval(hours => ${COUPON_HOLD_HOURS})))
       ) m)::int as mine,
      (select count(*) from orders o
         where o.coupon_code = ${code}::citext and o.user_id = ${userId}::uuid and o.status = 'created'
           and o.created_at > now() - make_interval(hours => ${COUPON_HOLD_HOURS}))::int as my_held`;
  const x = r[0];
  return x ? { used: x.used, held: x.held, mine: x.mine, myHeld: x.my_held } : { used: 0, held: 0, mine: 0, myHeld: 0 };
}

const ON_UNPAID_ORDER = 'That code is already on an unpaid order of yours — finish paying that order, or cancel it, before using the code again.';

async function couponUsageProblem(q: Tx, c: CouponRow, userId: string | null): Promise<string | null> {
  if (c.max_uses <= 0 && (c.per_user_limit <= 0 || !userId)) return null;
  const u = await couponUses(q, c.code, userId);
  if (c.max_uses > 0 && u.used + u.held >= c.max_uses) return u.myHeld > 0 ? ON_UNPAID_ORDER : 'That code has been used up.';
  if (userId && c.per_user_limit > 0 && u.mine >= c.per_user_limit) return u.myHeld > 0 ? ON_UNPAID_ORDER : 'You have already used that code.';
  return null;
}

// ── addresses ────────────────────────────────────────────────────────────────────────────

function postalRe(c: Country): RegExp | null {
  if (!c.postal.pattern) return null;
  try { return new RegExp(c.postal.pattern, c.postal.flags); } catch { return null; }
}

/** Cleans the billing address. India needs the full address (GST); elsewhere street and city
 *  are enough — state and postal code are checked only when given (the checkout asks only for
 *  street and city outside India). Problems make the quote not payable; they are not errors. */
export function cleanAddress(raw: unknown, c: Country): { address: QuoteAddress; errors: Record<string, string> } {
  const a = isObj(raw) ? raw : {};
  const address: QuoteAddress = {
    country: c.code,
    line1: cleanText(a.line1, 200),
    city: cleanText(a.city, 80),
    state: cleanText(a.state, 80),
    postal: cleanText(a.postal, 12).toUpperCase(),
  };
  const errors: Record<string, string> = {};
  if (address.line1.length < 4) errors.line1 = 'Enter your street address.';
  if (address.city.length < 2) errors.city = 'Enter your city.';
  const strict = c.code === 'IN';
  const stateWord = c.state.toLowerCase();
  if (c.states) {
    if ((strict || address.state) && !c.states.includes(address.state)) errors.state = `Choose your ${stateWord}.`;
  } else if (strict && !address.state) {
    errors.state = `Enter your ${stateWord}.`;
  }
  const re = postalRe(c);
  if (re && (strict || address.postal) && !re.test(address.postal)) {
    errors.postal = `${c.postal.label} — ${c.postal.hint}.`;
  }
  return { address, errors };
}

// ── expiry wording for the checkout ──────────────────────────────────────────────────────

function addMonthsUtc(d: Date, n: number): Date {
  const out = new Date(d.getTime());
  const day = out.getUTCDate();
  out.setUTCDate(1);
  out.setUTCMonth(out.getUTCMonth() + n);
  const last = new Date(Date.UTC(out.getUTCFullYear(), out.getUTCMonth() + 1, 0)).getUTCDate();
  out.setUTCDate(Math.min(day, last));
  return out;
}

function expiryText(item: Item, startsAt: Date, tz: string | null): { expiry: string; startsAt: number; endsAt: number } {
  const now = Date.now();
  if (item.kind === 'worksheet') {
    const days = item.accessDays ?? DEFAULTS.worksheet_access.days;
    const end = new Date(now + days * 86_400_000);
    return { expiry: `Open for ${days} days from payment — until ${fmtDateTime(end, tz)} if you pay now.`, startsAt: now, endsAt: end.getTime() };
  }
  const months = item.months ?? 1;
  const end = addMonthsUtc(startsAt, months);
  const span = `${months} month${months === 1 ? '' : 's'}`;
  if (startsAt.getTime() > now + 60_000) {
    return { expiry: `Starts ${fmtDateTime(startsAt, tz)}, when your current plan ends, and runs ${span} — until ${fmtDateTime(end, tz)}.`, startsAt: startsAt.getTime(), endsAt: end.getTime() };
  }
  return { expiry: `Every ${item.className} sheet for ${span} from payment — until ${fmtDateTime(end, tz)} if you pay now.`, startsAt: now, endsAt: end.getTime() };
}

// ── POST /api/quote ──────────────────────────────────────────────────────────────────────

const bad = (message: string, code: string, extra: Record<string, unknown> = {}) => new HttpError(400, message, { code, ...extra });

/** The sheets of a several-sheet quote ({ worksheets: [id, ...] }): 1 to 50 paid sheets on sale,
 *  repeats counted once. A free, unknown or unavailable sheet, or (for a signed-in customer) one
 *  already open on the account, refuses the whole quote with its code and the sheet's id. */
async function worksheetItems(q: Tx, s: Settings, raw: unknown, userId: string | null): Promise<Item[]> {
  if (!Array.isArray(raw)) throw bad('Send the sheets as a list.', 'bad_items');
  const ids: string[] = [];
  for (const v of raw) {
    const id = typeof v === 'string' ? v.trim() : '';
    if (!id) throw bad('Unknown worksheet.', 'unknown_item', { worksheet: typeof v === 'string' ? v : null });
    if (!ids.includes(id)) ids.push(id);
    if (ids.length > MAX_SHEETS_PER_ORDER) break;
  }
  if (!ids.length) throw bad('Choose at least one sheet.', 'no_items');
  if (ids.length > MAX_SHEETS_PER_ORDER) {
    throw bad(`One order can hold up to ${MAX_SHEETS_PER_ORDER} sheets.`, 'too_many', { max: MAX_SHEETS_PER_ORDER });
  }
  const items: Item[] = [];
  for (const id of ids) {
    const item = await worksheetItem(q, s, id);
    if (!item) throw bad('Unknown worksheet.', 'unknown_item', { worksheet: id });
    if (item.priceInr === 0) throw bad(FREE_MESSAGE, 'free', { worksheet: item.productId });
    if (item.problem) throw bad(item.problem.message, item.problem.code, { worksheet: item.productId });
    if (userId && await ownsSheet(q, userId, id)) throw new HttpError(409, OWNED_MESSAGE, { code: 'already_owned', worksheet: id });
    items.push(item);
  }
  return items;
}

/** One value when every item has it, else null (class, access days of a several-sheet order). */
function common<T>(items: Item[], pick: (it: Item) => T): T | null {
  const first = pick(items[0]);
  return items.every((it) => pick(it) === first) ? first : null;
}

function ttlMinutes(s: Settings): number {
  const t = Math.round(Number(s.quote.ttlMinutes));
  return t >= 1 && t <= 1440 ? t : DEFAULTS.quote.ttlMinutes;
}

/** POST /api/quote: validates, prices on the server, stores the quote and returns the response body.
 *  Call optionalUser(ctx) before the transaction: a signed-in customer's own coupon uses and running
 *  plans are taken into account (ctx.user). */
export async function buildQuote(q: Tx, ctx: Ctx, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const s = await getSettings(q);
  const addrIn = isObj(body.address) ? body.address : {};
  const country = countryFor(s, typeof addrIn.country === 'string' ? addrIn.country : (typeof body.country === 'string' ? body.country : null));
  const region = regionOf(country);

  // what is being bought: several sheets (the cart), one sheet, or one class plan
  const userId = ctx.user?.id ?? null;
  let items: Item[];
  if (body.worksheets !== undefined && body.worksheets !== null) {
    items = await worksheetItems(q, s, body.worksheets, userId);
  } else if (body.worksheet !== undefined && body.worksheet !== null && body.worksheet !== '') {
    const item = typeof body.worksheet === 'string' ? await worksheetItem(q, s, body.worksheet.trim()) : null;
    if (!item) throw bad('Unknown worksheet.', 'unknown_item');
    if (item.priceInr === 0) throw bad('That sheet is free — just open it.', 'free', { worksheet: item.productId });
    if (item.problem) throw bad(item.problem.message, item.problem.code, { worksheet: item.productId });
    items = [item];
  } else {
    const cls = typeof body.cls === 'string' ? body.cls.trim() : '';
    const plan = typeof body.plan === 'string' ? body.plan.trim() : '';
    const item = cls && plan ? await planItem(q, cls, plan) : null;
    if (!item) throw bad('Unknown plan or class.', 'unknown_item');
    if (!item.planRegions.includes(region)) throw bad(await regionMessage(q, item, region, country.name), 'plan_region');
    if (item.problem) throw bad(item.problem.message, item.problem.code, { cls: item.classId });
    items = [item];
  }
  const item = items[0];
  const several = items.length > 1;

  const rate = rateFor(s, country.currency);
  if (!rate) {
    throw new HttpError(503, `Prices in ${country.currency} are not available right now — please try again later or choose another country.`, { code: 'pricing_unavailable' });
  }

  // coupon: checked for active, dates, kind and class (every line must qualify); uses are counted
  // again when the order is made
  const code = cleanText(body.coupon, 40).toUpperCase();
  let coupon: CouponRow | null = null;
  let couponError: string | null = null;
  if (code) {
    const c = await loadCoupon(q, code, false);
    couponError = !c ? 'That code is not valid.' : couponRuleProblem(c, items) ?? await couponUsageProblem(q, c, userId);
    if (c && !couponError) coupon = c;
  }

  // one order: each line's discount on its own price, then one total with one tax and one fee
  // (revalidateQuote works the total out again the same way)
  let listInr = 0, discount = 0;
  const lines: QuoteLine[] = items.map((it) => {
    const d = rawDiscount(it.priceInr, it.classPct, it.planPct, coupon?.pct ?? 0);
    listInr += it.priceInr;
    discount += d;
    return {
      kind: it.kind, productId: it.productId, classId: it.kind === 'class' ? it.classId : null, planId: it.planId,
      title: it.title, months: it.months, accessDays: it.accessDays, unitPriceInr: it.priceInr, discountInr: roundMoney(d, 'INR'),
    };
  });
  const line = lines[0];
  const priced = priceIn(s, country, rate, listInr, discount);
  const { address, errors } = cleanAddress(addrIn, country);
  if (priced.amountMinor <= 0) errors.total = 'There is nothing to pay for this.';
  const valid = Object.keys(errors).length === 0;
  const methods = methodsFor(country);

  // a new plan starts when the customer's running plans for the class end
  let startsAt = new Date();
  if (item.kind === 'class' && userId) {
    const r = await q<{ until: Date | null }[]>`
      select max(expires_at) as until from entitlements
      where user_id = ${userId} and scope = 'class' and class_id = ${item.classId}
        and revoked_at is null and expires_at > now()`;
    if (r[0]?.until && new Date(r[0].until).getTime() > startsAt.getTime()) startsAt = new Date(r[0].until);
  }
  const tz = ctx.user?.profile.time_zone ?? null;
  const whens = items.map((it) => expiryText(it, startsAt, tz));
  const when = whens[0];
  const days = common(items, (it) => it.accessDays);
  const title = several ? `${items.length} worksheets` : item.title;
  const accessText = !several ? when.expiry
    : days !== null ? `Each sheet is open for ${days} days from payment, until ${fmtDateTime(new Date(when.endsAt), tz)} if you pay now.`
    : 'Each sheet is open for the days shown next to it, counted from payment.';
  const cls = common(items, (it) => it.classId);

  // only payable quotes are stored; the rest are price previews while the address is typed
  const ttl = ttlMinutes(s);
  let quoteId: string | null = null;
  let exp = Date.now() + ttl * 60_000;
  if (valid) {
    const payload = {
      rate, discountInr: priced.discountInr, methods, lines,
      priceLines: priced.priceLines, address, title, countryName: country.name, region,
      couponPct: coupon?.pct ?? 0,
    };
    const rows = await q<{ id: string; expires_at: Date }[]>`
      insert into quotes (expires_at, kind, product_id, class_id, plan_id, coupon_code, country, currency,
                          total, total_inr, amount_minor, valid, payload)
      values (now() + make_interval(mins => ${ttl}), ${item.kind}, ${several ? null : item.productId}, ${line.classId}, ${item.planId},
              ${coupon?.code ?? null}, ${country.code}, ${country.currency}, ${priced.total}, ${priced.totalInr},
              ${priced.amountMinor}, true, ${q.json(payload as never)})
      returning id, expires_at`;
    quoteId = rows[0].id;
    exp = new Date(rows[0].expires_at).getTime();
  }

  return {
    // the old response (a several-sheet quote names its one class, or none, and no single sheet)
    kind: item.kind,
    cls,
    className: cls === null ? null : item.className,
    plan: item.planId,
    planLabel: item.planLabel,
    months: item.months,
    worksheet: several ? null : item.productId,
    title: item.kind === 'worksheet' ? title : null,
    country: country.code,
    countryName: country.name,
    region,
    currency: country.currency,
    rate,
    lines: priced.priceLines,
    total: priced.total,
    amountMinor: priced.amountMinor,
    coupon: coupon?.code ?? null,
    discountInr: priced.discountInr,
    methods,
    address,
    valid,
    errors,
    exp,
    sig: quoteId,              // the old client sends the quote back; its id now stands in for the signature
    // new
    quoteId,
    expiresAt: exp,
    accessDays: days,
    totalInr: priced.totalInr,
    couponError: code ? couponError : null,
    accessText,
    // every sheet (or the plan) with its own price, discount and end date
    items: lines.map((l, i) => ({ ...l, expiry: whens[i].expiry, startsAt: whens[i].startsAt, endsAt: whens[i].endsAt })),
    worksheets: item.kind === 'worksheet' ? lines.map((l) => l.productId) : [],
    count: lines.length,
    listInr,
  };
}

// ── checkout: load and re-check ──────────────────────────────────────────────────────────

type QuoteRow = {
  id: string; expires_at: Date; kind: 'worksheet' | 'class'; country: string; currency: string; total: number;
  total_inr: number; amount_minor: number; coupon_code: string | null; valid: boolean; payload: unknown;
  used_at: Date | null; used_by_order: string | null; stale: boolean;
};

const staleQuote = () => new HttpError(409, STALE_QUOTE, { code: 'quote_expired' });
const invalidQuote = () => new HttpError(400, STALE_QUOTE, { code: 'quote_invalid' });

function parseLine(v: unknown): QuoteLine | null {
  if (!isObj(v)) return null;
  const kind = v.kind === 'worksheet' || v.kind === 'class' ? v.kind : null;
  const n = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : null);
  const sOrNull = (x: unknown) => (typeof x === 'string' && x ? x : null);
  const unit = n(v.unitPriceInr), disc = n(v.discountInr);
  if (!kind || unit === null || unit < 0 || disc === null || disc < 0) return null;
  const line: QuoteLine = {
    kind, productId: sOrNull(v.productId), classId: sOrNull(v.classId), planId: sOrNull(v.planId),
    title: typeof v.title === 'string' ? v.title : '', months: n(v.months), accessDays: n(v.accessDays),
    unitPriceInr: unit, discountInr: disc,
  };
  if (kind === 'worksheet' && (!line.productId || !line.accessDays)) return null;
  if (kind === 'class' && (!line.classId || !line.planId || !line.months)) return null;
  return line;
}

/** Loads a stored quote for checkout (FOR UPDATE). 409 {code:'quote_expired'} when missing/expired,
 *  400 {code:'quote_invalid'} when it was not payable. */
export async function loadQuote(q: Tx, quoteId: string): Promise<StoredQuote> {
  if (typeof quoteId !== 'string' || !UUID_RE.test(quoteId)) throw staleQuote();
  const rows = await q<QuoteRow[]>`
    select id, expires_at, kind, country, currency, total::float8 as total, total_inr::float8 as total_inr, amount_minor,
           coupon_code::text as coupon_code, valid, payload, used_at, used_by_order, (expires_at <= now()) as stale
    from quotes where id = ${quoteId}
    for update`;
  const r = rows[0];
  if (!r || r.stale) throw staleQuote();
  if (!r.valid) throw invalidQuote();
  const p = isObj(r.payload) ? r.payload : {};
  const lines = Array.isArray(p.lines) ? p.lines.map(parseLine) : [];
  const rate = Number(p.rate);
  if (!lines.length || lines.some((l) => !l) || !Number.isFinite(rate) || rate <= 0 || r.amount_minor <= 0) throw invalidQuote();
  const methods = Array.isArray(p.methods) ? p.methods.filter((m): m is string => (PAYMENT_METHODS as readonly unknown[]).includes(m)) : [];
  const addr = isObj(p.address) ? p.address : null;
  return {
    id: r.id,
    expiresAt: new Date(r.expires_at),
    kind: r.kind,
    country: r.country,
    currency: r.currency,
    rate,
    total: Number(r.total),
    totalInr: Number(r.total_inr),
    discountInr: Number(p.discountInr) || 0,
    amountMinor: Number(r.amount_minor),
    couponCode: r.coupon_code,
    methods,
    lines: lines as QuoteLine[],
    valid: r.valid,
    title: typeof p.title === 'string' ? p.title : (lines[0]?.title ?? ''),
    countryName: typeof p.countryName === 'string' ? p.countryName : r.country,
    region: p.region === 'IN' ? 'IN' : 'INTL',
    address: addr ? {
      country: str(addr.country, 8), line1: str(addr.line1), city: str(addr.city, 80), state: str(addr.state, 80), postal: str(addr.postal, 12),
    } : null,
    priceLines: Array.isArray(p.priceLines)
      ? p.priceLines.filter(isObj).map((l) => ({ label: str(l.label, 80), amount: Number(l.amount) || 0, note: str(l.note, 120) }))
      : [],
    usedAt: r.used_at,
    usedByOrder: r.used_by_order,
  };
}

const gone = (message: string, extra: Record<string, unknown> = {}) => new HttpError(410, message, { code: 'unavailable', ...extra });
const priceChanged = () => new HttpError(409, 'The price has changed since this quote — refresh the price and try again.', { code: 'price_changed' });
const couponInvalid = (why: string) => new HttpError(400, `${why} Remove the coupon or try another one.`, { code: 'coupon_invalid', errors: { coupon: why } });

/** Re-checks a quote for this customer at order time: products/classes/plans still on sale, PDF
 *  uploaded, coupon still valid incl. max_uses/per_user_limit, not already owning live access to
 *  the same sheet. Throws HttpError (409 code 'already_owned', 410 'unavailable', 400 'coupon_invalid'…).
 *  Run it in the transaction that inserts the order: it locks the coupon row, so two orders cannot
 *  both take a coupon's last use. */
export async function revalidateQuote(q: Tx, quote: StoredQuote, userId: string): Promise<void> {
  // (expiry is checked by loadQuote against the database clock)
  if (!quote.valid || !quote.lines.length) throw invalidQuote();
  const s = await getSettings(q);

  // 1. a sheet already open to this customer is never charged twice
  for (const l of quote.lines) {
    if (l.kind === 'worksheet' && l.productId && await ownsSheet(q, userId, l.productId)) {
      throw new HttpError(409, 'This sheet is already on your account — open it from My Worksheets.', { code: 'already_owned', worksheet: l.productId });
    }
  }

  // 2. still on sale, at the same price
  const country = countryFor(s, quote.country);
  if (country.code !== quote.country || country.currency !== quote.currency) throw priceChanged();
  const region = regionOf(country);
  const items: Item[] = [];
  for (const l of quote.lines) {
    const it = l.kind === 'worksheet' ? await worksheetItem(q, s, l.productId ?? '') : await planItem(q, l.classId ?? '', l.planId ?? '');
    if (!it) throw gone('This is no longer for sale.');
    if (it.problem) throw gone(it.problem.message, it.productId ? { worksheet: it.productId } : { cls: it.classId });
    if (it.kind === 'worksheet' && it.priceInr === 0) throw gone('That sheet is free now — just open it.', { worksheet: it.productId });
    if (it.kind === 'class' && !it.planRegions.includes(region)) throw gone(await regionMessage(q, it, region, country.name), { cls: it.classId });
    if (it.priceInr !== l.unitPriceInr || (it.kind === 'worksheet' && it.accessDays !== l.accessDays) || (it.kind === 'class' && it.months !== l.months)) {
      throw priceChanged();
    }
    items.push(it);
  }

  // 3. the coupon: same rules as the quote, plus how often it has been used
  let couponPct = 0;
  if (quote.couponCode) {
    const c = await loadCoupon(q, quote.couponCode, true);
    if (!c) throw couponInvalid('That code is not valid any more.');
    const why = couponRuleProblem(c, items) ?? await couponUsageProblem(q, c, userId);
    if (why) throw couponInvalid(why);
    couponPct = c.pct;
  }

  // 4. the same total, worked out again from today's prices and settings
  const rate = rateFor(s, quote.currency);
  if (!rate || Math.abs(rate - quote.rate) > 1e-9) throw priceChanged();
  let listInr = 0, discount = 0;
  items.forEach((it, i) => {
    const d = rawDiscount(it.priceInr, it.classPct, it.planPct, couponPct);
    if (roundMoney(d, 'INR') !== quote.lines[i].discountInr) throw priceChanged();
    listInr += it.priceInr;
    discount += d;
  });
  const priced = priceIn(s, country, rate, listInr, discount);
  if (priced.amountMinor !== quote.amountMinor) throw priceChanged();

  // 5. what the gateways accept
  if (quote.amountMinor <= 0) throw invalidQuote();
  if (quote.currency === 'INR' && quote.amountMinor < 100) {
    throw new HttpError(400, 'The amount is below the gateway minimum (₹1).', { code: 'below_minimum' });
  }
}
