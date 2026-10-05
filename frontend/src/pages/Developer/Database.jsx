import MetricCard from '../../components/dashboard/MetricCard.jsx';
import DataTable from '../../components/dashboard/DataTable.jsx';
import { Quota } from '../../components/dashboard/LiveStats.jsx';
import { kb, lwwKeys } from '../Portal/dashboard.js';

/* the demo tables (localStorage keys), their sizes and the browser quota */
export default function Database() {
  const keys = lwwKeys();
  const rows = keys.map(k => {
    const v = localStorage.getItem(k) || ''; let n = '';
    try { const j = JSON.parse(v); n = Array.isArray(j) ? j.length + ' rows' : typeof j === 'object' && j ? Object.keys(j).length + ' keys' : ''; } catch (_) {}
    return { key: k, cells: [<b key="k">{k}</b>, n, kb(v.length)] };
  });
  const total = keys.reduce((n, k) => n + (localStorage.getItem(k) || '').length, 0);
  return (
    <>
      <div className="kpi-row" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))' }}>
        <MetricCard label="Tables (keys)" value={keys.length} sub="localStorage keys" icon="db" />
        <MetricCard label="Used" value={kb(total)} sub="across all tables" icon="file" />
        <MetricCard label="Quota" value={<Quota />} sub="browser estimate" icon="activity" />
      </div>
      <section className="panel"><p className="eyebrow">Database health</p><p className="auth-sub">localStorage in demo mode. The real tables live in the server&apos;s SQLite database (database/data/lww.sqlite).</p><DataTable plain head={['Table', 'Size', 'Bytes']} empty="Empty." rows={rows} /></section>
    </>
  );
}
