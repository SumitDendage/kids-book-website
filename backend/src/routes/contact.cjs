/* Copyright (c) 2026 Learn With Why. All rights reserved. Proprietary — see LICENSE. This notice may not be removed. */
/* CONTACT — the "Leave a little note" form (Contact us on the home page).

     POST /api/contact                 { name, email, message }  → saved in the messages table,
                                       then a copy is emailed to the shop inbox when mail is set up
     GET  /api/admin/messages          the inbox for the admin Messages panel
     POST /api/admin/messages/read     { id }  opened in the panel
     POST /api/admin/messages/replied  { id }  answered (also marks it read)

   The note is stored FIRST, so nothing is lost when mail is down. Each IP may send
   5 notes per 10 minutes; a hidden `website` field filled in by a bot is accepted
   and quietly dropped. */
const { fail, json, readBody, clientIp, rateLimiter, isEmail } = require('./http.cjs');

const noteLimit = rateLimiter(5, 10 * 60e3);
const INBOX_DEFAULT = 'learnwithwhy6@gmail.com';

function make(db, auth, mail) {
  const INBOX = process.env.CONTACT_INBOX || INBOX_DEFAULT;
  const q = {
    insert: db.q('INSERT INTO messages (at, name, email, body, user_id, ip, ua) VALUES (?, ?, ?, ?, ?, ?, ?)'),
    mailed: db.q('UPDATE messages SET mailed = ?, mail_error = ? WHERE id = ?'),
    all: db.q('SELECT * FROM messages ORDER BY at DESC LIMIT ?'),
    byId: db.q('SELECT * FROM messages WHERE id = ?'),
    read: db.q('UPDATE messages SET read_at = ? WHERE id = ? AND read_at IS NULL'),
    replied: db.q('UPDATE messages SET replied_at = ?, read_at = COALESCE(read_at, ?) WHERE id = ?'),
  };
  /* the shape the admin Messages panel and dashboard.js read */
  const pub = m => ({ id: m.id, at: m.at, name: m.name, email: m.email, body: m.body, read: m.read_at || null, replied: m.replied_at || null, mailed: !!m.mailed, mailError: m.mail_error || null, user: m.user_id || null });

  /* POST /api/contact */
  async function post(req, res) {
    const b = await readBody(req, 32 * 1024);
    if (b.website) return json(res, 201, { ok: true });   /* honeypot */
    const name = String(b.name || '').trim().slice(0, 80), email = String(b.email || '').trim().toLowerCase(), message = String(b.message || '').trim();
    const errors = {};
    if (!name) errors.name = 'Your name, please.';
    if (!isEmail(email) || email.length > 200) errors.email = 'Enter a valid email address.';
    if (message.length < 10) errors.message = 'A little more detail helps us reply.';
    if (message.length > 5000) errors.message = 'That note is too long — keep it under 5000 characters.';
    if (Object.keys(errors).length) fail(400, Object.values(errors)[0], { errors });
    if (!noteLimit(clientIp(req))) fail(429, 'You have sent a few notes already — wait a few minutes and try again.');
    const user = auth.userOf(req);
    const r = q.insert.run(Date.now(), name, email, message, user ? user.id : null, clientIp(req), String(req.headers['user-agent'] || '').slice(0, 200));
    const id = Number(r.lastInsertRowid);
    const sent = await mail.send({ to: INBOX, replyTo: email, subject: 'Learn With Why — note from ' + name, text: 'From: ' + name + ' <' + email + '>\n\n' + message + '\n\n— sent through the Contact us form (message #' + id + ')' });
    q.mailed.run(sent.delivered ? 1 : 0, sent.delivered ? null : (sent.error || 'not sent — mail is in ' + mail.mode + ' mode'), id);
    if (!sent.ok && mail.ready) console.warn('[contact] note #' + id + ' saved but not emailed: ' + sent.error);
    json(res, 201, { ok: true, id, mailed: !!sent.delivered });
  }

  /* /api/admin/messages* — called from admin.cjs after the admin key is checked */
  async function admin(req, res, pathname, url) {
    const m = req.method;
    if (m === 'GET' && pathname === '/api/admin/messages') return json(res, 200, { messages: q.all.all(Math.min(2000, +url.searchParams.get('limit') || 500)).map(pub), inbox: INBOX, mail: mail.delivers });
    if (m === 'POST' && (pathname === '/api/admin/messages/read' || pathname === '/api/admin/messages/replied')) {
      const b = await readBody(req); const id = parseInt(b.id, 10);
      if (!q.byId.get(id)) fail(404, 'No such message.');
      if (pathname.endsWith('/read')) q.read.run(Date.now(), id); else q.replied.run(Date.now(), Date.now(), id);
      return json(res, 200, { ok: true, message: pub(q.byId.get(id)) });
    }
    return false;
  }

  return { post, admin, pub, INBOX };
}

module.exports = { make };
