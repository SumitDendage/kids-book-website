import { KG_TOPICS, ITEMS, topicSheets } from '../../data/catalogue.js';
import SheetCard from './SheetCard.jsx';
import { AzTile, PicTile } from './SheetTiles.jsx';

/* Kindergarten follows the Kindergarten content plan: one tile for each of the seven
   Alphabet sub-categories, in order. A tile opens to every sheet in it.
   Vocabulary has its own board (VocabBoard.jsx); its sheets are not "More for Kindergarten". */
const ALPHA = KG_TOPICS.find(g => g.id === 'alpha');
export const VOCAB = KG_TOPICS.find(g => g.id === 'vocab');
const idsOf = g => new Set(g.items.flatMap(([id]) => topicSheets(id).map(it => it.id)));
const inSections = () => new Set([...idsOf(ALPHA), ...idsOf(VOCAB)]);
/* the Kindergarten books and weekly sheets that are not in a sub-category */
export const kgMore = () => { const seen = inSections(); return ITEMS.filter(it => it.pdf && it.cls === 'kg' && !seen.has(it.id)); };
export const kgSheetCount = () => inSections().size + kgMore().length;
/* the Alphabet board shows the seven sub-categories and the "More" tile */
export const alphaSheetCount = () => idsOf(ALPHA).size + kgMore().length;
export const vocabSheetCount = () => idsOf(VOCAB).size;
const MORE = ['more', 'More for Kindergarten', 'Counting, colouring, first words and the weekly sheets.'];
const sections = () => ALPHA.items.map((x, k) => ({ no: String(k + 1).padStart(2, '0'), id: x[0], label: x[1], focus: x[2], list: topicSheets(x[0]) }))
  .concat(kgMore().length ? [{ no: '+', id: MORE[0], label: MORE[1], focus: MORE[2], list: kgMore() }] : []);

/* what can be opened free today, from the real prices (the server can change them) */
function accessOf(list) {
  if (!list.length) return { text: 'Coming soon', tone: 'soon' };
  const free = list.filter(it => it.price === 0).length;
  if (free === list.length) return { text: 'Free', tone: 'free' };
  return free ? { text: free + ' free · rest paid', tone: 'part' } : { text: 'Paid', tone: 'paid' };
}

export default function KgTopics({ open, onOpen }) {
  const all = sections();
  const s = open && all.find(x => x.id === open);
  if (s) return <TopicOpen s={s} crumb="Kindergarten › Alphabet" back="← All sections" onBack={() => onOpen(null)} />;
  return (
    <section className="kg-topics rise" style={{ '--i': 3 }} aria-label="Kindergarten · Alphabet">
      <div className="kg-head"><p className="eyebrow">Kindergarten · Main category</p><h3>Alphabet</h3></div>
      <div className="kg-tiles">
        {all.map((x, n) => {
          const acc = accessOf(x.list);
          return (
            <article key={x.id} className={'kg-tile' + (x.list.length ? '' : ' soon')} style={{ '--n': n }}>
              <span className="kg-no" aria-hidden="true">{x.no}</span>
              <h4 className="card-title">{x.label}</h4>
              <p className="kg-focus">{x.focus}</p>
              <span className={'kg-access ' + acc.tone}>{acc.text}</span>
              <div className="kg-foot">
                <span>{x.list.length ? x.list.length + (x.list.length === 1 ? ' sheet' : ' sheets') : 'Sheets on the way'}</span>
                {x.list.length ? <button type="button" className="btn btn-sm btn-primary" onClick={() => onOpen(x.id)}>Browse worksheets <span aria-hidden="true">→</span></button> : null}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

/* one sub-category opened: its sheets, with a way back to the tiles */
export function TopicOpen({ s, crumb, back, onBack }) {
  const list = s.list, az = list.filter(it => it.az || it.letter), pic = list.filter(it => it.rc || it.chart), rest = list.filter(it => !it.az && !it.letter && !it.rc && !it.chart);
  return (
    <section className="kg-open rise" style={{ '--i': 3 }}>
      <div className="kg-open-head">
        <button type="button" className="btn btn-ghost btn-back" onClick={onBack}>{back}</button>
        <div><p className="eyebrow">{crumb}</p><h3>{s.label} <em>· {list.length} {list.length === 1 ? 'sheet' : 'sheets'}</em></h3></div>
        <p className="kg-hint">{s.focus}{list.length ? ' Tap a sheet to see its price and what is inside.' : ''}</p>
      </div>
      {az.length > 0 && <div className="az-grid">{az.map((it, n) => <AzTile key={it.id} it={it} n={n} />)}</div>}
      {pic.length > 0 && <div className="rc-grid" style={{ marginTop: az.length ? '12px' : 0 }}>{pic.map((it, n) => <PicTile key={it.id} it={it} n={n} />)}</div>}
      {rest.length > 0 && <div className="shop-grid" style={{ marginTop: az.length || pic.length ? '12px' : 0 }}>{rest.map((it, n) => <SheetCard key={it.id} it={it} n={n} />)}</div>}
      {list.length ? null : <p className="kg-soon">These sheets are being drawn. They will appear here as soon as they are ready.</p>}
    </section>
  );
}
