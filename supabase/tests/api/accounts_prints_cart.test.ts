// Account types, the print allowance, the cart and several-sheet orders
// (migrations/20261015090000_accounts_prints_cart.sql; routes/auth.ts PATCH /api/auth/me;
// routes/admin_people.ts PUT /api/admin/users/:id; services/entitlements.ts effectivePrintLimit;
// routes/access.ts; routes/cart.ts; services/pricing.ts buildQuote { worksheets }; routes/payments.ts;
// services/fulfil.ts). Gateways are the fakes in fakes/gateways.ts.
import { assert, assertEquals, assertStatus, startHarness, test, type Harness, type TestUser } from './harness.ts';
import { installGatewayFakes, type Delivery } from './fakes/gateways.ts';

const h: Harness = await startHarness();
const gw = await installGatewayFakes(h);

// deno-lint-ignore no-explicit-any
type Any = any;

const IN_ADDR = { country: 'IN', line1: '12 MG Road', city: 'Pune', state: 'Maharashtra', postal: '411001' };
const US_ADDR = { country: 'US', line1: '1 Market Street', city: 'San Francisco' };
const LOCKED = 'Your account type is already set. Write to us if it needs changing.';
const DEFAULT_PRINTS = { parent: 2, teacher: 3, organization: 300 };

// sheets used here (kg, ₹19 each; az-A and az-B are free)
for (const id of ['az-A', 'az-B', 'az-C', 'az-D', 'az-E', 'az-F', 'az-G', 'az-H', 'az-I', 'az-J', 'az-K', 'az-W', 'az-X', 'az-Y', 'az-Z']) {
  await h.uploadPdfFor(id);
}
// 50 more paid sheets with no PDF yet (for the 50-sheet limits), and a draft
const EXTRA = Array.from({ length: 50 }, (_, i) => `tp-${String(i + 1).padStart(2, '0')}`);
for (const id of EXTRA) {
  await h.sql`
    insert into products (id, title, class_id, subject, price_inr, status)
    values (${id}, ${'Test sheet ' + id}, 'kg', 'English', 10, 'active')`;
}
await h.sql`insert into products (id, title, class_id, subject, price_inr, status) values ('tp-draft', 'Draft sheet', 'kg', 'English', 10, 'draft')`;

const owner = await h.staff('owner');

/** A customer who has not chosen an account type yet (the harness makes Parents). */
async function fresh(name?: string): Promise<TestUser> {
  const c = await h.customer(name ? { name } : {});
  await h.sql`update profiles set role = null where id = ${c.id}`;
  return c;
}
async function customerAs(role: string | null): Promise<TestUser> {
  const c = await h.customer();
  await h.sql`update profiles set role = ${role} where id = ${c.id}`;
  return c;
}
const me = (c: TestUser) => h.call('GET', '/api/auth/me', { token: c.token });
const setRole = (c: TestUser, role: unknown) => h.call('PATCH', '/api/auth/me', { token: c.token, body: { role } });
const roleOf = async (id: string) => (await h.sql<{ role: string | null }[]>`select role from profiles where id = ${id}`)[0].role;
const open = (c: TestUser, id: string) => h.call('POST', `/api/access/${id}`, { token: c.token });
const printOnce = (c: TestUser, viewToken: string) => h.call('POST', '/api/view/print', { token: c.token, headers: { 'x-view-token': viewToken } });
const metaOf = (c: TestUser, viewToken: string) => h.call('GET', '/api/view/meta', { token: c.token, headers: { 'x-view-token': viewToken } });
const cart = (c: TestUser) => h.call('GET', '/api/cart', { token: c.token });
const addToCart = (c: TestUser, worksheet: unknown) => h.call('POST', '/api/cart', { token: c.token, body: { worksheet } });
const cartIds = (r: { body: Any }) => (r.body.items as Any[]).map((i) => i.worksheet);
const entsOf = (userId: string) => h.sql<Any[]>`select * from entitlements where user_id = ${userId} order by id`;
/** This access record ended a minute ago. */
const endNow = (id: number) => h.sql`
  update entitlements set purchased_at = now() - interval '2 days', starts_at = now() - interval '2 days',
                          expires_at = now() - interval '1 minute'
  where id = ${id}`;
const deliver = (path: string, d: Delivery) => h.call('POST', path, { raw: d.raw, headers: d.headers, contentType: 'application/json' });

async function quote(c: TestUser, worksheets: unknown, o: { address?: Record<string, string>; coupon?: string } = {}) {
  return await h.call('POST', '/api/quote', { token: c.token, body: { worksheets, address: o.address ?? IN_ADDR, ...(o.coupon ? { coupon: o.coupon } : {}) } });
}

async function order(c: TestUser, worksheets: string[], method: string, address: Record<string, string> = IN_ADDR) {
  const q = await quote(c, worksheets, { address });
  assertStatus(q, 200, 'quote');
  assert(q.body.valid === true && typeof q.body.quoteId === 'string', `quote not payable: ${q.text.slice(0, 300)}`);
  const r = await h.call('POST', '/api/pay/order', { token: c.token, body: { quoteId: q.body.quoteId, method, worksheets } });
  assertStatus(r, 200, 'order');
  return { q: q.body, orderId: r.body.order.id as string, gateway: r.body.gateway as Any, order: r.body.order as Any };
}

async function paidByRazorpay(c: TestUser, worksheets: string[]) {
  const made = await order(c, worksheets, 'razorpay');
  const pay = await gw.razorpay.pay(made.gateway.razorpay_order_id);
  const v = await h.call('POST', '/api/pay/verify', {
    token: c.token,
    body: { order_id: made.orderId, razorpay_order_id: made.gateway.razorpay_order_id, razorpay_payment_id: pay.paymentId, razorpay_signature: pay.signature },
  });
  assertStatus(v, 200, 'verify');
  return { ...made, v };
}

/** Every sheet opens on a paid record of this order. */
async function opensAll(c: TestUser, worksheets: string[], orderId: string) {
  for (const id of worksheets) {
    const r = await open(c, id);
    assertStatus(r, 200, `open ${id}`);
    assertEquals(r.body.entitlement.kind, 'paid');
    assertEquals(r.body.entitlement.order, orderId);
    assertEquals(r.body.entitlement.worksheet, id);
  }
}

// ── account types ────────────────────────────────────────────────────────────────────────

test('account type: Parent, Teacher and Organization are each chosen once, then locked', async () => {
  const cases: [string, string, string, number][] = [
    ['parent', 'parent', 'parent', 2],
    ['teacher', 'teacher', 'teacher', 3],
    ['organization', 'school', 'organization', 300],
  ];
  for (const [sent, stored, type, prints] of cases) {
    const c = await fresh();
    const before = await me(c);
    assertStatus(before, 200);
    assertEquals([before.body.user.role, before.body.user.accountType, before.body.user.printsPerSheet], [null, null, 2]);

    const r = await setRole(c, sent);
    assertStatus(r, 200, sent);
    assertEquals([r.body.user.role, r.body.user.accountType, r.body.user.printsPerSheet], [stored, type, prints]);
    assertEquals(await roleOf(c.id), stored);
    // the same value again changes nothing
    assertStatus(await setRole(c, sent), 200);
    // a different value, or clearing it, is refused and changes nothing
    for (const other of ['parent', 'teacher', 'organization', '', null]) {
      if (other === sent) continue;
      const x = await setRole(c, other);
      assertStatus(x, 409, `${sent} -> ${other}`);
      assertEquals(x.body.code, 'role_locked');
      assertEquals(x.body.error, LOCKED);
      assertEquals(x.body.role, stored);
    }
    assertEquals(await roleOf(c.id), stored);
    // a name change alongside the same type is fine
    const named = await h.call('PATCH', '/api/auth/me', { token: c.token, body: { role: sent, name: 'New Name' } });
    assertStatus(named, 200);
    assertEquals(named.body.user.name, 'New Name');

    // me, sign-in and refresh all carry the type and its prints
    const m = await me(c);
    assertEquals([m.body.user.role, m.body.user.accountType, m.body.user.printsPerSheet], [stored, type, prints]);
    const login = await h.login(c.email, c.password);
    assertStatus(login, 200);
    assertEquals([login.body.user.role, login.body.user.accountType, login.body.user.printsPerSheet], [stored, type, prints]);
    const ref = await h.call('POST', '/api/auth/refresh-token', { body: { refreshToken: login.refreshToken } });
    assertStatus(ref, 200);
    assertEquals([ref.body.user.accountType, ref.body.user.printsPerSheet], [type, prints]);
    const ev = await h.sql`select detail from security_events where user_id = ${c.id} and event_type = 'account_type.set'`;
    assertEquals(ev.map((e) => e.detail.role), [stored]);
  }

  // other spellings and unknown values
  const t = await fresh();
  const tutor = await setRole(t, 'Tutor');
  assertStatus(tutor, 200);
  assertEquals([tutor.body.user.role, tutor.body.user.accountType, tutor.body.user.printsPerSheet], ['tutor', 'teacher', 3]);
  const o = await fresh();
  assertEquals((await setRole(o, 'organisation')).body.user.role, 'school');
  const u = await fresh();
  for (const bad of ['pirate', 5, { role: 'parent' }]) {
    const r = await setRole(u, bad);
    assertStatus(r, 400);
    assertEquals(r.body.errors.role, 'Unknown role.');
  }
  assertEquals(await roleOf(u.id), null);
});

test('account type: chosen at sign-up (Organization is stored as school); an unknown one is refused', async () => {
  const email = `org.${crypto.randomUUID().slice(0, 8)}@test.local`;
  const r = await h.call('POST', '/api/auth/signup', { body: { name: 'Green School', email, agreement: true, role: 'organization' } });
  assertStatus(r, 201);
  assertEquals((await h.sql`select role from profiles where email = ${email}`)[0].role, 'school');
  const bad = await h.call('POST', '/api/auth/signup', { body: { name: 'X', email: `x.${crypto.randomUUID().slice(0, 8)}@test.local`, agreement: true, role: 'pirate' } });
  assertStatus(bad, 400);
  assertEquals(bad.body.errors.role, 'Unknown role.');
});

test('account type: staff with customers.write change it in Admin → Customers (audited); others cannot', async () => {
  const c = await fresh();
  assertStatus(await setRole(c, 'parent'), 200);
  const support = await h.staff('support');
  const admin = await h.staff('admin');

  const denied = await h.call('PUT', `/api/admin/users/${c.id}`, { token: support.token, body: { accountType: 'teacher' } });
  assertStatus(denied, 403);
  assertStatus(await h.call('PUT', `/api/admin/users/${c.id}`, { token: c.token, body: { accountType: 'teacher' } }), 403);
  for (const body of [{}, { accountType: 'pirate' }, { role: 7 }]) {
    const r = await h.call('PUT', `/api/admin/users/${c.id}`, { token: admin.token, body });
    assertStatus(r, 400);
    assert(r.body.errors?.role, 'names the field');
  }
  assertStatus(await h.call('PUT', `/api/admin/users/${crypto.randomUUID()}`, { token: admin.token, body: { accountType: 'teacher' } }), 404);
  assertEquals(await roleOf(c.id), 'parent');

  const r = await h.call('PUT', `/api/admin/users/${c.id}`, { token: admin.token, body: { accountType: 'organization' } });
  assertStatus(r, 200);
  assertEquals(r.body.changed, true);
  assertEquals([r.body.user.accountType, r.body.user.printsPerSheet], ['organization', 300]);
  assertEquals(await roleOf(c.id), 'school');
  const same = await h.call('PATCH', `/api/admin/users/${c.id}`, { token: admin.token, body: { role: 'school' } });
  assertStatus(same, 200);
  assertEquals(same.body.changed, false);
  const audit = await h.sql<Any[]>`select actor_id, detail from audit_logs where action = 'account.role' and target_id = ${c.id}`;
  assertEquals(audit.length, 1, 'one audit row for the one change');
  assertEquals(audit[0].actor_id, admin.id);
  assertEquals(audit[0].detail.before, { role: 'parent', accountType: 'parent' });
  assertEquals(audit[0].detail.after, { role: 'school', accountType: 'organization' });

  // the customer sees it, and still cannot change it themselves
  const m = await me(c);
  assertEquals([m.body.user.accountType, m.body.user.printsPerSheet], ['organization', 300]);
  assertStatus(await setRole(c, 'parent'), 409);
  // the staff list and the security log show it, with the email of the staff member who acted
  const one = await h.call('GET', `/api/admin/users/${c.id}`, { token: admin.token });
  assertEquals([one.body.user.accountType, one.body.user.printsPerSheet], ['organization', 300]);
  const ev = await h.call('GET', `/api/admin/security-events?user=${c.id}&type=account_type.changed_by_staff`, { token: admin.token });
  assertStatus(ev, 200);
  assertEquals(ev.body.events.length, 1);
  assertEquals(ev.body.events[0].byEmail, admin.email);
  const set = await h.call('GET', `/api/admin/security-events?user=${c.id}&type=account_type.set`, { token: admin.token });
  assertEquals(set.body.events[0].byEmail, null);
});

// ── the prints setting ───────────────────────────────────────────────────────────────────

test('settings: prints per account type are validated; /api/config, sign-in and the FAQ follow them', async () => {
  const cfg = await h.call('GET', '/api/config');
  assertStatus(cfg, 200);
  assertEquals(cfg.body.prints, DEFAULT_PRINTS);
  const row = await h.sql`select value from settings where key = 'prints'`;
  assertEquals(row[0].value, DEFAULT_PRINTS);

  const content = await h.staff('content');
  assertStatus(await h.call('PUT', '/api/admin/settings/prints', { token: content.token, body: { value: { parent: 5 } } }), 403);
  const bad: [unknown, string][] = [
    [{ parent: 1001 }, 'parent'], [{ teacher: -1 }, 'teacher'], [{ organization: 2.5 }, 'organization'],
    [{ parent: '4' }, 'parent'], [{ everyone: 4 }, 'everyone'], ['lots', 'value'],
  ];
  for (const [value, field] of bad) {
    const r = await h.call('PUT', '/api/admin/settings/prints', { token: owner.token, body: { value } });
    assertStatus(r, 400, JSON.stringify(value));
    assert(r.body.errors?.[field], `error names ${field}: ${r.text}`);
  }
  assertEquals((await h.sql`select value from settings where key = 'prints'`)[0].value, DEFAULT_PRINTS);

  try {
    const ok = await h.call('PUT', '/api/admin/settings/prints', { token: owner.token, body: { value: { parent: 5, teacher: 40 } } });
    assertStatus(ok, 200);
    assertEquals(ok.body.value, { parent: 5, teacher: 40, organization: 300 });
    assertEquals((await h.call('GET', '/api/config')).body.prints, { parent: 5, teacher: 40, organization: 300 });
    assertEquals((await me(await customerAs('parent'))).body.user.printsPerSheet, 5);
    assertEquals((await me(await customerAs('tutor'))).body.user.printsPerSheet, 40);
    const faq = (await h.call('GET', '/api/faq')).body.faq as { question: string; answer: string }[];
    const printing = faq.find((f) => f.question === 'How many times can I print a sheet?')!;
    assert(printing.answer.includes('5 with a Parent account, 40 with a Teacher account and 300 with an Organization account'), printing.answer);
    assert(!faq.some((f) => f.answer.includes('{prints')), 'every placeholder is filled');
    const audit = await h.sql`select 1 from audit_logs where action like 'settings%' and target_id = 'prints'`;
    assert(audit.length >= 1, 'the change is audited');
  } finally {
    await h.setSetting('prints', DEFAULT_PRINTS);
  }
});

test('customer text: how long a sheet stays open, printing and account types', async () => {
  const faq = (await h.call('GET', '/api/faq')).body.faq as { question: string; answer: string }[];
  assertEquals(faq.find((f) => f.question === 'How long can I open a sheet I bought?')!.answer,
    'Each sheet you buy stays open for 1 hour, counted from your verified payment. My Account → My Worksheets shows the time left. When the time is up, the sheet is removed from your account, and you can buy it again from the shop.');
  const printing = faq.find((f) => f.question === 'How many times can I print a sheet?')!;
  assert(printing.answer.includes('2 with a Parent account, 3 with a Teacher account and 300 with an Organization account'), printing.answer);
  assert(faq.some((f) => f.question === 'Which account type should I choose?'));
  assert(!faq.some((f) => /view only|view-only|—/i.test(f.question + f.answer) && /print/i.test(f.answer)), 'no long dash or "view only" in printing answers');
  const chat = await h.call('POST', '/api/ai/chat', { body: { message: 'How many times can I print a worksheet?', history: [] } });
  assertStatus(chat, 200);
  assertEquals(chat.body.question, 'How many times can I print a sheet?');
  assert(chat.body.reply.includes('3 with a Teacher account'));
});

// ── the print allowance ──────────────────────────────────────────────────────────────────

test('prints: the account type sets the allowance on free, bought, plan and granted records', async () => {
  // free pass, Parent: 2, counted until used up
  const parent = await customerAs('parent');
  const free = await open(parent, 'az-A');
  assertStatus(free, 200);
  assertEquals(free.body.entitlement.kind, 'free');
  assertEquals([free.body.printRule, free.body.printLimit, free.body.printsLeft], ['account', 2, 2]);
  for (const left of [1, 0]) {
    const p = await printOnce(parent, free.body.token);
    assertStatus(p, 200);
    assertEquals(p.body, { ok: true, printsLeft: left, printLimit: 2, counts: 'server_deliveries' });
  }
  const over = await printOnce(parent, free.body.token);
  assertStatus(over, 429);
  assertEquals(over.body.code, 'quota_exhausted');
  assertEquals(over.body.limit, 2);
  assertEquals(over.body.error, 'You have used all 2 prints of this sheet that come with your account. You can still open it in the viewer.');
  const m = await metaOf(parent, free.body.token);
  assertEquals([m.body.printLimit, m.body.printsLeft], [2, 0]);
  const again = await open(parent, 'az-A');
  assertStatus(again, 200, 'used-up prints never stop the sheet opening');
  assertEquals(again.body.printsLeft, 0);
  // staff make the account a Teacher: the same record now has 3, less the 2 used
  assertStatus(await h.call('PUT', `/api/admin/users/${parent.id}`, { token: owner.token, body: { accountType: 'teacher' } }), 200);
  const teacherNow = await open(parent, 'az-A');
  assertEquals([teacherNow.body.printLimit, teacherNow.body.printsLeft], [3, 1]);

  // bought sheet, Teacher: 3
  const teacher = await customerAs('teacher');
  const bought = await paidByRazorpay(teacher, ['az-C', 'az-D']);
  const b = await open(teacher, 'az-C');
  assertEquals([b.body.entitlement.kind, b.body.entitlement.order], ['paid', bought.orderId]);
  assertEquals([b.body.printLimit, b.body.printsLeft], [3, 3]);
  assertEquals((await printOnce(teacher, b.body.token)).body.printsLeft, 2);
  // the other sheet of the same order has its own 3
  assertEquals((await open(teacher, 'az-D')).body.printsLeft, 3);

  // granted sheet, Organization: 300
  const org = await customerAs('school');
  await h.grant(org.id, { productId: 'az-E', days: 30 });
  const g = await open(org, 'az-E');
  assertEquals([g.body.entitlement.grant, g.body.printLimit, g.body.printsLeft], [true, 300, 300]);

  // class plan, Parent: every sheet of the plan has its own 2
  const planner = await customerAs('parent');
  const plan = await h.grant(planner.id, { classId: 'kg', days: 30 });
  const pf = await open(planner, 'az-F');
  assertEquals([pf.body.entitlement.scope, pf.body.printLimit], ['class', 2]);
  for (let i = 0; i < 2; i++) assertStatus(await printOnce(planner, pf.body.token), 200);
  assertStatus(await printOnce(planner, pf.body.token), 429);
  const pg = await open(planner, 'az-G');
  assertEquals([pg.body.entitlement.id, pg.body.printsLeft], [plan, 2]);
  const counts = await h.sql`select product_id, kind, used from delivery_counts where entitlement_id = ${plan}`;
  assertEquals(counts.map((x) => `${x.product_id}:${x.kind}:${x.used}`), ['az-F:print:2']);

  // no type chosen yet: counted as a Parent
  const none = await customerAs(null);
  await h.grant(none.id, { productId: 'az-H', days: 30 });
  assertEquals((await open(none, 'az-H')).body.printLimit, 2);
  // downloads are unchanged (the sheet's own download limit, 0 here)
  const d = await h.call('POST', '/api/view/download', { token: org.token, headers: { 'x-view-token': g.body.token } });
  assertStatus(d, 403);
  assertEquals(d.body.code, 'not_allowed');
});

test('prints: print rule "sheet" uses the sheet\'s own number for everyone (0 = no printing)', async () => {
  await h.sql`update products set print_rule = 'sheet', print_limit = 2 where id = 'az-I'`;
  try {
    const teacher = await customerAs('teacher');
    await h.grant(teacher.id, { productId: 'az-I', days: 30 });
    const r = await open(teacher, 'az-I');
    assertEquals([r.body.printRule, r.body.printLimit, r.body.printsLeft], ['sheet', 2, 2]);
    assertEquals((await printOnce(teacher, r.body.token)).body.printsLeft, 1);
    assertEquals((await printOnce(teacher, r.body.token)).body.printsLeft, 0);
    const over = await printOnce(teacher, r.body.token);
    assertStatus(over, 429);
    assertEquals(over.body.error, 'You have used all 2 prints that come with this sheet. You can still open it in the viewer.');

    // the shop and the staff panel show it
    const shop = (await h.call('GET', '/api/worksheets')).body.worksheets as Any[];
    const ai = shop.find((w) => w.id === 'az-I');
    assertEquals([ai.printRule, ai.prints], ['sheet', { parent: 2, teacher: 2, organization: 2 }]);
    const ac = shop.find((w) => w.id === 'az-C');
    assertEquals([ac.printRule, ac.prints], ['account', DEFAULT_PRINTS]);
    const adm = await h.call('GET', '/api/admin/worksheets/az-I', { token: owner.token });
    assertStatus(adm, 200);
    assertEquals([adm.body.worksheet.printRule, adm.body.worksheet.printLimit], ['sheet', 2]);

    // one print: the message speaks of "the 1 print"
    await h.sql`update products set print_limit = 1 where id = 'az-I'`;
    const one = await customerAs('parent');
    await h.grant(one.id, { productId: 'az-I', days: 30 });
    const r1 = await open(one, 'az-I');
    assertEquals((await printOnce(one, r1.body.token)).body.printsLeft, 0);
    const over1 = await printOnce(one, r1.body.token);
    assertStatus(over1, 429);
    assertEquals(over1.body.error, 'You have used the 1 print that comes with this sheet. You can still open it in the viewer.');

    // 0 = this sheet is not printed at all
    await h.sql`update products set print_limit = 0 where id = 'az-I'`;
    const none = await printOnce(teacher, r.body.token);
    assertStatus(none, 403);
    assertEquals(none.body.code, 'not_allowed');
    assertEquals(none.body.error, 'Printing is not offered for this sheet. It opens in the viewer only.');

    // staff switch it back to the account type's number
    const badRule = await h.call('PUT', '/api/admin/worksheets/az-I', { token: owner.token, body: { printRule: 'never' } });
    assertStatus(badRule, 400);
    assert(badRule.body.errors?.printRule, badRule.text);
    const put = await h.call('PUT', '/api/admin/worksheets/az-I', { token: owner.token, body: { printRule: 'account' } });
    assertStatus(put, 200);
    assertEquals((await h.sql`select print_rule from products where id = 'az-I'`)[0].print_rule, 'account');
    const back = await open(teacher, 'az-I');
    assertEquals([back.body.printRule, back.body.printLimit, back.body.printsLeft], ['account', 3, 1]);
  } finally {
    await h.sql`update products set print_rule = 'account', print_limit = 0 where id = 'az-I'`;
  }
});

test('prints: an ended record is refused, and every viewer refusal names the sheet, record kind and class', async () => {
  const c = await customerAs('parent');
  assertStatus(await h.call('PATCH', '/api/auth/me', { token: c.token, body: { timeZone: 'Asia/Kolkata' } }), 200);
  const ent = await h.grant(c.id, { productId: 'az-J', days: 30 });
  const r = await open(c, 'az-J');
  assertStatus(r, 200);
  const m = await metaOf(c, r.body.token);
  assertEquals(m.body.user, { name: c.name, email: c.email, timeZone: 'Asia/Kolkata' });

  await endNow(ent);
  const p = await printOnce(c, r.body.token);
  assertStatus(p, 403);
  assertEquals([p.body.code, p.body.worksheet, p.body.scope, p.body.cls, p.body.expired], ['expired', 'az-J', 'worksheet', 'kg', true]);
  const mm = await metaOf(c, r.body.token);
  assertEquals([mm.status, mm.body.code, mm.body.worksheet, mm.body.scope, mm.body.cls], [403, 'expired', 'az-J', 'worksheet', 'kg']);
  const reopen = await open(c, 'az-J');
  assertStatus(reopen, 402);
  assertEquals([reopen.body.code, reopen.body.expired], ['payment_required', true]);

  // a class plan that ended
  const plan = await h.grant(c.id, { classId: 'kg', days: 30 });
  const k = await open(c, 'az-K');
  await endNow(plan);
  const pk = await printOnce(c, k.body.token);
  assertEquals([pk.status, pk.body.code, pk.body.worksheet, pk.body.scope, pk.body.cls], [403, 'expired', 'az-K', 'class', 'kg']);

  // a token that is not this customer's names nothing
  const bad = await h.call('POST', '/api/view/print', { token: c.token, headers: { 'x-view-token': 'not-a-token' } });
  assertStatus(bad, 403);
  assertEquals([bad.body.code, bad.body.worksheet, bad.body.scope, bad.body.cls], ['invalid', null, null, null]);
  const other = await customerAs('parent');
  const theirs = await h.call('GET', '/api/view/meta', { token: other.token, headers: { 'x-view-token': k.body.token } });
  assertEquals([theirs.status, theirs.body.code, theirs.body.worksheet], [403, 'invalid', null]);
});

// ── the cart ─────────────────────────────────────────────────────────────────────────────

test('cart: add, list, remove and empty; free, unknown, draft and owned sheets are refused', async () => {
  assertStatus(await h.call('GET', '/api/cart'), 401);
  assertStatus(await h.call('POST', '/api/cart', { body: { worksheet: 'az-C' } }), 401);
  const c = await customerAs('parent');
  const empty = await cart(c);
  assertStatus(empty, 200);
  assertEquals(empty.body, { items: [], count: 0, buyable: 0, totalInr: 0, max: 50 });

  const one = await addToCart(c, 'az-C');
  assertStatus(one, 200);
  assertEquals(one.body.count, 1);
  const { addedAt, ...item } = one.body.items[0];
  assertEquals(typeof addedAt, 'number');
  assertEquals(item, {
    worksheet: 'az-C', title: 'Alphabet C — tracing sheet', priceInr: 19, wasPriceInr: null, cls: 'kg', subject: 'English',
    thumb: '/sheets/a-to-z/thumb/C.jpg', accessDays: 1, accessHours: 1, problem: null, note: null,
  });
  assertEquals((await addToCart(c, 'az-C')).body.count, 1, 'adding twice is harmless');
  const two = await addToCart(c, ' az-D ');
  assertEquals([cartIds(two), two.body.count, two.body.buyable, two.body.totalInr], [['az-C', 'az-D'], 2, 2, 38]);

  const free = await addToCart(c, 'az-A');
  assertStatus(free, 400);
  assertEquals([free.body.code, free.body.worksheet], ['is_free', 'az-A']);
  for (const id of ['zz-none', 'tp-draft', '', 42, null, '../az-C']) {
    const r = await addToCart(c, id);
    assertStatus(r, 404, String(id));
  }
  await h.grant(c.id, { productId: 'az-E', days: 30 });
  const owned = await addToCart(c, 'az-E');
  assertStatus(owned, 409);
  assertEquals([owned.body.code, owned.body.worksheet], ['already_owned', 'az-E']);
  assertEquals((await cart(c)).body.count, 2);

  // another customer's cart is their own
  const other = await customerAs('teacher');
  assertEquals((await cart(other)).body.count, 0);
  assertEquals((await h.call('DELETE', '/api/cart/az-C', { token: other.token })).body.count, 0);
  assertEquals((await cart(c)).body.count, 2);

  const removed = await h.call('DELETE', '/api/cart/az-C', { token: c.token });
  assertStatus(removed, 200);
  assertEquals(cartIds(removed), ['az-D']);
  assertEquals(cartIds(await h.call('DELETE', '/api/cart/not-in-cart', { token: c.token })), ['az-D']);
  const cleared = await h.call('DELETE', '/api/cart', { token: c.token });
  assertStatus(cleared, 200);
  assertEquals([cleared.body.count, cleared.body.totalInr], [0, 0]);
  assertEquals((await h.sql`select 1 from cart_items where user_id = ${c.id}`).length, 0);
});

test('cart: lines that cannot be bought any more say why and are left out of the total', async () => {
  const c = await customerAs('parent');
  for (const id of ['az-W', 'az-X', 'az-Y', 'az-Z']) assertStatus(await addToCart(c, id), 200);
  try {
    await h.sql`update products set status = 'archived' where id = 'az-W'`;
    await h.grant(c.id, { productId: 'az-X', days: 30 });
    await h.sql`update products set price_inr = 0 where id = 'az-Y'`;
    const r = await cart(c);
    const by = Object.fromEntries((r.body.items as Any[]).map((i) => [i.worksheet, [i.problem, i.note]]));
    assertEquals(by, {
      'az-W': ['unavailable', 'This sheet is no longer for sale.'],
      'az-X': ['owned', 'This sheet is already on your account.'],
      'az-Y': ['free', 'This sheet is free now. Open it from the shop.'],
      'az-Z': [null, null],
    });
    assertEquals([r.body.count, r.body.buyable, r.body.totalInr], [4, 1, 19]);
  } finally {
    await h.sql`update products set status = 'active', price_inr = 19 where id in ('az-W', 'az-Y')`;
  }
});

test('cart: at most 50 sheets', async () => {
  const c = await customerAs('teacher');
  for (const id of EXTRA) await h.sql`insert into cart_items (user_id, product_id) values (${c.id}, ${id})`;
  const full = await cart(c);
  assertEquals([full.body.count, full.body.buyable, full.body.totalInr], [50, 0, 0]);
  assertEquals([full.body.items[0].problem, full.body.items[0].note], ['unavailable', 'This sheet is being prepared. It is not for sale yet.']);
  const r = await addToCart(c, 'az-C');
  assertStatus(r, 400);
  assertEquals([r.body.code, r.body.max], ['cart_full', 50]);
  assertStatus(await addToCart(c, 'tp-01'), 200, 'a sheet already in the cart is still fine');
  const merged = await h.call('POST', '/api/cart/merge', { token: c.token, body: { worksheets: ['az-C'] } });
  assertStatus(merged, 200);
  assertEquals([merged.body.added, merged.body.skipped, merged.body.count], [[], [{ worksheet: 'az-C', reason: 'full' }], 50]);
  assertStatus(await h.call('DELETE', '/api/cart/tp-01', { token: c.token }), 200);
  assertStatus(await addToCart(c, 'az-C'), 200);
});

test('cart: merging the browser cart after sign-in skips free, unknown and owned sheets', async () => {
  assertStatus(await h.call('POST', '/api/cart/merge', { body: { worksheets: ['az-C'] } }), 401);
  const c = await customerAs('parent');
  await addToCart(c, 'az-C');
  await h.grant(c.id, { productId: 'az-E', days: 30 });
  const r = await h.call('POST', '/api/cart/merge', {
    token: c.token,
    body: { worksheets: ['az-C', 'az-D', 'az-D', 'az-A', 'zz-none', 'az-E', 5, 'tp-draft', 'az-F'] },
  });
  assertStatus(r, 200);
  assertEquals(r.body.added, ['az-D', 'az-F']);
  assertEquals(r.body.skipped, [
    { worksheet: 'az-A', reason: 'free' }, { worksheet: 'zz-none', reason: 'unknown' },
    { worksheet: 'az-E', reason: 'owned' }, { worksheet: 'tp-draft', reason: 'unknown' },
  ]);
  assertEquals([cartIds(r), r.body.totalInr], [['az-C', 'az-D', 'az-F'], 57]);
  const bad = await h.call('POST', '/api/cart/merge', { token: c.token, body: { worksheets: 'az-C' } });
  assertStatus(bad, 400);
  assertEquals(bad.body.code, 'bad_items');
  assertEquals((await h.call('POST', '/api/cart/merge', { token: c.token, body: { worksheets: [] } })).body.count, 3);
});

// ── several sheets in one quote and one order ────────────────────────────────────────────

test('quote: several sheets are priced as one order, one line each; refusals name the sheet', async () => {
  const c = await customerAs('parent');
  const r = await quote(c, ['az-C', 'az-D', 'az-C', 'az-F']);
  assertStatus(r, 200);
  const q = r.body;
  assertEquals([q.valid, q.kind, q.worksheet, q.title, q.count, q.cls, q.accessDays, q.listInr], [true, 'worksheet', null, '3 worksheets', 3, 'kg', 1, 57]);
  assertEquals(q.worksheets, ['az-C', 'az-D', 'az-F']);
  assertEquals((q.items as Any[]).map((i) => [i.productId, i.unitPriceInr, i.discountInr, typeof i.endsAt]), [
    ['az-C', 19, 0, 'number'], ['az-D', 19, 0, 'number'], ['az-F', 19, 0, 'number'],
  ]);
  assert(q.totalInr >= 57, 'the total covers every sheet');
  const single = await h.call('POST', '/api/quote', { token: c.token, body: { worksheet: 'az-C', address: IN_ADDR } });
  assertEquals([single.body.worksheet, single.body.count, single.body.worksheets], ['az-C', 1, ['az-C']]);
  const stored = (await h.sql<Any[]>`select product_id, payload from quotes where id = ${q.quoteId}`)[0];
  assertEquals(stored.product_id, null);
  assertEquals(stored.payload.lines.map((l: Any) => l.productId), ['az-C', 'az-D', 'az-F']);

  // coupons follow the per-line rules: a sheet coupon takes 10% off every line
  await h.sql`insert into coupons (code, pct, applies_to) values ('SHEETS10', 10, 'worksheet'), ('PLANS10', 10, 'class')`;
  const cq = await quote(c, ['az-C', 'az-D'], { coupon: 'sheets10' });
  assertEquals([cq.body.coupon, cq.body.couponError], ['SHEETS10', null]);
  assertEquals((cq.body.items as Any[]).map((i) => i.discountInr), [1.9, 1.9]);
  assert(Math.abs(cq.body.discountInr - 3.8) < 0.011, `discount ${cq.body.discountInr}`);
  const pq = await quote(c, ['az-C', 'az-D'], { coupon: 'PLANS10' });
  assertEquals(pq.body.coupon, null);
  assert(typeof pq.body.couponError === 'string' && pq.body.couponError.length > 0, 'a plan-only coupon does not apply');

  const refusals: [unknown, number, string, string | null][] = [
    [[], 400, 'no_items', null],
    ['az-C', 400, 'bad_items', null],
    [['az-C', 'az-A'], 400, 'free', 'az-A'],
    [['az-C', 'zz-none'], 400, 'unknown_item', 'zz-none'],
    [['az-C', 'tp-draft'], 400, 'unknown_item', 'tp-draft'],
    [['az-C', 'tp-01'], 400, 'unavailable', 'tp-01'],
  ];
  for (const [list, status, code, sheet] of refusals) {
    const x = await quote(c, list);
    assertStatus(x, status, JSON.stringify(list));
    assertEquals(x.body.code, code);
    if (sheet) assertEquals(x.body.worksheet, sheet);
  }
  const many = await quote(c, ['az-C', ...EXTRA]);
  assertStatus(many, 400);
  assertEquals([many.body.code, many.body.max], ['too_many', 50]);
  await h.grant(c.id, { productId: 'az-E', days: 30 });
  const owned = await quote(c, ['az-C', 'az-E']);
  assertStatus(owned, 409);
  assertEquals([owned.body.code, owned.body.worksheet], ['already_owned', 'az-E']);
});

test('order: several sheets through Razorpay open every sheet, empty them from the cart and show on receipts', async () => {
  const c = await customerAs('parent');
  for (const id of ['az-C', 'az-D', 'az-K']) await addToCart(c, id);
  const q = await quote(c, ['az-C', 'az-D']);
  assertStatus(q, 200);
  // the browser's description must match the stored quote
  for (const body of [{ worksheets: ['az-C'] }, { worksheets: ['az-C', 'az-D', 'az-K'] }, { worksheet: 'az-C' }, { worksheets: ['az-C', 7] }]) {
    const x = await h.call('POST', '/api/pay/order', { token: c.token, body: { quoteId: q.body.quoteId, method: 'razorpay', ...body } });
    assertStatus(x, 400, JSON.stringify(body));
    assertEquals(x.body.code, 'quote_mismatch');
  }
  const r = await h.call('POST', '/api/pay/order', { token: c.token, body: { quoteId: q.body.quoteId, method: 'razorpay', worksheets: ['az-D', 'az-C'] } });
  assertStatus(r, 200);
  const orderId = r.body.order.id as string;
  const gateway = r.body.gateway;
  assertEquals(gateway.amount, q.body.amountMinor);
  assertEquals(gateway.description, '2 worksheets');
  const notes = gw.razorpay.orders.get(gateway.razorpay_order_id)!.notes;
  assertEquals([notes.worksheet, notes.items, notes.worksheets], ['', '2', 'az-C,az-D']);
  const items = await h.sql<Any[]>`select product_id, unit_price_inr from order_items where order_id = ${orderId} order by id`;
  assertEquals(items.map((i) => [i.product_id, i.unit_price_inr]), [['az-C', 19], ['az-D', 19]]);
  assertEquals((r.body.order.lines as Any[]).map((l) => l.worksheet), ['az-C', 'az-D']);
  assertEquals(cartIds(await cart(c)), ['az-C', 'az-D', 'az-K'], 'the cart stays until the payment is verified');

  const pay = await gw.razorpay.pay(gateway.razorpay_order_id);
  const v = await h.call('POST', '/api/pay/verify', {
    token: c.token,
    body: { order_id: orderId, razorpay_order_id: gateway.razorpay_order_id, razorpay_payment_id: pay.paymentId, razorpay_signature: pay.signature },
  });
  assertStatus(v, 200);
  assertEquals(v.body.status, 'paid');
  assertEquals((v.body.entitlements as Any[]).map((e) => e.worksheet), ['az-C', 'az-D']);
  const ents = await entsOf(c.id);
  assertEquals(ents.map((e) => [e.product_id, e.kind, e.order_id]), [['az-C', 'paid', orderId], ['az-D', 'paid', orderId]]);
  await opensAll(c, ['az-C', 'az-D'], orderId);
  assertEquals(cartIds(await cart(c)), ['az-K'], 'the bought sheets left the cart; the rest stayed');

  // receipts: My Account orders, the Purchase Successful email and the staff payments list
  const mine = (await h.call('GET', '/api/me/orders', { token: c.token })).body.orders as Any[];
  const o = mine.find((x) => x.id === orderId);
  assertEquals((o.lines as Any[]).map((l) => [l.worksheet, l.entitlement.status]), [['az-C', 'active'], ['az-D', 'active']]);
  await h.processOutbox();
  const mail = h.mail.sent.filter((m) => m.to === c.email && /Purchase|purchase/.test(m.subject)).pop()!;
  assert(mail, 'a purchase email was sent');
  assert(mail.text.includes('Alphabet C — tracing sheet') && mail.text.includes('Alphabet D — tracing sheet'), 'the email lists every sheet');
  const pays = await h.call('GET', '/api/admin/payments', { token: owner.token });
  assertStatus(pays, 200);
  const p = (pays.body.payments as Any[]).find((x) => x.orderId === orderId);
  const total = (await h.sql`select total_inr::float8 as t from orders where id = ${orderId}`)[0].t;
  assertEquals(p.orderTotalInr, total);
  const adminOrder = await h.call('GET', `/api/admin/orders/${orderId}`, { token: owner.token });
  assertStatus(adminOrder, 200);
  assert(JSON.stringify(adminOrder.body).includes('az-D'), 'the staff order view lists every sheet');

  // a sheet already bought is never charged twice
  const again = await quote(c, ['az-K', 'az-C']);
  assertStatus(again, 409);
  assertEquals([again.body.code, again.body.worksheet], ['already_owned', 'az-C']);
});

test('order: several sheets paid through Stripe, PayPal and the Razorpay webhook open every sheet', async () => {
  // Stripe (hosted page, then the return page confirms)
  const s = await customerAs('teacher');
  for (const id of ['az-C', 'az-D']) await addToCart(s, id);
  const so = await order(s, ['az-C', 'az-D'], 'stripe', US_ADDR);
  const session = gw.stripe.sessions.get(so.gateway.session)!;
  assertEquals([session.metadata.order_id, session.metadata.worksheet, session.amount_total], [so.orderId, '', so.q.amountMinor]);
  gw.stripe.pay(so.gateway.session);
  const sc = await h.call('POST', '/api/pay/stripe/confirm', { token: s.token, body: { order_id: so.orderId, session_id: so.gateway.session } });
  assertStatus(sc, 200);
  assertEquals((sc.body.entitlements as Any[]).length, 2);
  await opensAll(s, ['az-C', 'az-D'], so.orderId);
  assertEquals((await cart(s)).body.count, 0);

  // PayPal (approve, then capture)
  const p = await customerAs('school');
  for (const id of ['az-C', 'az-D', 'az-F']) await addToCart(p, id);
  const po = await order(p, ['az-C', 'az-D', 'az-F'], 'paypal', US_ADDR);
  gw.paypal.approve(po.gateway.paypal_order_id);
  const pc = await h.call('POST', '/api/pay/paypal/capture', { token: p.token, body: { order_id: po.orderId, token: po.gateway.paypal_order_id } });
  assertStatus(pc, 200);
  assertEquals((pc.body.entitlements as Any[]).map((e) => e.worksheet), ['az-C', 'az-D', 'az-F']);
  await opensAll(p, ['az-C', 'az-D', 'az-F'], po.orderId);
  assertEquals((await open(p, 'az-F')).body.printLimit, 300);
  assertEquals((await cart(p)).body.count, 0);

  // Razorpay settled by its webhook alone (the browser never came back)
  const w = await customerAs('parent');
  for (const id of ['az-C', 'az-D']) await addToCart(w, id);
  const wo = await order(w, ['az-C', 'az-D'], 'razorpay');
  const pay = await gw.razorpay.pay(wo.gateway.razorpay_order_id);
  const hook = await deliver('/api/pay/webhook', await gw.razorpay.webhook('payment.captured', { payment: { entity: pay.payment } }));
  assertStatus(hook, 200);
  assertEquals((await entsOf(w.id)).map((e) => [e.product_id, e.order_id]), [['az-C', wo.orderId], ['az-D', wo.orderId]]);
  await opensAll(w, ['az-C', 'az-D'], wo.orderId);
  assertEquals((await cart(w)).body.count, 0, 'the webhook emptied the cart too');

  // PayPal settled by its webhook alone
  const x = await customerAs('parent');
  await addToCart(x, 'az-G');
  const xo = await order(x, ['az-G', 'az-H'], 'paypal', US_ADDR);
  gw.paypal.approve(xo.gateway.paypal_order_id);
  const capture = gw.paypal.captureNow(xo.gateway.paypal_order_id);
  assertStatus(await deliver('/api/pay/paypal/webhook', gw.paypal.webhook('PAYMENT.CAPTURE.COMPLETED', capture)), 200);
  await opensAll(x, ['az-G', 'az-H'], xo.orderId);
  assertEquals((await cart(x)).body.count, 0);
});

test('refund: refunding a several-sheet order ends every sheet (staff record, PayPal and Stripe webhooks)', async () => {
  // staff record a refund
  const c = await customerAs('parent');
  const bought = await paidByRazorpay(c, ['az-C', 'az-D', 'az-F']);
  const r = await h.call('POST', `/api/admin/orders/${bought.orderId}/refund`, { token: owner.token, body: { reason: 'Customer asked for a refund' } });
  assertStatus(r, 200);
  assertEquals(r.body.revoked, 3);
  assert((await entsOf(c.id)).every((e) => e.revoked_at !== null), 'every sheet ended');
  for (const id of ['az-C', 'az-D', 'az-F']) assertStatus(await open(c, id), 402, id);

  // PayPal refund webhook
  const p = await customerAs('teacher');
  const po = await order(p, ['az-C', 'az-D'], 'paypal', US_ADDR);
  gw.paypal.approve(po.gateway.paypal_order_id);
  assertStatus(await h.call('POST', '/api/pay/paypal/capture', { token: p.token, body: { order_id: po.orderId } }), 200);
  const refund = gw.paypal.webhook('PAYMENT.CAPTURE.REFUNDED', gw.paypal.refundResource(po.gateway.paypal_order_id));
  assertStatus(await deliver('/api/pay/paypal/webhook', refund), 200);
  assertEquals((await h.sql`select status from orders where id = ${po.orderId}`)[0].status, 'refunded');
  const pe = await entsOf(p.id);
  assertEquals(pe.length, 2);
  assert(pe.every((e) => e.revoked_at !== null), 'both sheets ended');

  // Stripe charge.refunded
  const s = await customerAs('teacher');
  const so = await order(s, ['az-C', 'az-D'], 'stripe', US_ADDR);
  gw.stripe.pay(so.gateway.session);
  assertStatus(await h.call('POST', '/api/pay/stripe/confirm', { token: s.token, body: { order_id: so.orderId, session_id: so.gateway.session } }), 200);
  assertStatus(await deliver('/api/pay/stripe/webhook', await gw.stripe.event('charge.refunded', gw.stripe.charge(so.gateway.session))), 200);
  const se = await entsOf(s.id);
  assertEquals(se.length, 2);
  assert(se.every((e) => e.revoked_at !== null), 'both sheets ended');
  for (const id of ['az-C', 'az-D']) assertStatus(await open(s, id), 402, id);
});

// ── small server fixes ───────────────────────────────────────────────────────────────────

test('CORS: the download counters are readable by the website', async () => {
  const r = await h.call('GET', '/api/health', { headers: { origin: 'http://localhost:5173' } });
  const exposed = (r.headers.get('access-control-expose-headers') ?? '').split(',').map((x) => x.trim());
  for (const name of ['X-Downloads-Left', 'X-Downloads-Limit', 'Content-Disposition', 'X-Pages']) {
    assert(exposed.includes(name), `${name} is exposed: ${exposed.join(', ')}`);
  }
});
