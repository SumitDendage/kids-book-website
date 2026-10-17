/* Account security for customers: the rules every account agrees to, the warnings, paused paid
   sheets, a blocked account, and notes to the team (appeals). The SERVER decides all of it
   (GET /api/me/security and friends, see services/api.js); this file only puts the answers in
   one shape and remembers, for this tab only, that the server said the account is blocked, so
   the /account-blocked page can say so after the sign-in is gone. No sample data, no made-up
   numbers: when the server has not answered, nothing is shown. */
import { fetchConfig, meApi } from './api.js';
import { INBOX, DEFAULT_ACCESS_HOURS } from '../data/content.js';

export const SUPPORT_EMAIL = INBOX;
export const MAX_WARNINGS = 3;
/* the words of the agreement when the server cannot be asked (the server checks the version anyway) */
export const DEFAULT_AGREEMENT = { version: null, text: 'I understand that my account credentials are personal and must not be shared with anyone.' };

const validEmail = v => typeof v === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
const num = v => (Number.isFinite(+v) ? +v : 0);
/* a time from the API: milliseconds, or an ISO date; null when missing */
export function timeOf(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const n = Number(v);
  if (Number.isFinite(n) && /^\d+$/.test(String(v))) return n;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
}

/* What the server says every account agrees to, and where to write to us (GET /api/config).
   Never fails: without an answer the built-in words are used. */
export async function getSiteRules() {
  try {
    const c = await fetchConfig();
    const a = c && c.agreement && typeof c.agreement.text === 'string' && c.agreement.text.trim() ? { version: c.agreement.version || null, text: c.agreement.text.trim() } : DEFAULT_AGREEMENT;
    return {
      agreement: a,
      supportEmail: validEmail(c && c.supportEmail) ? c.supportEmail : SUPPORT_EMAIL,
      maxWarnings: num(c && c.security && c.security.maxWarnings) || MAX_WARNINGS,
      emailOn: !(c && c.features && c.features.email === false),
      accessDays: num(c && c.accessDays) || 1,
      accessHours: num(c && c.accessHours) || (num(c && c.accessDays) ? num(c.accessDays) * 24 : DEFAULT_ACCESS_HOURS),
      known: true,
    };
  } catch (_) {
    return { agreement: DEFAULT_AGREEMENT, supportEmail: SUPPORT_EMAIL, maxWarnings: MAX_WARNINGS, emailOn: true, accessDays: 1, accessHours: DEFAULT_ACCESS_HOURS, known: false };
  }
}

/* One shape for GET /api/me/security (also inside a sign-in answer as `security`):
   { warningCount, maxWarnings, accessStatus: 'active' | 'suspended', acknowledgedWarningCount,
     updatedAt, suspendedAt, suspensionReason, warnings: [{ id, level, reason, issuedAt, expiresAt,
     acknowledged }] (oldest first), openAppeal: { id, kind, createdAt } | null }.
   warningCount and accessStatus are separate: only accessStatus pauses paid sheets. */
export function normalizeStatus(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw.security && typeof raw.security === 'object' ? raw.security : raw;
  if (r.warningCount == null && r.accessStatus == null && !Array.isArray(r.warnings)) return null;
  const max = num(r.maxWarnings) || MAX_WARNINGS;
  const warnings = (Array.isArray(r.warnings) ? r.warnings : []).map((w, i) => ({
    id: w.id, level: num(w.level) || i + 1, reason: typeof w.reason === 'string' ? w.reason : '',
    issuedAt: timeOf(w.issuedAt), expiresAt: timeOf(w.expiresAt), acknowledged: !!w.acknowledged,
  })).sort((a, b) => (a.issuedAt || 0) - (b.issuedAt || 0) || num(a.id) - num(b.id));
  const count = Math.max(0, Math.floor(num(r.warningCount != null ? r.warningCount : warnings.length)));
  const a = r.openAppeal && typeof r.openAppeal === 'object' ? r.openAppeal : null;
  return {
    warningCount: count,
    maxWarnings: max,
    accessStatus: r.accessStatus === 'suspended' ? 'suspended' : 'active',
    acknowledgedWarningCount: Math.max(0, Math.floor(num(r.acknowledgedWarningCount))),
    updatedAt: timeOf(r.updatedAt),
    suspendedAt: timeOf(r.suspendedAt),
    suspensionReason: r.suspensionReason || null,
    warnings,
    openAppeal: a ? { id: a.id, kind: a.kind || null, createdAt: timeOf(a.createdAt) } : null,
  };
}
/* paid sheets are paused (the server's accessStatus; never the warning count on its own) */
export const isPaused = status => !!status && status.accessStatus === 'suspended';
/* the warnings not yet read, oldest first, each with how many to acknowledge to mark it read */
export function unreadWarnings(status) {
  if (!status) return [];
  return status.warnings.map((w, i) => ({ ...w, upTo: i + 1 })).filter(w => !w.acknowledged);
}

export const securityService = {
  async status() { return normalizeStatus(await meApi.security()); },
  /* "I Understand": marks the oldest `upTo` warnings as read; the count itself never changes */
  async acknowledge(upTo) { return normalizeStatus(await meApi.acknowledgeWarnings(upTo)); },
  async appeals() { const r = await meApi.appeals(); return (Array.isArray(r.appeals) ? r.appeals : []).map(appealOf); },
  async sendAppeal({ kind, message, warningId }) {
    const body = { kind, message };
    if (warningId != null) body.warningId = warningId;
    const r = await meApi.sendAppeal(body);
    return r && r.appeal ? appealOf(r.appeal) : null;
  },
};

/* notes to the team about account security */
export const APPEAL_KINDS = [
  { id: 'warning', label: 'A security warning' },
  { id: 'suspension', label: 'Paid sheets being paused' },
  { id: 'block', label: 'A stopped sign-in or a blocked account' },
];
export const APPEAL_STATUS = { open: 'Waiting for an answer', accepted: 'Answered: we agreed', rejected: 'Answered: no change' };
export const appealKindLabel = id => (APPEAL_KINDS.find(k => k.id === id) || { label: 'Account security' }).label;
function appealOf(a) {
  return {
    id: a.id, kind: a.kind, message: a.message || '', status: a.status || 'open', response: a.response || null,
    warningId: a.warningId ?? null, createdAt: timeOf(a.createdAt), decidedAt: timeOf(a.decidedAt),
  };
}

/* ---------- "this account is blocked", for this tab only ----------
   The server ends every sign-in of a blocked account, so after the 403 there is nobody signed in
   to ask. The page that explains it reads this note (kept for a day, in this tab only). */
const BLOCKED_KEY = 'lww_blocked', BLOCKED_TTL = 24 * 3600e3, BLOCKED_EVENT = 'lww:account-blocked';
export function readAccountBlocked() {
  try {
    const v = JSON.parse(sessionStorage.getItem(BLOCKED_KEY) || 'null');
    return v && Date.now() - (v.at || 0) < BLOCKED_TTL ? { email: typeof v.email === 'string' ? v.email : '', at: v.at } : null;
  } catch (_) { return null; }
}
export function markAccountBlocked(email) {
  const prev = readAccountBlocked();
  const v = { email: (validEmail(email) && email) || (prev && prev.email) || '', at: Date.now() };
  try { sessionStorage.setItem(BLOCKED_KEY, JSON.stringify(v)); } catch (_) {}
  try { dispatchEvent(new CustomEvent(BLOCKED_EVENT, { detail: v })); } catch (_) {}
}
export function clearAccountBlocked() {
  let had = false;
  try { had = sessionStorage.getItem(BLOCKED_KEY) != null; sessionStorage.removeItem(BLOCKED_KEY); } catch (_) {}
  if (had) { try { dispatchEvent(new CustomEvent(BLOCKED_EVENT, { detail: null })); } catch (_) {} }
}
/* the blocked page listens: (note | null) => void. Returns the unsubscribe function. */
export function onAccountBlockedChange(fn) {
  const h = e => fn(e.detail || null);
  addEventListener(BLOCKED_EVENT, h);
  return () => removeEventListener(BLOCKED_EVENT, h);
}

/* a mail link to the team with a subject line */
export const mailTo = (email, subject) => 'mailto:' + (email || SUPPORT_EMAIL) + (subject ? '?subject=' + encodeURIComponent(subject) : '');
