/* The admin product manager, end to end: Admin → Products and Categories in a real browser against
   the local dev API, then the public website showing what was published.

   HOW TO RUN (nothing here reaches the internet)
     1. cd supabase && LWW_TEST_DB=lww_dev tests/local/reset-db.sh
        LWW_TEST_DB=lww_dev deno run -A --config functions/api/deno.json tests/dev-server.ts --port 54321
     2. cd frontend && VITE_SUPABASE_URL=http://127.0.0.1:54321 npx vite --port 5173 --host 127.0.0.1
     3. node supabase/tests/e2e/products.cjs
        E2E_API (default http://127.0.0.1:54321), E2E_SITE (default http://127.0.0.1:5173) and
        E2E_SHOTS (default /var/tmp/sb/pm-shots) point it elsewhere.

   WHAT IT COVERS
     owner sign-in; a new book with cover and PDF, original price + discount (selling price worked out),
     labels, home page and a Vocabulary section, published at once; a new section made in Categories and
     a free sheet put in it; a scheduled sheet; Unpublish from a card; then the website: the new book in
     the shop's Featured list, under Vocabulary › Animals and in "Picked for you" on the home page, the
     new section under "More sections", the unpublished and scheduled sheets nowhere. */
const { chromium } = require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright');
const fs = require('fs');
const path = require('path');

const API = (process.env.E2E_API || 'http://127.0.0.1:54321').replace(/\/+$/, '');
const SITE = (process.env.E2E_SITE || 'http://127.0.0.1:5173').replace(/\/+$/, '');
const SHOTS = process.env.E2E_SHOTS || '/var/tmp/sb/pm-shots';
const ROOT = path.resolve(__dirname, '../../..');
const COVER = ROOT + '/frontend/public/sheets/vocab-colours/thumb/colours-4.jpg';
const STAMP = Date.now().toString(36).slice(-5);
const BOOK = 'Animal friends ' + STAMP, FREEBIE = 'Bedtime story ' + STAMP, LATER = 'Coming next week ' + STAMP, SECTION = 'Story books ' + STAMP;
fs.mkdirSync(SHOTS, { recursive: true });

/* a small, valid one-page PDF */
function tinyPdf() {
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] >>'];
  let out = '%PDF-1.4\n'; const offs = [];
  objs.forEach((o, i) => { offs.push(out.length); out += (i + 1) + ' 0 obj\n' + o + '\nendobj\n'; });
  const x = out.length;
  out += 'xref\n0 ' + (objs.length + 1) + '\n0000000000 65535 f \n' + offs.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('');
  out += 'trailer\n<< /Size ' + (objs.length + 1) + ' /Root 1 0 R >>\nstartxref\n' + x + '\n%%EOF\n';
  const f = path.join(SHOTS, 'tiny.pdf'); fs.writeFileSync(f, out); return f;
}
const PDF = tinyPdf();

let failed = 0;
const log = (...a) => console.log(...a);
async function step(name, fn) {
  const t0 = Date.now();
  try { const out = await fn(); log('PASS', name, '(' + (Date.now() - t0) + ' ms)' + (out ? ' ' + out : '')); return true; }
  catch (e) { failed++; log('FAIL', name, '-', String(e.message).split('\n')[0]); return false; }
}
const must = (c, m) => { if (!c) throw new Error(m); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const users = await (await fetch(API + '/__dev/users')).json();
  const browser = await chromium.launch({ executablePath: process.env.E2E_CHROME || undefined });
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 }, reducedMotion: 'reduce' });
  await ctx.route('**/frames-webp/**', r => r.fulfill({ status: 204, body: '' }));
  const page = await ctx.newPage();
  const consoleErrors = [];
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  const shot = name => page.screenshot({ path: SHOTS + '/' + name + '.png', fullPage: false }).catch(() => {});
  const veilGone = async () => { await page.waitForFunction(() => { const v = document.getElementById('veil'); return !v || v.classList.contains('gone'); }, null, { timeout: 30000 }).catch(() => {}); await sleep(600); };
  const toast = async re => { const end = Date.now() + 15000; let seen = ''; for (;;) { seen = await page.evaluate(() => Array.from(document.querySelectorAll('.toast, [role="status"], .toast-msg')).map(x => x.textContent).join(' | ')); if (re.test(seen)) return seen; if (Date.now() > end) throw new Error('no message ' + re + ' (saw: ' + seen.slice(0, 200) + ')'); await sleep(200); } };
  const go = async title => { await page.locator('.sb .sb-item[title="' + title + '"]').click(); await page.waitForFunction(t => { const h = document.querySelector('main.mn .mn-head h1'); return h && h.textContent.trim() === t; }, title, { timeout: 20000 }); await sleep(800); };
  const option = async (sel, text) => { const v = await page.locator(sel + ' option', { hasText: text }).first().getAttribute('value'); await page.selectOption(sel, v); };

  async function newBook({ title, section, free, orig, pct, labels = [], home = false, vis = 'Published', when }) {
    await page.getByRole('button', { name: 'Upload new book' }).click();
    await page.locator('.studio #psTitle').waitFor({ timeout: 10000 });
    await page.fill('#psTitle', title);
    await page.fill('#psDesc', 'Made by the product manager test.');
    await page.fill('#psSubj', 'English');
    if (section) await option('#psTopic', section);
    if (free) await page.locator('.seg-opt', { hasText: 'Free' }).click();
    else { await page.fill('#psWas', String(orig)); await page.fill('#psPct', String(pct)); }
    for (const l of labels) await page.locator('.label-picks .pick', { hasText: l }).click();
    if (home) await page.locator('label.check', { hasText: 'Show on the home page' }).click();
    await page.locator('.seg-opt', { hasText: vis }).click();
    if (when) await page.fill('#psWhen', when);
    await page.locator('.studio .drop[data-drop="pdf"] input[type=file]').setInputFiles(PDF);
    await page.locator('.studio .drop[data-drop="image"] input[type=file]').setInputFiles(COVER);
  }

  await step('owner signs in at /admin', async () => {
    await page.goto(SITE + '/admin');
    await page.locator('#stEmail, .dash').first().waitFor({ timeout: 60000 });
    await veilGone();
    if (!(await page.locator('.dash').count())) {
      await page.fill('#stEmail', users.owner.email); await page.fill('#stPass', users.owner.password);
      await page.locator('.portal-login button[type=submit]').click();
      await page.locator('.dash').waitFor({ timeout: 30000 });
    }
  });

  await step('Products: filters, sales and the Categories item in the menu', async () => {
    await go('Products');
    must(await page.locator('.sb .sb-item[title="Categories"]').count(), 'no Categories in the menu');
    must(await page.locator('.filters-row select').count() === 3, 'section, label and sort filters');
    must(await page.locator('.tabs-s button', { hasText: 'Scheduled' }).count(), 'a Scheduled tab');
    await shot('01-products');
  });

  await step('a new book: discount works out the selling price, then it is published', async () => {
    await newBook({ title: BOOK, section: 'Animals', orig: 100, pct: 20, labels: ['Featured', 'Popular'], home: true });
    must(await page.inputValue('#psPrice') === '80', 'selling price ' + await page.inputValue('#psPrice'));
    must(/Customers pay ₹80 instead of ₹100 \(20% off, they save ₹20\)/.test(await page.locator('.price-sum').innerText()), 'price line');
    await shot('02-new-book-form');
    await page.locator('.studio-actions button[type=submit]').click();
    await toast(/on the website now/);
    await sleep(500);
    const ws = (await (await fetch(API + '/functions/v1/api/worksheets')).json()).worksheets.find(w => w.title === BOOK);
    must(ws, 'not in the public catalogue');
    must(ws.price === 80 && ws.wasPrice === 100, 'prices ' + ws.price + '/' + ws.wasPrice);
    must(['featured', 'popular', 'home'].every(t => ws.tags.includes(t)), 'labels ' + ws.tags);
    must(ws.section === 'vocab-animals', 'section ' + ws.section);
    await page.locator('.studio button[aria-label="Close"]').click().catch(() => {});
  });

  await step('Categories: add a section', async () => {
    await go('Categories');
    await page.getByRole('button', { name: 'Add section' }).click();
    await page.fill('#secLabel', SECTION);
    await page.fill('#secDesc', 'Short stories to read together');
    await page.locator('.dm button[type=submit]').click();
    await toast(/Section added/);
    must(await page.locator('.sec-row', { hasText: SECTION }).count(), 'section row');
    await shot('03-categories');
  });

  await step('a free sheet in the new section, and a scheduled one', async () => {
    await go('Products');
    await newBook({ title: FREEBIE, section: SECTION, free: true, labels: ['Recommended'] });
    await page.locator('.studio-actions button[type=submit]').click();
    await toast(/on the website now/);
    await page.locator('.studio button[aria-label="Close"]').click().catch(() => {});
    const d = new Date(Date.now() + 7 * 86400000), p = n => String(n).padStart(2, '0');
    await newBook({ title: LATER, section: 'Animals', orig: 50, pct: 10, vis: 'Scheduled', when: d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T10:00' });
    await page.locator('.studio-actions button[type=submit]').click();
    await toast(/goes on the website on/);
    await page.locator('.studio button[aria-label="Close"]').click().catch(() => {});
    await page.locator('.tabs-s button', { hasText: 'Scheduled' }).click();
    must(await page.locator('.book-card', { hasText: LATER }).count(), 'in the Scheduled tab');
    await shot('04-scheduled');
    await page.locator('.tabs-s button', { hasText: 'All' }).first().click();
  });

  await step('Unpublish from a card takes a sheet off the website', async () => {
    await page.fill('.panel input.search', 'alphabet b');
    const card = page.locator('.book-card[data-sheet="az-B"]');
    await card.locator('button', { hasText: 'Unpublish' }).click();
    await toast(/Unpublished/);
    const ws = (await (await fetch(API + '/functions/v1/api/worksheets')).json()).worksheets;
    must(!ws.some(w => w.id === 'az-B'), 'az-B still listed');
    must(!ws.some(w => w.title === LATER), 'the scheduled sheet is listed');
    await page.fill('.panel input.search', '');
  });

  await step('the website: home page row, shop Featured, Vocabulary › Animals, More sections', async () => {
    await page.goto(SITE + '/');
    await veilGone();
    await page.waitForFunction(t => document.body.innerText.includes(t), BOOK, { timeout: 30000 });
    must(await page.locator('.picked-row .shop-card', { hasText: BOOK }).count(), 'not in Picked for you');
    await page.locator('.picked-row').scrollIntoViewIfNeeded().catch(() => {});
    await page.locator('.ws-nav button').evaluate(b => b.click());
    await page.waitForSelector('#shop.open');
    await sleep(800);
    await page.locator('#shopViews .side-btn', { hasText: 'Featured' }).click();
    await sleep(400);
    must(await page.locator('#shopGrid .shop-card', { hasText: BOOK }).count(), 'not under Featured');
    must(/20% off/i.test(await page.locator('#shopGrid .shop-card', { hasText: BOOK }).innerText()), 'no 20% off on the card');
    await shot('05-shop-featured');
    await page.locator('#shopClasses .side-btn', { hasText: 'Animals' }).click();
    await sleep(400);
    must(await page.locator('#shopGrid .shop-card', { hasText: BOOK }).count(), 'not under Vocabulary › Animals');
    must(!(await page.locator('#shopGrid .shop-card', { hasText: LATER }).count()), 'the scheduled sheet shows');
    await page.locator('#shopViews .side-btn', { hasText: 'All sheets' }).click();
    await page.locator('#shopSections .side-btn', { hasText: SECTION }).click();
    await sleep(400);
    must(await page.locator('#shopGrid .shop-card', { hasText: FREEBIE }).count(), 'not under the new section');
    await shot('06-shop-new-section');
    await page.locator('#shopViews .side-btn', { hasText: 'All sheets' }).click();
    await page.fill('#shopSearch', 'alphabet b');
    await sleep(400);
    must(!(await page.locator('#shopGrid .shop-card[aria-label^="Alphabet B"]').count()), 'the unpublished sheet shows');
  });

  await step('Publish now puts the sheet back', async () => {
    await page.goto(SITE + '/admin');
    await page.locator('.dash').waitFor({ timeout: 60000 });
    await veilGone();
    await go('Products');
    await page.fill('.panel input.search', 'alphabet b');
    await page.locator('.book-card[data-sheet="az-B"] button', { hasText: 'Publish now' }).click();
    await toast(/Published/);
    const ws = (await (await fetch(API + '/functions/v1/api/worksheets')).json()).worksheets;
    must(ws.some(w => w.id === 'az-B'), 'az-B is not listed again');
  });

  const errs = consoleErrors.filter(t => !/favicon|frames-webp|Failed to load resource/.test(t));
  await step('no console errors', async () => must(!errs.length, errs.slice(0, 3).join(' | ')));
  await browser.close();
  log(failed ? failed + ' step(s) failed' : 'all steps passed', '· screenshots in', SHOTS);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
