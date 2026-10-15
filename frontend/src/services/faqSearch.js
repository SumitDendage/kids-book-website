/* Finds the best answer in the FAQ list (data/faq.json) for what a visitor typed.
   Each entry has a question (q), its answer (a), other ways to ask it (alt) and keywords (kw).
   Words are compared after dropping small words like "the" and "is", and a question that
   names one letter ("colour the letter C") only matches answers about that letter. */
const STOP = new Set(('a an the is are am was be been do does did i me my we our you your it its this that these those to of in on at for with and or ' +
  'can could should would will how what which who whom why when where there here please tell about any some get have has had so if than then just ' +
  'also from by as into out up want need know us they them he she him her his hers'
).split(' '));
/* words nearly every answer shares: they count, but only a little */
const LIGHT = new Set(['sheet', 'activity', 'resource', 'page']);
const weight = w => LIGHT.has(w) ? 0.25 : 1;

/* "colours" → "colour", "tracing" → "trac", so near forms meet */
function stem(w) {
  if (w.length > 5 && w.endsWith('ing')) return w.slice(0, -3);
  if (w.length > 4 && w.endsWith('ies')) return w.slice(0, -3) + 'y';
  if (w.length > 3 && w.endsWith('es') && !w.endsWith('ses')) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
  return w;
}
const SAME = { color: 'colour', colors: 'colour', math: 'maths', mathematic: 'maths', login: 'sign', signin: 'sign', signup: 'sign', kg: 'kindergarten', pdfs: 'pdf', price: 'cost', prices: 'cost', worksheet: 'sheet', activiti: 'activity', resourc: 'resource' };
export function words(text) {
  return String(text || '').toLowerCase().replace(/[’']/g, '').split(/[^a-z0-9₹]+/)
    .filter(w => w.length > 1 && !STOP.has(w)).map(w => SAME[w] || stem(w)).map(w => SAME[w] || w);
}

/* the one letter a question is about: "letter c", "alphabet C", "c tracing", or a lone capital */
export function letterOf(text) {
  const s = String(text || '');
  const m = /\b(?:letter|alphabet|sound)\s+([a-z])\b/i.exec(s) || /\b([a-z])\s+(?:tracing|for)\b/i.exec(s) || /(?:^|\s)([B-HJ-Z])(?=[\s?.!,]|$)/.exec(s);
  return m ? m[1].toLowerCase() : null;
}

function prepare(entry) {
  if (entry._q) return entry;
  const qs = [entry.q, ...(entry.alt || [])];
  entry._q = qs.map(q => new Set(words(q)));
  entry._kw = new Set((entry.kw || []).flatMap(words));
  entry._a = new Set(words(entry.a));
  entry._letter = letterOf(entry.q);
  return entry;
}

/* how well one entry fits: the best of its questions, plus keywords and the answer's own words */
function score(entry, ws, letter) {
  const e = prepare(entry);
  if (letter && e._letter && e._letter !== letter) return 0;
  if (!ws.length) return 0;
  const total = ws.reduce((n, w) => n + weight(w), 0);
  let best = 0;
  for (const q of e._q) {
    if (!q.size) continue;
    let hit = 0, size = 0;
    for (const w of ws) if (q.has(w)) hit += weight(w);
    for (const w of q) size += weight(w);
    /* share of the visitor's words found, and of the question's words covered */
    const s = (hit / total) * 0.6 + (hit / size) * 0.4;
    if (s > best) best = s;
  }
  let kw = 0, ans = 0;
  for (const w of ws) { if (e._kw.has(w)) kw += weight(w); if (e._a.has(w)) ans += weight(w); }
  let s = best + Math.min(kw, 3) * 0.08 + (ans / total) * 0.1;
  if (letter && e._letter === letter) s += 0.25;
  return s;
}

/* → { answer, question, score, suggestions } with answer null when nothing fits well enough */
export function findAnswer(entries, text, { min = 0.6 } = {}) {
  const ws = [...new Set(words(text))];
  const letter = letterOf(text);
  const ranked = entries.map(e => ({ e, s: score(e, ws, letter) })).filter(r => r.s > 0).sort((x, y) => y.s - x.s);
  const top = ranked[0];
  const suggestions = ranked.slice(0, 3).map(r => r.e.q);
  if (!top || top.s < min) return { answer: null, question: null, score: top ? top.s : 0, suggestions };
  return { answer: top.e.a, question: top.e.q, score: top.s, suggestions };
}
