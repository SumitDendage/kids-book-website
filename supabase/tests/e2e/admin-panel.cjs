/* The admin panel additions, end to end: Categories (subjects, academic sessions), the product
   form's new fields and Duplicate, Homepage lists and the bigger coupon form, in a real browser
   against the local dev API, then the public website showing the lists. Also screenshots at phone
   size.

   HOW TO RUN (nothing here reaches the internet): start the dev API and the website exactly as in
   products.cjs, then  node supabase/tests/e2e/admin-panel.cjs
   E2E_API, E2E_SITE and E2E_SHOTS (default /var/tmp/sb/ap-shots) point it elsewhere. */
const { chromium } = require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright');
const fs = require('fs');

const API = (process.env.E2E_API || 'http://127.0.0.1:54321').replace(/\/+$/, '');
const SITE = (process.env.E2E_SITE || 'http://127.0.0.1:5173').replace(/\/+$/, '');
const SHOTS = process.env.E2E_SHOTS || '/var/tmp/sb/ap-shots';
const STAMP = Date.now().toString(36).slice(-5);
const SUBJECT = 'Hindi ' + STAMP, ROW = 'Summer picks ' + STAMP, CODE = 'FLAT' + STAMP.toUpperCase();
fs.mkdirSync(SHOTS, { recursive: true });

let failed = 0;
const log = (...a) => console.log(...a);
async function step(name, fn) {
  const t0 = Date.now();
  try { const out = await fn(); log('PASS', name, '(' + (Date.now() - t0) + ' ms)' + (out ? ' ' + out : '')); return true; }
  catch (e) { failed++; log('FAIL', name, '-', String(e.message).split('\n')[0]); return false; }
}
const must = (c, m) => { if (!c) throw new Error(m); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const catalogue = async () => (await fetch(API + '/functions/v1/api/worksheets')).json();

(async () => {
  const users = await (await fetch(API + '/__dev/users')).json();
  const browser = await chromium.launch({ executablePath: process.env.E2E_CHROME || undefined });
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 }, reducedMotion: 'reduce' });
  await ctx.route('**/frames-webp/**', r => r.fulfill({ status: 204, body: '' }));
  const page = await ctx.newPage();
  const consoleErrors = [];
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', e => consoleErrors.push(e.message));

  const shot = name => page.screenshot({ path: SHOTS + '/' + name + '.png', fullPage: false }).catch(() => {});
  const veilGone = async () => { await page.waitForFunction(() => { const v = document.getElementById('veil'); return !v || v.classList.contains('gone'); }, null, { timeout: 30000 }).catch(() => {}); await sleep(600); };
  const toast = async re => { const end = Date.now() + 15000; let seen = ''; for (;;) { seen = await page.evaluate(() => Array.from(document.querySelectorAll('.toast, [role="status"], .toast-msg')).map(x => x.textContent).join(' | ')); if (re.test(seen)) return seen; if (Date.now() > end) throw new Error('no message ' + re + ' (saw: ' + seen.slice(0, 200) + ')'); await sleep(200); } };
  const go = async title => { await page.locator('.sb .sb-item[title="' + title + '"]').click(); await page.waitForFunction(t => { const h = document.querySelector('main.mn .mn-head h1'); return h && h.textContent.trim() === t; }, title, { timeout: 20000 }); await sleep(800); };
  const submitModal = label => page.locator('.dm button[type=submit]', { hasText: label }).click();
  const tab = name => page.locator('.tabs-s button', { hasText: name }).click();

  await step('owner signs in at /admin', async () => {
    await page.goto(SITE + '/admin');
    await page.locator('#stEmail, .dash').first().waitFor({ timeout: 60000 });
    await veilGone();
    if (!(await page.locator('.dash').count())) {
      await page.fill('#stEmail', users.owner.email); await page.fill('#stPass', users.owner.password);
      await page.locator('.portal-login button[type=submit]').click();
      await page.locator('.dash').waitFor({ timeout: 30000 });
    }
    must(await page.locator('.sb .sb-item[title="Homepage"]').count(), 'no Homepage in the menu');
  });

  await step('Categories: add a subject and an academic session', async () => {
    await go('Categories');
    await tab('Subjects');
    for (const s of ['English', 'Maths', 'Science']) must(await page.locator('.sec-row', { hasText: s }).count(), s + ' is not listed');
    await page.locator('button', { hasText: 'Add subject' }).click();
    await page.fill('#ndName', SUBJECT);
    await submitModal('Save');
    await toast(/Subject added/);
    must(await page.locator('.sec-row', { hasText: SUBJECT }).count(), 'the new subject is not listed');
    await tab('Academic sessions');
    must(await page.locator('.sec-row', { hasText: '2026-27' }).count(), '2026-27 is not listed');
    await page.locator('button', { hasText: 'Add session' }).click();
    await page.fill('#ssLabel', '2027-28');
    await page.fill('#ssFrom', '2027-04-01'); await page.fill('#ssTo', '2028-03-31');
    await submitModal('Add it');
    await page.locator('.sec-row', { hasText: '2027-28' }).waitFor({ timeout: 10000 });
    await shot('01-sessions');
  });

  await step('Products: new fields saved, subject from the list, paging', async () => {
    await go('Products');
    must(await page.locator('.pager').count(), 'no pager with 115 sheets');
    must((await page.locator('.book-grid .book-card').count()) === 24, '24 cards a page');
    await page.fill('.panel input.search', 'alphabet c');
    await page.locator('.book-card[data-sheet="az-C"]').click();
    await page.locator('#psShort').waitFor();
    must(await page.locator('#psSubj option', { hasText: SUBJECT }).count(), 'the new subject is not offered');
    await page.fill('#psShort', 'Trace the letter C');
    await page.fill('#psSku', 'KG-ENG-' + STAMP.toUpperCase());
    await page.fill('#psAge', '4 to 6 years');
    await page.fill('#psSeoT', 'Letter C tracing sheet');
    await page.locator('.label-picks .pick', { hasText: '2027-28' }).click();
    must(/Trace the letter C/.test(await page.locator('.card-look').innerText()), 'the card preview does not follow the short description');
    await shot('02-studio');
    await page.locator('.studio-actions button[type=submit]').click();
    await toast(/Saved/);
    const w = (await catalogue()).worksheets.find(x => x.id === 'az-C');
    must(w.shortDescription === 'Trace the letter C', 'short description not public: ' + w.shortDescription);
    must(w.ageGroup === '4 to 6 years' && w.seoTitle === 'Letter C tracing sheet', 'age group or SEO title missing');
    must(w.sessions.includes('2027-28'), 'session missing: ' + JSON.stringify(w.sessions));
    must(w.sku === undefined, 'the SKU is public');
  });

  let copyId = null;
  await step('Duplicate makes a draft copy and opens it', async () => {
    await page.locator('.book-card[data-sheet="az-C"]').click();
    await page.locator('.studio-more button', { hasText: 'Duplicate' }).click();
    await toast(/Copied as a draft/);
    await page.waitForFunction(() => /\(copy\)/.test((document.querySelector('#psTitle') || {}).value || ''), null, { timeout: 10000 });
    copyId = await page.locator('.studio-status .mono').innerText();
    must(copyId && copyId !== 'az-C', 'no new id');
    must(!(await catalogue()).worksheets.some(x => x.id === copyId), 'the copy is on the website');
    await page.locator('.studio button[aria-label="Close"]').click();
  });

  await step('Homepage: a new hand-picked row on the home page', async () => {
    await go('Homepage');
    must(await page.locator('.sec-row', { hasText: 'Picked for you' }).count(), 'no Picked for you');
    for (const s of ['New', 'Bestselling', 'Featured']) must(await page.locator('.sec-row', { hasText: s }).count(), s + ' missing');
    await page.locator('button', { hasText: 'Add a row' }).click();
    await page.fill('#hsTitle', ROW);
    await page.fill('#hsSub', 'Our favourites this month');
    await submitModal('Add it');
    await toast(/List added/);
    const editor = page.locator('.hs-edit');
    await editor.waitFor();
    for (const q of ['alphabet a', 'alphabet d']) {
      await editor.locator('.hs-find input').fill(q);
      await editor.locator('.hs-found li').first().locator('button').click();
    }
    must((await editor.locator('.hs-items li').count()) === 2, 'two sheets picked');
    await editor.locator('button[aria-label^="Move"][aria-label$="up"]').nth(1).click();
    await editor.locator('button', { hasText: 'Save the list' }).click();
    await toast(/Saved/);
    const row = (await catalogue()).homeSections.find(x => x.title === ROW);
    must(row && row.products.length === 2, 'the row is not public: ' + JSON.stringify(row));
    must(row.products[0] === 'az-D', 'order not kept: ' + row.products.join(','));
    await shot('03-homepage');
  });

  await step('Homepage: Bestselling set to automatic counts paid orders only', async () => {
    const best = page.locator('.hs-row', { has: page.locator('.sec-name b', { hasText: /^Bestselling$/ }) });
    await best.locator('button', { hasText: 'Sheets' }).click();
    await best.locator('.seg-opt', { hasText: 'Automatic' }).click();
    await toast(/fills itself/);
    const list = (await catalogue()).homeSections.find(x => x.id === 'bestsellers');
    must(list && list.mode === 'auto' && list.products.length === 0, 'with no paid orders the list should be empty: ' + JSON.stringify(list));
    await best.locator('.seg-opt', { hasText: 'Hand-picked' }).click();
    await toast(/hand-picked/);
    must((await catalogue()).homeSections.find(x => x.id === 'bestsellers').products.length > 0, 'the hand-picked sheets did not come back');
  });

  await step('Coupons: a fixed-amount coupon with a minimum order', async () => {
    await go('Coupons');
    await page.locator('button', { hasText: 'New coupon' }).click();
    await page.fill('#cpCode', CODE);
    await page.selectOption('#cpKind', 'fixed');
    await page.fill('#cpAmt', '10');
    await page.fill('#cpMin', '50');
    await page.selectOption('#cpApplies', 'worksheet');
    await page.fill('#cpProds', 'alphabet');
    await page.locator('.hs-found li').first().locator('button').click();
    must(await page.locator('.dm .chip.on').count() === 1, 'the picked sheet is not shown');
    await shot('04-coupon');
    await submitModal('Add the coupon');
    await toast(/added/);
    const row = page.locator('tr', { hasText: CODE });
    must(/₹10/.test(await row.innerText()) && /Orders from ₹50/.test(await row.innerText()), 'the table does not show ₹10 and the minimum');
  });

  await step('the website: the new row on the home page, in its order', async () => {
    await page.goto(SITE + '/');
    await veilGone();
    await page.waitForFunction(t => Array.from(document.querySelectorAll('.picked-row .eyebrow')).some(e => e.textContent === t), ROW, { timeout: 30000 });
    const row = page.locator('.picked-row[data-list]', { has: page.locator('.eyebrow', { hasText: ROW }) });
    must(/Our favourites this month/.test(await row.innerText()), 'no line under the heading');
    const titles = await row.locator('.shop-card').evaluateAll(els => els.map(e => e.innerText));
    must(titles.length === 2, 'two cards: ' + titles.length);
    must(/Alphabet D/.test(titles[0]) && /Alphabet A/.test(titles[1]), 'not in the list order: ' + titles.map(t => t.split('\n').find(l => /Alphabet/.test(l))).join(' | '));
    await row.scrollIntoViewIfNeeded().catch(() => {});
    await shot('05-home-row');
  });

  await step('phone size: the new pages fit a 390 px screen', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(SITE + '/admin');
    await page.locator('.dash').waitFor({ timeout: 60000 });
    await veilGone();
    const over = [];
    for (const s of ['Homepage', 'Products', 'Categories', 'Coupons']) {
      await page.locator('.hd button[aria-label="Toggle sidebar"]').click();
      await page.locator('.dash.sb-open').waitFor({ timeout: 10000 });
      await go(s);
      const w = await page.evaluate(() => { const m = document.querySelector('.mn'); return m ? m.scrollWidth - m.clientWidth : 0; });
      if (w > 2) over.push(s + ' +' + w + 'px');
      await shot('06-phone-' + s.toLowerCase());
    }
    must(!over.length, 'scrolls sideways: ' + over.join(', '));
  });

  await step('no console errors', async () => { must(!consoleErrors.length, consoleErrors.slice(0, 3).join(' | ')); });
  await browser.close();
  log(failed ? failed + ' step(s) failed' : 'all steps passed', '· screenshots in ' + SHOTS);
  process.exit(failed ? 1 : 0);
})();
