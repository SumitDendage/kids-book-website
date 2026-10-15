import MetricCard from '../../components/dashboard/MetricCard.jsx';
import DataTable from '../../components/dashboard/DataTable.jsx';
import { Fps } from '../../components/dashboard/LiveStats.jsx';
import { engineStats } from '../../services/frameEngine.js';
import { StaffStyles, Note } from './common.jsx';

/* Developer → Performance: load, paint and frame timings of this page load, measured in this
   browser only. They say nothing about how fast the site is for visitors. */
export default function Performance() {
  const nav = performance.getEntriesByType('navigation')[0] || {}, fcp = performance.getEntriesByType('paint').find(p => p.name === 'first-contentful-paint');
  const msOf = v => (v ? Math.round(v) + ' ms' : 'Not measured');
  const rows = [
    ['Animation frames loaded', engineStats.readyCount + ' of ' + engineStats.total], ['Animation frames still loading', engineStats.inflight],
    ['Screen pixel ratio', devicePixelRatio], ['Window size', innerWidth + ' × ' + innerHeight],
    ['Connection type (as the browser reports it)', (navigator.connection || {}).effectiveType || 'Not reported'], ['Reduced motion asked for', matchMedia('(prefers-reduced-motion: reduce)').matches ? 'Yes' : 'No'],
  ];
  return (
    <>
      <StaffStyles />
      <Note tone="info">Measured in this browser, for this visit only. These numbers are not collected from visitors and do not show how fast the site is for them.</Note>
      <div className="kpi-row five">
        <MetricCard label="Page ready" value={msOf(nav.domContentLoadedEventEnd)} sub="measured in this browser" icon="perf" />
        <MetricCard label="Fully loaded" value={msOf(nav.loadEventEnd)} sub="measured in this browser" icon="activity" />
        <MetricCard label="First paint" value={fcp ? Math.round(fcp.startTime) + ' ms' : 'Not measured'} sub="first content on screen" icon="image" />
        <MetricCard label="Frames per second" value={<Fps />} sub="live, in this browser" icon="health" />
        <MetricCard label="Page size" value={nav.transferSize ? Math.round(nav.transferSize / 1024) + ' KB' : 'Not measured'} sub="HTML downloaded for this visit" icon="backups" />
      </div>
      <section className="panel"><p className="eyebrow">Measured in this browser</p><DataTable plain head={['Measure', 'Value']} empty="" rows={rows.map(([k, v]) => ({ key: k, cells: [k, v] }))} /></section>
    </>
  );
}
