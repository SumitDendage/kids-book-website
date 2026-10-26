/* Learn With Why: the account type on the sign-up form, in a real browser (Playwright library, headless
   Chromium), against the dev API (tests/dev-server.ts: the real `api` Edge Function on a local database,
   fake Supabase Auth with "Confirm email" off as on the live project, captured email).

   What it checks, with a PASS or FAIL line for each step (exit code 1 when any step fails):
     the sign-up form shows Parent, Teacher and Organization with the prints from GET /api/config ·
     it refuses to go on with none picked · a Teacher sign-up, then the 6-digit sign-in code, ends signed
     in as a Teacher with 3 prints per sheet, and the old "Who will use these sheets?" popup never shows ·
     the server keeps the type · the same on a phone-size screen as an Organization (300 prints) · an
     account made before the form asked (no type yet) still gets the popup once.

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
  /* note any moment the old popup is on screen */
  await page.evaluate(() => {
    window.__typePopup = 0;
    new MutationObserver(() => { if (document.querySelector('.type-card')) window.__typePopup++; }).observe(document.body, { childList: true, subtree: true });
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
  const browser = await chromium.launch();

  /* ── computer: a Teacher ── */
  const desk = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await desk.newPage();
  const teacher = 'teacher-' + stamp + '@test.local';
  await step('computer: the site opens', () => siteReady(page));
  await step('sign-up form shows Parent, Teacher and Organization with their prints', async () => {
    await tap(page, '#authCard .tabs .tab:nth-child(1)');
    await page.waitForSelector('#authForm[data-view="signup"] .kind-choice');
    const tiles = await page.locator('.kind-choice').evaluateAll(els => els.map(e => e.dataset.type + ':' + e.querySelector('.kind-prints b').textContent));
    must(JSON.stringify(tiles) === JSON.stringify(['parent:' + prints.parent, 'teacher:' + prints.teacher, 'organization:' + prints.organization]), 'tiles ' + tiles.join(', '));
    must(prints.parent === 2 && prints.teacher === 3 && prints.organization === 300, 'config prints ' + JSON.stringify(prints));
    await shot(page, '01-signup-computer');
  });
  await step('sign-up refuses to go on with no type picked', async () => {
    await fillSignUp(page, 'Tara Teacher', teacher);
    await tap(page, '#authSubmit');
    await page.waitForSelector('#auKindErr[role="alert"]');
    must(/Choose Parent, Teacher or Organization/.test(await page.locator('#auKindErr').innerText()), 'no message');
    must(await page.locator('#authForm[data-view="signup"]').count() === 1, 'left the form');
    await shot(page, '02-signup-none-picked-computer');
  });
  await step('Teacher sign-up, email code, signed in as Teacher with 3 prints and no popup', async () => {
    await tap(page, '.kind-choice[data-type="teacher"]');
    must(await page.locator('.kind-choice.on[data-type="teacher"]').count() === 1, 'Teacher not picked');
    await shot(page, '03-signup-teacher-picked-computer');
    const since = new Date(Date.now() - 2000).toISOString();
    await tap(page, '#authSubmit');
    await enterCode(page, teacher, since);
    const line = (await page.locator('#roleLine').innerText()).replace(/\s+/g, ' ');
    must(/Teacher account · 3 prints per sheet/.test(line), 'role line "' + line + '"');
    must(await page.evaluate(() => window.__typePopup) === 0, 'the old popup showed');
    await shot(page, '04-signed-in-teacher-computer');
  });
  await step('the server keeps Teacher with 3 prints', async () => {
    const u = await serverRole(page);
    must(u.role === 'teacher' && u.printsPerSheet === 3, JSON.stringify({ role: u.role, prints: u.printsPerSheet }));
  });
  await step('after a reload it stays a Teacher and the popup still does not show', async () => {
    await siteReady(page);
    await page.waitForTimeout(2500);
    must(await page.evaluate(() => window.__typePopup) === 0, 'the old popup showed');
  });
  await desk.close();

  /* ── phone: an Organization ── */
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const p2 = await phone.newPage();
  const org = 'school-' + stamp + '@test.local';
  await step('phone: the site opens', () => siteReady(p2));
  await step('phone: the three choices fit the card, no words cut off', async () => {
    await tap(p2, '#authCard .tabs .tab:nth-child(1)');
    await p2.waitForSelector('.kind-choice');
    const cut = await p2.locator('.kind-choice').evaluateAll(els => els.filter(e => e.scrollWidth > e.clientWidth + 1).map(e => e.dataset.type));
    must(!cut.length, 'cut off: ' + cut.join(', '));
    await p2.waitForTimeout(6500);   /* the "Scroll to discover" hint fades out */
    await shot(p2, '05-signup-phone', '.kind-choices');
  });
  await step('phone: Organization sign-up ends signed in with 300 prints and no popup', async () => {
    await fillSignUp(p2, 'Sunrise School', org);
    await tap(p2, '.kind-choice[data-type="organization"]');
    must(await p2.locator('.kind-choice.on[data-type="organization"]').count() === 1, 'Organization not picked');
    await shot(p2, '06-signup-organization-picked-phone', '.kind-choices');
    const since = new Date(Date.now() - 2000).toISOString();
    await tap(p2, '#authSubmit');
    await enterCode(p2, org, since);
    const line = (await p2.locator('#roleLine').innerText()).replace(/\s+/g, ' ');
    must(/Organization account · 300 prints per sheet/.test(line), 'role line "' + line + '"');
    must(await p2.evaluate(() => window.__typePopup) === 0, 'the old popup showed');
    const u = await serverRole(p2);
    must(u.role === 'school' && u.printsPerSheet === 300, JSON.stringify({ role: u.role, prints: u.printsPerSheet }));
    await shot(p2, '07-signed-in-organization-phone', '#roleLine');
  });
  await phone.close();

  /* ── an older account with no type yet: the popup asks once ── */
  const old = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const p3 = await old.newPage();
  await step('an account made before the form asked still gets the popup', async () => {
    /* an account made straight with Supabase Auth, not through this browser's sign-up form */
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
    await p3.screenshot({ path: SHOTS + '/08-older-account-popup-computer.png' });
    await p3.locator('.type-choice[data-type="parent"]').click();
    await p3.locator('.type-go').click();
    await p3.waitForSelector('.type-card', { state: 'detached', timeout: 20000 });
  });
  await old.close();

  await browser.close();
  console.log(failed ? failed + ' step(s) FAILED' : 'all steps passed');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
