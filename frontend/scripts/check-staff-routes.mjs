import { loadEnv } from 'vite';
import { writeFile } from 'node:fs/promises';

const env = { ...loadEnv('production', process.cwd(), 'VITE_'), ...process.env };
const project = env.VITE_SUPABASE_URL;
if (project !== 'https://wjqmrcglzqemrvafjeel.supabase.co') throw new Error('Inspect the selected project before probing.');
// Primary read contracts taken from the Admin/Developer page source. No writes,
// user IDs, credential attempts, exports, retries, or payment actions are issued.
const pages = {
  'Admin / Dashboard': ['/api/admin/stats'],
  'Admin / Products': ['/api/admin/worksheets', '/api/admin/classes', '/api/admin/files'],
  'Admin / Orders': ['/api/admin/orders'],
  'Admin / Customers': ['/api/admin/users'],
  'Admin / Security': ['/api/admin/security/customers', '/api/admin/security/incidents', '/api/admin/security/appeals'],
  'Admin / Messages': ['/api/admin/messages'],
  'Admin / Analytics': ['/api/admin/analytics'],
  'Admin / Coupons': ['/api/admin/coupons'],
  'Admin / Content': ['/api/admin/content', '/api/admin/faq', '/api/admin/reviews'],
  'Admin / Roles': ['/api/admin/staff', '/api/admin/staff/roles'],
  'Admin / Settings': ['/api/admin/settings', '/api/admin/plans'],
  'Admin / Audit logs': ['/api/admin/audit'],
  'Developer / Dashboard': ['/api/admin/developer/health', '/api/health'],
  'Developer / Errors': ['/api/admin/developer/health', '/api/admin/emails', '/api/admin/payment-events'],
  'Developer / Emails': ['/api/admin/emails'],
  'Developer / API monitoring': ['/api/health', '/api/admin/login-activity', '/api/admin/access-log'],
  'Developer / Database': ['/api/admin/developer/health'],
  'Developer / Payments': ['/api/admin/payments', '/api/admin/orders'],
  'Developer / Webhooks': ['/api/admin/payment-events'],
  'Developer / Authentication': ['/api/admin/login-activity', '/api/admin/security/customers'],
  'Developer / Performance': [],
  'Developer / Security': ['/api/admin/security-events', '/api/admin/access-log'],
  'Developer / Deployments': ['/api/admin/developer/health', '/api/health'],
  'Developer / Backups': [],
  'Developer / Audit logs': ['/api/admin/audit'],
};
const paths = [...new Set(['/api/admin/me', ...Object.values(pages).flat()])];
const results = await Promise.all(paths.map(async path => {
  try {
    const response = await fetch(project + '/functions/v1' + path, {
      headers: { apikey: env.VITE_SUPABASE_PUBLISHABLE_KEY }, signal: AbortSignal.timeout(15000),
    });
    const body = await response.json().catch(() => null);
    return { path, status: response.status, code: body?.code || null,
      message: response.ok ? 'Response received without a staff session; requires authorization review.' : body?.message || body?.error || null };
  } catch (error) { return { path, status: 0, message: error.message }; }
}));
await writeFile('staff-route-results.json', JSON.stringify({ checkedAt: new Date().toISOString(), project,
  scope: 'Unauthenticated read-only reachability; not authenticated staff workflow verification.',
  pages, results }, null, 2) + '\n');
for (const r of results) console.log(`${r.status}: ${r.path}: ${r.message}`);
process.exitCode = results.some(r => ![401, 403].includes(r.status)) ? 1 : 0;
