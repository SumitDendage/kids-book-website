import MetricCard from '../../components/dashboard/MetricCard.jsx';
import DataTable from '../../components/dashboard/DataTable.jsx';
import { Fps } from '../../components/dashboard/LiveStats.jsx';
import { engineStats } from '../../services/frameEngine.js';

/* load, paint and frame timings */
export default function Performance() {
  const nav = performance.getEntriesByType('navigation')[0] || {}, fcp = performance.getEntriesByType('paint').find(p => p.name === 'first-contentful-paint');
  const rows = [['Frames loaded', engineStats.readyCount + ' of ' + engineStats.total], ['Frames in flight', engineStats.inflight], ['Device pixel ratio', devicePixelRatio], ['Viewport', innerWidth + ' × ' + innerHeight], ['Connection', (navigator.connection || {}).effectiveType || 'n/a'], ['Reduced motion', matchMedia('(prefers-reduced-motion: reduce)').matches ? 'yes' : 'no']];
  return (
    <>
      <div className="kpi-row five">
        <MetricCard label="DOM ready" value={Math.round(nav.domContentLoadedEventEnd || 0) + ' ms'} sub="DOMContentLoaded" icon="perf" />
        <MetricCard label="Load" value={Math.round(nav.loadEventEnd || 0) + ' ms'} sub="window load" icon="activity" />
        <MetricCard label="First paint" value={(fcp ? Math.round(fcp.startTime) : '—') + ' ms'} sub="first contentful paint" icon="image" />
        <MetricCard label="FPS" value={<Fps />} sub="measured live" icon="health" />
        <MetricCard label="HTML transfer" value={(Math.round(nav.transferSize / 1024) || '—') + ' KB'} sub="over the wire" icon="file" />
      </div>
      <section className="panel"><p className="eyebrow">Performance monitoring</p><DataTable plain head={['Metric', 'Value']} empty="" rows={rows.map(([k, v]) => ({ key: k, cells: [k, v] }))} /></section>
    </>
  );
}
