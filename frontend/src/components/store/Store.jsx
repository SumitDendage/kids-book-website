import { useEffect, useRef } from 'react';
import { useSite } from '../../context/SiteContext.jsx';
import { CLASSES, SUBJECTS, PLANS, classById, subjectById } from '../../data/content.js';
import { money, isIndia } from '../../services/currency.js';
import { dateOf } from '../../utils/format.js';
import { ITEMS, PDF_SHEETS, VIEWS, NEW_IDS, BEST_IDS, SKILL_CATEGORIES, SKILL_NAME, skillSheets, groupSheets } from '../../data/catalogue.js';
import SheetCard, { subjectMatches } from '../sheets/SheetCard.jsx';

/* THE STORE — a page of its own over the story. Sidebar: New · Bestselling · Free ·
   Subscription, then classes and subjects. Behind it: the Learn With Why picture
   (public/shop/learn-with-why-wallpaper.webp). Each skill card shows its own corner of that
   picture (public/shop/cards/<section id>.webp); the sheet cards are see-through, each in its own colour. */
function SideButton({ on, onClick, n, children }) {
  return <button type="button" className={'side-btn' + (on ? ' on' : '')} aria-pressed={on} onClick={onClick}><span className="side-lbl">{children}</span>{n != null ? <span className={'side-n' + (typeof n === 'string' ? ' soon' : '')}>{n}</span> : null}</button>;
}

const CARD_PICS = '/shop/cards/';

/* only Kindergarten has sheets so far: Class 1, 2 and 3 say "Coming soon" */
const SOON = { c1: true, c2: true, c3: true };
/* Vocabulary is not a class: it is Kindergarten's Vocabulary group, listed as a row of its own
   under Classes, right after Kindergarten, so the shop matches the Sheets list (Sumit, Oct 7:
   "vocab also add here also behind in classes"). Its sheets are Kindergarten sheets, so the
   Kindergarten plan opens them and the Kindergarten row still counts them. */
const VOCAB = 'vocab';
const clsLabel = id => (id === VOCAB ? 'Vocabulary' : classById(id).label);
const planCls = id => (id === 'all' || id === VOCAB ? 'kg' : id);

/* Subscribe to a class (1, 3, 6 months; 12 outside India). With a plan running it says until
   when, and the same buttons renew it — the new plan starts the day the current one ends. */
function SubscribeBox({ cls, sub, openCheckout }) {
  const label = classById(cls).label;
  return (
    <div className="shop-sub">
      {sub
        ? <div><b>Your {label} plan is active{sub.end ? ' until ' + dateOf(sub.end) : ''}</b><p>Every sheet in the class opens for you — tap any sheet below.{sub.end ? ' Renew any time: the new plan starts the day this one ends.' : ''}</p></div>
        : <div><b>Subscribe to {label}</b><p>Every sheet in the class opens while your plan runs. {isIndia() ? 'In India: 1, 3 or 6 months.' : 'Choose 1, 3, 6 or 12 months.'}</p></div>}
      {(!sub || sub.end) && <div className="shop-sub-plans">{PLANS.filter(x => !isIndia() || x.id !== 'y1').map(x => <button key={x.id} type="button" className="sub-plan" onClick={() => openCheckout({ cls, plan: x.id })}><b>{sub ? 'Renew · ' + x.label : x.label}</b><span>{money(x.price)}</span>{x.note ? <small>{x.note}</small> : null}</button>)}</div>}
    </div>
  );
}

export default function Store({ bagCount }) {
  const { shop, setShopFilter, closeShop, openDrawer, openCheckout, access } = useSite();
  const { open, view, cls, subject, skill } = shop;
  const shopRef = useRef(null);
  useEffect(() => { if (open && shopRef.current) shopRef.current.scrollTop = 0; }, [open]);

  const vocabIds = groupSheets(VOCAB).map(it => it.id);
  /* the sheets a view, class and subject show */
  const pick = (vw, c, sj) => ITEMS.filter(it => it.pdf && !SOON[it.cls] &&
    (vw === 'all' || (vw === 'new' && NEW_IDS.includes(it.id)) || (vw === 'best' && BEST_IDS.includes(it.id)) || (vw === 'free' && it.price === 0) || (vw === 'paid' && it.price > 0)) &&
    (c === 'all' || (c === VOCAB ? vocabIds.includes(it.id) : it.cls === c)) && subjectMatches(it, sj));
  /* every sidebar number is the number of sheets that button lists */
  const countOf = (vw, c, sj) => pick(vw, c, sj).length;
  const list = pick(view, cls, subject).sort((a, b) => (a.price === 0 ? 0 : 1) - (b.price === 0 ? 0 : 1));
  const v = VIEWS.find(x => x.id === view);
  let title, sub, shown = list;
  if (skill) {
    shown = skillSheets(skill);
    title = SKILL_NAME[skill];
  } else {
    title = v.label + (cls !== 'all' ? ' · ' + clsLabel(cls) : '') + (subject !== 'all' ? ' · ' + subjectById(subject).label : '');
  }
  const showSkills = view === 'all' && cls === 'all' && subject === 'all' && list.length > 0 && !skill;
  const soon = !skill && SOON[cls];
  if (soon) sub = 'New worksheets for ' + clsLabel(cls) + ' are on their way.';
  else if (showSkills) sub = SKILL_CATEGORIES.length + ' skill categories · ' + PDF_SHEETS.length + ' printable PDF sheets · click one to browse';
  else sub = shown.length + (shown.length === 1 ? ' sheet' : ' sheets') + ' · buy one PDF, or subscribe to a class to open them all';

  return (
    <div className={'shop' + (open ? ' open' : '')} id="shop" aria-hidden={open ? 'false' : 'true'} ref={shopRef} role="dialog" aria-label="Every sheet we have">
      <div className="shop-scene" aria-hidden="true"><img src="/shop/learn-with-why-wallpaper.webp" alt="" decoding="async" /></div>
      <header className="shop-bar">
        <div><p className="eyebrow">The shelf</p><h2 className="card-title">Every sheet we have.</h2></div>
        <div className="shop-actions"><button type="button" className="btn btn-ghost" id="shopBagBtn" onClick={() => openDrawer('bag')}>Cart · <b id="shopBagCount">{bagCount}</b></button><button type="button" className="icon-btn" id="shopClose" aria-label="Back to the story" onClick={closeShop}>✕</button></div>
      </header>
      <div className="shop-body">
        <aside className="panel shop-side" aria-label="Filters">
          <p className="side-title">Browse</p>
          <div className="side-list" id="shopViews">{VIEWS.map(x => <SideButton key={x.id} on={x.id === view} n={countOf(x.id, 'all', 'all')} onClick={() => setShopFilter({ view: x.id, cls: 'all', subject: 'all', skill: null })}>{x.label}{x.note ? <small>{x.note}</small> : null}</SideButton>)}</div>
          <p className="side-title">Classes</p>
          <div className="side-list" id="shopClasses"><SideButton on={cls === 'all'} n={countOf(view, 'all', subject)} onClick={() => setShopFilter({ cls: 'all', skill: null })}>All classes</SideButton>{CLASSES.map(c => {
            const row = <SideButton key={c.id} on={c.id === cls} n={SOON[c.id] ? 'Coming soon' : countOf(view, c.id, subject)} onClick={() => setShopFilter({ cls: c.id, skill: null })}>{c.label}</SideButton>;
            if (c.id !== 'kg') return row;
            return [row, <SideButton key={VOCAB} on={cls === VOCAB} n={countOf(view, VOCAB, subject)} onClick={() => setShopFilter({ cls: VOCAB, skill: null })}>Vocabulary</SideButton>];
          })}</div>
          <p className="side-title">Subjects</p>
          <div className="side-list" id="shopSubjects"><SideButton on={subject === 'all'} n={countOf(view, cls, 'all')} onClick={() => setShopFilter({ subject: 'all', skill: null })}>All subjects</SideButton>{SUBJECTS.map(x => <SideButton key={x.id} on={x.id === subject} n={countOf(view, cls, x.id)} onClick={() => setShopFilter({ subject: x.id, skill: null })}>{x.label}</SideButton>)}</div>
          <p className="side-note">Free sheets first. Subscribe to a class and open every sheet in it for as long as your plan runs.</p>
        </aside>
        <main className="shop-main">
          <div className="shop-head"><h3 id="shopTitle">{title}</h3><p id="shopSub">{sub}</p></div>
          <div className={'shop-grid' + (showSkills ? ' skills' : '')} id="shopGrid">
            {view === 'paid' && !skill && !soon && <SubscribeBox cls={planCls(cls)} sub={access.activeSub(planCls(cls))} openCheckout={openCheckout} />}
            {soon ? <div className="shop-soon"><b>Coming soon</b><p>We are making {clsLabel(cls)} worksheets right now. Until then, Kindergarten has {PDF_SHEETS.length} printable sheets ready.</p><button type="button" className="btn btn-primary" onClick={() => setShopFilter({ cls: 'kg', skill: null })}>See Kindergarten sheets →</button></div> : showSkills ? SKILL_CATEGORIES.map((c, n) => (
              <article key={c.id} className={'skill-card skill-' + c.id} style={{ '--n': n }}>
                {/* each skill has its own corner of the Learn With Why picture (public/shop/cards/) */}
                <img className="skill-pic" src={CARD_PICS + c.id + '.webp'} alt="" loading="lazy" decoding="async" />
                <div className="skill-content">
                  <h3 className="card-title">{c.label}</h3>
                  <p className="skill-desc">{c.description}</p>
                  <ul className="skill-list"><li>{skillSheets(c.id).some(it => it.price === 0) ? 'Free sample to explore' : 'Preview every sheet first'}</li><li>Printable and watermarked</li><li>Buy or subscribe to unlock</li></ul>
                  <div className="skill-foot">
                    <span className="skill-count">{c.count} sheets</span>
                    <button type="button" className="btn btn-primary" onClick={() => setShopFilter({ skill: c.id, view: 'all', cls: 'all', subject: 'all' })}>Browse worksheets <span aria-hidden="true">→</span></button>
                  </div>
                </div>
              </article>
            )) : shown.length ? shown.map((it, n) => <SheetCard key={it.id} it={it} n={n} store />) : <p className="cart-empty">Nothing here yet — try another class or subject.</p>}
          </div>
        </main>
      </div>
    </div>
  );
}
