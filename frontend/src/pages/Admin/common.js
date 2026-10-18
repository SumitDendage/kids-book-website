/* Words and small helpers shared by the Admin pages (labels for the server's status codes). */
import { inr, cur } from '../Portal/dashboard.js';

export const ORDER_STATUS_LABEL = { created: 'Unpaid', paid: 'Paid', failed: 'Failed', cancelled: 'Cancelled', refunded: 'Refunded', expired: 'Expired' };
export const METHOD_LABEL = { razorpay: 'Razorpay', stripe: 'Stripe', paypal: 'PayPal' };
export const ENT_STATUS_LABEL = { active: 'Open', scheduled: 'Starts later', expired: 'Ended', revoked: 'Taken away', lapsed: 'Free pass ended' };
export const ENT_TONE = { active: 'ok', scheduled: 'info', expired: 'neutral', revoked: 'bad', lapsed: 'neutral' };
export const SHEET_STATUS_LABEL = { draft: 'Draft', active: 'On sale', archived: 'Archived' };
export const SHEET_TONE = { draft: 'neutral', active: 'ok', archived: 'neutral' };
export const AUDIENCE_LABEL = { parent: 'Parents', teacher: 'Teachers', both: 'Parents and teachers' };
export const USER_STATUS_LABEL = { active: 'Active', pending_verification: 'Email not confirmed', suspended: 'Blocked' };

/* what an order bought, in a few words */
export function orderWhat(o) {
  const lines = (o && o.lines) || [];
  if (!lines.length) return o && o.worksheet ? o.worksheet : '';
  const first = lines[0].title || lines[0].worksheet || lines[0].cls || '';
  return lines.length === 1 ? first : first + ' + ' + (lines.length - 1) + ' more';
}
/* the order's amount: rupees, and the customer's own currency when they paid in another one */
export function orderAmount(o) {
  if (!o) return '';
  return o.currency && o.currency !== 'INR' ? inr(o.totalInr) + ' (' + cur(o.total, o.currency) + ')' : inr(o.totalInr);
}
/* an access record's name: the sheet title, or the class plan */
export function entName(e, classes) {
  if (!e) return '';
  if (e.scope === 'class') {
    const c = (classes || []).find(x => x.id === e.cls);
    return 'Class plan: ' + (e.className || (c && c.name) || e.cls) + (e.planLabel ? ' (' + e.planLabel + ')' : e.plan ? ' (' + e.plan + ')' : '');
  }
  return e.title || e.worksheet || 'Sheet';
}
/* a date for an <input type="date"> (local), and back */
export const dateInput = ms => { if (!ms) return ''; const d = new Date(ms); const p = n => String(n).padStart(2, '0'); return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); };
/* the end of that local day, as an ISO time the server understands */
export const endOfDayIso = s => { if (!s) return null; const d = new Date(s + 'T23:59:59'); return Number.isNaN(d.getTime()) ? null : d.toISOString(); };
export const startOfDayIso = s => { if (!s) return null; const d = new Date(s + 'T00:00:00'); return Number.isNaN(d.getTime()) ? null : d.toISOString(); };

/* product labels (they are tags on the product; the website reads the same words) and the home page tag */
export const LABELS = [['bestseller', 'Best Seller'], ['featured', 'Featured'], ['new', 'New Arrival'], ['popular', 'Popular'], ['recommended', 'Recommended']];
export const HOME_TAG = 'home';
/* where a sheet is: draft (staff only), published, scheduled (published from a time on), hidden (archived) */
export const VISIBILITY = [['draft', 'Draft'], ['published', 'Published'], ['scheduled', 'Scheduled'], ['hidden', 'Hidden']];
export const VISIBILITY_TONE = { draft: 'neutral', published: 'ok', scheduled: 'info', hidden: 'neutral' };
export const visibilityOf = s => (!s ? 'draft' : s.status === 'archived' ? 'hidden' : s.status === 'draft' ? 'draft' : s.scheduled ? 'scheduled' : 'published');
/* a time for an <input type="datetime-local"> (this browser's time zone), and back to ms */
export const localInput = ms => { if (!ms) return ''; const d = new Date(ms); const p = n => String(n).padStart(2, '0'); return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes()); };
export const fromLocalInput = s => { if (!s) return null; const t = new Date(s).getTime(); return Number.isNaN(t) ? null : t; };
