import { useEffect, useRef, useState } from 'react';
import { AnimatePresence } from 'motion/react';
import { createFrameEngine } from './engine/frameEngine';
import { useChapterTransition } from './hooks/useChapterTransition';
import { AUTH, CART, LIBRARY, NAV, PRODUCTS, VEIL } from './content';
import { LS_CART, read, write } from './lib/storage';
import { completeReset, currentSession, onSignedOut, signOut, signUp } from './lib/authStore';
import { checkout as placeOrder, consumePrint, isLocked, library, licence, online, protect } from './lib/libraryStore';
import Navbar from './components/chrome/Navbar';
import { CartDrawer, Counter, DrawerScrim, Hint, NavDrawer, Progress, Rail, Toast, Veil } from './components/chrome/Chrome';
import SignIn from './components/auth/SignIn';
import SignUp from './components/auth/SignUp';
import CreateAccount from './components/auth/CreateAccount';
import ForgotPassword from './components/auth/ForgotPassword';
import VerifyCode from './components/auth/VerifyCode';
import { About, Contact, Home, Sheets, Testimonials, WhatWeDo, Worksheets } from './components/site/Chapters';
import { LibraryPage, PrintConfirm, PrintJob, Reader } from './components/library/Library';

const CHAPTERS = NAV.length;
const M = AUTH.messages;
const MIN_VEIL_MS = 1800;    /* the loading animation always shows at least this long */
const MAX_VEIL_MS = 15000;   /* …and gives up waiting for the first frame after this */

/* The bag stores { qty, licence } per title; bags saved before licences
   existed stored a plain count. */
function normaliseCart(raw) {
  const out = {};
  Object.keys(raw || {}).forEach(id => { const v = raw[id]; out[id] = typeof v === 'number' ? { qty: v, licence: 'individual' } : v; });
  return out;
}

function scrollableAncestor(node) {
  while (node && node !== document.body) {
    if (node.nodeType === 1) {
      const oy = getComputedStyle(node).overflowY;
      if ((oy === 'auto' || oy === 'scroll') && node.scrollHeight > node.clientHeight + 2) return node;
    }
    node = node.parentNode;
  }
  return null;
}

export default function App() {
  /* ---------- stage: 'boot' → 'auth' → 'loading' → 'site' ---------- */
  const [stage, setStage] = useState('boot');
  const stageRef = useRef('boot');
  const changeStage = s => { stageRef.current = s; setStage(s); };

  const [authView, setAuthView] = useState(null);      /* signin | signup | password | forgot | code */
  const [session, setSession] = useState(null);
  const [section, setSection] = useState(-1);
  const anim = useChapterTransition(section);
  const [travelling, setTravelling] = useState(false);
  const [drawer, setDrawer] = useState(null);          /* null | 'nav' | 'cart' */
  const [hintGone, setHintGone] = useState(true);
  const [veilVisible, setVeilVisible] = useState(true);   /* the veil covers the boot until the session is known */
  const [veilNote, setVeilNote] = useState(VEIL.note);
  const [toastState, setToastState] = useState({ msg: '', show: false });

  /* auth flow bookkeeping */
  const [pendingSignup, setPendingSignup] = useState(null);
  const [resetState, setResetState] = useState(null);
  const [pwMode, setPwMode] = useState('create');
  const [pwEmail, setPwEmail] = useState('');
  const [pwSeq, setPwSeq] = useState(0);
  const [pwAlert, setPwAlert] = useState(null);
  const [signinNotice, setSigninNotice] = useState(null);

  /* bag */
  const [cart, setCart] = useState(() => normaliseCart(read(LS_CART, {})));

  /* library: page over the site, protected viewer, print confirmation, print job */
  const [page, setPage] = useState(null);          /* null | 'library' */
  const [reader, setReader] = useState(null);      /* entitlement open in the viewer */
  const [confirm, setConfirm] = useState(null);    /* entitlement awaiting print confirmation */
  const [printing, setPrinting] = useState(null);  /* entitlement being printed */
  const [shelf, setShelf] = useState([]);

  const canvasRef = useRef(null);
  const contentRef = useRef(null);
  const engineRef = useRef(null);
  const drawerRef = useRef(null);
  const pageRef = useRef(false);        /* a page or viewer is open: frames ignore input */
  const sessionRef = useRef(session);
  const pending = useRef(null);         /* { type: 'claim', id } | { type: 'checkout' } — finished after sign in */
  const travellingRef = useRef(false);
  const lastProgress = useRef(-1);
  const hoverScroller = useRef(null);
  const innerScroller = useRef(null);
  const settleTimer = useRef(null);
  const hintTimer = useRef(null);
  const toastTimer = useRef(null);
  const loadTimer = useRef(null);

  /* ---------- helpers ---------- */
  function toast(msg) {
    setToastState({ msg, show: true });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastState(s => ({ ...s, show: false })), 1900);
  }

  function goTo(n) {
    const engine = engineRef.current;
    const cap = Math.max(1, engine.total - 1);
    n = Math.max(0, Math.min(CHAPTERS - 1, n));
    engine.setTarget(((n + 0.5) / CHAPTERS) * cap);
    setHintGone(true);
  }

  /* Settle onto the nearest chapter when the input goes quiet */
  function scheduleSettle() {
    clearTimeout(settleTimer.current);
    settleTimer.current = setTimeout(() => {
      if (stageRef.current !== 'site') return;
      const engine = engineRef.current;
      const cap = Math.max(1, engine.total - 1);
      const seg = cap / CHAPTERS;
      const n = Math.max(0, Math.min(CHAPTERS - 1, Math.round(engine.target / seg - 0.5)));
      engine.setTarget((n + 0.5) * seg);
    }, 280);
  }

  function showSite(n) {
    const engine = engineRef.current;
    changeStage('site');
    travellingRef.current = false; setTravelling(false);
    lastProgress.current = -1;
    goTo(n || 0);
    engine.snap();
    const cap = Math.max(1, engine.total - 1);
    setSection(Math.min(CHAPTERS - 1, Math.floor((engine.current / cap) * CHAPTERS)));
    setHintGone(false);
    clearTimeout(hintTimer.current);
    hintTimer.current = setTimeout(() => setHintGone(true), 4200);
  }

  function showAuth(view) {
    changeStage('auth');
    setVeilVisible(false);
    travellingRef.current = false; setTravelling(false);
    setSection(-1);
    setAuthView(view);
    setHintGone(true);
    setDrawer(null);
    setPage(null); setReader(null); setConfirm(null);
  }

  /* Loading animation between the auth pages and the landing page: waits for
     the first frame to be painted and for a minimum on-screen time. */
  function enterSite(message) {
    changeStage('loading');
    setDrawer(null);
    setVeilVisible(true);
    setVeilNote(VEIL.note);
    const started = Date.now();
    clearTimeout(loadTimer.current);
    const tick = () => {
      const engine = engineRef.current;
      const elapsed = Date.now() - started;
      const painted = engine.isPainted();
      setVeilNote(!painted && engine.stats().failed ? VEIL.error : VEIL.note);
      if ((painted && elapsed >= MIN_VEIL_MS) || elapsed >= MAX_VEIL_MS) {
        setVeilVisible(false);
        showSite(0);
        if (!resumePending() && message) toast(message);
        return;
      }
      loadTimer.current = setTimeout(tick, 100);
    };
    loadTimer.current = setTimeout(tick, 100);
  }

  function navigate(n) {
    setDrawer(null);
    setPage(null);
    if (stageRef.current === 'site') goTo(n);
    else if (stageRef.current === 'auth') showSite(n);
  }

  /* ---------- hooks the animation engine calls (created once) ---------- */
  const latest = useRef({});
  latest.current = { scheduleSettle };
  const hooksRef = useRef(null);
  if (!hooksRef.current) {
    hooksRef.current = {
      isTyping(el) {
        if (pageRef.current) return true;   /* keys belong to the page / viewer */
        const tag = el && el.tagName;
        return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
      },
      onTouchStart(e) { innerScroller.current = scrollableAncestor(e.target); },
      /* Lets a panel scroll its own overflow before the frames take the input */
      scrollLocked(delta, isTouch) {
        if (drawerRef.current || pageRef.current) return true;
        const el = isTouch ? innerScroller.current : hoverScroller.current;
        if (!el) return false;
        const atTop = el.scrollTop <= 0;
        const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 1;
        if (delta < 0 && atTop) return false;
        if (delta > 0 && atBottom) return false;
        return true;
      },
      onScrollInput() {
        if (stageRef.current !== 'site') return;
        setHintGone(true);
        latest.current.scheduleSettle();
      },
      /* Called once per animation frame with the eased scroll position */
      onFrame(cur, tgt) {
        const engine = engineRef.current;
        if (!engine) return;
        const cap = Math.max(1, engine.total - 1);
        const progress = Math.min(1, Math.max(0, cur / cap));
        if (Math.abs(progress - lastProgress.current) > 0.0004) {
          lastProgress.current = progress;
          document.documentElement.style.setProperty('--scroll', progress);
          const n = Math.min(CHAPTERS - 1, Math.floor(progress * CHAPTERS));
          /* Position inside the chapter (-0.5 … 0.5) drives the depth drift in CSS */
          if (contentRef.current) contentRef.current.style.setProperty('--local', (progress * CHAPTERS - n - 0.5).toFixed(3));
          if (stageRef.current === 'site') setSection(n);
        }
        if (stageRef.current === 'site') {
          const moving = Math.abs(tgt - cur) > cap * 0.012;
          if (moving !== travellingRef.current) { travellingRef.current = moving; setTravelling(moving); }
        }
      },
    };
  }

  /* ---------- mount: start the engine, decide the first screen ---------- */
  useEffect(() => {
    const engine = createFrameEngine(canvasRef.current, hooksRef.current, { base: import.meta.env.BASE_URL });
    engineRef.current = engine;
    window.papercubFrames = () => engine.stats();

    const onOver = e => { hoverScroller.current = scrollableAncestor(e.target); };
    document.addEventListener('mouseover', onOver, { passive: true });

    /* Remembered session skips the forms; otherwise the site opens on Sign in. */
    currentSession().then(s => {
      if (s) { setSession(s); enterSite(M.welcomeBack + (s.name || 'friend')); }
      else showAuth('signin');
    });
    const offSignedOut = onSignedOut(() => { if (stageRef.current === 'site') { setSession(null); showAuth('signin'); } });

    return () => {
      offSignedOut();
      document.removeEventListener('mouseover', onOver);
      [settleTimer, hintTimer, toastTimer, loadTimer].forEach(t => clearTimeout(t.current));
      engine.destroy();
      engineRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------- mirror state onto <body> for the stylesheet ---------- */
  useEffect(() => { document.body.setAttribute('data-stage', stage); }, [stage]);
  useEffect(() => { document.body.classList.toggle('is-travel', travelling); }, [travelling]);
  useEffect(() => { drawerRef.current = drawer; document.body.classList.toggle('drawer-open', !!drawer); }, [drawer]);
  useEffect(() => { pageRef.current = !!(page || reader); document.body.classList.toggle('page-open', !!page); }, [page, reader]);
  useEffect(() => { write(LS_CART, cart); }, [cart]);
  useEffect(() => {
    sessionRef.current = session;
    let on = true;
    if (session) library(session.email).then(items => { if (on) setShelf(items); }).catch(() => {});
    else setShelf([]);
    return () => { on = false; };
  }, [session]);

  /* Online, a fresh purchase waits for its DRM-protected copy: poll while any is pending. */
  useEffect(() => {
    if (!online || !session || !shelf.some(e => e.drmStatus === 'pending')) return undefined;
    const t = setInterval(() => library(session.email).then(setShelf).catch(() => {}), 4000);
    return () => clearInterval(t);
  }, [online, session, shelf]);

  /* Escape closes the top-most layer only */
  useEffect(() => {
    const onKey = e => {
      if (e.key !== 'Escape') return;
      if (confirm) setConfirm(null);
      else if (reader) setReader(null);
      else if (drawer) setDrawer(null);
      else if (page) setPage(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [confirm, reader, drawer, page]);

  /* Focus the first field of whichever auth page is showing */
  useEffect(() => {
    if (stage !== 'auth' || !authView) return undefined;
    const t = setTimeout(() => {
      const first = document.querySelector('.chapter.auth.is-active input');
      if (first) { try { first.focus({ preventScroll: true }); } catch (_) { /* ignore */ } }
    }, 360);
    return () => clearTimeout(t);
  }, [stage, authView, pwSeq]);

  /* ---------- auth handlers ---------- */
  function handleSignedIn(s) {
    setSession(s);
    enterSite(M.signinWelcome + (s.name || 'friend'));
  }

  function handleGuest() { enterSite(M.guest); }

  function handleSignupContinue(data) {
    setPendingSignup(data);
    setResetState(null);
    setPwMode('create'); setPwEmail(data.email); setPwAlert(null); setPwSeq(s => s + 1);
    showAuth('password');
  }

  async function handlePasswordDone(pass) {
    setPwAlert(null);
    try {
      if (resetState) {
        await completeReset(resetState.email, pass);
        setResetState(null);
        showAuth('signin');
        setTimeout(() => setSigninNotice({ type: 'ok', msg: M.passwordUpdated, at: Date.now() }), 220);
        return;
      }
      if (!pendingSignup) { showAuth('signup'); return; }
      const result = await signUp({ ...pendingSignup, password: pass });
      setPendingSignup(null);
      if (result.confirm) {   /* the project asks new customers to confirm their email first */
        showAuth('signin');
        setTimeout(() => setSigninNotice({ type: 'ok', msg: M.confirmEmail, at: Date.now() }), 220);
        return;
      }
      setSession(result.session);
      enterSite(M.accountCreated);
    } catch (err) {
      setPwAlert({ type: 'err', msg: err.message });
    }
  }

  function handleForgotSent(reset) { setResetState(reset); showAuth('code'); }

  function handleCodeVerified() {
    setPwMode('reset'); setPwEmail(resetState.email); setPwAlert(null); setPwSeq(s => s + 1);
    showAuth('password');
  }

  async function accountAction() {
    setDrawer(null);
    if (session) {
      await signOut();
      setSession(null);
      showAuth('signin');
      setTimeout(() => setSigninNotice({ type: 'ok', msg: M.signedOut, at: Date.now() }), 220);
    } else {
      showAuth('signin');
    }
  }

  /* ---------- bag ---------- */
  const cartItems = Object.keys(cart)
    .map(id => ({ product: PRODUCTS.find(p => p.id === id), qty: cart[id].qty, licence: cart[id].licence }))
    .filter(x => x.product);
  const cartCount = cartItems.reduce((n, x) => n + x.qty, 0);
  const cartTotal = cartItems.reduce((n, x) => n + x.product.price * licence(x.licence).factor * x.qty, 0);

  function addToCart(id) {
    setCart(c => ({ ...c, [id]: { qty: (c[id] ? c[id].qty : 0) + 1, licence: c[id] ? c[id].licence : 'individual' } }));
    toast(CART.addedToast);
  }
  function changeQty(id, d) {
    setCart(c => { const next = { ...c }; const n = (c[id] ? c[id].qty : 0) + d; if (n <= 0) delete next[id]; else next[id] = { ...c[id], qty: n }; return next; });
  }
  function setLicence(id, lic) { setCart(c => ({ ...c, [id]: { ...c[id], licence: lic } })); }
  const toggleDrawer = name => setDrawer(d => (d === name ? null : name));

  /* ---------- library (developer brief: purchase → library → open → print → locked) ---------- */
  const owned = new Set(shelf.map(e => e.productId));
  const activeCount = shelf.filter(e => !isLocked(e)).length;
  const refreshShelf = email => library(email).then(setShelf).catch(() => {});

  /* Guests are sent to sign in; the action finishes when they are back. */
  function requireSignIn(next, notice) {
    pending.current = next;
    setDrawer(null);
    showAuth('signin');
    setTimeout(() => setSigninNotice({ type: 'ok', msg: notice, at: Date.now() }), 220);
  }
  function resumePending() {
    const p = pending.current;
    const s = sessionRef.current;
    pending.current = null;
    if (!p || !s) return false;
    if (p.type === 'claim') claimFree(p.id, s);
    else if (p.type === 'checkout') setDrawer('cart');
    return true;
  }

  function openLibrary() { setDrawer(null); setPage('library'); }

  async function claimFree(id, s = session) {
    if (!s) { requireSignIn({ type: 'claim', id }, LIBRARY.signInToClaim); return; }
    const product = PRODUCTS.find(x => x.id === id);
    try {
      await placeOrder(s.email, [{ productId: id, licence: 'individual', qty: 1 }]);
      await refreshShelf(s.email);
      toast(product.title + LIBRARY.claimToast);
      setPage('library');
    } catch (err) { toast(err.message); }
  }

  /* Demo checkout: no payment gateway yet; every bag line becomes `qty` licences. */
  async function checkout() {
    if (!session) { requireSignIn({ type: 'checkout' }, CART.signInToCheckout); return; }
    try {
      await placeOrder(session.email, cartItems.map(({ product, qty, licence: lic }) => ({ productId: product.id, licence: lic, qty })));
      await refreshShelf(session.email);
      setCart({});
      setDrawer(null);
      toast(CART.ordered);
      setPage('library');
    } catch (err) { toast(err.message); }
  }

  /* Print: confirm, consume one copy, print the watermarked pages; when the
     last copy is used the viewer closes and the title is locked. */
  async function confirmPrint() {
    const e = confirm;
    setConfirm(null);
    const updated = await consumePrint(session.email, e.id);
    refreshShelf(session.email);
    if (!updated) { toast(LIBRARY.lockedToast); setReader(null); return; }
    if (isLocked(updated)) setReader(null);
    else if (reader && reader.id === updated.id) setReader(updated);
    setPrinting(updated);
  }

  const authOn = view => stage === 'auth' && authView === view;

  return (
    <>
      {/* ======== BACKGROUND: frame-by-frame scroll animation ======== */}
      <canvas ref={canvasRef} aria-label="Landscape animation controlled by scrolling" />
      <div id="scrim" />

      <AnimatePresence initial={false}>{veilVisible && <Veil key="veil" note={veilNote} />}</AnimatePresence>

      {/* Outside #content so it stays sharp while the frames travel */}
      <Navbar
        section={section}
        cartCount={cartCount}
        libraryCount={activeCount}
        signedIn={!!session}
        menuOpen={drawer === 'nav'}
        onGo={navigate}
        onCart={() => toggleDrawer('cart')}
        onLibrary={openLibrary}
        onAccount={accountAction}
        onMenu={() => toggleDrawer('nav')}
      />

      {/* ======== FOREGROUND: website content ======== */}
      <div id="content" ref={contentRef}>
        {/* ---------- Authentication pages ---------- */}
        <SignIn active={authOn('signin')} notice={signinNotice} onSignedIn={handleSignedIn} onGuest={handleGuest} onGo={showAuth} />
        <SignUp active={authOn('signup')} onContinue={handleSignupContinue} onGo={showAuth} />
        <CreateAccount active={authOn('password')} seq={pwSeq} mode={pwMode} email={pwEmail} alert={pwAlert} onDone={handlePasswordDone} onGo={showAuth} />
        <ForgotPassword active={authOn('forgot')} onSent={handleForgotSent} onGo={showAuth} />
        <VerifyCode active={authOn('code')} reset={resetState} onVerified={handleCodeVerified} onGo={showAuth} />

        {/* ---------- Landing page chapters, mapped onto the frame scroll ---------- */}
        <Home section={section} anim={anim} onGo={navigate} />
        <WhatWeDo section={section} anim={anim} />
        <Sheets section={section} anim={anim} onAdd={addToCart} owned={owned} onClaim={claimFree} onLibrary={openLibrary} />
        <Worksheets section={section} anim={anim} onAdd={addToCart} owned={owned} onClaim={claimFree} onLibrary={openLibrary} />
        <About section={section} anim={anim} />
        <Contact section={section} anim={anim} />
        <Testimonials section={section} anim={anim} onGo={navigate} />

        {/* ---------- My Library: opened over the site, frames pause ---------- */}
        <LibraryPage
          open={page === 'library' && stage === 'site'}
          signedIn={!!session}
          email={session ? session.email : ''}
          items={shelf}
          onOpen={setReader}
          onPrint={setConfirm}
          onRetry={e => protect([e.id]).then(() => refreshShelf(session.email))}
          onGo={navigate}
          onSignIn={() => showAuth('signin')}
        />
      </div>

      <Rail section={section} onGo={navigate} />
      <Counter section={section} />
      <Progress />
      <Hint gone={hintGone} />
      <AnimatePresence>{toastState.show && <Toast key="toast" msg={toastState.msg} />}</AnimatePresence>

      <AnimatePresence>
        {drawer && <DrawerScrim key="scrim" onClose={() => setDrawer(null)} />}
        {drawer === 'nav' && (
          <NavDrawer
            key="nav"
            section={section}
            signedIn={!!session}
            sessionName={session ? (session.name || session.email) : ''}
            onGo={navigate}
            onLibrary={openLibrary}
            onAccount={accountAction}
            onClose={() => setDrawer(null)}
          />
        )}
        {drawer === 'cart' && (
          <CartDrawer
            key="cart"
            items={cartItems}
            total={cartTotal}
            onQty={changeQty}
            onLicence={setLicence}
            onCheckout={checkout}
            onGo={navigate}
            onClose={() => setDrawer(null)}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {reader && <Reader key={reader.id} item={reader} email={session ? session.email : ''} onPrint={() => setConfirm(reader)} onClose={() => setReader(null)} />}
      </AnimatePresence>
      <AnimatePresence>
        {confirm && <PrintConfirm key="confirm" item={confirm} onCancel={() => setConfirm(null)} onConfirm={confirmPrint} />}
      </AnimatePresence>
      {printing && <PrintJob item={printing} onDone={() => setPrinting(null)} />}
    </>
  );
}
