import { useEffect, useState } from 'react';
import DataTable from '../../components/dashboard/DataTable.jsx';
import Pill from '../../components/dashboard/Pill.jsx';
import Icon from '../../components/dashboard/Icon.jsx';
import Modal from '../../components/dashboard/Modal.jsx';
import { Guard, ErrorNote } from '../../components/dashboard/States.jsx';
import { useDash } from '../Portal/DashContext.js';
import { useStaffGet, fmt, qs, problem, fieldErrors, plural } from '../Portal/dashboard.js';
import { staffApi } from '../../services/api.js';
import { HERO, WHYS } from '../../data/content.js';

const keep = { tab: null };

/* Content: the home page's first screen, the questions and answers (the site's help and the
   assistant use the published public ones), and customer reviews waiting to be published. */
export default function Content() {
  const { can, stats } = useDash();
  const tabs = [
    can('content.write') ? ['home', 'Home page'] : null,
    can('content.write') ? ['faq', 'Questions and answers'] : null,
    can('reviews.moderate') ? ['reviews', 'Reviews'] : null,
  ].filter(Boolean);
  const [tab, setTabState] = useState(() => (tabs.some(([id]) => id === keep.tab) ? keep.tab : (tabs[0] || [''])[0]));
  const setTab = t => { keep.tab = t; setTabState(t); };
  const pending = stats && stats.pendingReviews;
  return (
    <>
      <div className="tabs-s" role="tablist">{tabs.map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>{label}{id === 'reviews' && pending ? <small>{pending}</small> : null}</button>)}</div>
      {tab === 'home' ? <HomeText /> : tab === 'faq' ? <Faq /> : tab === 'reviews' ? <Reviews /> : null}
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

/* ---------- questions and answers ---------- */
const FAQ_STATUS = { published: 'Published', draft: 'Draft', planned: 'Planned' };
const FAQ_FOR = { public: 'Customers', staff: 'Staff only' };
function Faq() {
  const { toast } = useDash();
  const [audience, setAudience] = useState(''), [status, setStatus] = useState(''), [text, setText] = useState(''), [search, setSearch] = useState('');
  useEffect(() => { const t = setTimeout(() => setSearch(text.trim()), 300); return () => clearTimeout(t); }, [text]);
  const q = useStaffGet('/api/admin/faq' + qs({ audience, status, q: search }), { keep: true });
  const [edit, setEdit] = useState(null), [drop, setDrop] = useState(null);
  const rows = (q.data && q.data.faq) || [];
  return (
    <section className="panel">
      <div className="row-between"><div><p className="eyebrow">Questions and answers</p><p className="auth-sub">Published answers for customers show in the site's help and the assistant. {q.data ? plural(q.data.counts.public, 'answer') + ' are public now.' : ''}</p></div>
        <div className="btn-row"><input className="search" type="search" placeholder="Search answers…" aria-label="Search answers" value={text} onChange={e => setText(e.target.value)} /><button type="button" className="btn btn-primary" onClick={() => setEdit('new')}><Icon id="plus" />New answer</button></div></div>
      <div className="chips" role="group" aria-label="Filter">
        {[['', 'Everyone'], ['public', 'Customers'], ['staff', 'Staff only']].map(([v, l]) => <button key={'a' + v} type="button" className={'chip' + (audience === v ? ' on' : '')} onClick={() => setAudience(v)}>{l}</button>)}
        <span className="chip-sep" aria-hidden="true" />
        {[['', 'Any status'], ['published', 'Published'], ['draft', 'Drafts'], ['planned', 'Planned']].map(([v, l]) => <button key={'s' + v} type="button" className={'chip' + (status === v ? ' on' : '')} onClick={() => setStatus(v)}>{l}</button>)}
      </div>
      {q.error ? <ErrorNote error={q.error} onRetry={q.reload} compact /> : null}
      <DataTable plain={rows.length <= 10} head={['Question', 'For', 'Status', 'Updated', '']} empty={q.loading ? 'Loading…' : 'No answers match.'}
        rows={rows.map(f => ({ key: f.id, cells: [
          <span key="q"><b>{f.question}</b><small className="clip">{f.answer}</small></span>,
          FAQ_FOR[f.audience] || f.audience, <Pill key="s" tone={f.status === 'published' ? 'ok' : 'neutral'}>{FAQ_STATUS[f.status] || f.status}</Pill>, fmt(f.updatedAt),
          <span key="a" className="row-actions"><button type="button" className="link" onClick={() => setEdit(f)}>Edit</button><button type="button" className="link danger" onClick={() => setDrop(f)}>Delete</button></span>,
        ] }))} />
      {edit ? <FaqDialog item={edit === 'new' ? null : edit} onClose={() => setEdit(null)} onDone={() => { setEdit(null); q.reload(true); toast(edit === 'new' ? 'Answer added' : 'Saved'); }} /> : null}
      {drop ? <DeleteFaq item={drop} onClose={() => setDrop(null)} onDone={() => { setDrop(null); q.reload(true); toast('Deleted'); }} /> : null}
    </section>
  );
}

function FaqDialog({ item, onClose, onDone }) {
  const f0 = item || {};
  const [busy, setBusy] = useState(false), [err, setErr] = useState(null), [errs, setErrs] = useState({});
  const submit = async e => {
    const f = new FormData(e.currentTarget);
    const body = { question: String(f.get('question') || '').trim(), answer: String(f.get('answer') || '').trim(), keywords: String(f.get('keywords') || '').split(',').map(x => x.trim()).filter(Boolean), audience: f.get('audience'), status: f.get('status'), sort: Number(f.get('sort')) || 0 };
    setBusy(true); setErr(null); setErrs({});
    try { if (item) await staffApi('PUT', '/api/admin/faq/' + item.id, body); else await staffApi('POST', '/api/admin/faq', body); onDone(); }
    catch (x) { const fe = fieldErrors(x); setErrs(fe); setErr(Object.keys(fe).length ? 'Please check the fields marked in red.' : problem(x)); setBusy(false); }
  };
  const fe = k => (errs[k] ? <small className="bad">{errs[k]}</small> : null);
  return (
    <Modal title={item ? 'Edit the answer' : 'New answer'} onClose={onClose} onSubmit={submit} submitLabel={item ? 'Save' : 'Add the answer'} busyLabel="Saving…" busy={busy} error={err} wide>
      <div className="field"><label htmlFor="fqQ">Question</label><input id="fqQ" name="question" maxLength={300} defaultValue={f0.question || ''} />{fe('question')}</div>
      <div className="field"><label htmlFor="fqA">Answer</label><textarea id="fqA" name="answer" rows={6} maxLength={2000} defaultValue={f0.answer || ''} />{fe('answer')}</div>
      <div className="field"><label htmlFor="fqK">Keywords</label><input id="fqK" name="keywords" defaultValue={(f0.keywords || []).join(', ')} placeholder="e.g. refund, money back" /><small>Words customers might use, separated by commas. They help the assistant find this answer.</small>{fe('keywords')}</div>
      <div className="grid-3">
        <div className="field"><label htmlFor="fqFor">For</label><select id="fqFor" name="audience" defaultValue={f0.audience || 'public'}><option value="public">Customers</option><option value="staff">Staff only</option></select></div>
        <div className="field"><label htmlFor="fqS">Status</label><select id="fqS" name="status" defaultValue={f0.status || 'published'}><option value="published">Published</option><option value="draft">Draft</option><option value="planned">Planned</option></select></div>
        <div className="field"><label htmlFor="fqO">Order</label><input id="fqO" name="sort" type="number" defaultValue={f0.sort || 0} /><small>Lower numbers come first.</small></div>
      </div>
    </Modal>
  );
}

function DeleteFaq({ item, onClose, onDone }) {
  const [busy, setBusy] = useState(false), [err, setErr] = useState(null);
  const submit = async () => { setBusy(true); try { await staffApi('DELETE', '/api/admin/faq/' + item.id); onDone(); } catch (x) { setErr(problem(x)); setBusy(false); } };
  return <Modal title="Delete this answer?" onClose={onClose} onSubmit={submit} submitLabel="Delete it" busyLabel="Deleting…" danger busy={busy} error={err}><p><b>{item.question}</b> is removed from the help and the assistant.</p></Modal>;
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
