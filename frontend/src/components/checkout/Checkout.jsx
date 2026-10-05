import { useCallback, useEffect, useRef, useState } from 'react';
import { useSite } from '../../context/SiteContext.jsx';
import { payApi } from '../../services/api.js';
import { write, pushLog, logEvent } from '../../services/storage.js';
import { fmtCur, setCurrencyFromCountry } from '../../services/currency.js';
import { initialAddress, loadCoConfig, loadRazorpay } from '../../services/checkout.js';
import { PAY_VIA, RZP_DISPLAY, PAY } from '../../data/checkout.js';
import { classById, planOf, plansFor } from '../../data/content.js';
import { sheetOf } from '../../data/catalogue.js';
import { flagOf, shortClass, dateOf } from '../../utils/format.js';
import { PAY_MARK } from './PayMarks.jsx';

/* The payment page. Nothing is priced here: the server returns a signed quote for
   the address and coupon; /api/pay/order turns it into an order; Razorpay (or a
   hosted Stripe / PayPal page) takes the payment; the server verifies it and grants
   the entitlement. A gateway the server has not connected is shown as coming soon. */
const keep = { code: '', touched: {}, via: 'qr' };   /* like the original page: the coupon, touched fields and way to pay survive closing the page */

export default function Checkout() {
  const site = useSite();
  const { checkout, closeCheckout, access, toast, syncEntitlements, showPurchasePopup, rerenderAll } = site;
  const [status, setStatus] = useState('loading');     /* loading | ready | error */
  const [loadError, setLoadError] = useState('');
  const [config, setConfig] = useState(null);
  const [addr, setAddr] = useState(initialAddress);
  const [touched, setTouchedState] = useState(keep.touched);
  const [code, setCodeState] = useState(keep.code);
  const [couponInput, setCouponInput] = useState(keep.code);
  const [payVia, setPayViaState] = useState(keep.via);
  const [quote, setQuote] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [bump, setBump] = useState(0);
  const lastTotal = useRef(null), timer = useRef(0), seq = useRef(0), shopRef = useRef(null);
  const item = checkout.item ? sheetOf(checkout.item) : null;
  const itemId = checkout.item;
  /* a class subscription instead of one PDF: the plan is picked on this page */
  const subCls = !itemId && checkout.cls ? checkout.cls : null;
  const running = subCls ? access.activeSub(subCls) : null;   /* a renewal starts when this plan ends */
  const [planPick, setPlanPick] = useState(checkout.plan || 'm3');
  const plans = plansFor(addr.country);
  const plan = plans.some(x => x.id === planPick) ? planPick : (plans.some(x => x.id === 'm6') ? 'm6' : plans[0].id);
  const planRef = useRef(plan); planRef.current = plan;

  const setTouched = t => { keep.touched = t; setTouchedState(t); };
  const setCode = c => { keep.code = c; setCodeState(c); };
  const setPayVia = v => { keep.via = v; setPayViaState(v); };

  /* ask the server for a fresh signed quote (debounced while typing) */
  const requestQuote = useCallback((now, a = addr, c = code, p = planRef.current) => {
    clearTimeout(timer.current);
    const run = async () => {
      const mine = ++seq.current;
      setBusy(true); setError('');
      try {
        const q = await payApi.quote(subCls ? { cls: subCls, plan: p, coupon: c, address: a } : { worksheet: itemId, coupon: c, address: a });
        if (mine !== seq.current) return;
        if (lastTotal.current !== null && lastTotal.current !== q.total) setBump(b => b + 1);
        lastTotal.current = q.total;
        setQuote(q);
      } catch (err) { if (mine === seq.current) { setQuote(null); setError(err.message); } }
      if (mine === seq.current) setBusy(false);
    };
    if (now) run(); else timer.current = setTimeout(run, 350);
  }, [addr, code, itemId, subCls]);

  /* opening the page: fresh quote, config loaded once */
  useEffect(() => {
    if (!checkout.open) return;
    if (shopRef.current) shopRef.current.scrollTop = 0;
    if (checkout.plan) setPlanPick(checkout.plan);
    setQuote(null); lastTotal.current = null; setStatus('loading');
    let alive = true;
    loadCoConfig().then(cfg => {
      if (!alive) return;
      setConfig(cfg); const a = initialAddress(); setAddr(a);
      if (setCurrencyFromCountry(cfg, a.country)) rerenderAll();
      const ps = plansFor(a.country), p0 = checkout.plan || 'm3';
      setStatus('ready'); requestQuote(false, a, keep.code, ps.some(x => x.id === p0) ? p0 : 'm6');
    }).catch(err => { if (alive) { setLoadError(err.message); setStatus('error'); } });
    return () => { alive = false; clearTimeout(timer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkout.nonce]);

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
  const fl = (k, input, label, extra) => (
    <div className={'fl' + (errOf(k) ? ' bad' : '')}>{input}<label htmlFor={'co-' + k} id={k === 'postal' ? 'coPostalLabel' : undefined}>{label}</label>{extra}<div className="err" data-err={k}>{errOf(k)}</div></div>
  );
  const text = (k, props) => <input id={'co-' + k} name={k} value={addr[k] || ''} placeholder=" " onChange={e => change(k, e.target.value)} onBlur={blur(k)} {...props} />;

  /* ---------- 1. /api/pay/order  2. Razorpay Checkout  3. /api/pay/verify → entitlement ---------- */
  async function placeOrder() {
    if (!quote || !quote.valid || busy || !canPay) return;
    const session = access.session; if (!session) return;
    setBusy(true); setError('');
    const q = quote, method = 'Razorpay · ' + viaOf.label;
    try {
      const out = await payApi.order({ quote: q, method: payMethod, via });
      const o = out.order, g = out.gateway;
      write('lww_address', addr);
      pushLog('lww_orders', { id: o.id, at: o.at, email: session.email, name: session.name, cls: o.cls, plan: o.plan, worksheet: o.worksheet, amount: o.totalInr, currency: q.currency, total: q.total, method, coupon: q.coupon, status: 'created', address: q.address }, 1000);
      if (g.provider === 'stripe' || g.provider === 'paypal') {
        /* hosted pages: remember the order, hand over to the gateway; the site finishes it on the way back */
        try { sessionStorage.setItem('lww_pending_pay', JSON.stringify({ order: o.id, provider: g.provider, total: q.total, currency: q.currency, worksheet: itemId, via })); } catch (_) {}
        location.href = g.url; return;
      }
      if (g.provider !== 'razorpay') throw new Error('Online payment is not available right now — nothing was charged.');
      await loadRazorpay();
      const done = await new Promise((res, rej) => {
        /* only the PUBLIC key id (g.key) comes from the server; the secret never leaves it */
        const rz = new window.Razorpay({
          key: g.key, amount: g.amount, currency: g.currency, order_id: g.razorpay_order_id, name: g.name, description: g.description, prefill: g.prefill, theme: g.theme, notes: { order: o.id, via },
          config: { display: RZP_DISPLAY[via] || RZP_DISPLAY.card },   /* open straight on the chosen way to pay */
          handler: resp => payApi.verify({ order_id: o.id, razorpay_order_id: resp.razorpay_order_id, razorpay_payment_id: resp.razorpay_payment_id, razorpay_signature: resp.razorpay_signature }).then(res, rej),
          modal: { ondismiss: () => rej(Object.assign(new Error('Payment cancelled — nothing was charged.'), { cancelled: true })) },
        });
        rz.on('payment.failed', r => { pushLog('lww_payments', { at: Date.now(), order: o.id, gateway: 'Razorpay', status: 'failed', reason: r.error && r.error.description }, 400); });
        rz.open();
      });
      const paid = done.order;
      pushLog('lww_orders', { id: paid.id, at: paid.at, email: session.email, name: session.name, cls: paid.cls, plan: paid.plan, worksheet: paid.worksheet, amount: paid.totalInr, currency: q.currency, total: q.total, method, coupon: q.coupon, status: 'paid', address: q.address }, 1000);
      pushLog('lww_payments', { at: paid.paidAt || Date.now(), order: paid.id, gateway: 'Razorpay', payment: paid.paymentId, amount: q.total, currency: q.currency, status: 'captured' }, 400);
      logEvent(q.kind === 'worksheet' ? 'buy' : 'subscribe', { order: paid.id, cls: paid.cls, plan: paid.plan, worksheet: paid.worksheet, amount: paid.totalInr, currency: q.currency });
      await syncEntitlements();
      setCode(''); setCouponInput(''); setQuote(null); setBusy(false);
      closeCheckout();
      showPurchasePopup({ order: paid.id, cls: paid.cls, plan: paid.plan, worksheet: itemId, total: fmtCur(q.total, q.currency), method });
    } catch (err) {
      setBusy(false);
      /* already on the account (bought in another tab or device): no second payment — show the sheet instead */
      if (err.status === 409 && err.body && err.body.code === 'already_owned') { await syncEntitlements(); closeCheckout(); toast(err.message); site.openSheet(itemId); return; }
      setError(err.message); if (!err.cancelled) requestQuote(true); else toast(err.message);
    }
  }

  /* changing country can drop the 12-month plan (India): ask again with the plan that is shown */
  const pickPlan = id => { setPlanPick(id); requestQuote(true, addr, code, id); };
  const prevPlan = useRef(plan);
  useEffect(() => { if (subCls && prevPlan.current !== plan) { prevPlan.current = plan; requestQuote(true, addr, code, plan); } });

  /* ---------- the order summary ---------- */
  const cls = item ? classById(item.cls) : subCls ? classById(subCls) : null;
  const q = quote, addrOk = !!(q && q.valid);
  const summary = (
    <aside className="co-summary" id="coSummary" aria-live="polite">
      <div className="sum-head"><p className="eyebrow">Order summary</p>{q && <span className={'region-chip' + (q.region === 'IN' ? ' in' : '')}>{q.region === 'IN' ? '🇮🇳 India · INR' : '🌍 ' + q.countryName + ' · ' + q.currency}</span>}</div>
      {item
        ? <div className="sum-item"><div className="sum-thumb">{item.glyph || 'PDF'}</div><div><b>{item.title}</b><small>{cls.label} · one PDF · yours to keep</small></div></div>
        : cls && <div className="sum-item"><div className="sum-thumb">{shortClass(cls.label)}</div><div><b>{cls.label} plan</b><small>{planOf(plan).label} · every sheet in the class{running && running.end ? ' · starts ' + dateOf(running.end) + ', when your current plan ends' : ''}</small></div></div>}
      <div className={'co-lines' + (busy ? ' busy' : '')}>
        {q ? q.lines.map((l, i) => <div key={i} className="co-line"><span>{l.label}<small>{l.note || ''}</small></span><b>{fmtCur(l.amount, q.currency)}</b></div>)
          : error ? <p className="alert err">{error}</p> : <><div className="sk-line" /><div className="sk-line" /><div className="sk-line short" /></>}
      </div>
      {q && <div className={'sum-total' + (bump ? ' bump' : '')}><span>Total<small>incl. tax &amp; fees</small></span><strong key={bump}>{fmtCur(q.total, q.currency)}</strong></div>}
      {q && <p className="co-note" style={{ textAlign: 'center' }}>{subCls ? <>Every sheet in {cls.label} opens the moment the payment is verified.</> : <>Access opens the moment the payment is verified and <b>does not expire</b>.</>}</p>}
      {q && q.currency !== 'INR' && <p className="co-note">≈ ₹{Math.round(q.total / q.rate)} at 1 INR = {q.rate} {q.currency}. You are charged in {q.currency}.</p>}
      {q && q.coupon && <p className="co-note ok">Coupon {q.coupon} applied — ₹{q.discountInr} off</p>}
      {q && error && <p className="alert err">{error}</p>}
      <button type="button" className="btn btn-pay" id="payNow" disabled={!q || !q.valid || busy || !canPay} onClick={placeOrder}>{!canPay
        ? <><span>Payment coming soon</span><small>online payment is not available yet</small></>
        : <><span>{q && q.valid ? 'Pay ' + fmtCur(q.total, q.currency) : 'Complete your address'}</span><small>{q && q.valid ? 'by ' + viaOf.label + ' →' : 'to unlock payment'}</small></>}</button>
      <ul className="trust"><li>🔒 Priced &amp; signed on the server</li><li>🛡️ No card details stored here</li><li>↺ Cancel any time</li></ul>
      {q && <p className="co-note" style={{ textAlign: 'center' }}>Quote valid until {new Date(q.exp).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</p>}
    </aside>
  );

  let body;
  if (status === 'loading') body = <section className="panel"><p className="cart-empty">Loading secure checkout…</p></section>;
  else if (status === 'error') body = <section className="panel"><p className="alert err">{loadError}. Start the server (<code>npm start</code> in the <code>backend</code> folder) so the pricing API is available.</p></section>;
  else {
    const stateField = C.states
      ? <select id="co-state" name="state" className={addr.state ? 'filled' : undefined} value={addr.state || ''} onChange={e => change('state', e.target.value)} onBlur={blur('state')}>{['', ...C.states].map(x => <option key={x} value={x}>{x}</option>)}</select>
      : text('state', { autoComplete: 'address-level1' });
    body = (
      <>
        <div className="co-left">
          {subCls && <section className="panel co-card co-plans" aria-labelledby="coPlanHead">
            <header className="co-card-head"><span className="co-num">★</span><div><h3 id="coPlanHead">Choose your plan</h3><p>{C.code === 'IN' ? 'India: 1, 3 or 6 months' : '1, 3, 6 or 12 months'} · every sheet in {cls.label}</p></div></header>
            <div className="method-grid plan-grid" role="radiogroup" aria-label="Subscription plan">
              {plans.map(x => <label key={x.id} className={'method' + (x.id === plan ? ' on' : '')}><input type="radio" name="plan" value={x.id} checked={x.id === plan} onChange={() => pickPlan(x.id)} /><span className="txt"><b>{x.label}</b><small>{fmtCur(Math.round(((config.plans && config.plans[x.id] && config.plans[x.id].price) || x.price) * (config.rates[C.currency] || 1) * 100) / 100, C.currency)}{x.note ? ' · ' + x.note : ''}</small></span><span className="ring" /></label>)}
            </div>
          </section>}
          <section className={'panel co-card' + (addrOk ? ' done' : '')} data-step="1" aria-labelledby="coStep1">
            <header className="co-card-head"><span className="co-num">1</span><div><h3 id="coStep1">Billing address</h3><p id="coRegionLine">{C.code === 'IN'
              ? <><span className="region-chip in">🇮🇳 India</span> prices in ₹ INR with GST · state and 6-digit PIN code</>
              : <><span className="region-chip">🌍 {C.name}</span> priced in <b>{C.currency}</b>{C.tax.includes('%') ? ' with ' + C.tax : ', no tax collected'} · street and city only</>}</p></div></header>
            {fl('country', <select id="co-country" name="country" className="filled" value={addr.country} onChange={e => change('country', e.target.value)} onBlur={blur('country')}>{config.countries.map(x => <option key={x.code} value={x.code}>{flagOf(x.code)}  {x.name}</option>)}</select>, 'Country')}
            {fl('line1', text('line1', { autoComplete: 'street-address' }), 'Address (house / flat, street, area)')}
            <div className={'fl-grid' + (C.code === 'IN' ? '' : ' intl')}>
              {fl('city', text('city', { autoComplete: 'address-level2' }), 'City')}
              {C.code === 'IN' && fl('state', stateField, C.state)}
              {C.code === 'IN' && fl('postal', text('postal', { inputMode: 'numeric', autoComplete: 'postal-code', maxLength: 6 }), 'PIN code', <small className="fhint">6 digits, e.g. 411001</small>)}
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
            <div className="err" id="coCouponMsg" style={{ marginTop: '-6px' }}>{code ? (q && q.coupon ? 'Coupon ' + q.coupon + ' applied — ₹' + q.discountInr + ' off.' : (q ? 'That code is not valid.' : '')) : ''}</div>
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
      <div className="checkout-body" id="checkoutBody">{checkout.item || subCls || status !== 'ready' ? body : null}</div>
    </div>
  );
}
