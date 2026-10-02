/* Copyright (c) 2026 Learn With Why. All rights reserved. Proprietary — see LICENSE. This notice may not be removed. */
/* AUTH — customer accounts live in the database, not the browser.
   Passwords are hashed with scrypt (salted). A sign-in creates a session row
   and hands the browser a random token in an httpOnly cookie; only the
   token's SHA-256 is stored, so the database alone cannot impersonate anyone.
   The cookie is sent automatically to the API and to the viewer page. */
const crypto = require('node:crypto');
const { fail, json, readBody, cookies, setCookie, clientIp, rateLimiter, sha256, timingEqual, isEmail } = require('./http.cjs');

const COOKIE = 'lww_sid';
const SESSION_DAYS = 30;
const RESET_TTL = 15 * 60e3;
const loginLimit = rateLimiter(20, 10 * 60e3);   /* 20 attempts per 10 minutes per IP+email */

function hashPassword(pw) { const salt = crypto.randomBytes(16); const key = crypto.scryptSync(pw, salt, 64); return salt.toString('hex') + ':' + key.toString('hex'); }
function checkPassword(pw, stored) { const [salt, hash] = String(stored || '').split(':'); if (!salt || !hash) return false; const key = crypto.scryptSync(pw, Buffer.from(salt, 'hex'), 64); return timingEqual(key.toString('hex'), hash); }
function strongPass(p) { p = String(p || ''); if (p.length < 8) return 'At least 8 characters.'; if (!/[A-Z]/.test(p) || !/[0-9]/.test(p)) return 'Add a capital letter and a number.'; if (p.length > 200) return 'Too long.'; return ''; }

function make(db, mail) {
  const q = {
    byEmail: db.q('SELECT * FROM users WHERE email = ?'),
    byId: db.q('SELECT * FROM users WHERE id = ?'),
    insert: db.q('INSERT INTO users (email, name, role, pw_hash, created_at) VALUES (?, ?, ?, ?, ?)'),
    touch: db.q('UPDATE users SET last_login_at = ? WHERE id = ?'),
    setRole: db.q('UPDATE users SET role = ? WHERE id = ?'),
    setName: db.q('UPDATE users SET name = ? WHERE id = ?'),
    setPw: db.q('UPDATE users SET pw_hash = ? WHERE id = ?'),
    newSession: db.q('INSERT INTO sessions (id, user_id, created_at, expires_at, ua, ip) VALUES (?, ?, ?, ?, ?, ?)'),
    getSession: db.q('SELECT s.id AS sid, s.expires_at, u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ? AND s.expires_at > ?'),
    delSession: db.q('DELETE FROM sessions WHERE id = ?'),
    delUserSessions: db.q('DELETE FROM sessions WHERE user_id = ?'),
    purge: db.q('DELETE FROM sessions WHERE expires_at < ?'),
    putReset: db.q('INSERT INTO password_resets (email, code_hash, expires_at, attempts) VALUES (?, ?, ?, 0) ON CONFLICT(email) DO UPDATE SET code_hash = excluded.code_hash, expires_at = excluded.expires_at, attempts = 0'),
    getReset: db.q('SELECT * FROM password_resets WHERE email = ?'),
    bumpReset: db.q('UPDATE password_resets SET attempts = attempts + 1 WHERE email = ?'),
    delReset: db.q('DELETE FROM password_resets WHERE email = ?'),
  };
  setInterval(() => q.purge.run(Date.now()), 3600e3).unref();

  const publicUser = u => ({ id: u.id, name: u.name, email: u.email, role: u.role || null, created: u.created_at });
  /* who is calling? null when there is no valid cookie */
  function userOf(req) {
    const tok = cookies(req)[COOKIE]; if (!tok) return null;
    const row = q.getSession.get(sha256(tok), Date.now()); if (!row) return null;
    req.sessionId = row.sid; return row;
  }
  function requireUser(req) { const u = userOf(req); if (!u) fail(401, 'Sign in to continue.'); return u; }
  function startSession(req, res, user, remember) {
    const tok = crypto.randomBytes(32).toString('base64url'); const ttl = SESSION_DAYS * 86400e3;
    q.newSession.run(sha256(tok), user.id, Date.now(), Date.now() + ttl, String(req.headers['user-agent'] || '').slice(0, 200), clientIp(req));
    q.touch.run(Date.now(), user.id);
    setCookie(res, req, COOKIE, tok, remember ? { maxAge: ttl } : null);
  }

  async function signup(req, res, log) {
    const b = await readBody(req);
    const email = String(b.email || '').trim().toLowerCase(), name = String(b.name || '').trim().slice(0, 80), pass = String(b.password || '');
    const errors = {};
    if (!name) errors.name = 'Tell us your name.';
    if (!isEmail(email) || email.length > 200) errors.email = 'Enter a valid email address.';
    const sp = strongPass(pass); if (sp) errors.password = sp;
    if (Object.keys(errors).length) fail(400, 'Check the form.', { errors });
    if (q.byEmail.get(email)) fail(409, 'That email already has an account. Sign in instead.');
    const r = q.insert.run(email, name, null, hashPassword(pass), Date.now());
    const user = q.byId.get(r.lastInsertRowid);
    startSession(req, res, user, b.remember !== false);
    log('signup', user.id, true, email);
    json(res, 201, { user: publicUser(user) });
  }
  async function signin(req, res, log) {
    const b = await readBody(req);
    const email = String(b.email || '').trim().toLowerCase(), pass = String(b.password || '');
    if (!loginLimit(clientIp(req) + '|' + email)) fail(429, 'Too many attempts — wait a few minutes and try again.');
    const user = isEmail(email) ? q.byEmail.get(email) : null;
    if (!user || !checkPassword(pass, user.pw_hash)) { log('signin_failed', user ? user.id : null, false, email); fail(401, 'We could not match that email and password. New here? Sign up instead.'); }
    startSession(req, res, user, !!b.remember);
    log('signin', user.id, true, email);
    json(res, 200, { user: publicUser(user) });
  }
  function signout(req, res) {
    const tok = cookies(req)[COOKIE]; if (tok) q.delSession.run(sha256(tok));
    setCookie(res, req, COOKIE, '', { maxAge: 0 });
    json(res, 200, { ok: true });
  }
  function me(req, res) { const u = userOf(req); if (!u) return json(res, 401, { error: 'Not signed in.' }); json(res, 200, { user: publicUser(u) }); }
  async function update(req, res) {
    const u = requireUser(req); const b = await readBody(req);
    if (b.role !== undefined) { const role = b.role == null ? null : String(b.role); if (role && !['parent', 'teacher', 'tutor', 'school'].includes(role)) fail(400, 'Unknown role.'); q.setRole.run(role, u.id); }
    if (b.name !== undefined) { const name = String(b.name || '').trim().slice(0, 80); if (!name) fail(400, 'Name cannot be empty.'); q.setName.run(name, u.id); }
    json(res, 200, { user: publicUser(q.byId.get(u.id)) });
  }
  /* Forgot password: a six-digit code, valid 15 minutes. Without a mail service the
     code is printed on the server console; RESET_CODE_IN_RESPONSE=1 (the default outside
     production) also returns it so the demo flow still works on screen. */
  async function forgot(req, res, log) {
    const b = await readBody(req); const email = String(b.email || '').trim().toLowerCase();
    if (!isEmail(email)) fail(400, 'Enter a valid email address.');
    if (!loginLimit(clientIp(req) + '|reset')) fail(429, 'Too many attempts — wait a few minutes and try again.');
    const user = q.byEmail.get(email);
    if (!user) fail(404, 'No account uses that email. Create one instead.');
    const code = String(crypto.randomInt(100000, 1000000));
    q.putReset.run(email, sha256(code + email), Date.now() + RESET_TTL);
    console.log('[auth] password reset code for ' + email + ': ' + code);
    /* with a mail service set up (RESEND_API_KEY + MAIL_FROM) the code is emailed as well */
    if (mail && mail.configured) mail.send({ to: email, subject: 'Your Learn With Why reset code: ' + code, text: 'Hello ' + user.name + ',\n\nYour code to reset your Learn With Why password is ' + code + '. It works for 15 minutes.\n\nIf you did not ask for it, you can ignore this email.' }).then(r => { if (!r.ok) console.warn('[auth] reset code not emailed: ' + r.error); });
    log('reset_requested', user.id, true, email);
    const show = process.env.RESET_CODE_IN_RESPONSE ? process.env.RESET_CODE_IN_RESPONSE === '1' : process.env.NODE_ENV !== 'production';
    json(res, 200, Object.assign({ ok: true, expiresIn: RESET_TTL }, show ? { code } : {}));
  }
  async function reset(req, res, log) {
    const b = await readBody(req); const email = String(b.email || '').trim().toLowerCase(), code = String(b.code || '').trim();
    const r = q.getReset.get(email);
    if (!r || r.expires_at < Date.now()) fail(400, 'That code has expired — ask for a new one.');
    if (r.attempts >= 5) { q.delReset.run(email); fail(400, 'Too many wrong codes — ask for a new one.'); }
    if (!timingEqual(sha256(code + email), r.code_hash)) { q.bumpReset.run(email); fail(400, 'That code does not match.'); }
    if (b.password === undefined) return json(res, 200, { ok: true, verified: true });   /* step 2: just check the code */
    const sp = strongPass(b.password); if (sp) fail(400, sp);
    const user = q.byEmail.get(email); if (!user) fail(404, 'No such account.');
    q.setPw.run(hashPassword(String(b.password)), user.id); q.delReset.run(email); q.delUserSessions.run(user.id);
    log('password_reset', user.id, true, email);
    json(res, 200, { ok: true });
  }

  return { userOf, requireUser, publicUser, signup, signin, signout, me, update, forgot, reset };
}

module.exports = { make, hashPassword, checkPassword, strongPass };
