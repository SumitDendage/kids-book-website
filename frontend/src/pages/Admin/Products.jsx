import { useEffect, useMemo, useState } from 'react';
import MetricCard from '../../components/dashboard/MetricCard.jsx';
import { Guard, ErrorNote } from '../../components/dashboard/States.jsx';
import ProductStudio, { ArchiveDialog } from './ProductStudio.jsx';
import { useDash } from '../Portal/DashContext.js';
import { useStaffGet, inr, size, plural, problem } from '../Portal/dashboard.js';
import { staffApi } from '../../services/api.js';
import { AUDIENCE_LABEL, LABELS, HOME_TAG, VISIBILITY, visibilityOf } from './common.js';

/* the filters survive moving between sections */
const keep = { status: 'all', cls: 'all', query: '', section: 'all', label: 'all', order: 'order' };
const STATUS_TABS = [['all', 'All'], ['published', 'Published'], ['scheduled', 'Scheduled'], ['draft', 'Drafts'], ['hidden', 'Hidden'], ['missing', 'Missing PDF']];
const VIS_LABEL = Object.fromEntries(VISIBILITY);
const LABEL_NAME = Object.fromEntries(LABELS.concat([[HOME_TAG, 'Home page']]));
const ORDERS = [['order', 'Display order'], ['newest', 'Newest first'], ['sold', 'Best selling'], ['price', 'Price, low to high'], ['title', 'Title, A to Z']];
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
        <div className="book-meta"><span><Stars n={rating} /></span><span>{it.pages} pg</span><span>{it.stock == null ? 'No stock limit' : it.stock + ' left'}</span></div>
        <div className="book-meta">
          <span>{it.available ? 'PDF ' + size(it.pdfBytes) : <b className="bad-text">No PDF yet</b>}</span>
          <span>{it.audience ? AUDIENCE_LABEL[it.audience] : 'Everyone'}</span>
          <span title="How long a customer can open it after buying">{it.effectiveAccessDays ? it.effectiveAccessDays + ' days' : ''}</span>
        </div>
        <div className="book-meta"><span title="Paid orders">{plural(it.sold || 0, 'sale')}{it.revenue ? ' · ' + inr(it.revenue) : ''}</span><span>Order {it.sort}</span></div>
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
  const [status, setStatusState] = useState(keep.status), [cls, setClsState] = useState(keep.cls), [query, setQueryState] = useState(keep.query);
  const [section, setSectionState] = useState(keep.section), [label, setLabelState] = useState(keep.label), [order, setOrderState] = useState(keep.order);
  const setSection = v => { keep.section = v; setSectionState(v); };
  const setLabel = v => { keep.label = v; setLabelState(v); };
  const setOrder = v => { keep.order = v; setOrderState(v); };
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
  if (section !== 'all') list = list.filter(s => (section === 'none' ? !s.section : s.section === section));
  if (label !== 'all') list = list.filter(s => (s.tags || []).includes(label));
  if (cls !== 'all') list = list.filter(s => s.cls === cls);
  if (query) list = list.filter(s => (s.title + ' ' + s.subject + ' ' + s.id + ' ' + (s.sectionLabel || '') + ' ' + (s.description || '')).toLowerCase().includes(query));
  list = list.slice().sort(SORTERS[order] || SORTERS.order);

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
    filesQ.reload(true); classesQ.reload(true); sectionsQ.reload(true); refreshCounts();
    if (site && typeof site.reloadCatalogue === 'function') site.reloadCatalogue();
  };
  const editingSheet = editing && editing !== 'new' ? all.find(s => s.id === editing) : null;
  const on = all.filter(s => visibilityOf(s) === 'published').length;

  return (
    <Guard state={sheets} rows={8}>
      {editing && (editing === 'new' || editingSheet) ? <ProductStudio key={editing} sheet={editingSheet} all={all} classes={classes} sections={sections} onSaved={onSaved} onClose={() => setEditing(null)} /> : null}
      {sheets.error ? <ErrorNote error={sheets.error} onRetry={sheets.reload} compact /> : null}
      <div className="kpi-row">
        <MetricCard label="Published" value={on} sub={plural(all.filter(s => visibilityOf(s) === 'published' && s.price === 0).length, 'free sheet') + ' among them' + (count('scheduled') ? ' · ' + count('scheduled') + ' scheduled' : '')} icon="book" />
        <MetricCard label="Drafts" value={count('draft')} sub={'not on the website · ' + count('hidden') + ' hidden'} icon="edit" />
        <MetricCard label="Sheets sold" value={sold} sub={inr(revenue) + ' from paid orders'} icon="rupee" />
        <MetricCard label="With their PDF" value={filesQ.data ? filesQ.data.counts.withPdf + ' / ' + filesQ.data.counts.total : all.filter(s => s.available).length + ' / ' + all.length} sub={missing.size ? plural(missing.size, 'sheet') + ' still need a PDF' : 'Every sheet has its file'} icon="file" />
      </div>
      {top.length ? <section className="panel">
        <p className="eyebrow">Best sellers</p>
        <ul className="top-sellers">{top.map(s => <li key={s.id}><button type="button" className="link" onClick={() => setEditing(s.id)}>{s.title}</button><span>{plural(s.sold, 'sale')} · {inr(s.revenue)}</span></li>)}</ul>
      </section> : null}
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
        <div className="filters-row">
          <select aria-label="Section" value={section} onChange={e => setSection(e.target.value)}><option value="all">Every section</option><option value="none">No section</option>
            {sections.filter(x => x.products).map(x => <option key={x.id} value={x.id}>{(x.groupLabel ? x.groupLabel + ' › ' : '') + x.label} ({x.products})</option>)}</select>
          <select aria-label="Label" value={label} onChange={e => setLabel(e.target.value)}><option value="all">Any label</option>{Object.entries(LABEL_NAME).map(([t, n]) => <option key={t} value={t}>{n}</option>)}</select>
          <select aria-label="Sort" value={order} onChange={e => setOrder(e.target.value)}>{ORDERS.map(([id, n]) => <option key={id} value={id}>{n}</option>)}</select>
        </div>
        {list.length ? <div className="book-grid">{list.map(it => <BookCard key={it.id} it={it} className={className(it.cls)} canWrite={canWrite} onQuick={quick} quickBusy={quickBusy} onEdit={setEditing} onArchive={s => setConfirm({ sheet: s, kind: 'archive' })} onRestore={s => setConfirm({ sheet: s, kind: 'restore' })} />)}</div>
          : <p className="cart-empty">{all.length ? 'No sheets match.' : 'No sheets yet. Use "Upload new book" to add the first one.'}</p>}
      </section>
      {confirm ? <ArchiveDialog {...confirm} onClose={() => setConfirm(null)} onDone={ws => { setConfirm(null); onSaved(ws); toast(confirm.kind === 'archive' ? 'Hidden. It is off the website now.' : ws && ws.status === 'active' ? 'Restored. It is on sale again.' : 'Restored as a draft. Upload its PDF to put it on sale.'); }} /> : null}
    </Guard>
  );
}
