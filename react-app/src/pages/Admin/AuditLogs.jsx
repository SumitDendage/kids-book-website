import DataTable from '../../components/dashboard/DataTable.jsx';
import Icon from '../../components/dashboard/Icon.jsx';
import { useDash } from '../Portal/DashContext.js';
import { log, fmt } from '../Portal/dashboard.js';
import { read } from '../../services/storage.js';

/* everything staff changed, newest first — shared by the Admin and Developer panels */
export default function AuditLogs() {
  const { refresh } = useDash();
  const a = read('lww_audit', []).slice().reverse();
  const clear = () => { localStorage.removeItem('lww_audit'); log('cleared', 'lww_audit'); refresh(); };
  return (
    <section className="panel">
      <div className="row-between"><div><p className="eyebrow">Audit logs · {a.length}</p><p className="auth-sub">Newest first.</p></div><button type="button" className="btn btn-ghost btn-sm" onClick={clear}><Icon id="trash" />Clear</button></div>
      <DataTable head={['When', 'Who', 'Action', 'Detail']} empty="Nothing logged yet." filter="Filter logs…" rows={a.map((x, i) => ({ key: i, cells: [fmt(x.at), x.actor, <b key="a">{x.action}</b>, x.detail] }))} />
    </section>
  );
}
