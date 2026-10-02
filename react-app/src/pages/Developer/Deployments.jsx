import { useEffect, useState } from 'react';
import MetricCard from '../../components/dashboard/MetricCard.jsx';
import { fmt } from '../Portal/dashboard.js';
import { SITE_VERSION } from '../../data/content.js';

const REPO = 'SumitDendage/kids-book-website';

/* site version, host, and the latest commits on GitHub (public API, no key) */
export default function Deployments() {
  const [commits, setCommits] = useState(null);   /* null = fetching, [] … = loaded, false = failed */
  useEffect(() => {
    let alive = true;
    fetch('https://api.github.com/repos/' + REPO + '/commits?per_page=5').then(r => r.json())
      .then(list => { if (!Array.isArray(list)) throw new Error('no data'); if (alive) setCommits(list); })
      .catch(() => { if (alive) setCommits(false); });
    return () => { alive = false; };
  }, []);
  const latest = commits === null ? '…' : commits && commits[0] ? commits[0].sha.slice(0, 7) : '…';
  return (
    <>
      <div className="kpi-row" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))' }}>
        <MetricCard label="Site version" value={SITE_VERSION} sub="from the page" icon="deploy" />
        <MetricCard label="Latest commit" value={latest} sub="on GitHub · main" icon="api" />
        <MetricCard label="Host" value={location.hostname} sub={location.protocol.replace(':', '')} icon="home" />
      </div>
      <section className="panel"><p className="eyebrow">Deployments</p><p className="auth-sub">Latest commits on <a href={'https://github.com/' + REPO + '/commits/main'} target="_blank" rel="noopener noreferrer">{REPO}</a>.</p>
        <div className="dev-list">
          {commits === null ? <div>Fetching…</div> : commits === false ? <div>Could not reach GitHub (offline or rate-limited).</div>
            : commits.map(c => <div key={c.sha}><b>{c.sha.slice(0, 7)}</b> — {c.commit.message.split('\n')[0]} <small>· {fmt(Date.parse(c.commit.author.date))}</small></div>)}
        </div>
      </section>
    </>
  );
}
