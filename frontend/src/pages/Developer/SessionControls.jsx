import { useEffect, useState } from 'react';
import { staffApi } from '../../services/api.js';
import ConfirmDialog from '../../components/dashboard/ConfirmDialog.jsx';
import { CardTable, Loading, LoadError, Note, PanelHead, Tag, Missing, useServer, useStaffAccess, problem, when, ago, plural, initialsOf, qs, NO_PERMISSION } from './common.jsx';

/* One customer's sign-ins (each device or browser they signed in on), each with its own Block or
   Unblock. Blocking one sign-in signs out only that device: the customer's other sign-ins, their
   paid access and the account itself are not touched. Used under Admin → Security and in
   Developer → Authentication. Needs security.read to see and security.write to change. */

const STATUS = { active: ['Signed in', 'ok'], blocked: ['Blocked', 'bad'], ended: ['Ended', 'neutral'] };
export const deviceOf = s => [s.browser, s.device].filter(Boolean).join(' on ') || s.label || '';
const whereOf = s => [s.network || s.ip, s.country].filter(Boolean).join(' · ');

export function SessionList({ customer, canWrite, onChanged }) {
  const [showEnded, setShowEnded] = useState(false);
  const path = '/api/admin/security/customers/' + encodeURIComponent(customer.id) + '/sessions' + (showEnded ? '?all=1' : '');
  const { data, error, loading, reload } = useServer(path);
  const [list, setList] = useState(null);
  const [busy, setBusy] = useState(null);         /* the session id while a request runs */
  const [note, setNote] = useState(null);         /* { tone, msg } after it */
  const [ask, setAsk] = useState(null);           /* { session, reason, error } for Block */
  useEffect(() => { setList(data ? data.sessions || [] : null); }, [data]);
  useEffect(() => { setNote(null); setAsk(null); }, [customer.id]);

  async function run(s, act, reason) {
    setBusy(s.id); setNote(null);
    try {
      const out = await staffApi('POST', '/api/admin/security/sessions/' + encodeURIComponent(s.id) + '/' + act, act === 'block' ? (reason ? { reason } : {}) : {});
      setList(l => (l || []).map(x => (x.id === s.id ? out.session : x)));
      setAsk(null);
      const dev = deviceOf(s) || 'that device';
      setNote({ tone: 'ok', msg: act === 'block'
        ? 'The sign-in on ' + dev + ' is blocked. ' + (customer.name || customer.email) + '’s other sign-ins keep working.'
        : 'The sign-in on ' + dev + ' works again.' + (out.changed ? '' : ' (It was not blocked.)') });
      if (onChanged && out.customer) onChanged(out.customer);
    } catch (err) {
      const msg = problem(err);
      if (act === 'block') setAsk(a => (a ? { ...a, error: msg } : a)); else setNote({ tone: 'err', msg: 'Could not unblock that sign-in. ' + msg });
      if (err.code === 'session_ended') { setAsk(null); setNote({ tone: 'err', msg }); reload(); }
    } finally { setBusy(null); }
  }

  const rows = list || [];
  const active = rows.filter(s => s.status === 'active').length;
  return (
    <div className="lw-stack" data-sessions={customer.id}>
      <div className="lw-bar">
        <div>
          <p className="lw-sub-title">Sign-ins{list ? ' · ' + plural(active, 'active', 'active') : ''}</p>
          <p className="auth-sub">Each device or browser the customer is signed in on. Blocking one signs out only that device.</p>
        </div>
        <label className="check lw-small"><input type="checkbox" checked={showEnded} onChange={e => setShowEnded(e.target.checked)} /> <span>Show ended sign-ins too</span></label>
      </div>
      {note ? <Note tone={note.tone}>{note.msg}</Note> : null}
      <LoadError error={error} what="the sign-ins" onRetry={reload} />
      {loading && !list ? <Loading>Loading sign-ins…</Loading> : null}
      {list ? (
        <CardTable
          rows={rows} rowKey={s => s.id} rowProps={s => ({ 'data-session': s.id, 'data-status': s.status })}
          empty={showEnded ? 'This customer has no sign-ins on record.' : 'This customer is not signed in anywhere right now.'}
          caption={'Sign-ins of ' + (customer.email || '')}
          cols={[
            ['Device', s => <span className="lw-who"><span><b>{deviceOf(s) || <Missing>Device not recorded</Missing>}</b><small className="lw-mono">{s.id}</small></span></span>],
            ['Network', s => (whereOf(s) ? <span className="lw-mono">{whereOf(s)}</span> : <Missing />)],
            ['Signed in', s => (s.createdAt ? when(s.createdAt) : <Missing />)],
            ['Last active', s => (s.lastActiveAt ? <span title={when(s.lastActiveAt)}>{ago(s.lastActiveAt)}</span> : <Missing />)],
            ['Status', s => { const [l, t] = STATUS[s.status] || [s.status, 'neutral']; return <span title={s.blockReason ? 'Reason: ' + s.blockReason : undefined}><Tag tone={t}>{l}</Tag></span>; }],
            ['', s => {
              if (!canWrite || s.status === 'ended') return null;
              const on = s.status === 'active', mine = busy === s.id;
              return (
                <button type="button" className={'btn btn-ghost btn-sm' + (on ? ' btn-danger' : '')} disabled={!!busy} data-act={on ? 'block-session' : 'unblock-session'}
                  aria-label={(on ? 'Block the sign-in on ' : 'Unblock the sign-in on ') + (deviceOf(s) || s.id)}
                  onClick={() => (on ? setAsk({ session: s, reason: '', error: null }) : run(s, 'unblock'))}>
                  {mine && !on ? <><span className="lw-spin" aria-hidden="true" />Unblocking…</> : on ? 'Block' : 'Unblock'}
                </button>
              );
            }],
          ]} />
      ) : null}
      {ask ? (
        <ConfirmDialog
          title="Block this sign-in?" confirmLabel="Block sign-in" busyLabel="Blocking…" danger busy={busy === ask.session.id} error={ask.error}
          onCancel={() => { if (!busy) setAsk(null); }} onConfirm={() => run(ask.session, 'block', ask.reason.trim())}>
          <p>The sign-in on <b>{deviceOf(ask.session) || 'this device'}</b>{ask.session.lastActiveAt ? ' (last active ' + ago(ask.session.lastActiveAt) + ')' : ''} stops working straight away and cannot be used again until you unblock it.</p>
          <p><b>{customer.name || customer.email}</b> stays signed in everywhere else. Their paid access and account are not changed.</p>
          <div className="field">
            <label htmlFor="lwBlockReason">Reason (optional, kept in the log)</label>
            <textarea id="lwBlockReason" maxLength={300} value={ask.reason} placeholder="For example: the customer does not recognise this device" onChange={e => { const v = e.target.value; setAsk(a => ({ ...a, reason: v })); }} />
          </div>
        </ConfirmDialog>
      ) : null}
    </div>
  );
}

/* Developer → Authentication: find a customer, see their sign-ins, block or unblock one. */
export default function SessionControls() {
  const access = useStaffAccess();
  const canRead = access.can('security.read'), canWrite = access.can('security.write');
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(null);
  useEffect(() => { const t = setTimeout(() => setQ(text.trim()), 300); return () => clearTimeout(t); }, [text]);
  const { data, error, loading, reload } = useServer('/api/admin/security/customers' + qs({ q, limit: 20 }), { skip: !canRead });
  const list = data ? data.customers || [] : [];
  const cur = sel ? list.find(c => c.id === sel.id) || sel : null;

  return (
    <section className="panel" aria-labelledby="lwSesTitle" data-section="session-controls">
      <PanelHead id="lwSesTitle" title="Customer sign-ins" sub="Look up a customer to see where they are signed in, and block or unblock one sign-in at a time." />
      {!access.ready ? <Loading /> : !canRead ? <Note tone="neutral">{NO_PERMISSION} Seeing customers’ sign-ins needs the “security.read” permission.</Note> : (
        <>
          {!canWrite ? <Note tone="neutral">You can look, but blocking a sign-in needs the “security.write” permission.</Note> : null}
          <div className="lw-bar">
            <input className="search" type="search" placeholder="Search by name or email" aria-label="Search customers by name or email" value={text} onChange={e => setText(e.target.value)} data-field="session-search" />
            {loading ? <Loading>Searching…</Loading> : null}
          </div>
          <LoadError error={error} what="the customers" onRetry={reload} />
          {data ? (
            <CardTable
              rows={list} rowKey={c => c.id} rowProps={c => ({ 'data-customer': c.email })}
              empty={q ? 'No customer matches “' + q + '”.' : 'No customers yet.'}
              cols={[
                ['Customer', c => <span className="lw-who"><span className="av round">{initialsOf(c.name || c.email)}</span><span><b>{c.name || c.email}</b><small>{c.email}</small></span></span>],
                ['Signed in on', c => plural(c.activeSessionCount || 0, 'device')],
                ['Blocked sign-ins', c => count0(c.blockedSessionCount)],
                ['Last sign-in', c => (c.lastLoginAt ? ago(c.lastLoginAt) : <Missing>Never</Missing>)],
                ['', c => <button type="button" className={'btn btn-sm ' + (cur && cur.id === c.id ? 'btn-primary' : 'btn-ghost')} aria-pressed={!!(cur && cur.id === c.id)} data-act="show-sessions" onClick={() => setSel(c)}>{cur && cur.id === c.id ? 'Showing' : 'Sign-ins'}</button>],
              ]} />
          ) : null}
          {cur ? (
            <div className="lw-stack" style={{ borderTop: '1px solid var(--border)', paddingTop: 16 }}>
              <div className="lw-detail-head">
                <span className="av round">{initialsOf(cur.name || cur.email)}</span>
                <div className="lw-grow"><h3 className="card-title">{cur.name || cur.email}</h3><p className="auth-sub">{cur.email}</p></div>
                {cur.blocked ? <Tag tone="bad">Account blocked</Tag> : null}
                {cur.accessStatus === 'suspended' ? <Tag tone="bad">Paid access paused</Tag> : null}
              </div>
              <SessionList customer={cur} canWrite={canWrite} onChanged={() => reload()} />
              <p className="lw-small">Paid access and whole-account blocks are under Admin → Security.</p>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
const count0 = n => (n ? String(n) : 'None');
