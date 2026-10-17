import { useEffect, useState } from 'react';
import DataTable from '../../components/dashboard/DataTable.jsx';
import Pill from '../../components/dashboard/Pill.jsx';
import Icon from '../../components/dashboard/Icon.jsx';
import Modal from '../../components/dashboard/Modal.jsx';
import { Guard, ErrorNote, Loading } from '../../components/dashboard/States.jsx';
import { useDash } from '../Portal/DashContext.js';
import { useStaffGet, useAct, fmt, inr, cur, qs, problem, fieldErrors, plural } from '../Portal/dashboard.js';
import { staffApi } from '../../services/api.js';
import { accessSpan } from '../../data/content.js';
import { ORDER_STATUS_LABEL, METHOD_LABEL, ENT_STATUS_LABEL, ENT_TONE, orderWhat, orderAmount, entName, startOfDayIso, endOfDayIso } from './common.js';

const FILTERS = [['', 'All'], ['paid', 'Paid'], ['created', 'Unpaid'], ['refunded', 'Refunded'], ['cancelled', 'Cancelled'], ['failed', 'Failed'], ['expired', 'Expired']];
const PAGE = 20;

/* Orders: every order from the server, newest first, with filters and pages; one order opens
   with its lines, payments and the access it gave. An order becomes paid only through a
   verified payment, so there is no "mark as paid" here. */
export default function Orders() {
  const { focus, clearFocus } = useDash();
  const [open, setOpen] = useState(() => (focus && focus.order) || null);
  useEffect(() => { if (focus && focus.order) { setOpen(focus.order); clearFocus(); } }, [focus, clearFocus]);
  return open ? <OrderDetail id={open} onBack={() => setOpen(null)} /> : <OrderList onOpen={setOpen} />;
}

function OrderList({ onOpen }) {
  const { stats } = useDash();
  const [status, setStatus] = useState('');
  const [method, setMethod] = useState('');
  const [q, setQ] = useState('');
  const [text, setText] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [offset, setOffset] = useState(0);
  const [limit, setLimit] = useState(PAGE);
  /* the search box waits for a pause in typing */
  useEffect(() => { const t = setTimeout(() => { setQ(text.trim()); setOffset(0); }, 350); return () => clearTimeout(t); }, [text]);
  const path = '/api/admin/orders' + qs({ status, method, q, from: startOfDayIso(from), to: endOfDayIso(to), limit, offset });
  const st = useStaffGet(path, { keep: true });
  const data = st.data || {};
  const orders = data.orders || [];
  const filtered = !!(status || method || q || from || to);
  const reset = () => { setStatus(''); setMethod(''); setText(''); setQ(''); setFrom(''); setTo(''); setOffset(0); };

  return (
    <>
      {stats ? <div className="kpi-row" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))' }}>
        <div className="stat"><b>{stats.paid_orders}</b><span>Paid</span></div>
        <div className="stat"><b>{stats.pendingOrders || 0}</b><span>Unpaid</span></div>
        <div className="stat"><b>{stats.refundedOrders || 0}</b><span>Refunded</span></div>
        <div className="stat"><b>{inr(stats.revenue_inr)}</b><span>Revenue</span></div>
      </div> : null}
      <section className="panel"><p className="eyebrow">Orders{data.total != null ? ' · ' + data.total : ''}</p>
        <p className="auth-sub">Live from the database. An order is paid only when the payment gateway confirms it. Open an order to cancel an unpaid one, record a refund or add a note.</p>
        <div className="chips" role="group" aria-label="Order status">{FILTERS.map(([v, l]) => <button key={v || 'all'} type="button" className={'chip' + (status === v ? ' on' : '')} aria-pressed={status === v} onClick={() => { setStatus(v); setOffset(0); }}>{l}</button>)}</div>
        <div className="dt-bar"><div className="lft">
          <input className="dt-q" type="search" placeholder="Search orders…" title="Order number, email, name, payment id or coupon" aria-label="Search orders by number, email, name, payment id or coupon" value={text} onChange={e => setText(e.target.value)} />
          <select aria-label="Payment method" value={method} onChange={e => { setMethod(e.target.value); setOffset(0); }} style={{ width: 'auto', height: '32px' }}><option value="">Any method</option>{Object.entries(METHOD_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          <label className="inline-field">From <input type="date" value={from} max={to || undefined} onChange={e => { setFrom(e.target.value); setOffset(0); }} /></label>
          <label className="inline-field">To <input type="date" value={to} min={from || undefined} onChange={e => { setTo(e.target.value); setOffset(0); }} /></label>
          {filtered ? <button type="button" className="btn btn-ghost btn-plain btn-sm" onClick={reset}>Reset <Icon id="x" size={14} /></button> : null}
        </div></div>
        {st.error ? <ErrorNote error={st.error} onRetry={st.reload} /> : null}
        {st.loading && !st.data ? <Loading rows={5} /> : (
          <DataTable head={['Order', 'When', 'Customer', 'What', 'Method', 'Amount', 'Status']}
            empty={filtered ? 'No orders match these filters.' : 'No orders yet. They appear when a customer checks out.'}
            page={{ total: data.total || 0, offset, limit, onPage: setOffset, onLimit: n => { setLimit(n); setOffset(0); } }}
            rows={orders.map(o => ({ key: o.id, onClick: () => onOpen(o.id), cells: [
              <button key="i" type="button" className="link mono" onClick={() => onOpen(o.id)}>{o.id}</button>, fmt(o.at),
              <span key="c">{o.name || o.email.split('@')[0]}<br /><small>{o.email}</small></span>,
              <span key="w">{orderWhat(o)}{o.coupon ? <><br /><small>coupon {o.coupon}</small></> : null}</span>,
              METHOD_LABEL[o.method] || o.method,
              <span key="a">{inr(o.totalInr)}{o.currency !== 'INR' ? <><br /><small>{cur(o.total, o.currency)}</small></> : null}</span>,
              <Pill key="s" tone={o.status}>{ORDER_STATUS_LABEL[o.status] || o.status}</Pill>,
            ] }))} />
        )}
      </section>
    </>
  );
}

/* one order: summary, lines with the access each gave, payments, gateway messages, history */
function OrderDetail({ id, onBack }) {
  const { can, go, allowed } = useDash();
  const st = useStaffGet('/api/admin/orders/' + encodeURIComponent(id));
  const act = useAct();
  const [dialog, setDialog] = useState(null);   /* 'cancel' | 'refund' */
  const [note, setNote] = useState(null);
  const [savingNote, setSavingNote] = useState(false);
  const d = st.data, o = d && d.order;
  useEffect(() => { if (o) setNote(o.note || ''); }, [o]);
  const write = can('orders.write');

  const saveNote = async () => {
    setSavingNote(true);
    const out = await act(() => staffApi('PUT', '/api/admin/orders', { id, note: note.trim() || null }), 'Note saved');
    setSavingNote(false);
    if (out) st.reload(true);
  };

  return (
    <>
      <div className="row-between"><button type="button" className="btn btn-ghost btn-sm" onClick={onBack}><Icon id="left" size={14} />All orders</button>
        {o ? <div className="btn-row">
          {write && o.status === 'created' ? <button type="button" className="btn btn-ghost btn-sm btn-danger" onClick={() => setDialog('cancel')}><Icon id="x" size={14} />Cancel this unpaid order</button> : null}
          {write && o.status === 'paid' ? <button type="button" className="btn btn-ghost btn-sm btn-danger" onClick={() => setDialog('refund')}><Icon id="undo" size={14} />Record a refund</button> : null}
        </div> : null}
      </div>
      <Guard state={st} rows={6}>
        {o ? <>
          <section className="panel">
            <div className="row-between"><div><p className="eyebrow mono">{o.id}</p><p className="auth-sub">{o.name || o.email} · {o.email}</p></div><Pill tone={o.status}>{ORDER_STATUS_LABEL[o.status] || o.status}</Pill></div>
            <div className="kv">
              <span>Amount</span><b>{orderAmount(o)}</b>
              {o.discountInr ? <><span>Discount</span><b>{inr(o.discountInr)}{d.coupon ? ' with coupon ' + d.coupon.code : o.coupon ? ' with coupon ' + o.coupon : ''}</b></> : null}
              {o.currency !== 'INR' && o.rate ? <><span>Exchange rate</span><b>1 rupee = {o.rate} {o.currency}</b></> : null}
              <span>Method</span><b>{METHOD_LABEL[o.method] || o.method}{o.gatewayMode && o.gatewayMode !== 'live' ? ' (' + o.gatewayMode + ' mode)' : ''}</b>
              <span>Placed</span><b>{fmt(o.at)}</b>
              {o.paidAt ? <><span>Paid</span><b>{fmt(o.paidAt)}</b></> : null}
              {o.cancelledAt ? <><span>Cancelled</span><b>{fmt(o.cancelledAt)}</b></> : null}
              {o.refundedAt ? <><span>Refund recorded</span><b>{fmt(o.refundedAt)}</b></> : null}
              {o.failureReason ? <><span>Why it failed</span><b>{o.failureReason}</b></> : null}
              {o.gatewayOrderId ? <><span>Gateway order</span><b className="mono">{o.gatewayOrderId}</b></> : null}
              {o.paymentId ? <><span>Payment id</span><b className="mono">{o.paymentId}</b></> : null}
              {o.country ? <><span>Country</span><b>{o.country}</b></> : null}
              {d.customer ? <><span>Customer</span><b>{allowed('customers') ? <button type="button" className="link" onClick={() => go('customers', { customer: d.customer.id })}>{d.customer.name || d.customer.email}</button> : (d.customer.name || d.customer.email)}{d.customer.blocked ? ' (blocked)' : d.customer.accessStatus === 'suspended' ? ' (paid access paused)' : ''}</b></> : null}
            </div>
            {o.status === 'refunded' ? <p className="st-note info"><Icon id="undo" size={16} /><span>This refund was recorded by staff. The money itself is returned in the payment gateway's dashboard.</span></p> : null}
          </section>

          <section className="panel"><p className="eyebrow">What was bought</p>
            <DataTable plain head={['Item', 'Price', 'Discount', 'Access', 'Open until']} empty="No lines on this order."
              rows={o.lines.map((l, i) => ({ key: i, cells: [
                <span key="t">{l.title || l.worksheet}<br /><small>{l.kind === 'class' ? 'Class plan' + (l.months ? ', ' + plural(l.months, 'month') : '') : 'Sheet' + (l.accessHours || l.accessDays ? ', open ' + accessSpan(l) : '')}</small></span>,
                inr(l.unitPriceInr), l.discountInr ? inr(l.discountInr) : '',
                l.entitlement ? <Pill key="e" tone={ENT_TONE[l.entitlement.status]}>{ENT_STATUS_LABEL[l.entitlement.status] || l.entitlement.status}</Pill> : <small key="e">{o.status === 'paid' ? 'Not given' : 'Given when paid'}</small>,
                l.entitlement && l.entitlement.end ? fmt(l.entitlement.end) : '',
              ] }))} />
            {d.entitlements && d.entitlements.length ? <><p className="eyebrow" style={{ marginTop: '4px' }}>Access records</p>
              <DataTable plain head={['#', 'Access', 'Status', 'From', 'Until', 'Note']} empty=""
                rows={d.entitlements.map(e => ({ key: e.id, cells: [e.id, entName(e), <Pill key="s" tone={ENT_TONE[e.status]}>{ENT_STATUS_LABEL[e.status] || e.status}</Pill>, fmt(e.start), e.end ? fmt(e.end) : '', e.revokeReason || ''] }))} /></> : null}
          </section>

          <div className="grid-2">
            <section className="panel"><p className="eyebrow">Payments</p>
              <DataTable plain head={['Gateway', 'Payment', 'Amount', 'Status', 'When']} empty="No payment was received for this order."
                rows={d.payments.map(p => ({ key: p.id, cells: [METHOD_LABEL[p.provider] || p.provider, <span key="p" className="mono">{p.paymentId}</span>, cur(p.amount, p.currency), <Pill key="s" tone={p.status === 'captured' ? 'ok' : p.status === 'refunded' ? 'bad' : 'info'}>{p.status}</Pill>, fmt(p.at)] }))} />
            </section>
            <section className="panel"><p className="eyebrow">Messages from the gateway</p>
              <DataTable plain head={['What', 'Result', 'When']} empty="No gateway messages for this order."
                rows={d.events.slice(0, 20).map(e => ({ key: e.id, cells: [e.type, <Pill key="r" tone={e.ok ? 'ok' : 'bad'}>{e.ok ? 'OK' : (e.status || 'not accepted')}</Pill>, fmt(e.at)] }))} />
            </section>
          </div>

          <section className="panel"><p className="eyebrow">Staff note</p><p className="auth-sub">Only staff see this note.</p>
            {note === null ? null : <>
              <textarea aria-label="Staff note" value={note} maxLength={2000} disabled={!write || savingNote} onChange={e => setNote(e.target.value)} placeholder={write ? 'For example: customer asked about an invoice.' : 'No note.'} />
              {write ? <div className="btn-row"><button type="button" className="btn btn-primary btn-sm" disabled={savingNote || (note || '') === (o.note || '')} onClick={saveNote}>{savingNote ? 'Saving…' : 'Save note'}</button></div> : null}
            </>}
          </section>

          {d.audit ? <section className="panel"><p className="eyebrow">History</p>
            <DataTable plain head={['When', 'Who', 'What']} empty="No staff changes on this order."
              rows={d.audit.map((h, i) => ({ key: i, cells: [fmt(h.at), h.actor || 'system', h.action] }))} />
          </section> : null}
        </> : null}
      </Guard>
      {dialog === 'cancel' && o ? <CancelDialog order={o} onClose={() => setDialog(null)} onDone={() => { setDialog(null); st.reload(true); }} /> : null}
      {dialog === 'refund' && o ? <RefundDialog order={o} onClose={() => setDialog(null)} onDone={() => { setDialog(null); st.reload(true); }} /> : null}
    </>
  );
}

function CancelDialog({ order, onClose, onDone }) {
  const { toast, refreshCounts } = useDash();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const submit = async () => {
    setBusy(true); setErr('');
    try { await staffApi('PUT', '/api/admin/orders', { id: order.id, status: 'cancelled' }); toast('Order ' + order.id + ' cancelled'); refreshCounts(); onDone(); }
    catch (e) { setErr(e.code === 'bad_transition' ? 'This order changed a moment ago (it may have been paid). Close this and look again.' : problem(e)); setBusy(false); }
  };
  return (
    <Modal title="Cancel this unpaid order?" onClose={onClose} onSubmit={submit} submitLabel="Cancel the order" busyLabel="Cancelling…" cancelLabel="Keep it" danger busy={busy} error={err}>
      <p>Order <b>{order.id}</b> for <b>{orderAmount(order)}</b> was never paid. Cancelling stops it from being paid later. The customer can always place a new order.</p>
    </Modal>
  );
}

function RefundDialog({ order, onClose, onDone }) {
  const { toast, refreshCounts } = useDash();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const gateway = METHOD_LABEL[order.method] || order.method;
  const submit = async () => {
    const r = reason.trim();
    if (r.length < 3) { setErr('Say why (at least 3 characters). It goes in the audit log.'); return; }
    setBusy(true); setErr('');
    try {
      const out = await staffApi('POST', '/api/admin/orders/' + encodeURIComponent(order.id) + '/refund', { reason: r });
      toast('Refund recorded. ' + plural(out.revoked || 0, 'access record') + ' ended.'); refreshCounts();
      onDone();
    } catch (e) {
      const fe = fieldErrors(e);
      setErr(fe.reason || (e.code === 'already_refunded' ? 'This order is already marked refunded.' : e.code === 'not_paid' ? 'Only a paid order can be marked refunded.' : problem(e)));
      setBusy(false);
    }
  };
  return (
    <Modal title="Record a refund" onClose={onClose} onSubmit={submit} submitLabel="Record the refund" busyLabel="Recording…" danger busy={busy} error={err}>
      <p>First refund <b>{orderAmount(order)}</b> in the <b>{gateway}</b> dashboard. This button does not move any money: it only records the refund here.</p>
      <p>When you record it, order <b>{order.id}</b> becomes refunded, the access it bought ends now, and the customer gets an email.</p>
      <div className="field"><label htmlFor="refundReason">Reason</label><textarea id="refundReason" value={reason} maxLength={200} onChange={e => setReason(e.target.value)} placeholder="For example: customer bought the wrong class by mistake." /><small>Kept in the audit log. 3 to 200 characters.</small></div>
    </Modal>
  );
}
