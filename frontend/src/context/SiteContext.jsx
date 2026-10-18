import { isRecovery } from '../services/supabaseAuth.js';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useToast } from './ToastContext.jsx';
import { createStage } from '../services/chapterStage.js';
import {
  authApi, cartApi, catalogueApi, customerTokens, signedOutHere, eventsApi, fetchConfig, fetchContent, onCustomerTokensChange, payApi, setAuthProblemHandler, setUnauthorizedHandler,
} from '../services/api.js';
import { loadSession, rememberSession, storeSession, read, write } from '../services/storage.js';
import { applyServerCatalogue, sheetOf, VIEWS } from '../data/catalogue.js';
import { WHYS, classById, planOf, accountTypeOf, DEFAULT_PRINTS, printsTableOf } from '../data/content.js';
import { fmtCur, setCurrencyFromCountry } from '../services/currency.js';
import { getCoConfig, loadCoConfig, initialAddress } from '../services/checkout.js';
import { markAccountBlocked, clearAccountBlocked } from '../services/security.js';
import { dateTimeTz } from '../utils/format.js';

/* The one store for the customer site: who is signed in, what they may open, which
   overlay is showing, and every action that crosses components (sign-in gate,
   open a sheet, checkout, the viewer). Actions read the latest values through refs,
   so a flow that waits for a sign-in (requireSignIn → then) always sees the new session.
   The SERVER decides everything that matters: the sign-in lives in the tokens the API gave
   (services/api.js), and lww_session is only a copy for the first paint, removed whenever
   the tokens are gone. Nothing about orders, payments or sign-ins is logged in the browser:
   the server records them. */
const SiteContext = createContext(null);
export const useSite = () => useContext(SiteContext);

/* What to do once the customer is signed in, kept in this browser so it survives the
   email-confirmation link opening in a new tab: { do: 'sheet', id } · { do: 'shop' } ·
   { do: 'checkout', what } · { do: 'pay', ret, pending } · { do: 'account', tab }. It is used once, and an old one
   (more than two hours) is dropped, so a sheet clicked long ago never pops up by surprise. */
const NEXT_KEY = 'lww_next', NEXT_TTL = 2 * 3600e3;
const saveNext = n => { try { if (n) localStorage.setItem(NEXT_KEY, JSON.stringify({ ...n, at: Date.now() })); else localStorage.removeItem(NEXT_KEY); } catch (_) {} };
const takeNext = () => { const n = read(NEXT_KEY, null); saveNext(null); return n && n.do && Date.now() - (n.at || 0) < NEXT_TTL ? n : null; };

/* the customer as the site keeps them (never a token, never a password). role is the account type
   (null until chosen), printsPerSheet the prints it gets per sheet (the server's number), staff
   whether this account is also a staff account (staff are never asked for an account type). */
export const sessionOf = u => (u && u.email ? {
  id: u.id || null, name: u.name || '', email: u.email, role: u.role || null,
  printsPerSheet: Number.isInteger(u.printsPerSheet) && u.printsPerSheet >= 0 ? u.printsPerSheet : null,
  staff: !!u.staff,
  accessStatus: u.accessStatus || 'active', timeZone: u.timeZone || null,
} : null);

/* The cart of a visitor who is not signed in lives in this browser (a list of sheet ids); it is
   merged into the server's cart when they sign in (POST /api/cart/merge). */
const LOCAL_CART = 'lww_cart', CART_MAX = 50;
const SHEET_ID = /^[A-Za-z0-9-]{1,64}$/;
function readLocalCart() {
  try {
    const v = JSON.parse(localStorage.getItem(LOCAL_CART) || '[]');
    return Array.isArray(v) ? Array.from(new Set(v.filter(x => typeof x === 'string' && SHEET_ID.test(x)))).slice(0, CART_MAX) : [];
  } catch (_) { return []; }
}
function writeLocalCart(ids) { try { if (ids.length) localStorage.setItem(LOCAL_CART, JSON.stringify(ids)); else localStorage.removeItem(LOCAL_CART); } catch (_) {} }
/* the browser's cart in the server's shape, from the catalogue this page already has */
function localCartOf(ids) {
  const items = ids.map(id => {
    const it = sheetOf(id);
    if (!it) return { worksheet: id, title: id, priceInr: 0, wasPriceInr: null, cls: null, subject: '', thumb: null, accessDays: null, problem: 'unavailable' };
    const problem = it.price === 0 ? 'free' : it.available === false || it.onSale === false ? 'unavailable' : null;
    return { worksheet: id, title: it.title, priceInr: it.price, wasPriceInr: it.was || null, cls: it.cls || null, subject: it.subject || '', thumb: it.img || null, accessDays: it.accessDays || null, problem };
  });
  return { items, count: items.length, totalInr: items.reduce((s, l) => s + (l.problem ? 0 : Number(l.priceInr) || 0), 0) };
}
/* the server's answer, made safe to draw */
function serverCartOf(r) {
  const items = (r && Array.isArray(r.items) ? r.items : []).filter(l => l && typeof l.worksheet === 'string');
  const total = Number(r && r.totalInr);
  return { items, count: Number.isInteger(r && r.count) ? r.count : items.length, totalInr: Number.isFinite(total) ? total : items.reduce((s, l) => s + (l.problem ? 0 : Number(l.priceInr) || 0), 0) };
}
/* the copy for the first paint counts only while this browser holds a sign-in */
function initialSession() {
  if (!authApi.hasTokens()) { rememberSession(null); return null; }
  const s = loadSession();
  return s && s.email ? s : null;
}

/* Is this access record open right now? The server says so (status / active); the clock is only a
   backstop for a record that ends while the page is open. `now` is the server's time as best known. */
export function isLive(e, now = Date.now()) {
  if (!e) return false;
  const st = e.status || (e.active === false ? 'expired' : 'active');
  if (st !== 'active' && st !== 'scheduled') return false;
  if (e.start != null && e.start > now) return false;
  if (e.end != null && e.end <= now) return false;
  return true;
}
const BIG = Number.MAX_SAFE_INTEGER;

/* The home page words the team published (GET /api/content → { home: { badge, heroTitle, heroLede, whys } }).
   Only these fields are taken; anything missing shows the built-in words. */
function homeOf(r) {
  const h = r && r.home && typeof r.home === 'object' ? r.home : {};
  const out = {};
  ['badge', 'heroTitle', 'heroLede'].forEach(k => { if (typeof h[k] === 'string' && h[k].trim()) out[k] = h[k]; });
  if (Array.isArray(h.whys)) { const w = h.whys.filter(x => typeof x === 'string' && x.trim()); if (w.length) out.whys = w; }
  return out;
}
const endKey = e => (e.end == null ? BIG : e.end);

/* What this customer may open, from EVERY access record the server sent (active, scheduled,
   expired, revoked). Only live records open anything; the rest is history. */
export function makeAccess(session, ent, skew = 0) {
  const now = Date.now() + (Number(skew) || 0);
  const all = Array.isArray(ent) ? ent : [];
  const live = all.filter(e => isLive(e, now));
  /* Class plans run from their start to their end. A renewal starts where the plan before it ends,
     so a class is covered while one of its plans has begun, until the last one ends. */
  const plans = all.filter(e => e.scope === 'class' && (e.status ? (e.status === 'active' || e.status === 'scheduled') : e.active !== false) && !(e.end != null && e.end <= now));
  const subOf = cls => {
    const mine = plans.filter(e => e.cls === cls), cur = mine.filter(e => (e.start || 0) <= now).sort((a, b) => b.start - a.start)[0];
    if (!cur) return null;
    return { cls, plan: cur.plan || 'm1', start: cur.start, at: cur.start, end: mine.some(e => e.end == null) ? null : Math.max(...mine.map(e => e.end)), planLabel: cur.planLabel || null, className: cur.className || null };
  };
  const subsOf = () => Array.from(new Set(plans.map(e => e.cls))).map(subOf).filter(Boolean);
  const activeSub = cls => subOf(cls);
  /* the record that opens a sheet bought on its own (or a free sheet opened before): bought first, latest end */
  const itemEnt = id => live.filter(e => e.scope === 'worksheet' && e.worksheet === id)
    .sort((a, b) => (a.kind === 'free' ? 1 : 0) - (b.kind === 'free' ? 1 : 0) || endKey(b) - endKey(a))[0] || null;
  const ownedOf = () => Array.from(new Set(live.filter(e => e.scope === 'worksheet').map(e => e.worksheet)));
  /* a sheet bought on its own whose time is up (and nothing else opens it): "Buy Access Again" */
  const endedOf = id => {
    if (itemEnt(id)) return null;
    return all.filter(e => e.scope === 'worksheet' && e.worksheet === id && e.kind !== 'free' && e.status !== 'revoked' && (e.status === 'expired' || (e.end != null && e.end <= now)))
      .sort((a, b) => (b.end || 0) - (a.end || 0))[0] || null;
  };
  /* class plans that ran out, with no plan running or waiting for that class */
  const endedPlans = () => {
    const open = new Set(plans.map(e => e.cls)), by = {};
    all.filter(e => e.scope === 'class' && !open.has(e.cls) && e.status !== 'revoked' && e.end != null && e.end <= now)
      .forEach(e => { if (!by[e.cls] || by[e.cls].end < e.end) by[e.cls] = e; });
    return Object.values(by).map(e => ({ cls: e.cls, plan: e.plan, start: e.start, end: e.end, planLabel: e.planLabel || null, className: e.className || null }));
  };
  /* free sheets open for everyone, signed in or not (signed in, the server grants the record on the
     spot); a paid sheet opens with a running class plan or its own live purchase. The server decides;
     this paints buttons. */
  const canOpen = it => (it.price === 0 ? true : !!(activeSub(it.cls) || itemEnt(it.id)));
  return { session, ent: all, live, now, skew: Number(skew) || 0, subsOf, activeSub, itemEnt, ownedOf, endedOf, endedPlans, canOpen };
}

const PAY_LABEL = { razorpay: 'Razorpay', stripe: 'Stripe', paypal: 'PayPal' };
const titleOf = l => {
  if (l.title) return l.title;
  if (l.worksheet) { const it = sheetOf(l.worksheet); return it ? it.title : l.worksheet; }
  const c = l.cls && classById(l.cls);
  return (c ? c.label : 'Class') + (l.plan ? ' · ' + planOf(l.plan).label + ' plan' : ' plan');
};
/* What the purchase popup is given, from a payment answer ({ ok, status, order, entitlement,
   entitlements } from /api/pay/verify, stripe/confirm or paypal/capture) or from the older
   { order: 'LWO-…', cls, plan, worksheet, total, method } shape. Always:
   { order (the order id), orderId, cls, plan, worksheet (first line), total (shown text), method,
     paidAt, lines: [{ kind, worksheet, cls, plan, title, months, accessDays, start, end (ms),
     expiresAt (ISO), status }], expiresAt / end (first line), orderView (the API order), entitlements }. */
export function purchaseOf(p, method) {
  if (!p) return null;
  const view = p.order && typeof p.order === 'object' ? p.order : (p.orderView || null);
  const ents = Array.isArray(p.entitlements) ? p.entitlements : (p.entitlement ? [p.entitlement] : []);
  const id = view ? view.id : (typeof p.order === 'string' ? p.order : (p.orderId || ''));
  const fromEnt = e => ({ kind: e.scope, worksheet: e.worksheet || null, cls: e.cls || null, plan: e.plan || null, title: titleOf(e), months: e.months || null, accessDays: null, start: e.start ?? null, end: e.end ?? null, expiresAt: e.expiresAt || null, status: e.status || null });
  const lines = view && Array.isArray(view.lines) && view.lines.length
    ? view.lines.map(l => {
      const e = l.entitlement || ents.find(x => (l.worksheet ? x.worksheet === l.worksheet : x.scope === 'class' && x.cls === l.cls)) || {};
      const end = e.end ?? null;
      return { kind: l.kind, worksheet: l.worksheet || null, cls: l.cls || null, plan: l.plan || null, title: titleOf(l), months: l.months || null, accessDays: l.accessDays || null, start: e.startsAt ?? e.start ?? null, end, expiresAt: e.expiresAt || (end ? new Date(end).toISOString() : null), status: e.status || null };
    })
    : ents.map(fromEnt);
  const first = lines[0] || {};
  const cur = (view && view.currency) || p.currency || 'INR';
  return {
    ...(view ? {} : p),
    order: id, orderId: id,
    cls: first.cls ?? p.cls ?? (view && view.cls) ?? null,
    plan: first.plan ?? p.plan ?? (view && view.plan) ?? null,
    worksheet: first.worksheet ?? p.worksheet ?? (view && view.worksheet) ?? null,
    total: typeof p.total === 'string' ? p.total : view ? fmtCur(view.total, cur) : '',
    method: method || (typeof p.method === 'string' && !view ? p.method : '') || (view && PAY_LABEL[view.method]) || '',
    paidAt: (view && view.paidAt) || p.paidAt || Date.now(),
    lines, expiresAt: first.expiresAt || null, end: first.end ?? null,
    orderView: view, entitlements: ents,
  };
}

export function SiteProvider({ children }) {
  const toast = useToast();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const stage = useMemo(createStage, []);

  /* ---------- who is signed in, and what they may open ---------- */
  const [session, _setSession] = useState(initialSession);
  const [ent, _setEnt] = useState([]);
  const [skew, setSkew] = useState(0);         /* the server's clock minus this device's, from the last answer */
  const [clock, setClock] = useState(0);       /* bumps when an access record runs out while the page is open */
  const sessionRef = useRef(session), entRef = useRef(ent), skewRef = useRef(0), signInAt = useRef(null);
  const setSession = useCallback(s => { sessionRef.current = s; _setSession(s); }, []);
  const setEnt = useCallback(e => { entRef.current = e; _setEnt(e); }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const access = useMemo(() => makeAccess(session, ent, skew), [session, ent, skew, clock]);
  const accessNow = () => makeAccess(sessionRef.current, entRef.current, skewRef.current);
  /* security status from a sign-in answer, so the warning shows without waiting (SecurityContext reads it) */
  const [securitySeed, setSecuritySeed] = useState(null);
  const [securityNonce, setSecurityNonce] = useState(0);
  /* true once the server has named this customer since the page opened (the copy kept for the first
     paint can be old, so the account-type question waits for this) */
  const [sessionFresh, setSessionFresh] = useState(false);
  /* prints per sheet for each account type, from GET /api/config ({ parent, teacher, organization }) */
  const [printsTable, setPrintsTable] = useState(DEFAULT_PRINTS);

  /* ---------- the cart ----------
     Signed in: the server's cart (serverCart, null until it answers or when the server has no cart yet).
     Not signed in: the sheet ids kept in this browser (cartIds). */
  const [cartIds, _setCartIds] = useState(readLocalCart);
  const [serverCart, _setServerCart] = useState(null);
  const cartIdsRef = useRef(cartIds), serverCartRef = useRef(null);
  const setCartIds = useCallback(ids => { cartIdsRef.current = ids; writeLocalCart(ids); _setCartIds(ids); }, []);
  const setServerCart = useCallback(c => { serverCartRef.current = c; _setServerCart(c); }, []);

  /* the catalogue objects are updated in place (server prices, admin edits); bumping this re-renders the shelves */
  const [version, setVersion] = useState(0);
  const rerenderAll = useCallback(() => setVersion(v => v + 1), []);
  /* home page words the team published (GET /api/content, loaded at start); lww_content is only the last
     answer, kept so the next visit paints the same words straight away. The staff Content page previews here. */
  const [content, setContentState] = useState(() => { const c = read('lww_content', {}); return c && typeof c === 'object' ? homeOf({ home: c }) : {}; });
  const whys = Array.isArray(content.whys) && content.whys.length ? content.whys : WHYS;
  /* the cart as every component sees it: { items, count, totalInr, ids, has(id) } */
  const cart = useMemo(() => {
    const c = session && serverCart ? serverCart : localCartOf(cartIds);
    const ids = c.items.map(l => l.worksheet);
    return { ...c, ids, has: id => ids.includes(id), onServer: !!(session && serverCart) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, serverCart, cartIds, version]);

  /* ---------- what is on screen ---------- */
  const [siteStage, setSiteStage] = useState('boot');     /* 'boot' while the veil is up, then 'site' */
  const [section, setSection] = useState(0);
  const [hintHidden, setHintHidden] = useState(false);
  const [drawer, setDrawer] = useState(null);             /* 'menu' | 'bag' | null */
  const [accountTab, setAccountTab] = useState('sheets'); /* My Account: 'sheets' | 'orders' | 'devices' | 'security' */
  const [modal, setModal] = useState({ open: false, kind: null });
  const [notice, setNotice] = useState(null);             /* { kind, title, text, actions: [{ label, run?, primary? }] } */
  const [shop, setShop] = useState({ open: false, view: 'all', cls: 'all', subject: 'all', skill: null, q: '' });
  const [checkout, setCheckout] = useState({ open: false, item: null, nonce: 0 });
  /* the sign-in card: view 'signup' | 'signin' | 'forgot' | 'reset' | 'agree'; token = the reset link's;
     email = to fill in; agreement = { version, text } when the rules must be accepted again */
  const [auth, setAuth] = useState(() => ({ view: authApi.hasTokens() || read('lww_seen', false) ? 'signin' : 'signup', alert: null, nonce: 0, token: null, email: '', agreement: null }));
  /* the staff page registers its fade-out here, so Escape and ✕ close it the same way */
  const portalCloser = useRef(null);
  const portalKind = pathname === '/admin' ? 'admin' : pathname === '/developer' ? 'developer' : null;
  /* Who will use these sheets? Asked once, when a signed-in customer (never staff) has no account type
     yet, and only after the server confirmed who is signed in. It cannot be skipped. */
  const askRole = !!(session && sessionFresh && !session.role && !session.staff && !portalKind && pathname !== '/account-blocked');
  const askRoleRef = useRef(false); askRoleRef.current = askRole;

  stage.onSection = setSection;
  stage.onHideHint = () => setHintHidden(true);
  /* an overlay, drawer or modal owns the wheel, touch and keys (the security popups lock it too) */
  const securityLock = useRef(false);
  const lock = useRef({});
  lock.current = { overlay: shop.open || checkout.open || !!portalKind || pathname === '/account-blocked', drawer: !!drawer, modal: modal.open || !!notice || askRole };
  const isInputLocked = useCallback(() => { const l = lock.current; return l.overlay || l.drawer || l.modal || securityLock.current; }, []);
  stage.isLocked = isInputLocked;

  useEffect(() => { document.body.classList.toggle('is-guest', !session); }, [session]);

  /* an access record that runs out while the page is open stops counting at its end */
  useEffect(() => {
    const now = Date.now() + skew;
    const next = ent.reduce((m, e) => (e.end != null && e.end > now && e.end < m ? e.end : (e.start != null && e.start > now && e.start < m ? e.start : m)), BIG);
    if (next === BIG) return undefined;
    const t = setTimeout(() => setClock(c => c + 1), Math.min(next - now + 1000, 24 * 3600e3));
    return () => clearTimeout(t);
  }, [ent, skew, clock]);

  /* ---------- actions (stable: they read the latest state through refs) ---------- */
  const checkoutOpenRef = useRef(false);
  const actions = useMemo(() => {
    const a = {};
    const tz = () => (sessionRef.current && sessionRef.current.timeZone) || undefined;
    a.goTo = n => { a.closeDrawers(); stage.goTo(n); };
    a.closeDrawers = () => setDrawer(null);
    a.openDrawer = id => setDrawer(id);
    /* My Account on one of its tabs */
    a.openAccount = tab => { if (tab) setAccountTab(tab); setDrawer('bag'); };
    /* the Cart drawer (asks the server for the cart again, so a change made in another tab shows) */
    a.openCart = () => { setDrawer('cart'); a.refreshCart(); };
    a.setAccountTab = tab => setAccountTab(tab);
    a.closeModal = () => setModal(m => (m.open ? { ...m, open: false } : m));
    a.showNotice = n => setNotice(n);
    a.closeNotice = () => setNotice(null);
    a.closeShop = () => setShop(s => (s.open ? { ...s, open: false } : s));
    a.closeCheckout = () => setCheckout(c => (c.open ? { ...c, open: false } : c));
    /* the catalogue from the database (GET /api/worksheets): what staff publish, hide, schedule or
       price in Admin → Products shows without a new website upload. Loaded at the start, again when
       the shop opens and when the visitor comes back to the tab (at most once a minute). */
    let catalogueAt = 0, catalogueBusy = null;
    a.reloadCatalogue = (force = false) => {
      if (catalogueBusy) return catalogueBusy;
      if (!force && Date.now() - catalogueAt < 60_000) return Promise.resolve(false);
      catalogueBusy = catalogueApi.worksheets().then(r => {
        catalogueAt = Date.now();
        applyServerCatalogue(r.worksheets || [], { sections: r.sections, classes: r.classes });
        a.rerenderAll();
        return true;
      }).finally(() => { catalogueBusy = null; });
      return catalogueBusy;
    };
    a.openShop = view => {
      setDrawer(null); a.closeModal();
      a.reloadCatalogue().catch(() => {});
      setShop(s => (view && VIEWS.some(v => v.id === view) ? { ...s, open: true, view, cls: 'all', subject: 'all', skill: null, q: '' } : { ...s, open: true }));
    };
    a.setShopFilter = patch => setShop(s => ({ ...s, ...patch }));
    /* token: the one from a password-reset link, kept while the reset form is showing;
       extra: { email, agreement } to fill in */
    a.setAuthView = (view, token, extra) => setAuth(x => ({ view, alert: null, nonce: x.nonce + 1, token: token || null, email: (extra && extra.email) || '', agreement: (extra && extra.agreement) || null }));
    a.setAuthAlert = alert => setAuth(x => ({ ...x, alert }));
    a.rerenderAll = () => setVersion(v => v + 1);
    a.setContent = c => setContentState(c);

    /* every access record the server holds for this customer (active, scheduled, expired, revoked) */
    a.syncEntitlements = async () => {
      if (!sessionRef.current) { setEnt([]); return []; }
      const requestedUser = sessionRef.current.id;
      try {
        const r = await catalogueApi.entitlements();
        // Ignore requests that finish after logout or switching accounts.
        if (sessionRef.current?.id !== requestedUser) return [];
        const list = Array.isArray(r.entitlements) ? r.entitlements : [];
        if (typeof r.now === 'number') { skewRef.current = r.now - Date.now(); setSkew(skewRef.current); }
        setEnt(list);
        if (r.accessStatus && sessionRef.current && sessionRef.current.accessStatus !== r.accessStatus) {
          const next = { ...sessionRef.current, accessStatus: r.accessStatus }; setSession(next); rememberSession(next);
        }
        return list;
      } catch (err) { if (err.status !== 401) console.warn('entitlements', err.message); return entRef.current; }
    };
    /* the customer the server named (sign-in, refresh, another tab) becomes the session */
    a.adoptUser = u => {
      const next = sessionOf(u); if (!next) return null;
      const had = sessionRef.current;
      if (had?.id !== next.id) { setEnt([]); setSecuritySeed(null); }
      setSession(next); storeSession(next, true); clearAccountBlocked(); setSessionFresh(true);
      const t = customerTokens.get(); signInAt.current = t ? t.sessionExpiresAt || null : null;
      /* another account signed in: its cart is not this one's */
      if (had && had.id && next.id && had.id !== next.id) setServerCart(null);
      return next;
    };
    /* this page stops showing the customer (the tokens are handled by services/api.js) */
    a.forgetSession = (opts = {}) => {
      setSession(null); setEnt([]); rememberSession(null); signInAt.current = null; setSecuritySeed(null);
      setSessionFresh(false); setServerCart(null);
      if (!opts.keepView) a.setAuthView('signin');
    };
    a.signedIn = async (u, msg, remember = true, security = null) => {
      const next = a.adoptUser(u); if (!next) return;
      if (security) setSecuritySeed({ email: next.email, status: security, at: Date.now() });
      await a.syncEntitlements();
      await a.syncCart();
      if (msg) toast(msg);
      const n = takeNext();
      if (n) setTimeout(() => a.runNext(n), 400);
    };
    a.runNext = n => {
      if (n.do === 'sheet' && n.id) a.openSheet(n.id);
      else if (n.do === 'shop') a.openShop('all');
      else if (n.do === 'checkout' && n.what) a.openCheckout(n.what);
      else if (n.do === 'pay' && n.ret) a.finishPayment(n.ret, n.pending || null);
      else if (n.do === 'account') a.openAccount(n.tab || 'sheets');
      else if (n.do === 'cart') a.openCart();
    };

    /* ---------- the account type (asked once; only staff can change it afterwards) ----------
       Saves it with PATCH /api/auth/me { role } and takes the server's answer (with printsPerSheet).
       409 role_locked means it was already set (another tab, or staff): the profile is read again.
       Resolves true when the account has a type now; throws the error to show otherwise. */
    a.chooseAccountType = async role => {
      if (!sessionRef.current) return false;
      try {
        const r = await authApi.updateMe({ role });
        a.adoptUser(r.user || { ...sessionRef.current, role });
      } catch (err) {
        if (err.code !== 'role_locked' && err.status !== 409) throw err;
        const r = await authApi.me();
        a.adoptUser(r.user);
      }
      return !!(sessionRef.current && sessionRef.current.role);
    };
    a.setRole = role => { a.chooseAccountType(role).catch(err => toast(err.message)); };

    /* ---------- the cart ---------- */
    const quietly = err => { if (err && err.status !== 401 && err.status !== 0) console.warn('cart', err.message); };
    /* GET /api/cart answered 404 with no code: this server has no cart yet, so it stays in the browser */
    const noServerCart = err => err && err.status === 404 && !err.code;
    /* the cart as the server has it now (signed in), or this browser's list */
    a.refreshCart = async () => {
      if (!sessionRef.current) { setCartIds(readLocalCart()); return; }
      try { setServerCart(serverCartOf(await cartApi.get())); }
      catch (err) { if (noServerCart(err)) setServerCart(null); else quietly(err); }
    };
    /* after a sign-in: the browser's cart joins the account's (owned, free and unknown sheets are skipped) */
    a.syncCart = async () => {
      if (!sessionRef.current) return;
      const ids = readLocalCart();
      if (!ids.length) { await a.refreshCart(); return; }
      try { setServerCart(serverCartOf(await cartApi.merge(ids))); setCartIds([]); }
      catch (err) { if (noServerCart(err)) setServerCart(null); else { quietly(err); await a.refreshCart(); } }
    };
    a.addToCart = async id => {
      const it = sheetOf(id); if (!it) return false;
      if (it.price === 0) { toast('This sheet is free. Just open it.'); return false; }
      if (sessionRef.current && accessNow().canOpen(it)) { toast('This sheet is already on your account.'); return false; }
      if (!sessionRef.current || !serverCartRef.current) {
        const ids = readLocalCart();
        if (ids.includes(id)) { toast('It is already in your cart.'); return true; }
        if (ids.length >= CART_MAX) { toast('Your cart is full. It holds up to ' + CART_MAX + ' sheets.'); return false; }
        if (!sessionRef.current) { setCartIds(ids.concat(id)); toast('Added to your cart.'); return true; }
      }
      try {
        setServerCart(serverCartOf(await cartApi.add(id)));
        toast('Added to your cart.');
        return true;
      } catch (err) {
        if (noServerCart(err)) { const ids = readLocalCart(); if (!ids.includes(id)) setCartIds(ids.concat(id)); toast('Added to your cart.'); return true; }
        if (err.code === 'already_owned') { a.syncEntitlements(); toast('This sheet is already on your account.'); return false; }
        if (err.code === 'is_free') { toast('This sheet is free. Just open it.'); return false; }
        if (err.status === 401) return false;   /* the sign-in is gone: the handler explains */
        toast(err.status === 0 ? 'No connection. Please try again.' : err.message);
        return false;
      }
    };
    a.removeFromCart = async id => {
      const local = readLocalCart();
      if (local.includes(id)) setCartIds(local.filter(x => x !== id));
      if (!sessionRef.current || !serverCartRef.current) return;
      try { setServerCart(serverCartOf(await cartApi.remove(id))); }
      catch (err) { if (err.status !== 401) toast(err.status === 0 ? 'No connection. Please try again.' : err.message); }
    };
    a.emptyCart = async () => {
      setCartIds([]);
      if (!sessionRef.current || !serverCartRef.current) return;
      try { setServerCart(serverCartOf(await cartApi.empty())); }
      catch (err) { if (err.status !== 401) toast(err.status === 0 ? 'No connection. Please try again.' : err.message); }
    };
    /* Checkout: every sheet in the cart that can be bought now, in one order. Not signed in: sign in
       first (the cart comes along and opens again). */
    a.checkoutCart = () => {
      const c = serverCartRef.current && sessionRef.current ? serverCartRef.current : localCartOf(readLocalCart());
      const ids = c.items.filter(l => !l.problem).map(l => l.worksheet);
      if (!ids.length) { toast(c.items.length ? 'Nothing in your cart can be bought right now.' : 'Your cart is empty.'); return; }
      if (!sessionRef.current) { a.requireSignIn({ do: 'cart' }, 'Sign in to check out. Your cart comes with you.'); return; }
      a.openCheckout({ worksheets: ids });
    };
    /* ends this sign-in on the server too (works even after the access token ran out) */
    a.signOut = async () => {
      try { await authApi.logout(); } catch (err) { toast(err.message); return; }
      saveNext(null); a.closeDrawers(); a.closeNotice(); a.forgetSession();
      toast('Signed out. See you soon.');
    };
    /* something that needs an account: remember what comes next, go to chapter 01, say why */
    a.requireSignIn = (next, why, view) => {
      saveNext(next);
      a.closeModal(); a.closeDrawers(); a.closeCheckout(); a.closeShop(); stage.goTo(0);
      a.setAuthView(view || (read('lww_seen', false) ? 'signin' : 'signup'));
      setTimeout(() => a.setAuthAlert({ type: 'ok', msg: why }), 500);
    };
    /* Not signed in? A paid worksheet first shows what a free account includes. */
    a.showAccountPopup = id => setModal({ open: true, kind: 'account', id });
    /* any sheet, free or paid: a look at the page, what is inside, and the open / buy action.
       Free sheets open for everyone, so they show their own window to guests too. */
    a.openSheet = id => {
      const it = sheetOf(id); if (!it) return;
      if (!sessionRef.current && it.price !== 0) { a.showAccountPopup(id); return; }
      setModal({ open: true, kind: 'sheet', id });
    };
    /* after a verified payment: the popup gets purchaseOf(...) (see above) */
    /* the server takes paid sheets out of the cart when an order is paid, so the cart is read again */
    a.showPurchasePopup = (p, method) => { setModal({ open: true, kind: 'purchase', purchase: purchaseOf(p, method) }); a.refreshCart(); };
    /* openCheckout({ worksheet: 'kg-mat-cnt' }) buys one PDF (again: true when an earlier purchase ran out);
       openCheckout({ worksheets: [ids] }) buys every sheet of the cart in one order;
       openCheckout({ cls: 'kg', plan: 'm3' }) buys a class plan */
    a.openCheckout = what => {
      if (what && what.cls) {
        if (!sessionRef.current) { a.requireSignIn({ do: 'checkout', what }, 'Sign in to buy a plan. Every sheet in the class opens as soon as you have paid.'); return; }
        setDrawer(null); a.closeModal();
        setCheckout(c => ({ open: true, item: null, items: null, cls: what.cls, plan: what.plan || 'm3', again: !!what.again, nonce: c.nonce + 1 }));
        return;
      }
      if (what && Array.isArray(what.worksheets)) {
        const ids = Array.from(new Set(what.worksheets.filter(id => typeof id === 'string' && sheetOf(id)))).slice(0, CART_MAX);
        if (!ids.length) { toast('Your cart is empty.'); return; }
        if (ids.length === 1) { a.openCheckout({ worksheet: ids[0] }); return; }
        if (!sessionRef.current) { a.requireSignIn({ do: 'cart' }, 'Sign in to check out. Your cart comes with you.'); return; }
        setDrawer(null); a.closeModal();
        setCheckout(c => ({ open: true, item: null, items: ids, cls: null, plan: null, again: false, nonce: c.nonce + 1 }));
        return;
      }
      if (!what || !what.worksheet) { toast('Pick a sheet to buy, or add sheets to your cart.'); return; }
      if (!sessionRef.current) { a.requireSignIn({ do: 'checkout', what }, 'Sign in to buy this PDF. It opens as soon as you have paid.'); return; }
      if (!sheetOf(what.worksheet)) return;
      setDrawer(null); a.closeModal();
      setCheckout(c => ({ open: true, item: what.worksheet, items: null, cls: null, plan: null, again: !!what.again, nonce: c.nonce + 1 }));
    };
    /* "Buy Access Again" for a sheet whose time ran out */
    a.buyAgain = id => { a.closeNotice(); a.closeModal(); a.openCheckout({ worksheet: id, again: true }); };
    a.renewPlan = (cls, plan) => { a.closeNotice(); a.openCheckout({ cls, plan: plan || 'm3', again: true }); };
    /* the time on a sheet bought on its own ran out: say when, and offer to buy access again */
    const endedNotice = (it, endedAt) => a.showNotice({
      kind: 'expired', title: 'Your access has expired',
      text: 'Your access to ' + it.title + (endedAt ? ' expired on ' + dateTimeTz(endedAt, tz()) : ' has expired') + '. You can buy access again to keep opening it.',
      actions: [{ label: 'Buy Access Again', primary: true, run: () => a.buyAgain(it.id) }, { label: 'Not now' }],
    });
    /* Open a sheet in the protected viewer (new tab, full screen). Paid sheets need sign-in; a free
       sheet opens without it (the server hands a guest view token for that one sheet).
       The SERVER decides: POST /api/access/:id answers with a view token (free, or a live access
       record), 402 when payment is needed (expired: true when an earlier purchase ran out), 410 when
       the PDF is not ready yet, 401 when the sign-in is gone, 403 for a block. The page follows it. */
    a.openViewer = async id => {
      const it = sheetOf(id); if (!it) return;
      if (!sessionRef.current && it.price !== 0) { a.requireSignIn({ do: 'sheet', id }, 'Sign in to open ' + it.title + '.'); return; }
      if (it.price !== 0 && !accessNow().canOpen(it)) {
        /* this browser's copy says it is not open, but it may be old (bought in another tab or on
           another device), so the server is asked before anyone is sent to pay */
        const fresh = await a.syncEntitlements();
        const acc = makeAccess(sessionRef.current, fresh, skewRef.current);
        if (!acc.canOpen(it)) {
          a.closeModal();
          const ended = acc.endedOf(id);
          if (ended) endedNotice(it, ended.end); else a.openCheckout({ worksheet: id });
          return;
        }
        a.openSheet(id); toast('It is on your account. Tap Open to read it.'); return;   /* a new tab needs a fresh tap */
      }
      const win = window.open('', '_blank');   /* open synchronously so the browser allows the tab */
      try {
        const r = await catalogueApi.access(id);
        const href = '/viewer.html#t=' + encodeURIComponent(r.viewToken || r.token);
        if (win) win.location.href = href; else window.location.href = href;
        a.syncEntitlements();
      } catch (err) {
        if (win) win.close();
        if (err.status === 402) {
          a.closeModal(); a.syncEntitlements();
          if (err.body && err.body.expired) endedNotice(it, err.body.expiredAt);
          else { toast('Payment needed to open this sheet'); a.openCheckout({ worksheet: id }); }
          return;
        }
        if (err.status === 410 || err.code === 'unavailable') { toast('This sheet is being prepared. Please check back soon.'); return; }
        if (err.status === 401) { a.requireSignIn({ do: 'sheet', id }, 'Your sign-in has ended. Sign in again to open ' + it.title + '.', 'signin'); return; }
        /* blocks: the notice (or the blocked page) comes from the handler below */
        if (['access_suspended', 'account_suspended', 'session_blocked', 'email_unverified'].includes(err.code)) { a.closeModal(); return; }
        toast(err.status === 0 ? 'No connection. Please try again.' : err.message);
      }
    };
    /* a card's own buttons: unlock (free) and buy (paid) */
    a.unlock = id => { const it = sheetOf(id); if (!sessionRef.current && !(it && it.price === 0)) { a.showAccountPopup(id); return; } a.openViewer(id); };
    a.buy = async id => {
      if (!sessionRef.current) { a.showAccountPopup(id); return; }
      /* bought already in another tab or on another device? then there is nothing to pay */
      const it = sheetOf(id), fresh = await a.syncEntitlements(), acc = makeAccess(sessionRef.current, fresh, skewRef.current);
      if (it && acc.canOpen(it)) { a.openSheet(id); toast('Already on your account. Tap Open to read it.'); return; }
      a.closeModal(); a.openCheckout({ worksheet: id, again: !!acc.endedOf(id) });
    };
    a.openPortal = kind => { setDrawer(null); a.closeModal(); a.closeCheckout(); navigate('/' + kind); };
    a.closePortal = () => { if (portalCloser.current) portalCloser.current(); else navigate('/' + window.location.hash); };
    /* after a purchase: My Account → My Worksheets */
    a.openMyWorksheets = () => { a.closeModal(); a.closeNotice(); a.openAccount('sheets'); };

    /* The links in the account emails: /?verify=… (Accept & Continue) confirms the email and shows
       sign-in; /?reset=… opens the new-password form. Both land on the sign-in card (chapter 01). */
    a.handleAuthLink = async () => {
      a.handleAccountLink();
      const u = new URL(window.location.href), verify = u.searchParams.get('verify'), reset = u.searchParams.get('reset');
      if (isRecovery()) { a.forgetSession(); stage.goTo(0); a.setAuthView('reset', 'supabase'); return; }
      if (!verify && !reset) return;
      u.searchParams.delete('verify'); u.searchParams.delete('reset');
      history.replaceState(history.state, '', u.pathname + u.search + u.hash);   /* the token leaves the address bar */
      stage.goTo(0);
      if (reset) {
        /* signed in here? sign this browser out first: the reset signs out every device anyway, and the form only shows to guests */
        if (sessionRef.current || authApi.hasTokens()) { await authApi.logout().catch(() => {}); a.forgetSession(); }
        a.setAuthView('reset', reset); return;
      }
      try {
        const r = await authApi.verifyEmail({ token: verify });
        if (sessionRef.current) { toast('Email confirmed. Thank you!'); return; }
        a.setAuthView('signin', null, { email: r.email || '' });
        setTimeout(() => a.setAuthAlert({ type: 'ok', msg: r.alreadyVerified ? 'Your email is already confirmed. Sign in with your password.' : 'Email confirmed! Sign in with the password from your welcome email.' }), 0);
      } catch (err) {
        const email = (err.body && err.body.email) || '';
        a.setAuthView('signin', null, { email });
        const resend = email ? { label: 'Send the email again', run: () => a.resendWelcome(email) } : null;
        setTimeout(() => a.setAuthAlert({ type: 'err', msg: err.message, action: resend }), 0);
      }
    };
    /* The purchase and account emails link to /?account=worksheets (also orders, devices, security):
       open My Account on that tab, once the sign-in kept in this browser is back (or after signing in). */
    a.handleAccountLink = () => {
      const u = new URL(window.location.href), want = u.searchParams.get('account');
      if (!want) return;
      u.searchParams.delete('account');
      history.replaceState(history.state, '', u.pathname + u.search + u.hash);
      const tab = { worksheets: 'sheets', sheets: 'sheets', orders: 'orders', devices: 'devices', security: 'security' }[want] || 'sheets';
      const go = () => { if (sessionRef.current) { a.openAccount(tab); return true; } return false; };
      if (go()) return;
      if (!authApi.hasTokens()) { a.requireSignIn({ do: 'account', tab }, 'Sign in to see My Account.', 'signin'); return; }
      let n = 0;   /* the sign-in kept here is being checked: wait for it a little */
      const t = setInterval(() => {
        if (go()) { clearInterval(t); return; }
        if (++n > 40 || !authApi.hasTokens()) { clearInterval(t); a.requireSignIn({ do: 'account', tab }, 'Sign in to see My Account.', 'signin'); }
      }, 250);
    };
    /* Confirmation resend never changes the password. */
    a.resendWelcome = email => authApi.resendVerification({ email })
      .then(r => a.setAuthAlert({ type: 'ok', msg: (r.message || 'A confirmation link is on its way. Your password has not changed.') }),
        err => a.setAuthAlert({ type: 'err', msg: err.message }));

    /* Back from Stripe or PayPal: ?pay=stripe&order=…&session=…  ·  ?pay=paypal&order=…&token=…  ·  ?pay=cancel&order=… */
    a.handlePaymentReturn = () => {
      const u = new URL(window.location.href), pay = u.searchParams.get('pay'); if (!pay) return;
      const ret = { pay, order: u.searchParams.get('order') || '', session: u.searchParams.get('session') || '', token: u.searchParams.get('token') || '' };
      let pending = null; try { pending = JSON.parse(sessionStorage.getItem('lww_pending_pay') || 'null'); sessionStorage.removeItem('lww_pending_pay'); } catch (_) {}
      history.replaceState(history.state, '', u.pathname + u.hash);   /* clean the address bar */
      a.finishPayment(ret, pending);
    };
    /* Confirm the payment with the server. With no session on this page the sign-in kept in this
       browser is tried first; failing that, the customer signs in and the confirmation carries on. */
    a.finishPayment = async (ret, pending) => {
      const { pay, order: orderId } = ret;
      if (!sessionRef.current) {
        let back = false;
        if (authApi.hasTokens()) {
          try { const r = await authApi.refresh(); back = !!a.adoptUser(r.user || (await authApi.me()).user); } catch (_) { back = false; }
        }
        if (!back) {
          if (pay === 'cancel') { toast('Payment cancelled. Nothing was charged.'); return; }   /* nothing to finish */
          a.requireSignIn({ do: 'pay', ret, pending }, 'Sign in again to finish your payment. You will not be charged twice.', 'signin'); return;
        }
      }
      try {
        if (pay === 'cancel') {
          if (orderId) await payApi.cancel({ order_id: orderId });
          toast('Payment cancelled. Nothing was charged.');
          if (pending && Array.isArray(pending.worksheets) && pending.worksheets.length) a.openCart();
          else if (pending && pending.worksheet) a.openSheet(pending.worksheet);
          return;
        }
        let done;
        if (pay === 'stripe') done = await payApi.stripeConfirm({ order_id: orderId, session_id: ret.session });
        else if (pay === 'paypal') done = await payApi.paypalCapture({ order_id: orderId, token: ret.token });
        else return;
        await a.syncEntitlements();
        a.showPurchasePopup(done, pay === 'stripe' ? 'Stripe' : 'PayPal');
      } catch (err) {
        if (err.status === 401) { a.requireSignIn({ do: 'pay', ret, pending }, 'Sign in again to finish your payment. You will not be charged twice.', 'signin'); return; }
        if (['access_suspended', 'account_suspended', 'session_blocked'].includes(err.code)) return;   /* the handler explains */
        a.showNotice({
          kind: 'payment', title: 'We could not confirm the payment yet',
          text: err.message + (err.status === 0 ? '' : ' Your order number is ' + (orderId || 'in your email') + '.'),
          actions: [{ label: 'See my orders', primary: true, run: () => a.openAccount('orders') }, { label: 'Close' }],
        });
      }
    };
    /* the currency the prices are shown in */
    a.loadCurrency = () => loadCoConfig().then(cfg => { if (setCurrencyFromCountry(cfg, initialAddress().country)) a.rerenderAll(); }).catch(() => {});   /* the same country the checkout starts with */
    /* the security card asks for a fresh status after a block */
    a.refreshSecurity = () => setSecurityNonce(n => n + 1);
    /* the security status says paid sheets are paused (or open again): keep the session copy in step */
    a.noteAccessStatus = st => {
      const s = sessionRef.current; if (!s || !st || s.accessStatus === st) return;
      const next = { ...s, accessStatus: st }; setSession(next); rememberSession(next);
    };
    return a;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, toast, navigate, setSession, setEnt]);

  /* a 401 on any call outside /api/auth/* means the sign-in is gone: the page must not think we are signed in */
  useEffect(() => {
    setUnauthorizedHandler(() => {
      if (!sessionRef.current) return;
      actions.forgetSession();
      actions.showNotice({ kind: 'signed_out', title: 'Please sign in again', text: 'Your sign-in on this device has ended. Sign in again to carry on. Your sheets and orders are safe.', actions: [{ label: 'Sign in', primary: true, run: () => { actions.closeNotice(); actions.closeDrawers(); actions.closeShop(); actions.closeCheckout(); actions.closeModal(); stage.goTo(0); } }, { label: 'Close' }] });
    });
    return () => setUnauthorizedHandler(null);
  }, [actions, stage]);

  /* the server blocked the account, stopped this sign-in, paused paid access or wants the email confirmed */
  useEffect(() => {
    setAuthProblemHandler((code, err) => {
      const had = sessionRef.current;
      if (code === 'account_suspended') {
        markAccountBlocked(had ? had.email : '');
        actions.forgetSession({ keepView: true }); actions.closeNotice();
        navigate('/account-blocked');
        return;
      }
      if (code === 'session_blocked') {
        actions.forgetSession({ keepView: true });
        if (had) {
          actions.showNotice({
            kind: 'session_blocked', title: 'This sign-in was stopped',
            text: err.message || 'This sign-in was stopped by Learn With Why. Sign in again on your own device, or write to us if you think this is a mistake.',
            actions: [{ label: 'Sign in again', primary: true, run: () => { actions.closeNotice(); actions.closeDrawers(); stage.goTo(0); actions.setAuthView('signin'); } }, { label: 'Write to us', mail: true }],
          });
        } else {
          actions.setAuthView('signin');
          setTimeout(() => actions.setAuthAlert({ type: 'err', msg: err.message }), 0);
        }
        return;
      }
      if (code === 'access_suspended') {
        if (had && had.accessStatus !== 'suspended') { const next = { ...had, accessStatus: 'suspended' }; setSession(next); rememberSession(next); }
        actions.refreshSecurity();
        if (checkoutOpenRef.current) return;   /* the checkout says it in its own words */
        actions.showNotice({
          kind: 'access_suspended', title: 'Paid sheets are paused',
          text: 'Paid sheets are paused on this account under our account-sharing rules. Free sheets still open, and you can still sign in and see your orders. If you think this is a mistake, write to us from My Account → Security.',
          actions: [{ label: 'Open My Account', primary: true, run: () => { actions.closeNotice(); actions.openAccount('security'); } }, { label: 'Close' }],
        });
        return;
      }
      if (code === 'email_unverified') {
        if (!had) return;   /* the sign-in form says it in its own words, with "Send the email again" */
        authApi.logout().catch(() => {});
        actions.forgetSession({ keepView: true });
        actions.setAuthView('signin');
        setTimeout(() => actions.setAuthAlert({ type: 'err', msg: err.message }), 0);
      }
    });
    return () => setAuthProblemHandler(null);
  }, [actions, navigate, stage, setSession]);

  /* back on the page after a while: ask the server again what this customer may open */
  useEffect(() => {
    let last = Date.now();
    const onBack = () => {
      if (document.visibilityState === 'hidden' || !sessionRef.current || Date.now() - last < 60e3) return;
      last = Date.now(); actions.syncEntitlements();
    };
    addEventListener('focus', onBack);
    document.addEventListener('visibilitychange', onBack);
    return () => { removeEventListener('focus', onBack); document.removeEventListener('visibilitychange', onBack); };
  }, [actions]);

  /* a visitor's cart changed in another tab */
  useEffect(() => {
    const onStorage = e => { if (e.key === LOCAL_CART || e.key === null) { const ids = readLocalCart(); cartIdsRef.current = ids; _setCartIds(ids); } };
    addEventListener('storage', onStorage);
    return () => removeEventListener('storage', onStorage);
  }, []);

  /* another tab signed in, out, or refreshed the sign-in */
  useEffect(() => onCustomerTokensChange(t => {
    if (isRecovery()) { actions.forgetSession(); actions.setAuthView('reset', 'supabase'); return; }
    if (!t || t.blocked || (!t.accessToken && !t.refreshToken)) {
      if (sessionRef.current) { actions.forgetSession(); if (!signedOutHere()) toast('You signed out in another tab.'); }
      return;
    }
    /* a new sign-in (not just a refresh): ask the server who it is */
    if (!sessionRef.current || t.userId !== sessionRef.current.id) {
      authApi.me().then(r => { if (actions.adoptUser(r.user)) { actions.syncEntitlements(); actions.syncCart(); } }).catch(() => {});
    }
  }), [actions, toast]);

  const portalRef = useRef(null), shopOpenRef = useRef(false), noticeRef = useRef(null);
  checkoutOpenRef.current = checkout.open; portalRef.current = portalKind; shopOpenRef.current = shop.open; noticeRef.current = notice;
  /* Escape closes the top-most thing: notice, modal, drawer, checkout, staff page, store */
  useEffect(() => {
    const onKey = e => {
      if (e.key !== 'Escape' || securityLock.current || askRoleRef.current) return;
      if (noticeRef.current) actions.closeNotice();
      else if (lock.current.modal) actions.closeModal();
      else if (lock.current.drawer) actions.closeDrawers();
      else if (checkoutOpenRef.current) actions.closeCheckout();
      else if (portalRef.current) actions.closePortal();
      else if (shopOpenRef.current) actions.closeShop();
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [actions]);

  /* back on the tab: pick up what changed in Admin → Products meanwhile */
  useEffect(() => {
    const on = () => { if (document.visibilityState === 'visible') actions.reloadCatalogue().catch(() => {}); };
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, [actions]);

  /* THE SERVER IS THE SOURCE OF TRUTH: prices and which sheets have a real PDF come from the
     database (GET /api/worksheets); the sign-in kept in this browser is checked with a refresh
     (POST /api/auth/refresh-token) and the access records loaded, so a stale copy in this browser
     can never open anything. A "no" from the server (401, or 403 for a block) forgets the sign-in;
     no connection keeps what this browser had, and the next call tries again. */
  useEffect(() => {
    let alive = true;
    try { localStorage.removeItem('lww_maybe_in'); } catch (_) {}
    (async () => {
      try { await actions.reloadCatalogue(true); }
      catch (err) { console.warn('catalogue: ' + err.message + ' (showing the built-in prices)'); }
    })();
    (async () => {
      if (isRecovery()) return;
      const had = !!sessionRef.current, t = customerTokens.get();
      if (!t || !t.refreshToken) { if (had) actions.forgetSession({ keepView: true }); return; }
      try {
        const r = await authApi.refresh(); if (!alive) return;
        const u = r.user || (await authApi.me()).user; if (!alive) return;
        if (!actions.adoptUser(u)) return;
        await actions.syncEntitlements();
        actions.syncCart();
        if (!had) actions.setAuthView('signin');
      } catch (err) {
        if (!alive) return;
        if (err.status === 401 || err.status === 403) { if (sessionRef.current) actions.forgetSession({ keepView: true }); }
      }
    })();
    /* prints per sheet for each account type (the account-type question and the sheet window show them) */
    fetchConfig().then(c => { if (alive) setPrintsTable(t => { const n = printsTableOf(c); return JSON.stringify(n) === JSON.stringify(t) ? t : n; }); }).catch(() => {});
    fetchContent().then(r => {
      if (!alive) return;
      const next = homeOf(r);
      write('lww_content', next);
      setContentState(c => (JSON.stringify(c) === JSON.stringify(next) ? c : next));
    }).catch(() => { /* the built-in words (or the last ones) stay */ });
    trackPageView();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* the prints this customer gets per sheet that follows the account type: the server's number, else the table's */
  const type = session ? accountTypeOf(session.role) : null;
  const printsPerSheet = session ? (session.printsPerSheet != null ? session.printsPerSheet : printsTable[(type || { key: 'parent' }).key]) : null;
  const value = {
    stage, access, session, version, content, whys, siteStage, setSiteStage, section, hintHidden,
    drawer, accountTab, modal, notice, shop, checkout, auth, portalKind, portalCloser, coConfig: getCoConfig(), isInputLocked,
    securitySeed, securityNonce, securityLock, toast, cart, askRole, printsTable, accountType: type, printsPerSheet, ...actions,
  };
  return <SiteContext.Provider value={value}>{children}</SiteContext.Provider>;
}

/* one page view per page load (the statistics never get in the way) */
let viewed = false;
function trackPageView() { if (viewed) return; viewed = true; eventsApi.track('page_view'); }
