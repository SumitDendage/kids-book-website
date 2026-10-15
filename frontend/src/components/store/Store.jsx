import { useEffect, useRef, useState } from 'react';
import { useSite } from '../../context/SiteContext.jsx';
import { CLASSES, SUBJECTS, classById, subjectById } from '../../data/content.js';
import { money, isIndia } from '../../services/currency.js';
import { getCoConfig, loadCoConfig, monthsText, serverPlans } from '../../services/checkout.js';
import { eventsApi } from '../../services/api.js';
import { dateTimeTz } from '../../utils/format.js';
import { ITEMS, PDF_SHEETS, VIEWS, NEW_IDS, BEST_IDS, SKILL_CATEGORIES, SKILL_NAME, skillSheets, groupSheets, KG_TOPICS, topicSheets } from '../../data/catalogue.js';
import SheetCard, { subjectMatches } from '../sheets/SheetCard.jsx';
import { CartIcon } from '../layout/Navbar.jsx';

/* ---------- search: typed words are looked for in each sheet's title, description, class, subject
   and the names of the sections and topics it sits in (in the browser, over the catalogue the
   site already has). Every word must be found somewhere; case and accents do not matter. ---------- */
const fold = v => String(v || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[–—-]+/g, ' ');
let topicWords = null;   /* sheet id → the topic and group names it is listed under (built once) */
function topicsOf(id) {
  if (!topicWords) {
    topicWords = {};
    KG_TOPICS.forEach(g => g.items.forEach(([tid, label]) => topicSheets(tid).forEach(it => { topicWords[it.id] = (topicWords[it.id] || '') + ' ' + label + ' ' + g.title; })));
  }
  return topicWords[id] || '';
}
const hayOf = it => fold([it.title, it.blurb, it.description, it.subject, it.cls ? (classById(it.cls) || {}).label : '', it.cls === 'kg' ? 'KG' : '',
  it.sectionLabel, it.cat, it.kicker, Array.isArray(it.tags) ? it.tags.join(' ') : '', Array.isArray(it.about) ? it.about.join(' ') : '',
  it.price === 0 ? 'free' : 'paid', topicsOf(it.id)].join(' '));
const wordsOf = q => fold(q).split(/[^a-z0-9]+/).filter(Boolean);
/* every typed word must start a word of the sheet ("trac" finds tracing); a single letter must be a
   whole word, so "alphabet c" finds the letter C and not every sheet with a c in it */
const tokensOf = it => ' ' + hayOf(it).split(/[^a-z0-9]+/).filter(Boolean).join(' ') + ' ';
export const matchesSearch = (it, words) => !words.length || (h => words.every(w => h.includes(w.length === 1 ? ' ' + w + ' ' : ' ' + w)))(tokensOf(it));

/* THE STORE — a page of its own over the story. Sidebar: New · Bestselling · Free ·
   Subscription, then classes and subjects. Behind it: the Learn With Why picture
   (public/shop/learn-with-why-wallpaper.webp). Each skill card shows its own corner of that
   picture (public/shop/cards/<section id>.webp); the sheet cards are see-through, each in its own colour. */
function SideButton({ on, onClick, n, children }) {
  return <button type="button" className={'side-btn' + (on ? ' on' : '')} aria-pressed={on} onClick={onClick}><span className="side-lbl">{children}</span>{n != null ? <span className={'side-n' + (typeof n === 'string' ? ' soon' : '')}>{n}</span> : null}</button>;
}

const CARD_PICS = '/shop/cards/';

/* only Kindergarten has sheets so far: Class 1, 2 and 3 say "Coming soon" (the server's
   classStatus in GET /api/config says which classes are on sale; this is the fallback) */
const SOON = { c1: true, c2: true, c3: true };
const soonIn = config => c => (config && config.classStatus && config.classStatus[c] ? config.classStatus[c] !== 'available' : !!SOON[c]);
/* Vocabulary is not a class: it is Kindergarten's Vocabulary group, listed as a row of its own
   under Classes, right after Kindergarten, so the shop matches the Sheets list (Sumit, Oct 7:
   "vocab also add here also behind in classes"). Its sheets are Kindergarten sheets, so the
   Kindergarten plan opens them and the Kindergarten row still counts them. */
const VOCAB = 'vocab';
const clsLabel = id => (id === VOCAB ? 'Vocabulary' : classById(id).label);
const planCls = id => (id === 'all' || id === VOCAB ? 'kg' : id);

/* Subscribe to a class (1, 3, 6 months; 12 outside India). The plans and their prices come from
   the server (GET /api/config): the price before tax and fees, in the shop's currency. With a plan
   running it says until when, and the same buttons renew it: the new plan starts when the current one ends. */
function SubscribeBox({ cls, sub, openCheckout, config, failed, tz }) {
  const label = classById(cls).label;
  const plans = serverPlans(config, isIndia() ? 'IN' : 'OTHER', cls);
  const months = monthsText(plans);
  return (
    <div className="shop-sub">
      {sub
        ? <div><b>Your {label} plan is active{sub.end ? ' until ' + dateTimeTz(sub.end, tz) : ''}</b><p>Every sheet in the class opens for you. Tap any sheet below.{sub.end ? ' Renew any time: the new plan starts the moment this one ends.' : ''}</p></div>
        : <div><b>Subscribe to {label}</b><p>Every sheet in the class opens while your plan runs.{months ? (isIndia() ? ' In India: ' : ' Choose ') + months + '.' : ''}</p></div>}
      {(!sub || sub.end) && <div className="shop-sub-plans">{plans.length
        ? plans.map(x => <button key={x.id} type="button" className="sub-plan" onClick={() => openCheckout({ cls, plan: x.id })}><b>{sub ? 'Renew · ' + x.label : x.label}</b><span>{money(x.price)}</span>{x.note ? <small>{x.note}</small> : null}</button>)
        : <p>{failed ? 'We could not load the plans just now. Please try again in a minute.' : 'Loading the plans…'}</p>}</div>}
    </div>
  );
}

export default function Store() {
  const { shop, setShopFilter, closeShop, openDrawer, openCart, openCheckout, access, cart } = useSite();
  const { open, view, cls, subject, skill } = shop;
  const q = shop.q || '';
  const words = wordsOf(q);
  const searching = words.length > 0;
  const shopRef = useRef(null);
  useEffect(() => { if (open && shopRef.current) shopRef.current.scrollTop = 0; }, [open]);
  /* the plans, prices and which classes are on sale, from the server */
  const [config, setConfig] = useState(getCoConfig);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!open) return undefined;
    let alive = true;
    loadCoConfig().then(c => { if (alive) { setConfig(c); setFailed(false); } }, () => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [open]);
  const SOON_NOW = soonIn(config);
  const tz = (access.session && access.session.timeZone) || undefined;

  const vocabIds = groupSheets(VOCAB).map(it => it.id);
  /* the sheets a view, class and subject show */
  const pick = (vw, c, sj) => ITEMS.filter(it => it.pdf && !SOON_NOW(it.cls) &&
    (vw === 'all' || (vw === 'new' && NEW_IDS.includes(it.id)) || (vw === 'best' && BEST_IDS.includes(it.id)) || (vw === 'free' && it.price === 0) || (vw === 'paid' && it.price > 0)) &&
    (c === 'all' || (c === VOCAB ? vocabIds.includes(it.id) : it.cls === c)) && subjectMatches(it, sj) && matchesSearch(it, words));
  /* every sidebar number is the number of sheets that button lists */
  const countOf = (vw, c, sj) => pick(vw, c, sj).length;
  /* every filter the customer picks is a shop search in the visit statistics (what they looked for, how many sheets it showed) */
  const filter = patch => {
    setShopFilter(patch);
    const n = { view, cls, subject, skill, ...patch };
    eventsApi.track('search', { meta: { view: n.view, cls: n.cls, subject: n.subject, skill: n.skill || 'none', q: q.trim() || undefined, results: n.skill ? skillSheets(n.skill).filter(it => matchesSearch(it, words)).length : countOf(n.view, n.cls, n.subject) } });
  };
  /* the words typed: filtered at once; recorded as a shop search once typing stops for a moment */
  const setQuery = v => setShopFilter({ q: v.slice(0, 80) });
  const searchRef = useRef(null);
  useEffect(() => {
    const text = q.trim();
    if (!open || text.length < 2) return undefined;
    const t = setTimeout(() => {
      const results = skill ? skillSheets(skill).filter(it => matchesSearch(it, words)).length : countOf(view, cls, subject);
      eventsApi.track('search', { meta: { q: text, view, cls, subject, skill: skill || 'none', results } });
    }, 900);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, open]);
  const clearSearch = () => { setQuery(''); if (searchRef.current) searchRef.current.focus(); };
  const list = pick(view, cls, subject).sort((a, b) => (a.price === 0 ? 0 : 1) - (b.price === 0 ? 0 : 1));
  const v = VIEWS.find(x => x.id === view);
  let title, sub, shown = list;
  if (skill) {
    shown = skillSheets(skill).filter(it => matchesSearch(it, words));
    title = SKILL_NAME[skill];
  } else {
    title = v.label + (cls !== 'all' ? ' · ' + clsLabel(cls) : '') + (subject !== 'all' ? ' · ' + subjectById(subject).label : '');
  }
  if (searching) title = 'Results for “' + q.trim() + '”' + (skill ? ' · ' + SKILL_NAME[skill] : view !== 'all' ? ' · ' + v.label : '') + (!skill && cls !== 'all' ? ' · ' + clsLabel(cls) : '') + (!skill && subject !== 'all' ? ' · ' + subjectById(subject).label : '');
  const showSkills = view === 'all' && cls === 'all' && subject === 'all' && list.length > 0 && !skill && !searching;
  const soon = !skill && cls !== 'all' && cls !== VOCAB && SOON_NOW(cls);
  if (soon) sub = 'New worksheets for ' + clsLabel(cls) + ' are on their way.';
  else if (searching) sub = shown.length ? (shown.length === 1 ? '1 sheet matches' : shown.length + ' sheets match') + ' · tap one to see it' : 'Nothing matches yet.';
  else if (showSkills) sub = SKILL_CATEGORIES.length + ' skill categories · ' + PDF_SHEETS.length + ' printable PDF sheets · click one to browse';
  else sub = shown.length + (shown.length === 1 ? ' sheet' : ' sheets') + ' · buy one PDF, or subscribe to a class to open them all';

  return (
    <div className={'shop' + (open ? ' open' : '')} id="shop" aria-hidden={open ? 'false' : 'true'} ref={shopRef} role="dialog" aria-label="Every sheet we have">
      <div className="shop-scene" aria-hidden="true"><img src="/shop/learn-with-why-wallpaper.webp" alt="" decoding="async" /></div>
      <header className="shop-bar">
        <div><p className="eyebrow">The shelf</p><h2 className="card-title">Every sheet we have.</h2></div>
        <div className="shop-actions">
          <button type="button" className="btn btn-ghost" id="shopBagBtn" aria-label="My Account" onClick={() => openDrawer('bag')}><span className="acct-label">My Account</span><svg className="acct-short" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="8" r="4" /><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" /></svg></button>
          <button type="button" className="btn btn-ghost" id="shopCartBtn" aria-label={'Cart: ' + cart.count + (cart.count === 1 ? ' sheet' : ' sheets')} onClick={openCart}><CartIcon /> Cart <b id="shopCartCount">{cart.count}</b></button>
          <button type="button" className="icon-btn" id="shopClose" aria-label="Back to the story" onClick={closeShop}>✕</button>
        </div>
      </header>
      <div className="shop-body">
        <aside className="panel shop-side" aria-label="Filters">
          <div className="shop-search" role="search">
            <svg className="search-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
            <input ref={searchRef} id="shopSearch" type="search" value={q} placeholder="Search sheets, e.g. colours" aria-label="Search the sheets" autoComplete="off" enterKeyHint="search" maxLength={80}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => { if (e.key === 'Escape' && q) { e.preventDefault(); e.stopPropagation(); setQuery(''); } else if (e.key === 'Enter') e.currentTarget.blur(); }} />
            {q ? <button type="button" className="search-x" id="shopSearchClear" aria-label="Clear the search" onClick={clearSearch}>✕</button> : null}
          </div>
          <p className="side-title">Browse</p>
          <div className="side-list" id="shopViews">{VIEWS.map(x => <SideButton key={x.id} on={x.id === view} n={countOf(x.id, 'all', 'all')} onClick={() => filter({ view: x.id, cls: 'all', subject: 'all', skill: null })}>{x.label}{x.note ? <small>{x.note}</small> : null}</SideButton>)}</div>
          <p className="side-title">Classes</p>
          <div className="side-list" id="shopClasses"><SideButton on={cls === 'all'} n={countOf(view, 'all', subject)} onClick={() => filter({ cls: 'all', skill: null })}>All classes</SideButton>{CLASSES.map(c => {
            const row = <SideButton key={c.id} on={c.id === cls} n={SOON_NOW(c.id) ? 'Coming soon' : countOf(view, c.id, subject)} onClick={() => filter({ cls: c.id, skill: null })}>{c.label}</SideButton>;
            if (c.id !== 'kg') return row;
            return [row, <SideButton key={VOCAB} on={cls === VOCAB} n={countOf(view, VOCAB, subject)} onClick={() => filter({ cls: VOCAB, skill: null })}>Vocabulary</SideButton>];
          })}</div>
          <p className="side-title">Subjects</p>
          <div className="side-list" id="shopSubjects"><SideButton on={subject === 'all'} n={countOf(view, cls, 'all')} onClick={() => filter({ subject: 'all', skill: null })}>All subjects</SideButton>{SUBJECTS.map(x => <SideButton key={x.id} on={x.id === subject} n={countOf(view, cls, x.id)} onClick={() => filter({ subject: x.id, skill: null })}>{x.label}</SideButton>)}</div>
          <p className="side-note">Free sheets first. Subscribe to a class and open every sheet in it for as long as your plan runs.</p>
        </aside>
        <main className="shop-main">
          <div className="shop-head"><h3 id="shopTitle">{title}</h3><p id="shopSub">{sub}</p></div>
          <div className={'shop-grid' + (showSkills ? ' skills' : '')} id="shopGrid">
            {view === 'paid' && !skill && !soon && <SubscribeBox cls={planCls(cls)} sub={access.activeSub(planCls(cls))} openCheckout={openCheckout} config={config} failed={failed} tz={tz} />}
            {soon ? <div className="shop-soon"><b>Coming soon</b><p>We are making {clsLabel(cls)} worksheets right now. Until then, Kindergarten has {PDF_SHEETS.length} printable sheets ready.</p><button type="button" className="btn btn-primary" onClick={() => filter({ cls: 'kg', skill: null })}>See Kindergarten sheets →</button></div> : showSkills ? SKILL_CATEGORIES.map((c, n) => (
              <article key={c.id} className={'skill-card skill-' + c.id} style={{ '--n': n }}>
                {/* each skill has its own corner of the Learn With Why picture (public/shop/cards/) */}
                <img className="skill-pic" src={CARD_PICS + c.id + '.webp'} alt="" loading="lazy" decoding="async" />
                <div className="skill-content">
                  <h3 className="card-title">{c.label}</h3>
                  <p className="skill-desc">{c.description}</p>
                  <ul className="skill-list"><li>{skillSheets(c.id).some(it => it.price === 0) ? 'Free sample to explore' : 'Preview every sheet first'}</li><li>Watermarked with your name</li><li>Buy or subscribe to unlock</li></ul>
                  <div className="skill-foot">
                    <span className="skill-count">{c.count} sheets</span>
                    <button type="button" className="btn btn-primary" onClick={() => filter({ skill: c.id, view: 'all', cls: 'all', subject: 'all' })}>Browse worksheets <span aria-hidden="true">→</span></button>
                  </div>
                </div>
              </article>
            )) : shown.length ? shown.map((it, n) => <SheetCard key={it.id} it={it} n={n} store />)
              : searching ? <div className="shop-none" id="shopNone" role="status"><b>No sheets match “{q.trim()}”</b><p>Try another word, or look in every class and subject.</p><button type="button" className="btn" onClick={() => { setShopFilter({ q: '', view: 'all', cls: 'all', subject: 'all', skill: null }); }}>Clear the search</button></div>
              : <p className="cart-empty">Nothing here yet. Try another class or subject.</p>}
          </div>
        </main>
      </div>
    </div>
  );
}
