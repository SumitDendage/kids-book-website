import { useRef } from 'react';
import { useSite } from '../../context/SiteContext.jsx';
import usePreviewPlayer from '../../hooks/usePreviewPlayer.js';
import { KG_TOPICS, CATALOGUE, WORKSHEETS, topicSheets } from '../../data/catalogue.js';
import SheetCard from './SheetCard.jsx';
import { AzTile, PicTile } from './SheetTiles.jsx';

/* Kindergarten follows the content plan: the Alphabet category, then its eight
   sub-categories in order, each with its own sheets. The fox and rabbit keep playing
   behind the category banner while the Sheets chapter is in view. */
const ALPHA = KG_TOPICS[0];
const inSections = () => new Set(ALPHA.items.flatMap(([id]) => topicSheets(id).map(it => it.id)));
/* the Kindergarten books and weekly sheets that are not in a sub-category yet */
export const kgMore = () => { const seen = inSections(); return CATALOGUE.concat(WORKSHEETS).filter(it => it.cls === 'kg' && !seen.has(it.id)); };
export const kgSheetCount = () => inSections().size + kgMore().length;

/* what the reader can open today, from the real prices (the server can change them) */
function accessOf(list) {
  if (!list.length) return { text: 'Coming soon', tone: 'soon' };
  const free = list.filter(it => it.price === 0).length;
  if (free === list.length) return { text: 'Free', tone: 'free' };
  if (!free) return { text: 'Paid', tone: 'paid' };
  return { text: free + ' free · rest paid', tone: 'part' };
}

function Subcategory({ no, id, label, focus }) {
  const list = topicSheets(id);
  const az = list.filter(it => it.az || it.letter), pic = list.filter(it => it.rc || it.chart), rest = list.filter(it => !it.az && !it.letter && !it.rc && !it.chart);
  const acc = accessOf(list);
  return (
    <article className="kg-sub" id={'kg-' + id} aria-labelledby={'kg-' + id + '-t'}>
      <header className="kg-sub-head">
        <span className="kg-no" aria-hidden="true">{String(no).padStart(2, '0')}</span>
        <div className="kg-sub-copy"><h4 id={'kg-' + id + '-t'}>{label}</h4><p>{focus}</p></div>
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
  const { section } = useSite();
  const bgRef = useRef(null);
  usePreviewPlayer(bgRef, 14, section === 3);
  const more = kgMore();
  return (
    <section className="kg-alpha rise" style={{ '--i': 3 }} aria-label="Kindergarten · Alphabet">
      <div className="kg-hero">
        <canvas ref={bgRef} aria-label="A fox and a rabbit studying together" />
        <div className="kg-hero-shade" />
        <div className="kg-hero-copy">
          <p className="eyebrow">Kindergarten · Main category</p>
          <h3>{ALPHA.title}</h3>
          <p>Eight small steps from tracing A to Z to hearing the sounds inside a word. Free samples in every set let you try a sheet before you buy the rest.</p>
          <ol className="kg-steps">{ALPHA.items.map(([id, label], k) => <li key={id}><b>{String(k + 1).padStart(2, '0')}</b>{label}</li>)}</ol>
        </div>
      </div>
      {ALPHA.items.map(([id, label, focus], k) => <Subcategory key={id} no={k + 1} id={id} label={label} focus={focus} />)}
      {more.length > 0 && (
        <article className="kg-sub kg-more" aria-labelledby="kg-more-t">
          <header className="kg-sub-head">
            <span className="kg-no" aria-hidden="true">+</span>
            <div className="kg-sub-copy"><h4 id="kg-more-t">More for Kindergarten</h4><p>Counting, colouring, first words and the weekly sheets.</p></div>
            <span className="kg-access part">{more.length} {more.length === 1 ? 'sheet' : 'sheets'}</span>
          </header>
          <div className="shop-grid">{more.map((it, n) => <SheetCard key={it.id} it={it} n={n} />)}</div>
        </article>
      )}
    </section>
  );
}
