import { useRef, useState } from 'react';
import Icon from '../../components/dashboard/Icon.jsx';
import { useDash } from '../Portal/DashContext.js';
import { save, log, kb } from '../Portal/dashboard.js';
import { read } from '../../services/storage.js';
import { CLASSES, SUBJECTS, subjectById } from '../../data/content.js';
import { KG_TOPICS, itemById, addItem, removeItem } from '../../data/catalogue.js';

/* a drop zone for the cover photo or the PDF: click to choose, or drag a file on it */
function Drop({ kind, it, toast }) {
  const input = useRef(null);
  const [over, setOver] = useState(false);
  const [picked, setPicked] = useState(null);   /* { name, size, url } */
  const show = file => {
    if (!file) return;
    if (kind === 'image' && file.type.startsWith('image/')) { const r = new FileReader(); r.onload = () => setPicked({ name: file.name, size: file.size, url: r.result }); r.readAsDataURL(file); }
    else setPicked({ name: file.name, size: file.size });
  };
  const onDrop = e => {
    e.preventDefault(); setOver(false);
    const f = e.dataTransfer.files[0]; if (!f) return;
    const ok = kind === 'image' ? f.type.startsWith('image/') : f.type === 'application/pdf';
    if (!ok) { toast(kind === 'image' ? 'Drop an image file' : 'Drop a PDF file'); return; }
    const dt = new DataTransfer(); dt.items.add(f); input.current.files = dt.files; show(f);
  };
  const drag = on => e => { e.preventDefault(); setOver(on); };
  const zone = { className: 'drop' + (kind === 'pdf' ? ' small' : '') + (over ? ' over' : ''), 'data-drop': kind, onClick: e => { if (!e.target.closest('input')) input.current.click(); }, onDragEnter: drag(true), onDragOver: drag(true), onDragLeave: drag(false), onDrop };
  const pick = <input ref={input} type="file" name={kind} accept={kind === 'image' ? 'image/*' : 'application/pdf'} hidden onChange={e => show(e.target.files[0])} />;
  if (kind === 'image') {
    const url = picked ? picked.url : it.image;
    return (
      <div {...zone} role="button" tabIndex={0} aria-label="Choose the cover photo" onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.current.click(); } }}>{pick}
        <div className="drop-preview" style={url ? { backgroundImage: 'url(' + url + ')' } : undefined}>{url ? null : <><span className="drop-icon"><Icon id="image" size={28} /></span><b>Drop the cover photo here</b><small>or click to choose · JPG / PNG · up to 600 KB</small></>}</div>
        <p className="drop-name">{picked ? picked.name + ' · ' + kb(picked.size) : it.image ? 'Cover set — drop a new one to replace it' : ''}</p>
      </div>
    );
  }
  return (
    <div {...zone} role="button" tabIndex={0} aria-label="Choose the PDF" onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.current.click(); } }}>{pick}
      <div className="drop-preview"><span className="drop-icon"><Icon id="file" size={24} /></span><b>{picked ? picked.name : it.pdf ? it.pdf.name : 'Drop the PDF here'}</b><small>{it.pdf ? kb(it.pdf.size) + ' · drop a new file to replace' : 'or click to choose · up to 1.5 MB'}</small></div>
      <p className="drop-name">{picked ? picked.name + ' · ' + kb(picked.size) : ''}</p>
    </div>
  );
}

function readFile(file, max, toast) {
  return new Promise(res => {
    if (!file) return res(null);
    if (file.size > max) { toast('File too large for the demo (' + kb(file.size) + ') — keeping the name only'); return res({ name: file.name, size: file.size }); }
    const r = new FileReader(); r.onload = () => res({ name: file.name, size: file.size, data: r.result }); r.readAsDataURL(file);
  });
}

export function deleteProduct(id, { toast, done, site }) {
  const it = itemById(id); if (!it || !confirm('Delete "' + it.title + '"?')) return;
  const o = read('lww_products', { added: [], edited: {}, deleted: [] });
  if (o.added.some(x => x.id === id)) o.added = o.added.filter(x => x.id !== id); else if (!o.deleted.includes(id)) o.deleted.push(id);
  delete o.edited[id]; save('lww_products', o);
  removeItem(id);
  log('book deleted', it.title); site.rerenderAll(); done(); toast('Deleted');
}

/* "Upload new book" / "Edit book": cover + PDF drop zones, stars, details, category, price, limits */
export default function ProductStudio({ id }) {
  const { toast, setEditing, refresh, site } = useDash();
  const it = id === 'new' ? {} : itemById(id) || {};
  const [rating, setRating] = useState(it.rating || 0);
  const v = k => (it[k] == null ? '' : it[k]);
  const subj = it.subjectId || (SUBJECTS.find(y => y.label === it.subject) || {}).id;
  const close = () => { setEditing(null); refresh(); };

  const submit = async e => {
    e.preventDefault();
    const form = e.currentTarget, f = new FormData(form), pid = it.id || ('p-' + Date.now().toString(36));
    const o = read('lww_products', { added: [], edited: {}, deleted: [] });
    const fields = { title: String(f.get('title')).trim(), glyph: String(f.get('glyph')).trim() || '✎', cls: f.get('cls'), subjectId: f.get('subjectId'), subject: subjectById(f.get('subjectId')).label, price: Math.max(0, parseInt(f.get('price'), 10) || 0), was: parseInt(f.get('was'), 10) || null, stock: f.get('stock') === '' ? null : parseInt(f.get('stock'), 10), pages: parseInt(f.get('pages'), 10) || 8, audience: f.get('audience'), topic: String(f.get('topic') || ''), rating: parseFloat(f.get('rating')) || 0, printLimit: parseInt(f.get('printLimit'), 10) || 0, downloadLimit: parseInt(f.get('downloadLimit'), 10) || 0, blurb: String(f.get('blurb')).trim() };
    if (!fields.title) { toast('Give the book a title'); return; }
    const imgFile = f.get('image'), pdfFile = f.get('pdf');
    const img = await readFile(imgFile && imgFile.size ? imgFile : null, 600 * 1024, toast); if (img && img.data) fields.image = img.data;
    const pdf = await readFile(pdfFile && pdfFile.size ? pdfFile : null, 1500 * 1024, toast); if (pdf) fields.pdf = { name: pdf.name, size: pdf.size, data: pdf.data || null };
    const existing = itemById(pid);
    if (existing) { Object.assign(existing, fields); if (o.added.some(x => x.id === pid)) o.added = o.added.map(x => (x.id === pid ? existing : x)); else o.edited[pid] = Object.assign(o.edited[pid] || {}, fields); log('book edited', fields.title); }
    else { const np = Object.assign({ id: pid, kind: 'sheet', skills: [], bullets: [] }, fields); addItem(np); o.added.push(np); log('book uploaded', fields.title); }
    try { localStorage.setItem('lww_products', JSON.stringify(o)); } catch (_) { toast('Storage is full — use a smaller image or PDF'); return; }
    site.rerenderAll(); close(); toast(existing ? 'Saved' : 'Published — it is on the shelf now');
  };

  return (
    <section className="panel studio">
      <div className="row-between"><div><p className="eyebrow">{it.id ? 'Edit book' : 'Upload new book'}</p><p className="auth-sub">{it.id ? it.title : 'Drop the cover and the PDF, fill in the details, save — it goes straight on the shelf.'}</p></div><button type="button" className="icon-btn" aria-label="Close" onClick={close}><Icon id="x" /></button></div>
      <form className="studio-grid" onSubmit={submit}>
        <div className="studio-side">
          <Drop kind="image" it={it} toast={toast} />
          <Drop kind="pdf" it={it} toast={toast} />
          <div className="field"><label>Rating (shown as stars)</label><div className="rate"><input type="hidden" name="rating" value={rating} />{[1, 2, 3, 4, 5].map(n => <button key={n} type="button" className={'star' + (rating >= n ? ' on' : '')} aria-label={n + ' star'} aria-pressed={rating >= n} onClick={() => setRating(n)}><Icon id="star" size={22} /></button>)}</div></div>
        </div>
        <div className="studio-main">
          <fieldset className="fs"><legend>Book details</legend>
            <div className="field"><label htmlFor="psTitle">Title</label><input id="psTitle" name="title" defaultValue={v('title')} placeholder="e.g. Alphabet explorers" required /></div>
            <div className="field"><label htmlFor="psBlurb">Description</label><textarea id="psBlurb" name="blurb" placeholder="One or two lines parents will read on the card" defaultValue={v('blurb')} /></div>
            <div className="grid-3"><div className="field"><label htmlFor="psGlyph">Cover glyph</label><input id="psGlyph" name="glyph" defaultValue={v('glyph')} placeholder="Aa" /></div><div className="field"><label htmlFor="psPages">Pages</label><input id="psPages" name="pages" type="number" min="1" defaultValue={it.pages || 8} /></div></div>
          </fieldset>
          <fieldset className="fs"><legend>Category</legend>
            <div className="grid-3">
              <div className="field"><label htmlFor="psCls">Class</label><select id="psCls" name="cls" defaultValue={it.cls || 'kg'}>{CLASSES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}</select></div>
              <div className="field"><label htmlFor="psSubj">Subject</label><select id="psSubj" name="subjectId" defaultValue={subj}>{SUBJECTS.map(x => <option key={x.id} value={x.id}>{x.label}</option>)}</select></div>
              <div className="field"><label htmlFor="psTopic">Topic (Kindergarten shelf)</label><select id="psTopic" name="topic" defaultValue={it.topic || ''}><option value="">— none —</option>{KG_TOPICS.map(g => <optgroup key={g.id} label={g.title}>{g.items.map(([tid, l]) => <option key={tid} value={tid}>{l}</option>)}</optgroup>)}</select><small>Files the sheet under a skill in Sheets → Kindergarten</small></div>
              <div className="field"><label htmlFor="psFor">For</label><select id="psFor" name="audience" defaultValue={it.audience || 'both'}><option value="both">Parents &amp; teachers</option><option value="parent">Parents</option><option value="teacher">Teachers</option></select></div>
            </div>
          </fieldset>
          <fieldset className="fs"><legend>Price &amp; stock</legend>
            <div className="grid-3">
              <div className="field"><label htmlFor="psPrice">Price ₹</label><input id="psPrice" name="price" type="number" min="0" defaultValue={it.price == null ? 0 : it.price} /><small>0 = free access sheet · anything else = part of the class plan</small></div>
              <div className="field"><label htmlFor="psStock">Stock</label><input id="psStock" name="stock" type="number" min="0" defaultValue={it.stock == null ? '' : it.stock} placeholder="unlimited" /></div>
              <div className="field"><label htmlFor="psWas">Old price ₹ (optional)</label><input id="psWas" name="was" type="number" min="0" defaultValue={it.was || ''} placeholder="shows struck through" /></div>
            </div>
          </fieldset>
          <fieldset className="fs"><legend>Limits per customer</legend>
            <div className="grid-3">
              <div className="field"><label htmlFor="psPrint">Print limit</label><input id="psPrint" name="printLimit" type="number" min="0" defaultValue={it.printLimit || ''} placeholder="unlimited" /></div>
              <div className="field"><label htmlFor="psDl">Download limit</label><input id="psDl" name="downloadLimit" type="number" min="0" defaultValue={it.downloadLimit || ''} placeholder="unlimited" /></div>
            </div>
          </fieldset>
          <div className="btn-row studio-actions">
            <button type="submit" className="btn btn-primary">{it.id ? 'Save changes' : 'Publish to the shelf'}</button>
            <button type="button" className="btn btn-ghost" onClick={close}>Cancel</button>
            {it.id ? <button type="button" className="btn btn-ghost btn-danger" style={{ marginLeft: 'auto' }} onClick={() => deleteProduct(it.id, { toast, site, done: close })}><Icon id="trash" />Delete book</button> : null}
          </div>
        </div>
      </form>
    </section>
  );
}
