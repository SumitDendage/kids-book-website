import MetricCard from '../../components/dashboard/MetricCard.jsx';
import DataTable from '../../components/dashboard/DataTable.jsx';
import Pill from '../../components/dashboard/Pill.jsx';
import { BarChart } from '../../components/dashboard/Charts.jsx';
import { Fps } from '../../components/dashboard/LiveStats.jsx';
import { fmt } from '../Portal/dashboard.js';
import { read } from '../../services/storage.js';
import { BOOT_AT } from '../../services/telemetry.js';
import { engineStats } from '../../services/frameEngine.js';
import { SITE_VERSION } from '../../data/content.js';

const storageOk = () => { try { localStorage.setItem('_t', '1'); localStorage.removeItem('_t'); return true; } catch (_) { return false; } };

/* system health at a glance */
export default function Health() {
  const errs = read('lww_errors', []), api = read('lww_api', []), up = Math.round((Date.now() - BOOT_AT) / 1000);
  const mem = performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) + ' MB' : 'n/a';
  const last = api.slice(-14);
  const checks = [
    ['Page script', <Pill key="p" tone="ok">ok</Pill>],
    ['Dashboard', <Pill key="d" tone="ok">loaded</Pill>],
    ['Frames', engineStats.painted ? <Pill key="f" tone="ok">painting</Pill> : <Pill key="f" tone="neutral">waiting</Pill>],
    ['Storage', storageOk() ? <Pill key="s" tone="ok">writable</Pill> : <Pill key="s" tone="bad">blocked</Pill>],
    ['Online', navigator.onLine ? <Pill key="o" tone="ok">online</Pill> : <Pill key="o" tone="bad">offline</Pill>],
    ['API errors', api.filter(a => !a.status || a.status >= 400).length],
    ['Version', SITE_VERSION],
  ];
  return (
    <>
      <div className="kpi-row five">
        <MetricCard label="Status" value={<span style={{ color: errs.length ? 'var(--destructive)' : 'var(--ok)' }}>{errs.length ? 'Degraded' : 'Healthy'}</span>} sub={errs.length + ' errors caught'} icon="health" />
        <MetricCard label="Session uptime" value={Math.floor(up / 60) + 'm ' + (up % 60) + 's'} sub="since the page opened" icon="activity" />
        <MetricCard label="JS heap" value={mem} sub="used memory" icon="db" />
        <MetricCard label="Frames resident" value={engineStats.readyCount + '/' + engineStats.total} sub="landscape frames in memory" icon="image" />
        <MetricCard label="FPS" value={<Fps />} sub="measured live" icon="perf" />
      </div>
      <div className="grid-7">
        <section className="panel span-4"><p className="eyebrow">API latency</p><p className="auth-sub">Milliseconds per request · last {Math.min(14, api.length) || 0}</p><BarChart series={last.map(x => x.ms)} labels={last.map(x => fmt(x.at))} color="var(--chart-2)" /></section>
        <section className="panel span-3"><p className="eyebrow">Checks</p><DataTable plain head={['Check', 'Result']} empty="" rows={checks.map(([k, v]) => ({ key: k, cells: [k, v] }))} /></section>
      </div>
    </>
  );
}
