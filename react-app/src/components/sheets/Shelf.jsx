import { useEffect, useState } from 'react';
import { useSite } from '../../context/SiteContext.jsx';
import { CLASSES, SUBJECTS, classById, subjectById } from '../../data/content.js';
import { CATALOGUE, WORKSHEETS, KG_TOPICS, AZ_LETTERS, AZ_FREE, azItem } from '../../data/catalogue.js';
import Rise from '../common/Rise.jsx';
import SheetCard from './SheetCard.jsx';
import { AzTile } from './SheetTiles.jsx';
import KgTopics, { kgSheetCount } from './KgTopics.jsx';

/* One shelf per class: the free sheet first, the paid ones right beside it.
   Left-side menu: "By class" (Kindergarten … Class 3) and "By topic" (every subject). */
const SIDE_ICON = { kg: 'Aa', c1: '1', c2: '2', c3: '3', english: 'Aa', maths: '12', science: '?', evs: '🌱', hindi: 'क', art: '✿' };
const poolOf = id => id.startsWith('subj:')
  ? CATALOGUE.filter(i => i.subjectId === id.slice(5)).concat(WORKSHEETS.filter(w => w.subject.toLowerCase() === subjectById(id.slice(5)).label.toLowerCase()))
  : CATALOGUE.concat(WORKSHEETS).filter(i => i.cls === id);   /* the weekly worksheets now sit in their own class */
const hasAZ = id => id === 'subj:english';
const countOf = id => (id === 'kg' ? kgSheetCount() : poolOf(id).length + (hasAZ(id) ? AZ_LETTERS.length : 0));

/* English: the 26 A to Z letter-tracing sheets above the books */
function AzBlock() {
  return (
    <section className="az rise" style={{ '--i': 3 }} aria-label="A to Z free sheets">
      <div className="az-head">
        <div><p className="eyebrow">Letter tracing · A to Z</p><h3>Every letter, <em>one calm page.</em></h3></div>
        <p>Twenty-six alphabet sheets to trace, colour and say out loud. <b>{AZ_FREE.join(', ')} are free</b> — sign in and open them. Tap any other letter to see its price; once bought it stays on your account for good.</p>
      </div>
      <div className="az-grid">{AZ_LETTERS.map(azItem).map((it, n) => <AzTile key={it.id} it={it} n={n} />)}</div>
      <div className="az-foot"><span>26 sheets · PDF · A4</span><span>{AZ_FREE.length} free · the rest are paid</span></div>
    </section>
  );
}

export default function Shelf() {
  const { stage, openShop, version } = useSite();
  const [cat, setCat] = useState(CLASSES[0].id);
  const [kgOpen, setKgOpen] = useState(null);   /* the Kindergarten section that is open, or null for the tiles */
  /* the chapter grows or shrinks: re-measure the stack */
  useEffect(() => { stage.measure(); }, [cat, kgOpen, version, stage]);

  const sideItem = (id, label) => (
    <button key={id} type="button" className={'side-item' + (id === cat ? ' on' : '')} aria-current={id === cat ? 'true' : 'false'} onClick={() => { setCat(id); setKgOpen(null); }}>
      <span className="ic" aria-hidden="true">{SIDE_ICON[id.replace('subj:', '')] || '•'}</span><span className="lbl"><b>{label}</b></span><span className="n">{countOf(id)}</span>
    </button>
  );

  let row = null, count;
  if (cat === 'kg') {   /* Kindergarten is organised by the content plan above — nothing to repeat here */
    count = 'Alphabet · ' + KG_TOPICS.find(g => g.id === 'alpha').items.length + ' sub-categories · ' + kgSheetCount() + ' sheets';
  } else {
    const list = poolOf(cat).slice().sort((a, b) => (a.price === 0 ? 0 : 1) - (b.price === 0 ? 0 : 1));
    row = list.length ? list.map((it, n) => <SheetCard key={it.id} it={it} n={n} />) : <p className="cart-empty">No sheets in this topic yet — more are on the way.</p>;
    const free = list.filter(i => i.price === 0).length;
    count = free + ' free · ' + (list.length - free) + ' to buy (or ' + (cat.startsWith('subj:') ? 'a class plan' : 'the ' + classById(cat).label + ' plan') + ')';
  }

  return (
    <div className="ws-block">
      <div className="ws-head">
        <div>
          <Rise as="p" i={0} className="eyebrow">The shelf · free first, then the rest</Rise>
          <Rise as="h2" i={1} className="h2">Grow a little.<br /><em>Every day.</em></Rise>
        </div>
        <Rise as="p" i={2} className="aside">Pick a class. The free sheet comes first — try it, then subscribe to open the ones beside it. <em>Little sums, big smiles.</em></Rise>
      </div>
      <div className="ws-layout">
        <Rise as="aside" i={2} className="ws-side" id="chips" aria-label="Browse by class">
          <p className="side-title">By class</p>
          {CLASSES.map(t => sideItem(t.id, t.label))}
          <div className="side-sep" /><p className="side-title">By topic</p>
          {SUBJECTS.map(s => sideItem('subj:' + s.id, s.label))}
        </Rise>
        <div className="ws-main">
          <div id="azBlock" hidden={!(cat === 'kg' || hasAZ(cat))}>
            {cat === 'kg' ? <KgTopics open={kgOpen} onOpen={setKgOpen} /> : hasAZ(cat) ? <AzBlock /> : null}
          </div>
          <Rise i={3} className="shop-grid" id="wsRow" hidden={cat === 'kg'}>{row}</Rise>
          <Rise i={4} className="ws-nav"><span id="wsCount">{count}</span><button type="button" className="btn btn-ghost" style={{ marginLeft: 'auto' }} onClick={() => openShop('all')}>See every sheet →</button></Rise>
        </div>
      </div>
    </div>
  );
}
