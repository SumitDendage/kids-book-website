import { NAV, IDS } from '../../data/content.js';
import { useSite } from '../../context/SiteContext.jsx';
import { m } from 'framer-motion';
import LogoTile from '../common/LogoTile.jsx';
import { SNAPPY } from '../motion/presets.js';

/* a small basket for the Cart buttons */
export function CartIcon({ size = 16 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 6h18l-2 11H5L3 6z" /><path d="M8 6l2-3M16 6l-2-3" /><path d="M9 11v3M15 11v3" /></svg>;
}

/* the glass header: brand, the six chapters and My Account + Cart (desktop), and on tablets and phones
   a Cart button beside the menu button (the menu has My Account and Cart too) */
export default function Navbar() {
  const { section, goTo, openDrawer, openCart, cart } = useSite();
  const go = n => e => { e.preventDefault(); goTo(n); };
  const n = cart.count;
  const cartTitle = n ? 'Cart: ' + n + (n === 1 ? ' sheet' : ' sheets') : 'Cart: empty';
  return (
    <nav className="navbar" aria-label="Main">
      <button type="button" className="nav-brand" onClick={() => goTo(0)} aria-label="Learn With Why home">
        <LogoTile as="span" /><span className="wordmark">Learn With Why<small>Print · Play · Ask why</small></span>
      </button>
      <div className="nav-links" id="navLinks">
        {NAV.map((l, i) => <a key={IDS[i]} className={'nav-link' + (section === i ? ' on' : '')} href={'#' + IDS[i]} aria-current={section === i ? 'true' : undefined} onClick={go(i)}>
          {/* the coloured pill glides from chapter to chapter instead of jumping */}
          {section === i ? <m.span layoutId="nav-pill" className="nav-pill" transition={SNAPPY} aria-hidden="true" /> : null}
          <span className="nav-word">{l}</span>
        </a>)}
        <button type="button" className="nav-link bag" id="bagBtn" title="My Account: your sheets, orders and devices" onClick={() => openDrawer('bag')}>My Account</button>
        <button type="button" className="nav-link bag cart" id="cartBtn" title={cartTitle} aria-label={cartTitle} onClick={openCart}>Cart <b id="cartCount" className={n ? 'has' : undefined}>{n}</b></button>
      </div>
      <span className="nav-right">
        <button type="button" className="icon-btn nav-cart-btn" id="cartBtnS" aria-label={cartTitle} title={cartTitle} onClick={openCart}><CartIcon /><b>{n}</b></button>
        <button type="button" className="icon-btn nav-menu-btn" id="menuBtn" aria-label="Menu" onClick={() => openDrawer('menu')}>☰</button>
      </span>
    </nav>
  );
}
