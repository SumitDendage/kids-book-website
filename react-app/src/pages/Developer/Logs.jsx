import DataTable from '../../components/dashboard/DataTable.jsx';
import Pill from '../../components/dashboard/Pill.jsx';
import Icon from '../../components/dashboard/Icon.jsx';
import { useDash } from '../Portal/DashContext.js';
import { events, fmt, log } from '../Portal/dashboard.js';
import { read } from '../../services/storage.js';
import { money } from '../../services/currency.js';

/* the four log pages of the Developer panel: payments, webhooks, authentication, security */
export function Payments() {
  const p = read('lww_payments', []).slice().reverse();
  return (
    <section className="panel"><p className="eyebrow">Payment logs · {p.length}</p><p className="auth-sub">One row per gateway call.</p>
      <DataTable head={['When', 'Order', 'Gateway', 'Amount', 'Status']} empty="No payments yet." filter="Filter payments…"
        rows={p.map((x, i) => ({ key: i, cells: [fmt(x.at), <b key="o">{x.order}</b>, x.gateway, money(x.amount), <Pill key="s" tone="ok">{x.status}</Pill>] }))} />
    </section>
  );
}

export function Webhooks() {
  const w = read('lww_webhooks', []).slice().reverse();
  return (
    <section className="panel"><p className="eyebrow">Webhook logs · {w.length}</p><p className="auth-sub">Gateways call back here after a payment; the real endpoint verifies the signature and unlocks the subscription.</p>
      <DataTable head={['When', 'Gateway', 'Event', 'Order', 'Response']} empty="No webhooks yet." filter="Filter webhooks…"
        rows={w.map((x, i) => ({ key: i, cells: [fmt(x.at), x.gateway, x.event, x.order, <Pill key="s" tone="ok">{String(x.status)}</Pill>] }))} />
    </section>
  );
}

export function Auth() {
  const a = events().filter(e => ['signin', 'signup', 'signin_failed'].includes(e.type)).slice().reverse();
  return (
    <section className="panel"><p className="eyebrow">Authentication logs · {a.length}</p><p className="auth-sub">Customer sign-ins and sign-ups.</p>
      <DataTable head={['When', 'Event', 'Email']} empty="No sign-ins yet." filter="Filter…"
        rows={a.map((x, i) => ({ key: i, cells: [fmt(x.at), <Pill key="e" tone={x.type === 'signin_failed' ? 'bad' : 'ok'}>{x.type.replace('_', ' ')}</Pill>, x.email || x.who || ''] }))} />
    </section>
  );
}

export function Security() {
  const { refresh } = useDash();
  const s = read('lww_security', []).slice().reverse();
  const clear = () => { localStorage.removeItem('lww_security'); log('cleared', 'lww_security'); refresh(); };
  return (
    <section className="panel">
      <div className="row-between"><div><p className="eyebrow">Security events · {s.length}</p><p className="auth-sub">Failed logins and suspicious activity.</p></div><button type="button" className="btn btn-ghost btn-sm" onClick={clear}><Icon id="trash" />Clear</button></div>
      <DataTable head={['When', 'Event', 'Email', 'Where']} empty="No failed logins or suspicious activity." filter="Filter events…"
        rows={s.map((x, i) => ({ key: i, cells: [fmt(x.at), <Pill key="e" tone="bad">{x.type.replace(/_/g, ' ')}</Pill>, x.email || '', x.where || ''] }))} />
    </section>
  );
}
