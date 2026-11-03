import { useState } from 'react';
import DataTable from '../../components/dashboard/DataTable.jsx';
import Pill from '../../components/dashboard/Pill.jsx';
import Icon from '../../components/dashboard/Icon.jsx';
import Modal from '../../components/dashboard/Modal.jsx';
import { Guard, ErrorNote } from '../../components/dashboard/States.jsx';
import { useDash } from '../Portal/DashContext.js';
import { useStaffGet, dateOnly, problem, fieldErrors, plural } from '../Portal/dashboard.js';
import { staffApi } from '../../services/api.js';
import { dateInput, startOfDayIso, endOfDayIso } from './common.js';

const APPLIES = { all: 'Everything', worksheet: 'Single sheets', class: 'Class plans' };
/* what a coupon takes off, in a few words */
const offText = c => (c.kind === 'fixed' ? '₹' + c.amountInr : c.pct + '%');

/* where a coupon stands today */
function stateOf(c) {
  const now = Date.now();
  if (!c.active) return ['Off', 'neutral'];
  if (c.usedUp) return ['Used up', 'neutral'];
  if (c.validUntil && c.validUntil < now) return ['Ended', 'neutral'];
  if (c.validFrom && c.validFrom > now) return ['Starts ' + dateOnly(c.validFrom), 'info'];
  return ['Active', 'ok'];
}

/* Coupons: the codes customers type at checkout (with limits, dates and what they work on), and
   the % off each class plan. All saved on the server; the checkout price comes from there. */
export default function Coupons() {
  const { can, toast } = useDash();
  const list = useStaffGet('/api/admin/coupons', { keep: true });
  const classesQ = useStaffGet(can('catalogue.read') ? '/api/admin/classes' : null, { keep: true });
  const [edit, setEdit] = useState(null);    /* 'new' | coupon */
  const [drop, setDrop] = useState(null);
  const canWrite = can('coupons.write');
  const classes = (classesQ.data && classesQ.data.classes) || [];
  const className = id => { const c = classes.find(x => x.id === id); return c ? c.name : id; };
  const cps = (list.data && list.data.coupons) || [];
  const put = c => list.setData(d => { const rows = (d && d.coupons) || []; return { ...(d || {}), coupons: rows.some(r => r.code === c.code) ? rows.map(r => (r.code === c.code ? c : r)) : [c, ...rows] }; });
  const toggle = async c => {
    try { const r = await staffApi('PUT', '/api/admin/coupons/' + encodeURIComponent(c.code), { active: !c.active }); put(r.coupon); toast(r.coupon.active ? c.code + ' is on' : c.code + ' is off'); }
    catch (e) { toast(problem(e)); }
  };

  return (
    <>
      <Guard state={list} rows={5}>
        <section className="panel">
          <div className="row-between"><div><p className="eyebrow">Coupons</p><p className="auth-sub">Customers type the code at checkout. {canWrite ? '' : 'Your role can see coupons but not change them.'}</p></div>
            {canWrite ? <div className="btn-row"><button type="button" className="btn btn-primary" onClick={() => setEdit('new')}><Icon id="plus" />New coupon</button></div> : null}</div>
          {list.error ? <ErrorNote error={list.error} onRetry={list.reload} compact /> : null}
          <DataTable plain={cps.length <= 10} head={['Code', 'Off', 'Works on', 'Used', 'Dates', 'Status', '']} empty="No coupons yet."
            rows={cps.map(c => {
              const [label, tone] = stateOf(c);
              return {
                key: c.code, cells: [
                  <span key="c"><b className="mono">{c.code}</b>{c.note ? <small>{c.note}</small> : null}</span>,
                  <span key="o">{offText(c)}{c.minOrderInr || c.maxDiscountInr ? <small>{[c.minOrderInr ? 'Orders from ₹' + c.minOrderInr : '', c.maxDiscountInr ? 'At most ₹' + c.maxDiscountInr + ' off' : ''].filter(Boolean).join(' · ')}</small> : null}</span>,
                  <span key="w">{APPLIES[c.appliesTo] + (c.cls ? ' · ' + className(c.cls) : '')}{(c.productIds || []).length || (c.sectionIds || []).length ? <small>{[(c.productIds || []).length ? plural(c.productIds.length, 'chosen sheet') : '', (c.sectionIds || []).length ? plural(c.sectionIds.length, 'category', 'categories') : ''].filter(Boolean).join(' + ')}</small> : null}</span>,
                  <span key="u">{c.uses}{c.maxUses ? ' of ' + c.maxUses : ''}{c.perUserLimit ? <small>{c.perUserLimit === 1 ? 'Once per customer' : c.perUserLimit + ' per customer'}</small> : null}</span>,
                  c.validFrom || c.validUntil ? (c.validFrom ? dateOnly(c.validFrom) : 'Now') + ' to ' + (c.validUntil ? dateOnly(c.validUntil) : 'no end') : 'Any time',
                  <Pill key="s" tone={tone}>{label}</Pill>,
                  canWrite ? <span key="a" className="row-actions"><button type="button" className="link" onClick={() => setEdit(c)}>Edit</button><button type="button" className="link" onClick={() => toggle(c)}>{c.active ? 'Turn off' : 'Turn on'}</button><button type="button" className="link danger" onClick={() => setDrop(c)}>Delete</button></span> : '',
                ],
              };
            })} />
        </section>
      </Guard>
      <ClassDiscounts classesQ={classesQ} />
      {edit ? <CouponDialog coupon={edit === 'new' ? null : edit} classes={classes} onClose={() => setEdit(null)} onDone={c => { setEdit(null); put(c); toast(edit === 'new' ? 'Coupon ' + c.code + ' added' : 'Saved'); }} /> : null}
      {drop ? <DeleteCoupon coupon={drop} onClose={() => setDrop(null)} onDone={r => { setDrop(null); if (r.deleted) list.setData(d => ({ ...d, coupons: d.coupons.filter(x => x.code !== drop.code) })); else if (r.coupon) put(r.coupon); toast(r.deleted ? 'Deleted' : 'It was used on orders, so it was switched off instead.'); }} /> : null}
    </>
  );
}

function CouponDialog({ coupon, classes, onClose, onDone }) {
  const c = coupon || {};
  const [busy, setBusy] = useState(false), [err, setErr] = useState(null), [errs, setErrs] = useState({});
  const [applies, setApplies] = useState(c.appliesTo || 'all');
  const [kind, setKind] = useState(c.kind || 'percent');
  const [prods, setProds] = useState(c.productIds || []), [secs, setSecs] = useState(c.sectionIds || []);
  const { can } = useDash();
  const sheetsQ = useStaffGet(can('catalogue.read') ? '/api/admin/worksheets' : null, { keep: true });
  const sectionsQ = useStaffGet(can('catalogue.read') ? '/api/admin/sections' : null, { keep: true });
  const sheetOpts = ((sheetsQ.data && sheetsQ.data.worksheets) || []).map(x => ({ id: x.id, name: x.title, note: x.id }));
  const sectionOpts = ((sectionsQ.data && sectionsQ.data.sections) || []).map(x => ({ id: x.id, name: (x.groupLabel ? x.groupLabel + ' › ' : '') + x.label, note: plural(x.products || 0, 'sheet') }));
  const submit = async e => {
    const f = new FormData(e.currentTarget);
    const num = k => { const s = String(f.get(k) || '').trim(); return s === '' ? 0 : Number(s); };
    const money = k => { const s = String(f.get(k) || '').trim(); return s === '' ? null : Number(s); };
    const body = {
      kind, ...(kind === 'fixed' ? { amountInr: money('amountInr') } : { pct: Number(f.get('pct')) }),
      minOrderInr: money('minOrderInr') ?? 0, maxDiscountInr: kind === 'percent' ? money('maxDiscountInr') : null,
      productIds: prods, sectionIds: secs,
      maxUses: num('maxUses'), perUserLimit: num('perUserLimit'), appliesTo: f.get('appliesTo'),
      classId: f.get('classId') || null, validFrom: startOfDayIso(f.get('validFrom')), validUntil: endOfDayIso(f.get('validUntil')),
      active: f.get('active') === 'on', note: String(f.get('note') || '').trim() || null,
    };
    if (!coupon) body.code = String(f.get('code') || '').trim().toUpperCase();
    setBusy(true); setErr(null); setErrs({});
    try {
      const r = coupon ? await staffApi('PUT', '/api/admin/coupons/' + encodeURIComponent(c.code), body) : await staffApi('POST', '/api/admin/coupons', body);
      onDone(r.coupon);
    } catch (x) {
      const fe = fieldErrors(x); setErrs(fe);
      setErr(Object.keys(fe).length ? 'Please check the fields marked in red.' : problem(x)); setBusy(false);
    }
  };
  const fe = k => (errs[k] ? <small className="bad">{errs[k]}</small> : null);
  return (
    <Modal title={coupon ? 'Edit ' + c.code : 'New coupon'} onClose={onClose} onSubmit={submit} submitLabel={coupon ? 'Save' : 'Add the coupon'} busyLabel="Saving…" busy={busy} error={err} wide>
      <div className="grid-3">
        {coupon ? null : <div className="field"><label htmlFor="cpCode">Code</label><input id="cpCode" name="code" required maxLength={32} placeholder="e.g. SPRING20" style={{ textTransform: 'uppercase' }} />{fe('code')}</div>}
        <div className="field"><label htmlFor="cpKind">Takes off</label><select id="cpKind" value={kind} onChange={e => setKind(e.target.value)}><option value="percent">A percentage</option><option value="fixed">A fixed amount (₹)</option></select>{fe('kind')}</div>
        {kind === 'percent'
          ? <div className="field"><label htmlFor="cpPct">% off</label><input id="cpPct" name="pct" type="number" min="1" max="100" step="0.5" required defaultValue={c.pct || ''} />{fe('pct')}</div>
          : <div className="field"><label htmlFor="cpAmt">₹ off</label><input id="cpAmt" name="amountInr" type="number" min="1" max="100000" step="1" required defaultValue={c.amountInr || ''} />{fe('amountInr')}</div>}
      </div>
      <div className="grid-3">
        <div className="field"><label htmlFor="cpMin">Smallest order ₹</label><input id="cpMin" name="minOrderInr" type="number" min="0" step="1" defaultValue={c.minOrderInr || ''} placeholder="Any order" />{fe('minOrderInr')}</div>
        {kind === 'percent' ? <div className="field"><label htmlFor="cpCap">Most it takes off ₹</label><input id="cpCap" name="maxDiscountInr" type="number" min="1" step="1" defaultValue={c.maxDiscountInr || ''} placeholder="No cap" />{fe('maxDiscountInr')}</div> : null}
        <div className="field"><label htmlFor="cpMax">Uses in all</label><input id="cpMax" name="maxUses" type="number" min="0" defaultValue={c.maxUses || ''} placeholder="No limit" />{fe('maxUses')}</div>
        <div className="field"><label htmlFor="cpPer">Uses per customer</label><input id="cpPer" name="perUserLimit" type="number" min="0" max="1000" defaultValue={c.perUserLimit || ''} placeholder="No limit" />{fe('perUserLimit')}</div>
      </div>
      <div className="grid-3">
        <div className="field"><label htmlFor="cpApplies">Works on</label><select id="cpApplies" name="appliesTo" value={applies} onChange={e => setApplies(e.target.value)}><option value="all">Everything</option><option value="worksheet">Single sheets only</option><option value="class">Class plans only</option></select>{fe('appliesTo')}</div>
        <div className="field"><label htmlFor="cpClass">Class</label><select id="cpClass" name="classId" defaultValue={c.cls || ''}><option value="">Any class</option>{classes.map(k => <option key={k.id} value={k.id}>{k.name}</option>)}{c.cls && !classes.some(k => k.id === c.cls) ? <option value={c.cls}>{c.cls}</option> : null}</select>{fe('cls')}</div>
        <label className="check"><input type="checkbox" name="active" defaultChecked={coupon ? !!c.active : true} />Switched on</label>
      </div>
      <div className="grid-3">
        <div className="field"><label htmlFor="cpFrom">Starts</label><input id="cpFrom" name="validFrom" type="date" defaultValue={dateInput(c.validFrom)} /><small>Empty: right away.</small>{fe('validFrom')}</div>
        <div className="field"><label htmlFor="cpUntil">Ends after</label><input id="cpUntil" name="validUntil" type="date" defaultValue={dateInput(c.validUntil)} /><small>Empty: no end date.</small>{fe('validUntil')}</div>
        <div className="field"><label htmlFor="cpNote">Note for staff</label><input id="cpNote" name="note" maxLength={200} defaultValue={c.note || ''} placeholder="e.g. Newsletter, May" />{fe('note')}</div>
      </div>
      {applies !== 'class' && (sheetOpts.length || sectionOpts.length || prods.length || secs.length) ? <div className="grid-2">
        <Picker id="cpProds" label="Only these sheets" hint="Empty: every sheet." options={sheetOpts} value={prods} onChange={setProds} error={fe('productIds')} />
        <Picker id="cpSecs" label="Only these categories" hint="Empty: every category. A sheet in a chosen category counts." options={sectionOpts} value={secs} onChange={setSecs} error={fe('sectionIds')} />
      </div> : null}
      {coupon && c.uses ? <p className="auth-sub">Used {plural(c.uses, 'time')} so far.</p> : null}
    </Modal>
  );
}

/* pick some items from a long list: search, then click to add; chosen ones show as chips */
function Picker({ id, label, hint, options, value, onChange, error }) {
  const [find, setFind] = useState('');
  const byId = new Map(options.map(o => [o.id, o]));
  const q = find.trim().toLowerCase();
  const found = q ? options.filter(o => !value.includes(o.id) && (o.name + ' ' + o.id).toLowerCase().includes(q)).slice(0, 6) : [];
  return (
    <div className="field"><label htmlFor={id}>{label}</label>
      {value.length ? <div className="chips">{value.map(v => <button key={v} type="button" className="chip on" aria-label={'Remove ' + ((byId.get(v) || {}).name || v)} onClick={() => onChange(value.filter(x => x !== v))}>{(byId.get(v) || {}).name || v} ✕</button>)}</div> : null}
      <input id={id} className="search" type="search" placeholder="Search to add…" value={find} onChange={e => setFind(e.target.value)} />
      {found.length ? <ul className="hs-found">{found.map(o => <li key={o.id}><span><b>{o.name}</b><small>{o.note}</small></span><button type="button" className="btn btn-ghost btn-sm" onClick={() => { onChange(value.concat(o.id)); setFind(''); }}>Add</button></li>)}</ul> : null}
      <small>{hint}</small>{error}
    </div>
  );
}

function DeleteCoupon({ coupon, onClose, onDone }) {
  const [busy, setBusy] = useState(false), [err, setErr] = useState(null);
  const submit = async () => {
    setBusy(true); setErr(null);
    try { onDone(await staffApi('DELETE', '/api/admin/coupons/' + encodeURIComponent(coupon.code))); }
    catch (e) { setErr(problem(e)); setBusy(false); }
  };
  return (
    <Modal title={'Delete ' + coupon.code + '?'} onClose={onClose} onSubmit={submit} submitLabel="Delete it" busyLabel="Deleting…" danger busy={busy} error={err}>
      <p>{coupon.uses ? 'This code was used on orders, so it is switched off instead of deleted. Its history stays.' : 'Nobody has used this code. It is removed for good.'}</p>
    </Modal>
  );
}

/* % off each class plan (needs pricing.write, plus catalogue.write or coupons.write to send it) */
function ClassDiscounts({ classesQ }) {
  const { can, toast } = useDash();
  const [vals, setVals] = useState({});
  const [busy, setBusy] = useState(false);
  const classes = (classesQ.data && classesQ.data.classes) || [];
  const mayPrice = can('pricing.write') && (can('catalogue.write') || can('coupons.write'));
  if (!can('catalogue.read')) return null;
  const changed = classes.filter(c => vals[c.id] !== undefined && Number(vals[c.id]) !== c.discountPct);
  const save = async () => {
    const bad = changed.find(c => !(Number(vals[c.id]) >= 0 && Number(vals[c.id]) <= 90));
    if (bad) { toast('A class discount is from 0 to 90 percent'); return; }
    setBusy(true);
    try {
      if (can('catalogue.write')) await staffApi('PUT', '/api/admin/classes', { classes: changed.map(c => ({ id: c.id, discountPct: Number(vals[c.id]) })) });
      else await staffApi('PUT', '/api/admin/coupons', { discounts: Object.fromEntries(classes.map(c => [c.id, vals[c.id] !== undefined ? Number(vals[c.id]) : c.discountPct])) });
      await classesQ.reload(true); setVals({}); toast('Discounts saved');
    } catch (e) { toast(problem(e)); }
    setBusy(false);
  };
  return (
    <section className="panel"><p className="eyebrow">Class plan discounts</p>
      <p className="auth-sub">% off a class plan. Checkout shows the old price struck through.{mayPrice ? '' : ' Your role cannot change prices.'}</p>
      {classesQ.error ? <ErrorNote error={classesQ.error} onRetry={classesQ.reload} compact /> : null}
      <DataTable plain head={['Class', 'Shown in the shop', 'Discount %']} empty={classesQ.loading ? 'Loading…' : 'No classes yet.'}
        rows={classes.map(c => ({ key: c.id, cells: [c.name, c.status === 'available' ? 'Yes' : c.status === 'coming_soon' ? 'Coming soon' : 'Hidden',
          <input key="d" type="number" min="0" max="90" step="0.5" className="num-input" aria-label={'Discount for ' + c.name} disabled={!mayPrice || busy} value={vals[c.id] !== undefined ? vals[c.id] : c.discountPct} onChange={e => setVals(v => ({ ...v, [c.id]: e.target.value }))} />] }))} />
      {mayPrice && changed.length ? <div className="btn-row"><button type="button" className="btn btn-primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save ' + plural(changed.length, 'discount')}</button><button type="button" className="btn btn-ghost" disabled={busy} onClick={() => setVals({})}>Undo</button></div> : null}
    </section>
  );
}
