import { useEffect, useMemo, useState } from 'react';
import MetricCard from '../../components/dashboard/MetricCard.jsx';
import { Guard, ErrorNote } from '../../components/dashboard/States.jsx';
import ProductStudio, { ArchiveDialog } from './ProductStudio.jsx';
import { useDash } from '../Portal/DashContext.js';
import { useStaffGet, inr, size, plural } from '../Portal/dashboard.js';
import { SHEET_STATUS_LABEL, AUDIENCE_LABEL } from './common.js';

/* the filters survive moving between sections */
const keep = { status: 'all', cls: 'all', query: '' };
const STATUS_TABS = [['all', 'All'], ['active', 'On sale'], ['draft', 'Drafts'], ['archived', 'Archived'], ['missing', 'Missing PDF']];

function Stars({ n }) {
  const r = Math.max(0, Math.min(5, Math.round(n || 0)));
  return <span className="stars" title={n ? (Math.round(n * 10) / 10) + ' out of 5' : 'No reviews yet'}>{'★'.repeat(r)}<i>{'★'.repeat(5 - r)}</i></span>;
}
const glyphOf = t => String(t || '?').replace(/[^A-Za-z0-9 ]/g, ' ').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?';

function BookCard({ it, className, canWrite, onEdit, onArchive, onRestore }) {
  const cover = it.thumb ? <img src={it.thumb} alt="" loading="lazy" /> : <div className="cover-glyph"><small>{it.subject}</small><b>{glyphOf(it.title)}</b></div>;
  const open = e => { if (e.target.closest('button')) return; onEdit(it.id); };
  const rating = it.reviewCount ? it.reviewAvg : it.rating;
  return (
    <article className={'book-card' + (it.status !== 'active' ? ' is-' + it.status : '')} tabIndex={0} onClick={open} onKeyDown={e => { if (e.key === 'Enter' && e.target === e.currentTarget) onEdit(it.id); }} aria-label={(canWrite ? 'Edit ' : 'Open ') + it.title} data-sheet={it.id}>
      <div className="book-cover">{cover}
        {it.status !== 'active' ? <span className="tag state">{SHEET_STATUS_LABEL[it.status]}</span> : it.price === 0 ? <span className="tag free">Free</span> : <span className="tag">On sale</span>}
      </div>
      <div className="book-body">
        <p className="meta">{className} · {it.subject}</p>
        <h4>{it.title}</h4>
        <div className="book-meta"><span><Stars n={rating} /></span><span>{it.pages} pg</span><span>{it.stock == null ? 'No stock limit' : it.stock + ' left'}</span></div>
        <div className="book-meta">
          <span>{it.available ? 'PDF ' + size(it.pdfBytes) : <b className="bad-text">No PDF yet</b>}</span>
          <span>{it.audience ? AUDIENCE_LABEL[it.audience] : 'Everyone'}</span>
          <span title="How long a customer can open it after buying">{it.effectiveAccessDays ? it.effectiveAccessDays + ' days' : ''}</span>
        </div>
        <div className="book-meta"><span className="print-rule" title={it.printRule === 'sheet' ? 'Every customer gets the same number of prints' : 'Prints come from the account type: Settings → Prints per sheet'}>
          {it.printRule === 'sheet' ? 'Prints: this sheet only: ' + (it.printLimit | 0) + (it.printLimit ? '' : ' (view only)') : 'Prints: by account type'}</span></div>
      </div>
      <div className="book-actions"><b>{it.price === 0 ? 'Free' : inr(it.price)}{it.wasPrice ? <s className="was">{inr(it.wasPrice)}</s> : null}</b>
        <span>
          <button type="button" className="link" onClick={() => onEdit(it.id)}>{canWrite ? 'Edit' : 'Open'}</button>
          {canWrite ? (it.status === 'archived'
            ? <button type="button" className="link" onClick={() => onRestore(it)}>Restore</button>
            : <button type="button" className="link danger" onClick={() => onArchive(it)}>Archive</button>) : null}
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
  const [status, setStatusState] = useState(keep.status), [cls, setClsState] = useState(keep.cls), [query, setQueryState] = useState(keep.query);
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
  const count = st => (st === 'all' ? all.length : st === 'missing' ? missing.size : all.filter(s => s.status === st).length);

  let list = all;
  if (status === 'missing') list = list.filter(s => missing.has(s.id));
  else if (status !== 'all') list = list.filter(s => s.status === status);
  if (cls !== 'all') list = list.filter(s => s.cls === cls);
  if (query) list = list.filter(s => (s.title + ' ' + s.subject + ' ' + s.id + ' ' + (s.sectionLabel || '') + ' ' + (s.description || '')).toLowerCase().includes(query));

  const onSaved = (ws, removedId) => {
    if (removedId) sheets.setData(d => ({ ...(d || {}), worksheets: ((d && d.worksheets) || []).filter(r => r.id !== removedId) }));
    if (ws) sheets.setData(d => {
      const rows = (d && d.worksheets) || [];
      return { ...(d || {}), worksheets: rows.some(r => r.id === ws.id) ? rows.map(r => (r.id === ws.id ? ws : r)) : [ws, ...rows] };
    });
    filesQ.reload(true); classesQ.reload(true); refreshCounts();
    if (site && typeof site.reloadCatalogue === 'function') site.reloadCatalogue();
  };
  const editingSheet = editing && editing !== 'new' ? all.find(s => s.id === editing) : null;
  const on = all.filter(s => s.status === 'active').length;

  return (
    <Guard state={sheets} rows={8}>
      {editing && (editing === 'new' || editingSheet) ? <ProductStudio key={editing} sheet={editingSheet} all={all} classes={classes} onSaved={onSaved} onClose={() => setEditing(null)} /> : null}
      {sheets.error ? <ErrorNote error={sheets.error} onRetry={sheets.reload} compact /> : null}
      <div className="kpi-row">
        <MetricCard label="On sale" value={on} sub={plural(all.filter(s => s.status === 'active' && s.price === 0).length, 'free sheet') + ' among them'} icon="book" />
        <MetricCard label="Drafts" value={count('draft')} sub="not in the shop yet" icon="edit" />
        <MetricCard label="Archived" value={count('archived')} sub="taken off the shelf" icon="archive" />
        <MetricCard label="With their PDF" value={filesQ.data ? filesQ.data.counts.withPdf + ' / ' + filesQ.data.counts.total : all.filter(s => s.available).length + ' / ' + all.length} sub={missing.size ? plural(missing.size, 'sheet') + ' still need a PDF' : 'Every sheet has its file'} icon="file" />
      </div>
      <section className="panel">
        <div className="row-between"><div><p className="eyebrow">Books on the shelf</p><p className="auth-sub">{plural(list.length, 'sheet')} shown{canWrite ? ' · click a card to edit it' : ' · your role can look but not change sheets'}</p></div>
          <div className="btn-row"><input className="search" type="search" placeholder="Filter books…" aria-label="Filter books" defaultValue={query} onChange={e => setQuery(e.target.value.trim().toLowerCase())} /></div></div>
        <div className="tabs-s" role="tablist" aria-label="Status">
          {STATUS_TABS.map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={status === id} className={status === id ? 'on' : ''} onClick={() => setStatus(id)}>{label} <small>{count(id)}</small></button>)}
        </div>
        {classes.length > 1 ? <div className="chips" role="group" aria-label="Class">
          <button type="button" className={'chip' + (cls === 'all' ? ' on' : '')} onClick={() => setCls('all')}>Every class</button>
          {classes.map(c => <button key={c.id} type="button" className={'chip' + (cls === c.id ? ' on' : '')} onClick={() => setCls(c.id)}>{c.name} <small>{all.filter(s => s.cls === c.id).length}</small></button>)}
        </div> : null}
        {list.length ? <div className="book-grid">{list.map(it => <BookCard key={it.id} it={it} className={className(it.cls)} canWrite={canWrite} onEdit={setEditing} onArchive={s => setConfirm({ sheet: s, kind: 'archive' })} onRestore={s => setConfirm({ sheet: s, kind: 'restore' })} />)}</div>
          : <p className="cart-empty">{all.length ? 'No sheets match.' : 'No sheets yet. Use "Upload new book" to add the first one.'}</p>}
      </section>
      {confirm ? <ArchiveDialog {...confirm} onClose={() => setConfirm(null)} onDone={ws => { setConfirm(null); onSaved(ws); toast(confirm.kind === 'archive' ? 'Archived. It is off the shelf now.' : ws && ws.status === 'active' ? 'Restored. It is on sale again.' : 'Restored as a draft. Upload its PDF to put it on sale.'); }} /> : null}
    </Guard>
  );
}
