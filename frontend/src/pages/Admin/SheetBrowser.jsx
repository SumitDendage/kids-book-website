import { useMemo, useRef, useState } from 'react';
import Icon from '../../components/dashboard/Icon.jsx';
import Modal from '../../components/dashboard/Modal.jsx';
import Pill from '../../components/dashboard/Pill.jsx';
import { useDash } from '../Portal/DashContext.js';
import { inr, plural, problem, fieldErrors, size } from '../Portal/dashboard.js';
import { staffApi } from '../../services/api.js';
import { VISIBILITY, VISIBILITY_TONE, visibilityOf } from './common.js';
import { ensurePlace, sectionFields, sectionsOfClass, sameName } from './place.js';
import { sendRaw, uploadProblem } from './ProductStudio.jsx';

const VIS_LABEL = Object.fromEntries(VISIBILITY);
const CLASS_STATUS = [['available', 'Open'], ['coming_soon', 'Coming soon'], ['hidden', 'Hidden']];
const PDF_MAX = 40 * 1024 * 1024;
const isPdf = f => f && (f.type === 'application/pdf' || /\.pdf$/i.test(f.name));
/* "alphabet_tracing-A.pdf" → "Alphabet tracing A" */
export const titleFromFile = name => {
  const t = String(name || '').replace(/\.pdf$/i, '').replace(/[_\-.]+/g, ' ').replace(/\s+/g, ' ').trim();
  return t ? t[0].toUpperCase() + t.slice(1) : 'New sheet';
};
let keepCls = null, keepSubject = 'all', keepOpen = null;
const glyph = t => String(t || '?').replace(/[^A-Za-z0-9 ]/g, ' ').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?';
const hasText = (q, ...xs) => xs.some(x => String(x || '').toLowerCase().includes(q));

/* Sheets by class and section, laid out like folders: pick a class at the top, then every section
   with sheets is a card (its cover, name and count) under its group. Open a card to see its sheets
   and change any of them. Empty sections stay tucked away until asked for. */
export default function SheetBrowser({ all, classes, sections, subjectList, onEdit, onNew, onSaved, onMade }) {
  const { can, toast } = useDash();
  const canWrite = can('catalogue.write'), canUpload = can('files.upload');
  const [cls, setClsState] = useState(() => (keepCls && classes.some(c => c.id === keepCls) ? keepCls : (classes[0] && classes[0].id) || 'kg'));
  const [subject, setSubjectState] = useState(keepSubject);
  const [opened, setOpenedState] = useState(keepOpen);   /* the open section's id ('' = the class shelf), or null for all sections */
  const setCls = v => { keepCls = v; setClsState(v); setOpened(null); };
  const setSubject = v => { keepSubject = v; setSubjectState(v); };
  const setOpened = v => { keepOpen = v; setOpenedState(v); };
  const [dialog, setDialog] = useState(null);   /* { kind: 'class' | 'subject' | 'section' | 'rename' | 'bulk', section? } */
  const [showEmpty, setShowEmpty] = useState(false);
  const [find, setFind] = useState('');
  const [busy, setBusy] = useState(false);
  const cur = classes.find(c => c.id === cls) || classes[0] || { id: cls, name: cls, status: 'available' };
  const q = find.trim().toLowerCase();

  const inClass = useMemo(() => all.filter(s => s.cls === cur.id), [all, cur.id]);
  const subjects = useMemo(() => [...new Set((subjectList || []).filter(x => x.active).map(x => x.name).concat(inClass.map(s => s.subject).filter(Boolean)))], [subjectList, inClass]);
  const shown = subject === 'all' ? inClass : inClass.filter(s => s.subject === subject);
  /* this class's sections with their sheets, Your sections first, then the website's groups in order */
  const secs = useMemo(() => {
    const list = sectionsOfClass(sections, cur.id).slice().sort((a, b) => (a.sort - b.sort) || a.label.localeCompare(b.label));
    const ids = new Set(list.map(x => x.id));
    /* a sheet whose section belongs to another class still shows here */
    shown.forEach(s => { if (s.section && !ids.has(s.section)) { ids.add(s.section); list.push({ id: s.section, label: s.sectionLabel || s.section, group: s.group, groupLabel: '', cls: cur.id }); } });
    const out = list.map(x => ({ ...x, group: x.groupLabel || (x.builtin ? 'Other topics' : 'Your sections'), list: shown.filter(s => s.section === x.id) }));
    const none = shown.filter(s => !s.section);
    if (none.length) out.push({ id: '', label: 'Not in a section', group: 'Class shelf', list: none });
    return out;
  }, [sections, shown, cur.id]);
  const filled = secs.filter(x => x.list.length);
  const empty = secs.length - filled.length;
  const visible = q ? secs.filter(x => hasText(q, x.label, x.group) || x.list.some(s => hasText(q, s.title))) : showEmpty ? secs : filled;
  const groups = useMemo(() => {
    const m = new Map();
    visible.forEach(x => { if (!m.has(x.group)) m.set(x.group, []); m.get(x.group).push(x); });
    /* staff's own sections first */
    return [...m.entries()].sort((a, b) => (b[0] === 'Your sections') - (a[0] === 'Your sections'));
  }, [visible]);
  const sheetHits = q ? shown.filter(s => hasText(q, s.title, s.id)).slice(0, 30) : [];
  const open = opened === null ? null : secs.find(x => x.id === opened) || null;

  const setStatus = async st => {
    setBusy(true);
    try { onMade('classes', await staffApi('PUT', '/api/admin/classes', { classes: [{ id: cur.id, status: st }] })); toast(cur.name + ': ' + CLASS_STATUS.find(x => x[0] === st)[1] + ' on the website.'); }
    catch (e) { toast(problem(e)); }
    setBusy(false);
  };
  const setShown = async (x, on) => {
    setBusy(true);
    try { onMade('sections', await staffApi('PUT', '/api/admin/sections/' + encodeURIComponent(x.id), { visible: on })); toast(on ? 'Shown on the website.' : 'Hidden from the website.'); }
    catch (e) { toast(problem(e)); }
    setBusy(false);
  };
  const preset = x => ({ cls: cur.id, subject: subject !== 'all' ? subject : '', sectionLabel: x && x.id ? x.label : '' });
  const live = list => list.filter(s => visibilityOf(s) === 'published').length;
  const sheetCard = s => {
    const vis = visibilityOf(s);
    return <li key={s.id}><button type="button" className="br-sheet" onClick={() => onEdit(s.id)} aria-label={(canWrite ? 'Edit ' : 'Open ') + s.title}>
      <span className="br-cover" style={s.thumb ? { backgroundImage: 'url("' + s.thumb + '")' } : undefined} aria-hidden="true">{s.thumb ? null : glyph(s.title)}</span>
      <b>{s.title}</b>
      <small>{s.subject} · {s.pages} pg{s.available ? '' : ' · no PDF yet'}</small>
      <span className="br-foot"><Pill tone={VISIBILITY_TONE[vis]}>{VIS_LABEL[vis]}</Pill><span className="br-price">{s.price === 0 ? 'Free' : inr(s.price)}</span></span>
    </button></li>;
  };

  return (
    <section className="panel browser" aria-label="Sheets by class and section">
      <div className="br-classes" role="tablist" aria-label="Class">
        {classes.map(c => <button key={c.id} type="button" role="tab" aria-selected={c.id === cur.id} className={'br-class' + (c.id === cur.id ? ' on' : '')} onClick={() => setCls(c.id)}>
          <b>{c.name}</b><small>{plural(all.filter(s => s.cls === c.id).length, 'sheet')}{c.status !== 'available' ? ' · ' + (CLASS_STATUS.find(x => x[0] === c.status) || [])[1] : ''}</small></button>)}
        {canWrite ? <button type="button" className="br-class add" onClick={() => setDialog({ kind: 'class' })}><Icon id="plus" size={16} /><b>New class</b></button> : null}
      </div>
      <div className="br-tools">
        <input className="search" type="search" placeholder={'Find a section or sheet in ' + cur.name + '…'} aria-label="Find a section or sheet" value={find} onChange={e => { setFind(e.target.value); if (e.target.value) setOpened(null); }} />
        <select aria-label="Subject" value={subject} onChange={e => { if (e.target.value === '+new') setDialog({ kind: 'subject' }); else setSubject(e.target.value); }}>
          <option value="all">Every subject ({inClass.length})</option>
          {subjects.map(x => <option key={x} value={x}>{x} ({inClass.filter(s => s.subject === x).length})</option>)}
          {canWrite ? <option value="+new">+ New subject…</option> : null}</select>
        {canWrite ? <label className="inline-field"><span className="muted">On the website</span>
          <select value={cur.status} disabled={busy} onChange={e => setStatus(e.target.value)} aria-label={cur.name + ' on the website'}>{CLASS_STATUS.map(([id, n]) => <option key={id} value={id}>{n}</option>)}</select></label>
          : <Pill>{(CLASS_STATUS.find(x => x[0] === cur.status) || [])[1]}</Pill>}
        {canWrite ? <span className="br-acts">
          <button type="button" className="btn btn-primary" onClick={() => setDialog({ kind: 'section' })}><Icon id="plus" />Add section</button>
          {canUpload ? <button type="button" className="btn btn-ghost" onClick={() => setDialog({ kind: 'bulk', section: open && open.id ? open : null })}><Icon id="download" />Upload PDFs</button> : null}
        </span> : null}
      </div>
      {cur.status !== 'available' ? <div className="st-note warn compact"><Icon id="lock" size={16} /><span>{cur.name} is {cur.status === 'hidden' ? 'hidden' : '"Coming soon"'} on the website, so customers can't buy its sheets yet. Set "On the website" to Open when it is ready.</span></div> : null}

      {open ? <div className="br-open">
        <nav className="br-crumbs" aria-label="Where you are"><button type="button" className="link" onClick={() => setOpened(null)}>← All sections</button><span>{cur.name}</span><span>{open.group}</span><b>{open.label}</b></nav>
        <div className="row-between br-open-head">
          <div><h3>{open.label}</h3><p className="auth-sub">{plural(open.list.length, 'sheet')} · {live(open.list)} on the website{open.visible === false ? ' · this section is hidden on the website' : ''}</p></div>
          {canWrite && open.id ? <div className="btn-row">
            <button type="button" className="btn btn-primary" onClick={() => onNew(preset(open))}><Icon id="plus" />Add a sheet</button>
            {canUpload ? <button type="button" className="btn btn-ghost" onClick={() => setDialog({ kind: 'bulk', section: open })}><Icon id="download" />Upload PDFs</button> : null}
            <button type="button" className="btn btn-ghost" onClick={() => setDialog({ kind: 'rename', section: open })}><Icon id="edit" />Rename</button>
            <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => setShown(open, open.visible === false)}><Icon id="eye" />{open.visible === false ? 'Show on website' : 'Hide from website'}</button>
            {open.list.length ? null : <button type="button" className="btn btn-ghost danger" onClick={() => setDialog({ kind: 'delete', section: open })}><Icon id="trash" />Delete section</button>}
          </div> : null}
        </div>
        {open.list.length ? <ul className="br-sheets">{open.list.map(sheetCard)}</ul>
          : <p className="cart-empty">No sheets here yet.{canWrite ? ' Use "Add a sheet" or "Upload PDFs".' : ''}</p>}
      </div> : <>
        {groups.map(([g, list]) => <div key={g} className="br-group">
          <p className="sec-group">{g} <small>{plural(list.length, 'section')}</small></p>
          <ul className="br-secs">{list.map(x => {
            const pic = (x.list.find(s => s.thumb) || {}).thumb;
            return <li key={x.id || 'none'}><button type="button" className={'br-sec' + (x.visible === false ? ' off' : '')} data-section={x.id || 'none'} onClick={() => { setOpened(x.id); setFind(''); }}>
              <span className="br-cover" style={pic ? { backgroundImage: 'url("' + pic + '")' } : undefined} aria-hidden="true">{pic ? null : <Icon id="file" size={22} />}</span>
              <b>{x.label}</b>
              <small>{x.list.length ? plural(x.list.length, 'sheet') + ' · ' + live(x.list) + ' live' : 'Empty'}{x.visible === false ? ' · hidden' : ''}</small>
            </button></li>;
          })}</ul>
        </div>)}
        {sheetHits.length ? <div className="br-group"><p className="sec-group">Sheets matching "{find.trim()}"</p><ul className="br-sheets">{sheetHits.map(sheetCard)}</ul></div> : null}
        {q && !visible.length && !sheetHits.length ? <p className="cart-empty">Nothing in {cur.name} matches "{find.trim()}".</p> : null}
        {!q && empty ? <button type="button" className="link br-more" onClick={() => setShowEmpty(v => !v)}>{showEmpty ? 'Hide the empty sections' : 'Show ' + plural(empty, 'empty section') + ' too'}</button> : null}
      </>}

      {dialog && dialog.kind === 'class' ? <NameDialog title="Add a class" label="Class name" placeholder="e.g. Class 4" note='It shows as "Coming soon" on the website until you set it to Open.'
        onClose={() => setDialog(null)} onSave={async name => {
          if (classes.some(c => sameName(c.name, name))) throw Object.assign(new Error('There is already a class with that name.'), { field: true });
          const r = await ensurePlace({ classes, newClass: name }, onMade);
          setCls(r.cls); setSubject('all'); toast(name + ' added. Add its first section now.');
        }} /> : null}
      {dialog && dialog.kind === 'subject' ? <NameDialog title="Add a subject" label="Subject name" placeholder="e.g. Hindi"
        onClose={() => setDialog(null)} onSave={async name => {
          const r = await ensurePlace({ subjects: subjectList, subject: name }, onMade);
          setSubject(r.subject); toast(r.subject + ' is ready. Pick it on a sheet.');
        }} /> : null}
      {dialog && dialog.kind === 'section' ? <BulkUpload make cls={cur} section={null} sections={sections} classes={classes} subjects={subjects} subjectList={subjectList} startSubject={subject !== 'all' ? subject : ''}
        onSaved={onSaved} onMade={onMade} onSection={id => { setOpened(id); setSubject('all'); setFind(''); }} onClose={() => setDialog(null)} /> : null}
      {dialog && dialog.kind === 'rename' ? <NameDialog title="Rename section" label="Section name" start={dialog.section.label}
        onClose={() => setDialog(null)} onSave={async name => {
          onMade('sections', await staffApi('PUT', '/api/admin/sections/' + encodeURIComponent(dialog.section.id), { label: name }));
          toast('Renamed.');
        }} /> : null}
      {dialog && dialog.kind === 'delete' ? <Modal title="Delete this section?" danger submitLabel="Delete it" busyLabel="Deleting…" busy={busy} onClose={() => setDialog(null)}
        onSubmit={async () => {
          setBusy(true);
          try { onMade('sections', await staffApi('DELETE', '/api/admin/sections/' + encodeURIComponent(dialog.section.id))); setDialog(null); setOpened(null); toast('Section deleted.'); }
          catch (e) { toast(e.code === 'in_use' ? e.message : problem(e)); }
          setBusy(false);
        }}><p><b>{dialog.section.label}</b> has no sheets, so it is simply removed.</p></Modal> : null}
      {dialog && dialog.kind === 'bulk' ? <BulkUpload cls={cur} section={dialog.section} sections={sections} classes={classes} subjects={subjects} subjectList={subjectList} startSubject={subject !== 'all' ? subject : ''}
        onSaved={onSaved} onMade={onMade} onClose={() => setDialog(null)} /> : null}
    </section>
  );
}

/* a one-field dialog: a name for a new class, subject or section */
function NameDialog({ title, label, placeholder, note, start = '', onSave, onClose }) {
  const [busy, setBusy] = useState(false), [err, setErr] = useState(null), [bad, setBad] = useState('');
  const submit = async e => {
    const name = String(new FormData(e.currentTarget).get('name') || '').trim().replace(/\s+/g, ' ');
    if (!name) { setBad('Type a name.'); return; }
    setBusy(true); setErr(null); setBad('');
    try { await onSave(name); onClose(); }
    catch (x) { const fe = fieldErrors(x); const msg = x.field ? x.message : Object.values(fe)[0] || problem(x); if (x.field || Object.keys(fe).length) setBad(msg); else setErr(msg); setBusy(false); }
  };
  return (
    <Modal title={title} onClose={onClose} onSubmit={submit} submitLabel="Save" busyLabel="Saving…" busy={busy} error={err}>
      <div className="field"><label htmlFor="ndName">{label}</label><input id="ndName" name="name" defaultValue={start} placeholder={placeholder} maxLength={60} aria-invalid={!!bad} />
        {bad ? <small className="bad">{bad}</small> : note ? <small>{note}</small> : null}</div>
    </Modal>
  );
}

/* many PDFs at once: each file becomes a sheet in the section, named after the file. They are saved
   as drafts unless "Put them on the website now" is ticked. A file that fails is listed; the rest go on.
   make = "Add section": the section's name comes first and the PDFs are optional. */
function BulkUpload({ make, cls, section, sections, classes, subjects, subjectList, startSubject, onSaved, onMade, onSection, onClose }) {
  const { can, toast } = useDash();
  const canPrice = can('pricing.write');
  const input = useRef(null);
  const [files, setFiles] = useState([]);
  const [over, setOver] = useState(false);
  const [subject, setSubject] = useState(startSubject || subjects[0] || '');
  const [secName, setSecName] = useState(section ? section.label : '');
  const [free, setFree] = useState(false), [price, setPrice] = useState('19');
  const [publish, setPublish] = useState(false);
  const [busy, setBusy] = useState(false), [err, setErr] = useState(null);
  const [done, setDone] = useState({});   /* file name → 'ok' | error text | 'working' */
  const [bad, setBad] = useState(''), [made, setMade] = useState(null);   /* "Add section": the name's problem, the section once made */
  const classSecs = sectionsOfClass(sections, cls.id);
  const add = list => {
    const fs = Array.from(list || []);
    const good = fs.filter(f => isPdf(f) && f.size <= PDF_MAX);
    if (good.length !== fs.length) toast('Some files were skipped: only PDFs up to 40 MB.');
    setFiles(cur => cur.concat(good.filter(f => !cur.some(c => c.name === f.name && c.size === f.size))).slice(0, 50));
  };
  const finished = files.length > 0 && files.every(f => done[f.name] === 'ok');
  const submit = async () => {
    if (finished) { onClose(); return; }
    if (make && !secName.trim()) { setBad('Type a name for the section.'); return; }
    if (make && !made && classSecs.some(x => sameName(x.label, secName))) { setBad(cls.name + ' already has a section called "' + secName.trim() + '".'); return; }
    if (!make && !files.length) { setErr('Choose the PDFs first.'); return; }
    if (!subject.trim()) { setErr('Pick or type a subject.'); return; }
    const p = free ? 0 : Number(price);
    if (canPrice && !free && !(Number.isInteger(p) && p >= 0)) { setErr('Enter the price in whole rupees.'); return; }
    setBusy(true); setErr(null); setBad('');
    let place;
    try { place = await ensurePlace({ classes, subjects: subjectList, sections: made ? sections.concat(made) : sections, cls: cls.id, subject, section: secName }, onMade); }
    catch (x) { setErr(problem(x)); setBusy(false); return; }
    if (make && place.section && !made) { setMade(place.section); if (onSection) onSection(place.section.id); }
    if (!files.length) { setBusy(false); toast('Section "' + place.section.label + '" added. Add its sheets any time.'); onClose(); return; }
    let ok = 0;
    for (const f of files) {
      if (done[f.name] === 'ok') continue;
      setDone(d => ({ ...d, [f.name]: 'working' }));
      try {
        const body = { title: titleFromFile(f.name), cls: place.cls, subject: place.subject, ...sectionFields(place.section) };
        if (canPrice) body.price = p;
        const ws = (await staffApi('POST', '/api/admin/worksheets', body)).worksheet;
        try { onSaved((await sendRaw('/api/admin/worksheets/' + encodeURIComponent(ws.id) + '/file' + (publish ? '?publish=1' : ''), f)).worksheet); }
        catch (x) { onSaved(ws); throw Object.assign(x, { pdf: true }); }
        ok++; setDone(d => ({ ...d, [f.name]: 'ok' }));
      } catch (x) {
        setDone(d => ({ ...d, [f.name]: x.pdf ? 'Saved as a draft, but the PDF did not upload: ' + uploadProblem(x, 'pdf') : problem(x) }));
      }
    }
    setBusy(false);
    toast(plural(ok, 'sheet') + ' added' + (publish ? ' to the website.' : ' as drafts.'));
  };
  const drag = on => e => { e.preventDefault(); if (!busy) setOver(on); };
  return (
    <Modal title={(make ? 'Add a section to ' : 'Upload PDFs to ') + cls.name} onClose={onClose} onSubmit={submit} wide busy={busy} error={err}
      submitLabel={finished ? 'Done' : make ? (files.length ? 'Add section with ' + plural(files.length, 'PDF') : 'Add section') : files.length ? 'Upload ' + plural(files.length, 'PDF') : 'Upload'}
      busyLabel={files.length ? 'Uploading…' : 'Saving…'} cancelLabel={finished ? 'Close' : 'Cancel'}>
      <div>
        {make ? <div className="field big"><label htmlFor="buName">Section name</label><input id="buName" value={secName} onChange={e => { setSecName(e.target.value); setBad(''); }} disabled={busy || !!made} maxLength={60} placeholder="e.g. Story time" autoComplete="off" aria-invalid={!!bad} data-autofocus />
          {bad ? <small className="bad">{bad}</small> : <small>Shown on the website as a shelf in {cls.name}.</small>}</div> : null}
        {make ? <p className="field-title">Its PDFs <small className="muted">(optional, you can add them later)</small></p> : null}
        <div className={'drop small' + (over ? ' over' : '')} role="button" tabIndex={0} aria-label="Choose the PDFs"
          onClick={() => !busy && input.current.click()} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (!busy) input.current.click(); } }}
          onDragEnter={drag(true)} onDragOver={drag(true)} onDragLeave={drag(false)} onDrop={e => { e.preventDefault(); setOver(false); if (!busy) add(e.dataTransfer.files); }}>
          <input ref={input} type="file" multiple accept="application/pdf,.pdf" hidden onChange={e => { add(e.target.files); e.target.value = ''; }} />
          <div className="drop-preview"><span className="drop-icon"><Icon id="download" size={24} /></span><b>Drop the PDFs here</b><small>or click to choose · up to 50 at a time · 40 MB each</small></div>
        </div>
        {files.length ? <ul className="bulk-list">{files.map(f => {
          const st = done[f.name];
          return <li key={f.name + f.size}><span><b>{titleFromFile(f.name)}</b><small>{f.name} · {size(f.size)}</small></span>
            {st === 'ok' ? <Pill tone="ok">Added</Pill> : st === 'working' ? <Pill tone="info">Uploading…</Pill> : st ? <small className="bad">{st}</small>
              : busy ? null : <button type="button" className="link danger" onClick={() => setFiles(l => l.filter(x => x !== f))}>Remove</button>}</li>;
        })}</ul> : null}
        <div className="grid-3">
          <div className="field"><label htmlFor="buSubj">Subject</label><input id="buSubj" list="buSubjList" value={subject} onChange={e => setSubject(e.target.value)} disabled={busy} maxLength={40} autoComplete="off" />
            <datalist id="buSubjList">{subjects.map(x => <option key={x} value={x} />)}</datalist></div>
          {make ? null : <div className="field"><label htmlFor="buSec">Section</label><input id="buSec" list="buSecList" value={secName} onChange={e => setSecName(e.target.value)} disabled={busy} maxLength={60} placeholder="Pick or type a new one" autoComplete="off" />
            <datalist id="buSecList">{classSecs.map(x => <option key={x.id} value={x.label} />)}</datalist>
            <small>{secName.trim() && !classSecs.some(x => sameName(x.label, secName)) ? 'A new section is made.' : ''}</small></div>}
          <div className="field"><label htmlFor="buPrice">Price ₹ each</label><input id="buPrice" type="number" min="0" step="1" value={free ? '0' : price} onChange={e => setPrice(e.target.value)} disabled={busy || free || !canPrice} />
            <label className="check"><input type="checkbox" checked={free} onChange={e => setFree(e.target.checked)} disabled={busy || !canPrice} />Free</label></div>
        </div>
        <label className="check"><input type="checkbox" checked={publish} onChange={e => setPublish(e.target.checked)} disabled={busy} />Put them on the website now</label>
        <small className="muted">{publish ? 'Each sheet goes on the website as soon as its PDF is uploaded.' : 'They are saved as drafts, so nothing shows on the website until you publish them. You can add covers and change titles after.'}</small>
      </div>
    </Modal>
  );
}
