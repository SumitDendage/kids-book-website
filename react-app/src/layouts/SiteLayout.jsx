import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { ToastProvider } from '../context/ToastContext.jsx';
import { SiteProvider, useSite } from '../context/SiteContext.jsx';
import useChapterInput from '../hooks/useChapterInput.js';
import useMyWorksheets from '../hooks/useMyWorksheets.js';
import CinematicScroll from '../components/cinematic/CinematicScroll.jsx';
import MagicLayer from '../components/cinematic/MagicLayer.jsx';
import StoryAnimals from '../components/cinematic/StoryAnimals.jsx';
import Veil from '../components/layout/Veil.jsx';
import Navbar from '../components/layout/Navbar.jsx';
import StageChrome from '../components/layout/StageChrome.jsx';
import Drawers from '../components/layout/Drawers.jsx';
import HomeChapter from '../components/home/HomeChapter.jsx';
import AboutChapter from '../components/home/AboutChapter.jsx';
import WhatWeDoChapter from '../components/home/WhatWeDoChapter.jsx';
import SheetsChapter from '../components/sheets/SheetsChapter.jsx';
import ContactChapter from '../components/home/ContactChapter.jsx';
import TestimonialsChapter from '../components/home/TestimonialsChapter.jsx';
import Store from '../components/store/Store.jsx';
import Checkout from '../components/checkout/Checkout.jsx';
import SheetModal from '../components/modals/SheetModal.jsx';
import { IDS } from '../data/content.js';

const STAFF = { admin: true, developer: true };

/* The customer site. It stays mounted under /admin and /developer too: the staff
   pages open over it (the <Outlet/>), exactly like the old #admin overlay. */
function Site() {
  const site = useSite();
  const { stage, isInputLocked, setSiteStage, handlePaymentReturn, loadCurrency } = site;
  const navigate = useNavigate();
  const contentRef = useRef(null), engineRef = useRef(null);
  const [veil, setVeil] = useState({ gone: false, slow: false });
  const { activeCount } = useMyWorksheets();

  /* old links such as /#admin still open the staff pages */
  const onStaffHash = useCallback(h => { if (!STAFF[h]) return false; navigate('/' + h); return true; }, [navigate]);
  useChapterInput(stage, contentRef, { isInputLocked, onStaffHash });

  /* the opening veil: lift it once the first frame is painted (at least 1.8 s), or after 15 s whatever happens */
  useEffect(() => {
    const started = Date.now();
    let hintTimer = 0;
    const t = setInterval(() => {
      const elapsed = Date.now() - started, painted = !!(engineRef.current && engineRef.current.painted);
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
        handlePaymentReturn();   /* finish a Stripe / PayPal payment if we just came back from one */
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
      <StoryAnimals />
      <Navbar bagCount={activeCount} />
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
      <Suspense fallback={null}><Outlet /></Suspense>
      <Store bagCount={activeCount} />
      <Checkout />
      <Drawers />
      <SheetModal />
    </>
  );
}

export default function SiteLayout() {
  return (
    <ToastProvider>
      <SiteProvider>
        <Site />
      </SiteProvider>
    </ToastProvider>
  );
}
