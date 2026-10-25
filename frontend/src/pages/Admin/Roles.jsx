import { useMemo, useState } from 'react';
import DataTable from '../../components/dashboard/DataTable.jsx';
import Pill from '../../components/dashboard/Pill.jsx';
import Icon from '../../components/dashboard/Icon.jsx';
import Modal from '../../components/dashboard/Modal.jsx';
import { Guard, ErrorNote } from '../../components/dashboard/States.jsx';
import { useDash } from '../Portal/DashContext.js';
import { useStaffGet, fmt, ago, initialsOf, problem, fieldErrors, plural, ROLE_LABEL } from '../Portal/dashboard.js';
import { staffApi } from '../../services/api.js';

/* the permissions in groups, in plain words (the server's own description shows as a hint) */
const PERM_GROUPS = [
  ['Shop', ['dashboard.view', 'catalogue.read', 'catalogue.write', 'files.upload', 'pricing.write', 'coupons.write', 'content.write', 'reviews.moderate']],
  ['Customers and orders', ['orders.read', 'orders.write', 'customers.read', 'customers.write', 'entitlements.grant', 'entitlements.revoke', 'messages.read', 'messages.write', 'exports.run']],
  ['Safety', ['security.read', 'security.write']],
  ['Running the shop', ['analytics.read', 'audit.read', 'emails.read', 'emails.write', 'settings.write', 'staff.manage', 'developer.read', 'logs.read']],
];
const PERM_LABEL = {
  'dashboard.view': 'See the dashboard', 'catalogue.read': 'See products', 'catalogue.write': 'Add and edit products', 'files.upload': 'Upload PDFs and pictures',
  'pricing.write': 'Change prices and plans', 'coupons.write': 'Manage coupons', 'content.write': 'Edit site text and answers', 'reviews.moderate': 'Publish or hide reviews',
  'orders.read': 'See orders', 'orders.write': 'Cancel unpaid orders and record refunds', 'customers.read': 'See customers',
  'customers.write': 'Block customers, sign them out, send password resets', 'entitlements.grant': 'Give or extend access', 'entitlements.revoke': 'Take access away',
  'messages.read': 'Read messages', 'messages.write': 'Answer messages', 'exports.run': 'Download CSV files', 'security.read': 'See account sharing cases',
  'security.write': 'Act on sharing cases', 'analytics.read': 'See analytics',
  'audit.read': 'See the audit log', 'emails.read': 'See sent emails', 'emails.write': 'Resend or skip emails', 'settings.write': 'Change settings',
  'staff.manage': 'Manage staff', 'developer.read': 'Open the developer panel', 'logs.read': 'See payment and sign-in logs',
};
const TOP = r => r === 'owner' || r === 'admin';
/* administrators never open the Developer panel (the server and the database refuse it too) */
const ADMIN_NOT = new Set(['developer.read']);
const allowedFor = (role, list) => (role === 'admin' ? list.filter(p => !ADMIN_NOT.has(p)) : list);

/* Roles: the staff list from the server, adding someone (a new account gets its password by
   email), changing a role or single permissions, and removing someone. Only an owner can give
   the owner or admin role or "Manage staff"; others can only give permissions they hold. */
export default function Roles() {
  const { me, toast, can } = useDash();
  const staffQ = useStaffGet('/api/admin/staff', { keep: true });
  const rolesQ = useStaffGet('/api/admin/staff/roles', { keep: true });
  const [edit, setEdit] = useState(null);   /* 'new' | staff row */
  const [drop, setDrop] = useState(null);
  const [showGone, setShowGone] = useState(false);
  const isOwner = me && me.staff && me.staff.role === 'owner';
  const myId = me && me.user && me.user.id;
  const rows = ((staffQ.data && staffQ.data.staff) || []).filter(s => showGone || s.active);
  const gone = ((staffQ.data && staffQ.data.staff) || []).filter(s => !s.active).length;
  const roles = (rolesQ.data && rolesQ.data.roles) || [];
  const info = useMemo(() => Object.fromEntries(((rolesQ.data && rolesQ.data.permissions) || []).map(p => [p.id, p.description])), [rolesQ.data]);
  const mayTouch = s => s.userId !== myId && (isOwner || !TOP(s.role));

  const put = s => staffQ.setData(d => { const list = (d && d.staff) || []; return { ...(d || {}), staff: list.some(x => x.userId === s.userId) ? list.map(x => (x.userId === s.userId ? s : x)) : [s, ...list] }; });
  const bringBack = async s => {
    try { const r = await staffApi('PUT', '/api/admin/staff/' + s.userId, { active: true }); put(r.staff); toast(s.email + ' is back on the staff'); }
    catch (e) { toast(e.code === 'account_blocked' ? 'This account is blocked. Unblock it under Customers first.' : problem(e)); }
  };

  return (
    <Guard state={staffQ} rows={6}>
      <section className="panel">
        <div className="row-between"><div><p className="eyebrow">Staff</p><p className="auth-sub">Who can open this panel. Add a person's email here after they make an account on the staff sign-in page.</p></div>
          <div className="btn-row">{gone ? <label className="check"><input type="checkbox" checked={showGone} onChange={e => setShowGone(e.target.checked)} />Show removed ({gone})</label> : null}
            {can('staff.manage') ? <button type="button" className="btn btn-primary" onClick={() => setEdit('new')}><Icon id="userplus" />Add staff member</button> : null}</div></div>
        {staffQ.error ? <ErrorNote error={staffQ.error} onRetry={staffQ.reload} compact /> : null}
        <DataTable plain={rows.length <= 10} head={['Name', 'Role', 'Can do', 'Status', 'Last sign-in', '']} empty="No staff yet."
          rows={rows.map(s => ({ key: s.userId, cells: [
            <span key="n" className="who-cell"><span className="av round sm">{initialsOf(s.name || s.email)}</span><span><b>{s.name || s.email.split('@')[0]}</b>{s.userId === myId ? ' (you)' : ''}<small>{s.email}</small>{s.note ? <small>{s.note}</small> : null}</span></span>,
            s.roleLabel || ROLE_LABEL[s.role] || s.role,
            s.role === 'owner' ? 'Everything' : plural((s.effectivePermissions || []).length, 'permission'),
            <Pill key="s" tone={!s.active ? 'neutral' : s.blocked ? 'bad' : 'ok'}>{!s.active ? 'Removed' : s.blocked ? 'Blocked' : 'Active'}</Pill>,
            s.lastLoginAt ? <span key="l" title={fmt(s.lastLoginAt)}>{ago(s.lastLoginAt)}</span> : 'Never',
            mayTouch(s) ? <span key="a" className="row-actions">{s.active ? <><button type="button" className="link" onClick={() => setEdit(s)}>Change</button><button type="button" className="link danger" onClick={() => setDrop(s)}>Remove</button></> : <button type="button" className="link" onClick={() => bringBack(s)}>Bring back</button>}</span>
              : <small key="a" className="muted">{s.userId === myId ? 'Ask another staff manager' : 'Owner only'}</small>,
          ] }))} />
      </section>
      {edit ? <StaffDialog row={edit === 'new' ? null : edit} roles={roles} info={info} isOwner={isOwner} myPerms={(me && me.staff && me.staff.permissions) || []} onClose={() => setEdit(null)}
        onDone={(s, msg) => { setEdit(null); put(s); toast(msg); }} /> : null}
      {drop ? <RemoveDialog row={drop} onClose={() => setDrop(null)} onDone={r => { setDrop(null); put(r.staff); toast(drop.email + ' was removed from the staff' + (r.sessionsEnded ? ' and signed out' : '')); }} /> : null}
    </Guard>
  );
}

function StaffDialog({ row, roles, info, isOwner, myPerms, onClose, onDone }) {
  const s = row || {};
  const tpl = id => allowedFor(id, (roles.find(r => r.role === id) || {}).permissions || []);
  const firstRole = (roles.find(r => !TOP(r.role)) || roles[0] || { role: 'support' }).role;
  const [role, setRole] = useState(s.role || firstRole);
  const [perms, setPerms] = useState(() => new Set(row ? (s.permissions || []) : tpl(s.role || firstRole)));
  const [busy, setBusy] = useState(false), [err, setErr] = useState(null), [errs, setErrs] = useState({});
  const old = new Set(row && s.active ? s.permissions || [] : []);
  const pickRole = r => { setRole(r); setPerms(new Set(tpl(r))); };
  /* may I tick this one? (the server checks again) */
  const mayGive = p => isOwner || old.has(p) || (p !== 'staff.manage' && myPerms.includes(p));
  const toggle = (p, on) => setPerms(cur => { const n = new Set(cur); if (on) n.add(p); else n.delete(p); return n; });
  const custom = role !== 'owner' && (tpl(role).length !== perms.size || tpl(role).some(p => !perms.has(p)));

  const submit = async e => {
    const f = new FormData(e.currentTarget);
    const body = { role, permissions: role === 'owner' ? undefined : allowedFor(role, [...perms]).sort(), note: String(f.get('note') || '').trim() || null };
    if (!row) { body.email = String(f.get('email') || '').trim(); body.name = String(f.get('name') || '').trim() || undefined; }
    setBusy(true); setErr(null); setErrs({});
    try {
      if (row) {
        const r = await staffApi('PUT', '/api/admin/staff/' + s.userId, body);
        onDone(r.staff, 'Saved. ' + (r.staff.name || r.staff.email) + ' now has the ' + (r.staff.roleLabel || role) + ' role.');
      } else {
        const r = await staffApi('POST', '/api/admin/staff', body);
        onDone(r.staff, r.passwordEmailed ? 'Added. ' + r.staff.email + ' gets an email with their password.' : r.promoted ? 'Added. ' + r.staff.email + ' can sign in to the staff page with their own password.' : 'Added');
      }
    } catch (x) {
      const fe = fieldErrors(x); setErrs(fe);
      const msg = x.code === 'staff_exists' ? 'This person is already on the staff. Change their role instead.'
        : x.code === 'mail_unavailable' ? 'Email is not set up, so a new account cannot get its password. Add someone who already has an account on the site.'
          : x.code === 'email_unverified' ? 'That account has not confirmed its email yet.'
            : x.code === 'account_blocked' ? 'That account is blocked. Unblock it under Customers first.'
              : x.status === 403 && x.body && Array.isArray(x.body.permissions) ? 'You can only give permissions you hold yourself.'
                : Object.keys(fe).length ? 'Please check the fields marked in red.' : problem(x);
      setErr(msg); setBusy(false);
    }
  };
  const fe = k => (errs[k] ? <small className="bad">{errs[k]}</small> : null);
  return (
    <Modal title={row ? 'Change ' + (s.name || s.email) : 'Add a staff member'} onClose={onClose} onSubmit={submit} submitLabel={row ? 'Save' : 'Add them'} busyLabel="Saving…" busy={busy} error={err} wide>
      {row ? null : <>
        <p>If they already have an account on the site, they keep their own password. Otherwise a new account is made and its password is emailed to them.</p>
        <div className="grid-2 tight">
          <div className="field"><label htmlFor="stfEmail">Email</label><input id="stfEmail" name="email" type="email" required autoComplete="off" />{fe('email')}</div>
          <div className="field"><label htmlFor="stfName">Name</label><input id="stfName" name="name" maxLength={80} autoComplete="off" />{fe('name')}</div>
        </div>
      </>}
      <div className="field"><label htmlFor="stfRole">Role</label>
        <select id="stfRole" value={role} onChange={e => pickRole(e.target.value)}>{roles.map(r => <option key={r.role} value={r.role} disabled={TOP(r.role) && !isOwner}>{(r.label || ROLE_LABEL[r.role] || r.role) + (TOP(r.role) && !isOwner ? ' (owner only)' : '')}</option>)}</select>
        <small>{role === 'owner' ? 'An owner can do everything, including managing other owners.' : custom ? 'Changed from the role\'s usual permissions.' : 'The role\'s usual permissions are ticked. Change them below if needed.'}</small>{fe('role')}</div>
      {role === 'owner' ? null : <div className="perm-grid">{PERM_GROUPS.map(([g, list]) => (
        <fieldset key={g} className="fs"><legend>{g}</legend>
          {allowedFor(role, list).map(p => <label key={p} className="check" title={info[p] || ''}><input type="checkbox" checked={perms.has(p)} disabled={!mayGive(p) && !perms.has(p)} onChange={e => toggle(p, e.target.checked)} />{PERM_LABEL[p] || p}{!mayGive(p) ? <small className="muted"> ({p === 'staff.manage' ? 'owner only' : 'you do not have it'})</small> : null}</label>)}
        </fieldset>))}</div>}
      <div className="field"><label htmlFor="stfNote">Note for staff</label><input id="stfNote" name="note" maxLength={300} defaultValue={s.note || ''} placeholder="e.g. Weekend support" /></div>
    </Modal>
  );
}

function RemoveDialog({ row, onClose, onDone }) {
  const [busy, setBusy] = useState(false), [err, setErr] = useState(null);
  const submit = async () => {
    setBusy(true); setErr(null);
    try { onDone(await staffApi('DELETE', '/api/admin/staff/' + row.userId)); }
    catch (e) { setErr(problem(e)); setBusy(false); }
  };
  return (
    <Modal title={'Remove ' + (row.name || row.email) + ' from the staff?'} onClose={onClose} onSubmit={submit} submitLabel="Remove" busyLabel="Removing…" danger busy={busy} error={err}>
      <p>They are signed out of the staff page and can no longer open it. Their customer account stays. You can bring them back later.</p>
    </Modal>
  );
}
