/* Copyright (c) 2026 Learn With Why. All rights reserved. Proprietary — see LICENSE. This notice may not be removed. */
/* CATALOGUE SEED — the worksheets the database starts with. Ids match the
   cards in dist/index.html; price is in INR and 0 means a free access sheet.
   `file` is the PDF's path inside site/protected/ (never inside dist/). The
   A to Z sheets ship with real PDFs; the rest get theirs when the admin
   uploads them (POST /api/admin/worksheets/:id/file). */
const C = (id, title, cls, subject, pages, price) => ({ id, title, cls, subject, pages, price });
const SEED_WORKSHEETS = [
  C('nur-eng-abc', 'Alphabet tracing A–Z', 'nursery', 'English', 26, 0),
  C('nur-mat-num', 'Numbers 1–10 with dots', 'nursery', 'Maths', 10, 49),
  C('nur-art-col', 'Colour the forest', 'nursery', 'Art & craft', 8, 39),
  C('kg-eng-cvc', 'CVC words: cat, hat, bat', 'kg', 'English', 12, 0),
  C('kg-mat-cnt', 'Count to 20', 'kg', 'Maths', 14, 59),
  C('kg-evs-ani', 'Animals and their homes', 'kg', 'EVS', 10, 49),
  C('kg-eng-rhy', 'Rhyme time', 'kg', 'English', 8, 39),
  C('c1-eng-sen', 'Build a sentence', 'c1', 'English', 16, 79),
  C('c1-mat-add', 'Addition to 20', 'c1', 'Maths', 20, 0),
  C('c1-mat-sub', 'Subtraction stories', 'c1', 'Maths', 16, 79),
  C('c1-evs-pla', 'Plants around us', 'c1', 'EVS', 12, 59),
  C('c1-hin-var', 'Hindi varnamala tracing', 'c1', 'Hindi', 20, 69),
  C('c2-eng-det', 'Story Detective', 'c2', 'English', 12, 0),
  C('c2-mat-mul', 'Multiplication tables 2–10', 'c2', 'Maths', 24, 99),
  C('c2-sci-why', 'Why does it float?', 'c2', 'Science', 14, 89),
  C('c2-hin-mat', 'Hindi matras', 'c2', 'Hindi', 18, 69),
  C('c2-eng-end', 'Imagine a Different Ending', 'c2', 'English', 10, 79),
  C('c3-eng-adv', "Fox and Rabbit's Word Adventure", 'c3', 'English', 12, 0),
  C('c3-mat-fra', 'Fractions with pizza', 'c3', 'Maths', 18, 99),
  C('c3-sci-wal', 'A Forest Walk Full of Why', 'c3', 'Science', 8, 59),
  C('c3-mat-tim', 'Telling the time', 'c3', 'Maths', 14, 89),
  C('c3-art-pat', 'Patterns and symmetry', 'c3', 'Art & craft', 12, 59),
  /* the four sheets in the player */
  C('counting', 'A little counting magic', 'nursery', 'Maths', 10, 0),
  C('alphabet', 'Alphabet explorers', 'kg', 'Phonics', 26, 99),
  C('shapes', 'Shape spotters', 'nursery', 'Maths', 8, 79),
  C('colours', 'Colour the forest', 'nursery', 'Art', 6, 59),
  /* week-by-week worksheets */
  C('ws-add', 'Woodland addition', 'c1', 'Maths', 20, 0),
  C('ws-story', 'My first story', 'c2', 'Stories', 12, 89),
  C('ws-nature', 'Backyard discoveries', 'kg', 'Nature', 8, 69),
  C('ws-phon', 'Phonics forest', 'kg', 'Phonics', 16, 99),
  C('ws-sub', 'Subtraction stories', 'c1', 'Maths', 16, 79),
  C('ws-time', 'Telling the time', 'c3', 'Maths', 14, 89),
].concat('ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map(L => ({
  id: 'az-' + L, title: 'Alphabet ' + L + ' — tracing sheet', cls: 'kg', subject: 'English', pages: 1, price: 0,
  file: 'a-to-z/' + L + '.pdf', thumb: 'sheets/a-to-z/thumb/' + L + '.jpg',
})));

module.exports = { SEED_WORKSHEETS };
