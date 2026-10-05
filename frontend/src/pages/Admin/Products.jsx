import { useEffect, useState } from 'react';
import MetricCard from '../../components/dashboard/MetricCard.jsx';
import ProductStudio, { deleteProduct } from './ProductStudio.jsx';
import { useDash } from '../Portal/DashContext.js';
import { money } from '../../services/currency.js';
import { CLASSES, classById } from '../../data/content.js';
import { ITEMS } from '../../data/catalogue.js';

const AUDIENCE = { parent: 'Parents', teacher: 'Teachers', both: 'Everyone' };
/* the filter survives a redraw, like the old module variables */
const keep = { filter: 'all', query: '' };

function Stars({ n }) {
  const r = Math.round(n);
  return <span className="stars" title={n + ' / 5'}>{'★'.repeat(r)}<i>{'★'.repeat(5 - r)}</i></span>;
}

function BookCard({ it, onEdit, onDelete }) {
  const cover = it.image ? <img src={it.image} alt="" /> : <div className="cover-glyph"><small>{it.subject}</small><b>{it.glyph}</b></div>;
  const edit = e => { if (e.target.closest('button')) return; onEdit(it.id); };
  return (
    <article className="book-card" tabIndex={0} onClick={edit} onKeyDown={e => { if (e.key === 'Enter' && e.target === e.currentTarget) onEdit(it.id); }} aria-label={'Edit ' + it.title}>
      <div className="book-cover">{cover}{it.price === 0 ? <span className="tag free">Free</span> : <span className="tag">Plan</span>}</div>
      <div className="book-body">
        <p className="meta">{it.cls ? (classById(it.cls) || { label: '' }).label : ''} · {it.subject}</p>
        <h4>{it.title}</h4>
        <div className="book-meta"><span><Stars n={it.rating || 0} /></span><span>{it.pages || '?'} pg</span><span>{it.stock == null ? '∞' : it.stock + ' left'}</span></div>
        <div className="book-meta"><span>{it.pdf ? 'PDF attached' : <i style={{ color: 'var(--destructive)' }}>no PDF</i>}</span><span>{it.subject || ''}</span><span>{AUDIENCE[it.audience || 'both']}</span></div>
      </div>
      <div className="book-actions"><b>{it.price === 0 ? 'Free' : money(it.price)}</b><span><button type="button" className="link" onClick={() => onEdit(it.id)}>Edit</button><button type="button" className="link btn-danger" onClick={() => onDelete(it.id)}>Delete</button></span></div>
    </article>
  );
}

/* a card gallery of every book and sheet, and the "Upload new book" studio above it */
export default function Products() {
  const { editing, setEditing, toast, site, refresh } = useDash();
  const [filter, setFilterState] = useState(keep.filter), [query, setQueryState] = useState(keep.query);
  const setFilter = f => { keep.filter = f; setFilterState(f); };
  const setQuery = q => { keep.query = q; setQueryState(q); };
  /* the studio opens above the gallery: bring it into view */
  useEffect(() => { if (editing) { const st = document.querySelector('.studio'); if (st) st.scrollIntoView({ behavior: 'smooth', block: 'start' }); } }, [editing]);

  let list = ITEMS.slice();
  if (filter !== 'all') list = list.filter(it => it.cls === filter);
  if (query) list = list.filter(it => (it.title + ' ' + it.subject + ' ' + (it.blurb || '')).toLowerCase().includes(query));
  const free = ITEMS.filter(i => i.price === 0).length, withPdf = ITEMS.filter(i => i.pdf).length;
  const onDelete = id => deleteProduct(id, { toast, site, done: () => { setEditing(null); refresh(); } });
  return (
    <>
      {editing ? <ProductStudio key={editing} id={editing} /> : null}
      <div className="kpi-row">
        <MetricCard label="Books & sheets" value={ITEMS.length} sub="on the shelf" icon="book" />
        <MetricCard label="Free" value={free} sub="free access sheets" icon="star" />
        <MetricCard label="In class plans" value={ITEMS.length - free} sub="open with a subscription" icon="card" />
        <MetricCard label="With PDF" value={withPdf} sub="real file attached" icon="file" />
      </div>
      <section className="panel">
        <div className="row-between"><div><p className="eyebrow">Books on the shelf</p><p className="auth-sub">{list.length} shown · click a card to edit</p></div>
          <div className="btn-row"><input className="search" type="search" placeholder="Filter books…" aria-label="Filter books" defaultValue={query} onChange={e => setQuery(e.target.value.trim().toLowerCase())} /></div></div>
        <div className="tabs-s">
          <button type="button" className={filter === 'all' ? 'on' : ''} onClick={() => setFilter('all')}>All <small>{ITEMS.length}</small></button>
          {CLASSES.map(c => <button key={c.id} type="button" className={filter === c.id ? 'on' : ''} onClick={() => setFilter(c.id)}>{c.label} <small>{ITEMS.filter(i => i.cls === c.id).length}</small></button>)}
        </div>
        {list.length ? <div className="book-grid">{list.map(it => <BookCard key={it.id} it={it} onEdit={setEditing} onDelete={onDelete} />)}</div> : <p className="cart-empty">No books match.</p>}
      </section>
    </>
  );
}
