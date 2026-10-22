/* The AI assistant on the landing page: its name, its first message, and the short
   practice answers it gives when neither the FAQ list (data/faq.json) nor our server has an
   answer (see services/aiChat.js).
   Each answer lists the words that bring it up (a plural counts too); the first match wins.
   {access} becomes how long a bought sheet stays open ("24 hours" unless staff change it). */
export const AI_NAME = 'Learn With Why AI';
export const AI_WELCOME = 'Hi! 👋 Welcome. How can I help you today?';
export const AI_PLACEHOLDER = 'Ask me anything...';

export const AI_ANSWERS = [
  { words: ['free', 'sample', 'try'], reply: 'Free sheets to try in every section: Alphabet A and B tracing, Colour A to Z (A, B and C), Matching (2), Uppercase and Lowercase (2), Sounds (A and B), Sounds Exercise (2), Missing Uppercase and Lowercase (2), and the first three sheets of Colours, Shapes, Sizes and Animals in Vocabulary. Open them from the shop (pick Free): no sign-in is needed. Every other sheet is bought on its own or opens with a class plan.' },
  { words: ['how long', 'expire', 'expiry', 'expires', 'expired', 'forever', 'keep', 'year', 'days', 'access', 'buy again'], reply: 'A sheet you buy stays open for {access}, counted from the moment your payment is verified. My Account → My Worksheets shows a timer with the time left. When it reaches zero, the sheet is removed from your account, and you can buy it again from the shop. Pages you have already printed or downloaded stay with you: a copy on a device or on paper cannot be removed from here.' },
  { words: ['subscribe', 'subscription', 'plan', 'month'], reply: 'You can take a Kindergarten plan for 1, 3 or 6 months (12 months too outside India). Every Kindergarten sheet opens while the plan runs, and it ends after its months. Pick a plan in the shop’s Subscription view; the price shows on the payment page.' },
  { words: ['price', 'cost', 'pay', 'buy', 'rupee', '₹', 'payment'], reply: 'You can buy single sheets or take a Kindergarten plan. The price shows on our secure payment page before you pay, and a bought sheet stays open for {access}.' },
  { words: ['class 1', 'class 2', 'class 3', 'grade', 'standard'], reply: 'Class 1, 2 and 3 sheets are coming soon. The Kindergarten sheets are ready now.' },
  { words: ['kindergarten', 'kg', 'alphabet', 'letter', 'tracing', 'phonics', 'sound', 'abc'], reply: 'Kindergarten has seven Alphabet sections: A to Z letter tracing, letter recognition, matching uppercase and lowercase, letter before and after, beginning sounds, ending sounds, and finding the missing letters. Vocabulary has Colours, Shapes, Sizes and Animals sheets.' },
  { words: ['english', 'maths', 'math', 'science', 'subject'], reply: 'Right now our sheets are Kindergarten English: the Alphabet sections, plus Colours, Shapes, Sizes and Animals in Vocabulary. More classes and subjects are coming soon.' },
  { words: ['print', 'download', 'pdf', 'open', 'view'], reply: 'Your sheets open in our protected viewer after you sign in. Find them in My Account → My Worksheets. If a sheet can be printed or downloaded, the viewer shows how many times are left.' },
  { words: ['share', 'sharing'], reply: 'Your sign-in is just for you, so please do not share it or the sheets. Every page shows your name.' },
  { words: ['contact', 'email', 'mail', 'phone', 'help', 'support', 'query'], reply: 'You can write to us at learnwithwhy6@gmail.com, or use the form in the Contact section of this page.' },
  { words: ['sign in', 'login', 'log in', 'sign up', 'account', 'password'], reply: 'Use the sign-in card on the first screen of this page. New here? Sign up with your name and email, and we will email you a password. Free sheets open without signing in; you need to be signed in to buy and open paid sheets.' },
  { words: ['hello', 'hi', 'hey', 'namaste', 'good morning', 'good evening'], reply: 'Hello! I can help you find worksheets, explain how plans work, or tell you how to reach us. What would you like to know?' },
  { words: ['thank', 'thanks', 'great', 'nice'], reply: 'You’re welcome! Ask me anything else whenever you like.' },
];

export const AI_FILE_REPLY = 'Thanks for the file! I can’t read attachments yet, but you can tell me what you need in words.';
export const AI_FALLBACK = 'I’m still learning, so my answers are simple for now. Try asking about free sheets, plans, how long a sheet stays open, or how to contact us.';
/* added under a practice answer, so nobody mistakes it for the full answer */
export const AI_OFFLINE_NOTE = 'I could not reach our server just now, so this is a shorter answer than usual. Please check your connection and ask again in a moment.';
/* when no FAQ answer fits well, before the closest questions */
export const AI_NOT_SURE = 'I’m not sure I understood. Did you mean one of these? Or write to us at learnwithwhy6@gmail.com.';
/* before the questions the server suggests when it was not sure */
export const AI_SUGGEST = 'You could ask me:';
export const AI_BUSY = 'You have asked a lot of questions very quickly. Please wait a minute, then ask again.';
export const AI_ERROR = 'Sorry, I couldn’t answer just now. Please try again in a moment.';
