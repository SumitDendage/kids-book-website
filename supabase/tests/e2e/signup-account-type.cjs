/* Learn With Why: the account-type question right after sign-up, in a real browser (Playwright library,
   headless Chromium), against the dev API (tests/dev-server.ts: the real `api` Edge Function on a local
   database, fake Supabase Auth with "Confirm email" off as on the live project, captured email).

   What it checks, with a PASS or FAIL line for each step (exit code 1 when any step fails):
     the sign-up form itself has no account-type question · pressing "Create my account" opens the
     "Who will use these sheets?" popup with Parent, Teacher and Organization and the prints from
     GET /api/config · it cannot go on with none picked · a Teacher, then the 6-digit sign-in code, ends
     signed in as a Teacher with 3 prints per sheet, asked only that once · the server keeps the type ·
     a reload does not ask again · the same on a phone-size screen as an Organization (300 prints) · an
     account made elsewhere (no type yet) gets the popup after it signs in.

   HOW TO RUN
     1. cd supabase && LWW_TEST_DB=lww_dev tests/local/reset-db.sh
        LWW_TEST_DB=lww_dev deno run -A --config functions/api/deno.json tests/dev-server.ts \
          --port 54321 --origin http://127.0.0.1:5173
     2. cd frontend && VITE_SUPABASE_URL=http://127.0.0.1:54321 VITE_SUPABASE_PUBLISHABLE_KEY=dev \
          npx vite --host 127.0.0.1 --port 5173
     3. node supabase/tests/e2e/signup-account-type.cjs
        Environment: E2E_API (default http://127.0.0.1:54321), E2E_SITE (default http://127.0.0.1:5173),
        E2E_SHOTS (screenshot folder, default /var/tmp/sb/signup-type-shots). */
const { chromium } = require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright');
const fs = require('fs');

const API = (process.env.E2E_API || 'http://127.0.0.1:54321').replace(/\/+$/, '');
const SITE = (process.env.E2E_SITE || 'http://127.0.0.1:5173').replace(/\/+$/, '');
const SHOTS = process.env.E2E_SHOTS || '/var/tmp/sb/signup-type-shots';
fs.mkdirSync(SHOTS, { recursive: true });

let failed = 0;
const pass = m => console.log('PASS ' + m);
const fail = (m, e) => { failed++; console.log('FAIL ' + m + (e ? ': ' + (e.message || e).split('\n')[0] : '')); };
async function step(name, fn) { try { await fn(); pass(name); } catch (e) { fail(name, e); } }
const must = (ok, msg) => { if (!ok) throw new Error(msg); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const PASSWORD = 'Forest-Owl-42';
const stamp = Date.now().toString(36);

async function codeFor(email, since) {
  for (let i = 0; i < 60; i++) {
    const m = ((await (await fetch(API + '/__dev/mail?to=' + encodeURIComponent(email))).json()).mail || [])
      .find(x => x.at >= since && /code is: (\d{6})/.test(x.text));
    if (m) return /code is: (\d{6})/.exec(m.text)[1];
    await sleep(250);
  }
  throw new Error('no sign-in code mailed to ' + email);
}
async function siteReady(page) {
  await page.goto(SITE + '/');
  await page.waitForFunction(() => document.body.dataset.stage === 'site', null, { timeout: 45000 });
  await page.waitForTimeout(800);
  /* count each time the popup comes on screen */
  await page.evaluate(() => {
    window.__typePopup = 0;
    let on = false;
    new MutationObserver(() => {
      const now = !!document.querySelector('.type-card');
      if (now && !on) window.__typePopup++;
      on = now;
    }).observe(document.body, { childList: true, subtree: true });
  });
}
async function tap(page, sel) {
  try { await page.click(sel, { timeout: 5000 }); }
  catch (_) { await page.waitForSelector(sel, { state: 'attached', timeout: 10000 }); await page.locator(sel).first().dispatchEvent('click'); }
}
/* the card as a person sees it: on a phone the card is taller than the screen, so scroll to the part in question */
async function shot(page, name, sel) {
  if (page.viewportSize().width < 700) {
    /* the chapters move with the wheel (the site's own scroll), not with scrollIntoView */
    const el = page.locator(sel || '#authCard').first();
    for (let i = 0; i < 40; i++) {
      const top = await el.evaluate(e => e.getBoundingClientRect().top);
      const h = page.viewportSize().height;
      if (top > h * 0.2 && top < h * 0.45) break;
      await page.mouse.move(195, 420);
      await page.mouse.wheel(0, top > h * 0.45 ? 160 : -160);
      await page.waitForTimeout(180);
    }
    await page.waitForTimeout(700);
    await page.screenshot({ path: SHOTS + '/' + name + '.png' });
  } else await page.locator('#authCard').screenshot({ path: SHOTS + '/' + name + '.png' });
}
async function fillSignUp(page, name, email) {
  await tap(page, '#authCard .tabs .tab:nth-child(1)');
  await page.waitForSelector('#authForm[data-view="signup"]');
  await page.fill('#auName', name);
  await page.fill('#auEmail', email);
  await page.fill('#auPass', PASSWORD);
  await page.fill('#auConfirm', PASSWORD);
  await tap(page, '#auAccept');
}
/* the popup's three rows, as "type:prints" */
const popupRows = page => page.locator('.type-choice').evaluateAll(els => els.map(e => e.dataset.type + ':' + e.querySelector('.type-prints b').textContent));
/* pick one in the popup and carry on */
async function pickType(page, type, photo) {
  await page.locator('.type-choice[data-type="' + type + '"]').click();
  await page.waitForTimeout(300);
  if (photo) await page.screenshot({ path: SHOTS + '/' + photo + '.png' });
  await page.locator('.type-go').click();
  await page.waitForSelector('.type-card', { state: 'detached', timeout: 20000 });
}
/* after the password: the 6-digit code from the email, then signed in */
async function enterCode(page, email, since) {
  await page.waitForSelector('#authForm[data-view="loginOtp"]', { timeout: 25000 });
  await page.fill('#auCode', await codeFor(email, since));
  await tap(page, '#authSubmit');
  await page.waitForSelector('#authCard.is-signed', { timeout: 25000 });
  await page.waitForTimeout(1500);
}
async function serverRole(page) {
  return page.evaluate(async api => {
    const k = Object.keys(localStorage).find(x => /^sb-.*-auth-token$/.test(x));
    const t = k && JSON.parse(localStorage.getItem(k)).access_token;
    const r = await fetch(api + '/functions/v1/api/api/auth/me', { headers: { apikey: 'dev', Authorization: 'Bearer ' + t } });
    return (await r.json()).user;
  }, API);
}

(async () => {
  const config = await (await fetch(API + '/functions/v1/api/api/config')).json();
  const prints = config.prints || {};
  const expected = JSON.stringify(['parent:' + prints.parent, 'teacher:' + prints.teacher, 'organization:' + prints.organization]);
  const browser = await chromium.launch();

  /* ── computer: a Teacher ── */
  const desk = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await desk.newPage();
  const teacher = 'teacher-' + stamp + '@test.local';
  await step('computer: the site opens', () => siteReady(page));
  await step('the sign-up form itself does not ask the account type', async () => {
    must(prints.parent === 2 && prints.teacher === 3 && prints.organization === 300, 'config prints ' + JSON.stringify(prints));
    await fillSignUp(page, 'Tara Teacher', teacher);
    must(await page.locator('#authForm .type-choice, #authForm input[name="accountType"]').count() === 0, 'the form has the choice');
    await shot(page, '01-signup-form-computer');
  });
  await step('"Create my account" opens the question with Parent 2, Teacher 3, Organization 300', async () => {
    await tap(page, '#authSubmit');
    await page.waitForSelector('.type-card', { timeout: 20000 });
    await page.waitForTimeout(600);
    const rows = JSON.stringify(await popupRows(page));
    must(rows === expected, 'rows ' + rows);
    must(/Welcome, Tara/i.test(await page.locator('.type-card .eyebrow').innerText()), 'no welcome with the name');
    must(await page.locator('.type-go').isDisabled(), 'can carry on with none picked');
    await page.screenshot({ path: SHOTS + '/02-after-signup-question-computer.png' });
  });
  await step('Teacher, then the email code: signed in as Teacher with 3 prints, asked only once', async () => {
    const since = new Date(Date.now() - 2000).toISOString();
    await pickType(page, 'teacher', '03-teacher-picked-computer');
    await enterCode(page, teacher, since);
    const line = (await page.locator('#roleLine').innerText()).replace(/\s+/g, ' ');
    must(/Teacher account · 3 prints per sheet/.test(line), 'role line "' + line + '"');
    must(await page.evaluate(() => window.__typePopup) === 1, 'asked ' + await page.evaluate(() => window.__typePopup) + ' times');
    await shot(page, '04-signed-in-teacher-computer');
  });
  await step('the server keeps Teacher with 3 prints', async () => {
    const u = await serverRole(page);
    must(u.role === 'teacher' && u.printsPerSheet === 3, JSON.stringify({ role: u.role, prints: u.printsPerSheet }));
  });
  await step('after a reload it is not asked again', async () => {
    await siteReady(page);
    await page.waitForTimeout(2500);
    must(await page.evaluate(() => window.__typePopup) === 0, 'asked again');
  });
  await desk.close();

  /* ── phone: an Organization ── */
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const p2 = await phone.newPage();
  const org = 'school-' + stamp + '@test.local';
  await step('phone: the site opens', () => siteReady(p2));
  await step('phone: right after sign-up the question pops up, nothing cut off', async () => {
    await fillSignUp(p2, 'Sunrise School', org);
    await p2.waitForTimeout(6500);   /* the "Scroll to discover" hint fades out */
    await shot(p2, '05-signup-form-phone', '#authSubmit');
    await tap(p2, '#authSubmit');
    await p2.waitForSelector('.type-card', { timeout: 20000 });
    await p2.waitForTimeout(600);
    must(JSON.stringify(await popupRows(p2)) === expected, 'rows');
    const cut = await p2.locator('.type-choice').evaluateAll(els => els.filter(e => e.scrollWidth > e.clientWidth + 1).map(e => e.dataset.type));
    must(!cut.length, 'cut off: ' + cut.join(', '));
    const box = await p2.locator('.type-card').boundingBox();
    must(box && box.x >= 0 && box.x + box.width <= 390, 'the popup is wider than the screen');
    await p2.screenshot({ path: SHOTS + '/06-after-signup-question-phone.png' });
  });
  await step('phone: Organization ends signed in with 300 prints, asked only once', async () => {
    const since = new Date(Date.now() - 2000).toISOString();
    await pickType(p2, 'organization', '07-organization-picked-phone');
    await enterCode(p2, org, since);
    const line = (await p2.locator('#roleLine').innerText()).replace(/\s+/g, ' ');
    must(/Organization account · 300 prints per sheet/.test(line), 'role line "' + line + '"');
    must(await p2.evaluate(() => window.__typePopup) === 1, 'asked ' + await p2.evaluate(() => window.__typePopup) + ' times');
    const u = await serverRole(p2);
    must(u.role === 'school' && u.printsPerSheet === 300, JSON.stringify({ role: u.role, prints: u.printsPerSheet }));
    await shot(p2, '08-signed-in-organization-phone', '#roleLine');
  });
  await phone.close();

  /* ── an account made elsewhere, with no type yet: the popup asks after it signs in ── */
  const old = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const p3 = await old.newPage();
  await step('an account with no type yet gets the question after signing in', async () => {
    /* made straight with Supabase Auth, not through this browser's sign-up */
    const email = 'older-' + stamp + '@test.local';
    const made = await fetch(API + '/auth/v1/signup', { method: 'POST', headers: { apikey: 'dev', 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD, data: { name: 'Olive Older' } }) });
    must(made.ok, 'could not make the account: ' + made.status);
    await siteReady(p3);
    await tap(p3, '#authCard .tabs .tab:nth-child(2)');
    await p3.fill('#auEmail', email);
    await p3.fill('#auPass', PASSWORD);
    const since = new Date(Date.now() - 2000).toISOString();
    await tap(p3, '#authSubmit');
    await p3.waitForSelector('#authForm[data-view="agree"], #authForm[data-view="loginOtp"]', { timeout: 25000 });
    if (await p3.locator('#authForm[data-view="agree"]').count()) { await tap(p3, '#auAccept'); await tap(p3, '#authSubmit'); }
    await enterCode(p3, email, since);
    await p3.waitForSelector('.type-card', { timeout: 20000 });
    await pickType(p3, 'parent');
    const u = await serverRole(p3);
    must(u.role === 'parent' && u.printsPerSheet === 2, JSON.stringify({ role: u.role, prints: u.printsPerSheet }));
  });
  await old.close();

  await browser.close();
  console.log(failed ? failed + ' step(s) FAILED' : 'all steps passed');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
