import { useState } from 'react';
import Icon from '../../components/dashboard/Icon.jsx';
import Modal from '../../components/dashboard/Modal.jsx';
import Pill from '../../components/dashboard/Pill.jsx';
import { Guard, ErrorNote } from '../../components/dashboard/States.jsx';
import { useDash } from '../Portal/DashContext.js';
import { useStaffGet, plural, problem, fieldErrors } from '../Portal/dashboard.js';
import { staffApi } from '../../services/api.js';

import { ClassesPanel, SubjectsPanel, SessionsPanel } from './Taxonomy.jsx';

const TABS = [['sections', 'Sections'], ['classes', 'Classes'], ['subjects', 'Subjects'], ['sessions', 'Academic sessions']];
let keepTab = 'sections';

/* Categories: the website sections a sheet can be put in, the classes (open, coming soon or hidden on the
   website), subjects and academic sessions. The website's own sections (Alphabet, Vocabulary …) can be renamed, reordered or hidden;
   sections added here show in the shop under "More sections" once a sheet is in them. */
export default function Categories() {
  const { can, toast } = useDash();
  const canWrite = can('catalogue.write');
  const secQ = useStaffGet('/api/admin/sections', { keep: true });
  const clsQ = useStaffGet('/api/admin/classes', { keep: true });
  const subQ = useStaffGet('/api/admin/subjects', { keep: true });
  const sesQ = useStaffGet('/api/admin/sessions', { keep: true });
  const [tab, setTab] = useState(keepTab);
  const setTabK = t => { keepTab = t; setTab(t); };
  const [edit, setEdit] = useState(null);   /* a section, or {} for a new one */
  const [del, setDel] = useState(null);
  const [busy, setBusy] = useState('');
  const sections = (secQ.data && secQ.data.sections) || [];
  const classes = (clsQ.data && clsQ.data.classes) || [];

  const saveRow = async (x, patch, msg) => {
    setBusy(x.id);
    try { const r = await staffApi('PUT', '/api/admin/sections/' + encodeURIComponent(x.id), patch); secQ.setData(d => ({ ...(d || {}), sections: r.sections })); if (msg) toast(msg); }
    catch (e) { toast(problem(e)); }
    setBusy('');
  };

  /* the website's sections by group, then the ones staff made */
  const groups = new Map();
  sections.filter(x => x.builtin).forEach(x => { const k = x.groupLabel || 'Other'; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(x); });
  const own = sections.filter(x => !x.builtin);
  const row = x => (
    <div key={x.id} className="sec-row">
      <div className="sec-name"><b>{x.label}</b><small>{plural(x.products, 'sheet')}{x.products !== x.activeProducts ? ' (' + x.activeProducts + ' on sale)' : ''}{x.description ? ' · ' + x.description : ''}</small></div>
      {x.visible ? <Pill tone="ok">Shown</Pill> : <Pill tone="neutral">Hidden</Pill>}
      {canWrite ? <label className="inline-field" title="Smaller numbers come first"><span className="muted">Order</span>
        <input type="number" defaultValue={x.sort} disabled={busy === x.id} onBlur={e => { const n = parseInt(e.target.value, 10); if (Number.isFinite(n) && n !== x.sort) saveRow(x, { sort: n }, 'Order saved.'); }} /></label> : <span />}
      {canWrite ? <span className="btn-row">
        <button type="button" className="link" disabled={busy === x.id} onClick={() => saveRow(x, { visible: !x.visible }, x.visible ? 'Hidden from the website.' : 'Shown on the website.')}>{x.visible ? 'Hide' : 'Show'}</button>
        <button type="button" className="link" onClick={() => setEdit(x)}>Edit</button>
        {!x.builtin ? <button type="button" className="link danger" onClick={() => setDel(x)}>Delete</button> : null}
      </span> : <span />}
    </div>
  );

  return (
    <Guard state={secQ} rows={8}>
      {secQ.error ? <ErrorNote error={secQ.error} onRetry={secQ.reload} compact /> : null}
      <div className="tabs-s" role="tablist" aria-label="Categories">
        {TABS.map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => setTabK(id)}>{label}</button>)}
      </div>
      {tab === 'classes' ? <ClassesPanel clsQ={clsQ} /> : null}
      {tab === 'subjects' ? <SubjectsPanel subQ={subQ} /> : null}
      {tab === 'sessions' ? <SessionsPanel sesQ={sesQ} /> : null}
      {tab === 'sections' ? <>
      <section className="panel">
        <div className="row-between"><div><p className="eyebrow">Your sections</p><p className="auth-sub">Sections you add show in the shop under "More sections" once a sheet is in them. Pick the section on a sheet in Products.</p></div>
          {canWrite ? <button type="button" className="btn btn-primary" onClick={() => setEdit({})}><Icon id="plus" />Add section</button> : null}</div>
        {own.length ? <div className="sec-list">{own.map(row)}</div> : <p className="cart-empty">No sections of your own yet.</p>}
      </section>
      <section className="panel">
        <p className="eyebrow">The website's sections</p>
        <p className="auth-sub">These are drawn by the website's own pages (Alphabet, Vocabulary and the Kindergarten topics). You can rename, reorder or hide them.</p>
        {[...groups.entries()].map(([g, l]) => <div key={g}><p className="sec-group">{g}</p><div className="sec-list">{l.map(row)}</div></div>)}
      </section>
      </> : null}
      {edit ? <SectionDialog section={edit} classes={classes} onClose={() => setEdit(null)} onDone={(r, isNew) => { secQ.setData(d => ({ ...(d || {}), sections: r.sections })); setEdit(null); toast(isNew ? 'Section added.' : 'Saved.'); }} /> : null}
      {del ? <DeleteSection section={del} onClose={() => setDel(null)} onDone={r => { secQ.setData(d => ({ ...(d || {}), sections: r.sections })); setDel(null); toast('Section deleted.'); }} /> : null}
    </Guard>
  );
}

function SectionDialog({ section, classes, onClose, onDone }) {
  const isNew = !section.id;
  const [busy, setBusy] = useState(false), [err, setErr] = useState(null), [errs, setErrs] = useState({});
  const submit = async e => {
    const f = new FormData(e.currentTarget);
    const body = { label: String(f.get('label') || '').trim(), description: String(f.get('description') || '').trim(), cls: f.get('cls') };
    if (!body.label) { setErrs({ label: 'Give the section a name.' }); return; }
    setBusy(true); setErr(null); setErrs({});
    try {
      const r = isNew ? await staffApi('POST', '/api/admin/sections', body) : await staffApi('PUT', '/api/admin/sections/' + encodeURIComponent(section.id), body);
      onDone(r, isNew);
    } catch (x) { const fe = fieldErrors(x); setErrs(fe); setErr(Object.keys(fe).length ? 'Please check the fields marked in red.' : problem(x)); setBusy(false); }
  };
  return (
    <Modal title={isNew ? 'Add a section' : 'Edit section'} onClose={onClose} onSubmit={submit} submitLabel={isNew ? 'Add it' : 'Save'} busyLabel="Saving…" busy={busy} error={err}>
      <div>
        <div className="field"><label htmlFor="secLabel">Name</label><input id="secLabel" name="label" defaultValue={section.label || ''} maxLength={60} placeholder="e.g. Story books" aria-invalid={!!errs.label} />{errs.label ? <small className="bad">{errs.label}</small> : null}</div>
        <div className="field"><label htmlFor="secDesc">Description (optional)</label><textarea id="secDesc" name="description" defaultValue={section.description || ''} maxLength={300} /></div>
        <div className="field"><label htmlFor="secCls">Class</label><select id="secCls" name="cls" defaultValue={section.cls || 'kg'}>{classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
      </div>
    </Modal>
  );
}

function DeleteSection({ section, onClose, onDone }) {
  const [busy, setBusy] = useState(false), [err, setErr] = useState(null);
  const submit = async () => {
    setBusy(true); setErr(null);
    try { onDone(await staffApi('DELETE', '/api/admin/sections/' + encodeURIComponent(section.id))); }
    catch (e) { setErr(e.code === 'in_use' ? e.message : problem(e)); setBusy(false); }
  };
  return (
    <Modal title="Delete this section?" onClose={onClose} onSubmit={submit} submitLabel="Delete it" busyLabel="Deleting…" danger busy={busy} error={err}>
      <p><b>{section.label}</b> is removed. {section.products ? 'Move its ' + plural(section.products, 'sheet') + ' to another section first.' : 'No sheet is in it.'}</p>
    </Modal>
  );
}
