// The cart of a signed-in customer: paid sheets they mean to buy together in one order.
// Stored in public.cart_items (only the API reads or changes it). A visitor's cart lives in the
// browser; after sign-in the website sends it to POST /api/cart/merge.
//
// Every route answers with the whole cart:
//   { items: [{ worksheet, title, priceInr, wasPriceInr, cls, subject, thumb, accessDays, problem, note, addedAt }],
//     count, buyable, totalInr, max }
// problem: null (can be bought), 'owned' (already on the account), 'free' (free now) or
// 'unavailable' (not for sale right now). totalInr adds up the lines that can be bought.
import type { Router } from '../lib/router.ts';
import type { Ctx } from '../lib/context.ts';
import { tx, type Tx } from '../lib/db.ts';
import { HttpError, json, readJson } from '../lib/http.ts';
import { requireUser } from '../lib/auth.ts';
import { rateLimit } from '../lib/guard.ts';
import { getSettings, type Settings } from '../lib/settings.ts';
import { accessDaysFor, FREE_MESSAGE, MAX_SHEETS_PER_ORDER, OWNED_MESSAGE } from '../services/pricing.ts';
import { ownedSheets } from '../services/entitlements.ts';

export const CART_MAX = MAX_SHEETS_PER_ORDER;
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9-]{1,63}$/;
const MERGE_INPUT_MAX = 200;

export type CartProblem = 'owned' | 'free' | 'unavailable';

type CartRow = {
  product_id: string; added_at: Date; title: string | null; price_inr: number | null; was_price_inr: number | null;
  class_id: string | null; subject: string | null; thumb_url: string | null; access_days: number | null;
  status: string | null; stock: number | null; class_status: string | null; has_pdf: boolean | null;
};

const NOTES: Record<CartProblem, string> = {
  owned: 'This sheet is already on your account.',
  free: 'This sheet is free now. Open it from the shop.',
  unavailable: 'This sheet is not for sale right now.',
};

function unavailableNote(r: CartRow): string {
  if (r.status !== 'active') return 'This sheet is no longer for sale.';
  if (r.class_status === 'coming_soon') return 'This sheet is coming soon. It is not for sale yet.';
  if (r.stock !== null && r.stock <= 0) return 'This sheet is sold out.';
  if (!r.has_pdf) return 'This sheet is being prepared. It is not for sale yet.';
  return NOTES.unavailable;
}

/** Serialises cart changes of one customer, so two tabs cannot push the cart past its limit. */
async function lockCart(q: Tx, userId: string) {
  await q`select pg_advisory_xact_lock(hashtextextended(${'lww-cart:' + userId}, 0))`;
}

async function cartRows(q: Tx, userId: string): Promise<CartRow[]> {
  return await q<CartRow[]>`
    select ci.product_id, ci.added_at, p.title, p.price_inr, p.was_price_inr, p.class_id, p.subject, p.thumb_url,
           p.access_days, p.status, p.stock, c.status as class_status, f.has_pdf
    from cart_items ci
    left join products p on p.id = ci.product_id
    left join classes c on c.id = p.class_id
    left join private.product_file_status() f on f.product_id = ci.product_id
    where ci.user_id = ${userId}
    order by ci.added_at, ci.product_id`;
}

/** The cart as the website reads it. Lines whose sheet no longer exists are left out. */
async function readCart(q: Tx, s: Settings, userId: string) {
  const rows = (await cartRows(q, userId)).filter((r) => r.title !== null);
  const owned = await ownedSheets(q, userId, rows.map((r) => r.product_id));
  const items = rows.map((r) => {
    const price = r.price_inr ?? 0;
    const onSale = r.status === 'active' && r.class_status === 'available' && !(r.stock !== null && r.stock <= 0) && !!r.has_pdf;
    const problem: CartProblem | null = owned.has(r.product_id) ? 'owned' : price === 0 ? 'free' : onSale ? null : 'unavailable';
    return {
      worksheet: r.product_id,
      title: r.title,
      priceInr: price,
      wasPriceInr: r.was_price_inr,
      cls: r.class_id,
      subject: r.subject,
      thumb: r.thumb_url,
      accessDays: accessDaysFor(s, r.access_days),
      problem,
      note: problem === 'unavailable' ? unavailableNote(r) : problem ? NOTES[problem] : null,
      addedAt: new Date(r.added_at).getTime(),
    };
  });
  const buyable = items.filter((i) => i.problem === null);
  return {
    items,
    count: items.length,
    buyable: buyable.length,
    totalInr: buyable.reduce((sum, i) => sum + i.priceInr, 0),
    max: CART_MAX,
  };
}

type SheetCheck = { id: string; price: number } | null;

/** A sheet a customer can see (not a draft, not in a hidden class); null otherwise. */
async function visibleSheet(q: Tx, raw: unknown): Promise<SheetCheck> {
  const id = typeof raw === 'string' ? raw.trim() : '';
  if (!ID_RE.test(id)) return null;
  const r = await q<{ id: string; price_inr: number }[]>`
    select p.id, p.price_inr from products p join classes c on c.id = p.class_id
    where p.id = ${id} and p.status <> 'draft' and c.status <> 'hidden'`;
  return r[0] ? { id: r[0].id, price: r[0].price_inr } : null;
}

async function cartCount(q: Tx, userId: string): Promise<number> {
  const r = await q<{ n: number }[]>`
    select count(*)::int as n from cart_items ci join products p on p.id = ci.product_id where ci.user_id = ${userId}`;
  return r[0]?.n ?? 0;
}

const unknownSheet = () => new HttpError(404, 'We could not find that sheet.', { code: 'unknown_item' });
const cartFull = () =>
  new HttpError(400, `Your cart can hold up to ${CART_MAX} sheets. Buy these first, or remove some.`, { code: 'cart_full', max: CART_MAX });

// ── GET /api/cart ────────────────────────────────────────────────────────────────────────

async function getCart(ctx: Ctx) {
  const u = await requireUser(ctx);
  await rateLimit(ctx, 'cart_read', u.id, 300, 600);
  const s = await getSettings();
  return json(200, await tx((q) => readCart(q, s, u.id)), { 'Cache-Control': 'no-store' });
}

// ── POST /api/cart { worksheet } ─────────────────────────────────────────────────────────

async function addToCart(ctx: Ctx) {
  const u = await requireUser(ctx);
  await rateLimit(ctx, 'cart', u.id, 120, 600);
  const b = await readJson(ctx.req, 4096);
  const s = await getSettings();
  const cart = await tx(async (q) => {
    await lockCart(q, u.id);
    const sheet = await visibleSheet(q, b.worksheet);
    if (!sheet) throw unknownSheet();
    if (sheet.price === 0) throw new HttpError(400, FREE_MESSAGE, { code: 'is_free', worksheet: sheet.id });
    if ((await ownedSheets(q, u.id, [sheet.id])).size) {
      throw new HttpError(409, OWNED_MESSAGE, { code: 'already_owned', worksheet: sheet.id });
    }
    const already = await q`select 1 from cart_items where user_id = ${u.id} and product_id = ${sheet.id}`;
    if (!already.length) {
      if (await cartCount(q, u.id) >= CART_MAX) throw cartFull();
      await q`insert into cart_items (user_id, product_id) values (${u.id}, ${sheet.id}) on conflict do nothing`;
    }
    return await readCart(q, s, u.id);
  });
  return json(200, cart, { 'Cache-Control': 'no-store' });
}

// ── DELETE /api/cart/:id and DELETE /api/cart ───────────────────────────────────────────

async function removeFromCart(ctx: Ctx) {
  const u = await requireUser(ctx);
  await rateLimit(ctx, 'cart', u.id, 120, 600);
  const id = String(ctx.params.id ?? '').trim().slice(0, 64);
  const s = await getSettings();
  const cart = await tx(async (q) => {
    await lockCart(q, u.id);
    if (id) await q`delete from cart_items where user_id = ${u.id} and product_id = ${id}`;
    return await readCart(q, s, u.id);
  });
  return json(200, cart, { 'Cache-Control': 'no-store' });
}

async function emptyCart(ctx: Ctx) {
  const u = await requireUser(ctx);
  await rateLimit(ctx, 'cart', u.id, 120, 600);
  const s = await getSettings();
  const cart = await tx(async (q) => {
    await lockCart(q, u.id);
    await q`delete from cart_items where user_id = ${u.id}`;
    return await readCart(q, s, u.id);
  });
  return json(200, cart, { 'Cache-Control': 'no-store' });
}

// ── POST /api/cart/merge { worksheets: [id, ...] } ──────────────────────────────────────

type Skip = { worksheet: string; reason: 'unknown' | 'free' | 'owned' | 'full' };

async function mergeCart(ctx: Ctx) {
  const u = await requireUser(ctx);
  await rateLimit(ctx, 'cart', u.id, 120, 600);
  const b = await readJson(ctx.req, 32 * 1024);
  if (!Array.isArray(b.worksheets)) throw new HttpError(400, 'Send the sheets as a list.', { code: 'bad_items' });
  const ids: string[] = [];
  for (const v of b.worksheets.slice(0, MERGE_INPUT_MAX)) {
    const id = typeof v === 'string' ? v.trim().slice(0, 64) : '';
    if (id && !ids.includes(id)) ids.push(id);
  }
  const s = await getSettings();
  const out = await tx(async (q) => {
    await lockCart(q, u.id);
    const added: string[] = [];
    const skipped: Skip[] = [];
    const inCart = new Set((await q<{ product_id: string }[]>`
      select product_id from cart_items where user_id = ${u.id}`).map((r) => r.product_id));
    let count = await cartCount(q, u.id);
    const owned = await ownedSheets(q, u.id, ids.filter((id) => ID_RE.test(id)));
    for (const raw of ids) {
      const sheet = await visibleSheet(q, raw);
      if (!sheet) { skipped.push({ worksheet: raw, reason: 'unknown' }); continue; }
      if (inCart.has(sheet.id)) continue;
      if (sheet.price === 0) { skipped.push({ worksheet: sheet.id, reason: 'free' }); continue; }
      if (owned.has(sheet.id)) { skipped.push({ worksheet: sheet.id, reason: 'owned' }); continue; }
      if (count >= CART_MAX) { skipped.push({ worksheet: sheet.id, reason: 'full' }); continue; }
      await q`insert into cart_items (user_id, product_id) values (${u.id}, ${sheet.id}) on conflict do nothing`;
      inCart.add(sheet.id);
      added.push(sheet.id);
      count++;
    }
    return { ...(await readCart(q, s, u.id)), added, skipped };
  });
  return json(200, out, { 'Cache-Control': 'no-store' });
}

export function register(r: Router) {
  r.get('/api/cart', getCart);
  r.post('/api/cart', addToCart);
  r.delete('/api/cart', emptyCart);
  r.post('/api/cart/merge', mergeCart);
  r.delete('/api/cart/:id', removeFromCart);
}
