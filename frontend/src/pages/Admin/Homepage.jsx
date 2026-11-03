import { useMemo, useState } from 'react';
import Icon from '../../components/dashboard/Icon.jsx';
import Modal from '../../components/dashboard/Modal.jsx';
import Pill from '../../components/dashboard/Pill.jsx';
import { Guard, ErrorNote } from '../../components/dashboard/States.jsx';
import { useDash } from '../Portal/DashContext.js';
import { useStaffGet, plural, problem, fieldErrors, inr } from '../Portal/dashboard.js';
import { staffApi } from '../../services/api.js';
import { visibilityOf } from './common.js';

/* what each kind of list shows */
export const KINDS = [
  ['curated', 'Hand-picked sheets'], ['bestsellers', 'Best sellers'], ['new', 'Newest sheets'], ['discounted', 'Discounted sheets'],
  ['free', 'Free sheets'], ['class', 'One class'], ['subject', 'One subject'], ['session', 'One academic session'], ['section', 'One category (section)'],
];
const KIND_NAME = Object.fromEntries(KINDS);
const FILTERED = ['class', 'subject', 'session', 'section'];
const autoText = s => ({
  bestsellers: 'Worked out from paid orders of the last ' + plural(s.autoDays, 'day') + ' (most sold first). Unpaid, failed and refunded orders do not count.',
  new: 'The newest sheets first.', discounted: 'Sheets with an original price above the selling price, biggest cut first.', free: 'Every free sheet.',
  class: 'Every sheet in this class, in display order.', subject: 'Every sheet in this subject, in display order.',
  session: 'Every sheet tagged with this session, in display order.', section: 'Every sheet in this section, in display order.',
}[s.kind] || '');

/* Homepage: the "Picked for you" row and any rows staff add on the home page, and the shop's lists
   (New, Bestselling, Featured, Popular, Recommended). Each one: heading, visibility, order, and
   either hand-picked sheets in a set order or an automatic rule. Taking a sheet off a list never
   changes the sheet. */
export default function Homepage() {
  const { can, toast, site } = useDash();
  const canWrite = can('catalogue.write');
  const q = useStaffGet('/api/admin/home-sections', { keep: true });
  const sheetsQ = useStaffGet('/api/admin/worksheets', { keep: true });
  const clsQ = useStaffGet('/api/admin/classes', { keep: true });
  const subQ = useStaffGet('/api/admin/subjects', { keep: true });
  const sesQ = useStaffGet('/api/admin/sessions', { keep: true });
  const secQ = useStaffGet('/api/admin/sections', { keep: true });
  const [open, setOpen] = useState(null), [edit, setEdit] = useState(null), [del, setDel] = useState(null), [busy, setBusy] = useState('');
  const lists = (q.data && q.data.sections) || [];
  const sheets = useMemo(() => (sheetsQ.data && sheetsQ.data.worksheets) || [], [sheetsQ.data]);
  const byId = useMemo(() => Object.fromEntries(sheets.map(s => [s.id, s])), [sheets]);
  const opts = {
    class: ((clsQ.data && clsQ.data.classes) || []).map(c => [c.id, c.name]),
    subject: ((subQ.data && subQ.data.subjects) || []).map(s => [s.name, s.name]),
    session: ((sesQ.data && sesQ.data.sessions) || []).map(s => [s.id, s.label]),
    section: ((secQ.data && secQ.data.sections) || []).map(s => [s.id, (s.groupLabel ? s.groupLabel + ' › ' : '') + s.label]),
  };
  const filterName = s => { const o = (opts[s.kind] || []).find(([v]) => v === s.filter); return o ? o[1] : s.filter; };
  const done = (r, msg) => { q.setData(d => ({ ...(d || {}), sections: r.sections })); if (msg) toast(msg); if (site && typeof site.reloadCatalogue === 'function') site.reloadCatalogue(true).catch(() => {}); };
  const save = async (s, patch, msg) => {
    setBusy(s.id);
    try { done(await staffApi('PUT', '/api/admin/home-sections/' + encodeURIComponent(s.id), patch), msg); } catch (e) { toast(problem(e)); }
    setBusy('');
  };

  const row = s => (
    <div key={s.id} className={'hs-row' + (open === s.id ? ' open' : '')}>
      <div className="sec-row">
        <div className="sec-name"><b>{s.title}</b><small>{KIND_NAME[s.kind]}{FILTERED.includes(s.kind) ? ': ' + filterName(s) : ''}{s.kind === 'curated' ? '' : s.mode === 'auto' ? ' · Automatic' : ' · Hand-picked'} · {plural(s.shown.length, 'sheet')} on the website{s.subtitle ? ' · ' + s.subtitle : ''}</small></div>
        <span className="btn-row">{s.visible ? <Pill tone="ok">Shown</Pill> : <Pill tone="neutral">Hidden</Pill>}{s.mode === 'auto' ? <Pill tone="info">Auto</Pill> : null}</span>
        {canWrite ? <label className="inline-field" title="Smaller numbers come first"><span className="muted">Order</span>
          <input type="number" defaultValue={s.sort} disabled={busy === s.id} onBlur={e => { const n = parseInt(e.target.value, 10); if (Number.isFinite(n) && n !== s.sort) save(s, { sort: n }, 'Order saved.'); }} /></label> : <span />}
        <span className="btn-row">
          <button type="button" className="link" onClick={() => setOpen(open === s.id ? null : s.id)} aria-expanded={open === s.id}>{open === s.id ? 'Close' : canWrite ? 'Sheets' : 'View'}</button>
          {canWrite ? <>
            <button type="button" className="link" disabled={busy === s.id} onClick={() => save(s, { visible: !s.visible }, s.visible ? 'Hidden from the website.' : 'Shown on the website.')}>{s.visible ? 'Hide' : 'Show'}</button>
            <button type="button" className="link" onClick={() => setEdit(s)}>Edit</button>
            {!s.builtin ? <button type="button" className="link danger" onClick={() => setDel(s)}>Delete</button> : null}
          </> : null}
        </span>
      </div>
      {open === s.id ? <ListEditor key={s.id + ':' + s.items.join(',')} s={s} sheets={sheets} byId={byId} canWrite={canWrite} onDone={done} onMode={m => save(s, { mode: m }, m === 'auto' ? 'The list now fills itself.' : 'The list now shows your hand-picked sheets.')} busy={busy === s.id} /> : null}
    </div>
  );

  const home = lists.filter(s => s.placement === 'home'), shop = lists.filter(s => s.placement === 'shop');
  return (
    <Guard state={q} rows={6}>
      {q.error ? <ErrorNote error={q.error} onRetry={q.reload} compact /> : null}
      <section className="panel">
        <div className="row-between"><div><p className="eyebrow">On the home page</p><p className="auth-sub">Rows of sheets under "Worksheets" on the home page, in this order. Hidden rows and rows with no sheets do not show.</p></div>
          {canWrite ? <button type="button" className="btn btn-primary" onClick={() => setEdit({ placement: 'home' })}><Icon id="plus" />Add a row</button> : null}</div>
        <div className="sec-list">{home.map(row)}</div>
      </section>
      <section className="panel">
        <div className="row-between"><div><p className="eyebrow">In the shop</p><p className="auth-sub">The lists in the shop's Browse menu. Card labels (New, Bestseller, Featured …) follow these lists.</p></div>
          {canWrite ? <button type="button" className="btn btn-ghost" onClick={() => setEdit({ placement: 'shop' })}><Icon id="plus" />Add a shop list</button> : null}</div>
        <div className="sec-list">{shop.map(row)}</div>
      </section>
      {edit ? <ListDialog s={edit} opts={opts} onClose={() => setEdit(null)} onDone={(r, isNew) => { setEdit(null); done(r, isNew ? 'List added.' : 'Saved.'); if (isNew && r.section) setOpen(r.section.id); }} /> : null}
      {del ? <DeleteList s={del} onClose={() => setDel(null)} onDone={r => { setDel(null); done(r, 'List deleted. Its sheets are unchanged.'); }} /> : null}
    </Guard>
  );
}

/* the sheets of one list: hand-picked (add, reorder, take out, save) or what the rule gives */
function ListEditor({ s, sheets, byId, canWrite, onDone, onMode, busy }) {
  const { toast } = useDash();
  const [items, setItems] = useState(s.items);
  const [find, setFind] = useState('');
  const [saving, setSaving] = useState(false);
  const changed = items.join() !== s.items.join();
  const canAuto = s.kind !== 'curated';
  const move = (i, d) => setItems(l => { const n = l.slice(); const j = i + d; if (j < 0 || j >= n.length) return l; [n[i], n[j]] = [n[j], n[i]]; return n; });
  const words = find.trim().toLowerCase();
  const found = words.length < 2 ? [] : sheets.filter(x => !items.includes(x.id) && (x.title + ' ' + x.id + ' ' + (x.sectionLabel || '')).toLowerCase().includes(words)).slice(0, 8);
  const send = async () => {
    setSaving(true);
    try { onDone(await staffApi('PUT', '/api/admin/home-sections/' + encodeURIComponent(s.id) + '/items', { products: items }), 'Saved. The website shows the new order.'); }
    catch (e) { toast(problem(e)); }
    setSaving(false);
  };
  const name = id => (byId[id] ? byId[id].title : id);
  const note = id => { const x = byId[id]; if (!x) return 'deleted'; const v = visibilityOf(x); return v === 'published' ? (x.price === 0 ? 'Free' : inr(x.price)) : v === 'draft' ? 'Draft: not shown' : v === 'hidden' ? 'Hidden: not shown' : 'Scheduled'; };
  return (
    <div className="hs-edit">
      {canAuto ? <div className="seg" role="radiogroup" aria-label="How the list fills">
        <label className={'seg-opt' + (s.mode === 'manual' ? ' on' : '')}><input type="radio" checked={s.mode === 'manual'} disabled={!canWrite || busy} onChange={() => onMode('manual')} />Hand-picked</label>
        <label className={'seg-opt' + (s.mode === 'auto' ? ' on' : '')}><input type="radio" checked={s.mode === 'auto'} disabled={!canWrite || busy} onChange={() => onMode('auto')} />Automatic</label>
      </div> : null}
      {s.mode === 'auto' ? <>
        <p className="auth-sub">{autoText(s)} Shows up to {s.maxItems}.</p>
        <ol className="hs-items">{s.shown.map((id, i) => <li key={id}><span className="hs-n">{i + 1}</span><b>{name(id)}</b><small>{note(id)}</small></li>)}</ol>
        {!s.shown.length ? <p className="cart-empty">{s.kind === 'bestsellers' ? 'No paid orders in this time yet, so the list is empty and does not show.' : 'No sheets match yet.'}</p> : null}
      </> : <>
        <p className="auth-sub">{canWrite ? 'Add sheets, put them in order and save. Taking a sheet out of the list does not change the sheet.' : 'The sheets in this list, in order.'} The website shows the first {s.maxItems}, and only sheets on sale.</p>
        {items.length ? <ol className="hs-items">{items.map((id, i) => (
          <li key={id}><span className="hs-n">{i + 1}</span><b>{name(id)}</b><small>{note(id)}</small>
            {canWrite ? <span className="hs-act">
              <button type="button" className="icon-btn sm" aria-label={'Move ' + name(id) + ' up'} disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
              <button type="button" className="icon-btn sm" aria-label={'Move ' + name(id) + ' down'} disabled={i === items.length - 1} onClick={() => move(i, 1)}>↓</button>
              <button type="button" className="link danger" onClick={() => setItems(l => l.filter(x => x !== id))}>Remove</button>
            </span> : null}
          </li>))}</ol> : <p className="cart-empty">No sheets in this list yet{canWrite ? ': search below to add some' : ''}.</p>}
        {canWrite ? <>
          <div className="hs-find"><input className="search" type="search" placeholder="Find a sheet to add…" aria-label="Find a sheet to add" value={find} onChange={e => setFind(e.target.value)} />
            {found.length ? <ul className="hs-found">{found.map(x => <li key={x.id}><span><b>{x.title}</b><small>{note(x.id)}</small></span><button type="button" className="btn btn-ghost" onClick={() => { setItems(l => l.concat(x.id)); setFind(''); }}><Icon id="plus" />Add</button></li>)}</ul>
              : words.length >= 2 ? <p className="muted">No sheet matches.</p> : null}</div>
          <div className="btn-row"><button type="button" className="btn btn-primary" disabled={!changed || saving} onClick={send}>{saving ? 'Saving…' : 'Save the list'}</button>
            {changed ? <button type="button" className="btn btn-ghost" disabled={saving} onClick={() => setItems(s.items)}>Undo</button> : null}</div>
        </> : null}
      </>}
    </div>
  );
}

function ListDialog({ s, opts, onClose, onDone }) {
  const isNew = !s.id;
  const [kind, setKind] = useState(s.kind || 'curated');
  const [busy, setBusy] = useState(false), [err, setErr] = useState(null), [errs, setErrs] = useState({});
  const submit = async e => {
    const f = new FormData(e.currentTarget);
    const body = { title: String(f.get('title') || '').trim(), subtitle: String(f.get('subtitle') || '').trim(), maxItems: Number(f.get('maxItems')) || 12 };
    if (f.get('autoDays')) body.autoDays = Number(f.get('autoDays'));
    if (!s.builtin) { body.kind = kind; if (FILTERED.includes(kind)) body.filter = f.get('filter') || null; }
    if (isNew) body.placement = f.get('placement') || 'home';
    if (!body.title) { setErrs({ title: 'Give the list a heading.' }); return; }
    if (!s.builtin && FILTERED.includes(kind) && !body.filter) { setErrs({ filter: 'Pick one.' }); return; }
    setBusy(true); setErr(null); setErrs({});
    try { onDone(isNew ? await staffApi('POST', '/api/admin/home-sections', body) : await staffApi('PUT', '/api/admin/home-sections/' + encodeURIComponent(s.id), body), isNew); }
    catch (x) { const e2 = fieldErrors(x); setErrs(e2); setErr(Object.keys(e2).length ? 'Please check the fields marked in red.' : problem(x)); setBusy(false); }
  };
  const f1 = k => (errs[k] ? <small className="bad">{errs[k]}</small> : null);
  return (
    <Modal title={isNew ? 'Add a list' : 'Edit ' + s.title} onClose={onClose} onSubmit={submit} submitLabel={isNew ? 'Add it' : 'Save'} busyLabel="Saving…" busy={busy} error={err} wide>
      <div className="grid-3">
        <div className="field"><label htmlFor="hsTitle">Heading</label><input id="hsTitle" name="title" defaultValue={s.title || ''} maxLength={60} placeholder="e.g. Kindergarten favourites" aria-invalid={!!errs.title} />{f1('title')}</div>
        <div className="field"><label htmlFor="hsSub">Line under it (optional)</label><input id="hsSub" name="subtitle" defaultValue={s.subtitle || ''} maxLength={160} /></div>
        {isNew ? <div className="field"><label htmlFor="hsWhere">Shows</label><select id="hsWhere" name="placement" defaultValue={s.placement || 'home'}><option value="home">On the home page</option><option value="shop">In the shop's Browse menu</option></select></div> : null}
      </div>
      <div className="grid-3">
        <div className="field"><label htmlFor="hsKind">What it shows</label><select id="hsKind" value={kind} disabled={!!s.builtin} onChange={e => setKind(e.target.value)}>{KINDS.map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select>
          <small>{kind === 'curated' ? 'You pick every sheet.' : 'Fills itself, or switch it to hand-picked after adding.'}</small></div>
        {FILTERED.includes(kind) ? <div className="field"><label htmlFor="hsFilter">Which one</label><select id="hsFilter" name="filter" defaultValue={s.filter || ''} aria-invalid={!!errs.filter}><option value="">Pick…</option>{(opts[kind] || []).map(([v, n]) => <option key={v} value={v}>{n}</option>)}</select>{f1('filter')}</div> : null}
        <div className="field"><label htmlFor="hsMax">Sheets shown</label><input id="hsMax" name="maxItems" type="number" min="1" max="200" defaultValue={s.maxItems || 12} />{f1('maxItems')}</div>
        {kind === 'bestsellers' ? <div className="field"><label htmlFor="hsDays">Sales from the last (days)</label><input id="hsDays" name="autoDays" type="number" min="1" max="3650" defaultValue={s.autoDays || 90} />{f1('autoDays')}</div> : null}
      </div>
    </Modal>
  );
}

function DeleteList({ s, onClose, onDone }) {
  const [busy, setBusy] = useState(false), [err, setErr] = useState(null);
  const submit = async () => {
    setBusy(true); setErr(null);
    try { onDone(await staffApi('DELETE', '/api/admin/home-sections/' + encodeURIComponent(s.id))); } catch (e) { setErr(problem(e)); setBusy(false); }
  };
  return (
    <Modal title={'Delete ' + s.title + '?'} onClose={onClose} onSubmit={submit} submitLabel="Delete it" busyLabel="Deleting…" danger busy={busy} error={err}>
      <p>The list leaves the website. The sheets in it are not changed.</p>
    </Modal>
  );
}
