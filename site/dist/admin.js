/* =====================================================================
   STAFF DASHBOARDS — Admin (#admin) and Developer (#developer).
   Loaded after the page script; reads the same demo storage. Everything
   here is local to this browser until the real backend is connected.
   ===================================================================== */
(function () {
  const ADMIN_SECTIONS = [
    ['overview', 'Overview'], ['products', 'Products'], ['orders', 'Orders'], ['customers', 'Customers'], ['analytics', 'Analytics'],
    ['coupons', 'Coupons & discounts'], ['content', 'Content'], ['roles', 'Roles & permissions'], ['audit', 'Audit logs'],
  ];
  const DEV_SECTIONS = [
    ['health', 'System health'], ['errors', 'Errors & stack traces'], ['api', 'API monitoring'], ['db', 'Database health'],
    ['payments', 'Payment logs'], ['webhooks', 'Webhook logs'], ['auth', 'Authentication logs'], ['perf', 'Performance'],
    ['security', 'Security events'], ['deploy', 'Deployments'], ['backups', 'Backups'], ['audit', 'Audit logs'],
  ];
  const ICON = {
    overview: '<path d="M3 13h8V3H3zm10 8h8V11h-8zM3 21h8v-6H3zm10-10h8V3h-8z"/>', products: '<path d="M21 8 12 3 3 8v8l9 5 9-5zM12 12 3.5 7.5M12 12l8.5-4.5M12 12v9"/>', orders: '<path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4zM3 6h18M16 10a4 4 0 0 1-8 0"/>',
    customers: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm14 10v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/>', analytics: '<path d="M3 3v18h18M7 14l4-4 4 4 5-6"/>', coupons: '<path d="M20 12V7a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v5a2 2 0 0 1 0 4v1a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-1a2 2 0 0 1 0-4zM9 9l6 6M9 15l6-6"/>',
    content: '<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>', roles: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10zM9 12l2 2 4-4"/>', audit: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M8 13h8M8 17h8M8 9h2"/>',
    health: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>', errors: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4m0 4h.01"/>', api: '<path d="M16 18l6-6-6-6M8 6l-6 6 6 6"/>', db: '<path d="M12 8c5 0 9-1.3 9-3s-4-3-9-3-9 1.3-9 3 4 3 9 3zm9-3v14c0 1.7-4 3-9 3s-9-1.3-9-3V5M3 12c0 1.7 4 3 9 3s9-1.3 9-3"/>',
    payments: '<path d="M2 7h20v10H2zM2 11h20M6 15h4"/>', webhooks: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>', auth: '<path d="M19 11H5a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2zM7 11V7a5 5 0 0 1 10 0v4"/>', perf: '<path d="M13 2 3 14h9l-1 8 10-12h-9z"/>',
    security: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>', deploy: '<path d="M4.5 16.5c-1.5 1.3-2 5-2 5s3.7-.5 5-2c.7-.8.7-2.1-.1-2.8a2 2 0 0 0-2.9-.2zM12 15l-3-3a22 22 0 0 1 2-3.9 12.5 12.5 0 0 1 11-6c0 3.5-1.5 8.5-6 11a22 22 0 0 1-4 2zM9 12H4s.5-3.6 2-5c1.6-1.4 5 0 5 0M12 15v5s3.6-.5 5-2c1.4-1.6 0-5 0-5"/>', backups: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
  };
  const ico = id => `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICON[id] || ICON.overview}</svg>`;
  const ORDER_STATUS = ['pending', 'paid', 'shipped', 'delivered', 'cancelled', 'refunded'];
  const PERMS = ['products', 'orders', 'customers', 'analytics', 'coupons', 'content', 'roles', 'audit', 'developer'];
  const DEFAULT_ROLES = { admin: PERMS.slice(), editor: ['products', 'content'], support: ['orders', 'customers'], developer: ['developer', 'audit'] };
  let section = { admin: 'overview', developer: 'health' }, editing = null, custOpen = null;
  /* ---------- dashboard styles ---------- */
  const style = document.createElement('style');
  style.textContent = `
  :root { --d-bg: #0b1017; --d-card: rgba(255,255,255,0.035); --d-line: rgba(255,255,255,0.08); --d-accent: #f0b455; }
  #portal .shop-bar { display: none; }
  #portal .portal-body { width: 100%; max-width: none; margin: 0; padding: 0; min-height: 100vh; display: block; }
  #portal .shop-shade { background: var(--d-bg); }
  .dash { display: grid; grid-template-columns: 240px 1fr; min-height: 100vh; }
  @media (max-width: 900px) { .dash { grid-template-columns: 1fr; } }
  .dash-nav { position: sticky; top: 0; height: 100vh; display: flex; flex-direction: column; padding: 22px 14px; border-right: 1px solid var(--d-line); background: rgba(255,255,255,0.02); }
  @media (max-width: 900px) { .dash-nav { position: static; height: auto; border-right: 0; border-bottom: 1px solid var(--d-line); } }
  .nav-brandline { display: grid; grid-template-columns: auto 1fr; column-gap: 10px; align-items: center; padding: 4px 8px 18px; }
  .nav-brandline b { font-family: var(--font-display); font-size: 1.25rem; font-weight: 500; }
  .nav-brandline small { grid-column: 2; font-size: 0.62rem; letter-spacing: 0.22em; text-transform: uppercase; color: var(--fg-dim); }
  .nav-dot { width: 10px; height: 10px; border-radius: 50%; background: var(--d-accent); box-shadow: 0 0 14px var(--d-accent); }
  .nav-list-v { display: grid; gap: 2px; }
  @media (max-width: 900px) { .nav-list-v { display: flex; overflow-x: auto; gap: 4px; padding-bottom: 6px; } .nav-item { white-space: nowrap; } }
  .nav-item { display: flex; align-items: center; gap: 11px; padding: 10px 12px; border-radius: 12px; border: none; background: none; color: var(--fg-muted); font: 600 0.86rem var(--font-body); cursor: pointer; text-align: left; transition: background 0.15s, color 0.15s; }
  .nav-item svg { flex-shrink: 0; opacity: 0.8; }
  .nav-item:hover { background: rgba(255,255,255,0.05); color: #fff; }
  .nav-item.on { background: rgba(240,180,85,0.14); color: #fff; box-shadow: inset 3px 0 0 var(--d-accent); }
  .nav-item.on svg { color: var(--d-accent); opacity: 1; }
  .nav-item.off { opacity: 0.35; }
  .nav-foot { margin-top: auto; display: flex; align-items: center; gap: 10px; padding: 14px 8px 0; border-top: 1px solid var(--d-line); font-size: 0.76rem; color: var(--fg-dim); }
  .nav-who { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .avatar-sm { width: 30px; height: 30px; border-radius: 50%; display: grid; place-items: center; background: linear-gradient(135deg, #f0b455, #8fd6d2); color: #14181c; font-weight: 800; font-size: 0.7rem; flex-shrink: 0; }
  .dash-main { min-width: 0; }
  .dash-top { position: sticky; top: 0; z-index: 5; display: flex; align-items: center; justify-content: space-between; gap: 14px; padding: 18px clamp(18px, 3vw, 36px); background: rgba(11,16,23,0.8); backdrop-filter: blur(14px); border-bottom: 1px solid var(--d-line); }
  .dash-top h2 { font-family: var(--font-display); font-weight: 500; font-size: 1.7rem; line-height: 1; }
  .dash-top p { font-size: 0.76rem; color: var(--fg-dim); margin-top: 4px; }
  .dash-top-actions { display: flex; gap: 8px; align-items: center; flex-shrink: 0; }
  @media (max-width: 900px) { .dash-top { flex-wrap: wrap; } .dash-top-actions .chip-sm { display: none; } .dash-nav { padding: 14px; } .nav-brandline { padding-bottom: 10px; } .nav-foot { display: none; } }
  .dash-close { margin-left: 6px; }
  .chip-sm { padding: 6px 10px; border-radius: 100px; border: 1px solid var(--d-line); background: rgba(255,255,255,0.03); font-size: 0.7rem; color: var(--fg-muted); white-space: nowrap; }
  .live i { display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: #8fe8b4; box-shadow: 0 0 8px #8fe8b4; margin-right: 5px; animation: pulse 1.6s ease-in-out infinite; }
  .dash-content { display: grid; gap: 18px; padding: 22px clamp(18px, 3vw, 36px) 60px; animation: fadeUp 0.35s var(--ease) both; }
  .dash-content .panel { background: var(--d-card); border-color: var(--d-line); backdrop-filter: none; box-shadow: none; border-radius: 18px; }
  .dash-content .eyebrow { color: var(--fg-dim); font-size: 0.66rem; }
  .kpi-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 12px; }
  .kpi { padding: 16px 18px; border-radius: 18px; border: 1px solid var(--d-line); background: var(--d-card); display: grid; gap: 6px; transition: border-color 0.2s, transform 0.2s; }
  .kpi:hover { border-color: rgba(255,255,255,0.18); transform: translateY(-1px); }
  .kpi-top { display: flex; justify-content: space-between; align-items: center; font-size: 0.7rem; letter-spacing: 0.12em; text-transform: uppercase; color: var(--fg-dim); }
  .kpi b { font-family: var(--font-display); font-size: 1.9rem; font-weight: 500; line-height: 1; }
  .kpi small { font-size: 0.72rem; color: var(--fg-dim); }
  .spark { width: 80px; height: 26px; }
  .stat-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; }
  .stat { padding: 16px 18px; border-radius: 18px; border: 1px solid var(--d-line); background: var(--d-card); }
  .stat b { font-family: var(--font-display); font-size: 1.8rem; font-weight: 500; line-height: 1; display: block; }
  .stat span { font-size: 0.66rem; letter-spacing: 0.12em; text-transform: uppercase; color: var(--fg-dim); }
  .side-title { font-size: 0.66rem; letter-spacing: 0.22em; text-transform: uppercase; color: var(--fg-dim); margin: 6px 0 10px; }
  .row-between { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-bottom: 10px; }
  .row-between .eyebrow { margin-bottom: 0; }
  .row-form { display: grid; grid-template-columns: 1fr 110px 170px auto; gap: 8px; margin-bottom: 14px; }
  @media (max-width: 720px) { .row-form { grid-template-columns: 1fr 1fr; } }
  .row-form input { background: rgba(255,255,255,0.06); border: 1px solid var(--d-line); padding: 10px 12px; border-radius: 12px; color: #fff; font: inherit; }
  .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  @media (max-width: 760px) { .grid-2 { grid-template-columns: 1fr; } }
  .field select, .table select { width: 100%; background: rgba(255,255,255,0.06); border: 1px solid var(--d-line); padding: 10px 12px; border-radius: 12px; color: #fff; font: inherit; }
  .field select option, .table select option { color: #000; }
  .field input[type=file] { padding: 8px; }
  .field small { font-size: 0.72rem; color: var(--fg-dim); }
  .table select { width: auto; padding: 5px 8px; font-size: 0.78rem; }
  .table input[type=number] { width: 90px; }
  .tbl-wrap { overflow-x: auto; border-radius: 12px; }
  .table { width: 100%; border-collapse: separate; border-spacing: 0; }
  .table th { text-align: left; font-size: 0.62rem; letter-spacing: 0.16em; text-transform: uppercase; color: var(--fg-dim); padding: 10px 12px; background: rgba(255,255,255,0.03); border-bottom: 1px solid var(--d-line); }
  .table th:first-child { border-radius: 10px 0 0 0; } .table th:last-child { border-radius: 0 10px 0 0; }
  .table td { padding: 12px; border-bottom: 1px solid rgba(255,255,255,0.05); font-size: 0.84rem; vertical-align: middle; }
  .table tbody tr { transition: background 0.15s; } .table tbody tr:hover { background: rgba(255,255,255,0.03); }
  .table td small { color: var(--fg-dim); }
  .pill { display: inline-block; padding: 3px 9px; border-radius: 100px; font-size: 0.62rem; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.08); }
  .search { min-width: 220px; background: rgba(255,255,255,0.06); border: 1px solid var(--d-line); padding: 10px 14px 10px 36px; border-radius: 100px; color: #fff; font: inherit; background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23aaa' stroke-width='2'%3E%3Ccircle cx='11' cy='11' r='7'/%3E%3Cpath d='m20 20-3.5-3.5'/%3E%3C/svg%3E"); background-repeat: no-repeat; background-size: 15px; background-position: 13px 50%; }
  .p-thumb { width: 44px; height: 44px; object-fit: cover; border-radius: 8px; }
  .thumb-glyph { display: inline-grid; place-items: center; width: 44px; height: 44px; border-radius: 8px; background: var(--paper); color: var(--ink); font-family: var(--font-display); font-weight: 500; }
  .chart { width: 100%; height: 170px; display: block; }
  .funnel { display: grid; gap: 10px; }
  .funnel-row { display: grid; grid-template-columns: 90px 1fr auto; align-items: center; gap: 10px; font-size: var(--fs-small); }
  .funnel-row i { display: block; height: 14px; border-radius: 7px; background: linear-gradient(90deg, #8fd6d2, #f0b455); }
  .funnel-row b { color: var(--fg-muted); font-weight: 600; white-space: nowrap; }
  .err-item { border-bottom: 1px solid rgba(255,255,255,0.08); padding: 10px 0; }
  .err-item summary { cursor: pointer; font-size: var(--fs-small); }
  .err-item summary small { color: var(--fg-dim); margin-left: 8px; }
  .err-item .code { margin-top: 8px; }
  .chip small { margin-left: 6px; color: var(--fg-dim); }
  .book-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 14px; }
  .book-card { display: flex; flex-direction: column; border-radius: 16px; border: 1px solid var(--d-line); background: rgba(255,255,255,0.03); overflow: hidden; cursor: pointer; transition: transform 0.25s var(--ease), border-color 0.25s, background 0.25s, box-shadow 0.25s; }
  .book-card:hover { transform: translateY(-3px); border-color: rgba(255,255,255,0.2); background: rgba(255,255,255,0.06); box-shadow: 0 16px 34px rgba(0,0,0,0.35); }
  .book-cover { position: relative; aspect-ratio: 4 / 3; background: var(--paper); }
  .book-cover img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .cover-glyph { height: 100%; display: grid; place-items: center; align-content: center; gap: 6px; color: var(--ink); }
  .cover-glyph small { font-size: 0.56rem; letter-spacing: 0.2em; text-transform: uppercase; color: var(--ink-muted); }
  .cover-glyph b { font-family: var(--font-display); font-weight: 500; font-size: 2.2rem; line-height: 1; }
  .book-cover .tag { position: absolute; top: 8px; right: 8px; padding: 3px 8px; border-radius: 100px; font-size: 0.58rem; font-weight: 800; letter-spacing: 0.12em; text-transform: uppercase; background: #14181c; color: #fff; }
  .book-cover .tag.free { background: #1f6b47; }
  .book-body { padding: 12px 12px 6px; display: grid; gap: 5px; }
  .book-body .meta { font-size: 0.6rem; letter-spacing: 0.14em; text-transform: uppercase; color: var(--fg-dim); }
  .book-body h4 { font-family: var(--font-display); font-weight: 500; font-size: 1.1rem; line-height: 1.15; }
  .book-meta { display: flex; justify-content: space-between; gap: 6px; font-size: 0.7rem; color: var(--fg-dim); }
  .book-actions { margin-top: auto; display: flex; justify-content: space-between; align-items: center; padding: 8px 12px 12px; font-size: 0.78rem; }
  .book-actions .link { font-size: 0.74rem; }
  .stars { color: #f0b455; letter-spacing: 0.08em; font-size: 0.72rem; } .stars i { font-style: normal; color: rgba(255,255,255,0.18); }
  .studio { border-color: rgba(240,180,85,0.35) !important; box-shadow: 0 0 0 1px rgba(240,180,85,0.12), 0 30px 70px rgba(0,0,0,0.45) !important; }
  .studio-grid { display: grid; grid-template-columns: 280px 1fr; gap: 22px; margin-top: 8px; }
  @media (max-width: 900px) { .studio-grid { grid-template-columns: 1fr; } }
  .studio-side { display: grid; gap: 14px; align-content: start; }
  .drop { border: 2px dashed rgba(255,255,255,0.22); border-radius: 16px; padding: 8px; cursor: pointer; transition: border-color 0.2s, background 0.2s; }
  .drop:hover, .drop.over { border-color: #f0b455; background: rgba(240,180,85,0.08); }
  .drop-preview { aspect-ratio: 4 / 3; border-radius: 12px; background: rgba(255,255,255,0.04) center / cover no-repeat; display: grid; place-items: center; align-content: center; gap: 4px; text-align: center; padding: 14px; }
  .drop.small .drop-preview { aspect-ratio: auto; padding: 18px 14px; }
  .drop-icon { font-size: 1.8rem; }
  .drop-preview b { font-size: 0.86rem; } .drop-preview small { font-size: 0.7rem; color: var(--fg-dim); }
  .drop-name { font-size: 0.7rem; color: var(--fg-dim); text-align: center; margin-top: 6px; min-height: 1em; }
  .rate { display: flex; gap: 4px; } .rate .star { font-size: 1.5rem; line-height: 1; background: none; border: none; color: rgba(255,255,255,0.2); cursor: pointer; padding: 2px; transition: color 0.15s, transform 0.15s; } .rate .star.on { color: #f0b455; } .rate .star:hover { transform: scale(1.15); }
  .fs { border: 1px solid var(--d-line); border-radius: 14px; padding: 14px 16px 4px; margin-bottom: 14px; }
  .fs legend { padding: 0 8px; font-size: 0.66rem; letter-spacing: 0.2em; text-transform: uppercase; color: #f0b455; font-weight: 700; }
  .grid-3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
  @media (max-width: 720px) { .grid-3 { grid-template-columns: 1fr; } }
  .studio-actions { margin-top: 4px; }
  @media (prefers-reduced-motion: reduce) { .dash-content, .live i { animation: none; } }`;
  document.head.appendChild(style);
  const fmt = ms => new Date(ms).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const day = ms => new Date(ms).toISOString().slice(0, 10);
  const kb = n => (n / 1024).toFixed(1) + ' KB';
  const staffEmail = () => (staffSession() || {}).email || 'staff';
  const events = () => read('lww_events', []);
  const orders = () => read('lww_orders', []);
  const lastDays = n => { const out = []; for (let i = n - 1; i >= 0; i--) { const d = new Date(); d.setDate(d.getDate() - i); out.push(d.toISOString().slice(0, 10)); } return out; };

  /* ---------- tiny charts (inline SVG) ---------- */
  function bars(series, labels, color) {
    /* a smooth line chart with a soft fill, dots and hover titles */
    const W = 560, H = 140, PAD = 8, n = series.length, max = Math.max(1, ...series);
    const x = i => PAD + (n === 1 ? W / 2 : i * (W - PAD * 2) / (n - 1)), y = v => H - PAD - (v / max) * (H - PAD * 2);
    const pts = series.map((v, i) => [x(i), y(v)]);
    let d = 'M' + pts[0][0].toFixed(1) + ' ' + pts[0][1].toFixed(1);
    for (let i = 1; i < pts.length; i++) { const [x0, y0] = pts[i - 1], [x1, y1] = pts[i], cx = ((x0 + x1) / 2).toFixed(1); d += ' C' + cx + ' ' + y0.toFixed(1) + ' ' + cx + ' ' + y1.toFixed(1) + ' ' + x1.toFixed(1) + ' ' + y1.toFixed(1); }
    const area = d + ' L' + pts[pts.length - 1][0].toFixed(1) + ' ' + (H - PAD) + ' L' + pts[0][0].toFixed(1) + ' ' + (H - PAD) + ' Z';
    const gid = 'g' + Math.random().toString(36).slice(2, 7);
    const grid = [0.25, 0.5, 0.75].map(f => `<line x1="${PAD}" x2="${W - PAD}" y1="${(H - PAD - f * (H - PAD * 2)).toFixed(1)}" y2="${(H - PAD - f * (H - PAD * 2)).toFixed(1)}" stroke="rgba(255,255,255,0.07)" stroke-dasharray="3 5"/>`).join('');
    return `<svg class="chart" viewBox="0 0 ${W} ${H + 22}" preserveAspectRatio="none"><defs><linearGradient id="${gid}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity="0.35"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>${grid}<path d="${area}" fill="url(#${gid})"/><path d="${d}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>${pts.map(([px, py], i) => `<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="3.5" fill="#0b1520" stroke="${color}" stroke-width="2" vector-effect="non-scaling-stroke"><title>${labels[i]}: ${series[i]}</title></circle>`).join('')}${labels.map((l, i) => (i % Math.ceil(n / 7) === 0 ? `<text x="${x(i).toFixed(1)}" y="${H + 16}" font-size="10" text-anchor="middle" fill="rgba(255,255,255,0.5)">${l.slice(5)}</text>` : '')).join('')}</svg>`;
  }
  function funnel(steps) {
    const max = Math.max(1, steps[0][1]);
    return `<div class="funnel">${steps.map(([l, v], i) => `<div class="funnel-row"><span>${l}</span><i style="width:${Math.max(4, v / max * 100)}%"></i><b>${v}${i ? ' · ' + Math.round(v / Math.max(1, steps[i - 1][1]) * 100) + '%' : ''}</b></div>`).join('')}</div>`;
  }

  /* ---------- layout ---------- */
  window.dashRender = function (kind, who) {
    const secs = kind === 'admin' ? ADMIN_SECTIONS : DEV_SECTIONS, cur = section[kind];
    const perms = permsOf(who);
    const nav = secs.map(([id, label]) => `<button type="button" class="nav-item${id === cur ? ' on' : ''}${perms.includes(id) || kind === 'developer' || id === 'overview' ? '' : ' off'}" data-dash="${id}">${ico(id)}<span>${label}</span></button>`).join('');
    let main = '';
    try { main = (kind === 'admin' ? ADMIN[cur] : DEV[cur])(); } catch (err) { main = '<section class="panel"><p class="cart-empty">Could not render this section: ' + esc(err.message) + '</p></section>'; }
    const title = (secs.find(x => x[0] === cur) || [])[1] || '';
    const initials = staffEmail().slice(0, 2).toUpperCase();
    return `<div class="dash">
      <aside class="dash-nav"><div class="nav-brandline"><span class="nav-dot"></span><b>${kind === 'admin' ? 'Admin' : 'Developer'}</b><small>Learn With Why</small></div><nav class="nav-list-v">${nav}</nav><div class="nav-foot"><span class="avatar-sm">${esc(initials)}</span><span class="nav-who" title="${esc(staffEmail())}">${esc(staffEmail())}</span></div></aside>
      <div class="dash-main">
        <header class="dash-top"><div><h2>${esc(title)}</h2><p>${kind === 'admin' ? 'Manage the shelf, orders and customers' : 'Everything under the hood'} · <span class="live"><i></i>live</span></p></div><div class="dash-top-actions"><span class="chip-sm">${new Date().toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}</span><span class="chip-sm">v${SITE_VERSION}</span></div></header>
        <div class="dash-content">${main}</div>
      </div></div>`;
  };
  function permsOf(who) { const roles = read('lww_roles', DEFAULT_ROLES), staff = read('lww_staff_users', []).find(u => u.email === (who || {}).email); const r = (staff && staff.rolename) || ((who || {}).kind === 'developer' ? 'developer' : 'admin'); return roles[r] || []; }
  function rerender() { renderPortal(); }
  function save(key, val) { write(key, val); }
  function log(action, detail) { audit(staffEmail(), action, detail); }

  /* =================================================================
     ADMIN
     ================================================================= */
  const ADMIN = {};
  ADMIN.overview = () => {
    const os = orders(), rev = os.filter(o => o.status !== 'cancelled' && o.status !== 'refunded').reduce((n, o) => n + o.amount, 0);
    const ev = events(), subs = Object.values(read('lww_subs', {})).flat().filter(x => x.end > Date.now());
    const days = lastDays(7), salesS = days.map(d => os.filter(o => day(o.at) === d).reduce((n, o) => n + o.amount, 0)), visitS = days.map(d => ev.filter(e => e.type === 'visit' && day(e.at) === d).length), signS = days.map(d => ev.filter(e => e.type === 'signup' && day(e.at) === d).length);
    const delta = (arr) => { const a = arr.slice(-3).reduce((n, v) => n + v, 0), b = arr.slice(-6, -3).reduce((n, v) => n + v, 0); return b ? Math.round((a - b) / b * 100) + '% vs last 3 days' : (a ? 'new this week' : 'no change'); };
    return `<div class="kpi-row">${kpi('Revenue', money(rev), delta(salesS), salesS, '#f0b455')}${kpi('Active subscriptions', subs.length, subs.length ? 'across ' + new Set(subs.map(x => x.cls)).size + ' classes' : 'none yet')}${kpi('Customers', users().length, delta(signS), signS, '#8fd6d2')}${kpi('Visits', ev.filter(e => e.type === 'visit').length, delta(visitS), visitS, '#c8b6ff')}${kpi('Products', ITEMS.length, ITEMS.filter(i => i.price === 0).length + ' free')}</div>
      <section class="panel"><p class="eyebrow">Latest orders</p>${table(['Order', 'Customer', 'Class · plan', 'Amount', 'Status', 'When'], os.slice(-6).reverse().map(o => [o.id, esc(o.email), esc(classById(o.cls).label) + ' · ' + planOf(o.plan).label, money(o.amount), pill(o.status), fmt(o.at)]), 'No orders yet.')}</section>
      <section class="panel"><p class="eyebrow">Sales · last 14 days</p>${bars(lastDays(14).map(d => os.filter(o => day(o.at) === d).reduce((n, o) => n + o.amount, 0)), lastDays(14), '#f0b455')}</section>`;
  };

  /* ----- products ----- */
  /* ----- products: a card gallery + an organised "Upload new book" studio ----- */
  let pFilter = 'all', pQuery = '';
  ADMIN.products = () => {
    let list = ITEMS.slice();
    if (pFilter !== 'all') list = list.filter(it => it.cls === pFilter);
    if (pQuery) list = list.filter(it => (it.title + ' ' + it.subject + ' ' + (it.blurb || '')).toLowerCase().includes(pQuery));
    const form = editing ? productForm(editing === 'new' ? {} : itemById(editing)) : '';
    const free = ITEMS.filter(i => i.price === 0).length, withPdf = ITEMS.filter(i => i.pdf).length;
    return `${form}
      <div class="stat-row"><div class="stat"><b>${ITEMS.length}</b><span>Books & sheets</span></div><div class="stat"><b>${free}</b><span>Free</span></div><div class="stat"><b>${ITEMS.length - free}</b><span>In class plans</span></div><div class="stat"><b>${withPdf}</b><span>With PDF</span></div></div>
      <section class="panel">
        <div class="row-between"><div><p class="eyebrow" style="margin-bottom:4px">Books on the shelf</p><p class="auth-sub" style="margin:0">${list.length} shown · click a card to edit</p></div>
          <div class="btn-row"><input class="search" type="search" placeholder="Search books…" value="${esc(pQuery)}" data-adm-search><button type="button" class="btn btn-primary" data-adm="product-new">＋ Upload new book</button></div></div>
        <div class="chips" style="margin:12px 0 16px"><button type="button" class="chip${pFilter === 'all' ? ' on' : ''}" data-adm="product-filter" data-id="all">All classes</button>${CLASSES.map(c => `<button type="button" class="chip${pFilter === c.id ? ' on' : ''}" data-adm="product-filter" data-id="${c.id}">${esc(c.label)} <small>${ITEMS.filter(i => i.cls === c.id).length}</small></button>`).join('')}</div>
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
        <div class="book-meta"><span>${it.pdf ? '📄 PDF' : '<i style="color:#ff9a9a">no PDF</i>'}</span><span>${esc(it.ageGroup || it.ages || '')}</span><span>${({ parent: 'Parents', teacher: 'Teachers', both: 'Everyone' })[it.audience || 'both']}</span></div>
      </div>
      <div class="book-actions"><b>${it.price === 0 ? 'Free' : money(it.price)}</b><span><button type="button" class="link" data-adm="product-edit" data-id="${it.id}">Edit</button> · <button type="button" class="link" data-adm="product-delete" data-id="${it.id}">Delete</button></span></div>
    </article>`;
  }
  function stars(n) { return '<span class="stars" title="' + n + ' / 5">' + '★'.repeat(Math.round(n)) + '<i>' + '★'.repeat(5 - Math.round(n)) + '</i></span>'; }
  function productForm(it) {
    const v = k => esc(it[k] == null ? '' : it[k]);
    const subj = it.subjectId || (SUBJECTS.find(y => y.label === it.subject) || {}).id;
    return `<section class="panel studio"><div class="row-between"><div><p class="eyebrow" style="margin-bottom:4px">${it.id ? 'Edit book' : 'Upload new book'}</p><p class="auth-sub" style="margin:0">${it.id ? esc(it.title) : 'Drop the cover and the PDF, fill in the details, save — it goes straight on the shelf.'}</p></div><button type="button" class="icon-btn" data-adm="product-cancel" aria-label="Close">✕</button></div>
    <form id="productForm" data-id="${it.id || ''}" class="studio-grid">
      <div class="studio-side">
        <div class="drop" id="dropImage" data-drop="image"><input type="file" name="image" accept="image/*" hidden>
          <div class="drop-preview" ${it.image ? 'style="background-image:url(' + it.image + ')"' : ''}>${it.image ? '' : '<span class="drop-icon">🖼️</span><b>Drop the cover photo here</b><small>or click to choose · JPG / PNG · up to 600 KB</small>'}</div>
          <p class="drop-name">${it.image ? 'Cover set — drop a new one to replace it' : ''}</p></div>
        <div class="drop small" id="dropPdf" data-drop="pdf"><input type="file" name="pdf" accept="application/pdf" hidden>
          <div class="drop-preview"><span class="drop-icon">📄</span><b>${it.pdf ? esc(it.pdf.name) : 'Drop the PDF here'}</b><small>${it.pdf ? kb(it.pdf.size) + ' · drop a new file to replace' : 'or click to choose · up to 1.5 MB'}</small></div>
          <p class="drop-name"></p></div>
        <div class="field"><label>Rating (shown as stars)</label><div class="rate" data-rate><input type="hidden" name="rating" value="${it.rating || 0}">${[1, 2, 3, 4, 5].map(n => `<button type="button" class="star${(it.rating || 0) >= n ? ' on' : ''}" data-star="${n}">★</button>`).join('')}</div></div>
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
        <div class="btn-row studio-actions"><button type="submit" class="btn btn-primary">${it.id ? 'Save changes' : 'Publish to the shelf'}</button><button type="button" class="btn btn-ghost" data-adm="product-cancel">Cancel</button>${it.id ? `<button type="button" class="btn btn-ghost" style="margin-left:auto;color:#ff9a9a" data-adm="product-delete" data-id="${it.id}">Delete book</button>` : ''}</div>
      </div>
    </form></section>`;
  }
  function readFile(file, max) { return new Promise(res => { if (!file) return res(null); if (file.size > max) { toast('File too large for the demo (' + kb(file.size) + ') — keeping the name only'); return res({ name: file.name, size: file.size }); } const r = new FileReader(); r.onload = () => res({ name: file.name, size: file.size, data: r.result }); r.readAsDataURL(file); }); }
  async function saveProduct(form) {
    const f = new FormData(form), id = form.dataset.id || ('p-' + Date.now().toString(36));
    const o = read('lww_products', { added: [], edited: {}, deleted: [] });
    const fields = { title: f.get('title').trim(), glyph: f.get('glyph').trim() || '✎', cls: f.get('cls'), subjectId: f.get('subjectId'), subject: subjectById(f.get('subjectId')).label, price: Math.max(0, parseInt(f.get('price'), 10) || 0), was: parseInt(f.get('was'), 10) || null, stock: f.get('stock') === '' ? null : parseInt(f.get('stock'), 10), pages: parseInt(f.get('pages'), 10) || 8, ageGroup: f.get('ageGroup').trim(), audience: f.get('audience'), rating: parseFloat(f.get('rating')) || 0, printLimit: parseInt(f.get('printLimit'), 10) || 0, downloadLimit: parseInt(f.get('downloadLimit'), 10) || 0, blurb: f.get('blurb').trim() };
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
    return `<div class="stat-row">${counts.map(([st, n]) => `<div class="stat"><b>${n}</b><span>${st}</span></div>`).join('')}</div>
      <section class="panel"><p class="eyebrow">Orders · ${os.length}</p><p class="auth-sub">Subscriptions are digital, so most go straight to <b>paid</b>. Change a status and it is written to the audit log.</p>
      ${table(['Order', 'When', 'Customer', 'Class · plan', 'Gateway', 'Amount', 'Status'], os.map(o => [o.id, fmt(o.at), esc(o.name) + '<br><small>' + esc(o.email) + '</small>', esc(classById(o.cls).label) + ' · ' + planOf(o.plan).label + (o.coupon ? '<br><small>coupon ' + esc(o.coupon) + '</small>' : ''), esc(o.method), money(o.amount), `<select data-adm="order-status" data-id="${o.id}">${ORDER_STATUS.map(st => `<option value="${st}"${st === o.status ? ' selected' : ''}>${st}</option>`).join('')}</select>`]), 'No orders yet — they appear when a customer subscribes.')}</section>`;
  };

  /* ----- customers ----- */
  ADMIN.customers = () => {
    const us = users(), subsAll = read('lww_subs', {}), os = orders(), prints = read('lww_prints', {}), ownedAll = read('lww_owned', {});
    const detail = custOpen && us.find(u => u.email === custOpen);
    return `${detail ? customerCard(detail, subsAll, os, prints, ownedAll) : ''}<section class="panel"><p class="eyebrow">Customers · ${us.length}</p>
      ${table(['Name', 'Email', 'Role', 'Subscriptions', 'Orders', 'Total spent', 'Downloads', 'Prints', ''], us.map(u => { const uo = os.filter(o => o.email === u.email); return [esc(u.name), esc(u.email), pill(roleOf(u.role).label), (subsAll[u.email] || []).filter(x => x.end > Date.now()).map(x => esc(classById(x.cls).label)).join(', ') || '—', uo.length, money(uo.reduce((n, o) => n + o.amount, 0)), (ownedAll[u.email] || []).length, Object.values(prints[u.email] || {}).reduce((n, v) => n + v, 0), `<button type="button" class="link" data-adm="customer-open" data-id="${esc(u.email)}">Profile</button>`]; }), 'No customers yet.')}</section>`;
  };
  function customerCard(u, subsAll, os, prints, ownedAll) {
    const uo = os.filter(o => o.email === u.email), pu = prints[u.email] || {};
    return `<section class="panel"><div class="row-between"><p class="eyebrow">Customer profile</p><button type="button" class="icon-btn" data-adm="customer-close">✕</button></div>
      <h3 class="card-title">${esc(u.name)}</h3><p class="auth-sub">${esc(u.email)} · ${roleOf(u.role).label} · joined ${fmt(u.created || Date.now())}</p>
      <div class="stat-row"><div class="stat"><b>${uo.length}</b><span>Orders</span></div><div class="stat"><b>${money(uo.reduce((n, o) => n + o.amount, 0))}</b><span>Total spending</span></div><div class="stat"><b>${(ownedAll[u.email] || []).length}</b><span>Downloads</span></div><div class="stat"><b>${Object.values(pu).reduce((n, v) => n + v, 0)}</b><span>Prints</span></div></div>
      <p class="eyebrow" style="margin-top:14px">Subscriptions</p>${table(['Class', 'Plan', 'Until', 'Status'], (subsAll[u.email] || []).map(x => [esc(classById(x.cls).label), planOf(x.plan).label, fmt(x.end), pill(x.end > Date.now() ? 'active' : 'expired')]), 'None.')}
      <p class="eyebrow" style="margin-top:14px">Orders</p>${table(['Order', 'When', 'Amount', 'Status'], uo.map(o => [o.id, fmt(o.at), money(o.amount), pill(o.status)]), 'None.')}
      <p class="eyebrow" style="margin-top:14px">Print usage</p>${table(['Sheet', 'Prints'], Object.keys(pu).map(id => [esc((itemById(id) || { title: id }).title), pu[id]]), 'Nothing printed yet.')}</section>`;
  }

  /* ----- analytics ----- */
  ADMIN.analytics = () => {
    const ev = events(), os = orders(), days = lastDays(14);
    const visits = days.map(d => ev.filter(e => e.type === 'visit' && day(e.at) === d).length), sales = days.map(d => os.filter(o => day(o.at) === d).reduce((n, o) => n + o.amount, 0));
    const v = ev.filter(e => e.type === 'visit').length, su = ev.filter(e => e.type === 'signup').length, sub = os.length;
    const top = {}; ev.filter(e => e.type === 'print' || e.type === 'download').forEach(e => { top[e.item] = (top[e.item] || 0) + 1; });
    const topList = Object.entries(top).sort((a, b) => b[1] - a[1]).slice(0, 8);
    const refs = {}; ev.filter(e => e.type === 'visit').forEach(e => { refs[e.ref || 'direct'] = (refs[e.ref || 'direct'] || 0) + 1; });
    return `<div class="stat-row"><div class="stat"><b>${v}</b><span>Visits</span></div><div class="stat"><b>${su}</b><span>Sign-ups</span></div><div class="stat"><b>${sub}</b><span>Subscriptions</span></div><div class="stat"><b>${v ? (sub / v * 100).toFixed(1) : 0}%</b><span>Conversion</span></div></div>
      <div class="grid-2"><section class="panel"><p class="eyebrow">Sales analytics · ₹ per day</p>${bars(sales, days, '#f0b455')}</section><section class="panel"><p class="eyebrow">Visitor analytics · visits per day</p>${bars(visits, days, '#8fd6d2')}</section></div>
      <div class="grid-2"><section class="panel"><p class="eyebrow">Conversion funnel</p>${funnel([['Visited', v], ['Signed up', su], ['Subscribed', sub]])}</section>
      <section class="panel"><p class="eyebrow">Top products · opens & prints</p>${table(['Product', 'Uses'], topList.map(([id, n]) => [esc((itemById(id) || { title: id }).title), n]), 'No activity yet.')}</section></div>
      <section class="panel"><p class="eyebrow">Where visitors come from</p>${table(['Source', 'Visits'], Object.entries(refs).sort((a, b) => b[1] - a[1]).map(([r, n]) => [esc(r), n]), 'No visits logged.')}</section>`;
  };

  /* ----- coupons & discounts ----- */
  ADMIN.coupons = () => {
    const cps = read('lww_coupons', []), ds = read('lww_discounts', {});
    return `<section class="panel"><p class="eyebrow">Coupons</p><form id="couponForm" class="row-form"><input name="code" placeholder="CODE" style="text-transform:uppercase" required><input name="pct" type="number" min="1" max="100" placeholder="% off" required><input name="max" type="number" min="0" placeholder="Max uses (blank = ∞)"><button type="submit" class="btn btn-primary">Add coupon</button></form>
      ${table(['Code', '% off', 'Uses', 'Active', ''], cps.map(c => [`<b>${esc(c.code)}</b>`, c.pct + '%', (c.uses || 0) + (c.max ? ' / ' + c.max : ''), `<label class="check"><input type="checkbox" data-adm="coupon-toggle" data-id="${esc(c.code)}"${c.active !== false ? ' checked' : ''}> on</label>`, `<button type="button" class="link" data-adm="coupon-delete" data-id="${esc(c.code)}">Delete</button>`]), 'No coupons yet. Customers type the code at checkout.')}</section>
      <section class="panel"><p class="eyebrow">Discounts · % off a class plan</p><p class="auth-sub">Shows as a struck-through price at checkout.</p>
      ${table(['Class', 'Discount %'], CLASSES.map(c => [esc(c.label), `<input type="number" min="0" max="90" value="${ds[c.id] || 0}" data-adm="discount" data-id="${c.id}" style="width:90px">`]), '')}</section>`;
  };

  /* ----- content ----- */
  ADMIN.content = () => {
    const c = read('lww_content', {});
    return `<section class="panel"><p class="eyebrow">Content management · home page</p><form id="contentForm">
      <div class="field"><label>Eyebrow line</label><input name="badge" value="${esc(c.badge || document.querySelector('#home .eyebrow').textContent)}"></div>
      <div class="field"><label>Headline (HTML allowed, e.g. &lt;em&gt;why&lt;/em&gt;)</label><input name="heroTitle" value="${esc(c.heroTitle || document.querySelector('h1.display').innerHTML)}"></div>
      <div class="field"><label>Intro paragraph</label><textarea name="heroLede">${esc(c.heroLede || document.querySelector('#home .lede').textContent)}</textarea></div>
      <div class="field"><label>"Today's why" questions (one per line)</label><textarea name="whys" style="min-height:140px">${esc((c.whys || WHYS).join('\n'))}</textarea></div>
      <div class="btn-row"><button type="submit" class="btn btn-primary">Save content</button><button type="button" class="btn btn-ghost" data-adm="content-reset">Reset to defaults</button></div></form></section>`;
  };

  /* ----- roles & permissions ----- */
  ADMIN.roles = () => {
    const roles = read('lww_roles', DEFAULT_ROLES), staff = read('lww_staff_users', []);
    return `<section class="panel"><p class="eyebrow">Roles & permissions</p><table class="table"><thead><tr><th>Permission</th>${Object.keys(roles).map(r => `<th>${esc(r)}</th>`).join('')}</tr></thead><tbody>${PERMS.map(pm => `<tr><td>${pm}</td>${Object.keys(roles).map(r => `<td><input type="checkbox" data-adm="perm" data-role="${r}" data-perm="${pm}"${roles[r].includes(pm) ? ' checked' : ''}${r === 'admin' && pm !== 'developer' ? ' disabled' : ''}></td>`).join('')}</tr>`).join('')}</tbody></table></section>
      <section class="panel"><p class="eyebrow">Staff accounts</p>${table(['Name', 'Email', 'Signed up as', 'Role'], staff.map(u => [esc(u.name), esc(u.email), u.kind, `<select data-adm="staff-role" data-id="${esc(u.email)}">${Object.keys(roles).map(r => `<option value="${r}"${(u.rolename || (u.kind === 'developer' ? 'developer' : 'admin')) === r ? ' selected' : ''}>${r}</option>`).join('')}</select>`]), 'No staff accounts yet — they sign up from the footer links.')}</section>`;
  };

  ADMIN.audit = () => auditView();
  function auditView() { const a = read('lww_audit', []).slice().reverse(); return `<section class="panel"><div class="row-between"><p class="eyebrow">Audit logs · ${a.length}</p><button type="button" class="btn btn-ghost" data-adm="clear" data-key="lww_audit">Clear</button></div>${table(['When', 'Who', 'Action', 'Detail'], a.map(x => [fmt(x.at), esc(x.actor), esc(x.action), esc(x.detail)]), 'Nothing logged yet.')}</section>`; }

  /* =================================================================
     DEVELOPER
     ================================================================= */
  const DEV = {};
  DEV.health = () => {
    const errs = read('lww_errors', []), api = read('lww_api', []), up = Math.round((Date.now() - BOOT_AT) / 1000);
    const mem = performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) + ' MB' : 'n/a';
    return `<div class="stat-row"><div class="stat"><b style="color:${errs.length ? '#ff9a9a' : '#8fe8b4'}">${errs.length ? 'Degraded' : 'Healthy'}</b><span>Status</span></div><div class="stat"><b>${Math.floor(up / 60)}m ${up % 60}s</b><span>Session uptime</span></div><div class="stat"><b>${mem}</b><span>JS heap</span></div><div class="stat"><b>${readyCount}/${TOTAL}</b><span>Frames resident</span></div><div class="stat"><b id="fpsStat">…</b><span>FPS</span></div></div>
      <section class="panel"><p class="eyebrow">Checks</p>${table(['Check', 'Result'], [['Page script', '<span class="pill" style="background:#1f6b47">ok</span>'], ['admin.js', '<span class="pill" style="background:#1f6b47">loaded</span>'], ['Frames', painted ? '<span class="pill" style="background:#1f6b47">painting</span>' : '<span class="pill">waiting</span>'], ['Storage', (() => { try { localStorage.setItem('_t', '1'); localStorage.removeItem('_t'); return '<span class="pill" style="background:#1f6b47">writable</span>'; } catch (_) { return '<span class="pill" style="background:#7a2b2b">blocked</span>'; } })()], ['Online', navigator.onLine ? '<span class="pill" style="background:#1f6b47">online</span>' : '<span class="pill">offline</span>'], ['API errors', api.filter(a => !a.status || a.status >= 400).length], ['Version', SITE_VERSION]], '')}</section>`;
  };
  DEV.errors = () => { const e = read('lww_errors', []).slice().reverse(); return `<section class="panel"><div class="row-between"><p class="eyebrow">Errors · ${e.length}</p><div class="btn-row"><button type="button" class="btn btn-ghost" data-adm="throw">Throw a test error</button><button type="button" class="btn btn-ghost" data-adm="clear" data-key="lww_errors">Clear</button></div></div>${e.length ? e.map(x => `<details class="err-item"><summary><b>${esc(x.msg)}</b> <small>${fmt(x.at)}${x.file ? ' · ' + esc(x.file.split('/').pop()) + ':' + x.line : ''}</small></summary><pre class="code">${esc(x.stack || 'no stack trace')}</pre></details>`).join('') : '<p class="cart-empty">No errors caught. window.onerror and unhandled promise rejections land here.</p>'}</section>`; };
  DEV.api = () => { const a = read('lww_api', []).slice().reverse(); const ok = a.filter(x => x.status && x.status < 400).length; return `<div class="stat-row"><div class="stat"><b>${a.length}</b><span>Requests</span></div><div class="stat"><b>${a.length ? Math.round(ok / a.length * 100) : 100}%</b><span>Success</span></div><div class="stat"><b>${a.length ? Math.round(a.reduce((n, x) => n + x.ms, 0) / a.length) : 0} ms</b><span>Avg latency</span></div></div><section class="panel"><div class="row-between"><p class="eyebrow">API monitoring · fetch()</p><button type="button" class="btn btn-ghost" data-adm="ping">Ping GitHub API</button></div>${table(['When', 'URL', 'Status', 'ms'], a.map(x => [fmt(x.at), esc(x.url), x.status ? pill(String(x.status), x.status < 400 ? '#1f6b47' : '#7a2b2b') : pill('failed', '#7a2b2b'), x.ms]), 'No requests yet — payments, Supabase and DRM calls will show here.')}</section>`; };
  DEV.db = () => { const keys = Object.keys(localStorage).filter(k => k.startsWith('lww_')); const rows = keys.map(k => { const v = localStorage.getItem(k) || ''; let n = ''; try { const j = JSON.parse(v); n = Array.isArray(j) ? j.length + ' rows' : typeof j === 'object' ? Object.keys(j).length + ' keys' : ''; } catch (_) {} return [k, n, kb(v.length)]; }); const total = keys.reduce((n, k) => n + (localStorage.getItem(k) || '').length, 0); return `<div class="stat-row"><div class="stat"><b>${keys.length}</b><span>Tables (keys)</span></div><div class="stat"><b>${kb(total)}</b><span>Used</span></div><div class="stat"><b id="quotaStat">…</b><span>Quota</span></div></div><section class="panel"><p class="eyebrow">Database health · localStorage (demo)</p><p class="auth-sub">In production these become Supabase tables — see <code>archive/learn-with-why/supabase/migrations</code>.</p>${table(['Table', 'Size', 'Bytes'], rows, 'Empty.')}</section>`; };
  DEV.payments = () => { const p = read('lww_payments', []).slice().reverse(); return `<section class="panel"><p class="eyebrow">Payment logs · ${p.length}</p>${table(['When', 'Order', 'Gateway', 'Amount', 'Status'], p.map(x => [fmt(x.at), x.order, esc(x.gateway), money(x.amount), pill(x.status, '#1f6b47') + (x.demo ? ' <small>demo</small>' : '')]), 'No payments yet.')}</section>`; };
  DEV.webhooks = () => { const w = read('lww_webhooks', []).slice().reverse(); return `<section class="panel"><p class="eyebrow">Webhook logs · ${w.length}</p><p class="auth-sub">Gateways call back here after a payment; the real endpoint verifies the signature and unlocks the subscription.</p>${table(['When', 'Gateway', 'Event', 'Order', 'Response'], w.map(x => [fmt(x.at), esc(x.gateway), esc(x.event), x.order, pill(String(x.status), '#1f6b47')]), 'No webhooks yet.')}</section>`; };
  DEV.auth = () => { const a = events().filter(e => ['signin', 'signup', 'signin_failed'].includes(e.type)).slice().reverse(); return `<section class="panel"><p class="eyebrow">Authentication logs · ${a.length}</p>${table(['When', 'Event', 'Email'], a.map(x => [fmt(x.at), pill(x.type.replace('_', ' '), x.type === 'signin_failed' ? '#7a2b2b' : '#1f6b47'), esc(x.email || x.who || '')]), 'No sign-ins yet.')}</section>`; };
  DEV.perf = () => { const nav = performance.getEntriesByType('navigation')[0] || {}; const paints = performance.getEntriesByType('paint'); const fcp = paints.find(p => p.name === 'first-contentful-paint'); return `<div class="stat-row"><div class="stat"><b>${Math.round(nav.domContentLoadedEventEnd || 0)} ms</b><span>DOM ready</span></div><div class="stat"><b>${Math.round(nav.loadEventEnd || 0)} ms</b><span>Load</span></div><div class="stat"><b>${fcp ? Math.round(fcp.startTime) : '—'} ms</b><span>First paint</span></div><div class="stat"><b id="fpsStat">…</b><span>FPS</span></div><div class="stat"><b>${Math.round(nav.transferSize / 1024) || '—'} KB</b><span>HTML transfer</span></div></div><section class="panel"><p class="eyebrow">Performance monitoring</p>${table(['Metric', 'Value'], [['Frames loaded', readyCount + ' of ' + TOTAL], ['Frames in flight', inflight], ['Device pixel ratio', devicePixelRatio], ['Viewport', innerWidth + ' × ' + innerHeight], ['Connection', (navigator.connection || {}).effectiveType || 'n/a'], ['Reduced motion', matchMedia('(prefers-reduced-motion: reduce)').matches ? 'yes' : 'no']], '')}</section>`; };
  DEV.security = () => { const s = read('lww_security', []).slice().reverse(); return `<section class="panel"><div class="row-between"><p class="eyebrow">Security events · ${s.length}</p><button type="button" class="btn btn-ghost" data-adm="clear" data-key="lww_security">Clear</button></div>${table(['When', 'Event', 'Email', 'Where'], s.map(x => [fmt(x.at), pill(x.type.replace(/_/g, ' '), '#7a2b2b'), esc(x.email || ''), esc(x.where || '')]), 'No failed logins or suspicious activity.')}</section>`; };
  DEV.deploy = () => `<section class="panel"><p class="eyebrow">Deployments</p><div class="stat-row"><div class="stat"><b>${SITE_VERSION}</b><span>Site version</span></div><div class="stat"><b id="commitStat">…</b><span>Latest commit</span></div><div class="stat"><b>${location.hostname}</b><span>Host</span></div></div><div id="commitBox" class="dev-list"><div>Fetching <a href="https://github.com/SumitDendage/kids-book-website/commits/main" target="_blank" rel="noopener" style="color:#fff">SumitDendage/kids-book-website</a>…</div></div></section>`;
  DEV.backups = () => `<section class="panel"><p class="eyebrow">Backups</p><p class="auth-sub">Export everything the site keeps (customers, subscriptions, orders, products, logs) as one JSON file; import it on another machine or after a reset.</p><div class="btn-row"><button type="button" class="btn btn-primary" data-adm="backup">Download backup</button><label class="btn btn-ghost">Restore from file<input type="file" accept="application/json" id="restoreFile" hidden></label><button type="button" class="btn btn-ghost" data-adm="wipe">Wipe demo data</button></div>${table(['Table', 'Size'], Object.keys(localStorage).filter(k => k.startsWith('lww_')).map(k => [k, kb((localStorage.getItem(k) || '').length)]), '')}</section>`;
  DEV.audit = () => auditView();

  /* ---------- helpers ---------- */
  function spark(series, color) { const max = Math.max(1, ...series), n = series.length, W = 80, H = 26; const pts = series.map((v, i) => (i * W / Math.max(1, n - 1)).toFixed(1) + ',' + (H - 2 - v / max * (H - 4)).toFixed(1)).join(' '); return `<svg class="spark" viewBox="0 0 ${W} ${H}"><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`; }
  function kpi(label, value, sub, series, color) { return `<div class="kpi"><div class="kpi-top"><span>${label}</span>${series ? spark(series, color || '#f0b455') : ''}</div><b>${value}</b>${sub ? `<small>${sub}</small>` : ''}</div>`; }
  function table(head, rows, empty) { return rows.length ? `<div class="tbl-wrap"><table class="table"><thead><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>` : `<p class="cart-empty">${empty}</p>`; }
  function pill(t, bg) { return `<span class="pill"${bg ? ' style="background:' + bg + '"' : ''}>${esc(t)}</span>`; }

  /* ---------- after each render: live numbers ---------- */
  const _renderPortal = window.renderPortal;
  window.renderPortal = function () {
    _renderPortal();
    const fps = document.getElementById('fpsStat'); if (fps) { let n = 0, t0 = performance.now(); const tick = () => { n++; const dt = performance.now() - t0; if (dt >= 1000) { fps.textContent = Math.round(n * 1000 / dt); n = 0; t0 = performance.now(); } if (document.body.contains(fps)) requestAnimationFrame(tick); }; requestAnimationFrame(tick); }
    const q = document.getElementById('quotaStat'); if (q && navigator.storage && navigator.storage.estimate) navigator.storage.estimate().then(e => { q.textContent = Math.round((e.usage || 0) / 1048576) + ' / ' + Math.round((e.quota || 0) / 1048576) + ' MB'; });
    const cb = document.getElementById('commitBox'); if (cb) fetch('https://api.github.com/repos/SumitDendage/kids-book-website/commits?per_page=5').then(r => r.json()).then(list => { if (!Array.isArray(list)) throw new Error('no data'); document.getElementById('commitStat').textContent = list[0].sha.slice(0, 7); cb.innerHTML = list.map(c => `<div><b>${c.sha.slice(0, 7)}</b> — ${esc(c.commit.message.split('\n')[0])} <small>· ${fmt(Date.parse(c.commit.author.date))}</small></div>`).join(''); }).catch(() => { cb.innerHTML = '<div>Could not reach GitHub (offline or rate-limited).</div>'; });
    const rf = document.getElementById('restoreFile'); if (rf) rf.addEventListener('change', () => { const f = rf.files[0]; if (!f) return; const r = new FileReader(); r.onload = () => { try { const j = JSON.parse(r.result); Object.keys(j).forEach(k => { if (k.startsWith('lww_')) localStorage.setItem(k, JSON.stringify(j[k])); }); log('backup restored', f.name); toast('Restored — reloading'); setTimeout(() => location.reload(), 600); } catch (_) { toast('That is not a Learn With Why backup'); } }; r.readAsText(f); });
    const pf = document.getElementById('productForm'); if (pf) pf.addEventListener('submit', e => { e.preventDefault(); saveProduct(pf); });
    wireStudio();
    const cf = document.getElementById('couponForm'); if (cf) cf.addEventListener('submit', e => { e.preventDefault(); const f = new FormData(cf), code = String(f.get('code')).trim().toUpperCase(); if (!code) return; const cps = read('lww_coupons', []).filter(c => c.code !== code); cps.push({ code, pct: Math.min(100, parseInt(f.get('pct'), 10) || 10), max: parseInt(f.get('max'), 10) || 0, uses: 0, active: true }); save('lww_coupons', cps); log('coupon added', code); rerender(); });
    const ct = document.getElementById('contentForm'); if (ct) ct.addEventListener('submit', e => { e.preventDefault(); const f = new FormData(ct); const c = { badge: f.get('badge').trim(), heroTitle: f.get('heroTitle').trim(), heroLede: f.get('heroLede').trim(), whys: String(f.get('whys')).split('\n').map(x => x.trim()).filter(Boolean) }; save('lww_content', c); document.querySelector('#home .eyebrow').textContent = c.badge; document.querySelector('h1.display').innerHTML = c.heroTitle; document.querySelector('#home .lede').textContent = c.heroLede; WHYS.length = 0; c.whys.forEach(w => WHYS.push(w)); log('content saved', 'home page'); toast('Content saved'); });
  };

  /* ---------- actions ---------- */
  document.addEventListener('click', e => {
    const d = e.target.closest('[data-dash]'); if (d) { if (d.classList.contains('off')) { toast('Your role does not have this permission'); return; } section[portalKind] = d.dataset.dash; editing = null; custOpen = null; rerender(); return; }
    const a = e.target.closest('[data-adm]'); if (!a) return;
    const act = a.dataset.adm, id = a.dataset.id;
    if (a.classList.contains('book-card') && e.target.closest('button')) return;
    if (act === 'product-new') { editing = 'new'; rerender(); }
    else if (act === 'product-edit') { editing = id; rerender(); const st = document.querySelector('.studio'); if (st) st.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
    else if (act === 'product-filter') { pFilter = id; rerender(); }
    else if (act === 'product-cancel') { editing = null; rerender(); }
    else if (act === 'product-delete') deleteProduct(id);
    else if (act === 'customer-open') { custOpen = id; rerender(); }
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
    if (act === 'order-status') { const os = orders(); const o = os.find(x => x.id === id); if (o) { o.status = a.value; save('lww_orders', os); log('order ' + a.value, id); toast(id + ' → ' + a.value); } }
    else if (act === 'coupon-toggle') { const cps = read('lww_coupons', []); const c = cps.find(x => x.code === id); if (c) { c.active = a.checked; save('lww_coupons', cps); log('coupon ' + (a.checked ? 'enabled' : 'disabled'), id); } }
    else if (act === 'discount') { const ds = read('lww_discounts', {}); ds[id] = Math.max(0, Math.min(90, parseInt(a.value, 10) || 0)); save('lww_discounts', ds); log('discount set', classById(id).label + ' ' + ds[id] + '%'); toast('Discount saved'); }
    else if (act === 'perm') { const roles = read('lww_roles', DEFAULT_ROLES); const set = new Set(roles[a.dataset.role] || []); if (a.checked) set.add(a.dataset.perm); else set.delete(a.dataset.perm); roles[a.dataset.role] = Array.from(set); save('lww_roles', roles); log('permission ' + (a.checked ? 'granted' : 'removed'), a.dataset.role + ':' + a.dataset.perm); }
    else if (act === 'staff-role') { const st = read('lww_staff_users', []); const u = st.find(x => x.email === id); if (u) { u.rolename = a.value; save('lww_staff_users', st); log('staff role', id + ' → ' + a.value); } }
  });
})();
