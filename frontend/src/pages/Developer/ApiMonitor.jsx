import { useState } from 'react';
import { authFetch, API_BASE } from '../../services/api.js';
import MetricCard from '../../components/dashboard/MetricCard.jsx';
import { StaffStyles, CardTable, KV, Tag, Loading, LoadError, Note, PanelHead, Where, useServer, useStaffAccess, when, ago, count, ms } from './common.jsx';
import { usePublicHealth } from './Health.jsx';

/* Developer → API monitoring: is the API answering, how fast (measured from this browser now),
   and what the server's own records say about the last 24 hours. The full request log (every
   call, its status and time) is kept by Supabase, so this page says where to find it. */

const DAY = 24 * 3600e3;
const within = (list, key) => list.filter(x => Date.now() - x[key] < DAY).length;

export default function ApiMonitor() {
  const access = useStaffAccess();
  const canDev = access.can('developer.read'), canLogs = access.canAny(['logs.read', 'security.read']);
  const [ver, setVer] = useState(0);
  const pub = usePublicHealth(ver);
  const h = useServer('/api/admin/developer/health', { skip: !canDev, version: ver });
  const logins = useServer('/api/admin/login-activity?limit=2000', { skip: !canLogs, version: ver });
  const viewer = useServer('/api/admin/access-log?limit=2000', { skip: !canLogs, version: ver });
  const [runs, setRuns] = useState([]);
  const [measuring, setMeasuring] = useState(false);

  async function measure() {
    setMeasuring(true);
    const out = [];
    for (let i = 0; i < 5; i++) {
      const t0 = performance.now();
      try { const r = await authFetch('/api/health'); await r.text(); out.push({ at: Date.now(), ms: performance.now() - t0, status: r.status }); }
      catch (_) { out.push({ at: Date.now(), ms: null, status: 0 }); }
    }
    setRuns(out); setMeasuring(false);
  }

  const d = h.data;
  const times = runs.filter(r => r.ms != null).map(r => r.ms).sort((a, b) => a - b);
  const host = (() => { try { return API_BASE ? new URL(API_BASE).host : location.host; } catch (_) { return API_BASE || location.host; } })();
  const many = list => (list.length >= 2000 && within(list, 'at') >= 2000 ? '+' : '');
  const lg = logins.data ? logins.data.logins || [] : [];
  const vw = viewer.data ? viewer.data.log || [] : [];

  return (
    <>
      <StaffStyles />
      <div className="kpi-row">
        <MetricCard label="API status" value={pub.loading ? '…' : pub.ok ? 'Answering' : 'Not answering'} sub={pub.loading ? 'checking' : pub.status ? 'public health check: ' + pub.status : 'could not be reached'} icon="api" />
        <MetricCard label="Round trip" value={pub.loading ? '…' : pub.ms != null ? ms(pub.ms) : 'None'} sub="measured in this browser just now" icon="activity" />
        <MetricCard label="Database answer" value={d ? ms(d.db.latencyMs) : canDev ? '…' : 'No access'} sub="measured on the server" icon="db" />
        <MetricCard label="API version" value={d ? d.version : pub.body && pub.body.version ? pub.body.version : '…'} sub={host} icon="deploy" />
      </div>

      <section className="panel" aria-labelledby="lwApiLive">
        <PanelHead id="lwApiLive" title="Response time from this browser" sub="Asks the public health check five times in a row. It measures this browser’s connection too, so it is a rough guide.">
          <button type="button" className="btn btn-ghost btn-sm" disabled={measuring} onClick={measure} data-act="measure-api">{measuring ? <><span className="lw-spin" aria-hidden="true" />Measuring…</> : 'Measure now'}</button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setVer(v => v + 1)}>Check again</button>
        </PanelHead>
        {runs.length ? (
          <>
            <KV rows={[['Fastest', ms(times[0])], ['Middle', ms(times[Math.floor(times.length / 2)])], ['Slowest', ms(times[times.length - 1])], ['Failed', String(runs.filter(r => r.status !== 200).length) + ' of ' + runs.length]]} />
            <CardTable caption="Measurements" rows={runs} rowKey={r => r.at + ':' + r.ms} cols={[
              ['Asked', r => when(r.at)], ['Answer', r => (r.status === 200 ? <Tag tone="ok">200 OK</Tag> : <Tag tone="bad">{r.status ? String(r.status) : 'No answer'}</Tag>)], ['Time', r => (r.ms != null ? ms(r.ms) : '')],
            ]} />
          </>
        ) : <p className="lw-small">Press Measure now to time five requests. Nothing is stored.</p>}
      </section>

      <section className="panel" aria-labelledby="lwApi24">
        <PanelHead id="lwApi24" title="The last 24 hours, from the server’s records" sub="Counted from the server’s own logs, not from this browser." />
        {!canDev && !canLogs ? <Note tone="neutral">You do not have permission for this. It needs the “developer.read” or “logs.read” permission.</Note> : null}
        <LoadError error={h.error} what="the health report" onRetry={h.reload} />
        <LoadError error={logins.error} what="the sign-in log" onRetry={logins.reload} />
        <LoadError error={viewer.error} what="the viewer log" onRetry={viewer.reload} />
        {(h.loading && !d) || (logins.loading && !logins.data) ? <Loading /> : null}
        <KV rows={[
          canLogs && logins.data ? ['Sign-in attempts', count(within(lg, 'at')) + many(lg) + ' (' + count(lg.filter(l => !l.success && Date.now() - l.at < DAY).length) + ' failed)'] : null,
          canLogs && viewer.data ? ['Sheet viewer requests', count(within(vw, 'at')) + many(vw) + ' (' + count(vw.filter(a => !a.ok && Date.now() - a.at < DAY).length) + ' refused)'] : null,
          d ? ['Payment notifications', count(d.payments.events24h) + ' (' + count(d.payments.notOk24h) + ' with a problem)'] : null,
          d ? ['Emails sent', count(d.outbox.sent24h) + ' (' + count(d.outbox.failed24h) + ' failed)'] : null,
          d && d.payments.lastPaidAt ? ['Last paid order', ago(d.payments.lastPaidAt)] : null,
        ]} />
      </section>

      <section className="panel" aria-labelledby="lwApiLogs">
        <PanelHead id="lwApiLogs" title="Every request" sub="The site does not keep its own log of each API call." />
        <Note tone="info">
          <p>Supabase records every request to the API with its status and time. Open <Where>Supabase dashboard → Edge Functions → api</Where>: <Where>Overview</Where> has charts of requests and errors, <Where>Invocations</Where> lists each request, and <Where>Logs</Where> has the server’s messages and crashes.</p>
          <p>The API this website talks to: <span className="lw-mono">{API_BASE || location.origin}</span>.</p>
        </Note>
      </section>
    </>
  );
}
