/* Everything the customer reads — moved from the top of the page script in
   legacy/old-static-site/index.html. Edit copy, categories and questions here. */

export const BRAND = 'Learn With Why';
export const SITE_VERSION = '2026.09.17';
export const INBOX = 'learnwithwhy6@gmail.com';
/* WhatsApp chat link: wa.me needs the full number with the country code (91 for India), no + or spaces */
export const WHATSAPP = 'https://wa.me/919822287983';

export const NAV = ['Home', 'About us', 'What we do', 'Sheets', 'Contact us', 'Testimonials'];
/* the chapter anchors: /#home, /#about, … /#testimonials */
export const IDS = ['home', 'about', 'what-we-do', 'sheets', 'contact', 'testimonials'];

/* who is signing up — sets the default licence */
export const ROLES = [
  { id: 'parent', label: 'Parent', licence: 'individual' },
  { id: 'teacher', label: 'Teacher', licence: 'teacher' },
  { id: 'tutor', label: 'Tutor', licence: 'tutor' },
  { id: 'school', label: 'School', licence: 'school' },
];
export const roleOf = id => ROLES.find(r => r.id === id) || ROLES[0];
/* Subscriptions: pay for one class for a period, open every sheet in it
   while it runs. Prices are per class; the admin can change them. */
export const PLANS = [
  { id: 'm1', label: '1 month', months: 1, price: 199 },
  { id: 'm3', label: '3 months', months: 3, price: 499, note: 'save 16%' },
  { id: 'm6', label: '6 months', months: 6, price: 899, note: 'save 25%' },
  { id: 'y1', label: '12 months', months: 12, price: 1499, note: 'best value' },
];
export const planOf = id => PLANS.find(x => x.id === id) || PLANS[0];
/* India buys 1, 3 or 6 months; every other country also 12 months (the server checks the same rule) */
export const plansFor = country => PLANS.filter(x => country !== 'IN' || x.id !== 'y1');
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
  badge: 'Small questions, extraordinary discoveries',
  titleHtml: 'Every great adventure begins with <em>why</em>.',
  lede: 'A little wonder for every learner. Beautiful printable activity sheets and playful worksheets from Kindergarten to Class 3 — for families, classrooms, and curious minds.',
};
