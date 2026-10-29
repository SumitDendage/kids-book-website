/* Search pages, built after `vite build` (npm run build).
   The shop itself lives inside the one-page forest site, so Google could only ever list the home page.
   This writes plain, fast HTML pages that Google can read without running the site:
     dist/kindergarten-worksheets/index.html          all topics
     dist/kindergarten-worksheets/<topic>/index.html  every sheet in one topic, each linking to /?sheet=<id>
     dist/sitemap.xml                                 the home page and these pages
   The sheets come from the live catalogue (GET /api/worksheets, the same public call the site makes),
   so new sheets added in Admin → Products appear on the next website build. If the live call fails,
   the copy in scripts/seo-catalogue-snapshot.json is used and the build carries on.
   Only real data is shown: titles, descriptions and prices as staff set them. No ratings or reviews. */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = resolve(ROOT, 'dist');
export const SITE = 'https://learnwithwhy.com';
export const HUB = '/kindergarten-worksheets/';
const BRAND = 'Learn With Why';
const INBOX = 'learnwithwhy6@gmail.com';
const INSTAGRAM = 'https://www.instagram.com/learnwithwhy_01';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
/* JSON inside <script>: "</script>" and friends can't close the tag */
const ldJson = o => JSON.stringify(o).replace(/</g, '\\u003c');
/* /kindergarten-worksheets/colours/ rather than …/vocab-colours/ */
export const slugOf = id => String(id).replace(/^vocab-/, '').replace(/[^a-z0-9-]+/gi, '-').toLowerCase();
export const topicPath = id => HUB + slugOf(id) + '/';
const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);
const priceText = p => (p === 0 ? 'Free' : '₹' + p);

function readEnv() {
  const env = { ...process.env };
  for (const f of ['.env.production', '.env']) {
    const p = resolve(ROOT, f);
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && env[m[1]] === undefined) env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
    }
  }
  return env;
}

async function liveCatalogue() {
  const env = readEnv();
  const base = (env.VITE_SUPABASE_URL || '').replace(/\/+$/, '');
  if (!base || env.SEO_OFFLINE) return null;
  try {
    const r = await fetch(base + '/functions/v1/api/worksheets', {
      headers: { apikey: env.VITE_SUPABASE_PUBLISHABLE_KEY || '' },
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    if (!Array.isArray(j.worksheets) || !j.worksheets.length) throw new Error('no worksheets in the answer');
    return j;
  } catch (err) {
    console.warn('seo pages: live catalogue not reached (' + err.message + '), using the saved copy');
    return null;
  }
}

/* the topics that have sheets on sale, in the shop's order, each with its sheets */
export function topicsOf(cat) {
  const open = new Set((cat.classes || []).filter(c => c.status === 'available' || c.available).map(c => c.id));
  const sheets = (cat.worksheets || []).filter(w => w && w.id && w.title && w.section
    && (!open.size || open.has(w.cls)) && w.available !== false && w.comingSoon !== true);
  const known = new Map((cat.sections || []).map(s => [s.id, s]));
  const topics = new Map();
  for (const w of sheets) {
    if (!topics.has(w.section)) {
      const s = known.get(w.section) || { id: w.section, label: w.sectionLabel || w.section, groupLabel: '', sort: 9999 };
      topics.set(w.section, { ...s, label: s.label || w.sectionLabel, sheets: [] });
    }
    topics.get(w.section).sheets.push(w);
  }
  return [...topics.values()].sort((a, b) => (a.sort ?? 9999) - (b.sort ?? 9999) || a.label.localeCompare(b.label));
}

const STYLE = `
:root{color-scheme:dark;--bg:#06101a;--card:rgba(255,255,255,.06);--line:rgba(255,255,255,.14);--ink:#f7f3ea;--soft:#c9d3d8;--gold:#ffd88a;--green:#8fe3b0}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:radial-gradient(1200px 600px at 20% -10%,#14324a 0,transparent 60%),linear-gradient(#0b1a26,#05090d) fixed;background-color:var(--bg);color:var(--ink);font:16px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,"Noto Sans",sans-serif}
a{color:var(--gold)}
a:focus-visible{outline:2px solid var(--gold);outline-offset:3px;border-radius:4px}
.wrap{max-width:1120px;margin:0 auto;padding:0 16px}
header.top{border-bottom:1px solid var(--line);background:rgba(6,16,26,.85);position:sticky;top:0;z-index:2}
header.top .wrap{display:flex;align-items:center;gap:16px;min-height:60px;flex-wrap:wrap}
.brand{display:flex;align-items:center;gap:10px;color:var(--ink);text-decoration:none;font-family:Cormorant,Georgia,serif;font-size:1.45rem;font-weight:500}
.brand img{border-radius:10px;background:#f7f3ea;padding:3px}
header.top nav{margin-left:auto;display:flex;gap:18px;flex-wrap:wrap}
header.top nav a{color:var(--soft);text-decoration:none;font-size:.95rem}
header.top nav a:hover,header.top nav a[aria-current]{color:var(--ink)}
.crumbs{font-size:.88rem;color:var(--soft);margin:22px 0 0;padding:0;list-style:none;display:flex;flex-wrap:wrap;gap:6px}
.crumbs li+li::before{content:"›";margin-right:6px;color:var(--line)}
.crumbs a{color:var(--soft)}
h1,h2{font-family:Cormorant,Georgia,serif;font-weight:500;line-height:1.15;margin:.4em 0}
h1{font-size:clamp(2rem,5vw,3.1rem)}
h2{font-size:clamp(1.5rem,3.4vw,2rem);margin-top:1.6em}
.lede{max-width:760px;color:var(--soft);font-size:1.08rem}
.facts{display:flex;flex-wrap:wrap;gap:10px;padding:0;list-style:none;margin:18px 0}
.facts li{border:1px solid var(--line);border-radius:999px;padding:4px 14px;font-size:.9rem;background:var(--card)}
.cta{display:inline-block;background:var(--gold);color:#1b1407;font-weight:700;text-decoration:none;border-radius:999px;padding:10px 22px;margin:6px 0 10px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:14px;padding:0;list-style:none}
.card{background:var(--card);border:1px solid var(--line);border-radius:18px;overflow:hidden;display:flex;flex-direction:column}
.card img{display:block;width:100%;height:auto;aspect-ratio:520/735;object-fit:cover;background:#fff}
.card .body{padding:12px 14px 16px;display:flex;flex-direction:column;gap:6px;flex:1}
.card h3{font-size:.98rem;margin:0;line-height:1.3}
.card h3 a{color:var(--ink);text-decoration:none}
.card h3 a:hover{text-decoration:underline}
.card p{margin:0;color:var(--soft);font-size:.92rem}
.price{margin-top:auto;font-weight:700}
.price.free{color:var(--green)}
.topics{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:16px;padding:0;list-style:none}
.topic{display:flex;gap:14px;align-items:center;background:var(--card);border:1px solid var(--line);border-radius:16px;padding:12px;text-decoration:none;color:var(--ink)}
.topic:hover{border-color:var(--gold)}
.topic img{width:64px;height:auto;aspect-ratio:520/735;border-radius:8px;background:#fff;flex:none}
.topic b{display:block;font-size:1.02rem}
.topic span{color:var(--soft);font-size:.88rem}
.how{max-width:760px;color:var(--soft)}
.how li{margin:.35em 0}
footer.foot{border-top:1px solid var(--line);margin-top:56px;padding:24px 0 40px;color:var(--soft);font-size:.92rem}
footer.foot nav{display:flex;flex-wrap:wrap;gap:8px 18px;margin-bottom:10px}
`;

function page({ path, title, description, h1, crumbs, body, image, ld }) {
  const url = SITE + path;
  const crumbLd = { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: crumbs.map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: c.name, item: SITE + c.path })) };
  return `<!DOCTYPE html>
<html lang="en-IN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta name="robots" content="index, follow, max-image-preview:large">
<meta name="theme-color" content="#06101a">
<link rel="canonical" href="${esc(url)}">
<link rel="icon" href="/favicon.ico" sizes="48x48">
<link rel="icon" type="image/png" sizes="96x96" href="/favicon-96.png">
<link rel="icon" type="image/png" sizes="192x192" href="/favicon-192.png">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${BRAND}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(url)}">
<meta property="og:image" content="${esc(SITE + (image || '/og.jpg'))}">
<meta property="og:locale" content="en_IN">
<meta name="twitter:card" content="summary_large_image">
<link rel="preload" as="font" type="font/woff2" href="/fonts/cormorant-garamond-latin-500-normal.woff2" crossorigin>
<style>@font-face{font-family:Cormorant;font-style:normal;font-weight:500;font-display:swap;src:url(/fonts/cormorant-garamond-latin-500-normal.woff2) format('woff2')}${STYLE.replace(/\n/g, '')}</style>
<script type="application/ld+json">${ldJson([crumbLd, ...(ld || [])])}</script>
</head>
<body>
<a href="#main" style="position:absolute;left:-999px;top:8px;background:#ffd88a;color:#1b1407;padding:6px 12px;border-radius:8px" onfocus="this.style.left='8px'" onblur="this.style.left='-999px'">Skip to the worksheets</a>
<header class="top"><div class="wrap">
<a class="brand" href="/"><img src="/logo.png" alt="" width="36" height="36">${BRAND}</a>
<nav aria-label="Main"><a href="/">Home</a><a href="${HUB}"${path === HUB ? ' aria-current="page"' : ''}>Kindergarten worksheets</a><a href="/#contact">Contact us</a></nav>
</div></header>
<main id="main" class="wrap">
<ol class="crumbs" aria-label="Breadcrumb">${crumbs.map((c, i) => `<li>${i === crumbs.length - 1 ? `<span aria-current="page">${esc(c.name)}</span>` : `<a href="${esc(c.path)}">${esc(c.name)}</a>`}</li>`).join('')}</ol>
<h1>${esc(h1)}</h1>
${body}
</main>
<footer class="foot"><div class="wrap">
<nav aria-label="Footer"><a href="/">Home</a><a href="/#about">About us</a><a href="${HUB}">All Kindergarten worksheets</a><a href="/#contact">Contact us</a><a href="${INSTAGRAM}" rel="noopener">Instagram</a></nav>
<div>© ${new Date().getFullYear()} ${BRAND} · <a href="mailto:${INBOX}">${INBOX}</a></div>
</div></footer>
</body>
</html>
`;
}

function sheetCard(w, i) {
  const href = '/?sheet=' + encodeURIComponent(w.id);
  const img = w.thumb ? `<img src="${esc(w.thumb)}" alt="${esc(w.title + ' worksheet preview')}" width="520" height="735"${i > 3 ? ' loading="lazy"' : ''} decoding="async">` : '';
  return `<li class="card">${img}<div class="body"><h3><a href="${esc(href)}">${esc(w.title)}</a></h3>${w.description ? `<p>${esc(w.description)}</p>` : ''}<span class="price${w.price === 0 ? ' free' : ''}">${priceText(w.price)}${w.pages ? ' · ' + plural(w.pages, 'page', 'pages') : ''}</span></div></li>`;
}

function topicLink(t) {
  const free = t.sheets.filter(w => w.price === 0).length;
  const thumb = t.sheets.find(w => w.thumb);
  return `<li><a class="topic" href="${esc(topicPath(t.id))}">${thumb ? `<img src="${esc(thumb.thumb)}" alt="" width="64" height="90" loading="lazy" decoding="async">` : ''}<div><b>${esc(t.label)} worksheets</b><span>${plural(t.sheets.length, 'sheet', 'sheets')}${free ? ' · ' + free + ' free' : ''}</span></div></a></li>`;
}

const HOW = `<h2>How the printable sheets work</h2>
<ol class="how">
<li>Open any sheet to see a preview of the page.</li>
<li>Free sheets open straight away. For paid sheets, make a free account and buy the sheet, or take a subscription for the whole class.</li>
<li>Print the sheet at home or in class. How many prints you get depends on your account type (parent, teacher or organisation).</li>
</ol>`;

function hubPage(topics) {
  const all = topics.flatMap(t => t.sheets), free = all.filter(w => w.price === 0).length;
  const paid = all.filter(w => w.price > 0).map(w => w.price), from = paid.length ? Math.min(...paid) : 0;
  const groups = new Map();
  for (const t of topics) { const g = t.groupLabel || 'More'; if (!groups.has(g)) groups.set(g, []); groups.get(g).push(t); }
  const names = topics.map(t => t.label.toLowerCase());
  const description = `${all.length} printable Kindergarten worksheets in ${topics.length} topics: ${names.slice(0, 6).join(', ')} and more. ${free} free sheets to try${from ? ', others from ₹' + from : ''}.`;
  const body = `<p class="lede">Printable worksheets for Kindergarten children, made by ${BRAND}. Pick a topic below to see every sheet in it with a preview of the page. Each topic has free sheets you can open without paying.</p>
<ul class="facts"><li>${plural(all.length, 'worksheet', 'worksheets')}</li><li>${plural(topics.length, 'topic', 'topics')}</li><li>${free} free to try</li>${from ? `<li>Others from ₹${from}</li>` : ''}</ul>
<a class="cta" href="/#sheets">Open the worksheet shop</a>
${[...groups].map(([g, ts]) => `<h2>${esc(g)} worksheets</h2><ul class="topics">${ts.map(topicLink).join('')}</ul>`).join('\n')}
${HOW}`;
  return page({
    path: HUB,
    title: `Printable Kindergarten Worksheets (${all.length} sheets, ${free} free) | ${BRAND}`,
    description,
    h1: 'Printable Kindergarten Worksheets',
    crumbs: [{ name: 'Home', path: '/' }, { name: 'Kindergarten worksheets', path: HUB }],
    body,
    ld: [{ '@context': 'https://schema.org', '@type': 'CollectionPage', name: 'Printable Kindergarten Worksheets', url: SITE + HUB, description, inLanguage: 'en-IN', isPartOf: { '@type': 'WebSite', name: BRAND, url: SITE + '/' } }],
  });
}

function topicPage(t, topics) {
  const free = t.sheets.filter(w => w.price === 0).length;
  const paid = t.sheets.filter(w => w.price > 0).map(w => w.price), from = paid.length ? Math.min(...paid) : 0;
  const name = `${t.label} Worksheets for Kindergarten`;
  const intro = t.description ? t.description.replace(/\.?\s*$/, '.') : `Printable ${t.label.toLowerCase()} worksheets for Kindergarten children.`;
  const description = `${intro} ${plural(t.sheets.length, 'printable sheet', 'printable sheets')}${free ? ', ' + free + ' free to try' : ''}${from ? ', others ₹' + from : ''}. Preview every page before you print.`;
  const others = topics.filter(x => x.id !== t.id);
  const same = others.filter(x => x.group === t.group), rest = others.filter(x => x.group !== t.group);
  const body = `<p class="lede">${esc(intro)} Here are all ${plural(t.sheets.length, 'sheet', 'sheets')} in this topic, each with a preview of the page${free ? '. The ones marked Free open without paying' : ''}.</p>
<ul class="facts"><li>${plural(t.sheets.length, 'sheet', 'sheets')}</li>${free ? `<li>${free} free</li>` : ''}${from ? `<li>Others ₹${from}</li>` : ''}<li>Kindergarten · ${esc(t.groupLabel || 'English')}</li></ul>
<h2>All ${esc(t.label)} sheets</h2>
<ul class="grid">${t.sheets.map(sheetCard).join('')}</ul>
${HOW}
${same.length ? `<h2>More ${esc((t.groupLabel || '').toLowerCase())} worksheets</h2><ul class="topics">${same.map(topicLink).join('')}</ul>` : ''}
${rest.length ? `<h2>Other Kindergarten topics</h2><ul class="topics">${rest.map(topicLink).join('')}</ul>` : ''}`;
  const path = topicPath(t.id);
  return page({
    path,
    title: `${name} (Printable${free ? ', ' + free + ' Free' : ''}) | ${BRAND}`,
    description,
    h1: name,
    crumbs: [{ name: 'Home', path: '/' }, { name: 'Kindergarten worksheets', path: HUB }, { name: t.label, path }],
    body,
    image: t.sheets[0] && t.sheets[0].thumb,
    ld: [{
      '@context': 'https://schema.org', '@type': 'CollectionPage', name, url: SITE + path, description, inLanguage: 'en-IN',
      isPartOf: { '@type': 'WebSite', name: BRAND, url: SITE + '/' },
      mainEntity: { '@type': 'ItemList', numberOfItems: t.sheets.length, itemListElement: t.sheets.map((w, i) => ({ '@type': 'ListItem', position: i + 1, name: w.title, url: SITE + '/?sheet=' + encodeURIComponent(w.id) })) },
    }],
  });
}

export function sitemapOf(topics) {
  const urls = [{ loc: SITE + '/', image: SITE + '/og.jpg' }, { loc: SITE + HUB }, ...topics.map(t => ({ loc: SITE + topicPath(t.id) }))];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
${urls.map(u => `  <url><loc>${esc(u.loc)}</loc>${u.image ? `<image:image><image:loc>${esc(u.image)}</image:loc></image:image>` : ''}</url>`).join('\n')}
</urlset>
`;
}

export function buildPages(cat) {
  const topics = topicsOf(cat);
  const files = { 'sitemap.xml': sitemapOf(topics), 'kindergarten-worksheets/index.html': hubPage(topics) };
  for (const t of topics) files['kindergarten-worksheets/' + slugOf(t.id) + '/index.html'] = topicPage(t, topics);
  return { topics, files };
}

/* The home page carries its own opening-veil styles (index.html), so the full stylesheet no
   longer has to arrive before the browser can draw anything. Vite writes the <link> itself, so
   it is turned into a non-blocking load here, after the build. The veil stays up until the
   stylesheet has landed (--css-ready, see layouts/SiteLayout.jsx), so nothing is ever shown
   unstyled, and <noscript> keeps the plain blocking link for a browser without JavaScript. */
export function deferStylesheet(html) {
  return html.replace(/<link rel="stylesheet"([^>]*?)href="([^"]+)"([^>]*)>/g, (all, a, href, b) =>
    `<link rel="preload" as="style"${a}href="${href}"${b} onload="this.onload=null;this.rel='stylesheet'">`
    + `<noscript>${all}</noscript>`);
}

/* The two font files are a kilobyte each but cost the browser a round trip apiece before it may
   draw: their @font-face rules go straight into the page instead. The fonts themselves are
   fetched exactly as before (font-display: swap), only sooner. */
export function inlineFontCss(html, read) {
  return html.replace(/<link href="\/fonts\/([a-z]+\.css)" rel="stylesheet">/g, (all, name) => {
    const css = read(name);
    return css ? '<style>/* /fonts/' + name + ' */' + css.replace(/url\(('?)(?!\/|https?:)/g, "url($1/fonts/").trim() + '</style>' : all;
  });
}

async function main() {
  const live = await liveCatalogue();
  const cat = live || JSON.parse(readFileSync(resolve(ROOT, 'scripts/seo-catalogue-snapshot.json'), 'utf8'));
  const { topics, files } = buildPages(cat);
  if (!topics.length) throw new Error('seo pages: no topics with sheets');
  for (const [rel, text] of Object.entries(files)) {
    const out = resolve(DIST, rel);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, text);
  }
  const home = resolve(DIST, 'index.html');
  const before = readFileSync(home, 'utf8');
  const after = inlineFontCss(deferStylesheet(before), name => readFileSync(resolve(DIST, 'fonts', name), 'utf8'));
  if (!after.includes('rel="preload" as="style"')) throw new Error('seo pages: no stylesheet link found in dist/index.html');
  if (after.includes('rel="stylesheet">') && !after.includes('<noscript><link rel="stylesheet"')) throw new Error('seo pages: a stylesheet still blocks the first paint');
  writeFileSync(home, after);
  console.log(`seo pages: ${topics.length} topics, ${topics.reduce((n, t) => n + t.sheets.length, 0)} sheets, ${Object.keys(files).length} files (${live ? 'live catalogue' : 'saved copy'})`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
