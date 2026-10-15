import { useEffect, useState } from 'react';
import { apiUrl } from '../../services/api.js';
import { SITE_VERSION } from '../../data/content.js';
import MetricCard from '../../components/dashboard/MetricCard.jsx';
import { StaffStyles, CardTable, KV, Tag, Missing, Loading, LoadError, Note, NoAccess, PanelHead, Where, useServer, useGo, useStaffAccess, when, ago, count, plural, ms } from './common.jsx';

/* Developer → Dashboard: how the live system is doing, from the server's own report
   (GET /api/admin/developer/health) and the public health check (GET /api/health).
   Settings are shown as set or not set up, never their values. */

const GATEWAYS = [['razorpay', 'Razorpay', 'RAZORPAY_WEBHOOK_SECRET'], ['stripe', 'Stripe', 'STRIPE_WEBHOOK_SECRET'], ['paypal', 'PayPal', 'PAYPAL_WEBHOOK_ID']];
const MODE = { live: ['Live', 'ok'], test: ['Test mode', 'info'], sandbox: ['Sandbox (test)', 'info'] };
const MAILER = { brevo: 'Brevo', resend: 'Resend' };
export const ENV_HELP = [
  ['Website', [['SITE_URL', 'The website’s address, used in emails and payment returns'], ['ALLOWED_ORIGINS', 'Which websites may call the API from a browser']]],
  ['Email', [['MAIL_PROVIDER', 'Which service sends email (Brevo or Resend)'], ['MAIL_FROM', 'The address emails come from'], ['BREVO_API_KEY', 'Key for Brevo, needed when Brevo sends email'], ['RESEND_API_KEY', 'Key for Resend, needed when Resend sends email']]],
  ['Razorpay', [['RAZORPAY_KEY_ID', 'Razorpay account key'], ['RAZORPAY_KEY_SECRET', 'Razorpay secret key'], ['RAZORPAY_WEBHOOK_SECRET', 'Checks that payment notifications really come from Razorpay']]],
  ['Stripe', [['STRIPE_SECRET_KEY', 'Stripe secret key'], ['STRIPE_WEBHOOK_SECRET', 'Checks that payment notifications really come from Stripe']]],
  ['PayPal', [['PAYPAL_CLIENT_ID', 'PayPal app id'], ['PAYPAL_SECRET', 'PayPal app secret'], ['PAYPAL_MODE', 'Live or sandbox (test)'], ['PAYPAL_WEBHOOK_ID', 'Checks that payment notifications really come from PayPal']]],
  ['Sign-in and sheets', [['LWW_JWT_SECRET', 'Signs the links that open sheets in the viewer'], ['AUTH_FORWARD_IP', 'Passes the visitor’s address to sign-in checks (optional)']]],
  ['Supabase', [['SUPABASE_DB_URL', 'Database connection (set by Supabase)'], ['SUPABASE_SERVICE_ROLE_KEY', 'Server key (set by Supabase)'], ['SUPABASE_SECRET_KEYS', 'Newer server keys (optional)'], ['SUPABASE_JWKS', 'Lets the API check sign-ins without asking Supabase each time (optional)']]],
];
const JOBS = { outbox_sweep: 'Email sender (sends queued emails)', housekeeping: 'Housekeeping (clears old sign-ins and logs)' };

/* the website build this browser is running: the file name of the site's own main script
   (Vite names it after its contents, so it changes with every build). Scripts from other
   sites, such as a payment gateway's, are never taken for it. */
export function siteBuild() {
  try {
    if (import.meta.env && import.meta.env.DEV) return 'development server';
    const own = [...document.querySelectorAll('script[type="module"][src]')]
      .map(x => { try { return new URL(x.getAttribute('src') || '', location.href); } catch (_) { return null; } })
      .filter(u => u && u.origin === location.origin && !u.pathname.includes('/@vite/'));
    const main = own.find(u => /\/assets\/[^/]+\.js$/.test(u.pathname)) || own[0];
    return main ? main.pathname.split('/').pop() : '';
  } catch (_) { return ''; }
}

/* the public health check, timed from this browser */
export function usePublicHealth(version) {
  const [st, setSt] = useState({ loading: true, ok: null, status: null, body: null, ms: null, error: null });
  useEffect(() => {
    let alive = true;
    const t0 = performance.now();
    setSt(s => Object.assign({}, s, { loading: true }));
    fetch(apiUrl('/api/health'), { cache: 'no-store' })
      .then(async r => { const body = await r.json().catch(() => null); if (alive) setSt({ loading: false, ok: r.ok, status: r.status, body, ms: performance.now() - t0, error: null }); })
      .catch(err => { if (alive) setSt({ loading: false, ok: false, status: 0, body: null, ms: null, error: err }); });
    return () => { alive = false; };
  }, [version]);
  return st;
}

export default function Health() {
  const access = useStaffAccess();
  const go = useGo();
  const canRead = access.can('developer.read');
  const [ver, setVer] = useState(0);
  const h = useServer('/api/admin/developer/health', { skip: !canRead, version: ver });
  const pub = usePublicHealth(ver);
  if (!access.ready) return <section className="panel"><StaffStyles />{access.error ? <LoadError error={access.error} what="your staff permissions" /> : <Loading />}</section>;
  if (!canRead) return <><StaffStyles /><NoAccess title="System health" need="developer.read" /></>;

  const d = h.data;
  const refresh = () => setVer(v => v + 1);
  if (!d) {
    return (
      <section className="panel"><StaffStyles />
        <PanelHead title="System health" sub="What the server reports about itself." />
        {h.loading ? <Loading>Asking the server…</Loading> : null}
        <LoadError error={h.error} what="the health report" onRetry={h.reload} />
      </section>
    );
  }

  const env = d.env || {};
  const ob = d.outbox || {};
  const pay = d.payments || {};
  const files = d.files || {};
  const gw = d.gateways || {};
  const modes = GATEWAYS.filter(([k]) => gw[k]);
  const warnings = d.warnings || [];
  const pubOk = pub.ok === true;
  const issues = warnings.length + (pub.loading || pubOk ? 0 : 1) + (ob.failed24h ? 1 : 0) + (pay.notOk24h ? 1 : 0);
  const buildName = siteBuild();
  const errs = (d.errors && d.errors.byType) || [];

  return (
    <>
      <StaffStyles />
      <div className="kpi-row five" data-health="">
        <MetricCard label="Overall" value={issues ? plural(issues, 'thing') + ' to check' : 'All good'} sub={'Checked ' + ago(d.time)} icon="health" />
        <MetricCard label="Database" value={d.db && d.db.ok ? 'Working' : 'Not reachable'} sub={d.db ? 'answered in ' + ms(d.db.latencyMs) : ''} icon="db" />
        <MetricCard label="Email" value={d.mail && d.mail.ready ? 'Ready' : 'Not set up'} sub={d.mail && d.mail.ready ? (MAILER[d.mail.provider] || d.mail.provider) + ' · ' + count(ob.waiting || 0) + ' waiting' : 'emails wait in the queue'} icon="messages" />
        <MetricCard label="Payments" value={modes.length ? plural(modes.length, 'gateway') : 'Not set up'} sub={modes.length ? modes.map(([k, l]) => l + ' ' + (MODE[gw[k]] ? MODE[gw[k]][0].toLowerCase() : gw[k])).join(' · ') : 'nothing can be bought'} icon="payments" />
        <MetricCard label="API" value={'Version ' + (d.version || '?')} sub={pub.loading ? 'measuring…' : pubOk ? 'round trip ' + ms(pub.ms) + ' from this browser' : 'public check failed'} icon="api" />
      </div>

      <section className="panel" aria-labelledby="lwHealthTodo">
        <PanelHead id="lwHealthTodo" title="Things to look at" sub="From the server’s own checks.">
          <button type="button" className="btn btn-ghost btn-sm" onClick={refresh} disabled={h.loading} data-act="refresh-health">{h.loading ? <><span className="lw-spin" aria-hidden="true" />Checking…</> : 'Check again'}</button>
        </PanelHead>
        <LoadError error={h.error} what="the latest report" onRetry={h.reload} />
        {issues ? (
          <div className="lw-stack" style={{ gap: 8 }}>
            {warnings.map(w => <Note key={w} tone="err">{w}</Note>)}
            {!pub.loading && !pubOk ? <Note tone="err">The public health check {pub.status ? 'answered ' + pub.status : 'could not be reached'} from this browser. Visitors may not be able to use the site.</Note> : null}
            {ob.failed24h ? <Note tone="err">{plural(ob.failed24h, 'email')} failed in the last 24 hours.{go('emails') ? ' ' : ''}{go('emails') ? <button type="button" className="link" onClick={go('emails')}>See Emails</button> : null}</Note> : null}
            {pay.notOk24h ? <Note tone="err">{plural(pay.notOk24h, 'payment notification')} had a problem in the last 24 hours{pay.badSignatures24h ? ' (' + pay.badSignatures24h + ' with a bad signature)' : ''}. {go('webhooks') ? <button type="button" className="link" onClick={go('webhooks')}>See Webhooks</button> : null}</Note> : null}
          </div>
        ) : <Note tone="ok">Nothing needs attention. The database, email and payments all answer as expected.</Note>}
      </section>

      <div className="grid-2">
        <section className="panel" aria-labelledby="lwHealthChecks">
          <PanelHead id="lwHealthChecks" title="Checks" />
          <CardTable caption="Checks" rowKey={r => r[0]} rows={[
            ['Database', d.db && d.db.ok, d.db ? 'Postgres ' + String(d.db.serverVersion || '').split(' ')[0] + ', answered in ' + ms(d.db.latencyMs) : ''],
            ['Public health check', pub.loading ? null : pubOk, pub.loading ? 'Measuring…' : pubOk ? 'Answered in ' + ms(pub.ms) + ' from this browser' : pub.status ? 'Answered ' + pub.status : 'Could not be reached from this browser'],
            ['Worksheet files', !files.onSaleWithoutPdf, count(files.withPdf) + ' of ' + plural(files.products || 0, 'sheet') + ' have a PDF in storage' + (files.onSaleWithoutPdf ? '; ' + files.onSaleWithoutPdf + ' on sale without one' : '')],
            ['Email', !!(d.mail && d.mail.ready), d.mail && d.mail.ready ? 'Sent by ' + (MAILER[d.mail.provider] || d.mail.provider) + (d.mail.fromSet ? '' : '; the from address is not set up') : 'Not set up: emails wait in the queue until it is'],
            ['Email queue', !ob.gaveUp, count(ob.waiting || 0) + ' waiting, ' + count(ob.due || 0) + ' due now' + (ob.gaveUp ? ', ' + ob.gaveUp + ' gave up' : '') + (ob.oldestWaitingAt ? '; oldest waiting since ' + ago(ob.oldestWaitingAt) : '')],
            ['Payment notifications', !pay.notOk24h, pay.lastEvent ? 'Last one ' + ago(pay.lastEvent.at) + ' (' + pay.lastEvent.provider + '); ' + count(pay.events24h) + ' in 24 hours' : 'None received yet'],
          ]} cols={[
            ['Check', r => <b>{r[0]}</b>],
            ['Status', r => (r[1] == null ? <Tag tone="neutral">Checking</Tag> : r[1] ? <Tag tone="ok">OK</Tag> : <Tag tone="bad">Look at this</Tag>)],
            ['Detail', r => <span className="lw-small" style={{ color: 'var(--foreground)' }}>{r[2]}</span>],
          ]} />
        </section>

        <section className="panel" aria-labelledby="lwHealthGw">
          <PanelHead id="lwHealthGw" title="Payment gateways" sub="Which gateways can take money, and whether their notifications can be checked." />
          <CardTable caption="Payment gateways" rowKey={r => r[0]} rows={GATEWAYS} cols={[
            ['Gateway', ([, l]) => <b>{l}</b>],
            ['Mode', ([k]) => (gw[k] ? <Tag tone={(MODE[gw[k]] || [])[1] || 'neutral'}>{(MODE[gw[k]] || [gw[k]])[0]}</Tag> : <Tag tone="neutral">Not set up</Tag>)],
            ['Notifications', ([, , secret]) => (env[secret] ? <Tag tone="ok">Can be checked</Tag> : <Tag tone="neutral">Not set up</Tag>)],
          ]} />
          <p className="lw-small">Test and sandbox modes take no real money. Switching to live is done with the keys under <Where>Supabase dashboard → Edge Functions → Secrets</Where>.</p>
        </section>
      </div>

      <div className="grid-2">
        <section className="panel" aria-labelledby="lwHealthVer">
          <PanelHead id="lwHealthVer" title="Versions" />
          <KV rows={[
            ['API (Edge Function)', d.version ? <span className="lw-mono">{d.version}</span> : ''],
            ['Runtime', d.runtime && d.runtime.deno ? 'Deno ' + d.runtime.deno : ''],
            ['Database', d.db ? 'Postgres ' + String(d.db.serverVersion || '').split(' ')[0] : ''],
            ['Database time zone', d.db ? d.db.timeZone : ''],
            ['Website version', <span className="lw-mono" key="v">{SITE_VERSION}</span>],
            ['Website build', buildName ? <span className="lw-mono" key="b">{buildName}</span> : ''],
            ['Report made', when(d.time)],
          ]} />
        </section>
        <section className="panel" aria-labelledby="lwHealthMig">
          <PanelHead id="lwHealthMig" title="Database changes" sub="The migrations the database reports as applied." />
          {d.migrations && d.migrations.readable ? (
            d.migrations.count ? (
              <>
                <KV rows={[['Applied', count(d.migrations.count)], ['Latest', d.migrations.latest ? <span className="lw-mono" key="l">{d.migrations.latest.version}{d.migrations.latest.name ? ' ' + d.migrations.latest.name : ''}</span> : '']]} />
                <details className="err-item"><summary>All {count(d.migrations.count)} migrations</summary>
                  <pre className="lw-pre">{(d.migrations.list || []).map(m => m.version + (m.name ? '  ' + m.name : '')).join('\n')}</pre>
                </details>
              </>
            ) : <Note tone="neutral">The database reports no migration history. That is normal on a local test database that was built from the schema files; on the live project, see <Where>Supabase dashboard → Database → Migrations</Where>.</Note>
          ) : d.migrations && d.migrations.reason === 'no_history_table'
            ? <Note tone="neutral">This database keeps no migration history. That is normal for a copy built straight from the schema files, such as a local test database. On the live project, see <Where>Supabase dashboard → Database → Migrations</Where>.</Note>
            : <Note tone="neutral">The server {d.migrations && d.migrations.reason === 'no_permission' ? 'is not allowed to read' : 'could not read'} the migration history. See <Where>Supabase dashboard → Database → Migrations</Where>.</Note>}
        </section>
      </div>

      <div className="grid-2">
        <section className="panel" aria-labelledby="lwHealthQueue">
          <PanelHead id="lwHealthQueue" title="Email queue" sub="Emails wait here and go out one by one.">
            {go('emails') ? <button type="button" className="btn btn-ghost btn-sm" onClick={go('emails')}>Open Emails</button> : null}
          </PanelHead>
          <KV rows={[
            ['Waiting to send', count(ob.waiting || 0) + (ob.due ? ' (' + count(ob.due) + ' due now)' : '')],
            ['Sent in the last 24 hours', count(ob.sent24h || 0)],
            ['Failed in the last 24 hours', count(ob.failed24h || 0)],
            ['Gave up after retries', count(ob.gaveUp || 0)],
            ['Skipped by staff', count(ob.skipped || 0)],
            ['Last sent', ob.lastSentAt ? ago(ob.lastSentAt) : <Missing key="n">Nothing sent yet</Missing>],
          ]} />
        </section>
        <section className="panel" aria-labelledby="lwHealthJobs">
          <PanelHead id="lwHealthJobs" title="Background jobs" sub="When each job last ran on the server." />
          <KV rows={Object.keys(Object.assign({}, JOBS, d.jobs || {})).map(k => [JOBS[k] || k, d.jobs && d.jobs[k] ? <span title={when(d.jobs[k])} key={k}>{ago(d.jobs[k])}</span> : <Missing key={k}>Has not run yet</Missing>])} />
          {errs.length ? <p className="lw-small">{plural(errs.reduce((n, e) => n + (e.last7d || 0), 0), 'problem')} logged in the last 7 days. {go('errors') ? <button type="button" className="link" onClick={go('errors')}>See Errors</button> : null}</p> : <p className="lw-small">No problems logged in the last 7 days.</p>}
        </section>
      </div>

      <section className="panel" aria-labelledby="lwHealthEnv">
        <PanelHead id="lwHealthEnv" title="Configuration" sub="Whether each server setting exists. Values (keys and passwords) never leave the server." />
        <CardTable caption="Server settings" rowKey={r => r[1]} rows={ENV_HELP.flatMap(([group, list]) => list.map(([name, help]) => [group, name, help]))
          .concat(Object.keys(env).filter(k => !ENV_HELP.some(([, l]) => l.some(([n]) => n === k))).map(k => ['Other', k, '']))} cols={[
          ['Area', r => r[0]],
          ['Setting', r => <span className="lw-mono">{r[1]}</span>],
          ['What it is for', r => <span className="lw-small" style={{ color: 'var(--foreground)' }}>{r[2] || <Missing>No description</Missing>}</span>],
          ['Status', r => (env[r[1]] ? <Tag tone="ok">Set</Tag> : <Tag tone="neutral">Not set up</Tag>)],
        ]} />
        <p className="lw-small">Settings are changed under <Where>Supabase dashboard → Edge Functions → Secrets</Where>. A setting that is not set up only matters if the line above says so (for example, only one email service is needed).</p>
      </section>
    </>
  );
}
