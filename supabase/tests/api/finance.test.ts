// Staff money page (routes/admin_finance.ts): revenue, refunds, discounts, typed-in expenses and the
// profit or loss per month; expense create / edit / delete with permissions and the audit trail.
import { assert, assertEquals, assertStatus, startHarness, test } from './harness.ts';

const h = await startHarness();
let n = 0;

async function order(userId: string, totalInr: number, discountInr: number, paidAt: Date, refundedAt?: Date) {
  const id = 'LWO-FIN' + String(++n).padStart(5, '0');
  await h.sql`
    insert into orders (id, user_id, kind, status, currency, rate, total, total_inr, discount_inr, amount_minor, lines, method,
                        created_at, paid_at, refunded_at)
    values (${id}, ${userId}, 'worksheet', ${refundedAt ? 'refunded' : 'paid'}, 'INR', 1, ${totalInr}, ${totalInr}, ${discountInr},
            ${Math.round(totalInr * 100)}, ${h.sql.json([])}, 'razorpay', ${paidAt}, ${paidAt}, ${refundedAt ?? null})`;
  return id;
}
const monthOf = (d: Date) => d.toISOString().slice(0, 7);

test('an empty shop gives twelve zero months and no expenses', async () => {
  const owner = await h.staff('owner');
  const r = await h.call('GET', '/api/admin/finance?tz=UTC', { token: owner.token });
  assertStatus(r, 200);
  assertEquals(r.body.months.length, 12);
  assertEquals(r.body.months[11].month, monthOf(new Date()));
  assert(r.body.months.every((m: { revenueInr: number; profitInr: number }) => m.revenueInr === 0 && m.profitInr === 0));
  assertEquals(r.body.expenses, []);
  assertEquals(r.body.totals.profitInr, 0);
});

test('profit is money in minus refunds minus expenses, each in its own month', async () => {
  const owner = await h.staff('owner');
  const c = await h.customer();
  const now = new Date();
  await order(c.id, 100, 10, now);
  await order(c.id, 50, 0, now, now);
  const add = await h.call('POST', '/api/admin/expenses', { token: owner.token, body: { spentOn: now.toISOString().slice(0, 10), category: 'hosting', amountInr: 30.5, note: 'Hostinger' } });
  assertStatus(add, 200);
  assertEquals(add.body.expense.amountInr, 30.5);
  const r = await h.call('GET', '/api/admin/finance?tz=UTC&months=3', { token: owner.token });
  assertStatus(r, 200);
  assertEquals(r.body.months.length, 3);
  const m = r.body.months[2];
  assertEquals(m.revenueInr, 150);
  assertEquals(m.refundedInr, 50);
  assertEquals(m.netInr, 100);
  assertEquals(m.discountsInr, 10);
  assertEquals(m.expensesInr, 30.5);
  assertEquals(m.profitInr, 69.5);
  assertEquals(r.body.totals.profitInr, 69.5);
  assertEquals(r.body.byCategory[0].category, 'hosting');
  assertEquals(r.body.expenses[0].note, 'Hostinger');
  const log = await h.sql`select action from audit_logs where target_type = 'expense' and target_id = ${add.body.expense.id}`;
  assertEquals(log.map((x) => x.action), ['expense.create']);
});

test('expenses can be edited and deleted, and bad input is refused', async () => {
  const owner = await h.staff('owner');
  const bad = await h.call('POST', '/api/admin/expenses', { token: owner.token, body: { spentOn: '2026-02-30', category: 'nope', amountInr: -1 } });
  assertStatus(bad, 400);
  assert(bad.body.errors.spentOn && bad.body.errors.category && bad.body.errors.amountInr);
  const add = await h.call('POST', '/api/admin/expenses', { token: owner.token, body: { spentOn: '2026-01-15', category: 'ads', amountInr: 200 } });
  assertStatus(add, 200);
  const id = add.body.expense.id;
  const edit = await h.call('PATCH', '/api/admin/expenses/' + id, { token: owner.token, body: { amountInr: 250, note: 'Instagram' } });
  assertStatus(edit, 200);
  assertEquals(edit.body.expense.amountInr, 250);
  assertEquals(edit.body.expense.category, 'ads');
  const del = await h.call('DELETE', '/api/admin/expenses/' + id, { token: owner.token });
  assertStatus(del, 200);
  assertStatus(await h.call('DELETE', '/api/admin/expenses/' + id, { token: owner.token }), 404);
  const log = await h.sql`select action from audit_logs where target_type = 'expense' and target_id = ${id} order by id`;
  assertEquals(log.map((x) => x.action), ['expense.create', 'expense.update', 'expense.delete']);
});

test('only staff with the right permissions see or change money', async () => {
  const c = await h.customer();
  assertStatus(await h.call('GET', '/api/admin/finance', { token: c.token }), 403);
  const support = await h.staff('support', ['dashboard.view']);
  assertStatus(await h.call('GET', '/api/admin/finance', { token: support.token }), 403);
  const reader = await h.staff('support', ['analytics.read']);
  assertStatus(await h.call('GET', '/api/admin/finance', { token: reader.token }), 200);
  assertStatus(await h.call('POST', '/api/admin/expenses', { token: reader.token, body: { spentOn: '2026-01-15', category: 'ads', amountInr: 1 } }), 403);
});
