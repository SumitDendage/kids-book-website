import { motion } from 'motion/react';
import { BRAND, NAV, UI } from '../../content';
import { springs } from '../../lib/motion';
import { Magnetic } from '../ui/Motion';

function BookIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H10a2 2 0 0 1 2 2v13a1.5 1.5 0 0 0-1.5-1.5h-6A.5.5 0 0 1 4 17V5.5Z" />
      <path d="M20 5.5A1.5 1.5 0 0 0 18.5 4H14a2 2 0 0 0-2 2v13a1.5 1.5 0 0 1 1.5-1.5h6a.5.5 0 0 0 .5-.5V5.5Z" />
    </svg>
  );
}

function BagIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 8h12l1 12H5L6 8Z" />
      <path d="M9 8V6a3 3 0 0 1 6 0v2" />
    </svg>
  );
}

export default function Navbar({ section, cartCount, libraryCount, signedIn, menuOpen, onGo, onCart, onLibrary, onAccount, onMenu }) {
  return (
    <nav className="navbar" aria-label="Main">
      <button type="button" className="nav-brand" onClick={() => onGo(0)}><span className="mark" aria-hidden="true" />{BRAND.name}</button>
      <div className="nav-links">
        {NAV.map((label, i) => (
          <button key={label} type="button" className={'nav-link' + (i === section ? ' is-active' : '')} onClick={() => onGo(i)}>{label}</button>
        ))}
      </div>
      <div className="nav-actions">
        <motion.button type="button" className="icon-btn" onClick={onLibrary} aria-label={UI.library} whileTap={{ scale: 0.92 }}>
          <BookIcon />
          {libraryCount > 0 && (
            <motion.span key={'l' + libraryCount} className="cart-badge" initial={{ scale: 0.4 }} animate={{ scale: 1 }} transition={springs.micro}>{libraryCount}</motion.span>
          )}
        </motion.button>
        <motion.button type="button" className="icon-btn" onClick={onCart} aria-label="Open bag" whileTap={{ scale: 0.92 }}>
          {/* Keyed on the count so the bag gives a little shake on every add */}
          <motion.span key={cartCount} style={{ display: 'inline-flex' }} animate={cartCount ? { rotate: [0, -12, 10, -4, 0] } : { rotate: 0 }} transition={{ duration: 0.45 }}>
            <BagIcon />
          </motion.span>
          {cartCount > 0 && (
            <motion.span key={'n' + cartCount} className="cart-badge" initial={{ scale: 0.4 }} animate={{ scale: 1 }} transition={springs.micro}>{cartCount}</motion.span>
          )}
        </motion.button>
        <Magnetic strength={0.2}>
          <button type="button" className="nav-account" onClick={onAccount}>{signedIn ? UI.signOut : UI.signIn}</button>
        </Magnetic>
        <button type="button" className="icon-btn nav-menu-btn" onClick={onMenu} aria-expanded={menuOpen} aria-controls="navDrawer" aria-label="Open menu">
          <span /><span /><span />
        </button>
      </div>
    </nav>
  );
}
