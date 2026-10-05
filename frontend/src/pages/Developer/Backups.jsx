import DataTable from '../../components/dashboard/DataTable.jsx';
import Icon from '../../components/dashboard/Icon.jsx';
import { useDash } from '../Portal/DashContext.js';
import { kb, log, lwwKeys, downloadBackup } from '../Portal/dashboard.js';

/* export everything the site keeps as one JSON file; restore it; wipe the demo data */
export default function Backups() {
  const { toast } = useDash();
  const restore = e => {
    const f = e.target.files[0]; if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      try { const j = JSON.parse(r.result); Object.keys(j).forEach(k => { if (k.startsWith('lww_')) localStorage.setItem(k, JSON.stringify(j[k])); }); log('backup restored', f.name); toast('Restored — reloading'); setTimeout(() => location.reload(), 600); }
      catch (_) { toast('That is not a Learn With Why backup'); }
    };
    r.readAsText(f);
  };
  const wipe = () => { if (confirm('Wipe all demo data in this browser?')) { lwwKeys().forEach(k => localStorage.removeItem(k)); location.reload(); } };
  return (
    <section className="panel"><p className="eyebrow">Backups</p><p className="auth-sub">Export everything the site keeps (customers, subscriptions, orders, products, logs) as one JSON file; import it on another machine or after a reset.</p>
      <div className="btn-row">
        <button type="button" className="btn btn-primary" onClick={downloadBackup}><Icon id="download" />Download backup</button>
        <label className="btn btn-ghost"><Icon id="upload" />Restore from file<input type="file" accept="application/json" hidden onChange={restore} /></label>
        <button type="button" className="btn btn-ghost btn-danger" onClick={wipe}><Icon id="trash" />Wipe demo data</button>
      </div>
      <DataTable plain head={['Table', 'Size']} empty="" rows={lwwKeys().map(k => ({ key: k, cells: [<b key="k">{k}</b>, kb((localStorage.getItem(k) || '').length)] }))} />
    </section>
  );
}
