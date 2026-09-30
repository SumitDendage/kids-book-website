import { useEffect, useRef } from 'react';
import { useSite } from '../../context/SiteContext.jsx';
import { CLASSES, SUBJECTS, classById, subjectById } from '../../data/content.js';
import { ITEMS, VIEWS, NEW_IDS, BEST_IDS, KG_ALPHABET, alphaById, alphaSheets } from '../../data/catalogue.js';
import SheetCard, { subjectMatches } from '../sheets/SheetCard.jsx';

/* THE STORE — a page of its own over the story. Sidebar: New · Bestselling · Free ·
   Subscription, then classes and subjects. With no filter on, it opens on the Alphabet
   tiles from the Kindergarten content plan. */
function SideButton({ on, onClick, children }) {
  return <button type="button" className={'side-btn' + (on ? ' on' : '')} aria-pressed={on} onClick={onClick}>{children}</button>;
}

export default function Store({ bagCount }) {
  const { shop, setShopFilter, closeShop, openDrawer } = useSite();
  const { open, view, cls, subject, skill } = shop;
  const shopRef = useRef(null);
  useEffect(() => { if (open && shopRef.current) shopRef.current.scrollTop = 0; }, [open]);

  const list = ITEMS.filter(it =>
    (view === 'all' || (view === 'new' && NEW_IDS.includes(it.id)) || (view === 'best' && BEST_IDS.includes(it.id)) || (view === 'free' && it.price === 0) || (view === 'paid' && it.price > 0)) &&
    (cls === 'all' || it.cls === cls) && subjectMatches(it, subject)
  ).sort((a, b) => (a.price === 0 ? 0 : 1) - (b.price === 0 ? 0 : 1));
  const v = VIEWS.find(x => x.id === view);
  let title, sub, shown = list;
  if (skill) {
    shown = alphaSheets(skill);
    title = (alphaById(skill) || {}).label;
  } else {
    title = v.label + (cls !== 'all' ? ' · ' + classById(cls).label : '') + (subject !== 'all' ? ' · ' + subjectById(subject).label : '');
  }
  const showSkills = view === 'all' && cls === 'all' && subject === 'all' && list.length > 0 && !skill;
  if (showSkills) sub = 'Alphabet · ' + KG_ALPHABET.length + ' sub-categories · pick one to see its sheets';
  else sub = shown.length + (shown.length === 1 ? ' sheet' : ' sheets') + ' · buy one PDF, or subscribe to a class to open them all';

  return (
    <div className={'shop' + (open ? ' open' : '')} id="shop" aria-hidden={open ? 'false' : 'true'} ref={shopRef} role="dialog" aria-label="Every sheet we have">
      <div className="shop-shade" />
      <header className="shop-bar">
        <div><p className="eyebrow">The shelf</p><h2 className="card-title">Every sheet we have.</h2></div>
        <div className="shop-actions"><button type="button" className="btn btn-ghost" id="shopBagBtn" onClick={() => openDrawer('bag')}>Cart · <b id="shopBagCount">{bagCount}</b></button><button type="button" className="icon-btn" id="shopClose" aria-label="Back to the story" onClick={closeShop}>✕</button></div>
      </header>
      <div className="shop-body">
        <aside className="panel shop-side" aria-label="Filters">
          <p className="side-title">Browse</p>
          <div className="side-list" id="shopViews">{VIEWS.map(x => <SideButton key={x.id} on={x.id === view} onClick={() => setShopFilter({ view: x.id, cls: 'all', subject: 'all', skill: null })}>{x.label}{x.note ? <small>{x.note}</small> : null}</SideButton>)}</div>
          <p className="side-title">Classes</p>
          <div className="side-list" id="shopClasses"><SideButton on={cls === 'all'} onClick={() => setShopFilter({ cls: 'all', skill: null })}>All classes</SideButton>{CLASSES.map(c => <SideButton key={c.id} on={c.id === cls} onClick={() => setShopFilter({ cls: c.id, skill: null })}>{c.label}</SideButton>)}</div>
          <p className="side-title">Subjects</p>
          <div className="side-list" id="shopSubjects"><SideButton on={subject === 'all'} onClick={() => setShopFilter({ subject: 'all', skill: null })}>All subjects</SideButton>{SUBJECTS.map(x => <SideButton key={x.id} on={x.id === subject} onClick={() => setShopFilter({ subject: x.id, skill: null })}>{x.label}</SideButton>)}</div>
          <p className="side-note">Free sheets first. Subscribe to a class and open every sheet in it for as long as your plan runs.</p>
        </aside>
        <main className="shop-main">
          <div className="shop-head"><h3 id="shopTitle">{title}</h3><p id="shopSub">{sub}</p></div>
          <div className="shop-grid" id="shopGrid">
            {showSkills ? KG_ALPHABET.map((c, n) => {
              const list = alphaSheets(c.id), free = list.filter(it => it.price === 0).length;
              return (
                <article key={c.id} className={'alpha-card' + (list.length ? '' : ' soon')} style={{ '--n': n }}>
                  <span className="alpha-no" aria-hidden="true">{String(n + 1).padStart(2, '0')}</span>
                  <h3 className="card-title">{c.label}</h3>
                  <p className="alpha-focus">{c.focus}</p>
                  <p className={'alpha-access' + (list.length ? (free ? ' part' : '') : ' soon')}>{!list.length ? 'Coming soon' : free === list.length ? 'Free' : free ? free + ' free · rest paid' : 'Paid'}</p>
                  <div className="alpha-foot">
                    <span>{list.length ? list.length + (list.length === 1 ? ' sheet' : ' sheets') : 'Sheets on the way'}</span>
                    {list.length ? <button type="button" className="btn btn-sm btn-primary" onClick={() => setShopFilter({ skill: c.id, view: 'all', cls: 'all', subject: 'all' })}>Browse sheets <span aria-hidden="true">→</span></button> : null}
                  </div>
                </article>
              );
            }) : shown.length ? shown.map((it, n) => <SheetCard key={it.id} it={it} n={n} store />) : <p className="cart-empty">Nothing here yet — try another class or subject.</p>}
          </div>
        </main>
      </div>
    </div>
  );
}
