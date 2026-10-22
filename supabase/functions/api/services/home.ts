// The lists the website shows (home_sections): which sheets each one holds, in order. A manual list
// holds the sheets staff picked (home_section_items, in their order); an automatic one is worked out
// here every time: best sellers from paid orders only, the newest, discounted or free sheets, or every
// sheet of a class, subject, academic session or section. Only sheets customers can see are listed
// (on sale, published, class not hidden), so a hidden sheet drops out of every list by itself.
import type { Tx } from '../lib/db.ts';

export type HomeSectionRow = {
  id: string; kind: string; mode: 'manual' | 'auto'; filter_value: string | null; title: string; subtitle: string;
  placement: 'home' | 'shop'; max_items: number; auto_days: number; label_tag: string | null; visible: boolean;
  sort: number; builtin: boolean; updated_at: Date;
};

export const HOME_KINDS = ['curated', 'bestsellers', 'new', 'discounted', 'free', 'class', 'subject', 'session', 'section'] as const;
/** kinds that need a filter value (which class, subject, session or section) */
export const FILTER_KINDS = ['class', 'subject', 'session', 'section'];

export async function loadHomeSections(q: Tx, visibleOnly: boolean): Promise<HomeSectionRow[]> {
  return visibleOnly
    ? await q<HomeSectionRow[]>`select * from home_sections where visible order by sort, id`
    : await q<HomeSectionRow[]>`select * from home_sections order by sort, id`;
}

/** The ordered sheet ids a section shows on the website now. */
export async function resolveSection(q: Tx, h: HomeSectionRow): Promise<string[]> {
  const lim = h.max_items;
  const listed = q`p.status = 'active' and (p.publish_at is null or p.publish_at <= now())
    and exists (select 1 from classes c where c.id = p.class_id and c.status <> 'hidden')`;
  let rows: { id: string }[];
  if (h.mode === 'manual') {
    rows = await q`
      select p.id from home_section_items i join products p on p.id = i.product_id
      where i.section_id = ${h.id} and ${listed}
      order by i.sort, i.added_at, p.id limit ${lim}`;
  } else if (h.kind === 'bestsellers') {
    // verified sales only: an order is 'paid' once the gateway confirmed the payment
    rows = await q`
      select p.id from products p
      join (
        select it.product_id, count(*) as n, sum(greatest(it.unit_price_inr - it.discount_inr, 0)) as revenue
        from order_items it join orders o on o.id = it.order_id
        where o.status = 'paid' and it.product_id is not null
          and o.paid_at > now() - make_interval(days => ${h.auto_days})
        group by it.product_id
      ) s on s.product_id = p.id
      where ${listed}
      order by s.n desc, s.revenue desc, p.sort, p.id limit ${lim}`;
  } else if (h.kind === 'new') {
    rows = await q`select p.id from products p where ${listed} order by p.created_at desc, p.id limit ${lim}`;
  } else if (h.kind === 'discounted') {
    rows = await q`
      select p.id from products p where ${listed} and p.was_price_inr > p.price_inr and p.price_inr > 0
      order by (p.was_price_inr - p.price_inr)::float8 / p.was_price_inr desc, p.sort, p.id limit ${lim}`;
  } else if (h.kind === 'free') {
    rows = await q`select p.id from products p where ${listed} and p.price_inr = 0 order by p.class_id, p.sort, p.id limit ${lim}`;
  } else if (h.kind === 'class') {
    rows = await q`select p.id from products p where ${listed} and p.class_id = ${h.filter_value} order by p.sort, p.id limit ${lim}`;
  } else if (h.kind === 'subject') {
    rows = await q`select p.id from products p where ${listed} and p.subject = ${h.filter_value} order by p.class_id, p.sort, p.id limit ${lim}`;
  } else if (h.kind === 'session') {
    rows = await q`
      select p.id from products p where ${listed}
        and exists (select 1 from product_sessions ps where ps.product_id = p.id and ps.session_id = ${h.filter_value})
      order by p.class_id, p.sort, p.id limit ${lim}`;
  } else if (h.kind === 'section') {
    rows = await q`select p.id from products p where ${listed} and p.section = ${h.filter_value} order by p.sort, p.id limit ${lim}`;
  } else {
    rows = [];
  }
  return rows.map((r) => r.id);
}

/** The public shape of a section with its sheets (GET /api/worksheets → homeSections). */
export const publicSection = (h: HomeSectionRow, products: string[]) => ({
  id: h.id, kind: h.kind, mode: h.mode, title: h.title, subtitle: h.subtitle, placement: h.placement,
  label: h.label_tag, filter: h.filter_value, builtin: h.builtin, sort: h.sort, products,
});
