// Public routes: health, checkout configuration, country hint, the contact form, the FAQ
// assistant, client analytics events, site text, the FAQ list and published reviews.
// Shapes follow the old site (see /var/tmp/sb/map/backend-api.md §11); new fields are only added.
import type { Router } from '../lib/router.ts';
import type { Ctx } from '../lib/context.ts';
import { tx } from '../lib/db.ts';
import { env, gatewayModes, mailReady } from '../lib/env.ts';
import { HttpError, intParam, json, readJson } from '../lib/http.ts';
import { optionalUser } from '../lib/auth.ts';
import { notify, rateLimit } from '../lib/guard.ts';
import { enqueue, kickOutbox } from '../lib/mail.ts';
import { getSettings } from '../lib/settings.ts';
import { cleanName, cleanText, normEmail, validEmail } from '../lib/util.ts';
import { contactToInbox } from '../services/emails.ts';
import { accessDaysFor, countryList } from '../services/pricing.ts';
import { answerQuestion, fillAnswer, supportEmail } from '../services/chatbot.ts';
import { printsPerSheet } from '../services/entitlements.ts';

const PRODUCT_RE = /^[A-Za-z0-9][A-Za-z0-9-]{1,63}$/;
const CLIENT_EVENTS = ['page_view', 'product_view', 'checkout_start', 'search'];
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

// ── GET /api/health ──────────────────────────────────────────────────────────────────────

async function health(_ctx: Ctx) {
  let db = false;
  try {
    await tx((q) => q`select 1`, { timeoutMs: 3000 });
    db = true;
  } catch {
    db = false;
  }
  const modes = gatewayModes();
  // names and on/off flags only, never a key or a URL
  return json(db ? 200 : 503, {
    ok: db,
    version: env().version,
    db,
    database: db,
    gateway: modes.razorpay,
    gateways: modes,
    mail: mailReady() ? env().mail.provider : 'none',
    time: Date.now(),
  });
}

// ── GET /api/config ──────────────────────────────────────────────────────────────────────

async function config(_ctx: Ctx) {
  const s = await getSettings();
  const { classes, plans } = await tx(async (q) => ({
    classes: await q<{ id: string; name: string; status: string; pct: number }[]>`
      select id, name, status, discount_pct::float8 as pct from classes where status <> 'hidden' order by sort, id`,
    plans: await q<{ id: string; label: string; months: number; price_inr: number; pct: number; regions: string[]; note: string | null }[]>`
      select id, label, months, price_inr, discount_pct::float8 as pct, regions, note from plans where active order by sort, id`,
  }));
  const rates: Record<string, number> = {};
  for (const [k, v] of Object.entries(s.currency_rates)) {
    if (/^[A-Z]{3}$/.test(k) && typeof v === 'number' && Number.isFinite(v) && v > 0) rates[k] = v;
  }
  const modes = gatewayModes();
  const e = env();
  return {
    // the old fields
    countries: countryList(s).map((c) => ({
      code: c.code, name: c.name, currency: c.currency, tax: c.tax.label, taxPct: c.tax.pct,
      postal: { label: c.postal.label, hint: c.postal.hint, pattern: c.postal.pattern, flags: c.postal.flags },
      state: c.state, states: c.states, methods: c.methods,
    })),
    plans: Object.fromEntries(plans.map((p) => [p.id, { label: p.label, months: p.months, price: p.price_inr, note: p.note, regions: p.regions, discountPct: p.pct }])),
    plansByRegion: {
      IN: plans.filter((p) => p.regions.includes('IN')).map((p) => p.id),
      INTL: plans.filter((p) => p.regions.includes('INTL')).map((p) => p.id),
    },
    classes: Object.fromEntries(classes.map((c) => [c.id, c.name])),
    rates,
    currencies: Object.keys(rates),
    gateways: modes,
    server: 'learn-with-why',
    version: '4',
    // new
    apiVersion: e.version,
    keys: { razorpay: modes.razorpay ? e.razorpay.keyId : null },   // the public key id only
    classStatus: Object.fromEntries(classes.map((c) => [c.id, c.status])),
    classDiscounts: Object.fromEntries(classes.filter((c) => c.pct > 0).map((c) => [c.id, c.pct])),
    accessDays: accessDaysFor(s, null),
    agreement: { version: s.agreement.version, text: s.agreement.text },
    features: {
      email: mailReady(),
      payments: { razorpay: !!modes.razorpay, stripe: !!modes.stripe, paypal: !!modes.paypal, any: !!(modes.razorpay || modes.stripe || modes.paypal) },
    },
    security: { maxWarnings: s.security.maxWarnings },
    viewer: { recheckSeconds: s.viewer.recheckSeconds },
    quote: { ttlMinutes: s.quote.ttlMinutes },
    supportEmail: supportEmail(s),
    // prints of each sheet by account type (Organization = a school, tuition centre or other group)
    prints: {
      parent: printsPerSheet(s.prints, 'parent'),
      teacher: printsPerSheet(s.prints, 'teacher'),
      organization: printsPerSheet(s.prints, 'school'),
    },
  };
}

// ── GET /api/geo ─────────────────────────────────────────────────────────────────────────

async function geo(ctx: Ctx) {
  // the platform's country header (ctx.country); a country the checkout does not list → null,
  // and the browser then guesses from its time zone, as before
  const s = await getSettings();
  const known = ctx.country && countryList(s).some((c) => c.code === ctx.country);
  return { country: known ? ctx.country : null, fallback: 'IN' };
}

// ── POST /api/contact ────────────────────────────────────────────────────────────────────

const NOTE_LIMIT = 'You have sent a few notes already — wait a few minutes and try again.';

async function contact(ctx: Ctx) {
  const b = await readJson(ctx.req, 32 * 1024);
  if (b.website) return json(201, { ok: true });   // honeypot: a bot filled the hidden field
  const name = cleanName(b.name).slice(0, 80);
  const email = normEmail(b.email);
  const message = cleanText(b.message, 12000);
  const chars = Array.from(message).length;   // the database counts characters, not UTF-16 units
  const errors: Record<string, string> = {};
  if (!name) errors.name = 'Your name, please.';
  if (!validEmail(email) || email.length > 200) errors.email = 'Enter a valid email address.';
  if (chars < 10) errors.message = 'A little more detail helps us reply.';
  if (chars > 5000) errors.message = 'That note is too long — keep it under 5000 characters.';
  if (Object.keys(errors).length) throw new HttpError(400, Object.values(errors)[0], { errors });
  await rateLimit(ctx, 'contact', ctx.ip, 5, 3600, NOTE_LIMIT, null);

  const user = await optionalUser(ctx);
  const s = await getSettings();
  const inbox = supportEmail(s);
  const id = await tx(async (q) => {
    const rows = await q<{ id: number; created_at: Date }[]>`
      insert into contact_messages (name, email, body, user_id, ip, user_agent)
      values (${name}, ${email}, ${message}, ${user?.id ?? null}, ${ctx.ip}, ${ctx.ua.slice(0, 200) || null})
      returning id, created_at`;
    const row = rows[0];
    const mail = contactToInbox({ name, email, body: message, at: row.created_at, signedInAs: user?.profile.email ?? null });
    const outboxId = await enqueue(q, {
      template: 'contact', to: inbox, replyTo: email, ...mail,
      relatedType: 'contact_message', relatedId: row.id, dedupeKey: `contact:${row.id}`,
    });
    await q`update contact_messages set outbox_id = ${outboxId} where id = ${row.id}`;
    await notify(q, {
      audience: 'staff', kind: 'contact.new', title: `New note from ${name}`, body: message.slice(0, 300),
      link: '/admin#messages', data: { id: row.id, email },
    });
    return row.id;
  });
  kickOutbox(ctx);
  // the email is sent just after this answer; `mailed` turns true in the staff inbox once it is out
  return json(201, { ok: true, id, mailed: false, queued: true });
}

// ── POST /api/ai/chat ────────────────────────────────────────────────────────────────────

async function chat(ctx: Ctx) {
  await rateLimit(ctx, 'chat', ctx.ip, 30, 60);
  const b = await readJson(ctx.req, 16 * 1024);
  const message = cleanText(b.message, 4000).replace(/\s+/g, ' ');
  if (!message) throw new HttpError(400, 'Type a question first.', { errors: { message: 'Type a question first.' } });
  if (message.length > 1000) throw new HttpError(400, 'Keep your question under 1000 characters.', { errors: { message: 'Keep your question under 1000 characters.' } });
  // `history` is accepted for the site's convenience but not used: each answer stands alone
  const s = await getSettings();
  return await tx((q) => answerQuestion(q, message, s));
}

// ── POST /api/events ─────────────────────────────────────────────────────────────────────

/** A site path only: no query string or fragment (they can hold one-time link tokens). */
function cleanPath(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const p = cleanText(v, 1000).split(/[?#]/)[0];
  if (!p.startsWith('/') || p.startsWith('//')) return null;
  return p.slice(0, 200);
}

function referrerHost(v: unknown): string | null {
  if (typeof v !== 'string' || !v || v.length > 2000) return null;
  try {
    const u = new URL(v);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.hostname.toLowerCase().slice(0, 120) || null;
  } catch {
    return null;
  }
}

/** At most 10 small values (strings cut to 100 characters); nested objects are dropped. */
function cleanMeta(v: unknown): Record<string, string | number | boolean> | null {
  if (!isObj(v)) return null;
  const out: Record<string, string | number | boolean> = {};
  let n = 0;
  for (const [k, val] of Object.entries(v)) {
    if (n >= 10) break;
    if (!/^[A-Za-z][A-Za-z0-9_]{0,30}$/.test(k)) continue;
    if (typeof val === 'string') out[k] = cleanText(val, 100);
    else if (typeof val === 'number' && Number.isFinite(val)) out[k] = val;
    else if (typeof val === 'boolean') out[k] = val;
    else continue;
    n++;
  }
  return n ? out : null;
}

async function events(ctx: Ctx) {
  await rateLimit(ctx, 'events', ctx.ip, 120, 60);
  const b = await readJson(ctx.req, 8 * 1024);
  const kind = typeof b.kind === 'string' ? b.kind : '';
  if (!CLIENT_EVENTS.includes(kind)) {
    throw new HttpError(400, 'Unknown event.', { code: 'bad_event', errors: { kind: `One of ${CLIENT_EVENTS.join(', ')}.` } });
  }
  const productId = typeof b.productId === 'string' && PRODUCT_RE.test(b.productId) ? b.productId : null;
  const meta = cleanMeta(b.meta);
  const user = await optionalUser(ctx);
  await tx((q) => q`
    insert into analytics_events (kind, source, visitor_id, user_id, path, product_id, country, referrer_host, device, meta)
    values (${kind}, 'client', ${ctx.visitorId}, ${user?.id ?? null}, ${cleanPath(b.path)}, ${productId}, ${ctx.country},
            ${referrerHost(b.referrer)}, ${ctx.device}, ${meta ? q.json(meta) : null})`);
  return { ok: true };
}

// ── GET /api/content, /api/faq, /api/worksheets/:id/reviews ──────────────────────────────

async function content(_ctx: Ctx) {
  const rows = await tx((q) => q<{ key: string; value: unknown }[]>`select key, value from site_content where published order by key`);
  return json(200, Object.fromEntries(rows.map((r) => [r.key, r.value])), { 'Cache-Control': 'public, max-age=60' });
}

async function faq(_ctx: Ctx) {
  const s = await getSettings();
  const rows = await tx((q) => q<{ id: number; question: string; answer: string; keywords: string[] }[]>`
    select id, question, answer, keywords from faq_entries
    where audience = 'public' and status = 'published'
    order by sort, id`);
  return json(200, {
    faq: rows.map((r) => ({ id: r.id, question: r.question, answer: fillAnswer(r.answer, s), keywords: r.keywords })),
  }, { 'Cache-Control': 'public, max-age=60' });
}

/** "Priya Sharma" → "P. S." (never the full name or the account id). */
export function initials(name: string | null | undefined): string {
  const words = String(name ?? '').replace(/[^\p{L}\p{N}\s'-]/gu, ' ').split(/\s+/).filter(Boolean).slice(0, 3);
  if (!words.length) return 'A customer';
  return words.map((w) => Array.from(w)[0].toUpperCase() + '.').join(' ');
}

async function reviews(ctx: Ctx) {
  const id = ctx.params.id ?? '';
  if (!PRODUCT_RE.test(id)) throw new HttpError(404, 'No such worksheet.');
  const limit = intParam(ctx.query.get('limit'), 20, 1, 50);
  const offset = intParam(ctx.query.get('offset'), 0, 0, 5000);
  const out = await tx(async (q) => {
    const p = await q<{ review_avg: number | null; review_count: number }[]>`
      select p.review_avg::float8 as review_avg, p.review_count
      from products p join classes c on c.id = p.class_id
      where p.id = ${id} and p.status = 'active' and c.status <> 'hidden'`;
    if (!p.length) return null;
    const rows = await q<{ id: number; rating: number; title: string | null; body: string | null; created_at: Date; name: string }[]>`
      select r.id, r.rating, r.title, r.body, r.created_at, pf.name
      from reviews r join profiles pf on pf.id = r.user_id
      where r.product_id = ${id} and r.status = 'published'
      order by r.created_at desc, r.id desc
      limit ${limit} offset ${offset}`;
    return { product: p[0], rows };
  });
  if (!out) throw new HttpError(404, 'No such worksheet.');
  return {
    worksheet: id,
    avg: out.product.review_avg,
    count: out.product.review_count,
    reviews: out.rows.map((r) => ({ id: r.id, rating: r.rating, title: r.title, body: r.body, at: new Date(r.created_at).getTime(), name: initials(r.name) })),
  };
}

export function register(r: Router) {
  r.get('/api/health', health);
  r.get('/api/config', config);
  r.get('/api/geo', geo);
  r.post('/api/contact', contact);
  r.post('/api/ai/chat', chat);
  r.post('/api/events', events);
  r.get('/api/content', content);
  r.get('/api/faq', faq);
  r.get('/api/worksheets/:id/reviews', reviews);
}
