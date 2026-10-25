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
let keepCls = null, keepSubject = 'all';

/* Sheets by class and section: pick a class (or add one), a subject (or add one), and see every
   section with its sheets. Open any sheet to change it, add one sheet to a section, or drop
   many PDFs on a section at once. */
export default function SheetBrowser({ all, classes, sections, subjectList, onEdit, onNew, onSaved, onMade }) {
  const { can, toast } = useDash();
  const canWrite = can('catalogue.write'), canUpload = can('files.upload');
  const [cls, setClsState] = useState(() => (keepCls && classes.some(c => c.id === keepCls) ? keepCls : (classes[0] && classes[0].id) || 'kg'));
  const [subject, setSubjectState] = useState(keepSubject);
  const setCls = v => { keepCls = v; setClsState(v); };
  const setSubject = v => { keepSubject = v; setSubjectState(v); };
  const [dialog, setDialog] = useState(null);   /* { kind: 'class' | 'subject' | 'section' | 'rename' | 'bulk', section? } */
  const [open, setOpen] = useState(() => new Set());
  const [busy, setBusy] = useState(false);
  const cur = classes.find(c => c.id === cls) || classes[0] || { id: cls, name: cls, status: 'available' };

  const inClass = useMemo(() => all.filter(s => s.cls === cur.id), [all, cur.id]);
  const subjects = useMemo(() => [...new Set((subjectList || []).filter(x => x.active).map(x => x.name).concat(inClass.map(s => s.subject).filter(Boolean)))], [subjectList, inClass]);
  const shown = subject === 'all' ? inClass : inClass.filter(s => s.subject === subject);
  /* this class's sections, by their group (Alphabet, Vocabulary …), then "No section" */
  const groups = useMemo(() => {
    const secs = sectionsOfClass(sections, cur.id).slice().sort((a, b) => (a.sort - b.sort) || a.label.localeCompare(b.label));
    const ids = new Set(secs.map(x => x.id));
    /* a sheet whose section belongs to another class still shows here */
    shown.forEach(s => { if (s.section && !ids.has(s.section)) { ids.add(s.section); secs.push({ id: s.section, label: s.sectionLabel || s.section, group: s.group, groupLabel: '', cls: cur.id, products: 0 }); } });
    const m = new Map();
    secs.forEach(x => {
      const list = shown.filter(s => s.section === x.id);
      if (subject !== 'all' && !list.length) return;
      const g = x.groupLabel || (x.builtin ? 'Other topics' : 'Your sections');
      if (!m.has(g)) m.set(g, []);
      m.get(g).push({ ...x, list });
    });
    const none = shown.filter(s => !s.section);
    if (none.length) m.set('Not in a section', [{ id: '', label: 'Class shelf only', list: none }]);
    return [...m.entries()];
  }, [sections, shown, cur.id, subject]);

  const toggle = id => setOpen(o => { const n = new Set(o); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const setStatus = async st => {
    setBusy(true);
    try { onMade('classes', await staffApi('PUT', '/api/admin/classes', { classes: [{ id: cur.id, status: st }] })); toast(cur.name + ': ' + CLASS_STATUS.find(x => x[0] === st)[1] + ' on the website.'); }
    catch (e) { toast(problem(e)); }
    setBusy(false);
  };
  const preset = x => ({ cls: cur.id, subject: subject !== 'all' ? subject : '', sectionLabel: x && x.id ? x.label : '' });

  return (
    <section className="panel browser" aria-label="Sheets by class and section">
      <div className="row-between"><div><p className="eyebrow">Sheets by class and section</p>
        <p className="auth-sub">Pick a class and a subject. Open a section to see its sheets, then click a sheet to change it.</p></div></div>
      <div className="chips" role="group" aria-label="Class">
        {classes.map(c => <button key={c.id} type="button" className={'chip' + (c.id === cur.id ? ' on' : '')} aria-pressed={c.id === cur.id} onClick={() => setCls(c.id)}>{c.name} <small>{all.filter(s => s.cls === c.id).length}</small></button>)}
        {canWrite ? <button type="button" className="chip add" onClick={() => setDialog({ kind: 'class' })}><Icon id="plus" size={14} />New class</button> : null}
      </div>
      <div className="browser-class">
        <b>{cur.name}</b>
        {canWrite ? <label className="inline-field"><span className="muted">On the website</span>
          <select value={cur.status} disabled={busy} onChange={e => setStatus(e.target.value)} aria-label={cur.name + ' on the website'}>{CLASS_STATUS.map(([id, n]) => <option key={id} value={id}>{n}</option>)}</select></label>
          : <Pill>{(CLASS_STATUS.find(x => x[0] === cur.status) || [])[1]}</Pill>}
        {cur.status !== 'available' ? <small className="muted">Customers can't buy this class's sheets until it is Open.</small> : null}
      </div>
      <div className="chips" role="group" aria-label="Subject">
        <button type="button" className={'chip' + (subject === 'all' ? ' on' : '')} onClick={() => setSubject('all')}>Every subject <small>{inClass.length}</small></button>
        {subjects.map(x => <button key={x} type="button" className={'chip' + (subject === x ? ' on' : '')} onClick={() => setSubject(x)}>{x} <small>{inClass.filter(s => s.subject === x).length}</small></button>)}
        {canWrite ? <button type="button" className="chip add" onClick={() => setDialog({ kind: 'subject' })}><Icon id="plus" size={14} />New subject</button> : null}
      </div>
      {canWrite ? <div className="btn-row browser-actions">
        <button type="button" className="btn btn-primary" onClick={() => setDialog({ kind: 'section' })}><Icon id="plus" />New section in {cur.name}</button>
        {canUpload ? <button type="button" className="btn btn-ghost" onClick={() => setDialog({ kind: 'bulk', section: null })}><Icon id="download" />Upload many PDFs</button> : null}
      </div> : null}
      {groups.length ? groups.map(([g, list]) => <div key={g}>
        <p className="sec-group">{g}</p>
        <div className="sec-list">{list.map(x => {
          const isOpen = open.has(x.id) || list.length === 1 && groups.length === 1;
          return (
            <div key={x.id || 'none'} className={'browse-sec' + (isOpen ? ' open' : '')} data-section={x.id || 'none'}>
              <div className="browse-head">
                <button type="button" className="browse-toggle" aria-expanded={isOpen} onClick={() => toggle(x.id)}>
                  <span className="browse-caret" aria-hidden="true">{isOpen ? '▾' : '▸'}</span><b>{x.label}</b>
                  <small>{plural(x.list.length, 'sheet')}{x.visible === false ? ' · hidden on the website' : ''}</small></button>
                {canWrite && x.id ? <span className="btn-row">
                  <button type="button" className="link" onClick={() => onNew(preset(x))}>Add a sheet</button>
                  {canUpload ? <button type="button" className="link" onClick={() => setDialog({ kind: 'bulk', section: x })}>Upload PDFs</button> : null}
                  <button type="button" className="link" onClick={() => setDialog({ kind: 'rename', section: x })}>Rename</button>
                </span> : null}
              </div>
              {isOpen ? (x.list.length ? <ul className="browse-sheets">{x.list.map(s => {
                const vis = visibilityOf(s);
                return <li key={s.id}><button type="button" className="browse-sheet" onClick={() => onEdit(s.id)} aria-label={(canWrite ? 'Edit ' : 'Open ') + s.title}>
                  <span className="browse-thumb" style={s.thumb ? { backgroundImage: 'url("' + s.thumb + '")' } : undefined} aria-hidden="true" />
                  <span className="browse-title"><b>{s.title}</b><small>{s.subject} · {s.pages} pg · {s.available ? 'PDF ' + size(s.pdfBytes) : 'No PDF yet'}</small></span>
                  <Pill tone={VISIBILITY_TONE[vis]}>{VIS_LABEL[vis]}</Pill>
                  <span className="browse-price">{s.price === 0 ? 'Free' : inr(s.price)}</span>
                  <span className="link">{canWrite ? 'Edit' : 'Open'}</span>
                </button></li>;
              })}</ul> : <p className="cart-empty">No sheets here yet.{canWrite ? ' Use "Add a sheet" or "Upload PDFs".' : ''}</p>) : null}
            </div>
          );
        })}</div>
      </div>) : <p className="cart-empty">{subject === 'all' ? 'No sections in ' + cur.name + ' yet.' : 'No ' + subject + ' sheets in ' + cur.name + ' yet.'}{canWrite ? ' Add a section to start.' : ''}</p>}

      {dialog && dialog.kind === 'class' ? <NameDialog title="Add a class" label="Class name" placeholder="e.g. Class 4" note='It shows as "Coming soon" on the website until you set it to Open.'
        onClose={() => setDialog(null)} onSave={async name => {
          if (classes.some(c => sameName(c.name, name))) throw Object.assign(new Error('There is already a class with that name.'), { field: true });
          const r = await ensurePlace({ classes, newClass: name }, onMade);
          setCls(r.cls); setSubject('all'); toast(name + ' added.');
        }} /> : null}
      {dialog && dialog.kind === 'subject' ? <NameDialog title="Add a subject" label="Subject name" placeholder="e.g. Hindi"
        onClose={() => setDialog(null)} onSave={async name => {
          const r = await ensurePlace({ subjects: subjectList, subject: name }, onMade);
          setSubject(r.subject); toast(r.subject + ' is ready. Pick it on a sheet.');
        }} /> : null}
      {dialog && dialog.kind === 'section' ? <NameDialog title={'New section in ' + cur.name} label="Section name" placeholder="e.g. Story time"
        onClose={() => setDialog(null)} onSave={async name => {
          if (sectionsOfClass(sections, cur.id).some(x => sameName(x.label, name))) throw Object.assign(new Error(cur.name + ' already has a section with that name.'), { field: true });
          const r = await ensurePlace({ sections, cls: cur.id, section: name }, onMade);
          setOpen(o => new Set(o).add(r.section.id)); setSubject('all'); toast('Section added. Add its sheets now.');
        }} /> : null}
      {dialog && dialog.kind === 'rename' ? <NameDialog title="Rename section" label="Section name" start={dialog.section.label}
        onClose={() => setDialog(null)} onSave={async name => {
          onMade('sections', await staffApi('PUT', '/api/admin/sections/' + encodeURIComponent(dialog.section.id), { label: name }));
          toast('Renamed.');
        }} /> : null}
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
   as drafts unless "Put them on the website now" is ticked. A file that fails is listed; the rest go on. */
function BulkUpload({ cls, section, sections, classes, subjects, subjectList, startSubject, onSaved, onMade, onClose }) {
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
    if (!files.length) { setErr('Choose the PDFs first.'); return; }
    if (!subject.trim()) { setErr('Pick or type a subject.'); return; }
    const p = free ? 0 : Number(price);
    if (canPrice && !free && !(Number.isInteger(p) && p >= 0)) { setErr('Enter the price in whole rupees.'); return; }
    setBusy(true); setErr(null);
    let place;
    try { place = await ensurePlace({ classes, subjects: subjectList, sections, cls: cls.id, subject, section: secName }, onMade); }
    catch (x) { setErr(problem(x)); setBusy(false); return; }
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
    <Modal title={'Upload PDFs to ' + cls.name} onClose={onClose} onSubmit={submit} wide busy={busy} error={err}
      submitLabel={finished ? 'Done' : files.length ? 'Upload ' + plural(files.length, 'PDF') : 'Upload'} busyLabel="Uploading…" cancelLabel={finished ? 'Close' : 'Cancel'}>
      <div>
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
          <div className="field"><label htmlFor="buSec">Section</label><input id="buSec" list="buSecList" value={secName} onChange={e => setSecName(e.target.value)} disabled={busy} maxLength={60} placeholder="Pick or type a new one" autoComplete="off" />
            <datalist id="buSecList">{classSecs.map(x => <option key={x.id} value={x.label} />)}</datalist>
            <small>{secName.trim() && !classSecs.some(x => sameName(x.label, secName)) ? 'A new section is made.' : ''}</small></div>
          <div className="field"><label htmlFor="buPrice">Price ₹ each</label><input id="buPrice" type="number" min="0" step="1" value={free ? '0' : price} onChange={e => setPrice(e.target.value)} disabled={busy || free || !canPrice} />
            <label className="check"><input type="checkbox" checked={free} onChange={e => setFree(e.target.checked)} disabled={busy || !canPrice} />Free</label></div>
        </div>
        <label className="check"><input type="checkbox" checked={publish} onChange={e => setPublish(e.target.checked)} disabled={busy} />Put them on the website now</label>
        <small className="muted">{publish ? 'Each sheet goes on the website as soon as its PDF is uploaded.' : 'They are saved as drafts, so nothing shows on the website until you publish them. You can add covers and change titles after.'}</small>
      </div>
    </Modal>
  );
}
