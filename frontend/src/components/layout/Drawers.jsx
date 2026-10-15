import { useCallback, useEffect, useRef, useState } from 'react';
import { useSite } from '../../context/SiteContext.jsx';
import useMyWorksheets from '../../hooks/useMyWorksheets.js';
import SecurityStatusCard from '../security/SecurityStatusCard.jsx';
import { meApi } from '../../services/api.js';
import { getSiteRules, timeOf } from '../../services/security.js';
import { fmtCur } from '../../services/currency.js';
import { NAV, IDS, classById, planOf } from '../../data/content.js';
import { dateTimeTz, shortClass, timeAgo } from '../../utils/format.js';

const TABS = [
  { id: 'sheets', label: 'My Worksheets' },
  { id: 'orders', label: 'Orders' },
  { id: 'devices', label: 'Devices' },
  { id: 'security', label: 'Security' },
];
const ORDER_STATUS = { paid: 'Paid', created: 'Not paid', expired: 'Not paid', failed: 'Payment failed', cancelled: 'Cancelled', refunded: 'Refunded' };
const PAY_BY = { razorpay: 'Razorpay', stripe: 'Card', paypal: 'PayPal' };
const classLabel = id => (classById(id) || { label: 'Class' }).label;
const planName = (cls, plan, label) => classLabel(cls) + ' · ' + (label || planOf(plan).label) + ' plan';
const offline = err => (err.status === 0 ? 'We could not reach Learn With Why just now.' : err.message);

/* the side drawers: Menu (tablet & phone) and My Account (My Worksheets, Orders, Devices, Security) */
export default function Drawers() {
  const site = useSite();
  const { drawer, closeDrawers, openDrawer, goTo, section, session, accountTab, setAccountTab, signOut, setAuthView, syncEntitlements } = site;
  const open = drawer === 'bag';
  /* opening My Account asks the server again, so a purchase or an ending made elsewhere shows */
  const signedIn = !!session;
  useEffect(() => { if (open && signedIn) syncEntitlements(); }, [open, signedIn, syncEntitlements]);
  const tab = TABS.some(t => t.id === accountTab) ? accountTab : 'sheets';
  const tz = (session && session.timeZone) || undefined;
  const signIn = () => { goTo(0); setAuthView('signin'); };
  return (
    <>
      <div className={'drawer-scrim' + (drawer ? ' open' : '')} id="drawerScrim" onClick={closeDrawers} />
      <aside className={'drawer' + (drawer === 'menu' ? ' open' : '')} id="menuDrawer" aria-label="Menu" aria-hidden={drawer === 'menu' ? undefined : 'true'}>
        <div className="drawer-head"><span className="drawer-title">Menu</span><button type="button" className="icon-btn" aria-label="Close" onClick={closeDrawers}>✕</button></div>
        <div className="nav-list" id="menuList">
          {NAV.map((l, i) => <button key={IDS[i]} type="button" className={section === i ? 'on' : undefined} onClick={() => goTo(i)}>{l}</button>)}
          <button type="button" id="bagBtn2" onClick={() => openDrawer('bag')}>Cart</button>
        </div>
      </aside>
      <aside className={'drawer acct' + (open ? ' open' : '')} id="bagDrawer" aria-label="My Account" aria-hidden={open ? undefined : 'true'}>
        <div className="drawer-head"><span className="drawer-title">My Account</span><button type="button" className="icon-btn" aria-label="Close" onClick={closeDrawers}>✕</button></div>
        {session ? (
          <div id="bagBody">
            <p className="acct-who"><b>{session.name || 'Your account'}</b><span>{session.email}</span></p>
            <div className="tabs acct-tabs" role="tablist" aria-label="My Account">
              {TABS.map(t => <button key={t.id} type="button" role="tab" id={'acctTab-' + t.id} aria-controls="acctPanel" aria-selected={tab === t.id} className={'tab' + (tab === t.id ? ' on' : '')} onClick={() => setAccountTab(t.id)}>{t.label}</button>)}
            </div>
            <div id="acctPanel" role="tabpanel" aria-labelledby={'acctTab-' + tab}>
              {tab === 'sheets' ? <SheetsTab tz={tz} /> : null}
              {tab === 'orders' ? <OrdersTab tz={tz} open={open} /> : null}
              {tab === 'devices' ? <DevicesTab tz={tz} open={open} /> : null}
              {tab === 'security' ? <SecurityStatusCard /> : null}
            </div>
            <button type="button" className="btn btn-ghost btn-block acct-signout" id="acctSignOut" onClick={signOut}>Sign out</button>
          </div>
        ) : (
          <div id="bagBody">
            <p className="cart-empty">Sign in to see your worksheets, your orders and the devices you are signed in on.</p>
            <button type="button" className="btn btn-primary btn-block" onClick={signIn}>Sign in or create an account</button>
            <button type="button" className="btn btn-ghost btn-block" style={{ marginTop: '10px' }} onClick={() => site.openShop('all')}>Browse all sheets →</button>
          </div>
        )}
      </aside>
    </>
  );
}

/* My Worksheets: what opens now (with its end), plans, and what ran out ("Buy Access Again") */
function SheetsTab({ tz }) {
  const { openViewer, openShop, buyAgain, renewPlan, setAccountTab } = useSite();
  const { subs, endedPlans, sheets, expired, paused, now } = useMyWorksheets();
  const [days, setDays] = useState(365);
  useEffect(() => { let alive = true; getSiteRules().then(r => { if (alive) setDays(r.accessDays); }); return () => { alive = false; }; }, []);
  const until = end => (end ? ' · open until ' + dateTimeTz(end, tz) : '');
  const noteOf = s => (s.kind === 'plan' ? 'In your ' + classLabel(s.cls) + ' plan' + until(s.end)
    : s.kind === 'free' ? 'Free with your account'
      : s.kind === 'grant' ? 'Added for you' + until(s.end)
        : 'Bought' + until(s.end));
  const openKey = id => e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openViewer(id); } };
  return (
    <>
      {paused ? <div className="alert err" role="status">Paid sheets are paused on this account. Free sheets still open. <button type="button" className="link" onClick={() => setAccountTab('security')}>See why</button></div> : null}
      <p className="eyebrow acct-eyebrow">My plans</p>
      {!subs.length && !endedPlans.length ? <p className="cart-empty">No class plan yet. Pick a class and every sheet in it opens for as long as your plan runs.</p> : null}
      {subs.map(x => {
        const later = x.start != null && x.start > now;
        return (
          <div key={x.cls} className="cart-row">
            <div className="paper-mini">{shortClass(classLabel(x.cls))}</div>
            <div className="nm">{classLabel(x.cls)}<span>{(x.planLabel || planOf(x.plan).label) + ' plan'}{later ? ' · starts ' + dateTimeTz(x.start, tz) : ''}{x.end ? ' · open until ' + dateTimeTz(x.end, tz) : ''}</span></div>
            <span className="pill">{later ? 'Next' : 'Active'}</span>
          </div>
        );
      })}
      {endedPlans.map(x => (
        <div key={'ended-' + x.cls} className="cart-row is-ended">
          <div className="paper-mini">{shortClass(classLabel(x.cls))}</div>
          <div className="nm">{classLabel(x.cls)}<span>{(x.planLabel || planOf(x.plan).label) + ' plan'} · ended on {dateTimeTz(x.end, tz)}</span></div>
          <button type="button" className="btn btn-ghost acct-mini" onClick={() => renewPlan(x.cls, x.plan)}>Renew</button>
        </div>
      ))}

      <p className="eyebrow acct-eyebrow">My Worksheets · {sheets.length}</p>
      {sheets.length ? sheets.map(s => (s.it ? (
        <div key={s.id} className="cart-row acct-open" role="button" tabIndex={0} title="Open in the viewer" onClick={() => openViewer(s.id)} onKeyDown={openKey(s.id)}>
          <div className="paper-mini">{s.it.glyph || s.it.az || 'PDF'}</div><div className="nm">{s.title}<span>{noteOf(s)}</span></div><span className="pill">Open ↗</span>
        </div>
      ) : (
        <div key={s.id} className="cart-row"><div className="paper-mini">PDF</div><div className="nm">{s.title}<span>{noteOf(s)}</span></div></div>
      ))) : <p className="cart-empty">Nothing here yet. Free sheets you open, PDFs you buy and every sheet in a class plan appear here.</p>}

      {expired.length ? (
        <>
          <p className="eyebrow acct-eyebrow">Expired · {expired.length}</p>
          {expired.map(x => (
            <div key={'exp-' + x.id} className="cart-row is-ended">
              <div className="paper-mini">{(x.it && (x.it.glyph || x.it.az)) || 'PDF'}</div>
              <div className="nm">{x.title}<span>Access ended on {dateTimeTz(x.end, tz)}</span></div>
              {x.it ? <button type="button" className="btn btn-primary acct-mini" onClick={() => buyAgain(x.id)}>Buy Access Again</button> : null}
            </div>
          ))}
        </>
      ) : null}

      <button type="button" className="btn btn-primary btn-block" style={{ marginTop: '16px' }} onClick={() => openShop('all')}>Browse all sheets →</button>
      <p className="cart-empty acct-fine">Each PDF you buy opens for {days} days from the day you pay, and a class plan for as long as it runs. The end date is shown next to each one, and we check your access every time a sheet opens.</p>
    </>
  );
}

/* load a list when its tab is showing (again each time the drawer opens on it) */
function useList(open, fetcher, pick) {
  const [s, setS] = useState({ list: null, err: '', loading: false });
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const load = useCallback(() => {
    setS(x => ({ ...x, loading: true, err: '' }));
    fetcher().then(r => { if (alive.current) setS({ list: pick(r), err: '', loading: false }); },
      err => { if (alive.current) setS(x => ({ ...x, err: offline(err), loading: false })); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { if (open) load(); }, [open, load]);
  return [s, load, setS];
}

/* Orders: every order, newest first, with what each line opened and until when */
function OrdersTab({ tz, open }) {
  const [s, load] = useList(open, meApi.orders, r => (Array.isArray(r.orders) ? r.orders : []));
  const { openShop } = useSite();
  const now = Date.now();
  const lineText = l => {
    const e = l.entitlement; if (!e) return '';
    const end = e.end ?? timeOf(e.expiresAt), start = e.startsAt ?? e.start ?? null;
    if (e.status === 'revoked') return 'Access removed';
    if (end == null) return '';
    if (e.status === 'expired' || end <= now) return 'Ended on ' + dateTimeTz(end, tz);
    if (start != null && start > now) return 'Starts ' + dateTimeTz(start, tz) + ' · open until ' + dateTimeTz(end, tz);
    return 'Open until ' + dateTimeTz(end, tz);
  };
  const titleOf = o => {
    const ls = Array.isArray(o.lines) ? o.lines : [];
    if (ls.length === 1) return ls[0].kind === 'class' ? planName(ls[0].cls, ls[0].plan, ls[0].months ? ls[0].months + (ls[0].months === 1 ? ' month' : ' months') : null) : (ls[0].title || 'Worksheet');
    if (ls.length > 1) return ls.length + ' items';
    return o.kind === 'class' ? planName(o.cls, o.plan) : 'Worksheet';
  };
  if (s.list === null) {
    return s.err ? <div className="alert err" role="alert">{s.err} <button type="button" className="link" onClick={load}>Try again</button></div>
      : <p className="sec-card-note" role="status"><span className="sec-spin" aria-hidden="true" />Loading your orders…</p>;
  }
  return (
    <>
      {s.err ? <div className="alert err" role="alert">{s.err} <button type="button" className="link" onClick={load}>Try again</button></div> : null}
      {!s.list.length ? (
        <>
          <p className="cart-empty">No orders yet. When you buy a PDF or a class plan, the order shows here with its receipt details.</p>
          <button type="button" className="btn btn-primary btn-block" onClick={() => openShop('all')}>Browse all sheets →</button>
        </>
      ) : s.list.map(o => {
        const ls = Array.isArray(o.lines) ? o.lines : [];
        const when = o.paidAt || o.at;
        return (
          <div key={o.id} className={'acct-order st-' + o.status}>
            <div className="acct-order-top"><b>{titleOf(o)}</b><span className={'pill acct-st'}>{ORDER_STATUS[o.status] || o.status}</span></div>
            <span className="acct-meta">{fmtCur(o.total, o.currency || 'INR')}{PAY_BY[o.method] ? ' · ' + PAY_BY[o.method] : ''}{when ? ' · ' + dateTimeTz(when, tz) : ''}</span>
            {o.status === 'paid' && ls.length ? (
              <ul className="acct-lines">{ls.map((l, i) => { const t = lineText(l); return t ? <li key={i}>{ls.length > 1 ? (l.title || 'Item') + ': ' : ''}{t}</li> : null; })}</ul>
            ) : null}
            {o.status === 'refunded' && o.refundedAt ? <span className="acct-meta">Refunded on {dateTimeTz(o.refundedAt, tz)}</span> : null}
            <small className="acct-id">Order {o.id}</small>
          </div>
        );
      })}
    </>
  );
}

/* Devices: every place this account is signed in; any other one can be signed out from here */
function DevicesTab({ tz, open }) {
  const { toast, signOut } = useSite();
  const [s, load, setS] = useList(open, meApi.sessions, r => (Array.isArray(r.sessions) ? r.sessions : []));
  const [busy, setBusy] = useState(null);
  const end = async d => {
    setBusy(d.id);
    try { await meApi.endSession(d.id); toast('That device is signed out.'); }
    catch (err) { if (err.status !== 404) { toast(err.status === 0 ? 'No connection. Please try again.' : err.message); setBusy(null); return; } }
    setBusy(null);
    setS(x => ({ ...x, list: (x.list || []).filter(y => y.id !== d.id) }));
  };
  if (s.list === null) {
    return s.err ? <div className="alert err" role="alert">{s.err} <button type="button" className="link" onClick={load}>Try again</button></div>
      : <p className="sec-card-note" role="status"><span className="sec-spin" aria-hidden="true" />Loading your devices…</p>;
  }
  const list = s.list.slice().sort((a, b) => (b.current ? 1 : 0) - (a.current ? 1 : 0) || (b.lastSeenAt || 0) - (a.lastSeenAt || 0));
  return (
    <>
      {s.err ? <div className="alert err" role="alert">{s.err} <button type="button" className="link" onClick={load}>Try again</button></div> : null}
      <p className="cart-empty acct-lead">You are signed in on {list.length === 1 ? 'one device' : list.length + ' devices'}.</p>
      {list.map(d => (
        <div key={d.id} className={'cart-row acct-device' + (d.current ? ' is-current' : '')}>
          <div className="paper-mini" aria-hidden="true"><DeviceIcon label={d.device} /></div>
          <div className="nm">{d.device || 'A device'}
            <span>{d.current ? 'This device · ' : ''}last active {timeAgo(d.lastSeenAt || d.lastActiveAt)}{d.country ? ' · ' + d.country : ''}</span>
            <span>Signed in {dateTimeTz(d.createdAt, tz)}</span>
          </div>
          {d.current
            ? <button type="button" className="btn btn-ghost acct-mini" onClick={signOut}>Sign out</button>
            : <button type="button" className="btn btn-ghost acct-mini" disabled={busy === d.id} onClick={() => end(d)}>{busy === d.id ? 'One moment…' : 'Sign out this device'}</button>}
          {d.blocked ? <span className="pill acct-stopped">Stopped</span> : null}
        </div>
      ))}
      <p className="cart-empty acct-fine">See a device you do not know? Sign it out here, then choose a new password with Forgot password on the sign-in card.</p>
    </>
  );
}

/* a phone, a tablet or a computer, from the name the server gave the device */
function DeviceIcon({ label }) {
  const l = String(label || '');
  const p = { width: 22, height: 22, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' };
  if (/ipad|tablet/i.test(l)) return <svg {...p}><rect x="4" y="2.5" width="16" height="19" rx="2.5" /><path d="M11 18.5h2" /></svg>;
  if (/android|iphone|ios|mobile|phone/i.test(l)) return <svg {...p}><rect x="6.5" y="2.5" width="11" height="19" rx="2.5" /><path d="M11 18.5h2" /></svg>;
  return <svg {...p}><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8M12 16v4" /></svg>;
}
