import { AnimatePresence, motion } from 'motion/react';
import { BRAND, CART, LICENCES, NAV, UI } from '../../content';
import { fadeUp, springs, staggered } from '../../lib/motion';
import { licence } from '../../lib/libraryStore';
import { money } from '../site/Cards';

/* ---------- Loading animation ---------- */
/* Fades in over the auth page, letters of the wordmark rise one by one, and
   the whole veil lifts like a curtain once the first frame is painted.
   Mounted/unmounted by the AnimatePresence in App. */
export function Veil({ note }) {
  return (
    <motion.div
      id="veil"
      initial={{ opacity: 0, y: 0 }}
      animate={{ opacity: 1, y: 0, transition: { duration: 0.4 } }}
      exit={{ y: '-100%', transition: { duration: 0.8, ease: [0.65, 0, 0.35, 1] } }}
    >
      <div className="veil-brand" aria-label={BRAND.name}>
        {BRAND.name.split('').map((ch, i) => <span key={i} style={{ '--i': i }} aria-hidden="true">{ch}</span>)}
      </div>
      <div className="veil-line"><i /></div>
      <p className="veil-note">{note}</p>
    </motion.div>
  );
}

/* ---------- Right-hand chapter rail ---------- */
export function Rail({ section, onGo }) {
  return (
    <nav className="rail" aria-label="Chapters">
      {NAV.map((label, i) => (
        <button key={label} type="button" className={i === section ? 'on' : ''} aria-label={label} onClick={() => onGo(i)}><span>{label}</span></button>
      ))}
    </nav>
  );
}

export function Counter({ section }) {
  const n = Math.max(0, section);
  return (
    <div className="counter">
      <b>{('0' + (n + 1)).slice(-2)}</b>
      <span>{(NAV[n] || NAV[0]).toUpperCase()}</span>
    </div>
  );
}

export function Progress() {
  return <div className="progress"><i /></div>;
}

export function Hint({ gone }) {
  return <div className={'hint' + (gone ? ' gone' : '')}><i />{UI.hint}</div>;
}

export function Toast({ msg }) {
  return (
    <motion.div
      className="toast"
      initial={{ opacity: 0, y: 14, x: '-50%' }}
      animate={{ opacity: 1, y: 0, x: '-50%' }}
      exit={{ opacity: 0, y: 8, x: '-50%' }}
      transition={springs.ui}
    >
      {msg}
    </motion.div>
  );
}

/* ---------- Drawers ---------- */
/* Slide in from the right; their links stagger in behind them. */
const drawer = {
  hide: { x: '100%' },
  show: { x: 0, transition: { ...springs.ui, ...staggered().show.transition } },
};

export function DrawerScrim({ onClose }) {
  return <motion.div className="drawer-scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }} onClick={onClose} />;
}

export function NavDrawer({ section, signedIn, sessionName, onGo, onLibrary, onAccount, onClose }) {
  return (
    <motion.aside className="drawer" id="navDrawer" aria-label="Menu" variants={drawer} initial="hide" animate="show" exit="hide">
      <div className="drawer-head">
        <span className="drawer-title">{UI.menu}</span>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close menu">✕</button>
      </div>
      <div className="drawer-inner">
        {NAV.map((label, i) => (
          <motion.button key={label} type="button" variants={fadeUp} className={'drawer-link' + (i === section ? ' is-active' : '')} onClick={() => onGo(i)}>{label}</motion.button>
        ))}
        <motion.button type="button" variants={fadeUp} className="drawer-link" onClick={onLibrary}>{UI.library}</motion.button>
        <motion.button type="button" variants={fadeUp} className="drawer-cta" onClick={onAccount}>
          {signedIn ? UI.signOut + ' (' + sessionName + ')' : UI.signIn}
        </motion.button>
      </div>
    </motion.aside>
  );
}

export function CartDrawer({ items, total, onQty, onLicence, onCheckout, onGo, onClose }) {
  return (
    <motion.aside className="drawer" aria-label="Bag" variants={drawer} initial="hide" animate="show" exit="hide">
      <div className="drawer-head">
        <span className="drawer-title">{CART.title}</span>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close bag">✕</button>
      </div>
      <div>
        {!items.length ? (
          <>
            <motion.p className="cart-empty" variants={fadeUp}>{CART.empty}</motion.p>
            <motion.button type="button" className="drawer-cta" variants={fadeUp} onClick={() => onGo(CART.browseGo)}>{CART.browse}</motion.button>
          </>
        ) : (
          <>
            <AnimatePresence initial={false}>
              {items.map(({ product, qty, licence: lic }) => (
                <motion.div
                  className="cart-row"
                  key={product.id}
                  layout
                  initial={{ opacity: 0, x: 24 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 24 }}
                  transition={springs.ui}
                >
                  <div className="thumb" aria-hidden="true">{product.mark}</div>
                  <div className="nm">
                    {product.title}<span>{product.pages} · {money(product.price * licence(lic).factor)}</span>
                    {/* Licence type sets the print allowance (brief §5) */}
                    <select value={lic} onChange={e => onLicence(product.id, e.target.value)} aria-label={CART.licence}>
                      {LICENCES.map(l => <option key={l.id} value={l.id}>{l.label} · {l.copies === 1 ? '1 copy' : l.copies + ' copies'}</option>)}
                    </select>
                  </div>
                  <div className="qty">
                    <button type="button" onClick={() => onQty(product.id, -1)} aria-label="Remove one">−</button>
                    <motion.b key={qty} initial={{ scale: 0.6 }} animate={{ scale: 1 }} transition={springs.micro}>{qty}</motion.b>
                    <button type="button" onClick={() => onQty(product.id, 1)} aria-label="Add one">+</button>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
            <motion.div layout className="cart-total"><span>{CART.total}</span><span>{money(total)}</span></motion.div>
            <motion.button layout type="button" className="btn btn-primary btn-block" onClick={onCheckout}>{CART.checkout}</motion.button>
            <motion.p layout className="cart-empty" style={{ fontSize: '0.78rem' }}>{CART.note}</motion.p>
          </>
        )}
      </div>
    </motion.aside>
  );
}
