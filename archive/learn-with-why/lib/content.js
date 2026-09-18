/* =====================================================================
   CONTENT — every word and every product on the site lives here.
   ===================================================================== */

export const BRAND = {
  name: 'Learn With Why',
  short: 'LWW',
  tagline: 'Printable sheets that make children ask why.',
  currency: '₹',
  licencePrefix: 'LW',   /* licence ids look like LW-105842 */
  email: 'hello@learnwithwhy.in',
  city: 'Pune, India',
};

/* Landing-page sections, in order. */
export const NAV = [
  { id: 'home', label: 'Home' },
  { id: 'sheets', label: 'Sheets' },
  { id: 'about', label: 'About us' },
  { id: 'contact', label: 'Contact us' },
  { id: 'testimonials', label: 'Testimonials' },
];

export const HERO = {
  badge: 'New: Class 2 science — Why does it float?',
  title: 'Learning that starts with why.',
  lede: 'Printable sheets for Nursery to Class 3 — alphabet, numbers, science and stories — drawn to make small hands practise and small minds ask questions. One sheet in every class is free.',
  primary: 'Browse the sheets',
  secondary: 'How it works',
  stats: [
    { value: '120+', label: 'Sheets' },
    { value: '5', label: 'Classes' },
    { value: '4.9', label: 'Parent rating' },
  ],
};

export const SHEETS_COPY = {
  eyebrow: 'The shelf',
  title: 'Pick a class. Pick a subject.',
  lede: 'Every class has a free sheet to try. The rest unlock when you buy them — they land in your Library, open inside the site, and print with your licence.',
  gallery: 'Spin the shelf — hover a cover, click to open it',
  all: 'All subjects',
  free: 'Free',
  locked: 'Unlock',
  open: 'Open free',
  inLibrary: 'In your Library',
  details: 'Details',
  empty: 'No sheets here yet — try another subject.',
  pages: n => n + ' pages',
};

export const CLASSES = [
  { id: 'nursery', label: 'Nursery', ages: 'Ages 3–4' },
  { id: 'kg', label: 'Kindergarten', ages: 'Ages 4–5' },
  { id: 'c1', label: 'Class 1', ages: 'Ages 5–6' },
  { id: 'c2', label: 'Class 2', ages: 'Ages 6–7' },
  { id: 'c3', label: 'Class 3', ages: 'Ages 7–8' },
];

/* hue drives every subject's colour (cards, covers, chips) */
export const SUBJECTS = [
  { id: 'english', label: 'English', hue: 36 },
  { id: 'maths', label: 'Maths', hue: 206 },
  { id: 'science', label: 'Science', hue: 150 },
  { id: 'evs', label: 'EVS', hue: 96 },
  { id: 'hindi', label: 'Hindi', hue: 350 },
  { id: 'art', label: 'Art & craft', hue: 282 },
];

/* price 0 = free access sheet */
export const SHEETS = [
  { id: 'nur-eng-abc', cls: 'nursery', subject: 'english', title: 'Alphabet tracing A–Z', glyph: 'Aa', pages: 26, price: 0, was: 99, blurb: 'Uppercase and lowercase with dotted guides and a picture cue for every letter.', skills: ['Pencil grip', 'Letter shapes', 'Phonics sounds'] },
  { id: 'nur-mat-num', cls: 'nursery', subject: 'maths', title: 'Numbers 1–10 with dots', glyph: '1·2·3', pages: 10, price: 49, was: null, blurb: 'Count the dots, trace the numeral, colour the ten-frame — one number per page.', skills: ['Counting', 'Number shapes', 'One-to-one matching'] },
  { id: 'nur-art-col', cls: 'nursery', subject: 'art', title: 'Colour the forest', glyph: '✿', pages: 8, price: 39, was: null, blurb: 'Fox, rabbit, mushrooms and a very tall tree — big shapes, thick lines, no fiddly bits.', skills: ['Colour names', 'Staying inside lines', 'Fine motor'] },
  { id: 'kg-eng-cvc', cls: 'kg', subject: 'english', title: 'CVC words: cat, hat, bat', glyph: 'c-a-t', pages: 12, price: 0, was: 79, blurb: 'Blend three sounds into a word, match it to a picture, write it once more.', skills: ['Blending', 'Reading first words', 'Spelling'] },
  { id: 'kg-mat-cnt', cls: 'kg', subject: 'maths', title: 'Count to 20', glyph: '20', pages: 14, price: 59, was: 89, blurb: 'Ten-frames, number lines and forest creatures to count, up to twenty.', skills: ['Counting to 20', 'Number line', 'More and fewer'] },
  { id: 'kg-evs-ani', cls: 'kg', subject: 'evs', title: 'Animals and their homes', glyph: '🐾', pages: 10, price: 49, was: null, blurb: 'Who lives in a burrow, a nest, a den? Match, draw and name the home.', skills: ['Living things', 'Habitats', 'Vocabulary'] },
  { id: 'kg-eng-rhy', cls: 'kg', subject: 'english', title: 'Rhyme time', glyph: 'hush', pages: 8, price: 39, was: null, blurb: 'Circle the words that rhyme, then make up one of your own for the fox to keep.', skills: ['Rhyme', 'Listening', 'Word play'] },
  { id: 'c1-eng-sen', cls: 'c1', subject: 'english', title: 'Build a sentence', glyph: 'The fox…', pages: 16, price: 79, was: 99, blurb: 'Who, does what, where — pick a card from each column and write the sentence it makes.', skills: ['Sentence structure', 'Capital letters', 'Full stops'] },
  { id: 'c1-mat-add', cls: 'c1', subject: 'maths', title: 'Addition to 20', glyph: '+', pages: 20, price: 0, was: 99, blurb: 'Pictures first, numerals second: add acorns, add books, add the fireflies over the stump.', skills: ['Addition facts', 'Number bonds', 'Word problems'] },
  { id: 'c1-mat-sub', cls: 'c1', subject: 'maths', title: 'Subtraction stories', glyph: '−', pages: 16, price: 79, was: null, blurb: 'Every page is a tiny story with something taken away — cross it out, count what is left.', skills: ['Subtraction', 'Counting back', 'Reading a problem'] },
  { id: 'c1-evs-pla', cls: 'c1', subject: 'evs', title: 'Plants around us', glyph: '🌱', pages: 12, price: 59, was: null, blurb: 'Roots, stem, leaves, flower: label the plant, then grow a bean in a cup and record it.', skills: ['Parts of a plant', 'Observation', 'Recording'] },
  { id: 'c1-hin-var', cls: 'c1', subject: 'hindi', title: 'Hindi varnamala tracing', glyph: 'क', pages: 20, price: 69, was: 89, blurb: 'Swar and vyanjan with dotted guides, a picture for each letter and a line to write it alone.', skills: ['Devanagari shapes', 'Letter sounds', 'Handwriting'] },
  { id: 'c2-eng-det', cls: 'c2', subject: 'english', title: 'Story Detective', glyph: '🔍', pages: 12, price: 0, was: 89, blurb: 'Read anything at all, then work like a detective: who wanted what, what got in the way, what changed.', skills: ['Comprehension', 'Cause and effect', 'Evidence from the text'] },
  { id: 'c2-mat-mul', cls: 'c2', subject: 'maths', title: 'Multiplication tables 2–10', glyph: '×', pages: 24, price: 99, was: 129, blurb: 'Arrays, skip-counting and a table a day — with a progress chart at the back.', skills: ['Times tables', 'Arrays', 'Skip counting'] },
  { id: 'c2-sci-why', cls: 'c2', subject: 'science', title: 'Why does it float?', glyph: '?', pages: 14, price: 89, was: null, blurb: 'Seven kitchen experiments. Guess first, test second, write down what surprised you.', skills: ['Prediction', 'Fair testing', 'Recording results'] },
  { id: 'c2-hin-mat', cls: 'c2', subject: 'hindi', title: 'Hindi matras', glyph: 'की', pages: 18, price: 69, was: null, blurb: 'Every matra with words to read, trace and sort — from aa to au.', skills: ['Matras', 'Reading words', 'Spelling'] },
  { id: 'c2-eng-end', cls: 'c2', subject: 'english', title: 'Imagine a Different Ending', glyph: '…', pages: 10, price: 79, was: null, blurb: 'Take a story you know and turn one decision the other way. Endings are choices somebody made.', skills: ['Creative writing', 'Character motive', 'Sequencing'] },
  { id: 'c3-eng-adv', cls: 'c3', subject: 'english', title: "Fox and Rabbit's Word Adventure", glyph: 'moss', pages: 12, price: 0, was: 79, blurb: 'A forest-flavoured vocabulary walk: sort, rhyme and build sentences from words gathered along the way.', skills: ['Vocabulary', 'Rhyme', 'Sentence building'] },
  { id: 'c3-mat-fra', cls: 'c3', subject: 'maths', title: 'Fractions with pizza', glyph: '½', pages: 18, price: 99, was: 129, blurb: 'Halves, quarters and thirds you can colour, cut and share — then compare who got more.', skills: ['Fractions', 'Equal parts', 'Comparing'] },
  { id: 'c3-sci-wal', cls: 'c3', subject: 'science', title: 'A Forest Walk Full of Why', glyph: '🌲', pages: 8, price: 59, was: null, blurb: 'A take-outdoors observation sheet. Notice five things, ask a why about each, guess before you look it up.', skills: ['Observation', 'Asking questions', 'Nature study'] },
  { id: 'c3-mat-tim', cls: 'c3', subject: 'maths', title: 'Telling the time', glyph: '⏰', pages: 14, price: 89, was: null, blurb: "O'clock, half past, quarter past and to — draw the hands, read the clock, plan a fox's day.", skills: ['Analogue time', 'Quarter hours', 'Sequencing a day'] },
  { id: 'c3-art-pat', cls: 'c3', subject: 'art', title: 'Patterns and symmetry', glyph: '◐', pages: 12, price: 59, was: null, blurb: 'Finish the other half of the butterfly, continue the pattern, invent one the rabbit could copy.', skills: ['Symmetry', 'Repeating patterns', 'Precision'] },
];

/* ---------- Licences (allowances are configuration, not code) ---------- */
export const LICENCES = [
  { id: 'individual', label: 'Individual', copies: 1, factor: 1 },
  { id: 'family', label: 'Family', copies: 3, factor: 2 },
  { id: 'tutor', label: 'Tutor', copies: 10, factor: 4 },
  { id: 'teacher', label: 'Teacher', copies: 30, factor: 8 },
  { id: 'classroom', label: 'Classroom', copies: 60, factor: 12 },
  { id: 'school', label: 'School', copies: 120, factor: 20 },
];

export const DETAIL = {
  back: 'Back to the shelf',
  eyebrow: 'Sheet',
  free: 'Free access sheet',
  what: "What's inside",
  skills: 'Skills practised',
  preview: 'Preview',
  licence: 'Licence',
  payNow: 'Pay now',
  addToBag: 'Add to bag',
  openFree: 'Open free in your Library',
  inLibrary: 'Open in your Library',
  note: 'Pay once. The sheet lands in your Library, opens inside the site and prints with your licence — no PDF to lose.',
  copies: n => (n === 1 ? '1 printed copy' : n + ' printed copies'),
  related: 'More from this class',
};

export const ABOUT = {
  eyebrow: 'About us',
  title: 'A fox, a rabbit and one very old tree.',
  lede: 'Learn With Why is a small studio in Pune drawing calm, ink-light sheets for children aged three to eight. Every page is tested in a real classroom before it reaches the shelf.',
  why: { title: 'Why we started', text: 'We kept printing worksheets that were loud, cluttered and full of clip art. So we drew our own: one idea per page, generous white space, and a question at the bottom that starts with why.' },
  how: { title: 'How it works', text: 'Pick a class, pick a subject, try the free sheet. Buy the ones you want and they live in your Library — open them here, print them with your licence, keep them forever.' },
  ticks: ['Designed with teachers, not stock templates', 'Ink-friendly — a full pack costs pennies to print', 'One purchase, unlimited home printing within your licence'],
  stats: [
    { value: '2019', label: 'Founded' },
    { value: '310', label: 'Classrooms' },
    { value: '18', label: 'Countries' },
  ],
};

export const TESTIMONIALS = {
  eyebrow: 'Testimonials',
  title: 'Loved at kitchen tables.',
  lede: '4.9 out of 5 across 1,840 reviews from parents, teachers and a few very determined four-year-olds.',
  quotes: [
    { initials: 'RS', name: 'Ritika S.', meta: 'Mum of a 4-year-old · Pune', text: 'My daughter asks for “her sheets” before breakfast now. The letters are big and clean, so she can actually stay inside the lines.' },
    { initials: 'AK', name: 'Arjun K.', meta: 'Class 2 teacher · Bengaluru', text: 'I print the multiplication pack for twenty-two children every week. Ink-light, no clutter, and homework actually comes back done.' },
    { initials: 'MF', name: 'Maria F.', meta: 'Homeschooling two · Lisbon', text: 'We bought the fractions sheets on a Sunday and were printing them ten minutes later. One page a day fits our routine without a fight.' },
    { initials: 'NP', name: 'Neha P.', meta: 'Dad of twins · Mumbai', text: 'The free sheet convinced us. Two weeks later we own the whole Class 1 shelf and the twins race to the printer.' },
  ],
};

export const CONTACT = {
  eyebrow: 'Contact us',
  title: 'Tell us what you need.',
  lede: 'A pack question, a bulk order for a school, a sheet you wish existed — we reply within one working day.',
  name: 'Your name',
  email: 'you@email.com',
  message: 'A pack question, a bulk order, a printable you wish existed…',
  submit: 'Send message',
  success: 'Thanks — we will reply within one working day. (Demo form: nothing is sent.)',
  errors: { name: 'Your name, please.', email: 'Enter a valid email address.', message: 'A little more detail helps us reply.' },
  lines: [
    { label: 'Email', text: BRAND.email, href: 'mailto:' + BRAND.email },
    { label: 'Support hours', text: 'Mon – Sat, 10:00 – 18:00 IST' },
    { label: 'Schools & bulk', text: 'schools@learnwithwhy.in', href: 'mailto:schools@learnwithwhy.in' },
    { label: 'Studio', text: BRAND.city },
  ],
};

export const FOOTER = {
  tagline: 'Printable sheets for little hands, drawn in Pune.',
};

/* ---------- Bag ---------- */
export const CART = {
  title: 'Your bag',
  empty: 'Your bag is empty. Unlock a sheet and it shows up here.',
  browse: 'Browse sheets',
  add: 'Add to bag',
  added: 'Added ✓',
  addedToast: 'Added to your bag',
  licence: 'Licence',
  total: 'Total',
  checkout: 'Pay now — demo',
  note: 'Demo checkout: no payment is taken. Sheets land in your Library.',
  ordered: 'Order placed — your sheets are in your Library',
  signInToCheckout: 'Sign in to pay — your bag is saved.',
};

/* ---------- Auth ---------- */
export const AUTH = {
  signin: { title: 'Sign in', sub: 'Use the email you bought your sheets with.', submit: 'Sign in', switchText: 'New here?', switchLink: 'Create an account', forgot: 'Forgot password?' },
  signup: { title: 'Create an account', sub: 'Your free sheets and purchases are kept in your Library.', name: 'Parent name', kid: "Child's class", submit: 'Create account', switchText: 'Already have an account?', switchLink: 'Sign in' },
  forgot: { title: 'Forgot password', sub: 'We will send a six-digit code to your email.', submit: 'Send reset code', code: 'Reset code', demo: 'Demo code:', newTitle: 'Create new password', newSubmit: 'Save new password', back: 'Back to sign in' },
  messages: {
    signinFail: 'We could not match that email and password. New here? Create an account instead.',
    signinWelcome: 'Signed in — welcome back, ',
    guest: 'Browsing as a guest',
    accountCreated: 'Account created — your free sheets are waiting in the Library',
    emailTaken: 'That email already has an account. Sign in instead.',
    noAccount: 'No account uses that email. Create one instead.',
    accountGone: 'That account no longer exists.',
    passwordUpdated: 'Password updated. Sign in with your new password.',
    signedOut: 'Signed out. See you soon.',
    badEmail: 'Enter a valid email address.',
    needPassword: 'Enter your password.',
    needName: 'Tell us your name.',
    shortPassword: 'At least 8 characters.',
    weakPassword: 'Add a capital letter and a number.',
    badCode: 'That code does not match.',
    confirmEmail: 'Account created — check your inbox to confirm your email, then sign in.',
  },
};

/* ---------- Library ---------- */
export const LIBRARY = {
  nav: 'My Library',
  eyebrow: 'My Library',
  title: 'Your shelf.',
  lede: 'Everything you own, ready to open and print inside Learn With Why. Each print uses one copy of your licence; once the copies are used, the sheet stays here as a record of your purchase.',
  guestTitle: 'Sign in to see your shelf.',
  guestText: 'Free sheets and purchases are kept in your Library. Sign in and they will be waiting.',
  signIn: 'Sign in',
  empty: 'Nothing here yet. Try a free sheet or unlock one — they land here after checkout.',
  browse: 'Browse sheets',
  purchased: 'Purchased',
  licence: 'Licence',
  access: 'Access',
  active: 'Active',
  locked: 'Locked',
  allowance: 'Printing allowance',
  remaining: 'Copies remaining',
  copies: n => (n === 1 ? '1 copy' : n + ' copies'),
  open: 'Open sheet',
  print: 'Print',
  usedNote: 'Licence used — this sheet stays here as a record of your purchase.',
  claimToast: ' is in your Library',
  signInToClaim: 'Sign in to open your free sheet — it will be in your Library when you are back.',
  lockedToast: 'This licence has been used. Buy a new licence to print again.',
  confirm: {
    title: 'Print this sheet?',
    allows: n => 'Your licence allows ' + (n === 1 ? '1 printed copy.' : n + ' printed copies.'),
    last: 'After printing, this sheet will be locked in your Library and you will no longer be able to open or print it.',
    more: n => 'After this print you will have ' + (n === 1 ? '1 copy' : n + ' copies') + ' left.',
    cancel: 'Cancel',
    go: 'Print 1 copy',
  },
  reader: { page: 'Page', of: 'of', close: 'Close', prev: 'Previous page', next: 'Next page', note: 'Protected viewer · no download' },
  watermark: 'Licensed copy',
  drm: {
    title: 'Protected copy',
    text: 'This sheet is protected with VeryPDF DRM. Open it in the secure reader with the logon below — printing is counted there and stops when your copies are used.',
    user: 'Reader logon',
    password: 'Reader password',
    enforced: 'enforced by the secure reader',
    open: 'Open in secure reader',
    reader: 'Get VeryPDF DRM Reader',
    readerHref: 'https://drm.verypdf.com/downloads/',
    pending: 'Preparing your protected copy — this takes a moment.',
    failed: 'We could not prepare the protected copy. Try again or contact us.',
    retry: 'Try again',
  },
};

export const UI = {
  menu: 'Menu',
  library: 'My Library',
  bag: 'Bag',
  signIn: 'Sign in',
  signOut: 'Sign out',
  loading: 'Opening the forest',
};

/* ---------- lookups ---------- */
export const sheetById = id => SHEETS.find(s => s.id === id);
export const classById = id => CLASSES.find(c => c.id === id);
export const subjectById = id => SUBJECTS.find(s => s.id === id);
export const money = n => BRAND.currency + n;
export const isFree = s => s.price === 0;
