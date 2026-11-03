import { useEffect, useMemo, useState } from 'react';
import MetricCard from '../../components/dashboard/MetricCard.jsx';
import { Guard, ErrorNote } from '../../components/dashboard/States.jsx';
import ProductStudio, { ArchiveDialog } from './ProductStudio.jsx';
import SheetBrowser from './SheetBrowser.jsx';
import { useDash } from '../Portal/DashContext.js';
import { useStaffGet, inr, size, plural, problem } from '../Portal/dashboard.js';
import { staffApi } from '../../services/api.js';
import { AUDIENCE_LABEL, LABELS, HOME_TAG, VISIBILITY, visibilityOf } from './common.js';

/* the filters survive moving between sections */
const keep = { status: 'all', cls: 'all', query: '', view: 'sections' };
const PAGE = 24;
const STATUS_TABS = [['all', 'All'], ['published', 'Published'], ['scheduled', 'Scheduled'], ['draft', 'Drafts'], ['hidden', 'Hidden'], ['missing', 'Missing PDF']];
const VIS_LABEL = Object.fromEntries(VISIBILITY);
const LABEL_NAME = Object.fromEntries(LABELS.concat([[HOME_TAG, 'Home page']]));
const SORTERS = {
  order: (a, b) => (a.cls === b.cls ? 0 : a.cls < b.cls ? -1 : 1) || (a.sort - b.sort) || a.id.localeCompare(b.id),
  newest: (a, b) => (b.created || 0) - (a.created || 0),
  sold: (a, b) => (b.sold || 0) - (a.sold || 0) || (b.revenue || 0) - (a.revenue || 0),
  price: (a, b) => a.price - b.price,
  title: (a, b) => a.title.localeCompare(b.title),
};

function Stars({ n }) {
  const r = Math.max(0, Math.min(5, Math.round(n || 0)));
  return <span className="stars" title={n ? (Math.round(n * 10) / 10) + ' out of 5' : 'No reviews yet'}>{'★'.repeat(r)}<i>{'★'.repeat(5 - r)}</i></span>;
}
const glyphOf = t => String(t || '?').replace(/[^A-Za-z0-9 ]/g, ' ').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?';

function BookCard({ it, className, canWrite, onEdit, onArchive, onRestore, onQuick, quickBusy }) {
  const vis = visibilityOf(it);
  const labels = (it.tags || []).filter(t => LABEL_NAME[t]);
  const cover = it.thumb ? <img src={it.thumb} alt="" loading="lazy" /> : <div className="cover-glyph"><small>{it.subject}</small><b>{glyphOf(it.title)}</b></div>;
  const open = e => { if (e.target.closest('button')) return; onEdit(it.id); };
  const rating = it.reviewCount ? it.reviewAvg : it.rating;
  return (
    <article className={'book-card' + (it.status !== 'active' ? ' is-' + it.status : '')} tabIndex={0} onClick={open} onKeyDown={e => { if (e.key === 'Enter' && e.target === e.currentTarget) onEdit(it.id); }} aria-label={(canWrite ? 'Edit ' : 'Open ') + it.title} data-sheet={it.id}>
      <div className="book-cover">{cover}
        {vis !== 'published' ? <span className="tag state">{VIS_LABEL[vis]}</span> : it.price === 0 ? <span className="tag free">Free</span> : <span className="tag">Published</span>}
      </div>
      <div className="book-body">
        <p className="meta">{className} · {it.subject}{it.sectionLabel ? ' · ' + it.sectionLabel : ''}</p>
        <h4>{it.title}</h4>
        {labels.length ? <div className="book-labels">{labels.map(t => <span key={t}>{LABEL_NAME[t]}</span>)}</div> : null}
        {vis === 'scheduled' ? <p className="meta">Goes live {new Date(it.publishAt).toLocaleString()}</p> : null}
        <div className="book-meta"><span><Stars n={rating} /></span><span>{it.pages} pg</span></div>
        <div className="book-meta">
          <span>{it.available ? 'PDF ' + size(it.pdfBytes) : <b className="bad-text">No PDF yet</b>}</span>
          <span>{it.audience ? AUDIENCE_LABEL[it.audience] : 'Everyone'}</span>
          <span title="How long a customer can open it after buying">{it.effectiveAccessDays ? it.effectiveAccessDays + ' days' : ''}</span>
        </div>
        <div className="book-meta"><span title="Paid orders">{plural(it.sold || 0, 'sale')}{it.revenue ? ' · ' + inr(it.revenue) : ''}</span></div>
        <div className="book-meta"><span className="print-rule" title={it.printRule === 'sheet' ? 'Every customer gets the same number of prints' : 'Prints come from the account type: Settings → Prints per sheet'}>
          {it.printRule === 'sheet' ? 'Prints: this sheet only: ' + (it.printLimit | 0) + (it.printLimit ? '' : ' (view only)') : 'Prints: by account type'}</span></div>
      </div>
      {canWrite ? <div className="book-quick">
        {vis === 'draft' || vis === 'scheduled' ? <button type="button" className="btn btn-ghost" disabled={quickBusy || !it.available} title={it.available ? 'Put it on the website now' : 'Add the PDF first'} onClick={() => onQuick(it, 'published')}>Publish now</button> : null}
        {vis === 'published' || vis === 'scheduled' ? <button type="button" className="btn btn-ghost" disabled={quickBusy} onClick={() => onQuick(it, 'draft')}>Unpublish</button> : null}
      </div> : null}
      <div className="book-actions"><b>{it.price === 0 ? 'Free' : inr(it.price)}{it.wasPrice && it.wasPrice > it.price ? <s className="was">{inr(it.wasPrice)}</s> : null}{it.discountPct ? <small> {it.discountPct}% off</small> : null}</b>
        <span>
          <button type="button" className="link" onClick={() => onEdit(it.id)}>{canWrite ? 'Edit' : 'Open'}</button>
          {canWrite ? (it.status === 'archived'
            ? <button type="button" className="link" onClick={() => onRestore(it)}>Restore</button>
            : <button type="button" className="link danger" onClick={() => onArchive(it)}>Hide</button>) : null}
        </span>
      </div>
    </article>
  );
}

/* Products: every sheet from the server (on sale, drafts and archived), which ones have their
   PDF, and the studio for a new sheet or an edit. */
export default function Products() {
  const { editing, setEditing, can, toast, site, refreshCounts, portalRef } = useDash();
  const sheets = useStaffGet('/api/admin/worksheets', { keep: true });
  const classesQ = useStaffGet('/api/admin/classes', { keep: true });
  const filesQ = useStaffGet('/api/admin/files', { keep: true });
  const sectionsQ = useStaffGet('/api/admin/sections', { keep: true });
  const subjectsQ = useStaffGet('/api/admin/subjects', { keep: true });
  /* one view only: sheets by class and section (the All sheets switch is gone, Sumit, Oct 27) */
  const view = 'sections';
  const [page, setPage] = useState(1);
  const [preset, setPreset] = useState(null);   /* class, subject and section for a new sheet started from a section */
  const [status, setStatusState] = useState(keep.status), [cls, setClsState] = useState(keep.cls), [query, setQueryState] = useState(keep.query);
  const [quickBusy, setQuickBusy] = useState(false);
  const setStatus = v => { keep.status = v; setStatusState(v); };
  const setCls = v => { keep.cls = v; setClsState(v); };
  const setQuery = v => { keep.query = v; setQueryState(v); };
  const [confirm, setConfirm] = useState(null);   /* { sheet, kind: 'archive' | 'restore' } */
  const canWrite = can('catalogue.write');

  /* the studio opens above the gallery: bring it into view */
  useEffect(() => { if (editing && portalRef.current) portalRef.current.scrollTo({ top: 0, behavior: 'smooth' }); }, [editing, portalRef]);

  const all = useMemo(() => (sheets.data && sheets.data.worksheets) || [], [sheets.data]);
  const classes = (classesQ.data && classesQ.data.classes) || [];
  const className = id => { const c = classes.find(x => x.id === id); return c ? c.name : id; };
  const missing = new Set((filesQ.data && filesQ.data.missing) || all.filter(s => !s.available && s.status !== 'archived').map(s => s.id));
  const sections = (sectionsQ.data && sectionsQ.data.sections) || [];
  const count = st => (st === 'all' ? all.length : st === 'missing' ? missing.size : all.filter(s => visibilityOf(s) === st).length);

  let list = all;
  if (status === 'missing') list = list.filter(s => missing.has(s.id));
  else if (status !== 'all') list = list.filter(s => visibilityOf(s) === status);
  if (cls !== 'all') list = list.filter(s => s.cls === cls);
  if (query) list = list.filter(s => (s.title + ' ' + s.subject + ' ' + s.id + ' ' + (s.sectionLabel || '') + ' ' + (s.description || '')).toLowerCase().includes(query));
  list = list.slice().sort(SORTERS.order);
  /* 24 cards a page; a filter change goes back to the first page */
  const pages = Math.max(1, Math.ceil(list.length / PAGE));
  const filterKey = [status, cls, query].join('|');
  useEffect(() => { setPage(1); }, [filterKey]);
  const at = Math.min(page, pages);
  const shown = list.slice((at - 1) * PAGE, at * PAGE);
  const subjectList = (subjectsQ.data && subjectsQ.data.subjects) || null;

  /* Publish now / Unpublish from the card */
  const quick = async (it, want) => {
    setQuickBusy(true);
    try {
      const body = want === 'published' ? { status: 'active', publishAt: null } : { status: 'draft' };
      const r = await staffApi('PUT', '/api/admin/worksheets/' + encodeURIComponent(it.id), body);
      onSaved(r.worksheet);
      toast(want === 'published' ? 'Published. It is on the website now.' : 'Unpublished. It is off the website.');
    } catch (e) { toast(e.code === 'pdf_missing' ? 'Upload the PDF before publishing this sheet.' : problem(e)); }
    setQuickBusy(false);
  };
  /* sales: paid orders per sheet */
  const sold = all.reduce((n, s) => n + (s.sold || 0), 0), revenue = all.reduce((n, s) => n + (s.revenue || 0), 0);
  const top = all.filter(s => s.sold).sort(SORTERS.sold).slice(0, 5);

  const onSaved = (ws, removedId) => {
    if (removedId) sheets.setData(d => ({ ...(d || {}), worksheets: ((d && d.worksheets) || []).filter(r => r.id !== removedId) }));
    if (ws) sheets.setData(d => {
      const rows = (d && d.worksheets) || [];
      return { ...(d || {}), worksheets: rows.some(r => r.id === ws.id) ? rows.map(r => (r.id === ws.id ? ws : r)) : [ws, ...rows] };
    });
    filesQ.reload(true); classesQ.reload(true); sectionsQ.reload(true); subjectsQ.reload(true); refreshCounts();
    if (site && typeof site.reloadCatalogue === 'function') site.reloadCatalogue();
  };
  /* a class, subject or section made while adding a sheet joins the lists straight away */
  const onMade = (kind, r) => {
    if (kind === 'classes' && r.classes) classesQ.setData(d => ({ ...(d || {}), classes: r.classes }));
    if (kind === 'subjects' && r.subjects) subjectsQ.setData(d => ({ ...(d || {}), subjects: r.subjects }));
    if (kind === 'sections' && r.sections) sectionsQ.setData(d => ({ ...(d || {}), sections: r.sections }));
    if (site && typeof site.reloadCatalogue === 'function') site.reloadCatalogue();
  };
  const newIn = p => { setPreset(p); setEditing('new'); };
  const editingSheet = editing && editing !== 'new' ? all.find(s => s.id === editing) : null;
  const on = all.filter(s => visibilityOf(s) === 'published').length;

  return (
    <Guard state={sheets} rows={8}>
      {editing && (editing === 'new' || editingSheet) ? <ProductStudio key={editing + (editing === 'new' && preset ? '|' + preset.cls + '|' + preset.sectionLabel : '')} sheet={editingSheet} preset={editing === 'new' ? preset : null} all={all} classes={classes} sections={sections} subjectList={subjectList} onSaved={onSaved} onMade={onMade} onClose={() => { setEditing(null); setPreset(null); }} /> : null}
      {sheets.error ? <ErrorNote error={sheets.error} onRetry={sheets.reload} compact /> : null}
      <div className="kpi-row">
        <MetricCard label="Published" value={on} sub={plural(all.filter(s => visibilityOf(s) === 'published' && s.price === 0).length, 'free sheet') + ' among them' + (count('scheduled') ? ' · ' + count('scheduled') + ' scheduled' : '')} icon="book" />
        <MetricCard label="Drafts" value={count('draft')} sub={'not on the website · ' + count('hidden') + ' hidden'} icon="edit" />
        <MetricCard label="Sheets sold" value={sold} sub={inr(revenue) + ' from paid orders'} icon="rupee" />
        <MetricCard label="With their PDF" value={filesQ.data ? filesQ.data.counts.withPdf + ' / ' + filesQ.data.counts.total : all.filter(s => s.available).length + ' / ' + all.length} sub={missing.size ? plural(missing.size, 'sheet') + ' still need a PDF' : 'Every sheet has its file'} icon="file" />
      </div>
      {top.length && view === 'grid' ? <section className="panel">
        <p className="eyebrow">Best sellers</p>
        <ul className="top-sellers">{top.map(s => <li key={s.id}><button type="button" className="link" onClick={() => setEditing(s.id)}>{s.title}</button><span>{plural(s.sold, 'sale')} · {inr(s.revenue)}</span></li>)}</ul>
      </section> : null}
      {view === 'sections' && classes.length ? <SheetBrowser all={all} classes={classes} sections={sections} subjectList={subjectList} onEdit={setEditing} onNew={newIn} onSaved={onSaved} onMade={onMade} /> : null}
      {view === 'grid' ? <section className="panel">
        <div className="row-between"><div><p className="eyebrow">Books on the shelf</p><p className="auth-sub">{plural(list.length, 'sheet')} shown{canWrite ? ' · click a card to edit it' : ' · your role can look but not change sheets'}</p></div>
          <div className="btn-row"><input className="search" type="search" placeholder="Filter books…" aria-label="Filter books" defaultValue={query} onChange={e => setQuery(e.target.value.trim().toLowerCase())} /></div></div>
        <div className="tabs-s" role="tablist" aria-label="Status">
          {STATUS_TABS.map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={status === id} className={status === id ? 'on' : ''} onClick={() => setStatus(id)}>{label} <small>{count(id)}</small></button>)}
        </div>
        {classes.length > 1 ? <div className="chips" role="group" aria-label="Class">
          <button type="button" className={'chip' + (cls === 'all' ? ' on' : '')} onClick={() => setCls('all')}>Every class</button>
          {classes.map(c => <button key={c.id} type="button" className={'chip' + (cls === c.id ? ' on' : '')} onClick={() => setCls(c.id)}>{c.name} <small>{all.filter(s => s.cls === c.id).length}</small></button>)}
        </div> : null}
        {list.length ? <div className="book-grid">{shown.map(it => <BookCard key={it.id} it={it} className={className(it.cls)} canWrite={canWrite} onQuick={quick} quickBusy={quickBusy} onEdit={setEditing} onArchive={s => setConfirm({ sheet: s, kind: 'archive' })} onRestore={s => setConfirm({ sheet: s, kind: 'restore' })} />)}</div>
          : <p className="cart-empty">{all.length ? 'No sheets match.' : 'No sheets yet. Use "Upload new book" to add the first one.'}</p>}
        {pages > 1 ? <nav className="pager" aria-label="Pages">
          <button type="button" className="btn btn-ghost btn-sm" disabled={at === 1} onClick={() => setPage(at - 1)}>Previous</button>
          <span>Page {at} of {pages}</span>
          <button type="button" className="btn btn-ghost btn-sm" disabled={at === pages} onClick={() => setPage(at + 1)}>Next</button>
        </nav> : null}
      </section> : null}
      {confirm ? <ArchiveDialog {...confirm} onClose={() => setConfirm(null)} onDone={ws => { setConfirm(null); onSaved(ws); toast(confirm.kind === 'archive' ? 'Hidden. It is off the website now.' : ws && ws.status === 'active' ? 'Restored. It is on sale again.' : 'Restored as a draft. Upload its PDF to put it on sale.'); }} /> : null}
    </Guard>
  );
}
