// What a customer may open, and how an access record looks to the website.
// A record is live when it is not revoked, has started, has not expired, and — for a free pass —
// the sheet is still free. All times are UTC in the database and epoch ms in the API.
import type { Tx } from '../lib/db.ts';

export type ProductRow = {
  id: string; title: string; description: string; class_id: string; subject: string; pages: number;
  price_inr: number; status: 'draft' | 'active' | 'archived'; pdf_path: string | null; thumb_url: string | null;
  print_limit: number; download_limit: number; access_days: number | null; landscape: boolean; stock: number | null;
};

export type EntRow = {
  id: number; user_id: string; scope: 'worksheet' | 'class'; product_id: string | null; class_id: string | null;
  plan_id: string | null; kind: 'free' | 'paid' | 'grant'; order_id: string | null; purchased_at: Date;
  starts_at: Date; expires_at: Date | null; revoked_at: Date | null; revoke_reason: string | null;
  title?: string | null; price_inr?: number | null; product_class?: string | null;
};

export type EntStatus = 'active' | 'scheduled' | 'expired' | 'revoked' | 'lapsed';

export function entStatus(e: EntRow, productPrice?: number | null, now = Date.now()): EntStatus {
  if (e.revoked_at) return 'revoked';
  if (new Date(e.starts_at).getTime() > now) return 'scheduled';
  if (e.expires_at && new Date(e.expires_at).getTime() <= now) return 'expired';
  if (e.kind === 'free' && (productPrice ?? e.price_inr ?? 0) > 0) return 'lapsed';
  return 'active';
}

export const isLive = (e: EntRow, productPrice?: number | null, now = Date.now()) => entStatus(e, productPrice, now) === 'active';

/** The entitlement object the website already reads, plus purchase/expiry details. */
export function pubEntitlement(e: EntRow, productPrice?: number | null) {
  const status = entStatus(e, productPrice);
  return {
    id: e.id,
    scope: e.scope,
    worksheet: e.product_id,
    title: e.title ?? null,
    cls: e.class_id ?? e.product_class ?? null,
    plan: e.plan_id,
    kind: e.kind === 'grant' ? 'paid' : e.kind,
    grant: e.kind === 'grant',
    order: e.order_id,
    purchasedAt: new Date(e.purchased_at).getTime(),
    start: new Date(e.starts_at).getTime(),
    end: e.expires_at ? new Date(e.expires_at).getTime() : null,
    expiresAt: e.expires_at ? new Date(e.expires_at).toISOString() : null,
    active: status === 'active',
    status,
  };
}

/** Every access record that could open this sheet (its own, or its class plan). */
export async function coveringEntitlements(q: Tx, userId: string, p: Pick<ProductRow, 'id' | 'class_id'>): Promise<EntRow[]> {
  return await q<EntRow[]>`
    select e.*, pr.title, pr.price_inr
    from entitlements e
    left join products pr on pr.id = e.product_id
    where e.user_id = ${userId}
      and ((e.scope = 'worksheet' and e.product_id = ${p.id}) or (e.scope = 'class' and e.class_id = ${p.class_id}))
    order by e.starts_at desc`;
}

/** The best live record for a sheet: bought/granted sheet with the latest end, then a class
 *  plan, then a free pass (only while the sheet is still free). For a sheet that is free now the
 *  free pass comes first: it never ends, and a paid-access suspension does not close it. */
export function pickBest(rows: EntRow[], price: number): EntRow | null {
  const live = rows.filter((e) => isLive(e, e.scope === 'worksheet' ? price : null));
  const rank = (e: EntRow) => (e.kind === 'free' ? (price === 0 ? -1 : 2) : e.scope === 'worksheet' ? 0 : 1);
  live.sort((a, b) => rank(a) - rank(b) || (new Date(b.expires_at ?? '9999-12-31').getTime() - new Date(a.expires_at ?? '9999-12-31').getTime()));
  return live[0] ?? null;
}

export async function bestLive(q: Tx, userId: string, p: ProductRow): Promise<EntRow | null> {
  return pickBest(await coveringEntitlements(q, userId, p), p.price_inr);
}

/** Does the customer already hold live access to this sheet bought on its own (not via a plan)? */
export async function ownsSheet(q: Tx, userId: string, productId: string): Promise<EntRow | null> {
  const rows = await q<EntRow[]>`
    select e.*, pr.price_inr from entitlements e join products pr on pr.id = e.product_id
    where e.user_id = ${userId} and e.scope = 'worksheet' and e.product_id = ${productId}
      and e.kind <> 'free' and e.revoked_at is null and e.starts_at <= now()
      and (e.expires_at is null or e.expires_at > now())
    order by e.expires_at desc nulls first limit 1`;
  return rows[0] ?? null;
}

export async function loadProduct(q: Tx, id: string): Promise<ProductRow | null> {
  if (!/^[A-Za-z0-9][A-Za-z0-9-]{1,63}$/.test(id)) return null;
  const r = await q<ProductRow[]>`
    select id, title, description, class_id, subject, pages, price_inr, status, pdf_path, thumb_url,
           print_limit, download_limit, access_days, landscape, stock
    from products where id = ${id}`;
  return r[0] ?? null;
}

/** Is the PDF for this sheet uploaded? */
export async function hasPdf(q: Tx, p: Pick<ProductRow, 'pdf_path'>): Promise<boolean> {
  if (!p.pdf_path) return false;
  const r = await q<{ name: string }[]>`select name from private.worksheet_objects(${[p.pdf_path]}::text[])`;
  return r.length > 0;
}
