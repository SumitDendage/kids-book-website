import { useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../../components/dashboard/Icon.jsx';
import Pill from '../../components/dashboard/Pill.jsx';
import Modal from '../../components/dashboard/Modal.jsx';
import { useDash } from '../Portal/DashContext.js';
import { size, dateOnly, problem, fieldErrors, plural } from '../Portal/dashboard.js';
import { staffApi, staffFetch } from '../../services/api.js';
import { SHEET_STATUS_LABEL, SHEET_TONE, LABELS, HOME_TAG, visibilityOf, localInput, fromLocalInput } from './common.js';
import { ensurePlace, sectionFields, sectionsOfClass, sameName } from './place.js';

const PDF_MAX = 40 * 1024 * 1024, IMAGE_MAX = 5 * 1024 * 1024;
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

/* sends one file as the raw request body (the server reads PDFs and pictures this way) */
export async function sendRaw(path, file) {
  const r = await staffFetch(path, { method: 'POST', headers: { 'Content-Type': file.type || 'application/octet-stream' }, body: file });
  let b = {}; try { b = await r.json(); } catch (_) { /* not JSON */ }
  if (!r.ok) throw Object.assign(new Error(String(b.error || 'The upload did not work.').replace(/\s+—\s+/g, ', ')), { status: r.status, code: b.code || null, body: b });
  return b;
}
/* upload problems in plain words */
export function uploadProblem(e, what) {
  if (e.status === 413 || e.code === 'too_large') return what === 'pdf' ? 'That PDF is too big. A PDF can be up to 40 MB.' : 'That picture is too big. A picture can be up to 5 MB.';
  if (e.code === 'not_pdf') return 'That file is not a PDF.';
  if (e.code === 'pdf_incomplete') return 'The PDF looks incomplete. Please upload it again.';
  if (e.code === 'bad_image') return 'Use a JPG, PNG or WebP picture (5 MB at most).';
  return problem(e);
}

/* a drop zone for the cover picture or the PDF: click to choose, or drag a file on it. The box keeps
   its size while a file is dragged over it (a count of enter and leave, so passing over its own
   text does not make it flicker), and once a file is there it folds into one short line: a small
   picture, the file's name and "Change" (Sumit, Oct 28). */
function Drop({ kind, current, picked, onPick, toast, disabled }) {
  const input = useRef(null);
  const depth = useRef(0);
  const [over, setOver] = useState(false);
  const accept = f => {
    if (!f) return;
    const ok = kind === 'image' ? IMAGE_TYPES.includes(f.type) : (f.type === 'application/pdf' || /\.pdf$/i.test(f.name));
    if (!ok) { toast(kind === 'image' ? 'Choose a JPG, PNG or WebP picture' : 'Choose a PDF file'); return; }
    if (f.size > (kind === 'image' ? IMAGE_MAX : PDF_MAX)) { toast(kind === 'image' ? 'That picture is over 5 MB' : 'That PDF is over 40 MB'); return; }
    onPick(f);
  };
  const enter = e => { e.preventDefault(); if (disabled) return; depth.current += 1; setOver(true); };
  const leave = e => { e.preventDefault(); depth.current = Math.max(0, depth.current - 1); if (!depth.current) setOver(false); };
  const url = kind === 'image' ? (picked ? picked.url : current) : null;
  const has = !!(picked || current);
  const zone = {
    className: 'drop' + (kind === 'pdf' ? ' small' : '') + (has ? ' compact' : '') + (over ? ' over' : '') + (disabled ? ' off' : ''), 'data-drop': kind, role: 'button', tabIndex: disabled ? -1 : 0, 'aria-disabled': disabled || undefined,
    onClick: e => { if (!disabled && !e.target.closest('input')) input.current.click(); },
    onKeyDown: e => { if (!disabled && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); input.current.click(); } },
    onDragEnter: enter, onDragOver: e => { e.preventDefault(); if (disabled) e.dataTransfer.dropEffect = 'none'; }, onDragLeave: leave,
    onDrop: e => { e.preventDefault(); depth.current = 0; setOver(false); if (!disabled) accept(e.dataTransfer.files[0]); },
    'aria-label': kind === 'image' ? 'Choose the cover picture' : 'Choose the PDF',
  };
  const pick = <input ref={input} type="file" accept={kind === 'image' ? IMAGE_TYPES.join(',') : 'application/pdf,.pdf'} hidden onChange={e => { accept(e.target.files[0]); e.target.value = ''; }} />;
  if (has) {
    const name = picked ? picked.file.name : kind === 'image' ? 'Cover picture' : 'PDF attached';
    const note = picked ? size(picked.file.size) + ' · uploads when you save' : kind === 'pdf' && current ? current : '';
    return (
      <div {...zone}>{pick}
        <span className={'drop-thumb' + (url ? '' : ' icon')} style={url ? { backgroundImage: 'url("' + url + '")' } : undefined} aria-hidden="true">{url ? null : <Icon id={kind === 'image' ? 'image' : 'file'} size={20} />}</span>
        <span className="drop-line"><b>{over ? 'Drop to replace it' : name}</b>{note ? <small>{note}</small> : null}</span>
        {disabled ? null : <span className="drop-change">Change</span>}
      </div>
    );
  }
  return (
    <div {...zone}>{pick}
      <div className="drop-preview"><span className="drop-icon"><Icon id={kind === 'image' ? 'image' : 'file'} size={kind === 'image' ? 28 : 24} /></span>
        <b>{over ? 'Drop it here' : kind === 'image' ? 'Drop the cover picture here' : 'Drop the PDF here'}</b>
        <small>{kind === 'image' ? 'or click to choose · JPG, PNG or WebP · up to 5 MB' : 'or click to choose · up to 40 MB'}</small></div>
    </div>
  );
}

/* "Upload new book" / "Edit book": cover and PDF, page pictures, details, where it goes, price,
   access and limits. Saved on the server: a new sheet starts as a draft and goes on sale once its
   PDF is uploaded. The class, subject and section can be picked or typed new (made on save).
   preset = { cls, subject, section } for a new sheet started from a section. */
export default function ProductStudio({ sheet, preset, all, classes, sections, subjectList, onSaved, onMade, onClose }) {
  const { toast, can, setEditing } = useDash();
  /* a file dropped beside a drop box must not open in the browser and leave the form */
  useEffect(() => {
    const stop = e => { if (!(e.target.closest && e.target.closest('.drop')) && e.dataTransfer && [...e.dataTransfer.types].includes('Files')) { e.preventDefault(); e.dataTransfer.dropEffect = 'none'; } };
    addEventListener('dragover', stop); addEventListener('drop', stop);
    return () => { removeEventListener('dragover', stop); removeEventListener('drop', stop); };
  }, []);
  const it = sheet || {};
  const isNew = !sheet;
  const canWrite = can('catalogue.write'), canPrice = can('pricing.write'), canUpload = can('files.upload');
  const [cover, setCover] = useState(null);       /* { file, url } */
  const [pdf, setPdf] = useState(null);           /* { file } */
  const [pagePics, setPagePics] = useState([]);   /* File[] */
  const [firstPage, setFirstPage] = useState(1);
  const [donePages, setDonePages] = useState(null);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState(null), [errs, setErrs] = useState({});
  const [dialog, setDialog] = useState(null);     /* 'archive' | 'restore' | 'delete' */
  /* price: original price, discount and selling price work each other out; Free makes it 0 */
  const startPrice = it.price == null ? 19 : it.price;
  const [free, setFree] = useState(startPrice === 0);
  const [orig, setOrig] = useState(it.wasPrice != null && it.wasPrice > startPrice ? String(it.wasPrice) : '');
  const [sell, setSell] = useState(String(startPrice === 0 ? (it.wasPrice || 19) : startPrice));
  const [pct, setPct] = useState(it.wasPrice > startPrice && startPrice > 0 ? String(Math.round((1 - startPrice / it.wasPrice) * 100)) : '');
  const num = v => (String(v).trim() === '' ? null : Number(v));
  const onOrig = v => { setOrig(v); const o = num(v), d = num(pct); if (o != null && d != null && d >= 0 && d <= 100) setSell(String(Math.round(o * (1 - d / 100)))); };
  const onPct = v => { setPct(v); const o = num(orig), d = num(v); if (o != null && d != null && d >= 0 && d <= 100) setSell(String(Math.round(o * (1 - d / 100)))); };
  const onSell = v => { setSell(v); const o = num(orig), x = num(v); setPct(o && x != null && o > x ? String(Math.round((1 - x / o) * 100)) : ''); };
  const finalPrice = free ? 0 : num(sell);
  const origPrice = num(orig);
  /* where and when it shows */
  /* no Visibility box (Sumit, Oct 27): a new sheet goes on the website once its PDF is there, and
     a saved sheet keeps how it shows now (Hide and Restore change that). Access days, prints and
     downloads come from Settings; a sheet that already has its own numbers keeps them. */
  const vis = isNew ? 'published' : visibilityOf(it);
  const [when] = useState(it.publishAt && it.publishAt > Date.now() ? localInput(it.publishAt) : localInput(Date.now() + 86400000));
  const [labels, setLabels] = useState(() => new Set((it.tags || []).filter(t => LABELS.some(([x]) => x === t) || t === HOME_TAG)));
  const toggleLabel = t => setLabels(cur => { const n = new Set(cur); if (n.has(t)) n.delete(t); else n.add(t); return n; });
  /* where it goes: a class (or a new one), a subject and a section, picked or typed */
  const start = isNew ? (preset || {}) : {};
  const [cls, setCls] = useState(it.cls || start.cls || (classes[0] && classes[0].id) || 'kg');
  const [newClass, setNewClass] = useState('');
  const startSec = it.section ? (it.sectionLabel || ((sections || []).find(x => x.id === it.section) || {}).label || it.section) : (start.sectionLabel || '');
  const [secName, setSecName] = useState(startSec);
  /* live preview of the shop card */
  const [look, setLook] = useState({ title: it.title || '', short: it.shortDescription || '' });

  /* the subjects and shelf topics already in the shop, to pick from */
  /* subjects come from Categories → Subjects; the sheets' own subjects if that list could not load */
  const subjects = useMemo(() => {
    const list = subjectList && subjectList.length ? subjectList.filter(x => x.active).map(x => x.name) : [...new Set((all || []).map(s => s.subject).filter(Boolean))];
    if (it.subject && !list.includes(it.subject)) list.push(it.subject);
    return list;
  }, [subjectList, all, it.subject]);
  /* the prints each account type gets (Settings → Prints per sheet), as the server worked them out for a sheet that follows the account type */
  /* the sections of the chosen class, to pick from (a new class has none yet) */
  const classSections = useMemo(() => (newClass ? [] : sectionsOfClass(sections, cls)).slice().sort((a, b) => a.label.localeCompare(b.label)), [sections, cls, newClass]);
  const secIsNew = !!secName.trim() && !classSections.some(x => sameName(x.label, secName)) && !(it.section && sameName(secName, startSec));

  const pickCover = f => { const r = new FileReader(); r.onload = () => setCover({ file: f, url: r.result }); r.readAsDataURL(f); };
  const v = k => (it[k] == null ? '' : it[k]);
  const err1 = k => (errs[k] ? <small className="bad">{errs[k]}</small> : null);

  /* the form's values as the server's fields; prices only for staff who may change them */
  function fieldsOf(form) {
    const f = new FormData(form), n = k => { const s = String(f.get(k) ?? '').trim(); return s === '' ? null : Number(s); };
    const body = {
      title: String(f.get('title') || '').trim(),
      description: String(f.get('description') || '').trim(),
      cls,
      subject: String(f.get('subject') || '').trim(),
      pages: n('pages') || 1,
      audience: f.get('audience') || null,
      landscape: f.get('landscape') === 'on',
      /* the labels ticked below; any older words on the sheet are kept as they were */
      tags: [...new Set((it.tags || []).filter(t => !LABELS.some(([x]) => x === t) && t !== HOME_TAG).concat([...labels]))],
      shortDescription: String(f.get('shortDescription') || '').trim(),
      language: String(f.get('language') || '').trim() || 'English',
    };
    if (canPrice) { body.price = finalPrice ?? 0; body.wasPrice = !free && origPrice != null && origPrice > (finalPrice ?? 0) ? origPrice : null; }
    return body;
  }

  const submit = async e => {
    e.preventDefault();
    const sub = e.nativeEvent && e.nativeEvent.submitter;
    const publish = !!(sub && sub.value === 'publish');
    const form = e.currentTarget;
    const body = fieldsOf(form);
    if (canWrite && !body.title) { setErrs({ title: 'Give the sheet a title.' }); return; }
    if (canWrite && !body.subject) { setErrs({ subject: 'Give the sheet a subject.' }); return; }
    if (canWrite && cls === '+new' && !newClass.trim()) { setErrs({ cls: 'Type the name of the new class, e.g. Class 4.' }); return; }
    if (canWrite && canPrice && !free && (finalPrice == null || !(finalPrice >= 0) || !Number.isInteger(finalPrice))) { setErrs({ price: 'Enter the selling price in whole rupees.' }); return; }
    if (canWrite && canPrice && pct !== '' && !(num(pct) >= 0 && num(pct) <= 100)) { setErrs({ pct: 'A discount is from 0 to 100%.' }); return; }
    if (canWrite && vis === 'scheduled' && !(fromLocalInput(when) > Date.now())) { setErrs({ publishAt: 'Pick a time in the future.' }); return; }
    setErr(null); setErrs({});
    let ws = sheet || null, step = '';
    const notes = [];
    try {
      if (canWrite) {
        step = 'details'; setBusy('Saving…');
        /* a new class, subject or section is made first */
        const sameSec = !isNew && it.section && cls === it.cls && sameName(secName, startSec);
        const place = await ensurePlace({ classes, subjects: subjectList, sections, cls: cls === '+new' ? '' : cls, newClass: cls === '+new' ? newClass : '', subject: body.subject, section: sameSec ? '' : secName }, onMade);
        if (cls === '+new') { setCls(place.cls); setNewClass(''); }
        /* the sheet's own section stays when its name was not changed */
        const keepSec = !isNew && it.section && place.cls === it.cls && sameName(secName, startSec) ? { id: it.section, group: it.group, label: it.sectionLabel || startSec } : null;
        Object.assign(body, { cls: place.cls, subject: place.subject }, sectionFields(keepSec || place.section));
        setBusy(isNew ? 'Saving the draft…' : 'Saving…');
        ws = (isNew ? await staffApi('POST', '/api/admin/worksheets', body) : await staffApi('PUT', '/api/admin/worksheets/' + encodeURIComponent(it.id), body)).worksheet;
      }
      const base = '/api/admin/worksheets/' + encodeURIComponent(ws.id);
      if (canUpload && cover) { step = 'cover'; setBusy('Uploading the cover…'); ws = (await sendRaw(base + '/cover', cover.file)).worksheet; setCover(null); }
      if (canUpload && pdf) {
        step = 'pdf'; setBusy('Uploading the PDF…');
        const r = await sendRaw(base + '/file' + (publish && canWrite ? '?publish=1' : ''), pdf.file);
        ws = r.worksheet; setPdf(null);
        notes.push(r.pagesCounted ? 'The PDF has ' + plural(ws.pages, 'page') + '.' : 'We could not count the pages, so the page count stays as it was.');
      }
      if (canUpload && pagePics.length) {
        step = 'pages'; let last = null;
        for (let i = 0; i < pagePics.length; i++) {
          setBusy('Uploading page picture ' + (i + 1) + ' of ' + pagePics.length + '…');
          last = await sendRaw(base + '/pages/' + (Number(firstPage) + i), pagePics[i]);
        }
        setPagePics([]); if (last) setDonePages(last.pages || []);
      }
      /* visibility last: a sheet goes on sale only once its PDF is there */
      const want = publish ? 'published' : vis;
      if (canWrite && want !== visibilityOf(ws) && !(want === 'published' && !ws.available)) {
        step = 'publish'; setBusy(want === 'hidden' ? 'Hiding it…' : want === 'draft' ? 'Taking it off the shop…' : 'Publishing…');
        const v = { draft: { status: 'draft' }, published: { status: 'active', publishAt: null }, scheduled: { status: 'active', publishAt: new Date(fromLocalInput(when)).toISOString() }, hidden: { status: 'archived' } }[want];
        ws = (await staffApi('PUT', base, v)).worksheet;
      } else if (canWrite && want === 'scheduled' && ws.publishAt !== fromLocalInput(when)) {
        step = 'publish'; setBusy('Saving the publish time…');
        ws = (await staffApi('PUT', base, { publishAt: new Date(fromLocalInput(when)).toISOString() })).worksheet;
      }
      setBusy('');
      onSaved(ws);
      const what = ws.scheduled ? 'Saved. It goes on the website on ' + new Date(ws.publishAt).toLocaleString() + '.' : ws.status === 'active' ? (isNew || sheet.status !== 'active' ? 'It is on the website now.' : 'Saved. The website shows the change.') : ws.status === 'draft' ? 'Saved as a draft (not on the website).' : ws.status === 'archived' ? 'Saved. It is hidden from the website.' : 'Saved.';
      toast([what].concat(notes).join(' '));
      if (isNew) setEditing(ws.id); else onClose();
    } catch (x) {
      setBusy('');
      if (ws && ws !== sheet) onSaved(ws);   /* the parts that worked are kept */
      const fe = fieldErrors(x);
      if (step === 'details' && Object.keys(fe).length) setErrs(fe);
      if (x.code === 'pdf_missing') setErr('Upload the PDF before publishing this sheet. It was saved as a draft.');
      else if (step === 'cover' || step === 'pdf' || step === 'pages') setErr((isNew && ws ? 'The sheet was saved as a draft, but ' : '') + (step === 'pdf' ? 'the PDF' : step === 'cover' ? 'the cover' : 'a page picture') + ' did not upload: ' + uploadProblem(x, step === 'pdf' ? 'pdf' : 'image'));
      else setErr(Object.keys(fe).length ? 'Please check the fields marked in red.' : problem(x));
      if (isNew && ws) setEditing(ws.id);
    }
  };

  /* a copy as a new draft (no PDF, labels, pictures or SKU), opened for editing */
  const duplicate = async () => {
    setBusy('Making a copy…'); setErr(null);
    try { const ws = (await staffApi('POST', '/api/admin/worksheets/' + encodeURIComponent(it.id) + '/duplicate')).worksheet; setBusy(''); onSaved(ws); toast('Copied as a draft. Add its PDF before publishing.'); setEditing(ws.id); }
    catch (x) { setBusy(''); setErr(problem(x)); }
  };

  const hasPdf = !!it.available || !!pdf;
  const status = it.status || 'draft';
  const rating = it.reviewCount ? it.reviewAvg : it.rating;
  const ratingCount = it.reviewCount || it.ratingCount || 0;
  const lockAll = !canWrite;

  return (
    <section className="panel studio" aria-label={isNew ? 'Upload new book' : 'Edit ' + it.title}>
      <div className="row-between"><div><p className="eyebrow">{isNew ? 'Upload new book' : canWrite ? 'Edit book' : 'Book'}</p>
        <p className="auth-sub">{isNew ? 'Drop the PDF and the cover, give it a title, pick or type its section, then save.' : it.title}</p></div>
        <button type="button" className="icon-btn" aria-label="Close" onClick={onClose} disabled={!!busy}><Icon id="x" /></button></div>
      {!isNew ? <div className="studio-status">
        <Pill tone={SHEET_TONE[status]}>{SHEET_STATUS_LABEL[status]}</Pill>
        {it.available ? <Pill tone="ok">PDF {size(it.pdfBytes)}{it.pdfUpdatedAt ? ', ' + dateOnly(it.pdfUpdatedAt) : ''}</Pill> : <Pill tone="bad">No PDF yet</Pill>}
        {it.ordered ? <Pill tone="info">Customers have bought it</Pill> : null}
        <span className="mono muted">{it.id}</span>
      </div> : null}
      {lockAll ? <div className="st-note warn compact"><Icon id="lock" size={16} /><span>Your role can look at this sheet but not change it.{canUpload ? ' You can still upload its files.' : ''}</span></div> : null}
      <form className="studio-grid" onSubmit={submit} noValidate>
        <div className="studio-side">
          {canUpload ? <>
            <Drop kind="image" current={it.thumb} picked={cover} onPick={pickCover} toast={toast} disabled={!!busy} />
            <Drop kind="pdf" current={it.available ? size(it.pdfBytes) : ''} picked={pdf} onPick={f => setPdf({ file: f })} toast={toast} disabled={!!busy} />
            <div className="field"><label htmlFor="psPics">Page pictures (optional)</label>
              <input id="psPics" type="file" multiple accept={IMAGE_TYPES.join(',')} disabled={!!busy} onChange={e => { const fs = Array.from(e.target.files || []).filter(f => IMAGE_TYPES.includes(f.type) && f.size <= IMAGE_MAX); setPagePics(fs); if (fs.length !== (e.target.files || []).length) toast('Some files were skipped: use JPG, PNG or WebP up to 5 MB'); }} />
              <div className="inline-field"><label htmlFor="psFirst">Starting at page</label><input id="psFirst" type="number" min="1" max="500" value={firstPage} onChange={e => setFirstPage(Math.max(1, parseInt(e.target.value, 10) || 1))} disabled={!!busy} /></div>
              <small>{pagePics.length ? plural(pagePics.length, 'picture') + ' for pages ' + firstPage + (pagePics.length > 1 ? ' to ' + (Number(firstPage) + pagePics.length - 1) : '') + ', uploaded when you save.' : donePages ? 'Pages with a picture: ' + (donePages.length ? donePages.join(', ') : 'none') + '.' : 'Pictures of each page, shown in the viewer. A new picture replaces the old one for that page.'}</small>
            </div>
          </> : <>
            <div className="drop off"><div className="drop-preview" style={it.thumb ? { backgroundImage: 'url("' + it.thumb + '")' } : undefined}>{it.thumb ? null : <b>No cover picture</b>}</div></div>
            <p className="auth-sub">{it.available ? 'PDF attached, ' + size(it.pdfBytes) + '.' : 'No PDF yet.'} Your role cannot upload files.</p>
          </>}
          {!isNew ? <Gallery sheet={it} canUpload={canUpload} canWrite={canWrite} busy={!!busy} onSaved={onSaved} toast={toast} /> : null}
          <div className="field"><label>Card preview</label>
            <div className="card-look" aria-label="How the card looks in the shop">
              <div className="card-look-cover" style={(cover ? cover.url : it.thumb) ? { backgroundImage: 'url("' + (cover ? cover.url : it.thumb) + '")' } : undefined} />
              <b>{look.title || 'Title'}</b><small>{look.short || it.description || 'Short description'}</small>
              <span className="card-look-price">{free ? 'Free' : finalPrice != null ? '₹' + finalPrice : ''}{!free && origPrice > finalPrice ? <s>₹{origPrice}</s> : null}</span>
            </div></div>
          {!isNew ? <div className="field"><label>Rating from reviews</label><p className="rate-read"><span className="stars">{'★'.repeat(Math.round(rating || 0))}<i>{'★'.repeat(5 - Math.round(rating || 0))}</i></span> {ratingCount ? (Math.round((rating || 0) * 10) / 10) + ' from ' + plural(ratingCount, 'review') : 'No reviews yet'}</p></div> : null}
        </div>
        <div className="studio-main">
          <fieldset className="fs" disabled={lockAll || !!busy}><legend>Book details</legend>
            <div className="field"><label htmlFor="psTitle">Title</label><input id="psTitle" name="title" defaultValue={v('title')} onChange={e => setLook(l => ({ ...l, title: e.target.value }))} placeholder="e.g. Alphabet explorers" maxLength={200} required aria-invalid={!!errs.title} />{err1('title')}</div>
            <div className="field"><label htmlFor="psShort">Short description</label><input id="psShort" name="shortDescription" defaultValue={v('shortDescription')} onChange={e => setLook(l => ({ ...l, short: e.target.value }))} placeholder="One line for the card, e.g. Trace and say A to Z" maxLength={300} />{err1('shortDescription')}</div>
            <div className="field"><label htmlFor="psDesc">Description</label><textarea id="psDesc" name="description" placeholder="One or two lines parents will read on the card" defaultValue={v('description')} maxLength={2000} />{err1('description')}</div>
            <div className="grid-3">
              <div className="field"><label htmlFor="psPages">Pages</label><input id="psPages" name="pages" type="number" min="1" max="500" defaultValue={it.pages || 1} /><small>Counted from the PDF when you upload it.</small>{err1('pages')}</div>
              <div className="field"><label htmlFor="psLang">Language</label><input id="psLang" name="language" defaultValue={it.language || 'English'} maxLength={40} />{err1('language')}</div>
              <label className="check"><input type="checkbox" name="landscape" defaultChecked={!!it.landscape} />Pages are landscape</label>
            </div>
          </fieldset>
          <fieldset className="fs" disabled={lockAll || !!busy}><legend>Where it goes on the website</legend>
            <div className="grid-3">
              <div className="field"><label htmlFor="psCls">Class</label><select id="psCls" value={cls} onChange={e => setCls(e.target.value)} aria-invalid={!!errs.cls}>{classes.map(c => <option key={c.id} value={c.id}>{c.name}{c.status !== 'available' ? ' (not open yet)' : ''}</option>)}<option value="+new">+ New class…</option></select>
                {cls === '+new' ? <input id="psNewCls" aria-label="New class name" value={newClass} onChange={e => setNewClass(e.target.value)} placeholder="e.g. Class 4" maxLength={40} autoFocus /> : null}
                <small>{cls === '+new' ? 'Made when you save. It shows as "Coming soon" until you open it.' : 'Pick the class, or "+ New class" to add one.'}</small>{err1('cls')}</div>
              <div className="field"><label htmlFor="psSubj">Subject</label><input id="psSubj" name="subject" list="psSubjList" defaultValue={v('subject') || start.subject || (isNew ? subjects[0] || '' : '')} placeholder="e.g. English" maxLength={40} autoComplete="off" aria-invalid={!!errs.subject} />
                <datalist id="psSubjList">{subjects.map(x => <option key={x} value={x} />)}</datalist><small>Pick one, or type a new subject.</small>{err1('subject')}</div>
              <div className="field"><label htmlFor="psTopic">Section</label><input id="psTopic" list="psTopicList" value={secName} onChange={e => setSecName(e.target.value)} placeholder="e.g. Story time" maxLength={60} autoComplete="off" />
                <datalist id="psTopicList">{classSections.map(x => <option key={x.id} value={x.label} />)}</datalist>
                <small>{secIsNew ? 'New section "' + secName.trim() + '" is made when you save.' : secName.trim() ? 'Goes into this section.' : 'Pick a section or type a new name. Empty: the class shelf only.'}</small>{err1('section')}</div>
              <div className="field"><label htmlFor="psFor">For</label><select id="psFor" name="audience" defaultValue={it.audience || ''}><option value="">Everyone</option><option value="both">Parents and teachers</option><option value="parent">Parents</option><option value="teacher">Teachers</option></select></div>
            </div>
          </fieldset>
          <fieldset className="fs" disabled={lockAll || !!busy}><legend>Price</legend>
            <div className="seg" role="radiogroup" aria-label="Free or paid">
              <label className={'seg-opt' + (!free ? ' on' : '')}><input type="radio" name="freeOrPaid" checked={!free} onChange={() => setFree(false)} disabled={!canPrice} />Paid</label>
              <label className={'seg-opt' + (free ? ' on' : '')}><input type="radio" name="freeOrPaid" checked={free} onChange={() => setFree(true)} disabled={!canPrice} />Free</label>
            </div>
            <div className="grid-3">
              <div className="field"><label htmlFor="psWas">Original price ₹</label><input id="psWas" type="number" min="0" max="100000" step="1" value={orig} onChange={e => onOrig(e.target.value)} placeholder="optional" disabled={!canPrice || free} />{err1('wasPrice')}</div>
              <div className="field"><label htmlFor="psPct">Discount %</label><input id="psPct" type="number" min="0" max="100" step="1" value={pct} onChange={e => onPct(e.target.value)} placeholder="0" disabled={!canPrice || free || !orig} aria-invalid={!!errs.pct} /><small>Needs an original price.</small>{err1('pct')}</div>
              <div className="field"><label htmlFor="psPrice">Selling price ₹</label><input id="psPrice" type="number" min="0" max="100000" step="1" value={free ? '0' : sell} onChange={e => onSell(e.target.value)} disabled={!canPrice || free} aria-invalid={!!errs.price} />{err1('price')}</div>
            </div>
            <p className="price-sum">{!canPrice ? 'Your role cannot change prices.' : free ? 'Free: anyone can open it, no sign-in needed.' : finalPrice == null ? 'Enter the selling price.'
              : <>Customers pay <b>₹{finalPrice}</b>{origPrice > finalPrice ? <> instead of <s>₹{origPrice}</s> ({Math.round((1 - finalPrice / origPrice) * 100)}% off, they save ₹{origPrice - finalPrice})</> : null}, before tax and fees.</>}</p>
          </fieldset>
          <fieldset className="fs" disabled={lockAll || !!busy}><legend>Home page lists</legend>
            <div className="label-picks" role="group" aria-label="Labels">
              {LABELS.map(([t, name]) => <label key={t} className={'check pick' + (labels.has(t) ? ' on' : '')}><input type="checkbox" checked={labels.has(t)} onChange={() => toggleLabel(t)} />{name}</label>)}
            </div>
            <label className="check"><input type="checkbox" checked={labels.has(HOME_TAG)} onChange={() => toggleLabel(HOME_TAG)} />Show on the home page</label>
          </fieldset>
          {err ? <div className="st-note err" role="alert"><Icon id="alert" size={16} /><span>{err}</span></div> : null}
          <div className="btn-row studio-actions">
            {canWrite || canUpload ? <button type="submit" value="save" className="btn btn-primary" disabled={!!busy}>{busy ? <><span className="dm-spin" aria-hidden="true" />{busy}</> : isNew ? 'Save' : canWrite ? 'Save changes' : 'Upload the files'}</button> : null}
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={!!busy}>{canWrite ? 'Cancel' : 'Close'}</button>
            {!isNew && canWrite ? <span className="studio-more">
              <button type="button" className="btn btn-ghost" disabled={!!busy} onClick={duplicate}><Icon id="copy" />Duplicate</button>
              {status === 'archived' ? <button type="button" className="btn btn-ghost" disabled={!!busy} onClick={() => setDialog('restore')}><Icon id="undo" />Restore</button>
                : <button type="button" className="btn btn-ghost btn-danger" disabled={!!busy} onClick={() => setDialog('archive')}><Icon id="archive" />Hide</button>}
              {!it.ordered && status !== 'active' ? <button type="button" className="btn btn-ghost btn-danger" disabled={!!busy} onClick={() => setDialog('delete')}><Icon id="trash" />Delete for good</button> : null}
            </span> : null}
          </div>
        </div>
      </form>
      {dialog === 'archive' || dialog === 'restore' ? <ArchiveDialog sheet={it} kind={dialog} onClose={() => setDialog(null)} onDone={ws => { setDialog(null); onSaved(ws); toast(dialog === 'archive' ? 'Hidden. It is off the website now.' : ws && ws.status === 'active' ? 'Restored. It is on sale again.' : 'Restored as a draft.'); onClose(); }} /> : null}
      {dialog === 'delete' ? <DeleteDialog sheet={it} onClose={() => setDialog(null)} onDone={() => { setDialog(null); onSaved(null, it.id); toast('Deleted'); onClose(); }} /> : null}
    </section>
  );
}

/* more pictures for the sheet (up to 8): add one, move it, or remove it. Saved straight away. */
const GALLERY_MAX = 8;
function Gallery({ sheet, canUpload, canWrite, busy, onSaved, toast }) {
  const input = useRef(null);
  const [work, setWork] = useState(false);
  const pics = sheet.gallery || [], urls = sheet.galleryUrls || [];
  const base = '/api/admin/worksheets/' + encodeURIComponent(sheet.id);
  const add = async f => {
    if (!f) return;
    if (!IMAGE_TYPES.includes(f.type) || f.size > IMAGE_MAX) { toast('Use a JPG, PNG or WebP picture (5 MB at most)'); return; }
    setWork(true);
    try { onSaved((await sendRaw(base + '/gallery', f)).worksheet); } catch (e) { toast(uploadProblem(e, 'image')); }
    setWork(false);
  };
  const save = async next => {
    setWork(true);
    try { onSaved((await staffApi('PUT', base, { gallery: next })).worksheet); } catch (e) { toast(problem(e)); }
    setWork(false);
  };
  const move = (i, d) => { const n = pics.slice(); [n[i], n[i + d]] = [n[i + d], n[i]]; save(n); };
  const off = busy || work;
  return (
    <div className="field"><label>More pictures <small className="muted">{pics.length} of {GALLERY_MAX}</small></label>
      {pics.length ? <ul className="gallery">{pics.map((g, i) => <li key={g} style={{ backgroundImage: 'url("' + urls[i] + '")' }}>
        {canWrite ? <span className="gallery-act">
          <button type="button" className="icon-btn sm" aria-label="Move left" disabled={off || i === 0} onClick={() => move(i, -1)}>‹</button>
          <button type="button" className="icon-btn sm" aria-label="Move right" disabled={off || i === pics.length - 1} onClick={() => move(i, 1)}>›</button>
          <button type="button" className="icon-btn sm" aria-label="Remove picture" disabled={off} onClick={() => save(pics.filter(x => x !== g))}><Icon id="x" size={14} /></button>
        </span> : null}</li>)}</ul> : <small>Extra pictures of the inside pages, shown with the cover.</small>}
      {canUpload && pics.length < GALLERY_MAX ? <><input ref={input} type="file" hidden accept={IMAGE_TYPES.join(',')} onChange={e => { add(e.target.files[0]); e.target.value = ''; }} />
        <button type="button" className="btn btn-ghost btn-sm" disabled={off} onClick={() => input.current.click()}>{work ? 'Saving…' : <><Icon id="image" size={16} />Add a picture</>}</button></> : null}
    </div>
  );
}

/* a sheet nobody bought can be removed for good */
function DeleteDialog({ sheet, onClose, onDone }) {
  const [busy, setBusy] = useState(false), [err, setErr] = useState(null);
  const submit = async () => {
    setBusy(true); setErr(null);
    try { await staffApi('DELETE', '/api/admin/worksheets/' + encodeURIComponent(sheet.id) + '?hard=1'); onDone(); }
    catch (e) { setErr(e.code === 'in_use' ? 'Customers have bought or opened this sheet, so it can only be archived.' : problem(e)); setBusy(false); }
  };
  return (
    <Modal title="Delete this sheet for good?" onClose={onClose} onSubmit={submit} submitLabel="Delete it" busyLabel="Deleting…" danger busy={busy} error={err}>
      <p><b>{sheet.title}</b> and the files uploaded for it are removed. This cannot be undone.</p>
    </Modal>
  );
}

/* archive (take off the shelf) or restore one sheet */
export function ArchiveDialog({ sheet, kind, onClose, onDone }) {
  const [busy, setBusy] = useState(false), [err, setErr] = useState(null);
  const submit = async () => {
    setBusy(true); setErr(null);
    try {
      const r = kind === 'archive' ? await staffApi('DELETE', '/api/admin/worksheets/' + encodeURIComponent(sheet.id)) : await staffApi('POST', '/api/admin/worksheets/' + encodeURIComponent(sheet.id) + '/restore');
      onDone(r.worksheet);
    } catch (e) { setErr(problem(e)); setBusy(false); }
  };
  return kind === 'archive' ? (
    <Modal title="Hide this sheet?" onClose={onClose} onSubmit={submit} submitLabel="Hide it" busyLabel="Hiding…" danger busy={busy} error={err}>
      <p><b>{sheet.title}</b> leaves the website. Customers who already bought it keep their access until it ends. You can restore it later.</p>
    </Modal>
  ) : (
    <Modal title="Restore this sheet?" onClose={onClose} onSubmit={submit} submitLabel="Restore it" busyLabel="Restoring…" busy={busy} error={err}>
      <p><b>{sheet.title}</b> {sheet.available ? 'goes back on sale.' : 'comes back as a draft, because it has no PDF yet.'}</p>
    </Modal>
  );
}

