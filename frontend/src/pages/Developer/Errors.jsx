import { useState } from 'react';
import MetricCard from '../../components/dashboard/MetricCard.jsx';
import { EmailTable } from './Emails.jsx';
import { eventLabel, detailText } from './Logs.jsx';
import { StaffStyles, CardTable, Tag, Loading, LoadError, Note, NoAccess, PanelHead, Where, useServer, useGo, useStaffAccess, when, ago, count } from './common.jsx';

/* Developer → Errors: what went wrong on the server, from the server's own records: problems it
   logged (bad payment signatures, refused payments, watermark failures, locked accounts), emails
   that did not send and payment notifications that failed. Crashes are in the Edge Function logs
   in the Supabase dashboard. Errors in this browser are not collected and are not shown here. */

const GATEWAY = { razorpay: 'Razorpay', stripe: 'Stripe', paypal: 'PayPal' };

export default function Errors() {
  const access = useStaffAccess();
  const go = useGo();
  const canDev = access.can('developer.read'), canMail = access.can('emails.read'), canMailWrite = access.can('emails.write');
  const canPay = access.canAny(['logs.read', 'orders.read']);
  const [ver, setVer] = useState(0);
  const h = useServer('/api/admin/developer/health', { skip: !canDev, version: ver });
  const failed = useServer('/api/admin/emails?status=failed&limit=50', { skip: !canMail, version: ver });
  const pay = useServer('/api/admin/payment-events?ok=false&limit=50', { skip: !canPay, version: ver });
  if (!access.ready) return <section className="panel"><StaffStyles />{access.error ? <LoadError error={access.error} what="your staff permissions" /> : <Loading />}</section>;
  if (!canDev && !canMail && !canPay) return <><StaffStyles /><NoAccess title="Errors" need="developer.read" /></>;

  const d = h.data;
  const byType = (d && d.errors && d.errors.byType) || [];
  const recent = (d && d.errors && d.errors.recent) || [];
  const day = byType.reduce((n, t) => n + (t.last24h || 0), 0), week = byType.reduce((n, t) => n + (t.last7d || 0), 0);
  const mails = failed.data ? failed.data.emails || [] : [];
  const events = pay.data ? pay.data.events || [] : [];
  const top = Math.max(1, ...byType.map(t => t.last7d || 0));
  const reload = () => setVer(v => v + 1);

  return (
    <>
      <StaffStyles />
      <div className="kpi-row">
        <MetricCard label="Problems in 24 hours" value={canDev ? (d ? count(day) : '…') : 'No access'} sub={canDev && d ? count(week) + ' in the last 7 days' : ''} icon="errors" />
        <MetricCard label="Emails that failed" value={canMail ? (failed.data ? count(failed.data.counts ? failed.data.counts.failed : mails.length) : '…') : 'No access'} sub={failed.data && failed.data.counts ? count(failed.data.counts.gaveUp) + ' gave up after retries' : ''} icon="messages" />
        <MetricCard label="Payment notification problems" value={canPay ? (pay.data ? count(events.length) + (events.length >= 50 ? '+' : '') : '…') : 'No access'} sub="failed or refused, newest 50" icon="webhooks" />
        <MetricCard label="Checked" value={d ? ago(d.time) : '…'} sub={d ? when(d.time) : ''} icon="clock" />
      </div>

      <section className="panel" aria-labelledby="lwErrWhere">
        <PanelHead id="lwErrWhere" title="Where errors are kept">
          <button type="button" className="btn btn-ghost btn-sm" onClick={reload} data-act="refresh-errors">Check again</button>
        </PanelHead>
        <Note tone="info">
          <p>This page shows the problems the server records in the database. If the server itself crashes or answers with an error, the details are in <Where>Supabase dashboard → Edge Functions → api → Logs</Where> (and <Where>Invocations</Where> for each request).</p>
          <p>Errors in visitors’ browsers, or in this one, are not collected, so none are shown here.</p>
        </Note>
      </section>

      {canDev ? (
        <section className="panel" aria-labelledby="lwErrTypes" data-section="server-problems">
          <PanelHead id="lwErrTypes" title="Problems the server logged" sub="The last 7 days, by kind." />
          <LoadError error={h.error} what="the server’s problem log" onRetry={h.reload} />
          {h.loading && !d ? <Loading>Loading…</Loading> : null}
          {d && !byType.length ? <Note tone="ok">No problems logged in the last 7 days.</Note> : null}
          {byType.length ? (
            <div className="lw-bars">
              {byType.map(t => (
                <div className="lw-barrow" key={t.type}>
                  <span>{eventLabel(t.type)[0]}<small className="lw-muted">{' · last ' + ago(t.lastAt)}</small></span>
                  <i style={{ width: Math.max(2, Math.round(100 * (t.last7d || 0) / top)) + '%' }} aria-hidden="true" />
                  <span className="lw-small">{count(t.last24h)} today · {count(t.last7d)} this week</span>
                </div>
              ))}
            </div>
          ) : null}
          {recent.length ? (
            <CardTable caption="Most recent problems" rows={recent} rowKey={r => r.id} cols={[
              ['When', r => <span title={when(r.at)}>{when(r.at)}</span>],
              ['What happened', r => { const [l, t] = eventLabel(r.type); return <Tag tone={t}>{l}</Tag>; }],
              ['Reason', r => (r.reason ? <span className="lw-small" style={{ color: 'var(--foreground)' }}>{r.reason}</span> : <span className="lw-muted">Not recorded</span>)],
            ]} />
          ) : null}
        </section>
      ) : null}

      {canMail ? (
        <section className="panel" aria-labelledby="lwErrMail" data-section="failed-emails">
          <PanelHead id="lwErrMail" title="Emails that did not send" sub="Failed emails are tried again by themselves a few times; after that they give up.">
            {go('emails') ? <button type="button" className="btn btn-ghost btn-sm" onClick={go('emails')}>Open Emails</button> : null}
          </PanelHead>
          <LoadError error={failed.error} what="the failed emails" onRetry={failed.reload} />
          {failed.loading && !failed.data ? <Loading>Loading…</Loading> : null}
          {failed.data ? <EmailTable emails={mails} canWrite={canMailWrite} onDone={reload} empty="No failed emails. Everything that was due has gone out." /> : null}
        </section>
      ) : null}

      {canPay ? (
        <section className="panel" aria-labelledby="lwErrPay" data-section="failed-webhooks">
          <PanelHead id="lwErrPay" title="Payment notifications with a problem" sub="Messages from the gateways that failed, were refused or had a signature that did not match.">
            {go('webhooks') ? <button type="button" className="btn btn-ghost btn-sm" onClick={go('webhooks')}>Open Webhooks</button> : null}
          </PanelHead>
          <LoadError error={pay.error} what="the payment notifications" onRetry={pay.reload} />
          {pay.loading && !pay.data ? <Loading>Loading…</Loading> : null}
          {pay.data ? <CardTable caption="Payment notifications with a problem" rows={events} rowKey={e => e.id} empty="No problems with payment notifications." cols={[
            ['Received', e => <span title={when(e.at)}>{when(e.at)}</span>],
            ['Gateway', e => GATEWAY[e.provider] || e.provider],
            ['Event', e => <span className="lw-mono">{e.type}</span>],
            ['Order', e => (e.orderId ? <span className="lw-mono">{e.orderId}</span> : <span className="lw-muted">None</span>)],
            ['Signature', e => (e.signatureOk === false ? <Tag tone="bad">Did not match</Tag> : e.signatureOk ? <Tag tone="ok">Genuine</Tag> : <Tag tone="neutral">Not checked</Tag>)],
            ['Detail', e => <span className="lw-small" style={{ color: 'var(--foreground)' }}>{detailText(e.detail) || e.status}</span>],
          ]} /> : null}
        </section>
      ) : null}
    </>
  );
}
