import { useState } from 'react';
import MetricCard from '../../components/dashboard/MetricCard.jsx';
import DataTable from '../../components/dashboard/DataTable.jsx';
import Icon from '../../components/dashboard/Icon.jsx';
import Modal from '../../components/dashboard/Modal.jsx';
import { LineChart, PosNegBars, Donut } from '../../components/dashboard/Charts.jsx';
import { Guard, ErrorNote } from '../../components/dashboard/States.jsx';
import { useDash } from '../Portal/DashContext.js';
import { useStaffGet, inr, qs, tzName, dateOnly, problem, fieldErrors, plural } from '../Portal/dashboard.js';
import { staffApi } from '../../services/api.js';

export const CATEGORY = { hosting: 'Website and hosting', ads: 'Ads and marketing', fees: 'Payment fees', tools: 'Apps and tools', printing: 'Printing and design', salary: 'People and salaries', other: 'Other' };
const RANGES = [[6, '6 months'], [12, '12 months'], [24, '2 years']];
const keep = { months: 12 };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthName = m => { const [y, mm] = String(m).split('-'); return MONTHS[Number(mm) - 1] + ' ' + y.slice(2); };
/* profit or loss in words: "₹1,200 profit" / "₹300 loss" */
const pl = v => (v < 0 ? inr(-v) + ' loss' : inr(v) + (v ? ' profit' : ''));
const today = () => { const d = new Date(); const p = n => String(n).padStart(2, '0'); return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); };

/* Money: what came in (paid orders), what went back (refunds), the costs staff type in, and so the
   profit or loss, per month (GET /api/admin/finance). Costs are added, changed and deleted here
   (POST / PATCH / DELETE /api/admin/expenses); orders are only read. */
export default function Money() {
  const { can, toast, go, allowed } = useDash();
  const [months, setMonthsState] = useState(keep.months);
  const setMonths = n => { keep.months = n; setMonthsState(n); };
  const q = useStaffGet('/api/admin/finance' + qs({ months, tz: tzName() }), { keep: true });
  const [edit, setEdit] = useState(null);   /* 'new' | expense */
  const [drop, setDrop] = useState(null);
  const canWrite = can('settings.write');
  const a = q.data;
  const t = a ? a.totals : null;
  const ms = a ? a.months || [] : [];
  const labels = ms.map(m => monthName(m.month));
  const thisMonth = ms.length ? ms[ms.length - 1] : null;
  const notLive = q.error && q.error.status === 404;
  const done = msg => { setEdit(null); setDrop(null); toast(msg); q.reload(); };

  return (
    <>
      <div className="row-between tabs-row">
        <div className="tabs-s">{allowed('overview') ? <button type="button" onClick={() => go('overview')}>Overview</button> : null}{allowed('analytics') ? <button type="button" onClick={() => go('analytics')}>Analytics</button> : null}<button type="button" className="on">Money</button></div>
        <div className="chips" role="group" aria-label="Period">{RANGES.map(([n, l]) => <button key={n} type="button" className={'chip' + (months === n ? ' on' : '')} onClick={() => setMonths(n)}>{l}</button>)}</div>
      </div>
      <p className="auth-sub range-note">Money in is every paid order, in the month it was paid. Refunds count in the month they were made. Costs are what you type in below.</p>
      {notLive ? <div className="st-note info"><Icon id="alert" size={16} /><span>The money page needs the server update that goes with it. It starts working as soon as that update is live.</span></div> : null}
      <Guard state={notLive ? { data: null, loading: false, error: null } : q} rows={6}>
        {q.error && !notLive ? <ErrorNote error={q.error} onRetry={q.reload} compact /> : null}
        {a ? <>
          <div className="kpi-row">
            <MetricCard label="Money in" value={inr(t.revenueInr)} sub={plural(t.paidOrders, 'paid order') + (t.discountsInr ? ' · ' + inr(t.discountsInr) + ' given as coupons' : '')} icon="rupee" trend={ms.map(m => m.revenueInr)} />
            <MetricCard label="Refunds (money back)" value={inr(t.refundedInr)} sub={plural(t.refunds, 'refund')} icon="card" trend={ms.map(m => m.refundedInr)} trendColor="var(--viz-2)" />
            <MetricCard label="Costs" value={inr(t.expensesInr)} sub={plural((a.expenses || []).length, 'cost') + ' typed in'} icon="file" trend={ms.map(m => m.expensesInr)} trendColor="var(--viz-4)" />
            <MetricCard label={t.profitInr < 0 ? 'Loss' : 'Profit'} value={(t.profitInr < 0 ? '−' : '') + inr(Math.abs(t.profitInr))} sub={thisMonth ? 'This month: ' + (pl(thisMonth.profitInr) || '₹0') : ''} icon="analytics" trend={ms.map(m => m.profitInr)} trendColor="var(--viz-3)" />
          </div>
          <div className="grid-2">
            <section className="panel"><p className="eyebrow">Profit or loss</p><p className="auth-sub">Each month: money in, minus refunds, minus costs. Point at a month to see it.</p>
              <PosNegBars series={ms.map(m => m.profitInr)} labels={labels} prefix="₹" empty="No money in or costs in this period yet." /></section>
            <section className="panel"><p className="eyebrow">Money in and costs</p><p className="auth-sub">Per month, in rupees.</p>
              <LineChart labels={labels} prefix="₹" series={[{ name: 'Money in', values: ms.map(m => m.revenueInr) }, { name: 'Costs', values: ms.map(m => m.expensesInr), color: 'var(--viz-4)' }, { name: 'Refunds', values: ms.map(m => m.refundedInr), color: 'var(--viz-2)' }]} empty="No money in or costs in this period yet." /></section>
          </div>
          <div className="grid-2">
            <section className="panel"><p className="eyebrow">Where the costs go</p><p className="auth-sub">All costs typed in so far, by kind.</p>
              <Donut parts={(a.byCategory || []).map(c => [CATEGORY[c.category] || c.category, c.amountInr])} center={inr(t.expensesInr)} sub="in costs" format={inr} empty="No costs typed in yet. Add one below." /></section>
            <section className="panel"><p className="eyebrow">All time</p>
              <div className="kv">
                <span>Money in (paid orders)</span><b>{inr(t.revenueInr)}</b>
                <span>Refunds (money back)</span><b>{t.refundedInr ? '−' + inr(t.refundedInr) : inr(0)}</b>
                <span>Money kept</span><b>{inr(t.netInr)}</b>
                <span>Costs</span><b>{t.expensesInr ? '−' + inr(t.expensesInr) : inr(0)}</b>
                <span>{t.profitInr < 0 ? 'Loss' : 'Profit'}</span><b style={{ color: t.profitInr < 0 ? 'var(--bad)' : t.profitInr > 0 ? 'var(--ok)' : undefined }}>{(t.profitInr < 0 ? '−' : '') + inr(Math.abs(t.profitInr))}</b>
                <span>Given away as coupon discounts</span><b>{inr(t.discountsInr)}</b>
              </div>
            </section>
          </div>
          <section className="panel"><p className="eyebrow">Month by month</p>
            <DataTable plain head={['Month', 'Money in', 'Refunds', 'Costs', 'Profit or loss']} empty=""
              rows={ms.slice().reverse().map(m => ({ key: m.month, cells: [monthName(m.month), inr(m.revenueInr), inr(m.refundedInr), inr(m.expensesInr), <b key="p" style={{ color: m.profitInr < 0 ? 'var(--bad)' : m.profitInr > 0 ? 'var(--ok)' : undefined }}>{(m.profitInr < 0 ? '−' : '') + inr(Math.abs(m.profitInr))}</b>] }))} />
          </section>
          <section className="panel">
            <div className="row-between"><div><p className="eyebrow">Costs</p><p className="auth-sub">Type in what you spend, such as hosting, ads or payment fees. {canWrite ? '' : 'Your role can see costs but not change them.'}</p></div>
              {canWrite ? <div className="btn-row"><button type="button" className="btn btn-primary" onClick={() => setEdit('new')} data-act="add-expense"><Icon id="plus" />Add a cost</button></div> : null}</div>
            <DataTable plain={(a.expenses || []).length <= 10} head={['Date', 'What for', 'Amount', 'Note', '']} empty="No costs yet. Press Add a cost to type in the first one."
              rows={(a.expenses || []).map(e => ({ key: e.id, cells: [dateOnly(e.spentOn + 'T00:00:00'), CATEGORY[e.category] || e.category, inr(e.amountInr), e.note || '', canWrite ? <span key="a" className="btn-row">
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEdit(e)}>Edit</button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDrop(e)}>Delete</button></span> : ''] }))} />
          </section>
        </> : null}
      </Guard>
      {edit ? <ExpenseForm expense={edit === 'new' ? null : edit} onClose={() => setEdit(null)} onDone={() => done(edit === 'new' ? 'Cost added' : 'Cost saved')} /> : null}
      {drop ? <DeleteExpense expense={drop} onClose={() => setDrop(null)} onDone={() => done('Cost deleted')} /> : null}
    </>
  );
}

function ExpenseForm({ expense, onClose, onDone }) {
  const e = expense || {};
  const [busy, setBusy] = useState(false), [err, setErr] = useState(null), [errs, setErrs] = useState({});
  const submit = async ev => {
    const f = new FormData(ev.currentTarget);
    const body = { spentOn: f.get('spentOn'), category: f.get('category'), amountInr: Number(f.get('amountInr')), note: String(f.get('note') || '').trim() };
    setBusy(true); setErr(null); setErrs({});
    try {
      if (expense) await staffApi('PATCH', '/api/admin/expenses/' + expense.id, body);
      else await staffApi('POST', '/api/admin/expenses', body);
      onDone();
    } catch (x) {
      const fe = fieldErrors(x); setErrs(fe);
      setErr(Object.keys(fe).length ? 'Please check the fields marked in red.' : problem(x)); setBusy(false);
    }
  };
  const fe = k => (errs[k] ? <small className="bad">{errs[k]}</small> : null);
  return (
    <Modal title={expense ? 'Edit this cost' : 'Add a cost'} onClose={onClose} onSubmit={submit} submitLabel={expense ? 'Save' : 'Add the cost'} busyLabel="Saving…" busy={busy} error={err}>
      <div className="grid-2">
        <div className="field"><label htmlFor="exDate">Date</label><input id="exDate" name="spentOn" type="date" required max={today()} defaultValue={e.spentOn || today()} />{fe('spentOn')}</div>
        <div className="field"><label htmlFor="exAmt">Amount ₹</label><input id="exAmt" name="amountInr" type="number" min="0.01" step="0.01" required defaultValue={e.amountInr || ''} placeholder="e.g. 499" />{fe('amountInr')}</div>
      </div>
      <div className="field"><label htmlFor="exCat">What it was for</label><select id="exCat" name="category" defaultValue={e.category || 'hosting'}>{Object.entries(CATEGORY).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>{fe('category')}</div>
      <div className="field"><label htmlFor="exNote">Note (optional)</label><input id="exNote" name="note" maxLength={300} defaultValue={e.note || ''} placeholder="e.g. Hostinger, one year" />{fe('note')}</div>
    </Modal>
  );
}

function DeleteExpense({ expense, onClose, onDone }) {
  const [busy, setBusy] = useState(false), [err, setErr] = useState(null);
  const submit = async () => {
    setBusy(true); setErr(null);
    try { await staffApi('DELETE', '/api/admin/expenses/' + expense.id); onDone(); }
    catch (x) { setErr(problem(x)); setBusy(false); }
  };
  return (
    <Modal title="Delete this cost?" onClose={onClose} onSubmit={submit} submitLabel="Delete it" busyLabel="Deleting…" danger busy={busy} error={err}>
      <p>{(CATEGORY[expense.category] || expense.category) + ', ' + inr(expense.amountInr) + ' on ' + dateOnly(expense.spentOn + 'T00:00:00')}. It is removed for good, and the profit goes up by that much.</p>
    </Modal>
  );
}
