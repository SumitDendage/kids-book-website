import MetricCard from '../../components/dashboard/MetricCard.jsx';
import DataTable from '../../components/dashboard/DataTable.jsx';
import { BarChart, Funnel } from '../../components/dashboard/Charts.jsx';
import { useDash } from '../Portal/DashContext.js';
import { events, orders, day, lastDays } from '../Portal/dashboard.js';
import { itemById } from '../../data/catalogue.js';

/* sales, visitors, the conversion funnel, top products and where visitors come from */
export default function Analytics() {
  const { go } = useDash();
  const ev = events(), os = orders(), days = lastDays(14);
  const visits = days.map(d => ev.filter(e => e.type === 'visit' && day(e.at) === d).length), sales = days.map(d => os.filter(o => day(o.at) === d).reduce((n, o) => n + o.amount, 0));
  const v = ev.filter(e => e.type === 'visit').length, su = ev.filter(e => e.type === 'signup').length, sub = os.length;
  const top = {}; ev.filter(e => e.type === 'print' || e.type === 'download').forEach(e => { top[e.item] = (top[e.item] || 0) + 1; });
  const topList = Object.entries(top).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const refs = {}; ev.filter(e => e.type === 'visit').forEach(e => { refs[e.ref || 'direct'] = (refs[e.ref || 'direct'] || 0) + 1; });
  return (
    <>
      <div className="tabs-s"><button type="button" onClick={() => go('overview')}>Overview</button><button type="button" className="on">Analytics</button><button type="button" disabled>Reports</button><button type="button" disabled>Notifications</button></div>
      <div className="kpi-row">
        <MetricCard label="Visits" value={v} sub="all time" icon="activity" />
        <MetricCard label="Sign-ups" value={su} sub="customer accounts" icon="users" />
        <MetricCard label="Subscriptions" value={sub} sub="orders placed" icon="card" />
        <MetricCard label="Conversion" value={(v ? (sub / v * 100).toFixed(1) : 0) + '%'} sub="visits → subscriptions" icon="analytics" />
      </div>
      <div className="grid-2">
        <section className="panel"><p className="eyebrow">Sales</p><p className="auth-sub">₹ per day · last 14 days</p><BarChart series={sales} labels={days} prefix="₹" small /></section>
        <section className="panel"><p className="eyebrow">Visitors</p><p className="auth-sub">Visits per day · last 14 days</p><BarChart series={visits} labels={days} color="var(--chart-2)" small /></section>
      </div>
      <div className="grid-2">
        <section className="panel"><p className="eyebrow">Conversion funnel</p><Funnel steps={[['Visited', v], ['Signed up', su], ['Subscribed', sub]]} /></section>
        <section className="panel"><p className="eyebrow">Top products</p><p className="auth-sub">Opens and prints</p><DataTable plain head={['Product', 'Uses']} empty="No activity yet." rows={topList.map(([id, n]) => ({ key: id, cells: [(itemById(id) || { title: id }).title, n] }))} /></section>
      </div>
      <section className="panel"><p className="eyebrow">Where visitors come from</p><DataTable plain head={['Source', 'Visits']} empty="No visits logged." rows={Object.entries(refs).sort((a, b) => b[1] - a[1]).map(([r, n]) => ({ key: r, cells: [r, n] }))} /></section>
    </>
  );
}
