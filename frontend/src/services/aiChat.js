/* The AI assistant's one call: send what the visitor typed, get the answer back.
   1. The FAQ list in data/faq.json (Sumit's Learn With Why FAQ) answers first, right in the
      browser, so the assistant works even when the server is not online.
   2. A question it does not know goes to our server: POST /api/ai/chat { message } answers
      from the FAQ list the team keeps in the admin ({ reply, source, suggestions }).
   3. If the server cannot answer, the chat suggests the closest FAQ questions, or falls back
      to the short practice answers in data/aiAssistant.js. A visitor always gets a reply. */
import { aiApi } from './api.js';
import { getCoConfig } from './checkout.js';
import { accessSpan } from '../data/content.js';
import { findAnswer } from './faqSearch.js';
import { AI_ANSWERS, AI_FALLBACK, AI_FILE_REPLY, AI_SUGGEST, AI_BUSY, AI_NOT_SURE } from '../data/aiAssistant.js';

const escape = w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/* a whole word or phrase, so "hi" does not match "this"; a plural counts too */
const has = (text, w) => new RegExp('(^|[^a-z])' + escape(w) + 's?([^a-z]|$)').test(text);

export function practiceReply(message, { file } = {}) {
  const text = String(message || '').toLowerCase();
  const hit = AI_ANSWERS.find(a => a.words.some(w => has(text, w)));
  if (hit) return hit.reply.replace(/\{access\}/g, accessSpan((getCoConfig() || {}).accessDays));
  return file ? AI_FILE_REPLY : AI_FALLBACK;
}

const wait = (ms, signal) => new Promise((resolve, reject) => {
  const t = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); reject(new DOMException('Aborted', 'AbortError')); }, { once: true });
});

/* the server's answer, with the questions it suggests when it was not sure */
function replyOf(out) {
  const reply = String((out && out.reply) || '').trim();
  const tips = out && out.source === 'fallback' && Array.isArray(out.suggestions) ? out.suggestions.filter(x => typeof x === 'string' && x.trim()).slice(0, 4) : [];
  return tips.length ? reply + '\n\n' + AI_SUGGEST + '\n' + tips.map(x => '• ' + x.trim()).join('\n') : reply;
}

/* the FAQ list loads the first time someone asks, so it never slows the page down */
let faqList = null;
const loadFaq = () => (faqList ||= import('../data/faq.json').then(m => (m.default || m).faq).catch(() => { faqList = null; return []; }));
export async function faqReply(message) {
  return findAnswer(await loadFaq(), message);
}
const withTips = (reply, tips) => tips.length ? reply + '\n\n' + AI_SUGGEST + '\n' + tips.map(x => '• ' + x).join('\n') : reply;

/* resolves with the reply text (rejects only when the visitor cancels) */
export async function sendChatMessage(message, { file, signal } = {}) {
  const words = String(message || '').trim();
  /* files are not read: a file on its own gets a friendly note, a file with words sends just the words */
  if (!words) {
    await wait(500, signal);
    return AI_FILE_REPLY;
  }
  const local = await faqReply(words);
  if (local.answer) { await wait(400, signal); return local.answer; }
  try {
    return replyOf(await aiApi.chat(words.slice(0, 1000), signal));
  } catch (err) {
    if (err && err.status === 429) return AI_BUSY;
    /* "Type a question first." and the like: the server's own words for what to change */
    const why = err && err.status === 400 && err.body && err.body.errors && err.body.errors.message;
    if (why) return String(why);
    if (err && err.name === 'AbortError') throw err;
    /* the server could not answer (offline, not online yet, or a problem on its side) */
    const practice = practiceReply(words, { file });
    if (practice !== AI_FALLBACK) return practice;
    return local.suggestions.length ? withTips(AI_NOT_SURE, local.suggestions) : AI_FALLBACK;
  }
}
