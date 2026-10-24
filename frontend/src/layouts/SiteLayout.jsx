import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { ToastProvider } from '../context/ToastContext.jsx';
import { SiteProvider, useSite } from '../context/SiteContext.jsx';
import { SecurityProvider } from '../context/SecurityContext.jsx';
import useChapterInput from '../hooks/useChapterInput.js';
import CinematicScroll from '../components/cinematic/CinematicScroll.jsx';
import MagicLayer from '../components/cinematic/MagicLayer.jsx';
import Veil from '../components/layout/Veil.jsx';
import ScrollProgress from '../components/motion/ScrollProgress.jsx';
import Navbar from '../components/layout/Navbar.jsx';
import StageChrome from '../components/layout/StageChrome.jsx';
import HomeChapter from '../components/home/HomeChapter.jsx';
import AboutChapter from '../components/home/AboutChapter.jsx';
import WhatWeDoChapter from '../components/home/WhatWeDoChapter.jsx';
import SheetsChapter from '../components/sheets/SheetsChapter.jsx';
import ContactChapter from '../components/home/ContactChapter.jsx';
import TestimonialsChapter from '../components/home/TestimonialsChapter.jsx';
import { IDS } from '../data/content.js';

/* Nothing below the first screen is downloaded while the forest is still opening: the shop,
   the checkout, My Account, a sheet's window, the AI assistant and the account-type question
   are all behind a tap, so they load on their own once the site is up (warmUp below) — or the
   moment they are first needed, whichever comes first. The screen never waits for them. */
const Store = lazy(() => import('../components/store/Store.jsx'));
const Checkout = lazy(() => import('../components/checkout/Checkout.jsx'));
const Drawers = lazy(() => import('../components/layout/Drawers.jsx'));
const SheetModal = lazy(() => import('../components/modals/SheetModal.jsx'));
const AIAssistant = lazy(() => import('../components/ai/AIAssistant.jsx'));
const AccountTypePopup = lazy(() => import('../components/account/AccountTypePopup.jsx'));
const warmUp = () => {
  import('../components/store/Store.jsx');
  import('../components/checkout/Checkout.jsx');
  import('../components/layout/Drawers.jsx');
  import('../components/modals/SheetModal.jsx');
  import('../components/ai/AIAssistant.jsx');
};

const STAFF = { admin: true, developer: true };

/* The customer site. It stays mounted under /admin and /developer too: the staff
   pages open over it (the <Outlet/>), exactly like the old #admin overlay. */
function Site() {
  const site = useSite();
  const { stage, isInputLocked, setSiteStage, handlePaymentReturn, handleAuthLink, loadCurrency, askRole, siteStage } = site;
  const navigate = useNavigate();
  const contentRef = useRef(null), engineRef = useRef(null);
  const [veil, setVeil] = useState({ gone: false, slow: false });

  /* old links such as /#admin still open the staff pages */
  const onStaffHash = useCallback(h => { if (!STAFF[h]) return false; navigate('/' + h); return true; }, [navigate]);
  useChapterInput(stage, contentRef, { isInputLocked, onStaffHash });

  /* the look arrives without blocking the first paint (scripts/build-seo-pages.mjs), so the veil
     also waits for it: its last rule sets --css-ready, and until then the site below is unstyled */
  const styled = () => getComputedStyle(document.documentElement).getPropertyValue('--css-ready').trim() === '1';

  /* the opening veil: lift it once the look and the first frame are there (at least 1.8 s), or after 15 s whatever happens */
  useEffect(() => {
    const started = Date.now();
    let hintTimer = 0;
    const t = setInterval(() => {
      const elapsed = Date.now() - started, painted = !!(engineRef.current && engineRef.current.painted) && styled();
      if (!painted && elapsed > 4000) setVeil(v => (v.slow ? v : { ...v, slow: true }));
      if ((painted && elapsed >= 1800) || elapsed >= 15000) {
        clearInterval(t);
        setVeil(v => ({ ...v, gone: true }));
        document.body.dataset.stage = 'site'; stage.site = true; setSiteStage('site');
        if (contentRef.current) contentRef.current.scrollTop = 0;
        const h = location.hash.slice(1);
        onStaffHash(h);
        stage.jump(IDS.indexOf(h));
        hintTimer = setTimeout(stage.onHideHint, 6000);
        warmUp();               /* the shop, the cart and the rest are fetched now, before anyone taps */
        handlePaymentReturn();   /* finish a Stripe / PayPal payment if we just came back from one */
        handleAuthLink();        /* an Accept & Continue or password-reset link from an account email */
        loadCurrency();          /* the currency the prices are shown in */
      }
    }, 100);
    return () => { clearInterval(t); clearTimeout(hintTimer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onTick = useCallback(() => stage.tick(), [stage]);
  return (
    <>
      <CinematicScroll onTick={onTick} engineRef={engineRef} />
      <div id="scrim" />
      <MagicLayer />
      <Veil gone={veil.gone} slow={veil.slow} />
      <Navbar />
      <ScrollProgress />
      <main id="content" ref={contentRef}>
        <div id="stack" ref={el => { stage.stack = el; }}>
          <HomeChapter />
          <AboutChapter />
          <WhatWeDoChapter />
          <SheetsChapter />
          <ContactChapter />
          <TestimonialsChapter />
        </div>
      </main>
      <StageChrome />
      <Suspense fallback={null}>
        <AIAssistant />
        <Outlet />
        <Store />
        <Checkout />
        <Drawers />
        <SheetModal />
        {askRole && siteStage === 'site' ? <AccountTypePopup /> : null}
      </Suspense>
    </>
  );
}

export default function SiteLayout() {
  return (
    <ToastProvider>
      <SiteProvider>
        <SecurityProvider>
          <Site />
        </SecurityProvider>
      </SiteProvider>
    </ToastProvider>
  );
}
