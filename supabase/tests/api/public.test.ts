// Public routes (routes/public.ts) and the FAQ assistant (services/chatbot.ts).
import { assert, assertEquals, assertMatch, assertStatus, randomIp, startHarness, test, uniqueEmail, type Harness } from './harness.ts';
import { hasKeyword } from '../../functions/api/services/chatbot.ts';
import { initials } from '../../functions/api/routes/public.ts';

const h: Harness = await startHarness();
const INBOX = 'learnwithwhy6@gmail.com';

// ── health, config, geo ──────────────────────────────────────────────────────────────────

test('health: ok with the database, and no secrets', async () => {
  const r = await h.call('GET', '/api/health');
  assertStatus(r, 200);
  assertEquals([r.body.ok, r.body.db, r.body.database, r.body.version], [true, true, true, 'test']);
  assert(typeof r.body.time === 'number');
  for (const v of Object.values(h.env())) if (v && v.length > 6) assert(!r.text.includes(v), 'no env value in the answer');
});

test('config: the old checkout shape plus the new fields; public keys only', async () => {
  h.setEnv({ RAZORPAY_KEY_ID: 'rzp_test_publicid', RAZORPAY_KEY_SECRET: 'very-secret-rzp', PAYPAL_CLIENT_ID: 'pp-id', PAYPAL_SECRET: 'very-secret-pp' });
  try {
    const r = await h.call('GET', '/api/config');
    assertStatus(r, 200);
    const b = r.body;
    assertEquals(b.countries.length, 14);
    const india = b.countries.find((c: { code: string }) => c.code === 'IN');
    assertEquals([india.currency, india.tax, india.state, india.methods], ['INR', 'GST 18%', 'State', ['razorpay', 'paypal', 'stripe']]);
    assertEquals(india.postal, { label: 'PIN code', hint: '6 digits, e.g. 411001', pattern: '^[1-9][0-9]{5}$', flags: '' });
    assertEquals(india.states.length, 36);
    assertEquals(b.countries.at(-1).code, 'OTHER');
    assertEquals(b.plans.m1, { label: '1 month', months: 1, price: 199, note: null, regions: ['IN', 'INTL'], discountPct: 0 });
    assertEquals(b.plansByRegion, { IN: ['m1', 'm3', 'm6'], INTL: ['m1', 'm3', 'm6', 'y1'] });
    assertEquals(b.classes, { kg: 'Kindergarten', c1: 'Class 1', c2: 'Class 2', c3: 'Class 3' });
    assertEquals(b.classStatus.kg, 'available');
    assertEquals(b.classStatus.c1, 'coming_soon');
    assertEquals(b.rates.USD, 0.012);
    assert(b.currencies.includes('JPY'));
    assertEquals(b.gateways, { razorpay: 'test', stripe: false, paypal: 'sandbox' });
    assertEquals(b.keys.razorpay, 'rzp_test_publicid');
    assertEquals([b.server, b.version, b.accessDays, b.accessHours, b.supportEmail], ['learn-with-why', '4', 1, 1, INBOX]);
    assertEquals(b.agreement.version, '2026-10-07');
    assertEquals(b.features, { email: true, payments: { razorpay: true, stripe: false, paypal: true, any: true } });
    assertEquals([b.security.maxWarnings, b.viewer.recheckSeconds], [3, 60]);
    assert(!r.text.includes('very-secret'), 'no secret in the answer');
    for (const v of Object.values(h.env())) if (v && v.length > 10 && v !== 'rzp_test_publicid') assert(!r.text.includes(v));
  } finally {
    h.resetEnv();
  }
  const off = await h.call('GET', '/api/config');
  assertEquals(off.body.gateways, { razorpay: false, stripe: false, paypal: false });
  assertEquals(off.body.keys.razorpay, null);
  assertEquals(off.body.features.payments.any, false);
});

test('config: settings changes show up (access days, coming soon)', async () => {
  await h.setSetting('worksheet_access', { days: 200 });
  await h.sql`update classes set status = 'available' where id = 'c1'`;
  try {
    const r = await h.call('GET', '/api/config');
    assertEquals([r.body.accessDays, r.body.classStatus.c1], [200, 'available']);
  } finally {
    await h.setSetting('worksheet_access', { days: 1, hours: 1 });
    await h.sql`update classes set status = 'coming_soon' where id = 'c1'`;
  }
});

test('geo: the platform country header when it is a checkout country, else null', async () => {
  assertEquals((await h.call('GET', '/api/geo', { headers: { 'cf-ipcountry': 'gb' } })).body.country, 'GB');
  assertEquals((await h.call('GET', '/api/geo', { headers: { 'x-country-code': 'IN' } })).body.country, 'IN');
  assertEquals((await h.call('GET', '/api/geo', { headers: { 'cf-ipcountry': 'BR' } })).body.country, null);
  const none = await h.call('GET', '/api/geo');
  assertEquals(none.body, { country: null, fallback: 'IN' });
});

// ── POST /api/contact ────────────────────────────────────────────────────────────────────

test('contact: stores the note and emails the inbox once, reply-to the sender', async () => {
  h.mail.clear();
  const email = uniqueEmail('parent');
  const r = await h.call('POST', '/api/contact', { body: { name: 'Meera Iyer', email: email.toUpperCase(), message: 'Do you have Class 1 maths sheets yet?' } });
  assertStatus(r, 201);
  assertEquals([r.body.ok, r.body.mailed, r.body.queued], [true, false, true]);
  assert(typeof r.body.id === 'number');
  const row = (await h.sql`select * from contact_messages where id = ${r.body.id}`)[0];
  assertEquals([row.name, row.email, row.body, row.user_id, row.status], ['Meera Iyer', email, 'Do you have Class 1 maths sheets yet?', null, 'new']);
  assert(row.outbox_id, 'linked to its email');

  const sent = h.mail.to(INBOX);
  assertEquals(sent.length, 1);
  assertEquals(sent[0].replyTo, email);
  assertMatch(sent[0].subject, /Meera Iyer/);
  assertMatch(sent[0].text, /Class 1 maths/);
  const ob = (await h.sql`select * from email_outbox where id = ${row.outbox_id}`)[0];
  assertEquals([ob.template, ob.related_type, ob.related_id, ob.status, ob.reply_to], ['contact', 'contact_message', String(r.body.id), 'sent', email]);
  const after = (await h.sql`select mailed, mail_error from contact_messages where id = ${r.body.id}`)[0];
  assertEquals([after.mailed, after.mail_error], [true, null]);
  const n = await h.sql`select * from notifications where audience = 'staff' and kind = 'contact.new' and (data ->> 'id')::bigint = ${r.body.id}`;
  assertEquals(n.length, 1);
  // the outbox sends it only once
  await h.processOutbox();
  assertEquals(h.mail.to(INBOX).length, 1);
});

test('contact: a signed-in customer is recorded; a failed send is kept for a retry', async () => {
  h.mail.clear();
  const c = await h.customer();
  h.mail.failNext(1);
  const r = await h.call('POST', '/api/contact', { token: c.token, body: { name: 'Asha', email: c.email, message: 'Please help me open my sheet.' } });
  assertStatus(r, 201);
  const row = (await h.sql`select user_id, mailed, mail_error from contact_messages where id = ${r.body.id}`)[0];
  assertEquals([row.user_id, row.mailed], [c.id, false]);
  assert(row.mail_error, 'the error is recorded');
  await h.sql`update email_outbox set next_attempt_at = now() where related_type = 'contact_message' and related_id = ${String(r.body.id)}`;
  await h.processOutbox();
  assertEquals(h.mail.to(INBOX).length, 1);
  assertEquals((await h.sql`select mailed from contact_messages where id = ${r.body.id}`)[0].mailed, true);
});

test('contact: old validation messages, honeypot, size limit', async () => {
  const bad = await h.call('POST', '/api/contact', { body: { name: ' ', email: 'nope', message: 'short' } });
  assertStatus(bad, 400);
  assertEquals(bad.body.errors, { name: 'Your name, please.', email: 'Enter a valid email address.', message: 'A little more detail helps us reply.' });
  assertEquals(bad.body.error, 'Your name, please.');
  const long = await h.call('POST', '/api/contact', { body: { name: 'A', email: uniqueEmail(), message: 'x'.repeat(5001) } });
  assertEquals(long.body.errors.message, 'That note is too long — keep it under 5000 characters.');
  // emoji count as one character each, as the database counts them
  const emoji = await h.call('POST', '/api/contact', { body: { name: 'A', email: uniqueEmail(), message: '😀😀😀😀😀' } });
  assertStatus(emoji, 400);

  const before = (await h.sql`select count(*)::int as n from contact_messages`)[0].n;
  const bot = await h.call('POST', '/api/contact', { body: { name: 'Bot', email: uniqueEmail(), message: 'Buy cheap things now!!', website: 'http://spam' } });
  assertStatus(bot, 201);
  assertEquals(bot.body, { ok: true });
  assertEquals((await h.sql`select count(*)::int as n from contact_messages`)[0].n, before);

  const huge = await h.call('POST', '/api/contact', { body: { name: 'A', email: uniqueEmail(), message: 'y'.repeat(40 * 1024) } });
  assertStatus(huge, 413);
});

test('contact: 5 notes per hour per IP, with the old message', async () => {
  const ip = randomIp();
  for (let i = 0; i < 5; i++) {
    assertStatus(await h.call('POST', '/api/contact', { ip, body: { name: 'Ravi', email: uniqueEmail(), message: `Note number ${i} for you.` } }), 201);
  }
  const r = await h.call('POST', '/api/contact', { ip, body: { name: 'Ravi', email: uniqueEmail(), message: 'One more note for you.' } });
  assertStatus(r, 429);
  assertEquals(r.body, { error: 'You have sent a few notes already — wait a few minutes and try again.' });
  // invalid notes do not use up the limit
  const ip2 = randomIp();
  for (let i = 0; i < 6; i++) assertStatus(await h.call('POST', '/api/contact', { ip: ip2, body: { name: 'x' } }), 400);
  assertStatus(await h.call('POST', '/api/contact', { ip: ip2, body: { name: 'Ravi', email: uniqueEmail(), message: 'A proper note now.' } }), 201);
});

// ── POST /api/ai/chat ────────────────────────────────────────────────────────────────────

async function chat(message: string, ip?: string) {
  return await h.call('POST', '/api/ai/chat', { body: { message, history: [] }, ip });
}

test('chat: answers from the published public FAQ and fills {accessDays}', async () => {
  const free = await chat('Which sheets are FREE?');
  assertStatus(free, 200);
  assertEquals(free.body.source, 'faq');
  assertMatch(free.body.reply, /^Free sheets to try in every section/);

  const days = await chat('how long does my access last after I buy?');
  assertEquals(days.body.reply, 'Each sheet you buy stays open for 1 hour, counted from your verified payment. My Account → My Worksheets shows the time left. When the time is up, the sheet is removed from your account, and you can buy it again from the shop.');
  assert(!days.body.reply.includes('{accessDays}'));
  await h.setSetting('worksheet_access', { days: 200 });
  try {
    assertMatch((await chat('when does it expire?')).body.reply, /stays open for 200 days, counted from your verified payment/);
  } finally {
    await h.setSetting('worksheet_access', { days: 1, hours: 6 });
  }
  try {
    assertMatch((await chat('when does it expire?')).body.reply, /stays open for 6 hours, counted from your verified payment/);
  } finally {
    await h.setSetting('worksheet_access', { days: 1, hours: 1 });
  }

  assertMatch((await chat('hi')).body.reply, /^Hello!/);
  assertMatch((await chat('Is class 2 ready?')).body.reply, /coming soon/);
  // "class 10" is not "class 1"
  assert(!/coming soon/.test((await chat('class 10')).body.reply));
});

test('chat: staff-only, draft and planned answers are never used', async () => {
  await h.sql`
    insert into faq_entries (question, answer, keywords, audience, status, sort) values
      ('Zebra staff question', 'STAFF ONLY ANSWER', '{zebracrossing}', 'staff', 'published', 50),
      ('Zebra draft question', 'DRAFT ANSWER', '{zebracrossing}', 'public', 'draft', 51),
      ('Zebra planned question', 'PLANNED ANSWER', '{zebracrossing}', 'public', 'planned', 52)`;
  for (const m of ['zebracrossing', 'Zebra staff question', 'grant access', 'Do you offer refunds?']) {
    const r = await chat(m);
    assertStatus(r, 200);
    assert(!/STAFF ONLY|DRAFT ANSWER|PLANNED ANSWER|Admin → Customers|being written/.test(r.text), `no hidden answer for "${m}": ${r.text}`);
  }
  const fb = await chat('zebracrossing');
  assertEquals(fb.body.source, 'fallback');
  assertMatch(fb.body.reply, /Contact section/);
  assertMatch(fb.body.reply, /learnwithwhy6@gmail\.com/);
  assert(fb.body.suggestions.length > 0);
  // once published for the public, it is found
  await h.sql`update faq_entries set status = 'published' where answer = 'DRAFT ANSWER'`;
  assertEquals((await chat('tell me about zebracrossings')).body.reply, 'DRAFT ANSWER');
});

test('chat: input checks and 30 per minute per IP', async () => {
  assertStatus(await chat('   '), 400);
  assertStatus(await chat('x'.repeat(1001)), 400);
  assertEquals((await chat('qwertyuiop asdfgh')).body.source, 'fallback');
  const ip = randomIp();
  for (let i = 0; i < 30; i++) assertStatus(await chat('hello', ip), 200);
  const r = await chat('hello', ip);
  assertStatus(r, 429);
  assertEquals(r.body.code, 'rate_limited');
});

test('chat: keyword matching rules', () => {
  assert(hasKeyword('hi there', 'hi'));
  assert(!hasKeyword('this is it', 'hi'));
  assert(hasKeyword('how much are the sheets', 'sheet'));
  assert(hasKeyword('price in ₹19?', '₹'));
  assert(!hasKeyword('class 10 maths', 'class 1'));
  assert(hasKeyword('class 1 maths', 'class 1'));
  return Promise.resolve();
});

// ── POST /api/events ─────────────────────────────────────────────────────────────────────

test('events: only the four client kinds; path without query; referrer host only', async () => {
  const visitor = 'visitor_' + crypto.randomUUID().slice(0, 12);
  const r = await h.call('POST', '/api/events', {
    headers: { 'x-visitor-id': visitor },
    body: { kind: 'page_view', path: '/?verify=secret-token#x', referrer: 'https://www.google.com/search?q=worksheets', meta: { a: 1, nested: { x: 1 }, s: 'y'.repeat(300) } },
  });
  assertStatus(r, 200);
  assertEquals(r.body, { ok: true });
  const row = (await h.sql`select * from analytics_events where visitor_id = ${visitor}`)[0];
  assertEquals([row.kind, row.source, row.path, row.referrer_host, row.device, row.user_id], ['page_view', 'client', '/', 'www.google.com', 'desktop', null]);
  assertEquals(row.meta, { a: 1, s: 'y'.repeat(100) });

  const c = await h.customer();
  await h.call('POST', '/api/events', { token: c.token, headers: { 'x-visitor-id': visitor }, body: { kind: 'product_view', productId: 'az-C', path: '/sheets' } });
  const pv = (await h.sql`select * from analytics_events where visitor_id = ${visitor} and kind = 'product_view'`)[0];
  assertEquals([pv.product_id, pv.user_id], ['az-C', c.id]);

  for (const kind of ['purchase', 'signup', 'order_created', 'login', '', 'PAGE_VIEW']) {
    const bad = await h.call('POST', '/api/events', { body: { kind } });
    assertStatus(bad, 400);
  }
  const n = (await h.sql`select count(*)::int as n from analytics_events where source = 'client' and kind not in ('page_view', 'product_view', 'checkout_start', 'search')`)[0].n;
  assertEquals(n, 0);
});

test('events: 120 per minute per IP', async () => {
  const ip = randomIp();
  for (let i = 0; i < 120; i++) assertStatus(await h.call('POST', '/api/events', { ip, body: { kind: 'search', meta: { q: 'tracing' } } }), 200);
  assertStatus(await h.call('POST', '/api/events', { ip, body: { kind: 'search' } }), 429);
});

// ── GET /api/content, /api/faq, /api/worksheets/:id/reviews ──────────────────────────────

test('content: published keys only, as { key: value }', async () => {
  await h.sql`insert into site_content (key, value, published) values ('hero.title', '"Hello forest"', true), ('hero.secret', '"draft text"', false)`;
  const r = await h.call('GET', '/api/content');
  assertStatus(r, 200);
  assertEquals(r.body['hero.title'], 'Hello forest');
  assert(!('hero.secret' in r.body));
});

test('faq: published public answers only, with {accessDays} filled', async () => {
  const r = await h.call('GET', '/api/faq');
  assertStatus(r, 200);
  const list = r.body.faq as { question: string; answer: string }[];
  assert(list.length >= 10);
  assert(!list.some((f) => /Admin →|Refund policy is being written/.test(f.answer)));
  const days = list.find((f) => f.question.startsWith('How long can I open'))!;
  assertEquals(days.answer, 'Each sheet you buy stays open for 1 hour, counted from your verified payment. My Account → My Worksheets shows the time left. When the time is up, the sheet is removed from your account, and you can buy it again from the shop.');
});

test('reviews: published only, initials instead of names, never ids or emails', async () => {
  const a = await h.customer({ name: 'Priya Sharma' });
  const b = await h.customer({ name: 'Rahul' });
  await h.sql`
    insert into reviews (product_id, user_id, rating, title, body, status) values
      ('az-T', ${a.id}, 5, 'Lovely', 'My daughter loved it.', 'published'),
      ('az-T', ${b.id}, 2, 'Pending one', 'Not yet moderated.', 'pending')`;
  const r = await h.call('GET', '/api/worksheets/az-T/reviews');
  assertStatus(r, 200);
  assertEquals(r.body.reviews.length, 1);
  assertEquals([r.body.reviews[0].name, r.body.reviews[0].rating, r.body.reviews[0].title], ['P. S.', 5, 'Lovely']);
  assertEquals([r.body.count, r.body.avg], [1, 5]);
  assert(!r.text.includes(a.id) && !r.text.includes(a.email) && !r.text.includes('Priya') && !r.text.includes('Pending one'));
  assertStatus(await h.call('GET', '/api/worksheets/no-such/reviews'), 404);
  assertStatus(await h.call('GET', '/api/worksheets/' + encodeURIComponent('../x') + '/reviews'), 404);
  assertEquals([initials('Priya Sharma'), initials(''), initials('  émile  zola '), initials('a b c d')], ['P. S.', 'A customer', 'É. Z.', 'A. B. C.']);
});
