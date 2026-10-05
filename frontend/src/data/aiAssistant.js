/* The AI assistant on the landing page: its name, its first message, and the
   practice answers it gives until a real AI is connected (see services/aiChat.js).
   Each answer lists the words that bring it up (a plural counts too); the first match wins. */
export const AI_NAME = 'Learn With Why AI';
export const AI_WELCOME = 'Hi! 👋 Welcome. How can I help you today?';
export const AI_PLACEHOLDER = 'Ask me anything...';

export const AI_ANSWERS = [
  { words: ['free', 'sample', 'try'], reply: 'Many sheets are free to try. Open the shop, look for the Free label, and sign in to open them.' },
  { words: ['subscribe', 'subscription', 'plan', 'month'], reply: 'You can subscribe to Kindergarten for 1, 3 or 6 months (12 months too outside India). Pick a plan in the shop’s Subscription view; the price shows on the payment page.' },
  { words: ['price', 'cost', 'pay', 'buy', 'rupee', '₹', 'payment'], reply: 'You can buy single sheets or subscribe to Kindergarten. Each sheet card in the shop shows its price, and you pay on our secure payment page.' },
  { words: ['class 1', 'class 2', 'class 3', 'grade', 'standard'], reply: 'Class 1, 2 and 3 sheets are coming soon. The Kindergarten sheets are ready now.' },
  { words: ['kindergarten', 'kg', 'alphabet', 'letter', 'tracing', 'phonics', 'sound', 'abc'], reply: 'Kindergarten has seven Alphabet sections: A–Z letter tracing, letter recognition, matching uppercase and lowercase, letter before and after, beginning sounds, ending sounds, and finding the missing letters.' },
  { words: ['english', 'maths', 'math', 'science', 'subject'], reply: 'Our sheets cover English, Maths and Science. Use the filters in the shop to see one subject at a time.' },
  { words: ['print', 'download', 'pdf', 'open', 'view'], reply: 'Your sheets open in our protected viewer after you sign in. Tap Cart at the top to find yours under My worksheets.' },
  { words: ['contact', 'email', 'mail', 'phone', 'help', 'support', 'query'], reply: 'You can write to us at learnwithwhy6@gmail.com, or use the form in the Contact section of this page.' },
  { words: ['sign in', 'login', 'log in', 'sign up', 'account', 'password'], reply: 'Use the sign-in card on the first screen of this page. New here? Sign up with your name and email, and we will email you a password.' },
  { words: ['hello', 'hi', 'hey', 'namaste', 'good morning', 'good evening'], reply: 'Hello! I can help you find worksheets, explain how plans work, or tell you how to reach us. What would you like to know?' },
  { words: ['thank', 'thanks', 'great', 'nice'], reply: 'You’re welcome! Ask me anything else whenever you like.' },
];

export const AI_FILE_REPLY = 'Thanks for the file! I can’t read attachments yet, but you can tell me what you need in words.';
export const AI_FALLBACK = 'I’m still learning, so my answers are simple for now. Try asking about free sheets, plans, the Kindergarten sections, or how to contact us.';
export const AI_ERROR = 'Sorry, I couldn’t answer just now. Please try again in a moment.';
