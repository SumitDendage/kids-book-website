/* Copyright (c) 2026 Learn With Why. All rights reserved. Proprietary — see LICENSE. This notice may not be removed.
   Backend tests: the account API end to end, against a throw-away PostgreSQL database.
     TEST_DATABASE_URL=postgres://… node --test test/auth.test.cjs */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers.cjs');
const { PASSWORD_LINE } = require('../server/emails.cjs');

let app, pdb, env, ipN = 0;
/* each test gets its own client IP, so the per-IP rate limits of one test do not spill into the next */
const fresh = () => H.client(app.base, { ip: '10.0.0.' + (++ipN) });
const q = (sql, params) => app.pg.many(sql, params);
const one = (sql, params) => app.pg.one(sql, params);

before(async () => { pdb = await H.freshDatabase(); env = H.testEnv(pdb.url); app = await H.startApp(); });
after(async () => { if (app) await app.close(); if (pdb) await pdb.drop(); if (env) env.cleanup(); });

test('sign-up checks the form', async () => {
  const c = fresh();
  let r = await c.post('/api/auth/signup', { name: '', email: 'nope' });
  assert.equal(r.status, 400); assert.ok(r.body.errors.name && r.body.errors.email);
  r = await c.post('/api/auth/signup', { name: 'A'.repeat(81), email: 'a@example.com' });
  assert.equal(r.status, 400); assert.ok(r.body.errors.name);
  r = await c.post('/api/auth/signup', { name: 'Ria', email: 'x'.repeat(250) + '@example.com' });
  assert.equal(r.status, 400); assert.ok(r.body.errors.email);
  assert.equal((await one('SELECT COUNT(*)::int AS n FROM users')).n, 0);
});

test('sign-up stores a hashed generated password and emails it with Accept & Continue', async () => {
  const c = fresh();
  const r = await c.post('/api/auth/signup', { name: '  Ria   Sharma ', email: 'Ria@Example.COM', password: 'ignored-by-the-server' });
  assert.equal(r.status, 201); assert.equal(r.body.verificationRequired, true); assert.equal(r.body.email, 'ria@example.com');
  assert.equal(c.cookie, '', 'no session before the email is confirmed');
  const u = await one('SELECT * FROM users WHERE email = $1', ['ria@example.com']);
  assert.equal(u.name, 'Ria Sharma'); assert.equal(u.email_verified, false); assert.equal(u.account_status, 'pending_verification');
  assert.ok(u.created_at > 0 && u.updated_at > 0); assert.equal(u.last_login_at, null);
  const m = H.lastMail(app, 'ria@example.com');
  assert.ok(m, 'welcome email sent');
  const password = H.passwordIn(m), token = H.tokenIn(m, 'verify');
  assert.match(password, /^[A-Za-z0-9]{4}-[A-Za-z0-9]{4}-[A-Za-z0-9]{4}-[A-Za-z0-9]{4}$/);
  assert.ok(m.text.includes(PASSWORD_LINE) && m.html.includes('Accept &amp; Continue'));
  assert.ok(m.text.includes('https://site.test/?verify=' + token), 'the link goes to SITE_URL, never to the request host');
  assert.match(u.password_hash, /^\$argon2id\$/); assert.ok(!u.password_hash.includes(password), 'never stored as plain text');
  const t = await one('SELECT * FROM email_verification_tokens WHERE user_id = $1', [u.id]);
  assert.equal(t.token_hash, H.sha256(token)); assert.equal(t.used_at, null);
  assert.ok(t.expires_at - Date.now() > 23 * 3600e3 && t.expires_at - Date.now() <= 24 * 3600e3 + 5000, 'expires in 24 hours');
  assert.equal((await q("SELECT * FROM security_events WHERE user_id = $1 AND event_type = 'signup'", [u.id])).length, 1);
});

test('an email can register only once (any letter case)', async () => {
  const c = fresh();
  assert.equal((await c.post('/api/auth/signup', { name: 'Dev', email: 'dev@example.com' })).status, 201);
  const r = await c.post('/api/auth/signup', { name: 'Dev 2', email: 'DEV@example.com' });
  assert.equal(r.status, 409); assert.equal(r.body.code, 'email_taken');
  assert.equal((await one("SELECT COUNT(*)::int AS n FROM users WHERE email = 'dev@example.com'")).n, 1);
});

test('no sign-in until the email is confirmed; the link confirms it once', async () => {
  const c = fresh();
  await c.post('/api/auth/signup', { name: 'Kiran', email: 'kiran@example.com' });
  const m = H.lastMail(app, 'kiran@example.com'), password = H.passwordIn(m), token = H.tokenIn(m, 'verify');
  let r = await c.post('/api/auth/login', { email: 'kiran@example.com', password });
  assert.equal(r.status, 403); assert.equal(r.body.code, 'email_unverified'); assert.equal(c.cookie, '');
  const act = await one("SELECT * FROM login_activity WHERE email = 'kiran@example.com' ORDER BY id DESC LIMIT 1");
  assert.equal(act.success, false); assert.equal(act.failure_reason, 'email_unverified');

  r = await c.post('/api/auth/verify-email', { token: 'x'.repeat(43) }); assert.equal(r.status, 400); assert.equal(r.body.code, 'token_invalid');
  r = await c.post('/api/auth/verify-email', { token: "' OR 1=1 --" }); assert.equal(r.status, 400);
  r = await c.post('/api/auth/verify-email', { token });
  assert.equal(r.status, 200); assert.equal(r.body.verified, true); assert.equal(r.body.alreadyVerified, false);
  const u = await one("SELECT * FROM users WHERE email = 'kiran@example.com'");
  assert.equal(u.email_verified, true); assert.ok(u.email_verified_at); assert.equal(u.account_status, 'active');
  assert.ok((await one('SELECT used_at FROM email_verification_tokens WHERE user_id = $1', [u.id])).used_at);
  r = await c.post('/api/auth/verify-email', { token }); assert.equal(r.status, 200); assert.equal(r.body.alreadyVerified, true);

  r = await c.post('/api/auth/login', { email: 'kiran@example.com', password, remember: true });
  assert.equal(r.status, 200); assert.equal(r.body.user.email, 'kiran@example.com'); assert.equal(r.body.user.emailVerified, true);
  assert.ok(!('password_hash' in r.body.user));
});

test('an expired confirmation link is refused', async () => {
  const c = fresh();
  await c.post('/api/auth/signup', { name: 'Late', email: 'late@example.com' });
  const token = H.tokenIn(H.lastMail(app, 'late@example.com'), 'verify');
  await app.pg.run("UPDATE email_verification_tokens SET expires_at = now() - interval '1 minute' WHERE token_hash = $1", [H.sha256(token)]);
  const r = await c.post('/api/auth/verify-email', { token });
  assert.equal(r.status, 400); assert.equal(r.body.code, 'token_expired');
  assert.equal((await one("SELECT email_verified FROM users WHERE email = 'late@example.com'")).email_verified, false);
});

test('sign-in: httpOnly cookie, only a hash in the database, generic errors', async () => {
  const c = fresh();
  const password = await H.signUpAndConfirm(app, c, 'Mira', 'mira@example.com');
  let r = await c.post('/api/auth/login', { email: 'mira@example.com', password: 'Wrong-pass-1' });
  assert.equal(r.status, 401);
  const unknown = await c.post('/api/auth/login', { email: 'nobody@example.com', password: 'Wrong-pass-1' });
  assert.equal(unknown.status, 401); assert.equal(unknown.body.error, r.body.error, 'same answer for an unknown email');
  r = await c.post('/api/auth/login', { email: 'MIRA@example.com', password, remember: true });
  assert.equal(r.status, 200);
  assert.match(c.setCookie, /^lww_sid=[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; SameSite=Lax; Max-Age=\d+/);
  const s = await one('SELECT * FROM user_sessions WHERE token_hash = $1', [H.sha256(H.cookieValue(c))]);
  assert.ok(s && s.remember && !s.revoked_at); assert.ok(s.expires_at - Date.now() > 29 * 86400e3);
  assert.equal((await one("SELECT COUNT(*)::int AS n FROM user_sessions WHERE token_hash = $1", [H.cookieValue(c)])).n, 0, 'the raw token is not stored');
  const u = await one("SELECT * FROM users WHERE email = 'mira@example.com'"); assert.ok(u.last_login_at);
  const acts = await q("SELECT success, failure_reason FROM login_activity WHERE email = 'mira@example.com' ORDER BY id");
  assert.deepEqual(acts.map(a => a.failure_reason), ['bad_credentials', null]);

  /* without "keep me signed in": a browser-session cookie */
  const c2 = fresh(); r = await c2.post('/api/auth/login', { email: 'mira@example.com', password });
  assert.equal(r.status, 200); assert.ok(!/Max-Age/.test(c2.setCookie));
});

test('authentication middleware guards the protected routes', async () => {
  const anon = fresh();
  for (const [m, p] of [['GET', '/api/auth/me'], ['PATCH', '/api/auth/me'], ['POST', '/api/auth/refresh-token'], ['GET', '/api/me/entitlements'], ['GET', '/api/me/orders'], ['POST', '/api/access/az-A'], ['GET', '/api/view/meta'], ['POST', '/api/pay/order']]) {
    const r = await anon.req(m, p, m === 'GET' ? undefined : {});
    assert.equal(r.status, 401, m + ' ' + p); assert.equal(r.body.code, 'signin');
  }
  anon.cookie = 'lww_sid=' + 'A'.repeat(43);   /* a made-up token */
  assert.equal((await anon.get('/api/auth/me')).status, 401);
  const c = fresh(); const password = await H.signUpAndConfirm(app, c, 'Guard', 'guard@example.com');
  await c.post('/api/auth/login', { email: 'guard@example.com', password });
  let r = await c.get('/api/auth/me'); assert.equal(r.status, 200); assert.equal(r.body.user.name, 'Guard');
  r = await c.get('/api/me/entitlements'); assert.equal(r.status, 200);
  r = await c.post('/api/access/az-A'); assert.equal(r.status, 200); assert.equal(r.body.entitlement.kind, 'free');
  r = await c.patch('/api/auth/me', { role: 'teacher', name: 'Guard T' }); assert.equal(r.status, 200); assert.equal(r.body.user.role, 'teacher');
  r = await c.patch('/api/auth/me', { role: 'hacker' }); assert.equal(r.status, 400);
});

test('refresh-token rotates the cookie; the old one works only for a short grace period', async () => {
  const c = fresh(); const password = await H.signUpAndConfirm(app, c, 'Rot', 'rot@example.com');
  await c.post('/api/auth/login', { email: 'rot@example.com', password, remember: true });
  const old = c.cookie;
  const r = await c.post('/api/auth/refresh-token'); assert.equal(r.status, 200); assert.equal(r.body.user.email, 'rot@example.com'); assert.ok(r.body.expiresAt > Date.now());
  assert.notEqual(c.cookie, old);
  assert.equal((await c.get('/api/auth/me')).status, 200);
  const other = fresh(); other.cookie = old;
  assert.equal((await other.get('/api/auth/me')).status, 200, 'a second tab still holding the old token is not signed out');
  await app.pg.run("UPDATE user_sessions SET rotated_at = now() - interval '10 minutes' WHERE token_hash = $1", [H.sha256(H.cookieValue(c))]);
  assert.equal((await other.get('/api/auth/me')).status, 401, 'after the grace period the old token is dead');
  assert.equal((await c.get('/api/auth/me')).status, 200);
});

test('logout revokes the session on the server', async () => {
  const c = fresh(); const password = await H.signUpAndConfirm(app, c, 'Out', 'out@example.com');
  await c.post('/api/auth/login', { email: 'out@example.com', password });
  const tok = H.cookieValue(c);
  const r = await c.post('/api/auth/logout'); assert.equal(r.status, 200); assert.match(c.setCookie, /Max-Age=0/);
  const s = await one('SELECT * FROM user_sessions WHERE token_hash = $1', [H.sha256(tok)]);
  assert.ok(s.revoked_at); assert.equal(s.revoke_reason, 'logout');
  const replay = fresh(); replay.cookie = 'lww_sid=' + tok;
  assert.equal((await replay.get('/api/auth/me')).status, 401, 'a copied cookie is useless after logout');
});

test('five wrong passwords lock the account for a while', async () => {
  const c = fresh(); const password = await H.signUpAndConfirm(app, c, 'Lock', 'lock@example.com');
  for (let i = 1; i <= 4; i++) assert.equal((await c.post('/api/auth/login', { email: 'lock@example.com', password: 'Wrong-' + i + 'A' })).status, 401);
  let r = await c.post('/api/auth/login', { email: 'lock@example.com', password: 'Wrong-5A' });
  assert.equal(r.status, 429); assert.equal(r.body.code, 'account_locked');
  r = await c.post('/api/auth/login', { email: 'lock@example.com', password });
  assert.equal(r.status, 429, 'even the right password waits'); assert.equal(c.cookie, '');
  assert.equal((await q("SELECT * FROM security_events e JOIN users u ON u.id = e.user_id WHERE u.email = 'lock@example.com' AND e.event_type = 'account_locked'")).length, 1);
  await app.pg.run("UPDATE users SET locked_until = now() - interval '1 second' WHERE email = 'lock@example.com'");
  r = await c.post('/api/auth/login', { email: 'lock@example.com', password });
  assert.equal(r.status, 200);
  const u = await one("SELECT failed_login_attempts, locked_until FROM users WHERE email = 'lock@example.com'");
  assert.equal(u.failed_login_attempts, 0); assert.equal(u.locked_until, null);
});

test('forgot password: the same answer for every email; a single-use link resets the password', async () => {
  const c = fresh(); const password = await H.signUpAndConfirm(app, c, 'Reset', 'reset@example.com');
  await c.post('/api/auth/login', { email: 'reset@example.com', password });
  const before = app.mail.outbox.length;
  const nobody = await c.post('/api/auth/forgot-password', { email: 'ghost@example.com' });
  assert.equal(nobody.status, 200); assert.equal(app.mail.outbox.length, before, 'nothing is sent for an unknown email');
  let r = await c.post('/api/auth/forgot-password', { email: 'reset@example.com' });
  assert.equal(r.status, 200); assert.equal(r.body.message.replace('reset@', 'x@'), nobody.body.message.replace('ghost@', 'x@'));
  const m = H.lastMail(app, 'reset@example.com'); const token = H.tokenIn(m, 'reset');
  assert.ok(m.text.includes('https://site.test/?reset=' + token));
  const t = await one('SELECT * FROM password_reset_tokens WHERE token_hash = $1', [H.sha256(token)]);
  assert.ok(t.expires_at - Date.now() <= 30 * 60e3 + 5000 && t.expires_at - Date.now() > 29 * 60e3, 'expires in 30 minutes');

  r = await c.post('/api/auth/reset-password', { token, password: 'short' }); assert.equal(r.status, 400); assert.ok(r.body.errors.password);
  r = await c.post('/api/auth/reset-password', { token, password: 'nocapital123' }); assert.equal(r.status, 400);
  r = await c.post('/api/auth/reset-password', { token, password: 'Brand-New-Pass9' }); assert.equal(r.status, 200);
  assert.equal((await c.get('/api/auth/me')).status, 401, 'every session is signed out');
  assert.ok(H.lastMail(app, 'reset@example.com').subject.includes('was changed'), 'a password-changed notice is sent');
  r = await c.post('/api/auth/reset-password', { token, password: 'Another-Pass9' }); assert.equal(r.status, 400); assert.equal(r.body.code, 'token_used');
  assert.equal((await c.post('/api/auth/login', { email: 'reset@example.com', password })).status, 401, 'the old password is gone');
  assert.equal((await c.post('/api/auth/login', { email: 'reset@example.com', password: 'Brand-New-Pass9' })).status, 200);
  const u = await one("SELECT password_changed_at, password_hash FROM users WHERE email = 'reset@example.com'");
  assert.ok(u.password_changed_at); assert.match(u.password_hash, /^\$argon2id\$/);
});

test('reset links expire, and asking again kills the previous link', async () => {
  const c = fresh(); await H.signUpAndConfirm(app, c, 'Exp', 'exp@example.com');
  await c.post('/api/auth/forgot-password', { email: 'exp@example.com' }); const first = H.tokenIn(H.lastMail(app, 'exp@example.com'), 'reset');
  await c.post('/api/auth/forgot-password', { email: 'exp@example.com' }); const second = H.tokenIn(H.lastMail(app, 'exp@example.com'), 'reset');
  let r = await c.post('/api/auth/reset-password', { token: first, password: 'Brand-New-Pass9' }); assert.equal(r.status, 400); assert.equal(r.body.code, 'token_expired');
  await app.pg.run("UPDATE password_reset_tokens SET expires_at = now() - interval '1 second' WHERE token_hash = $1", [H.sha256(second)]);
  r = await c.post('/api/auth/reset-password', { token: second, password: 'Brand-New-Pass9' }); assert.equal(r.status, 400); assert.equal(r.body.code, 'token_expired');
});

test('a reset link also confirms an email that was never confirmed', async () => {
  const c = fresh(); await c.post('/api/auth/signup', { name: 'Skip', email: 'skip@example.com' });
  await c.post('/api/auth/forgot-password', { email: 'skip@example.com' });
  const token = H.tokenIn(H.lastMail(app, 'skip@example.com'), 'reset');
  assert.equal((await c.post('/api/auth/reset-password', { token, password: 'Own-Choice-9' })).status, 200);
  assert.equal((await c.post('/api/auth/login', { email: 'skip@example.com', password: 'Own-Choice-9' })).status, 200);
});

test('resend-verification: a new password and link; the old ones stop working', async () => {
  const c = fresh(); await c.post('/api/auth/signup', { name: 'Again', email: 'again@example.com' });
  const m1 = H.lastMail(app, 'again@example.com');
  let r = await c.post('/api/auth/resend-verification', { email: 'again@example.com' }); assert.equal(r.status, 200);
  const m2 = H.lastMail(app, 'again@example.com'); assert.notEqual(m2, m1); assert.ok(m2.text.includes(PASSWORD_LINE));
  assert.notEqual(H.passwordIn(m2), H.passwordIn(m1));
  assert.equal((await c.post('/api/auth/verify-email', { token: H.tokenIn(m1, 'verify') })).body.code, 'token_expired');
  assert.equal((await c.post('/api/auth/verify-email', { token: H.tokenIn(m2, 'verify') })).status, 200);
  assert.equal((await c.post('/api/auth/login', { email: 'again@example.com', password: H.passwordIn(m1) })).status, 401);
  assert.equal((await c.post('/api/auth/login', { email: 'again@example.com', password: H.passwordIn(m2) })).status, 200);
  const count = app.mail.outbox.length;
  r = await c.post('/api/auth/resend-verification', { email: 'again@example.com' }); assert.equal(r.status, 200);
  assert.equal(app.mail.outbox.length, count, 'a confirmed account gets nothing (and the answer does not say so)');
});

test('if the welcome email cannot be sent, the account is not created', async () => {
  const send = app.mail.send;
  app.mail.send = async () => ({ ok: false, delivered: false, error: 'SMTP down' });
  try {
    const r = await fresh().post('/api/auth/signup', { name: 'Down', email: 'down@example.com' });
    assert.equal(r.status, 502); assert.equal(r.body.code, 'mail_failed');
  } finally { app.mail.send = send; }
  assert.equal(await one("SELECT * FROM users WHERE email = 'down@example.com'"), null);
  assert.equal((await fresh().post('/api/auth/signup', { name: 'Down', email: 'down@example.com' })).status, 201, 'trying again works');
});

test('SQL injection is just text', async () => {
  const c = fresh();
  let r = await c.post('/api/auth/login', { email: "' OR '1'='1' --", password: "' OR '1'='1" }); assert.equal(r.status, 400);
  r = await c.post('/api/auth/login', { email: "a'--@example.com", password: "x' OR 1=1 --" }); assert.equal(r.status, 401);
  const evil = "Robert'); DROP TABLE users; --";
  r = await c.post('/api/auth/signup', { name: evil, email: "o'brien@example.com" }); assert.equal(r.status, 201);
  const u = await one('SELECT name, email FROM users WHERE email = $1', ["o'brien@example.com"]);
  assert.equal(u.name, "Robert'); DROP TABLE users; --".replace(/[<>]/g, '')); assert.ok((await one('SELECT COUNT(*)::int AS n FROM users')).n > 1);
});

test('rate limits: sign-ups per IP and sign-in attempts per IP + email', async () => {
  const c = H.client(app.base, { ip: '10.9.9.9' });
  let last;
  for (let i = 0; i < 21; i++) last = await c.post('/api/auth/signup', { name: 'Bulk', email: 'bulk' + i + '@example.com' });
  assert.equal(last.status, 429); assert.equal(last.body.code, 'rate_limited');
  const d = H.client(app.base, { ip: '10.9.9.10' });
  for (let i = 0; i < 10; i++) assert.equal((await d.post('/api/auth/login', { email: 'nobody@example.com', password: 'Guess-' + i })).status, 401);
  last = await d.post('/api/auth/login', { email: 'nobody@example.com', password: 'Guess-10' });
  assert.equal(last.status, 429);
  assert.equal((await one("SELECT failure_reason FROM login_activity WHERE email = 'nobody@example.com' ORDER BY id DESC LIMIT 1")).failure_reason, 'rate_limited');
});

test('a suspended account is signed out and cannot sign in', async () => {
  const c = fresh(); const password = await H.signUpAndConfirm(app, c, 'Sus', 'sus@example.com');
  await c.post('/api/auth/login', { email: 'sus@example.com', password });
  const id = (await one("SELECT id FROM users WHERE email = 'sus@example.com'")).id;
  const A = { 'x-admin-key': 'test-admin-key' };
  assert.equal((await fresh().put('/api/admin/users/status', { id, status: 'suspended' })).status, 401, 'needs the admin key');
  let r = await fresh().put('/api/admin/users/status', { id, status: 'suspended' }, A); assert.equal(r.status, 200); assert.equal(r.body.user.status, 'suspended');
  assert.equal((await c.get('/api/auth/me')).status, 401);
  r = await c.post('/api/auth/login', { email: 'sus@example.com', password }); assert.equal(r.status, 403); assert.equal(r.body.code, 'account_suspended');
  r = await fresh().put('/api/admin/users/status', { id, status: 'active' }, A); assert.equal(r.status, 200);
  assert.equal((await c.post('/api/auth/login', { email: 'sus@example.com', password })).status, 200);
  r = await fresh().get('/api/admin/users', undefined, A);
  const row = r.body.users.find(x => x.email === 'sus@example.com'); assert.equal(row.email_verified, true); assert.equal(row.account_status, 'active');
  r = await fresh().get('/api/admin/security-events', undefined, A); assert.ok(r.body.events.some(e => e.event_type === 'account_suspended'));
  r = await fresh().get('/api/admin/login-activity', undefined, A); assert.ok(r.body.logins.length > 0);
});

test('security headers, cross-site refusal, JSON errors', async () => {
  const r = await fetch(app.base + '/api/auth/me');
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff'); assert.equal(r.headers.get('x-frame-options'), 'SAMEORIGIN');
  assert.equal(r.headers.get('referrer-policy'), 'strict-origin-when-cross-origin'); assert.match(r.headers.get('content-security-policy'), /default-src 'none'/);
  assert.equal(r.headers.get('cache-control'), 'no-store');
  const x = await fresh().post('/api/auth/login', { email: 'a@example.com', password: 'x' }, { Origin: 'https://evil.example' });
  assert.equal(x.status, 403);
  const bad = await fetch(app.base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{not json' });
  assert.equal(bad.status, 400); assert.equal((await bad.json()).error, 'Body must be JSON');
  const huge = await fetch(app.base + '/api/auth/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'x'.repeat(70000) }) });
  assert.equal(huge.status, 413);
});
