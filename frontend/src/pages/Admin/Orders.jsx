import DataTable from '../../components/dashboard/DataTable.jsx';
import { useDash } from '../Portal/DashContext.js';
import { orders, save, log, fmt, adminKey, adminApi, sync, ORDER_STATUS } from '../Portal/dashboard.js';
import { money } from '../../services/currency.js';
import { classById, planOf } from '../../data/content.js';
import { itemById } from '../../data/catalogue.js';

/* every order, newest first; the status can be changed (and is written back to the server) */
export default function Orders() {
  const { toast, refresh } = useDash();
  const os = orders().slice().reverse(), counts = ORDER_STATUS.map(st => [st, os.filter(o => o.status === st).length]);
  const setStatus = (id, status) => {
    const all = orders(), o = all.find(x => x.id === id); if (!o) return;
    o.status = status; save('lww_orders', all); log('order ' + status, id); toast(id + ' → ' + status);
    if (adminKey()) adminApi('PUT', '/api/admin/orders', { id, status: { pending: 'created', paid: 'paid', cancelled: 'cancelled', refunded: 'refunded' }[status] || 'paid' }).catch(err => toast('Server: ' + err.message));
    refresh();
  };
  return (
    <>
      <div className="kpi-row" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(110px,1fr))' }}>{counts.map(([st, n]) => <div key={st} className="stat"><b>{n}</b><span>{st}</span></div>)}</div>
      <section className="panel"><p className="eyebrow">Orders · {os.length}</p>
        <p className="auth-sub">{adminKey() ? 'Live from the database' + (sync.at ? ' · synced ' + fmt(sync.at) : '') + '.' : 'Showing this browser\'s copy — save the admin key under Settings → Server connection to load the database.'} Orders are digital, so a verified payment goes straight to <b>paid</b>. Change a status and it is written to the audit log.</p>
        <DataTable head={['Order', 'When', 'Customer', 'Class · plan', 'Gateway', 'Amount', 'Status']} empty="No orders yet — they appear when a customer subscribes." filter="Filter orders…"
          rows={os.map(o => ({ key: o.id, cells: [
            <b key="i">{o.id}</b>, fmt(o.at),
            <span key="c">{o.name}<br /><small>{o.email}</small></span>,
            <span key="w">{o.worksheet ? 'PDF · ' + (itemById(o.worksheet) || { title: o.worksheet }).title : (classById(o.cls) || { label: o.cls }).label + ' · ' + planOf(o.plan).label}{o.coupon ? <><br /><small>coupon {o.coupon}</small></> : null}</span>,
            o.method, money(o.amount),
            <select key="s" value={o.status} aria-label={'Status of ' + o.id} onChange={e => setStatus(o.id, e.target.value)}>{ORDER_STATUS.map(st => <option key={st} value={st}>{st}</option>)}</select>,
          ] }))} />
      </section>
    </>
  );
}
