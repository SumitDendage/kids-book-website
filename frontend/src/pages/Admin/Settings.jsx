import { useState } from 'react';
import DataTable from '../../components/dashboard/DataTable.jsx';
import Icon from '../../components/dashboard/Icon.jsx';
import { Guard, ErrorNote } from '../../components/dashboard/States.jsx';
import { useDash } from '../Portal/DashContext.js';
import { useStaffGet, fmt, problem, fieldErrors } from '../Portal/dashboard.js';
import { staffApi } from '../../services/api.js';

/* Settings: every rule the shop runs on, from the server (GET /api/admin/settings). Each card saves
   its own setting (PUT /api/admin/settings/:key); a card you may not change is shown read-only. */
export default function Settings() {
  const q = useStaffGet('/api/admin/settings', { keep: true });
  const d = q.data;
  const st = (d && d.settings) || {};
  const has = k => !!st[k];
  return (
    <Guard state={q} rows={8}>
      {q.error ? <ErrorNote error={q.error} onRetry={q.reload} compact /> : null}
      {d ? <>
        <p className="eyebrow group-head">Prices and access</p>
        {has('prints') ? <SettingCard q={q} k="prints" title="Prints per sheet"
          intro="How many times a customer can print each sheet they have, by the account type they chose. A sheet set to its own number under Products keeps that number."
          fields={[{ name: 'parent', label: 'Parents', type: 'int', min: 0, max: 1000 }, { name: 'teacher', label: 'Teachers', type: 'int', min: 0, max: 1000 },
            { name: 'organization', label: 'Organizations', type: 'int', min: 0, max: 1000, help: 'Schools, tuition centres and other groups. 0 means view only.' }]} /> : null}
        <Plans q={q} />
        {has('currency_rates') ? <Rates q={q} /> : null}
        {has('fees') ? <SettingCard q={q} k="fees" title="Payment fees" intro="Added to the price at checkout to cover the payment service."
          fields={[{ name: 'IN.pct', label: 'India: percent', type: 'dec', min: 0, max: 50, step: 0.01 }, { name: 'IN.fixed', label: 'India: plus rupees', type: 'dec', min: 0, max: 10000, step: 0.01 },
            { name: 'INTL.pct', label: 'Other countries: percent', type: 'dec', min: 0, max: 50, step: 0.01 }, { name: 'INTL.fixed', label: 'Other countries: plus US dollars', type: 'dec', min: 0, max: 1000, step: 0.01 }]} /> : null}
        {has('countries') ? <Taxes q={q} /> : null}
        {has('quote') ? <SettingCard q={q} k="quote" title="Price quotes" intro="The price a customer sees at checkout is held for this long while they pay."
          fields={[{ name: 'ttlMinutes', label: 'Minutes', type: 'int', min: 5, max: 1440 }]} /> : null}

        {has('sessions') || has('login') || has('auth_links') || has('viewer') ? <p className="eyebrow group-head">Signing in and the viewer</p> : null}
        {has('sessions') ? <SettingCard q={q} k="sessions" title="How long a sign-in lasts" intro="For customers and staff."
          fields={[{ name: 'rememberDays', label: 'With "Keep me signed in": days', type: 'int', min: 1, max: 365 }, { name: 'shortHours', label: 'Without it: hours', type: 'int', min: 1, max: 168 }, { name: 'maxDays', label: 'Never longer than: days', type: 'int', min: 1, max: 365 }]} /> : null}
        {has('login') ? <SettingCard q={q} k="login" title="Wrong passwords" intro="After this many wrong passwords in a row, the account waits before it can try again."
          fields={[{ name: 'maxFailed', label: 'Wrong passwords allowed', type: 'int', min: 3, max: 50 }, { name: 'lockMinutes', label: 'Then wait: minutes', type: 'int', min: 1, max: 1440 }]} /> : null}
        {has('auth_links') ? <SettingCard q={q} k="auth_links" title="Email links" intro="How long the links in our emails keep working."
          fields={[{ name: 'verifyHours', label: 'Confirm email: hours', type: 'int', min: 1, max: 168 }, { name: 'resetMinutes', label: 'Reset password: minutes', type: 'int', min: 5, max: 1440 }]} /> : null}
        {has('viewer') ? <SettingCard q={q} k="viewer" title="Sheet viewer" intro="An open sheet checks again that the customer still has access, so taking access away closes it soon."
          fields={[{ name: 'tokenHours', label: 'One opened tab works for: hours', type: 'int', min: 1, max: 72 }, { name: 'recheckSeconds', label: 'Check access again every: seconds', type: 'int', min: 15, max: 3600 }]} /> : null}

        {has('contact') || has('email') || has('agreement') || has('security') ? <p className="eyebrow group-head">Email and account safety</p> : null}
        {has('contact') ? <SettingCard q={q} k="contact" title="Contact form" intro="Notes sent through Contact us are also emailed here."
          fields={[{ name: 'inbox', label: 'Shop inbox', type: 'email' }]} /> : null}
        {has('email') ? <SettingCard q={q} k="email" title="Emails we send"
          fields={[{ name: 'fromName', label: 'Sender name', type: 'text', max: 60 }, { name: 'adminAlerts', label: 'Staff alerts go to', type: 'list', help: 'Up to 10 addresses, separated by commas. They hear about new appeals, sharing cases and failed payments.' }]} /> : null}
        {has('agreement') ? <SettingCard q={q} k="agreement" title="Account sharing agreement" intro="Every customer accepts this when they sign up. When you change the words, change the version too, so everyone accepts the new text."
          fields={[{ name: 'version', label: 'Version', type: 'text', max: 40 }, { name: 'text', label: 'Text', type: 'area', max: 2000 }]} /> : null}
        {has('security') ? <SettingCard q={q} k="security" title="Sharing warnings" intro="Warnings for account sharing. When a customer reaches the limit, their paid access can pause on its own."
          fields={[{ name: 'maxWarnings', label: 'Warnings before paid access pauses', type: 'int', min: 1, max: 20 }, { name: 'warningExpiryDays', label: 'A warning stops counting after: days', type: 'int', min: 1, max: 3650 }, { name: 'autoSuspend', label: 'Pause paid access on its own at the limit', type: 'bool' }]} /> : null}
      </> : null}
    </Guard>
  );
}

/* the server's field messages for one card: "IN.pct" or "days" */
const errFor = (errs, name) => errs[name] || errs[name.split('.').pop()] || null;
const getPath = (o, path) => path.split('.').reduce((x, k) => (x == null ? x : x[k]), o);
function setPath(o, path, v) { const keys = path.split('.'); let x = o; keys.slice(0, -1).forEach(k => { x[k] = Object.assign({}, x[k]); x = x[k]; }); x[keys[keys.length - 1]] = v; }

/* one setting as a small form */
function SettingCard({ q, k, title, intro, fields }) {
  const { toast } = useDash();
  const s = q.data.settings[k];
  const [busy, setBusy] = useState(false), [errs, setErrs] = useState({}), [err, setErr] = useState(null);
  const submit = async e => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const value = JSON.parse(JSON.stringify(s.value));
    for (const fd of fields) {
      const raw = f.get(fd.name);
      let v;
      if (fd.type === 'bool') v = raw === 'on';
      else if (fd.type === 'int' || fd.type === 'dec') v = String(raw ?? '').trim() === '' ? NaN : Number(raw);
      else if (fd.type === 'list') v = String(raw || '').split(/[\s,]+/).map(x => x.trim().toLowerCase()).filter(Boolean);
      else v = String(raw ?? '').trim();
      setPath(value, fd.name, v);
    }
    setBusy(true); setErr(null); setErrs({});
    try {
      const r = await staffApi('PUT', '/api/admin/settings/' + k, { value });
      q.setData(d => ({ ...d, settings: { ...d.settings, [k]: { ...d.settings[k], value: r.value, updatedAt: Date.now() } } }));
      toast(title + ': saved');
    } catch (x) { const fe = fieldErrors(x); setErrs(fe); setErr(Object.keys(fe).length ? 'Please check the values marked in red.' : problem(x)); }
    setBusy(false);
  };
  const ro = !s.editable;
  return (
    <section className="panel setting">
      <div className="row-between"><div><p className="eyebrow">{title}</p>{intro ? <p className="auth-sub">{intro}</p> : null}</div>
        <small className="muted">{s.updatedAt ? 'Changed ' + fmt(s.updatedAt) : ''}</small></div>
      <form key={JSON.stringify(s.value)} onSubmit={submit} noValidate>
        <fieldset className="fs plain" disabled={ro || busy}>
          <div className={fields.length > 1 ? 'grid-3' : 'grid-3 one'}>
            {fields.map(fd => {
              const id = 'set-' + k + '-' + fd.name.replace('.', '-'), cur = getPath(s.value, fd.name), e = errFor(errs, fd.name);
              if (fd.type === 'bool') return <label key={fd.name} className="check"><input type="checkbox" name={fd.name} defaultChecked={!!cur} />{fd.label}</label>;
              return (
                <div key={fd.name} className={'field' + (fd.type === 'area' ? ' wide' : '')}><label htmlFor={id}>{fd.label}</label>
                  {fd.type === 'area' ? <textarea id={id} name={fd.name} maxLength={fd.max} defaultValue={cur || ''} rows={3} />
                    : <input id={id} name={fd.name} type={fd.type === 'int' || fd.type === 'dec' ? 'number' : fd.type === 'email' ? 'email' : 'text'} min={fd.min} max={fd.type === 'int' || fd.type === 'dec' ? fd.max : undefined} maxLength={fd.type === 'text' ? fd.max : undefined} step={fd.type === 'dec' ? fd.step || 'any' : fd.type === 'int' ? 1 : undefined} defaultValue={Array.isArray(cur) ? cur.join(', ') : cur == null ? '' : cur} aria-invalid={!!e} />}
                  {fd.help ? <small>{fd.help}</small> : null}{e ? <small className="bad">{e}</small> : null}
                </div>
              );
            })}
          </div>
        </fieldset>
        {err ? <div className="st-note err compact" role="alert"><Icon id="alert" size={16} /><span>{err}</span></div> : null}
        {ro ? <p className="auth-sub">Your role cannot change this.</p> : <div className="btn-row"><button type="submit" className="btn btn-primary btn-sm" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button></div>}
      </form>
    </section>
  );
}

/* class plan prices (PUT /api/admin/plans, needs pricing.write) */
function Plans({ q }) {
  const { can, toast } = useDash();
  const plans = q.data.planList || [];
  const [vals, setVals] = useState({});
  const [busy, setBusy] = useState(false), [err, setErr] = useState(null);
  const mayEdit = can('pricing.write');
  if (!plans.length) return null;
  const v = (p, f) => (vals[p.id] && vals[p.id][f] !== undefined ? vals[p.id][f] : p[f]);
  const set = (p, f, x) => setVals(cur => ({ ...cur, [p.id]: { ...(cur[p.id] || {}), [f]: x } }));
  const changed = plans.filter(p => vals[p.id]);
  const save = async () => {
    setBusy(true); setErr(null);
    try {
      const body = { plans: changed.map(p => ({ id: p.id, label: String(v(p, 'label')).trim(), price: Number(v(p, 'price')), note: String(v(p, 'note') || '').trim() || null, active: !!v(p, 'active'), regions: v(p, 'regions') })) };
      await staffApi('PUT', '/api/admin/plans', body);
      await q.reload(true); setVals({}); toast('Plan prices saved');
    } catch (x) { const fe = fieldErrors(x); setErr(Object.values(fe)[0] || problem(x)); }
    setBusy(false);
  };
  const regionToggle = (p, r, on) => { const cur = new Set(v(p, 'regions') || []); if (on) cur.add(r); else cur.delete(r); set(p, 'regions', ['IN', 'INTL'].filter(x => cur.has(x))); };
  return (
    <section className="panel setting"><p className="eyebrow">Class plan prices</p>
      <p className="auth-sub">A class plan opens every sheet of one class for its number of months. Prices are in rupees; other currencies use the rates below.{mayEdit ? '' : ' Your role cannot change prices.'}</p>
      <DataTable plain head={['Plan', 'Months', 'Price ₹', 'Note', 'Sold in', 'On sale']} empty=""
        rows={plans.map(p => ({ key: p.id, cells: [
          <input key="l" aria-label={'Name of ' + p.id} value={v(p, 'label')} maxLength={40} disabled={!mayEdit || busy} onChange={e => set(p, 'label', e.target.value)} />,
          p.months,
          <input key="p" type="number" min="0" step="1" className="num-input" aria-label={'Price of ' + p.label} value={v(p, 'price')} disabled={!mayEdit || busy} onChange={e => set(p, 'price', e.target.value)} />,
          <input key="n" aria-label={'Note for ' + p.label} value={v(p, 'note') || ''} maxLength={60} placeholder="e.g. best value" disabled={!mayEdit || busy} onChange={e => set(p, 'note', e.target.value)} />,
          <span key="r" className="btn-row tight">{[['IN', 'India'], ['INTL', 'Elsewhere']].map(([r, l]) => <label key={r} className="check"><input type="checkbox" checked={(v(p, 'regions') || []).includes(r)} disabled={!mayEdit || busy} onChange={e => regionToggle(p, r, e.target.checked)} />{l}</label>)}</span>,
          <input key="a" type="checkbox" aria-label={p.label + ' on sale'} checked={!!v(p, 'active')} disabled={!mayEdit || busy} onChange={e => set(p, 'active', e.target.checked)} />,
        ] }))} />
      {err ? <div className="st-note err compact" role="alert"><Icon id="alert" size={16} /><span>{err}</span></div> : null}
      {mayEdit && changed.length ? <div className="btn-row"><button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save plan prices'}</button><button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => { setVals({}); setErr(null); }}>Undo</button></div> : null}
    </section>
  );
}

/* currency rates: how much one rupee is in each currency */
function Rates({ q }) {
  const { toast } = useDash();
  const s = q.data.settings.currency_rates;
  const [vals, setVals] = useState({}), [add, setAdd] = useState({ code: '', rate: '' });
  const [busy, setBusy] = useState(false), [errs, setErrs] = useState({}), [err, setErr] = useState(null);
  const codes = Object.keys(s.value).filter(c => c !== 'INR');
  const save = async extra => {
    const value = { INR: 1 };
    codes.forEach(c => { value[c] = Number(vals[c] !== undefined ? vals[c] : s.value[c]); });
    if (extra) value[extra.code] = Number(extra.rate);
    setBusy(true); setErr(null); setErrs({});
    try {
      const r = await staffApi('PUT', '/api/admin/settings/currency_rates', { value });
      q.setData(d => ({ ...d, rates: r.value, settings: { ...d.settings, currency_rates: { ...d.settings.currency_rates, value: r.value, updatedAt: Date.now() } } }));
      setVals({}); setAdd({ code: '', rate: '' }); toast('Currency rates saved');
    } catch (x) { const fe = fieldErrors(x); setErrs(fe); setErr(Object.keys(fe).length ? 'Please check the rates marked in red.' : problem(x)); }
    setBusy(false);
  };
  const ro = !s.editable;
  return (
    <section className="panel setting">
      <div className="row-between"><div><p className="eyebrow">Currency rates</p><p className="auth-sub">How much one rupee is in each currency. Customers abroad see prices in their own currency with these.</p></div><small className="muted">{s.updatedAt ? 'Changed ' + fmt(s.updatedAt) : ''}</small></div>
      <div className="rate-grid">{codes.map(c => (
        <div key={c} className="field"><label htmlFor={'rate-' + c}>₹1 in {c}</label><input id={'rate-' + c} type="number" min="0" step="any" disabled={ro || busy} value={vals[c] !== undefined ? vals[c] : s.value[c]} onChange={e => setVals(v => ({ ...v, [c]: e.target.value }))} aria-invalid={!!errs[c]} />{errs[c] ? <small className="bad">{errs[c]}</small> : null}</div>
      ))}</div>
      {err ? <div className="st-note err compact" role="alert"><Icon id="alert" size={16} /><span>{err}</span></div> : null}
      {ro ? <p className="auth-sub">Your role cannot change this.</p> : <div className="btn-row">
        <button type="button" className="btn btn-primary btn-sm" disabled={busy || !Object.keys(vals).length} onClick={() => save()}>{busy ? 'Saving…' : 'Save rates'}</button>
        <span className="inline-field rate-add"><input aria-label="New currency code" placeholder="Code, e.g. CHF" maxLength={3} value={add.code} onChange={e => setAdd(a => ({ ...a, code: e.target.value.toUpperCase().replace(/[^A-Z]/g, '') }))} /><input aria-label="Rate for the new currency" type="number" min="0" step="any" placeholder="Rate" value={add.rate} onChange={e => setAdd(a => ({ ...a, rate: e.target.value }))} />
          <button type="button" className="btn btn-ghost btn-sm" disabled={busy || add.code.length !== 3 || !(Number(add.rate) > 0)} onClick={() => save(add)}><Icon id="plus" size={14} />Add</button></span>
      </div>}
    </section>
  );
}

/* tax per country (the rest of each country's checkout details stay as they are) */
function Taxes({ q }) {
  const { toast } = useDash();
  const s = q.data.settings.countries;
  const [vals, setVals] = useState({});
  const [busy, setBusy] = useState(false), [err, setErr] = useState(null);
  const list = Array.isArray(s.value) ? s.value : [];
  const v = (c, f) => (vals[c.code] && vals[c.code][f] !== undefined ? vals[c.code][f] : (c.tax || {})[f]);
  const set = (c, f, x) => setVals(cur => ({ ...cur, [c.code]: { ...(cur[c.code] || {}), [f]: x } }));
  const save = async () => {
    const value = list.map(c => (vals[c.code] ? { ...c, tax: { label: String(v(c, 'label')).trim(), pct: Number(v(c, 'pct')) } } : c));
    setBusy(true); setErr(null);
    try {
      const r = await staffApi('PUT', '/api/admin/settings/countries', { value });
      q.setData(d => ({ ...d, settings: { ...d.settings, countries: { ...d.settings.countries, value: r.value, updatedAt: Date.now() } } }));
      setVals({}); toast('Taxes saved');
    } catch (x) { const fe = fieldErrors(x); setErr(Object.keys(fe).length ? 'Please check the taxes: ' + Object.values(fe)[0] : problem(x)); }
    setBusy(false);
  };
  const ro = !s.editable;
  return (
    <section className="panel setting">
      <div className="row-between"><div><p className="eyebrow">Tax by country</p><p className="auth-sub">Added at checkout for customers in each country.</p></div><small className="muted">{s.updatedAt ? 'Changed ' + fmt(s.updatedAt) : ''}</small></div>
      <DataTable plain={list.length <= 10} head={['Country', 'Currency', 'Tax name', 'Tax %']} empty="No countries."
        rows={list.map(c => ({ key: c.code, cells: [c.name + (c.code === 'OTHER' ? '' : ' (' + c.code + ')'), c.currency,
          <input key="l" aria-label={'Tax name for ' + c.name} maxLength={60} disabled={ro || busy} value={v(c, 'label') || ''} onChange={e => set(c, 'label', e.target.value)} />,
          <input key="p" type="number" min="0" max="100" step="0.01" className="num-input" aria-label={'Tax percent for ' + c.name} disabled={ro || busy} value={v(c, 'pct') ?? 0} onChange={e => set(c, 'pct', e.target.value)} />] }))} />
      {err ? <div className="st-note err compact" role="alert"><Icon id="alert" size={16} /><span>{err}</span></div> : null}
      {!ro && Object.keys(vals).length ? <div className="btn-row"><button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save taxes'}</button><button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => { setVals({}); setErr(null); }}>Undo</button></div> : null}
    </section>
  );
}
