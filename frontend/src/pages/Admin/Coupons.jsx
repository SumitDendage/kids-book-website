import DataTable from '../../components/dashboard/DataTable.jsx';
import Icon from '../../components/dashboard/Icon.jsx';
import { useDash } from '../Portal/DashContext.js';
import { save, log } from '../Portal/dashboard.js';
import { read } from '../../services/storage.js';
import { CLASSES, classById } from '../../data/content.js';

/* coupon codes customers type at checkout, and % off per class plan */
export default function Coupons() {
  const { refresh, toast } = useDash();
  const cps = read('lww_coupons', []), ds = read('lww_discounts', {});
  const add = e => {
    e.preventDefault();
    const f = new FormData(e.currentTarget), code = String(f.get('code')).trim().toUpperCase(); if (!code) return;
    const next = read('lww_coupons', []).filter(c => c.code !== code);
    next.push({ code, pct: Math.min(100, parseInt(f.get('pct'), 10) || 10), max: parseInt(f.get('max'), 10) || 0, uses: 0, active: true });
    save('lww_coupons', next); log('coupon added', code); e.currentTarget.reset(); refresh();
  };
  const toggle = (code, on) => { const all = read('lww_coupons', []), c = all.find(x => x.code === code); if (c) { c.active = on; save('lww_coupons', all); log('coupon ' + (on ? 'enabled' : 'disabled'), code); refresh(); } };
  const remove = code => { save('lww_coupons', read('lww_coupons', []).filter(c => c.code !== code)); log('coupon deleted', code); refresh(); };
  /* saved when the value is committed (blur / Enter), like the old change event — not on every keystroke */
  const discount = (id, value) => { const all = read('lww_discounts', {}), v = Math.max(0, Math.min(90, parseInt(value, 10) || 0)); if ((all[id] || 0) === v) return; all[id] = v; save('lww_discounts', all); log('discount set', classById(id).label + ' ' + v + '%'); toast('Discount saved'); };
  return (
    <>
      <section className="panel"><p className="eyebrow">Coupons</p><p className="auth-sub">Customers type the code at checkout.</p>
        <form className="row-form" onSubmit={add}><input name="code" placeholder="CODE" aria-label="Coupon code" style={{ textTransform: 'uppercase' }} required /><input name="pct" type="number" min="1" max="100" placeholder="% off" aria-label="Percent off" required /><input name="max" type="number" min="0" placeholder="Max uses (blank = ∞)" aria-label="Max uses" /><button type="submit" className="btn btn-primary"><Icon id="plus" />Add coupon</button></form>
        <DataTable plain head={['Code', '% off', 'Uses', 'Active', '']} empty="No coupons yet."
          rows={cps.map(c => ({ key: c.code, cells: [<b key="c">{c.code}</b>, c.pct + '%', (c.uses || 0) + (c.max ? ' / ' + c.max : ''), <label key="a" className="check"><input type="checkbox" checked={c.active !== false} onChange={e => toggle(c.code, e.target.checked)} /> on</label>, <button key="d" type="button" className="link btn-danger" onClick={() => remove(c.code)}>Delete</button>] }))} />
      </section>
      <section className="panel"><p className="eyebrow">Discounts</p><p className="auth-sub">% off a class plan — shows as a struck-through price at checkout.</p>
        <DataTable plain head={['Class', 'Discount %']} empty="" rows={CLASSES.map(c => ({ key: c.id, cells: [c.label, <input key="d" type="number" min="0" max="90" defaultValue={ds[c.id] || 0} aria-label={'Discount for ' + c.label} onBlur={e => discount(c.id, e.target.value)} onKeyDown={e => { if (e.key === 'Enter') discount(c.id, e.target.value); }} />] }))} />
      </section>
    </>
  );
}
