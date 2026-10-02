/* Copyright (c) 2026 Learn With Why. All rights reserved. Proprietary — see LICENSE. This notice may not be removed. */
/* ACCESS — who may open which PDF.

   An ENTITLEMENT is a row saying "user U may open worksheet W (or every sheet
   in class C)". A paid one is created by a verified payment; a free sheet gets
   one the moment a signed-in customer opens it. Neither expires: once a sheet
   is yours it stays yours (an admin can still revoke one).

   The PDFs live in site/protected/, outside the web root, and are only ever
   streamed through /api/view/* — every request re-checks the session cookie
   AND the entitlement row, so a link cannot be shared and a revoked sheet
   closes even in a tab that is still open. */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { fail, json, clientIp, timingEqual, b64url } = require('./http.cjs');

const FILE_TYPES = { '.pdf': 'application/pdf', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };

function make(db, auth, protectedDir) {
  const q = {
    ws: db.q('SELECT * FROM worksheets WHERE id = ? AND active = 1'),
    active: db.q(`SELECT * FROM entitlements WHERE user_id = ? AND revoked_at IS NULL
      AND ((scope = 'worksheet' AND worksheet_id = ?) OR (scope = 'class' AND cls = ?)) ORDER BY starts_at DESC LIMIT 1`),
    byId: db.q('SELECT * FROM entitlements WHERE id = ? AND user_id = ?'),
    insert: db.q('INSERT INTO entitlements (user_id, scope, worksheet_id, cls, plan, order_id, kind, starts_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'),
    mine: db.q('SELECT e.*, w.title FROM entitlements e LEFT JOIN worksheets w ON w.id = e.worksheet_id WHERE e.user_id = ? AND e.revoked_at IS NULL ORDER BY e.starts_at DESC LIMIT 200'),
    log: db.q('INSERT INTO access_log (at, user_id, worksheet_id, action, ok, detail, ip) VALUES (?, ?, ?, ?, ?, ?, ?)'),
    catalogue: db.q('SELECT id, title, cls, subject, pages, price, file, thumb FROM worksheets WHERE active = 1 ORDER BY cls, id'),
  };
  const log = (req, action, userId, wsId, ok, detail) => { try { q.log.run(Date.now(), userId || null, wsId || null, action, ok ? 1 : 0, detail ? String(detail).slice(0, 300) : null, clientIp(req)); } catch (_) {} };
  const pub = e => ({ id: e.id, scope: e.scope, worksheet: e.worksheet_id, title: e.title || null, cls: e.cls, plan: e.plan, kind: e.kind, order: e.order_id, start: e.starts_at, active: !e.revoked_at });

  /* grant: called by payments (kind 'paid') and by the free path (kind 'free') */
  function grant(userId, scope, ref, kind, orderId, plan, from) {
    const start = from || Date.now();
    const r = q.insert.run(userId, scope, scope === 'worksheet' ? ref : null, scope === 'class' ? ref : null, plan || null, orderId || null, kind, start);
    return { id: Number(r.lastInsertRowid), start };
  }

  /* THE SERVER ACCESS CHECK. Returns { ent } or throws 402 / 404. */
  function check(user, wsId) {
    const w = q.ws.get(wsId); if (!w) fail(404, 'No such worksheet.');
    let ent = q.active.get(user.id, w.id, w.cls);
    if (!ent && w.price === 0) { const g = grant(user.id, 'worksheet', w.id, 'free', null, null); ent = q.byId.get(g.id, user.id); }
    if (!ent) fail(402, 'Payment required to open this sheet.', { code: 'payment_required', worksheet: w.id, cls: w.cls, price: w.price });
    return { w, ent };
  }

  /* view tokens: HMAC-signed, bound to user + worksheet + entitlement; useless without the cookie, dead once the row is revoked */
  function makeToken(user, w, ent) {
    const body = b64url(JSON.stringify({ u: user.id, w: w.id, e: ent.id }));
    return body + '.' + b64url(crypto.createHmac('sha256', db.secret()).update(body).digest());
  }
  function parseToken(t) {
    const [body, sig] = String(t || '').split('.'); if (!body || !sig) return null;
    const expect = b64url(crypto.createHmac('sha256', db.secret()).update(body).digest());
    if (!timingEqual(expect, sig)) return null;
    try { const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); return p && p.u && p.w && p.e ? p : null; } catch (_) { return null; }
  }
  /* every /api/view request goes through here: cookie, token, and the entitlement row, all three */
  function viewContext(req) {
    const user = auth.userOf(req); if (!user) fail(401, 'Sign in to open this sheet.', { code: 'signin' });
    const p = parseToken(req.headers['x-view-token'] || new URL(req.url, 'http://x').searchParams.get('t'));
    if (!p || p.u !== user.id) { log(req, 'view', user.id, p && p.w, false, 'bad token'); fail(403, 'This link is not valid — open the sheet again from the site.', { code: 'invalid' }); }
    const ent = q.byId.get(p.e, user.id);
    if (!ent || ent.revoked_at) { log(req, 'view', user.id, p.w, false, ent ? 'entitlement revoked' : 'no entitlement'); fail(403, 'This sheet is no longer available on your account.', { code: 'revoked' }); }
    const w = q.ws.get(p.w); if (!w) fail(404, 'No such worksheet.');
    if (ent.scope === 'worksheet' ? ent.worksheet_id !== w.id : ent.cls !== w.cls) fail(403, 'This sheet is not in your plan.', { code: 'invalid' });
    return { user, w, ent };
  }
  /* where a worksheet's pages are: the PDF and, if pre-rendered, page images beside it */
  function files(w) {
    if (!w.file) return null;
    const pdf = path.resolve(protectedDir, w.file);
    if (!pdf.startsWith(protectedDir + path.sep) || !fs.existsSync(pdf)) return null;
    const base = pdf.replace(/\.[^.]+$/, ''); const pages = [];
    for (const ext of ['.jpg', '.png', '.webp']) { if (fs.existsSync(base + ext)) { pages.push(base + ext); break; } }
    for (let n = 1; n < 400 && !pages.length; n++) { const f = base + '-' + n + '.jpg'; if (!fs.existsSync(f)) break; pages.push(f); }
    return { pdf, pages };
  }
  function stream(res, file, extra) {
    const stat = fs.statSync(file);
    res.writeHead(200, Object.assign({ 'Content-Type': FILE_TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Content-Length': stat.size, 'Cache-Control': 'no-store, private', 'X-Robots-Tag': 'noindex, nofollow', 'X-Content-Type-Options': 'nosniff', 'Content-Disposition': 'inline', 'Referrer-Policy': 'no-referrer' }, extra || {}));
    fs.createReadStream(file).pipe(res);
  }

  /* ---- handlers ---- */
  /* POST /api/access/:id — the step after "Customer selects PDF → Login" */
  function open(req, res, wsId) {
    const user = auth.requireUser(req);
    let out;
    try { out = check(user, wsId); } catch (e) { log(req, 'access', user.id, wsId, false, e.message); throw e; }
    const { w, ent } = out; const f = files(w);
    log(req, 'access', user.id, w.id, true, ent.kind + ' · ' + ent.scope);
    json(res, 200, { ok: true, token: makeToken(user, w, ent), worksheet: { id: w.id, title: w.title, pages: w.pages, cls: w.cls, subject: w.subject, price: w.price, real: !!f }, entitlement: pub(ent) });
  }
  /* GET /api/view/meta — the viewer's first call: what to show and for whom (the watermark) */
  function meta(req, res) {
    const { user, w, ent } = viewContext(req); const f = files(w);
    json(res, 200, { title: w.title, cls: w.cls, subject: w.subject, pages: f && f.pages.length ? f.pages.length : w.pages, kind: ent.kind, since: ent.starts_at, real: !!f, hasPdf: !!(f && f.pdf), hasImages: !!(f && f.pages.length), now: Date.now(), user: { name: user.name, email: user.email } });
  }
  /* GET /api/view/file — the PDF itself, straight from private storage */
  function file(req, res) {
    const { user, w } = viewContext(req); const f = files(w);
    if (!f) fail(404, 'This sheet has no PDF yet.', { code: 'nofile' });
    log(req, 'pdf', user.id, w.id, true, null);
    stream(res, f.pdf);
  }
  /* GET /api/view/page?n=0 — a pre-rendered page image (fallback when the PDF cannot be rendered) */
  function page(req, res, url) {
    const { user, w } = viewContext(req); const f = files(w);
    const n = Math.max(0, parseInt(url.searchParams.get('n') || '0', 10) || 0);
    if (!f || !f.pages[n]) fail(404, 'No such page.');
    log(req, 'page', user.id, w.id, true, 'p' + n);
    stream(res, f.pages[n]);
  }
  /* GET /api/me/entitlements — My worksheets / My plans */
  function mine(req, res) { const u = auth.requireUser(req); json(res, 200, { entitlements: q.mine.all(u.id).map(pub), now: Date.now() }); }
  /* GET /api/worksheets — the public catalogue (prices, pages, whether a real PDF is attached) */
  function catalogue(req, res) { json(res, 200, { worksheets: q.catalogue.all().map(w => ({ id: w.id, title: w.title, cls: w.cls, subject: w.subject, pages: w.pages, price: w.price, free: w.price === 0, real: !!files(w), thumb: w.thumb })) }, { 'Cache-Control': 'no-cache' }); }

  return { grant, check, open, meta, file, page, mine, catalogue, files, log, pub };
}

module.exports = { make };
