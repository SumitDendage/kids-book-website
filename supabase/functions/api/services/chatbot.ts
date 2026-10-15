// The FAQ assistant on the home page. No AI service: it looks up the published public answers in
// faq_entries by keywords (whole words or phrases, plurals too) and by trigram similarity to the
// question, and answers with the best one. Staff-only, draft and planned answers are never read.
import type { Tx } from '../lib/db.ts';
import { DEFAULTS, type Settings } from '../lib/settings.ts';
import { validEmail } from '../lib/util.ts';
import { printsPerSheet } from './entitlements.ts';

export type ChatAnswer = {
  reply: string;
  source: 'faq' | 'fallback';
  faqId: number | null;
  question: string | null;
  suggestions: string[];
};

type FaqRow = { id: number; question: string; answer: string; keywords: string[]; sim: number };

// Below this trigram similarity a question alone is not trusted to pick an answer.
const MIN_SIMILARITY = 0.35;

export function supportEmail(s: Settings): string {
  const e = String(s.contact.inbox ?? '').trim();
  return validEmail(e) ? e : DEFAULTS.contact.inbox;
}

/** Fills the placeholders staff may use in answers: {accessDays}, {supportEmail}, and the prints
 *  of each sheet by account type {printsParent}, {printsTeacher} and {printsOrganization}. */
export function fillAnswer(text: string, s: Settings): string {
  const days = Number.isInteger(s.worksheet_access.days) && s.worksheet_access.days > 0 ? s.worksheet_access.days : DEFAULTS.worksheet_access.days;
  return text.replace(/\{accessDays\}/g, String(days)).replace(/\{supportEmail\}/g, supportEmail(s))
    .replace(/\{printsParent\}/g, String(printsPerSheet(s.prints, 'parent')))
    .replace(/\{printsTeacher\}/g, String(printsPerSheet(s.prints, 'teacher')))
    .replace(/\{printsOrganization\}/g, String(printsPerSheet(s.prints, 'school')));
}

const escapeRe = (w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Is this keyword in the text as a whole word or phrase? ("hi" is not in "this", "class 1" is
 *  not in "class 10"; "sheet" matches "sheets"). Symbols such as ₹ match anywhere. */
export function hasKeyword(text: string, keyword: string): boolean {
  const k = keyword.toLowerCase().replace(/\s+/g, ' ').trim();
  if (!k || k.length > 60) return false;
  const left = /^[a-z0-9]/.test(k) ? '(?:^|[^a-z0-9])' : '';
  const right = /[a-z0-9]$/.test(k) ? '(?:e?s)?(?:[^a-z0-9]|$)' : '';
  return new RegExp(left + escapeRe(k) + right).test(text);
}

export function normalise(message: string): string {
  return message.toLowerCase().replace(/[‘’]/g, "'").replace(/\s+/g, ' ').trim();
}

function fallback(s: Settings, rows: FaqRow[]): ChatAnswer {
  return {
    reply: `I’m not sure about that one yet. Please write to us with the form in the Contact section of this page, or email ${supportEmail(s)}, and we will reply within one working day.`,
    source: 'fallback',
    faqId: null,
    question: null,
    suggestions: rows.slice(0, 4).map((r) => r.question),
  };
}

/** The best published public answer for this message, or a polite pointer to the contact form. */
export async function answerQuestion(q: Tx, message: string, s: Settings): Promise<ChatAnswer> {
  const text = normalise(message).slice(0, 1000);
  const rows = await q<FaqRow[]>`
    select id, question, answer, keywords, similarity(lower(question), ${text.slice(0, 300)})::float8 as sim
    from faq_entries
    where audience = 'public' and status = 'published'
    order by sort, id
    limit 500`;
  if (!text) return fallback(s, rows);

  let best: FaqRow | null = null;
  let bestScore = 0;
  let bestHits = 0;
  for (const r of rows) {
    let hits = 0;
    for (const k of r.keywords ?? []) {
      // a matching phrase of several words says more than one word
      if (hasKeyword(text, k)) hits += 1 + 0.25 * (k.trim().split(/\s+/).length - 1);
    }
    const sim = Number(r.sim) || 0;
    if (hits === 0 && sim < MIN_SIMILARITY) continue;
    const score = hits * 2 + sim;
    // rows come in the staff's order, so on a tie the earlier answer wins
    if (score > bestScore) { best = r; bestScore = score; bestHits = hits; }
  }
  if (!best || (bestHits === 0 && Number(best.sim) < MIN_SIMILARITY)) return fallback(s, rows);
  return { reply: fillAnswer(best.answer, s), source: 'faq', faqId: best.id, question: best.question, suggestions: [] };
}
