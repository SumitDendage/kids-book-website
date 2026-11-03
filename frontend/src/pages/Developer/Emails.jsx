import { useEffect, useState } from 'react';
import { staffApi } from '../../services/api.js';
import MetricCard from '../../components/dashboard/MetricCard.jsx';
import { SplitBar } from '../../components/dashboard/Charts.jsx';
import ConfirmDialog from '../../components/dashboard/ConfirmDialog.jsx';
import { StaffStyles, CardTable, Chips, Tag, Missing, Loading, LoadError, Note, NoAccess, PanelHead, useServer, useStaffAccess, problem, qs, when, ago, count, plural } from './common.jsx';

/* Developer → Emails: the outbox. Every email the site sends waits here first and is sent one by
   one; failed ones are tried again a few times. Staff with emails.write can send an email again
   (Retry), leave it unsent (Skip) or send everything that is due now. Emails that held a password
   or a one-time link were never stored, so they can only be skipped. */

export const TEMPLATE = {
  welcome: 'Welcome and password', resend_verification: 'Email confirmation link', password_reset: 'Password reset link', password_changed: 'Password changed',
  purchase_successful: 'Purchase receipt', order_refunded: 'Order refunded', security_warning: 'Security warning', access_suspended: 'Paid access paused',
  access_restored: 'Paid access restored', appeal_decision: 'Reply to an appeal', contact: 'Contact form note', contact_reply: 'Reply to a contact note',
  staff_alert: 'Staff alert', staff_welcome: 'Staff welcome',
};
export const emailStatus = e => (e.status === 'failed' ? (e.gaveUp ? ['Gave up', 'bad'] : ['Failed, will retry', 'bad'])
  : ({ queued: ['Waiting', 'info'], sending: ['Sending', 'info'], sent: ['Sent', 'ok'], skipped: ['Skipped', 'neutral'] })[e.status] || [e.status, 'neutral']);

/* the outbox rows with Retry and Skip; `onDone` reloads the list after an action */
export function EmailTable({ emails, canWrite, onDone, empty }) {
  const [busy, setBusy] = useState(null);
  const [note, setNote] = useState(null);
  const [ask, setAsk] = useState(null);   /* { e, reason, error } for Skip */
  async function retry(e) {
    setBusy(e.id); setNote(null);
    try {
      await staffApi('POST', '/api/admin/emails/' + e.id + '/retry', {});
      setNote({ tone: 'ok', msg: 'The email to ' + e.to + ' is queued again and goes out in a moment.' });
      onDone();
    } catch (err) { setNote({ tone: 'err', msg: 'Could not send it again. ' + problem(err) }); if (err.status === 409) onDone(); }
    finally { setBusy(null); }
  }
  async function skip() {
    const a = ask;
    setBusy(a.e.id);
    try {
      const out = await staffApi('POST', '/api/admin/emails/' + a.e.id + '/skip', a.reason.trim() ? { reason: a.reason.trim() } : {});
      setAsk(null);
      setNote({ tone: 'ok', msg: out.changed === false ? 'That email was already skipped.' : 'The email to ' + a.e.to + ' will not be sent. Retry can still send it later.' });
      onDone();
    } catch (err) { setAsk(x => (x ? Object.assign({}, x, { error: problem(err) }) : x)); }
    finally { setBusy(null); }
  }
  return (
    <div className="lw-stack">
      {note ? <Note tone={note.tone}>{note.msg}</Note> : null}
      <CardTable caption="Emails" rows={emails} rowKey={e => e.id} rowProps={e => ({ 'data-email-id': e.id, 'data-status': e.status, 'data-to': e.to })} empty={empty || 'No emails here.'} cols={[
        ['Created', e => <span title={when(e.createdAt)}>{ago(e.createdAt)}</span>],
        ['To', e => <span className="lw-mono">{e.to}</span>],
        ['Email', e => <span className="lw-who"><span><b>{e.subject || TEMPLATE[e.template] || e.template}</b><small>{TEMPLATE[e.template] || e.template}{e.sensitive ? ' · text not stored' : ''}</small></span></span>],
        ['Status', e => { const [l, t] = emailStatus(e); return <span><Tag tone={t}>{l}</Tag><small className="lw-muted" style={{ display: 'block' }}>{e.status === 'sent' ? (e.sentAt ? 'sent ' + ago(e.sentAt) : '') : plural(e.attempts || 0, 'try', 'tries') + ' of ' + e.maxAttempts + (e.nextAttemptAt ? ', next ' + ago(e.nextAttemptAt) : '')}</small></span>; }],
        ['Last error', e => (e.lastError ? <span className="lw-small" style={{ color: 'var(--foreground)' }}>{e.lastError}</span> : <span className="lw-muted">None</span>)],
        canWrite ? ['', e => (e.canRetry || e.canSkip ? (
          <span className="lw-actions">
            {e.canRetry ? <button type="button" className="btn btn-ghost btn-sm" disabled={!!busy} data-act="retry-email" onClick={() => retry(e)}>{busy === e.id && !ask ? <><span className="lw-spin" aria-hidden="true" />Sending…</> : 'Retry'}</button> : null}
            {e.canSkip ? <button type="button" className="btn btn-ghost btn-sm btn-danger" disabled={!!busy} data-act="skip-email" onClick={() => { setNote(null); setAsk({ e, reason: '', error: null }); }}>Skip</button> : null}
          </span>
        ) : e.sensitive && e.status !== 'sent' ? <span className="lw-small">Cannot be resent</span> : null)] : null,
      ].filter(Boolean)} />
      {ask ? (
        <ConfirmDialog title="Skip this email?" confirmLabel="Skip email" busyLabel="Skipping…" danger busy={busy === ask.e.id} error={ask.error}
          onCancel={() => { if (!busy) setAsk(null); }} onConfirm={skip}>
          <p>“{ask.e.subject || TEMPLATE[ask.e.template] || ask.e.template}” to <b>{ask.e.to}</b> will not be sent. {ask.e.sensitive ? 'It held a password or a one-time link, so it cannot be sent again later.' : 'You can still send it later with Retry.'}</p>
          <div className="field"><label htmlFor="lwSkipReason">Reason (optional, kept in the log)</label><textarea id="lwSkipReason" maxLength={300} value={ask.reason} onChange={ev => { const v = ev.target.value; setAsk(x => Object.assign({}, x, { reason: v })); }} /></div>
        </ConfirmDialog>
      ) : null}
    </div>
  );
}

const PAGE = 100;
export default function Emails() {
  const access = useStaffAccess();
  const canRead = access.can('emails.read'), canWrite = access.can('emails.write');
  const [status, setStatus] = useState('');
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [offset, setOffset] = useState(0);
  const [ver, setVer] = useState(0);
  const [run, setRun] = useState({ busy: false, note: null });
  useEffect(() => { const t = setTimeout(() => setQ(text.trim()), 300); return () => clearTimeout(t); }, [text]);
  useEffect(() => { setOffset(0); }, [status, q]);
  const { data, error, loading, reload } = useServer('/api/admin/emails' + qs({ status, q, limit: PAGE, offset }), { skip: !canRead, version: ver });
  if (!access.ready) return <section className="panel"><StaffStyles />{access.error ? <LoadError error={access.error} what="your staff permissions" /> : <Loading />}</section>;
  if (!canRead) return <><StaffStyles /><NoAccess title="Emails" need="emails.read" /></>;

  const c = (data && data.counts) || {};
  const list = data ? data.emails || [] : [];
  const mailReady = data ? data.mail && data.mail.toLowerCase() !== 'none' : null;
  async function sendDue() {
    setRun({ busy: true, note: null });
    try {
      const out = await staffApi('POST', '/api/admin/emails/process', { limit: 25 });
      setRun({ busy: false, note: { tone: out.failed ? 'err' : 'ok', msg: out.processed ? 'Sent ' + plural(out.sent, 'email') + (out.failed ? '; ' + out.failed + ' failed and will be tried again' : '') + '.' + (out.stoppedEarly ? ' More are waiting: press again to carry on.' : '') : 'Nothing was due to send.' } });
      setVer(v => v + 1);
    } catch (err) { setRun({ busy: false, note: { tone: 'err', msg: problem(err) } }); }
  }
  const from = list.length ? offset + 1 : 0, to = offset + list.length;
  return (
    <>
      <StaffStyles />
      <div className="kpi-row">
        <MetricCard label="Waiting to send" value={data ? count(c.waiting) : '…'} sub={data ? count(c.due) + ' due now' : ''} icon="clock" />
        <MetricCard label="Sent" value={data ? count(c.sent) : '…'} sub="all time" icon="messages" />
        <MetricCard label="Failed" value={data ? count(c.failed) : '…'} sub={data ? count(c.gaveUp) + ' gave up after retries' : ''} icon="errors" />
        <MetricCard label="Skipped" value={data ? count(c.skipped) : '…'} sub="left unsent by staff" icon="activity" />
      </div>
      {data ? (
        <section className="panel" aria-labelledby="lwMailSplit" data-section="email-chart">
          <PanelHead id="lwMailSplit" title="Every email so far" sub="All emails the site has made, by what happened to them." />
          <SplitBar parts={[['Sent', c.sent, 'var(--viz-1)'], ['Waiting', c.waiting, 'var(--viz-4)'], ['Failed', c.failed, 'var(--viz-2)'], ['Skipped', c.skipped, 'var(--viz-other)']]} empty="No emails yet." />
        </section>
      ) : null}
      <section className="panel" aria-labelledby="lwMailTitle" data-section="emails">
        <PanelHead id="lwMailTitle" title="Email outbox" sub="Every email the site sends, newest first. Failed emails are tried again a few times by themselves.">
          {canWrite ? <button type="button" className="btn btn-primary btn-sm" onClick={sendDue} disabled={run.busy || !data || !c.due} data-act="send-due">{run.busy ? <><span className="lw-spin" aria-hidden="true" />Sending…</> : 'Send due emails now'}</button> : null}
        </PanelHead>
        {mailReady === false ? <Note tone="err">Email is not set up on the server, so nothing can be sent. Emails wait here until it is (see Dashboard → Configuration).</Note> : null}
        {!canWrite ? <Note tone="neutral">You can look, but sending again or skipping needs the “emails.write” permission.</Note> : null}
        {run.note ? <Note tone={run.note.tone}>{run.note.msg}</Note> : null}
        <div className="lw-bar">
          <Chips label="Show emails" value={status} onChange={setStatus} options={[
            ['', 'All', data ? c.total : null], ['waiting', 'Waiting', data ? c.waiting : null], ['due', 'Due now', data ? c.due : null], ['failed', 'Failed', data ? c.failed : null],
            ['gave_up', 'Gave up', data ? c.gaveUp : null], ['sent', 'Sent', data ? c.sent : null], ['skipped', 'Skipped', data ? c.skipped : null],
          ]} />
          <input className="search" type="search" placeholder="Search by address or subject" aria-label="Search emails by address or subject" value={text} onChange={e => setText(e.target.value)} />
        </div>
        <LoadError error={error} what="the emails" onRetry={reload} />
        {loading && !data ? <Loading>Loading emails…</Loading> : null}
        {data ? <EmailTable emails={list} canWrite={canWrite} onDone={() => setVer(v => v + 1)} empty={q ? 'No email matches “' + q + '”.' : 'No emails here.'} /> : null}
        {data && (offset > 0 || data.nextOffset != null) ? (
          <div className="lw-bar">
            <span className="lw-small">Showing {count(from)} to {count(to)} of {count(data.total)}</span>
            <span className="lw-actions">
              <button type="button" className="btn btn-ghost btn-sm" disabled={offset === 0 || loading} onClick={() => setOffset(o => Math.max(0, o - PAGE))}>Newer</button>
              <button type="button" className="btn btn-ghost btn-sm" disabled={data.nextOffset == null || loading} onClick={() => setOffset(data.nextOffset)}>Older</button>
            </span>
          </div>
        ) : null}
        <p className="lw-small">Emails that held a password or a one-time link are never stored, so they cannot be sent again: ask the customer to request a new link instead.</p>
      </section>
    </>
  );
}
