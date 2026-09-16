'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { AnimatePresence, motion, useMotionValueEvent, useScroll } from 'motion/react';
import { BRAND, NAV, UI } from '@/lib/content';
import { springs } from '@/lib/motion';
import { useStore } from '@/lib/store';
import { Mark } from '@/components/ui/Logo';
import { Magnetic } from '@/components/ui/Motion';

function BagIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 8h12l1 12H5L6 8Z" /><path d="M9 8V6a3 3 0 0 1 6 0v2" /></svg>;
}
function BookIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H10a2 2 0 0 1 2 2v13a1.5 1.5 0 0 0-1.5-1.5h-6A.5.5 0 0 1 4 17V5.5Z" /><path d="M20 5.5A1.5 1.5 0 0 0 18.5 4H14a2 2 0 0 0-2 2v13a1.5 1.5 0 0 1 1.5-1.5h6a.5.5 0 0 0 .5-.5V5.5Z" /></svg>;
}

/* Which landing section is under the top of the viewport */
function useActiveSection(enabled) {
  const [active, setActive] = useState('home');
  useEffect(() => {
    if (!enabled) return undefined;
    const els = NAV.map(n => document.getElementById(n.id)).filter(Boolean);
    const io = new IntersectionObserver(entries => {
      entries.forEach(e => { if (e.isIntersecting) setActive(e.target.id); });
    }, { rootMargin: '-45% 0px -50% 0px' });
    els.forEach(el => io.observe(el));
    return () => io.disconnect();
  }, [enabled]);
  return active;
}

export default function Nav() {
  const { session, cartCount, activeCount, drawer, setDrawer, setAuth, signOut } = useStore();
  const pathname = usePathname();
  const router = useRouter();
  const home = pathname === '/';
  const active = useActiveSection(home);
  const { scrollY } = useScroll();
  const [compact, setCompact] = useState(false);
  useMotionValueEvent(scrollY, 'change', v => setCompact(v > 80));

  const go = id => {
    setDrawer(null);
    if (home) document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    else router.push('/#' + id);
  };
  const account = () => { setDrawer(null); if (session) signOut(); else setAuth('signin'); };

  return (
    <motion.nav className={'nav' + (compact ? ' compact' : '')} aria-label="Main" initial={{ y: -24, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ ...springs.ui, delay: 0.2 }}>
      <Link href="/" className="nav-brand" onClick={e => { if (home) { e.preventDefault(); go('home'); } }}>
        <Mark color="var(--fg)" />
        <span>{BRAND.name.split(' ')[0]}<small>{BRAND.name.split(' ').slice(1).join(' ')}</small></span>
      </Link>
      <div className="nav-links">
        {NAV.map(n => (
          <button key={n.id} type="button" className={'nav-link' + (home && active === n.id ? ' on' : '')} onClick={() => go(n.id)}>
            {home && active === n.id && <motion.span className="nav-pill" layoutId="nav-pill" transition={springs.ui} />}
            {n.label}
          </button>
        ))}
      </div>
      <div className="nav-actions">
        <motion.button type="button" className="icon-btn" aria-label={UI.library} whileTap={{ scale: 0.92 }} onClick={() => { setDrawer(null); router.push('/library'); }}>
          <BookIcon />
          {activeCount > 0 && <motion.span key={'l' + activeCount} className="count-badge" initial={{ scale: 0.4 }} animate={{ scale: 1 }} transition={springs.micro}>{activeCount}</motion.span>}
        </motion.button>
        <motion.button type="button" className="icon-btn" aria-label={UI.bag} whileTap={{ scale: 0.92 }} onClick={() => setDrawer(drawer === 'cart' ? null : 'cart')}>
          <motion.span key={cartCount} style={{ display: 'inline-flex' }} animate={cartCount ? { rotate: [0, -12, 10, -4, 0] } : { rotate: 0 }} transition={{ duration: 0.45 }}><BagIcon /></motion.span>
          {cartCount > 0 && <motion.span key={'n' + cartCount} className="count-badge" initial={{ scale: 0.4 }} animate={{ scale: 1 }} transition={springs.micro}>{cartCount}</motion.span>}
        </motion.button>
        <Magnetic strength={0.2}><button type="button" className="nav-account" onClick={account}>{session ? UI.signOut : UI.signIn}</button></Magnetic>
        <button type="button" className="icon-btn nav-menu-btn" aria-label={UI.menu} aria-expanded={drawer === 'nav'} onClick={() => setDrawer(drawer === 'nav' ? null : 'nav')}><span /><span /><span /></button>
      </div>
      <AnimatePresence>
        {drawer === 'nav' && (
          <MenuDrawer key="menu" active={home ? active : ''} onGo={go} onLibrary={() => { setDrawer(null); router.push('/library'); }} onAccount={account} onClose={() => setDrawer(null)} sessionName={session ? (session.name || session.email) : ''} />
        )}
      </AnimatePresence>
    </motion.nav>
  );
}

const drawerAnim = { hide: { x: '100%' }, show: { x: 0, transition: { ...springs.ui, staggerChildren: 0.045, delayChildren: 0.12 } } };
const item = { hide: { opacity: 0, x: 16 }, show: { opacity: 1, x: 0, transition: springs.ui } };

function MenuDrawer({ active, onGo, onLibrary, onAccount, onClose, sessionName }) {
  return (
    <>
      <motion.div className="drawer-scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }} onClick={onClose} />
      <motion.aside className="drawer" aria-label={UI.menu} variants={drawerAnim} initial="hide" animate="show" exit="hide">
        <div className="drawer-head">
          <span className="drawer-title">{UI.menu}</span>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close menu">✕</button>
        </div>
        <div className="drawer-inner">
          {NAV.map(n => <motion.button key={n.id} type="button" variants={item} className={'drawer-link' + (active === n.id ? ' on' : '')} onClick={() => onGo(n.id)}>{n.label}</motion.button>)}
          <motion.button type="button" variants={item} className="drawer-link" onClick={onLibrary}>{UI.library}</motion.button>
          <motion.button type="button" variants={item} className="drawer-cta" onClick={onAccount}>{sessionName ? UI.signOut + ' (' + sessionName + ')' : UI.signIn}</motion.button>
        </div>
      </motion.aside>
    </>
  );
}
