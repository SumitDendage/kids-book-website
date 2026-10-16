import { useState } from 'react';
import { useSite } from '../../context/SiteContext.jsx';
import { classById, subjectById } from '../../data/content.js';
import { NEW_IDS, BEST_IDS } from '../../data/catalogue.js';
import { sheetState, openForText, cartable } from './sheetAccess.js';

/* the line beside a card's button: free, bought, in a plan, ended, or how long a purchase stays open */
export const priceLine = (st, it) => (st.kind === 'free' ? (st.open ? 'Free · ready to open' : 'Free access sheet')
  : !st.ready && !st.open ? 'Coming soon'
  : st.kind === 'bought' ? 'Bought ✓'
  : st.kind === 'plan' ? 'In your plan ✓'
  : st.kind === 'ended' ? 'Access ended'
  : openForText(it));

/* the Open / Open free / Buy PDF / Buy again button of a card — it wins over the card's own click */
export function CardAction({ it, st, openLabel = 'Open ↗', openClass = 'btn btn-ghost', freeLabel = 'Open free', buyLabel = 'Buy PDF' }) {
  const { openViewer, unlock, buy, buyAgain } = useSite();
  const stop = fn => e => { e.stopPropagation(); fn(it.id); };
  if (!st.ready) return <button type="button" className="btn btn-ghost" disabled onClick={e => e.stopPropagation()}>Coming soon</button>;
  if (st.open) return <button type="button" className={openClass} onClick={stop(openViewer)}>{openLabel}</button>;
  if (st.kind === 'free') return <button type="button" className="btn btn-primary" onClick={stop(unlock)}>{freeLabel}</button>;
  if (st.kind === 'ended') return <button type="button" className="btn btn-primary" onClick={stop(buyAgain || buy)}>Buy again</button>;
  return <button type="button" className="btn btn-primary" onClick={stop(buy)}>{buyLabel}</button>;
}

/* "Add to cart" for a paid sheet the customer does not have open; "In cart" (opens the cart) once it is there.
   The buy button beside it still buys the one sheet straight away. */
export function CartButton({ it, st, className = 'btn btn-ghost' }) {
  const { cart, addToCart, openCart } = useSite();
  const [busy, setBusy] = useState(false);
  if (!cartable(it, st)) return null;
  const inCart = cart.has(it.id);
  const click = async e => {
    e.stopPropagation();
    if (inCart) { openCart(); return; }
    setBusy(true);
    try { await addToCart(it.id); } finally { setBusy(false); }
  };
  return <button type="button" className={className + (inCart ? ' in-cart' : '')} data-cart={it.id} aria-pressed={inCart} disabled={busy} onClick={click}>{inCart ? 'In cart ✓' : busy ? 'Adding…' : 'Add to cart'}</button>;
}

/* open the card with Enter or Space as well as a click (the card is focusable) */
export const cardKeys = open => e => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); open(); } };

/* A paper card on the shelf (Sheets chapter) or in the store: the printed page when there is a
   thumbnail; the store also shows the New / Bestseller tags. */
export default function SheetCard({ it, n, store = false }) {
  const { access, openSheet } = useSite();
  const free = it.price === 0, st = sheetState(access, it), mine = st.open;
  const tag = mine ? <b className="tag">{free ? 'Free' : 'Unlocked'}</b>
    : store && NEW_IDS.includes(it.id) ? <b className="tag" style={{ background: '#3b5bdb' }}>New</b>
    : store && BEST_IDS.includes(it.id) ? <b className="tag" style={{ background: '#b8862b' }}>Bestseller</b>
    : free ? <b className="tag free">Free</b> : <b className="tag" aria-label="Locked">🔒</b>;
  /* every card shows the printed page when the sheet has a picture, on the shelf as well as in the store */
  const shot = !!it.img;
  const meta = store
    ? (it.cls ? classById(it.cls).label + ' · ' : '') + it.subject + (it.pages ? ' · ' + it.pages + ' pages' : '')
    : (it.cls ? classById(it.cls).label : it.cat || '') + (it.pages ? ' · ' + it.pages + ' pages' : '');
  const open = () => openSheet(it.id);
  return (
    <article className="shop-card" style={{ '--n': n }} tabIndex={0} aria-label={it.title} onClick={open} onKeyDown={cardKeys(open)}>
      <div className={'paper' + (shot ? ' shot' : '')}>
        {shot ? <img src={it.img} alt="" loading="lazy" /> : <><small>{it.subject}</small><div className="glyph">{it.glyph}</div><small>Learn With Why · PDF</small></>}
        {tag}
      </div>
      <p className="meta">{meta}</p>
      <h3 className="card-title">{it.title}</h3>
      <p>{it.blurb}</p>
      {store && cartable(it, st)
        ? <div className="row has-cart"><span className="price">{priceLine(st, it)}</span><span className="card-btns"><CartButton it={it} st={st} /><CardAction it={it} st={st} /></span></div>
        : <div className="row"><span className={'price' + (free ? ' free' : '')}>{priceLine(st, it)}</span>
          <CardAction it={it} st={st} /></div>}
    </article>
  );
}

/* the subject label a store filter matches against */
export const subjectMatches = (it, subject) => subject === 'all' || it.subjectId === subject || it.subject.toLowerCase() === subjectById(subject).label.toLowerCase();
