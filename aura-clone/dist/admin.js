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
  const ORDER_STATUS = ['pending', 'paid', 'shipped', 'delivered', 'cancelled', 'refunded'];
  const PERMS = ['products', 'orders', 'customers', 'analytics', 'coupons', 'content', 'roles', 'audit', 'developer'];
  const DEFAULT_ROLES = { admin: PERMS.slice(), editor: ['products', 'content'], support: ['orders', 'customers'], developer: ['developer', 'audit'] };
  let section = { admin: 'overview', developer: 'health' }, editing = null, custOpen = null;
  /* ---------- dashboard styles ---------- */
  const style = document.createElement('style');
  style.textContent = `
  .dash { display: grid; grid-template-columns: 230px 1fr; gap: 18px; align-items: start; }
  @media (max-width: 860px) { .dash { grid-template-columns: 1fr; } }
  .dash-nav { position: sticky; top: 96px; }
  .dash-main { display: grid; gap: 18px; min-width: 0; }
  .side-btn.off { opacity: 0.4; }
  .row-between { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-bottom: 8px; }
  .row-between .eyebrow { margin-bottom: 0; }
  .row-form { display: grid; grid-template-columns: 1fr 110px 170px auto; gap: 8px; margin-bottom: 14px; }
  @media (max-width: 720px) { .row-form { grid-template-columns: 1fr 1fr; } }
  .row-form input { background: rgba(255,255,255,0.07); border: 1px solid var(--glass-border); padding: 10px 12px; border-radius: var(--r-md); color: #fff; font: inherit; }
  .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  @media (max-width: 760px) { .grid-2 { grid-template-columns: 1fr; } }
  .field select, .table select { width: 100%; background: rgba(255,255,255,0.07); border: 1px solid var(--glass-border); padding: 10px 12px; border-radius: var(--r-md); color: #fff; font: inherit; }
  .field select option, .table select option { color: #000; }
  .field input[type=file] { padding: 8px; }
  .field small { font-size: 0.72rem; color: var(--fg-dim); }
  .table select { width: auto; padding: 5px 8px; font-size: 0.78rem; }
  .table input[type=number] { width: 90px; }
  .tbl-wrap { overflow-x: auto; }
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
  .table td small { color: var(--fg-dim); }`;
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
    const max = Math.max(1, ...series), W = 560, H = 140, n = series.length, bw = W / n;
    return `<svg class="chart" viewBox="0 0 ${W} ${H + 22}" preserveAspectRatio="none">${series.map((v, i) => { const h = Math.round(v / max * H); return `<rect x="${(i * bw + 2).toFixed(1)}" y="${H - h}" width="${(bw - 4).toFixed(1)}" height="${h}" rx="3" fill="${color}" opacity="${v ? 0.9 : 0.25}"><title>${labels[i]}: ${v}</title></rect>`; }).join('')}${labels.map((l, i) => (i % Math.ceil(n / 7) === 0 ? `<text x="${(i * bw + bw / 2).toFixed(1)}" y="${H + 16}" font-size="10" text-anchor="middle" fill="rgba(255,255,255,0.5)">${l.slice(5)}</text>` : '')).join('')}</svg>`;
  }
  function funnel(steps) {
    const max = Math.max(1, steps[0][1]);
    return `<div class="funnel">${steps.map(([l, v], i) => `<div class="funnel-row"><span>${l}</span><i style="width:${Math.max(4, v / max * 100)}%"></i><b>${v}${i ? ' · ' + Math.round(v / Math.max(1, steps[i - 1][1]) * 100) + '%' : ''}</b></div>`).join('')}</div>`;
  }

  /* ---------- layout ---------- */
  window.dashRender = function (kind, who) {
    const secs = kind === 'admin' ? ADMIN_SECTIONS : DEV_SECTIONS, cur = section[kind];
    const perms = permsOf(who);
    const nav = secs.map(([id, label]) => `<button type="button" class="side-btn${id === cur ? ' on' : ''}${perms.includes(id) || kind === 'developer' || id === 'overview' ? '' : ' off'}" data-dash="${id}">${label}</button>`).join('');
    let main = '';
    try { main = (kind === 'admin' ? ADMIN[cur] : DEV[cur])(); } catch (err) { main = '<section class="panel"><p class="cart-empty">Could not render this section: ' + esc(err.message) + '</p></section>'; }
    return `<div class="dash"><aside class="panel dash-nav"><p class="side-title">${kind === 'admin' ? 'Admin' : 'Developer'} · ${esc(staffEmail())}</p><div class="side-list">${nav}</div><p class="side-note" style="margin-top:14px">Route: <code>/#${kind}</code></p></aside><div class="dash-main">${main}</div></div>`;
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
    return `<div class="stat-row"><div class="stat"><b>${users().length}</b><span>Customers</span></div><div class="stat"><b>${subs.length}</b><span>Active subscriptions</span></div><div class="stat"><b>${money(rev)}</b><span>Revenue</span></div><div class="stat"><b>${ev.filter(e => e.type === 'visit').length}</b><span>Visits</span></div><div class="stat"><b>${ITEMS.length}</b><span>Products</span></div></div>
      <section class="panel"><p class="eyebrow">Latest orders</p>${table(['Order', 'Customer', 'Class · plan', 'Amount', 'Status', 'When'], os.slice(-6).reverse().map(o => [o.id, esc(o.email), esc(classById(o.cls).label) + ' · ' + planOf(o.plan).label, money(o.amount), pill(o.status), fmt(o.at)]), 'No orders yet.')}</section>
      <section class="panel"><p class="eyebrow">Sales · last 14 days</p>${bars(lastDays(14).map(d => os.filter(o => day(o.at) === d).reduce((n, o) => n + o.amount, 0)), lastDays(14), '#f0b455')}</section>`;
  };

  /* ----- products ----- */
  ADMIN.products = () => {
    const list = ITEMS.slice().sort((a, b) => (a.cls || '').localeCompare(b.cls || ''));
    const form = editing ? productForm(editing === 'new' ? {} : itemById(editing)) : '';
    return `${form}<section class="panel"><div class="row-between"><p class="eyebrow">Products · ${list.length}</p><button type="button" class="btn btn-primary" data-adm="product-new">+ Add product</button></div>
      <p class="auth-sub">Categories are the classes and subjects; stock, price, images, PDFs, age group, audience and limits are per product.</p>
      ${table(['', 'Product', 'Category', 'Age group', 'For', 'Price', 'Stock', 'Limits', ''], list.map(it => [
        it.image ? `<img class="p-thumb" src="${it.image}" alt="">` : `<span class="thumb-glyph">${esc(it.glyph)}</span>`,
        `<b>${esc(it.title)}</b><br><small>${it.pdf ? '📄 ' + esc(it.pdf.name) : 'no PDF'} · ${it.pages || '?'} pages</small>`,
        esc(it.cls ? classById(it.cls).label + ' · ' : '') + esc(it.subject),
        esc(it.ageGroup || it.ages || ''), esc(({ parent: 'Parents', teacher: 'Teachers', both: 'Both' })[it.audience || 'both']),
        it.price === 0 ? '<span class="pill" style="background:#1f6b47">Free</span>' : money(it.price),
        it.stock == null ? '∞' : it.stock,
        (it.printLimit ? 'print ' + it.printLimit : 'print ∞') + ' · ' + (it.downloadLimit ? 'dl ' + it.downloadLimit : 'dl ∞'),
        `<button type="button" class="link" data-adm="product-edit" data-id="${it.id}">Edit</button> &nbsp; <button type="button" class="link" data-adm="product-delete" data-id="${it.id}">Delete</button>`,
      ]), 'No products.')}</section>
      <section class="panel"><p class="eyebrow">Categories</p><div class="chips">${CLASSES.map(c => `<span class="chip">${esc(c.label)} <small>${ITEMS.filter(i => i.cls === c.id).length}</small></span>`).join('')}${SUBJECTS.map(x => `<span class="chip">${esc(x.label)} <small>${ITEMS.filter(i => i.subjectId === x.id || i.subject === x.label).length}</small></span>`).join('')}</div>
      <p class="co-note">Classes and subjects come from <code>CLASSES</code> / <code>SUBJECTS</code> at the top of the page script.</p></section>`;
  };
  function productForm(it) {
    const v = k => esc(it[k] == null ? '' : it[k]);
    return `<section class="panel"><p class="eyebrow">${it.id ? 'Edit product' : 'Add product'}</p><form id="productForm" data-id="${it.id || ''}">
      <div class="grid-2">
        <div class="field"><label>Title</label><input name="title" value="${v('title')}" required></div>
        <div class="field"><label>Glyph shown on the cover</label><input name="glyph" value="${v('glyph')}" placeholder="Aa"></div>
        <div class="field"><label>Class</label><select name="cls">${CLASSES.map(c => `<option value="${c.id}"${c.id === it.cls ? ' selected' : ''}>${c.label}</option>`).join('')}</select></div>
        <div class="field"><label>Subject</label><select name="subjectId">${SUBJECTS.map(x => `<option value="${x.id}"${x.id === (it.subjectId || (SUBJECTS.find(y => y.label === it.subject) || {}).id) ? ' selected' : ''}>${x.label}</option>`).join('')}</select></div>
        <div class="field"><label>Price ₹ (0 = free access sheet)</label><input name="price" type="number" min="0" value="${it.price == null ? 0 : it.price}"></div>
        <div class="field"><label>Stock (blank = unlimited)</label><input name="stock" type="number" min="0" value="${it.stock == null ? '' : it.stock}"></div>
        <div class="field"><label>Pages</label><input name="pages" type="number" min="1" value="${it.pages || 8}"></div>
        <div class="field"><label>Age group</label><input name="ageGroup" value="${v('ageGroup') || v('ages')}" placeholder="4–6 years"></div>
        <div class="field"><label>For</label><select name="audience"><option value="both"${(it.audience || 'both') === 'both' ? ' selected' : ''}>Parents & teachers</option><option value="parent"${it.audience === 'parent' ? ' selected' : ''}>Parents</option><option value="teacher"${it.audience === 'teacher' ? ' selected' : ''}>Teachers</option></select></div>
        <div class="field"><label>Print limit per customer (blank = unlimited)</label><input name="printLimit" type="number" min="0" value="${it.printLimit || ''}"></div>
        <div class="field"><label>Download limit per customer (blank = unlimited)</label><input name="downloadLimit" type="number" min="0" value="${it.downloadLimit || ''}"></div>
        <div class="field"><label>Cover image</label><input name="image" type="file" accept="image/*">${it.image ? '<small>current image kept unless you choose another</small>' : ''}</div>
        <div class="field"><label>PDF</label><input name="pdf" type="file" accept="application/pdf">${it.pdf ? '<small>current: ' + esc(it.pdf.name) + ' (' + kb(it.pdf.size) + ')</small>' : ''}</div>
      </div>
      <div class="field"><label>Description</label><textarea name="blurb">${v('blurb')}</textarea></div>
      <div class="btn-row"><button type="submit" class="btn btn-primary">Save product</button><button type="button" class="btn btn-ghost" data-adm="product-cancel">Cancel</button></div></form></section>`;
  }
  function readFile(file, max) { return new Promise(res => { if (!file) return res(null); if (file.size > max) { toast('File too large for the demo (' + kb(file.size) + ') — keeping the name only'); return res({ name: file.name, size: file.size }); } const r = new FileReader(); r.onload = () => res({ name: file.name, size: file.size, data: r.result }); r.readAsDataURL(file); }); }
  async function saveProduct(form) {
    const f = new FormData(form), id = form.dataset.id || ('p-' + Date.now().toString(36));
    const o = read('lww_products', { added: [], edited: {}, deleted: [] });
    const fields = { title: f.get('title').trim(), glyph: f.get('glyph').trim() || '✎', cls: f.get('cls'), subjectId: f.get('subjectId'), subject: subjectById(f.get('subjectId')).label, price: Math.max(0, parseInt(f.get('price'), 10) || 0), stock: f.get('stock') === '' ? null : parseInt(f.get('stock'), 10), pages: parseInt(f.get('pages'), 10) || 8, ageGroup: f.get('ageGroup').trim(), audience: f.get('audience'), printLimit: parseInt(f.get('printLimit'), 10) || 0, downloadLimit: parseInt(f.get('downloadLimit'), 10) || 0, blurb: f.get('blurb').trim() };
    if (!fields.title) return toast('Give the product a title');
    const img = await readFile(f.get('image') && f.get('image').size ? f.get('image') : null, 600 * 1024); if (img) fields.image = img.data;
    const pdf = await readFile(f.get('pdf') && f.get('pdf').size ? f.get('pdf') : null, 1500 * 1024); if (pdf) fields.pdf = { name: pdf.name, size: pdf.size, data: pdf.data || null };
    const it = itemById(id);
    if (it) { Object.assign(it, fields); if (o.added.some(x => x.id === id)) o.added = o.added.map(x => x.id === id ? it : x); else o.edited[id] = Object.assign(o.edited[id] || {}, fields); log('product edited', fields.title); }
    else { const np = Object.assign({ id, kind: 'sheet', ages: fields.ageGroup, skills: [], bullets: [], was: null }, fields); CATALOGUE.push(np); ITEMS.push(np); o.added.push(np); log('product added', fields.title); }
    save('lww_products', o); editing = null; renderPlayer(); renderWorksheets(); rerender(); toast('Product saved');
  }
  function deleteProduct(id) {
    const it = itemById(id); if (!it || !confirm('Delete "' + it.title + '"?')) return;
    const o = read('lww_products', { added: [], edited: {}, deleted: [] });
    if (o.added.some(x => x.id === id)) o.added = o.added.filter(x => x.id !== id); else if (!o.deleted.includes(id)) o.deleted.push(id);
    delete o.edited[id]; save('lww_products', o);
    [CATALOGUE, SHEETS, WORKSHEETS, ITEMS].forEach(a => { const i = a.findIndex(x => x.id === id); if (i >= 0) a.splice(i, 1); });
    log('product deleted', it.title); renderPlayer(); renderWorksheets(); rerender(); toast('Deleted');
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
  DEV.db = () => { const keys = Object.keys(localStorage).filter(k => k.startsWith('lww_')); const rows = keys.map(k => { const v = localStorage.getItem(k) || ''; let n = ''; try { const j = JSON.parse(v); n = Array.isArray(j) ? j.length + ' rows' : typeof j === 'object' ? Object.keys(j).length + ' keys' : ''; } catch (_) {} return [k, n, kb(v.length)]; }); const total = keys.reduce((n, k) => n + (localStorage.getItem(k) || '').length, 0); return `<div class="stat-row"><div class="stat"><b>${keys.length}</b><span>Tables (keys)</span></div><div class="stat"><b>${kb(total)}</b><span>Used</span></div><div class="stat"><b id="quotaStat">…</b><span>Quota</span></div></div><section class="panel"><p class="eyebrow">Database health · localStorage (demo)</p><p class="auth-sub">In production these become Supabase tables — see <code>learn-with-why/supabase/migrations</code>.</p>${table(['Table', 'Size', 'Bytes'], rows, 'Empty.')}</section>`; };
  DEV.payments = () => { const p = read('lww_payments', []).slice().reverse(); return `<section class="panel"><p class="eyebrow">Payment logs · ${p.length}</p>${table(['When', 'Order', 'Gateway', 'Amount', 'Status'], p.map(x => [fmt(x.at), x.order, esc(x.gateway), money(x.amount), pill(x.status, '#1f6b47') + (x.demo ? ' <small>demo</small>' : '')]), 'No payments yet.')}</section>`; };
  DEV.webhooks = () => { const w = read('lww_webhooks', []).slice().reverse(); return `<section class="panel"><p class="eyebrow">Webhook logs · ${w.length}</p><p class="auth-sub">Gateways call back here after a payment; the real endpoint verifies the signature and unlocks the subscription.</p>${table(['When', 'Gateway', 'Event', 'Order', 'Response'], w.map(x => [fmt(x.at), esc(x.gateway), esc(x.event), x.order, pill(String(x.status), '#1f6b47')]), 'No webhooks yet.')}</section>`; };
  DEV.auth = () => { const a = events().filter(e => ['signin', 'signup', 'signin_failed'].includes(e.type)).slice().reverse(); return `<section class="panel"><p class="eyebrow">Authentication logs · ${a.length}</p>${table(['When', 'Event', 'Email'], a.map(x => [fmt(x.at), pill(x.type.replace('_', ' '), x.type === 'signin_failed' ? '#7a2b2b' : '#1f6b47'), esc(x.email || x.who || '')]), 'No sign-ins yet.')}</section>`; };
  DEV.perf = () => { const nav = performance.getEntriesByType('navigation')[0] || {}; const paints = performance.getEntriesByType('paint'); const fcp = paints.find(p => p.name === 'first-contentful-paint'); return `<div class="stat-row"><div class="stat"><b>${Math.round(nav.domContentLoadedEventEnd || 0)} ms</b><span>DOM ready</span></div><div class="stat"><b>${Math.round(nav.loadEventEnd || 0)} ms</b><span>Load</span></div><div class="stat"><b>${fcp ? Math.round(fcp.startTime) : '—'} ms</b><span>First paint</span></div><div class="stat"><b id="fpsStat">…</b><span>FPS</span></div><div class="stat"><b>${Math.round(nav.transferSize / 1024) || '—'} KB</b><span>HTML transfer</span></div></div><section class="panel"><p class="eyebrow">Performance monitoring</p>${table(['Metric', 'Value'], [['Frames loaded', readyCount + ' of ' + TOTAL], ['Frames in flight', inflight], ['Device pixel ratio', devicePixelRatio], ['Viewport', innerWidth + ' × ' + innerHeight], ['Connection', (navigator.connection || {}).effectiveType || 'n/a'], ['Reduced motion', matchMedia('(prefers-reduced-motion: reduce)').matches ? 'yes' : 'no']], '')}</section>`; };
  DEV.security = () => { const s = read('lww_security', []).slice().reverse(); return `<section class="panel"><div class="row-between"><p class="eyebrow">Security events · ${s.length}</p><button type="button" class="btn btn-ghost" data-adm="clear" data-key="lww_security">Clear</button></div>${table(['When', 'Event', 'Email', 'Where'], s.map(x => [fmt(x.at), pill(x.type.replace(/_/g, ' '), '#7a2b2b'), esc(x.email || ''), esc(x.where || '')]), 'No failed logins or suspicious activity.')}</section>`; };
  DEV.deploy = () => `<section class="panel"><p class="eyebrow">Deployments</p><div class="stat-row"><div class="stat"><b>${SITE_VERSION}</b><span>Site version</span></div><div class="stat"><b id="commitStat">…</b><span>Latest commit</span></div><div class="stat"><b>${location.hostname}</b><span>Host</span></div></div><div id="commitBox" class="dev-list"><div>Fetching <a href="https://github.com/SumitDendage/kids-book-website/commits/main" target="_blank" rel="noopener" style="color:#fff">SumitDendage/kids-book-website</a>…</div></div></section>`;
  DEV.backups = () => `<section class="panel"><p class="eyebrow">Backups</p><p class="auth-sub">Export everything the site keeps (customers, subscriptions, orders, products, logs) as one JSON file; import it on another machine or after a reset.</p><div class="btn-row"><button type="button" class="btn btn-primary" data-adm="backup">Download backup</button><label class="btn btn-ghost">Restore from file<input type="file" accept="application/json" id="restoreFile" hidden></label><button type="button" class="btn btn-ghost" data-adm="wipe">Wipe demo data</button></div>${table(['Table', 'Size'], Object.keys(localStorage).filter(k => k.startsWith('lww_')).map(k => [k, kb((localStorage.getItem(k) || '').length)]), '')}</section>`;
  DEV.audit = () => auditView();

  /* ---------- helpers ---------- */
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
    const cf = document.getElementById('couponForm'); if (cf) cf.addEventListener('submit', e => { e.preventDefault(); const f = new FormData(cf), code = String(f.get('code')).trim().toUpperCase(); if (!code) return; const cps = read('lww_coupons', []).filter(c => c.code !== code); cps.push({ code, pct: Math.min(100, parseInt(f.get('pct'), 10) || 10), max: parseInt(f.get('max'), 10) || 0, uses: 0, active: true }); save('lww_coupons', cps); log('coupon added', code); rerender(); });
    const ct = document.getElementById('contentForm'); if (ct) ct.addEventListener('submit', e => { e.preventDefault(); const f = new FormData(ct); const c = { badge: f.get('badge').trim(), heroTitle: f.get('heroTitle').trim(), heroLede: f.get('heroLede').trim(), whys: String(f.get('whys')).split('\n').map(x => x.trim()).filter(Boolean) }; save('lww_content', c); document.querySelector('#home .eyebrow').textContent = c.badge; document.querySelector('h1.display').innerHTML = c.heroTitle; document.querySelector('#home .lede').textContent = c.heroLede; WHYS.length = 0; c.whys.forEach(w => WHYS.push(w)); log('content saved', 'home page'); toast('Content saved'); });
  };

  /* ---------- actions ---------- */
  document.addEventListener('click', e => {
    const d = e.target.closest('[data-dash]'); if (d) { if (d.classList.contains('off')) { toast('Your role does not have this permission'); return; } section[portalKind] = d.dataset.dash; editing = null; custOpen = null; rerender(); return; }
    const a = e.target.closest('[data-adm]'); if (!a) return;
    const act = a.dataset.adm, id = a.dataset.id;
    if (act === 'product-new') { editing = 'new'; rerender(); }
    else if (act === 'product-edit') { editing = id; rerender(); }
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
