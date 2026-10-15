import { NAV, IDS } from '../../data/content.js';
import { useSite } from '../../context/SiteContext.jsx';
import LogoTile from '../common/LogoTile.jsx';

/* the glass header: brand, the six chapters (desktop), the cart / My Account button (it counts the paid
   sheets and class plans open right now), the menu button (tablet & phone) */
export default function Navbar({ bagCount }) {
  const { section, goTo, openDrawer } = useSite();
  const go = n => e => { e.preventDefault(); goTo(n); };
  return (
    <nav className="navbar" aria-label="Main">
      <button type="button" className="nav-brand" onClick={() => goTo(0)} aria-label="Learn With Why home">
        <LogoTile as="span" /><span className="wordmark">Learn With Why<small>Print · Play · Ask why</small></span>
      </button>
      <div className="nav-links" id="navLinks">
        {NAV.map((l, i) => <a key={IDS[i]} className={'nav-link' + (section === i ? ' on' : '')} href={'#' + IDS[i]} aria-current={section === i ? 'true' : undefined} onClick={go(i)}>{l}</a>)}
        <button type="button" className="nav-link bag" id="bagBtn" title={'My Account: ' + bagCount + (bagCount === 1 ? ' paid item open now' : ' paid items open now')} onClick={() => openDrawer('bag')}>Cart <b id="bagCount">{bagCount}</b></button>
      </div>
      <button type="button" className="icon-btn nav-menu-btn" id="menuBtn" aria-label="Menu" onClick={() => openDrawer('menu')}>☰</button>
    </nav>
  );
}
