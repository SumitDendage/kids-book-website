'use client';
/* App-wide state: session, bag, Library, toast, drawers and the auth dialog.
   The commerce rules live here; components only render and call. */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AUTH, CART, LIBRARY, LICENCES, sheetById } from './content';
import { LS_CART, read, write } from './storage';
import { currentSession, onSignedOut, signOut as authSignOut } from './authStore';
import { checkout as placeOrder, consumePrint as consume, isLocked, library, licence, online, protect } from './libraryStore';

const Store = createContext(null);
const M = AUTH.messages;

export function StoreProvider({ children }) {
  const router = useRouter();
  const [session, setSession] = useState(null);
  const [booted, setBooted] = useState(false);
  const [cart, setCart] = useState({});               /* { sheetId: { qty, licence } } */
  const [shelf, setShelf] = useState([]);
  const [drawer, setDrawer] = useState(null);         /* null | 'nav' | 'cart' */
  const [auth, setAuth] = useState(null);             /* null | 'signin' | 'signup' | 'forgot' */
  const [toastState, setToastState] = useState(null);
  const [notice, setNotice] = useState(null);         /* message shown on the sign-in form */
  const toastTimer = useRef(null);
  const pending = useRef(null);                       /* finished after sign in: { type: 'claim', id } | { type: 'checkout' } */

  const toast = useCallback(msg => {
    setToastState({ msg, key: Date.now() });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastState(null), 2200);
  }, []);

  /* ---------- boot: remembered session + saved bag ---------- */
  useEffect(() => {
    setCart(read(LS_CART, {}));
    currentSession().then(s => { setSession(s); setBooted(true); });
    return onSignedOut(() => setSession(null));
  }, []);
  useEffect(() => { if (booted) write(LS_CART, cart); }, [cart, booted]);

  const refreshShelf = useCallback(async s => {
    const who = s === undefined ? session : s;
    if (!who) { setShelf([]); return; }
    try { setShelf(await library(who.email)); } catch (_) { /* keep what we have */ }
  }, [session]);
  useEffect(() => { refreshShelf(session); }, [session, refreshShelf]);

  /* Online, a fresh purchase waits for its DRM copy: poll while any is pending. */
  useEffect(() => {
    if (!online || !session || !shelf.some(e => e.drmStatus === 'pending')) return undefined;
    const t = setInterval(() => refreshShelf(session), 4000);
    return () => clearInterval(t);
  }, [session, shelf, refreshShelf]);

  /* ---------- bag ---------- */
  const cartItems = useMemo(() => Object.keys(cart)
    .map(id => ({ sheet: sheetById(id), qty: cart[id].qty, licence: cart[id].licence }))
    .filter(x => x.sheet), [cart]);
  const cartCount = cartItems.reduce((n, x) => n + x.qty, 0);
  const cartTotal = cartItems.reduce((n, x) => n + x.sheet.price * licence(x.licence).factor * x.qty, 0);

  const addToCart = useCallback((id, lic) => {
    setCart(c => ({ ...c, [id]: { qty: (c[id] ? c[id].qty : 0) + 1, licence: lic || (c[id] ? c[id].licence : LICENCES[0].id) } }));
    toast(CART.addedToast);
  }, [toast]);
  const changeQty = useCallback((id, d) => {
    setCart(c => { const next = { ...c }; const n = (c[id] ? c[id].qty : 0) + d; if (n <= 0) delete next[id]; else next[id] = { ...c[id], qty: n }; return next; });
  }, []);
  const setLicence = useCallback((id, lic) => setCart(c => ({ ...c, [id]: { ...c[id], licence: lic } })), []);

  /* ---------- library ---------- */
  const owned = useMemo(() => new Set(shelf.map(e => e.productId)), [shelf]);
  const activeCount = shelf.filter(e => !isLocked(e)).length;

  const requireSignIn = useCallback((next, message) => {
    pending.current = next;
    setDrawer(null);
    setNotice({ type: 'ok', msg: message, at: Date.now() });
    setAuth('signin');
  }, []);

  const claimFree = useCallback(async (id, s = session) => {
    if (!s) { requireSignIn({ type: 'claim', id }, LIBRARY.signInToClaim); return false; }
    const sheet = sheetById(id);
    try {
      await placeOrder(s.email, [{ productId: id, licence: 'individual', qty: 1 }]);
      await refreshShelf(s);
      toast(sheet.title + LIBRARY.claimToast);
      return true;
    } catch (err) { toast(err.message); return false; }
  }, [session, requireSignIn, refreshShelf, toast]);

  /* Demo checkout: no payment gateway yet; every line becomes `qty` licences. */
  const purchase = useCallback(async (s, order, wholeBag) => {
    try {
      await placeOrder(s.email, order);
      await refreshShelf(s);
      if (wholeBag) setCart({});
      else setCart(c => { const next = { ...c }; order.forEach(l => delete next[l.productId]); return next; });
      setDrawer(null);
      toast(CART.ordered);
      return true;
    } catch (err) { toast(err.message); return false; }
  }, [refreshShelf, toast]);

  /* `lines` = Pay now for one sheet; no lines = the whole bag. */
  const checkout = useCallback(async (lines) => {
    if (!session) { requireSignIn({ type: 'checkout', lines }, CART.signInToCheckout); return false; }
    const order = lines || cartItems.map(({ sheet, qty, licence: lic }) => ({ productId: sheet.id, licence: lic, qty }));
    if (!order.length) return false;
    return purchase(session, order, !lines);
  }, [session, cartItems, requireSignIn, purchase]);

  const consumePrint = useCallback(async id => {
    const updated = await consume(session.email, id);
    refreshShelf(session);
    return updated;
  }, [session, refreshShelf]);

  const retryProtect = useCallback(async id => { await protect([id]); refreshShelf(session); }, [session, refreshShelf]);

  /* ---------- auth ---------- */
  const signedIn = useCallback(async (s, message) => {
    setSession(s);
    setAuth(null);
    const p = pending.current; pending.current = null;
    if (p && p.type === 'claim') { if (await claimFree(p.id, s)) router.push('/library'); return; }
    if (p && p.type === 'checkout') {
      if (p.lines) { if (await purchase(s, p.lines, false)) router.push('/library'); return; }
      setDrawer('cart');
    }
    if (message) toast(message);
  }, [claimFree, purchase, router, toast]);

  const signOut = useCallback(async () => {
    await authSignOut();
    setSession(null);
    setDrawer(null);
    toast(M.signedOut);
  }, [toast]);

  const value = useMemo(() => ({
    booted, session, online,
    cart, cartItems, cartCount, cartTotal, addToCart, changeQty, setLicence, checkout,
    shelf, owned, activeCount, claimFree, consumePrint, retryProtect, refreshShelf,
    drawer, setDrawer, auth, setAuth, notice, setNotice, signedIn, signOut,
    toastState, toast,
  }), [booted, session, cart, cartItems, cartCount, cartTotal, addToCart, changeQty, setLicence, checkout,
    shelf, owned, activeCount, claimFree, consumePrint, retryProtect, refreshShelf, drawer, auth, notice, signedIn, signOut, toastState, toast]);

  return <Store.Provider value={value}>{children}</Store.Provider>;
}

export const useStore = () => useContext(Store);
