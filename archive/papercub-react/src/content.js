/* =====================================================================
   CONTENT — every word on the site lives here.
   Edit this file to change copy, products, testimonials or contact
   details; the components only render what they find in these objects.
   ===================================================================== */

export const BRAND = {
  name: 'Papercub',
  currency: '₹',
  licencePrefix: 'LW',   /* licence ids look like LW-105842 (developer brief §6) */
};

/* Landing-page header, in order. Index = chapter number (0-based). */
export const NAV = ['Home', 'What We Do', 'Sheets', 'Worksheets', 'About Us', 'Contact Us', 'Testimonials'];
export const CHAPTER = { home: 0, whatWeDo: 1, sheets: 2, worksheets: 3, about: 4, contact: 5, testimonials: 6 };

/* Loading animation shown after sign in / sign up, before the landing page. */
export const VEIL = {
  note: 'Preparing the landscape',
  error: 'Cannot read the animation frames — check that frames-webp sits in the public folder',
};

/* ---------- Authentication pages ---------- */
export const AUTH = {
  signin: {
    badge: '240+ printables inside',
    heading: 'Welcome back to the Papercub shelf.',
    text: 'Sign in to reach every alphabet sheet, number line and tracing worksheet you own — plus the freebie we add each week.',
    title: 'Sign in',
    sub: 'Use the email you bought your printables with.',
    submit: 'Sign in',
    remember: 'Keep me signed in',
    forgot: 'Forgot password?',
    switchText: 'New here?',
    switchLink: 'Create an account',
    guest: 'Just looking? Explore the store →',
    emailPlaceholder: 'parent@email.com',
  },
  signup: {
    badge: 'Free starter pack on sign up',
    heading: 'Make learning feel like play time.',
    text: 'Create an account and a 12-page alphabet tracing pack lands in your shelf straight away — no card needed.',
    title: 'Sign up',
    sub: 'Step 1 of 2 — tell us who the printables are for.',
    nameLabel: 'Parent name',
    namePlaceholder: 'Sumit',
    kidLabel: "Child's age",
    kidPlaceholder: '4',
    terms: 'I agree to the terms and the weekly freebie email.',
    submit: 'Continue to create account',
    switchText: 'Already have an account?',
    switchLink: 'Sign in',
  },
  password: {
    badge: 'Step 2 of 2',
    heading: 'Create a password you will remember.',
    text: 'Eight characters or more, with a number and a capital letter. Your shelf, orders and downloads sit behind it.',
    createTitle: 'Create account',
    createSub: 'Almost done — set the password for ',
    createSubmit: 'Create account',
    resetTitle: 'Create new password',
    resetSub: 'Pick a new password for ',
    resetSubmit: 'Save new password',
    hint: 'Use 8+ characters with a number and a capital letter.',
    strength: ['Use 8+ characters with a number and a capital letter.', 'Too weak — keep going.', 'Getting there.', 'Good password.', 'Strong password.'],
    back: 'Back to sign in',
  },
  forgot: {
    badge: 'Takes about a minute',
    heading: 'Forgot it? That happens.',
    text: 'Give us the email on the account and we will send a six-digit code. Enter it on the next step and pick a new password.',
    title: 'Forgot password',
    sub: 'We will send a reset code to your email.',
    submit: 'Send reset code',
    switchText: 'Remembered it?',
    switchLink: 'Sign in',
  },
  code: {
    badge: 'Check your inbox',
    heading: 'Enter the six-digit code.',
    text: 'The code expires in ten minutes. This is a front-end demo, so the code appears on screen instead of by email.',
    textOnline: 'We have emailed a six-digit code to that address. It expires in ten minutes.',
    title: "Verify it's you",
    sub: 'Sent to ',
    demo: 'Demo code:',
    submit: 'Verify code',
    back: 'Use a different email',
  },
  messages: {
    signinFail: 'We could not match that email and password. New here? Create an account instead.',
    signinWelcome: 'Signed in — welcome back, ',
    welcomeBack: 'Welcome back, ',
    guest: 'Browsing as a guest — sign in any time to save your bag',
    accountCreated: 'Account created — your starter pack is in the bag',
    emailTaken: 'That email already has an account. Sign in instead.',
    acceptTerms: 'Please accept the terms to continue.',
    noAccount: 'No account uses that email. Create one instead.',
    accountGone: 'That account no longer exists.',
    passwordUpdated: 'Password updated. Sign in with your new password.',
    signedOut: 'Signed out. See you soon.',
    confirmEmail: 'Account created — check your inbox to confirm your email, then sign in.',
    badEmail: 'Enter a valid email address.',
    needPassword: 'Enter your password.',
    needName: 'Tell us your name.',
    badAge: 'Age in years, e.g. 4.',
    shortPassword: 'At least 8 characters.',
    weakPassword: 'Add a capital letter and a number.',
    mismatch: 'Both passwords must match.',
    badCode: 'That code does not match.',
  },
};

/* ---------- Landing page chapters ---------- */
export const HOME = {
  badge: 'New: Colours & Shapes bundle',
  title: 'Printables that make little hands want to practise.',
  lede: 'Alphabet, numbers, colours and tracing — designed for ages 2 to 8, printed at home in a minute. Buy once, download forever, print as often as you like.',
  primary: { label: 'Browse sheets', go: CHAPTER.sheets },
  secondary: { label: 'See worksheets', go: CHAPTER.worksheets },
  stats: [
    { value: '240+', label: 'Printables' },
    { value: '12k', label: 'Families' },
    { value: '4.9', label: 'Avg rating' },
  ],
};

export const WHAT_WE_DO = {
  eyebrow: 'Chapter 02 — What we do',
  title: 'We turn big ideas into one calm page.',
  lede: 'Papercub designs, tests and delivers learning printables for children aged 2 to 8 — alphabet, numbers, colours, shapes and handwriting — so practice at home feels like play.',
  cards: [
    { mark: '✎', title: 'We design', text: 'Every sheet is drawn by hand around a single idea: one letter, one number, one shape. Generous white space, thick guide lines and letterforms small hands can copy.' },
    { mark: '✓', title: 'We test', text: 'Early-years teachers try each page in real classrooms before it reaches the shelf. If a four-year-old gets stuck, we redraw it.' },
    { mark: '⇩', title: 'We deliver', text: 'Pay once and the PDF lands in your shelf instantly. Print at home in A4 or US Letter, as many times as you like, for as long as you like.' },
  ],
  ticks: [
    'Sheets for daily five-minute practice, worksheets for week-by-week progress.',
    'Ink-friendly, black-and-white friendly, tablet friendly.',
    'A free printable added to every shelf each week.',
  ],
};

export const SHEETS = {
  eyebrow: 'Chapter 03 — Sheets',
  title: 'One page, one idea.',
  lede: 'Single-concept pages for daily practice. A4 and US Letter, black-and-white friendly, ready to print.',
};

export const WORKSHEETS = {
  eyebrow: 'Chapter 04 — Worksheets',
  title: 'Packs that build week by week.',
  lede: 'Phonics, early maths and handwriting, each with a parent guide in front and a progress chart at the back.',
};

export const ABOUT = {
  eyebrow: 'Chapter 05 — About us',
  title: 'A small studio, drawing calm pages.',
  why: {
    title: 'Why we started',
    text: 'We kept printing worksheets that were loud, cluttered and full of clip art. So we drew our own: one idea per page, generous white space, letterforms a four-year-old can copy. Early-years teachers tested every pack before it reached the shelf.',
    ticks: [
      'Designed with teachers, not stock templates.',
      'Ink-friendly layouts — a full pack costs pennies to print.',
      'One purchase, lifetime downloads, unlimited home printing.',
    ],
  },
  how: {
    title: 'How it works',
    text: 'Pick a sheet or a pack, pay once, and it lands in your shelf as a PDF. Print at home, at a copy shop, or hand it to a tablet — the files stay yours.',
    stats: [
      { value: '2019', label: 'Founded' },
      { value: '18', label: 'Countries' },
    ],
  },
};

export const CONTACT = {
  eyebrow: 'Chapter 06 — Contact us',
  title: 'Tell us what you need.',
  namePlaceholder: 'Your name',
  emailPlaceholder: 'you@email.com',
  messagePlaceholder: 'A pack question, a bulk order, a printable you wish existed…',
  submit: 'Send message',
  success: 'Thanks — we will reply within one working day. (Demo form: nothing is sent.)',
  errors: { name: 'Your name, please.', email: 'Enter a valid email address.', message: 'A little more detail helps us reply.' },
  lines: [
    { icon: '✉️', label: 'Email', text: 'hello@papercub.store', href: 'mailto:hello@papercub.store' },
    { icon: '💬', label: 'Support hours', text: 'Mon – Sat, 10:00 – 18:00 IST' },
    { icon: '🏫', label: 'Schools & bulk', text: 'schools@papercub.store', href: 'mailto:schools@papercub.store' },
    { icon: '📍', label: 'Studio', text: 'Pune, India' },
  ],
};

export const TESTIMONIALS = {
  eyebrow: 'Chapter 07 — Testimonials',
  title: 'Loved at kitchen tables.',
  lede: '4.9 out of 5 across 1,840 reviews from parents, teachers and a few very determined four-year-olds.',
  stats: [
    { value: '1,840', label: 'Reviews' },
    { value: '96%', label: 'Print again within a month' },
    { value: '310', label: 'Classrooms using packs' },
  ],
};

/* ---------- Catalogue ---------- */
export const PRODUCTS = [
  { id: 'sh-alpha', group: 'sheets', mark: 'Aa', title: 'Alphabet tracing sheets', desc: 'Uppercase and lowercase, dotted guides and a picture cue for every letter.', pages: '26 pages', price: 149, was: 199 },
  { id: 'sh-num', group: 'sheets', mark: '123', title: 'Number line sheets', desc: 'Count, trace and colour 1–20 with ten-frames and simple story prompts.', pages: '20 pages', price: 129, was: 169 },
  { id: 'sh-col', group: 'sheets', mark: '◑', title: 'Colours & shapes sheets', desc: 'Match, sort and name eight shapes and ten colours — ink-light layouts.', pages: '18 pages', price: 0, was: 139 },   /* price 0 = free title */
  { id: 'wk-phon', group: 'worksheets', mark: 'Ph', title: 'Phonics starter pack', desc: 'Six weeks of CVC blending, rhyme families and sound hunts with a parent guide.', pages: '48 pages', price: 199, was: 259 },
  { id: 'wk-math', group: 'worksheets', mark: '+−', title: 'Early maths workbook', desc: 'Addition to 20, patterns and measuring, one short page per school day.', pages: '40 pages', price: 179, was: null },
  { id: 'wk-hand', group: 'worksheets', mark: '✎', title: 'Handwriting practice', desc: 'Pencil grip warm-ups, letter families and a joined-writing bridge at the end.', pages: '36 pages', price: 159, was: 189 },
];

export const QUOTES = [
  { initials: 'RS', name: 'Ritika S.', meta: 'Mum of a 4-year-old · Pune', text: 'My daughter asks for “her sheets” before breakfast now. The letters are big and clean, so she can actually stay inside the lines.' },
  { initials: 'AK', name: 'Arjun K.', meta: 'Nursery teacher · Bengaluru', text: 'I print the phonics pack for twenty-two children every week. Ink-light, no clutter, and homework actually comes back done.' },
  { initials: 'MF', name: 'Maria F.', meta: 'Homeschooling two · Lisbon', text: 'We bought the maths workbook on a Sunday and were printing it ten minutes later. One page a day fits our routine without a fight.' },
];

/* ---------- Licences (brief §5) ----------
   Allowances and price factors are configuration an admin panel would edit;
   nothing else in the code knows these numbers. */
export const LICENCES = [
  { id: 'individual', label: 'Individual', copies: 1, factor: 1 },
  { id: 'family', label: 'Family', copies: 3, factor: 2 },
  { id: 'tutor', label: 'Tutor', copies: 10, factor: 4 },
  { id: 'teacher', label: 'Teacher', copies: 30, factor: 8 },
  { id: 'classroom', label: 'Classroom', copies: 60, factor: 12 },
  { id: 'school', label: 'School', copies: 120, factor: 20 },
];

/* ---------- Bag ---------- */
export const CART = {
  title: 'Your bag',
  empty: 'Your bag is empty. Add a sheet or a worksheet pack and it shows up here.',
  browse: 'Browse sheets',
  browseGo: CHAPTER.sheets,
  add: 'Add to bag',
  added: 'Added ✓',
  addedToast: 'Added to your bag',
  free: 'Free',
  claim: 'Get it free',
  inLibrary: 'In your Library',
  format: 'Print inside Papercub',
  licence: 'Licence',
  total: 'Total',
  checkout: 'Checkout — demo',
  note: 'Demo storefront: no payment is taken. Titles land in your Library.',
  ordered: 'Order placed — your titles are in your Library',
  signInToCheckout: 'Sign in to check out — your bag is saved.',
};

/* ---------- My Library (brief §2, §4, §7) ---------- */
export const LIBRARY = {
  nav: 'My Library',
  eyebrow: 'My Library',
  title: 'Your shelf.',
  lede: 'Everything you own, ready to open and print inside Papercub. Each print uses one copy of your licence; once the copies are used, the title stays here as a record of your purchase.',
  guestTitle: 'Sign in to see your shelf.',
  guestText: 'Free sheets and purchases are kept in your Library. Sign in and they will be waiting.',
  signIn: 'Sign in',
  empty: 'Nothing here yet. Claim the free sheet or add a pack to your bag — titles land here after checkout.',
  browse: 'Browse sheets',
  purchased: 'Purchased',
  licence: 'Licence',
  access: 'Access',
  active: 'Active',
  locked: 'Locked',
  allowance: 'Printing allowance',
  remaining: 'Copies remaining',
  copies: n => (n === 1 ? '1 copy' : n + ' copies'),
  open: 'Open book',
  print: 'Print',
  usedNote: 'Licence used — this title stays here as a record of your purchase.',
  claimToast: ' is in your Library',
  signInToClaim: 'Sign in to claim your free sheet — it will be in your Library when you are back.',
  lockedToast: 'This licence has been used. Buy a new licence to print again.',
  confirm: {
    title: 'Print this book?',
    allows: n => 'Your licence allows ' + (n === 1 ? '1 printed copy.' : n + ' printed copies.'),
    last: 'After printing, this book will be locked in your Library and you will no longer be able to open or print it.',
    more: n => 'After this print you will have ' + (n === 1 ? '1 copy' : n + ' copies') + ' left.',
    cancel: 'Cancel',
    go: 'Print 1 copy',
  },
  reader: { page: 'Page', of: 'of', close: 'Close', prev: 'Previous page', next: 'Next page', note: 'Protected viewer · no download' },
  watermark: 'Licensed copy',
  /* Titles protected by VeryPDF DRM Protector (online mode) */
  drm: {
    title: 'Protected copy',
    text: 'This title is protected with VeryPDF DRM. Open it in the secure reader with the logon below — printing is counted there and stops when your copies are used.',
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

/* ---------- Footer (closes the last chapter) ---------- */
export const FOOTER = {
  tagline: 'Learning printables for little hands, drawn in Pune.',
  email: 'hello@papercub.store',
  href: 'mailto:hello@papercub.store',
};

export const UI = {
  hint: 'Scroll to travel',
  menu: 'Menu',
  library: 'My Library',
  signIn: 'Sign in',
  signOut: 'Sign out',
};
