import { KG_TOPICS, CATALOGUE, WORKSHEETS, topicSheets } from '../../data/catalogue.js';
import SheetCard from './SheetCard.jsx';
import { AzTile, PicTile } from './SheetTiles.jsx';

/* Kindergarten follows the Kindergarten content plan: the Alphabet category and its
   eight sub-categories, in order, each with its own sheets. */
const ALPHA = KG_TOPICS.find(g => g.id === 'alpha');
const inSections = () => new Set(ALPHA.items.flatMap(([id]) => topicSheets(id).map(it => it.id)));
/* the Kindergarten books and weekly sheets that are not in a sub-category */
export const kgMore = () => { const seen = inSections(); return CATALOGUE.concat(WORKSHEETS).filter(it => it.cls === 'kg' && !seen.has(it.id)); };
export const kgSheetCount = () => inSections().size + kgMore().length;

/* what can be opened free today, from the real prices (the server can change them) */
function accessOf(list) {
  if (!list.length) return { text: 'Coming soon', tone: 'soon' };
  const free = list.filter(it => it.price === 0).length;
  if (free === list.length) return { text: 'Free', tone: 'free' };
  return free ? { text: free + ' free · rest paid', tone: 'part' } : { text: 'Paid', tone: 'paid' };
}

function Section({ no, id, label, list }) {
  const az = list.filter(it => it.az || it.letter), pic = list.filter(it => it.rc || it.chart), rest = list.filter(it => !it.az && !it.letter && !it.rc && !it.chart);
  const acc = accessOf(list);
  return (
    <article className="kg-sub" aria-labelledby={'kg-' + id}>
      <header className="kg-sub-head">
        <span className="kg-no" aria-hidden="true">{no}</span>
        <h4 id={'kg-' + id}>{label}</h4>
        <span className={'kg-access ' + acc.tone}>{acc.text}{list.length ? <i>{list.length} {list.length === 1 ? 'sheet' : 'sheets'}</i> : null}</span>
      </header>
      {az.length > 0 && <div className="az-grid">{az.map((it, n) => <AzTile key={it.id} it={it} n={n} />)}</div>}
      {pic.length > 0 && <div className="rc-grid" style={{ marginTop: az.length ? '12px' : 0 }}>{pic.map((it, n) => <PicTile key={it.id} it={it} n={n} />)}</div>}
      {rest.length > 0 && <div className="shop-grid" style={{ marginTop: az.length || pic.length ? '12px' : 0 }}>{rest.map((it, n) => <SheetCard key={it.id} it={it} n={n} />)}</div>}
      {list.length ? null : <p className="kg-soon">These sheets are being drawn. They will appear here as soon as they are ready.</p>}
    </article>
  );
}

export default function KgTopics() {
  const more = kgMore();
  return (
    <section className="kg-alpha rise" style={{ '--i': 3 }} aria-label="Kindergarten · Alphabet">
      <div className="kg-alpha-head"><p className="eyebrow">Kindergarten · Main category</p><h3>Alphabet</h3></div>
      {ALPHA.items.map(([id, label], k) => <Section key={id} no={String(k + 1).padStart(2, '0')} id={id} label={label} list={topicSheets(id)} />)}
      {more.length > 0 && <Section no="+" id="more" label="More for Kindergarten" list={more} />}
    </section>
  );
}
