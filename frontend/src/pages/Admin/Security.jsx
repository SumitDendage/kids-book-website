import { useEffect, useMemo, useState } from 'react';
import { staffApi } from '../../services/api.js';
import MetricCard from '../../components/dashboard/MetricCard.jsx';
import Icon from '../../components/dashboard/Icon.jsx';
import ConfirmDialog from '../../components/dashboard/ConfirmDialog.jsx';
import { SessionList } from '../Developer/SessionControls.jsx';
import {
  StaffStyles, CardTable, Chips, Tabs, Tag, Missing, KV, Loading, LoadError, Note, NoAccess, PanelHead,
  useServer, useStaffAccess, problem, qs, when, ago, count, plural, initialsOf,
} from '../Developer/common.jsx';

/* Admin → Security: customers with warnings or paused access, their sign-ins, the three separate
   controls (one sign-in, paid access, the whole account), sharing incidents, warnings, appeals and
   the sharing rules. Everything is read from and written to the server; staff without
   security.write (or customers.write for whole-account blocks) see it read-only. */

const ACCOUNT = { active: ['Active', 'ok'], pending_verification: ['Email not confirmed', 'neutral'] };
const KIND = { warning: 'About a warning', suspension: 'About paused paid access', block: 'About a blocked account' };
const SEVERITY = { low: ['Low', 'neutral'], medium: ['Medium', 'info'], high: ['High', 'bad'] };
const needsAttention = c => c.warningCount > 0 || c.accessStatus === 'suspended' || c.blocked || c.openIncidents > 0 || c.openAppeal || c.blockedSessionCount > 0;
const nameOf = c => (c && (c.name || c.email)) || 'This customer';
const Who = ({ c }) => (
  <span className="lw-who"><span className="av round">{initialsOf(c.name || c.email)}</span><span><b>{c.name || c.email}</b><small>{c.email}</small></span></span>
);
const warnText = (n, max) => (n ? n + ' of ' + max : 'None');
const warnTone = (n, max) => (!n ? 'neutral' : n >= max ? 'bad' : 'info');
const reasonOf = c => (c.suspensionReason === 'warnings' ? 'reached the warning limit' : c.suspensionReason === 'staff' ? 'paused by staff' : '');

export default function Security() {
  const access = useStaffAccess();
  const canRead = access.can('security.read'), canWrite = access.can('security.write'), canAccount = access.can('customers.write');
  const [tab, setTab] = useState('customers');
  const [openId, setOpenId] = useState(null);
  const [ver, setVer] = useState(0);
  const bump = () => setVer(v => v + 1);
  const all = useServer('/api/admin/security/customers?limit=1000', { skip: !canRead, version: ver });
  const inc = useServer('/api/admin/security/incidents?status=open&limit=1000', { skip: !canRead, version: ver });
  const app = useServer('/api/admin/security/appeals?status=open&limit=1000', { skip: !canRead, version: ver });

  if (!access.ready) return <section className="panel"><StaffStyles />{access.error ? <LoadError error={access.error} what="your staff permissions" /> : <Loading />}</section>;
  if (!canRead) return <><StaffStyles /><NoAccess title="Security" need="security.read" /></>;

  const customers = all.data ? all.data.customers || [] : [];
  const byId = Object.fromEntries(customers.map(c => [c.id, c]));
  const max = customers.length ? customers[0].maxWarnings : 3;
  const warned = customers.filter(c => c.warningCount > 0).length;
  const paused = customers.filter(c => c.accessStatus === 'suspended').length;
  const blocked = customers.filter(c => c.blocked).length;
  const attention = customers.filter(needsAttention).length;
  const openIncidents = inc.data ? (inc.data.incidents || []).length : null;
  const openAppeals = app.data ? (app.data.appeals || []).length : null;
  const many = customers.length >= 1000 ? '+' : '';
  const open = id => { setOpenId(id); setTab('customers'); };

  return (
    <>
      <StaffStyles />
      <section className="panel" aria-labelledby="lwSecHow">
        <PanelHead id="lwSecHow" title="Three separate controls" sub="Each one changes only its own thing, is checked on the server and is written to the audit log." />
        <div className="lw-three">
          <div><b>Block one sign-in</b><p>Signs out one device or browser. The customer’s other sign-ins keep working.</p></div>
          <div><b>Pause paid access</b><p>Bought sheets and class plans stop opening; sign-in, orders and free sheets keep working. Starts by itself at {max} warnings.</p></div>
          <div><b>Block the whole account</b><p>Sign-in is refused and every sign-in ends, until you unblock it.</p></div>
        </div>
        {!canWrite ? <Note tone="neutral">You can look but not change anything here: changes need the “security.write” permission.</Note> : null}
      </section>

      <div className="kpi-row">
        <MetricCard label="Customers with warnings" value={all.data ? count(warned) + many : '…'} sub={all.data ? 'of ' + plural(customers.length, 'customer') + many : ''} icon="security" />
        <MetricCard label="Paid access paused" value={all.data ? count(paused) : '…'} sub={all.data ? (blocked ? plural(blocked, 'account') + ' blocked' : 'No account is blocked') : ''} icon="auth" />
        <MetricCard label="Open incidents" value={openIncidents == null ? '…' : count(openIncidents)} sub="waiting for a decision" icon="errors" />
        <MetricCard label="Appeals waiting" value={openAppeals == null ? '…' : count(openAppeals)} sub="notes from customers" icon="messages" />
      </div>

      <Tabs label="Security" value={tab} onChange={t => { setTab(t); if (t !== 'customers') setOpenId(null); }} options={[
        ['customers', 'Customers', attention || null], ['incidents', 'Incidents', openIncidents || null], ['warnings', 'Warnings'], ['appeals', 'Appeals', openAppeals || null], ['rules', 'Sharing rules'],
      ]} />

      {tab === 'customers' ? (openId
        ? <CustomerDetail key={openId} id={openId} seed={byId[openId]} canWrite={canWrite} canAccount={canAccount} max={max} version={ver} onChanged={bump} onBack={() => setOpenId(null)} />
        : <CustomersTab all={all} onOpen={open} version={ver} counts={{ attention, warned, paused, blocked, total: customers.length }} />) : null}
      {tab === 'incidents' ? <section className="panel"><PanelHead title="Sharing incidents" sub="A rule noticed something that may be account sharing. Nothing happens to the customer until someone confirms it: confirming sends one warning." /><IncidentList canWrite={canWrite} byId={byId} max={max} version={ver} onChanged={bump} onOpen={open} /></section> : null}
      {tab === 'warnings' ? <section className="panel"><PanelHead title="Warnings" sub={'Each confirmed incident gives one warning, emailed to the customer. At ' + max + ' active warnings paid access pauses by itself.'} /><WarningList canWrite={canWrite} version={ver} onChanged={bump} onOpen={open} /></section> : null}
      {tab === 'appeals' ? <section className="panel"><PanelHead title="Appeals" sub="Notes customers sent from My Account about a warning or paused access. Your reply is emailed to them." /><AppealList canWrite={canWrite} version={ver} onChanged={bump} onOpen={open} /></section> : null}
      {tab === 'rules' ? <RulesTab canWrite={canWrite} max={max} /> : null}
    </>
  );
}

/* ---------- customers ---------- */
function CustomersTab({ all, onOpen, version, counts }) {
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [view, setView] = useState('attention');
  const [shown, setShown] = useState(50);
  useEffect(() => { const t = setTimeout(() => setQ(text.trim()), 300); return () => clearTimeout(t); }, [text]);
  useEffect(() => { setShown(50); }, [q, view]);
  const search = useServer('/api/admin/security/customers' + qs({ q, limit: 200 }), { skip: !q, version });
  const src = q ? search : all;
  const base = src.data ? src.data.customers || [] : [];
  const FILTER = { attention: needsAttention, warned: c => c.warningCount > 0, paused: c => c.accessStatus === 'suspended', blocked: c => c.blocked, all: () => true };
  const rows = base.filter(FILTER[view]);
  const EMPTY = {
    attention: 'No customer needs attention right now. Customers with warnings, paused paid access, a blocked account or sign-in, an open incident or an appeal show here.',
    warned: 'No customer has an active warning.', paused: 'No customer’s paid access is paused.', blocked: 'No account is blocked.', all: 'No customers yet.',
  };
  return (
    <section className="panel" aria-labelledby="lwCustTitle" data-tab-panel="customers">
      <PanelHead id="lwCustTitle" title="Customers" sub="Open a customer to see their sign-ins, warnings and the three controls." />
      <div className="lw-bar">
        <Chips label="Show" value={view} onChange={setView} options={q ? [['attention', 'Needs attention'], ['warned', 'Warnings'], ['paused', 'Paid access paused'], ['blocked', 'Account blocked'], ['all', 'All']] : [
          ['attention', 'Needs attention', counts.attention], ['warned', 'Warnings', counts.warned], ['paused', 'Paid access paused', counts.paused], ['blocked', 'Account blocked', counts.blocked], ['all', 'All', counts.total],
        ]} />
        <input className="search" type="search" placeholder="Search by name or email" aria-label="Search customers by name or email" value={text} onChange={e => { const v = e.target.value; if (v.trim() && !text.trim()) setView('all'); setText(v); }} data-field="customer-search" />
      </div>
      <LoadError error={src.error} what="the customers" onRetry={src.reload} />
      {src.loading && !src.data ? <Loading>Loading customers…</Loading> : null}
      {src.data ? (
        <>
          <CardTable
            rows={rows.slice(0, shown)} rowKey={c => c.id} rowProps={c => ({ 'data-customer': c.email })}
            empty={q ? (base.length ? (base.length === 1 ? 'One customer matches “' : count(base.length) + ' customers match “') + q + '”, but not this filter. Choose “All” to see them.' : 'No customer matches “' + q + '”.') : EMPTY[view]} caption="Customers"
            cols={[
              ['Customer', c => <Who c={c} />],
              ['Paid access', c => (c.accessStatus === 'suspended' ? <Tag tone="bad">Paused</Tag> : <Tag tone="ok">Active</Tag>)],
              ['Warnings', c => <Tag tone={warnTone(c.warningCount, c.maxWarnings)}>{warnText(c.warningCount, c.maxWarnings)}</Tag>],
              ['Account', c => { const [l, t] = c.blocked ? ['Blocked', 'bad'] : ACCOUNT[c.status] || [c.status || 'Active', 'neutral']; return <Tag tone={t}>{l}</Tag>; }],
              ['Sign-ins', c => <span>{plural(c.activeSessionCount || 0, 'active', 'active')}{c.blockedSessionCount ? <small className="lw-muted">{' · ' + c.blockedSessionCount + ' blocked'}</small> : null}</span>],
              ['Waiting', c => (c.openIncidents || c.openAppeal ? <span className="lw-actions">{c.openIncidents ? <Tag tone="info">{plural(c.openIncidents, 'incident')}</Tag> : null}{c.openAppeal ? <Tag tone="info">Appeal</Tag> : null}</span> : <span className="lw-muted">Nothing</span>)],
              ['Last sign-in', c => (c.lastLoginAt ? <span title={when(c.lastLoginAt)}>{ago(c.lastLoginAt)}</span> : <Missing>Never</Missing>)],
              ['', c => <button type="button" className="btn btn-ghost btn-sm" data-act="open-customer" aria-label={'Open ' + (c.name || c.email)} onClick={() => onOpen(c.id)}>Open</button>],
            ]} />
          {rows.length > shown ? <div className="lw-actions"><button type="button" className="btn btn-ghost btn-sm" onClick={() => setShown(s => s + 50)}>Show more ({count(rows.length - shown)} left)</button></div> : null}
        </>
      ) : null}
    </section>
  );
}

/* one customer: their status, the three controls, sign-ins, warnings, incidents and appeals */
function CustomerDetail({ id, seed, canWrite, canAccount, max, version, onChanged, onBack }) {
  const [local, setLocal] = useState(0);
  const one = useServer('/api/admin/security/customers' + qs({ q: id, limit: 1 }), { version: version + local });
  const fresh = one.data ? (one.data.customers || []).find(x => x.id === id) : null;
  const [patch, setPatch] = useState(null);
  const c = Object.assign({}, seed || {}, fresh || {}, patch || {});
  const [ask, setAsk] = useState(null);   /* { kind, text, reset, confirm, error } */
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);
  useEffect(() => { setPatch(null); }, [fresh]);
  const refresh = () => { setLocal(n => n + 1); onChanged(); };
  /* a change made further down the page makes the note at the top out of date */
  const listChanged = () => { setNote(null); refresh(); };

  if (!c.id) {
    return (
      <section className="panel">
        <div className="lw-actions"><button type="button" className="btn btn-ghost btn-sm" onClick={onBack}><Icon id="left" size={14} />All customers</button></div>
        {one.loading ? <Loading>Loading the customer…</Loading> : <LoadError error={one.error} what="the customer" onRetry={one.reload} />}
        {one.data && !fresh ? <Note tone="neutral">This customer could not be found. Staff accounts are managed under Roles, not here.</Note> : null}
      </section>
    );
  }

  const pausedNow = c.accessStatus === 'suspended';
  const open = (kind, extra) => { setNote(null); setAsk(Object.assign({ kind, text: '', reset: false, confirm: false, error: null }, extra || {})); };
  async function run() {
    const a = ask, text = a.text.trim();
    setBusy(true);
    try {
      let msg;
      if (a.kind === 'pause') {
        const out = await staffApi('POST', '/api/admin/security/customers/' + id + '/block', text ? { note: text } : {});
        setPatch(out.customer); msg = out.changed ? nameOf(c) + '’s paid access is paused. They were sent an email.' : 'Paid access was already paused.';
      } else if (a.kind === 'restore') {
        const out = await staffApi('POST', '/api/admin/security/customers/' + id + '/unblock', Object.assign({ resetWarnings: !!a.reset }, text ? { note: text } : {}));
        setPatch(out.customer); msg = (out.changed ? nameOf(c) + '’s paid access is open again. They were sent an email.' : 'Paid access was not paused.') + (a.reset ? ' Their warnings were cleared.' : '');
      } else if (a.kind === 'block') {
        const out = await staffApi('POST', '/api/admin/users/' + id + '/block', { reason: text });
        msg = out.changed ? nameOf(c) + '’s account is blocked. Every sign-in has ended.' : 'The account was already blocked.';
      } else if (a.kind === 'unblock') {
        const out = await staffApi('POST', '/api/admin/users/' + id + '/unblock', {});
        msg = out.changed ? nameOf(c) + ' can sign in again.' : 'The account was not blocked.';
      } else if (a.kind === 'report') {
        const out = await staffApi('POST', '/api/admin/security/customers/' + id + '/report', { reason: text, confirm: !!a.confirm });
        const w = out.warning;
        msg = w ? 'Reported and confirmed. Warning ' + w.active + ' of ' + w.max + ' is on its way to ' + c.email + '.' + (w.suspended ? ' That was the last one: paid access is now paused.' : '')
          : 'Reported. The incident is waiting under Incidents for someone to confirm or dismiss it.';
      }
      setAsk(null); setNote({ tone: 'ok', msg }); refresh();
    } catch (err) {
      setAsk(x => (x ? Object.assign({}, x, { error: problem(err) }) : x));
    } finally { setBusy(false); }
  }

  const DIALOG = ask ? {
    pause: { title: 'Pause ' + nameOf(c) + '’s paid access?', label: 'Pause paid access', busy: 'Pausing…', danger: true, body: <>
      <p>Bought sheets and class plans stop opening for <b>{c.email}</b> until you restore access. Sign-in, My Account, orders and free sheets keep working, and nothing they bought is deleted.</p>
      <p>They get an email saying access is paused.</p>
      <div className="field"><label htmlFor="lwAskText">Note (optional, kept in the log)</label><textarea id="lwAskText" maxLength={300} value={ask.text} onChange={e => { const v = e.target.value; setAsk(x => Object.assign({}, x, { text: v })); }} /></div>
    </> },
    restore: { title: 'Restore ' + nameOf(c) + '’s paid access?', label: 'Restore paid access', busy: 'Restoring…', body: <>
      <p>Bought sheets and class plans open again until their original end dates (the time spent paused is not added back). <b>{c.email}</b> gets an email.</p>
      <label className="check"><input type="checkbox" checked={ask.reset} onChange={e => { const v = e.target.checked; setAsk(x => Object.assign({}, x, { reset: v })); }} data-field="reset-warnings" /> <span>Also clear their warnings{c.warningCount ? ' (' + c.warningCount + ' active)' : ''}</span></label>
      {!ask.reset && c.warningCount >= max ? <p>If you keep the warnings, the next confirmed warning pauses access again.</p> : null}
      <div className="field"><label htmlFor="lwAskText">Note (optional, kept in the log)</label><textarea id="lwAskText" maxLength={300} value={ask.text} onChange={e => { const v = e.target.value; setAsk(x => Object.assign({}, x, { text: v })); }} /></div>
    </> },
    block: { title: 'Block ' + nameOf(c) + '’s whole account?', label: 'Block account', busy: 'Blocking…', danger: true, need: 3, body: <>
      <p><b>{c.email}</b> cannot sign in while the account is blocked, and every device they are signed in on is signed out now. Their purchases are kept.</p>
      <p>This is separate from paid access and from single sign-ins. Unblock the account to let them back in.</p>
      <div className="field"><label htmlFor="lwAskText">Reason (required, kept in the audit log)</label><textarea id="lwAskText" maxLength={500} value={ask.text} placeholder="Why is the account blocked?" onChange={e => { const v = e.target.value; setAsk(x => Object.assign({}, x, { text: v })); }} /><small>{ask.text.trim().length < 3 ? 'At least 3 characters.' : ask.text.trim().length + ' of 500 characters'}</small></div>
    </> },
    unblock: { title: 'Unblock ' + nameOf(c) + '’s account?', label: 'Unblock account', busy: 'Unblocking…', body: <>
      <p><b>{c.email}</b> can sign in again. Sign-ins that ended when the account was blocked stay ended, so they sign in afresh.</p>
      <p>Paid access is a separate control and is not changed here.</p>
    </> },
    report: { title: 'Report a violation for ' + nameOf(c), label: ask.confirm ? 'Report and send warning' : 'Report', busy: 'Reporting…', danger: !!ask.confirm, need: 3, body: <>
      <p>Describe what was seen. It is saved as an incident under Incidents, where it can be confirmed (one warning) or dismissed.</p>
      <div className="field"><label htmlFor="lwAskText">What was seen (required)</label><textarea id="lwAskText" maxLength={500} value={ask.text} placeholder="For example: the login was shared in a parents’ group" onChange={e => { const v = e.target.value; setAsk(x => Object.assign({}, x, { text: v })); }} data-field="report-reason" /><small>{ask.text.trim().length < 3 ? 'At least 3 characters.' : ask.text.trim().length + ' of 500 characters'}</small></div>
      <label className="check"><input type="checkbox" checked={ask.confirm} onChange={e => { const v = e.target.checked; setAsk(x => Object.assign({}, x, { confirm: v })); }} data-field="report-confirm" /> <span>Confirm it now and email {nameOf(c)} a warning (warning {Math.min((c.warningCount || 0) + 1, 99)} of {max}{(c.warningCount || 0) + 1 >= max ? ', which pauses paid access' : ''})</span></label>
    </> },
  }[ask.kind] : null;

  return (
    <div className="lw-stack" data-customer-detail={c.email}>
      <section className="panel" aria-labelledby="lwCustName">
        <div className="lw-bar">
          <button type="button" className="btn btn-ghost btn-sm" onClick={onBack} data-act="back-to-customers"><Icon id="left" size={14} />All customers</button>
          {canWrite ? <button type="button" className="btn btn-ghost btn-sm" onClick={() => open('report')} data-act="report-violation">Report a violation</button> : null}
        </div>
        <div className="lw-detail-head">
          <span className="av round">{initialsOf(c.name || c.email)}</span>
          <div className="lw-grow"><h3 className="card-title" id="lwCustName">{c.name || c.email}</h3><p className="auth-sub">{c.email}</p></div>
          {one.loading ? <Loading>Updating…</Loading> : null}
        </div>
        {note ? <Note tone={note.tone}>{note.msg}</Note> : null}
        <LoadError error={one.error} what="the latest details" onRetry={one.reload} />
        <div className="kpi-row">
          <MetricCard label="Paid access" value={pausedNow ? 'Paused' : 'Active'} sub={pausedNow ? 'since ' + when(c.suspendedAt) + (reasonOf(c) ? ', ' + reasonOf(c) : '') : 'Bought sheets open normally'} icon="auth" />
          <MetricCard label="Warnings" value={(c.warningCount || 0) + ' of ' + (c.maxWarnings || max)} sub={(c.warningCount || 0) >= (c.maxWarnings || max) ? 'At the limit' : 'Active warnings'} icon="security" />
          <MetricCard label="Signed in on" value={plural(c.activeSessionCount || 0, 'device')} sub={c.blockedSessionCount ? plural(c.blockedSessionCount, 'sign-in') + ' blocked' : 'None blocked'} icon="users" />
          <MetricCard label="Last sign-in" value={c.lastLoginAt ? ago(c.lastLoginAt) : 'Never'} sub={c.lastLoginAt ? when(c.lastLoginAt) : ''} icon="clock" />
        </div>
        <div className="lw-controls">
          <div className="lw-control">
            <div className="lw-control-head"><b>One sign-in</b>{c.blockedSessionCount ? <Tag tone="bad">{c.blockedSessionCount} blocked</Tag> : <Tag tone="ok">None blocked</Tag>}</div>
            <p>Use Block next to a sign-in below. Only that device is signed out; the others keep working.</p>
          </div>
          <div className={'lw-control' + (pausedNow ? ' is-on' : '')}>
            <div className="lw-control-head"><b>Paid access</b>{pausedNow ? <Tag tone="bad">Paused</Tag> : <Tag tone="ok">Active</Tag>}</div>
            <p>{pausedNow ? 'Bought sheets do not open. Sign-in, orders and free sheets still work.' : 'Pausing stops bought sheets opening. Sign-in, orders and free sheets keep working.'}</p>
            {canWrite ? (pausedNow
              ? <button type="button" className="btn btn-primary btn-sm" onClick={() => open('restore', { reset: true })} data-act="restore-access">Restore paid access</button>
              : <button type="button" className="btn btn-destructive btn-sm" onClick={() => open('pause')} data-act="pause-access">Pause paid access</button>) : null}
          </div>
          <div className={'lw-control' + (c.blocked ? ' is-on' : '')}>
            <div className="lw-control-head"><b>Whole account</b>{c.blocked ? <Tag tone="bad">Blocked</Tag> : <Tag tone="ok">Can sign in</Tag>}</div>
            <p>{c.blocked ? 'Sign-in is refused and every sign-in has ended.' : 'Blocking refuses sign-in and ends every sign-in at once.'}</p>
            {canAccount ? (c.blocked
              ? <button type="button" className="btn btn-ghost btn-sm" onClick={() => open('unblock')} data-act="unblock-account">Unblock account</button>
              : <button type="button" className="btn btn-destructive btn-sm" onClick={() => open('block')} data-act="block-account">Block account</button>)
              : <p className="lw-small">Needs the “customers.write” permission.</p>}
          </div>
        </div>
      </section>

      <section className="panel" aria-label="Sign-ins">
        <SessionList customer={c} canWrite={canWrite} onChanged={cust => { if (cust) setPatch(cust); setNote(null); onChanged(); }} />
      </section>
      <section className="panel" aria-labelledby="lwCustWarn">
        <PanelHead id="lwCustWarn" title="Warnings" sub="Every warning this customer was given, newest first." />
        <WarningList user={id} canWrite={canWrite} version={version + local} onChanged={listChanged} />
      </section>
      <section className="panel" aria-labelledby="lwCustInc">
        <PanelHead id="lwCustInc" title="Incidents" sub="What the sharing rules or staff noticed for this customer." />
        <IncidentList user={id} canWrite={canWrite} byId={{ [id]: c }} max={max} version={version + local} onChanged={listChanged} />
      </section>
      <section className="panel" aria-labelledby="lwCustApp">
        <PanelHead id="lwCustApp" title="Appeals" sub="Notes this customer sent about a warning or paused access." />
        <AppealList user={id} canWrite={canWrite} version={version + local} onChanged={listChanged} />
      </section>

      {ask && DIALOG ? (
        <ConfirmDialog title={DIALOG.title} confirmLabel={DIALOG.label} busyLabel={DIALOG.busy} danger={!!DIALOG.danger} busy={busy} error={ask.error}
          confirmDisabled={!!DIALOG.need && ask.text.trim().length < DIALOG.need} onCancel={() => { if (!busy) setAsk(null); }} onConfirm={run}>
          {DIALOG.body}
        </ConfirmDialog>
      ) : null}
    </div>
  );
}

/* ---------- incidents ---------- */
const FACTS = [
  ['devices', n => plural(n, 'device')], ['networks', n => plural(n, 'network')], ['countries', n => plural(n, 'country', 'countries')],
  ['requests', n => plural(n, 'viewer request')], ['windowMinutes', n => 'within ' + plural(n, 'minute')], ['windowHours', n => 'within ' + plural(n, 'hour')],
];
/* zero counts (for example no country known for a local address) say nothing, so they are left out */
const factsOf = ev => FACTS.filter(([k]) => typeof (ev || {})[k] === 'number' && ev[k] > 0).map(([k, f]) => f(ev[k]));

const PAST_SHOWN = 3;
function IncidentList({ user, canWrite, byId, max, version, onChanged, onOpen }) {
  const [status, setStatus] = useState(user ? 'all' : 'open');
  const [limit, setLimit] = useState(100);
  const { data, error, loading, reload } = useServer('/api/admin/security/incidents' + qs({ status, user, limit }), { version });
  const [ask, setAsk] = useState(null);   /* { inc, confirm, note, error } */
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);
  const [past, setPast] = useState(false);
  const all = data ? data.incidents || [] : [];
  /* on a customer's page, open incidents and the three newest decided ones; the rest on request */
  const decided = all.filter(i => i.status !== 'open');
  const hidden = user && !past ? Math.max(0, decided.length - PAST_SHOWN) : 0;
  const list = hidden ? all.filter(i => i.status === 'open').concat(decided.slice(0, PAST_SHOWN)) : all;

  async function run() {
    const a = ask;
    setBusy(true);
    try {
      const out = await staffApi('POST', '/api/admin/security/incidents/' + a.inc.id + '/' + (a.confirm ? 'confirm' : 'dismiss'), a.note.trim() ? { note: a.note.trim() } : {});
      const w = out.warning;
      setAsk(null);
      setNote({ tone: 'ok', msg: a.confirm
        ? (w ? 'Incident confirmed. Warning ' + w.active + ' of ' + w.max + ' is on its way to ' + a.inc.email + '.' + (w.suspended ? ' That was the last one: paid access is now paused.' : '') : 'Incident confirmed. It already had a warning, so no new one was sent.')
        : 'Incident dismissed. Nothing changed for ' + (a.inc.name || a.inc.email) + '.' });
      reload(); if (onChanged) onChanged();
    } catch (err) {
      if (err.code === 'already_confirmed' || err.code === 'already_dismissed') { setAsk(null); setNote({ tone: 'neutral', msg: problem(err) }); reload(); }
      else setAsk(x => (x ? Object.assign({}, x, { error: problem(err) }) : x));
    } finally { setBusy(false); }
  }

  const cust = ask ? byId[ask.inc.userId] : null;
  const nextLevel = cust ? (cust.warningCount || 0) + 1 : null;
  return (
    <div className="lw-stack" data-list="incidents">
      {!user ? <Chips label="Show incidents" value={status} onChange={s => { setStatus(s); setLimit(100); }} options={[['open', 'Open'], ['confirmed', 'Confirmed'], ['dismissed', 'Dismissed'], ['all', 'All']]} /> : null}
      {note ? <Note tone={note.tone}>{note.msg}</Note> : null}
      <LoadError error={error} what="the incidents" onRetry={reload} />
      {loading && !data ? <Loading>Loading incidents…</Loading> : null}
      {data && !list.length ? <p className="cart-empty">{status === 'open' ? 'No open incidents. Nothing is waiting for a decision.' : 'No incidents here.'}</p> : null}
      {list.length ? (
        <div className="lw-cards">
          {list.map(i => {
            const [sl, st] = SEVERITY[i.severity] || [i.severity, 'neutral'];
            const facts = factsOf(i.evidence);
            const places = [].concat((i.evidence && i.evidence.countryList) || []).filter(Boolean);
            return (
              <article key={i.id} className="lw-card" data-incident={i.id} data-status={i.status} data-email={i.email}>
                <div className="lw-card-head">
                  <b>{i.ruleName || i.rule}</b>
                  <span className="lw-actions"><Tag tone={st}>{sl + ' concern'}</Tag><Tag tone={i.status === 'open' ? 'info' : i.status === 'confirmed' ? 'bad' : 'neutral'}>{i.status === 'open' ? 'Open' : i.status === 'confirmed' ? 'Confirmed' : 'Dismissed'}</Tag></span>
                </div>
                {!user ? <div className="lw-bar"><Who c={i} />{onOpen ? <button type="button" className="btn btn-ghost btn-sm btn-plain" onClick={() => onOpen(i.userId)}>Open customer</button> : null}</div> : null}
                {i.summary ? <p className="lw-quote">{i.summary}</p> : null}
                {facts.length || places.length ? <p className="lw-small">{facts.join(' · ')}{places.length ? (facts.length ? ' · ' : '') + 'from ' + places.join(', ') : ''}</p> : null}
                <div className="lw-meta">
                  <span>First seen {when(i.firstSeenAt)}</span>
                  {i.lastSeenAt && i.lastSeenAt !== i.firstSeenAt ? <span>Last seen {ago(i.lastSeenAt)}</span> : null}
                  {i.decidedAt ? <span>{i.status === 'confirmed' ? 'Confirmed' : 'Dismissed'} {when(i.decidedAt)}{i.decidedByEmail ? ' by ' + i.decidedByEmail : ''}</span> : null}
                </div>
                {i.decisionNote ? <p className="lw-small">Note: {i.decisionNote}</p> : null}
                {canWrite && i.status === 'open' ? (
                  <div className="lw-actions">
                    <button type="button" className="btn btn-primary btn-sm" disabled={busy} data-act="confirm-incident" onClick={() => { setNote(null); setAsk({ inc: i, confirm: true, note: '', error: null }); }}>Confirm and warn</button>
                    <button type="button" className="btn btn-ghost btn-sm" disabled={busy} data-act="dismiss-incident" onClick={() => { setNote(null); setAsk({ inc: i, confirm: false, note: '', error: null }); }}>Dismiss</button>
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      ) : null}
      {user && (hidden || past) && decided.length > PAST_SHOWN ? <div className="lw-actions"><button type="button" className="btn btn-ghost btn-sm" aria-expanded={past} onClick={() => setPast(v => !v)}>{past ? 'Show fewer' : 'Show ' + plural(hidden, 'older incident')}</button></div> : null}
      {data && all.length >= limit && limit < 1000 && (!user || past) ? <div className="lw-actions"><button type="button" className="btn btn-ghost btn-sm" onClick={() => setLimit(l => Math.min(1000, l + 100))}>Show more</button></div> : null}
      {ask ? (
        <ConfirmDialog
          title={ask.confirm ? 'Confirm this incident?' : 'Dismiss this incident?'} confirmLabel={ask.confirm ? 'Confirm and send warning' : 'Dismiss'} busyLabel={ask.confirm ? 'Confirming…' : 'Dismissing…'}
          danger={ask.confirm} busy={busy} error={ask.error} onCancel={() => { if (!busy) setAsk(null); }} onConfirm={run}>
          {ask.confirm
            ? <p><b>{ask.inc.email}</b> gets {nextLevel ? 'warning ' + nextLevel + ' of ' + (cust.maxWarnings || max) : 'a warning'} by email.{nextLevel && nextLevel >= (cust.maxWarnings || max) ? ' That is the limit, so their paid access pauses straight away.' : ' At ' + max + ' active warnings paid access pauses by itself.'}</p>
            : <p>No warning is sent and nothing changes for <b>{ask.inc.email}</b>. The incident stays in the list as dismissed.</p>}
          <div className="field"><label htmlFor="lwIncNote">Note (optional, kept with the decision)</label><textarea id="lwIncNote" maxLength={1000} value={ask.note} onChange={e => { const v = e.target.value; setAsk(x => Object.assign({}, x, { note: v })); }} /></div>
        </ConfirmDialog>
      ) : null}
    </div>
  );
}

/* ---------- warnings ---------- */
const WSTATUS = { active: ['Active', 'bad'], revoked: ['Removed', 'neutral'], expired: ['Expired', 'neutral'] };
function WarningList({ user, canWrite, version, onChanged, onOpen }) {
  const [status, setStatus] = useState(user ? 'all' : 'active');
  const [limit, setLimit] = useState(200);
  const { data, error, loading, reload } = useServer('/api/admin/security/warnings' + qs({ status, user, limit }), { version });
  const [ask, setAsk] = useState(null);   /* { w, reason, error } */
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);
  const [past, setPast] = useState(false);
  const all = data ? data.warnings || [] : [];
  /* on a customer's page, active warnings and the three newest removed or expired ones; the rest on request */
  const ended = all.filter(w => w.status !== 'active');
  const hidden = user && !past ? Math.max(0, ended.length - PAST_SHOWN) : 0;
  const list = hidden ? all.filter(w => w.status === 'active').concat(ended.slice(0, PAST_SHOWN)) : all;

  async function run() {
    const a = ask;
    setBusy(true);
    try {
      const out = await staffApi('POST', '/api/admin/security/warnings/' + a.w.id + '/revoke', { reason: a.reason.trim() });
      const s = out.security || {};
      setAsk(null);
      setNote({ tone: 'ok', msg: 'Warning removed. ' + (a.w.name || a.w.email) + ' now has ' + (s.warningCount != null ? s.warningCount + ' of ' + s.maxWarnings : 'one fewer') + '.' + (s.accessStatus === 'suspended' ? ' Their paid access is still paused: restore it on their page if that is right.' : '') });
      reload(); if (onChanged) onChanged();
    } catch (err) {
      if (err.code === 'already_revoked') { setAsk(null); setNote({ tone: 'neutral', msg: problem(err) }); reload(); }
      else setAsk(x => (x ? Object.assign({}, x, { error: problem(err) }) : x));
    } finally { setBusy(false); }
  }

  const cols = [
    !user ? ['Customer', w => <span className="lw-actions"><Who c={w} />{onOpen ? <button type="button" className="btn btn-ghost btn-sm btn-plain" onClick={() => onOpen(w.userId)}>Open</button> : null}</span>] : null,
    ['Warning', w => <b style={{ whiteSpace: 'nowrap' }}>{'Warning ' + w.level}</b>],
    ['Reason', w => <span className="lw-small" style={{ color: 'var(--foreground)' }}>{w.reason}</span>],
    ['Given', w => <span>{when(w.issuedAt)}<small className="lw-muted" style={{ display: 'block' }}>{w.automatic ? 'by a rule that confirms itself' : 'confirmed by staff'}</small></span>],
    ['Seen by customer', w => (w.acknowledged ? <span title={when(w.acknowledgedAt)}>{ago(w.acknowledgedAt)}</span> : <span className="lw-muted">Not yet</span>)],
    ['Stops counting', w => (w.status === 'revoked' ? <span title={w.revokeReason || ''}>Removed {when(w.revokedAt)}</span> : w.expiresAt ? when(w.expiresAt) : <span className="lw-muted">Never</span>)],
    ['Status', w => { const [l, t] = WSTATUS[w.status] || [w.status, 'neutral']; return <Tag tone={t}>{l}</Tag>; }],
    canWrite ? ['', w => (w.status === 'active' ? <button type="button" className="btn btn-ghost btn-sm btn-danger" disabled={busy} data-act="revoke-warning" onClick={() => { setNote(null); setAsk({ w, reason: '', error: null }); }}>Remove</button> : null)] : null,
  ].filter(Boolean);
  return (
    <div className="lw-stack" data-list="warnings">
      {!user ? <Chips label="Show warnings" value={status} onChange={s => { setStatus(s); setLimit(200); }} options={[['active', 'Active'], ['revoked', 'Removed'], ['expired', 'Expired'], ['all', 'All']]} /> : null}
      {note ? <Note tone={note.tone}>{note.msg}</Note> : null}
      <LoadError error={error} what="the warnings" onRetry={reload} />
      {loading && !data ? <Loading>Loading warnings…</Loading> : null}
      {data ? <CardTable rows={list} rowKey={w => w.id} rowProps={w => ({ 'data-warning': w.id, 'data-status': w.status })} cols={cols} caption="Warnings"
        empty={status === 'active' ? 'No active warnings.' : 'No warnings here.'} /> : null}
      {user && (hidden || past) && ended.length > PAST_SHOWN ? <div className="lw-actions"><button type="button" className="btn btn-ghost btn-sm" aria-expanded={past} onClick={() => setPast(v => !v)}>{past ? 'Show fewer' : 'Show ' + plural(hidden, 'older warning')}</button></div> : null}
      {data && all.length >= limit && limit < 1000 && (!user || past) ? <div className="lw-actions"><button type="button" className="btn btn-ghost btn-sm" onClick={() => setLimit(l => Math.min(1000, l + 200))}>Show more</button></div> : null}
      {ask ? (
        <ConfirmDialog title="Remove this warning?" confirmLabel="Remove warning" busyLabel="Removing…" danger busy={busy} error={ask.error}
          confirmDisabled={ask.reason.trim().length < 3} onCancel={() => { if (!busy) setAsk(null); }} onConfirm={run}>
          <p>Warning {ask.w.level} for <b>{ask.w.email}</b> stops counting. The customer sees a note that it was removed.</p>
          <p>Removing a warning does not restore paid access by itself: that stays a separate decision on the customer’s page.</p>
          <div className="field"><label htmlFor="lwRevokeReason">Why is it removed? (required, kept in the log)</label><textarea id="lwRevokeReason" maxLength={300} value={ask.reason} onChange={e => { const v = e.target.value; setAsk(x => Object.assign({}, x, { reason: v })); }} data-field="revoke-reason" /><small>{ask.reason.trim().length < 3 ? 'At least 3 characters.' : ask.reason.trim().length + ' of 300 characters'}</small></div>
        </ConfirmDialog>
      ) : null}
    </div>
  );
}

/* ---------- appeals ---------- */
function AppealList({ user, canWrite, version, onChanged, onOpen }) {
  const [status, setStatus] = useState(user ? 'all' : 'open');
  const [limit, setLimit] = useState(100);
  const { data, error, loading, reload } = useServer('/api/admin/security/appeals' + qs({ status, user, limit }), { version });
  const [ask, setAsk] = useState(null);   /* { a, accept, response, reset, error } */
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);
  const [past, setPast] = useState(false);
  const all = data ? data.appeals || [] : [];
  /* on a customer's page, open appeals and the three newest decided ones; the rest on request */
  const decided = all.filter(a => a.status !== 'open');
  const hidden = user && !past ? Math.max(0, decided.length - PAST_SHOWN) : 0;
  const list = hidden ? all.filter(a => a.status === 'open').concat(decided.slice(0, PAST_SHOWN)) : all;

  async function run() {
    const x = ask;
    setBusy(true);
    try {
      const out = await staffApi('POST', '/api/admin/security/appeals/' + x.a.id + '/decide', { accept: x.accept, response: x.response.trim(), resetWarnings: x.accept && !!x.reset });
      setAsk(null);
      const who = x.a.name || x.a.email;
      setNote({ tone: 'ok', msg: x.accept
        ? 'Appeal accepted.' + (out.revokedWarning ? ' One warning was removed.' : '') + (x.reset ? ' Their warnings were cleared.' : '') + (out.restored ? ' Paid access is open again.' : '') + ' Your reply is on its way to ' + x.a.email + '.'
        : 'Appeal rejected. Nothing changed for ' + who + '. Your reply is on its way to ' + x.a.email + '.' });
      reload(); if (onChanged) onChanged();
    } catch (err) {
      if (err.code === 'already_decided') { setAsk(null); setNote({ tone: 'neutral', msg: problem(err) }); reload(); }
      else setAsk(y => (y ? Object.assign({}, y, { error: problem(err) }) : y));
    } finally { setBusy(false); }
  }

  return (
    <div className="lw-stack" data-list="appeals">
      {!user ? <Chips label="Show appeals" value={status} onChange={s => { setStatus(s); setLimit(100); }} options={[['open', 'Waiting'], ['accepted', 'Accepted'], ['rejected', 'Rejected'], ['all', 'All']]} /> : null}
      {note ? <Note tone={note.tone}>{note.msg}</Note> : null}
      <LoadError error={error} what="the appeals" onRetry={reload} />
      {loading && !data ? <Loading>Loading appeals…</Loading> : null}
      {data && !list.length ? <p className="cart-empty">{status === 'open' ? 'No appeals are waiting.' : 'No appeals here.'}</p> : null}
      {list.length ? (
        <div className="lw-cards">
          {list.map(a => (
            <article key={a.id} className="lw-card" data-appeal={a.id} data-status={a.status} data-email={a.email}>
              <div className="lw-card-head">
                <b>{KIND[a.kind] || 'Appeal'}</b>
                <Tag tone={a.status === 'open' ? 'info' : a.status === 'accepted' ? 'ok' : 'neutral'}>{a.status === 'open' ? 'Waiting' : a.status === 'accepted' ? 'Accepted' : 'Rejected'}</Tag>
              </div>
              {!user ? <div className="lw-bar"><Who c={a} />{onOpen ? <button type="button" className="btn btn-ghost btn-sm btn-plain" onClick={() => onOpen(a.userId)}>Open customer</button> : null}</div> : null}
              <p className="lw-quote">{a.message}</p>
              <div className="lw-meta">
                <span>Sent {when(a.createdAt)}</span>
                {a.status === 'open' ? <span>Now: paid access {a.accessStatus === 'suspended' ? 'paused' : 'active'}</span> : null}
                {a.status === 'open' ? <span>{plural(a.warningCount || 0, 'active warning')}</span> : null}
              </div>
              {a.response ? <p className="lw-small"><b style={{ color: 'var(--foreground)' }}>Reply{a.decidedAt ? ' (' + when(a.decidedAt) + ')' : ''}:</b> {a.response}</p> : null}
              {canWrite && a.status === 'open' ? (
                <div className="lw-actions">
                  <button type="button" className="btn btn-primary btn-sm" disabled={busy} data-act="accept-appeal" onClick={() => { setNote(null); setAsk({ a, accept: true, response: '', reset: false, error: null }); }}>Accept</button>
                  <button type="button" className="btn btn-ghost btn-sm" disabled={busy} data-act="reject-appeal" onClick={() => { setNote(null); setAsk({ a, accept: false, response: '', reset: false, error: null }); }}>Reject</button>
                </div>
              ) : null}
            </article>
          ))}
        </div>
      ) : null}
      {user && (hidden || past) && decided.length > PAST_SHOWN ? <div className="lw-actions"><button type="button" className="btn btn-ghost btn-sm" aria-expanded={past} onClick={() => setPast(v => !v)}>{past ? 'Show fewer' : 'Show ' + plural(hidden, 'older appeal')}</button></div> : null}
      {data && all.length >= limit && limit < 1000 && (!user || past) ? <div className="lw-actions"><button type="button" className="btn btn-ghost btn-sm" onClick={() => setLimit(l => Math.min(1000, l + 100))}>Show more</button></div> : null}
      {ask ? (
        <ConfirmDialog
          title={(ask.accept ? 'Accept ' : 'Reject ') + (ask.a.name || ask.a.email) + '’s appeal?'} confirmLabel={ask.accept ? 'Accept appeal' : 'Reject appeal'} busyLabel={ask.accept ? 'Accepting…' : 'Rejecting…'}
          busy={busy} error={ask.error} danger={!ask.accept} confirmDisabled={!ask.accept && ask.response.trim().length < 3}
          onCancel={() => { if (!busy) setAsk(null); }} onConfirm={run}>
          {ask.accept
            ? <p>The warning the note is about (or the newest one) is removed, and paid access opens again if it was paused. <b>{ask.a.email}</b> gets your reply by email.{ask.a.kind === 'block' ? ' A blocked account stays blocked: unblock it on the customer’s page.' : ''}</p>
            : <p>Nothing changes on the account. <b>{ask.a.email}</b> gets your reply by email, so say why.</p>}
          <div className="field">
            <label htmlFor="lwAppealReply">{ask.accept ? 'Reply to the customer (optional)' : 'Reply to the customer (required)'}</label>
            <textarea id="lwAppealReply" maxLength={4000} value={ask.response} onChange={e => { const v = e.target.value; setAsk(x => Object.assign({}, x, { response: v })); }} data-field="appeal-reply" />
            {!ask.accept ? <small>{ask.response.trim().length < 3 ? 'At least 3 characters.' : ask.response.trim().length + ' of 4,000 characters'}</small> : null}
          </div>
          {ask.accept ? <label className="check"><input type="checkbox" checked={ask.reset} onChange={e => { const v = e.target.checked; setAsk(x => Object.assign({}, x, { reset: v })); }} data-field="appeal-reset" /> <span>Also clear all their warnings</span></label> : null}
        </ConfirmDialog>
      ) : null}
    </div>
  );
}

/* ---------- sharing rules ---------- */
const UNIT = {
  devices: ['Devices', 'devices'], networks: ['Different networks', 'networks'], countries: ['Countries', 'countries'], requests: ['Viewer requests', 'requests'],
  windowMinutes: ['Time window (minutes)', 'minutes'], windowHours: ['Time window (hours)', 'hours'],
};
const span = (n, unit) => {
  if (unit === 'minutes') return n % 60 === 0 ? span(n / 60, 'hours') : plural(n, 'minute');
  if (unit === 'hours') return n % 24 === 0 && n >= 24 ? (n === 24 ? 'one day' : plural(n / 24, 'day')) : plural(n, 'hour');
  return String(n);
};
function explain(id, p) {
  const x = p || {};
  switch (id) {
    case 'concurrent_devices': return 'Opens an incident when paid sheets are opened on ' + x.devices + ' or more devices from ' + x.networks + ' or more different networks within ' + span(x.windowMinutes, 'minutes') + '. One new device or a new internet connection alone never counts.';
    case 'many_devices_day': return 'Opens an incident when the account is used on ' + x.devices + ' or more different devices within ' + span(x.windowHours, 'hours') + '.';
    case 'many_countries_day': return 'Opens an incident when paid sheets are opened from ' + x.countries + ' or more different countries within ' + span(x.windowHours, 'hours') + '.';
    case 'rapid_page_requests': return 'Opens an incident after ' + count(x.requests) + ' or more sheet-viewer requests within ' + span(x.windowMinutes, 'minutes') + ', far more than reading needs.';
    case 'manual_report': return 'Used when staff report a violation by hand (on a customer’s page). The person reporting decides whether to confirm it.';
    default: return '';
  }
}

function RulesTab({ canWrite, max }) {
  const { data, error, loading, reload } = useServer('/api/admin/security/rules');
  const rules = data ? data.rules || [] : [];
  return (
    <section className="panel" aria-labelledby="lwRulesTitle" data-tab-panel="rules">
      <PanelHead id="lwRulesTitle" title="Sharing rules" sub={'What counts as possible account sharing. A rule only opens an incident; a warning is sent when someone confirms it, or straight away if the rule confirms itself. At ' + max + ' warnings paid access pauses.'} />
      {!canWrite ? <Note tone="neutral">Changing the rules needs the “security.write” permission.</Note> : null}
      <LoadError error={error} what="the rules" onRetry={reload} />
      {loading && !data ? <Loading>Loading the rules…</Loading> : null}
      <div className="lw-cards">{rules.map(r => <RuleCard key={r.id} rule={r} canWrite={canWrite} />)}</div>
    </section>
  );
}

function RuleCard({ rule, canWrite }) {
  const [saved, setSaved] = useState(rule);
  const [draft, setDraft] = useState(() => ({ enabled: rule.enabled, autoConfirm: rule.autoConfirm, severity: rule.severity, params: Object.assign({}, rule.params) }));
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);
  const [ask, setAsk] = useState(null);
  const limits = saved.limits || {};
  const keys = Object.keys(limits);
  const bad = useMemo(() => keys.map(k => {
    const v = draft.params[k], [lo, hi] = limits[k];
    return Number.isInteger(v) && v >= lo && v <= hi ? null : UNIT[k][0] + ' must be a whole number from ' + count(lo) + ' to ' + count(hi) + '.';
  }).filter(Boolean), [draft, keys.join(), limits]);   // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = draft.enabled !== saved.enabled || draft.autoConfirm !== saved.autoConfirm || draft.severity !== saved.severity || keys.some(k => draft.params[k] !== saved.params[k]);
  const manual = saved.id === 'manual_report';
  const [sl, st] = SEVERITY[saved.severity] || [saved.severity, 'neutral'];

  async function save() {
    setBusy(true); setNote(null);
    try {
      const body = { enabled: draft.enabled, severity: draft.severity };
      if (!manual) body.autoConfirm = draft.autoConfirm;
      if (keys.length) body.params = Object.fromEntries(keys.map(k => [k, draft.params[k]]));
      const out = await staffApi('PUT', '/api/admin/security/rules/' + encodeURIComponent(saved.id), body);
      setSaved(out.rule);
      setDraft({ enabled: out.rule.enabled, autoConfirm: out.rule.autoConfirm, severity: out.rule.severity, params: Object.assign({}, out.rule.params) });
      setAsk(null); setNote({ tone: 'ok', msg: 'Saved.' });
    } catch (err) {
      if (ask) setAsk(a => Object.assign({}, a, { error: problem(err) })); else setNote({ tone: 'err', msg: 'Could not save. ' + problem(err) });
    } finally { setBusy(false); }
  }
  const onSave = () => (draft.autoConfirm && !saved.autoConfirm && draft.enabled ? setAsk({ error: null }) : save());
  const set = (k, v) => setDraft(d => Object.assign({}, d, { [k]: v }));
  const setParam = (k, v) => setDraft(d => Object.assign({}, d, { params: Object.assign({}, d.params, { [k]: v === '' ? '' : Number(v) }) }));
  const shown = Object.assign({}, saved.params, draft.params);

  return (
    <article className="lw-card" data-rule={saved.id}>
      <div className="lw-card-head">
        <b>{saved.name}</b>
        <span className="lw-actions">
          <Tag tone={saved.enabled ? 'ok' : 'neutral'}>{saved.enabled ? 'On' : 'Off'}</Tag>
          {!manual ? <Tag tone={saved.autoConfirm ? 'bad' : 'neutral'}>{saved.autoConfirm ? 'Confirms itself' : 'Staff confirm'}</Tag> : null}
          <Tag tone={st}>{sl + ' concern'}</Tag>
        </span>
      </div>
      <p>{explain(saved.id, keys.length && !bad.length ? shown : saved.params)}</p>
      <p className="lw-small">{!saved.enabled ? 'This rule is off: it does not open incidents.' : manual ? 'Reports start as open incidents unless the person reporting confirms them.' : saved.autoConfirm ? 'It confirms itself: the customer gets a warning straight away, without anyone checking first.' : 'Each incident waits for staff to confirm (one warning) or dismiss it.'}</p>
      {canWrite ? (
        <>
          <div className="lw-switches">
            <label className="check"><input type="checkbox" checked={draft.enabled} onChange={e => set('enabled', e.target.checked)} data-field="rule-enabled" /> <span>Rule is on</span></label>
            {!manual ? <label className="check"><input type="checkbox" disabled checked={false} onChange={e => set('autoConfirm', e.target.checked)} data-field="rule-auto" /> <span>Staff review required before warning</span></label> : null}
            <label className="check"><span>Concern level</span>
              <select value={draft.severity} onChange={e => set('severity', e.target.value)} aria-label="Concern level">{['low', 'medium', 'high'].map(s => <option key={s} value={s}>{SEVERITY[s][0]}</option>)}</select>
            </label>
          </div>
          {keys.length ? (
            <div className="lw-rule-params">
              {keys.map(k => (
                <div className="field" key={k}>
                  <label htmlFor={'lwRule' + saved.id + k}>{UNIT[k] ? UNIT[k][0] : k}</label>
                  <input id={'lwRule' + saved.id + k} type="number" inputMode="numeric" min={limits[k][0]} max={limits[k][1]} step="1" value={draft.params[k] === undefined ? '' : draft.params[k]} onChange={e => setParam(k, e.target.value)} />
                  <small>{count(limits[k][0])} to {count(limits[k][1])}</small>
                </div>
              ))}
            </div>
          ) : null}
          {bad.length ? <Note tone="err">{bad.join(' ')}</Note> : null}
          {note ? <Note tone={note.tone}>{note.msg}</Note> : null}
          <div className="lw-actions">
            <button type="button" className="btn btn-primary btn-sm" disabled={!dirty || busy || bad.length > 0} onClick={onSave} data-act="save-rule">{busy && !ask ? <><span className="lw-spin" aria-hidden="true" />Saving…</> : 'Save'}</button>
            {dirty ? <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => { setDraft({ enabled: saved.enabled, autoConfirm: saved.autoConfirm, severity: saved.severity, params: Object.assign({}, saved.params) }); setNote(null); }}>Undo changes</button> : null}
          </div>
        </>
      ) : keys.length ? <KV rows={keys.map(k => [UNIT[k] ? UNIT[k][0] : k, count(saved.params[k])])} /> : null}
      <p className="lw-small">Last changed {saved.updatedAt ? when(saved.updatedAt) : 'never'}.</p>
      {ask ? (
        <ConfirmDialog title="Let this rule confirm itself?" confirmLabel="Save, confirms itself" busyLabel="Saving…" danger busy={busy} error={ask.error}
          onCancel={() => { if (!busy) setAsk(null); }} onConfirm={save}>
          <p>When <b>{saved.name}</b> trips, the customer gets a warning by email straight away, without anyone checking first. At the warning limit their paid access pauses by itself.</p>
          <p>Keep this off unless you are sure the rule does not catch ordinary families.</p>
        </ConfirmDialog>
      ) : null}
    </article>
  );
}
