import { useState } from 'react';
import Pill from '../../components/dashboard/Pill.jsx';
import Icon from '../../components/dashboard/Icon.jsx';
import Modal from '../../components/dashboard/Modal.jsx';
import { Guard, ErrorNote } from '../../components/dashboard/States.jsx';
import { useDash } from '../Portal/DashContext.js';
import { useStaffGet, fmt, qs, problem, fieldErrors } from '../Portal/dashboard.js';
import { staffApi } from '../../services/api.js';
import { HERO, WHYS } from '../../data/content.js';
import Homepage from './Homepage.jsx';

const keep = { tab: null };

/* The Homepage section: the lists of sheets, the home page's first screen and customer reviews
   waiting to be published. There is no separate Content item in the menu, and no questions and
   answers tab (Sumit, Oct 26); the answers already published stay on the site. */
export default function Content() {
  const { can, stats } = useDash();
  const tabs = [
    can('catalogue.read') ? ['lists', 'Sheet lists'] : null,
    can('content.write') ? ['home', 'Home page text'] : null,
    can('reviews.moderate') ? ['reviews', 'Reviews'] : null,
  ].filter(Boolean);
  const [tab, setTabState] = useState(() => (tabs.some(([id]) => id === keep.tab) ? keep.tab : (tabs[0] || [''])[0]));
  const setTab = t => { keep.tab = t; setTabState(t); };
  const pending = stats && stats.pendingReviews;
  return (
    <>
      <div className="tabs-s" role="tablist">{tabs.map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>{label}{id === 'reviews' && pending ? <small>{pending}</small> : null}</button>)}</div>
      {tab === 'lists' ? <Homepage /> : tab === 'home' ? <HomeText /> : tab === 'reviews' ? <Reviews /> : null}
    </>
  );
}

/* ---------- the home page's first screen ---------- */
function HomeText() {
  const { site, toast } = useDash();
  const q = useStaffGet('/api/admin/content');
  const [busy, setBusy] = useState(''), [errs, setErrs] = useState({}), [err, setErr] = useState(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const home = q.data ? q.data.home : null;
  const show = h => { if (site && typeof site.setContent === 'function') site.setContent(h && h.published !== false ? { badge: h.badge, heroTitle: h.heroTitle, heroLede: h.heroLede, whys: h.whys } : {}); };
  const submit = async e => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const body = {
      badge: String(f.get('badge') || '').trim(), heroTitle: String(f.get('heroTitle') || '').trim(), heroLede: String(f.get('heroLede') || '').trim(),
      whys: String(f.get('whys') || '').split('\n').map(x => x.trim()).filter(Boolean), published: f.get('published') === 'on',
    };
    setBusy('save'); setErr(null); setErrs({});
    try {
      const r = await staffApi('PUT', '/api/admin/content', body);
      q.setData(r && r.home !== undefined ? r : d => ({ ...d, home: { ...body, updatedAt: Date.now() } }));
      show(r && r.home ? r.home : body);
      toast(body.published ? 'Saved. The home page shows it now.' : 'Saved, but hidden from the site');
    } catch (x) { const fe = fieldErrors(x); setErrs(fe); setErr(Object.keys(fe).length ? 'Please check the fields marked in red.' : problem(x)); }
    setBusy('');
  };
  const reset = async () => {
    setBusy('reset'); setErr(null);
    try { await staffApi('PUT', '/api/admin/content', { reset: true }); await q.reload(); show(null); setConfirmReset(false); toast('The home page shows the built-in text again'); }
    catch (x) { setErr(problem(x)); setConfirmReset(false); }
    setBusy('');
  };
  const fe = k => (errs[k] ? <small className="bad">{errs[k]}</small> : null);
  return (
    <Guard state={q} rows={6}>
      <section className="panel"><p className="eyebrow">Home page</p>
        <p className="auth-sub">These lines are shown on the first screen of the site. {home ? 'Last saved ' + fmt(home.updatedAt) + (home.published === false ? ', hidden from the site.' : '.') : 'The site shows its built-in text until you save your own.'}</p>
        {q.error ? <ErrorNote error={q.error} onRetry={q.reload} compact /> : null}
        <form key={home ? home.updatedAt : 'built-in'} onSubmit={submit} noValidate>
          <div className="field"><label htmlFor="ctBadge">Eyebrow line</label><input id="ctBadge" name="badge" maxLength={120} defaultValue={home && home.badge != null ? home.badge : HERO.badge} />{fe('badge')}</div>
          <div className="field"><label htmlFor="ctTitle">Headline</label><input id="ctTitle" name="heroTitle" maxLength={300} defaultValue={home && home.heroTitle != null ? home.heroTitle : HERO.titleHtml} /><small>You can put a word in &lt;em&gt;italics&lt;/em&gt; or &lt;strong&gt;bold&lt;/strong&gt;. Other tags are removed.</small>{fe('heroTitle')}</div>
          <div className="field"><label htmlFor="ctLede">Intro paragraph</label><textarea id="ctLede" name="heroLede" maxLength={600} defaultValue={home && home.heroLede != null ? home.heroLede : HERO.lede} />{fe('heroLede')}</div>
          <div className="field"><label htmlFor="ctWhys">&quot;Today&apos;s why&quot; questions</label><textarea id="ctWhys" name="whys" style={{ minHeight: '140px' }} defaultValue={(home && Array.isArray(home.whys) && home.whys.length ? home.whys : WHYS).join('\n')} /><small>One per line, 30 at most.</small>{fe('whys')}</div>
          <label className="check"><input type="checkbox" name="published" defaultChecked={!home || home.published !== false} />Show this on the site</label>
          {err ? <div className="st-note err" role="alert"><Icon id="alert" size={16} /><span>{err}</span></div> : null}
          <div className="btn-row"><button type="submit" className="btn btn-primary" disabled={!!busy}>{busy === 'save' ? 'Saving…' : 'Save content'}</button>
            {home ? <button type="button" className="btn btn-ghost" disabled={!!busy} onClick={() => setConfirmReset(true)}>Use the built-in text</button> : null}</div>
        </form>
      </section>
      {confirmReset ? <Modal title="Go back to the built-in text?" onClose={() => setConfirmReset(false)} onSubmit={reset} submitLabel="Use the built-in text" busyLabel="Working…" busy={busy === 'reset'} danger>
        <p>Your saved home page text is removed and the site shows its original lines again.</p></Modal> : null}
    </Guard>
  );
}

/* ---------- reviews ---------- */
const REVIEW_STATUS = { pending: 'Waiting', published: 'Published', hidden: 'Hidden' };
function Reviews() {
  const { toast, refreshCounts, can, go } = useDash();
  const [status, setStatus] = useState('pending');
  const q = useStaffGet('/api/admin/reviews' + qs({ status }), { keep: true });
  const [busy, setBusy] = useState(null);
  const rows = (q.data && q.data.reviews) || [];
  const counts = (q.data && q.data.counts) || {};
  const move = async (r, to) => {
    setBusy(r.id);
    try { await staffApi('POST', '/api/admin/reviews/' + r.id + '/status', { status: to }); toast(to === 'published' ? 'Published' : to === 'hidden' ? 'Hidden' : 'Moved back to waiting'); await q.reload(true); refreshCounts(); }
    catch (x) { toast(problem(x)); }
    setBusy(null);
  };
  return (
    <section className="panel"><p className="eyebrow">Reviews</p><p className="auth-sub">Customers review sheets they bought. A review shows on the sheet once you publish it.</p>
      <div className="chips" role="group" aria-label="Show">{Object.entries(REVIEW_STATUS).map(([id, l]) => <button key={id} type="button" className={'chip' + (status === id ? ' on' : '')} onClick={() => setStatus(id)}>{l} <small>{counts[id] || 0}</small></button>)}</div>
      {q.error ? <ErrorNote error={q.error} onRetry={q.reload} compact /> : null}
      {rows.length ? <div className="review-list">{rows.map(r => (
        <article key={r.id} className="review">
          <div className="review-head"><span className="stars" title={r.rating + ' out of 5'}>{'★'.repeat(r.rating)}<i>{'★'.repeat(5 - r.rating)}</i></span><b>{r.title || 'No title'}</b><Pill tone={r.status === 'published' ? 'ok' : r.status === 'pending' ? 'info' : 'neutral'}>{REVIEW_STATUS[r.status]}</Pill></div>
          {r.body ? <p className="review-body">{r.body}</p> : null}
          <p className="auth-sub">{r.worksheetTitle} · {r.customer.name || r.customer.initials}{r.customer.email ? ' (' + r.customer.email + ')' : ''} · {fmt(r.createdAt)}</p>
          <div className="btn-row">
            {r.status !== 'published' ? <button type="button" className="btn btn-primary btn-sm" disabled={busy === r.id} onClick={() => move(r, 'published')}>Publish</button> : null}
            {r.status !== 'hidden' ? <button type="button" className="btn btn-ghost btn-sm" disabled={busy === r.id} onClick={() => move(r, 'hidden')}>Hide</button> : null}
            {r.status !== 'pending' ? <button type="button" className="btn btn-ghost btn-sm" disabled={busy === r.id} onClick={() => move(r, 'pending')}>Back to waiting</button> : null}
            {can('customers.read') && r.customer.id ? <button type="button" className="btn btn-ghost btn-sm" onClick={() => go('customers', { customer: r.customer.id })}>Open the customer</button> : null}
          </div>
        </article>
      ))}</div> : <p className="cart-empty">{q.loading ? 'Loading…' : status === 'pending' ? 'No reviews are waiting. All caught up.' : 'None here.'}</p>}
    </section>
  );
}
