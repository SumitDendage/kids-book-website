/* Copyright (c) 2026 Learn With Why. All rights reserved. Proprietary — see LICENSE. This notice may not be removed. */
/* ACCESS — who may open which PDF.

   An ENTITLEMENT is a row saying "user U may open worksheet W (or every sheet
   in class C)". A paid one is created by a verified payment; a free sheet gets
   one the moment a signed-in customer opens it. A sheet bought on its own, and a
   free sheet, never expire: once it is yours it stays yours. A class PLAN (1, 3, 6
   or 12 months) runs for its months from the day it starts; a renewal bought while
   it runs starts when it ends, so no day is lost. A class the admin gives without
   a plan does not run out. An admin can still revoke any of them.

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
    covering: db.q(`SELECT * FROM entitlements WHERE user_id = ? AND revoked_at IS NULL
      AND ((scope = 'worksheet' AND worksheet_id = ?) OR (scope = 'class' AND cls = ?)) ORDER BY starts_at DESC`),
    plansOf: db.q("SELECT * FROM entitlements WHERE user_id = ? AND scope = 'class' AND cls = ? AND revoked_at IS NULL"),
    byId: db.q('SELECT * FROM entitlements WHERE id = ? AND user_id = ?'),
    insert: db.q('INSERT INTO entitlements (user_id, scope, worksheet_id, cls, plan, order_id, kind, starts_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'),
    mine: db.q('SELECT e.*, w.title FROM entitlements e LEFT JOIN worksheets w ON w.id = e.worksheet_id WHERE e.user_id = ? AND e.revoked_at IS NULL ORDER BY e.starts_at DESC LIMIT 200'),
    log: db.q('INSERT INTO access_log (at, user_id, worksheet_id, action, ok, detail, ip) VALUES (?, ?, ?, ?, ?, ?, ?)'),
    catalogue: db.q('SELECT id, title, cls, subject, pages, price, file, thumb FROM worksheets WHERE active = 1 ORDER BY cls, id'),
  };
  const log = (req, action, userId, wsId, ok, detail) => { try { q.log.run(Date.now(), userId || null, wsId || null, action, ok ? 1 : 0, detail ? String(detail).slice(0, 300) : null, clientIp(req)); } catch (_) {} };
  /* when a class plan ends (null: never) — its months come from the plan settings */
  const endOf = e => { if (e.scope !== 'class' || !e.plan) return null; const p = db.get('plans')[e.plan]; return p && p.months ? addMonths(e.starts_at, p.months) : null; };
  /* not revoked, started, and not run out */
  const live = (e, now = Date.now()) => { if (e.revoked_at || e.starts_at > now) return false; const end = endOf(e); return !end || end > now; };
  /* the entitlement that opens this sheet now: one that never runs out first (a bought sheet stays
     open after a plan ends), then the newest */
  const liveFor = (userId, w) => q.covering.all(userId, w.id, w.cls).filter(e => live(e)).sort((a, b) => (endOf(a) == null ? 0 : 1) - (endOf(b) == null ? 0 : 1) || b.starts_at - a.starts_at)[0] || null;
  const pub = e => ({ id: e.id, scope: e.scope, worksheet: e.worksheet_id, title: e.title || null, cls: e.cls, plan: e.plan, kind: e.kind, order: e.order_id, start: e.starts_at, end: endOf(e), active: live(e) });
  /* a new plan for a class starts when the plans already running for it end (or now) */
  function planStart(userId, cls, now = Date.now()) {
    let from = now;
    for (const e of q.plansOf.all(userId, cls)) { const end = endOf(e); if (end && end > from) from = end; }
    return from;
  }

  /* grant: called by payments (kind 'paid') and by the free path (kind 'free') */
  function grant(userId, scope, ref, kind, orderId, plan, from) {
    const start = from || Date.now();
    const r = q.insert.run(userId, scope, scope === 'worksheet' ? ref : null, scope === 'class' ? ref : null, plan || null, orderId || null, kind, start);
    return { id: Number(r.lastInsertRowid), start };
  }

  /* THE SERVER ACCESS CHECK. Returns { ent } or throws 402 / 404. */
  function check(user, wsId) {
    const w = q.ws.get(wsId); if (!w) fail(404, 'No such worksheet.');
    let ent = liveFor(user.id, w);
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
    let ent = q.byId.get(p.e, user.id);
    if (!ent || ent.revoked_at) { log(req, 'view', user.id, p.w, false, ent ? 'entitlement revoked' : 'no entitlement'); fail(403, 'This sheet is no longer available on your account.', { code: 'revoked' }); }
    const w = q.ws.get(p.w); if (!w) fail(404, 'No such worksheet.');
    if (ent.scope === 'worksheet' ? ent.worksheet_id !== w.id : ent.cls !== w.cls) fail(403, 'This sheet is not in your plan.', { code: 'invalid' });
    /* the plan this tab was opened with has run out: a renewal (or the sheet bought on its own) carries on */
    if (!live(ent)) {
      const next = liveFor(user.id, w);
      if (!next) { log(req, 'view', user.id, w.id, false, 'plan ended'); fail(403, 'Your ' + (db.get('classes')[w.cls] || w.cls) + ' plan has ended — renew it on the site to keep opening these sheets.', { code: 'expired' }); }
      ent = next;
    }
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
    json(res, 200, { title: w.title, cls: w.cls, subject: w.subject, pages: f && f.pages.length ? f.pages.length : w.pages, kind: ent.kind, scope: ent.scope, since: ent.starts_at, until: endOf(ent), real: !!f, hasPdf: !!(f && f.pdf), hasImages: !!(f && f.pages.length), now: Date.now(), user: { name: user.name, email: user.email } });
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

  /* does the customer already have this sheet open to them (bought, or in a running plan)? */
  const owns = (userId, wsId) => { const w = q.ws.get(wsId); return !!(w && liveFor(userId, w)); };

  return { grant, check, open, meta, file, page, mine, catalogue, files, log, pub, endOf, live, planStart, owns };
}

/* the same day N months later (31 January + 1 month = 28 or 29 February), same time of day */
function addMonths(ms, n) {
  const d = new Date(ms), day = d.getUTCDate();
  d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + n);
  d.setUTCDate(Math.min(day, new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()));
  return d.getTime();
}

module.exports = { make, addMonths };
