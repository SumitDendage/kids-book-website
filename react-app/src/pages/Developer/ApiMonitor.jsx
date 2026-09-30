import MetricCard from '../../components/dashboard/MetricCard.jsx';
import DataTable from '../../components/dashboard/DataTable.jsx';
import Pill from '../../components/dashboard/Pill.jsx';
import { useDash } from '../Portal/DashContext.js';
import { fmt } from '../Portal/dashboard.js';
import { read } from '../../services/storage.js';

/* every fetch() the page makes: URL, status, latency */
export default function ApiMonitor() {
  const { refresh } = useDash();
  const a = read('lww_api', []).slice().reverse(), ok = a.filter(x => x.status && x.status < 400).length;
  const ping = () => fetch('https://api.github.com/rate_limit').then(refresh, refresh);
  return (
    <>
      <div className="kpi-row">
        <MetricCard label="Requests" value={a.length} sub="fetch() calls this session" icon="api" />
        <MetricCard label="Success" value={(a.length ? Math.round(ok / a.length * 100) : 100) + '%'} sub={ok + ' ok'} icon="check" />
        <MetricCard label="Avg latency" value={(a.length ? Math.round(a.reduce((n, x) => n + x.ms, 0) / a.length) : 0) + ' ms'} sub="across all calls" icon="activity" />
        <MetricCard label="Failures" value={a.length - ok} sub="status ≥ 400 or network error" icon="errors" />
      </div>
      <section className="panel">
        <div className="row-between"><div><p className="eyebrow">API monitoring</p><p className="auth-sub">Every fetch() the page makes.</p></div><button type="button" className="btn btn-ghost btn-sm" onClick={ping}>Ping GitHub API</button></div>
        <DataTable head={['When', 'URL', 'Status', 'ms']} empty="No requests yet — API and payment calls will show here." filter="Filter requests…"
          rows={a.map((x, i) => ({ key: i, cells: [fmt(x.at), <span key="u" style={{ fontFamily: 'ui-monospace,Menlo,monospace', fontSize: '12px' }}>{x.url}</span>, x.status ? <Pill key="s" tone={x.status < 400 ? 'ok' : 'bad'}>{String(x.status)}</Pill> : <Pill key="s" tone="bad">failed</Pill>, x.ms] }))} />
      </section>
    </>
  );
}
