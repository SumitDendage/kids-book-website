import { useEffect, useMemo, useState } from 'react';
import MetricCard from '../../components/dashboard/MetricCard.jsx';
import DataTable from '../../components/dashboard/DataTable.jsx';
import Pill from '../../components/dashboard/Pill.jsx';
import Icon from '../../components/dashboard/Icon.jsx';
import Modal from '../../components/dashboard/Modal.jsx';
import { Guard, ErrorNote, Loading } from '../../components/dashboard/States.jsx';
import { useDash } from '../Portal/DashContext.js';
import { useStaffGet, fmt, dateOnly, ago, inr, cur, qs, problem, fieldErrors, plural, initialsOf, ROLE_LABEL } from '../Portal/dashboard.js';
import { staffApi } from '../../services/api.js';
import { ORDER_STATUS_LABEL, ENT_STATUS_LABEL, ENT_TONE, USER_STATUS_LABEL, entName, dateInput, endOfDayIso } from './common.js';

const STATUS = [['', 'All'], ['active', 'Active'], ['pending_verification', 'Email not confirmed'], ['suspended', 'Blocked']];
const TYPES = [['customers', 'Customers'], ['staff', 'Staff'], ['all', 'Everyone']];
const PAGE = 20;
const KIND_LABEL = { paid: 'Bought', free: 'Free pass' };

/* Customers: every account from the server, with search and pages; one customer opens with
   their orders, access, sign-ins and warnings, and the account tools. */
export default function Customers() {
  const { focus, clearFocus, custOpen, setCustOpen, portalRef } = useDash();
  useEffect(() => { if (focus && focus.customer) { setCustOpen(focus.customer); clearFocus(); } }, [focus, clearFocus, setCustOpen]);
  const open = id => { setCustOpen(id); if (portalRef.current) portalRef.current.scrollTo({ top: 0, behavior: 'smooth' }); };
  return custOpen ? <CustomerCard id={custOpen} onClose={() => setCustOpen(null)} /> : <CustomerList onOpen={open} />;
}

function statusPills(u) {
  return <>
    <Pill tone={u.blocked ? 'bad' : u.status === 'active' ? 'ok' : 'info'}>{USER_STATUS_LABEL[u.status] || u.status}</Pill>
    {u.accessStatus === 'suspended' ? <> <Pill tone="bad">Paid access paused</Pill></> : null}
    {u.staffRole ? <> <Pill tone="neutral">Staff: {ROLE_LABEL[u.staffRole] || u.staffRole}</Pill></> : null}
  </>;
}

function CustomerList({ onOpen }) {
  const { stats } = useDash();
  const [status, setStatus] = useState('');
  const [type, setType] = useState('customers');
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [offset, setOffset] = useState(0);
  const [limit, setLimit] = useState(PAGE);
  useEffect(() => { const t = setTimeout(() => { setQ(text.trim()); setOffset(0); }, 350); return () => clearTimeout(t); }, [text]);
  const st = useStaffGet('/api/admin/users' + qs({ q, status, type, limit, offset }), { keep: true });
  const data = st.data || {}, users = data.users || [];
  return (
    <>
      {stats ? <div className="kpi-row">
        <MetricCard label="Customers" value={stats.users} sub={(stats.today ? stats.today.signups : 0) + ' signed up today'} icon="users" />
        <MetricCard label="Open access" value={stats.active_entitlements} sub="sheets and class plans open now" icon="book" />
        <MetricCard label="Paid access paused" value={stats.suspendedCustomers || 0} sub="after sharing warnings" icon="lock" />
        <MetricCard label="Blocked accounts" value={stats.blockedCustomers || 0} sub="cannot sign in" icon="ban" />
      </div> : null}
      <section className="panel"><p className="eyebrow">{type === 'staff' ? 'Staff accounts' : type === 'all' ? 'Every account' : 'Customer list'}{data.total != null ? ' · ' + data.total : ''}</p>
        <p className="auth-sub">Live from the database. Open a profile to see orders and access, give or end access, or block an account.</p>
        <div className="chips" role="group" aria-label="Account status">{STATUS.map(([v, l]) => <button key={v || 'all'} type="button" className={'chip' + (status === v ? ' on' : '')} aria-pressed={status === v} onClick={() => { setStatus(v); setOffset(0); }}>{l}</button>)}</div>
        <div className="dt-bar"><div className="lft">
          <input className="dt-q" type="search" placeholder="Search name or email…" aria-label="Search customers" value={text} onChange={e => setText(e.target.value)} />
          <select aria-label="Which accounts" value={type} onChange={e => { setType(e.target.value); setOffset(0); }} style={{ width: 'auto', height: '32px' }}>{TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        </div></div>
        {st.error ? <ErrorNote error={st.error} onRetry={st.reload} /> : null}
        {st.loading && !st.data ? <Loading rows={5} /> : (
          <DataTable head={['Name', 'Email', 'Status', 'Open access', 'Paid orders', 'Spent', 'Warnings', 'Last sign-in', '']}
            empty={q || status ? 'No accounts match.' : 'No customers yet.'}
            page={{ total: data.total || 0, offset, limit, onPage: setOffset, onLimit: n => { setLimit(n); setOffset(0); } }}
            rows={users.map(u => ({ key: u.id, onClick: () => onOpen(u.id), cells: [
              <span key="n" className="who-cell"><span className="av round sm">{initialsOf(u.name || u.email)}</span><b>{u.name || u.email.split('@')[0]}</b></span>,
              u.email, <span key="s">{statusPills(u)}</span>, u.active, u.orders, inr(u.spent_inr),
              u.warningCount ? <Pill key="w" tone={u.warningCount >= u.maxWarnings ? 'bad' : 'info'}>{u.warningCount + ' of ' + u.maxWarnings}</Pill> : '0',
              u.lastLoginAt ? ago(u.lastLoginAt) : 'Never',
              <button key="b" type="button" className="link" onClick={() => onOpen(u.id)}>Profile</button>,
            ] }))} />
        )}
      </section>
    </>
  );
}

/* one customer's profile, with the account tools */
function CustomerCard({ id, onClose }) {
  const { can, go, allowed, me } = useDash();
  const st = useStaffGet('/api/admin/users/' + encodeURIComponent(id));
  const [dialog, setDialog] = useState(null);   /* { kind: 'block'|'unblock'|'end'|'reset'|'grant'|'revoke'|'extend', ent? } */
  const d = st.data, u = d && d.user;
  const done = () => { setDialog(null); st.reload(true); };
  const self = u && me && me.user && u.id === me.user.id;
  const writeAcct = can('customers.write');
  const liveSessions = d ? d.sessions.filter(s => s.status === 'active') : [];
  const activeWarnings = d ? d.warnings.filter(w => w.status === 'active') : [];

  return (
    <>
      <div className="row-between"><button type="button" className="btn btn-ghost btn-sm" onClick={onClose}><Icon id="left" size={14} />All customers</button>
        {u && allowed('security') ? <button type="button" className="btn btn-ghost btn-sm" onClick={() => go('security', { customer: u.id, email: u.email })}><Icon id="security" size={14} />Open in Security</button> : null}
      </div>
      <Guard state={st} rows={8}>
        {u ? <section className="panel">
          <div className="row-between">
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0 }}><span className="av round" style={{ width: '40px', height: '40px', fontSize: '14px' }}>{initialsOf(u.name || u.email)}</span>
              <div style={{ minWidth: 0 }}><h3 className="card-title">{u.name || u.email.split('@')[0]}</h3><p className="auth-sub">{u.email}{u.role ? ' · ' + (u.role === 'teacher' ? 'Teacher' : u.role === 'parent' ? 'Parent' : u.role) : ''} · joined {dateOnly(u.createdAt)}{u.country ? ' · ' + u.country : ''}</p></div></div>
            <div className="btn-row">{statusPills(u)}</div>
          </div>
          {u.blocked ? <p className="st-note err"><Icon id="ban" size={16} /><span>Blocked {fmt(u.blockedAt)}{u.blockedReason ? ': ' + u.blockedReason : ''}. They cannot sign in.</span></p> : null}
          {u.accessStatus === 'suspended' ? <p className="st-note warn"><Icon id="lock" size={16} /><span>Paid access is paused {u.suspendedAt ? 'since ' + fmt(u.suspendedAt) : ''}{u.suspensionReason ? ': ' + u.suspensionReason : ''}. {allowed('security') ? 'It is managed on the Security page.' : ''}</span></p> : null}
          <div className="kpi-row">
            <MetricCard label="Paid orders" value={u.orders} icon="orders" />
            <MetricCard label="Total spent" value={inr(u.spent_inr)} icon="rupee" />
            <MetricCard label="Open access" value={u.active} icon="book" />
            <MetricCard label="Signed in on" value={plural(u.activeSessionCount, 'device')} sub={u.lastLoginAt ? 'last sign-in ' + ago(u.lastLoginAt) : 'never signed in'} icon="activity" />
          </div>
          {writeAcct && !self ? <div className="btn-row">
            {u.blocked
              ? <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDialog({ kind: 'unblock' })}><Icon id="undo" size={14} />Unblock account</button>
              : <button type="button" className="btn btn-ghost btn-sm btn-danger" onClick={() => setDialog({ kind: 'block' })}><Icon id="ban" size={14} />Block account</button>}
            <button type="button" className="btn btn-ghost btn-sm" disabled={!u.activeSessionCount} onClick={() => setDialog({ kind: 'end' })}><Icon id="logout" size={14} />Sign out everywhere</button>
            <button type="button" className="btn btn-ghost btn-sm" disabled={u.blocked} title={u.blocked ? 'Unblock the account first' : undefined} onClick={() => setDialog({ kind: 'reset' })}><Icon id="key" size={14} />Send password reset</button>
          </div> : self ? <p className="auth-sub">This is your own account. Account tools are not shown for it.</p> : null}
        </section> : null}

        {d ? <>
          <section className="panel">
            <div className="row-between"><div><p className="eyebrow">Access</p><p className="auth-sub">Sheets and class plans this customer can open. Every access has an end date.</p></div>
              {can('entitlements.grant') && u && !u.blocked ? <button type="button" className="btn btn-primary btn-sm" onClick={() => setDialog({ kind: 'grant' })}><Icon id="plus" size={14} />Give access</button> : null}
            </div>
            <DataTable head={['Access', 'How', 'Status', 'From', 'Until', '']} empty="No access yet." filter="Filter access…"
              rows={d.entitlements.map(e => ({ key: e.id, cells: [
                entName(e), e.grant ? 'Given by staff' : KIND_LABEL[e.kind] || e.kind,
                <Pill key="s" tone={ENT_TONE[e.status]} title={e.revokeReason || undefined}>{ENT_STATUS_LABEL[e.status] || e.status}</Pill>,
                dateOnly(e.start), e.end ? fmt(e.end) : '',
                <span key="a" className="btn-row nowrap">
                  {can('entitlements.grant') && e.end && e.status !== 'revoked' ? <button type="button" className="link" onClick={() => setDialog({ kind: 'extend', ent: e })}>Extend</button> : null}
                  {can('entitlements.revoke') && (e.status === 'active' || e.status === 'scheduled') ? <button type="button" className="link danger" onClick={() => setDialog({ kind: 'revoke', ent: e })}>End now</button> : null}
                </span>,
              ] }))} />
          </section>
          <div className="grid-2">
            <section className="panel"><p className="eyebrow">Orders</p>
              <DataTable plain head={['Order', 'When', 'Amount', 'Status']} empty="No orders."
                rows={d.orders.slice(0, 20).map(o => ({ key: o.id, cells: [
                  allowed('orders') ? <button key="i" type="button" className="link mono" onClick={() => go('orders', { order: o.id })}>{o.id}</button> : <span key="i" className="mono">{o.id}</span>,
                  fmt(o.at), <span key="a">{inr(o.totalInr)}{o.currency !== 'INR' ? <><br /><small>{cur(o.total, o.currency)}</small></> : null}</span>,
                  <Pill key="s" tone={o.status}>{ORDER_STATUS_LABEL[o.status] || o.status}</Pill>,
                ] }))} />
            </section>
            <section className="panel"><p className="eyebrow">Sign-ins</p><p className="auth-sub">{plural(liveSessions.length, 'device')} signed in now.{allowed('security') ? ' Stop one sign-in on the Security page.' : ''}</p>
              <DataTable plain head={['Device', 'Last active', 'Status']} empty="No sign-ins yet."
                rows={d.sessions.slice(0, 8).map(s => ({ key: s.id, cells: [<span key="d">{s.device || 'Unknown device'}{s.country ? <><br /><small>{s.country}{s.staff ? ' · staff sign-in' : ''}</small></> : null}</span>, ago(s.lastActiveAt), <Pill key="s" tone={s.status === 'active' ? 'ok' : s.status === 'blocked' ? 'bad' : 'neutral'}>{s.status === 'active' ? 'Signed in' : s.status === 'blocked' ? 'Stopped' : s.status === 'expired' ? 'Ran out' : 'Ended'}</Pill>] }))} />
            </section>
          </div>
          <section className="panel"><p className="eyebrow">Sharing warnings</p>
            <p className="auth-sub">{activeWarnings.length ? plural(activeWarnings.length, 'active warning') + ' of ' + u.maxWarnings + '. ' + (activeWarnings.length >= u.maxWarnings ? 'That is the limit.' : '') : 'No active warnings.'} {d.incidents.filter(i => i.status === 'open').length ? plural(d.incidents.filter(i => i.status === 'open').length, 'possible sharing case') + ' waiting for review.' : ''} {d.appeals.filter(a => a.status === 'open').length ? plural(d.appeals.filter(a => a.status === 'open').length, 'note') + ' from the customer waiting for an answer.' : ''}</p>
            {d.warnings.length ? <DataTable plain head={['Level', 'Reason', 'Given', 'Status']} empty=""
              rows={d.warnings.slice(0, 6).map(w => ({ key: w.id, cells: [w.level + ' of ' + u.maxWarnings, w.reason, dateOnly(w.issuedAt), <Pill key="s" tone={w.status === 'active' ? 'bad' : 'neutral'}>{w.status === 'active' ? 'Active' : w.status === 'revoked' ? 'Removed' : 'Expired'}</Pill>] }))} /> : null}
            {allowed('security') ? <div className="btn-row"><button type="button" className="btn btn-ghost btn-sm" onClick={() => go('security', { customer: u.id, email: u.email })}><Icon id="security" size={14} />Review in Security</button></div> : null}
          </section>
        </> : null}
      </Guard>
      {dialog && u ? <CustomerDialog dialog={dialog} user={u} onClose={() => setDialog(null)} onDone={done} /> : null}
    </>
  );
}

/* the account and access tools, each one a small dialog */
function CustomerDialog({ dialog, user, onClose, onDone }) {
  const { toast, refreshCounts, can } = useDash();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [errs, setErrs] = useState({});
  const [reason, setReason] = useState('');
  const [mode, setMode] = useState('days');
  const [days, setDays] = useState('30');
  const [until, setUntil] = useState('');
  const [what, setWhat] = useState('worksheet');
  const [sheet, setSheet] = useState('');
  const [cls, setCls] = useState('');
  const [plan, setPlan] = useState('');
  const k = dialog.kind, e = dialog.ent;
  const name = user.name || user.email;
  const sheets = useStaffGet(k === 'grant' && can('catalogue.read') ? '/api/admin/worksheets' : null);
  const settings = useStaffGet(k === 'grant' ? '/api/admin/settings' : null);
  const classes = (settings.data && settings.data.classList) || [];
  const plans = ((settings.data && settings.data.planList) || []).filter(p => p.active);
  const sheetList = useMemo(() => ((sheets.data && sheets.data.worksheets) || []).filter(s => s.status !== 'draft').sort((a, b) => (a.cls + a.title).localeCompare(b.cls + b.title)), [sheets.data]);

  const run = async (fn, ok) => {
    setBusy(true); setErr(''); setErrs({});
    try { const out = await fn(); toast(typeof ok === 'function' ? ok(out) : ok); refreshCounts(); onDone(); }
    catch (x) { const fe = fieldErrors(x); setErrs(fe); setErr(Object.keys(fe).length ? '' : problem(x)); setBusy(false); }
  };
  const needReason = min => { const r = reason.trim(); if (r.length < min) { setErrs({ reason: 'Say why (at least ' + min + ' characters). It goes in the audit log.' }); return null; } return r; };
  const end = () => (mode === 'days' ? { days: Number(days) } : { until: endOfDayIso(until) });
  const enc = encodeURIComponent;

  let title, label, busyLabel, danger = false, body, submit;
  if (k === 'block') {
    title = 'Block this account?'; label = 'Block account'; busyLabel = 'Blocking…'; danger = true;
    body = <><p><b>{name}</b> is signed out on every device and cannot sign in until you unblock the account. Their access records are not changed.</p>
      <div className="field"><label htmlFor="cuReason">Reason</label><textarea id="cuReason" value={reason} maxLength={500} onChange={x => setReason(x.target.value)} placeholder="For example: payment dispute, account shared on a forum." aria-invalid={errs.reason ? 'true' : undefined} /><small className={errs.reason ? 'bad' : ''}>{errs.reason || 'Kept in the audit log. 3 to 500 characters.'}</small></div></>;
    submit = () => { const r = needReason(3); if (r) run(() => staffApi('POST', '/api/admin/users/' + enc(user.id) + '/block', { reason: r }), o => (o.changed === false ? 'This account was already blocked' : 'Account blocked')); };
  } else if (k === 'unblock') {
    title = 'Unblock this account?'; label = 'Unblock'; busyLabel = 'Unblocking…';
    body = <p><b>{name}</b> can sign in again. Paid access that was paused after sharing warnings stays paused; that is managed on the Security page.</p>;
    submit = () => run(() => staffApi('POST', '/api/admin/users/' + enc(user.id) + '/unblock', {}), 'Account unblocked');
  } else if (k === 'end') {
    title = 'Sign out everywhere?'; label = 'Sign out everywhere'; busyLabel = 'Signing out…'; danger = true;
    body = <p><b>{name}</b> is signed out on {plural(user.activeSessionCount, 'device')}. They can sign in again with their password.</p>;
    submit = () => run(() => staffApi('POST', '/api/admin/users/' + enc(user.id) + '/sessions/end-all', {}), o => 'Signed out on ' + plural(o.ended || 0, 'device'));
  } else if (k === 'reset') {
    title = 'Send a password reset link?'; label = 'Send the link'; busyLabel = 'Sending…';
    body = <p>We email <b>{user.email}</b> a link to choose a new password. The link works once. Nobody sees the new password, staff included.</p>;
    submit = () => run(() => staffApi('POST', '/api/admin/users/' + enc(user.id) + '/password-reset', {}), 'Reset link sent to ' + user.email);
  } else if (k === 'revoke') {
    title = 'End this access now?'; label = 'End access'; busyLabel = 'Ending…'; danger = true;
    body = <><p><b>{entName(e, classes)}</b> closes for <b>{name}</b> right away. This does not refund any money.</p>
      <div className="field"><label htmlFor="cuReason">Reason</label><textarea id="cuReason" value={reason} maxLength={200} onChange={x => setReason(x.target.value)} placeholder="For example: given by mistake." aria-invalid={errs.reason ? 'true' : undefined} /><small className={errs.reason ? 'bad' : ''}>{errs.reason || 'Kept in the audit log. 3 to 200 characters.'}</small></div></>;
    submit = () => { const r = needReason(3); if (r) run(() => staffApi('POST', '/api/admin/entitlements/revoke', { id: e.id, reason: r }), 'Access ended'); };
  } else {
    const grant = k === 'grant';
    title = grant ? 'Give access' : 'Extend access'; label = grant ? 'Give access' : 'Extend'; busyLabel = 'Saving…';
    const endFields = <fieldset className="fs"><legend>{grant ? 'Open until' : 'New end'}</legend>
      <div className="chips" role="radiogroup" aria-label="How to set the end">
        <button type="button" role="radio" aria-checked={mode === 'days'} className={'chip' + (mode === 'days' ? ' on' : '')} onClick={() => setMode('days')}>{grant ? 'A number of days' : 'Add days'}</button>
        <button type="button" role="radio" aria-checked={mode === 'until'} className={'chip' + (mode === 'until' ? ' on' : '')} onClick={() => setMode('until')}>A date</button>
        {grant && what === 'class' ? <button type="button" role="radio" aria-checked={mode === 'plan'} className={'chip' + (mode === 'plan' ? ' on' : '')} onClick={() => setMode('plan')}>The plan's length</button> : null}
      </div>
      {mode === 'days' ? <div className="field"><label htmlFor="cuDays">{grant ? 'Days from today' : 'Days to add'}</label><input id="cuDays" type="number" min="1" max="3650" value={days} onChange={x => setDays(x.target.value)} /><small className={errs.days ? 'bad' : ''}>{errs.days || (grant ? 'From 1 to 3650 days.' : 'Counted from the current end' + (e && e.end && e.end > Date.now() ? ' (' + dateOnly(e.end) + ')' : ', or from today if it has ended') + '.')}</small></div> : null}
      {mode === 'until' ? <div className="field"><label htmlFor="cuUntil">Last day</label><input id="cuUntil" type="date" min={dateInput(Math.max(Date.now() + 864e5, e && e.end ? e.end + 864e5 : 0))} value={until} onChange={x => setUntil(x.target.value)} /><small className={errs.until ? 'bad' : ''}>{errs.until || 'Access stays open until the end of this day.'}</small></div> : null}
      {mode === 'plan' ? <p className="auth-sub">Open for the plan's own number of months, from today.</p> : null}
    </fieldset>;
    body = <>
      {grant ? <p>Give <b>{name}</b> access without a payment. It is recorded as given by staff and always has an end date.</p> : <p>Give <b>{entName(e, classes)}</b> a later end date. It now ends <b>{fmt(e.end)}</b>.</p>}
      {grant ? <>
        <div className="chips" role="radiogroup" aria-label="What to open">
          <button type="button" role="radio" aria-checked={what === 'worksheet'} className={'chip' + (what === 'worksheet' ? ' on' : '')} onClick={() => { setWhat('worksheet'); if (mode === 'plan') setMode('days'); }}>One sheet</button>
          <button type="button" role="radio" aria-checked={what === 'class'} className={'chip' + (what === 'class' ? ' on' : '')} onClick={() => setWhat('class')}>A whole class</button>
        </div>
        {what === 'worksheet' ? <div className="field"><label htmlFor="cuSheet">Sheet</label>
          {sheetList.length ? <select id="cuSheet" value={sheet} onChange={x => setSheet(x.target.value)}><option value="">Choose a sheet…</option>{sheetList.map(s => <option key={s.id} value={s.id}>{s.title} ({s.cls}){s.status === 'archived' ? ', archived' : ''}</option>)}</select>
            : <input id="cuSheet" type="text" value={sheet} onChange={x => setSheet(x.target.value.trim())} placeholder={sheets.loading ? 'Loading sheets…' : 'The sheet id, e.g. kg-alphabet-a'} />}
          <small className={errs.worksheet ? 'bad' : ''}>{errs.worksheet || ''}</small></div>
          : <div className="grid-2">
            <div className="field"><label htmlFor="cuClass">Class</label>
              {classes.length ? <select id="cuClass" value={cls} onChange={x => setCls(x.target.value)}><option value="">Choose a class…</option>{classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
                : <input id="cuClass" type="text" value={cls} onChange={x => setCls(x.target.value.trim())} placeholder="The class id, e.g. kg" />}
              <small className={errs.cls ? 'bad' : ''}>{errs.cls || ''}</small></div>
            <div className="field"><label htmlFor="cuPlan">Plan (optional)</label>
              <select id="cuPlan" value={plan} onChange={x => { setPlan(x.target.value); if (!x.target.value && mode === 'plan') setMode('days'); }}><option value="">No plan</option>{plans.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}</select>
              <small className={errs.plan ? 'bad' : ''}>{errs.plan || ''}</small></div>
          </div>}
      </> : null}
      {endFields}
      <div className="field"><label htmlFor="cuReason">Reason</label><textarea id="cuReason" value={reason} maxLength={200} onChange={x => setReason(x.target.value)} placeholder={grant ? 'For example: school trial for one month.' : 'For example: customer could not use it while ill.'} aria-invalid={errs.reason ? 'true' : undefined} /><small className={errs.reason ? 'bad' : ''}>{errs.reason || 'Kept in the audit log. 3 to 200 characters.'}</small></div>
    </>;
    submit = () => {
      const r = needReason(3); if (!r) return;
      if (mode === 'days' && !(Number(days) >= 1)) { setErrs({ days: 'Enter a number of days.' }); return; }
      if (mode === 'until' && !until) { setErrs({ until: 'Pick the last day.' }); return; }
      if (grant) {
        const target = what === 'worksheet' ? (sheet ? { worksheet: sheet } : null) : (cls ? { cls, plan: plan || undefined } : null);
        if (!target) { setErrs(what === 'worksheet' ? { worksheet: 'Choose a sheet.' } : { cls: 'Choose a class.' }); return; }
        if (mode === 'plan' && !plan) { setErrs({ plan: 'Choose a plan, or give days or a date.' }); return; }
        run(() => staffApi('POST', '/api/admin/entitlements/grant', Object.assign({ user: user.id, reason: r }, target, mode === 'plan' ? {} : end())), o => 'Access given until ' + fmt(o.entitlement && o.entitlement.end));
      } else {
        run(() => staffApi('POST', '/api/admin/entitlements/' + enc(e.id) + '/extend', Object.assign({ reason: r }, end())), o => 'Access now ends ' + fmt(o.entitlement && o.entitlement.end));
      }
    };
  }
  return (
    <Modal title={title} onClose={onClose} onSubmit={submit} submitLabel={label} busyLabel={busyLabel} danger={danger} busy={busy} error={err} wide={k === 'grant'}>
      {body}
    </Modal>
  );
}
