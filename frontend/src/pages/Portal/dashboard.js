/* Shared by the Admin and Developer dashboards: the sections and the permission each one needs,
   the signed-in staff member (from GET /api/admin/me), loading data from the server, friendly
   error text, formatting and file downloads. Everything shown comes from the server; this
   browser only remembers the panel's theme (lww_dash_theme) and sidebar state (lww_dash_sb). */
import { useCallback, useEffect, useRef, useState } from 'react';
import { staffApi, staffFetch } from '../../services/api.js';
import { useDash } from './DashContext.js';

export const ADMIN_SECTIONS = [
  ['overview', 'Dashboard'], ['products', 'Products'], ['categories', 'Categories'], ['homepage', 'Homepage'], ['orders', 'Orders'], ['customers', 'Customers'], ['security', 'Security'], ['messages', 'Messages'],
  ['analytics', 'Analytics'], ['coupons', 'Coupons'], ['content', 'Content'], ['roles', 'Roles'], ['settings', 'Settings'], ['audit', 'Audit logs'],
];
export const DEV_SECTIONS = [
  ['health', 'Dashboard'], ['errors', 'Errors'], ['emails', 'Emails'], ['api', 'API monitoring'], ['db', 'Database'],
  ['payments', 'Payments'], ['webhooks', 'Webhooks'], ['auth', 'Authentication'], ['perf', 'Performance'],
  ['security', 'Security'], ['deploy', 'Deployments'], ['backups', 'Backups'], ['audit', 'Audit logs'],
];
export const GROUPS = {
  admin: [['General', ['overview', 'products', 'categories', 'homepage', 'orders', 'customers', 'security', 'messages', 'analytics']], ['Store', ['coupons', 'content', 'roles', 'settings', 'audit']]],
  developer: [['General', ['health', 'errors', 'emails', 'api', 'db', 'perf']], ['Logs', ['payments', 'webhooks', 'auth', 'security', 'audit']], ['Ops', ['deploy', 'backups']]],
};
/* the line under each section's title (the developer panel's own security page keeps its line) */
export const DESC = {
  admin: {
    overview: "Here's what is happening in your store today.", products: 'Every book and sheet: upload, price, label, publish or schedule. Changes show on the website by themselves.', categories: 'Classes, subjects, academic sessions and website sections.', homepage: 'The lists of sheets on the home page and in the shop: pick them yourself or let them fill by themselves.', orders: 'Every order, its payments and the access it gave.',
    customers: 'Customer accounts, their orders and their access.', security: 'Account sharing: sessions, incidents, warnings and appeals.', messages: 'Notes customers sent through the contact form.',
    analytics: 'Sales, visitors and conversion.', coupons: 'Coupon codes and class discounts.', content: 'Home page text, questions and answers, and reviews.',
    roles: 'Staff members and what each one may do.', settings: 'How long access lasts, prices, rates, fees and sign-in rules.', audit: 'Everything staff changed, newest first.',
  },
  developer: {
    health: 'System health at a glance.', errors: 'Problems the server recorded: failed emails, payment notifications and security events.', emails: 'Every email the site sends, with Retry and Skip.', api: 'Is the API answering, and how fast.', db: 'Tables and row counts from the database.',
    payments: 'Payment gateway log.', webhooks: 'Payment notifications from the gateways.', auth: 'Sign-ins and customer sessions.', perf: 'Load and paint timings measured in this browser.',
    security: 'Security events and the sheet viewer log.', deploy: 'The API and website versions running now.', backups: 'Download the settings backup and CSV exports.', audit: 'Everything staff changed, newest first.',
  },
};
export const TOPNAV = {
  admin: [['overview', 'Overview'], ['customers', 'Customers'], ['products', 'Products'], ['settings', 'Settings']],
  developer: [['health', 'Overview'], ['errors', 'Errors'], ['api', 'API'], ['deploy', 'Deployments']],
};
export const FIRST = { admin: 'overview', developer: 'health' };
export const sectionsOf = kind => (kind === 'admin' ? ADMIN_SECTIONS : DEV_SECTIONS);

/* ---------- permissions ----------
   The server checks every call; the panel only hides what the staff member cannot use.
   A section opens with any one of its permissions. */
export const SECTION_PERMS = {
  admin: {
    overview: ['dashboard.view'], products: ['catalogue.read'], categories: ['catalogue.read'], homepage: ['catalogue.read'], orders: ['orders.read'], customers: ['customers.read'], security: ['security.read'],
    messages: ['messages.read'], analytics: ['analytics.read'], coupons: ['coupons.write', 'pricing.write'], content: ['content.write', 'reviews.moderate'],
    roles: ['staff.manage'], settings: ['settings.write', 'pricing.write'], audit: ['audit.read'],
  },
  developer: {
    health: ['developer.read'], errors: ['developer.read'], emails: ['emails.read'], api: ['developer.read'], db: ['developer.read'], perf: ['developer.read'],
    payments: ['logs.read', 'orders.read'], webhooks: ['logs.read', 'orders.read'], auth: ['logs.read', 'security.read'], security: ['logs.read', 'security.read'], deploy: ['developer.read'], backups: ['exports.run'], audit: ['audit.read'],
  },
};
/* the permission list of the signed-in staff member (the owner holds every one) */
export const permsOf = me => ((me && me.staff && me.staff.permissions) || []);
export const canWith = me => { const set = new Set(permsOf(me)); return p => (Array.isArray(p) ? p.some(x => set.has(x)) : set.has(p)); };
export const sectionAllowed = (kind, id, can) => { const need = (SECTION_PERMS[kind] || {})[id]; return !!need && can(need); };
/* the developer panel needs developer.read; the admin panel needs any admin section */
export const panelAllowed = (kind, can) => (kind === 'developer' ? can('developer.read') : ADMIN_SECTIONS.some(([id]) => sectionAllowed('admin', id, can)));
export const ROLE_LABEL = { owner: 'Owner', admin: 'Administrator', support: 'Support', content: 'Content editor', developer: 'Developer' };

/* ---------- errors in plain words ---------- */
export const NO_PERMISSION = 'You do not have permission for this.';
export function problem(e) {
  if (!e) return '';
  if (e.status === 0) return 'We could not reach the server. Check the internet connection and try again.';
  if (e.status === 401) return 'Your staff sign-in has ended. Please sign in again.';
  if (e.status === 403) {
    if (e.code === 'owner_only') return 'Only an owner can do this.';
    if (e.code === 'self_change') return 'You cannot change your own role or access. Ask another staff manager.';
    if (e.code === 'not_staff') return 'This account is no longer a staff account.';
    return NO_PERMISSION;
  }
  if (e.status === 409 && e.code === 'last_owner') return 'The shop needs at least one owner. Make someone else an owner first.';
  if (e.status === 429) return 'Too many requests just now. Wait a minute and try again.';
  if (e.status >= 500) return 'Something went wrong on the server. Please try again in a minute.';
  return e.message || 'That did not work. Please try again.';
}
/* the field messages of a 400 answer: { email: '...', ... } */
export const fieldErrors = e => ((e && e.body && e.body.errors && typeof e.body.errors === 'object') ? e.body.errors : {});

/* ---------- loading from the server ----------
   useStaffGet('/api/admin/orders?limit=20') → { data, error, loading, reload, setData }.
   A 401 hands the panel back to the sign-in page; other errors stay on the section. */
export function useStaffGet(path, opts = {}) {
  const dash = useDash();
  const lost = dash && dash.authLost;
  const [st, setSt] = useState({ data: null, error: null, loading: !!path });
  const seq = useRef(0);
  const run = useCallback(async quiet => {
    if (!path) { setSt({ data: null, error: null, loading: false }); return null; }
    const n = ++seq.current;
    if (!quiet) setSt(s => ({ data: opts.keep ? s.data : null, error: null, loading: true }));
    try {
      const data = await staffApi('GET', path);
      if (n === seq.current) setSt({ data, error: null, loading: false });
      return data;
    } catch (e) {
      if (n === seq.current) setSt(s => ({ data: quiet || opts.keep ? s.data : null, error: e, loading: false }));
      if (e.status === 401 && lost) lost(e);
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, lost]);
  useEffect(() => { run(false); }, [run]);
  const setData = useCallback(fn => setSt(s => ({ ...s, data: typeof fn === 'function' ? fn(s.data) : fn })), []);
  return { data: st.data, error: st.error, loading: st.loading, reload: run, setData };
}

/* one call for a button: runs it, shows a toast, refreshes the badges, reports a lost sign-in.
   act(() => staffApi('POST', ...), 'Saved') → the answer, or null when it failed (toast shown). */
export function useAct() {
  const dash = useDash();
  return useCallback(async (fn, okMsg, opts = {}) => {
    try {
      const out = await fn();
      if (okMsg && dash) dash.toast(typeof okMsg === 'function' ? okMsg(out) : okMsg);
      if (dash && dash.refreshCounts) dash.refreshCounts();
      return out === undefined ? true : out;
    } catch (e) {
      if (e.status === 401 && dash && dash.authLost) dash.authLost(e);
      else if (!opts.quiet && dash) dash.toast(problem(e));
      if (opts.rethrow) throw e;
      return null;
    }
  }, [dash]);
}

/* ---------- formatting ---------- */
const num = v => (typeof v === 'number' ? v : Number(v));
/* rupees: ₹1,250 (₹1,250.50 when there are paise) */
export function inr(v) {
  const n = num(v);
  if (v == null || !Number.isFinite(n)) return '₹0';
  return '₹' + n.toLocaleString('en-IN', { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 });
}
/* an amount in the customer's own currency: $12.00, €9.50, ₹499 */
export function cur(v, code) {
  const n = num(v), c = String(code || 'INR').toUpperCase();
  if (v == null || !Number.isFinite(n)) return '';
  if (c === 'INR') return inr(n);
  try { return new Intl.NumberFormat('en-IN', { style: 'currency', currency: c, maximumFractionDigits: c === 'JPY' ? 0 : 2 }).format(n); }
  catch (_) { return c + ' ' + n.toFixed(2); }
}
/* "8 Oct, 10:41 am" (with the year when it is not this year) */
export function fmt(ms) {
  if (ms == null || ms === '') return '';
  const d = new Date(ms); if (Number.isNaN(d.getTime())) return '';
  const o = { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' };
  if (d.getFullYear() !== new Date().getFullYear()) o.year = 'numeric';
  return d.toLocaleString('en-IN', o);
}
/* "8 Oct 2026" */
export const dateOnly = ms => { if (ms == null || ms === '') return ''; const d = new Date(ms); return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }); };
/* "in 3 days", "2 hours ago" */
export function ago(ms) {
  if (ms == null) return '';
  const diff = Number(ms) - Date.now(), abs = Math.abs(diff), past = diff < 0;
  const units = [['day', 864e5], ['hour', 36e5], ['minute', 6e4]];
  for (const [u, size] of units) if (abs >= size) { const n = Math.round(abs / size); const t = n + ' ' + u + (n === 1 ? '' : 's'); return past ? t + ' ago' : 'in ' + t; }
  return past ? 'just now' : 'in a moment';
}
export const day = ms => new Date(ms).toISOString().slice(0, 10);
export const kb = n => (n / 1024).toFixed(1) + ' KB';
export const size = n => (n == null ? '' : n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');
export const lastDays = n => { const out = []; for (let i = n - 1; i >= 0; i--) { const d = new Date(); d.setDate(d.getDate() - i); out.push(d.toISOString().slice(0, 10)); } return out; };
export const initialsOf = s => String(s || '').trim().split(/[\s@._-]+/).filter(Boolean).slice(0, 2).map(x => x[0].toUpperCase()).join('') || 'ST';
export const plural = (n, one, many) => n + ' ' + (n === 1 ? one : (many || one + 's'));
/* the staff member's time zone for the server's day-by-day numbers */
export const tzName = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Kolkata'; } catch (_) { return 'Asia/Kolkata'; } };
export const qs = o => { const p = new URLSearchParams(); Object.entries(o).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') p.set(k, String(v)); }); const s = p.toString(); return s ? '?' + s : ''; };

/* ---------- downloads (CSV exports, the settings backup) ----------
   Fetches with the staff sign-in and saves the file under the server's own name. */
export async function downloadFile(path, fallbackName) {
  const r = await staffFetch(path);
  if (!r.ok) {
    let b = {}; try { b = await r.json(); } catch (_) { /* not JSON */ }
    throw Object.assign(new Error(b.error || 'The download did not work.'), { status: r.status, code: b.code || null, body: b });
  }
  const blob = await r.blob();
  const m = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(r.headers.get('Content-Disposition') || '');
  const name = m ? decodeURIComponent(m[1]) : fallbackName;
  const u = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = u; a.download = name; a.rel = 'noopener'; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(u), 4000);
  const rows = r.headers.get('X-Row-Count');
  return { name, rows: rows == null ? null : Number(rows), truncated: r.headers.get('X-Truncated') === 'true' };
}
/* the CSV kinds the server exports, and what each one also needs besides exports.run */
export const EXPORTS = {
  orders: { label: 'orders', needs: ['orders.read'] },
  payments: { label: 'payments', needs: ['orders.read', 'logs.read'] },
  customers: { label: 'customers', needs: ['customers.read'] },
  entitlements: { label: 'access records', needs: ['orders.read', 'customers.read', 'entitlements.grant', 'entitlements.revoke'] },
  messages: { label: 'messages', needs: ['messages.read'] },
  coupons: { label: 'coupons', needs: ['coupons.write', 'pricing.write', 'orders.read'] },
  audit: { label: 'audit log', needs: ['audit.read'] },
};
export const canExport = (kind, can) => !!EXPORTS[kind] && can('exports.run') && can(EXPORTS[kind].needs);
export const exportCsv = (kind, filters = {}) => downloadFile('/api/admin/export/' + kind + qs(Object.assign({ tz: tzName() }, filters)), 'lww-' + kind + '-' + day(Date.now()) + '.csv');
/* the store's settings, prices, products, coupons and texts as one JSON file (owners and admins) */
export const canBackup = (me, can) => can('exports.run') && !!me && !!me.staff && (me.staff.role === 'owner' || me.staff.role === 'admin');
export const downloadBackup = () => downloadFile('/api/admin/backup', 'learn-with-why-backup-' + day(Date.now()) + '.json');
