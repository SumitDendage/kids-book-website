import { useCallback, useEffect, useRef, useState } from 'react';
import { useSite } from '../../context/SiteContext.jsx';
import { eventsApi, payApi } from '../../services/api.js';
import { write } from '../../services/storage.js';
import { fmtCur, money, setCurrencyFromCountry } from '../../services/currency.js';
import { addressForQuote, initialAddress, loadCoConfig, loadRazorpay, monthsText, payErrorText, serverPlans, tidyAddress } from '../../services/checkout.js';
import { PAY_VIA, RZP_DISPLAY, PAY } from '../../data/checkout.js';
import { classById, hoursOf, spanText } from '../../data/content.js';
import { sheetOf } from '../../data/catalogue.js';
import { flagOf, shortClass, dateTimeTz } from '../../utils/format.js';
import { PAY_MARK } from './PayMarks.jsx';

/* The payment page. Nothing is priced here: the server prices the address and coupon and keeps
   the quote (POST /api/quote → quoteId); /api/pay/order turns that stored quote into an order;
   Razorpay (or a hosted Stripe / PayPal page) takes the payment; the server checks it and opens
   the purchase. A gateway the server has not connected is shown as coming soon. */
const keep = { code: '', touched: {}, via: 'qr' };   /* like the original page: the coupon, touched fields and way to pay survive closing the page */
/* the stored quote ran out or no longer matches: price it again and ask for one more tap on Pay */
const REQUOTE = ['quote_expired', 'quote_invalid', 'quote_mismatch', 'price_changed'];
const REFRESHED = 'We refreshed your price because the old one had run out. Please check the total and press Pay again.';

/* "Opens as soon as your payment is verified and stays open for 24 hours, until 18 Oct 2026, 1:16 pm IST if you pay now." */
function accessNoteOf(q, tz) {
  const its = q && Array.isArray(q.items) ? q.items : [];
  const it = its[0] || null;
  if (its.length > 1) {
    /* a cart: one sentence when every sheet stays open as long, else each line says its own time */
    const hours = Array.from(new Set(its.map(x => hoursOf(x) || hoursOf(q))));
    if (hours.length === 1 && hours[0] && it.endsAt) return 'Every sheet opens as soon as your payment is verified and stays open for ' + spanText(hours[0]) + ', until ' + dateTimeTz(it.endsAt, tz) + ' if you pay now. Then it is removed from your account.';
    return 'Every sheet opens as soon as your payment is verified. How long each one stays open is shown beside it.';
  }
  if (!it || !it.endsAt) return q && q.accessText ? q.accessText : '';
  const until = dateTimeTz(it.endsAt, tz);
  if (it.kind === 'worksheet') return 'Opens as soon as your payment is verified and stays open for ' + spanText(hoursOf(it) || hoursOf(q)) + ', until ' + until + ' if you pay now. Then it is removed from your account.';
  const span = it.months + (it.months === 1 ? ' month' : ' months');
  if (/^Starts /.test(it.expiry || q.accessText || '') && it.startsAt) return 'Starts ' + dateTimeTz(it.startsAt, tz) + ', when your current plan ends, and runs for ' + span + ', until ' + until + '.';
  return 'Every ' + (q.className || 'class') + ' sheet opens as soon as your payment is verified and stays open for ' + span + ', until ' + until + ' if you pay now.';
}

export default function Checkout() {
  const site = useSite();
  const { checkout, closeCheckout, access, toast, syncEntitlements, showPurchasePopup, rerenderAll } = site;
  const tz = (access.session && access.session.timeZone) || undefined;
  const [status, setStatus] = useState('loading');     /* loading | ready | error */
  const [loadError, setLoadError] = useState('');
  const [loadTry, setLoadTry] = useState(0);
  const [config, setConfig] = useState(null);
  const [addr, setAddr] = useState(initialAddress);
  const [touched, setTouchedState] = useState(keep.touched);
  const [code, setCodeState] = useState(keep.code);
  const [couponInput, setCouponInput] = useState(keep.code);
  const [payVia, setPayViaState] = useState(keep.via);
  const [quote, setQuote] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [bump, setBump] = useState(0);
  const lastTotal = useRef(null), timer = useRef(0), seq = useRef(0), shopRef = useRef(null);
  const item = checkout.item ? sheetOf(checkout.item) : null;
  const itemId = checkout.item;
  /* the cart: several sheets in one order (openCheckout({ worksheets })). A sheet the server says cannot be
     bought (already on the account, free now, not for sale) can be taken out here and the price asked again. */
  const [removed, setRemoved] = useState([]);
  const [problem, setProblem] = useState(null);   /* { id, msg } */
  const multi = !itemId && !checkout.cls && Array.isArray(checkout.items) && checkout.items.length ? checkout.items.filter(id => !removed.includes(id)) : null;
  const listRef = useRef(multi); listRef.current = multi;
  /* a class plan instead of one PDF: the plan is picked on this page */
  const subCls = !itemId && checkout.cls ? checkout.cls : null;
  const running = subCls ? access.activeSub(subCls) : null;   /* a renewal starts when this plan ends */
  const [planPick, setPlanPick] = useState(checkout.plan || 'm3');
  /* the plans the server sells in this country, with the server's prices */
  const plans = serverPlans(config, addr.country, subCls);
  const plan = plans.some(x => x.id === planPick) ? planPick : (plans.some(x => x.id === 'm6') ? 'm6' : (plans[0] ? plans[0].id : planPick));
  const planRef = useRef(plan); planRef.current = plan;

  const setTouched = t => { keep.touched = t; setTouchedState(t); };
  const setCode = c => { keep.code = c; setCodeState(c); };
  const setPayVia = v => { keep.via = v; setPayViaState(v); };

  /* ask the server for a fresh quote (debounced while typing) */
  const requestQuote = useCallback((now, a = addr, c = code, p = planRef.current) => {
    clearTimeout(timer.current);
    const run = async () => {
      const mine = ++seq.current;
      setBusy(true); setError('');
      try {
        const address = addressForQuote(a);
        const list = listRef.current;
        const q = await payApi.quote(subCls ? { cls: subCls, plan: p, coupon: c, address } : list ? { worksheets: list, coupon: c, address } : { worksheet: itemId, coupon: c, address });
        if (mine !== seq.current) return;
        setProblem(null);
        if (lastTotal.current !== null && lastTotal.current !== q.total) setBump(b => b + 1);
        lastTotal.current = q.total;
        setQuote(q);
      } catch (err) {
        if (mine === seq.current) {
          const sp = sheetProblem(err);
          setQuote(null); setProblem(sp); setError(sp ? '' : payErrorText(err, 'quote'));
        }
      }
      if (mine === seq.current) setBusy(false);
    };
    if (now) run(); else timer.current = setTimeout(run, 350);
  }, [addr, code, itemId, subCls]);

  /* a cart line the server refused: which sheet, and why, in plain words */
  function sheetProblem(err) {
    const id = err && err.body && typeof err.body.worksheet === 'string' ? err.body.worksheet : null;
    if (!listRef.current || !id || !listRef.current.includes(id)) return null;
    const t = (sheetOf(id) || {}).title || 'One of the sheets';
    const why = err.code === 'already_owned' ? t + ' is already on your account.'
      : err.code === 'free' || err.code === 'is_free' ? t + ' is free now, so there is nothing to pay for it.'
        : err.code === 'unknown_item' ? t + ' is not in the shop any more.'
          : t + ' cannot be bought right now.';
    return { id, msg: why + ' Take it out of this order to carry on.' };
  }
  /* take one sheet out of this order (and out of the cart) and ask for the price again */
  const dropSheet = id => {
    const next = (listRef.current || []).filter(x => x !== id);
    setProblem(null); setRemoved(r => r.concat(id)); listRef.current = next;
    site.removeFromCart(id);
    if (!next.length) { closeCheckout(); site.openCart(); return; }
    requestQuote(true);
  };

  /* opening the page counts as a checkout start (visit statistics on the server) */
  useEffect(() => {
    if (!checkout.open) return;
    eventsApi.track('checkout_start', itemId ? { productId: itemId, meta: { kind: 'worksheet', again: !!checkout.again } }
      : multi ? { meta: { kind: 'cart', count: multi.length } }
        : { meta: { kind: 'class', cls: checkout.cls || null, plan: checkout.plan || null, again: !!checkout.again } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkout.nonce]);

  /* opening the page: the server's countries, plans and gateways, then a fresh quote */
  useEffect(() => {
    if (!checkout.open) return;
    if (shopRef.current) shopRef.current.scrollTop = 0;
    if (checkout.plan) setPlanPick(checkout.plan);
    setQuote(null); setError(''); setNotice(''); setProblem(null); lastTotal.current = null; setStatus('loading');
    setRemoved([]); listRef.current = !checkout.item && !checkout.cls && Array.isArray(checkout.items) && checkout.items.length ? checkout.items.slice() : null;
    let alive = true;
    loadCoConfig().then(cfg => {
      if (!alive) return;
      let a = initialAddress();
      if (!cfg.countries.some(c => c.code === a.country)) a = tidyAddress({ ...a, country: 'OTHER' });
      setConfig(cfg); setAddr(a);
      if (setCurrencyFromCountry(cfg, a.country)) rerenderAll();
      const ps = serverPlans(cfg, a.country, subCls), p0 = checkout.plan || 'm3';
      setStatus('ready');
      requestQuote(false, a, keep.code, ps.some(x => x.id === p0) ? p0 : (ps.some(x => x.id === 'm6') ? 'm6' : (ps[0] ? ps[0].id : p0)));
    }).catch(err => { if (alive) { setLoadError(err.message || 'We could not load the secure checkout just now.'); setStatus('error'); } });
    return () => { alive = false; clearTimeout(timer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkout.nonce, loadTry]);

  const C = (config && (config.countries.find(c => c.code === addr.country) || config.countries[config.countries.length - 1])) || null;
  const india = C ? C.code === 'IN' : true;
  const gw = (config && config.gateways) || {};
  /* each way to pay switches on the moment the server has its gateway connected (Razorpay for card / QR / UPI / wallet); until then it is shown as coming soon */
  const live = m => !!gw[m.gateway || 'razorpay'];
  const ways = PAY_VIA.filter(m => india || !m.india);
  const canPay = ways.some(live);
  const via = ways.some(m => m.id === payVia && live(m)) ? payVia : ((ways.find(live) || {}).id || (india ? 'qr' : 'card'));
  useEffect(() => { if (via !== payVia) setPayVia(via); });
  const viaOf = PAY_VIA.find(m => m.id === via) || PAY_VIA[0];
  /* a method is offered when the country allows it AND the server has that gateway connected */
  const allowed = (C ? C.methods : PAY).filter(id => gw[id] !== false);
  const payMethod = viaOf.gateway || (allowed.includes('razorpay') ? 'razorpay' : allowed[0] || 'razorpay');

  /* ---------- the address form ---------- */
  const change = (k, value) => {
    const t = { ...touched, [k]: true };
    if (k === 'country') {
      const a = { ...addr, country: value, state: '', postal: '' };
      setAddr(a); setTouched({ country: true }); write('lww_address', a);
      if (setCurrencyFromCountry(config, value)) rerenderAll();
      requestQuote(true, a); return;
    }
    const a = { ...addr, [k]: value }; setAddr(a); setTouched(t); write('lww_address', a);
    requestQuote(k === 'state', a);
  };
  const blur = k => () => setTouched({ ...touched, [k]: true });
  const errs = (quote && quote.errors) || {};
  const errOf = k => (touched[k] && errs[k] ? errs[k] : '');
  /* a problem with something that is not on the form (the total, say) is shown in the summary */
  const onForm = ['country', 'line1', 'city'].concat(india ? ['state', 'postal'] : []);
  const otherErrs = Object.keys(errs).filter(k => !onForm.includes(k)).map(k => errs[k]);
  const fl = (k, input, label, extra) => (
    <div className={'fl' + (errOf(k) ? ' bad' : '')}>{input}<label htmlFor={'co-' + k} id={k === 'postal' ? 'coPostalLabel' : undefined}>{label}</label>{extra}<div className="err" data-err={k}>{errOf(k)}</div></div>
  );
  const text = (k, props) => <input id={'co-' + k} name={k} value={addr[k] || ''} placeholder=" " onChange={e => change(k, e.target.value)} onBlur={blur(k)} {...props} />;

  /* ---------- 1. /api/pay/order  2. Razorpay Checkout  3. /api/pay/verify → the purchase opens ---------- */
  async function placeOrder() {
    if (!quote || !quote.valid || !quote.quoteId || busy || !canPay) return;
    if (!access.session) return;
    setBusy(true); setError(''); setNotice('');
    const q = quote, method = 'Razorpay · ' + viaOf.label;
    let orderId = null, step = 'order';
    try {
      const out = await payApi.order({ quoteId: q.quoteId, method: payMethod });
      const o = out.order || {}, g = out.gateway || {};
      orderId = o.id || out.orderId || null;
      write('lww_address', addr);
      if (g.provider === 'stripe' || g.provider === 'paypal') {
        /* hosted pages: remember the order, hand over to the gateway; the site finishes it on the way back */
        try { sessionStorage.setItem('lww_pending_pay', JSON.stringify({ order: orderId, provider: g.provider, total: q.total, currency: q.currency, worksheet: itemId, worksheets: multi || undefined, cls: subCls, plan: subCls ? plan : null, via })); } catch (_) {}
        location.href = g.url; return;
      }
      if (g.provider !== 'razorpay') throw Object.assign(new Error('Online payment is not available right now.'), { code: 'payments_unavailable' });
      await loadRazorpay();
      step = 'pay';
      const done = await new Promise((res, rej) => {
        let paid = false;
        /* only the PUBLIC key id (g.key) comes from the server; the secret never leaves it */
        const rz = new window.Razorpay({
          key: g.key, amount: g.amount, currency: g.currency, order_id: g.razorpay_order_id, name: g.name, description: g.description, prefill: g.prefill, theme: g.theme, notes: { order: orderId, via },
          config: { display: RZP_DISPLAY[via] || RZP_DISPLAY.card },   /* open straight on the chosen way to pay */
          handler: resp => {
            paid = true; step = 'verify';
            payApi.verify({ order_id: orderId, razorpay_order_id: resp.razorpay_order_id, razorpay_payment_id: resp.razorpay_payment_id, razorpay_signature: resp.razorpay_signature }).then(res, rej);
          },
          modal: { ondismiss: () => { if (!paid) rej(Object.assign(new Error('Payment cancelled. Nothing was charged.'), { cancelled: true })); } },
        });
        rz.open();
      });
      await syncEntitlements();
      setCode(''); setCouponInput(''); setQuote(null); setBusy(false);
      closeCheckout();
      /* { ok, status, order, entitlement, entitlements } + what was paid; SiteContext shapes it for the popup */
      showPurchasePopup({ ...done, total: fmtCur(q.total, q.currency) }, method);
    } catch (err) {
      setBusy(false);
      /* the Razorpay window was closed before paying: the order is cancelled on the server too */
      if (err.cancelled) {
        if (orderId) payApi.cancel({ order_id: orderId }).catch(() => {});
        toast('Payment cancelled. Nothing was charged.');
        requestQuote(true);
        return;
      }
      /* one sheet of the cart is already on the account, or cannot be sold any more: say which, offer to take it out */
      if (multi && sheetProblem(err)) {
        if (err.code === 'already_owned') await syncEntitlements();
        setProblem(sheetProblem(err)); setQuote(null);
        return;
      }
      /* already on the account (bought in another tab or device): no second payment, show the sheet instead */
      if (err.status === 409 && err.code === 'already_owned') {
        await syncEntitlements(); closeCheckout();
        toast('This sheet is already on your account. Open it from My Account → My Worksheets.');
        if (itemId) site.openSheet(itemId);
        return;
      }
      if (REQUOTE.includes(err.code)) { setNotice(err.code === 'price_changed' ? 'The price changed a moment ago. We refreshed it, so please check the total and press Pay again.' : REFRESHED); requestQuote(true); return; }
      if (step === 'verify') syncEntitlements();
      setError(payErrorText(err, step));
      if (step !== 'verify') requestQuote(true);
    }
  }

  /* picking a plan asks again with that plan */
  const pickPlan = id => { setPlanPick(id); requestQuote(true, addr, code, id); };
  const prevPlan = useRef(plan);
  useEffect(() => { if (subCls && prevPlan.current !== plan) { prevPlan.current = plan; requestQuote(true, addr, code, plan); } });

  /* ---------- the order summary ---------- */
  const cls = item ? classById(item.cls) : subCls ? classById(subCls) : null;
  const q = quote, addrOk = !!(q && q.valid);
  const planNow = plans.find(x => x.id === plan);
  const hours = hoursOf(q) || hoursOf(item) || hoursOf(config);
  const off = q && q.discountInr ? (q.currency === 'INR' ? '₹' + q.discountInr : fmtCur(Math.round(q.discountInr * q.rate * 100) / 100, q.currency)) : '';
  const accessNote = q ? accessNoteOf(q, tz) : '';
  const summary = (
    <aside className="co-summary" id="coSummary" aria-live="polite">
      <div className="sum-head"><p className="eyebrow">Order summary</p>{q && <span className={'region-chip' + (q.region === 'IN' ? ' in' : '')}>{q.region === 'IN' ? '🇮🇳 India · INR' : '🌍 ' + q.countryName + ' · ' + q.currency}</span>}</div>
      {multi
        ? <div className="sum-items" id="coItems"><p className="sum-count">{multi.length} sheets in one order</p>{multi.map(id => {
          const s = sheetOf(id) || { title: id }, c = s.cls ? classById(s.cls) : null, qi = q && Array.isArray(q.items) ? q.items.find(x => x.productId === id) : null;
          return <div key={id} className="sum-item" data-sheet={id}><div className="sum-thumb">{s.glyph || s.az || 'PDF'}</div><div><b>{s.title}</b><small>{c ? c.label + ' · ' : ''}open for {spanText(hoursOf(qi) || hoursOf(s) || hours)}{qi && qi.unitPriceInr ? ' · ₹' + qi.unitPriceInr : ''}</small></div></div>;
        })}</div>
        : item
        ? <div className="sum-item"><div className="sum-thumb">{item.glyph || 'PDF'}</div><div><b>{item.title}</b><small>{cls.label} · one PDF · open for {spanText(hours)}{checkout.again ? ' · buying access again' : ''}</small></div></div>
        : cls && <div className="sum-item"><div className="sum-thumb">{shortClass(cls.label)}</div><div><b>{cls.label} plan</b><small>{planNow ? planNow.label : ''} · every sheet in the class{running && running.end ? ' · starts ' + dateTimeTz(running.end, tz) + ', when your current plan ends' : ''}</small></div></div>}
      <div className={'co-lines' + (busy ? ' busy' : '')}>
        {q ? q.lines.map((l, i) => <div key={i} className="co-line"><span>{l.label}<small>{l.note || ''}</small></span><b>{fmtCur(l.amount, q.currency)}</b></div>)
          : problem ? <div className="alert err" id="coProblem" role="alert">{problem.msg} <button type="button" className="link" onClick={() => dropSheet(problem.id)}>Take it out</button></div>
          : error ? <p className="alert err">{error}</p> : <><div className="sk-line" /><div className="sk-line" /><div className="sk-line short" /></>}
      </div>
      {q && <div className={'sum-total' + (bump ? ' bump' : '')}><span>Total<small>incl. tax &amp; fees</small></span><strong key={bump}>{fmtCur(q.total, q.currency)}</strong></div>}
      {q && accessNote && <p className="co-note" id="coAccess" style={{ textAlign: 'center' }}>{accessNote}</p>}
      {q && q.currency !== 'INR' && <p className="co-note">≈ ₹{Math.round(q.totalInr || q.total / q.rate)} at 1 INR = {q.rate} {q.currency}. You are charged in {q.currency}.</p>}
      {q && q.coupon && <p className="co-note ok">Coupon {q.coupon} applied, {off} off.</p>}
      {q && !q.valid && otherErrs.length > 0 && <p className="alert err">{otherErrs.join(' ')}</p>}
      {notice && <p className="alert ok" id="coNotice">{notice}</p>}
      {q && error && <p className="alert err">{error}</p>}
      <button type="button" className="btn btn-pay" id="payNow" disabled={!q || !q.valid || !q.quoteId || busy || !canPay} onClick={placeOrder}>{!canPay
        ? <><span>Payment coming soon</span><small>online payment is not available yet</small></>
        : <><span>{q && q.valid ? 'Pay ' + fmtCur(q.total, q.currency) : 'Complete your address'}</span><small>{q && q.valid ? 'by ' + viaOf.label + ' →' : 'to unlock payment'}</small></>}</button>
      <ul className="trust"><li>🔒 Priced on our server</li><li>🛡️ No card details stored here</li></ul>
      {q && q.quoteId && <p className="co-note" style={{ textAlign: 'center' }}>This price is held until {dateTimeTz(q.expiresAt || q.exp, tz)}.</p>}
    </aside>
  );

  let body;
  if (status === 'loading') body = <section className="panel"><p className="cart-empty">Loading secure checkout…</p></section>;
  else if (status === 'error') body = <section className="panel"><p className="alert err">{loadError}</p><button type="button" className="btn btn-ghost" onClick={() => setLoadTry(n => n + 1)}>Try again</button></section>;
  else {
    const stateField = C.states
      ? <select id="co-state" name="state" className={addr.state ? 'filled' : undefined} value={addr.state || ''} onChange={e => change('state', e.target.value)} onBlur={blur('state')}>{['', ...C.states].map(x => <option key={x} value={x}>{x}</option>)}</select>
      : text('state', { autoComplete: 'address-level1' });
    const postal = C.postal || {};
    body = (
      <>
        <div className="co-left">
          {subCls && <section className="panel co-card co-plans" aria-labelledby="coPlanHead">
            <header className="co-card-head"><span className="co-num">★</span><div><h3 id="coPlanHead">Choose your plan</h3><p>{(C.code === 'IN' ? 'India: ' : '') + monthsText(plans)} · every sheet in {cls.label}</p></div></header>
            <div className="method-grid plan-grid" role="radiogroup" aria-label="Class plan">
              {plans.map(x => <label key={x.id} className={'method' + (x.id === plan ? ' on' : '')}><input type="radio" name="plan" value={x.id} checked={x.id === plan} onChange={() => pickPlan(x.id)} /><span className="txt"><b>{x.label}</b><small>{money(x.price)}{x.note ? ' · ' + x.note : ''}</small></span><span className="ring" /></label>)}
            </div>
          </section>}
          <section className={'panel co-card' + (addrOk ? ' done' : '')} data-step="1" aria-labelledby="coStep1">
            <header className="co-card-head"><span className="co-num">1</span><div><h3 id="coStep1">Billing address</h3><p id="coRegionLine">{C.code === 'IN'
              ? <><span className="region-chip in">🇮🇳 India</span> prices in ₹ INR with GST · state and 6-digit PIN code</>
              : <><span className="region-chip">🌍 {C.name}</span> priced in <b>{C.currency}</b>{C.taxPct ? ' with ' + C.tax + (/%/.test(C.tax) ? '' : ' ' + C.taxPct + '%') : ', no tax collected'} · street and city only</>}</p></div></header>
            {fl('country', <select id="co-country" name="country" className="filled" value={C.code} onChange={e => change('country', e.target.value)} onBlur={blur('country')}>{config.countries.map(x => <option key={x.code} value={x.code}>{flagOf(x.code)}  {x.name}</option>)}</select>, 'Country')}
            {fl('line1', text('line1', { autoComplete: 'street-address' }), 'Address (house / flat, street, area)')}
            <div className={'fl-grid' + (C.code === 'IN' ? '' : ' intl')}>
              {fl('city', text('city', { autoComplete: 'address-level2' }), 'City')}
              {C.code === 'IN' && fl('state', stateField, C.state)}
              {C.code === 'IN' && fl('postal', text('postal', { inputMode: 'numeric', autoComplete: 'postal-code', maxLength: 6 }), postal.label || 'PIN code', <small className="fhint">{postal.hint || '6 digits, e.g. 411001'}</small>)}
            </div>
          </section>
          <section className="panel co-card" data-step="2" aria-labelledby="coStep2">
            <header className="co-card-head"><span className="co-num">2</span><div><h3 id="coStep2">Payment</h3><p>Choose how you would like to pay.</p></div></header>
            <div className="method-grid" id="coMethods" role="radiogroup" aria-label="Way to pay">
              {ways.map(m => { const on = live(m); return (
                <label key={m.id} className={'method' + (m.id === via ? ' on' : '') + (on ? '' : ' off')}><input type="radio" name="pay" value={m.id} checked={m.id === via} disabled={!on} onChange={() => setPayVia(m.id)} /><span className="mark">{PAY_MARK[m.id]}</span><span className="txt"><b>{m.label}</b><small>{on ? m.note : 'Coming soon'}</small></span><span className="ring" /></label>
              ); })}
              <p className="pay-secure">{PAY_MARK.razorpay}<span><b>100% secure payment</b> — powered by Razorpay, PCI-DSS certified and 256-bit encrypted. Your card and UPI details go straight to the bank; we never see or store them.</span></p>
            </div>
            <div className="coupon-row"><div className="fl"><input id="coCoupon" type="text" value={couponInput} placeholder=" " autoComplete="off" onChange={e => setCouponInput(e.target.value)} /><label htmlFor="coCoupon">Coupon code</label></div><button type="button" className="btn btn-ghost" id="coApply" onClick={() => { const c = couponInput.trim().toUpperCase(); setCode(c); requestQuote(true, addr, c); }}>Apply</button></div>
            <div className={'err' + (code && q && q.coupon ? ' ok' : '')} id="coCouponMsg" style={{ marginTop: '-6px' }}>{code && q ? (q.coupon ? 'Coupon ' + q.coupon + ' applied.' : (q.couponError || '')) : ''}</div>
          </section>
        </div>
        {summary}
      </>
    );
  }

  return (
    <div className={'shop' + (checkout.open ? ' open' : '')} id="checkout" aria-hidden={checkout.open ? 'false' : 'true'} ref={shopRef} role="dialog" aria-label="Secure checkout">
      <div className="shop-shade" style={{ background: '#071018' }} />
      <header className="shop-bar">
        <div><p className="eyebrow">Secure checkout</p><ol className="stepper" id="coStepper"><li className={addrOk ? 'done' : 'on'}><i>1</i>Address</li><li className={addrOk ? 'on' : undefined}><i>2</i>Payment</li></ol></div>
        <div className="shop-actions"><span className="co-lock">🔒 256-bit encrypted</span><button type="button" className="icon-btn" id="checkoutBack" aria-label="Back" onClick={closeCheckout}>✕</button></div>
      </header>
      <div className="checkout-body" id="checkoutBody">{checkout.item || subCls || multi || status !== 'ready' ? body : null}</div>
    </div>
  );
}
