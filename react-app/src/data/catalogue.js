/* The shelf — every sheet, book and printable PDF the site knows about.
   Moved from the page script in site/dist/index.html. The items are plain
   objects that the server (GET /api/worksheets) and the admin's book studio
   update in place; components re-render through the catalogue version in the
   site store (see src/context/SiteContext.jsx). */
import { CLASSES, SUBJECTS, subjectById } from './content.js';
import { read } from '../services/storage.js';

export const CATALOGUE = [
  { id: 'nur-eng-abc', cls: 'kg', subject: 'english', title: 'Alphabet tracing A–Z', glyph: 'Aa', pages: 26, price: 0, was: 99, blurb: 'Uppercase and lowercase with dotted guides and a picture cue for every letter.', skills: ['Pencil grip', 'Letter shapes', 'Phonics sounds'] },
  { id: 'nur-mat-num', cls: 'kg', subject: 'maths', title: 'Numbers 1–10 with dots', glyph: '1·2·3', pages: 10, price: 49, was: null, blurb: 'Count the dots, trace the numeral, colour the ten-frame — one number per page.', skills: ['Counting', 'Number shapes', 'One-to-one matching'] },
  { id: 'kg-eng-cvc', cls: 'kg', subject: 'english', title: 'CVC words: cat, hat, bat', glyph: 'c-a-t', pages: 12, price: 0, was: 79, blurb: 'Blend three sounds into a word, match it to a picture, write it once more.', skills: ['Blending', 'Reading first words', 'Spelling'] },
  { id: 'kg-mat-cnt', cls: 'kg', subject: 'maths', title: 'Count to 20', glyph: '20', pages: 14, price: 59, was: 89, blurb: 'Ten-frames, number lines and forest creatures to count, up to twenty.', skills: ['Counting to 20', 'Number line', 'More and fewer'] },
  { id: 'kg-evs-ani', cls: 'kg', subject: 'science', title: 'Animals and their homes', glyph: '🐾', pages: 10, price: 49, was: null, blurb: 'Who lives in a burrow, a nest, a den? Match, draw and name the home.', skills: ['Living things', 'Habitats', 'Vocabulary'] },
  { id: 'kg-eng-rhy', cls: 'kg', subject: 'english', title: 'Rhyme time', glyph: 'hush', pages: 8, price: 39, was: null, blurb: 'Circle the words that rhyme, then make up one of your own for the fox to keep.', skills: ['Rhyme', 'Listening', 'Word play'] },
  { id: 'c1-eng-sen', cls: 'c1', subject: 'english', title: 'Build a sentence', glyph: 'The fox…', pages: 16, price: 79, was: 99, blurb: 'Who, does what, where — pick a card from each column and write the sentence it makes.', skills: ['Sentence structure', 'Capital letters', 'Full stops'] },
  { id: 'c1-mat-add', cls: 'c1', subject: 'maths', title: 'Addition to 20', glyph: '+', pages: 20, price: 0, was: 99, blurb: 'Pictures first, numerals second: add acorns, add books, add the fireflies over the stump.', skills: ['Addition facts', 'Number bonds', 'Word problems'] },
  { id: 'c1-mat-sub', cls: 'c1', subject: 'maths', title: 'Subtraction stories', glyph: '−', pages: 16, price: 79, was: null, blurb: 'Every page is a tiny story with something taken away — cross it out, count what is left.', skills: ['Subtraction', 'Counting back', 'Reading a problem'] },
  { id: 'c1-evs-pla', cls: 'c1', subject: 'science', title: 'Plants around us', glyph: '🌱', pages: 12, price: 59, was: null, blurb: 'Roots, stem, leaves, flower: label the plant, then grow a bean in a cup and record it.', skills: ['Parts of a plant', 'Observation', 'Recording'] },
  { id: 'c2-eng-det', cls: 'c2', subject: 'english', title: 'Story Detective', glyph: '🔍', pages: 12, price: 0, was: 89, blurb: 'Read anything at all, then work like a detective: who wanted what, what got in the way, what changed.', skills: ['Comprehension', 'Cause and effect', 'Evidence from the text'] },
  { id: 'c2-mat-mul', cls: 'c2', subject: 'maths', title: 'Multiplication tables 2–10', glyph: '×', pages: 24, price: 99, was: 129, blurb: 'Arrays, skip-counting and a table a day — with a progress chart at the back.', skills: ['Times tables', 'Arrays', 'Skip counting'] },
  { id: 'c2-sci-why', cls: 'c2', subject: 'science', title: 'Why does it float?', glyph: '?', pages: 14, price: 89, was: null, blurb: 'Seven kitchen experiments. Guess first, test second, write down what surprised you.', skills: ['Prediction', 'Fair testing', 'Recording results'] },
  { id: 'c2-eng-end', cls: 'c2', subject: 'english', title: 'Imagine a Different Ending', glyph: '…', pages: 10, price: 79, was: null, blurb: 'Take a story you know and turn one decision the other way. Endings are choices somebody made.', skills: ['Creative writing', 'Character motive', 'Sequencing'] },
  { id: 'c3-eng-adv', cls: 'c3', subject: 'english', title: "Fox and Rabbit's Word Adventure", glyph: 'moss', pages: 12, price: 0, was: 79, blurb: 'A forest-flavoured vocabulary walk: sort, rhyme and build sentences from words gathered along the way.', skills: ['Vocabulary', 'Rhyme', 'Sentence building'] },
  { id: 'c3-mat-fra', cls: 'c3', subject: 'maths', title: 'Fractions with pizza', glyph: '½', pages: 18, price: 99, was: 129, blurb: 'Halves, quarters and thirds you can colour, cut and share — then compare who got more.', skills: ['Fractions', 'Equal parts', 'Comparing'] },
  { id: 'c3-sci-wal', cls: 'c3', subject: 'science', title: 'A Forest Walk Full of Why', glyph: '🌲', pages: 8, price: 59, was: null, blurb: 'A take-outdoors observation sheet. Notice five things, ask a why about each, guess before you look it up.', skills: ['Observation', 'Asking questions', 'Nature study'] },
  { id: 'c3-mat-tim', cls: 'c3', subject: 'maths', title: 'Telling the time', glyph: '⏰', pages: 14, price: 89, was: null, blurb: "O'clock, half past, quarter past and to — draw the hands, read the clock, plan a fox's day.", skills: ['Analogue time', 'Quarter hours', 'Sequencing a day'] },
].map(x => ({ ...x, kind: 'sheet', subjectId: x.subject, subject: subjectById(x.subject).label, bullets: [x.pages + ' A4 activity pages', x.skills[0] + ' · ' + x.skills[1], 'Parent, teacher, tutor or school print licence'] }));

/* the four sheets in the player */
export const SHEETS = [
  { id: 'counting', cls: 'kg', kind: 'sheet', glyph: '1 2 3', title: 'A little counting magic', subject: 'Maths', price: 0, was: 79, blurb: 'Count, trace and colour 1 to 10 with friendly forest creatures — one number per page.', bullets: ['Ten A4 activity pages', 'Ten-frames and number tracing', 'Parent, teacher or tutor print licence'] },
  { id: 'alphabet', cls: 'kg', kind: 'sheet', glyph: 'Aa Bb', title: 'Alphabet explorers', subject: 'English', price: 99, was: 129, blurb: 'Give little hands a happy start with letter shapes and early writing practice.', bullets: ['One A4 activity sheet per letter', 'Uppercase and lowercase practice', 'Parent, teacher or tutor print licence'] },
  { id: 'shapes', cls: 'kg', kind: 'sheet', glyph: '○ △ □', title: 'Shape spotters', subject: 'Maths', price: 79, was: null, blurb: 'Trace, sort and name eight shapes, then find one like it somewhere at home.', bullets: ['Eight A4 activity pages', 'Cut-and-sort shape cards', 'Parent, teacher or tutor print licence'] },
  { id: 'colours', cls: 'kg', kind: 'sheet', glyph: '✿', title: 'Colour the forest', subject: 'English', price: 59, was: null, blurb: 'Fox, rabbit, mushrooms and a very tall tree — big shapes, thick lines, no fiddly bits.', bullets: ['Six A4 colouring pages', 'Colour-name practice', 'Parent, teacher or tutor print licence'] },
];
export const WORKSHEETS = [
  { id: 'ws-add', cls: 'c1', kind: 'worksheet', cat: 'Maths', kicker: 'Little sums everywhere', glyph: '2 + 3', title: 'Woodland addition', subject: 'Maths', price: 0, was: 99, blurb: 'Build confidence with friendly addition problems and space to work things out.', bullets: ['Twenty A4 worksheet pages', 'Pictures first, numerals second', 'Answer key at the back'] },
  { id: 'ws-story', cls: 'c2', kind: 'worksheet', cat: 'Stories', kicker: 'Once upon a page', glyph: 'Once…', title: 'My first story', subject: 'English', price: 89, was: null, blurb: "Three gentle story prompts to bring a little learner's imagination to the page.", bullets: ['Twelve A4 worksheet pages', 'Story starters and picture boxes', 'Parent, teacher or tutor print licence'] },
  { id: 'ws-nature', cls: 'kg', kind: 'worksheet', cat: 'Nature', kicker: 'A walk full of why', glyph: '🌱', title: 'Backyard discoveries', subject: 'Science', price: 69, was: null, blurb: 'Explore the outdoors with a grown-up and notice big wonder hiding in everyday things.', bullets: ['Eight take-outside pages', 'Notice five things, ask five whys', 'Parent, teacher or tutor print licence'] },
  { id: 'ws-phon', cls: 'kg', kind: 'worksheet', cat: 'Phonics', kicker: 'Sounds in the forest', glyph: 'c-a-t', title: 'Phonics forest', subject: 'English', price: 99, was: 129, blurb: 'Blend three sounds into a word, match it to a picture, write it once more.', bullets: ['Sixteen A4 worksheet pages', 'CVC words and rhyme families', 'Parent guide in front'] },
  { id: 'ws-sub', cls: 'c1', kind: 'worksheet', cat: 'Maths', kicker: 'Take one away', glyph: '7 − 2', title: 'Subtraction stories', subject: 'Maths', price: 79, was: null, blurb: 'Every page is a tiny story with something taken away — cross it out, count what is left.', bullets: ['Sixteen A4 worksheet pages', 'Counting back on a number line', 'Answer key at the back'] },
  { id: 'ws-time', cls: 'c3', kind: 'worksheet', cat: 'Maths', kicker: 'What time is it, fox?', glyph: '⏰', title: 'Telling the time', subject: 'Maths', price: 89, was: null, blurb: "O'clock, half past and quarter past — draw the hands, read the clock, plan a fox's day.", bullets: ['Fourteen A4 worksheet pages', 'Analogue and digital', 'Parent, teacher or tutor print licence'] },
];
export const ITEMS = CATALOGUE.concat(SHEETS, WORKSHEETS);
export const itemById = id => ITEMS.find(x => x.id === id);

/* What is inside each sheet — shown when a customer opens one (4–5 lines). */
export const ABOUT = {
  'nur-eng-abc': ['One page per letter, A to Z, uppercase and lowercase side by side.', 'Dotted guides with numbered arrows show where the pencil starts and turns.', 'A picture cue for every letter to say the sound out loud.', 'Seven rows of practice, from big traced letters to writing alone.', 'Ends with a "my best letter" box to colour in.'],
  'nur-mat-num': ['Numbers 1 to 10, one number on each page.', 'Count the dots, then trace the numeral three times.', 'Colour the ten-frame to match the number.', 'Circle the group that has the same amount.', 'A tiny forest creature hides on every page to count.'],
  'kg-eng-cvc': ['Twelve pages of three-letter words: cat, hat, bat, dog, sun and more.', 'Say each sound, blend them, then read the word.', 'Match the word to its picture.', 'Write the word once more on the guide line.', 'A final page to read a short silly sentence.'],
  'kg-mat-cnt': ['Counting from 1 to 20 across fourteen pages.', 'Ten-frames to fill, number lines to hop along.', 'Forest creatures to count and circle in groups.', 'Which has more, which has fewer — compare two groups.', 'Trace the numerals 11 to 20.'],
  'kg-evs-ani': ['Ten pages about animals and where they live.', 'Match each animal to its home: burrow, nest, den, hive.', 'Draw the missing animal in its house.', 'Name the home and copy the word.', 'A last page to draw your own home.'],
  'kg-eng-rhy': ['Eight pages of rhyming words to hear and see.', 'Circle the two words that rhyme in each row.', 'Draw a line from a picture to its rhyming friend.', 'Make up a rhyme of your own for the fox to keep.'],
  'c1-eng-sen': ['Sixteen pages of sentence building.', 'Three columns — who, does what, where — pick one from each.', 'Write the sentence you made, with a capital letter and a full stop.', 'Colour the picture that matches your sentence.', 'Silly sentences are allowed and encouraged.'],
  'c1-mat-add': ['Twenty pages of adding up to 20.', 'Pictures first — add the acorns, add the books, add the fireflies.', 'Then the numerals, with number bonds to 10 and 20.', 'Short word problems to read and solve.', 'Answer key on the last page.'],
  'c1-mat-sub': ['Sixteen tiny subtraction stories.', 'Something is taken away on every page — cross it out.', 'Count what is left and write the number sentence.', 'Count back on a number line.', 'Answer key on the last page.'],
  'c1-evs-pla': ['Twelve pages about the plants around us.', 'Label the roots, stem, leaves and flower.', 'What a plant needs: sun, water, soil, air.', 'Grow a bean in a cup and record it for a week.', 'Draw the plant you found on a walk.'],
  'c2-eng-det': ['Twelve pages to use with any story you have read.', 'Who wanted what? What got in the way? What changed?', 'Find a clue in the text and write it down.', 'Draw the most important moment.', 'A detective badge to colour when the case is solved.'],
  'c2-mat-mul': ['Multiplication tables 2 to 10 across twenty-four pages.', 'Arrays to draw and count, skip-counting paths to follow.', 'One table a day with a quick test.', 'A progress chart to colour in at the back.'],
  'c2-sci-why': ['Seven kitchen experiments across fourteen pages.', 'Float or sink, mix or separate, melt or stay.', 'Guess first, test second, write down what surprised you.', 'Simple things from home — a bowl, a spoon, some water.', 'Space to draw what happened.'],
  'c2-eng-end': ['Ten pages of creative writing.', 'Take a story you know and change one decision.', 'What happens next? Write a new ending.', 'Put the new events in order.', 'Draw the cover of your new story.'],
  'c3-eng-adv': ['Twelve pages of forest-flavoured vocabulary.', 'Sort words gathered along the way into groups.', 'Find the rhymes and make new pairs.', 'Build sentences from the words you collected.', 'A word map to fill in at the end.'],
  'c3-mat-fra': ['Eighteen pages of fractions with pizza.', 'Halves, quarters and thirds to colour and cut.', 'Share the slices and compare who got more.', 'Write the fraction for each shaded part.', 'Answer key on the last page.'],
  'c3-sci-wal': ['Eight pages to take outdoors.', 'Notice five things and draw them.', 'Ask a "why" about each one.', 'Guess the answer before you look it up.', 'A nature checklist for the walk home.'],
  'c3-mat-tim': ["Fourteen pages of telling the time.", "O'clock, half past, quarter past and quarter to.", 'Draw the hands on the clock, then read the time.', 'Match analogue clocks to digital times.', "Plan a fox's day from breakfast to bedtime."],
  counting: ['Numbers 1 to 10 with friendly forest creatures.', 'Count, trace the numeral and colour the ten-frame.', 'One number per page, big and clear.', 'Circle the group with the same amount.'],
  alphabet: ['One activity sheet for every letter, A to Z.', 'Uppercase and lowercase with dotted guides.', 'A picture for each letter to say the sound.', 'Rows of practice, then a line to write alone.', 'Early writing made happy and calm.'],
  shapes: ['Eight shapes to trace, sort and name.', 'Circle, triangle, square, rectangle, star and more.', 'Cut-and-sort shape cards.', 'Find one shape like it somewhere at home.'],
  colours: ['Six colouring pages from the forest.', 'The fox, the rabbit, mushrooms and a very tall tree.', 'Big shapes and thick lines — no fiddly bits.', 'A colour word under every picture.'],
  'ws-add': ['Twenty pages of woodland addition.', 'Pictures first, numerals second.', 'Space to work each sum out.', 'Number bonds to 10 and 20.', 'Answer key at the back.'],
  'ws-story': ['Three gentle story prompts across twelve pages.', 'Story starters with picture boxes.', 'Who is in the story, where are they, what happens?', 'Write a little, draw a little.', 'A cover page to design.'],
  'ws-nature': ['Eight take-outside pages.', 'Notice five things and ask five whys.', 'Draw what you found.', 'Explore with a grown-up.'],
  'ws-phon': ['Sixteen pages of phonics in the forest.', 'CVC words and rhyme families.', 'Blend three sounds, match the picture, write the word.', 'A parent guide in front.', 'Simple sentences to read at the end.'],
  'ws-sub': ['Sixteen subtraction stories.', 'Cross out what is taken away, count what is left.', 'Count back on a number line.', 'Write the number sentence.', 'Answer key at the back.'],
  'ws-time': ['Fourteen pages of telling the time.', "O'clock, half past and quarter past.", 'Draw the hands, read the clock.', 'Analogue and digital side by side.', "Plan a fox's day."],
};
/* The free A to Z demo sheets (Kindergarten): the "Say it" picture on each one. */
export const AZ_WORDS = { A: 'apple', B: 'boy', C: 'cloud', D: 'drum', E: 'elephant', F: 'fish', G: 'grapes', H: 'house', I: 'igloo', J: 'jam', K: 'kite', L: 'lion', M: 'monkey', N: 'nest', O: 'orange', P: 'parrot', Q: 'quilt', R: 'rabbit', S: 'snake', T: 'tiger', U: 'umbrella', V: 'van', W: 'whale', X: 'x-ray', Y: 'yak', Z: 'zebra' };
/* Letter tracing and picture reading: the first three letters of each set are free samples,
   the rest are single PDFs to buy. The server's catalogue is the source of truth — SHEET_PRICE
   is only the built-in fallback until /api/worksheets answers. */
export const AZ_FREE = ['A', 'B', 'C'], RC_FREE = ['A', 'I', 'N'], SHEET_PRICE = 19;
const sheetPrice = (id, free) => (SERVER_PRICE[id] != null ? SERVER_PRICE[id] : (free ? 0 : SHEET_PRICE));
export const SERVER_PRICE = {};   /* filled by syncCatalogue() for ids that are not in ITEMS */
/* Each real PDF is built once and kept, so the store, the topic board and the sheet
   page all hold the same object — a price from the server reaches every one of them. */
const PDF_CACHE = {};
const keepSheet = (id, build) => PDF_CACHE[id] || (PDF_CACHE[id] = build());
export const azItem = L => keepSheet('az-' + L, () => { const price = sheetPrice('az-' + L, AZ_FREE.includes(L)); return ({ id: 'az-' + L, az: L, cls: 'kg', subject: 'English', subjectId: 'english', title: 'Alphabet ' + L + ' — tracing sheet', pages: 1, price, free: price === 0, real: true, img: '/sheets/a-to-z/thumb/' + L + '.jpg',
  blurb: 'Trace the big ' + L + ' and the small ' + L.toLowerCase() + ', then say it: ' + L + ' is for ' + AZ_WORDS[L] + '.',
  about: ['A "Trace it" box with the letter ' + L + ' and ' + L.toLowerCase() + ' — numbered arrows show where to start.', 'A "Say it" picture: ' + L + ' is for ' + AZ_WORDS[L] + '.', 'Seven rows of dotted ' + L + L.toLowerCase() + ' on red and blue guide lines to trace.', 'One A4 page, opens full screen in the protected viewer.', price === 0 ? 'Free sample — just sign in to open it.' : 'Yours to keep once bought — it never expires.'] }); });
/* Kindergarten demo section: the 26 A to Z sheets are real PDFs in sheets/a-to-z/, free for everyone — no sign-in, no plan. */
export const AZ_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
/* Kindergarten topics: seven groups, every sub-topic is a shelf of its own.
   Sheets reach a sub-topic through TOPIC_SHEETS below or a `topic` field on the product
   (the admin's book studio has a Topic field). Letter tracing holds the 26 A to Z sheets.
   The Alphabet group follows the Kindergarten content plan: eight sub-categories in its order. */
export const KG_TOPICS = [
  { id: 'pre', title: 'Pre-reading skills', tone: 'blue', items: [['picture-matching', 'Picture matching'], ['same-different', 'Same and different'], ['visual-discrimination', 'Visual discrimination'], ['listening', 'Listening activities'], ['following-instructions', 'Following instructions'], ['story-sequencing', 'Story sequencing'], ['rhyming-words', 'Rhyming words'], ['odd-one-out', 'Odd one out'], ['bme-sounds', 'Beginning, middle and ending sounds'], ['syllable-clapping', 'Syllable clapping'], ['oral-blending', 'Oral blending and segmenting']] },
  { id: 'alpha', title: 'Alphabet', tone: 'teal', items: [   /* as in the Kindergarten content plan: id, name, learning focus */
    ['letter-tracing', 'A-Z Letter Tracing', 'Children trace uppercase and lowercase letters from A to Z.'],
    ['letter-recognition', 'A-Z Letter Recognition', 'Children identify and recognise letters from A to Z.'],
    ['match-upper-lower', 'Match Uppercase and Lowercase Letters', 'Children match each capital letter with its corresponding small letter.'],
    ['before-after-letters', 'Letters Before and After', 'Children identify the letter that comes before or after the given letter.'],
    ['beginning-sounds', 'Beginning Sounds', 'Children identify the first sound heard in a pictured word.'],
    ['ending-sounds', 'Ending Sounds', 'Children identify the final sound heard in a pictured word.'],
    ['middle-sounds', 'Middle Sounds', 'Children identify the middle sound heard in a simple word.'],
    ['missing-letters', 'Find the Missing Letters', 'Children complete alphabet sequences by writing the missing letters.'],
  ] },
  { id: 'phon', title: 'Phonics', tone: 'yellow', items: [['short-vowels', 'Short vowels'], ['cvc-words', 'CVC words'], ['word-families', 'Word families'], ['blending-segmenting', 'Blending and segmenting'], ['ccvc-cvcc', 'CCVC and CVCC words'], ['blends', 'Beginning and ending blends'], ['digraphs', 'Digraphs: sh, ch, th, wh, ph, ck, ng, qu'], ['double-letters', 'Double letters'], ['magic-e', 'Magic e'], ['long-vowels', 'Long vowels'], ['vowel-teams', 'Simple vowel teams'], ['rhyming-words', 'Rhyming words'], ['spelling-rules', 'Simple spelling rules']] },
  { id: 'vocab', title: 'Vocabulary', tone: 'pink', items: [['colours-shapes-numbers', 'Colours, shapes and numbers'], ['animals', 'Animals, birds and insects'], ['food', 'Fruits, vegetables and food'], ['clothes-toys', 'Clothes and toys'], ['body-family', 'Body and family'], ['school-home', 'School and home objects'], ['transport-helpers', 'Transport and helpers'], ['action-words', 'Action words'], ['opposites', 'Opposites'], ['position-words', 'Position words'], ['simple-meanings', 'Simple meanings']] },
  { id: 'sight', title: 'Sight words', tone: 'purple', items: [['sight-lists', 'Pre-KG, KG1 and KG2 lists'], ['read-trace', 'Read and trace'], ['find-sight-word', 'Find the sight word'], ['complete-sentence', 'Complete the sentence'], ['sight-colouring', 'Sight-word colouring'], ['sight-passages', 'Sight-word passages']] },
  { id: 'gram', title: 'Grammar & writing', tone: 'yellow', items: [['pre-writing', 'Pre-writing strokes'], ['pencil-control', 'Pencil control'], ['name-writing', 'Name writing'], ['word-tracing', 'Word tracing and copying'], ['label-picture', 'Label the picture'], ['sentence-formation', 'Sentence formation'], ['capitals-full-stops', 'Capital letters and full stops'], ['naming-action', 'Naming and action words'], ['one-many', 'One and many'], ['this-that', 'This/that; these/those'], ['is-am-are', 'Is/am/are'], ['he-she-it', 'He/she/it'], ['position-words', 'Position words']] },
  { id: 'read', title: 'Reading', tone: 'teal', items: [['picture-reading', 'Picture reading'], ['read-match', 'Read and match'], ['read-colour', 'Read and colour'], ['decodable-sentences', 'Simple and decodable sentences'], ['picture-comprehension', 'Picture comprehension'], ['short-passages', 'Short passages'], ['yes-no', 'Yes/no questions'], ['multiple-choice', 'Multiple choice'], ['story-sequencing', 'Story sequencing'], ['wh-questions', 'Who, what and where questions']] },
  { id: 'more', title: 'Maths & the world', tone: 'blue', items: [['numbers-counting', 'Numbers and counting'], ['shapes-patterns', 'Shapes and patterns'], ['animals-nature', 'Animals and nature'], ['my-world', 'My body, family and home']] },
];
export const TOPIC_SHEETS = { 'picture-reading': ['rc'], 'beginning-sounds': ['bx', 'sd', 'rc'], 'ending-sounds': ['ex'], 'letter-recognition': ['cl'], 'match-upper-lower': ['mt', 'sp'], 'numbers-counting': ['kg-mat-cnt'], 'animals-nature': ['kg-evs-ani', 'ws-nature'], 'letter-tracing': ['az'], 'upper-lower': ['mt', 'sp'], 'letter-formation': ['az'], 'letter-sounds': ['rc'], 'cvc-words': ['kg-eng-cvc', 'ws-phon'], 'blending-segmenting': ['kg-eng-cvc', 'ws-phon'], 'word-families': ['ws-phon'], 'rhyming-words': ['kg-eng-rhy'], 'oral-blending': ['kg-eng-cvc'] };
const KG_ORDER = ['pre', 'vocab', 'alpha', 'sight', 'gram', 'phon', 'read', 'more'];   /* packs into columns like the reference */
export const kgOrdered = () => KG_ORDER.map(id => KG_TOPICS.find(g => g.id === id)).filter(Boolean);
/* every sheet inside a whole topic group (for "Browse worksheets") */
export function groupSheets(gid) {
  const g = KG_TOPICS.find(x => x.id === gid); if (!g) return [];
  const out = []; g.items.forEach(([id]) => topicSheets(id).forEach(it => { if (!out.some(x => x.id === it.id)) out.push(it); })); return out;
}
export const groupTitle = gid => (KG_TOPICS.find(x => x.id === gid) || {}).title || '';
export const topicLabel = id => { for (const g of KG_TOPICS) { const it = g.items.find(x => x[0] === id); if (it) return { group: g.title, label: it[1] }; } return { group: '', label: id }; };
export function topicSheets(id) {
  /* printable sets by id prefix, in the order TOPIC_SHEETS lists them; anything else is an item id */
  const SETS = { az: () => AZ_LETTERS.map(azItem), rc: () => RC_LETTERS.map(rcItem), cl: () => CL_LETTERS.map(clItem), mt: () => MT_RANGES.map(r => mtItem(r[0])), sp: () => MT_RANGES.map(r => spItem(r[0])),
    bx: () => SOUND_EXERCISES.map(bxItem), sd: () => SD_LETTERS.map(sdItem), ex: () => SOUND_EXERCISES.map(exItem) };
  const out = [];
  (TOPIC_SHEETS[id] || []).forEach(x => { (SETS[x] ? SETS[x]() : [itemById(x)]).forEach(it => { if (it && !out.includes(it)) out.push(it); }); });
  ITEMS.forEach(it => { if (it.topic === id && !out.includes(it)) out.push(it); });
  return out;
}
/* Picture-reading charts: six landscape pages (A, I, N, P, S, T) — a big letter with pictures whose names carry its sound. */
export const RC_LETTERS = 'AINPST'.split('');
export const RC_WORDS = { A: 'aeroplane, ant, apple, jam and hat', I: 'igloo, ink, insects, tin and spin', N: 'net, nest, nap, nine and pan', P: 'pup, pen, pit, panda and map', S: 'sun, star, snake, sand and bus', T: 'tent, train, tiger, tree and sit' };
export const rcItem = L => keepSheet('rc-' + L, () => { const price = sheetPrice('rc-' + L, RC_FREE.includes(L)); return ({ id: 'rc-' + L, rc: L, cls: 'kg', subject: 'English', subjectId: 'english', title: 'Letter ' + L + ' — picture reading chart', pages: 1, price, free: price === 0, real: true, landscape: true, img: '/sheets/reading/thumb/' + L + '.jpg', topic: 'picture-reading',
  blurb: 'Look at the pictures, say the words, hear the ' + L.toLowerCase() + ' sound: ' + RC_WORDS[L] + '.',
  about: ['A big, friendly letter ' + L + ' in the middle of the page.', 'Five pictures around it — ' + RC_WORDS[L] + ' — with the letter marked in red in each word.', 'Point, name the picture, then find the letter at the start, middle or end of the word.', 'One landscape A4 page, opens full screen in the protected viewer.', price === 0 ? 'Free sample — just sign in to open it.' : 'Yours to keep once bought — it never expires.'] }); });
/* Colour the letter (26) and Match the letters (5 ranges) — first three of each set free */
export const CL_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
export const clItem = L => keepSheet('cl-' + L, () => { const price = sheetPrice('cl-' + L, AZ_FREE.includes(L)); return ({ id: 'cl-' + L, letter: L, tileLabel: 'Colour ' + L, cls: 'kg', subject: 'English', subjectId: 'english', title: 'Colour the letter ' + L, pages: 1, price, free: price === 0, real: true, img: '/sheets/colour/thumb/' + L + '.jpg', topic: 'letter-recognition',
  blurb: 'Find every ' + L + ' and ' + L.toLowerCase() + ' hiding among the other letters, and colour them in.',
  about: ['A grid of twenty letters — some are ' + L + ' or ' + L.toLowerCase() + ', most are not.', 'Colour in only the ones that match, and leave the rest.', 'Trains letter recognition: spotting a letter by its shape, in both cases.', 'One A4 page, opens full screen in the protected viewer.', price === 0 ? 'Free sample — just sign in to open it.' : 'Yours to keep once bought — it never expires.'] }); });
export const MT_RANGES = [['AE', 'A B C D E'], ['FJ', 'F G H I J'], ['KO', 'K L M N O'], ['PT', 'P Q R S T'], ['UZ', 'U V W X Y Z']];
export const mtItem = code => keepSheet('mt-' + code, () => { const i = MT_RANGES.findIndex(r => r[0] === code), letters = (MT_RANGES[i] || ['', ''])[1], price = sheetPrice('mt-' + code, i < 3);
  return ({ id: 'mt-' + code, chart: true, tileName: 'Match ' + code[0] + '–' + code[1], tileSub: letters.split(' ').join(' · '), cls: 'kg', subject: 'English', subjectId: 'english', title: 'Match the letters ' + code[0] + '–' + code[1], pages: 1, price, free: price === 0, real: true, img: '/sheets/matching/thumb/' + code + '.jpg', topic: 'match-upper-lower',
  blurb: 'Trace the dots to join each capital letter to its small letter: ' + letters + '.',
  about: ['Capital letters down the left, small letters down the right — in a different order.', 'Trace the dotted line from each capital to the small letter that matches.', 'Covers ' + letters + ' on one page.', 'One A4 page, opens full screen in the protected viewer.', price === 0 ? 'Free sample — just sign in to open it.' : 'Yours to keep once bought — it never expires.'] }); });
/* Spot the letters — circle every lowercase letter that matches the capital, five ranges */
export const spItem = code => keepSheet('sp-' + code, () => { const i = MT_RANGES.findIndex(r => r[0] === code), letters = (MT_RANGES[i] || ['', ''])[1], price = sheetPrice('sp-' + code, i < 3);
  return ({ id: 'sp-' + code, chart: true, tileName: 'Spot ' + code[0] + '–' + code[1], tileSub: letters.split(' ').join(' · '), cls: 'kg', subject: 'English', subjectId: 'english', title: 'Spot the letters ' + code[0] + '–' + code[1], pages: 1, price, free: price === 0, real: true, img: '/sheets/spot/thumb/' + code + '.jpg', topic: 'match-upper-lower',
  blurb: 'Read the capital letter, then circle every small letter in the row that matches it: ' + letters + '.',
  about: ['A capital letter at the start of each row, then six small letters beside it.', 'Circle only the ones that match the capital — the rest are near-misses like b and d.', 'Covers ' + letters + ' on one page.', 'One A4 page, opens full screen in the protected viewer.', price === 0 ? 'Free sample — just sign in to open it.' : 'Yours to keep once bought — it never expires.'] }); });
/* Beginning and ending sounds (Sep 30): the "Read aloud" charts A to E and three
   exercises each for beginning and ending sounds. The exercises come first in their
   sub-category, and those three are free, as the content plan asks; the charts are paid.
   Files keep the folders of the zips they came in: sound/ and sound-exercise/. */
export const SD_LETTERS = 'ABCDE'.split('');
const SD_WORDS = { A: 'apple, arm, ant, panda, sofa and pizza', B: 'bat, bee, bag, tub, web and crab', C: 'cat, cup, car, sock, duck and magic', D: 'dog, doll, door, road, bed and bird', E: 'eagle, elephant, elbow, tree, knee and three' };
const soundAbout = (price, lines) => lines.concat(['One A4 page, opens full screen in the protected viewer.', price === 0 ? 'Free sample — just sign in to open it.' : 'Yours to keep once bought — it never expires.']);
export const sdItem = L => keepSheet('sd-' + L, () => { const price = sheetPrice('sd-' + L, false);
  return ({ id: 'sd-' + L, chart: true, tileName: 'Sound ' + L, tileSub: 'Read aloud · beginning & ending', cls: 'kg', subject: 'English', subjectId: 'english', title: 'Letter ' + L + ' — beginning and ending sounds', pages: 1, price, free: price === 0, real: true, img: '/sheets/sound/thumb/' + L + '.jpg', topic: 'beginning-sounds',
  blurb: 'Read the pictures aloud and hear ' + L + ' at the start or the end of each word: ' + SD_WORDS[L] + '.',
  about: soundAbout(price, ['A big letter ' + L + ' with six pictures around it: ' + SD_WORDS[L] + '.', 'The letter is underlined where it sits in each word, at the start or at the end.', 'Point, say the word, and listen for the ' + L + ' sound.']) }); });
const BX = { 1: ['Write the missing sound', 'Look at each picture and write the missing beginning sound of the word.'], 2: ['Circle the sound', 'Look at each picture and circle the sound its name begins with.'], 3: ['Same beginning sound', 'Read each row and circle the two words that begin with the same sound.'] };
const EX = { 1: ['Choose the ending sound', 'Look at each picture and circle the sound its name ends with.'], 2: ['Write the ending sound', 'Write the last sound of each word under its picture.'], 3: ['Same ending sound', 'Read each row and circle the two words that end with the same sound.'] };
const exerciseItem = (pre, n, map, what, file, topic) => keepSheet(pre + '-' + n, () => { const price = sheetPrice(pre + '-' + n, true);
  return ({ id: pre + '-' + n, chart: true, tileName: what + ' ' + n, tileSub: map[n][0], cls: 'kg', subject: 'English', subjectId: 'english', title: what + ' ' + n + ' — ' + map[n][0].toLowerCase(), pages: 1, price, free: price === 0, real: true, img: '/sheets/sound-exercise/thumb/' + file + '-' + n + '.jpg', topic,
  blurb: map[n][1], about: soundAbout(price, [map[n][1], 'Friendly pictures for every word, with a worked example to start.']) }); });
export const SOUND_EXERCISES = [1, 2, 3];
export const bxItem = n => exerciseItem('bx', n, BX, 'Beginning Sound', 'beginning-sound', 'beginning-sounds');
export const exItem = n => exerciseItem('ex', n, EX, 'Ending Sound', 'ending-sound', 'ending-sounds');
/* Every printable PDF joins the catalogue, so "All sheets" and the store's filters
   show the whole shelf — the letter, colour, matching and reading pages as well as the books. */
export const PDF_SHEETS = [].concat(AZ_LETTERS.map(azItem), RC_LETTERS.map(rcItem), CL_LETTERS.map(clItem),
  MT_RANGES.map(r => mtItem(r[0])), MT_RANGES.map(r => spItem(r[0])),
  SOUND_EXERCISES.map(bxItem), SD_LETTERS.map(sdItem), SOUND_EXERCISES.map(exItem));
PDF_SHEETS.forEach(it => { it.pdf = true; if (!itemById(it.id)) ITEMS.push(it); });
/* any sheet by id: the printable PDFs are built on demand, everything else is in ITEMS */
export const sheetOf = id => id && id.startsWith('sd-') ? sdItem(id.slice(3)) : id && id.startsWith('bx-') ? bxItem(+id.slice(3)) : id && id.startsWith('ex-') ? exItem(+id.slice(3)) : id && id.startsWith('az-') ? azItem(id.slice(3)) : id && id.startsWith('rc-') ? rcItem(id.slice(3)) : id && id.startsWith('cl-') ? clItem(id.slice(3)) : id && id.startsWith('mt-') ? mtItem(id.slice(3)) : id && id.startsWith('sp-') ? spItem(id.slice(3)) : itemById(id);

/* ---------- the store: views and skill groups ---------- */
export const NEW_IDS = ['c2-sci-why', 'c3-mat-tim', 'kg-eng-rhy', 'ws-time'];
export const BEST_IDS = ['nur-eng-abc', 'c1-mat-add', 'c2-mat-mul', 'kg-eng-cvc', 'alphabet', 'ws-add', 'c3-mat-fra'];
export const VIEWS = [
  { id: 'all', label: 'All sheets' }, { id: 'worksheets', label: 'All worksheets', note: 'every PDF' }, { id: 'new', label: 'New', note: 'just drawn' }, { id: 'best', label: 'Bestselling', note: 'parents love these' },
  { id: 'free', label: 'Free', note: 'try first' }, { id: 'paid', label: 'Subscription', note: 'per class' },
];
export const SKILL_CATEGORIES = [
  { id: 'letter-formation', label: 'Letter Formation', description: 'Uppercase and lowercase with dotted guides and picture cues', color: 'rgba(59, 91, 219, 0.4)', count: 26 },
  { id: 'letter-sounds', label: 'Letter Sounds', description: 'Consonant blending, rhyming words and phonetic awareness', color: 'rgba(139, 67, 219, 0.4)', count: 6 },
  { id: 'uppercase-lowercase', label: 'Uppercase & lowercase', description: 'Match upper to lower case letters in fun activities', color: 'rgba(67, 167, 219, 0.4)', count: 5 },
  { id: 'spot-the-letters', label: 'Spot the letters', description: 'Visual discrimination and letter recognition practice', color: 'rgba(219, 131, 67, 0.4)', count: 5 },
  { id: 'colour-matching', label: 'Colour matching', description: 'Sort, name and match colours with tracing practice', color: 'rgba(67, 219, 131, 0.4)', count: 26 },
  { id: 'beginning-sounds', label: 'Beginning sounds', description: 'Hear, circle and write the first sound, with read-aloud charts A to E', color: 'rgba(219, 67, 131, 0.4)' },
  { id: 'ending-sounds', label: 'Ending sounds', description: 'Choose and write the last sound, then find words that end the same', color: 'rgba(219, 191, 67, 0.4)' },
];
/* the store's skill filter: category id → the id prefix of its printable PDFs */
export const SKILL_PREFIX = { 'letter-formation': 'az', 'letter-sounds': 'rc', 'uppercase-lowercase': 'mt', 'spot-the-letters': 'sp', 'colour-matching': 'cl', 'beginning-sounds': 'bs', 'ending-sounds': 'es' };
export const SKILL_NAME = { az: 'Letter Formation', rc: 'Letter Sounds', mt: 'Uppercase & lowercase', sp: 'Spot the letters', cl: 'Colour matching', bs: 'Beginning sounds', es: 'Ending sounds' };
/* the PDF sheets in a skill: every sheet whose id starts with one of its prefixes, so each PDF is counted once */
const SKILL_SETS = { bs: ['bx', 'sd'], es: ['ex'] };
export const skillSheets = skill => PDF_SHEETS.filter(it => (SKILL_SETS[skill] || [skill]).includes(it.id.split('-')[0]));
SKILL_CATEGORIES.forEach(c => { c.count = skillSheets(SKILL_PREFIX[c.id]).length; });

/* prices the admin changed in this browser */
export function applyLocalPrices(PLANS) { const o = read('lww_prices', {}); ITEMS.forEach(it => { if (o[it.id] != null) it.price = o[it.id]; }); const q = read('lww_plan_prices', {}); PLANS.forEach(x => { if (q[x.id] != null) x.price = q[x.id]; }); }
/* products the admin added, edited or removed (the book studio in the admin panel) */
export function applyAdminProducts() {
  const o = read('lww_products', { added: [], edited: {}, deleted: [] });
  o.added.forEach(x => { if (!ITEMS.some(i => i.id === x.id)) { CATALOGUE.push(x); ITEMS.push(x); } });
  Object.keys(o.edited).forEach(id => { const it = itemById(id); if (it) Object.assign(it, o.edited[id]); });
  o.deleted.forEach(id => [CATALOGUE, SHEETS, WORKSHEETS, ITEMS].forEach(a => { const i = a.findIndex(x => x.id === id); if (i >= 0) a.splice(i, 1); }));
}
/* THE SERVER IS THE SOURCE OF TRUTH — prices, page counts and which sheets have a real PDF
   come from GET /api/worksheets and override the built-in values. */
export function applyServerCatalogue(worksheets) {
  const byId = {}; worksheets.forEach(w => { byId[w.id] = w; });
  ITEMS.forEach(it => { const w = byId[it.id]; if (!w) return; it.price = w.price; it.real = w.real; if (w.pages) it.pages = w.pages;
    /* the printable pages carry the free/paid line in their own words, so keep it in step */
    if (it.pdf) { it.free = it.price === 0; if (Array.isArray(it.about)) it.about[it.about.length - 1] = it.price === 0 ? 'Free sample — just sign in to open it.' : 'Yours to keep once bought — it never expires.'; } });
  worksheets.forEach(w => { if (!itemById(w.id)) SERVER_PRICE[w.id] = w.price; });   /* letter tracing + picture reading */
}
/* products edited in the admin's book studio */
export function removeItem(id) { [CATALOGUE, SHEETS, WORKSHEETS, ITEMS].forEach(a => { const i = a.findIndex(x => x.id === id); if (i >= 0) a.splice(i, 1); }); }
export function addItem(np) { CATALOGUE.push(np); ITEMS.push(np); }
export { CLASSES, SUBJECTS };
