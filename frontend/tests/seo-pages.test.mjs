import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildPages, sitemapOf, slugOf, topicsOf, topicPath, SITE, HUB } from '../scripts/build-seo-pages.mjs';

const cat = JSON.parse(await readFile(new URL('../scripts/seo-catalogue-snapshot.json', import.meta.url), 'utf8'));
const { topics, files } = buildPages(cat);
const hub = files['kindergarten-worksheets/index.html'];
const tracing = files['kindergarten-worksheets/letter-tracing/index.html'];

test('every topic with sheets gets its own page, and only classes on sale are listed', () => {
  assert.ok(topics.length >= 10);
  for (const t of topics) {
    assert.ok(t.sheets.length, t.id + ' has sheets');
    assert.ok(files['kindergarten-worksheets/' + slugOf(t.id) + '/index.html'], t.id + ' has a page');
    for (const w of t.sheets) assert.equal(w.cls, 'kg', 'only Kindergarten is on sale today');
  }
  assert.equal(Object.keys(files).length, topics.length + 2, 'the topics plus the hub and the sitemap');
});

test('each page carries one title, one description, one canonical and one h1', () => {
  for (const [name, html] of Object.entries(files)) {
    if (!name.endsWith('.html')) continue;
    for (const re of [/<title>[^<]{20,}<\/title>/, /<meta name="description" content="[^"]{70,}">/, /<link rel="canonical" href="https:\/\/learnwithwhy\.com\/[^"]*">/, /<h1>[^<]+<\/h1>/]) {
      assert.match(html, re, name + ' · ' + re);
    }
    assert.equal(html.match(/<h1>/g).length, 1, name + ' has exactly one h1');
    assert.doesNotMatch(html, /noindex/, name + ' is meant to be found');
    assert.doesNotMatch(html, /learnwithwhy\.in/, name + ' uses the .com address');
  }
});

test('titles and descriptions are not repeated between pages', () => {
  const pages = Object.entries(files).filter(([n]) => n.endsWith('.html'));
  for (const field of [/<title>([^<]+)<\/title>/, /<meta name="description" content="([^"]+)">/]) {
    const seen = new Set();
    for (const [name, html] of pages) {
      const v = html.match(field)[1];
      assert.ok(!seen.has(v), name + ' repeats "' + v.slice(0, 40) + '…"');
      seen.add(v);
    }
  }
});

test('the hub links to every topic and the topic pages link back', () => {
  for (const t of topics) assert.ok(hub.includes('href="' + topicPath(t.id) + '"'), 'the hub links to ' + t.id);
  assert.ok(tracing.includes('href="' + HUB + '"'), 'a topic page links back to the hub');
  assert.ok(tracing.includes('href="/"'), 'a topic page links to the home page');
});

test('every sheet of a topic is listed, linking into the site, with a picture that has alt text', () => {
  const t = topics.find(x => x.id === 'letter-tracing');
  for (const w of t.sheets) {
    assert.ok(tracing.includes('href="/?sheet=' + w.id + '"'), w.id + ' is linked');
    assert.ok(tracing.includes('>' + w.title.replace(/&/g, '&amp;') + '<'), w.id + ' shows its own title');
  }
  for (const img of tracing.match(/<img[^>]*>/g)) assert.match(img, /alt="/, 'every picture has alt text: ' + img);
  assert.match(tracing, /alt="Alphabet A — tracing sheet worksheet preview"/);
});

test('prices and free sheets are shown as the database has them, with nothing invented', () => {
  const t = topics.find(x => x.id === 'vocab-colours');
  const page = files['kindergarten-worksheets/colours/index.html'];
  assert.ok(page.includes('>Free · 2 pages<') || page.includes('>Free'), 'free sheets say Free');
  for (const w of t.sheets.filter(x => x.price > 0)) assert.ok(page.includes('₹' + w.price), w.id + ' shows ₹' + w.price);
  for (const re of [/aggregateRating/, /"review"/i, /ratingValue/]) assert.doesNotMatch(page, re, 'no invented ratings or reviews');
});

test('the structured data is valid JSON and describes what the page really is', () => {
  for (const [name, html] of Object.entries(files)) {
    if (!name.endsWith('.html')) continue;
    const blocks = html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s);
    const data = JSON.parse(blocks[1].replace(/\\u003c/g, '<'));
    assert.equal(data[0]['@type'], 'BreadcrumbList');
    assert.ok(data[0].itemListElement.every(x => x.item.startsWith(SITE)), name + ' breadcrumbs use full addresses');
    assert.equal(data[1]['@type'], 'CollectionPage');
    assert.equal(data[1].url, SITE + (name === 'kindergarten-worksheets/index.html' ? HUB : topicPath(topics.find(t => slugOf(t.id) === name.split('/')[1]).id)));
  }
  const list = JSON.parse(tracing.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)[1].replace(/\\u003c/g, '<'))[1].mainEntity;
  assert.equal(list.numberOfItems, topics.find(t => t.id === 'letter-tracing').sheets.length);
});

test('the sitemap holds the home page and every page that was built, and nothing private', () => {
  const xml = files['sitemap.xml'];
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
  assert.deepEqual(locs.slice(0, 2), [SITE + '/', SITE + HUB]);
  assert.equal(locs.length, topics.length + 2);
  assert.equal(new Set(locs).size, locs.length, 'no address twice');
  for (const bad of ['/admin', '/developer', '/viewer', '/account-blocked', '?']) {
    assert.ok(!locs.some(l => l.includes(bad)), 'the sitemap keeps out ' + bad);
  }
  assert.ok(locs.every(l => l.startsWith(SITE + '/') && l.endsWith('/')), 'canonical addresses only');
});

test('a sheet whose class is not on sale yet never reaches a page', () => {
  const t = topicsOf({
    classes: [{ id: 'kg', status: 'available' }, { id: 'c1', status: 'coming_soon' }],
    sections: [{ id: 's1', label: 'Numbers', sort: 1 }],
    worksheets: [
      { id: 'a', title: 'Now', cls: 'kg', section: 's1', price: 0 },
      { id: 'b', title: 'Later', cls: 'c1', section: 's1', price: 19 },
      { id: 'c', title: 'Hidden', cls: 'kg', section: 's1', price: 19, available: false },
    ],
  });
  assert.deepEqual(t.flatMap(x => x.sheets).map(x => x.id), ['a']);
  assert.ok(!sitemapOf(t).includes('Later'));
});

/* index.html draws the opening veil itself, so the first screen does not wait for JavaScript.
   React renders the same veil the moment it mounts; if one of the two changes, this fails. */
test('the veil in index.html matches the one React renders', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const jsx = await readFile(new URL('../src/components/layout/Veil.jsx', import.meta.url), 'utf8');
  const logo = await readFile(new URL('../src/components/common/LogoTile.jsx', import.meta.url), 'utf8');
  for (const part of ['id="veil"', 'class="veil-inner"', 'class="logo-tile"', 'class="veil-word"', 'class="veil-line"', 'id="veilNote"']) {
    assert.ok(html.includes(part), 'index.html draws ' + part);
  }
  assert.ok(html.includes('Opening the forest') && jsx.includes('Opening the forest'), 'both say the same thing');
  assert.ok(html.includes('<b>LEARN</b><small>WITH WHY</small>') && logo.includes('<b>LEARN</b><small>WITH WHY</small>'));
  const leaves = JSON.parse(logo.match(/const LEAVES = (\[\[[^;]+\]\]);/)[1]);
  for (const [x, y] of leaves) assert.ok(html.includes(`cx="${x}" cy="${y}"`), `the static logo has the leaf at ${x},${y}`);
  assert.equal((html.match(/<ellipse /g) || []).length, leaves.length, 'the same number of leaves');
});

test('the home page ships no staff stylesheet and no address from the old domain', async () => {
  const main = await readFile(new URL('../src/main.jsx', import.meta.url), 'utf8');
  assert.doesNotMatch(main, /admin\.css['"]/, 'admin.css belongs to the staff pages, not every visitor');
  const portal = await readFile(new URL('../src/pages/Portal/Portal.jsx', import.meta.url), 'utf8');
  assert.match(portal, /styles\/admin\.css/, 'the staff pages load it themselves');
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.doesNotMatch(html, /learnwithwhy\.in/);
  assert.match(html, /<link rel="canonical" href="https:\/\/learnwithwhy\.com\/">/);
});
