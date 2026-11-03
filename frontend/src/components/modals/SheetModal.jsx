import { useEffect, useRef } from 'react';
import { useSite } from '../../context/SiteContext.jsx';
import { eventsApi } from '../../services/api.js';
import { sheetOf, ABOUT } from '../../data/catalogue.js';
import { classById, planOf, accessSpan } from '../../data/content.js';
import Countdown from '../sheets/Countdown.jsx';
import { dateTimeTz } from '../../utils/format.js';
import { sheetState, openForText, printsLine, picLocked } from '../sheets/sheetAccess.js';
import { CartButton } from '../sheets/SheetCard.jsx';
import { StarRow } from '../reviews/Stars.jsx';
import SheetRatings from '../reviews/SheetRatings.jsx';
import WriteReview from '../reviews/WriteReview.jsx';

const tzOf = access => (access && access.session && access.session.timeZone) || undefined;

/* Not signed in? Every worksheet first shows what a free account includes. */
function AccountPopup({ id }) {
  const { closeModal, requireSignIn } = useSite();
  const it = sheetOf(id);
  const go = view => requireSignIn(id ? { do: 'sheet', id } : { do: 'shop' }, view === 'signup' ? 'Create your free account. We will email you a password, then sign in and your sheet will be waiting for you.' : 'Sign in and your sheet will be waiting for you.', view);
  return (
    <>
      <button type="button" className="icon-btn close-x" aria-label="Close" onClick={closeModal}>✕</button>
      <h3 id="modalTitle">Free Account Includes:</h3>
      <ul className="perks">
        <li><i aria-hidden="true">✓</i><span>Free access sheets — open them in the full-screen viewer</span></li>
        <li><i aria-hidden="true">✓</i><span>Suggest a Resource! You want it? We&apos;ll make it</span></li>
        <li><i aria-hidden="true">✓</i><span>Customer support (with real people!)</span></li>
      </ul>
      <div className="sheet-actions"><button type="button" className="btn btn-primary" onClick={() => go('signup')}>Create my free account →</button><button type="button" className="btn btn-ghost" onClick={() => go('signin')}>I already have an account</button></div>
      {it && <p className="fine">Then <b>{it.title}</b> is one tap away.</p>}
    </>
  );
}

/* any sheet, free or paid: a look at the page, what is inside, and the open / buy action.
   The Access row says how long a purchase stays open (the sheet's accessDays from the server),
   until when it is open now, or when it ended ("Buy Access Again"). */
function SheetDetail({ id }) {
  const site = useSite();
  const { access, closeModal, openViewer, buy, cart } = site;
  const it = sheetOf(id); if (!it) return null;
  const session = access.session, tz = tzOf(access);
  const free = it.price === 0, cls = classById(it.cls) || { label: 'Kindergarten' }, st = sheetState(access, it);
  const span = accessSpan(it);
  const about = it.about || ABOUT[it.id] || it.bullets || [];
  const buyAgain = () => (site.buyAgain ? site.buyAgain(it.id) : (closeModal(), site.openCheckout({ worksheet: it.id, again: true })));
  const pic = it.img ? <img src={it.img} alt={it.title + ' — the printed page'} draggable={false} />
    : (
      <div className="sheet-mock" aria-hidden="true"><div className="brand"><b>Learn With Why</b><span>{it.subject}</span></div>
        <div className="boxes"><div><span className="glyph">{it.glyph}</span>{it.skills ? it.skills[0] : it.subject}</div><div><span className="pic">{it.pages ? it.pages : '✎'}</span>{it.pages ? 'A4 pages' : 'Activity'}</div></div>
        <div className="lines"><i /><i /><i /><i /><i /></div><small>{it.title} · {it.subject}</small></div>
    );
  const accessLine = !st.ready && !st.open ? 'Coming soon'
    : st.kind === 'free' ? (session ? 'Free access · signed in' : 'Free access · no sign-in needed')
    : st.kind === 'bought' ? (st.until ? 'Open until ' + dateTimeTz(st.until, tz) : 'Open on your account')
    : st.kind === 'plan' ? 'In your ' + cls.label + ' plan' + (st.until ? ' · until ' + dateTimeTz(st.until, tz) : '')
    : st.kind === 'ended' ? (st.endedAt ? 'Your access expired on ' + dateTimeTz(st.endedAt, tz) : 'Your access has expired')
    : openForText(it);
  /* one Open button for every sheet: it opens the protected full-screen viewer in a new tab */
  const actions = !st.ready
    ? <><button type="button" className="btn btn-primary" disabled>Coming soon</button><span className="note">We are still preparing this sheet. Please check back soon.</span></>
    : st.open && free
      ? <><button type="button" className="btn btn-primary" onClick={() => openViewer(it.id)}>Open it free ↗</button><span className="note">{session ? 'Free access sheet. No payment needed: it opens in a new tab in the protected viewer, with your name on every page.' : 'Free access sheet. No sign-in or payment needed: it opens in a new tab in the protected viewer.'}</span></>
    : st.open
      ? <><button type="button" className="btn btn-primary" onClick={() => openViewer(it.id)}>Open PDF · full screen ↗</button><span className="note">Opens in a new tab in the protected viewer. Close it to come back here.</span></>
      : !session
        ? <><button type="button" className="btn btn-primary" onClick={() => openViewer(it.id)}>Sign in to open</button>{free ? null : <CartButton it={it} st={st} />}<span className="note">{free ? 'Free access sheet. Sign in and it opens straight away.' : cart.has(it.id) ? 'It is in your cart. Sign in to pay for everything in your cart in one go.' : 'Sign in, then buy this PDF, or add it to your cart and buy a few together. It stays open for ' + span + ' from the day you pay.'}</span></>
        : free
          ? <><button type="button" className="btn btn-primary" onClick={() => openViewer(it.id)}>Open it free ↗</button><span className="note">Free access sheet. No payment needed, just open it.</span></>
          : st.kind === 'ended'
            ? <><button type="button" className="btn btn-primary" onClick={buyAgain}>Buy Access Again</button><CartButton it={it} st={st} /><span className="note">{st.endedAt ? 'Your access expired on ' + dateTimeTz(st.endedAt, tz) + '. ' : 'Your access has expired. '}Buy it again and it opens for another {span} from the day you pay.</span></>
            : <><button type="button" className="btn btn-primary" onClick={() => buy(it.id)}>Buy this PDF</button><CartButton it={it} st={st} /><span className="note">{cart.has(it.id) ? 'It is in your cart: pay for it with the rest of your cart, or buy it now on its own. ' : 'Buy it now, or add it to your cart and pay for a few sheets together. '}You see the full price at checkout. The sheet opens as soon as your payment is verified and stays open for {span}.</span></>;
  return (
    <>
      <div className={'sheet-view' + (it.img && picLocked(st) ? ' pic-locked' : '')}>{pic}{it.img && picLocked(st) ? <span className="lock-note">🔒 Buy to see the whole sheet</span> : null}</div>
      <div className="sheet-info">
        <div className="modal-head"><div><p className="eyebrow">{cls.label} · {it.subject}</p><h3 id="modalTitle">{it.title}</h3>{it.reviewCount && it.reviewAvg != null ? <p className="head-rating"><b>{it.reviewAvg.toFixed(1)}</b><StarRow value={it.reviewAvg} /><small>{it.reviewCount === 1 ? '1 review' : it.reviewCount + ' reviews'}</small></p> : null}</div><button type="button" className="icon-btn" aria-label="Close" onClick={closeModal}>✕</button></div>
        <p className="lead">{it.blurb}</p>
        <ul className="about">{about.map((l, i) => <li key={i}>{l}</li>)}</ul>
        <div className="rows"><div><span>Pages</span><b>{it.pages || 1} · A4 · PDF</b></div><div><span>Access</span><b id="sheetAccess">{accessLine}</b></div><div><span>Prints</span><b id="sheetPrints">{printsLine(it, site)}</b></div></div>
        <div className="sheet-actions">{actions}</div>
        <SheetRatings it={it} st={st} />
      </div>
    </>
  );
}

/* The lines of a purchase: SiteContext's purchaseOf() already gives { lines: [{ kind, worksheet, cls, plan,
   title, months, accessDays, start, end, expiresAt, status }] }. An older caller's { order, worksheet | cls + plan }
   is looked up in the customer's access records (the record the order opened). */
function linesOf(p, access) {
  if (Array.isArray(p.lines) && p.lines.length) return p.lines;
  const orderId = typeof p.order === 'string' ? p.order : (p.order && p.order.id) || p.orderId || null;
  const ents = Array.isArray(p.entitlements) && p.entitlements.length ? p.entitlements : p.entitlement ? [p.entitlement] : [];
  const all = (access && access.ent) || [];
  const find = (scope, key, val) => all.filter(e => e.scope === scope && e[key] === val && (!orderId || !e.order || e.order === orderId)).sort((a, b) => (b.start || 0) - (a.start || 0))[0] || null;
  const fromEnt = e => ({ kind: e.scope, worksheet: e.worksheet || null, cls: e.cls || null, plan: e.plan || null, title: e.title || null, start: e.start ?? null, end: e.end ?? null, expiresAt: e.expiresAt || null });
  if (ents.length) return ents.map(fromEnt);
  if (p.worksheet) { const e = find('worksheet', 'worksheet', p.worksheet); return [Object.assign({ kind: 'worksheet', worksheet: p.worksheet, title: null }, e ? fromEnt(e) : {})]; }
  if (p.cls) { const e = find('class', 'cls', p.cls); return [Object.assign({ kind: 'class', cls: p.cls, plan: p.plan || null, title: null }, e ? fromEnt(e) : {})]; }
  return [];
}
const titleOfLine = l => {
  if (l.title) return l.title;
  if (l.worksheet) { const it = sheetOf(l.worksheet); return it ? it.title : 'Your sheet'; }
  const c = classById(l.cls);
  return (c ? c.label : 'Class') + ' plan' + (l.plan ? ' · ' + planOf(l.plan).label : '');
};
const endOfLine = l => (l.end != null ? l.end : l.expiresAt ? Date.parse(l.expiresAt) : null);

/* Shown right after a verified payment: "Purchase Successful", each sheet or plan with the date and time
   its access ends (with the time zone), and where to find it again: My Account → My Worksheets.
   Props: { p } where p is what SiteContext.showPurchasePopup(...) builds with purchaseOf():
   { order: 'LWO-…', total: '₹25.80', method: 'Razorpay · QR code', paidAt, lines: [{ kind, worksheet, cls, plan,
   title, start, end (ms), expiresAt (ISO) }], entitlements }. The older { order, worksheet | cls + plan, total,
   method } (and { entitlement(s) }) work too. */
function PurchasePopup({ p }) {
  const { access, closeModal, openViewer, openMyWorksheets } = useSite();
  if (!p) return null;
  const tz = tzOf(access), now = Date.now();
  const orderId = typeof p.order === 'string' ? p.order : (p.order && p.order.id) || p.orderId || '';
  const lines = linesOf(p, access);
  const first = lines[0] || {};
  const item = lines.length === 1 && first.kind === 'worksheet' && first.worksheet ? sheetOf(first.worksheet) : null;
  const plan = first.kind === 'class';
  const it = lines.length > 1 || plan ? 'them' : 'it';
  return (
    <>
      <div className="purchase-icon" aria-hidden="true">✓</div>
      {orderId ? <p className="eyebrow">Order {orderId}</p> : null}
      <h3 id="modalTitle">Purchase Successful</h3>
      <p className="lead">{plan ? 'Your plan is ready.' : lines.length > 1 ? 'Your sheets are ready to open.' : 'Your sheet is ready to open.'}</p>
      {lines.map((l, i) => {
        const end = endOfLine(l), starts = l.start != null && l.start > now + 60e3 ? l.start : null, c = classById(l.cls);
        return (
          <div className="expiry" key={i} data-line={l.worksheet || l.cls || i}>
            <small>{l.kind === 'class' ? titleOfLine(l) + ': every ' + (c ? c.label : 'class') + ' sheet is open until' : titleOfLine(l) + ' is open until'}</small>
            <b>{end ? dateTimeTz(end, tz) : 'See My Worksheets'}</b>
            {l.kind !== 'class' && end ? <Countdown end={end} skew={(access && access.skew) || 0} /> : null}
            <small>{starts ? 'Starts ' + dateTimeTz(starts, tz) + ', when your current plan ends.' : end && l.kind !== 'class' ? 'Open it as often as you like until then. When the timer reaches zero, it is removed from your account.' : end ? 'Open it as often as you like until then.' : 'The end date is in My Account → My Worksheets.'}</small>
          </div>
        );
      })}
      <p>You can open {it} from <b>My Account → My Worksheets</b>.</p>
      {(p.total || orderId) ? <div className="rows">{p.total ? <div><span>Paid</span><b>{p.total}{p.method ? ' via ' + p.method : ''}</b></div> : null}{orderId ? <div><span>Order</span><b>{orderId}</b></div> : null}</div> : null}
      <div className="sheet-actions">
        {item && <button type="button" className="btn btn-primary" onClick={() => openViewer(item.id)}>Open the PDF now ↗</button>}
        <button type="button" className={'btn ' + (item ? 'btn-ghost' : 'btn-primary')} onClick={openMyWorksheets}>Open My Worksheets</button>
        <button type="button" className="btn btn-ghost" onClick={closeModal}>Close</button>
      </div>
    </>
  );
}

/* the paper-card modal: account prompt, sheet detail, or purchase receipt.
   The last content stays while it fades out. */
export default function SheetModal() {
  const site = useSite();
  const { modal, closeModal, siteStage } = site;
  const box = useRef(null);
  const actRef = useRef(site); actRef.current = site;
  useEffect(() => { if (modal.open && box.current) box.current.focus({ preventScroll: true }); }, [modal.open, modal.kind, modal.id]);

  /* a sheet opened (or a guest tapped one): a product view in the visit statistics */
  useEffect(() => {
    if (modal.open && (modal.kind === 'sheet' || modal.kind === 'account') && modal.id) eventsApi.track('product_view', { productId: modal.id, meta: { signedIn: modal.kind === 'sheet' } });
  }, [modal.open, modal.kind, modal.id]);

  /* "Buy Access Again" / "Renew my plan" pressed in the viewer tab (viewer.html): it tells this tab
     (postMessage, same site only), or comes back as /?again=<sheet> or /?renew=<class> */
  useEffect(() => {
    const go = d => {
      const a = actRef.current, id = d && typeof d.id === 'string' ? d.id : '', cls = d && typeof d.cls === 'string' ? d.cls : '';
      if (d && d.scope === 'class' && classById(cls)) { if (a.renewPlan) a.renewPlan(cls, d.plan || undefined); else a.openCheckout({ cls, plan: d.plan || 'm3', again: true }); return; }
      if (!id || !sheetOf(id)) return;
      Promise.resolve(a.syncEntitlements ? a.syncEntitlements() : null).catch(() => {}).then(() => { const b = actRef.current; if (b.buyAgain) b.buyAgain(id); else b.openCheckout({ worksheet: id, again: true }); });
    };
    const onMsg = e => { if (e.origin !== location.origin || !e.data || e.data.type !== 'lww:buy-again') return; go(e.data); };
    addEventListener('message', onMsg);
    if (siteStage === 'site') {
      const u = new URL(location.href), again = u.searchParams.get('again'), renew = u.searchParams.get('renew');
      if (again || renew) {
        u.searchParams.delete('again'); u.searchParams.delete('renew');
        history.replaceState(history.state, '', u.pathname + u.search + u.hash);
        go(renew ? { scope: 'class', cls: renew } : { id: again });
      }
    }
    return () => removeEventListener('message', onMsg);
  }, [siteStage]);

  const cls = modal.kind === 'account' ? 'modal account' : modal.kind === 'purchase' ? 'modal purchase' : modal.kind === 'review' ? 'modal review' : 'modal sheet';
  return (
    <div className={'modal-scrim' + (modal.open ? ' open' : '')} id="modalScrim" onClick={e => { if (e.target === e.currentTarget) closeModal(); }}>
      <div className={cls} id="modal" role="dialog" aria-modal="true" aria-labelledby="modalTitle" tabIndex={-1} ref={box} style={{ outline: 'none' }} aria-hidden={modal.open ? undefined : 'true'}>
        {modal.kind === 'account' && <AccountPopup id={modal.id} />}
        {modal.kind === 'sheet' && <SheetDetail id={modal.id} />}
        {modal.kind === 'purchase' && <PurchasePopup p={modal.purchase} />}
        {modal.kind === 'review' && <WriteReview />}
      </div>
    </div>
  );
}
