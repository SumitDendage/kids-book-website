/* Copyright (c) 2026 Learn With Why. All rights reserved. Proprietary — see LICENSE. This notice may not be removed. */
/* ADMIN API — every route needs the x-admin-key header (ADMIN_KEY env).
   Orders, customers, entitlements (grant / revoke), the worksheet catalogue
   with PDF upload into private storage, store settings, the logs and the
   contact-form inbox (/api/admin/messages*, handled in contact.cjs). */
const fs = require('node:fs');
const path = require('node:path');
const { fail, json, readBody, readRaw, timingEqual } = require('./http.cjs');

function make(db, access, payments, protectedDir, contact) {
  const ADMIN_KEY = process.env.ADMIN_KEY || 'change-me';
  const q = {
    orders: db.q('SELECT o.*, u.email, u.name FROM orders o JOIN users u ON u.id = o.user_id ORDER BY o.created_at DESC LIMIT 500'),
    order: db.q('SELECT * FROM orders WHERE id = ?'),
    setStatus: db.q('UPDATE orders SET status = ? WHERE id = ?'),
    users: db.q(`SELECT u.id, u.email, u.name, u.role, u.created_at, u.last_login_at,
      (SELECT COUNT(*) FROM orders o WHERE o.user_id = u.id AND o.status = 'paid') AS orders,
      (SELECT COALESCE(SUM(o.total_inr), 0) FROM orders o WHERE o.user_id = u.id AND o.status = 'paid') AS spent_inr,
      (SELECT COUNT(*) FROM entitlements e WHERE e.user_id = u.id AND e.revoked_at IS NULL) AS active
      FROM users u ORDER BY u.created_at DESC LIMIT 1000`),
    userByEmail: db.q('SELECT * FROM users WHERE email = ?'),
    ents: db.q('SELECT e.*, u.email, w.title FROM entitlements e JOIN users u ON u.id = e.user_id LEFT JOIN worksheets w ON w.id = e.worksheet_id ORDER BY e.starts_at DESC LIMIT 500'),
    revoke: db.q('UPDATE entitlements SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL'),
    worksheets: db.q('SELECT * FROM worksheets ORDER BY cls, id'),
    ws: db.q('SELECT * FROM worksheets WHERE id = ?'),
    upsertWs: db.q(`INSERT INTO worksheets (id, title, cls, subject, pages, price, file, thumb, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET title = excluded.title, cls = excluded.cls, subject = excluded.subject, pages = excluded.pages, price = excluded.price, thumb = excluded.thumb, active = excluded.active, updated_at = excluded.updated_at`),
    setFile: db.q('UPDATE worksheets SET file = ?, pages = ?, updated_at = ? WHERE id = ?'),
    deactivate: db.q('UPDATE worksheets SET active = 0, updated_at = ? WHERE id = ?'),
    log: db.q('SELECT a.*, u.email FROM access_log a LEFT JOIN users u ON u.id = a.user_id ORDER BY a.at DESC LIMIT ?'),
    payLog: db.q('SELECT * FROM payments ORDER BY at DESC LIMIT ?'),
    stats: db.q(`SELECT (SELECT COUNT(*) FROM users) AS users, (SELECT COUNT(*) FROM orders WHERE status = 'paid') AS paid_orders,
      (SELECT ROUND(COALESCE(SUM(total_inr), 0), 2) FROM orders WHERE status = 'paid') AS revenue_inr,
      (SELECT COUNT(*) FROM entitlements WHERE revoked_at IS NULL) AS active_entitlements,
      (SELECT COUNT(*) FROM worksheets WHERE active = 1) AS worksheets, (SELECT COUNT(*) FROM worksheets WHERE active = 1 AND file IS NOT NULL) AS with_pdf,
      (SELECT COUNT(*) FROM access_log WHERE action = 'access' AND ok = 1 AND at > ?) AS opens_24h,
      (SELECT COUNT(*) FROM messages) AS messages, (SELECT COUNT(*) FROM messages WHERE read_at IS NULL) AS messages_unread`),
  };
  const guard = req => { if (!timingEqual(String(req.headers['x-admin-key'] || ''), ADMIN_KEY)) fail(401, 'Admin key required.'); };
  const ent = e => Object.assign(access.pub(e), { email: e.email, revoked: e.revoked_at || null });
  const ws = w => ({ id: w.id, title: w.title, cls: w.cls, subject: w.subject, pages: w.pages, price: w.price, file: w.file, thumb: w.thumb, active: !!w.active, real: !!access.files(w), updated: w.updated_at });
  /* PDF page count: count /Type /Page objects (good enough for the catalogue; the viewer asks pdf.js) */
  const pdfPages = buf => { const m = buf.toString('latin1').match(/\/Type\s*\/Page[^s]/g); return m ? m.length : 1; };

  async function handle(req, res, pathname, url) {
    guard(req);
    const m = req.method, seg = pathname.split('/').filter(Boolean);   /* ['api','admin',...] */
    if (m === 'GET' && pathname === '/api/admin/stats') return json(res, 200, Object.assign({ gateway: payments.mode, gateways: payments.gateways }, q.stats.get(Date.now() - 86400e3)));
    if (pathname === '/api/admin/messages' || pathname.startsWith('/api/admin/messages/')) { if (contact && (await contact.admin(req, res, pathname, url)) !== false) return; }
    if (m === 'GET' && pathname === '/api/admin/orders') return json(res, 200, { orders: q.orders.all().map(o => Object.assign(payments.pub(o), { email: o.email, name: o.name })) });
    if (m === 'PUT' && pathname === '/api/admin/orders') { const b = await readBody(req); const o = q.order.get(String(b.id || '')); if (!o) fail(404, 'No such order.'); const st = String(b.status || ''); if (!['created', 'paid', 'failed', 'refunded', 'cancelled'].includes(st)) fail(400, 'Unknown status.'); q.setStatus.run(st, o.id); return json(res, 200, { order: payments.pub(q.order.get(o.id)) }); }
    if (m === 'GET' && pathname === '/api/admin/users') return json(res, 200, { users: q.users.all() });
    if (m === 'GET' && pathname === '/api/admin/entitlements') return json(res, 200, { entitlements: q.ents.all().map(ent) });
    if (m === 'POST' && pathname === '/api/admin/entitlements/revoke') { const b = await readBody(req); const r = q.revoke.run(Date.now(), +b.id || 0); return json(res, 200, { ok: true, revoked: r.changes }); }
    if (m === 'POST' && pathname === '/api/admin/entitlements/grant') {
      const b = await readBody(req); const u = q.userByEmail.get(String(b.email || '').trim().toLowerCase()); if (!u) fail(404, 'No customer with that email.');
      const scope = b.scope === 'class' ? 'class' : 'worksheet'; const ref = String(b.ref || '');
      if (scope === 'worksheet' && !q.ws.get(ref)) fail(404, 'No such worksheet.'); if (scope === 'class' && !db.get('classes')[ref]) fail(404, 'No such class.');
      const g = access.grant(u.id, scope, ref, 'paid', null, b.plan || null); return json(res, 200, { ok: true, entitlement: g });
    }
    if (m === 'GET' && pathname === '/api/admin/worksheets') return json(res, 200, { worksheets: q.worksheets.all().map(ws) });
    if (seg[2] === 'worksheets' && seg[3]) {
      const id = decodeURIComponent(seg[3]); if (!/^[a-z0-9][a-z0-9-]{1,60}$/i.test(id)) fail(400, 'Worksheet ids are letters, digits and dashes.');
      if (m === 'PUT' && !seg[4]) {
        const b = await readBody(req); const cur = q.ws.get(id) || {};
        const title = String(b.title ?? cur.title ?? '').trim().slice(0, 120), cls = String(b.cls ?? cur.cls ?? ''), subject = String(b.subject ?? cur.subject ?? '').trim().slice(0, 40);
        if (!title || !subject || !db.get('classes')[cls]) fail(400, 'Title, subject and a known class are required.');
        q.upsertWs.run(id, title, cls, subject, Math.max(1, parseInt(b.pages ?? cur.pages ?? 1, 10) || 1), Math.max(0, parseInt(b.price ?? cur.price ?? 0, 10) || 0), cur.file || null, b.thumb !== undefined ? (b.thumb || null) : (cur.thumb || null), b.active === undefined ? (cur.active === undefined ? 1 : cur.active) : (b.active ? 1 : 0), cur.created_at || Date.now(), Date.now());
        return json(res, 200, { worksheet: ws(q.ws.get(id)) });
      }
      if (m === 'DELETE' && !seg[4]) { q.deactivate.run(Date.now(), id); return json(res, 200, { ok: true }); }
      /* POST /api/admin/worksheets/:id/file — the PDF bytes as the body, into protected storage */
      if (m === 'POST' && seg[4] === 'file') {
        if (!q.ws.get(id)) fail(404, 'Create the worksheet first (PUT /api/admin/worksheets/:id).');
        const buf = await readRaw(req, 40 * 1024 * 1024);
        if (buf.subarray(0, 5).toString() !== '%PDF-') fail(400, 'That is not a PDF.');
        const rel = path.join('uploads', id + '.pdf'); fs.mkdirSync(path.join(protectedDir, 'uploads'), { recursive: true });
        fs.writeFileSync(path.join(protectedDir, rel), buf);
        q.setFile.run(rel.split(path.sep).join('/'), pdfPages(buf), Date.now(), id);
        return json(res, 200, { worksheet: ws(q.ws.get(id)) });
      }
    }
    if (m === 'GET' && pathname === '/api/admin/settings') return json(res, 200, { plans: db.get('plans'), classes: db.get('classes'), coupons: db.get('coupons'), discounts: db.get('discounts'), rates: db.get('rates'), fees: db.get('fees') });
    if (m === 'PUT' && pathname === '/api/admin/plans') { const b = await readBody(req); const plans = db.get('plans'); Object.keys(b).forEach(k => { if (plans[k] && +b[k] >= 0) plans[k].price = +b[k]; }); db.set('plans', plans); return json(res, 200, { plans }); }
    if (m === 'PUT' && pathname === '/api/admin/rates') { const b = await readBody(req); const rates = db.get('rates'); Object.keys(b).forEach(k => { if (rates[k] != null && +b[k] > 0) rates[k] = +b[k]; }); rates.INR = 1; db.set('rates', rates); return json(res, 200, { rates }); }
    if (m === 'PUT' && pathname === '/api/admin/coupons') {
      const b = await readBody(req); const coupons = {}, discounts = {}, classes = db.get('classes');
      (b.coupons || []).forEach(c => { if (c && c.code) coupons[String(c.code).toUpperCase()] = { pct: Math.max(0, Math.min(100, +c.pct || 0)), max: +c.max || 0, uses: +c.uses || 0, active: c.active !== false }; });
      Object.keys(b.discounts || {}).forEach(k => { if (classes[k]) discounts[k] = Math.max(0, Math.min(90, +b.discounts[k] || 0)); });
      db.set('coupons', coupons); db.set('discounts', discounts); return json(res, 200, { ok: true, coupons, discounts });
    }
    if (m === 'GET' && pathname === '/api/admin/access-log') return json(res, 200, { log: q.log.all(Math.min(2000, +url.searchParams.get('limit') || 300)) });
    if (m === 'GET' && pathname === '/api/admin/payments') return json(res, 200, { events: q.payLog.all(Math.min(2000, +url.searchParams.get('limit') || 300)) });
    json(res, 404, { error: 'Not found' });
  }
  return { handle };
}

module.exports = { make };
