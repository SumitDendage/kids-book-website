import { useSite } from '../../context/SiteContext.jsx';
import { classById, subjectById } from '../../data/content.js';
import { NEW_IDS, BEST_IDS } from '../../data/catalogue.js';

export const priceLine = (free, mine) => (mine ? (free ? 'Free · open any time' : 'Yours to keep ✓') : free ? 'Free access sheet' : 'Yours to keep once bought');

/* the Open / Open free / Buy PDF button of a card — it wins over the card's own click */
export function CardAction({ it, mine, openLabel = 'Open ↗', openClass = 'btn btn-ghost', freeLabel = 'Open free', buyLabel = 'Buy PDF' }) {
  const { openViewer, unlock, buy } = useSite();
  const free = it.price === 0;
  const stop = fn => e => { e.stopPropagation(); fn(it.id); };
  if (mine) return <button type="button" className={openClass} onClick={stop(openViewer)}>{openLabel}</button>;
  if (free) return <button type="button" className="btn btn-primary" onClick={stop(unlock)}>{freeLabel}</button>;
  return <button type="button" className="btn btn-primary" onClick={stop(buy)}>{buyLabel}</button>;
}

/* open the card with Enter or Space as well as a click (the card is focusable) */
export const cardKeys = open => e => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); open(); } };

/* A paper card on the shelf (Sheets chapter) or in the store. The store shows the
   printed page when there is a thumbnail and the New / Bestseller tags. */
export default function SheetCard({ it, n, store = false }) {
  const { access, openSheet } = useSite();
  const free = it.price === 0, mine = access.canOpen(it);
  const tag = mine ? <b className="tag">{free ? 'Free' : 'Unlocked'}</b>
    : store && NEW_IDS.includes(it.id) ? <b className="tag" style={{ background: '#3b5bdb' }}>New</b>
    : store && BEST_IDS.includes(it.id) ? <b className="tag" style={{ background: '#b8862b' }}>Bestseller</b>
    : free ? <b className="tag free">Free</b> : <b className="tag" aria-label="Locked">🔒</b>;
  const shot = store && it.img;
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
      <div className="row"><span className={'price' + (free ? ' free' : '')}>{priceLine(free, mine)}</span>
        <CardAction it={it} mine={mine} /></div>
    </article>
  );
}

/* the subject label a store filter matches against */
export const subjectMatches = (it, subject) => subject === 'all' || it.subjectId === subject || it.subject.toLowerCase() === subjectById(subject).label.toLowerCase();
