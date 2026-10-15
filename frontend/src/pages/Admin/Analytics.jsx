import { useState } from 'react';
import MetricCard from '../../components/dashboard/MetricCard.jsx';
import DataTable from '../../components/dashboard/DataTable.jsx';
import { BarChart, Funnel } from '../../components/dashboard/Charts.jsx';
import { Guard, ErrorNote } from '../../components/dashboard/States.jsx';
import { useDash } from '../Portal/DashContext.js';
import { useStaffGet, inr, qs, tzName, dateOnly, plural } from '../Portal/dashboard.js';

const RANGES = [[7, '7 days'], [14, '14 days'], [30, '30 days'], [90, '90 days'], [365, 'A year']];
const keep = { days: 30 };
const pct = v => (v == null ? 'None yet' : (Math.round(v * 10) / 10) + '%');
const DEVICE = { desktop: 'Computer', mobile: 'Phone', tablet: 'Tablet', bot: 'Robot', unknown: 'Unknown' };

/* Analytics from the server (GET /api/admin/analytics): sales, visitors, the path from a visit to
   a paid order, the best sellers, and where visitors come from. Days follow the staff member's
   own time zone. */
export default function Analytics() {
  const { go, allowed } = useDash();
  const [days, setDaysState] = useState(keep.days);
  const setDays = n => { keep.days = n; setDaysState(n); };
  const q = useStaffGet('/api/admin/analytics' + qs({ days, tz: tzName() }), { keep: true });
  const a = q.data;
  const t = a ? a.totals : null;
  const byDay = a ? a.byDay || [] : [];
  return (
    <>
      <div className="row-between tabs-row">
        <div className="tabs-s">{allowed('overview') ? <button type="button" onClick={() => go('overview')}>Overview</button> : null}<button type="button" className="on">Analytics</button></div>
        <div className="chips" role="group" aria-label="Period">{RANGES.map(([n, l]) => <button key={n} type="button" className={'chip' + (days === n ? ' on' : '')} onClick={() => setDays(n)}>{l}</button>)}</div>
      </div>
      <Guard state={q} rows={8}>
        {q.error ? <ErrorNote error={q.error} onRetry={q.reload} compact /> : null}
        {a ? <>
          <p className="auth-sub range-note">{dateOnly(a.range.from)} to {dateOnly(a.range.to - 1)} · {a.range.tz}{q.loading ? ' · updating…' : ''}{a.hasData ? '' : ' · nothing counted in this period yet'}</p>
          {a.note ? <div className="st-note info compact"><span>{a.note}</span></div> : null}
          <div className="kpi-row">
            <MetricCard label="Revenue" value={inr(t.revenueInr)} sub={plural(t.paidOrders, 'paid order') + (t.refundedInr ? ' · ' + inr(t.refundedInr) + ' refunded' : '')} icon="rupee" />
            <MetricCard label="Visitors" value={t.visitors} sub={plural(t.pageViews, 'page view')} icon="activity" />
            <MetricCard label="Sign-ups" value={t.signups} sub={t.verifiedSignups + ' confirmed their email'} icon="users" />
            <MetricCard label="Conversion" value={pct(a.conversion.visitorsPct)} sub="paid orders per 100 visitors" icon="analytics" />
          </div>
          <div className="grid-2">
            <section className="panel"><p className="eyebrow">Sales</p><p className="auth-sub">Paid orders in rupees, per day.</p><BarChart series={byDay.map(d => d.revenueInr || 0)} labels={byDay.map(d => d.day)} prefix="₹" small /></section>
            <section className="panel"><p className="eyebrow">Visitors</p><p className="auth-sub">Different visitors per day.</p><BarChart series={byDay.map(d => d.visitors || 0)} labels={byDay.map(d => d.day)} color="var(--chart-2)" small /></section>
          </div>
          <div className="grid-2">
            <section className="panel"><p className="eyebrow">From a visit to a paid order</p>
              <Funnel steps={[['Visited', t.visitors], ['Looked at a sheet', t.productViews], ['Started checkout', t.checkoutVisitors || t.checkoutStarts], ['Paid', t.buyers || t.paidOrders]]} />
              <div className="kv">
                <span>Paid per 100 checkouts</span><b>{pct(a.conversion.checkoutsPct)}</b>
                <span>Sign-ups per 100 visitors</span><b>{pct(a.conversion.signupsPct)}</b>
                <span>Average order</span><b>{t.averageOrderInr == null ? 'None yet' : inr(t.averageOrderInr)}</b>
                <span>Sheets opened</span><b>{t.sheetOpens}</b>
                <span>Searches</span><b>{t.searches}</b>
              </div>
            </section>
            <section className="panel"><p className="eyebrow">Best sellers</p><p className="auth-sub">Sheets by paid orders in this period.</p>
              <DataTable plain head={['Sheet', 'Sold', 'Buyers', 'Revenue', 'Views']} empty="No sheets sold in this period."
                rows={(a.topProducts || []).map(p => ({ key: p.id, cells: [p.title || p.id, p.units, p.buyers, inr(p.revenueInr), p.views] }))} />
              {(a.topPlans || []).length ? <><p className="eyebrow" style={{ marginTop: 16 }}>Class plans</p>
                <DataTable plain head={['Class', 'Plan', 'Sold', 'Revenue']} empty="" rows={a.topPlans.map(p => ({ key: p.cls + p.plan, cells: [p.cls, p.plan, p.units, inr(p.revenueInr)] }))} /></> : null}
            </section>
          </div>
          <div className="grid-2">
            <section className="panel"><p className="eyebrow">Most viewed sheets</p>
              <DataTable plain head={['Sheet', 'Views', 'Visitors']} empty="No sheet views in this period." rows={(a.mostViewed || []).map(p => ({ key: p.id, cells: [p.title || p.id, p.views, p.visitors] }))} /></section>
            <section className="panel"><p className="eyebrow">Countries</p>
              <DataTable plain head={['Country', 'Visitors', 'Paid orders', 'Revenue']} empty="No visits in this period." rows={(a.byCountry || []).map(c => ({ key: c.country || '?', cells: [c.country || 'Unknown', c.visitors, c.paidOrders, inr(c.revenueInr)] }))} /></section>
          </div>
          <div className="grid-2">
            <section className="panel"><p className="eyebrow">Where visitors come from</p>
              <DataTable plain head={['Source', 'Visitors', 'Page views']} empty="No visits from other sites in this period." rows={(a.referrers || []).map(r => ({ key: r.host || 'direct', cells: [r.host || 'Typed the address or a bookmark', r.visitors, r.pageViews] }))} /></section>
            <section className="panel"><p className="eyebrow">Devices</p>
              <DataTable plain head={['Device', 'Visitors']} empty="No visits in this period." rows={(a.devices || []).map(d => ({ key: d.device, cells: [DEVICE[d.device] || d.device, d.visitors] }))} /></section>
          </div>
        </> : null}
      </Guard>
    </>
  );
}
