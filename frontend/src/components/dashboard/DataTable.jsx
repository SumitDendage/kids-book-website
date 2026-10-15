import { useState } from 'react';
import Icon from './Icon.jsx';

/* the plain text of a cell, for the filter box (what textContent gave the old table) */
export function textOf(node) {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (node.props) {
    if (node.type === 'select') return textOf(node.props.children);
    if (node.props.children != null) return textOf(node.props.children);
    if (node.props.dangerouslySetInnerHTML) return String(node.props.dangerouslySetInnerHTML.__html).replace(/<[^>]*>/g, '');
    return Object.values(node.props).filter(v => typeof v === 'string' || typeof v === 'number').map(String).join(' ');
  }
  return '';
}

function Table({ head, rows }) {
  return (
    <div className="tbl-wrap">
      <table className="table">
        <thead><tr>{head.map((h, i) => <th key={i}>{h}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => (
          <tr key={r.key != null ? r.key : i} className={(r.onClick ? 'clickable' : '') + (r.cls ? ' ' + r.cls : '') || undefined}
            onClick={r.onClick ? e => { if (!e.target.closest('button, a, input, select, textarea, label')) r.onClick(); } : undefined}>
            {(r.cells || r).map((c, j) => <td key={j}>{c}</td>)}
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

/* the footer of a table whose rows are paged by the server */
export function Pager({ total, offset, limit, count, onPage, onLimit, sizes = [20, 50, 100] }) {
  const pages = Math.max(1, Math.ceil(total / limit)), page = Math.floor(offset / limit);
  const go = n => onPage(Math.max(0, Math.min(pages - 1, n)) * limit);
  return (
    <div className="dt-foot">
      <span className="dt-count">{total ? (offset + 1) + '–' + (offset + count) + ' of ' + total : 'None'}</span>
      {onLimit ? <label className="rpp"><select className="dt-size" value={limit} onChange={e => onLimit(+e.target.value)} aria-label="Rows per page">{sizes.map(n => <option key={n} value={n}>{n}</option>)}</select><span>Rows per page</span></label> : null}
      <div className="pg">
        <span className="dt-page">{'Page ' + (page + 1) + ' of ' + pages}</span>
        <button type="button" className="btn btn-ghost dt-first" aria-label="First page" disabled={page === 0} onClick={() => go(0)}><Icon id="first" size={16} /></button>
        <button type="button" className="btn btn-ghost dt-prev" aria-label="Previous page" disabled={page === 0} onClick={() => go(page - 1)}><Icon id="left" size={16} /></button>
        <button type="button" className="btn btn-ghost dt-next" aria-label="Next page" disabled={page >= pages - 1} onClick={() => go(page + 1)}><Icon id="right" size={16} /></button>
        <button type="button" className="btn btn-ghost dt-last" aria-label="Last page" disabled={page >= pages - 1} onClick={() => go(pages - 1)}><Icon id="last" size={16} /></button>
      </div>
    </div>
  );
}

/* A data table. Plain (or ten rows or fewer without a filter): just the table.
   Otherwise the shadcn "data table": filter box, rows per page, pagination.
   With `page` ({ total, offset, limit, onPage, onLimit }) the server pages the rows. */
export default function DataTable({ head, rows, empty, plain, filter, page }) {
  const [q, setQ] = useState('');
  const [size, setSize] = useState(10);
  const [pageWant, setPage] = useState(0);
  if (!rows.length) return <p className="cart-empty">{empty}</p>;
  if (page) return <div className="dt"><Table head={head} rows={rows} /><Pager {...page} count={rows.length} /></div>;
  if (plain || (rows.length <= 10 && !filter)) return <Table head={head} rows={rows} />;
  const term = q.trim().toLowerCase();
  const vis = term ? rows.filter(r => (r.cells || r).map(textOf).join('').toLowerCase().includes(term)) : rows;
  const pages = Math.max(1, Math.ceil(vis.length / size)), pg = Math.min(pageWant, pages - 1);
  const go = n => setPage(Math.max(0, Math.min(pages - 1, n)));
  return (
    <div className={'dt' + (term ? ' filtered' : '')}>
      <div className="dt-bar">
        <div className="lft">
          <input className="dt-q" type="search" placeholder={filter || 'Filter…'} aria-label="Filter" value={q} onChange={e => { setQ(e.target.value); setPage(0); }} />
          <button type="button" className="btn btn-ghost btn-plain btn-sm dt-reset" onClick={() => { setQ(''); setPage(0); }}>Reset <Icon id="x" size={14} /></button>
        </div>
      </div>
      <Table head={head} rows={vis.slice(pg * size, pg * size + size)} />
      <div className="dt-foot">
        <span className="dt-count">{vis.length + ' of ' + rows.length + ' row(s)' + (term ? ' match' : '')}</span>
        <label className="rpp"><select className="dt-size" value={size} onChange={e => { setSize(+e.target.value); setPage(0); }} aria-label="Rows per page">{[10, 20, 30, 40, 50].map(n => <option key={n} value={n}>{n}</option>)}</select><span>Rows per page</span></label>
        <div className="pg">
          <span className="dt-page">{'Page ' + (pg + 1) + ' of ' + pages}</span>
          <button type="button" className="btn btn-ghost dt-first" aria-label="First page" disabled={pg === 0} onClick={() => go(0)}><Icon id="first" size={16} /></button>
          <button type="button" className="btn btn-ghost dt-prev" aria-label="Previous page" disabled={pg === 0} onClick={() => go(pg - 1)}><Icon id="left" size={16} /></button>
          <button type="button" className="btn btn-ghost dt-next" aria-label="Next page" disabled={pg >= pages - 1} onClick={() => go(pg + 1)}><Icon id="right" size={16} /></button>
          <button type="button" className="btn btn-ghost dt-last" aria-label="Last page" disabled={pg >= pages - 1} onClick={() => go(pages - 1)}><Icon id="last" size={16} /></button>
        </div>
      </div>
    </div>
  );
}
