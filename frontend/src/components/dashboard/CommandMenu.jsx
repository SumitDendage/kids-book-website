import { useEffect, useMemo, useRef, useState } from 'react';
import Icon from './Icon.jsx';

/* ⌘K: jump to a section by typing part of its name. Only sections this staff member may open
   are listed. Arrow keys move, Enter opens, Escape closes. */
export default function CommandMenu({ items, onPick, onClose }) {
  const [q, setQ] = useState('');
  const [at, setAt] = useState(0);
  const inputRef = useRef(null), listRef = useRef(null);
  const term = q.trim().toLowerCase();
  const hits = useMemo(() => (term ? items.filter(it => it.label.toLowerCase().includes(term) || it.id.includes(term) || (it.group || '').toLowerCase().includes(term)) : items), [items, term]);
  const pos = Math.min(at, Math.max(0, hits.length - 1));

  useEffect(() => { if (inputRef.current) inputRef.current.focus(); }, []);
  useEffect(() => { const el = listRef.current && listRef.current.querySelector('[aria-selected="true"]'); if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' }); }, [pos]);

  const onKey = e => {
    e.stopPropagation();
    if (e.key === 'Escape') { e.preventDefault(); onClose(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setAt(Math.min(hits.length - 1, pos + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setAt(Math.max(0, pos - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (hits[pos]) onPick(hits[pos]); }
    else if (e.key === 'Tab') e.preventDefault();
  };
  return (
    <div className="dm-scrim cmdk-scrim" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="cmdk" role="dialog" aria-modal="true" aria-label="Go to a section" onKeyDown={onKey}>
        <div className="cmdk-in"><Icon id="search" size={16} /><input ref={inputRef} type="text" role="combobox" aria-expanded="true" aria-controls="cmdkList" aria-activedescendant={hits[pos] ? 'cmdk-' + hits[pos].key : undefined} placeholder="Type a section name…" value={q} onChange={e => { setQ(e.target.value); setAt(0); }} aria-label="Section name" /><kbd>Esc</kbd></div>
        <div className="cmdk-list" id="cmdkList" role="listbox" ref={listRef}>
          {hits.length ? hits.map((it, i) => (
            <button key={it.key} id={'cmdk-' + it.key} type="button" role="option" aria-selected={i === pos} className={'cmdk-item' + (i === pos ? ' on' : '')} onMouseEnter={() => setAt(i)} onClick={() => onPick(it)}>
              <Icon id={it.icon || it.id} /><span>{it.label}</span>{it.group ? <small>{it.group}</small> : null}
            </button>
          )) : <p className="cmdk-empty">No section matches “{q.trim()}”.</p>}
        </div>
      </div>
    </div>
  );
}
