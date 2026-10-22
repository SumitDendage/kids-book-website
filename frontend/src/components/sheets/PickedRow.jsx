import { useSite } from '../../context/SiteContext.jsx';
import { homeRows } from '../../data/catalogue.js';
import SheetCard from './SheetCard.jsx';

/* The rows of sheets on the home page: "Picked for you" and any other list staff put on the home page
   (Admin → Homepage), each in its own order. A row with no sheets is not shown. */
export default function PickedRow() {
  useSite();   /* re-renders with the catalogue (the site's version) */
  const rows = homeRows();
  if (!rows.length) return null;
  return rows.map(r => (
    <section key={r.id} className="ws-block picked-row" aria-label={r.title} data-list={r.id}>
      <div className="ws-head"><div><p className="eyebrow">{r.title}</p>{r.subtitle ? <p className="ws-sub">{r.subtitle}</p> : null}</div></div>
      <div className="shop-grid">{r.list.map((it, n) => <SheetCard key={it.id} it={it} n={n} store />)}</div>
    </section>
  ));
}
