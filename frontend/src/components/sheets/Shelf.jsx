import { useEffect, useRef, useState } from 'react';
import { useSite } from '../../context/SiteContext.jsx';
import { CLASSES, SUBJECTS, classById } from '../../data/content.js';
import { ITEMS, KG_TOPICS, AZ_LETTERS, AZ_FREE, azItem } from '../../data/catalogue.js';
import { subjectMatches } from './SheetCard.jsx';
import Rise from '../common/Rise.jsx';
import SheetCard from './SheetCard.jsx';
import { AzTile } from './SheetTiles.jsx';
import KgTopics, { kgSheetCount, alphaSheetCount, vocabSheetCount } from './KgTopics.jsx';
import VocabBoard from './VocabBoard.jsx';
import vocabIcon from '../../assets/vocab/colours.webp';

/* One shelf per class: the free sheet first, the paid ones right beside it.
   Left-side menu: "By class" (Kindergarten … Class 3) and "By topic" (every subject).
   Kindergarten has Alphabet under it in the menu; Vocabulary is a row of its own. */
const SIDE_ICON = { kg: 'Aa', c1: '1', c2: '2', c3: '3', english: 'Aa', maths: '12', science: '?' };
/* only sheets with a real PDF; the A to Z letters have their own block above the list */
const poolOf = id => ITEMS.filter(i => i.pdf && !i.az && (id.startsWith('subj:') ? subjectMatches(i, id.slice(5)) : i.cls === id));
const hasAZ = id => id === 'subj:english';
/* only Kindergarten has sheets so far: Class 1, 2 and 3 say "Coming soon" (as in the store) */
const SOON = { c1: true, c2: true, c3: true };
/* Kindergarten's Alphabet, a row of its own under Kindergarten: id, name, sheet count, icon */
const KG_PARTS = [['alpha', 'Alphabet', alphaSheetCount, 'Az']];
const countOf = id => (id === 'kg' ? alphaSheetCount() : poolOf(id).length + (hasAZ(id) ? AZ_LETTERS.length : 0));

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
  const glide = useRef(false);   /* set by a tap that changes the board: bring the board into view */
  /* the chapter grows or shrinks: re-measure the stack. On a phone the board sits below the
     menu, so after a tap there the page glides to the board's top. */
  useEffect(() => {
    stage.measure();
    if (!glide.current) return;
    glide.current = false;
    const top = document.getElementById('azBlock')?.getBoundingClientRect().top;
    if (top != null && (top < 70 || top > innerHeight * 0.55)) stage.target = stage.clamp(stage.current + top - 96);
  }, [cat, kgOpen, version, stage]);
  const pick = id => { glide.current = true; setCat(id); setKgOpen(null); };
  const openTopic = id => { glide.current = true; setKgOpen(id); };

  const sideItem = (id, label) => (
    <button key={id} type="button" className={'side-item' + (id === 'kg' ? ' kg-parent' : '') + (id === cat ? ' on' : '')} aria-current={id === cat ? 'true' : 'false'} onClick={() => { setCat(id); setKgOpen(null); }}>
      <span className="ic" aria-hidden="true">{SIDE_ICON[id.replace('subj:', '')] || '•'}</span><span className="lbl"><b>{label}</b></span><span className={'n' + (SOON[id] ? ' soon' : '')}>{SOON[id] ? 'Coming soon' : countOf(id)}</span>
    </button>
  );

  /* Alphabet, a row of its own just under Kindergarten */
  const kgParts = KG_PARTS.map(([part, label, n, ic]) => {
    const on = cat === 'kg';
    return (
      <button key={'kg-' + part} type="button" className={'side-item side-child' + (on ? ' on' : '')} aria-current={on ? 'true' : 'false'} onClick={() => pick('kg')}>
        <span className="ic" aria-hidden="true">{ic}</span><span className="lbl"><b>{label}</b></span><span className="n">{n()}</span>
      </button>
    );
  });
  /* Vocabulary, a row of its own after Kindergarten, not under it (Sumit, Oct 7) */
  const vocabRow = (
    <button key="vocab" type="button" className={'side-item side-vocab' + (cat === 'vocab' ? ' on' : '')} aria-current={cat === 'vocab' ? 'true' : 'false'} onClick={() => pick('vocab')}>
      <span className="ic" aria-hidden="true"><img src={vocabIcon} alt="" /></span><span className="lbl"><b>Vocabulary</b></span><span className="n">{vocabSheetCount()}</span>
    </button>
  );

  let row = null, count;
  if (cat === 'kg') {   /* Kindergarten is organised by the content plan above — nothing to repeat here */
    count = 'Alphabet · ' + KG_TOPICS.find(g => g.id === 'alpha').items.length + ' sub-categories · ' + alphaSheetCount() + ' sheets';
  } else if (cat === 'vocab') {
    count = 'Vocabulary · ' + KG_TOPICS.find(g => g.id === 'vocab').items.length + ' topics · ' + vocabSheetCount() + ' sheets';
  } else if (SOON[cat]) {
    row = <div className="ws-soon"><b>Coming soon</b><p>We are making {classById(cat).label} worksheets right now. Until then, Kindergarten has {kgSheetCount()} printable sheets ready.</p><button type="button" className="btn btn-primary" onClick={() => pick('kg')}>See Kindergarten sheets →</button></div>;
    count = classById(cat).label + ' · coming soon';
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
          {CLASSES.map(t => t.id === 'kg' ? [sideItem(t.id, t.label), ...kgParts, vocabRow] : sideItem(t.id, t.label))}
          <div className="side-sep" /><p className="side-title">By topic</p>
          {SUBJECTS.map(s => sideItem('subj:' + s.id, s.label))}
        </Rise>
        <div className="ws-main">
          <div id="azBlock" hidden={!(cat === 'kg' || cat === 'vocab' || hasAZ(cat))}>
            {cat === 'kg' ? <KgTopics open={kgOpen} onOpen={openTopic} /> : cat === 'vocab' ? <VocabBoard open={kgOpen} onOpen={openTopic} /> : hasAZ(cat) ? <AzBlock /> : null}
          </div>
          <Rise i={3} className="shop-grid" id="wsRow" hidden={cat === 'kg' || cat === 'vocab'}>{row}</Rise>
          <Rise i={4} className="ws-nav"><span id="wsCount">{count}</span><button type="button" className="btn btn-ghost" style={{ marginLeft: 'auto' }} onClick={() => openShop('all')}>See every sheet →</button></Rise>
        </div>
      </div>
    </div>
  );
}
