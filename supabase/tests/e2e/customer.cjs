/* Learn With Why: end-to-end check of the whole customer side, in a real browser (Playwright library,
   headless Chromium), against the dev API (the real `api` Edge Function on a local database, with fake
   Supabase Auth/Storage, fake payment gateways and captured email). Nothing reaches the internet.

   What it walks through, with a PASS or FAIL line for each step (exit code 1 when any step fails):
     landing page with no console errors · sign-up with the account-sharing agreement · the welcome email
     (password + verify link) · verify · sign in (and answer the one-time "Who will use these sheets?" with
     Parent) · a page refresh stays signed in · a free sheet in the viewer
     (watermark) · buying a paid sheet with the Razorpay stand-in · the purchase popup (Purchase Successful,
     the sheet, the end date with its time zone, My Account → My Worksheets) · the viewer's "Open until" ·
     My Account (active sheet, order history) · the purchase ends (POST /__dev/expire): the viewer clears,
     My Account lists it under Expired with Buy Access Again, which opens the checkout · contact note ·
     assistant answer from the server · a sign-in ended from My Account → Devices signs that browser out ·
     a sign-in stopped by staff shows the "sign-in was stopped" message · the 3rd confirmed sharing warning
     shows the warning popup, paid sheets stop opening and free sheets still open · a blocked account ends
     on /account-blocked · a phone-size pass (landing, shop, sheet window, My Account) with screenshots.

   HOW TO RUN (three terminals, or background the first two; any free ports and database name will do)
     1. dev API on a fresh database:
          cd supabase
          LWW_TEST_DB=lww_e2e tests/local/reset-db.sh
          LWW_TEST_DB=lww_e2e DENO_DIR=/var/tmp/sb/deno-cache NO_COLOR=1 /var/tmp/sb/tools/node_modules/.bin/deno run -A \
            --config functions/api/deno.json tests/dev-server.ts --port 54333 --origin http://127.0.0.1:5183 \
            --files ../backend/protected
        wait for "dev API on" in its output.
     2. the website pointed at it:
          cd frontend
          VITE_API_BASE_URL=http://127.0.0.1:54333/functions/v1 npx vite --port 5183 --strictPort --host 127.0.0.1
     3. this script (Playwright is installed globally; Chromium is already there):
          node supabase/tests/e2e/customer.cjs
        Environment: E2E_API (dev API root, default http://127.0.0.1:54333), E2E_SITE (default
        http://127.0.0.1:5183), E2E_SHOTS (screenshot folder, default /var/tmp/sb/fe-v-shots),
        E2E_ALL_FRAMES=1 to load all 960 frames of the forest film (by default only the first 40 load after
        the landing check, so headless Chromium stays within memory while the viewer tabs are open).
   The script starts nothing itself. Run it against a freshly reset database: it signs up a new customer each
   time, but the seeded parent@dev.local is used for the phone pass. */
const { chromium } = require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright');
const fs = require('fs');

const ROOT = (process.env.E2E_API || 'http://127.0.0.1:54333').replace(/\/+$/, '');
const SITE = (process.env.E2E_SITE || 'http://127.0.0.1:5183').replace(/\/+$/, '');
const API = ROOT + '/functions/v1';
const SHOTS = process.env.E2E_SHOTS || '/var/tmp/sb/fe-v-shots';
const ALL_FRAMES = process.env.E2E_ALL_FRAMES === '1';
fs.mkdirSync(SHOTS, { recursive: true });

/* ---------------- small helpers ---------------- */
const results = [];
let failed = 0;
const short = e => String((e && e.message) || e).split('\n').slice(0, 3).join(' | ').slice(0, 400);
async function step(name, fn, { needs } = {}) {
  const t0 = Date.now();
  const missing = (needs || []).filter(k => !state[k]);
  if (missing.length) {
    failed++; results.push({ name, ok: false, note: 'skipped: needs ' + missing.join(', ') });
    console.log('FAIL ' + name + ': skipped, an earlier step it needs did not pass (' + missing.join(', ') + ')');
    return false;
  }
  try {
    const note = await fn();
    results.push({ name, ok: true, note: note || '' });
    console.log('PASS ' + name + (note ? ' (' + note + ')' : '') + ' [' + ((Date.now() - t0) / 1000).toFixed(1) + 's]');
    return true;
  } catch (e) {
    failed++; results.push({ name, ok: false, note: short(e) });
    console.log('FAIL ' + name + ': ' + short(e));
    return false;
  }
}
const state = {};
const OWNER_DEVICE = 'e2ecustomerownerdevice01';
const j = async (method, url, body, token) => {
  const headers = { 'Content-Type': 'application/json', Origin: SITE, 'X-Device-Id': OWNER_DEVICE };
  if (token) headers.Authorization = 'Bearer ' + token;
  const r = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const out = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(method + ' ' + url.replace(ROOT, '') + ' -> ' + r.status + ' ' + JSON.stringify(out).slice(0, 240));
  return out;
};
const sleep = ms => new Promise(r => setTimeout(r, ms));
/* "9 Oct 2027, 2:45 pm IST" */
const DATE_TZ = /\d{1,2} [A-Z][a-z]{2} \d{4}, \d{1,2}:\d{2} [ap]m [A-Z]{2,5}/;
const FOREVER = /forever|never expire|does not expire|doesn't expire|yours to keep|no expiry|lifetime|for good/i;
const oneLine = s => String(s || '').replace(/\s+/g, ' ').trim();

async function waitMail(to, re, tries = 60) {
  for (let i = 0; i < tries; i++) {
    const r = await j('GET', ROOT + '/__dev/mail?to=' + encodeURIComponent(to));
    const m = (r.mail || []).find(x => re.test(x.subject + '\n' + x.text));
    if (m) return m;
    await sleep(500);
  }
  throw new Error('no email matching ' + re + ' for ' + to);
}
async function siteReady(page) {
  await page.waitForFunction(() => document.body.dataset.stage === 'site', null, { timeout: 45000 });
  await page.waitForTimeout(800);
}
/* the chapters drift with the cinematic scroll: click like a person, or dispatch the click on the element */
async function tap(page, sel) {
  try { await page.click(sel, { timeout: 5000 }); }
  catch (_) { await page.waitForSelector(sel, { state: 'attached', timeout: 10000 }); await page.locator(sel).first().dispatchEvent('click'); }
}
async function signIn(page, email, password) {
  await tap(page, '#authCard .tabs .tab:nth-child(2)');
  await page.fill('#auEmail', email);
  await page.fill('#auPass', password);
  await tap(page, '#authSubmit');
  await page.waitForFunction(() => document.querySelector('#authCard.is-signed') || document.querySelector('#authForm[data-view="agree"]') || location.pathname === '/account-blocked' || document.querySelector('#authAlert .alert.err'), null, { timeout: 25000 });
  if (await page.locator('#authForm[data-view="agree"]').count()) { await tap(page, '#auAccept'); await tap(page, '#authSubmit'); }
}
async function signedIn(page) { await page.waitForSelector('#authCard.is-signed', { timeout: 25000 }); await page.waitForTimeout(600); }
/* a new account is asked once "Who will use these sheets?" (no close button): pick one and carry on */
async function chooseAccountType(page, type = 'parent') {
  await page.waitForSelector('.type-card', { timeout: 20000 });
  await page.locator('.type-choice[data-type="' + type + '"]').click();
  await page.locator('.type-go').click();
  await page.waitForSelector('.type-card', { state: 'detached', timeout: 20000 });
  await page.waitForTimeout(400);
}
/* close whatever is on top (notice, popup, sheet window, checkout, store, drawer) the way a person would */
async function clearOverlays(page) {
  for (let i = 0; i < 6; i++) {
    if (await page.locator('.sec-modal').count()) break;   /* the warning popup needs "I Understand" */
    if (await page.locator('.modal.notice').count()) { await page.keyboard.press('Escape'); await page.waitForTimeout(400); continue; }
    if (await page.locator('#modalScrim.open').count()) { await page.keyboard.press('Escape'); await page.waitForTimeout(400); continue; }
    if (await page.locator('#bagDrawer.open, #menuDrawer.open').count()) { await page.keyboard.press('Escape'); await page.waitForTimeout(500); continue; }
    if (await page.locator('#checkout.open').count()) { await tap(page, '#checkoutBack'); await page.waitForTimeout(500); continue; }
    if (await page.locator('#shop.open').count()) { await tap(page, '#shopClose'); await page.waitForTimeout(500); continue; }
    break;
  }
}
async function openAccount(page, tab) {
  if (!(await page.locator('#bagDrawer.open').count())) {
    await clearOverlays(page);
    if (await page.locator('#bagBtn').isVisible()) await tap(page, '#bagBtn');
    else { await tap(page, '#menuBtn'); await page.waitForSelector('#menuDrawer.open'); await tap(page, '#bagBtn2'); }
  }
  await page.waitForSelector('#bagDrawer.open');
  if (tab && await page.locator('#acctTab-' + tab).count()) await tap(page, '#acctTab-' + tab);
  await page.waitForTimeout(900);
}
async function closeAccount(page) {
  if (await page.locator('#bagDrawer.open').count()) { await page.keyboard.press('Escape'); await page.waitForTimeout(500); }
}
async function openSection(page) {
  if (!(await page.locator('#shop.open').count())) {
    await clearOverlays(page);
    await tap(page, '#authCard .signed .btn-primary');   /* "Explore the sheets" on the signed-in card */
    await page.waitForSelector('#shop.open');
  }
  const browse = page.locator('#shopGrid button', { hasText: 'Browse worksheets' }).first();
  if (await browse.count()) await browse.click();
  await page.waitForSelector('#shopGrid .shop-card');
}
async function openCard(page, title) {
  await openSection(page);
  await page.locator('#shopGrid .shop-card[aria-label="' + title + '"]').click();
  await page.waitForSelector('#modalScrim.open');
  await page.waitForTimeout(500);
}
async function fillIndia(page) {
  await page.waitForSelector('#co-country');
  await page.selectOption('#co-country', 'IN');
  await page.fill('#co-line1', '12 MG Road');
  await page.fill('#co-city', 'Pune');
  await page.selectOption('#co-state', 'Maharashtra');
  await page.fill('#co-postal', '411001');
  await page.waitForFunction(() => { const b = document.querySelector('#payNow'); return b && !b.disabled; }, null, { timeout: 25000 });
  await page.waitForTimeout(500);
}
/* the viewer tab is open and has drawn the sheet's pages */
async function viewerOpen(viewer) {
  await viewer.waitForURL(/viewer\.html#t=/, { timeout: 15000 });
  const drawn = await viewer.waitForFunction(() => document.querySelector('#stage .page canvas') || /could not/i.test(document.querySelector('#veilTitle')?.textContent || ''), null, { timeout: 45000 })
    .then(() => viewer.locator('#stage .page canvas').count())
    .catch(async e => { throw new Error('viewer stuck on "' + (await viewer.locator('#veilTitle').innerText().catch(() => '?')) + '": ' + e.message.split('\n')[0]); });
  if (!drawn) {   /* a busy machine can refuse a request once (ERR_INSUFFICIENT_RESOURCES): reload once */
    console.log('  (viewer said "' + (await viewer.locator('#veilTitle').innerText().catch(() => '?')) + '"; reloading the tab once)');
    await viewer.reload();
  }
  await viewer.waitForSelector('#stage .page canvas', { timeout: 30000 });
  await viewer.waitForFunction(() => { const b = document.querySelector('#veilBtn'); return b && !b.hidden && /full screen/i.test(b.textContent); }, null, { timeout: 30000 });
}
async function noSideScroll(page, sel) {
  return page.evaluate(s => {
    const d = document.documentElement, el = s ? document.querySelector(s) : null;
    return { page: d.scrollWidth - window.innerWidth, el: el ? el.scrollWidth - el.clientWidth : 0 };
  }, sel || null);
}
/* the sign-in this browser keeps: the Supabase client's own slot (sb-…-auth-token), as { accessToken, refreshToken } */
const READ_TOKENS = () => {
  const k = Object.keys(localStorage).find(k => /^sb-.*-auth-token$/.test(k));
  const v = k ? JSON.parse(localStorage.getItem(k) || 'null') : null;
  const s = v && (v.currentSession || v);
  return s && s.access_token ? { accessToken: s.access_token, refreshToken: s.refresh_token } : null;
};
async function sessionIdOf(page) {
  const t = await page.evaluate(READ_TOKENS);
  if (!t || !t.accessToken) throw new Error('no tokens in this browser');
  const r = await j('GET', API + '/api/me/sessions', null, t.accessToken);
  const cur = (r.sessions || []).find(s => s.current);
  if (!cur) throw new Error('the API did not mark a current sign-in');
  return cur.id;
}

/* ---------------- the run ---------------- */
(async () => {
  const stamp = Date.now().toString(36);
  const email = 'e2e.parent.' + stamp + '@dev.local';
  const name = 'Meera Iyer';
  let password = null;
  const errorsBy = new Map();   /* page -> console errors */
  let web3Calls = 0;

  try { await j('POST', ROOT + '/__dev/reset-limits', {}); }
  catch (e) { console.log('FAIL the dev API answers at ' + ROOT + ': ' + short(e)); process.exit(2); }
  const users = await j('GET', ROOT + '/__dev/users');
  const ownerLogin = async () => (await j('POST', API + '/api/auth/login', { email: users.owner.email, password: users.owner.password, staff: true })).session.accessToken;

  const browser = await chromium.launch({ args: ['--disable-gpu'] });
  const mk = async (opts = {}, { allFrames = ALL_FRAMES } = {}) => {
    const ctx = await browser.newContext(Object.assign({ viewport: { width: 1366, height: 900 }, timezoneId: 'Asia/Kolkata', locale: 'en-IN' }, opts));
    await ctx.route('https://checkout.razorpay.com/v1/checkout.js', async route => {
      const r = await fetch(ROOT + '/__dev/razorpay/checkout.js');
      route.fulfill({ status: 200, contentType: 'application/javascript', body: await r.text() });
    });
    /* the older contact route: answered here, never sent out */
    await ctx.route('https://api.web3forms.com/**', route => { web3Calls++; route.fulfill({ status: 200, contentType: 'application/json', body: '{"success":true}' }); });
    if (!allFrames) {
      /* fulfilled (not aborted) so the page logs no error for a frame it never needed */
      await ctx.route(/\/frames-webp\/frame_(\d+)\.webp/, route => { const n = Number(/frame_(\d+)/.exec(route.request().url())[1]); return n > 40 ? route.fulfill({ status: 204, body: '' }) : route.continue(); });
    }
    ctx.on('page', p => {
      const list = []; errorsBy.set(p, list);
      const where = () => p.url().split('#')[0].replace(SITE, '') || '/';
      p.on('console', m => { if (m.type() === 'error') list.push(where() + ': ' + m.text().slice(0, 240)); });
      p.on('pageerror', e => list.push(where() + ': pageerror ' + e.message.slice(0, 240)));
      p.on('crash', () => list.push(where() + ': tab crashed'));
    });
    return ctx;
  };
  const errorsOf = p => errorsBy.get(p) || [];

  /* ===================== landing ===================== */
  await step('landing page loads with no console errors', async () => {
    const lctx = await mk({}, { allFrames: true });
    try {
      const p = await lctx.newPage();
      const bad = [];
      p.on('response', r => { if (r.status() >= 400) bad.push(r.status() + ' ' + r.request().method() + ' ' + r.url().replace(SITE, '').replace(ROOT, '')); });
      p.on('requestfailed', r => { if (!/frames-webp|preview-frames/.test(r.url())) bad.push('failed ' + r.url().replace(SITE, '') + ' ' + ((r.failure() && r.failure().errorText) || '')); });
      await p.goto(SITE + '/');
      await siteReady(p);
      await p.waitForSelector('#authForm[data-view="signup"]');
      await p.waitForTimeout(3000);
      await p.screenshot({ path: SHOTS + '/desktop-landing.png' });
      const errs = errorsOf(p).concat(bad);
      if (errs.length) throw new Error(errs.length + ' error(s): ' + errs.slice(0, 5).join(' || '));
      const title = await p.title();
      return 'title "' + title + '"';
    } finally { await lctx.close(); }
  });

  /* ===================== desktop: one new customer ===================== */
  const ctx = await mk();
  let page = await ctx.newPage();
  try {
    await step('sign-up needs the agreement ticked, then creates the account', async () => {
      await page.goto(SITE + '/');
      await siteReady(page);
      await page.waitForSelector('#authForm[data-view="signup"]');
      const rules = await page.locator('.accept-rules').innerText();
      await page.fill('#auName', name);
      await page.fill('#auEmail', email);
      await tap(page, '#authSubmit');
      await page.waitForSelector('#auAcceptErr', { timeout: 10000 });
      const err = await page.locator('#auAcceptErr').innerText();
      await tap(page, '#auAccept');
      await tap(page, '#authSubmit');
      await page.waitForSelector('#authAlert .alert.ok', { timeout: 20000 });
      const msg = await page.locator('#authAlert .alert.ok').innerText();
      if (!msg.includes(email)) throw new Error('unexpected: ' + msg);
      await page.locator('#authCard').screenshot({ path: SHOTS + '/desktop-signup-done.png' });
      state.signedUp = true;
      return 'rules "' + oneLine(rules).slice(0, 50) + '…", without the tick "' + oneLine(err) + '", then "' + oneLine(msg).slice(0, 70) + '"';
    });

    let verifyUrl = null;
    await step('the welcome email has a password and a verify link', async () => {
      const m = await waitMail(email, /password/i);
      const pw = /password \(keep it private\): (\S+)/.exec(m.text), link = /(https?:\/\/\S+[?&]verify=\S+)/.exec(m.text);
      if (!pw || !link) throw new Error('could not read the welcome email: ' + m.text.slice(0, 200));
      password = pw[1]; verifyUrl = link[1];
      if (!verifyUrl.startsWith(SITE)) throw new Error('the link goes to ' + verifyUrl.split('?')[0]);
      state.mail = true;
      return 'subject "' + m.subject + '"';
    }, { needs: ['signedUp'] });

    await step('the verify link confirms the email', async () => {
      const old = page;
      page = await ctx.newPage();   /* as from an email app: a new tab */
      await old.close();
      await page.goto(verifyUrl);
      await siteReady(page);
      await page.waitForSelector('#authAlert .alert', { timeout: 40000 });
      const t = await page.locator('#authAlert .alert').innerText();
      if (!/Email confirmed/i.test(t)) throw new Error('unexpected: ' + t);
      if (/verify=/.test(page.url())) throw new Error('the token stayed in the address bar');
      if (await page.inputValue('#auEmail') !== email) throw new Error('email not filled in');
      state.verified = true;
      return oneLine(t);
    }, { needs: ['mail'] });

    await step('sign in with the emailed password', async () => {
      await page.fill('#auPass', password);
      await tap(page, '#authSubmit');
      await signedIn(page);
      await chooseAccountType(page, 'parent');   /* the one-time account type question (prints-cart.cjs checks it in full) */
      const tokens = await page.evaluate(READ_TOKENS);
      if (!tokens || !tokens.accessToken || !tokens.refreshToken) throw new Error('no tokens kept');
      if (await page.evaluate(() => document.cookie.length) > 0 && /sb-|token/i.test(await page.evaluate(() => document.cookie))) throw new Error('a sign-in cookie was set');
      await page.locator('#authCard').screenshot({ path: SHOTS + '/desktop-signed-in.png' });
      state.signedIn = true;
      return 'signed in as "' + oneLine(await page.locator('#signedName').innerText().catch(() => '')) + '", bearer tokens kept';
    }, { needs: ['verified'] });

    await step('a page refresh stays signed in', async () => {
      await page.reload();
      await siteReady(page);
      await signedIn(page);
      const n = oneLine(await page.locator('#signedName').innerText().catch(() => ''));
      if (!n.includes(name.split(' ')[0])) throw new Error('signed-in card shows "' + n + '"');
      return 'still signed in as "' + n + '"';
    }, { needs: ['signedIn'] });

    await step('a free sheet opens in the viewer with the watermark', async () => {
      await openCard(page, 'Alphabet A — tracing sheet');
      const access = await page.locator('#sheetAccess').innerText();
      const [viewer] = await Promise.all([ctx.waitForEvent('page', { timeout: 15000 }), page.locator('#modal button', { hasText: 'Open it free' }).click()]);
      try {
        await viewerOpen(viewer);
        const wm = await viewer.locator('#stage .page .wm span').first().innerText();
        const pill = await viewer.locator('#lic .l').innerText();
        const veil = await viewer.locator('#veilText').innerText();
        const foot = await viewer.locator('#foot').innerText();
        await viewer.screenshot({ path: SHOTS + '/desktop-viewer-free.png' });
        if (!wm.includes(email)) throw new Error('watermark without the email: ' + wm);
        if (FOREVER.test(pill + veil + foot)) throw new Error('permanence wording in the viewer: ' + oneLine(pill + ' / ' + foot));
        if (/screenshots? (are|is) (blocked|impossible|prevented)|cannot be copied/i.test(veil + foot)) throw new Error('claims copying is impossible: ' + veil);
        return 'access row "' + oneLine(access) + '", pill "' + pill + '", watermark "' + wm.slice(0, 50) + '…"';
      } finally { await viewer.close().catch(() => {}); await page.bringToFront(); await clearOverlays(page); }
    }, { needs: ['signedIn'] });

    let viewerD = null;
    await step('buy a paid sheet (Alphabet D) through the checkout and the Razorpay stand-in', async () => {
      await openCard(page, 'Alphabet D — tracing sheet');
      const access = await page.locator('#sheetAccess').innerText();
      if (!/Open for .+ once bought/.test(access)) throw new Error('sheet access row: ' + access);
      await page.locator('#modal button', { hasText: 'Buy this PDF' }).click();
      await page.waitForSelector('#checkout.open');
      await fillIndia(page);
      const co = await page.locator('#checkout').innerText();
      const note = await page.locator('#coAccess').innerText().catch(() => '');
      if (FOREVER.test(co)) throw new Error('permanence wording in the checkout');
      if (!DATE_TZ.test(note)) throw new Error('checkout access line without a date and zone: ' + note);
      await page.screenshot({ path: SHOTS + '/desktop-checkout.png' });
      await tap(page, '#payNow');
      await page.waitForSelector('#modal.purchase', { timeout: 30000 });
      await page.waitForTimeout(900);
      state.bought = true;
      return 'access row "' + oneLine(access) + '"; checkout "' + oneLine(note).slice(0, 120) + '"';
    }, { needs: ['signedIn'] });

    await step('purchase popup: Purchase Successful, the sheet, the end date with zone, My Account → My Worksheets', async () => {
      const t = await page.locator('#modal').innerText();
      await page.screenshot({ path: SHOTS + '/desktop-purchase.png' });
      if (!/Purchase Successful/.test(t)) throw new Error('no title: ' + oneLine(t).slice(0, 200));
      if (!/Alphabet D/.test(t)) throw new Error('no sheet name');
      if (!DATE_TZ.test(t) || !/IST/.test(t)) throw new Error('no end date with its zone: ' + oneLine(t).slice(0, 300));
      if (!/My Account → My Worksheets/.test(t)) throw new Error('no "My Account → My Worksheets"');
      if (FOREVER.test(t)) throw new Error('permanence wording in the popup');
      return oneLine(t).slice(0, 220);
    }, { needs: ['bought'] });

    await step('the bought sheet opens in the viewer with "Open until <date, time, zone>"', async () => {
      const [viewer] = await Promise.all([ctx.waitForEvent('page', { timeout: 15000 }), page.locator('#modal button', { hasText: 'Open the PDF now' }).click()]);
      viewerD = viewer;
      await viewerOpen(viewer);
      const pill = await viewer.locator('#lic .l').innerText();
      const wm = await viewer.locator('#stage .page .wm span').first().innerText();
      const foot = await viewer.locator('#foot').innerText();
      await viewer.screenshot({ path: SHOTS + '/desktop-viewer-bought.png' });
      /* past the welcome card: the page itself, with the watermark and the bar */
      await viewer.click('#veilBtn');
      await viewer.waitForTimeout(900);
      await viewer.mouse.move(500, 300);
      await viewer.waitForTimeout(300);
      await viewer.screenshot({ path: SHOTS + '/desktop-viewer-bought-page.png' });
      if (!/^Open until /.test(pill) || !DATE_TZ.test(pill)) throw new Error('pill: ' + pill);
      if (!wm.includes(email)) throw new Error('watermark without the email');
      if (FOREVER.test(pill + foot)) throw new Error('permanence wording in the viewer');
      state.viewerD = true;
      return 'pill "' + pill + '"; footer "' + oneLine(foot).slice(0, 120) + '"';
    }, { needs: ['bought'] });

    await step('My Account shows the sheet as active and the order in Orders', async () => {
      await page.bringToFront();
      await clearOverlays(page);
      await openAccount(page, 'sheets');
      await page.waitForFunction(() => /Alphabet D/.test(document.querySelector('#acctPanel')?.innerText || ''), null, { timeout: 15000 });
      const t = await page.locator('#acctPanel').innerText();
      if (!/Alphabet D[\s\S]*Bought · open until \d/.test(t)) throw new Error('not listed as bought and open: ' + oneLine(t).slice(0, 300));
      if (FOREVER.test(t)) throw new Error('permanence wording in My Worksheets');
      await page.locator('#bagDrawer').screenshot({ path: SHOTS + '/desktop-account-active.png' });
      await tap(page, '#acctTab-orders');
      await page.waitForSelector('#acctPanel .acct-order', { timeout: 15000 });
      const o = await page.locator('#acctPanel .acct-order').first().innerText();
      if (!/Alphabet D/.test(o) || !/\bpaid\b/i.test(o) || !/Open until/.test(o) || !DATE_TZ.test(o)) throw new Error('order: ' + oneLine(o));
      await page.locator('#bagDrawer').screenshot({ path: SHOTS + '/desktop-account-orders.png' });
      return 'order "' + oneLine(o).slice(0, 160) + '"';
    }, { needs: ['bought'] });

    await step('when the purchase ends (POST /__dev/expire) the open viewer clears and offers Buy Access Again', async () => {
      const out = await j('POST', ROOT + '/__dev/expire', { email });
      await sleep(3300);   /* the viewer skips focus checks within 3 s of the last one */
      await viewerD.bringToFront();
      await viewerD.evaluate(() => { window.dispatchEvent(new Event('focus')); document.dispatchEvent(new Event('visibilitychange')); });
      await viewerD.waitForFunction(() => /ended/i.test(document.querySelector('#veilTitle').textContent), null, { timeout: 20000 });
      const pages = await viewerD.locator('#stage .page').count();
      const title = await viewerD.locator('#veilTitle').innerText(), text = await viewerD.locator('#veilText').innerText();
      const btn = await viewerD.locator('#veilBtn').innerText();
      await viewerD.screenshot({ path: SHOTS + '/desktop-viewer-ended.png' });
      if (pages) throw new Error(pages + ' page(s) still on screen');
      if (btn !== 'Buy Access Again') throw new Error('button "' + btn + '"');
      state.expired = true;
      return 'expired ' + JSON.stringify(out.expired ?? out) + '; "' + title + '": "' + oneLine(text).slice(0, 120) + '"';
    }, { needs: ['viewerD'] });
    if (viewerD) await viewerD.close().catch(() => {});

    await step('My Account lists it under Expired with Buy Access Again, which opens the checkout; paying there opens it again', async () => {
      await page.bringToFront();
      await clearOverlays(page);
      await openAccount(page, 'sheets');
      await page.waitForSelector('#acctPanel button:has-text("Buy Access Again")', { timeout: 15000 });
      const t = await page.locator('#acctPanel').innerText();
      if (!/Expired · 1/i.test(t) || !/Access ended on/.test(t)) throw new Error('expired list: ' + oneLine(t).slice(0, 300));
      if (/Alphabet D[^\n]*\n?[^\n]*Bought · open until/.test(t)) throw new Error('still listed as open');
      await page.locator('#bagDrawer').screenshot({ path: SHOTS + '/desktop-account-expired.png' });
      await page.click('#acctPanel button:has-text("Buy Access Again")');
      await page.waitForSelector('#checkout.open', { timeout: 15000 });
      await page.waitForTimeout(800);
      const co = await page.locator('#checkout').innerText();
      if (!/Alphabet D/.test(co)) throw new Error('the checkout is not for Alphabet D: ' + oneLine(co).slice(0, 200));
      await page.screenshot({ path: SHOTS + '/desktop-checkout-again.png' });
      await fillIndia(page);
      await tap(page, '#payNow');
      await page.waitForSelector('#modal.purchase', { timeout: 30000 });
      const pop = await page.locator('#modal').innerText();
      if (!/Purchase Successful/.test(pop) || !DATE_TZ.test(pop)) throw new Error('second purchase popup: ' + oneLine(pop).slice(0, 200));
      await clearOverlays(page);
      state.rebought = true;
      return 'checkout ' + (/buying access again/i.test(co) ? 'marked "buying access again"' : 'for Alphabet D') + '; paid again: "' + oneLine(pop).slice(0, 90) + '…"';
    }, { needs: ['expired'] });

    await step('a contact note is accepted (POST /api/contact 201) and reaches the staff inbox', async () => {
      await clearOverlays(page);
      await page.locator('#navLinks a.nav-link', { hasText: 'Contact us' }).click();
      await page.waitForSelector('#ctName', { state: 'visible', timeout: 25000 });
      await page.waitForTimeout(1500);
      await page.fill('#ctName', name);
      await page.fill('#ctEmail', email);
      await page.fill('#ctMsg', 'Hello from the customer e2e ' + stamp + '. Do you have more alphabet sheets?');
      const [resp] = await Promise.all([page.waitForResponse(r => r.url().includes('/api/contact'), { timeout: 15000 }), page.$eval('#contactForm', f => f.requestSubmit())]);
      await page.waitForSelector('#contactAlert .alert.ok', { timeout: 15000 });
      const ok = await page.locator('#contactAlert').innerText();
      const body = await resp.json().catch(() => ({}));
      if (resp.status() !== 201 || !body.ok) throw new Error('POST /api/contact ' + resp.status() + ' ' + JSON.stringify(body).slice(0, 120));
      const inbox = await j('GET', API + '/api/admin/messages?limit=50', null, await ownerLogin());
      const hit = (inbox.messages || []).find(m => String(m.body || m.message || '').includes(stamp));
      if (!hit) throw new Error('the note is not in the staff inbox');
      await page.locator('#contactForm').screenshot({ path: SHOTS + '/desktop-contact.png' }).catch(() => {});
      return '201 { ok, id ' + body.id + ', mailed ' + body.mailed + ', queued ' + body.queued + ' }; "' + oneLine(ok) + '"; Web3Forms copies ' + web3Calls;
    }, { needs: ['signedIn'] });

    await step('the assistant answers from the server', async () => {
      await page.locator('#navLinks a.nav-link', { hasText: 'Home' }).click().catch(() => {});
      await page.waitForTimeout(800);
      await page.click('button[aria-label="Ask AI"]');
      await page.waitForSelector('#ai-chat');
      /* the website answers its own FAQ list in the browser; this question is not in it, so it goes to the server */
      await page.fill('#ai-chat [aria-label="Your message"]', 'Can my dog eat chocolate?');
      const [resp] = await Promise.all([page.waitForResponse(r => r.url().includes('/api/ai/chat'), { timeout: 15000 }), page.click('button[aria-label="Send"]')]);
      const body = await resp.json();
      await page.waitForFunction(() => document.querySelectorAll('#ai-chat .ai-msg.from-ai').length >= 2 && !document.querySelector('#ai-chat .ai-typing'), null, { timeout: 15000 });
      const last = await page.locator('#ai-chat .ai-msg.from-ai .ai-bubble').last().innerText();
      await page.locator('#ai-chat').screenshot({ path: SHOTS + '/desktop-assistant.png' });
      if (resp.status() !== 200 || !body.reply) throw new Error('POST /api/ai/chat ' + resp.status());
      if (oneLine(last) !== oneLine(body.reply)) throw new Error('shown "' + oneLine(last).slice(0, 80) + '" is not the server answer "' + oneLine(body.reply).slice(0, 80) + '"');
      if (FOREVER.test(last)) throw new Error('permanence wording in the answer');
      await page.click('#ai-chat button[aria-label*="Close"], #ai-chat .ai-close', { timeout: 3000 }).catch(() => page.keyboard.press('Escape'));
      await page.waitForTimeout(400);
      return 'source ' + body.source + ': "' + oneLine(last).slice(0, 100) + '"';
    });

    let other = null;
    await step('a sign-in ended from My Account → Devices signs that browser out', async () => {
      const bctx = await mk({ viewport: { width: 1280, height: 860 } });
      try {
        other = await bctx.newPage();
        await other.goto(SITE + '/');
        await siteReady(other);
        await signIn(other, email, password);
        await signedIn(other);
        await page.bringToFront();
        await clearOverlays(page);
        await openAccount(page, 'devices');
        await page.waitForFunction(() => document.querySelectorAll('#acctPanel .acct-device').length >= 2, null, { timeout: 15000 });
        await page.locator('#bagDrawer').screenshot({ path: SHOTS + '/desktop-account-devices.png' });
        await page.locator('#acctPanel .acct-device:not(.is-current) button', { hasText: 'Sign out this device' }).first().click();
        await page.waitForFunction(() => document.querySelectorAll('#acctPanel .acct-device').length === 1, null, { timeout: 15000 });
        /* the other browser finds out at its next call to the server (here: opening My Account) */
        await other.bringToFront();
        await tap(other, '#bagBtn');
        await other.waitForSelector('.modal.notice', { timeout: 20000 });
        const t = await other.locator('.modal.notice').innerText();
        await other.waitForSelector('#authCard:not(.is-signed)', { state: 'attached', timeout: 10000 });
        await other.waitForTimeout(500);
        await other.screenshot({ path: SHOTS + '/desktop-device-signed-out.png' });
        const tokens = await other.evaluate(READ_TOKENS);
        if (!/sign in again/i.test(t)) throw new Error('notice: ' + oneLine(t));
        if (tokens) throw new Error('tokens left in the signed-out browser');
        return 'the other browser shows "' + oneLine(t).slice(0, 110) + '"';
      } finally { await bctx.close().catch(() => {}); await page.bringToFront(); }
    }, { needs: ['signedIn'] });

    const ownerToken = await ownerLogin();
    const found = await j('GET', API + '/api/admin/users?q=' + encodeURIComponent(email), null, ownerToken);
    const userId = ((found.users || []).find(u => u.email === email) || {}).id;
    state.userId = !!userId;

    await step('a sign-in stopped by staff shows the "sign-in was stopped" message', async () => {
      await clearOverlays(page);
      const sid = await sessionIdOf(page);
      await j('POST', API + '/api/admin/security/sessions/' + sid + '/block', { reason: 'Customer e2e: stop one sign-in' }, ownerToken);
      await tap(page, '#bagBtn');   /* the next call to the server hears about it */
      await page.waitForSelector('.modal.notice[data-kind="session_blocked"]', { timeout: 20000 });
      const t = await page.locator('.modal.notice').innerText();
      await page.waitForTimeout(500);
      await page.screenshot({ path: SHOTS + '/desktop-session-stopped.png' });
      const slot = await page.evaluate(READ_TOKENS);
      if (!/stopped/i.test(t)) throw new Error('notice: ' + oneLine(t));
      if (slot && slot.accessToken) throw new Error('the stopped sign-in kept its access token');
      if (await page.locator('#authCard.is-signed').count()) throw new Error('still shown as signed in');
      /* "Sign in again" starts a new sign-in */
      await page.locator('.modal.notice button', { hasText: 'Sign in again' }).click();
      await page.waitForTimeout(600);
      await signIn(page, email, password);
      await signedIn(page);
      return '"' + oneLine(t).slice(0, 140) + '"; signed in again afterwards';
    }, { needs: ['signedIn', 'userId'] });

    await step('the 3rd confirmed sharing warning shows the warning popup; paid sheets stop opening, free sheets still open', async () => {
      if (!state.rebought) throw new Error('needs an open paid sheet (the re-purchase step failed)');
      await clearOverlays(page);
      await j('POST', API + '/api/admin/security/customers/' + userId + '/report', { reason: 'The account was opened in two cities within one hour.', confirm: true }, ownerToken);
      await j('POST', API + '/api/admin/security/customers/' + userId + '/report', { reason: 'Signed in on five devices in one day.', confirm: true }, ownerToken);
      /* the third: reported first, then confirmed as an incident, the way the staff page does it */
      const rep = await j('POST', API + '/api/admin/security/customers/' + userId + '/report', { reason: 'Signed in from two countries in one hour.', confirm: false }, ownerToken);
      const conf = await j('POST', API + '/api/admin/security/incidents/' + rep.incidentId + '/confirm', { note: 'Checked by the e2e.' }, ownerToken);
      if (!conf.security || conf.security.accessStatus !== 'suspended') throw new Error('the API did not pause paid access: ' + JSON.stringify(conf.security || conf).slice(0, 200));
      await openAccount(page, 'security');   /* My Account → Security asks the server again */
      const seen = [];
      for (let i = 0; i < 3; i++) {
        await page.waitForSelector('.sec-modal', { timeout: 20000 });
        await page.waitForTimeout(700);
        const t = await page.locator('.sec-modal').innerText();
        seen.push(t);
        if (/3 of 3/.test(t)) { await page.screenshot({ path: SHOTS + '/desktop-warning-3.png' }); }
        await page.locator('.sec-modal button', { hasText: /understand/i }).first().click();
        await page.waitForTimeout(700);
        if (/3 of 3/.test(t)) break;
      }
      const third = seen.find(t => /3 of 3/.test(t));
      if (!third) throw new Error('no "3 of 3" popup; saw ' + seen.map(s => oneLine(s).slice(0, 60)).join(' | '));
      if (!/paused/i.test(third)) throw new Error('3 of 3 does not say paid sheets are paused: ' + oneLine(third).slice(0, 200));
      if (/can(not|'t) (take|make) (a )?screenshot|screenshots are (blocked|impossible)/i.test(third)) throw new Error('claims screenshots are impossible');
      await page.waitForSelector('.sec-modal', { state: 'detached', timeout: 10000 });
      const card = await page.locator('#acctPanel').innerText();
      if (!/Paused/i.test(card)) throw new Error('security card: ' + oneLine(card).slice(0, 200));
      await page.locator('#bagDrawer').screenshot({ path: SHOTS + '/desktop-account-paused.png' });

      /* a paid sheet that is on the account no longer opens */
      await closeAccount(page);
      await openCard(page, 'Alphabet D — tracing sheet');
      await page.locator('#modal .sheet-actions .btn-primary').first().click();
      await page.waitForSelector('.modal.notice', { timeout: 20000 });
      const n = await page.locator('.modal.notice').innerText();
      await page.waitForTimeout(800);
      await page.screenshot({ path: SHOTS + '/desktop-paid-paused.png' });
      const viewers = ctx.pages().filter(p => /viewer\.html/.test(p.url()));
      if (viewers.length) throw new Error('a viewer tab opened for the paused paid sheet');
      if (!/paused/i.test(n)) throw new Error('notice: ' + oneLine(n));
      await clearOverlays(page);

      /* a free sheet still opens */
      await openCard(page, 'Alphabet B — tracing sheet');
      const [viewer] = await Promise.all([ctx.waitForEvent('page', { timeout: 15000 }), page.locator('#modal button', { hasText: 'Open it free' }).click()]);
      try {
        await viewerOpen(viewer);
        const wm = await viewer.locator('#stage .page .wm span').first().innerText();
        if (!wm.includes(email)) throw new Error('free sheet watermark');
      } finally { await viewer.close().catch(() => {}); await page.bringToFront(); await clearOverlays(page); }
      return 'popups ' + seen.map(s => (/(\d) of 3/.exec(s) || [])[0]).join(', ') + '; paid sheet: "' + oneLine(n).slice(0, 90) + '…"; the free sheet opened and drew its pages';
    }, { needs: ['signedIn', 'userId'] });

    await step('a blocked account ends on /account-blocked', async () => {
      await clearOverlays(page);
      await j('POST', API + '/api/admin/users/' + userId + '/block', { reason: 'Customer e2e: account block' }, ownerToken);
      await openAccount(page);   /* the next call to the server hears about it */
      await page.waitForFunction(() => location.pathname === '/account-blocked' || document.querySelector('.modal.notice'), null, { timeout: 20000 });
      let how = 'straight away';
      if (!/\/account-blocked$/.test(new URL(page.url()).pathname)) {
        /* the API answers 401 to the open sign-in (the block ended it): the next sign-in shows the page */
        const note = oneLine(await page.locator('.modal.notice').innerText());
        how = 'after "' + note.slice(0, 40) + '…" and a new sign-in attempt';
        await clearOverlays(page);
        await signIn(page, email, password);
      }
      await page.waitForURL(/\/account-blocked$/, { timeout: 20000 });
      await page.waitForSelector('.sec-blocked.open', { timeout: 15000 });
      await page.waitForTimeout(800);
      const t = await page.locator('.sec-blocked').innerText();
      await page.screenshot({ path: SHOTS + '/desktop-account-blocked.png' });
      if (!t.includes(email)) throw new Error('the page does not name the account: ' + oneLine(t).slice(0, 200));
      const tokens = await page.evaluate(READ_TOKENS);
      if (tokens) throw new Error('tokens kept for a blocked account');
      return how + '; "' + oneLine(t).slice(0, 120) + '"';
    }, { needs: ['signedIn', 'userId'] });
  } catch (e) {
    failed++; console.log('FAIL desktop flow stopped: ' + short(e));
  }
  const desktopErrors = ctx.pages().concat(page).flatMap(p => errorsOf(p));
  await ctx.close().catch(() => {});

  /* ===================== phone (390 × 844) ===================== */
  const pctx = await mk({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const phone = await pctx.newPage();
  const parent = users.customer;
  await step('phone: landing page', async () => {
    await phone.goto(SITE + '/');
    await siteReady(phone);
    await phone.waitForTimeout(1500);
    await phone.screenshot({ path: SHOTS + '/phone-landing.png' });
    const w = await noSideScroll(phone);
    if (w.page > 0) throw new Error('the page scrolls sideways by ' + w.page + 'px');
    for (let i = 0; i < 4; i++) { await phone.mouse.wheel(0, 260); await phone.waitForTimeout(250); }
    await phone.waitForTimeout(800);
    await phone.screenshot({ path: SHOTS + '/phone-landing-card.png' });
    await signIn(phone, parent.email, parent.password);
    await signedIn(phone);
    await phone.screenshot({ path: SHOTS + '/phone-signed-in.png' });
    state.phone = true;
    return 'no sideways scroll; signed in as ' + parent.email;
  });

  await step('phone: the shop', async () => {
    await openSection(phone);
    await phone.waitForTimeout(800);
    await phone.screenshot({ path: SHOTS + '/phone-shop.png' });
    const w = await noSideScroll(phone, '#shop');
    if (w.page > 0 || w.el > 1) throw new Error('sideways scroll: page ' + w.page + 'px, shop ' + w.el + 'px');
    const cards = await phone.locator('#shopGrid .shop-card').count();
    return cards + ' cards, no sideways scroll';
  }, { needs: ['phone'] });

  await step('phone: the sheet window', async () => {
    await openCard(phone, 'Alphabet E — tracing sheet');
    await phone.waitForTimeout(600);
    await phone.screenshot({ path: SHOTS + '/phone-sheet.png' });
    const t = await phone.locator('#modal').innerText();
    const access = await phone.locator('#sheetAccess').innerText().catch(() => '');
    const fit = await phone.evaluate(() => { const m = document.querySelector('#modal'); const r = m.getBoundingClientRect(); return { left: Math.round(r.left), right: Math.round(r.right), over: m.scrollWidth - m.clientWidth }; });
    if (fit.left < 0 || fit.right > 390 || fit.over > 1) throw new Error('the sheet window does not fit: ' + JSON.stringify(fit));
    if (FOREVER.test(t)) throw new Error('permanence wording');
    /* the sheet window scrolls inside itself on a phone: the access row and the buttons sit at the bottom */
    await phone.evaluate(() => {
      const m = document.querySelector('#modal');
      [m, ...m.querySelectorAll('*')].forEach(el => { const o = getComputedStyle(el).overflowY; if ((o === 'auto' || o === 'scroll') && el.scrollHeight > el.clientHeight + 2) el.scrollTop = el.scrollHeight; });
    });
    await phone.waitForTimeout(500);
    await phone.screenshot({ path: SHOTS + '/phone-sheet-actions.png' });
    await phone.keyboard.press('Escape'); await phone.waitForTimeout(500);
    return 'access "' + oneLine(access) + '", fits ' + JSON.stringify(fit);
  }, { needs: ['phone'] });

  await step('phone: My Account (every tab)', async () => {
    await clearOverlays(phone);
    await openAccount(phone, 'sheets');
    await phone.screenshot({ path: SHOTS + '/phone-account-sheets.png' });
    const overs = {};
    for (const t of ['sheets', 'orders', 'devices', 'security']) {
      await tap(phone, '#acctTab-' + t); await phone.waitForTimeout(1300);
      if (t !== 'sheets') await phone.screenshot({ path: SHOTS + '/phone-account-' + t + '.png' });
      const w = await noSideScroll(phone, '#bagDrawer');
      overs[t] = w.el;
      if (w.page > 0 || w.el > 1) throw new Error(t + ' tab scrolls sideways: page ' + w.page + 'px, drawer ' + w.el + 'px');
    }
    const t = await phone.locator('#acctPanel').innerText();
    if (FOREVER.test(t)) throw new Error('permanence wording');
    return 'no sideways scroll on any tab';
  }, { needs: ['phone'] });
  const phoneErrors = pctx.pages().flatMap(p => errorsOf(p));
  await pctx.close().catch(() => {});
  await browser.close();

  const passed = results.filter(r => r.ok).length;
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  const other = desktopErrors.concat(phoneErrors).filter(e => !/status of (401|402|403)|Failed to load resource: the server responded with a status of 40[123]/.test(e));
  if (other.length) console.log('console errors after the landing check (expected 401/402/403 answers left out):\n  ' + other.slice(0, 20).join('\n  '));
  fs.writeFileSync(SHOTS + '/results.json', JSON.stringify({ at: new Date().toISOString(), site: SITE, api: ROOT, results, consoleErrors: desktopErrors.concat(phoneErrors) }, null, 2));
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('E2E CRASHED', e); process.exit(2); });
