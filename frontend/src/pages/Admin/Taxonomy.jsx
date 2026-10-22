import { useState } from 'react';
import Icon from '../../components/dashboard/Icon.jsx';
import Modal from '../../components/dashboard/Modal.jsx';
import Pill from '../../components/dashboard/Pill.jsx';
import { ErrorNote } from '../../components/dashboard/States.jsx';
import { useDash } from '../Portal/DashContext.js';
import { plural, problem, fieldErrors } from '../Portal/dashboard.js';
import { staffApi } from '../../services/api.js';

const CLASS_STATUS = [['available', 'Open'], ['coming_soon', 'Coming soon'], ['hidden', 'Hidden']];
const fe = (errs, k) => (errs[k] ? <small className="bad">{errs[k]}</small> : null);

/* one compact row: name and note, a pill, the order box and the actions */
function Row({ name, note, pill, sort, onSort, busy, children }) {
  return (
    <div className="sec-row">
      <div className="sec-name"><b>{name}</b>{note ? <small>{note}</small> : null}</div>
      {pill || <span />}
      {onSort ? <label className="inline-field" title="Smaller numbers come first"><span className="muted">Order</span>
        <input type="number" defaultValue={sort} disabled={busy} onBlur={e => { const n = parseInt(e.target.value, 10); if (Number.isFinite(n) && n !== sort) onSort(n); }} /></label> : <span />}
      {children || <span />}
    </div>
  );
}

/* Classes: add, rename, reorder, and open / coming soon / hidden on the website */
export function ClassesPanel({ clsQ }) {
  const { can, toast } = useDash();
  const canWrite = can('catalogue.write');
  const [busy, setBusy] = useState(''), [edit, setEdit] = useState(null);
  const classes = (clsQ.data && clsQ.data.classes) || [];
  const save = async (c, patch, msg) => {
    setBusy(c.id);
    try { const r = await staffApi('PUT', '/api/admin/classes', { classes: [{ id: c.id, ...patch }] }); clsQ.setData(d => ({ ...(d || {}), classes: r.classes })); toast(msg); }
    catch (e) { toast(problem(e)); }
    setBusy('');
  };
  return (
    <section className="panel">
      <div className="row-between"><div><p className="eyebrow">Classes</p><p className="auth-sub">Open a class to show its sheets on the website. Coming soon shows it with a note; Hidden takes it off.</p></div>
        {canWrite ? <button type="button" className="btn btn-primary" onClick={() => setEdit({})}><Icon id="plus" />Add class</button> : null}</div>
      {clsQ.error ? <ErrorNote error={clsQ.error} onRetry={clsQ.reload} compact /> : null}
      <div className="sec-list">{classes.map(c => (
        <Row key={c.id} name={c.name} note={plural(c.products || 0, 'sheet') + ' · id ' + c.id} sort={c.sort} busy={busy === c.id}
          onSort={canWrite ? n => save(c, { sort: n }, 'Order saved.') : null}>
          {canWrite ? <span className="btn-row">
            <select aria-label={c.name + ' on the website'} value={c.status} disabled={busy === c.id} onChange={e => save(c, { status: e.target.value }, c.name + ': ' + CLASS_STATUS.find(x => x[0] === e.target.value)[1] + '.')}>{CLASS_STATUS.map(([id, n]) => <option key={id} value={id}>{n}</option>)}</select>
            <button type="button" className="link" onClick={() => setEdit(c)}>Rename</button>
          </span> : <Pill>{(CLASS_STATUS.find(x => x[0] === c.status) || [])[1]}</Pill>}
        </Row>))}</div>
      {edit ? <ClassDialog cls={edit} onClose={() => setEdit(null)} onDone={(r, isNew) => { clsQ.setData(d => ({ ...(d || {}), classes: r.classes })); setEdit(null); toast(isNew ? 'Class added. It starts as Coming soon.' : 'Saved.'); }} /> : null}
    </section>
  );
}

function ClassDialog({ cls, onClose, onDone }) {
  const isNew = !cls.id;
  const [busy, setBusy] = useState(false), [err, setErr] = useState(null), [errs, setErrs] = useState({});
  const submit = async e => {
    const f = new FormData(e.currentTarget);
    const name = String(f.get('name') || '').trim();
    const id = isNew ? String(f.get('id') || '').trim().toLowerCase() : cls.id;
    if (!name) { setErrs({ name: 'Give the class a name.' }); return; }
    if (!/^[a-z0-9]{1,12}$/.test(id)) { setErrs({ id: 'Up to 12 lower-case letters and digits, e.g. c4.' }); return; }
    setBusy(true); setErr(null); setErrs({});
    try { onDone(await staffApi('PUT', '/api/admin/classes', { classes: [{ id, name, ...(isNew ? { status: 'coming_soon', sort: Number(f.get('sort')) || 0 } : {}) }] }), isNew); }
    catch (x) { setErr(problem(x)); setBusy(false); }
  };
  return (
    <Modal title={isNew ? 'Add a class' : 'Rename ' + cls.name} onClose={onClose} onSubmit={submit} submitLabel={isNew ? 'Add it' : 'Save'} busyLabel="Saving…" busy={busy} error={err}>
      <div className="grid-3">
        <div className="field"><label htmlFor="clName">Name</label><input id="clName" name="name" defaultValue={cls.name || ''} maxLength={40} placeholder="e.g. Class 4" aria-invalid={!!errs.name} />{fe(errs, 'name')}</div>
        {isNew ? <div className="field"><label htmlFor="clId">Short id</label><input id="clId" name="id" maxLength={12} placeholder="e.g. c4" aria-invalid={!!errs.id} /><small>Used in links. Cannot change later.</small>{fe(errs, 'id')}</div> : null}
        {isNew ? <div className="field"><label htmlFor="clSort">Order</label><input id="clSort" name="sort" type="number" defaultValue="10" /></div> : null}
      </div>
    </Modal>
  );
}

/* Subjects: the list products pick from (English, Maths, Science …) */
export function SubjectsPanel({ subQ }) {
  const { can, toast } = useDash();
  const canWrite = can('catalogue.write');
  const [busy, setBusy] = useState(''), [edit, setEdit] = useState(null), [del, setDel] = useState(null);
  const subjects = (subQ.data && subQ.data.subjects) || [];
  const set = r => subQ.setData(d => ({ ...(d || {}), subjects: r.subjects }));
  const save = async (x, patch, msg) => {
    setBusy(x.id);
    try { set(await staffApi('PUT', '/api/admin/subjects/' + encodeURIComponent(x.id), patch)); toast(msg); } catch (e) { toast(problem(e)); }
    setBusy('');
  };
  return (
    <section className="panel">
      <div className="row-between"><div><p className="eyebrow">Subjects</p><p className="auth-sub">Products pick their subject from this list. A new name follows to every product. Switched-off subjects leave the shop's filter.</p></div>
        {canWrite ? <button type="button" className="btn btn-primary" onClick={() => setEdit({})}><Icon id="plus" />Add subject</button> : null}</div>
      {subQ.error ? <ErrorNote error={subQ.error} onRetry={subQ.reload} compact /> : null}
      <div className="sec-list">{subjects.map(x => (
        <Row key={x.id} name={x.name} note={plural(x.products, 'product') + (x.products !== x.activeProducts ? ' (' + x.activeProducts + ' on sale)' : '')}
          pill={x.active ? <Pill tone="ok">On</Pill> : <Pill tone="neutral">Off</Pill>} sort={x.sort} busy={busy === x.id}
          onSort={canWrite ? n => save(x, { sort: n }, 'Order saved.') : null}>
          {canWrite ? <span className="btn-row">
            <button type="button" className="link" disabled={busy === x.id} onClick={() => save(x, { active: !x.active }, x.active ? x.name + ' switched off.' : x.name + ' switched on.')}>{x.active ? 'Switch off' : 'Switch on'}</button>
            <button type="button" className="link" onClick={() => setEdit(x)}>Rename</button>
            {!x.products ? <button type="button" className="link danger" onClick={() => setDel(x)}>Delete</button> : null}
          </span> : null}
        </Row>))}</div>
      {edit ? <NameDialog title={edit.id ? 'Rename ' + edit.name : 'Add a subject'} label="Subject name" value={edit.name} max={40} placeholder="e.g. Hindi" onClose={() => setEdit(null)}
        send={name => (edit.id ? staffApi('PUT', '/api/admin/subjects/' + encodeURIComponent(edit.id), { name }) : staffApi('POST', '/api/admin/subjects', { name }))}
        onDone={r => { set(r); setEdit(null); toast(edit.id ? 'Renamed.' : 'Subject added.'); }} /> : null}
      {del ? <DeleteDialog title={'Delete ' + del.name + '?'} text="No product uses it. It is removed for good." onClose={() => setDel(null)}
        send={() => staffApi('DELETE', '/api/admin/subjects/' + encodeURIComponent(del.id))} onDone={r => { set(r); setDel(null); toast('Deleted.'); }} /> : null}
    </section>
  );
}

/* Academic sessions: e.g. 2026-27, with dates; one is the current session */
export function SessionsPanel({ sesQ }) {
  const { can, toast } = useDash();
  const canWrite = can('catalogue.write');
  const [busy, setBusy] = useState(''), [edit, setEdit] = useState(null), [del, setDel] = useState(null);
  const sessions = (sesQ.data && sesQ.data.sessions) || [];
  const set = r => sesQ.setData(d => ({ ...(d || {}), sessions: r.sessions }));
  const save = async (x, patch, msg) => {
    setBusy(x.id);
    try { set(await staffApi('PUT', '/api/admin/sessions/' + encodeURIComponent(x.id), patch)); toast(msg); } catch (e) { toast(problem(e)); }
    setBusy('');
  };
  const range = x => (x.startsOn || x.endsOn ? (x.startsOn || '…') + ' to ' + (x.endsOn || '…') : 'No dates');
  return (
    <section className="panel">
      <div className="row-between"><div><p className="eyebrow">Academic sessions</p><p className="auth-sub">Tag products with the school years they suit. The current session is marked in the shop.</p></div>
        {canWrite ? <button type="button" className="btn btn-primary" onClick={() => setEdit({})}><Icon id="plus" />Add session</button> : null}</div>
      {sesQ.error ? <ErrorNote error={sesQ.error} onRetry={sesQ.reload} compact /> : null}
      {sessions.length ? <div className="sec-list">{sessions.map(x => (
        <Row key={x.id} name={x.label} note={range(x) + ' · ' + plural(x.products, 'product')}
          pill={x.current ? <Pill tone="info">Current</Pill> : x.active ? <Pill tone="ok">On</Pill> : <Pill tone="neutral">Off</Pill>} sort={x.sort} busy={busy === x.id}
          onSort={canWrite ? n => save(x, { sort: n }, 'Order saved.') : null}>
          {canWrite ? <span className="btn-row">
            {!x.current ? <button type="button" className="link" disabled={busy === x.id} onClick={() => save(x, { current: true }, x.label + ' is the current session.')}>Make current</button> : null}
            <button type="button" className="link" disabled={busy === x.id} onClick={() => save(x, { active: !x.active }, x.active ? 'Switched off.' : 'Switched on.')}>{x.active ? 'Switch off' : 'Switch on'}</button>
            <button type="button" className="link" onClick={() => setEdit(x)}>Edit</button>
            {!x.products ? <button type="button" className="link danger" onClick={() => setDel(x)}>Delete</button> : null}
          </span> : null}
        </Row>))}</div> : <p className="cart-empty">No sessions yet.</p>}
      {edit ? <SessionDialog session={edit} onClose={() => setEdit(null)} onDone={r => { set(r); setEdit(null); toast(edit.id ? 'Saved.' : 'Session added.'); }} /> : null}
      {del ? <DeleteDialog title={'Delete ' + del.label + '?'} text="No product is in it. It is removed for good." onClose={() => setDel(null)}
        send={() => staffApi('DELETE', '/api/admin/sessions/' + encodeURIComponent(del.id))} onDone={r => { set(r); setDel(null); toast('Deleted.'); }} /> : null}
    </section>
  );
}

function SessionDialog({ session, onClose, onDone }) {
  const isNew = !session.id;
  const [busy, setBusy] = useState(false), [err, setErr] = useState(null), [errs, setErrs] = useState({});
  const submit = async e => {
    const f = new FormData(e.currentTarget);
    const body = { label: String(f.get('label') || '').trim(), startsOn: f.get('startsOn') || null, endsOn: f.get('endsOn') || null };
    if (!body.label) { setErrs({ label: 'Give the session a name, e.g. 2027-28.' }); return; }
    if (body.startsOn && body.endsOn && body.endsOn <= body.startsOn) { setErrs({ endsOn: 'The end must be after the start.' }); return; }
    if (isNew) body.current = f.get('current') === 'on';
    setBusy(true); setErr(null); setErrs({});
    try { onDone(isNew ? await staffApi('POST', '/api/admin/sessions', body) : await staffApi('PUT', '/api/admin/sessions/' + encodeURIComponent(session.id), body)); }
    catch (x) { const e2 = fieldErrors(x); setErrs(e2); setErr(Object.keys(e2).length ? 'Please check the fields marked in red.' : problem(x)); setBusy(false); }
  };
  return (
    <Modal title={isNew ? 'Add a session' : 'Edit ' + session.label} onClose={onClose} onSubmit={submit} submitLabel={isNew ? 'Add it' : 'Save'} busyLabel="Saving…" busy={busy} error={err}>
      <div className="grid-3">
        <div className="field"><label htmlFor="ssLabel">Name</label><input id="ssLabel" name="label" defaultValue={session.label || ''} maxLength={40} placeholder="e.g. 2027-28" aria-invalid={!!errs.label} />{fe(errs, 'label')}</div>
        <div className="field"><label htmlFor="ssFrom">Starts</label><input id="ssFrom" name="startsOn" type="date" defaultValue={session.startsOn || ''} />{fe(errs, 'startsOn')}</div>
        <div className="field"><label htmlFor="ssTo">Ends</label><input id="ssTo" name="endsOn" type="date" defaultValue={session.endsOn || ''} aria-invalid={!!errs.endsOn} />{fe(errs, 'endsOn')}</div>
      </div>
      {isNew ? <label className="check"><input type="checkbox" name="current" />Make it the current session</label> : null}
    </Modal>
  );
}

function NameDialog({ title, label, value, max, placeholder, send, onClose, onDone }) {
  const [busy, setBusy] = useState(false), [err, setErr] = useState(null);
  const submit = async e => {
    const name = String(new FormData(e.currentTarget).get('name') || '').trim();
    if (!name) { setErr('Give it a name.'); return; }
    setBusy(true); setErr(null);
    try { onDone(await send(name)); } catch (x) { setErr(problem(x)); setBusy(false); }
  };
  return (
    <Modal title={title} onClose={onClose} onSubmit={submit} submitLabel="Save" busyLabel="Saving…" busy={busy} error={err}>
      <div className="field"><label htmlFor="ndName">{label}</label><input id="ndName" name="name" defaultValue={value || ''} maxLength={max} placeholder={placeholder} /></div>
    </Modal>
  );
}

function DeleteDialog({ title, text, send, onClose, onDone }) {
  const [busy, setBusy] = useState(false), [err, setErr] = useState(null);
  const submit = async () => {
    setBusy(true); setErr(null);
    try { onDone(await send()); } catch (e) { setErr(e.code === 'in_use' ? e.message : problem(e)); setBusy(false); }
  };
  return (
    <Modal title={title} onClose={onClose} onSubmit={submit} submitLabel="Delete it" busyLabel="Deleting…" danger busy={busy} error={err}>
      <p>{text}</p>
    </Modal>
  );
}
