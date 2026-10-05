/* Shared by the Admin and Developer dashboards: sections, permissions, the staff
   identity, the demo storage and the sync with the server (/api/admin/*).
   Moved from site/dist/admin.js; behaviour unchanged. */
import { read, write, audit, staffSession } from '../../services/storage.js';
import { adminApi as callAdmin } from '../../services/api.js';

export const ADMIN_SECTIONS = [
  ['overview', 'Dashboard'], ['products', 'Products'], ['orders', 'Orders'], ['customers', 'Customers'], ['messages', 'Messages'], ['analytics', 'Analytics'],
  ['coupons', 'Coupons'], ['content', 'Content'], ['roles', 'Roles'], ['settings', 'Settings'], ['audit', 'Audit logs'],
];
export const DEV_SECTIONS = [
  ['health', 'Dashboard'], ['errors', 'Errors'], ['api', 'API monitoring'], ['db', 'Database'],
  ['payments', 'Payments'], ['webhooks', 'Webhooks'], ['auth', 'Authentication'], ['perf', 'Performance'],
  ['security', 'Security'], ['deploy', 'Deployments'], ['backups', 'Backups'], ['audit', 'Audit logs'],
];
export const GROUPS = {
  admin: [['General', ['overview', 'products', 'orders', 'customers', 'messages', 'analytics']], ['Store', ['coupons', 'content', 'roles', 'settings', 'audit']]],
  developer: [['General', ['health', 'errors', 'api', 'db', 'perf']], ['Logs', ['payments', 'webhooks', 'auth', 'security', 'audit']], ['Ops', ['deploy', 'backups']]],
};
export const DESC = { overview: "Here's what is happening in your store today.", products: 'Manage the books and sheets on the shelf.', orders: 'Every subscription order and its status.', customers: 'Manage your customers and their plans here.', messages: 'Notes customers sent through the contact form.', analytics: 'Sales, visitors and conversion.', coupons: 'Coupon codes and class discounts.', content: 'Edit the words on the home page.', roles: 'Who can do what.', settings: 'Store-wide settings — the server connection.', audit: 'Everything staff changed, in order.',
  health: 'System health at a glance.', errors: 'Errors and stack traces caught in the browser.', api: 'Every fetch() call, status and latency.', db: 'Tables, sizes and quota.', payments: 'Payment gateway log.', webhooks: 'Callbacks from the gateways.', auth: 'Sign-ins and sign-ups.', perf: 'Load, paint and frame timings.', security: 'Failed logins and suspicious activity.', deploy: 'Version and latest commits.', backups: 'Export and restore the demo data.' };
export const TOPNAV = {
  admin: [['overview', 'Overview'], ['customers', 'Customers'], ['products', 'Products'], ['settings', 'Settings']],
  developer: [['health', 'Overview'], ['errors', 'Errors'], ['api', 'API'], ['deploy', 'Deployments']],
};
export const FIRST = { admin: 'overview', developer: 'health' };
export const sectionsOf = kind => (kind === 'admin' ? ADMIN_SECTIONS : DEV_SECTIONS);

export const ORDER_STATUS = ['pending', 'paid', 'shipped', 'delivered', 'cancelled', 'refunded'];
export const PERMS = ['products', 'orders', 'customers', 'messages', 'analytics', 'coupons', 'content', 'roles', 'audit', 'developer'];
export const DEFAULT_ROLES = { admin: PERMS.slice(), editor: ['products', 'content'], support: ['orders', 'customers', 'messages'], developer: ['developer', 'audit'] };
export function permsOf(who) {
  const roles = read('lww_roles', DEFAULT_ROLES);
  PERMS.forEach(p => { if (roles.admin && !roles.admin.includes(p)) roles.admin.push(p); });   /* a panel added since the roles were saved stays open to the admin */
  const staff = read('lww_staff_users', []).find(u => u.email === (who || {}).email);
  const r = (staff && staff.rolename) || ((who || {}).kind === 'developer' ? 'developer' : 'admin');
  return roles[r] || [];
}

/* formatting */
export const fmt = ms => new Date(ms).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
export const day = ms => new Date(ms).toISOString().slice(0, 10);
export const kb = n => (n / 1024).toFixed(1) + ' KB';
export const lastDays = n => { const out = []; for (let i = n - 1; i >= 0; i--) { const d = new Date(); d.setDate(d.getDate() - i); out.push(d.toISOString().slice(0, 10)); } return out; };
export const initialsOf = s => String(s || '').trim().split(/[\s@._-]+/).filter(Boolean).slice(0, 2).map(x => x[0].toUpperCase()).join('') || 'ST';

/* who is signed in to the staff page */
export const staffEmail = () => (staffSession() || {}).email || 'staff';
export const staffName = () => { const u = read('lww_staff_users', []).find(x => x.email === staffEmail()); return (u && u.name) || staffEmail().split('@')[0]; };
export const log = (action, detail) => audit(staffEmail(), action, detail);

/* the demo storage the dashboards render */
export const events = () => read('lww_events', []);
export const orders = () => read('lww_orders', []);
export const users = () => read('lww_users', []);
export const save = (key, val) => write(key, val);
export const lwwKeys = () => Object.keys(localStorage).filter(k => k.startsWith('lww_'));

/* ---------- the database is the source of truth ----------
   With the admin key saved (Settings → Server connection), orders, customers and entitlements are
   pulled from the server (/api/admin/*) into the same lww_* keys the dashboards render, so every
   section shows what is really in SQLite instead of this browser's copy. The key is typed in by
   staff and kept in this browser only — it is never part of the built site. */
export const adminKey = () => read('lww_admin_key', '');
export const adminApi = (method, path, body) => callAdmin(adminKey(), method, path, body);
export const sync = { at: 0, busy: false };
export async function syncFromServer(force) {
  if (!adminKey() || sync.busy || (!force && Date.now() - sync.at < 30e3)) return false;
  sync.busy = true;
  try {
    const [o, u, e, c] = await Promise.all([adminApi('GET', '/api/admin/orders'), adminApi('GET', '/api/admin/users'), adminApi('GET', '/api/admin/entitlements'), adminApi('GET', '/api/admin/messages').catch(() => ({ messages: [] }))]);
    const STATUS = { created: 'pending', paid: 'paid', failed: 'cancelled', refunded: 'refunded', cancelled: 'cancelled' };
    save('lww_orders', o.orders.slice().reverse().map(x => ({ id: x.id, at: x.at, email: x.email, name: x.name, cls: x.cls, plan: x.plan, worksheet: x.worksheet, amount: x.totalInr, currency: x.currency, total: x.total, method: ({ razorpay: 'Razorpay', stripe: 'Stripe', paypal: 'PayPal' })[x.method] || x.method, payment: x.paymentId, coupon: x.coupon, status: STATUS[x.status] || x.status, address: x.address, server: true })));
    save('lww_users', u.users.map(x => ({ id: x.id, name: x.name, email: x.email, role: x.role, created: x.created_at, lastLogin: x.last_login_at, spent: x.spent_inr, orders: x.orders, active: x.active })));
    const subs = {}, owned = {};
    e.entitlements.forEach(x => { if (x.scope === 'class') (subs[x.email] = subs[x.email] || []).push({ cls: x.cls, plan: x.plan || 'm1', start: x.start, at: x.start, end: x.end || null, ended: !!(x.end && x.end <= Date.now()), id: x.id, revoked: x.revoked }); else if (!(owned[x.email] || []).includes(x.worksheet)) (owned[x.email] = owned[x.email] || []).push(x.worksheet); });
    save('lww_subs', subs); save('lww_owned', owned);
    if (c.messages) { save('lww_messages', c.messages); if (c.inbox) save('lww_inbox', c.inbox); }
    sync.at = Date.now(); return true;
  } catch (err) { console.warn('admin sync: ' + err.message); sync.at = Date.now() - 20e3; return false; }
  finally { sync.busy = false; }
}

/* Download backup: every lww_* key as one JSON file */
export function downloadBackup() {
  const j = {};
  lwwKeys().forEach(k => { try { j[k] = JSON.parse(localStorage.getItem(k)); } catch (_) { j[k] = localStorage.getItem(k); } });
  const blob = new Blob([JSON.stringify(j, null, 2)], { type: 'application/json' });
  const u = URL.createObjectURL(blob), l = document.createElement('a');
  l.href = u; l.download = 'learn-with-why-backup-' + day(Date.now()) + '.json'; l.click();
  setTimeout(() => URL.revokeObjectURL(u), 1000);
  log('backup downloaded', '');
}
