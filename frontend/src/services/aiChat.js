/* The AI assistant's one call: send what the visitor typed, get the answer back.
   The answer comes from our server: POST /api/ai/chat { message } answers from the
   questions and answers the team keeps in the admin's FAQ list ({ reply, source,
   suggestions }). Only when the server cannot be reached at all (no connection) does
   the chat fall back to the short practice answers in data/aiAssistant.js, so a
   visitor is never left without a reply. */
import { aiApi } from './api.js';
import { getCoConfig } from './checkout.js';
import { accessSpan } from '../data/content.js';
import { AI_ANSWERS, AI_FALLBACK, AI_FILE_REPLY, AI_OFFLINE_NOTE, AI_SUGGEST, AI_BUSY } from '../data/aiAssistant.js';

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

/* resolves with the reply text; rejects if the server answers with an error (the chat then says sorry) */
export async function sendChatMessage(message, { file, signal } = {}) {
  const words = String(message || '').trim();
  /* files are not read: a file on its own gets a friendly note, a file with words sends just the words */
  if (!words) {
    await wait(500, signal);
    return AI_FILE_REPLY;
  }
  try {
    return replyOf(await aiApi.chat(words.slice(0, 1000), signal));
  } catch (err) {
    if (err && err.status === 429) return AI_BUSY;
    /* "Type a question first." and the like: the server's own words for what to change */
    const why = err && err.status === 400 && err.body && err.body.errors && err.body.errors.message;
    if (why) return String(why);
    if (!err || err.name === 'AbortError' || err.status !== 0) throw err;
    /* no connection to our server: answer from the practice list, and say so */
    const reply = practiceReply(words, { file }) + '\n\n' + AI_OFFLINE_NOTE;
    await wait(500, signal);
    return reply;
  }
}
