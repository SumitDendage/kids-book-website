import MetricCard from '../../components/dashboard/MetricCard.jsx';
import DataTable from '../../components/dashboard/DataTable.jsx';
import Pill from '../../components/dashboard/Pill.jsx';
import Icon from '../../components/dashboard/Icon.jsx';
import { useDash } from '../Portal/DashContext.js';
import { users, orders, fmt, initialsOf } from '../Portal/dashboard.js';
import { read } from '../../services/storage.js';
import { money } from '../../services/currency.js';
import { classById, planOf, roleOf } from '../../data/content.js';
import { itemById } from '../../data/catalogue.js';

const clsLabel = id => (classById(id) || { label: id }).label;
const sum = obj => Object.values(obj || {}).reduce((n, v) => n + v, 0);

/* one customer's profile: orders, spending, downloads, prints, subscriptions */
function CustomerCard({ u, subsAll, os, prints, ownedAll, onClose }) {
  const uo = os.filter(o => o.email === u.email), pu = prints[u.email] || {};
  return (
    <section className="panel">
      <div className="row-between">
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}><span className="av round" style={{ width: '40px', height: '40px', fontSize: '14px' }}>{initialsOf(u.name)}</span><div><h3 className="card-title">{u.name}</h3><p className="auth-sub">{u.email} · {roleOf(u.role).label} · joined {fmt(u.created || Date.now())}</p></div></div>
        <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}><Icon id="x" /></button>
      </div>
      <div className="kpi-row">
        <MetricCard label="Orders" value={uo.length} icon="orders" />
        <MetricCard label="Total spending" value={money(uo.reduce((n, o) => n + o.amount, 0))} icon="rupee" />
        <MetricCard label="Downloads" value={(ownedAll[u.email] || []).length} icon="download" />
        <MetricCard label="Prints" value={sum(pu)} icon="file" />
      </div>
      <div className="grid-2">
        <div><p className="eyebrow" style={{ marginBottom: '8px' }}>Subscriptions</p><DataTable plain head={['Class', 'Plan', 'Since', 'Status']} empty="None." rows={(subsAll[u.email] || []).map((x, i) => ({ key: i, cells: [clsLabel(x.cls), planOf(x.plan).label, fmt(x.start || x.at), <Pill key="p" tone={x.revoked ? 'bad' : 'ok'}>{x.revoked ? 'revoked' : 'active'}</Pill>] }))} /></div>
        <div><p className="eyebrow" style={{ marginBottom: '8px' }}>Orders</p><DataTable plain head={['Order', 'When', 'Amount', 'Status']} empty="None." rows={uo.map(o => ({ key: o.id, cells: [o.id, fmt(o.at), money(o.amount), <Pill key="p">{o.status}</Pill>] }))} /></div>
      </div>
      <div><p className="eyebrow" style={{ marginBottom: '8px' }}>Print usage</p><DataTable plain head={['Sheet', 'Prints']} empty="Nothing printed yet." rows={Object.keys(pu).map(id => ({ key: id, cells: [(itemById(id) || { title: id }).title, pu[id]] }))} /></div>
    </section>
  );
}

/* every account that signed up, with a profile card */
export default function Customers() {
  const { custOpen, setCustOpen, portalRef } = useDash();
  const us = users(), subsAll = read('lww_subs', {}), os = orders(), prints = read('lww_prints', {}), ownedAll = read('lww_owned', {});
  const detail = custOpen && us.find(u => u.email === custOpen);
  const open = email => { setCustOpen(email); if (portalRef.current) portalRef.current.scrollTo({ top: 0, behavior: 'smooth' }); };
  return (
    <>
      {detail ? <CustomerCard u={detail} subsAll={subsAll} os={os} prints={prints} ownedAll={ownedAll} onClose={() => setCustOpen(null)} /> : null}
      <section className="panel"><p className="eyebrow">Customer list · {us.length}</p><p className="auth-sub">Every account that signed up on the site.</p>
        <DataTable head={['Name', 'Email', 'Role', 'Subscriptions', 'Orders', 'Total spent', 'Downloads', 'Prints', '']} empty="No customers yet." filter="Filter customers…"
          rows={us.map(u => {
            const uo = os.filter(o => o.email === u.email), act = (subsAll[u.email] || []).filter(x => !x.revoked);
            return { key: u.email, cells: [
              <span key="n" style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}><span className="av round" style={{ width: '28px', height: '28px', fontSize: '11px' }}>{initialsOf(u.name)}</span><b>{u.name}</b></span>,
              u.email, <Pill key="r" tone="neutral">{roleOf(u.role).label}</Pill>,
              <span key="s">{act.length ? act.map((x, i) => <span key={i}>{i ? ' ' : ''}<Pill tone="ok">{clsLabel(x.cls)}</Pill></span>) : <Pill tone="neutral">none</Pill>}</span>,
              uo.length, money(uo.reduce((n, o) => n + o.amount, 0)), (ownedAll[u.email] || []).length, sum(prints[u.email]),
              <button key="b" type="button" className="link" onClick={() => open(u.email)}>Profile</button>,
            ] };
          })} />
      </section>
    </>
  );
}
