import { API_BASE } from '../../services/api.js';
import { SITE_VERSION } from '../../data/content.js';
import MetricCard from '../../components/dashboard/MetricCard.jsx';
import { StaffStyles, KV, Tag, Loading, LoadError, Note, PanelHead, Where, useServer, useStaffAccess, when } from './common.jsx';
import { siteBuild, usePublicHealth } from './Health.jsx';

/* Developer → Deployments: which version of the API and of the website is running now. The API
   reports its own version; the website's version and build file come from this page itself.
   Deploy history lives in Supabase (API) and with the web host (website), not here. */

const MODE = { live: 'Live', test: 'Test mode', sandbox: 'Sandbox (test)' };

export default function Deployments() {
  const access = useStaffAccess();
  const canDev = access.can('developer.read');
  const pub = usePublicHealth(0);
  const h = useServer('/api/admin/developer/health', { skip: !canDev });
  const d = h.data;
  const build = siteBuild();
  const apiVersion = d ? d.version : pub.body && pub.body.version ? pub.body.version : null;
  const gw = (d && d.gateways) || (pub.body && pub.body.gateways) || {};
  const modes = Object.entries(gw).filter(([, m]) => m);
  const live = modes.length && modes.every(([, m]) => m === 'live');
  const apiHost = (() => { try { return API_BASE ? new URL(API_BASE).host : location.host; } catch (_) { return API_BASE || location.host; } })();

  return (
    <>
      <StaffStyles />
      <div className="kpi-row">
        <MetricCard label="API version" value={apiVersion || (pub.loading ? '…' : 'Not reported')} sub="the Edge Function “api”" icon="api" />
        <MetricCard label="Website version" value={SITE_VERSION} sub="this page’s build" icon="deploy" />
        <MetricCard label="Website build" value={build || 'Not known'} sub="main script file" icon="activity" />
        <MetricCard label="Payments" value={!modes.length ? (pub.loading && !d ? '…' : 'Not set up') : live ? 'Live' : 'Test mode'} sub={modes.map(([k, m]) => k + ' ' + (MODE[m] || m).toLowerCase()).join(' · ')} icon="payments" />
      </div>
      <div className="grid-2">
        <section className="panel" aria-labelledby="lwDepNow">
          <PanelHead id="lwDepNow" title="Running now" />
          {!access.ready || (h.loading && !d && pub.loading) ? <Loading /> : null}
          <LoadError error={h.error} what="the server’s report" onRetry={h.reload} />
          <KV rows={[
            ['API version', apiVersion ? <span className="lw-mono" key="a">{apiVersion}</span> : ''],
            ['API runtime', d && d.runtime ? 'Deno ' + d.runtime.deno : ''],
            ['API address', <span className="lw-mono" key="h">{apiHost}</span>],
            ['API answering', pub.loading ? 'Checking…' : pub.ok ? <Tag tone="ok" key="o">Yes</Tag> : <Tag tone="bad" key="o">{pub.status ? 'Answered ' + pub.status : 'Could not be reached'}</Tag>],
            ['Website version', <span className="lw-mono" key="v">{SITE_VERSION}</span>],
            ['Website build file', build ? <span className="lw-mono" key="b">{build}</span> : ''],
            ['Website address', <span className="lw-mono" key="w">{location.origin}</span>],
            ['Checked', d ? when(d.time) : pub.body && pub.body.time ? when(pub.body.time) : ''],
          ]} />
          {!canDev && access.ready ? <p className="lw-small">The runtime and gateway details need the “developer.read” permission.</p> : null}
        </section>
        <section className="panel" aria-labelledby="lwDepHow">
          <PanelHead id="lwDepHow" title="Where deploys are recorded" />
          <Note tone="info">
            <p>The API runs on Supabase as the Edge Function <span className="lw-mono">api</span>. Each deploy, with its time, is listed under <Where>Supabase dashboard → Edge Functions → api</Where>.</p>
            <p>The website is a set of files built with Vite and uploaded to the web host. The build file name above changes with every new build, so it shows which build visitors get.</p>
            <p>Database changes (migrations) are listed on the Dashboard page under Database changes.</p>
          </Note>
        </section>
      </div>
    </>
  );
}
