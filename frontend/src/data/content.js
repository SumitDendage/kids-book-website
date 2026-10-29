/* Everything the customer reads — moved from the top of the page script in
   legacy/old-static-site/index.html. Edit copy, categories and questions here. */

export const BRAND = 'Learn With Why';
export const SITE_VERSION = '2026.09.17';
export const INBOX = 'learnwithwhy6@gmail.com';
/* WhatsApp chat link: wa.me needs the full number with the country code (91 for India), no + or spaces */
export const WHATSAPP = 'https://wa.me/919822287983';
export const INSTAGRAM = 'https://www.instagram.com/learnwithwhy_01';
/* Web3Forms sends each "Leave a little note" to the email this key was made with (Sumit's new key, Oct 16). The key
   is meant to sit in the page: it can only send notes to that one inbox. */
export const WEB3FORMS_KEY = '5b22ccce-85d2-48af-82e1-6523e1b2bd87';

export const NAV = ['Home', 'About us', 'What we do', 'Worksheets', 'Contact us', 'Reviews', 'Testimonials'];
/* the chapter anchors: /#home, /#about, … /#testimonials */
export const IDS = ['home', 'about', 'what-we-do', 'sheets', 'contact', 'reviews', 'testimonials'];

/* The account type, asked once after the first sign-in (Sumit, 15 Oct): Parent, Teacher or
   Organization. id is what the server keeps (profiles.role): Organization is stored as 'school',
   and an older 'tutor' account counts as a Teacher. key names its prints in GET /api/config
   (prints: { parent, teacher, organization }), which staff change in Admin → Settings. */
export const ACCOUNT_TYPES = [
  { id: 'parent', key: 'parent', label: 'Parent', plural: 'Parents', hint: 'At home, for my own children', licence: 'individual' },
  { id: 'teacher', key: 'teacher', label: 'Teacher', plural: 'Teachers', hint: 'For my class or my students', licence: 'teacher' },
  { id: 'school', key: 'organization', label: 'Organization', plural: 'Organizations', hint: 'A school, tuition centre or other group', licence: 'school' },
];
/* the type a stored role belongs to, or null while the customer has not chosen yet */
export const accountTypeOf = role => (role === 'school' ? ACCOUNT_TYPES[2] : role === 'teacher' || role === 'tutor' ? ACCOUNT_TYPES[1] : role === 'parent' ? ACCOUNT_TYPES[0] : null);
/* prints per sheet for each type until GET /api/config answers (the server's numbers win) */
export const DEFAULT_PRINTS = { parent: 2, teacher: 3, organization: 300 };
export function printsTableOf(config) {
  const p = config && config.prints && typeof config.prints === 'object' ? config.prints : {};
  const n = (v, d) => (Number.isInteger(v) && v >= 0 ? v : d);
  return { parent: n(p.parent, DEFAULT_PRINTS.parent), teacher: n(p.teacher, DEFAULT_PRINTS.teacher), organization: n(p.organization, DEFAULT_PRINTS.organization) };
}
/* "3 prints", "1 print", "No prints" */
export const printsText = n => (n === 0 ? 'No prints' : n + (n === 1 ? ' print' : ' prints'));
/* kept for older callers: the account types under their old name */
export const ROLES = ACCOUNT_TYPES;
export const roleOf = id => accountTypeOf(id) || ACCOUNT_TYPES[0];
/* Subscriptions: pay for one class for a period, open every sheet in it while it runs.
   THE SERVER SETS THE PLANS: GET /api/config answers with each plan's name, months, price,
   discount and the countries it is sold in, and applyServerPlans() copies that in here.
   The list below only names the plans until that answer arrives; prices shown to customers
   come from the server's answer (services/checkout.js serverPlans). */
export const PLANS = [
  { id: 'm1', label: '1 month', months: 1, price: 199, regions: ['IN', 'INTL'] },
  { id: 'm3', label: '3 months', months: 3, price: 499, note: 'save 16%', regions: ['IN', 'INTL'] },
  { id: 'm6', label: '6 months', months: 6, price: 899, note: 'save 25%', regions: ['IN', 'INTL'] },
  { id: 'y1', label: '12 months', months: 12, price: 1499, note: 'best value', regions: ['INTL'] },
];
export const planOf = id => PLANS.find(x => x.id === id) || PLANS[0];
/* How long a bought sheet stays open. The server sends accessHours (1 unless staff change it) and,
   for older readers, accessDays rounded up. "24 hours", "1 hour", "3 days" (days only when the hours
   make whole days of two or more), as the server words it. */
export const DEFAULT_ACCESS_HOURS = 1;
export const spanText = hours => { const h = Math.round(Number(hours)) || DEFAULT_ACCESS_HOURS; return h >= 48 && h % 24 === 0 ? h / 24 + ' days' : h + (h === 1 ? ' hour' : ' hours'); };
/* hours from anything that carries accessHours / accessDays (a sheet, a quote line, the config) */
export const hoursOf = x => { if (!x || typeof x !== 'object') return 0; const h = Number(x.accessHours); if (h > 0) return Math.round(h); const d = Number(x.accessDays); return d > 0 ? Math.round(d * 24) : 0; };
/* accessSpan(sheet | config | line) — or a number of days, as older callers pass */
export const accessSpan = x => spanText(x && typeof x === 'object' ? hoursOf(x) : Number(x) > 0 ? Number(x) * 24 : 0);
/* India buys 1, 3 or 6 months; every other country also 12 months (the server decides where each plan is sold) */
export const plansFor = country => PLANS.filter(x => (Array.isArray(x.regions) ? x.regions.includes(country === 'IN' ? 'IN' : 'INTL') : (country !== 'IN' || x.id !== 'y1')));
/* the plans from GET /api/config, in the server's order (the objects are updated in place) */
export function applyServerPlans(config) {
  const src = config && config.plans;
  if (!src || typeof src !== 'object') return false;
  const ids = Object.keys(src);
  if (!ids.length) return false;
  const next = ids.map(id => {
    const p = src[id] || {}, x = PLANS.find(y => y.id === id) || { id };
    return Object.assign(x, { label: p.label || x.label || id, months: Number(p.months) || x.months || 1, price: Number(p.price) || 0, note: p.note || undefined, regions: Array.isArray(p.regions) ? p.regions : x.regions, discountPct: Number(p.discountPct) || 0 });
  });
  PLANS.splice(0, PLANS.length, ...next);
  return true;
}
/* ---------- the shelf: classes × subjects (price 0 = free access sheet) ---------- */
export const CLASSES = [
  { id: 'kg', label: 'Kindergarten' },
  { id: 'c1', label: 'Class 1' },
  { id: 'c2', label: 'Class 2' },
  { id: 'c3', label: 'Class 3' },
];
export const SUBJECTS = [
  { id: 'english', label: 'English' }, { id: 'maths', label: 'Maths' }, { id: 'science', label: 'Science' },
];
export const classById = id => CLASSES.find(c => c.id === id);
export const subjectById = id => SUBJECTS.find(x => x.id === id);
/* Real words from real customers — sent to us on WhatsApp and Instagram after their books arrived. */
export const QUOTES = [
  { text: "I bought my alphabet book & CVC book from Learn With Why. It's very useful for the kids who are all studying alphabet letters and phonics sounds. A must-try book for phonics learners. Thanks to the team.", who: 'Risvana', meta: 'Chennai · Alphabet & CVC books', initials: 'R' },
  { text: 'I absolutely love these books! The Alphabet Book is fantastic for toddlers, and the CVC book is a great tool for beginners starting their phonics journey. Overall, they are incredibly well-designed. Thank you so much!', who: 'Akanksha Kagilkar', meta: 'Borivali, Mumbai · Alphabet & CVC books', initials: 'A' },
  { text: 'Just got some amazing phonics books! Simple, engaging, and perfect for helping kids improve reading and pronunciation skills step by step. Highly recommended for young learners!', who: 'Abu Academy', meta: 'School · Phonics books', initials: 'AA' },
  { text: 'Fantastic workbook for practicing digraphs! My daughter loves the bright illustrations and engaging activities like matching and fill-ups. The book introduces digraphs in a very logical, step-by-step order. I definitely recommend this for early readers!', who: 'Priyanka Rawat', meta: 'Parent · Digraph book', initials: 'P' },
  { text: 'The Digraph Book is truly wonderful! The concepts are explained in such a simple and engaging way that my child is not only understanding the sounds clearly but also genuinely enjoying the learning process. Thanks!!', who: 'Nikita Mahatma', meta: 'Parent · Digraph book', initials: 'N' },
  { text: 'All 3 levels of the phonics books were very good. I really liked the books, and they are very useful for my 5-year-old child. The content is simple, engaging, and easy for kids to understand. My child is enjoying learning and showing great improvement.', who: 'Priyanka Solanki', meta: 'Parent · Phonics levels 1–3', initials: 'P' },
  { text: 'The content of the book is really great for kids, especially helpful for both homemakers and working women to teach their kids easily. I also appreciate your coordination and support.', who: 'Sakshi Sood', meta: 'Parent · Digraph book', initials: 'S' },
  { text: 'An excellent book! The information is well organized and easy to follow. The content is clear and helpful. I really enjoyed reading it.', who: 'Sitara Sunjuna', meta: 'Parent', initials: 'S' },
  { text: "Thank you to the Learn With Why team for the book! It's really helpful for young learners who are just starting out. The book covers vowels and reading exercises, and the font size is nice and big, making it easy for kids to read.", who: 'A happy parent', meta: 'Instagram · Vowels & reading', initials: 'H' },
  { text: 'I liked the content of the book very much. Specific and learner friendly. I will be referring your book, and ordering more books as per the number of students for phonics level 1.', who: 'A teacher', meta: 'School order · Phonics level 1', initials: 'T' },
  { text: 'I ordered all the three booklets. They are amazing for my daughter. I really like your concept. Looking forward to buying more as you said you are going to release more books.', who: 'A happy parent', meta: 'Instagram · Phonics booklets', initials: 'H' },
  { text: 'Your materials are amazing. It is a great help for me and my students.', who: 'Jessica', meta: 'Teacher', initials: 'J' },
  { text: 'It is really very good books. My kid really loves it. These books help my child learn in a better way.', who: 'Kawal Preet', meta: 'Parent', initials: 'K' },
  { text: 'It is so nicely curated. As soon as we received it my son started doing it.', who: 'A happy parent', meta: 'WhatsApp', initials: 'H' },
  { text: 'My child enjoyed this story. My 8-month-old is interested to see these colourful pictures.', who: 'Dhivya Karthikeyan', meta: 'Parent · The Big Fish storybook', initials: 'D' },
  { text: 'This book is very easy to teach my daughter. Thank you.', who: 'Soni', meta: 'Parent', initials: 'S' },
];
/* the short thank-yous scroll past underneath */
export const THANKS = ['Books bhut aachi hai apki 💛 — Sanvi Gahlyan', 'Yes, very helpful for this book. Thank you ❤️ — Ikbal', 'Thank you so much for the amazing book 👍 — Divya Sharma', 'This is awesome 💯 children will enjoy reading — Rebecca', 'Received. The book is really good! Thank you — Jaya', 'Do you have grammar books? — Abu Academy', 'It will be great help for classes — a teacher', 'Thanks a lot ❤️ — Risvana'];
/* a new little question every few seconds — the kind children ask */
export const WHYS = ['Why do foxes have such fluffy tails?', 'Why is the sky blue and not green?', 'Why do leaves change colour?', 'Why does the moon follow us home?', 'Why do rabbits have long ears?', 'Why does bread rise?', 'Why do we have to sleep?', 'Why is the sea salty?'];
/* the first screen's lines (the admin's Content section can replace them) */
export const HERO = {
  badge: 'Big curiosity starts with little questions',
  titleHtml: 'Little learners. <em>Big discoveries.</em>',
  lede: 'Turn curious moments into confident learning. Explore playful, printable phonics, alphabet, maths and activity worksheets for Kindergarten to Class 3 — made for parents, teachers and little minds that love to ask why.',
};
