import DataTable from '../../components/dashboard/DataTable.jsx';
import Pill from '../../components/dashboard/Pill.jsx';
import { useDash } from '../Portal/DashContext.js';
import { save, log, PERMS, DEFAULT_ROLES } from '../Portal/dashboard.js';
import { read } from '../../services/storage.js';

/* roles & permissions, and which role each staff account has */
export default function Roles() {
  const { refresh } = useDash();
  const roles = read('lww_roles', DEFAULT_ROLES), staff = read('lww_staff_users', []), names = Object.keys(roles);
  const setPerm = (role, perm, on) => { const all = read('lww_roles', DEFAULT_ROLES), set = new Set(all[role] || []); if (on) set.add(perm); else set.delete(perm); all[role] = Array.from(set); save('lww_roles', all); log('permission ' + (on ? 'granted' : 'removed'), role + ':' + perm); refresh(); };
  const setStaffRole = (email, role) => { const all = read('lww_staff_users', []), u = all.find(x => x.email === email); if (u) { u.rolename = role; save('lww_staff_users', all); log('staff role', email + ' → ' + role); refresh(); } };
  return (
    <>
      <section className="panel"><p className="eyebrow">Roles &amp; permissions</p><p className="auth-sub">Tick what each role may open. Admin always has everything except the developer panel.</p>
        <div className="tbl-wrap"><table className="table">
          <thead><tr><th>Permission</th>{names.map(r => <th key={r} style={{ textTransform: 'capitalize' }}>{r}</th>)}</tr></thead>
          <tbody>{PERMS.map(pm => <tr key={pm}><td style={{ textTransform: 'capitalize' }}>{pm}</td>{names.map(r => <td key={r}><input type="checkbox" aria-label={r + ' may open ' + pm} checked={roles[r].includes(pm)} disabled={r === 'admin' && pm !== 'developer'} onChange={e => setPerm(r, pm, e.target.checked)} /></td>)}</tr>)}</tbody>
        </table></div>
      </section>
      <section className="panel"><p className="eyebrow">Staff accounts</p><p className="auth-sub">Staff sign up from the links in the site footer.</p>
        <DataTable plain head={['Name', 'Email', 'Signed up as', 'Role']} empty="No staff accounts yet."
          rows={staff.map(u => ({ key: u.kind + u.email, cells: [<b key="n">{u.name}</b>, u.email, <Pill key="k" tone="neutral">{u.kind}</Pill>, <select key="r" aria-label={'Role of ' + u.email} value={u.rolename || (u.kind === 'developer' ? 'developer' : 'admin')} onChange={e => setStaffRole(u.email, e.target.value)}>{names.map(r => <option key={r} value={r}>{r}</option>)}</select>] }))} />
      </section>
    </>
  );
}
