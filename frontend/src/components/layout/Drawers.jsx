import { useSite } from '../../context/SiteContext.jsx';
import useMyWorksheets from '../../hooks/useMyWorksheets.js';
import { NAV, IDS, classById, planOf } from '../../data/content.js';
import { dateOf, dateTimeOf, shortClass } from '../../utils/format.js';

/* the side drawers: Menu (tablet & phone) and My Account → My Worksheets */
export default function Drawers() {
  const { drawer, closeDrawers, openDrawer, goTo, section, openViewer, openShop } = useSite();
  const { subs, mine } = useMyWorksheets();
  const rowNote = ({ since, kind, end }) => kind === 'plan' ? 'in your plan' + (end ? ' · until ' + dateOf(end) : '') : (kind === 'free' ? 'free' : 'bought') + ' · since ' + dateOf(since) + ' · yours to keep';
  const openKey = id => e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openViewer(id); } };
  return (
    <>
      <div className={'drawer-scrim' + (drawer ? ' open' : '')} id="drawerScrim" onClick={closeDrawers} />
      <aside className={'drawer' + (drawer === 'menu' ? ' open' : '')} id="menuDrawer" aria-label="Menu" aria-hidden={drawer === 'menu' ? undefined : 'true'}>
        <div className="drawer-head"><span className="drawer-title">Menu</span><button type="button" className="icon-btn" aria-label="Close" onClick={closeDrawers}>✕</button></div>
        <div className="nav-list" id="menuList">
          {NAV.map((l, i) => <button key={IDS[i]} type="button" className={section === i ? 'on' : undefined} onClick={() => goTo(i)}>{l}</button>)}
          <button type="button" id="bagBtn2" onClick={() => openDrawer('bag')}>Cart</button>
        </div>
      </aside>
      <aside className={'drawer' + (drawer === 'bag' ? ' open' : '')} id="bagDrawer" aria-label="My Account" aria-hidden={drawer === 'bag' ? undefined : 'true'}>
        <div className="drawer-head"><span className="drawer-title">My Account</span><button type="button" className="icon-btn" aria-label="Close" onClick={closeDrawers}>✕</button></div>
        <div id="bagBody">
          <p className="eyebrow" style={{ marginBottom: '10px' }}>My plans</p>
          {!subs.length ? <p className="cart-empty">No class plan yet. Pick a class and every sheet in it opens for as long as your plan runs.</p>
            : subs.map(x => <div key={x.cls} className="cart-row"><div className="paper-mini">{shortClass(classById(x.cls).label)}</div><div className="nm">{classById(x.cls).label}<span>{planOf(x.plan).label} · since {dateTimeOf(x.start)}{x.end ? ' · until ' + dateOf(x.end) : ''}</span></div><span className="pill">Active</span></div>)}
          <p className="eyebrow" style={{ margin: '18px 0 10px' }}>My worksheets · {mine.length}</p>
          {mine.length ? mine.map(m => (
            <div key={m.it.id} className="cart-row" role="button" tabIndex={0} style={{ cursor: 'pointer' }} title="Open in the viewer" onClick={() => openViewer(m.it.id)} onKeyDown={openKey(m.it.id)}>
              <div className="paper-mini">{m.it.glyph || m.it.az || 'PDF'}</div><div className="nm">{m.it.title}<span>{rowNote(m)}</span></div><span className="pill">Open ↗</span>
            </div>
          )) : <p className="cart-empty">Nothing here yet — free sheets you open, PDFs you buy and every sheet in a subscribed class appear here.</p>}
          <button type="button" className="btn btn-primary btn-block" style={{ marginTop: '16px' }} onClick={() => openShop('all')}>Browse all sheets →</button>
          <p className="cart-empty" style={{ fontSize: '.78rem' }}>Nothing here expires. Everything is checked on the server every time a sheet opens.</p>
        </div>
      </aside>
    </>
  );
}
