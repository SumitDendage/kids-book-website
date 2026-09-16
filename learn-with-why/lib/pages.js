/* The pages of a sheet, drawn in the browser. The demo has no PDF masters —
   online, the protected viewer streams pages from private storage instead. */
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
const CVC = ['cat', 'hat', 'bat', 'dog', 'log', 'fog', 'pen', 'hen', 'ten', 'pig', 'wig', 'dig'];
const WORDS = ['lantern', 'moss', 'hollow', 'drift', 'thicket', 'glimmer', 'burrow', 'rustle', 'amber', 'brook', 'tangle', 'hush'];
const HINDI = 'अ आ इ ई उ ऊ ए ऐ ओ औ क ख ग घ च छ ज झ ट ठ'.split(' ');
const MATRA = ['का', 'कि', 'की', 'कु', 'कू', 'के', 'कै', 'को', 'कौ', 'कं', 'कः', 'कृ', 'खा', 'खी', 'गु', 'गे', 'घो', 'चौ'];

export function pagesFor(sheet) {
  const n = sheet.pages;
  const page = (i, heading, glyph, task) => ({ n: i + 1, heading, glyph, task });
  const generic = () => Array.from({ length: n }, (_, i) => page(i, 'Page ' + (i + 1), sheet.glyph, sheet.blurb));
  switch (sheet.id) {
    case 'nur-eng-abc':
      return LETTERS.slice(0, n).map((L, i) => page(i, 'Letter ' + L, L + L.toLowerCase(), 'Trace the dotted letters, then write your own on the lines below.'));
    case 'nur-mat-num':
    case 'kg-mat-cnt':
      return Array.from({ length: n }, (_, i) => page(i, 'Number ' + (i + 1), String(i + 1), 'Count out loud, trace the number, then draw that many acorns.'));
    case 'kg-eng-cvc':
      return CVC.slice(0, n).map((w, i) => page(i, w.toUpperCase(), w.split('').join('·'), 'Say each sound, blend the word, draw the picture, write it once more.'));
    case 'c1-mat-add':
      return Array.from({ length: n }, (_, i) => { const a = (i % 9) + 1, b = ((i * 3) % 9) + 1; return page(i, 'Sum ' + (i + 1), a + ' + ' + b, 'Draw the two groups, count them together, write the answer in the box.'); });
    case 'c1-mat-sub':
      return Array.from({ length: n }, (_, i) => { const a = 10 + (i % 10), b = (i % 7) + 1; return page(i, 'Story ' + (i + 1), a + ' − ' + b, 'Read the story, cross out what is taken away, count what is left.'); });
    case 'c2-mat-mul':
      return Array.from({ length: n }, (_, i) => { const t = 2 + (i % 9); return page(i, t + ' times table', t + ' ×', 'Draw the array, skip-count along the line, fill the table from ' + t + ' × 1 to ' + t + ' × 10.'); });
    case 'c3-mat-fra':
      return ['½', '¼', '¾', '⅓', '⅔', '⅛'].concat(Array(12).fill('½')).slice(0, n).map((f, i) => page(i, 'Fraction ' + (i + 1), f, 'Colour the slices, write the fraction, decide who got more.'));
    case 'c1-hin-var':
      return HINDI.slice(0, n).map((h, i) => page(i, 'अक्षर ' + (i + 1), h, 'Trace the dotted letter, say its sound, write it three times.'));
    case 'c2-hin-mat':
      return MATRA.slice(0, n).map((h, i) => page(i, 'मात्रा ' + (i + 1), h, 'Read the word, trace the matra, find two more words that use it.'));
    case 'c3-eng-adv':
      return WORDS.slice(0, n).map((w, i) => page(i, 'Word ' + (i + 1), w, 'Say it, sort it, rhyme it, then use it in a sentence about the forest.'));
    default:
      return generic();
  }
}
