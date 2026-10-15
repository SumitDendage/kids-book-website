/* Staff panels, end to end: /admin and /developer in a real browser against the local dev API.

   HOW TO RUN (nothing here reaches the internet)
     1. A fresh test database and the dev API (it seeds owner@dev.local and parent@dev.local):
          cd supabase && LWW_TEST_DB=lww_e2e tests/local/reset-db.sh
          LWW_TEST_DB=lww_e2e deno run -A --config functions/api/deno.json tests/dev-server.ts \
            --port 54343 --origin http://127.0.0.1:5193 --files ../backend/protected
     2. The website, pointed at that API:
          cd frontend && VITE_API_BASE_URL=http://127.0.0.1:54343/functions/v1 \
            npx vite --port 5193 --strictPort --host 127.0.0.1
     3. This script (Playwright as a library, with its own Chromium):
          node supabase/tests/e2e/staff.cjs
        E2E_API (default http://127.0.0.1:54343) and E2E_SITE (default http://127.0.0.1:5193) point it
        elsewhere; E2E_SHOTS sets the screenshot folder (default /var/tmp/sb/fe-sv-shots).
   It prints one PASS or FAIL line per step and exits 1 when any step failed (2 when it could not run).
   It can run again on the same database: names carry a fresh stamp and it puts back what it changes.

   WHAT IT COVERS
     owner sign-in at /admin; every admin and developer section loads with no console or API errors;
     a support member is added (password from the welcome email), sees only their sections and gets a
     403 for a forbidden change, shown in plain words in the panel too; a draft sheet gets its PDF and
     goes on sale (public /api/worksheets); the access days setting reaches a new quote; a coupon works
     at the quote; a refund recorded on a paid order ends its access; a blocked customer is sent to
     /account-blocked on their next request; session block, paid-access pause and account block stay
     independent; a CSV export downloads; the audit log names the staff member for each change; sign-out.

   The site's scroll landscape (960 large frames drawn every animation frame) keeps running behind
   the staff page, which starves a busy test machine, so the test browsers skip those frames and ask
   for reduced motion. The staff panels themselves run unchanged. */
const { chromium } = require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright');
const fs = require('fs');
const path = require('path');

const API = (process.env.E2E_API || 'http://127.0.0.1:54343').replace(/\/+$/, '');
const SITE = (process.env.E2E_SITE || 'http://127.0.0.1:5193').replace(/\/+$/, '');
const A = API + '/functions/v1';
const SHOTS = process.env.E2E_SHOTS || '/var/tmp/sb/fe-sv-shots';
const ROOT = path.resolve(__dirname, '../../..');
const PDF = ROOT + '/backend/protected/a-to-z/A.pdf';
const COVER = ROOT + '/backend/protected/a-to-z/A.jpg';
const STAMP = Date.now().toString(36).slice(-5);
const SUPPORT = { email: 'support-' + STAMP + '@dev.local', name: 'Sam Support ' + STAMP };
const COUPON = 'SV' + STAMP.toUpperCase();
const TITLE = 'E2E sheet ' + STAMP;
const ADDRESS = { country: 'IN', name: 'Parent Test', line1: '12 Garden Road', city: 'Pune', state: 'Maharashtra', postal: '411001' };
const UA_A = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const UA_B = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';
fs.mkdirSync(SHOTS, { recursive: true });

/* ---------- steps ---------- */
const results = [];
let failed = 0;
const log = (...a) => console.log(...a);
async function step(name, fn) {
  const t0 = Date.now();
  try {
    const out = await fn();
    results.push(['PASS', name]);
    log('PASS', name, '(' + (Date.now() - t0) + ' ms)' + (out ? ' ' + out : ''));
    return true;
  } catch (e) {
    failed++;
    results.push(['FAIL', name, e.message]);
    log('FAIL', name, '-', String(e.message).split('\n')[0]);
    return false;
  }
}
const must = (c, m) => { if (!c) throw new Error(m); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function waitFor(fn, ms, what) {
  const end = Date.now() + ms;
  for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) throw new Error('timed out waiting for ' + what); await sleep(300); }
}

/* ---------- the API from node (with the site's Origin) ---------- */
async function call(method, p, token, body, extra = {}) {
  const r = await fetch(A + p, {
    method,
    headers: Object.assign({ 'Content-Type': 'application/json', Origin: SITE, 'X-Device-Id': extra.device || 'sv-e2e-node-device-0001', 'User-Agent': extra.ua || 'sv-e2e' }, token ? { Authorization: 'Bearer ' + token } : {}),
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const t = await r.text(); let j; try { j = JSON.parse(t); } catch (_) { j = { raw: t.slice(0, 200) }; }
  return { status: r.status, body: j };
}
async function login(email, password, opts = {}) {
  const r = await call('POST', '/api/auth/login', null, Object.assign({ email, password }, opts.staff ? { staff: true } : {}), opts);
  if (r.status !== 200) throw new Error('sign-in of ' + email + ' answered ' + r.status + ' ' + JSON.stringify(r.body).slice(0, 200));
  return r.body.session.accessToken;
}
const dev = async (p, body) => (await fetch(API + p, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {})).json();
const resetLimits = () => fetch(API + '/__dev/reset-limits', { method: 'POST' }).catch(() => {});
const mailTo = async to => (await dev('/__dev/mail?to=' + encodeURIComponent(to))).mail || [];

(async () => {
  await resetLimits();
  const users = await dev('/__dev/users');
  const OWNER = users.owner, CUST = users.customer;
  let ownerTok = await login(OWNER.email, OWNER.password, { staff: true, device: 'sv-e2e-owner-node-0001' });
  const ownerCall = async (m, p, b) => {
    let r = await call(m, p, ownerTok, b, { device: 'sv-e2e-owner-node-0001' });
    if (r.status === 401) { ownerTok = await login(OWNER.email, OWNER.password, { staff: true, device: 'sv-e2e-owner-node-0001' }); r = await call(m, p, ownerTok, b, { device: 'sv-e2e-owner-node-0001' }); }
    return r;
  };
  const ownerMe = (await ownerCall('GET', '/api/admin/me')).body;
  const OWNER_NAME = ownerMe.user.name || 'Dev Owner';
  const custRow = ((await ownerCall('GET', '/api/admin/users?q=' + encodeURIComponent(CUST.email))).body.users || [])[0];
  if (!custRow) throw new Error('the seeded customer is missing');
  const custId = custRow.id;

  /* a clean start for the customer (an earlier run may have stopped half way) */
  await ownerCall('POST', '/api/admin/users/' + custId + '/unblock', {});
  await ownerCall('POST', '/api/admin/security/customers/' + custId + '/unblock', { resetWarnings: true, note: 'e2e: clean start' });
  for (const s of (await ownerCall('GET', '/api/admin/security/customers/' + custId + '/sessions')).body.sessions || []) if (s.status === 'blocked') await ownerCall('POST', '/api/admin/security/sessions/' + s.id + '/unblock', {});
  /* the access days setting as it was (put back at the end) */
  const settings0 = (await ownerCall('GET', '/api/admin/settings')).body;
  const DAYS0 = settings0.accessDays;
  const DAYS1 = DAYS0 === 200 ? 210 : 200;
  /* two paid sheets from the shop the customer does not have open: one to buy and refund, one to give and pause */
  const pub0 = (await (await fetch(A + '/api/worksheets')).json()).worksheets || [];
  await resetLimits();
  const custTok0 = await login(CUST.email, CUST.password, { device: 'sv-e2e-parent-setup-01' });
  const owned = new Set(((await call('GET', '/api/me/entitlements', custTok0, undefined, { device: 'sv-e2e-parent-setup-01' })).body.entitlements || []).filter(e => e.active && e.worksheet).map(e => e.worksheet));
  const paidSheets = pub0.filter(w => w.price > 0 && w.available !== false && w.onSale !== false && !owned.has(w.id) && !/^e2e-/.test(w.id))
    .sort((a, b) => (/^az-/.test(b.id) ? 1 : 0) - (/^az-/.test(a.id) ? 1 : 0));
  const BUY = paidSheets[0] && paidSheets[0].id, GIVE = paidSheets[1] && paidSheets[1].id;
  const FREE = (pub0.find(w => w.price === 0 && w.available !== false) || {}).id;
  if (!BUY || !GIVE || !FREE) throw new Error('the shop list has no paid or free sheets to test with');
  log('owner', OWNER.email, '· customer', CUST.email, '· sheets', BUY, GIVE, FREE, '· access days', DAYS0);

  /* ---------- browsers ---------- */
  const browser = await chromium.launch();
  const consoleErrors = [], badApi = [], adminKeyHeaders = [];
  const allowed = [];   /* [who, regex, status] of API refusals a step expects */
  const allow = (who, re, status) => allowed.push([who, re, status]);
  const watch = (page, who) => {
    page.on('pageerror', e => consoleErrors.push(who + ' pageerror: ' + e.message));
    page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|favicon/.test(m.text())) consoleErrors.push(who + ' console: ' + m.text().slice(0, 240)); });
    page.on('request', r => { const h = r.headers(); if (h['x-admin-key'] !== undefined) adminKeyHeaders.push(who + ' ' + r.url()); });
    page.on('response', r => {
      const u = r.url();
      if (!u.startsWith(A + '/api/') || r.status() < 400) return;
      badApi.push({ who, status: r.status(), method: r.request().method(), path: u.slice(A.length).split('?')[0], at: Date.now() });
    });
  };
  const unexpectedApi = (since = 0) => badApi.slice(since).filter(b => !allowed.some(([w, re, s]) => (w === '*' || w === b.who) && re.test(b.method + ' ' + b.path) && (s === b.status || (Array.isArray(s) && s.includes(b.status)))));
  const lighten = async ctx => { await ctx.route('**/frames-webp/**', r => r.fulfill({ status: 204, body: '' })); return ctx; };
  const newCtx = async (opts = {}) => lighten(await browser.newContext(Object.assign({ viewport: { width: 1360, height: 900 }, acceptDownloads: true, reducedMotion: 'reduce' }, opts)));
  const shot = async (p, name) => { await p.screenshot({ path: SHOTS + '/' + name + '.png' }).catch(e => log('   · screenshot', name, 'failed:', e.message.split('\n')[0])); };
  const veilGone = async p => { await p.waitForFunction(() => { const v = document.getElementById('veil'); return !v || v.classList.contains('gone'); }, null, { timeout: 30000 }).catch(() => {}); await sleep(700); };

  /* staff panel helpers (work on any page) */
  const sidebar = p => p.locator('.sb .sb-menu:not([aria-label="Other"]) .sb-item').evaluateAll(els => els.map(e => e.getAttribute('title')));
  async function go(p, title) {
    await p.locator('.sb .sb-item[title="' + title + '"]').click();
    await p.waitForFunction(t => { const h = document.querySelector('main.mn .mn-head h1'); return h && h.textContent.trim() === t; }, title, { timeout: 20000 });
    await p.waitForFunction(() => !document.querySelector('main.mn .ld'), null, { timeout: 20000 }).catch(() => {});
  }
  /* back on the admin panel (a failed step may have left the page elsewhere) */
  async function toAdmin(p) {
    if (/\/admin$/.test(p.url()) && await p.locator('.dash .sb').count() && !(await p.locator('.dm, .cfm').count())) return;
    await p.goto(SITE + '/admin');
    await p.locator('.dash').waitFor({ timeout: 60000 });
    await veilGone(p);
  }
  const errorNotes = p => p.locator('main.mn .st-note.err, main.mn .lw-note.err').allInnerTexts();
  async function toast(p, re, ms = 12000) {
    const end = Date.now() + ms;
    let seen = '';
    for (;;) {
      seen = await p.evaluate(() => Array.from(document.querySelectorAll('.toast, [role="status"], .toast-msg')).map(x => x.textContent).join(' | '));
      if (re.test(seen)) return seen;
      if (Date.now() > end) throw new Error('no message matching ' + re + ' (saw: ' + seen.slice(0, 200) + ')');
      await sleep(200);
    }
  }
  async function staffSignIn(p, email, password, where = '/admin', remember = false) {
    await p.goto(SITE + where);
    await p.locator('#stEmail, .dash').first().waitFor({ timeout: 60000 });
    await veilGone(p);
    if (await p.locator('.dash').count()) return;
    await p.fill('#stEmail', email);
    await p.fill('#stPass', password);
    if (remember) await p.check('#stRemember');
    await p.locator('.portal-login button[type=submit]').click();
    await p.locator('.dash').waitFor({ timeout: 30000 });
  }
  /* a customer signed in inside a browser page: the same sign-in the site makes, kept in its token slot */
  async function customerSignInPage(p, email, password) {
    const out = await p.evaluate(async ({ api, email, password }) => {
      let dev = localStorage.getItem('lww_device');
      if (!dev || !/^[A-Za-z0-9_-]{16,64}$/.test(dev)) { dev = 'sv-e2e-browser-' + Math.random().toString(36).slice(2, 12); localStorage.setItem('lww_device', dev); }
      const r = await fetch(api + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Device-Id': dev }, body: JSON.stringify({ email, password, remember: true }) });
      const b = await r.json();
      if (r.status !== 200) return { status: r.status, body: b };
      const s = b.session, now = Date.now(), inMs = Number(s.expiresIn) > 0 ? Number(s.expiresIn) * 1000 : 3600e3;
      localStorage.setItem('lww_tokens', JSON.stringify(Object.assign({}, s, { skew: Number(s.expiresAt) > 0 ? Number(s.expiresAt) - inMs - now : 0, localExp: now + inMs })));
      return { status: 200, token: s.accessToken };
    }, { api: A, email, password });
    must(out.status === 200, 'customer sign-in in the browser answered ' + out.status + ' ' + JSON.stringify(out.body || {}).slice(0, 160));
    return out.token;
  }

  const desk = await newCtx();
  const page = await desk.newPage();
  watch(page, 'owner');

  /* ======================= 1. owner sign-in ======================= */
  await step('owner signs in at /admin with their own account', async () => {
    allow('owner', /^POST \/api\/auth\/login$/, 401);
    await page.goto(SITE + '/admin');
    await page.locator('#stEmail').waitFor({ timeout: 60000 });
    must(await page.locator('#stRemember').count() === 1, 'no "Keep me signed in" box');
    must(!(await page.locator('#portal').getByText(/create an account|sign up|register/i).count()), 'staff self sign-up is offered');
    must(!(await page.locator('#portal').getByText(/ADMIN_KEY|admin key|demo/i).count()), 'the sign-in page talks about an admin key or a demo');
    await veilGone(page);
    await shot(page, 'login');
    await page.fill('#stEmail', OWNER.email);
    await page.fill('#stPass', 'not-the-password-1');
    await page.locator('.portal-login button[type=submit]').click();
    await page.locator('.portal-login .alert.err').waitFor({ timeout: 15000 });
    const bad = (await page.locator('.portal-login .alert.err').textContent()).trim();
    must(/password/i.test(bad), 'wrong password said: ' + bad);
    await page.fill('#stPass', OWNER.password);
    await page.check('#stRemember');
    await page.locator('.portal-login button[type=submit]').click();
    await page.locator('.dash').waitFor({ timeout: 30000 });
    const toks = await page.evaluate(() => JSON.parse(localStorage.getItem('lww_staff_tokens') || 'null'));
    must(toks && toks.accessToken, 'no staff sign-in kept in lww_staff_tokens');
    must(!(await page.evaluate(() => localStorage.getItem('lww_tokens'))), 'the staff sign-in went into the customer slot');
    const demo = await page.evaluate(() => Object.keys(localStorage).concat(Object.keys(sessionStorage)).filter(k => /^lww_(staff_users|roles|admin_key|products|coupons|discounts|content_admin|audit|orders|users|subs|owned|messages|inbox|events|security|api|errors|payments|webhooks|prints|staff)$/.test(k)));
    must(!demo.length, 'demo keys in browser storage: ' + demo.join(', '));
    const who = await page.locator('.sb').innerText();
    must(who.includes(OWNER_NAME) && /Owner/.test(who), 'the sidebar does not name the owner: ' + who.slice(-120).replace(/\s+/g, ' '));
    return 'wrong password said "' + bad.slice(0, 60) + '"';
  });

  /* ======================= 2. every section ======================= */
  const ADMIN_SECTIONS = ['Dashboard', 'Products', 'Orders', 'Customers', 'Security', 'Messages', 'Analytics', 'Coupons', 'Content', 'Roles', 'Settings', 'Audit logs'];
  await step('every admin section loads server data with no console or API errors', async () => {
    const seen = await sidebar(page);
    must(JSON.stringify(seen) === JSON.stringify(ADMIN_SECTIONS), 'owner sidebar: ' + seen.join(', '));
    const c0 = consoleErrors.length, b0 = badApi.length;
    for (const s of ADMIN_SECTIONS) {
      await go(page, s);
      await sleep(500);
      const errs = await errorNotes(page);
      must(!errs.length, s + ' shows an error: ' + errs.join(' | ').slice(0, 200));
      must(!(await page.locator('main.mn').getByText(/sample data|demo data|this browser only|SQLite|ADMIN_KEY|no expiry/i).count()), s + ' still has demo wording');
      await shot(page, 'admin-' + s.toLowerCase().replace(/ /g, '-'));
    }
    must(consoleErrors.length === c0, 'console: ' + consoleErrors.slice(c0).join(' | ').slice(0, 300));
    const bad = unexpectedApi(b0);
    must(!bad.length, 'API errors: ' + bad.map(b => b.status + ' ' + b.method + ' ' + b.path).join(' | '));
    return ADMIN_SECTIONS.length + ' sections';
  });

  const DEV_EXPECT = {
    Dashboard: p => p.locator('main.mn [data-health]').waitFor({ timeout: 20000 }),
    Errors: p => p.locator('main.mn [data-section=server-problems]').waitFor({ timeout: 20000 }),
    Emails: p => p.locator('main.mn [data-section=emails]').waitFor({ timeout: 20000 }),
    'API monitoring': async p => { await p.locator('main.mn').getByText('Answering', { exact: true }).waitFor({ timeout: 20000 }); },
    Database: p => p.locator('main.mn [data-section=db-tables]').waitFor({ timeout: 20000 }),
    Performance: p => p.locator('main.mn').getByText('Measured in this browser', { exact: true }).waitFor({ timeout: 20000 }),
    Payments: p => p.locator('main.mn [data-section=payments]').waitFor({ timeout: 20000 }),
    Webhooks: p => p.locator('main.mn [data-section=webhooks]').waitFor({ timeout: 20000 }),
    Authentication: async p => { await p.locator('main.mn [data-section=auth]').waitFor({ timeout: 20000 }); await p.locator('main.mn [data-section=session-controls]').waitFor({ timeout: 20000 }); },
    Security: p => p.locator('main.mn [data-section=security-events]').waitFor({ timeout: 20000 }),
    Deployments: p => p.locator('main.mn').getByText('Running now', { exact: true }).waitFor({ timeout: 20000 }),
    Backups: p => p.locator('main.mn [data-section=exports]').waitFor({ timeout: 20000 }),
    'Audit logs': p => p.locator('main.mn .eyebrow', { hasText: /^Audit logs/ }).first().waitFor({ timeout: 20000 }),
  };
  const DEV_SECTIONS = Object.keys(DEV_EXPECT);
  await step('every developer section loads server data with no console or API errors', async () => {
    await page.goto(SITE + '/developer');
    await page.locator('.dash').waitFor({ timeout: 60000 });
    await veilGone(page);
    try { return await walkDeveloper(); } finally { await toAdmin(page); }
  });
  async function walkDeveloper() {
    const seen = await sidebar(page);
    must(DEV_SECTIONS.every(s => seen.includes(s)) && seen.length === DEV_SECTIONS.length, 'developer sidebar: ' + seen.join(', '));
    const c0 = consoleErrors.length, b0 = badApi.length;
    for (const s of seen) {
      await go(page, s);
      await DEV_EXPECT[s](page);
      await sleep(400);
      const errs = await errorNotes(page);
      must(!errs.length, s + ' shows an error: ' + errs.join(' | ').slice(0, 200));
      must(!(await page.locator('main.mn [data-no-access]').count()), s + ' says no permission to the owner');
      must(!(await page.locator('main.mn').getByText(/sample data|demo data|SQLite|ADMIN_KEY|no expiry|localStorage/i).count()), s + ' still has demo wording');
      await shot(page, 'developer-' + s.toLowerCase().replace(/ /g, '-'));
    }
    must(consoleErrors.length === c0, 'console: ' + consoleErrors.slice(c0).join(' | ').slice(0, 300));
    const bad = unexpectedApi(b0);
    must(!bad.length, 'API errors: ' + bad.map(b => b.status + ' ' + b.method + ' ' + b.path).join(' | '));
    return seen.length + ' sections';
  }

  /* ======================= 3. a support staff member ======================= */
  let supportPassword = null, supportId = null;
  await step('owner adds a support staff member; the password comes by email', async () => {
    await toAdmin(page);
    await go(page, 'Roles');
    await page.getByRole('button', { name: 'Add staff member' }).click();
    await page.fill('#stfEmail', SUPPORT.email);
    await page.fill('#stfName', SUPPORT.name);
    await page.selectOption('#stfRole', 'support');
    const ticked = await page.locator('.dm .perm-grid input[type=checkbox]:checked').count();
    must(ticked === 8, 'the support role ticks ' + ticked + ' permissions, not 8');
    await shot(page, 'roles-add-support');
    await page.locator('.dm button[type=submit]').click();
    await page.locator('.dm').waitFor({ state: 'detached', timeout: 20000 });
    await page.locator('main.mn td', { hasText: SUPPORT.email }).first().waitFor({ timeout: 15000 });
    const mail = await waitFor(async () => (await mailTo(SUPPORT.email))[0], 20000, 'the welcome email');
    const m = /(?:password|Password)[^\n]*?:\s*(\S+)/.exec(mail.text) || /\n\s*([A-Za-z0-9_\-!@#$%^&*]{12,})\s*\n/.exec(mail.text);
    must(m, 'no password in the welcome email');
    supportPassword = m[1];
    const st = ((await ownerCall('GET', '/api/admin/staff')).body.staff || []).find(s => s.email === SUPPORT.email);
    must(st && st.role === 'support' && st.active, 'server staff row: ' + JSON.stringify(st || null).slice(0, 160));
    supportId = st.userId;
    return 'welcome email "' + mail.subject + '"';
  });

  /* a note from the customer, so the support member has something to answer */
  await call('POST', '/api/contact', null, { name: 'Dev Parent', email: CUST.email, message: 'Hello, can you help me print the sheet? (' + STAMP + ')' }, { device: 'sv-e2e-contact-00001' });

  let supCtx = null, sup = null;
  await step('the support member sees only their sections, and the server refuses a forbidden change (403)', async () => {
    must(supportPassword, 'no password');
    supCtx = await newCtx({ viewport: { width: 1280, height: 860 } });
    sup = await supCtx.newPage();
    watch(sup, 'support');
    await staffSignIn(sup, SUPPORT.email, supportPassword);
    const seen = await sidebar(sup);
    const want = ['Dashboard', 'Products', 'Orders', 'Customers', 'Security', 'Messages'];
    must(JSON.stringify(seen) === JSON.stringify(want), 'support sidebar: ' + seen.join(', '));
    must(!(await sup.locator('.sb .sb-item[title="Developer panel"]').count()), 'the developer panel is offered to support');
    const b0 = badApi.length;
    for (const s of want) { await go(sup, s); await sleep(300); const errs = await errorNotes(sup); must(!errs.length, 'support ' + s + ' shows an error: ' + errs.join(' | ').slice(0, 160)); }
    const bad = unexpectedApi(b0);
    must(!bad.length, 'the support panel asked for something it may not have: ' + bad.map(b => b.status + ' ' + b.method + ' ' + b.path).join(' | '));
    await go(sup, 'Products');
    must(!(await sup.getByRole('button', { name: 'Upload new book' }).count()), 'support can add books');
    await go(sup, 'Orders');
    must(!(await sup.getByRole('button', { name: /^Export/ }).count()), 'support sees export buttons');
    await go(sup, 'Customers');
    await sup.locator('main.mn input[type=search]').first().fill(CUST.email);
    await sup.locator('main.mn tr', { hasText: CUST.email }).first().click({ timeout: 15000 });
    await sup.locator('main.mn h3.card-title').first().waitFor({ timeout: 15000 });
    must(!(await sup.getByRole('button', { name: /Block account|Sign out everywhere|Give access/ }).count()), 'support sees account tools');
    await go(sup, 'Security');
    must(await sup.locator('main.mn').getByText(/look but not change/i).count(), 'no read-only note on Security');
    must(!(await sup.locator('main.mn [data-act=pause-access], main.mn [data-act=block-account], main.mn [data-act=report-violation]').count()), 'support sees security actions');
    await sup.keyboard.press('Control+k');
    await sup.fill('.cmdk-in input', 'settings');
    must(await sup.locator('.cmdk-empty').count() === 1, 'Cmd+K offers Settings to support');
    await sup.keyboard.press('Escape');
    await shot(sup, 'support-security');
    allow('support', /^PUT \/api\/admin\/settings\//, 403);
    const res = await sup.evaluate(async api => {
      const t = JSON.parse(localStorage.getItem('lww_staff_tokens'));
      const r = await fetch(api + '/api/admin/settings/worksheet_access', { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t.accessToken }, body: JSON.stringify({ value: { days: 5 } }) });
      return { status: r.status, body: await r.json() };
    }, A);
    must(res.status === 403, 'a forbidden change answered ' + res.status);
    await sup.goto(SITE + '/developer');
    await sup.getByText('No developer access').waitFor({ timeout: 30000 });
    await shot(sup, 'support-no-developer');
    await toAdmin(sup);
    return 'PUT a setting as support → ' + res.status + ' (' + (res.body.code || res.body.error) + ')';
  });

  await step('support archives a customer note; after the owner takes that right away the panel says "You do not have permission for this."', async () => {
    must(sup, 'no support browser');
    await go(sup, 'Messages');
    const note = sup.locator('main.mn details.msg', { hasText: STAMP }).first();
    await note.waitFor({ timeout: 15000 });
    await note.locator('summary').click();
    await note.getByRole('button', { name: 'Archive' }).click();
    await toast(sup, /Archived/);
    await sup.locator('main.mn details.msg', { hasText: STAMP }).first().locator('.pill', { hasText: 'Archived' }).waitFor({ timeout: 10000 }).catch(() => {});
    /* the owner changes the support member in Roles: no more answering messages */
    await toAdmin(page);
    await go(page, 'Roles');
    const row = page.locator('main.mn tr', { hasText: SUPPORT.email }).first();
    await row.getByRole('button', { name: 'Change' }).click();
    const box = page.locator('.dm .perm-grid label', { hasText: 'Answer messages' }).locator('input[type=checkbox]');
    must(await box.isChecked(), '"Answer messages" was not ticked for support');
    await box.uncheck();
    await page.locator('.dm button[type=submit]').click();
    await page.locator('.dm').waitFor({ state: 'detached', timeout: 15000 });
    const st = ((await ownerCall('GET', '/api/admin/staff')).body.staff || []).find(s => s.email === SUPPORT.email);
    must(st && !st.permissions.includes('messages.write'), 'server still lets support answer messages');
    /* the support page still shows the old buttons until it asks again: the server says no */
    allow('support', /^POST \/api\/admin\/messages\/\d+\/status$/, 403);
    const again = sup.locator('main.mn details.msg', { hasText: STAMP }).first();
    if (!(await again.evaluate(d => d.open))) await again.locator('summary').click();
    await again.getByRole('button', { name: 'Back to the inbox' }).click();
    const t = await toast(sup, /You do not have permission for this\./);
    await shot(sup, 'support-403-message');
    const m = ((await ownerCall('GET', '/api/admin/messages?limit=20')).body.messages || []).find(x => String(x.body).includes(STAMP));
    must(m && m.status === 'archived', 'the note changed after all: ' + (m && m.status));
    /* the panel catches up once it asks the server again (coming back to the tab) */
    await sup.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await waitFor(async () => !(await sup.locator('main.mn details.msg', { hasText: STAMP }).first().getByRole('button', { name: 'Back to the inbox' }).count()), 15000, 'the answer buttons to go');
    return 'toast: ' + t.replace(/\s+/g, ' ').slice(0, 60);
  });
  if (supCtx) await supCtx.close();

  /* ======================= 4. a sheet: draft, PDF, on sale ======================= */
  let sheetId = null;
  await step('a draft sheet gets its PDF and cover, goes on sale and is in the public /api/worksheets', async () => {
    await toAdmin(page);
    await go(page, 'Products');
    await page.getByRole('button', { name: 'Upload new book' }).click();
    await page.locator('.studio #psTitle').waitFor({ timeout: 10000 });
    await page.fill('#psTitle', TITLE);
    await page.fill('#psDesc', 'A sheet made by the staff browser test.');
    await page.fill('#psPrice', '29');
    await page.fill('#psDays', '120');
    await page.fill('#psPrint', '2');
    await page.getByRole('button', { name: 'Save as draft' }).click();
    await page.locator('.studio .studio-status', { hasText: 'Draft' }).waitFor({ timeout: 20000 });
    sheetId = (await page.locator('.studio .studio-status .mono').textContent()).trim();
    must(await page.getByRole('button', { name: 'Save and put on sale' }).isDisabled(), 'a draft can go on sale without a PDF');
    let pub = (await (await fetch(A + '/api/worksheets')).json()).worksheets || [];
    must(!pub.some(x => x.id === sheetId), 'the draft is already in the public list');
    await page.locator('.studio .drop[data-drop="pdf"] input[type=file]').setInputFiles(PDF);
    await page.locator('.studio .drop[data-drop="image"] input[type=file]').setInputFiles(COVER);
    await page.locator('.studio .studio-status', { hasText: /PDF/ }).waitFor({ timeout: 20000 }).catch(() => {});
    await shot(page, 'product-studio');
    await page.getByRole('button', { name: 'Save and put on sale' }).click();
    await page.locator('.studio').waitFor({ state: 'detached', timeout: 30000 });
    const w = (await ownerCall('GET', '/api/admin/worksheets/' + sheetId)).body.worksheet;
    must(w && w.status === 'active' && w.pdfBytes > 1000 && w.price === 29 && w.accessDays === 120, 'sheet on the server: ' + JSON.stringify(w || {}).slice(0, 200));
    pub = (await (await fetch(A + '/api/worksheets')).json()).worksheets || [];
    const p = pub.find(x => x.id === sheetId);
    must(p && p.price === 29 && p.title === TITLE, 'not in the public list as made: ' + JSON.stringify(p || null).slice(0, 160));
    await page.locator('.book-card[data-sheet="' + sheetId + '"]').waitFor({ timeout: 10000 });
    return sheetId + ', ' + w.pdfBytes + ' bytes';
  });

  /* ======================= 5. access days reach a new quote ======================= */
  let custTok = null;
  await step('the access days setting reaches a new quote (accessDays)', async () => {
    custTok = await login(CUST.email, CUST.password, { device: 'sv-e2e-parent-quote-01' });
    const before = await call('POST', '/api/quote', custTok, { worksheet: BUY, address: ADDRESS }, { device: 'sv-e2e-parent-quote-01' });
    must(before.status === 200 && before.body.accessDays === DAYS0, 'quote before: ' + before.status + ' accessDays ' + before.body.accessDays);
    await toAdmin(page);
    await go(page, 'Settings');
    const input = page.locator('#set-worksheet_access-days');
    must(Number(await input.inputValue()) === DAYS0, 'the form shows ' + (await input.inputValue()) + ', the server ' + DAYS0);
    await input.fill(String(DAYS1));
    await input.locator('xpath=ancestor::form').getByRole('button', { name: 'Save' }).click();
    await toast(page, /saved/i);
    const after = await call('POST', '/api/quote', custTok, { worksheet: BUY, address: ADDRESS }, { device: 'sv-e2e-parent-quote-01' });
    must(after.status === 200 && after.body.accessDays === DAYS1, 'new quote accessDays ' + after.body.accessDays + ', wanted ' + DAYS1);
    must(new RegExp(String(DAYS1)).test(after.body.accessText || ''), 'the quote text does not say ' + DAYS1 + ' days: ' + after.body.accessText);
    if (sheetId) {
      const own = await call('POST', '/api/quote', custTok, { worksheet: sheetId, address: ADDRESS }, { device: 'sv-e2e-parent-quote-01' });
      must(own.status === 200 && own.body.accessDays === 120, 'the new sheet keeps its own 120 days: ' + own.body.accessDays);
    }
    await shot(page, 'settings-access-days');
    return BUY + ': ' + DAYS0 + ' → ' + DAYS1 + ' days';
  });

  /* ======================= 6. a coupon at the quote ======================= */
  await step('a coupon made in the panel applies at the quote', async () => {
    await toAdmin(page);
    await go(page, 'Coupons');
    await page.getByRole('button', { name: 'New coupon' }).click();
    await page.fill('#cpCode', COUPON);
    await page.fill('#cpPct', '10');
    await page.fill('#cpPer', '1');
    await page.selectOption('#cpApplies', 'worksheet');
    await page.locator('.dm button[type=submit]').click();
    await page.locator('.dm').waitFor({ state: 'detached', timeout: 15000 });
    await page.locator('main.mn td', { hasText: COUPON }).first().waitFor({ timeout: 10000 });
    const q = (await call('POST', '/api/quote', custTok, { worksheet: BUY, coupon: COUPON, address: ADDRESS }, { device: 'sv-e2e-parent-quote-01' })).body;
    must(q.coupon && String(q.coupon.code || q.coupon).toUpperCase() === COUPON && q.discountInr > 0 && !q.couponError, 'quote coupon: ' + JSON.stringify({ c: q.coupon, d: q.discountInr, e: q.couponError }));
    const plain = (await call('POST', '/api/quote', custTok, { worksheet: BUY, address: ADDRESS }, { device: 'sv-e2e-parent-quote-01' })).body;
    must(q.totalInr < plain.totalInr, 'the coupon did not lower the total: ' + q.totalInr + ' vs ' + plain.totalInr);
    return COUPON + ': ₹' + plain.totalInr + ' → ₹' + q.totalInr;
  });

  /* ======================= 7. a paid order, then a refund ======================= */
  let orderId = null;
  await step('the customer pays for a sheet (stand-in Razorpay) and it opens', async () => {
    const dv = { device: 'sv-e2e-parent-quote-01' };
    const q = await call('POST', '/api/quote', custTok, { worksheet: BUY, address: ADDRESS }, dv);
    must(q.status === 200 && q.body.quoteId, 'quote ' + q.status);
    const o = await call('POST', '/api/pay/order', custTok, { quoteId: q.body.quoteId, method: 'razorpay', quote: q.body }, dv);
    must(o.status === 200 && o.body.gateway, 'order ' + o.status + ' ' + JSON.stringify(o.body).slice(0, 200));
    orderId = o.body.orderId;
    const pay = await dev('/__dev/razorpay/pay', { order_id: o.body.gateway.razorpay_order_id });
    const v = await call('POST', '/api/pay/verify', custTok, Object.assign({ order_id: orderId }, pay), dv);
    must(v.status === 200, 'verify ' + v.status + ' ' + JSON.stringify(v.body).slice(0, 200));
    const acc = await call('POST', '/api/access/' + BUY, custTok, undefined, dv);
    must(acc.status === 200, 'the bought sheet answered ' + acc.status + ' ' + (acc.body.code || ''));
    return orderId;
  });

  await step('a refund recorded on the paid order ends its access', async () => {
    await toAdmin(page);
    must(orderId, 'no order');
    await go(page, 'Orders');
    await page.locator('main.mn input[type=search]').first().fill(orderId);
    await page.locator('main.mn tr', { hasText: orderId }).first().click({ timeout: 20000 });
    await page.getByRole('button', { name: 'Record a refund' }).click();
    await page.locator('.dm textarea').fill('Customer asked for a refund (staff browser test)');
    await page.locator('.dm button[type=submit]').click();
    await page.locator('.dm').waitFor({ state: 'detached', timeout: 20000 });
    await page.locator('main.mn .pill', { hasText: 'Refunded' }).first().waitFor({ timeout: 15000 });
    const r = (await ownerCall('GET', '/api/admin/orders/' + orderId)).body;
    must(r.order.status === 'refunded', 'server status ' + r.order.status);
    must((r.entitlements || []).length && r.entitlements.every(e => !e.active), 'access still open after the refund');
    const acc = await call('POST', '/api/access/' + BUY, custTok, undefined, { device: 'sv-e2e-parent-quote-01' });
    must(acc.status !== 200, 'the refunded sheet still opens');
    await shot(page, 'order-refunded');
    return 'the refunded sheet answers ' + acc.status + ' ' + (acc.body.code || '');
  });

  /* ======================= 8. CSV export ======================= */
  await step('the orders CSV downloads with the order in it', async () => {
    await toAdmin(page);
    await page.locator('main.mn').getByRole('button', { name: /All orders|Back/ }).first().click().catch(() => {});
    await go(page, 'Orders');
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), page.getByRole('button', { name: /^Export$/ }).click()]);
    const file = SHOTS + '/orders.csv';
    await dl.saveAs(file);
    const csv = fs.readFileSync(file, 'utf8');
    must(/order/i.test(csv.split('\n')[0]) && csv.includes(orderId), 'csv: ' + csv.slice(0, 160));
    await toast(page, /Downloaded/);
    return dl.suggestedFilename() + ', ' + (csv.trim().split('\n').length - 1) + ' rows';
  });

  /* ======================= 9. account block → /account-blocked ======================= */
  let custCtx = null;
  await step('a blocked customer is sent to /account-blocked on their next request', async () => {
    custCtx = await newCtx({ viewport: { width: 1280, height: 860 } });
    const cp = await custCtx.newPage();
    watch(cp, 'customer');
    allow('customer', /.*/, [401, 403]);
    await cp.goto(SITE + '/');
    await cp.waitForFunction(() => document.readyState === 'complete', null, { timeout: 60000 });
    await customerSignInPage(cp, CUST.email, CUST.password);
    await cp.reload();
    await cp.waitForFunction(() => document.body.dataset.stage === 'site' || !!document.querySelector('#bagBtn'), null, { timeout: 60000 }).catch(() => {});
    await cp.waitForFunction(() => { try { return !!JSON.parse(localStorage.getItem('lww_tokens')).accessToken; } catch (_) { return false; } }, null, { timeout: 30000 });
    await sleep(1500);
    /* staff block the account in Admin → Customers */
    await toAdmin(page);
    await go(page, 'Customers');
    await page.locator('main.mn input[type=search]').first().fill(CUST.email);
    await page.locator('main.mn tr', { hasText: CUST.email }).first().click({ timeout: 20000 });
    await page.getByRole('button', { name: 'Block account' }).click();
    await page.locator('.dm textarea').fill('Staff browser test: blocking for a moment');
    await page.locator('.dm button[type=submit]').click();
    await page.locator('.dm').waitFor({ state: 'detached', timeout: 20000 });
    await page.locator('main.mn .pill', { hasText: 'Blocked' }).first().waitFor({ timeout: 15000 });
    await shot(page, 'customer-blocked');
    /* the customer's next request: open My Account (it asks the server) */
    await cp.evaluate(() => { const b = document.querySelector('#bagBtn'); if (b) b.click(); });
    let landed = true;
    await cp.waitForURL(/\/account-blocked$/, { timeout: 20000 }).catch(() => { landed = false; });
    await sleep(800);
    await shot(cp, 'customer-next-request-after-block');
    const at = cp.url().replace(SITE, '');
    const notice = await cp.locator('.modal.notice').innerText().catch(() => '');
    const tokens = await cp.evaluate(() => localStorage.getItem('lww_tokens'));
    must(!tokens, 'the blocked customer still has a sign-in kept');
    must(landed, 'the page stayed at ' + at + (notice ? ' and said "' + notice.replace(/\s+/g, ' ').slice(0, 80) + '"' : '') + ', not /account-blocked');
    const t = await cp.locator('.sec-blocked').innerText().catch(() => '');
    must(/suspended|blocked/i.test(t), 'the blocked page says: ' + t.slice(0, 120));
    return 'landed on /account-blocked';
  });
  await step('staff unblock the customer; they can sign in again', async () => {
    if (!(await page.getByRole('button', { name: 'Unblock account' }).count())) {
      await toAdmin(page);
      await go(page, 'Customers');
      await page.locator('main.mn input[type=search]').first().fill(CUST.email);
      await page.locator('main.mn tr', { hasText: CUST.email }).first().click({ timeout: 20000 });
    }
    await page.getByRole('button', { name: 'Unblock account' }).click();
    await page.locator('.dm button[type=submit]').click();
    await page.locator('.dm').waitFor({ state: 'detached', timeout: 20000 });
    await waitFor(async () => !(await page.locator('main.mn .pill', { hasText: /^Blocked$/ }).count()), 15000, 'the Blocked pill to go');
    await resetLimits();
    custTok = await login(CUST.email, CUST.password, { device: 'sv-e2e-parent-quote-01' });
  });
  if (custCtx) await custCtx.close();

  /* ======================= 10. three separate controls ======================= */
  await resetLimits();
  const tokA = await login(CUST.email, CUST.password, { device: 'sv-e2e-laptop-0000001', ua: UA_A });
  const tokB = await login(CUST.email, CUST.password, { device: 'sv-e2e-phone-00000001', ua: UA_B });
  const asA = (m, p) => call(m, p, tokA, undefined, { device: 'sv-e2e-laptop-0000001', ua: UA_A });
  const asB = (m, p) => call(m, p, tokB, undefined, { device: 'sv-e2e-phone-00000001', ua: UA_B });
  const sidOf = async tok => ((await call('GET', '/api/me/sessions', tok)).body.sessions || []).find(s => s.current).id;
  const sidA = await sidOf(tokA), sidB = await sidOf(tokB);
  const fresh = async n => { await resetLimits(); const r = await call('POST', '/api/auth/login', null, { email: CUST.email, password: CUST.password }, { device: 'sv-e2e-check-' + n + '-000001' }); return r; };
  const confirmDlg = async () => { await page.locator('.cfm [data-confirm]').click(); await page.locator('.cfm').waitFor({ state: 'detached', timeout: 20000 }); };
  const secNote = async re => page.locator('main.mn .lw-note', { hasText: re }).first().waitFor({ timeout: 20000 });
  const openSecCustomer = async () => {
    await toAdmin(page);
    await go(page, 'Security');
    await page.locator('main.mn [data-tab="customers"]').click();
    await page.locator('main.mn [data-field=customer-search]').fill(CUST.email);
    const row = page.locator('main.mn tr[data-customer="' + CUST.email + '"]');
    await row.waitFor({ timeout: 20000 });
    await row.locator('[data-act=open-customer]').click();
    await page.locator('main.mn [data-customer-detail="' + CUST.email + '"]').waitFor({ timeout: 20000 });
    await page.locator('main.mn [data-sessions] tr[data-session]').first().waitFor({ timeout: 20000 });
  };

  await step('staff give the customer a paid sheet from their profile (Give access)', async () => {
    await toAdmin(page);
    await go(page, 'Customers');
    await page.locator('main.mn input[type=search]').first().fill(CUST.email);
    await page.locator('main.mn tr', { hasText: CUST.email }).first().click({ timeout: 20000 });
    await page.getByRole('button', { name: 'Give access' }).click();
    await page.locator('#cuSheet').waitFor({ timeout: 10000 });
    await waitFor(async () => (await page.locator('#cuSheet option[value="' + GIVE + '"]').count()) > 0, 15000, 'the sheet list');
    await page.selectOption('#cuSheet', GIVE);
    await page.fill('#cuDays', '30');
    await page.fill('#cuReason', 'Staff browser test: a sheet to pause and restore');
    await page.locator('.dm button[type=submit]').click();
    await page.locator('.dm').waitFor({ state: 'detached', timeout: 20000 });
    await toast(page, /Access given until/);
    const r = await asB('POST', '/api/access/' + GIVE);
    must(r.status === 200, 'the given sheet answered ' + r.status + ' ' + (r.body.code || ''));
  });

  await step('blocking one sign-in stops only that sign-in (paid access and the account carry on)', async () => {
    await openSecCustomer();
    const row = page.locator('main.mn tr[data-session="' + sidA + '"]');
    await row.waitFor({ timeout: 20000 });
    await row.locator('[data-act=block-session]').click();
    await page.locator('.cfm textarea').fill('Customer does not recognise this laptop (staff browser test)');
    await confirmDlg();
    await page.locator('main.mn tr[data-session="' + sidA + '"][data-status=blocked]').waitFor({ timeout: 20000 });
    const a = await asA('GET', '/api/auth/me'), b = await asB('GET', '/api/auth/me'), pb = await asB('POST', '/api/access/' + GIVE), l = await fresh(1);
    must(a.status === 403 && a.body.code === 'session_blocked', 'blocked sign-in answered ' + a.status + ' ' + a.body.code);
    must(b.status === 200, 'the other sign-in answered ' + b.status);
    must(pb.status === 200, 'paid access changed: ' + pb.status + ' ' + (pb.body.code || ''));
    must(l.status === 200, 'a new sign-in was refused: ' + l.status);
    const c = (await ownerCall('GET', '/api/admin/security/customers?q=' + custId)).body.customers[0];
    must(c.accessStatus === 'active' && !c.blocked, 'the server shows ' + JSON.stringify({ access: c.accessStatus, blocked: c.blocked }));
    return 'A 403 session_blocked · B 200 · paid sheet 200 · new sign-in 200';
  });

  const onSecCustomer = async () => { if (!(await page.locator('main.mn [data-customer-detail="' + CUST.email + '"]').count()) || await page.locator('.cfm, .dm').count()) await openSecCustomer(); };
  await step('pausing paid access stops bought sheets only (sign-in, free sheets and the stopped sign-in stay as they were)', async () => {
    await onSecCustomer();
    await page.locator('main.mn [data-act=pause-access]').click();
    await page.locator('.cfm textarea').fill('Staff browser test: pause');
    await confirmDlg();
    await secNote(/paid access is paused/);
    const b = await asB('GET', '/api/auth/me'), pb = await asB('POST', '/api/access/' + GIVE), fb = await asB('POST', '/api/access/' + FREE), a = await asA('GET', '/api/auth/me'), l = await fresh(2);
    must(pb.status === 403 && pb.body.code === 'access_suspended', 'the paid sheet answered ' + pb.status + ' ' + pb.body.code);
    must(b.status === 200, 'sign-in B answered ' + b.status);
    must(fb.status === 200, 'the free sheet answered ' + fb.status + ' ' + (fb.body.code || ''));
    must(a.status === 403 && a.body.code === 'session_blocked', 'the stopped sign-in changed: ' + a.status + ' ' + a.body.code);
    must(l.status === 200, 'a new sign-in was refused: ' + l.status);
    await shot(page, 'security-controls-paused');
    return 'paid 403 access_suspended · free 200 · B 200 · A still session_blocked';
  });

  await step('unblocking the sign-in brings it back, still with paid access paused', async () => {
    await onSecCustomer();
    await page.locator('main.mn tr[data-session="' + sidA + '"] [data-act=unblock-session]').click();
    await page.locator('.cfm [data-confirm]').click({ timeout: 3000 }).catch(() => {});
    await page.locator('main.mn tr[data-session="' + sidA + '"][data-status=active]').waitFor({ timeout: 20000 });
    const a = await asA('GET', '/api/auth/me'), pa = await asA('POST', '/api/access/' + GIVE);
    must(a.status === 200, 'the unblocked sign-in answered ' + a.status + ' ' + (a.body.code || ''));
    must(pa.status === 403 && pa.body.code === 'access_suspended', 'paid access is no longer paused: ' + pa.status + ' ' + pa.body.code);
  });

  await step('blocking the whole account refuses sign-in and ends every session, and leaves the pause alone', async () => {
    await onSecCustomer();
    await page.locator('main.mn [data-act=block-account]').click();
    must(await page.locator('.cfm [data-confirm]').isDisabled(), 'the account can be blocked without a reason');
    await page.locator('.cfm textarea').fill('Abusive messages to staff (staff browser test)');
    await confirmDlg();
    await secNote(/account is blocked/);
    const l = await fresh(3), b = await asB('GET', '/api/auth/me');
    must(l.status === 403 && l.body.code === 'account_suspended', 'sign-in while blocked answered ' + l.status + ' ' + l.body.code);
    must(b.status === 401 || b.status === 403, 'an old sign-in still works: ' + b.status);
    const c = (await ownerCall('GET', '/api/admin/security/customers?q=' + custId)).body.customers[0];
    must(c.blocked && c.accessStatus === 'suspended', 'the server shows ' + JSON.stringify({ blocked: c.blocked, access: c.accessStatus }));
    await page.locator('main.mn [data-act=unblock-account]').click();
    await confirmDlg();
    await secNote(/can sign in again/);
    await resetLimits();
    const t = await login(CUST.email, CUST.password, { device: 'sv-e2e-check-4-000001' });
    const p = await call('POST', '/api/access/' + GIVE, t, undefined, { device: 'sv-e2e-check-4-000001' });
    must(p.status === 403 && p.body.code === 'access_suspended', 'unblocking the account also changed paid access: ' + p.status + ' ' + p.body.code);
    await page.locator('main.mn [data-act=restore-access]').click();
    await confirmDlg();
    await secNote(/paid access is open again/);
    const p2 = await call('POST', '/api/access/' + GIVE, t, undefined, { device: 'sv-e2e-check-4-000001' });
    must(p2.status === 200, 'after restoring, the paid sheet answered ' + p2.status + ' ' + (p2.body.code || ''));
    return 'blocked sign-in 403 account_suspended · pause kept through unblock · restored 200';
  });

  /* ======================= 11. the audit log names who did each change ======================= */
  await step('the audit log lists each change with the staff member\'s name', async () => {
    await toAdmin(page);
    await go(page, 'Audit logs');
    const sel = page.locator('main.mn select[aria-label="Rows per page"]').first();
    if (await sel.count()) await sel.selectOption('200').catch(() => {});
    await sleep(1200);
    await page.waitForFunction(() => !document.querySelector('main.mn .ld'), null, { timeout: 15000 }).catch(() => {});
    const rows = await page.locator('main.mn table tbody tr').evaluateAll(trs => trs.map(tr => { const td = tr.querySelectorAll('td'); return { who: td[1] ? td[1].innerText : '', what: td[2] ? td[2].innerText : '' }; }));
    must(rows.length, 'no audit rows shown');
    const WANT = [
      ['Added a staff member', OWNER_NAME], ['Changed a staff member', OWNER_NAME], ['Moved a message', SUPPORT.name],
      ['Added a sheet', OWNER_NAME], ['Uploaded a sheet PDF', OWNER_NAME], ['Changed a setting', OWNER_NAME], ['Added a coupon', OWNER_NAME],
      ['Recorded a refund', OWNER_NAME], ['Downloaded a CSV', OWNER_NAME], ['Blocked an account', OWNER_NAME], ['Unblocked an account', OWNER_NAME],
      ['Gave access', OWNER_NAME], ['Stopped a sign-in', OWNER_NAME], ['Allowed a sign-in again', OWNER_NAME], ['Paused paid access', OWNER_NAME], ['Restored paid access', OWNER_NAME],
    ];
    const missing = WANT.filter(([what, who]) => !rows.some(r => r.what.includes(what) && r.who.includes(who)));
    await shot(page, 'audit-log');
    must(!missing.length, 'missing (action, name): ' + missing.map(m => m.join(' by ')).join('; ') + ' · first rows: ' + rows.slice(0, 4).map(r => (r.who + ' / ' + r.what).replace(/\s+/g, ' ')).join(' | '));
    must(!(await page.getByRole('button', { name: /clear|delete/i }).count()), 'the audit log can be cleared');
    return WANT.length + ' actions found with names';
  });

  /* ======================= 12. phone layout ======================= */
  await step('phone: admin and developer sections fit a 390 px screen', async () => {
    const ph = await newCtx({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const p3 = await ph.newPage();
    watch(p3, 'phone');
    await staffSignIn(p3, OWNER.email, OWNER.password);
    const wide = [];
    for (const [where, list] of [['/admin', ADMIN_SECTIONS], ['/developer', DEV_SECTIONS]]) {
      if (where === '/developer') { await p3.goto(SITE + where); await p3.locator('.dash').waitFor({ timeout: 60000 }); await veilGone(p3); }
      for (const s of list) {
        await p3.locator('.hd button[aria-label="Toggle sidebar"]').click();
        await p3.locator('.dash.sb-open').waitFor({ timeout: 10000 });
        await go(p3, s);
        await sleep(400);
        const over = await p3.evaluate(() => { const m = document.querySelector('.mn'); return m ? m.scrollWidth - m.clientWidth : 0; });
        if (over > 2) wide.push(where + ' ' + s + ' +' + over + 'px');
      }
    }
    await shot(p3, 'phone-last');
    await ph.close();
    must(!wide.length, 'sideways scrolling on: ' + wide.join(', '));
  });

  /* ======================= 13. sign-out ======================= */
  await step('staff sign-out ends the staff sign-in only (a customer sign-in in the same browser stays)', async () => {
    await resetLimits();
    const custInStaffBrowser = await customerSignInPage(page, CUST.email, CUST.password);
    const staffTok = await page.evaluate(() => JSON.parse(localStorage.getItem('lww_staff_tokens')).accessToken);
    await page.locator('.hd .av-btn').click();
    await page.locator('#profileMenu.open').waitFor({ timeout: 5000 });
    await page.locator('#profileMenu').getByRole('menuitem', { name: 'Sign out' }).click();
    await page.locator('#stEmail').waitFor({ timeout: 20000 });
    await toast(page, /Signed out/);
    must(!(await page.evaluate(() => localStorage.getItem('lww_staff_tokens'))), 'the staff sign-in is still kept');
    must(await page.evaluate(() => !!localStorage.getItem('lww_tokens')), 'signing out of staff also signed the customer out');
    const old = await call('GET', '/api/admin/me', staffTok);
    must(old.status === 401, 'the old staff token still answers ' + old.status);
    const c = await call('GET', '/api/auth/me', custInStaffBrowser);
    must(c.status === 200, 'the customer sign-in in the same browser answered ' + c.status);
    await page.evaluate(() => localStorage.removeItem('lww_tokens'));
    await shot(page, 'signed-out');
    return 'old staff token → 401, customer token → 200';
  });

  /* ======================= tidy up and the overall checks ======================= */
  await step('put back the access days setting', async () => {
    const r = await ownerCall('PUT', '/api/admin/settings/worksheet_access', { value: { days: DAYS0 } });
    must(r.status === 200, 'answered ' + r.status);
  });
  await step('no request carried an x-admin-key header', async () => { must(!adminKeyHeaders.length, adminKeyHeaders.slice(0, 3).join(' | ')); });
  await step('no console errors and no unexpected API errors in any browser', async () => {
    must(!consoleErrors.length, consoleErrors.slice(0, 6).join(' | '));
    const bad = unexpectedApi(0);
    must(!bad.length, bad.slice(0, 8).map(b => b.who + ' ' + b.status + ' ' + b.method + ' ' + b.path).join(' | '));
  });

  await browser.close();
  log('\n' + (results.length - failed) + ' passed, ' + failed + ' failed' + (failed ? ':\n  ' + results.filter(r => r[0] === 'FAIL').map(r => r[1] + ': ' + r[2]).join('\n  ') : ''));
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('COULD NOT RUN:', e); process.exit(2); });
