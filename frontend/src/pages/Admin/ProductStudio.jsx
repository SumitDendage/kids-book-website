import { useMemo, useRef, useState } from 'react';
import Icon from '../../components/dashboard/Icon.jsx';
import Pill from '../../components/dashboard/Pill.jsx';
import Modal from '../../components/dashboard/Modal.jsx';
import { useDash } from '../Portal/DashContext.js';
import { size, dateOnly, problem, fieldErrors, plural } from '../Portal/dashboard.js';
import { staffApi, staffFetch } from '../../services/api.js';
import { SHEET_STATUS_LABEL, SHEET_TONE, LABELS, HOME_TAG, visibilityOf, VISIBILITY, localInput, fromLocalInput } from './common.js';
import { spanText } from '../../data/content.js';

const PDF_MAX = 40 * 1024 * 1024, IMAGE_MAX = 5 * 1024 * 1024;
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

/* sends one file as the raw request body (the server reads PDFs and pictures this way) */
async function sendRaw(path, file) {
  const r = await staffFetch(path, { method: 'POST', headers: { 'Content-Type': file.type || 'application/octet-stream' }, body: file });
  let b = {}; try { b = await r.json(); } catch (_) { /* not JSON */ }
  if (!r.ok) throw Object.assign(new Error(String(b.error || 'The upload did not work.').replace(/\s+—\s+/g, ', ')), { status: r.status, code: b.code || null, body: b });
  return b;
}
/* upload problems in plain words */
function uploadProblem(e, what) {
  if (e.status === 413 || e.code === 'too_large') return what === 'pdf' ? 'That PDF is too big. A PDF can be up to 40 MB.' : 'That picture is too big. A picture can be up to 5 MB.';
  if (e.code === 'not_pdf') return 'That file is not a PDF.';
  if (e.code === 'pdf_incomplete') return 'The PDF looks incomplete. Please upload it again.';
  if (e.code === 'bad_image') return 'Use a JPG, PNG or WebP picture (5 MB at most).';
  return problem(e);
}

/* a drop zone for the cover picture or the PDF: click to choose, or drag a file on it */
function Drop({ kind, current, picked, onPick, toast, disabled }) {
  const input = useRef(null);
  const [over, setOver] = useState(false);
  const accept = f => {
    if (!f) return;
    const ok = kind === 'image' ? IMAGE_TYPES.includes(f.type) : (f.type === 'application/pdf' || /\.pdf$/i.test(f.name));
    if (!ok) { toast(kind === 'image' ? 'Choose a JPG, PNG or WebP picture' : 'Choose a PDF file'); return; }
    if (f.size > (kind === 'image' ? IMAGE_MAX : PDF_MAX)) { toast(kind === 'image' ? 'That picture is over 5 MB' : 'That PDF is over 40 MB'); return; }
    onPick(f);
  };
  const drag = on => e => { e.preventDefault(); if (!disabled) setOver(on); };
  const zone = {
    className: 'drop' + (kind === 'pdf' ? ' small' : '') + (over ? ' over' : '') + (disabled ? ' off' : ''), 'data-drop': kind, role: 'button', tabIndex: disabled ? -1 : 0, 'aria-disabled': disabled || undefined,
    onClick: e => { if (!disabled && !e.target.closest('input')) input.current.click(); },
    onKeyDown: e => { if (!disabled && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); input.current.click(); } },
    onDragEnter: drag(true), onDragOver: drag(true), onDragLeave: drag(false),
    onDrop: e => { e.preventDefault(); setOver(false); if (!disabled) accept(e.dataTransfer.files[0]); },
  };
  const pick = <input ref={input} type="file" accept={kind === 'image' ? IMAGE_TYPES.join(',') : 'application/pdf,.pdf'} hidden onChange={e => { accept(e.target.files[0]); e.target.value = ''; }} />;
  if (kind === 'image') {
    const url = picked ? picked.url : current;
    return (
      <div {...zone} aria-label="Choose the cover picture">{pick}
        <div className="drop-preview" style={url ? { backgroundImage: 'url("' + url + '")' } : undefined}>{url ? null : <><span className="drop-icon"><Icon id="image" size={28} /></span><b>Drop the cover picture here</b><small>or click to choose · JPG, PNG or WebP · up to 5 MB</small></>}</div>
        <p className="drop-name">{picked ? picked.file.name + ' · ' + size(picked.file.size) + ' · uploads when you save' : current ? (disabled ? 'Cover picture' : 'Cover set. Drop a new one to replace it.') : ''}</p>
      </div>
    );
  }
  return (
    <div {...zone} aria-label="Choose the PDF">{pick}
      <div className="drop-preview"><span className="drop-icon"><Icon id="file" size={24} /></span>
        <b>{picked ? picked.file.name : current ? 'PDF attached' : 'Drop the PDF here'}</b>
        <small>{picked ? size(picked.file.size) + ' · uploads when you save' : current ? current + (disabled ? '' : ' · drop a new file to replace it') : 'or click to choose · up to 40 MB'}</small></div>
    </div>
  );
}

/* "Upload new book" / "Edit book": cover and PDF, page pictures, details, category, price, access
   and limits. Saved on the server: a new sheet starts as a draft and goes on sale once its PDF is
   uploaded. */
export default function ProductStudio({ sheet, all, classes, sections, onSaved, onClose }) {
  const { toast, can, setEditing } = useDash();
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
  const [printRule, setPrintRule] = useState(it.printRule === 'sheet' ? 'sheet' : 'account');
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
  const [vis, setVis] = useState(isNew ? 'draft' : visibilityOf(it));
  const [when, setWhen] = useState(it.publishAt && it.publishAt > Date.now() ? localInput(it.publishAt) : localInput(Date.now() + 86400000));
  const [labels, setLabels] = useState(() => new Set((it.tags || []).filter(t => LABELS.some(([x]) => x === t) || t === HOME_TAG)));
  const toggleLabel = t => setLabels(cur => { const n = new Set(cur); if (n.has(t)) n.delete(t); else n.add(t); return n; });

  /* the subjects and shelf topics already in the shop, to pick from */
  const subjects = useMemo(() => [...new Set((all || []).map(s => s.subject).filter(Boolean))].sort(), [all]);
  const topics = useMemo(() => {
    const m = new Map();
    (all || []).forEach(s => { if (s.section) { const k = (s.group || '') + '|' + s.section; if (!m.has(k)) m.set(k, { group: s.group || '', section: s.section, label: s.sectionLabel || s.section, cls: s.cls }); } });
    return [...m.values()].sort((a, b) => a.label.localeCompare(b.label));
  }, [all]);
  /* the prints each account type gets (Settings → Prints per sheet), as the server worked them out for a sheet that follows the account type */
  const typePrints = useMemo(() => { const s = (all || []).find(x => x.printRule !== 'sheet' && x.prints); return s ? s.prints : null; }, [all]);
  const shopSpan = useMemo(() => { const s = (all || []).find(x => x.accessDays == null && (x.effectiveAccessHours || x.effectiveAccessDays)); return s ? (s.effectiveAccessHours ? spanText(s.effectiveAccessHours) : s.effectiveAccessDays + ' days') : null; }, [all]);
  const topicValue = it.section ? (it.group || '') + '|' + it.section : '';
  /* the website's sections (Admin → Categories), by group; the sheets' own sections if they could not load */
  const sectionGroups = useMemo(() => {
    const list = (sections && sections.length ? sections.map(x => ({ group: x.group || '', section: x.id, label: x.label, groupLabel: x.groupLabel || (x.builtin ? '' : 'Your sections'), visible: x.visible })) : topics.map(t => ({ ...t, groupLabel: '' })));
    if (it.section && !list.some(x => x.section === it.section)) list.push({ group: it.group || '', section: it.section, label: it.sectionLabel || it.section, groupLabel: '' });
    const m = new Map();
    list.forEach(x => { const k = x.groupLabel || 'Other'; if (!m.has(k)) m.set(k, []); m.get(k).push(x); });
    return [...m.entries()];
  }, [sections, topics, it.section, it.group, it.sectionLabel]);

  const pickCover = f => { const r = new FileReader(); r.onload = () => setCover({ file: f, url: r.result }); r.readAsDataURL(f); };
  const v = k => (it[k] == null ? '' : it[k]);
  const err1 = k => (errs[k] ? <small className="bad">{errs[k]}</small> : null);

  /* the form's values as the server's fields; prices only for staff who may change them */
  function fieldsOf(form) {
    const f = new FormData(form), n = k => { const s = String(f.get(k) ?? '').trim(); return s === '' ? null : Number(s); };
    const body = {
      title: String(f.get('title') || '').trim(),
      description: String(f.get('description') || '').trim(),
      cls: f.get('cls'),
      subject: String(f.get('subject') || '').trim(),
      pages: n('pages') || 1,
      audience: f.get('audience') || null,
      stock: n('stock'),
      accessDays: n('accessDays'),
      printRule: f.get('printRule') === 'sheet' ? 'sheet' : 'account',
      printLimit: n('printLimit') ?? 0,
      downloadLimit: n('downloadLimit') ?? 0,
      landscape: f.get('landscape') === 'on',
      /* the free words people search by, plus the labels ticked above */
      tags: [...new Set(String(f.get('tags') || '').split(/[,\s]+/).map(t => t.trim().toLowerCase()).filter(t => t && !LABELS.some(([x]) => x === t) && t !== HOME_TAG).concat([...labels]))],
      sort: n('sort') ?? 0,
    };
    const t = sectionGroups.flatMap(([, l]) => l).find(x => x.group + '|' + x.section === f.get('topic'));
    if (t) { body.group = t.group || null; body.section = t.section; body.sectionLabel = t.label; }
    else if (f.get('topic') === '') { body.group = null; body.section = null; body.sectionLabel = null; }
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
    if (canWrite && canPrice && !free && (finalPrice == null || !(finalPrice >= 0) || !Number.isInteger(finalPrice))) { setErrs({ price: 'Enter the selling price in whole rupees.' }); return; }
    if (canWrite && canPrice && pct !== '' && !(num(pct) >= 0 && num(pct) <= 100)) { setErrs({ pct: 'A discount is from 0 to 100%.' }); return; }
    if (canWrite && vis === 'scheduled' && !(fromLocalInput(when) > Date.now())) { setErrs({ publishAt: 'Pick a time in the future.' }); return; }
    setErr(null); setErrs({});
    let ws = sheet || null, step = '';
    const notes = [];
    try {
      if (canWrite) {
        step = 'details'; setBusy(isNew ? 'Saving the draft…' : 'Saving…');
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
      if (canWrite && want !== visibilityOf(ws)) {
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

  const hasPdf = !!it.available || !!pdf;
  const status = it.status || 'draft';
  const rating = it.reviewCount ? it.reviewAvg : it.rating;
  const ratingCount = it.reviewCount || it.ratingCount || 0;
  const lockAll = !canWrite;

  return (
    <section className="panel studio" aria-label={isNew ? 'Upload new book' : 'Edit ' + it.title}>
      <div className="row-between"><div><p className="eyebrow">{isNew ? 'Upload new book' : canWrite ? 'Edit book' : 'Book'}</p>
        <p className="auth-sub">{isNew ? 'Fill in the details, drop the cover and the PDF, pick its section, price and visibility, then save.' : it.title}</p></div>
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
          {!isNew ? <div className="field"><label>Rating from reviews</label><p className="rate-read"><span className="stars">{'★'.repeat(Math.round(rating || 0))}<i>{'★'.repeat(5 - Math.round(rating || 0))}</i></span> {ratingCount ? (Math.round((rating || 0) * 10) / 10) + ' from ' + plural(ratingCount, 'review') : 'No reviews yet'}</p></div> : null}
        </div>
        <div className="studio-main">
          <fieldset className="fs" disabled={lockAll || !!busy}><legend>Book details</legend>
            <div className="field"><label htmlFor="psTitle">Title</label><input id="psTitle" name="title" defaultValue={v('title')} placeholder="e.g. Alphabet explorers" maxLength={200} required aria-invalid={!!errs.title} />{err1('title')}</div>
            <div className="field"><label htmlFor="psDesc">Description</label><textarea id="psDesc" name="description" placeholder="One or two lines parents will read on the card" defaultValue={v('description')} maxLength={2000} />{err1('description')}</div>
            <div className="grid-3">
              <div className="field"><label htmlFor="psPages">Pages</label><input id="psPages" name="pages" type="number" min="1" max="500" defaultValue={it.pages || 1} /><small>Counted from the PDF when you upload it.</small>{err1('pages')}</div>
              <div className="field"><label htmlFor="psTags">Tags</label><input id="psTags" name="tags" defaultValue={(it.tags || []).join(', ')} placeholder="e.g. best, new" />{err1('tags')}</div>
              <label className="check"><input type="checkbox" name="landscape" defaultChecked={!!it.landscape} />Pages are landscape</label>
            </div>
          </fieldset>
          <fieldset className="fs" disabled={lockAll || !!busy}><legend>Category</legend>
            <div className="grid-3">
              <div className="field"><label htmlFor="psCls">Class</label><select id="psCls" name="cls" defaultValue={it.cls || (classes[0] && classes[0].id) || 'kg'}>{classes.map(c => <option key={c.id} value={c.id}>{c.name}{c.status !== 'available' ? ' (not open yet)' : ''}</option>)}</select>{err1('cls')}</div>
              <div className="field"><label htmlFor="psSubj">Subject</label><input id="psSubj" name="subject" list="psSubjects" defaultValue={v('subject') || (isNew ? subjects[0] || '' : '')} maxLength={40} aria-invalid={!!errs.subject} /><datalist id="psSubjects">{subjects.map(s => <option key={s} value={s} />)}</datalist>{err1('subject')}</div>
              <div className="field"><label htmlFor="psTopic">Website section</label><select id="psTopic" name="topic" defaultValue={topicValue}><option value="">None (the class shelf only)</option>
                {sectionGroups.map(([g, l]) => <optgroup key={g} label={g}>{l.map(t => <option key={t.group + '|' + t.section} value={t.group + '|' + t.section}>{t.label}{t.visible === false ? ' (hidden)' : ''}</option>)}</optgroup>)}</select>
                <small>Where it shows on the website. Add or rename sections in Categories.</small>{err1('section')}</div>
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
            <p className="price-sum">{!canPrice ? 'Your role cannot change prices.' : free ? 'Free: anyone signed in can open it.' : finalPrice == null ? 'Enter the selling price.'
              : <>Customers pay <b>₹{finalPrice}</b>{origPrice > finalPrice ? <> instead of <s>₹{origPrice}</s> ({Math.round((1 - finalPrice / origPrice) * 100)}% off, they save ₹{origPrice - finalPrice})</> : null}, before tax and fees.</>}</p>
            <div className="grid-3">
              <div className="field"><label htmlFor="psStock">Stock</label><input id="psStock" name="stock" type="number" min="0" defaultValue={v('stock')} placeholder="No limit" /><small>Leave empty for no limit.</small>{err1('stock')}</div>
            </div>
          </fieldset>
          <fieldset className="fs" disabled={lockAll || !!busy}><legend>Labels and placement</legend>
            <div className="label-picks" role="group" aria-label="Labels">
              {LABELS.map(([t, name]) => <label key={t} className={'check pick' + (labels.has(t) ? ' on' : '')}><input type="checkbox" checked={labels.has(t)} onChange={() => toggleLabel(t)} />{name}</label>)}
            </div>
            <div className="grid-3">
              <label className="check"><input type="checkbox" checked={labels.has(HOME_TAG)} onChange={() => toggleLabel(HOME_TAG)} />Show on the home page</label>
              <div className="field"><label htmlFor="psSort">Display order</label><input id="psSort" name="sort" type="number" min="-1000000" max="1000000" step="1" defaultValue={it.sort == null ? 0 : it.sort} /><small>Smaller numbers come first in a list.</small>{err1('sort')}</div>
            </div>
          </fieldset>
          <fieldset className="fs" disabled={lockAll || !!busy}><legend>Visibility</legend>
            <div className="seg" role="radiogroup" aria-label="Visibility">
              {VISIBILITY.map(([id, name]) => <label key={id} className={'seg-opt' + (vis === id ? ' on' : '')}><input type="radio" name="visibility" value={id} checked={vis === id} onChange={() => setVis(id)} />{name}</label>)}
            </div>
            {vis === 'scheduled' ? <div className="grid-3"><div className="field"><label htmlFor="psWhen">Publish on</label><input id="psWhen" type="datetime-local" value={when} onChange={e => setWhen(e.target.value)} aria-invalid={!!errs.publishAt} />{err1('publishAt')}</div></div> : null}
            <small className="muted">{{ draft: 'Not on the website. Only staff can see it.', published: hasPdf ? 'On the website as soon as you save.' : 'Add the PDF first: a sheet goes on the website only with its PDF.', scheduled: 'Goes on the website by itself at the time you pick.', hidden: 'Taken off the website. Customers who bought it keep their access until it ends.' }[vis]}</small>
          </fieldset>
          <fieldset className="fs" disabled={lockAll || !!busy}><legend>Access and limits per customer</legend>
            <div className="grid-3">
              <div className="field"><label htmlFor="psDays">Access days</label><input id="psDays" name="accessDays" type="number" min="1" max="3650" defaultValue={v('accessDays')} placeholder={shopSpan ? 'Shop setting: ' + shopSpan : 'Shop setting'} /><small>How long a buyer can open it, in days. Empty uses the shop setting{shopSpan ? ' (' + shopSpan + ')' : ''}, set in hours under Settings.</small>{err1('accessDays')}</div>
              <div className="field"><label htmlFor="psRule">Prints come from</label><select id="psRule" name="printRule" value={printRule} onChange={e => setPrintRule(e.target.value)}><option value="account">The account type</option><option value="sheet">This sheet only</option></select>
                <small>{printRule === 'sheet' ? 'Every customer gets the number below.' : typePrints ? 'Parents ' + typePrints.parent + ' · Teachers ' + typePrints.teacher + ' · Organizations ' + typePrints.organization + '. Change these in Settings.' : 'The numbers in Settings → Prints per sheet.'}</small>{err1('printRule')}</div>
              <div className="field"><label htmlFor="psPrint">Prints with this sheet only</label><input id="psPrint" name="printLimit" type="number" min="0" max="100" defaultValue={it.printLimit == null ? 0 : it.printLimit} aria-describedby="psPrintHelp" /><small id="psPrintHelp">{printRule === 'sheet' ? '0 means view only.' : 'Used only when prints come from this sheet.'}</small>{err1('printLimit')}</div>
              <div className="field"><label htmlFor="psDl">Downloads</label><input id="psDl" name="downloadLimit" type="number" min="0" max="100" defaultValue={it.downloadLimit == null ? 0 : it.downloadLimit} /><small>0 means view only.</small>{err1('downloadLimit')}</div>
            </div>
          </fieldset>
          {err ? <div className="st-note err" role="alert"><Icon id="alert" size={16} /><span>{err}</span></div> : null}
          <div className="btn-row studio-actions">
            {canWrite || canUpload ? <button type="submit" value="save" className="btn btn-primary" disabled={!!busy}>{busy ? <><span className="dm-spin" aria-hidden="true" />{busy}</> : isNew ? (vis === 'draft' ? 'Save as draft' : 'Save') : canWrite ? 'Save changes' : 'Upload the files'}</button> : null}
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={!!busy}>{canWrite ? 'Cancel' : 'Close'}</button>
            {!isNew && canWrite ? <span className="studio-more">
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

