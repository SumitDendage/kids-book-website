import { useSite } from '../../context/SiteContext.jsx';
import { homeSheets } from '../../data/catalogue.js';
import SheetCard from './SheetCard.jsx';

/* "Picked for you": the sheets staff put on the home page (Admin → Products → Show on the home page),
   in their display order. Nothing shows until a sheet is picked. */
export default function PickedRow() {
  useSite();   /* re-renders with the catalogue (the site's version) */
  const list = homeSheets();
  if (!list.length) return null;
  return (
    <section className="ws-block picked-row" aria-label="Picked for you">
      <div className="ws-head"><div><p className="eyebrow">Picked for you</p></div></div>
      <div className="shop-grid">{list.map((it, n) => <SheetCard key={it.id} it={it} n={n} store />)}</div>
    </section>
  );
}
