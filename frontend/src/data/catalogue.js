/* The shelf — every sheet, book and printable PDF the site knows about.
   Moved from the page script in legacy/old-static-site/index.html. The items are plain
   objects that the server (GET /api/worksheets) and the admin's book studio
   update in place; components re-render through the catalogue version in the
   site store (see src/context/SiteContext.jsx). */
import { CLASSES, SUBJECTS, subjectById, accessSpan } from './content.js';

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
/* Free sheets per section (Sumit, Oct 22): Colour A to Z 3, Matching 2, Uppercase & Lowercase 2,
   Sounds 2, Sounds Exercise 2, Missing letters 2, and Colours, Shapes, Sizes and Animals 3 each;
   Alphabet A and B tracing stay free (not on his list).
   Every other PDF is a single sheet to buy. The server's catalogue is the source of truth —
   FREE_PDFS and SHEET_PRICE are only the built-in fallback until /api/worksheets answers. */
export const FREE_PDFS = ['az-A', 'az-B', 'cl-A', 'cl-B', 'cl-C', 'mt-AE', 'mt-FJ', 'sp-AE', 'sp-FJ', 'sd-A', 'sd-B', 'bx-1', 'ex-1', 'vc-1', 'vc-2', 'vc-3', 'ms-U1', 'ms-L1', 'vs-1', 'vs-2', 'vs-3', 'vz-1', 'vz-2', 'vz-3', 'va-1', 'va-2', 'va-3'], SHEET_PRICE = 19;
export const AZ_FREE = FREE_PDFS.filter(id => id.startsWith('az-')).map(id => id.slice(3));
const sheetPrice = id => (SERVER_PRICE[id] != null ? SERVER_PRICE[id] : (FREE_PDFS.includes(id) ? 0 : SHEET_PRICE));
/* the last line of every printable sheet's "what is inside": free, or how long a purchase stays open
   (the sheet's accessHours from the server, 24 hours until it answers) */
export const accessLine = (price, it) => (price === 0 ? 'Free sample. It opens straight away, no sign-in needed.' : 'Once bought, it stays open for ' + accessSpan(it) + ' from the moment you pay. Then it is removed from your account.');
export const SERVER_PRICE = {};   /* filled by syncCatalogue() for ids that are not in ITEMS */
/* Each real PDF is built once and kept, so the store, the topic board and the sheet
   page all hold the same object — a price from the server reaches every one of them. */
const PDF_CACHE = {};
const keepSheet = (id, build) => PDF_CACHE[id] || (PDF_CACHE[id] = build());
export const azItem = L => keepSheet('az-' + L, () => { const price = sheetPrice('az-' + L); return ({ id: 'az-' + L, az: L, cls: 'kg', subject: 'English', subjectId: 'english', title: 'Alphabet ' + L + ' — tracing sheet', pages: 1, price, free: price === 0, real: true, img: '/sheets/a-to-z/thumb/' + L + '.jpg',
  blurb: 'Trace the big ' + L + ' and the small ' + L.toLowerCase() + ', then say it: ' + L + ' is for ' + AZ_WORDS[L] + '.',
  about: ['A "Trace it" box with the letter ' + L + ' and ' + L.toLowerCase() + ' — numbered arrows show where to start.', 'A "Say it" picture: ' + L + ' is for ' + AZ_WORDS[L] + '.', 'Seven rows of dotted ' + L + L.toLowerCase() + ' on red and blue guide lines to trace.', 'One A4 page, opens full screen in the protected viewer.', accessLine(price)] }); });
/* Kindergarten's A to Z section: 26 tracing sheets, real PDFs in sheets/a-to-z/. A and B are free (they open
   without signing in); the others are bought one at a time or open with the Kindergarten plan. The server's prices decide. */
export const AZ_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
/* Kindergarten topics: seven groups, every sub-topic is a shelf of its own.
   Sheets reach a sub-topic through TOPIC_SHEETS below or a `topic` field on the product
   (the admin's book studio has a Topic field). The Alphabet group follows the Kindergarten
   content plan, in its order, as the seven sections Sumit listed (Oct 5; Middle Sounds was
   taken out). Which sheets sit in each is Sumit's own list: tracing = A to Z + the Group 1 reading charts, recognition = Colour A to Z,
   match = Matching, before and after = the Spot sheets ("Uppercase to Lowercase" zip),
   beginning and ending sounds = their Sound Exercise sheets + the Sound charts A to E,
   missing letters = Missing A to Z. */
export const KG_TOPICS = [
  { id: 'pre', title: 'Pre-reading skills', tone: 'blue', items: [['picture-matching', 'Picture matching'], ['same-different', 'Same and different'], ['visual-discrimination', 'Visual discrimination'], ['listening', 'Listening activities'], ['following-instructions', 'Following instructions'], ['story-sequencing', 'Story sequencing'], ['rhyming-words', 'Rhyming words'], ['odd-one-out', 'Odd one out'], ['bme-sounds', 'Beginning, middle and ending sounds'], ['syllable-clapping', 'Syllable clapping'], ['oral-blending', 'Oral blending and segmenting']] },
  { id: 'alpha', title: 'Alphabet', tone: 'teal', items: [   /* as in the Kindergarten content plan: id, name, learning focus */
    ['letter-tracing', 'A-Z Letter Tracing', 'Children trace uppercase and lowercase letters from A to Z.'],
    ['letter-recognition', 'A-Z Letter Recognition', 'Children identify and recognise letters from A to Z.'],
    ['match-upper-lower', 'Match Uppercase and Lowercase Letters', 'Children match each capital letter with its corresponding small letter.'],
    ['before-after-letters', 'Letters Before and After', 'Children identify the letter that comes before or after the given letter.'],
    ['beginning-sounds', 'Beginning Sounds', 'Children identify the first sound heard in a pictured word.'],
    ['ending-sounds', 'Ending Sounds', 'Children identify the final sound heard in a pictured word.'],
    ['missing-letters', 'Find the Missing Letters', 'Children complete alphabet sequences by writing the missing letters.'],
  ] },
  { id: 'phon', title: 'Phonics', tone: 'yellow', items: [['short-vowels', 'Short vowels'], ['cvc-words', 'CVC words'], ['word-families', 'Word families'], ['blending-segmenting', 'Blending and segmenting'], ['ccvc-cvcc', 'CCVC and CVCC words'], ['blends', 'Beginning and ending blends'], ['digraphs', 'Digraphs: sh, ch, th, wh, ph, ck, ng, qu'], ['double-letters', 'Double letters'], ['magic-e', 'Magic e'], ['long-vowels', 'Long vowels'], ['vowel-teams', 'Simple vowel teams'], ['rhyming-words', 'Rhyming words'], ['spelling-rules', 'Simple spelling rules']] },
  { id: 'vocab', title: 'Vocabulary', tone: 'pink', items: [   /* Sumit's twelve topics (Oct 6 picture): id, name, picture */
    ['vocab-colours', 'Colours', 'colours'], ['vocab-shapes', 'Shapes', 'shapes'], ['vocab-sizes', 'Sizes', 'sizes'], ['vocab-animals', 'Animals', 'animals'],
    ['vocab-animal-babies', 'Animal Babies', 'animal-babies'], ['vocab-transport', 'Transport', 'transport'], ['vocab-fruits', 'Fruits', 'fruits'], ['vocab-vegetables', 'Vegetables', 'vegetables'],
    ['vocab-body-parts', 'Body Parts', 'body-parts'], ['vocab-clothes', 'Clothes', 'clothes'], ['vocab-my-family', 'My Family', 'my-family'], ['vocab-weather', 'Weather', 'weather'],
  ] },
  { id: 'sight', title: 'Sight words', tone: 'purple', items: [['sight-lists', 'Pre-KG, KG1 and KG2 lists'], ['read-trace', 'Read and trace'], ['find-sight-word', 'Find the sight word'], ['complete-sentence', 'Complete the sentence'], ['sight-colouring', 'Sight-word colouring'], ['sight-passages', 'Sight-word passages']] },
  { id: 'gram', title: 'Grammar & writing', tone: 'yellow', items: [['pre-writing', 'Pre-writing strokes'], ['pencil-control', 'Pencil control'], ['name-writing', 'Name writing'], ['word-tracing', 'Word tracing and copying'], ['label-picture', 'Label the picture'], ['sentence-formation', 'Sentence formation'], ['capitals-full-stops', 'Capital letters and full stops'], ['naming-action', 'Naming and action words'], ['one-many', 'One and many'], ['this-that', 'This/that; these/those'], ['is-am-are', 'Is/am/are'], ['he-she-it', 'He/she/it'], ['position-words', 'Position words']] },
  { id: 'read', title: 'Reading', tone: 'teal', items: [['picture-reading', 'Picture reading'], ['read-match', 'Read and match'], ['read-colour', 'Read and colour'], ['decodable-sentences', 'Simple and decodable sentences'], ['picture-comprehension', 'Picture comprehension'], ['short-passages', 'Short passages'], ['yes-no', 'Yes/no questions'], ['multiple-choice', 'Multiple choice'], ['story-sequencing', 'Story sequencing'], ['wh-questions', 'Who, what and where questions']] },
  { id: 'more', title: 'Maths & the world', tone: 'blue', items: [['numbers-counting', 'Numbers and counting'], ['shapes-patterns', 'Shapes and patterns'], ['animals-nature', 'Animals and nature'], ['my-world', 'My body, family and home']] },
];
export const TOPIC_SHEETS = { 'vocab-colours': ['vc'], 'vocab-shapes': ['vs'], 'vocab-sizes': ['vz'], 'vocab-animals': ['va'], 'picture-reading': ['rc'], 'beginning-sounds': ['bx', 'sd'], 'ending-sounds': ['ex', 'sd'], 'letter-recognition': ['cl'], 'match-upper-lower': ['mt'], 'before-after-letters': ['sp'], 'missing-letters': ['ms'], 'numbers-counting': ['kg-mat-cnt'], 'animals-nature': ['kg-evs-ani', 'ws-nature'], 'letter-tracing': ['az', 'rc'], 'upper-lower': ['mt', 'sp'], 'letter-formation': ['az'], 'letter-sounds': ['rc'], 'cvc-words': ['kg-eng-cvc', 'ws-phon'], 'blending-segmenting': ['kg-eng-cvc', 'ws-phon'], 'word-families': ['ws-phon'], 'rhyming-words': ['kg-eng-rhy'], 'oral-blending': ['kg-eng-cvc'] };
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
    bx: () => SOUND_EXERCISES.map(bxItem), sd: () => SD_LETTERS.map(sdItem), ex: () => SOUND_EXERCISES.map(exItem), ms: () => MS_CODES.map(msItem), vc: () => VOCAB_NUMBERS.map(n => vocabItem('vc', n)), vs: () => VOCAB_NUMBERS.map(n => vocabItem('vs', n)), vz: () => VOCAB_NUMBERS.map(n => vocabItem('vz', n)), va: () => VOCAB_NUMBERS.map(n => vocabItem('va', n)) };
  const out = [];
  /* a built-in sheet staff moved to another section (Admin → Products) leaves its own sections */
  (TOPIC_SHEETS[id] || []).forEach(x => { (SETS[x] ? SETS[x]() : [itemById(x)]).forEach(it => { if (it && !it.movedTo && !out.includes(it)) out.push(it); }); });
  ITEMS.forEach(it => { if ((it.topic === id && (!it.movedTo || it.movedTo === id)) || it.movedTo === id) { if (!out.includes(it)) out.push(it); } });
  return out.filter(isListed);
}
/* Picture-reading charts: six landscape pages (A, I, N, P, S, T) — a big letter with pictures whose names carry its sound. */
export const RC_LETTERS = 'AINPST'.split('');
export const RC_WORDS = { A: 'aeroplane, ant, apple, jam and hat', I: 'igloo, ink, insects, tin and spin', N: 'net, nest, nap, nine and pan', P: 'pup, pen, pit, panda and map', S: 'sun, star, snake, sand and bus', T: 'tent, train, tiger, tree and sit' };
export const rcItem = L => keepSheet('rc-' + L, () => { const price = sheetPrice('rc-' + L); return ({ id: 'rc-' + L, rc: L, cls: 'kg', subject: 'English', subjectId: 'english', title: 'Letter ' + L + ' — picture reading chart', pages: 1, price, free: price === 0, real: true, landscape: true, img: '/sheets/reading/thumb/' + L + '.jpg', topic: 'picture-reading',
  blurb: 'Look at the pictures, say the words, hear the ' + L.toLowerCase() + ' sound: ' + RC_WORDS[L] + '.',
  about: ['A big, friendly letter ' + L + ' in the middle of the page.', 'Five pictures around it — ' + RC_WORDS[L] + ' — with the letter marked in red in each word.', 'Point, name the picture, then find the letter at the start, middle or end of the word.', 'One landscape A4 page, opens full screen in the protected viewer.', accessLine(price)] }); });
/* Colour the letter (26) and Match the letters (5 ranges) */
export const CL_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
export const clItem = L => keepSheet('cl-' + L, () => { const price = sheetPrice('cl-' + L); return ({ id: 'cl-' + L, letter: L, tileLabel: 'Colour ' + L, cls: 'kg', subject: 'English', subjectId: 'english', title: 'Colour the letter ' + L, pages: 1, price, free: price === 0, real: true, img: '/sheets/colour/thumb/' + L + '.jpg', topic: 'letter-recognition',
  blurb: 'Find every ' + L + ' and ' + L.toLowerCase() + ' hiding among the other letters, and colour them in.',
  about: ['A grid of twenty letters — some are ' + L + ' or ' + L.toLowerCase() + ', most are not.', 'Colour in only the ones that match, and leave the rest.', 'Trains letter recognition: spotting a letter by its shape, in both cases.', 'One A4 page, opens full screen in the protected viewer.', accessLine(price)] }); });
export const MT_RANGES = [['AE', 'A B C D E'], ['FJ', 'F G H I J'], ['KO', 'K L M N O'], ['PT', 'P Q R S T'], ['UZ', 'U V W X Y Z']];
export const mtItem = code => keepSheet('mt-' + code, () => { const i = MT_RANGES.findIndex(r => r[0] === code), letters = (MT_RANGES[i] || ['', ''])[1], price = sheetPrice('mt-' + code);
  return ({ id: 'mt-' + code, chart: true, tileName: 'Match ' + code[0] + '–' + code[1], tileSub: letters.split(' ').join(' · '), cls: 'kg', subject: 'English', subjectId: 'english', title: 'Match the letters ' + code[0] + '–' + code[1], pages: 1, price, free: price === 0, real: true, img: '/sheets/matching/thumb/' + code + '.jpg', topic: 'match-upper-lower',
  blurb: 'Trace the dots to join each capital letter to its small letter: ' + letters + '.',
  about: ['Capital letters down the left, small letters down the right — in a different order.', 'Trace the dotted line from each capital to the small letter that matches.', 'Covers ' + letters + ' on one page.', 'One A4 page, opens full screen in the protected viewer.', accessLine(price)] }); });
/* Spot the letters — circle every lowercase letter that matches the capital, five ranges */
export const spItem = code => keepSheet('sp-' + code, () => { const i = MT_RANGES.findIndex(r => r[0] === code), letters = (MT_RANGES[i] || ['', ''])[1], price = sheetPrice('sp-' + code);
  return ({ id: 'sp-' + code, chart: true, tileName: 'Spot ' + code[0] + '–' + code[1], tileSub: letters.split(' ').join(' · '), cls: 'kg', subject: 'English', subjectId: 'english', title: 'Spot the letters ' + code[0] + '–' + code[1], pages: 1, price, free: price === 0, real: true, img: '/sheets/spot/thumb/' + code + '.jpg', topic: 'before-after-letters',
  blurb: 'Read the capital letter, then circle every small letter in the row that matches it: ' + letters + '.',
  about: ['A capital letter at the start of each row, then six small letters beside it.', 'Circle only the ones that match the capital — the rest are near-misses like b and d.', 'Covers ' + letters + ' on one page.', 'One A4 page, opens full screen in the protected viewer.', accessLine(price)] }); });
/* Beginning and ending sounds (Sep 30): the "Read aloud" charts A to E and three
   exercises each for beginning and ending sounds. The exercises come first in their
   sub-category.
   Files keep the folders of the zips they came in: sound/ and sound-exercise/. */
export const SD_LETTERS = 'ABCDE'.split('');
const SD_WORDS = { A: 'apple, arm, ant, panda, sofa and pizza', B: 'bat, bee, bag, tub, web and crab', C: 'cat, cup, car, sock, duck and magic', D: 'dog, doll, door, road, bed and bird', E: 'eagle, elephant, elbow, tree, knee and three' };
const soundAbout = (price, lines) => lines.concat(['One A4 page, opens full screen in the protected viewer.', accessLine(price)]);
export const sdItem = L => keepSheet('sd-' + L, () => { const price = sheetPrice('sd-' + L);
  return ({ id: 'sd-' + L, chart: true, tileName: 'Sound ' + L, tileSub: 'Read aloud · beginning & ending', cls: 'kg', subject: 'English', subjectId: 'english', title: 'Letter ' + L + ' — beginning and ending sounds', pages: 1, price, free: price === 0, real: true, img: '/sheets/sound/thumb/' + L + '.jpg', topic: 'beginning-sounds',
  blurb: 'Read the pictures aloud and hear ' + L + ' at the start or the end of each word: ' + SD_WORDS[L] + '.',
  about: soundAbout(price, ['A big letter ' + L + ' with six pictures around it: ' + SD_WORDS[L] + '.', 'The letter is underlined where it sits in each word, at the start or at the end.', 'Point, say the word, and listen for the ' + L + ' sound.']) }); });
const BX = { 1: ['Write the missing sound', 'Look at each picture and write the missing beginning sound of the word.'], 2: ['Circle the sound', 'Look at each picture and circle the sound its name begins with.'], 3: ['Same beginning sound', 'Read each row and circle the two words that begin with the same sound.'] };
const EX = { 1: ['Choose the ending sound', 'Look at each picture and circle the sound its name ends with.'], 2: ['Write the ending sound', 'Write the last sound of each word under its picture.'], 3: ['Same ending sound', 'Read each row and circle the two words that end with the same sound.'] };
const exerciseItem = (pre, n, map, what, file, topic) => keepSheet(pre + '-' + n, () => { const price = sheetPrice(pre + '-' + n);
  return ({ id: pre + '-' + n, chart: true, tileName: what + ' ' + n, tileSub: map[n][0], cls: 'kg', subject: 'English', subjectId: 'english', title: what + ' ' + n + ' — ' + map[n][0].toLowerCase(), pages: 1, price, free: price === 0, real: true, img: '/sheets/sound-exercise/thumb/' + file + '-' + n + '.jpg', topic,
  blurb: map[n][1], about: soundAbout(price, [map[n][1], 'Friendly pictures for every word, with a worked example to start.']) }); });
export const SOUND_EXERCISES = [1, 2, 3];
export const bxItem = n => exerciseItem('bx', n, BX, 'Beginning Sound', 'beginning-sound', 'beginning-sounds');
export const exItem = n => exerciseItem('ex', n, EX, 'Ending Sound', 'ending-sound', 'ending-sounds');
/* Find the missing letters (Oct 5, Sumit's Missing A to Z zip): three capital-letter sheets
   and three small-letter sheets, in sheets/missing/ */
export const MS_CODES = ['U1', 'U2', 'U3', 'L1', 'L2', 'L3'];
const MS = { 1: ['Apples', 'Write the missing letters on the blank apples, from ', ' to ', '.', 'Twenty-six apples in alphabet order; some letters are there, the rest are blank.'],
  2: ['Alphabet path', 'Follow the winding path of boxes and write the missing letters from ', ' to ', '.', 'One long path of boxes, from the apple to the zebra, with a few letters as clues.'],
  3: ['Rows with pictures', 'Fill in the missing letters in short rows of five, each with a little picture.', '', '', 'Four rows of five boxes with two or three letters given in each row.'] };
export const msItem = code => keepSheet('ms-' + code, () => { const big = code[0] === 'U', n = +code[1], m = MS[n] || MS[1], first = big ? 'A' : 'a', last = big ? 'Z' : 'z', kind = big ? 'capital' : 'small', price = sheetPrice('ms-' + code);
  const blurb = n === 3 ? m[1] : m[1] + first + m[2] + last + m[3];
  return ({ id: 'ms-' + code, chart: true, tileName: (big ? 'Capitals ' : 'Small letters ') + n, tileSub: m[0] + ' · ' + first + '–' + last, cls: 'kg', subject: 'English', subjectId: 'english', title: 'Missing ' + kind + ' letters ' + n + ' — ' + m[0].toLowerCase(), pages: 1, price, free: price === 0, real: true, img: '/sheets/missing/thumb/' + (big ? 'upper-' : 'lower-') + n + '.jpg', topic: 'missing-letters',
  blurb, about: soundAbout(price, [m[4], 'Say the alphabet aloud and write each missing ' + kind + ' letter in its place.']) }); });
/* Vocabulary · Colours and Shapes (Oct 6, Sumit's Colours and Shapes zips): ten sheets each in
   sheets/vocab-colours/ and sheets/vocab-shapes/. Most have a second page: the same sheet with the
   answers filled in. Per sheet: short name for the tile, what the child does, number of pages. */
export const VOCAB_NUMBERS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const VOCAB = {
  vc: { name: 'Colours', topic: 'vocab-colours', folder: 'vocab-colours', file: 'colours', sheets: {
    1: ['Write the colour names', 'Look at each colour and write its name, using the words in the box.', 2],
    2: ['Circle the colour word', 'Look at each colour and circle the word that names it.', 2],
    3: ['Match the colour', 'Draw a line from each coloured heart to its name.', 2],
    4: ['Read and colour the pencils', 'Read the colour word under each pencil and colour the pencil in.', 1],
    5: ['Read and colour the pictures', 'Read the words, find the matching pictures and colour each one in its colour.', 1],
    6: ['I spy something blue', 'Circle all the things that are blue.', 2],
    7: ['I spy something yellow', 'Circle all the things that are yellow.', 2],
    8: ['I spy something red', 'Circle all the things that are red.', 2],
    9: ['Circle the colour', 'Look at each paint splash and circle the name of its colour.', 2],
    10: ['Match the crayon', 'Draw a line from each crayon to the picture of the same colour.', 2] } },
  vs: { name: 'Shapes', topic: 'vocab-shapes', folder: 'vocab-shapes', file: 'shapes', sheets: {
    1: ['Name the shapes', 'Twelve shapes with their names: look at each one and say its name aloud.', 1],
    2: ['Colour the correct shape', 'Read the shape word and colour the shape that matches it.', 2],
    3: ['Match objects to shapes', 'Draw a line from each object to the shape it looks like.', 2],
    4: ['Match the word to the shape', 'Join the dots to match each shape word to its shape.', 2],
    5: ['Circle the shape word', 'Look at each picture and circle the word for its shape.', 2],
    6: ['2D shapes and their names', 'Draw a line to connect each shape with its name.', 2],
    7: ['Which one is different?', 'Look at the objects in each row and colour the one with a different shape.', 2],
    8: ['Circle the shape name', 'Look at each shape and circle its correct name.', 2],
    9: ['Count the shapes', 'Count the shapes in each row and write the number in the box.', 2],
    10: ['Cut and paste', 'Cut out the objects and paste each one under the shape it matches.', 1] } },
  /* Sizes (Oct 15, Sumit's Sizes zip "Big and Small 1-10"): every sheet has an answers page */
  vz: { name: 'Sizes', topic: 'vocab-sizes', folder: 'vocab-sizes', file: 'sizes', sheets: {
    1: ['Tick the bigger one', 'Look at each pair of pictures and tick the one that is bigger.', 2],
    2: ['Which is bigger?', 'Tick the bigger object in each pair: watermelons, clocks, elephants and more.', 2],
    3: ['Tick the smaller one', 'Look at each pair of pictures and tick the one that is smaller.', 2],
    4: ['Which is smaller?', 'Tick the smaller object in each pair: umbrellas, cups, hats and more.', 2],
    5: ['Circle the biggest animal', 'Look at each row of animals and circle the biggest one.', 2],
    6: ['Circle the smallest object', 'Look at each row and circle the smallest object.', 2],
    7: ['B or S: animals', 'Look at each pair of animals. Write B for the bigger animal and S for the smaller one.', 2],
    8: ['B or S: food', 'Write B for the bigger picture and S for the smaller picture.', 2],
    9: ['Circle big or small', 'Look at each picture and circle big or small.', 2],
    10: ['Big or small?', 'Look at each picture, from a basket to a hippo, and circle big or small.', 2] } },
  va: { name: 'Animals', topic: 'vocab-animals', folder: 'vocab-animals', file: 'animals', sheets: {
    1: ["Name the farm animals", "Use the word bank to name the hen, horse, sheep, buffalo, goat and cow.", 2],
    2: ["More farm animals", "Use the word bank to name the pig, rabbit, donkey, turkey, duck and camel.", 2],
    3: ["Name the pet animals", "Use the word bank to name the cat, hamster, fish, rabbit, dog and parrot.", 2],
    4: ["More pet animals", "Use the word bank to name the gecko, hamster, turtle, rat, canary and goldfish.", 2],
    5: ["Choose the wild animal name", "Look at each wild animal picture and choose the correct name.", 2],
    6: ["Match the wild animals", "Match each wild animal picture to its correct name.", 2],
    7: ["Under the sea", "Circle the animals that live under the sea.", 2],
    8: ["Match the sea animals", "Draw a line from each sea animal to its name.", 2],
    9: ["Animals that can fly", "Circle the animals that can fly.", 2],
    10: ["Match the birds", "Match each bird picture to its correct name.", 2]
  } },
};
const lowerFirst = t => /^(I |2D|B )/.test(t) ? t : t[0].toLowerCase() + t.slice(1);   /* "I spy", "2D" and "B or S" keep their capitals */
export const vocabItem = (set, n) => keepSheet(set + '-' + n, () => { const v = VOCAB[set], s = v.sheets[n], id = set + '-' + n, price = sheetPrice(id);
  return ({ id, chart: true, tileName: v.name + ' ' + n, tileSub: s[0], cls: 'kg', subject: 'English', subjectId: 'english', title: v.name + ' ' + n + ' — ' + lowerFirst(s[0]), pages: s[2], price, free: price === 0, real: true, img: '/sheets/' + v.folder + '/thumb/' + v.file + '-' + n + '.jpg', topic: v.topic,
  blurb: s[1], about: [s[1], s[2] === 2 ? 'Two A4 pages: the sheet, then the same sheet with the answers filled in.' : 'One A4 page.', 'Opens full screen in the protected viewer.', accessLine(price)] }); });
/* Every printable PDF joins the catalogue, so "All sheets" and the store's filters
   show the whole shelf — the letter, colour, matching and reading pages as well as the books. */
export const PDF_SHEETS = [].concat(AZ_LETTERS.map(azItem), RC_LETTERS.map(rcItem), CL_LETTERS.map(clItem),
  MT_RANGES.map(r => mtItem(r[0])), MT_RANGES.map(r => spItem(r[0])),
  SOUND_EXERCISES.map(bxItem), SD_LETTERS.map(sdItem), SOUND_EXERCISES.map(exItem), MS_CODES.map(msItem),
  VOCAB_NUMBERS.map(n => vocabItem('vc', n)), VOCAB_NUMBERS.map(n => vocabItem('vs', n)), VOCAB_NUMBERS.map(n => vocabItem('vz', n)), VOCAB_NUMBERS.map(n => vocabItem('va', n)));
PDF_SHEETS.forEach(it => { it.pdf = true; if (!itemById(it.id)) ITEMS.push(it); });
/* any sheet by id: the printable PDFs are built on demand, everything else is in ITEMS */
const vocabOf = id => { const m = /^(vc|vs|vz|va)-(\d+)$/.exec(id || ''); return m && VOCAB_NUMBERS.includes(+m[2]) ? vocabItem(m[1], +m[2]) : undefined; };
const sheetOfRaw = id => /^v[csza]-/.test(id || '') ? vocabOf(id) : id && id.startsWith('ms-') ? (MS_CODES.includes(id.slice(3)) ? msItem(id.slice(3)) : undefined) : id && id.startsWith('sd-') ? sdItem(id.slice(3)) : id && id.startsWith('bx-') ? bxItem(+id.slice(3)) : id && id.startsWith('ex-') ? exItem(+id.slice(3)) : id && id.startsWith('az-') ? azItem(id.slice(3)) : id && id.startsWith('rc-') ? rcItem(id.slice(3)) : id && id.startsWith('cl-') ? clItem(id.slice(3)) : id && id.startsWith('mt-') ? mtItem(id.slice(3)) : id && id.startsWith('sp-') ? spItem(id.slice(3)) : itemById(id);
/* an id the catalogue cannot build (e.g. bx-9 from an old entitlement) is simply unknown, never a crash */
export const sheetOf = id => { try { const known = itemById(id); return known && known.dynamic ? known : sheetOfRaw(id); } catch (_) { return undefined; } };

/* ---------- the store: views and skill groups ---------- */
/* only sheets with a real PDF are listed: the Colours and Shapes sheets are the newest, then the missing-letter and sound sheets; the A to Z set the favourites */
export const NEW_IDS = [...VOCAB_NUMBERS.map(n => 'va-' + n), ...VOCAB_NUMBERS.map(n => 'vc-' + n), ...VOCAB_NUMBERS.map(n => 'vs-' + n), ...VOCAB_NUMBERS.map(n => 'vz-' + n), 'ms-U1', 'ms-U2', 'ms-U3', 'ms-L1', 'ms-L2', 'ms-L3', 'bx-1', 'bx-2', 'bx-3', 'ex-1', 'ex-2', 'ex-3', 'sd-A', 'sd-B', 'sd-C', 'sd-D', 'sd-E'];
export const BEST_IDS = ['az-A', 'az-B', 'az-C', 'rc-A', 'cl-A', 'mt-' + MT_RANGES[0][0], 'sp-' + MT_RANGES[0][0]];
/* the four sheets in the Sheets chapter's preview carousel */
export const PLAYER_IDS = ['az-A', 'rc-A', 'cl-C', 'bx-1'];   /* the reading charts are A, I, N, P, S and T */
export const VIEWS = [
  { id: 'all', label: 'All sheets' }, { id: 'new', label: 'New', note: 'just drawn' }, { id: 'best', label: 'Bestselling', note: 'parents love these' },
  { id: 'featured', label: 'Featured', note: 'our picks', label_: true }, { id: 'popular', label: 'Popular', label_: true }, { id: 'recommended', label: 'Recommended', label_: true },
  { id: 'free', label: 'Free', note: 'try first' }, { id: 'paid', label: 'Paid', note: 'buy or subscribe' },
];
/* Product labels staff set in Admin → Products. They are tags on the product: the shop's New and
   Bestselling lists follow them once the server's catalogue is in (NEW_IDS and BEST_IDS until then);
   Featured, Popular and Recommended show in the shop only when a sheet has that label.
   'home' puts a sheet in the "Picked for you" row on the home page. */
export const LABELS = [['bestseller', 'Best Seller'], ['featured', 'Featured'], ['new', 'New Arrival'], ['popular', 'Popular'], ['recommended', 'Recommended']];
const VIEW_TAG = { new: 'new', best: 'bestseller', featured: 'featured', popular: 'popular', recommended: 'recommended' };
const tagsOf = it => (Array.isArray(it.tags) ? it.tags : []);
export const hasLabel = (it, tag) => (SERVER.ready ? tagsOf(it).includes(tag) : tag === 'new' ? NEW_IDS.includes(it.id) : tag === 'bestseller' ? BEST_IDS.includes(it.id) : false);
/* the sheets a Browse view lists (free and paid by price; the label views by label) */
export const inView = (vw, it) => vw === 'all' || (vw === 'free' && it.price === 0) || (vw === 'paid' && it.price > 0) || (VIEW_TAG[vw] ? hasLabel(it, VIEW_TAG[vw]) : false);
/* the label a card shows (one, the first that applies) */
const CARD_ORDER = ['new', 'bestseller', 'featured', 'popular', 'recommended'];
const CARD_TEXT = { new: 'New', bestseller: 'Bestseller', featured: 'Featured', popular: 'Popular', recommended: 'Recommended' };
export const LABEL_COLOUR = { new: '#3b5bdb', bestseller: '#b8862b', featured: '#8e44ad', popular: '#d9480f', recommended: '#2b8a3e' };
export const cardLabel = it => { const t = CARD_ORDER.find(x => hasLabel(it, x)); return t ? { tag: t, text: CARD_TEXT[t] } : null; };
/* "25% off" when staff set an original price above the selling price */
export const discountPct = it => (it.wasPrice && it.wasPrice > it.price ? Math.round((1 - it.price / it.wasPrice) * 100) : 0);
/* is this sheet in the shop now? (the server's list says; hidden, draft and scheduled sheets are not) */
export function isListed(it) { return !!it && !it.unlisted; }
/* the server's view of the catalogue beyond the sheets: its sections and which classes are open */
export const SERVER = { ready: false, sections: [], classStatus: {} };
/* the sheets on the home page ("Picked for you"): labelled 'home', in display order */
export const homeSheets = () => (SERVER.ready ? ITEMS.filter(it => it.pdf && isListed(it) && tagsOf(it).includes('home')).sort(byOrder) : []);
/* display order: the order staff set (Admin → Products), then the site's own order */
export const byOrder = (a, b) => (a.sort ?? 1e9) - (b.sort ?? 1e9);
/* the sections staff added in Admin → Categories, and the website's own topics outside Alphabet and
   Vocabulary, that have sheets: the shop lists them under "More sections" */
export const extraSections = () => SERVER.sections.filter(x => x.group !== 'alpha' && x.group !== 'vocab')
  .map(x => ({ ...x, list: topicSheets(x.id).filter(it => it.pdf) }))
  /* a website topic joins the list once staff put a sheet in it (its own sheets are shown elsewhere already) */
  .filter(x => x.list.length && (!x.builtin || x.list.some(it => it.dynamic || it.movedTo === x.id)));
/* the store's cards are the same seven Alphabet sections as the Kindergarten tiles (Sumit, Oct 5),
   each with the same sheets: a card's id is its section id */
const ALPHA_ITEMS = KG_TOPICS.find(g => g.id === 'alpha').items;
export const SKILL_CATEGORIES = ALPHA_ITEMS.map(([id, label, description]) => ({ id, label, description }));
export const SKILL_NAME = Object.fromEntries(SKILL_CATEGORIES.map(c => [c.id, c.label]));
/* the PDF sheets in a section (the Sound charts A to E sit in both Beginning and Ending Sounds) */
export const skillSheets = skill => topicSheets(skill).filter(it => it.pdf);
const countSkills = () => SKILL_CATEGORIES.forEach(c => { c.count = skillSheets(c.id).length; });
countSkills();

/* Prices are the server's alone (GET /api/worksheets and GET /api/config). Older builds let prices a staff
   member typed in their own browser (lww_prices, lww_plan_prices) change what that browser showed; they are
   ignored now. Kept so older callers still work. */
export function applyLocalPrices() {}
/* Older builds let the admin's book studio add, edit or hide products in that staff member's own browser
   (lww_products). The catalogue is the server's now (GET /api/worksheets), so that copy is ignored.
   Kept so older callers still work. */
export function applyAdminProducts() {}
/* THE SERVER IS THE SOURCE OF TRUTH — prices, page counts and which sheets have a real PDF
   come from GET /api/worksheets and override the built-in values. */
/* the sections a built-in sheet sits in by the site's own lists (TOPIC_SHEETS) */
const naturalTopics = it => { const pre = String(it.id).split('-')[0]; return Object.keys(TOPIC_SHEETS).filter(t => TOPIC_SHEETS[t].includes(pre) || TOPIC_SHEETS[t].includes(it.id)); };
const glyphOf = t => String(t || '?').replace(/[^A-Za-z0-9 ]/g, ' ').trim().split(/\s+/).slice(0, 2).map(w => w[0] || '').join('').toUpperCase() || '✎';
/* a sheet staff added in Admin → Products: the site builds its card from the server's fields */
function serverItem(w) {
  const subj = SUBJECTS.find(x => x.id === String(w.subject).toLowerCase() || x.label.toLowerCase() === String(w.subject).toLowerCase());
  return { id: w.id, cls: w.cls, kind: 'sheet', subject: w.subject, subjectId: subj ? subj.id : String(w.subject || '').toLowerCase(), title: w.title, glyph: glyphOf(w.title),
    pages: w.pages || 1, price: w.price, free: w.price === 0, real: !!w.real, pdf: true, dynamic: true, about: [] };
}
export function applyServerCatalogue(worksheets, extra) {
  const byId = {}; (worksheets || []).forEach(w => { byId[w.id] = w; });
  /* sheets added in Admin → Products join the shelf (a class the website does not draw is left out) */
  (worksheets || []).forEach(w => { if (!itemById(w.id) && CLASSES.some(c => c.id === w.cls)) { const it = serverItem(w); ITEMS.push(it); PDF_SHEETS.push(it); } });
  ITEMS.forEach(it => { const w = byId[it.id]; if (!w) return; it.price = w.price; it.real = w.real; if (w.pages) it.pages = w.pages;
    /* how long a purchase stays open, whether its PDF is ready, and how many copies come with it */
    if (w.accessDays) it.accessDays = w.accessDays;
    if (w.accessHours) it.accessHours = w.accessHours;
    it.available = w.available !== false && w.real !== false;
    it.onSale = w.onSale !== false;
    it.comingSoon = !!w.comingSoon;
    it.printLimit = Number(w.printLimit) || 0; it.downloadLimit = Number(w.downloadLimit) || 0;
    /* prints: 'account' = as many as the customer's account type gets (Parent 3, Teacher 30, Organization 300
       unless staff change them); 'sheet' = this sheet's own printLimit (0 = view only) */
    it.printRule = w.printRule === 'sheet' ? 'sheet' : 'account';
    /* the words the shop's search looks through */
    if (typeof w.description === 'string' && w.description.trim()) it.description = w.description;
    if (typeof w.sectionLabel === 'string' && w.sectionLabel.trim()) it.sectionLabel = w.sectionLabel;
    if (Array.isArray(w.tags)) it.tags = w.tags.filter(t => typeof t === 'string');
    /* labels, display order and the original price (Admin → Products) */
    it.sort = Number.isFinite(w.sort) ? w.sort : it.sort;
    it.wasPrice = w.wasPrice != null && w.wasPrice > w.price ? w.wasPrice : null;
    it.section = w.section || null;
    if (it.pdf) {
      /* the title, words and picture staff set; the site's own words stay when the server has none */
      if (typeof w.title === 'string' && w.title.trim()) it.title = w.title;
      if (typeof w.description === 'string' && w.description.trim()) it.blurb = w.description;
      if (typeof w.thumb === 'string' && w.thumb) it.img = w.thumb;
      if (typeof w.landscape === 'boolean') it.landscape = w.landscape;
      if (it.dynamic) { it.cls = w.cls; it.subject = w.subject; it.topic = w.section || null; }
      /* a built-in sheet staff put in another section moves there */
      else it.movedTo = w.section && !naturalTopics(it).includes(w.section) ? w.section : null;
    }
    /* the printable pages carry the free/paid line in their own words, so keep it in step */
    if (it.pdf) { it.free = it.price === 0;
      if (it.dynamic) it.about = [it.blurb, (it.pages === 1 ? 'One A4 page.' : it.pages + ' A4 pages.'), 'Opens full screen in the protected viewer.', accessLine(it.price, it)].filter(Boolean);
      else if (Array.isArray(it.about)) it.about[it.about.length - 1] = accessLine(it.price, it); } });
  (worksheets || []).forEach(w => { if (!itemById(w.id)) SERVER_PRICE[w.id] = w.price; });   /* letter tracing + picture reading */
  /* what the server does not list (a draft, hidden, scheduled or deleted sheet) leaves the website */
  if (worksheets && worksheets.length) ITEMS.forEach(it => { if (it.pdf) it.unlisted = !byId[it.id]; });
  /* labels and sections need the newer server (it sends sections); an older one keeps the built-in lists */
  SERVER.ready = !!(worksheets && worksheets.length && extra && Array.isArray(extra.sections));
  if (extra && Array.isArray(extra.sections)) SERVER.sections = extra.sections.slice().sort((a, b) => (a.sort - b.sort) || String(a.id).localeCompare(b.id));
  if (extra && Array.isArray(extra.classes)) SERVER.classStatus = Object.fromEntries(extra.classes.map(c => [c.id, c.status]));
  countSkills();
}
/* products edited in the admin's book studio */
export function removeItem(id) { [CATALOGUE, SHEETS, WORKSHEETS, ITEMS].forEach(a => { const i = a.findIndex(x => x.id === id); if (i >= 0) a.splice(i, 1); }); }
export function addItem(np) { CATALOGUE.push(np); ITEMS.push(np); }
export { CLASSES, SUBJECTS };
