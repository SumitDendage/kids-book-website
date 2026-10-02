/* Copyright (c) 2026 Learn With Why. All rights reserved. Proprietary — see LICENSE. This notice may not be removed. */
/* CATALOGUE SEED — the worksheets the database starts with. Ids, titles, classes,
   subjects, pages and default prices match the React shelf (react-app/src/data/catalogue.js);
   price is in INR and 0 means a free access sheet. `file` is the PDF's path inside
   site/protected/ (never inside the web root); `thumb` is the public preview image.

   Classes are kg, c1, c2, c3 (Nursery was folded into Kindergarten). Subjects are
   English, Maths and Science only.

   The 79 printable PDFs follow the shelf's own free/paid rules: the first three of
   each set are free samples (A–C tracing and colouring, A/I/N picture reading, the
   first three matching and spot ranges), the three beginning- and ending-sound
   exercises are free, and every other PDF costs SHEET_PRICE. The admin can change
   any price later; db.cjs never overwrites a field the admin has edited.

   SEED_VERSION goes up whenever this file changes in a way existing databases must
   pick up once (sheets removed, classes renamed); see db.cjs → syncSeed(). */
const SEED_VERSION = 2;
const SHEET_PRICE = 19;
const C = (id, title, cls, subject, pages, price) => ({ id, title, cls, subject, pages, price });
const SEED_WORKSHEETS = [
  /* the shelf (CATALOGUE) */
  C('nur-eng-abc', 'Alphabet tracing A–Z', 'kg', 'English', 26, 0),
  C('nur-mat-num', 'Numbers 1–10 with dots', 'kg', 'Maths', 10, 49),
  C('kg-eng-cvc', 'CVC words: cat, hat, bat', 'kg', 'English', 12, 0),
  C('kg-mat-cnt', 'Count to 20', 'kg', 'Maths', 14, 59),
  C('kg-evs-ani', 'Animals and their homes', 'kg', 'Science', 10, 49),
  C('kg-eng-rhy', 'Rhyme time', 'kg', 'English', 8, 39),
  C('c1-eng-sen', 'Build a sentence', 'c1', 'English', 16, 79),
  C('c1-mat-add', 'Addition to 20', 'c1', 'Maths', 20, 0),
  C('c1-mat-sub', 'Subtraction stories', 'c1', 'Maths', 16, 79),
  C('c1-evs-pla', 'Plants around us', 'c1', 'Science', 12, 59),
  C('c2-eng-det', 'Story Detective', 'c2', 'English', 12, 0),
  C('c2-mat-mul', 'Multiplication tables 2–10', 'c2', 'Maths', 24, 99),
  C('c2-sci-why', 'Why does it float?', 'c2', 'Science', 14, 89),
  C('c2-eng-end', 'Imagine a Different Ending', 'c2', 'English', 10, 79),
  C('c3-eng-adv', "Fox and Rabbit's Word Adventure", 'c3', 'English', 12, 0),
  C('c3-mat-fra', 'Fractions with pizza', 'c3', 'Maths', 18, 99),
  C('c3-sci-wal', 'A Forest Walk Full of Why', 'c3', 'Science', 8, 59),
  C('c3-mat-tim', 'Telling the time', 'c3', 'Maths', 14, 89),
  /* the four sheets in the player (SHEETS) */
  C('counting', 'A little counting magic', 'kg', 'Maths', 10, 0),
  C('alphabet', 'Alphabet explorers', 'kg', 'English', 26, 99),
  C('shapes', 'Shape spotters', 'kg', 'Maths', 8, 79),
  C('colours', 'Colour the forest', 'kg', 'English', 6, 59),
  /* week-by-week worksheets (WORKSHEETS) */
  C('ws-add', 'Woodland addition', 'c1', 'Maths', 20, 0),
  C('ws-story', 'My first story', 'c2', 'English', 12, 89),
  C('ws-nature', 'Backyard discoveries', 'kg', 'Science', 8, 69),
  C('ws-phon', 'Phonics forest', 'kg', 'English', 16, 99),
  C('ws-sub', 'Subtraction stories', 'c1', 'Maths', 16, 79),
  C('ws-time', 'Telling the time', 'c3', 'Maths', 14, 89),
];

/* the printable PDFs (PDF_SHEETS): one A4 page each, Kindergarten English, a real file in protected/ */
const pdf = (id, title, folder, name, free) => ({ id, title, cls: 'kg', subject: 'English', pages: 1, price: free ? 0 : SHEET_PRICE, file: folder + '/' + name + '.pdf', thumb: 'sheets/' + folder + '/thumb/' + name + '.jpg' });
const AZ = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split(''), FIRST3 = ['A', 'B', 'C'];
const RANGES = ['AE', 'FJ', 'KO', 'PT', 'UZ'];
const BX = { 1: 'write the missing sound', 2: 'circle the sound', 3: 'same beginning sound' };
const EX = { 1: 'choose the ending sound', 2: 'write the ending sound', 3: 'same ending sound' };
const PDF_SHEETS = [].concat(
  AZ.map(L => pdf('az-' + L, 'Alphabet ' + L + ' — tracing sheet', 'a-to-z', L, FIRST3.includes(L))),
  'AINPST'.split('').map(L => pdf('rc-' + L, 'Letter ' + L + ' — picture reading chart', 'reading', L, ['A', 'I', 'N'].includes(L))),
  AZ.map(L => pdf('cl-' + L, 'Colour the letter ' + L, 'colour', L, FIRST3.includes(L))),
  RANGES.map((r, i) => pdf('mt-' + r, 'Match the letters ' + r[0] + '–' + r[1], 'matching', r, i < 3)),
  RANGES.map((r, i) => pdf('sp-' + r, 'Spot the letters ' + r[0] + '–' + r[1], 'spot', r, i < 3)),
  [1, 2, 3].map(n => pdf('bx-' + n, 'Beginning Sound ' + n + ' — ' + BX[n], 'sound-exercise', 'beginning-sound-' + n, true)),
  'ABCDE'.split('').map(L => pdf('sd-' + L, 'Letter ' + L + ' — beginning and ending sounds', 'sound', L, false)),
  [1, 2, 3].map(n => pdf('ex-' + n, 'Ending Sound ' + n + ' — ' + EX[n], 'sound-exercise', 'ending-sound-' + n, true)),
);
SEED_WORKSHEETS.push(...PDF_SHEETS);

/* sheets the shelf no longer shows (Hindi and Art & craft): made inactive once in existing databases */
const REMOVED_IDS = ['nur-art-col', 'c1-hin-var', 'c2-hin-mat', 'c3-art-pat'];

/* The catalogue as the FIRST version of this file seeded it. A database made before
   seed tracking existed has no record of what the seed wrote, so a field is treated
   as untouched by the admin only when it still holds exactly this value. */
const V1 = (title, cls, subject, pages, price) => ({ title, cls, subject, pages, price });
const SEED_V1 = {
  'nur-eng-abc': V1('Alphabet tracing A–Z', 'nursery', 'English', 26, 0), 'nur-mat-num': V1('Numbers 1–10 with dots', 'nursery', 'Maths', 10, 49),
  'nur-art-col': V1('Colour the forest', 'nursery', 'Art & craft', 8, 39), 'kg-eng-cvc': V1('CVC words: cat, hat, bat', 'kg', 'English', 12, 0),
  'kg-mat-cnt': V1('Count to 20', 'kg', 'Maths', 14, 59), 'kg-evs-ani': V1('Animals and their homes', 'kg', 'EVS', 10, 49),
  'kg-eng-rhy': V1('Rhyme time', 'kg', 'English', 8, 39), 'c1-eng-sen': V1('Build a sentence', 'c1', 'English', 16, 79),
  'c1-mat-add': V1('Addition to 20', 'c1', 'Maths', 20, 0), 'c1-mat-sub': V1('Subtraction stories', 'c1', 'Maths', 16, 79),
  'c1-evs-pla': V1('Plants around us', 'c1', 'EVS', 12, 59), 'c1-hin-var': V1('Hindi varnamala tracing', 'c1', 'Hindi', 20, 69),
  'c2-eng-det': V1('Story Detective', 'c2', 'English', 12, 0), 'c2-mat-mul': V1('Multiplication tables 2–10', 'c2', 'Maths', 24, 99),
  'c2-sci-why': V1('Why does it float?', 'c2', 'Science', 14, 89), 'c2-hin-mat': V1('Hindi matras', 'c2', 'Hindi', 18, 69),
  'c2-eng-end': V1('Imagine a Different Ending', 'c2', 'English', 10, 79), 'c3-eng-adv': V1("Fox and Rabbit's Word Adventure", 'c3', 'English', 12, 0),
  'c3-mat-fra': V1('Fractions with pizza', 'c3', 'Maths', 18, 99), 'c3-sci-wal': V1('A Forest Walk Full of Why', 'c3', 'Science', 8, 59),
  'c3-mat-tim': V1('Telling the time', 'c3', 'Maths', 14, 89), 'c3-art-pat': V1('Patterns and symmetry', 'c3', 'Art & craft', 12, 59),
  counting: V1('A little counting magic', 'nursery', 'Maths', 10, 0), alphabet: V1('Alphabet explorers', 'kg', 'Phonics', 26, 99),
  shapes: V1('Shape spotters', 'nursery', 'Maths', 8, 79), colours: V1('Colour the forest', 'nursery', 'Art', 6, 59),
  'ws-add': V1('Woodland addition', 'c1', 'Maths', 20, 0), 'ws-story': V1('My first story', 'c2', 'Stories', 12, 89),
  'ws-nature': V1('Backyard discoveries', 'kg', 'Nature', 8, 69), 'ws-phon': V1('Phonics forest', 'kg', 'Phonics', 16, 99),
  'ws-sub': V1('Subtraction stories', 'c1', 'Maths', 16, 79), 'ws-time': V1('Telling the time', 'c3', 'Maths', 14, 89),
};
AZ.forEach(L => { SEED_V1['az-' + L] = Object.assign(V1('Alphabet ' + L + ' — tracing sheet', 'kg', 'English', 1, 0), { thumb: 'sheets/a-to-z/thumb/' + L + '.jpg' }); });

module.exports = { SEED_WORKSHEETS, PDF_SHEETS, REMOVED_IDS, SEED_V1, SEED_VERSION, SHEET_PRICE };
