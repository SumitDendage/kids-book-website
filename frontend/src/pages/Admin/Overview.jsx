import MetricCard from '../../components/dashboard/MetricCard.jsx';
import DataTable from '../../components/dashboard/DataTable.jsx';
import Pill from '../../components/dashboard/Pill.jsx';
import { BarChart } from '../../components/dashboard/Charts.jsx';
import { useDash } from '../Portal/DashContext.js';
import { orders, events, day, lastDays, fmt, initialsOf } from '../Portal/dashboard.js';
import { read } from '../../services/storage.js';
import { money } from '../../services/currency.js';
import { classById, planOf } from '../../data/content.js';

/* Dashboard: revenue, subscriptions, sales, visitors today; the sales chart and the latest orders */
export default function Overview() {
  const { go } = useDash();
  const os = orders(), good = os.filter(o => o.status !== 'cancelled' && o.status !== 'refunded'), rev = good.reduce((n, o) => n + o.amount, 0);
  const ev = events(), subs = Object.values(read('lww_subs', {})).flat().filter(x => !x.revoked && !x.ended);
  const days = lastDays(14), salesS = days.map(d => os.filter(o => day(o.at) === d).reduce((n, o) => n + o.amount, 0));
  const delta = (arr, unit) => { const a = arr.slice(-7).reduce((n, v) => n + v, 0), b = arr.slice(-14, -7).reduce((n, v) => n + v, 0); return b ? (a >= b ? '+' : '') + Math.round((a - b) / b * 100) + '% from last week' : (a ? '+' + a + (unit || '') + ' this week' : 'No change'); };
  const today = ev.filter(e => e.type === 'visit' && day(e.at) === day(Date.now())).length, hour = ev.filter(e => e.type === 'visit' && e.at > Date.now() - 36e5).length;
  const recent = os.slice(-5).reverse(), classes = new Set(subs.map(x => x.cls)).size;
  return (
    <>
      <div className="tabs-s"><button type="button" className="on">Overview</button><button type="button" onClick={() => go('analytics')}>Analytics</button><button type="button" disabled>Reports</button><button type="button" disabled>Notifications</button></div>
      <div className="kpi-row">
        <MetricCard label="Total Revenue" value={money(rev)} sub={delta(salesS)} icon="rupee" />
        <MetricCard label="Subscriptions" value={'+' + subs.length} sub={subs.length ? 'across ' + classes + (classes === 1 ? ' class' : ' classes') : 'None active yet'} icon="users" />
        <MetricCard label="Sales" value={'+' + good.length} sub={delta(days.map(d => os.filter(o => day(o.at) === d).length))} icon="card" />
        <MetricCard label="Active Now" value={'+' + today} sub={'+' + hour + ' since last hour'} icon="activity" />
      </div>
      <div className="grid-7">
        <section className="panel span-4"><p className="eyebrow">Overview</p><BarChart series={salesS} labels={days} prefix="₹" /></section>
        <section className="panel span-3"><p className="eyebrow">Recent Sales</p><p className="auth-sub">You made {good.length} {good.length === 1 ? 'sale' : 'sales'} in total.</p>
          {recent.length ? <div className="sales">{recent.map(o => <div key={o.id} className="sale"><span className="av round">{initialsOf(o.name || o.email)}</span><div className="who"><div><p className="nm">{o.name || o.email.split('@')[0]}</p><p className="em">{o.email}</p></div><span className="amt">+{money(o.amount)}</span></div></div>)}</div> : <p className="cart-empty">No sales yet — they appear here when a customer subscribes.</p>}
        </section>
      </div>
      <section className="panel"><p className="eyebrow">Latest orders</p><p className="auth-sub">The six most recent orders. Open Orders to change a status.</p>
        <DataTable head={['Order', 'Customer', 'Class · plan', 'Amount', 'Status', 'When']} plain empty="No orders yet."
          rows={os.slice(-6).reverse().map(o => ({ key: o.id, cells: [<b key="i">{o.id}</b>, o.email, (classById(o.cls) || { label: o.cls }).label + ' · ' + planOf(o.plan).label, money(o.amount), <Pill key="s">{o.status}</Pill>, fmt(o.at)] }))} />
      </section>
    </>
  );
}
