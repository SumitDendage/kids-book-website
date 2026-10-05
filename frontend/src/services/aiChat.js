/* The AI assistant's one call: send what the visitor typed, get the answer back.
   Until a real AI is connected it answers with the practice answers in
   data/aiAssistant.js after a short "typing" pause. Build with VITE_AI_CHAT=live
   (see .env.example) and it calls POST /api/ai/chat { message } instead and
   shows the { reply } the server sends back. */
import { aiApi } from './api.js';
import { AI_ANSWERS, AI_FALLBACK, AI_FILE_REPLY } from '../data/aiAssistant.js';

const LIVE = import.meta.env.VITE_AI_CHAT === 'live';

const escape = w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/* a whole word or phrase, so "hi" does not match "this"; a plural counts too */
const has = (text, w) => new RegExp('(^|[^a-z])' + escape(w) + 's?([^a-z]|$)').test(text);

export function practiceReply(message, { file } = {}) {
  const text = String(message || '').toLowerCase();
  const hit = AI_ANSWERS.find(a => a.words.some(w => has(text, w)));
  if (hit) return hit.reply;
  return file ? AI_FILE_REPLY : AI_FALLBACK;
}

const wait = (ms, signal) => new Promise((resolve, reject) => {
  const t = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); reject(new DOMException('Aborted', 'AbortError')); }, { once: true });
});

/* resolves with the reply text; rejects if the server fails (the chat then says sorry) */
export async function sendChatMessage(message, { file, signal } = {}) {
  if (LIVE) {
    /* files are not sent yet: the server only gets the words (or the file's name) */
    const out = await aiApi.chat(message || (file ? 'I attached a file: ' + file.name : ''), signal);
    return String(out.reply || '');
  }
  const reply = practiceReply(message, { file });
  await wait(700 + Math.min(1100, reply.length * 6), signal);
  return reply;
}
