import { useEffect, useState } from 'react';
import MetricCard from '../../components/dashboard/MetricCard.jsx';
import SessionControls from './SessionControls.jsx';
import { StaffStyles, CardTable, Chips, Tabs, Tag, Missing, Loading, LoadError, Note, NoAccess, PanelHead, useServer, useStaffAccess, qs, when, ago, count, money, rupees, plural } from './common.jsx';

/* The server's logs, read-only: payments, payment notifications (webhooks), sign-ins with the
   per-sign-in controls, security events and the sheet viewer log. Every row comes from the
   database through /api/admin/*. */

const GATEWAY = { razorpay: 'Razorpay', stripe: 'Stripe', paypal: 'PayPal' };
const DAY = 24 * 3600e3;

/* "Chrome on Windows" from a browser's user agent (never more than that) */
export function uaShort(ua) {
  const s = String(ua || '');
  if (!s) return '';
  const b = /Edg\//.test(s) ? 'Edge' : /OPR\/|Opera/.test(s) ? 'Opera' : /Firefox\//.test(s) ? 'Firefox' : /Chrome\/|CriOS\//.test(s) ? 'Chrome' : /Safari\//.test(s) ? 'Safari' : /curl|node|deno|python|Headless/i.test(s) ? 'Script' : '';
  const o = /iPhone/.test(s) ? 'iPhone' : /iPad/.test(s) ? 'iPad' : /Android/.test(s) ? 'Android' : /Windows/.test(s) ? 'Windows' : /Mac OS X|Macintosh/.test(s) ? 'Mac' : /CrOS/.test(s) ? 'Chromebook' : /Linux/.test(s) ? 'Linux' : '';
  return b && o ? b + ' on ' + o : b || o || 'Other';
}
/* a few facts from a log row's JSON detail, as "label: value" text in plain words. Ids of staff
   members are not shown (the audit log says who did what); nested values are left out. */
const DETAIL_LABEL = {
  orderId: 'order', provider: 'gateway', appealId: 'appeal', kind: 'kind', warningId: 'warning', sessionId: 'sign-in',
  emailDelivered: 'email sent', attempts: 'wrong tries', minutes: 'locked for (minutes)', sessionsEnded: 'sign-ins ended',
  productId: 'sheet', entitlementId: 'access record', reason: 'reason', note: 'note', bytes: 'size', by: 'by', count: 'how many',
  role: 'role', newAccount: 'new account', active: 'still active', incidentId: 'incident', rule: 'rule', confirm: 'confirmed at once',
  resetWarnings: 'warnings cleared', capture: 'capture', markedFailed: 'marked failed', result: 'result', error: 'error',
  status: 'status', code: 'code', gatewayOrderId: 'gateway order', mode: 'mode', partial: 'part refund', refundId: 'refund',
  paymentId: 'payment', paymentOrder: 'payment’s order', paypalOrder: 'PayPal order', refund: 'refund', revoked: 'access removed', sent: 'sent',
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function detailValue(k, v) {
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  if (k === 'bytes' && Number.isFinite(Number(v))) return Number(v) < 1024 ? v + ' bytes' : Math.round(Number(v) / 1024) + ' KB';
  const s = String(v);
  if (k === 'by') return UUID.test(s) ? 'a staff member' : s === 'system' || s === 'rule' ? 'automatic' : s.replace(/_/g, ' ');
  if (k === 'role' || k === 'kind' || k === 'reason' || k === 'mode' || k === 'status' || k === 'result') return s.replace(/_/g, ' ').slice(0, 120);
  return UUID.test(s) ? s.slice(0, 8) : s.slice(0, 80);
}
export function detailText(d) {
  if (d == null || d === '') return '';
  if (typeof d !== 'object') return String(d).replace(/_/g, ' ');
  const out = [];
  if (d.level != null && d.max != null) out.push('warning ' + d.level + ' of ' + d.max);
  Object.entries(d).forEach(([k, v]) => {
    if (v == null || v === '' || typeof v === 'object' || ((k === 'level' || k === 'max') && d.level != null && d.max != null)) return;
    out.push((DETAIL_LABEL[k] || k.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ').toLowerCase()) + ': ' + detailValue(k, v));
  });
  return out.slice(0, 6).join(' · ');
}
const Gate = ({ access, perms, title, need, children }) => {
  if (!access.ready) return <section className="panel"><StaffStyles />{access.error ? <LoadError error={access.error} what="your staff permissions" /> : <Loading />}</section>;
  if (!access.canAny(perms)) return <><StaffStyles /><NoAccess title={title} need={need} /></>;
  return <><StaffStyles />{children}</>;
};

/* ---------- payments ---------- */
const PAY_STATUS = { captured: ['Paid', 'ok'], authorized: ['Authorised, not taken yet', 'info'], refunded: ['Refunded', 'bad'] };
const sourceOf = s => (!s ? '' : s.startsWith('webhook') ? 'Gateway notification' : ['verify', 'stripe.confirm', 'paypal.capture'].includes(s) ? 'Checkout' : s.includes('refund') ? 'Refund' : s);
export function Payments() {
  const access = useStaffAccess();
  const [provider, setProvider] = useState('');
  const canOrders = access.can('orders.read');
  const ok = access.canAny(['orders.read', 'logs.read']);
  const p = useServer('/api/admin/payments' + qs({ provider, limit: 300 }), { skip: !ok });
  const o = useServer('/api/admin/orders?limit=500', { skip: !canOrders });
  const orders = Object.fromEntries(((o.data && o.data.orders) || []).map(x => [x.id, x]));
  const list = p.data ? p.data.payments || [] : [];
  const paid = list.filter(x => x.status === 'captured');
  /* the order's rupee total: from the payment row when the server sends it, else from the orders list */
  const orderInr = x => (x.orderTotalInr != null ? Number(x.orderTotalInr) : orders[x.orderId] && orders[x.orderId].totalInr != null ? Number(orders[x.orderId].totalInr) : null);
  const inrOf = x => (x.currency === 'INR' ? x.amount : orderInr(x));
  const inrKnown = paid.every(x => inrOf(x) != null);
  const inrTotal = paid.reduce((n, x) => n + (Number(inrOf(x)) || 0), 0);
  return (
    <Gate access={access} perms={['orders.read', 'logs.read']} title="Payments" need="orders.read or logs.read">
      <div className="kpi-row">
        <MetricCard label="Payments recorded" value={p.data ? count(list.length) + (list.length >= 300 ? '+' : '') : '…'} sub={provider ? GATEWAY[provider] + ' only' : 'all gateways'} icon="payments" />
        <MetricCard label="Taken" value={p.data ? (inrKnown ? rupees(inrTotal) : plural(paid.length, 'payment')) : '…'} sub={inrKnown ? 'in rupees, from ' + plural(paid.length, 'payment') : 'rupee totals need the orders permission'} icon="rupee" />
        <MetricCard label="Refunded" value={p.data ? count(list.filter(x => x.status === 'refunded').length) : '…'} sub="payments" icon="activity" />
        <MetricCard label="Last payment" value={list[0] ? ago(list[0].at) : p.data ? 'None yet' : '…'} sub={list[0] ? when(list[0].at) : ''} icon="clock" />
      </div>
      <section className="panel" aria-labelledby="lwPayTitle" data-section="payments">
        <PanelHead id="lwPayTitle" title="Payments" sub="Money the gateways confirmed, newest first. Amounts are shown as paid, with the rupee total of the order beside foreign currencies." />
        <Chips label="Gateway" value={provider} onChange={setProvider} options={[['', 'All'], ['razorpay', 'Razorpay'], ['stripe', 'Stripe'], ['paypal', 'PayPal']]} />
        <LoadError error={p.error} what="the payments" onRetry={p.reload} />
        {p.loading && !p.data ? <Loading>Loading payments…</Loading> : null}
        {p.data ? <CardTable caption="Payments" rows={list} rowKey={x => x.id} empty="No payments recorded yet." cols={[
          ['When', x => <span title={when(x.at)}>{when(x.at)}</span>],
          ['Customer', x => (x.email ? <span className="lw-mono">{x.email}</span> : <Missing />)],
          ['Order', x => <span className="lw-mono">{x.orderId}</span>],
          ['Gateway', x => GATEWAY[x.provider] || x.provider],
          ['Amount', x => { const inr = x.currency !== 'INR' ? orderInr(x) : null; return <span><b>{money(x.amount, x.currency)}</b>{inr != null ? <small className="lw-muted" style={{ display: 'block' }}>{rupees(inr)} order total</small> : null}</span>; }],
          ['Status', x => { const [l, t] = PAY_STATUS[x.status] || [x.status, 'neutral']; return <Tag tone={t}>{l}</Tag>; }],
          ['Recorded from', x => <span className="lw-small" style={{ color: 'var(--foreground)' }}>{sourceOf(x.source)}</span>],
          ['Payment id', x => <span className="lw-mono">{x.paymentId}</span>],
        ]} /> : null}
        {!canOrders && p.data && !inrKnown ? <p className="lw-small">Rupee order totals are shown to staff who can see orders.</p> : null}
      </section>
    </Gate>
  );
}

/* ---------- webhooks: payment notifications from the gateways ---------- */
const EV_STATUS = { processed: ['Handled', 'ok'], ignored: ['Not needed', 'neutral'], failed: ['Failed', 'bad'], received: ['Received, not handled yet', 'info'], logged: ['Logged', 'neutral'] };
export function Webhooks() {
  const access = useStaffAccess();
  const [provider, setProvider] = useState('');
  const [onlyBad, setOnlyBad] = useState(false);
  const ok = access.canAny(['logs.read', 'orders.read']);
  const { data, error, loading, reload } = useServer('/api/admin/payment-events' + qs({ provider, ok: onlyBad ? 'false' : '', limit: 300 }), { skip: !ok });
  const list = data ? data.events || [] : [];
  const now = Date.now();
  const day = list.filter(e => now - e.at < DAY);
  return (
    <Gate access={access} perms={['logs.read', 'orders.read']} title="Webhooks" need="logs.read">
      <div className="kpi-row">
        <MetricCard label="Notifications in 24 hours" value={data ? count(day.length) : '…'} sub={onlyBad ? 'problems only' : 'from all gateways'} icon="webhooks" />
        <MetricCard label="Problems in 24 hours" value={data ? count(day.filter(e => !e.ok).length) : '…'} sub="failed or refused" icon="errors" />
        <MetricCard label="Bad signatures" value={data ? count(list.filter(e => e.signatureOk === false).length) : '…'} sub="in the list below" icon="security" />
        <MetricCard label="Last notification" value={list[0] ? ago(list[0].at) : data ? 'None yet' : '…'} sub={list[0] ? GATEWAY[list[0].provider] || list[0].provider : ''} icon="clock" />
      </div>
      <section className="panel" aria-labelledby="lwHookTitle" data-section="webhooks">
        <PanelHead id="lwHookTitle" title="Payment notifications" sub="What Razorpay, Stripe and PayPal told the server, and what the server did with it. Only a fingerprint of each message is kept, not the message itself." />
        <div className="lw-bar">
          <Chips label="Gateway" value={provider} onChange={setProvider} options={[['', 'All'], ['razorpay', 'Razorpay'], ['stripe', 'Stripe'], ['paypal', 'PayPal']]} />
          <Chips label="Result" value={onlyBad ? 'bad' : 'all'} onChange={v => setOnlyBad(v === 'bad')} options={[['all', 'Everything'], ['bad', 'Problems only']]} />
        </div>
        <LoadError error={error} what="the notifications" onRetry={reload} />
        {loading && !data ? <Loading>Loading notifications…</Loading> : null}
        {data ? <CardTable caption="Payment notifications" rows={list} rowKey={e => e.id} rowProps={e => ({ 'data-ok': String(e.ok) })} empty={onlyBad ? 'No problems. Every notification was handled.' : 'No notifications received yet.'} cols={[
          ['Received', e => <span title={when(e.at)}>{when(e.at)}</span>],
          ['Gateway', e => GATEWAY[e.provider] || e.provider],
          ['Event', e => <span className="lw-mono">{e.type}</span>],
          ['Order', e => (e.orderId ? <span className="lw-mono">{e.orderId}</span> : <span className="lw-muted">None</span>)],
          ['Result', e => { const [l, t] = EV_STATUS[e.status] || [e.status, 'neutral']; return <Tag tone={e.ok ? t : 'bad'}>{e.ok ? l : l === 'Failed' ? l : 'Problem: ' + l.toLowerCase()}</Tag>; }],
          ['Signature', e => (e.signatureOk === true ? <Tag tone="ok">Genuine</Tag> : e.signatureOk === false ? <Tag tone="bad">Did not match</Tag> : <Tag tone="neutral">Not checked</Tag>)],
          ['Detail', e => (detailText(e.detail) ? <span className="lw-small" style={{ color: 'var(--foreground)' }}>{detailText(e.detail)}</span> : <span className="lw-muted">None</span>)],
        ]} /> : null}
      </section>
    </Gate>
  );
}

/* ---------- sign-ins ---------- */
export const LOGIN_REASON = {
  bad_credentials: 'Wrong email or password', account_locked: 'Locked after too many wrong passwords', email_unverified: 'Email not confirmed yet',
  account_blocked: 'Account is blocked', rate_limited: 'Too many tries, slowed down', auth_unavailable: 'The sign-in service did not answer',
  staff_only: 'Not a staff account', agreement_required: 'Had to accept the terms first',
};
export function Auth() {
  const access = useStaffAccess();
  const [failed, setFailed] = useState(false);
  const [text, setText] = useState('');
  const [email, setEmail] = useState('');
  useEffect(() => { const t = setTimeout(() => setEmail(text.trim().toLowerCase()), 400); return () => clearTimeout(t); }, [text]);
  const ok = access.canAny(['logs.read', 'security.read']);
  const { data, error, loading, reload } = useServer('/api/admin/login-activity' + qs({ success: failed ? 'false' : '', email: /@/.test(email) ? email : '', limit: 300 }), { skip: !ok });
  const list = data ? data.logins || [] : [];
  const now = Date.now();
  const day = list.filter(l => now - l.at < DAY);
  return (
    <Gate access={access} perms={['logs.read', 'security.read']} title="Authentication" need="logs.read">
      <div className="kpi-row">
        <MetricCard label="Sign-ins in 24 hours" value={data ? count(day.filter(l => l.success).length) : '…'} sub={failed ? 'showing failed only' : 'successful'} icon="auth" />
        <MetricCard label="Failed in 24 hours" value={data ? count(day.filter(l => !l.success).length) : '…'} sub="wrong password and other refusals" icon="errors" />
        <MetricCard label="Locked accounts" value={data ? count(new Set(list.filter(l => l.reason === 'account_locked').map(l => l.email)).size) : '…'} sub="in the list below" icon="security" />
        <MetricCard label="Last sign-in" value={list.find(l => l.success) ? ago(list.find(l => l.success).at) : data ? 'None yet' : '…'} sub={list.find(l => l.success) ? list.find(l => l.success).email : ''} icon="clock" />
      </div>
      <section className="panel" aria-labelledby="lwAuthTitle" data-section="auth">
        <PanelHead id="lwAuthTitle" title="Sign-in log" sub="Every sign-in attempt on the site and the staff pages, newest first." />
        <div className="lw-bar">
          <Chips label="Show" value={failed ? 'failed' : 'all'} onChange={v => setFailed(v === 'failed')} options={[['all', 'Everything'], ['failed', 'Failed only']]} />
          <input className="search" type="search" placeholder="Exact email address" aria-label="Show one email address" value={text} onChange={e => setText(e.target.value)} />
        </div>
        <LoadError error={error} what="the sign-in log" onRetry={reload} />
        {loading && !data ? <Loading>Loading sign-ins…</Loading> : null}
        {data ? <CardTable caption="Sign-in log" rows={list} rowKey={l => l.id} rowProps={l => ({ 'data-success': String(l.success) })} empty={failed ? 'No failed sign-ins.' : 'No sign-ins recorded yet.'} cols={[
          ['When', l => <span title={when(l.at)}>{when(l.at)}</span>],
          ['Email', l => <span className="lw-mono">{l.email}</span>],
          ['Result', l => (l.success ? <Tag tone="ok">Signed in</Tag> : <Tag tone="bad">{LOGIN_REASON[l.reason] || 'Refused' + (l.reason ? ' (' + l.reason + ')' : '')}</Tag>)],
          ['Device', l => uaShort(l.user_agent) || <Missing />],
          ['IP address', l => (l.ip ? <span className="lw-mono">{l.ip}</span> : <Missing />)],
        ]} /> : null}
      </section>
      <SessionControls />
    </Gate>
  );
}

/* ---------- security events and the sheet viewer log ---------- */
export const EVENT = {
  'security.incident_opened': ['A sharing rule noticed something', 'info'], 'security.incident_confirmed': ['Incident confirmed', 'bad'], 'security.incident_dismissed': ['Incident dismissed', 'neutral'],
  'security.incident_reported': ['Violation reported by staff', 'info'], 'security.warning': ['Warning given', 'bad'], 'security.warning_revoked': ['Warning removed', 'ok'],
  'security.warnings_reset': ['Warnings cleared', 'ok'], 'access.suspended': ['Paid access paused', 'bad'], 'access.restored': ['Paid access restored', 'ok'],
  account_blocked: ['Account blocked', 'bad'], account_unblocked: ['Account unblocked', 'ok'], account_locked: ['Locked after wrong passwords', 'bad'],
  password_reset_requested: ['Password reset asked for', 'info'], password_reset: ['Password changed with a reset link', 'info'],
  'payment.bad_signature': ['Payment notification with a bad signature', 'bad'], 'payment.rejected': ['Payment refused', 'bad'],
  'appeal.created': ['Appeal sent', 'info'], 'appeal.accepted': ['Appeal accepted', 'ok'], 'appeal.rejected': ['Appeal rejected', 'neutral'],
  'session.ended_by_customer': ['Customer ended a sign-in', 'neutral'], 'session.blocked': ['Sign-in blocked by staff', 'bad'], 'session.unblocked': ['Sign-in unblocked by staff', 'ok'],
  'sessions.ended_by_staff': ['Every sign-in ended by staff', 'bad'], signup: ['Account created', 'ok'], email_verified: ['Email confirmed', 'ok'],
  verification_resent: ['Confirmation email sent again', 'neutral'], logout: ['Signed out', 'neutral'], 'watermark.failed': ['Watermark could not be added', 'bad'],
  'staff.added': ['Staff member added', 'info'], 'staff.changed': ['Staff member changed', 'info'], 'staff.deactivated': ['Staff member removed', 'neutral'],
};
export const eventLabel = t => (EVENT[t] || [String(t || '').replace(/[._]/g, ' '), 'neutral']);
const ACTION = { access: 'Opened the viewer', meta: 'Loaded sheet details', pdf: 'Loaded the PDF', page: 'Loaded a page', print: 'Printed', download: 'Downloaded', view: 'Viewed' };

export function Security() {
  const access = useStaffAccess();
  const [tab, setTab] = useState('events');
  const [type, setType] = useState('');
  const ok = access.canAny(['logs.read', 'security.read']);
  const ev = useServer('/api/admin/security-events' + qs({ type, limit: 300 }), { skip: !ok || tab !== 'events' });
  const log = useServer('/api/admin/access-log?limit=300', { skip: !ok || tab !== 'viewer' });
  const [types, setTypes] = useState([]);
  useEffect(() => { if (ev.data && !type) setTypes(Array.from(new Set((ev.data.events || []).map(e => e.type))).sort()); }, [ev.data, type]);
  const events = ev.data ? ev.data.events || [] : [];
  const rows = log.data ? log.data.log || [] : [];
  return (
    <Gate access={access} perms={['logs.read', 'security.read']} title="Security" need="logs.read">
      <Tabs label="Security logs" value={tab} onChange={setTab} options={[['events', 'Security events'], ['viewer', 'Sheet viewer log']]} />
      {tab === 'events' ? (
        <section className="panel" aria-labelledby="lwSecEvTitle" data-section="security-events">
          <PanelHead id="lwSecEvTitle" title="Security events" sub="Sign-up, sign-in, warnings, blocks and other account events, newest first. Staff decisions are under Admin → Security." />
          <div className="lw-bar">
            <label className="check lw-small"><span>Show</span>
              <select value={type} onChange={e => setType(e.target.value)} aria-label="Event type" style={{ width: 'auto', height: 32 }}>
                <option value="">Every kind of event</option>
                {Array.from(new Set(types.concat(type ? [type] : []))).map(t => <option key={t} value={t}>{eventLabel(t)[0]}</option>)}
              </select>
            </label>
          </div>
          <LoadError error={ev.error} what="the security events" onRetry={ev.reload} />
          {ev.loading && !ev.data ? <Loading>Loading events…</Loading> : null}
          {ev.data ? <CardTable caption="Security events" rows={events} rowKey={e => e.id} rowProps={e => ({ 'data-type': e.type })} empty="No security events recorded yet." cols={[
            ['When', e => <span title={when(e.at)}>{when(e.at)}</span>],
            ['Customer', e => (e.email ? <span className="lw-mono">{e.email}</span> : <span className="lw-muted">None</span>)],
            ['What happened', e => { const [l, t] = eventLabel(e.type); return <Tag tone={t}>{l}</Tag>; }],
            ['Detail', e => (detailText(e.detail) ? <span className="lw-small" style={{ color: 'var(--foreground)' }}>{detailText(e.detail)}</span> : <span className="lw-muted">None</span>)],
            ['IP address', e => (e.ip ? <span className="lw-mono">{e.ip}</span> : <Missing />)],
          ]} /> : null}
        </section>
      ) : (
        <section className="panel" aria-labelledby="lwViewTitle" data-section="viewer-log">
          <PanelHead id="lwViewTitle" title="Sheet viewer log" sub="Each time a customer opened, printed or downloaded a sheet, and each refusal. The sharing rules read this log." />
          <LoadError error={log.error} what="the viewer log" onRetry={log.reload} />
          {log.loading && !log.data ? <Loading>Loading the viewer log…</Loading> : null}
          {log.data ? <CardTable caption="Sheet viewer log" rows={rows} rowKey={a => a.id} rowProps={a => ({ 'data-ok': String(a.ok) })} empty="No sheet has been opened yet." cols={[
            ['When', a => <span title={when(a.at)}>{when(a.at)}</span>],
            ['Customer', a => (a.email ? <span className="lw-mono">{a.email}</span> : <span className="lw-muted">Signed out</span>)],
            ['Sheet', a => (a.productId ? <span className="lw-mono">{a.productId}</span> : <Missing />)],
            ['What', a => ACTION[a.action] || a.action],
            ['Result', a => (a.ok ? <Tag tone="ok">Allowed</Tag> : <Tag tone="bad">{'Refused' + (a.detail ? ': ' + String(a.detail).replace(/_/g, ' ') : '')}</Tag>)],
            ['Where', a => ([a.network || a.ip, a.country].filter(Boolean).join(' · ') ? <span className="lw-mono">{[a.network || a.ip, a.country].filter(Boolean).join(' · ')}</span> : <Missing />)],
          ]} /> : null}
          {log.data && rows.length >= 300 ? <Note tone="neutral">Showing the newest 300 entries.</Note> : null}
        </section>
      )}
    </Gate>
  );
}
