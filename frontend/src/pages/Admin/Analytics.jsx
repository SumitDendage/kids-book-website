import { useState } from 'react';
import MetricCard from '../../components/dashboard/MetricCard.jsx';
import DataTable from '../../components/dashboard/DataTable.jsx';
import { BarChart, Funnel, LineChart, Donut, RankBars } from '../../components/dashboard/Charts.jsx';
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
            <MetricCard label="Revenue" value={inr(t.revenueInr)} sub={plural(t.paidOrders, 'paid order') + (t.refundedInr ? ' · ' + inr(t.refundedInr) + ' refunded' : '')} icon="rupee" trend={byDay.map(d => d.revenueInr || 0)} />
            <MetricCard label="Visitors" value={t.visitors} sub={plural(t.pageViews, 'page view')} icon="activity" trend={byDay.map(d => d.visitors || 0)} />
            <MetricCard label="Sign-ups" value={t.signups} sub={t.verifiedSignups + ' confirmed their email'} icon="users" trend={byDay.map(d => d.signups || 0)} trendColor="var(--viz-3)" />
            <MetricCard label="Conversion" value={pct(a.conversion.visitorsPct)} sub="paid orders per 100 visitors" icon="analytics" />
          </div>
          <div className="grid-2">
            <section className="panel"><p className="eyebrow">Sales</p><p className="auth-sub">Paid orders in rupees, per day.</p><BarChart series={byDay.map(d => d.revenueInr || 0)} labels={byDay.map(d => d.day)} prefix="₹" color="var(--viz-1)" small empty="No sales in this period yet." /></section>
            <section className="panel"><p className="eyebrow">Visitors</p><p className="auth-sub">Different visitors and pages they opened, per day. Point at a day to see its numbers.</p>
              <LineChart labels={byDay.map(d => d.day)} series={[{ name: 'Visitors', values: byDay.map(d => d.visitors || 0) }, { name: 'Page views', values: byDay.map(d => d.pageViews || 0) }]} empty="No visits in this period yet." /></section>
          </div>
          <div className="grid-2">
            <section className="panel"><p className="eyebrow">Shop activity</p><p className="auth-sub">Sheets looked at, checkouts started and sheets opened, per day.</p>
              <LineChart labels={byDay.map(d => d.day)} series={[{ name: 'Sheets looked at', values: byDay.map(d => d.productViews || 0) }, { name: 'Checkouts started', values: byDay.map(d => d.checkoutStarts || 0), color: 'var(--viz-2)' }, { name: 'Sheets opened', values: byDay.map(d => d.sheetOpens || 0), color: 'var(--viz-3)' }]} empty="Nothing happened in the shop in this period yet." /></section>
            <section className="panel"><p className="eyebrow">Sign-ups</p><p className="auth-sub">New customer accounts per day.</p>
              <BarChart series={byDay.map(d => d.signups || 0)} labels={byDay.map(d => d.day)} color="var(--viz-3)" small empty="No sign-ups in this period yet." /></section>
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
            <section className="panel"><p className="eyebrow">Most viewed sheets</p><p className="auth-sub">Views in this period; the small number is different visitors.</p>
              <RankBars rows={(a.mostViewed || []).map(p => [p.title || p.id, p.views, plural(p.visitors, 'visitor')])} empty="No sheet views in this period." /></section>
            <section className="panel"><p className="eyebrow">Countries</p><p className="auth-sub">Visitors by country.</p>
              <RankBars rows={(a.byCountry || []).map(c => [c.country || 'Unknown', c.visitors, c.paidOrders ? plural(c.paidOrders, 'paid order') + ' · ' + inr(c.revenueInr) : ''])} color="var(--viz-3)" empty="No visits in this period." /></section>
          </div>
          <div className="grid-2">
            <section className="panel"><p className="eyebrow">Where visitors come from</p><p className="auth-sub">Visitors by the site that sent them.</p>
              <RankBars rows={(a.referrers || []).map(r => [r.host || 'Typed the address or a bookmark', r.visitors, plural(r.pageViews, 'page view')])} color="var(--viz-2)" empty="No visits in this period." /></section>
            <section className="panel"><p className="eyebrow">Devices</p><p className="auth-sub">Visitors by the kind of device they used.</p>
              <Donut parts={(a.devices || []).map(d => [DEVICE[d.device] || d.device, d.visitors])} sub="visitors" empty="No visits in this period." /></section>
          </div>
        </> : null}
      </Guard>
    </>
  );
}
