/* The simpler Products page (Oct 25): the product form without tags, age group, SKU, sessions,
   stock, display order and search-engine boxes; a section typed by name; sheets by class and
   section; a new class, subject and section; many PDFs at once; no Roles menu item (staff live at the bottom of Settings, owner only).

   HOW TO RUN (nothing here reaches the internet): start the dev API and the website exactly as in
   products.cjs, then  node supabase/tests/e2e/simple-uploads.cjs
   E2E_API, E2E_SITE and E2E_SHOTS (default /var/tmp/sb/su-shots) point it elsewhere. */
const { chromium } = require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright');
const fs = require('fs');
const path = require('path');

const API = (process.env.E2E_API || 'http://127.0.0.1:54321').replace(/\/+$/, '');
const SITE = (process.env.E2E_SITE || 'http://127.0.0.1:5173').replace(/\/+$/, '');
const SHOTS = process.env.E2E_SHOTS || '/var/tmp/sb/su-shots';
const STAMP = Date.now().toString(36).slice(-4);
const CLASS = process.env.E2E_CLASS || 'Class ' + (4 + (parseInt(STAMP, 36) % 90)), SUBJECT = 'Hindi ' + STAMP, SECTION = 'Story time ' + STAMP, TYPED = 'Poems ' + STAMP;
fs.mkdirSync(SHOTS, { recursive: true });

function tinyPdf(name) {
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] >>'];
  let out = '%PDF-1.4\n'; const offs = [];
  objs.forEach((o, i) => { offs.push(out.length); out += (i + 1) + ' 0 obj\n' + o + '\nendobj\n'; });
  const x = out.length;
  out += 'xref\n0 ' + (objs.length + 1) + '\n0000000000 65535 f \n' + offs.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('');
  out += 'trailer\n<< /Size ' + (objs.length + 1) + ' /Root 1 0 R >>\nstartxref\n' + x + '\n%%EOF\n';
  const f = path.join(SHOTS, name); fs.writeFileSync(f, out); return f;
}

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
  page.on('pageerror', e => consoleErrors.push(e.message));

  const shot = (name, full) => page.screenshot({ path: SHOTS + '/' + name + '.png', fullPage: !!full }).catch(() => {});
  const veilGone = async () => { await page.waitForFunction(() => { const v = document.getElementById('veil'); return !v || v.classList.contains('gone'); }, null, { timeout: 30000 }).catch(() => {}); await sleep(600); };
  const toast = async re => { const end = Date.now() + 15000; let seen = ''; for (;;) { seen = await page.evaluate(() => Array.from(document.querySelectorAll('.toast, [role="status"], .toast-msg')).map(x => x.textContent).join(' | ')); if (re.test(seen)) return seen; if (Date.now() > end) throw new Error('no message ' + re + ' (saw: ' + seen.slice(0, 200) + ')'); await sleep(200); } };
  const go = async title => { await page.locator('.sb .sb-item[title="' + title + '"]').click(); await page.waitForFunction(t => { const h = document.querySelector('main.mn .mn-head h1'); return h && h.textContent.trim() === t; }, title, { timeout: 20000 }); await sleep(800); };
  const submitModal = label => page.locator('.dm button[type=submit]', { hasText: label }).click();
  const signIn = async who => {
    await page.goto(SITE + '/admin');
    await page.locator('#stEmail, .dash').first().waitFor({ timeout: 60000 });
    await veilGone();
    await page.fill('#stEmail', who.email); await page.fill('#stPass', who.password);
    const t0 = new Date(Date.now() - 2000).toISOString();
    await page.locator('.portal-login button[type=submit]').click();
    /* sign-in asks for the 6-digit code from the email (the dev API keeps the mail) */
    await page.locator('#stCode, .dash').first().waitFor({ timeout: 30000 });
    if (await page.locator('#stCode').count()) {
      let code = null;
      for (let i = 0; i < 50 && !code; i++) {
        const m = ((await (await fetch(API + '/__dev/mail')).json()).mail || []).find(x => x.to === who.email && x.at >= t0 && /code is: (\d{6})/.test(x.text));
        code = m && /code is: (\d{6})/.exec(m.text)[1];
        if (!code) await sleep(200);
      }
      must(code, 'no sign-in code mailed');
      await page.fill('#stCode', code);
      await page.locator('.portal-login button[type=submit]').click();
    }
    await page.locator('.dash').waitFor({ timeout: 30000 });
  };

  await step('owner signs in: no Roles in the menu, staff at the bottom of Settings', async () => {
    await signIn(users.owner);
    must(!(await page.locator('.sb .sb-item[title="Roles"]').count()), 'the menu still has Roles');
    must(!(await page.locator('.sb .sb-item[title="Categories"]').count()), 'the menu still has Categories');
    must(!(await page.locator('.sb .sb-item[title="Content"]').count()), 'the menu still has Content');
    await go('Homepage');
    for (const t of ['Sheet lists', 'Home page text', 'Reviews']) must(await page.locator('.tabs-s button', { hasText: t }).count(), 'Homepage has no ' + t + ' tab');
    must(!(await page.locator('.tabs-s button', { hasText: 'Questions and answers' }).count()), 'Homepage still has Questions and answers');
    await page.locator('.tabs-s button', { hasText: 'Home page text' }).click(); await sleep(800);
    await shot('00b-homepage-with-content');
    await go('Dashboard');
    await shot('00a-dashboard');
    await page.getByRole('button', { name: 'Sheets and sections' }).click();
    await page.locator('.browser').waitFor({ timeout: 15000 });
    await go('Settings');
    await page.getByRole('button', { name: 'Show staff' }).click();
    await page.getByRole('button', { name: 'Add staff member' }).waitFor({ timeout: 15000 });
    await shot('00-settings-staff');
  });

  await step('no Add your own box, class tabs, tool bar or All sheets switch', async () => {
    await go('Products');
    await page.locator('.browser').waitFor({ timeout: 15000 });
    must(!(await page.locator('.br-sec.add').count()), 'the Add your own section box is still there');
    must(!(await page.locator('.br-classes, .br-tools').count()), 'the class tabs or tool bar are still there');
    must(!(await page.locator('.tabs-s button', { hasText: 'All sheets' }).count()), 'the All sheets switch is still there');
  });

  await step('Products opens on sheets by class and section', async () => {
    await go('Products');
    await page.locator('.browser').waitFor({ timeout: 15000 });
    must(!(await page.locator('.br-sec', { hasText: 'Empty' }).count()), 'empty sections are shown');
    await shot('01-sections-as-cards');
    await page.locator('.br-more').click(); await sleep(300); await shot('01b-with-empty-sections', true); await page.locator('.br-more').click();
    await page.locator('.br-sec').first().click();
    await page.locator('.br-sheet').first().waitFor({ timeout: 5000 });
    await shot('01-sheets-by-section');
  });

  await step('the product form has none of the removed boxes', async () => {
    await page.locator('.br-sheet').first().click();
    await page.locator('#psTitle').waitFor();
    for (const id of ['psTags', 'psAge', 'psSku', 'psStock', 'psSort', 'psSeoT', 'psSeoD']) must(!(await page.locator('#' + id).count()), id + ' is still there');
    must(!(await page.locator('.studio legend', { hasText: /Category|Search engines|Visibility|Access and limits/ }).count()), 'old fieldsets still there');
    for (const id of ['psDays', 'psRule', 'psPrint', 'psDl']) must(!(await page.locator('#' + id).count()), id + ' is still there');
    must(!(await page.locator('.studio', { hasText: 'Academic sessions' }).count()), 'academic sessions still there');
    must(await page.locator('#psTopic').evaluate(e => e.tagName === 'INPUT'), 'the section is not a typed box');
    await page.locator('.studio legend', { hasText: 'Where it goes' }).scrollIntoViewIfNeeded();
    await shot('02-edit-sheet-form');
    await page.locator('.studio button[aria-label="Close"]').click();
  });

  await step('drop boxes keep their size while dragging and fold to one line after a drop', async () => {
    await page.locator('.mn-head button', { hasText: 'Upload new book' }).click();
    await page.locator('#psTitle').waitFor();
    const box = page.locator('.drop[data-drop="image"]');
    const h0 = (await box.boundingBox()).height;
    const r = await box.evaluate(async el => {
      const c = document.createElement('canvas'); c.width = 30; c.height = 40; c.getContext('2d').fillRect(0, 0, 30, 40);
      const blob = await new Promise(res => c.toBlob(res, 'image/png'));
      const dt = new DataTransfer(); dt.items.add(new File([blob], 'cover.png', { type: 'image/png' }));
      const fire = (t, type) => t.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }));
      const inner = el.querySelector('b');
      fire(el, 'dragenter'); fire(inner, 'dragenter'); fire(el, 'dragleave');   /* the pointer moves onto the box's own text */
      await new Promise(res => setTimeout(res, 100));
      const mid = { over: el.classList.contains('over'), h: el.getBoundingClientRect().height };
      /* a drop beside the box must not open the file */
      const outside = new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }); document.querySelector('#psTitle').dispatchEvent(outside);
      fire(inner, 'drop');
      await new Promise(res => setTimeout(res, 300));
      const after = document.querySelector('.drop[data-drop="image"]');
      return { mid, outsideBlocked: outside.defaultPrevented, compact: after.classList.contains('compact'), h: after.getBoundingClientRect().height, text: after.innerText };
    });
    must(r.mid.over && Math.abs(r.mid.h - h0) < 1, 'the box changed while dragging: ' + JSON.stringify(r.mid) + ' vs ' + h0);
    must(r.outsideBlocked, 'a drop beside the box was not stopped');
    must(r.compact && r.h < 90 && /cover\.png/.test(r.text) && /Change/.test(r.text), 'not folded: ' + JSON.stringify(r));
    await shot('02b-cover-dropped');
    await page.locator('.studio button[aria-label="Close"]').click();
    await sleep(400);
  });

  await step('a new sheet makes a new class, subject and section', async () => {
    await page.locator('.mn-head button', { hasText: 'Upload new book' }).click();
    await page.locator('#psTitle').waitFor();
    await page.fill('#psTitle', 'Rhymes ' + STAMP);
    await page.selectOption('#psCls', '+new');
    await page.fill('#psNewCls', CLASS);
    await page.fill('#psSubj', SUBJECT);
    await page.fill('#psTopic', SECTION);
    await page.locator('.studio input[type=file][accept*="pdf"]').setInputFiles(tinyPdf('rhymes.pdf'));
    await shot('03-new-class-on-a-sheet');
    await page.locator('.studio-actions button[type=submit]').click();
    await toast(/Saved|website/);
    await page.locator('.studio button[aria-label="Close"]').click().catch(() => {});
    await sleep(500);
  });

  await step('open the new class, then upload two PDFs into its section', async () => {
    await page.locator('.br-other button', { hasText: CLASS }).click();
    await page.locator('.br-head h3', { hasText: CLASS }).waitFor();
    await page.locator('.browser .st-note button', { hasText: 'Open it on the website' }).click();
    await toast(/Open on the website/);
    await page.locator('.br-sec', { hasText: SECTION }).click();
    await page.locator('.br-open-head button', { hasText: 'Upload PDFs' }).click();
    await page.locator('.dm input[type=file]').setInputFiles([tinyPdf('rhymes_part-1.pdf'), tinyPdf('rhymes_part-2.pdf')]);
    await page.fill('#buSubj', SUBJECT);
    await page.locator('.dm label.check', { hasText: 'Put them on the website now' }).click();
    await shot('05-upload-many');
    await submitModal('Upload 2 PDFs');
    await page.locator('.dm button[type=submit]', { hasText: 'Done' }).waitFor({ timeout: 30000 });
    await submitModal('Done');
    await page.locator('.br-crumbs button').click(); await sleep(300);
    await shot('04-class-4-sections');
    const ws = (await catalogue()).worksheets.filter(w => w.sectionLabel === SECTION);
    must(ws.length === 3, 'expected 3 public sheets, got ' + JSON.stringify(ws.map(w => w.title)));
  });

  await step('a new sheet with a typed new section', async () => {
    await page.locator('.mn-head button', { hasText: 'Upload new book' }).click();
    await page.locator('#psTitle').waitFor();
    await page.fill('#psTitle', 'Little poems ' + STAMP);
    await page.fill('#psSubj', 'English');
    await page.fill('#psTopic', TYPED);
    must(/New section/.test(await page.locator('#psTopic ~ small').innerText()), 'no new-section note');
    await page.locator('.studio input[type=file][accept*="pdf"]').setInputFiles(tinyPdf('poems.pdf'));
    await shot('07-new-sheet-typed-section');
    await page.locator('.studio-actions button[type=submit]').click();
    await toast(/Saved|draft|website/);
    const secs = (await catalogue()).sections || [];
    must(secs.some(x => x.label === TYPED), 'the typed section was not made');
  });

  await step('the website lists the new class', async () => {
    const r = await catalogue();
    must(r.classes.some(c => c.name === CLASS), 'class not public');
  });

  await step('phone size', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('.studio button[aria-label="Close"]').click().catch(() => {});
    await sleep(600);
    await page.locator('.browser').scrollIntoViewIfNeeded();
    await shot('08-phone-sheets-by-section');
    await page.setViewportSize({ width: 1360, height: 900 });
  });

  await step('an Administrator does not see Roles or the Developer panel', async () => {
    if (!process.env.E2E_ADMIN) return 'skipped (set E2E_ADMIN=email:password of an admin)';
    const [email, password] = process.env.E2E_ADMIN.split(':');
    await page.context().clearCookies(); await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
    await signIn({ email, password });
    must(!(await page.locator('.sb .sb-item[title="Roles"]').count()), 'an admin sees Roles');
    await go('Settings');
    must(!(await page.getByRole('button', { name: 'Show staff' }).count()), 'an admin sees the staff part of Settings');
    await shot('09-admin-menu-no-roles');
    await page.goto(SITE + '/developer'); await veilGone();
    await page.locator('text=No developer access').waitFor({ timeout: 20000 });
    await shot('10-admin-no-developer-panel');
  });

  if (consoleErrors.length) { failed++; log('FAIL page errors:', consoleErrors.slice(0, 3).join(' | ')); }
  await browser.close();
  log(failed ? failed + ' failed' : 'all passed', '· shots in', SHOTS);
  process.exit(failed ? 1 : 0);
})();
