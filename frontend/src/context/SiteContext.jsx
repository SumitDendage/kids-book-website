import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useToast } from './ToastContext.jsx';
import { createStage } from '../services/chapterStage.js';
import { authApi, catalogueApi, payApi, setUnauthorizedHandler } from '../services/api.js';
import { loadSession, rememberSession, storeSession, read, write, logEvent, pushLog, setLogIdentity } from '../services/storage.js';
import { applyAdminProducts, applyLocalPrices, applyServerCatalogue, sheetOf, VIEWS } from '../data/catalogue.js';
import { PLANS, WHYS } from '../data/content.js';
import { fmtCur, setCurrencyFromCountry } from '../services/currency.js';
import { getCoConfig, loadCoConfig, initialAddress } from '../services/checkout.js';

/* The one store for the customer site: who is signed in, what they may open, which
   overlay is showing, and every action that crosses components (sign-in gate,
   open a sheet, checkout, the viewer). It replaces the page script's globals.
   Actions read the latest values through refs, so a flow that waits for a
   sign-in (requireSignIn → then) always sees the new session. */
const SiteContext = createContext(null);
export const useSite = () => useContext(SiteContext);

/* prices and products the admin changed in this browser apply before the first paint */
applyLocalPrices(PLANS);
applyAdminProducts();

/* What to do once the customer is signed in, kept in this browser so it survives the
   email-confirmation link opening in a new tab: { do: 'sheet', id } · { do: 'shop' } ·
   { do: 'checkout', what } · { do: 'pay', ret, pending }. It is used once, and an old one
   (more than two hours) is dropped, so a sheet clicked long ago never pops up by surprise. */
const NEXT_KEY = 'lww_next', NEXT_TTL = 2 * 3600e3;
const saveNext = n => { try { if (n) localStorage.setItem(NEXT_KEY, JSON.stringify({ ...n, at: Date.now() })); else localStorage.removeItem(NEXT_KEY); } catch (_) {} };
const takeNext = () => { const n = read(NEXT_KEY, null); saveNext(null); return n && n.do && Date.now() - (n.at || 0) < NEXT_TTL ? n : null; };
/* true when this browser may still hold a session cookie (it signed in and did not sign out) —
   guests skip the session check at start, so it does not show up as a failed request.
   Browsers from before this hint fall back to "has signed in here before". */
const MAYBE_IN = 'lww_maybe_in';
const maybeSignedIn = () => { const v = read(MAYBE_IN, null); return v == null ? !!read('lww_seen', false) : !!v; };

export function makeAccess(session, ent) {
  /* Class plans run from their start to their end (the server sends both). A renewal starts where
     the plan before it ends, so a class is covered while one of its plans has begun, and it runs
     until the last one ends; a plan the admin gave with no end does not run out. */
  const now = Date.now();
  const plans = ent.filter(e => e.scope === 'class' && !(e.end && e.end <= now));   /* revoked ones are not sent */
  const subOf = cls => {
    const mine = plans.filter(e => e.cls === cls), cur = mine.filter(e => e.start <= now).sort((a, b) => b.start - a.start)[0];
    if (!cur) return null;
    return { cls, plan: cur.plan || 'm1', start: cur.start, at: cur.start, end: mine.some(e => !e.end) ? null : Math.max(...mine.map(e => e.end)) };
  };
  const subsOf = () => Array.from(new Set(plans.map(e => e.cls))).map(subOf).filter(Boolean);
  const activeSub = cls => subOf(cls);
  /* a paid single-PDF purchase, or a free sheet already opened once */
  const itemEnt = id => ent.filter(e => e.scope === 'worksheet' && e.worksheet === id).sort((a, b) => b.start - a.start)[0] || null;
  const ownedOf = () => Array.from(new Set(ent.filter(e => e.scope === 'worksheet').map(e => e.worksheet)));
  /* free sheets open for anyone signed in (the server grants the entitlement on the spot);
     a paid sheet opens with the class plan or its own purchase — the server decides, this only paints the buttons */
  const canOpen = it => (it.price === 0 ? !!session : !!(activeSub(it.cls) || itemEnt(it.id)));
  return { session, ent, subsOf, activeSub, itemEnt, ownedOf, canOpen };
}

export function SiteProvider({ children }) {
  const toast = useToast();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const stage = useMemo(createStage, []);

  /* ---------- who is signed in, and what they may open ---------- */
  const [session, _setSession] = useState(loadSession);
  const [ent, _setEnt] = useState([]);
  const sessionRef = useRef(session), entRef = useRef(ent);
  const setSession = useCallback(s => { sessionRef.current = s; setLogIdentity(s && s.email); _setSession(s); }, []);
  const setEnt = useCallback(e => { entRef.current = e; _setEnt(e); }, []);
  const access = useMemo(() => makeAccess(session, ent), [session, ent]);
  const accessNow = () => makeAccess(sessionRef.current, entRef.current);

  /* the catalogue objects are updated in place (server prices, admin edits); bumping this re-renders the shelves */
  const [version, setVersion] = useState(0);
  const rerenderAll = useCallback(() => setVersion(v => v + 1), []);
  /* home page copy the admin edited (Content section) */
  const [content, setContentState] = useState(() => read('lww_content', {}));
  const whys = Array.isArray(content.whys) && content.whys.length ? content.whys : WHYS;

  /* ---------- what is on screen ---------- */
  const [siteStage, setSiteStage] = useState('boot');     /* 'boot' while the veil is up, then 'site' */
  const [section, setSection] = useState(0);
  const [hintHidden, setHintHidden] = useState(false);
  const [drawer, setDrawer] = useState(null);             /* 'menu' | 'bag' | null */
  const [modal, setModal] = useState({ open: false, kind: null });
  const [shop, setShop] = useState({ open: false, view: 'all', cls: 'all', subject: 'all', skill: null });
  const [checkout, setCheckout] = useState({ open: false, item: null, nonce: 0 });
  const [auth, setAuth] = useState(() => ({ view: loadSession() ? 'signin' : 'signup', alert: null, nonce: 0, token: null }));
  /* the staff page registers its fade-out here, so Escape and ✕ close it the same way */
  const portalCloser = useRef(null);
  const portalKind = pathname === '/admin' ? 'admin' : pathname === '/developer' ? 'developer' : null;

  stage.onSection = setSection;
  stage.onHideHint = () => setHintHidden(true);
  /* an overlay, drawer or modal owns the wheel, touch and keys */
  const lock = useRef({});
  lock.current = { overlay: shop.open || checkout.open || !!portalKind, drawer: !!drawer, modal: modal.open };
  const isInputLocked = useCallback(() => { const l = lock.current; return l.overlay || l.drawer || l.modal; }, []);
  stage.isLocked = isInputLocked;

  useEffect(() => { document.body.classList.toggle('is-guest', !session); }, [session]);

  /* ---------- actions (stable: they read the latest state through refs) ---------- */
  const actions = useMemo(() => {
    const a = {};
    a.goTo = n => { a.closeDrawers(); stage.goTo(n); };
    a.closeDrawers = () => setDrawer(null);
    a.openDrawer = id => setDrawer(id);
    a.closeModal = () => setModal(m => (m.open ? { ...m, open: false } : m));
    a.closeShop = () => setShop(s => (s.open ? { ...s, open: false } : s));
    a.closeCheckout = () => setCheckout(c => (c.open ? { ...c, open: false } : c));
    a.openShop = view => {
      setDrawer(null); a.closeModal();
      setShop(s => (view && VIEWS.some(v => v.id === view) ? { ...s, open: true, view, cls: 'all', subject: 'all', skill: null } : { ...s, open: true }));
    };
    a.setShopFilter = patch => setShop(s => ({ ...s, ...patch }));
    /* token: the one from a password-reset link, kept while the reset form is showing */
    a.setAuthView = (view, token) => setAuth(x => ({ view, alert: null, nonce: x.nonce + 1, token: token || null }));
    a.setAuthAlert = alert => setAuth(x => ({ ...x, alert }));
    a.rerenderAll = () => setVersion(v => v + 1);
    a.setContent = c => setContentState(c);

    a.syncEntitlements = async () => {
      if (!sessionRef.current) { setEnt([]); return []; }
      try { const r = await catalogueApi.entitlements(); setEnt(r.entitlements || []); return r.entitlements || []; }
      catch (err) { if (err.status !== 401) console.warn('entitlements', err.message); return entRef.current; }
    };
    a.forgetSession = () => {
      setSession(null); setEnt([]); rememberSession(null); write(MAYBE_IN, false);
      a.setAuthView('signin');
    };
    a.signedIn = async (s, msg, remember = true) => {
      const next = { name: s.name, email: s.email, role: s.role || null };
      setSession(next); storeSession(next, remember); write(MAYBE_IN, true);
      await a.syncEntitlements();
      toast(msg);
      const n = takeNext();
      if (n) setTimeout(() => a.runNext(n), 400);
    };
    a.runNext = n => {
      if (n.do === 'sheet' && n.id) a.openSheet(n.id);
      else if (n.do === 'shop') a.openShop('all');
      else if (n.do === 'checkout' && n.what) a.openCheckout(n.what);
      else if (n.do === 'pay' && n.ret) a.finishPayment(n.ret, n.pending || null);
    };
    a.signOut = () => { authApi.logout().catch(() => {}); saveNext(null); a.forgetSession(); toast('Signed out. See you soon.'); };
    a.setRole = role => {
      const s = sessionRef.current; if (!s) return;
      const next = { ...s, role }; setSession(next); rememberSession(next);
      if (role) authApi.updateMe({ role }).catch(err => toast(err.message));
    };
    /* something that needs an account: remember what comes next, go to chapter 01, say why */
    a.requireSignIn = (next, why, view) => {
      saveNext(next);
      a.closeModal(); a.closeDrawers(); a.closeCheckout(); a.closeShop(); stage.goTo(0);
      a.setAuthView(view || (read('lww_seen', false) ? 'signin' : 'signup'));
      setTimeout(() => a.setAuthAlert({ type: 'ok', msg: why }), 500);
    };
    /* Not signed in? Every worksheet first shows what a free account includes. */
    a.showAccountPopup = id => { setModal({ open: true, kind: 'account', id }); logEvent('account_prompt', { item: id }); };
    /* any sheet, free or paid: a look at the page, what is inside, and the open / buy action */
    a.openSheet = id => {
      const it = sheetOf(id); if (!it) return;
      if (!sessionRef.current) { a.showAccountPopup(id); return; }
      setModal({ open: true, kind: 'sheet', id });
      logEvent('view', { item: it.id });
    };
    a.showPurchasePopup = p => setModal({ open: true, kind: 'purchase', purchase: p });
    /* openCheckout({ worksheet: 'kg-mat-cnt' }) buys one PDF; openCheckout({ cls: 'kg', plan: 'm3' }) subscribes to a class */
    a.openCheckout = what => {
      if (what && what.cls) {
        if (!sessionRef.current) { a.requireSignIn({ do: 'checkout', what }, 'Sign in to subscribe — every sheet in the class opens as soon as you have paid.'); return; }
        setDrawer(null); a.closeModal();
        setCheckout(c => ({ open: true, item: null, cls: what.cls, plan: what.plan || 'm3', nonce: c.nonce + 1 }));
        return;
      }
      if (!what || !what.worksheet) { toast('Pick a sheet to buy — each PDF is bought on its own.'); return; }
      if (!sessionRef.current) { a.requireSignIn({ do: 'checkout', what }, 'Sign in to buy this PDF — it opens as soon as you have paid.'); return; }
      if (!sheetOf(what.worksheet)) return;
      setDrawer(null); a.closeModal();
      setCheckout(c => ({ open: true, item: what.worksheet, cls: null, plan: null, nonce: c.nonce + 1 }));
    };
    /* Open a sheet in the protected viewer (new tab, full screen). Sign-in is required for every sheet.
       The SERVER decides: POST /api/access/:id answers with a view token (free, or a valid entitlement),
       402 when payment is needed, 401 when the session is gone. The page only follows that answer. */
    a.openViewer = async id => {
      const it = sheetOf(id); if (!it) return;
      if (!sessionRef.current) { a.requireSignIn({ do: 'sheet', id }, 'Sign in to open ' + it.title + ' — free and paid sheets both need an account.'); return; }
      if (it.price !== 0 && !accessNow().canOpen(it)) {
        /* this browser's copy says it is not yours — but it may be old (bought in another tab or on
           another device), so the server is asked before anyone is sent to pay */
        const fresh = await a.syncEntitlements();
        if (!makeAccess(sessionRef.current, fresh).canOpen(it)) { a.closeModal(); a.openCheckout({ worksheet: id }); return; }
        a.openSheet(id); toast(it.title + ' is on your account — tap Open to read it.'); return;   /* a new tab needs a fresh tap */
      }
      const win = window.open('', '_blank');   /* open synchronously so the browser allows the tab */
      try {
        const r = await catalogueApi.access(id);
        const href = '/viewer.html#t=' + encodeURIComponent(r.token);
        if (win) win.location.href = href; else window.location.href = href;
        logEvent('open', { item: id, kind: r.entitlement.kind });
        a.syncEntitlements();
      } catch (err) {
        if (win) win.close();
        if (err.status === 402) { a.closeModal(); toast('Payment needed to open this sheet'); a.openCheckout({ worksheet: id }); return; }
        if (err.status === 401) { a.requireSignIn({ do: 'sheet', id }, 'Your session ended — sign in again to open ' + it.title + '.', 'signin'); return; }
        toast(err.message);
      }
    };
    /* a card's own buttons: unlock (free) and buy (paid) */
    a.unlock = id => { if (!sessionRef.current) { a.showAccountPopup(id); return; } a.openViewer(id); };
    a.buy = async id => {
      if (!sessionRef.current) { a.showAccountPopup(id); return; }
      /* bought already in another tab or on another device? then there is nothing to pay */
      const it = sheetOf(id), fresh = await a.syncEntitlements();
      if (it && makeAccess(sessionRef.current, fresh).canOpen(it)) { a.openSheet(id); toast(it.title + ' is already on your account — tap Open to read it.'); return; }
      a.closeModal(); a.openCheckout({ worksheet: id });
    };
    a.openPortal = kind => { setDrawer(null); a.closeModal(); a.closeCheckout(); navigate('/' + kind); };
    a.closePortal = () => { if (portalCloser.current) portalCloser.current(); else navigate('/' + window.location.hash); };
    /* after a purchase: My Worksheets */
    a.openMyWorksheets = () => { a.closeModal(); setDrawer('bag'); };

    /* The links in the account emails: /?verify=… (Accept & Continue) confirms the email and shows
       sign-in; /?reset=… opens the new-password form. Both land on the sign-in card (chapter 01). */
    a.handleAuthLink = async () => {
      const u = new URL(window.location.href), verify = u.searchParams.get('verify'), reset = u.searchParams.get('reset');
      if (!verify && !reset) return;
      u.searchParams.delete('verify'); u.searchParams.delete('reset');
      history.replaceState(history.state, '', u.pathname + u.search + u.hash);   /* the token leaves the address bar */
      stage.goTo(0);
      if (reset) {
        /* signed in here? sign this browser out first — the reset signs out every device anyway, and the form only shows to guests */
        if (sessionRef.current) { await authApi.logout().catch(() => {}); a.forgetSession(); }
        a.setAuthView('reset', reset); return;
      }
      try {
        const r = await authApi.verifyEmail({ token: verify });
        if (sessionRef.current) { toast(r.message); return; }
        a.setAuthView('signin');
        setTimeout(() => a.setAuthAlert({ type: 'ok', msg: r.message }), 0);
      } catch (err) {
        a.setAuthView('signin');
        setTimeout(() => a.setAuthAlert({ type: 'err', msg: err.message }), 0);
      }
    };
    /* Back from Stripe or PayPal: ?pay=stripe&order=…&session=…  ·  ?pay=paypal&order=…&token=…  ·  ?pay=cancel&order=… */
    a.handlePaymentReturn = () => {
      const u = new URL(window.location.href), pay = u.searchParams.get('pay'); if (!pay) return;
      const ret = { pay, order: u.searchParams.get('order') || '', session: u.searchParams.get('session') || '', token: u.searchParams.get('token') || '' };
      let pending = null; try { pending = JSON.parse(sessionStorage.getItem('lww_pending_pay') || 'null'); sessionStorage.removeItem('lww_pending_pay'); } catch (_) {}
      history.replaceState(history.state, '', u.pathname + u.hash);   /* clean the address bar */
      a.finishPayment(ret, pending);
    };
    /* confirm the payment with the server; with no session in this tab, the cookie is tried once,
       then the customer signs in and the confirmation carries on from there */
    a.finishPayment = async (ret, pending) => {
      if (!sessionRef.current) {
        try {
          const r = await authApi.refresh(); const s = { name: r.user.name, email: r.user.email, role: r.user.role || null };
          setSession(s); rememberSession(s); write(MAYBE_IN, true);
        } catch (_) {
          if (ret.pay === 'cancel') { toast('Payment cancelled — nothing was charged.'); return; }   /* nothing to finish */
          a.requireSignIn({ do: 'pay', ret, pending }, 'Sign in again to finish your payment — you will not be charged twice.', 'signin'); return;
        }
      }
      const s = sessionRef.current, { pay, order: orderId } = ret;
      try {
        let done;
        if (pay === 'cancel') { if (orderId) await payApi.cancel({ order_id: orderId }); toast('Payment cancelled — nothing was charged.'); if (pending && pending.worksheet) a.openSheet(pending.worksheet); return; }
        if (pay === 'stripe') done = await payApi.stripeConfirm({ order_id: orderId, session_id: ret.session });
        else if (pay === 'paypal') done = await payApi.paypalCapture({ order_id: orderId, token: ret.token });
        else return;
        const paid = done.order, cur = paid.currency || (pending && pending.currency) || 'INR';
        pushLog('lww_orders', { id: paid.id, at: paid.at, email: s.email, name: s.name, cls: paid.cls, plan: paid.plan, worksheet: paid.worksheet, amount: paid.totalInr, currency: cur, total: paid.total, method: pay === 'stripe' ? 'Stripe' : 'PayPal', status: 'paid' }, 1000);
        pushLog('lww_payments', { at: paid.paidAt || Date.now(), order: paid.id, gateway: pay === 'stripe' ? 'Stripe' : 'PayPal', payment: paid.paymentId, amount: paid.total, currency: cur, status: 'captured' }, 400);
        logEvent('buy', { order: paid.id, worksheet: paid.worksheet, amount: paid.totalInr, currency: cur, gateway: pay });
        await a.syncEntitlements();
        a.showPurchasePopup({ order: paid.id, cls: paid.cls, plan: paid.plan, worksheet: paid.worksheet, total: fmtCur(paid.total, cur), method: pay === 'stripe' ? 'Stripe' : 'PayPal' });
      } catch (err) {
        if (err.status === 401) { a.requireSignIn({ do: 'pay', ret, pending }, 'Sign in again to finish your payment — you will not be charged twice.', 'signin'); return; }
        toast(err.message || 'Could not confirm the payment'); if (pending && pending.worksheet) a.openSheet(pending.worksheet);
      }
    };
    /* the currency the prices are shown in */
    a.loadCurrency = () => loadCoConfig().then(cfg => { if (setCurrencyFromCountry(cfg, initialAddress().country)) a.rerenderAll(); }).catch(() => {});   /* the same country the checkout starts with */
    return a;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, toast, navigate, setSession, setEnt]);
  /* a 401 on any call outside /api/auth/* means the cookie is gone: the page must not think we are signed in */
  useEffect(() => { setUnauthorizedHandler(() => { if (sessionRef.current) actions.forgetSession(); }); return () => setUnauthorizedHandler(null); }, [actions]);

  const checkoutOpenRef = useRef(false), portalRef = useRef(null), shopOpenRef = useRef(false);
  checkoutOpenRef.current = checkout.open; portalRef.current = portalKind; shopOpenRef.current = shop.open;
  /* Escape closes the top-most thing: modal, drawer, checkout, staff page, store */
  useEffect(() => {
    const onKey = e => {
      if (e.key !== 'Escape') return;
      if (lock.current.modal) actions.closeModal();
      else if (lock.current.drawer) actions.closeDrawers();
      else if (checkoutOpenRef.current) actions.closeCheckout();
      else if (portalRef.current) actions.closePortal();
      else if (shopOpenRef.current) actions.closeShop();
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [actions]);

  /* THE SERVER IS THE SOURCE OF TRUTH — prices and which sheets have a real PDF come from the
     database (GET /api/worksheets); the session cookie is checked (POST /api/auth/refresh-token) and the
     entitlements loaded, so a stale copy in this browser can never open anything. */
  useEffect(() => {
    let alive = true;
    (async () => {
      try { const r = await catalogueApi.worksheets(); if (!alive) return; applyServerCatalogue(r.worksheets); rerenderAll(); }
      catch (err) { console.warn('catalogue: ' + err.message + ' — showing the built-in prices'); }
    })();
    (async () => {
      const had = !!sessionRef.current;
      if (!had && !maybeSignedIn()) return;   /* a guest: no cookie to check */
      try {
        const r = await authApi.refresh(); if (!alive) return;   /* the cookie still good? (and its expiry moved on) */
        const s = { name: r.user.name, email: r.user.email, role: r.user.role || null };
        setSession(s); rememberSession(s); write(MAYBE_IN, true); await actions.syncEntitlements();
        if (!had) actions.setAuthView('signin');
      } catch (err) { if (err.status === 401) { if (had) actions.forgetSession(); else write(MAYBE_IN, false); } }
    })();
    logEvent('visit', { path: window.location.hash || '/', ref: document.referrer ? new URL(document.referrer).hostname : 'direct', ua: navigator.userAgent.slice(0, 80) });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const value = {
    stage, access, session, version, content, whys, siteStage, setSiteStage, section, hintHidden,
    drawer, modal, shop, checkout, auth, portalKind, portalCloser, coConfig: getCoConfig(), isInputLocked,
    toast, ...actions,
  };
  return <SiteContext.Provider value={value}>{children}</SiteContext.Provider>;
}
