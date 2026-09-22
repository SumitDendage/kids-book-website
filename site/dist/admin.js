/* Copyright (c) 2026 Learn With Why. All rights reserved. Proprietary — see LICENSE. This notice may not be removed. */
/* =====================================================================
   STAFF DASHBOARDS — Admin (#admin) and Developer (#developer).
   Loaded after the page script; reads the same demo storage. Everything
   here is local to this browser until the real backend is connected.

   UI: shadcn-admin style (Vite + shadcn/ui look) rebuilt in plain CSS —
   inset layout, collapsible icon sidebar, h-16 header with ⌘K search,
   light / dark themes, cards, data tables with filter + pagination.
   ===================================================================== */
(function () {
  const ADMIN_SECTIONS = [
    ['overview', 'Dashboard'], ['products', 'Products'], ['orders', 'Orders'], ['customers', 'Customers'], ['analytics', 'Analytics'],
    ['coupons', 'Coupons'], ['content', 'Content'], ['roles', 'Roles'], ['settings', 'Settings'], ['audit', 'Audit logs'],
  ];
  const DEV_SECTIONS = [
    ['health', 'Dashboard'], ['errors', 'Errors'], ['api', 'API monitoring'], ['db', 'Database'],
    ['payments', 'Payments'], ['webhooks', 'Webhooks'], ['auth', 'Authentication'], ['perf', 'Performance'],
    ['security', 'Security'], ['deploy', 'Deployments'], ['backups', 'Backups'], ['audit', 'Audit logs'],
  ];
  const GROUPS = { admin: [['General', ['overview', 'products', 'orders', 'customers', 'analytics']], ['Store', ['coupons', 'content', 'roles', 'settings', 'audit']]],
    developer: [['General', ['health', 'errors', 'api', 'db', 'perf']], ['Logs', ['payments', 'webhooks', 'auth', 'security', 'audit']], ['Ops', ['deploy', 'backups']]] };
  const DESC = { overview: "Here's what is happening in your store today.", products: 'Manage the books and sheets on the shelf.', orders: 'Every subscription order and its status.', customers: 'Manage your customers and their plans here.', analytics: 'Sales, visitors and conversion.', coupons: 'Coupon codes and class discounts.', content: 'Edit the words on the home page.', roles: 'Who can do what.', settings: 'Store-wide settings — the server connection.', audit: 'Everything staff changed, in order.',
    health: 'System health at a glance.', errors: 'Errors and stack traces caught in the browser.', api: 'Every fetch() call, status and latency.', db: 'Tables, sizes and quota.', payments: 'Payment gateway log.', webhooks: 'Callbacks from the gateways.', auth: 'Sign-ins and sign-ups.', perf: 'Load, paint and frame timings.', security: 'Failed logins and suspicious activity.', deploy: 'Version and latest commits.', backups: 'Export and restore the demo data.' };
  /* lucide-style icons, 24 box, stroke 2 */
  const ICON = {
    overview: '<rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/>',
    products: '<path d="m7.5 4.27 9 5.15"/><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/>',
    orders: '<path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/>',
    customers: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    analytics: '<path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="m19 9-5 5-4-4-3 3"/>',
    coupons: '<path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z"/><path d="M13 5v2"/><path d="M13 17v2"/><path d="M13 11v2"/>',
    content: '<path d="M12 20h9"/><path d="M16.376 3.622a1 1 0 0 1 3.002 3.002L7.368 18.635a2 2 0 0 1-.855.506l-2.872.838a.5.5 0 0 1-.62-.62l.838-2.872a2 2 0 0 1 .506-.854z"/>',
    roles: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>',
    audit: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>',
    health: '<path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"/>',
    errors: '<path d="m8 2 1.88 1.88"/><path d="M14.12 3.88 16 2"/><path d="M9 7.13v-1a3.003 3.003 0 1 1 6 0v1"/><path d="M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6"/><path d="M12 20v-9"/><path d="M6.53 9C4.6 8.8 3 7.1 3 5"/><path d="M6 13H2"/><path d="M3 21c0-2.1 1.7-3.9 3.8-4"/><path d="M20.97 5c0 2.1-1.6 3.8-3.5 4"/><path d="M22 13h-4"/><path d="M17.2 17c2.1.1 3.8 1.9 3.8 4"/>',
    api: '<path d="m16 18 6-6-6-6"/><path d="m8 6-6 6 6 6"/>',
    db: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5V19A9 3 0 0 0 21 19V5"/><path d="M3 12A9 3 0 0 0 21 12"/>',
    payments: '<rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" x2="22" y1="10" y2="10"/>',
    webhooks: '<path d="M18 16.98h-5.99c-1.1 0-1.95.94-2.48 1.9A4 4 0 0 1 2 17c.01-.7.2-1.4.57-2"/><path d="m6 17 3.13-5.78c.53-.97.1-2.18-.5-3.1a4 4 0 1 1 6.89-4.06"/><path d="m12 6 3.13 5.73C15.66 12.7 16.9 13 18 13a4 4 0 0 1 0 8"/>',
    auth: '<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
    perf: '<path d="M12 2v4"/><path d="m16.2 7.8 2.9-2.9"/><path d="M18 12h4"/><path d="m16.2 16.2 2.9 2.9"/><path d="M12 18v4"/><path d="m4.9 19.1 2.9-2.9"/><path d="M2 12h4"/><path d="m4.9 4.9 2.9 2.9"/>',
    security: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>',
    deploy: '<path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/><path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"/><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/>',
    backups: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/>',
    panel: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18"/>',
    settings: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
    clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
    search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>',
    moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
    home: '<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>',
    logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" x2="9" y1="12" y2="12"/>',
    chevrons: '<path d="m7 15 5 5 5-5"/><path d="m7 9 5-5 5 5"/>',
    command: '<path d="M15 6v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3"/>',
    rupee: '<path d="M6 3h12"/><path d="M6 8h12"/><path d="m6 13 8.5 8"/><path d="M6 13h3"/><path d="M9 13c6.667 0 6.667-10 0-10"/>',
    activity: '<path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"/>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    card: '<rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" x2="22" y1="10" y2="10"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/>',
    plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
    sliders: '<line x1="21" x2="14" y1="4" y2="4"/><line x1="10" x2="3" y1="4" y2="4"/><line x1="21" x2="12" y1="12" y2="12"/><line x1="8" x2="3" y1="12" y2="12"/><line x1="21" x2="16" y1="20" y2="20"/><line x1="12" x2="3" y1="20" y2="20"/><line x1="14" x2="14" y1="2" y2="6"/><line x1="8" x2="8" y1="10" y2="14"/><line x1="16" x2="16" y1="18" y2="22"/>',
    left: '<path d="m15 18-6-6 6-6"/>', right: '<path d="m9 18 6-6-6-6"/>', first: '<path d="m11 17-5-5 5-5"/><path d="m18 17-5-5 5-5"/>', last: '<path d="m6 17 5-5-5-5"/><path d="m13 17 5-5-5-5"/>',
    x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>', check: '<path d="M20 6 9 17l-5-5"/>', book: '<path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/>', upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/>',
    image: '<rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>', file: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/>',
    trash: '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>', star: '<path d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z"/>',
  };
  const ico = (id, s) => `<svg viewBox="0 0 24 24" width="${s || 16}" height="${s || 16}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[id] || ICON.overview}</svg>`;
  const ORDER_STATUS = ['pending', 'paid', 'shipped', 'delivered', 'cancelled', 'refunded'];
  const PERMS = ['products', 'orders', 'customers', 'analytics', 'coupons', 'content', 'roles', 'audit', 'developer'];
  const DEFAULT_ROLES = { admin: PERMS.slice(), editor: ['products', 'content'], support: ['orders', 'customers'], developer: ['developer', 'audit'] };
  let section = { admin: 'overview', developer: 'health' }, editing = null, custOpen = null;
  let theme = read('lww_dash_theme', 'light'), collapsed = read('lww_dash_sb', false), mobileOpen = false;

  /* ---------- dashboard styles (shadcn tokens, scoped to .dash) ---------- */
  const style = document.createElement('style');
  style.textContent = `
  .dash {
    --radius: 0.625rem;
    --background: oklch(1 0 0); --foreground: oklch(0.129 0.042 264.695);
    --card: oklch(1 0 0); --card-foreground: oklch(0.129 0.042 264.695);
    --popover: oklch(1 0 0); --popover-foreground: oklch(0.129 0.042 264.695);
    --primary: oklch(0.208 0.042 265.755); --primary-foreground: oklch(0.984 0.003 247.858);
    --secondary: oklch(0.968 0.007 247.896); --secondary-foreground: oklch(0.208 0.042 265.755);
    --muted: oklch(0.968 0.007 247.896); --muted-foreground: oklch(0.554 0.046 257.417);
    --accent: oklch(0.968 0.007 247.896); --accent-foreground: oklch(0.208 0.042 265.755);
    --destructive: oklch(0.577 0.245 27.325);
    --border: oklch(0.929 0.013 255.508); --input: oklch(0.929 0.013 255.508); --ring: oklch(0.704 0.04 256.788);
    --chart-1: oklch(0.646 0.222 41.116); --chart-2: oklch(0.6 0.118 184.704); --chart-3: oklch(0.398 0.07 227.392); --chart-4: oklch(0.828 0.189 84.429); --chart-5: oklch(0.769 0.188 70.08);
    --sidebar: var(--background); --sidebar-accent: var(--accent); --sidebar-border: var(--border);
    --ok: oklch(0.6 0.118 184.704); --ok-bg: oklch(0.6 0.118 184.704 / 0.12); --info: oklch(0.55 0.15 240); --info-bg: oklch(0.55 0.15 240 / 0.12); --bad: var(--destructive); --bad-bg: oklch(0.577 0.245 27.325 / 0.1);
    --shadow-xs: 0 1px 2px 0 rgb(0 0 0 / 0.05); --shadow-sm: 0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1);
    --paper: #fff; --ink: var(--foreground); --ink-muted: var(--muted-foreground);
    font-family: 'Inter', var(--font-body), system-ui, sans-serif; font-size: 14px; line-height: 1.5; color: var(--foreground); background: var(--sidebar);
    display: flex; min-height: 100vh; -webkit-font-smoothing: antialiased; letter-spacing: 0;
  }
  .dash.dark {
    --background: oklch(0.129 0.042 264.695); --foreground: oklch(0.984 0.003 247.858);
    --card: oklch(0.14 0.04 259.21); --card-foreground: oklch(0.984 0.003 247.858);
    --popover: oklch(0.208 0.042 265.755); --popover-foreground: oklch(0.984 0.003 247.858);
    --primary: oklch(0.929 0.013 255.508); --primary-foreground: oklch(0.208 0.042 265.755);
    --secondary: oklch(0.279 0.041 260.031); --secondary-foreground: oklch(0.984 0.003 247.858);
    --muted: oklch(0.279 0.041 260.031); --muted-foreground: oklch(0.704 0.04 256.788);
    --accent: oklch(0.279 0.041 260.031); --accent-foreground: oklch(0.984 0.003 247.858);
    --destructive: oklch(0.704 0.191 22.216);
    --border: oklch(1 0 0 / 10%); --input: oklch(1 0 0 / 15%); --ring: oklch(0.551 0.027 264.364);
    --chart-1: oklch(0.488 0.243 264.376); --chart-2: oklch(0.696 0.17 162.48); --chart-3: oklch(0.769 0.188 70.08); --chart-4: oklch(0.627 0.265 303.9); --chart-5: oklch(0.645 0.246 16.439);
    --ok: oklch(0.696 0.17 162.48); --ok-bg: oklch(0.696 0.17 162.48 / 0.15); --info: oklch(0.7 0.14 240); --info-bg: oklch(0.7 0.14 240 / 0.15); --bad-bg: oklch(0.704 0.191 22.216 / 0.18);
    --paper: var(--card);
  }
  .dash *, .dash *::before, .dash *::after { box-sizing: border-box; border-color: var(--border); }
  .dash svg { flex-shrink: 0; }
  #portal.is-dash .shop-bar { display: none; }
  #portal.is-dash .portal-body { width: 100%; max-width: none; margin: 0; padding: 0; min-height: 100vh; display: block; }
  #portal.is-dash .shop-shade, #portal.is-dash .shop-bg { display: none; }
  #portal.is-dash { background: #fff; }
  #portal.is-dash:has(.dash.dark) { background: oklch(0.129 0.042 264.695); }

  /* ----- staff sign-in page (same look as the panel's auth pages) ----- */
  #portal:not(.is-dash) { background: #fff; color: oklch(0.129 0.042 264.695); font-family: 'Inter', var(--font-body), system-ui, sans-serif; -webkit-font-smoothing: antialiased; }
  #portal:not(.is-dash) .shop-shade, #portal:not(.is-dash) .shop-bg { display: none; }
  #portal:not(.is-dash) .shop-bar { position: absolute; top: 0; left: 0; right: 0; padding: 16px 20px !important; align-items: center !important; border: 0; background: none; backdrop-filter: none; }
  #portal:not(.is-dash) .shop-bar .eyebrow { display: none; }
  #portal:not(.is-dash) .shop-bar .card-title { font-family: inherit; font-size: 15px !important; font-weight: 600; display: inline-flex; align-items: center; gap: 10px; }
  #portal:not(.is-dash) .shop-bar .card-title::before { content: 'LW'; width: 32px; height: 32px; border-radius: 8px; background: oklch(0.208 0.042 265.755); color: #fff; display: inline-grid; place-items: center; font-family: var(--font-display); font-size: 13px; }
  #portal:not(.is-dash) .shop-actions .btn, #portal:not(.is-dash) .shop-actions .icon-btn { height: 32px; border-radius: 8px; border: 1px solid oklch(0.929 0.013 255.508); background: #fff; color: inherit; box-shadow: 0 1px 2px rgb(0 0 0 / 0.05); backdrop-filter: none; font-size: 13px; padding: 0 12px; }
  #portal:not(.is-dash) .shop-actions .icon-btn { width: 32px; padding: 0; }
  #portal .shop-actions [hidden] { display: none !important; }
  #portal:not(.is-dash) .shop-actions .btn:hover, #portal:not(.is-dash) .shop-actions .icon-btn:hover { background: oklch(0.968 0.007 247.896); transform: none; box-shadow: 0 1px 2px rgb(0 0 0 / 0.05); }
  #portal:not(.is-dash) .portal-body { min-height: 100vh !important; display: grid !important; place-items: center; margin: 0 auto !important; padding: 80px 16px 40px; width: 100% !important; }
  #portal:not(.is-dash) .portal-login { width: min(100%, 24rem); margin: 0; padding: 24px; border-radius: 12px; border: 1px solid oklch(0.929 0.013 255.508); background: #fff; box-shadow: 0 1px 3px rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1); backdrop-filter: none; color: inherit; }
  #portal:not(.is-dash) .portal-login .tabs { display: inline-flex; width: 100%; height: 36px; padding: 3px; margin-bottom: 20px; border: 0; border-radius: 8px; background: oklch(0.968 0.007 247.896); }
  #portal:not(.is-dash) .portal-login .tab { flex: 1; padding: 0; border-radius: 6px; font-size: 14px; font-weight: 500; color: oklch(0.554 0.046 257.417); letter-spacing: 0; text-transform: none; }
  #portal:not(.is-dash) .portal-login .tab.on { background: #fff; color: inherit; box-shadow: 0 1px 3px rgb(0 0 0 / 0.1); } #portal:not(.is-dash) .portal-login .tab.on::after { display: none; }
  #portal:not(.is-dash) .portal-login .card-title { font-family: inherit; font-size: 18px; font-weight: 600; letter-spacing: -0.02em; margin-bottom: 4px !important; }
  #portal:not(.is-dash) .portal-login .auth-sub { font-size: 14px; color: oklch(0.554 0.046 257.417); margin-bottom: 20px; }
  #portal:not(.is-dash) .portal-login .field { gap: 8px; margin-bottom: 16px; }
  #portal:not(.is-dash) .portal-login .field label { font-size: 14px; font-weight: 500; letter-spacing: 0; text-transform: none; color: inherit; }
  #portal:not(.is-dash) .portal-login .field input { height: 36px; padding: 4px 12px; border-radius: 8px; border: 1px solid oklch(0.929 0.013 255.508); background: transparent; color: inherit; font-size: 14px; box-shadow: 0 1px 2px rgb(0 0 0 / 0.05); }
  #portal:not(.is-dash) .portal-login .field input::placeholder { color: oklch(0.554 0.046 257.417); }
  #portal:not(.is-dash) .portal-login .field input:focus { border-color: oklch(0.704 0.04 256.788); background: transparent; box-shadow: 0 0 0 3px oklch(0.704 0.04 256.788 / 0.5); }
  #portal:not(.is-dash) .portal-login .field .err { color: oklch(0.577 0.245 27.325); font-size: 12px; }
  #portal:not(.is-dash) .portal-login .btn-primary { height: 36px; border-radius: 8px; background: oklch(0.208 0.042 265.755); color: #fff; font-size: 14px; font-weight: 500; box-shadow: 0 1px 2px rgb(0 0 0 / 0.05); margin-top: 4px; }
  #portal:not(.is-dash) .portal-login .btn-primary:hover { transform: none; background: oklch(0.208 0.042 265.755 / 0.9); box-shadow: 0 1px 2px rgb(0 0 0 / 0.05); }
  #portal:not(.is-dash) .portal-login .switch { font-size: 14px; color: oklch(0.554 0.046 257.417); text-align: center; margin-top: 16px; }
  #portal:not(.is-dash) .portal-login .switch .link { color: inherit; font-weight: 500; border-bottom: 1px solid currentColor; }
  #portal:not(.is-dash) .portal-login .alert { border-radius: 8px; font-size: 13px; padding: 10px 12px; margin-bottom: 14px; }
  #portal:not(.is-dash) .portal-login .alert.err { background: oklch(0.577 0.245 27.325 / 0.1); color: oklch(0.577 0.245 27.325); border: 1px solid oklch(0.577 0.245 27.325 / 0.2); }

  /* ----- sidebar (collapsible: icon) ----- */
  .sb { width: 16rem; flex-shrink: 0; position: sticky; top: 0; height: 100vh; display: flex; flex-direction: column; background: var(--sidebar); transition: width 0.2s ease; overflow: hidden; }
  .dash.sb-collapsed .sb { width: 3rem; }
  .sb-head, .sb-foot { padding: 8px; display: flex; flex-direction: column; gap: 8px; }
  .sb-content { flex: 1; min-height: 0; overflow-y: auto; overflow-x: hidden; display: flex; flex-direction: column; gap: 8px; padding: 0 8px; }
  .sb-content::-webkit-scrollbar { width: 6px; } .sb-content::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }
  .sb-group { display: flex; flex-direction: column; padding: 8px 0 0; }
  .sb-label { height: 32px; padding: 0 8px; display: flex; align-items: center; font-size: 12px; font-weight: 500; color: var(--muted-foreground); white-space: nowrap; overflow: hidden; transition: opacity 0.2s; }
  .dash.sb-collapsed .sb-label { opacity: 0; height: 0; padding: 0; }
  .sb-menu { display: flex; flex-direction: column; gap: 4px; }
  .sb-item { display: flex; align-items: center; gap: 8px; height: 32px; padding: 0 8px; border-radius: calc(var(--radius) - 4px); border: 0; background: none; color: var(--foreground); font: inherit; font-size: 14px; cursor: pointer; text-align: left; white-space: nowrap; overflow: hidden; transition: background 0.15s, color 0.15s; width: 100%; }
  .sb-item:hover { background: var(--sidebar-accent); }
  .sb-item.on { background: var(--sidebar-accent); font-weight: 500; }
  .sb-item.off { opacity: 0.45; }
  .sb-item span { overflow: hidden; text-overflow: ellipsis; }
  .sb-badge { margin-left: auto; min-width: 20px; height: 20px; padding: 0 6px; border-radius: 6px; background: var(--muted); font-size: 11px; font-weight: 600; display: inline-flex; align-items: center; justify-content: center; }
  .dash.sb-collapsed .sb-item { padding: 0 8px; width: 32px; } .dash.sb-collapsed .sb-item span, .dash.sb-collapsed .sb-item .sb-badge, .dash.sb-collapsed .team-txt, .dash.sb-collapsed .team .chev { display: none; }
  .team { display: flex; align-items: center; gap: 8px; height: 48px; padding: 8px; border-radius: calc(var(--radius) - 2px); border: 0; background: none; color: inherit; font: inherit; cursor: pointer; width: 100%; text-align: left; }
  .team:hover { background: var(--sidebar-accent); }
  .team-logo { width: 32px; height: 32px; flex-shrink: 0; border-radius: 8px; background: var(--primary); color: var(--primary-foreground); display: grid; place-items: center; font-family: var(--font-display); font-weight: 600; font-size: 13px; letter-spacing: 0.02em; }
  .team-txt { display: grid; flex: 1; min-width: 0; line-height: 1.25; }
  .team-txt b { font-weight: 600; font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .team-txt small { font-size: 12px; color: var(--muted-foreground); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .team .chev { margin-left: auto; color: var(--muted-foreground); }
  .av { width: 32px; height: 32px; flex-shrink: 0; border-radius: 8px; background: var(--muted); color: var(--foreground); display: grid; place-items: center; font-size: 12px; font-weight: 600; }
  .av.round { border-radius: 50%; }
  .dash.sb-collapsed .team, .dash.sb-collapsed .sb-user { padding: 0; width: 32px; justify-content: center; }
  .sb-rail { position: absolute; top: 0; bottom: 0; right: -2px; width: 4px; cursor: w-resize; }
  .sb-scrim { display: none; }

  /* ----- inset content ----- */
  .inset { flex: 1; min-width: 0; display: flex; flex-direction: column; background: var(--background); margin: 8px 8px 8px 0; border-radius: 12px; box-shadow: var(--shadow-sm), 0 0 0 1px var(--border); position: relative; }
  .dash.dark .inset { box-shadow: 0 0 0 1px var(--border); }
  .hd { position: sticky; top: 8px; z-index: 20; height: 64px; display: flex; align-items: center; gap: 12px; padding: 16px; border-radius: 12px 12px 0 0; background: color-mix(in oklab, var(--background) 80%, transparent); backdrop-filter: blur(12px); }
  .hd.scrolled { box-shadow: 0 1px 2px rgb(0 0 0 / 0.06); }
  .vsep { width: 1px; height: 24px; background: var(--border); }
  .topnav { display: flex; align-items: center; gap: 16px; margin-right: auto; }
  .topnav button { background: none; border: 0; padding: 0; font: inherit; font-size: 14px; font-weight: 500; color: var(--muted-foreground); cursor: pointer; transition: color 0.15s; white-space: nowrap; }
  .topnav button:hover, .topnav button.on { color: var(--foreground); }
  .topnav button:disabled { opacity: 0.5; cursor: default; }
  .hd-spacer { margin-right: auto; }
  .search-btn { position: relative; height: 32px; width: 256px; display: inline-flex; align-items: center; gap: 8px; padding: 0 48px 0 30px; border: 1px solid var(--input); border-radius: calc(var(--radius) - 2px); background: color-mix(in oklab, var(--muted) 25%, transparent); color: var(--muted-foreground); font: inherit; font-size: 14px; cursor: pointer; text-align: left; }
  .search-btn:hover { background: var(--accent); }
  .search-btn > svg { position: absolute; left: 8px; top: 50%; transform: translateY(-50%); }
  .search-btn kbd { position: absolute; right: 5px; top: 5px; height: 20px; display: inline-flex; align-items: center; gap: 2px; padding: 0 6px; border: 1px solid var(--border); border-radius: 4px; background: var(--muted); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 10px; font-weight: 500; }
  .hd-right { display: flex; align-items: center; gap: 8px; }
  .av-btn { width: 32px; height: 32px; border-radius: 50%; border: 0; padding: 0; background: var(--muted); color: var(--foreground); font: inherit; font-size: 12px; font-weight: 600; cursor: pointer; }
  .av-btn:hover { box-shadow: 0 0 0 2px var(--background), 0 0 0 4px var(--ring); }
  .menu.user-menu { position: fixed; left: calc(16rem + 8px); bottom: 12px; }
  .dash.sb-collapsed .menu.user-menu { left: calc(3rem + 8px); }
  @media (max-width: 767px) { .menu.user-menu { left: 8px; bottom: 76px; } }
  .menu { position: absolute; z-index: 70; min-width: 224px; padding: 4px; border: 1px solid var(--border); border-radius: calc(var(--radius) - 2px); background: var(--popover); color: var(--popover-foreground); box-shadow: 0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1); display: none; }
  .menu.open { display: block; animation: fadeUp 0.15s ease both; }
  .menu-label { padding: 6px 8px; display: flex; align-items: center; gap: 8px; font-size: 14px; }
  .menu-label .team-txt small { font-size: 12px; }
  .menu-sep { height: 1px; background: var(--border); margin: 4px -4px; }
  .menu-item { display: flex; align-items: center; gap: 8px; width: 100%; padding: 6px 8px; border: 0; border-radius: 4px; background: none; color: inherit; font: inherit; font-size: 14px; cursor: pointer; text-align: left; }
  .menu-item:hover { background: var(--accent); }
  .menu-item.danger { color: var(--destructive); }
  .menu-item svg { color: var(--muted-foreground); } .menu-item.danger svg { color: inherit; }
  .menu-item kbd { margin-left: auto; font-size: 11px; color: var(--muted-foreground); font-family: inherit; }

  .mn { padding: 24px 16px; display: flex; flex-direction: column; gap: 16px; width: 100%; max-width: 80rem; margin: 0 auto; flex: 1; }
  @media (min-width: 640px) { .mn { gap: 24px; } }
  .mn-head { display: flex; flex-wrap: wrap; align-items: flex-end; justify-content: space-between; gap: 8px; }
  .mn-head h1 { font-family: inherit; font-size: 24px; font-weight: 700; letter-spacing: -0.025em; line-height: 1.3; margin: 0; }
  .mn-head p { color: var(--muted-foreground); margin: 0; font-size: 14px; }
  .mn-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .ft { padding: 12px 16px; font-size: 12px; color: var(--muted-foreground); display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
  .ft a { color: inherit; text-decoration: underline; text-underline-offset: 3px; }

  /* ----- tabs ----- */
  .tabs-s { display: inline-flex; height: 36px; padding: 3px; border-radius: calc(var(--radius) - 2px); background: var(--muted); color: var(--muted-foreground); gap: 2px; max-width: 100%; overflow-x: auto; }
  .tabs-s button { height: 100%; padding: 0 12px; border: 1px solid transparent; border-radius: calc(var(--radius) - 4px); background: none; color: inherit; font: inherit; font-size: 14px; font-weight: 500; cursor: pointer; white-space: nowrap; display: inline-flex; align-items: center; gap: 6px; transition: background 0.15s, color 0.15s; }
  .tabs-s button.on { background: var(--background); color: var(--foreground); box-shadow: var(--shadow-sm); }
  .dash.dark .tabs-s button.on { background: var(--input); border-color: var(--input); }
  .tabs-s button:disabled { opacity: 0.5; cursor: default; }
  .tabs-s button small { font-weight: 400; color: var(--muted-foreground); }

  /* ----- cards ----- */
  .dash .panel, .card { background: var(--card); color: var(--card-foreground); border: 1px solid var(--border); border-radius: var(--radius); padding: 24px; box-shadow: var(--shadow-xs); backdrop-filter: none; display: flex; flex-direction: column; gap: 16px; }
  .dash .eyebrow { color: var(--muted-foreground); font-size: 12px; font-weight: 500; letter-spacing: 0.06em; }
  .dash .panel > .eyebrow, .card-t { font-size: 16px; font-weight: 600; letter-spacing: 0; text-transform: none; color: var(--foreground); margin: 0; line-height: 1.3; }
  .dash .row-between .eyebrow { font-size: 16px; font-weight: 600; letter-spacing: 0; text-transform: none; color: var(--foreground); margin: 0; }
  .dash .panel > .eyebrow + .auth-sub, .card-d { margin-top: -12px; }
  .dash .auth-sub { font-size: 14px; color: var(--muted-foreground); margin: 0; line-height: 1.5; }
  .dash .panel .eyebrow[style*="margin-top"] { margin-top: 4px !important; }
  .dash .panel h3.card-title { font-family: inherit; font-size: 20px; font-weight: 600; letter-spacing: -0.02em; margin: 0; }
  .dash .cart-empty { color: var(--muted-foreground); font-size: 14px; padding: 24px 0; text-align: center; border: 1px dashed var(--border); border-radius: calc(var(--radius) - 2px); }
  .dash .row-between { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin: 0; }
  .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  .grid-7 { display: grid; grid-template-columns: repeat(7, 1fr); gap: 16px; }
  .grid-7 > .span-4 { grid-column: span 4; } .grid-7 > .span-3 { grid-column: span 3; }
  @media (max-width: 1024px) { .grid-7 { grid-template-columns: 1fr; } .grid-7 > .span-4, .grid-7 > .span-3 { grid-column: auto; } }
  @media (max-width: 760px) { .grid-2 { grid-template-columns: 1fr; } }
  .kpi-row, .stat-row { display: grid; grid-template-columns: 1fr; gap: 16px; }
  @media (min-width: 640px) { .kpi-row, .stat-row { grid-template-columns: repeat(2, 1fr); } }
  @media (min-width: 1024px) { .kpi-row, .stat-row { grid-template-columns: repeat(4, 1fr); } .kpi-row.five { grid-template-columns: repeat(5, 1fr); } }
  .kpi, .stat { background: var(--card); border: 1px solid var(--border); border-radius: var(--radius); padding: 24px; box-shadow: var(--shadow-xs); display: flex; flex-direction: column; gap: 8px; }
  .kpi-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 14px; font-weight: 500; letter-spacing: 0; text-transform: none; color: var(--foreground); }
  .kpi-top svg { color: var(--muted-foreground); }
  .kpi b { font-family: inherit; font-size: 24px; font-weight: 700; line-height: 1.2; letter-spacing: -0.02em; }
  .kpi small { font-size: 12px; color: var(--muted-foreground); }
  .stat { flex-direction: column-reverse; justify-content: flex-end; }
  .stat b { font-family: inherit; font-size: 24px; font-weight: 700; line-height: 1.2; display: block; letter-spacing: -0.02em; }
  .stat span { font-size: 14px; font-weight: 500; letter-spacing: 0; text-transform: capitalize; color: var(--muted-foreground); }

  /* recent sales list */
  .sales { display: flex; flex-direction: column; gap: 28px; }
  .sale { display: flex; align-items: center; gap: 16px; }
  .sale .who { flex: 1; min-width: 0; display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 6px; }
  .sale .who p { margin: 0; font-size: 14px; } .sale .who p.nm { font-weight: 500; line-height: 1; margin-bottom: 4px; } .sale .who p.em { color: var(--muted-foreground); }
  .sale .amt { font-weight: 500; }

  /* ----- buttons ----- */
  .dash .btn { height: 36px; padding: 0 16px; border-radius: calc(var(--radius) - 2px); font: inherit; font-size: 14px; font-weight: 500; display: inline-flex; align-items: center; justify-content: center; gap: 8px; border: 1px solid transparent; cursor: pointer; box-shadow: var(--shadow-xs); transition: background 0.15s, color 0.15s, box-shadow 0.15s; backdrop-filter: none; white-space: nowrap; letter-spacing: 0; }
  .dash .btn:hover, .dash .btn:active { transform: none; }
  .dash .btn-primary { background: var(--primary); color: var(--primary-foreground); }
  .dash .btn-primary:hover { background: color-mix(in oklab, var(--primary) 90%, transparent); box-shadow: var(--shadow-xs); }
  .dash .btn-ghost { background: var(--background); color: var(--foreground); border-color: var(--input); }
  .dash .btn-ghost:hover { background: var(--accent); color: var(--accent-foreground); }
  .dash.dark .btn-ghost { background: var(--input); border-color: var(--input); }
  .dash .btn-sm { height: 32px; padding: 0 12px; font-size: 13px; }
  .dash .btn-ic { width: 32px; height: 32px; padding: 0; }
  .dash .btn-plain { background: none; border-color: transparent; box-shadow: none; } .dash .btn-plain:hover { background: var(--accent); }
  .dash .btn-danger { color: var(--destructive); }
  .dash .btn-dashed { border-style: dashed; }
  .dash .icon-btn { width: 28px; height: 28px; border-radius: calc(var(--radius) - 4px); border: 1px solid var(--input); background: var(--background); color: var(--foreground); box-shadow: var(--shadow-xs); }
  .dash .icon-btn:hover { background: var(--accent); }
  .dash .icon-btn svg { width: 16px; height: 16px; }
  .dash .link { color: var(--foreground); border: 0; font-weight: 500; font-size: 13px; padding: 4px 8px; border-radius: 4px; }
  .dash .link:hover { background: var(--accent); }
  .dash .btn-row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }

  /* ----- form controls ----- */
  .dash :is(.field, .row-form, .table) :where(input:not([type=checkbox]):not([type=radio]), select, textarea), .dash :where(input:not([type=checkbox]):not([type=radio]):not([type=file]):not([type=hidden]), select, textarea) {
    height: 36px; width: 100%; padding: 4px 12px; border: 1px solid var(--input); border-radius: calc(var(--radius) - 2px); background-color: transparent; color: var(--foreground); font: inherit; font-size: 14px; box-shadow: var(--shadow-xs); outline: none; transition: border-color 0.15s, box-shadow 0.15s; }
  .dash.dark :is(.field, .row-form, .table) :where(input:not([type=checkbox]):not([type=radio]), select, textarea), .dash.dark :where(input:not([type=checkbox]):not([type=radio]):not([type=file]):not([type=hidden]), select, textarea) { background-color: color-mix(in oklab, var(--input) 30%, transparent); }
  .dash input:focus, .dash select:focus, .dash textarea:focus { border-color: var(--ring); box-shadow: 0 0 0 3px color-mix(in oklab, var(--ring) 50%, transparent); background-color: transparent; }
  .dash.dark input:focus, .dash.dark select:focus, .dash.dark textarea:focus { background-color: color-mix(in oklab, var(--input) 30%, transparent); }
  .dash input::placeholder, .dash textarea::placeholder { color: var(--muted-foreground); }
  .dash textarea { height: auto; min-height: 80px; padding: 8px 12px; resize: vertical; line-height: 1.5; }
  .dash select { appearance: none; -webkit-appearance: none; padding-right: 32px; background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2364748b' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E"); background-repeat: no-repeat; background-size: 16px; background-position: right 10px center; }
  .dash select option { color: #000; background: #fff; }
  .dash .table select { height: 32px; width: auto; font-size: 13px; }
  .dash .table input[type=number] { height: 32px; width: 90px; }
  .dash .field { gap: 8px; margin-bottom: 16px; }
  .dash .field label { font-size: 14px; font-weight: 500; letter-spacing: 0; text-transform: none; color: var(--foreground); line-height: 1; }
  .dash .field small { font-size: 12px; color: var(--muted-foreground); }
  .dash input[type=checkbox], .dash input[type=radio] { width: 16px; height: 16px; border-radius: 4px; accent-color: var(--primary); cursor: pointer; }
  .dash .check { font-size: 14px; }
  .dash .search { height: 32px; width: 250px; padding-left: 32px; background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2364748b' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Ccircle cx='11' cy='11' r='8'/%3E%3Cpath d='m21 21-4.3-4.3'/%3E%3C/svg%3E"); background-repeat: no-repeat; background-size: 15px; background-position: 10px 50%; }
  .row-form { display: grid; grid-template-columns: 1fr 120px 200px auto; gap: 8px; }
  @media (max-width: 720px) { .row-form { grid-template-columns: 1fr 1fr; } }
  .dash .code { background: var(--muted); border: 1px solid var(--border); color: var(--foreground); border-radius: calc(var(--radius) - 2px); padding: 12px; font-size: 12px; overflow: auto; margin: 0; }
  .dash .dev-list { font-size: 14px; color: var(--muted-foreground); } .dash .dev-list b { color: var(--foreground); font-family: ui-monospace, Menlo, monospace; font-weight: 500; } .dash .dev-list a { color: var(--foreground) !important; }
  .dash .chips { display: flex; flex-wrap: wrap; gap: 8px; margin: 0; }
  .dash .chip { height: 32px; padding: 0 12px; border-radius: calc(var(--radius) - 2px); border: 1px dashed var(--input); background: var(--background); color: var(--foreground); font: inherit; font-size: 13px; font-weight: 500; backdrop-filter: none; display: inline-flex; align-items: center; gap: 6px; }
  .dash .chip:hover { background: var(--accent); transform: none; color: var(--foreground); }
  .dash .chip.on { background: var(--primary); color: var(--primary-foreground); border-style: solid; border-color: var(--primary); }
  .dash .chip small { margin: 0; padding: 0 5px; border-radius: 4px; background: color-mix(in oklab, currentColor 12%, transparent); font-size: 11px; color: inherit; }

  /* ----- badges ----- */
  .dash .pill { display: inline-flex; align-items: center; padding: 2px 8px; border-radius: calc(var(--radius) - 4px); border: 1px solid var(--border); background: transparent; color: var(--foreground); font-size: 12px; font-weight: 500; letter-spacing: 0; text-transform: capitalize; white-space: nowrap; line-height: 1.35; }
  .dash .pill.ok { background: var(--ok-bg); color: var(--ok); border-color: color-mix(in oklab, var(--ok) 30%, transparent); }
  .dash .pill.info { background: var(--info-bg); color: var(--info); border-color: color-mix(in oklab, var(--info) 30%, transparent); }
  .dash .pill.bad { background: var(--bad-bg); color: var(--bad); border-color: color-mix(in oklab, var(--bad) 20%, transparent); }
  .dash .pill.neutral { background: var(--muted); border-color: var(--border); }
  .dash .pill.solid { background: var(--primary); color: var(--primary-foreground); border-color: transparent; }

  /* ----- data table ----- */
  .dt { display: flex; flex-direction: column; gap: 16px; }
  .dt-bar { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
  .dt-bar .lft { display: flex; align-items: center; gap: 8px; flex: 1; flex-wrap: wrap; }
  .dt-bar .dt-q { height: 32px; width: 250px; max-width: 100%; }
  .dt-bar .dt-reset { display: none; } .dt.filtered .dt-reset { display: inline-flex; }
  .tbl-wrap { overflow-x: auto; border: 1px solid var(--border); border-radius: calc(var(--radius) - 2px); }
  .dash .table { width: 100%; border-collapse: collapse; font-size: 14px; caption-side: bottom; }
  .dash .table th { height: 40px; padding: 0 8px; text-align: left; vertical-align: middle; font-size: 14px; font-weight: 500; letter-spacing: 0; text-transform: none; color: var(--foreground); background: transparent; border-bottom: 1px solid var(--border); white-space: nowrap; border-radius: 0 !important; }
  .dash .table th:first-child, .dash .table td:first-child { padding-left: 12px; } .dash .table th:last-child, .dash .table td:last-child { padding-right: 12px; }
  .dash .table td { padding: 8px; border-bottom: 1px solid var(--border); vertical-align: middle; font-size: 14px; }
  .dash .table tbody tr:last-child td { border-bottom: 0; }
  .dash .table tbody tr { transition: background 0.15s; } .dash .table tbody tr:hover { background: color-mix(in oklab, var(--muted) 50%, transparent); }
  .dash .table td small { color: var(--muted-foreground); font-size: 12px; }
  .dash .table td b { font-weight: 500; }
  .dt-foot { display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; padding: 0 8px; font-size: 14px; }
  .dt-foot .dt-count { color: var(--muted-foreground); flex: 1; white-space: nowrap; }
  .dt-foot .rpp { display: flex; align-items: center; gap: 8px; font-weight: 500; white-space: nowrap; } .dt-foot .rpp select { width: 70px; height: 32px; }
  .dt-foot .pg { display: flex; align-items: center; gap: 8px; font-weight: 500; white-space: nowrap; }
  .dt-foot .pg .dt-page { min-width: 100px; text-align: center; }
  .dt-foot .pg button { width: 32px; height: 32px; padding: 0; }
  .dt-foot .pg button:disabled { opacity: 0.5; pointer-events: none; }
  .dt .table tr[hidden] { display: none; }
  .p-thumb { width: 40px; height: 40px; object-fit: cover; border-radius: 6px; }
  .thumb-glyph { display: inline-grid; place-items: center; width: 40px; height: 40px; border-radius: 6px; background: var(--muted); color: var(--foreground); font-family: var(--font-display); font-weight: 500; }

  /* ----- charts ----- */
  .chart { width: 100%; height: auto; display: block; }
  .chart.sm { max-height: 240px; }
  .chart text { font-family: inherit; }
  .chart .bar { transition: opacity 0.15s; } .chart:hover .bar { opacity: 0.55; } .chart .bar:hover { opacity: 1; }
  .funnel { display: grid; gap: 12px; }
  .funnel-row { display: grid; grid-template-columns: 90px 1fr auto; align-items: center; gap: 12px; font-size: 14px; }
  .funnel-row i { display: block; height: 10px; border-radius: 5px; background: var(--primary); }
  .funnel-row b { color: var(--muted-foreground); font-weight: 500; white-space: nowrap; font-size: 13px; }
  .err-item { border-bottom: 1px solid var(--border); padding: 10px 0; }
  .err-item:last-child { border-bottom: 0; }
  .err-item summary { cursor: pointer; font-size: 14px; }
  .err-item summary small { color: var(--muted-foreground); margin-left: 8px; }
  .err-item .code { margin-top: 8px; }

  /* ----- products: gallery + studio ----- */
  .book-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 16px; }
  .book-card { display: flex; flex-direction: column; border-radius: var(--radius); border: 1px solid var(--border); background: var(--card); overflow: hidden; cursor: pointer; box-shadow: var(--shadow-xs); transition: box-shadow 0.2s, border-color 0.2s; }
  .book-card:hover { box-shadow: var(--shadow-sm); border-color: var(--ring); }
  .book-cover { position: relative; aspect-ratio: 4 / 3; background: var(--muted); }
  .book-cover img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .cover-glyph { height: 100%; display: grid; place-items: center; align-content: center; gap: 6px; color: var(--foreground); }
  .cover-glyph small { font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted-foreground); font-weight: 500; }
  .cover-glyph b { font-family: var(--font-display); font-weight: 500; font-size: 2.2rem; line-height: 1; }
  .book-cover .tag { position: absolute; top: 8px; right: 8px; padding: 2px 8px; border-radius: 6px; font-size: 11px; font-weight: 500; background: var(--primary); color: var(--primary-foreground); }
  .book-cover .tag.free { background: var(--ok); color: #fff; }
  .book-body { padding: 12px 12px 6px; display: grid; gap: 4px; }
  .book-body .meta { font-size: 12px; color: var(--muted-foreground); }
  .book-body h4 { font-family: inherit; font-weight: 600; font-size: 14px; line-height: 1.3; margin: 0; }
  .book-meta { display: flex; justify-content: space-between; gap: 6px; font-size: 12px; color: var(--muted-foreground); }
  .book-actions { margin-top: auto; display: flex; justify-content: space-between; align-items: center; padding: 8px 12px 12px; font-size: 14px; }
  .book-actions .link { font-size: 13px; }
  .stars { color: var(--chart-4); letter-spacing: 0.05em; font-size: 12px; } .stars i { font-style: normal; color: var(--border); }
  .studio { border-color: var(--ring) !important; }
  .studio-grid { display: grid; grid-template-columns: 280px 1fr; gap: 24px; }
  @media (max-width: 900px) { .studio-grid { grid-template-columns: 1fr; } }
  .studio-side { display: grid; gap: 16px; align-content: start; }
  .drop { border: 2px dashed var(--input); border-radius: var(--radius); padding: 8px; cursor: pointer; transition: border-color 0.2s, background 0.2s; }
  .drop:hover, .drop.over { border-color: var(--ring); background: var(--accent); }
  .drop-preview { aspect-ratio: 4 / 3; border-radius: calc(var(--radius) - 4px); background: var(--muted) center / cover no-repeat; display: grid; place-items: center; align-content: center; gap: 4px; text-align: center; padding: 14px; color: var(--foreground); }
  .drop.small .drop-preview { aspect-ratio: auto; padding: 18px 14px; }
  .drop-icon { color: var(--muted-foreground); }
  .drop-preview b { font-size: 14px; font-weight: 500; } .drop-preview small { font-size: 12px; color: var(--muted-foreground); }
  .drop-name { font-size: 12px; color: var(--muted-foreground); text-align: center; margin: 6px 0 0; min-height: 1em; }
  .rate { display: flex; gap: 2px; } .rate .star { line-height: 1; background: none; border: none; color: var(--border); cursor: pointer; padding: 2px; transition: color 0.15s, transform 0.15s; } .rate .star svg { fill: currentColor; } .rate .star.on { color: var(--chart-4); } .rate .star:hover { transform: scale(1.15); }
  .fs { border: 1px solid var(--border); border-radius: var(--radius); padding: 16px 16px 0; margin: 0 0 16px; }
  .fs legend { padding: 0 6px; font-size: 14px; font-weight: 600; color: var(--foreground); }
  .grid-3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
  @media (max-width: 720px) { .grid-3 { grid-template-columns: 1fr; } }
  .studio-actions { margin-top: 4px; }

  /* ----- mobile: sidebar becomes a sheet ----- */
  @media (max-width: 767px) {
    .sb { position: fixed; left: 0; top: 0; bottom: 0; z-index: 60; width: 18rem !important; transform: translateX(-100%); transition: transform 0.25s ease; border-right: 1px solid var(--border); background: var(--background); box-shadow: 0 25px 50px -12px rgb(0 0 0 / 0.25); }
    .dash.sb-open .sb { transform: none; }
    .dash.sb-collapsed .sb-label, .dash.sb-collapsed .sb-item span, .dash.sb-collapsed .sb-item .sb-badge, .dash.sb-collapsed .team .chev { display: flex; opacity: 1; height: auto; }
    .dash.sb-collapsed .team-txt { display: grid; }
    .dash.sb-collapsed .sb-label { height: 32px; padding: 0 8px; }
    .dash.sb-collapsed .sb-item, .dash.sb-collapsed .team, .dash.sb-collapsed .sb-user { width: 100%; padding: 0 8px; justify-content: flex-start; }
    .dash.sb-collapsed .team { padding: 8px; }
    .sb-scrim { display: block; position: fixed; inset: 0; z-index: 55; background: rgb(0 0 0 / 0.5); opacity: 0; pointer-events: none; transition: opacity 0.25s; }
    .dash.sb-open .sb-scrim { opacity: 1; pointer-events: auto; }
    .inset { margin: 0; border-radius: 0; box-shadow: none; }
    .hd { top: 0; border-radius: 0; padding: 12px; }
    .topnav { display: none; }
    .search-btn { width: 32px; padding: 0; justify-content: center; } .search-btn > svg { position: static; transform: none; } .search-btn span, .search-btn kbd { display: none; }
    .mn { padding: 16px 12px; }
    .dash .panel, .card, .kpi, .stat { padding: 16px; }
    .dt-foot { flex-direction: column-reverse; align-items: stretch; } .dt-foot .dt-count { text-align: center; }
  }
  @media (prefers-reduced-motion: reduce) { .sb, .inset, .menu.open { transition: none; animation: none; } }`;
  document.head.appendChild(style);

  const fmt = ms => new Date(ms).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const day = ms => new Date(ms).toISOString().slice(0, 10);
  const kb = n => (n / 1024).toFixed(1) + ' KB';
  const staffEmail = () => (staffSession() || {}).email || 'staff';
  const staffName = () => { const u = read('lww_staff_users', []).find(x => x.email === staffEmail()); return (u && u.name) || staffEmail().split('@')[0]; };
  const initialsOf = s => String(s || '').trim().split(/[\s@._-]+/).filter(Boolean).slice(0, 2).map(x => x[0].toUpperCase()).join('') || 'ST';
  const events = () => read('lww_events', []);
  const orders = () => read('lww_orders', []);
  const users = () => read('lww_users', []);
  /* ---------- the database is the source of truth ----------
     With the admin key saved (Settings → Server connection), orders, customers and entitlements are
     pulled from the server (/api/admin/*) into the same lww_* keys the dashboards render, so every
     section below shows what is really in SQLite instead of this browser's copy. */
  let syncedAt = 0, syncing = false;
  const adminKey = () => read('lww_admin_key', '');
  async function adminApi(method, path, body) {
    const r = await fetch(path, { method, headers: Object.assign({ 'x-admin-key': adminKey() }, body ? { 'Content-Type': 'application/json' } : {}), body: body ? JSON.stringify(body) : undefined, cache: 'no-store' });
    const out = await r.json().catch(() => ({})); if (!r.ok) throw new Error(out.error || ('HTTP ' + r.status)); return out;
  }
  async function syncFromServer(force) {
    if (!adminKey() || syncing || (!force && Date.now() - syncedAt < 30e3)) return false;
    syncing = true;
    try {
      const [o, u, e] = await Promise.all([adminApi('GET', '/api/admin/orders'), adminApi('GET', '/api/admin/users'), adminApi('GET', '/api/admin/entitlements')]);
      const STATUS = { created: 'pending', paid: 'paid', failed: 'cancelled', refunded: 'refunded', cancelled: 'cancelled' };
      save('lww_orders', o.orders.slice().reverse().map(x => ({ id: x.id, at: x.at, email: x.email, name: x.name, cls: x.cls, plan: x.plan, worksheet: x.worksheet, amount: x.totalInr, currency: x.currency, total: x.total, method: x.method === 'razorpay' ? 'Razorpay' : 'Demo gateway', payment: x.paymentId, coupon: x.coupon, status: STATUS[x.status] || x.status, address: x.address, server: true })));
      save('lww_users', u.users.map(x => ({ id: x.id, name: x.name, email: x.email, role: x.role, created: x.created_at, lastLogin: x.last_login_at, spent: x.spent_inr, orders: x.orders, active: x.active })));
      const subs = {}, owned = {};
      e.entitlements.forEach(x => { if (x.scope === 'class') (subs[x.email] = subs[x.email] || []).push({ cls: x.cls, plan: x.plan || 'm1', start: x.start, at: x.start, id: x.id, revoked: x.revoked }); else if (!(owned[x.email] || []).includes(x.worksheet)) (owned[x.email] = owned[x.email] || []).push(x.worksheet); });
      save('lww_subs', subs); save('lww_owned', owned);
      syncedAt = Date.now(); return true;
    } catch (err) { console.warn('admin sync: ' + err.message); syncedAt = Date.now() - 20e3; return false; }
    finally { syncing = false; }
  }
  const lastDays = n => { const out = []; for (let i = n - 1; i >= 0; i--) { const d = new Date(); d.setDate(d.getDate() - i); out.push(d.toISOString().slice(0, 10)); } return out; };

  /* ---------- charts (inline SVG, theme-aware) ---------- */
  function bars(series, labels, color, opts) {
    /* shadcn "Overview" bar chart: rounded bars in the theme colour, no axis lines, muted tick labels, hover titles */
    opts = opts || {}; color = color || 'var(--primary)';
    if (!series.length) return '<p class="cart-empty">No data yet.</p>';
    const W = 640, H = opts.h || 260, PL = 44, PR = 8, PT = 12, PB = 28, n = series.length, max = Math.max(1, ...series);
    const plotW = W - PL - PR, plotH = H - PT - PB, base = H - PB, slot = plotW / n, gap = Math.min(10, slot * 0.3), bw = slot - gap;
    const ticks = [0, 0.25, 0.5, 0.75, 1]; let lastLabel = null;
    const grid = ticks.map(f => { const yy = (base - f * plotH).toFixed(1), lab = Math.round(max * f); const txt = lab === lastLabel ? '' : `<text x="${PL - 8}" y="${yy}" dy="4" font-size="11" text-anchor="end" fill="var(--muted-foreground)">${(opts.prefix || '') + lab}</text>`; lastLabel = lab; return `<line x1="${PL}" x2="${W - PR}" y1="${yy}" y2="${yy}" stroke="var(--border)" stroke-dasharray="3 3"/>${txt}`; }).join('');
    const step = Math.ceil(n / 7), r = Math.min(4, bw / 2);
    const bar = (v, i) => { const x = PL + i * slot + gap / 2, h = Math.max(v > 0 ? 2 : 0, v / max * plotH), y = base - h; const d = h <= r ? `M${x} ${base}h${bw}v-${h}h-${bw}z` : `M${x} ${base}v-${(h - r).toFixed(1)}a${r} ${r} 0 0 1 ${r} -${r}h${(bw - 2 * r).toFixed(1)}a${r} ${r} 0 0 1 ${r} ${r}v${(h - r).toFixed(1)}z`; return `<path class="bar" d="${d}" fill="${color}"><title>${labels[i]}: ${(opts.prefix || '') + series[i]}</title></path>`; };
    return `<svg class="chart${opts.small ? ' sm' : ''}" viewBox="0 0 ${W} ${H}">${grid}${series.map(bar).join('')}${labels.map((l, i) => (i % step === 0 || i === n - 1 ? `<text x="${(PL + i * slot + slot / 2).toFixed(1)}" y="${H - 8}" font-size="11" text-anchor="middle" fill="var(--muted-foreground)">${l.length > 5 ? l.slice(5) : l}</text>` : '')).join('')}</svg>`;
  }
  function funnel(steps) {
    const max = Math.max(1, steps[0][1]);
    return `<div class="funnel">${steps.map(([l, v], i) => `<div class="funnel-row"><span>${l}</span><i style="width:${Math.max(4, v / max * 100)}%"></i><b>${v}${i ? ' · ' + Math.round(v / Math.max(1, steps[i - 1][1]) * 100) + '%' : ''}</b></div>`).join('')}</div>`;
  }

  /* ---------- layout ---------- */
  window.dashRender = function (kind, who) {
    const secs = kind === 'admin' ? ADMIN_SECTIONS : DEV_SECTIONS, cur = section[kind];
    const perms = permsOf(who), label = id => (secs.find(x => x[0] === id) || [])[1] || id;
    const counts = { orders: orders().filter(o => o.status === 'pending').length, errors: read('lww_errors', []).length, security: read('lww_security', []).length };
    const item = id => `<button type="button" class="sb-item${id === cur ? ' on' : ''}${perms.includes(id) || kind === 'developer' || id === 'overview' || id === 'settings' ? '' : ' off'}" data-dash="${id}" title="${esc(label(id))}">${ico(id)}<span>${esc(label(id))}</span>${counts[id] ? `<span class="sb-badge">${counts[id]}</span>` : ''}</button>`;
    const nav = GROUPS[kind].map(([g, ids]) => `<div class="sb-group"><div class="sb-label">${g}</div><nav class="sb-menu">${ids.map(item).join('')}</nav></div>`).join('')
      + `<div class="sb-group"><div class="sb-label">Other</div><nav class="sb-menu"><button type="button" class="sb-item" data-dash-go="${kind === 'admin' ? 'developer' : 'admin'}" title="${kind === 'admin' ? 'Developer panel' : 'Admin panel'}">${ico(kind === 'admin' ? 'api' : 'overview')}<span>${kind === 'admin' ? 'Developer panel' : 'Admin panel'}</span></button><button type="button" class="sb-item" data-portal-close title="Back to the site">${ico('home')}<span>Back to the site</span></button></nav></div>`;
    let main = '';
    try { main = (kind === 'admin' ? ADMIN[cur] : DEV[cur])(); } catch (err) { main = '<section class="panel"><p class="cart-empty">Could not render this section: ' + esc(err.message) + '</p></section>'; }
    const name = staffName(), email = staffEmail(), ini = initialsOf(name);
    const first = kind === 'admin' ? 'overview' : 'health';
    const topnav = kind === 'admin'
      ? [['overview', 'Overview'], ['customers', 'Customers'], ['products', 'Products'], ['settings', 'Settings']]
      : [['health', 'Overview'], ['errors', 'Errors'], ['api', 'API'], ['deploy', 'Deployments']];
    const userBlock = `<span class="av">${esc(ini)}</span><span class="team-txt"><b>${esc(name)}</b><small>${esc(email)}</small></span>`;
    return `<div class="dash${theme === 'dark' ? ' dark' : ''}${collapsed ? ' sb-collapsed' : ''}${mobileOpen ? ' sb-open' : ''}">
      <div class="sb-scrim" data-sb-close></div>
      <aside class="sb" aria-label="Sidebar">
        <div class="sb-head"><button type="button" class="team" data-dash="${first}"><span class="team-logo">LW</span><span class="team-txt"><b>Learn With Why</b><small>${kind === 'admin' ? 'Admin panel' : 'Developer panel'}</small></span><span class="chev">${ico('chevrons', 16)}</span></button></div>
        <div class="sb-content">${nav}</div>
        <div class="sb-foot"><button type="button" class="team sb-user" data-menu="userMenu">${userBlock}<span class="chev">${ico('chevrons', 16)}</span></button></div>
      </aside>
      <div class="inset">
        <header class="hd">
          <button type="button" class="btn btn-ghost btn-ic" data-sb-toggle aria-label="Toggle sidebar" style="width:28px;height:28px">${ico('panel')}</button>
          <span class="vsep"></span>
          <nav class="topnav">${topnav.map(([id, l]) => `<button type="button"${id === cur ? ' class="on"' : ''} data-dash="${id}">${l}</button>`).join('')}</nav>
          <span class="hd-spacer"></span>
          <button type="button" class="search-btn" data-dash-search>${ico('search', 16)}<span>Search</span><kbd><span style="font-size:12px">⌘</span>K</kbd></button>
          <div class="hd-right">
            <button type="button" class="btn btn-ghost btn-plain btn-ic" data-theme-toggle aria-label="Toggle theme">${ico(theme === 'dark' ? 'moon' : 'sun', 18)}</button>
            <button type="button" class="av-btn" data-menu="profileMenu" aria-label="Account">${esc(ini)}</button>
          </div>
          <div class="menu" id="profileMenu" style="right:16px;top:56px">
            <div class="menu-label">${userBlock}</div><div class="menu-sep"></div>
            <button type="button" class="menu-item" data-dash="${kind === 'admin' ? 'roles' : 'health'}">${ico('roles')}Account</button>
            <button type="button" class="menu-item" data-dash-go="${kind === 'admin' ? 'developer' : 'admin'}">${ico(kind === 'admin' ? 'api' : 'overview')}${kind === 'admin' ? 'Developer panel' : 'Admin panel'}</button>
            <button type="button" class="menu-item" data-portal-close>${ico('home')}Back to the site</button>
            <div class="menu-sep"></div>
            <button type="button" class="menu-item danger" data-portal-out>${ico('logout')}Sign out</button>
          </div>
        </header>
        <div class="menu user-menu" id="userMenu">
          <div class="menu-label">${userBlock}</div><div class="menu-sep"></div>
          <button type="button" class="menu-item" data-dash="${kind === 'admin' ? 'roles' : 'health'}">${ico('roles')}Account</button>
          <button type="button" class="menu-item" data-portal-close>${ico('home')}Back to the site</button>
          <div class="menu-sep"></div>
          <button type="button" class="menu-item danger" data-portal-out>${ico('logout')}Sign out</button>
        </div>
        <main class="mn">
          <div class="mn-head"><div><h1>${esc(label(cur))}</h1><p>${esc(DESC[cur] || '')}</p></div><div class="mn-actions">${headActions(kind, cur)}</div></div>
          ${main}
        </main>
        <footer class="ft"><span>Learn With Why · ${kind === 'admin' ? 'Admin' : 'Developer'} · v${SITE_VERSION}</span><span>${new Date().toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</span></footer>
      </div></div>`;
  };
  function headActions(kind, cur) {
    if (kind === 'admin' && cur === 'overview') return `<button type="button" class="btn btn-primary" data-adm="backup">Download</button>`;
    if (cur === 'products') return `<button type="button" class="btn btn-ghost" data-adm="backup">${ico('download')}Export</button><button type="button" class="btn btn-primary" data-adm="product-new">${ico('plus')}Upload new book</button>`;
    if (cur === 'customers' || cur === 'orders' || cur === 'audit' || cur === 'analytics') return `<button type="button" class="btn btn-ghost" data-adm="backup">${ico('download')}Export</button>`;
    if (cur === 'backups') return `<button type="button" class="btn btn-primary" data-adm="backup">${ico('download')}Download backup</button>`;
    if (cur === 'errors') return `<button type="button" class="btn btn-ghost" data-adm="throw">Throw a test error</button>`;
    return '';
  }
  function permsOf(who) { const roles = read('lww_roles', DEFAULT_ROLES), staff = read('lww_staff_users', []).find(u => u.email === (who || {}).email); const r = (staff && staff.rolename) || ((who || {}).kind === 'developer' ? 'developer' : 'admin'); return roles[r] || []; }
  function rerender() { renderPortal(); }
  function save(key, val) { write(key, val); }
  function log(action, detail) { audit(staffEmail(), action, detail); }

  /* =================================================================
     ADMIN
     ================================================================= */
  const ADMIN = {};
  ADMIN.overview = () => {
    const os = orders(), good = os.filter(o => o.status !== 'cancelled' && o.status !== 'refunded'), rev = good.reduce((n, o) => n + o.amount, 0);
    const ev = events(), subs = Object.values(read('lww_subs', {})).flat().filter(x => !x.revoked);
    const days = lastDays(14), salesS = days.map(d => os.filter(o => day(o.at) === d).reduce((n, o) => n + o.amount, 0)), visitS = days.map(d => ev.filter(e => e.type === 'visit' && day(e.at) === d).length);
    const delta = (arr, unit) => { const a = arr.slice(-7).reduce((n, v) => n + v, 0), b = arr.slice(-14, -7).reduce((n, v) => n + v, 0); return b ? (a >= b ? '+' : '') + Math.round((a - b) / b * 100) + '% from last week' : (a ? '+' + a + (unit || '') + ' this week' : 'No change'); };
    const today = ev.filter(e => e.type === 'visit' && day(e.at) === day(Date.now())).length, hour = ev.filter(e => e.type === 'visit' && e.at > Date.now() - 36e5).length;
    const recent = os.slice(-5).reverse();
    return `<div class="tabs-s"><button type="button" class="on">Overview</button><button type="button" data-dash="analytics">Analytics</button><button type="button" disabled>Reports</button><button type="button" disabled>Notifications</button></div>
      <div class="kpi-row">${kpi('Total Revenue', money(rev), delta(salesS), 'rupee')}${kpi('Subscriptions', '+' + subs.length, subs.length ? 'across ' + new Set(subs.map(x => x.cls)).size + (new Set(subs.map(x => x.cls)).size === 1 ? ' class' : ' classes') : 'None active yet', 'users')}${kpi('Sales', '+' + good.length, delta(days.map(d => os.filter(o => day(o.at) === d).length)), 'card')}${kpi('Active Now', '+' + today, '+' + hour + ' since last hour', 'activity')}</div>
      <div class="grid-7">
        <section class="panel span-4"><p class="eyebrow">Overview</p>${bars(salesS, days, 'var(--primary)', { prefix: '₹' })}</section>
        <section class="panel span-3"><p class="eyebrow">Recent Sales</p><p class="auth-sub">You made ${good.length} ${good.length === 1 ? 'sale' : 'sales'} in total.</p>
          ${recent.length ? `<div class="sales">${recent.map(o => `<div class="sale"><span class="av round">${esc(initialsOf(o.name || o.email))}</span><div class="who"><div><p class="nm">${esc(o.name || o.email.split('@')[0])}</p><p class="em">${esc(o.email)}</p></div><span class="amt">+${money(o.amount)}</span></div></div>`).join('')}</div>` : '<p class="cart-empty">No sales yet — they appear here when a customer subscribes.</p>'}</section>
      </div>
      <section class="panel"><p class="eyebrow">Latest orders</p><p class="auth-sub">The six most recent orders. Open Orders to change a status.</p>${table(['Order', 'Customer', 'Class · plan', 'Amount', 'Status', 'When'], os.slice(-6).reverse().map(o => [`<b>${o.id}</b>`, esc(o.email), esc(classById(o.cls).label) + ' · ' + planOf(o.plan).label, money(o.amount), pill(o.status), fmt(o.at)]), 'No orders yet.', { plain: true })}</section>`;
  };

  /* ----- products: a card gallery + an organised "Upload new book" studio ----- */
  let pFilter = 'all', pQuery = '';
  ADMIN.products = () => {
    let list = ITEMS.slice();
    if (pFilter !== 'all') list = list.filter(it => it.cls === pFilter);
    if (pQuery) list = list.filter(it => (it.title + ' ' + it.subject + ' ' + (it.blurb || '')).toLowerCase().includes(pQuery));
    const form = editing ? productForm(editing === 'new' ? {} : itemById(editing)) : '';
    const free = ITEMS.filter(i => i.price === 0).length, withPdf = ITEMS.filter(i => i.pdf).length;
    return `${form}
      <div class="kpi-row">${kpi('Books & sheets', ITEMS.length, 'on the shelf', 'book')}${kpi('Free', free, 'free access sheets', 'star')}${kpi('In class plans', ITEMS.length - free, 'open with a subscription', 'card')}${kpi('With PDF', withPdf, 'real file attached', 'file')}</div>
      <section class="panel">
        <div class="row-between"><div><p class="eyebrow">Books on the shelf</p><p class="auth-sub">${list.length} shown · click a card to edit</p></div>
          <div class="btn-row"><input class="search" type="search" placeholder="Filter books…" value="${esc(pQuery)}" data-adm-search></div></div>
        <div class="tabs-s"><button type="button" class="${pFilter === 'all' ? 'on' : ''}" data-adm="product-filter" data-id="all">All <small>${ITEMS.length}</small></button>${CLASSES.map(c => `<button type="button" class="${pFilter === c.id ? 'on' : ''}" data-adm="product-filter" data-id="${c.id}">${esc(c.label)} <small>${ITEMS.filter(i => i.cls === c.id).length}</small></button>`).join('')}</div>
        ${list.length ? `<div class="book-grid">${list.map(bookCard).join('')}</div>` : '<p class="cart-empty">No books match.</p>'}
      </section>`;
  };
  function bookCard(it) {
    const cover = it.image ? `<img src="${it.image}" alt="">` : `<div class="cover-glyph"><small>${esc(it.subject)}</small><b>${esc(it.glyph)}</b></div>`;
    return `<article class="book-card" data-adm="product-edit" data-id="${it.id}" tabindex="0">
      <div class="book-cover">${cover}${it.price === 0 ? '<span class="tag free">Free</span>' : '<span class="tag">Plan</span>'}</div>
      <div class="book-body">
        <p class="meta">${esc(it.cls ? classById(it.cls).label : '')} · ${esc(it.subject)}</p>
        <h4>${esc(it.title)}</h4>
        <div class="book-meta"><span>${stars(it.rating || 0)}</span><span>${it.pages || '?'} pg</span><span>${it.stock == null ? '∞' : it.stock + ' left'}</span></div>
        <div class="book-meta"><span>${it.pdf ? 'PDF attached' : '<i style="color:var(--destructive)">no PDF</i>'}</span><span>${esc(it.ageGroup || it.ages || '')}</span><span>${({ parent: 'Parents', teacher: 'Teachers', both: 'Everyone' })[it.audience || 'both']}</span></div>
      </div>
      <div class="book-actions"><b>${it.price === 0 ? 'Free' : money(it.price)}</b><span><button type="button" class="link" data-adm="product-edit" data-id="${it.id}">Edit</button><button type="button" class="link btn-danger" data-adm="product-delete" data-id="${it.id}">Delete</button></span></div>
    </article>`;
  }
  function stars(n) { return '<span class="stars" title="' + n + ' / 5">' + '★'.repeat(Math.round(n)) + '<i>' + '★'.repeat(5 - Math.round(n)) + '</i></span>'; }
  function productForm(it) {
    const v = k => esc(it[k] == null ? '' : it[k]);
    const subj = it.subjectId || (SUBJECTS.find(y => y.label === it.subject) || {}).id;
    return `<section class="panel studio"><div class="row-between"><div><p class="eyebrow">${it.id ? 'Edit book' : 'Upload new book'}</p><p class="auth-sub">${it.id ? esc(it.title) : 'Drop the cover and the PDF, fill in the details, save — it goes straight on the shelf.'}</p></div><button type="button" class="icon-btn" data-adm="product-cancel" aria-label="Close">${ico('x')}</button></div>
    <form id="productForm" data-id="${it.id || ''}" class="studio-grid">
      <div class="studio-side">
        <div class="drop" id="dropImage" data-drop="image"><input type="file" name="image" accept="image/*" hidden>
          <div class="drop-preview" ${it.image ? 'style="background-image:url(' + it.image + ')"' : ''}>${it.image ? '' : '<span class="drop-icon">' + ico('image', 28) + '</span><b>Drop the cover photo here</b><small>or click to choose · JPG / PNG · up to 600 KB</small>'}</div>
          <p class="drop-name">${it.image ? 'Cover set — drop a new one to replace it' : ''}</p></div>
        <div class="drop small" id="dropPdf" data-drop="pdf"><input type="file" name="pdf" accept="application/pdf" hidden>
          <div class="drop-preview"><span class="drop-icon">${ico('file', 24)}</span><b>${it.pdf ? esc(it.pdf.name) : 'Drop the PDF here'}</b><small>${it.pdf ? kb(it.pdf.size) + ' · drop a new file to replace' : 'or click to choose · up to 1.5 MB'}</small></div>
          <p class="drop-name"></p></div>
        <div class="field"><label>Rating (shown as stars)</label><div class="rate" data-rate><input type="hidden" name="rating" value="${it.rating || 0}">${[1, 2, 3, 4, 5].map(n => `<button type="button" class="star${(it.rating || 0) >= n ? ' on' : ''}" data-star="${n}" aria-label="${n} star">${ico('star', 22)}</button>`).join('')}</div></div>
      </div>
      <div class="studio-main">
        <fieldset class="fs"><legend>Book details</legend>
          <div class="field"><label>Title</label><input name="title" value="${v('title')}" placeholder="e.g. Alphabet explorers" required></div>
          <div class="field"><label>Description</label><textarea name="blurb" placeholder="One or two lines parents will read on the card">${v('blurb')}</textarea></div>
          <div class="grid-3"><div class="field"><label>Cover glyph</label><input name="glyph" value="${v('glyph')}" placeholder="Aa"></div><div class="field"><label>Pages</label><input name="pages" type="number" min="1" value="${it.pages || 8}"></div><div class="field"><label>Age group</label><input name="ageGroup" value="${v('ageGroup') || v('ages')}" placeholder="4–6 years"></div></div>
        </fieldset>
        <fieldset class="fs"><legend>Category</legend>
          <div class="grid-3"><div class="field"><label>Class</label><select name="cls">${CLASSES.map(c => `<option value="${c.id}"${c.id === (it.cls || 'nursery') ? ' selected' : ''}>${c.label}</option>`).join('')}</select></div>
          <div class="field"><label>Subject</label><select name="subjectId">${SUBJECTS.map(x => `<option value="${x.id}"${x.id === subj ? ' selected' : ''}>${x.label}</option>`).join('')}</select></div>
          <div class="field"><label>Topic (Kindergarten shelf)</label><select name="topic"><option value="">— none —</option>${(typeof KG_TOPICS !== 'undefined' ? KG_TOPICS : []).map(g => `<optgroup label="${esc(g.title)}">${g.items.map(([id, l]) => `<option value="${id}"${it.topic === id ? ' selected' : ''}>${esc(l)}</option>`).join('')}</optgroup>`).join('')}</select><small>Files the sheet under a skill in Sheets → Kindergarten</small></div>
          <div class="field"><label>For</label><select name="audience"><option value="both"${(it.audience || 'both') === 'both' ? ' selected' : ''}>Parents & teachers</option><option value="parent"${it.audience === 'parent' ? ' selected' : ''}>Parents</option><option value="teacher"${it.audience === 'teacher' ? ' selected' : ''}>Teachers</option></select></div></div>
        </fieldset>
        <fieldset class="fs"><legend>Price & stock</legend>
          <div class="grid-3"><div class="field"><label>Price ₹</label><input name="price" type="number" min="0" value="${it.price == null ? 0 : it.price}"><small>0 = free access sheet · anything else = part of the class plan</small></div>
          <div class="field"><label>Stock</label><input name="stock" type="number" min="0" value="${it.stock == null ? '' : it.stock}" placeholder="unlimited"></div>
          <div class="field"><label>Old price ₹ (optional)</label><input name="was" type="number" min="0" value="${it.was || ''}" placeholder="shows struck through"></div></div>
        </fieldset>
        <fieldset class="fs"><legend>Limits per customer</legend>
          <div class="grid-3"><div class="field"><label>Print limit</label><input name="printLimit" type="number" min="0" value="${it.printLimit || ''}" placeholder="unlimited"></div>
          <div class="field"><label>Download limit</label><input name="downloadLimit" type="number" min="0" value="${it.downloadLimit || ''}" placeholder="unlimited"></div></div>
        </fieldset>
        <div class="btn-row studio-actions"><button type="submit" class="btn btn-primary">${it.id ? 'Save changes' : 'Publish to the shelf'}</button><button type="button" class="btn btn-ghost" data-adm="product-cancel">Cancel</button>${it.id ? `<button type="button" class="btn btn-ghost btn-danger" style="margin-left:auto" data-adm="product-delete" data-id="${it.id}">${ico('trash')}Delete book</button>` : ''}</div>
      </div>
    </form></section>`;
  }
  function readFile(file, max) { return new Promise(res => { if (!file) return res(null); if (file.size > max) { toast('File too large for the demo (' + kb(file.size) + ') — keeping the name only'); return res({ name: file.name, size: file.size }); } const r = new FileReader(); r.onload = () => res({ name: file.name, size: file.size, data: r.result }); r.readAsDataURL(file); }); }
  async function saveProduct(form) {
    const f = new FormData(form), id = form.dataset.id || ('p-' + Date.now().toString(36));
    const o = read('lww_products', { added: [], edited: {}, deleted: [] });
    const fields = { title: f.get('title').trim(), glyph: f.get('glyph').trim() || '✎', cls: f.get('cls'), subjectId: f.get('subjectId'), subject: subjectById(f.get('subjectId')).label, price: Math.max(0, parseInt(f.get('price'), 10) || 0), was: parseInt(f.get('was'), 10) || null, stock: f.get('stock') === '' ? null : parseInt(f.get('stock'), 10), pages: parseInt(f.get('pages'), 10) || 8, ageGroup: f.get('ageGroup').trim(), audience: f.get('audience'), topic: String(f.get('topic') || ''), rating: parseFloat(f.get('rating')) || 0, printLimit: parseInt(f.get('printLimit'), 10) || 0, downloadLimit: parseInt(f.get('downloadLimit'), 10) || 0, blurb: f.get('blurb').trim() };
    if (!fields.title) return toast('Give the book a title');
    const img = await readFile(f.get('image') && f.get('image').size ? f.get('image') : null, 600 * 1024); if (img && img.data) fields.image = img.data;
    const pdf = await readFile(f.get('pdf') && f.get('pdf').size ? f.get('pdf') : null, 1500 * 1024); if (pdf) fields.pdf = { name: pdf.name, size: pdf.size, data: pdf.data || null };
    const it = itemById(id);
    if (it) { Object.assign(it, fields); if (o.added.some(x => x.id === id)) o.added = o.added.map(x => x.id === id ? it : x); else o.edited[id] = Object.assign(o.edited[id] || {}, fields); log('book edited', fields.title); }
    else { const np = Object.assign({ id, kind: 'sheet', ages: fields.ageGroup, skills: [], bullets: [] }, fields); CATALOGUE.push(np); ITEMS.push(np); o.added.push(np); log('book uploaded', fields.title); }
    try { save('lww_products', o); } catch (err) { return toast('Storage is full — use a smaller image or PDF'); }
    editing = null; renderPlayer(); renderWorksheets(); rerender(); toast(it ? 'Saved' : 'Published — it is on the shelf now');
  }
  function deleteProduct(id) {
    const it = itemById(id); if (!it || !confirm('Delete "' + it.title + '"?')) return;
    const o = read('lww_products', { added: [], edited: {}, deleted: [] });
    if (o.added.some(x => x.id === id)) o.added = o.added.filter(x => x.id !== id); else if (!o.deleted.includes(id)) o.deleted.push(id);
    delete o.edited[id]; save('lww_products', o);
    [CATALOGUE, SHEETS, WORKSHEETS, ITEMS].forEach(a => { const i = a.findIndex(x => x.id === id); if (i >= 0) a.splice(i, 1); });
    editing = null; log('book deleted', it.title); renderPlayer(); renderWorksheets(); rerender(); toast('Deleted');
  }
  /* drag & drop + stars, wired after each render */
  function wireStudio() {
    document.querySelectorAll('.drop').forEach(zone => {
      const input = zone.querySelector('input[type=file]'), prev = zone.querySelector('.drop-preview'), name = zone.querySelector('.drop-name');
      const show = file => { if (!file) return; name.textContent = file.name + ' · ' + kb(file.size); if (zone.dataset.drop === 'image' && file.type.startsWith('image/')) { const r = new FileReader(); r.onload = () => { prev.style.backgroundImage = 'url(' + r.result + ')'; prev.innerHTML = ''; }; r.readAsDataURL(file); } else if (zone.dataset.drop === 'pdf') { prev.querySelector('b').textContent = file.name; } };
      zone.addEventListener('click', e => { if (!e.target.closest('input')) input.click(); });
      input.addEventListener('change', () => show(input.files[0]));
      ['dragenter', 'dragover'].forEach(ev => zone.addEventListener(ev, e => { e.preventDefault(); zone.classList.add('over'); }));
      ['dragleave', 'drop'].forEach(ev => zone.addEventListener(ev, e => { e.preventDefault(); zone.classList.remove('over'); }));
      zone.addEventListener('drop', e => { const f = e.dataTransfer.files[0]; if (!f) return; const ok = zone.dataset.drop === 'image' ? f.type.startsWith('image/') : f.type === 'application/pdf'; if (!ok) { toast(zone.dataset.drop === 'image' ? 'Drop an image file' : 'Drop a PDF file'); return; } const dt = new DataTransfer(); dt.items.add(f); input.files = dt.files; show(f); });
    });
    const rate = document.querySelector('[data-rate]'); if (rate) rate.addEventListener('click', e => { const b = e.target.closest('[data-star]'); if (!b) return; const n = +b.dataset.star; rate.querySelector('input').value = n; rate.querySelectorAll('.star').forEach(x => x.classList.toggle('on', +x.dataset.star <= n)); });
    const search = document.querySelector('[data-adm-search]'); if (search) { search.addEventListener('input', () => { pQuery = search.value.trim().toLowerCase(); const grid = document.querySelector('.book-grid'); if (!grid) return; let list = ITEMS.slice(); if (pFilter !== 'all') list = list.filter(it => it.cls === pFilter); if (pQuery) list = list.filter(it => (it.title + ' ' + it.subject + ' ' + (it.blurb || '')).toLowerCase().includes(pQuery)); grid.innerHTML = list.map(bookCard).join(''); }); }
  }

  /* ----- orders ----- */
  ADMIN.orders = () => {
    const os = orders().slice().reverse(), counts = ORDER_STATUS.map(st => [st, os.filter(o => o.status === st).length]);
    return `<div class="kpi-row" style="grid-template-columns:repeat(auto-fit,minmax(110px,1fr))">${counts.map(([st, n]) => `<div class="stat"><b>${n}</b><span>${st}</span></div>`).join('')}</div>
      <section class="panel"><p class="eyebrow">Orders · ${os.length}</p><p class="auth-sub">${adminKey() ? 'Live from the database' + (syncedAt ? ' · synced ' + fmt(syncedAt) : '') + '.' : 'Showing this browser\'s copy — save the admin key under Settings → Server connection to load the database.'} Orders are digital, so a verified payment goes straight to <b>paid</b>. Change a status and it is written to the audit log.</p>
      ${table(['Order', 'When', 'Customer', 'Class · plan', 'Gateway', 'Amount', 'Status'], os.map(o => [`<b>${o.id}</b>`, fmt(o.at), esc(o.name) + '<br><small>' + esc(o.email) + '</small>', (o.worksheet ? 'PDF · ' + esc((itemById(o.worksheet) || { title: o.worksheet }).title) : esc((classById(o.cls) || { label: o.cls }).label) + ' · ' + planOf(o.plan).label) + (o.coupon ? '<br><small>coupon ' + esc(o.coupon) + '</small>' : ''), esc(o.method), money(o.amount), `<select data-adm="order-status" data-id="${o.id}">${ORDER_STATUS.map(st => `<option value="${st}"${st === o.status ? ' selected' : ''}>${st}</option>`).join('')}</select>`]), 'No orders yet — they appear when a customer subscribes.', { filter: 'Filter orders…' })}</section>`;
  };

  /* ----- customers ----- */
  ADMIN.customers = () => {
    const us = users(), subsAll = read('lww_subs', {}), os = orders(), prints = read('lww_prints', {}), ownedAll = read('lww_owned', {});
    const detail = custOpen && us.find(u => u.email === custOpen);
    return `${detail ? customerCard(detail, subsAll, os, prints, ownedAll) : ''}<section class="panel"><p class="eyebrow">Customer list · ${us.length}</p><p class="auth-sub">Every account that signed up on the site.</p>
      ${table(['Name', 'Email', 'Role', 'Subscriptions', 'Orders', 'Total spent', 'Downloads', 'Prints', ''], us.map(u => { const uo = os.filter(o => o.email === u.email), act = (subsAll[u.email] || []).filter(x => !x.revoked); return [`<span style="display:inline-flex;align-items:center;gap:8px"><span class="av round" style="width:28px;height:28px;font-size:11px">${esc(initialsOf(u.name))}</span><b>${esc(u.name)}</b></span>`, esc(u.email), pill(roleOf(u.role).label, 'neutral'), act.length ? act.map(x => pill(classById(x.cls).label, 'ok')).join(' ') : pill('none', 'neutral'), uo.length, money(uo.reduce((n, o) => n + o.amount, 0)), (ownedAll[u.email] || []).length, Object.values(prints[u.email] || {}).reduce((n, v) => n + v, 0), `<button type="button" class="link" data-adm="customer-open" data-id="${esc(u.email)}">Profile</button>`]; }), 'No customers yet.', { filter: 'Filter customers…' })}</section>`;
  };
  function customerCard(u, subsAll, os, prints, ownedAll) {
    const uo = os.filter(o => o.email === u.email), pu = prints[u.email] || {};
    return `<section class="panel"><div class="row-between"><div style="display:flex;align-items:center;gap:12px"><span class="av round" style="width:40px;height:40px;font-size:14px">${esc(initialsOf(u.name))}</span><div><h3 class="card-title">${esc(u.name)}</h3><p class="auth-sub">${esc(u.email)} · ${roleOf(u.role).label} · joined ${fmt(u.created || Date.now())}</p></div></div><button type="button" class="icon-btn" data-adm="customer-close" aria-label="Close">${ico('x')}</button></div>
      <div class="kpi-row">${kpi('Orders', uo.length, '', 'orders')}${kpi('Total spending', money(uo.reduce((n, o) => n + o.amount, 0)), '', 'rupee')}${kpi('Downloads', (ownedAll[u.email] || []).length, '', 'download')}${kpi('Prints', Object.values(pu).reduce((n, v) => n + v, 0), '', 'file')}</div>
      <div class="grid-2"><div><p class="eyebrow" style="margin-bottom:8px">Subscriptions</p>${table(['Class', 'Plan', 'Since', 'Status'], (subsAll[u.email] || []).map(x => [esc(classById(x.cls).label), planOf(x.plan).label, fmt(x.start || x.at), pill(x.revoked ? 'revoked' : 'active', x.revoked ? 'bad' : 'ok')]), 'None.', { plain: true })}</div>
      <div><p class="eyebrow" style="margin-bottom:8px">Orders</p>${table(['Order', 'When', 'Amount', 'Status'], uo.map(o => [o.id, fmt(o.at), money(o.amount), pill(o.status)]), 'None.', { plain: true })}</div></div>
      <div><p class="eyebrow" style="margin-bottom:8px">Print usage</p>${table(['Sheet', 'Prints'], Object.keys(pu).map(id => [esc((itemById(id) || { title: id }).title), pu[id]]), 'Nothing printed yet.', { plain: true })}</div></section>`;
  }

  /* ----- analytics ----- */
  ADMIN.analytics = () => {
    const ev = events(), os = orders(), days = lastDays(14);
    const visits = days.map(d => ev.filter(e => e.type === 'visit' && day(e.at) === d).length), sales = days.map(d => os.filter(o => day(o.at) === d).reduce((n, o) => n + o.amount, 0));
    const v = ev.filter(e => e.type === 'visit').length, su = ev.filter(e => e.type === 'signup').length, sub = os.length;
    const top = {}; ev.filter(e => e.type === 'print' || e.type === 'download').forEach(e => { top[e.item] = (top[e.item] || 0) + 1; });
    const topList = Object.entries(top).sort((a, b) => b[1] - a[1]).slice(0, 8);
    const refs = {}; ev.filter(e => e.type === 'visit').forEach(e => { refs[e.ref || 'direct'] = (refs[e.ref || 'direct'] || 0) + 1; });
    return `<div class="tabs-s"><button type="button" data-dash="overview">Overview</button><button type="button" class="on">Analytics</button><button type="button" disabled>Reports</button><button type="button" disabled>Notifications</button></div>
      <div class="kpi-row">${kpi('Visits', v, 'all time', 'activity')}${kpi('Sign-ups', su, 'customer accounts', 'users')}${kpi('Subscriptions', sub, 'orders placed', 'card')}${kpi('Conversion', (v ? (sub / v * 100).toFixed(1) : 0) + '%', 'visits → subscriptions', 'analytics')}</div>
      <div class="grid-2"><section class="panel"><p class="eyebrow">Sales</p><p class="auth-sub">₹ per day · last 14 days</p>${bars(sales, days, 'var(--primary)', { prefix: '₹', small: true })}</section><section class="panel"><p class="eyebrow">Visitors</p><p class="auth-sub">Visits per day · last 14 days</p>${bars(visits, days, 'var(--chart-2)', { small: true })}</section></div>
      <div class="grid-2"><section class="panel"><p class="eyebrow">Conversion funnel</p>${funnel([['Visited', v], ['Signed up', su], ['Subscribed', sub]])}</section>
      <section class="panel"><p class="eyebrow">Top products</p><p class="auth-sub">Opens and prints</p>${table(['Product', 'Uses'], topList.map(([id, n]) => [esc((itemById(id) || { title: id }).title), n]), 'No activity yet.', { plain: true })}</section></div>
      <section class="panel"><p class="eyebrow">Where visitors come from</p>${table(['Source', 'Visits'], Object.entries(refs).sort((a, b) => b[1] - a[1]).map(([r, n]) => [esc(r), n]), 'No visits logged.', { plain: true })}</section>`;
  };

  /* ----- coupons & discounts ----- */
  ADMIN.coupons = () => {
    const cps = read('lww_coupons', []), ds = read('lww_discounts', {});
    return `<section class="panel"><p class="eyebrow">Coupons</p><p class="auth-sub">Customers type the code at checkout.</p><form id="couponForm" class="row-form"><input name="code" placeholder="CODE" style="text-transform:uppercase" required><input name="pct" type="number" min="1" max="100" placeholder="% off" required><input name="max" type="number" min="0" placeholder="Max uses (blank = ∞)"><button type="submit" class="btn btn-primary">${ico('plus')}Add coupon</button></form>
      ${table(['Code', '% off', 'Uses', 'Active', ''], cps.map(c => [`<b>${esc(c.code)}</b>`, c.pct + '%', (c.uses || 0) + (c.max ? ' / ' + c.max : ''), `<label class="check"><input type="checkbox" data-adm="coupon-toggle" data-id="${esc(c.code)}"${c.active !== false ? ' checked' : ''}> on</label>`, `<button type="button" class="link btn-danger" data-adm="coupon-delete" data-id="${esc(c.code)}">Delete</button>`]), 'No coupons yet.', { plain: true })}</section>
      <section class="panel"><p class="eyebrow">Discounts</p><p class="auth-sub">% off a class plan — shows as a struck-through price at checkout.</p>
      ${table(['Class', 'Discount %'], CLASSES.map(c => [esc(c.label), `<input type="number" min="0" max="90" value="${ds[c.id] || 0}" data-adm="discount" data-id="${c.id}">`]), '', { plain: true })}</section>`;
  };

  /* ----- content ----- */
  ADMIN.content = () => {
    const c = read('lww_content', {});
    return `<section class="panel"><p class="eyebrow">Home page</p><p class="auth-sub">These lines are shown on the first screen of the site.</p><form id="contentForm">
      <div class="field"><label>Eyebrow line</label><input name="badge" value="${esc(c.badge || document.querySelector('#home .eyebrow').textContent)}"></div>
      <div class="field"><label>Headline</label><input name="heroTitle" value="${esc(c.heroTitle || document.querySelector('h1.display').innerHTML)}"><small>HTML allowed, e.g. &lt;em&gt;why&lt;/em&gt;</small></div>
      <div class="field"><label>Intro paragraph</label><textarea name="heroLede">${esc(c.heroLede || document.querySelector('#home .lede').textContent)}</textarea></div>
      <div class="field"><label>"Today's why" questions</label><textarea name="whys" style="min-height:140px">${esc((c.whys || WHYS).join('\n'))}</textarea><small>One per line</small></div>
      <div class="btn-row"><button type="submit" class="btn btn-primary">Save content</button><button type="button" class="btn btn-ghost" data-adm="content-reset">Reset to defaults</button></div></form></section>`;
  };

  /* ----- roles & permissions ----- */
  ADMIN.roles = () => {
    const roles = read('lww_roles', DEFAULT_ROLES), staff = read('lww_staff_users', []);
    return `<section class="panel"><p class="eyebrow">Roles & permissions</p><p class="auth-sub">Tick what each role may open. Admin always has everything except the developer panel.</p><div class="tbl-wrap"><table class="table"><thead><tr><th>Permission</th>${Object.keys(roles).map(r => `<th style="text-transform:capitalize">${esc(r)}</th>`).join('')}</tr></thead><tbody>${PERMS.map(pm => `<tr><td style="text-transform:capitalize">${pm}</td>${Object.keys(roles).map(r => `<td><input type="checkbox" data-adm="perm" data-role="${r}" data-perm="${pm}"${roles[r].includes(pm) ? ' checked' : ''}${r === 'admin' && pm !== 'developer' ? ' disabled' : ''}></td>`).join('')}</tr>`).join('')}</tbody></table></div></section>
      <section class="panel"><p class="eyebrow">Staff accounts</p><p class="auth-sub">Staff sign up from the links in the site footer.</p>${table(['Name', 'Email', 'Signed up as', 'Role'], staff.map(u => [`<b>${esc(u.name)}</b>`, esc(u.email), pill(u.kind, 'neutral'), `<select data-adm="staff-role" data-id="${esc(u.email)}">${Object.keys(roles).map(r => `<option value="${r}"${(u.rolename || (u.kind === 'developer' ? 'developer' : 'admin')) === r ? ' selected' : ''}>${r}</option>`).join('')}</select>`]), 'No staff accounts yet.', { plain: true })}</section>`;
  };

  /* ----- settings: the server connection (admin key) — access never expires, so there is nothing to time ----- */
  ADMIN.settings = () => {
    const key = read('lww_admin_key', '');
    return `<section class="panel"><p class="eyebrow">Server connection</p><p class="auth-sub">With the admin key saved here, Orders, Customers and the dashboard read the database (SQLite behind <code>/api/admin/*</code>) instead of this browser's copy, and order status changes are written back.</p>
      <form id="accessForm" class="grid-2" style="gap:24px">
        <div>
          <div class="field"><label>Admin key</label><input name="key" type="password" value="${esc(key)}" placeholder="ADMIN_KEY from site/.env" autocomplete="off"><small>Set <code>ADMIN_KEY</code> in <code>site/.env</code> (the default is <code>change-me</code>) and enter the same value here.</small></div>
          <div class="btn-row"><button type="submit" class="btn btn-primary">Save & connect</button><span class="note" id="accessStatus" style="font-size:13px;color:var(--muted-foreground)">${adminKey() ? (syncedAt ? 'Connected · synced ' + fmt(syncedAt) : 'Key saved') : 'Not connected'}</span></div>
        </div>
        <div>
          <div class="field"><label>Access</label><div class="tbl-wrap" style="padding:14px 16px;font-size:14px;line-height:1.6">Every sheet a customer opens for free or pays for stays on their account — <b>there is no expiry</b>. To take a sheet away from one customer, revoke its entitlement with <code>POST /api/admin/entitlements/revoke</code>; an open viewer closes within a minute.</div></div>
        </div>
      </form></section>
      <section class="panel"><p class="eyebrow">What the customer sees</p><p class="auth-sub">Right after a successful purchase:</p>
      <div class="tbl-wrap" style="padding:16px 18px;font-size:14px;line-height:1.6"><b>Your purchase has been completed successfully.</b> You can now access your PDF.<br>This worksheet has been added to your account — it is yours to keep, with no expiry.<br>You can open it any time from <b>My Account → My Worksheets</b>.</div></section>`;
  };
  ADMIN.audit = () => auditView();
  function auditView() { const a = read('lww_audit', []).slice().reverse(); return `<section class="panel"><div class="row-between"><div><p class="eyebrow">Audit logs · ${a.length}</p><p class="auth-sub">Newest first.</p></div><button type="button" class="btn btn-ghost btn-sm" data-adm="clear" data-key="lww_audit">${ico('trash')}Clear</button></div>${table(['When', 'Who', 'Action', 'Detail'], a.map(x => [fmt(x.at), esc(x.actor), `<b>${esc(x.action)}</b>`, esc(x.detail)]), 'Nothing logged yet.', { filter: 'Filter logs…' })}</section>`; }

  /* =================================================================
     DEVELOPER
     ================================================================= */
  const DEV = {};
  DEV.health = () => {
    const errs = read('lww_errors', []), api = read('lww_api', []), up = Math.round((Date.now() - BOOT_AT) / 1000);
    const mem = performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) + ' MB' : 'n/a';
    const ok = pill('ok', 'ok');
    return `<div class="kpi-row five">${kpi('Status', `<span style="color:${errs.length ? 'var(--destructive)' : 'var(--ok)'}">${errs.length ? 'Degraded' : 'Healthy'}</span>`, errs.length + ' errors caught', 'health')}${kpi('Session uptime', Math.floor(up / 60) + 'm ' + (up % 60) + 's', 'since the page opened', 'activity')}${kpi('JS heap', mem, 'used memory', 'db')}${kpi('Frames resident', readyCount + '/' + TOTAL, 'landscape frames in memory', 'image')}${kpi('FPS', '<span id="fpsStat">…</span>', 'measured live', 'perf')}</div>
      <div class="grid-7"><section class="panel span-4"><p class="eyebrow">API latency</p><p class="auth-sub">Milliseconds per request · last ${Math.min(14, api.length) || 0}</p>${bars(api.slice(-14).map(x => x.ms), api.slice(-14).map(x => fmt(x.at)), 'var(--chart-2)', { prefix: '' })}</section>
      <section class="panel span-3"><p class="eyebrow">Checks</p>${table(['Check', 'Result'], [['Page script', ok], ['admin.js', pill('loaded', 'ok')], ['Frames', painted ? pill('painting', 'ok') : pill('waiting', 'neutral')], ['Storage', (() => { try { localStorage.setItem('_t', '1'); localStorage.removeItem('_t'); return pill('writable', 'ok'); } catch (_) { return pill('blocked', 'bad'); } })()], ['Online', navigator.onLine ? pill('online', 'ok') : pill('offline', 'bad')], ['API errors', api.filter(a => !a.status || a.status >= 400).length], ['Version', SITE_VERSION]], '', { plain: true })}</section></div>`;
  };
  DEV.errors = () => { const e = read('lww_errors', []).slice().reverse(); return `<section class="panel"><div class="row-between"><div><p class="eyebrow">Errors · ${e.length}</p><p class="auth-sub">window.onerror and unhandled promise rejections land here.</p></div><button type="button" class="btn btn-ghost btn-sm" data-adm="clear" data-key="lww_errors">${ico('trash')}Clear</button></div>${e.length ? `<div>${e.map(x => `<details class="err-item"><summary><b>${esc(x.msg)}</b> <small>${fmt(x.at)}${x.file ? ' · ' + esc(x.file.split('/').pop()) + ':' + x.line : ''}</small></summary><pre class="code">${esc(x.stack || 'no stack trace')}</pre></details>`).join('')}</div>` : '<p class="cart-empty">No errors caught.</p>'}</section>`; };
  DEV.api = () => { const a = read('lww_api', []).slice().reverse(); const ok = a.filter(x => x.status && x.status < 400).length; return `<div class="kpi-row">${kpi('Requests', a.length, 'fetch() calls this session', 'api')}${kpi('Success', (a.length ? Math.round(ok / a.length * 100) : 100) + '%', ok + ' ok', 'check')}${kpi('Avg latency', (a.length ? Math.round(a.reduce((n, x) => n + x.ms, 0) / a.length) : 0) + ' ms', 'across all calls', 'activity')}${kpi('Failures', a.length - ok, 'status ≥ 400 or network error', 'errors')}</div><section class="panel"><div class="row-between"><div><p class="eyebrow">API monitoring</p><p class="auth-sub">Every fetch() the page makes.</p></div><button type="button" class="btn btn-ghost btn-sm" data-adm="ping">Ping GitHub API</button></div>${table(['When', 'URL', 'Status', 'ms'], a.map(x => [fmt(x.at), `<span style="font-family:ui-monospace,Menlo,monospace;font-size:12px">${esc(x.url)}</span>`, x.status ? pill(String(x.status), x.status < 400 ? 'ok' : 'bad') : pill('failed', 'bad'), x.ms]), 'No requests yet — API and payment calls will show here.', { filter: 'Filter requests…' })}</section>`; };
  DEV.db = () => { const keys = Object.keys(localStorage).filter(k => k.startsWith('lww_')); const rows = keys.map(k => { const v = localStorage.getItem(k) || ''; let n = ''; try { const j = JSON.parse(v); n = Array.isArray(j) ? j.length + ' rows' : typeof j === 'object' ? Object.keys(j).length + ' keys' : ''; } catch (_) {} return [`<b>${k}</b>`, n, kb(v.length)]; }); const total = keys.reduce((n, k) => n + (localStorage.getItem(k) || '').length, 0); return `<div class="kpi-row" style="grid-template-columns:repeat(auto-fit,minmax(200px,1fr))">${kpi('Tables (keys)', keys.length, 'localStorage keys', 'db')}${kpi('Used', kb(total), 'across all tables', 'file')}${kpi('Quota', '<span id="quotaStat">…</span>', 'browser estimate', 'activity')}</div><section class="panel"><p class="eyebrow">Database health</p><p class="auth-sub">localStorage in demo mode. The real tables live in the server's SQLite database (site/data/lww.sqlite).</p>${table(['Table', 'Size', 'Bytes'], rows, 'Empty.', { plain: true })}</section>`; };
  DEV.payments = () => { const p = read('lww_payments', []).slice().reverse(); return `<section class="panel"><p class="eyebrow">Payment logs · ${p.length}</p><p class="auth-sub">One row per gateway call.</p>${table(['When', 'Order', 'Gateway', 'Amount', 'Status'], p.map(x => [fmt(x.at), `<b>${x.order}</b>`, esc(x.gateway), money(x.amount), pill(x.status, 'ok') + (x.demo ? ' <small>demo</small>' : '')]), 'No payments yet.', { filter: 'Filter payments…' })}</section>`; };
  DEV.webhooks = () => { const w = read('lww_webhooks', []).slice().reverse(); return `<section class="panel"><p class="eyebrow">Webhook logs · ${w.length}</p><p class="auth-sub">Gateways call back here after a payment; the real endpoint verifies the signature and unlocks the subscription.</p>${table(['When', 'Gateway', 'Event', 'Order', 'Response'], w.map(x => [fmt(x.at), esc(x.gateway), esc(x.event), x.order, pill(String(x.status), 'ok')]), 'No webhooks yet.', { filter: 'Filter webhooks…' })}</section>`; };
  DEV.auth = () => { const a = events().filter(e => ['signin', 'signup', 'signin_failed'].includes(e.type)).slice().reverse(); return `<section class="panel"><p class="eyebrow">Authentication logs · ${a.length}</p><p class="auth-sub">Customer sign-ins and sign-ups.</p>${table(['When', 'Event', 'Email'], a.map(x => [fmt(x.at), pill(x.type.replace('_', ' '), x.type === 'signin_failed' ? 'bad' : 'ok'), esc(x.email || x.who || '')]), 'No sign-ins yet.', { filter: 'Filter…' })}</section>`; };
  DEV.perf = () => { const nav = performance.getEntriesByType('navigation')[0] || {}; const paints = performance.getEntriesByType('paint'); const fcp = paints.find(p => p.name === 'first-contentful-paint'); return `<div class="kpi-row five">${kpi('DOM ready', Math.round(nav.domContentLoadedEventEnd || 0) + ' ms', 'DOMContentLoaded', 'perf')}${kpi('Load', Math.round(nav.loadEventEnd || 0) + ' ms', 'window load', 'activity')}${kpi('First paint', (fcp ? Math.round(fcp.startTime) : '—') + ' ms', 'first contentful paint', 'image')}${kpi('FPS', '<span id="fpsStat">…</span>', 'measured live', 'health')}${kpi('HTML transfer', (Math.round(nav.transferSize / 1024) || '—') + ' KB', 'over the wire', 'file')}</div><section class="panel"><p class="eyebrow">Performance monitoring</p>${table(['Metric', 'Value'], [['Frames loaded', readyCount + ' of ' + TOTAL], ['Frames in flight', inflight], ['Device pixel ratio', devicePixelRatio], ['Viewport', innerWidth + ' × ' + innerHeight], ['Connection', (navigator.connection || {}).effectiveType || 'n/a'], ['Reduced motion', matchMedia('(prefers-reduced-motion: reduce)').matches ? 'yes' : 'no']], '', { plain: true })}</section>`; };
  DEV.security = () => { const s = read('lww_security', []).slice().reverse(); return `<section class="panel"><div class="row-between"><div><p class="eyebrow">Security events · ${s.length}</p><p class="auth-sub">Failed logins and suspicious activity.</p></div><button type="button" class="btn btn-ghost btn-sm" data-adm="clear" data-key="lww_security">${ico('trash')}Clear</button></div>${table(['When', 'Event', 'Email', 'Where'], s.map(x => [fmt(x.at), pill(x.type.replace(/_/g, ' '), 'bad'), esc(x.email || ''), esc(x.where || '')]), 'No failed logins or suspicious activity.', { filter: 'Filter events…' })}</section>`; };
  DEV.deploy = () => `<div class="kpi-row" style="grid-template-columns:repeat(auto-fit,minmax(200px,1fr))">${kpi('Site version', SITE_VERSION, 'from the page', 'deploy')}${kpi('Latest commit', '<span id="commitStat">…</span>', 'on GitHub · main', 'api')}${kpi('Host', location.hostname, location.protocol.replace(':', ''), 'home')}</div><section class="panel"><p class="eyebrow">Deployments</p><p class="auth-sub">Latest commits on <a href="https://github.com/SumitDendage/kids-book-website/commits/main" target="_blank" rel="noopener">SumitDendage/kids-book-website</a>.</p><div id="commitBox" class="dev-list"><div>Fetching…</div></div></section>`;
  DEV.backups = () => `<section class="panel"><p class="eyebrow">Backups</p><p class="auth-sub">Export everything the site keeps (customers, subscriptions, orders, products, logs) as one JSON file; import it on another machine or after a reset.</p><div class="btn-row"><button type="button" class="btn btn-primary" data-adm="backup">${ico('download')}Download backup</button><label class="btn btn-ghost">${ico('upload')}Restore from file<input type="file" accept="application/json" id="restoreFile" hidden></label><button type="button" class="btn btn-ghost btn-danger" data-adm="wipe">${ico('trash')}Wipe demo data</button></div>${table(['Table', 'Size'], Object.keys(localStorage).filter(k => k.startsWith('lww_')).map(k => [`<b>${k}</b>`, kb((localStorage.getItem(k) || '').length)]), '', { plain: true })}</section>`;
  DEV.audit = () => auditView();

  /* ---------- helpers ---------- */
  function kpi(label, value, sub, icon) { return `<div class="kpi"><div class="kpi-top"><span>${label}</span>${ico(icon || 'activity', 16)}</div><b>${value}</b>${sub ? `<small>${sub}</small>` : ''}</div>`; }
  let tblSeq = 0;
  function table(head, rows, empty, opts) {
    opts = opts || {};
    if (!rows.length) return `<p class="cart-empty">${empty}</p>`;
    const body = `<div class="tbl-wrap"><table class="table"><thead><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
    if (opts.plain || rows.length <= 10 && !opts.filter) return body;
    const id = 'dt' + (++tblSeq);
    return `<div class="dt" id="${id}" data-size="10" data-page="0">
      <div class="dt-bar"><div class="lft"><input class="dt-q" type="search" placeholder="${esc(opts.filter || 'Filter…')}" aria-label="Filter"><button type="button" class="btn btn-ghost btn-plain btn-sm dt-reset">Reset ${ico('x', 14)}</button></div><button type="button" class="btn btn-ghost btn-sm" disabled>${ico('sliders', 14)}View</button></div>
      ${body}
      <div class="dt-foot"><span class="dt-count"></span><label class="rpp"><select class="dt-size">${[10, 20, 30, 40, 50].map(n => `<option value="${n}">${n}</option>`).join('')}</select><span>Rows per page</span></label><div class="pg"><span class="dt-page"></span><button type="button" class="btn btn-ghost dt-first" aria-label="First page">${ico('first', 16)}</button><button type="button" class="btn btn-ghost dt-prev" aria-label="Previous page">${ico('left', 16)}</button><button type="button" class="btn btn-ghost dt-next" aria-label="Next page">${ico('right', 16)}</button><button type="button" class="btn btn-ghost dt-last" aria-label="Last page">${ico('last', 16)}</button></div></div></div>`;
  }
  function wireTables() {
    document.querySelectorAll('.dt').forEach(dt => {
      const rows = Array.from(dt.querySelectorAll('tbody tr')), q = dt.querySelector('.dt-q'), size = dt.querySelector('.dt-size');
      const apply = () => {
        const term = q.value.trim().toLowerCase(), per = +size.value, vis = rows.filter(r => !term || r.textContent.toLowerCase().includes(term));
        const pages = Math.max(1, Math.ceil(vis.length / per)); let page = Math.min(+dt.dataset.page || 0, pages - 1); dt.dataset.page = page;
        rows.forEach(r => { r.hidden = true; }); vis.slice(page * per, page * per + per).forEach(r => { r.hidden = false; });
        dt.classList.toggle('filtered', !!term);
        dt.querySelector('.dt-count').textContent = vis.length + ' of ' + rows.length + ' row(s)' + (term ? ' match' : '');
        dt.querySelector('.dt-page').textContent = 'Page ' + (page + 1) + ' of ' + pages;
        dt.querySelector('.dt-first').disabled = dt.querySelector('.dt-prev').disabled = page === 0;
        dt.querySelector('.dt-next').disabled = dt.querySelector('.dt-last').disabled = page >= pages - 1;
        dt.dataset.pages = pages;
      };
      q.addEventListener('input', () => { dt.dataset.page = 0; apply(); });
      size.addEventListener('change', () => { dt.dataset.page = 0; apply(); });
      dt.querySelector('.dt-reset').addEventListener('click', () => { q.value = ''; dt.dataset.page = 0; apply(); });
      dt.querySelector('.dt-first').addEventListener('click', () => { dt.dataset.page = 0; apply(); });
      dt.querySelector('.dt-prev').addEventListener('click', () => { dt.dataset.page = Math.max(0, +dt.dataset.page - 1); apply(); });
      dt.querySelector('.dt-next').addEventListener('click', () => { dt.dataset.page = +dt.dataset.page + 1; apply(); });
      dt.querySelector('.dt-last').addEventListener('click', () => { dt.dataset.page = +dt.dataset.pages - 1; apply(); });
      apply();
    });
  }
  const TONE = { paid: 'ok', active: 'ok', delivered: 'ok', ok: 'ok', loaded: 'ok', online: 'ok', signin: 'ok', signup: 'info', pending: 'info', shipped: 'info', invited: 'info', cancelled: 'bad', refunded: 'bad', expired: 'neutral', failed: 'bad', 'signin failed': 'bad', none: 'neutral', '#1f6b47': 'ok', '#7a2b2b': 'bad' };
  function pill(t, tone) { const cls = TONE[tone] || tone || TONE[String(t).toLowerCase()] || ''; return `<span class="pill${cls ? ' ' + cls : ''}">${esc(t)}</span>`; }

  /* ---------- after each render: live numbers + wiring ---------- */
  const _renderPortal = window.renderPortal;
  window.renderPortal = function () {
    _renderPortal();
    mobileOpen = false;
    syncFromServer().then(changed => { if (changed && document.getElementById('portal').classList.contains('open')) _renderPortal(); });
    const fps = document.getElementById('fpsStat'); if (fps) { let n = 0, t0 = performance.now(); const tick = () => { n++; const dt = performance.now() - t0; if (dt >= 1000) { fps.textContent = Math.round(n * 1000 / dt); n = 0; t0 = performance.now(); } if (document.body.contains(fps)) requestAnimationFrame(tick); }; requestAnimationFrame(tick); }
    const q = document.getElementById('quotaStat'); if (q && navigator.storage && navigator.storage.estimate) navigator.storage.estimate().then(e => { q.textContent = Math.round((e.usage || 0) / 1048576) + ' / ' + Math.round((e.quota || 0) / 1048576) + ' MB'; });
    const cb = document.getElementById('commitBox'); if (cb) fetch('https://api.github.com/repos/SumitDendage/kids-book-website/commits?per_page=5').then(r => r.json()).then(list => { if (!Array.isArray(list)) throw new Error('no data'); document.getElementById('commitStat').textContent = list[0].sha.slice(0, 7); cb.innerHTML = list.map(c => `<div><b>${c.sha.slice(0, 7)}</b> — ${esc(c.commit.message.split('\n')[0])} <small>· ${fmt(Date.parse(c.commit.author.date))}</small></div>`).join(''); }).catch(() => { cb.innerHTML = '<div>Could not reach GitHub (offline or rate-limited).</div>'; });
    const rf = document.getElementById('restoreFile'); if (rf) rf.addEventListener('change', () => { const f = rf.files[0]; if (!f) return; const r = new FileReader(); r.onload = () => { try { const j = JSON.parse(r.result); Object.keys(j).forEach(k => { if (k.startsWith('lww_')) localStorage.setItem(k, JSON.stringify(j[k])); }); log('backup restored', f.name); toast('Restored — reloading'); setTimeout(() => location.reload(), 600); } catch (_) { toast('That is not a Learn With Why backup'); } }; r.readAsText(f); });
    const pf = document.getElementById('productForm'); if (pf) pf.addEventListener('submit', e => { e.preventDefault(); saveProduct(pf); });
    wireStudio(); wireTables();
    const af = document.getElementById('accessForm'); if (af) {
      af.addEventListener('submit', async e => { e.preventDefault(); const key = String(new FormData(af).get('key') || '').trim(), st = document.getElementById('accessStatus'); save('lww_admin_key', key); log('admin key ' + (key ? 'saved' : 'cleared'), ''); if (!key) { st.textContent = 'Not connected'; return; } st.textContent = 'Connecting…';
        const ok = await syncFromServer(true); st.textContent = ok ? 'Connected · synced ' + fmt(syncedAt) : 'Could not connect — check the key and that the server is running'; if (ok) toast('Orders, customers and entitlements loaded from the database'); else toast('Server refused the key'); });
    }
    const cf = document.getElementById('couponForm'); if (cf) cf.addEventListener('submit', e => { e.preventDefault(); const f = new FormData(cf), code = String(f.get('code')).trim().toUpperCase(); if (!code) return; const cps = read('lww_coupons', []).filter(c => c.code !== code); cps.push({ code, pct: Math.min(100, parseInt(f.get('pct'), 10) || 10), max: parseInt(f.get('max'), 10) || 0, uses: 0, active: true }); save('lww_coupons', cps); log('coupon added', code); rerender(); });
    const ct = document.getElementById('contentForm'); if (ct) ct.addEventListener('submit', e => { e.preventDefault(); const f = new FormData(ct); const c = { badge: f.get('badge').trim(), heroTitle: f.get('heroTitle').trim(), heroLede: f.get('heroLede').trim(), whys: String(f.get('whys')).split('\n').map(x => x.trim()).filter(Boolean) }; save('lww_content', c); document.querySelector('#home .eyebrow').textContent = c.badge; document.querySelector('h1.display').innerHTML = c.heroTitle; document.querySelector('#home .lede').textContent = c.heroLede; WHYS.length = 0; c.whys.forEach(w => WHYS.push(w)); log('content saved', 'home page'); toast('Content saved'); });
    /* header shadow once the inset scrolls */
    const hd = document.querySelector('.dash .hd'); if (hd) { const sc = () => hd.classList.toggle('scrolled', (portalEl.scrollTop || 0) > 10); portalEl.addEventListener('scroll', sc, { passive: true }); sc(); }
  };

  /* ---------- chrome: sidebar, theme, menus, ⌘K ---------- */
  const closeMenus = () => document.querySelectorAll('.dash .menu.open').forEach(m => m.classList.remove('open'));
  document.addEventListener('click', e => {
    const dashEl = e.target.closest('.dash');
    const tg = e.target.closest('[data-sb-toggle]'); if (tg && dashEl) { if (innerWidth < 768) { mobileOpen = !mobileOpen; dashEl.classList.toggle('sb-open', mobileOpen); } else { collapsed = !collapsed; write('lww_dash_sb', collapsed); dashEl.classList.toggle('sb-collapsed', collapsed); } return; }
    if (e.target.closest('[data-sb-close]') && dashEl) { mobileOpen = false; dashEl.classList.remove('sb-open'); return; }
    const th = e.target.closest('[data-theme-toggle]'); if (th && dashEl) { theme = theme === 'dark' ? 'light' : 'dark'; write('lww_dash_theme', theme); dashEl.classList.toggle('dark', theme === 'dark'); th.innerHTML = ico(theme === 'dark' ? 'moon' : 'sun', 18); return; }
    const mb = e.target.closest('[data-menu]'); if (mb) { const m = document.getElementById(mb.dataset.menu); const was = m && m.classList.contains('open'); closeMenus(); if (m && !was) m.classList.add('open'); return; }
    if (!e.target.closest('.menu')) closeMenus();
    const go = e.target.closest('[data-dash-go]'); if (go) { closeMenus(); openPortal(go.dataset.dashGo); return; }
    const s = e.target.closest('[data-dash-search]'); if (s) { const q = prompt('Jump to a section (e.g. orders, customers, errors):'); if (q) jump(q); return; }
  });
  function jump(q) {
    q = q.trim().toLowerCase(); const secs = portalKind === 'admin' ? ADMIN_SECTIONS : DEV_SECTIONS;
    const hit = secs.find(([id, l]) => id === q || l.toLowerCase().includes(q)); if (hit) { section[portalKind] = hit[0]; editing = null; custOpen = null; rerender(); } else toast('No section called "' + q + '"');
  }
  document.addEventListener('keydown', e => {
    if (!portalEl.classList.contains('open') || !document.querySelector('.dash')) return;
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); const q = prompt('Jump to a section (e.g. orders, customers, errors):'); if (q) jump(q); }
    if (e.key === 'Escape') closeMenus();
  });

  /* ---------- actions ---------- */
  document.addEventListener('click', e => {
    const d = e.target.closest('[data-dash]'); if (d) { if (d.classList.contains('off')) { toast('Your role does not have this permission'); return; } section[portalKind] = d.dataset.dash; editing = null; custOpen = null; rerender(); return; }
    const a = e.target.closest('[data-adm]'); if (!a) return;
    const act = a.dataset.adm, id = a.dataset.id;
    if (a.classList.contains('book-card') && e.target.closest('button')) return;
    if (act === 'product-new') { editing = 'new'; rerender(); const st = document.querySelector('.studio'); if (st) st.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
    else if (act === 'product-edit') { editing = id; rerender(); const st = document.querySelector('.studio'); if (st) st.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
    else if (act === 'product-filter') { pFilter = id; rerender(); }
    else if (act === 'product-cancel') { editing = null; rerender(); }
    else if (act === 'product-delete') deleteProduct(id);
    else if (act === 'customer-open') { custOpen = id; rerender(); portalEl.scrollTo({ top: 0, behavior: 'smooth' }); }
    else if (act === 'customer-close') { custOpen = null; rerender(); }
    else if (act === 'coupon-delete') { save('lww_coupons', read('lww_coupons', []).filter(c => c.code !== id)); log('coupon deleted', id); rerender(); }
    else if (act === 'content-reset') { localStorage.removeItem('lww_content'); log('content reset', 'home page'); toast('Reset — reloading'); setTimeout(() => location.reload(), 500); }
    else if (act === 'clear') { localStorage.removeItem(a.dataset.key); log('cleared', a.dataset.key); rerender(); }
    else if (act === 'throw') { setTimeout(() => { throw new Error('Test error from the developer panel'); }, 0); setTimeout(rerender, 300); }
    else if (act === 'ping') fetch('https://api.github.com/rate_limit').then(() => rerender()).catch(() => rerender());
    else if (act === 'backup') { const j = {}; Object.keys(localStorage).filter(k => k.startsWith('lww_')).forEach(k => { try { j[k] = JSON.parse(localStorage.getItem(k)); } catch (_) { j[k] = localStorage.getItem(k); } }); const blob = new Blob([JSON.stringify(j, null, 2)], { type: 'application/json' }); const u = URL.createObjectURL(blob); const l = document.createElement('a'); l.href = u; l.download = 'learn-with-why-backup-' + day(Date.now()) + '.json'; l.click(); setTimeout(() => URL.revokeObjectURL(u), 1000); log('backup downloaded', ''); }
    else if (act === 'wipe') { if (confirm('Wipe all demo data in this browser?')) { Object.keys(localStorage).filter(k => k.startsWith('lww_')).forEach(k => localStorage.removeItem(k)); location.reload(); } }
  });
  document.addEventListener('change', e => {
    const a = e.target.closest('[data-adm]'); if (!a) return;
    const act = a.dataset.adm, id = a.dataset.id;
    if (act === 'order-status') { const os = orders(); const o = os.find(x => x.id === id); if (o) { o.status = a.value; save('lww_orders', os); log('order ' + a.value, id); toast(id + ' → ' + a.value); if (adminKey()) adminApi('PUT', '/api/admin/orders', { id, status: { pending: 'created', paid: 'paid', cancelled: 'cancelled', refunded: 'refunded' }[a.value] || 'paid' }).catch(err => toast('Server: ' + err.message)); } }
    else if (act === 'coupon-toggle') { const cps = read('lww_coupons', []); const c = cps.find(x => x.code === id); if (c) { c.active = a.checked; save('lww_coupons', cps); log('coupon ' + (a.checked ? 'enabled' : 'disabled'), id); } }
    else if (act === 'discount') { const ds = read('lww_discounts', {}); ds[id] = Math.max(0, Math.min(90, parseInt(a.value, 10) || 0)); save('lww_discounts', ds); log('discount set', classById(id).label + ' ' + ds[id] + '%'); toast('Discount saved'); }
    else if (act === 'perm') { const roles = read('lww_roles', DEFAULT_ROLES); const set = new Set(roles[a.dataset.role] || []); if (a.checked) set.add(a.dataset.perm); else set.delete(a.dataset.perm); roles[a.dataset.role] = Array.from(set); save('lww_roles', roles); log('permission ' + (a.checked ? 'granted' : 'removed'), a.dataset.role + ':' + a.dataset.perm); }
    else if (act === 'staff-role') { const st = read('lww_staff_users', []); const u = st.find(x => x.email === id); if (u) { u.rolename = a.value; save('lww_staff_users', st); log('staff role', id + ' → ' + a.value); } }
  });
})();
