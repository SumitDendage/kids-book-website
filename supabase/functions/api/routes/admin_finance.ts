// Staff money page: what came in (paid orders), what went back (refunds), what was given away
// (coupon discounts), the costs staff typed in (expenses) and so the profit or loss, per month.
// Expenses are the only thing written here; every write is audited (before/after) in the same
// transaction. Orders and payments are only read.
import type { Router } from '../lib/router.ts';
import type { Ctx } from '../lib/context.ts';
import { tx, type Tx } from '../lib/db.ts';
import { HttpError, intParam, readJson } from '../lib/http.ts';
import { requireStaff } from '../lib/auth.ts';
import { audit } from '../lib/guard.ts';
import { cleanText } from '../lib/util.ts';
import { tzOf } from '../services/analytics.ts';

const READ = ['analytics.read', 'orders.read'];
const WRITE = 'settings.write';
export const EXPENSE_CATEGORIES = ['hosting', 'ads', 'fees', 'tools', 'printing', 'salary', 'other'] as const;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_AMOUNT = 10_000_000;

const invalid = (errors: Record<string, string>) => new HttpError(400, Object.values(errors)[0], { errors });
const round2 = (n: number) => Math.round(n * 100) / 100;

type ExpenseRow = {
  id: string; spent_on: string; category: string; amount_inr: number; note: string;
  created_at: Date; created_by_email: string | null; updated_at: Date;
};
const expenseView = (e: ExpenseRow) => ({
  id: e.id, spentOn: e.spent_on, category: e.category, amountInr: Number(e.amount_inr), note: e.note,
  createdAt: new Date(e.created_at).getTime(), createdBy: e.created_by_email, updatedAt: new Date(e.updated_at).getTime(),
});
const snapshot = (e: ExpenseRow | null) => (e ? { spentOn: e.spent_on, category: e.category, amountInr: Number(e.amount_inr), note: e.note } : null);

async function loadExpense(q: Tx, id: string, lock = false): Promise<ExpenseRow | null> {
  const rows = lock
    ? await q<ExpenseRow[]>`
        select e.id, e.spent_on::text as spent_on, e.category, e.amount_inr::float8 as amount_inr, e.note, e.created_at,
               null::text as created_by_email, e.updated_at
        from expenses e where e.id = ${id}::uuid for update`
    : await q<ExpenseRow[]>`
        select e.id, e.spent_on::text as spent_on, e.category, e.amount_inr::float8 as amount_inr, e.note, e.created_at,
               p.email::text as created_by_email, e.updated_at
        from expenses e left join profiles p on p.id = e.created_by where e.id = ${id}::uuid`;
  return rows[0] ?? null;
}

/** The fields of an expense from a request body. `partial` (an edit) lets fields be left out. */
function parseExpense(b: Record<string, unknown>, partial: boolean) {
  const out: { spent_on?: string; category?: string; amount_inr?: number; note?: string } = {};
  const errors: Record<string, string> = {};
  if (b.spentOn !== undefined || !partial) {
    const d = String(b.spentOn ?? '').trim();
    const t = DATE_RE.test(d) ? Date.parse(d + 'T00:00:00Z') : NaN;
    if (!Number.isFinite(t) || new Date(t).toISOString().slice(0, 10) !== d) errors.spentOn = 'Pick the date the money was spent.';
    else if (t > Date.now() + 2 * 86_400_000) errors.spentOn = 'The date cannot be in the future.';
    else if (t < Date.parse('2000-01-01T00:00:00Z')) errors.spentOn = 'The date is too far in the past.';
    else out.spent_on = d;
  }
  if (b.category !== undefined || !partial) {
    const c = String(b.category ?? '').trim();
    if (!(EXPENSE_CATEGORIES as readonly string[]).includes(c)) errors.category = 'Pick what the money was spent on.';
    else out.category = c;
  }
  if (b.amountInr !== undefined || !partial) {
    const n = Number(b.amountInr);
    if (!Number.isFinite(n) || n <= 0 || n > MAX_AMOUNT) errors.amountInr = 'The amount is in rupees, above 0 and at most 1,00,00,000.';
    else out.amount_inr = round2(n);
  }
  if (b.note !== undefined) out.note = cleanText(b.note, 300);
  else if (!partial) out.note = '';
  if (Object.keys(errors).length) throw invalid(errors);
  return out;
}

function idParam(ctx: Ctx) {
  const id = (ctx.params.id ?? '').trim();
  if (!UUID_RE.test(id)) throw new HttpError(404, 'No such expense.', { code: 'not_found' });
  return id;
}

// ── GET /api/admin/finance?months=12&tz= ─────────────────────────────────────────────────

type MonthRow = { month: string; gross_inr: number; paid: number; discount_inr: number; refunded_inr: number; refunds: number; expenses_inr: number };

async function finance(ctx: Ctx) {
  await requireStaff(ctx, READ);
  const tz = tzOf(ctx.query.get('tz'));
  const months = intParam(ctx.query.get('months'), 12, 1, 36);
  return await tx(async (q) => {
    // money in counts every order that was paid (later refunds included) in the month it was paid;
    // a refund counts in the month it was made, so an old month's figures never change afterwards
    const rows = await q<MonthRow[]>`
      with m as (
        select generate_series(date_trunc('month', (now() at time zone ${tz}::text)) - make_interval(months => ${months - 1}),
                               date_trunc('month', (now() at time zone ${tz}::text)), interval '1 month')::date as month
      ),
      paid as (
        select date_trunc('month', paid_at at time zone ${tz}::text)::date as month,
               sum(total_inr)::float8 as gross_inr, count(*)::int as paid, sum(discount_inr)::float8 as discount_inr
        from orders where status in ('paid', 'refunded') and paid_at is not null group by 1
      ),
      ref as (
        select date_trunc('month', refunded_at at time zone ${tz}::text)::date as month,
               sum(total_inr)::float8 as refunded_inr, count(*)::int as refunds
        from orders where status = 'refunded' and refunded_at is not null group by 1
      ),
      ex as (
        select date_trunc('month', spent_on)::date as month, sum(amount_inr)::float8 as expenses_inr from expenses group by 1
      )
      select to_char(m.month, 'YYYY-MM') as month,
             coalesce(paid.gross_inr, 0)::float8 as gross_inr, coalesce(paid.paid, 0)::int as paid,
             coalesce(paid.discount_inr, 0)::float8 as discount_inr,
             coalesce(ref.refunded_inr, 0)::float8 as refunded_inr, coalesce(ref.refunds, 0)::int as refunds,
             coalesce(ex.expenses_inr, 0)::float8 as expenses_inr
      from m left join paid using (month) left join ref using (month) left join ex using (month)
      order by m.month`;
    const all = (await q<{ gross_inr: number; paid: number; discount_inr: number; refunded_inr: number; refunds: number; expenses_inr: number }[]>`
      select coalesce((select sum(total_inr) from orders where status in ('paid', 'refunded') and paid_at is not null), 0)::float8 as gross_inr,
             (select count(*) from orders where status in ('paid', 'refunded') and paid_at is not null)::int as paid,
             coalesce((select sum(discount_inr) from orders where status in ('paid', 'refunded') and paid_at is not null), 0)::float8 as discount_inr,
             coalesce((select sum(total_inr) from orders where status = 'refunded'), 0)::float8 as refunded_inr,
             (select count(*) from orders where status = 'refunded')::int as refunds,
             coalesce((select sum(amount_inr) from expenses), 0)::float8 as expenses_inr`)[0];
    const byCategory = await q<{ category: string; amount_inr: number; n: number }[]>`
      select category, sum(amount_inr)::float8 as amount_inr, count(*)::int as n from expenses group by category order by 2 desc`;
    const list = await q<ExpenseRow[]>`
      select e.id, e.spent_on::text as spent_on, e.category, e.amount_inr::float8 as amount_inr, e.note, e.created_at,
             p.email::text as created_by_email, e.updated_at
      from expenses e left join profiles p on p.id = e.created_by
      order by e.spent_on desc, e.created_at desc limit 200`;
    const money = (r: { gross_inr: number; paid: number; discount_inr: number; refunded_inr: number; refunds: number; expenses_inr: number }) => {
      const net = round2(r.gross_inr - r.refunded_inr);
      return {
        revenueInr: round2(r.gross_inr), paidOrders: r.paid, discountsInr: round2(r.discount_inr),
        refundedInr: round2(r.refunded_inr), refunds: r.refunds, netInr: net,
        expensesInr: round2(r.expenses_inr), profitInr: round2(net - r.expenses_inr),
      };
    };
    return {
      tz, months: rows.map((r) => ({ month: r.month, ...money(r) })), totals: money(all),
      byCategory: byCategory.map((c) => ({ category: c.category, amountInr: round2(c.amount_inr), count: c.n })),
      expenses: list.map(expenseView), categories: EXPENSE_CATEGORIES, generatedAt: Date.now(),
    };
  });
}

// ── POST /api/admin/expenses, PATCH and DELETE /api/admin/expenses/:id ─────────────────

async function createExpense(ctx: Ctx) {
  const u = await requireStaff(ctx, WRITE);
  const v = parseExpense(await readJson(ctx.req, 4 * 1024), false);
  const row = await tx(async (q) => {
    const id = (await q<{ id: string }[]>`
      insert into expenses (spent_on, category, amount_inr, note, created_by, updated_by)
      values (${v.spent_on!}::date, ${v.category!}, ${v.amount_inr!}, ${v.note ?? ''}, ${u.id}, ${u.id}) returning id`)[0].id;
    const after = await loadExpense(q, id);
    await audit(ctx, { action: 'expense.create', targetType: 'expense', targetId: id, detail: { before: null, after: snapshot(after) } }, q);
    return after!;
  });
  return { ok: true, expense: expenseView(row) };
}

async function updateExpense(ctx: Ctx) {
  const u = await requireStaff(ctx, WRITE);
  const id = idParam(ctx);
  const v = parseExpense(await readJson(ctx.req, 4 * 1024), true);
  const row = await tx(async (q) => {
    const before = await loadExpense(q, id, true);
    if (!before) throw new HttpError(404, 'No such expense.', { code: 'not_found' });
    await q`
      update expenses set spent_on = coalesce(${v.spent_on ?? null}::date, spent_on), category = coalesce(${v.category ?? null}, category),
        amount_inr = coalesce(${v.amount_inr ?? null}::numeric, amount_inr), note = coalesce(${v.note ?? null}, note), updated_by = ${u.id}
      where id = ${id}::uuid`;
    const after = await loadExpense(q, id);
    await audit(ctx, { action: 'expense.update', targetType: 'expense', targetId: id, detail: { before: snapshot(before), after: snapshot(after) } }, q);
    return after!;
  });
  return { ok: true, expense: expenseView(row) };
}

async function deleteExpense(ctx: Ctx) {
  await requireStaff(ctx, WRITE);
  const id = idParam(ctx);
  await tx(async (q) => {
    const before = await loadExpense(q, id, true);
    if (!before) throw new HttpError(404, 'No such expense.', { code: 'not_found' });
    await q`delete from expenses where id = ${id}::uuid`;
    await audit(ctx, { action: 'expense.delete', targetType: 'expense', targetId: id, detail: { before: snapshot(before), after: null } }, q);
  });
  return { ok: true, deleted: true };
}

export function register(r: Router) {
  r.get('/api/admin/finance', finance);
  r.post('/api/admin/expenses', createExpense);
  r.patch('/api/admin/expenses/:id', updateExpense);
  r.delete('/api/admin/expenses/:id', deleteExpense);
}
