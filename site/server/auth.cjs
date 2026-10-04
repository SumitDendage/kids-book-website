/* Copyright (c) 2026 Learn With Why. All rights reserved. Proprietary — see LICENSE. This notice may not be removed. */
/* AUTH — customer accounts, in PostgreSQL.

   Sign up      POST /api/auth/signup              { name, email }
                The server makes a random password, stores only its Argon2id hash, and
                emails the password with an "Accept & Continue" link (a single-use
                email-confirmation token, 24 hours). No session yet.
   Confirm      POST /api/auth/verify-email        { token }   (the link opens /?verify=<token>)
                Marks the email verified and the account active; the page then shows sign-in.
   Resend       POST /api/auth/resend-verification { email }
                Not confirmed yet: a NEW password and link are emailed (the old ones stop working).
   Sign in      POST /api/auth/login               { email, password, remember }
                Argon2id check; 5 wrong passwords lock the account for 15 minutes; only a
                confirmed, active account gets a session. The session is a random token in an
                httpOnly, SameSite=Lax cookie (Secure over HTTPS); the database keeps its SHA-256.
   Session      GET  /api/auth/me · PATCH /api/auth/me { role, name }
                POST /api/auth/refresh-token  rotates the cookie token and slides the expiry
                POST /api/auth/logout         revokes the session and clears the cookie
   Reset        POST /api/auth/forgot-password     { email }  → a single-use link, 30 minutes (/?reset=<token>)
                POST /api/auth/reset-password      { token, password }
                The new password is hashed, the link is spent, every session is signed out.

   Forgot-password and resend answer the same way whether or not the email has an account,
   so they cannot be used to find out who is a customer. Every sign-in attempt goes to
   login_activity; account changes go to security_events.

   The rest of the server (shop, viewer, payments, admin) runs on the SQLite store and asks
   auth.userOf(req) / auth.requireUser(req) — both synchronous, because the router has
   already called `await auth.load(req)` for the request. A signed-in customer also gets a
   row in the SQLite users table with the same id ("mirror"), which the shop's orders and
   entitlements point at. */
const crypto = require('node:crypto');
const { fail, json, readBody, cookies, setCookie, clientIp, rateLimiter, sha256, isEmail } = require('./http.cjs');
const passwords = require('./passwords.cjs');
const emails = require('./emails.cjs');

const COOKIE = 'lww_sid';
const ROTATE_GRACE_SECONDS = 60;         /* the token before a refresh still works this long */
const TOKEN_RE = /^[A-Za-z0-9_-]{32,128}$/;
const ROLES = ['parent', 'teacher', 'tutor', 'school'];
const BAD_LOGIN = 'We could not match that email and password. New here? Sign up instead.';
const newToken = () => crypto.randomBytes(32).toString('base64url');
const normEmail = v => String(v == null ? '' : v).trim().toLowerCase();
const validEmail = e => e.length <= 254 && isEmail(e);
/* names: printable text only, single spaces, at most 80 characters */
const cleanName = v => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim();

function make(db, mail, cfg, shop) {
  const A = cfg.auth;
  const limit = {
    signup: rateLimiter(20, 60 * 60e3),        /* sign-ups per IP per hour */
    login: rateLimiter(10, 15 * 60e3),         /* attempts per IP + email per 15 minutes */
    loginIp: rateLimiter(100, 15 * 60e3),      /* attempts per IP per 15 minutes */
    mailEmail: rateLimiter(3, 60 * 60e3),      /* reset / resend emails per address per hour */
    mailIp: rateLimiter(20, 60 * 60e3),        /* reset / resend requests per IP per hour */
    token: rateLimiter(30, 15 * 60e3),         /* confirm / reset submissions per IP per 15 minutes */
  };
  const tooMany = () => fail(429, 'Too many attempts — wait a few minutes and try again.', { code: 'rate_limited' });
  const who = req => ({ ip: clientIp(req) || null, ua: String(req.headers['user-agent'] || '').slice(0, 300) || null });
  const link = (param, token) => cfg.siteUrl + '/?' + param + '=' + token;

  /* a hash to check against when the email is unknown, so "no such account" takes as long as "wrong password" */
  let dummy = null;
  const dummyHash = async () => dummy || (dummy = await passwords.hash(newToken()));

  /* ---------- the trail ---------- */
  async function securityEvent(req, userId, type, detail) {
    const { ip, ua } = req ? who(req) : {};
    try { await db.run('INSERT INTO security_events (user_id, event_type, detail, ip, user_agent) VALUES ($1, $2, $3, $4, $5)', [userId || null, type, detail ? JSON.stringify(detail) : null, ip || null, ua || null]); }
    catch (e) { console.warn('[auth] security event not saved:', e.message); }
  }
  async function loginActivity(req, userId, email, reason) {
    const { ip, ua } = who(req);
    try { await db.run('INSERT INTO login_activity (user_id, email, success, failure_reason, ip, user_agent) VALUES ($1, $2, $3, $4, $5, $6)', [userId || null, email.slice(0, 254), !reason, reason || null, ip, ua]); }
    catch (e) { console.warn('[auth] login activity not saved:', e.message); }
  }

  /* ---------- the shop's copy of the customer (SQLite users row, same id) ---------- */
  const mirrored = new Map();
  const shopQ = shop ? {
    upsert: shop.q(`INSERT INTO users (id, email, name, role, pw_hash, created_at, last_login_at) VALUES (?, ?, ?, ?, '!postgresql', ?, ?)
      ON CONFLICT(id) DO UPDATE SET email = excluded.email, name = excluded.name, role = excluded.role, pw_hash = '!postgresql', last_login_at = excluded.last_login_at`),
    freeEmail: shop.q('UPDATE users SET email = ? WHERE email = ? AND id <> ?'),
  } : null;
  function mirror(u) {
    if (!shopQ) return;
    const sig = u.email + '|' + u.name + '|' + (u.role || '');
    if (mirrored.get(u.id) === sig) return;
    const args = [u.id, u.email, u.name, u.role || null, u.created_at, u.last_login_at || null];
    try { shopQ.upsert.run(...args); }
    catch (e) {
      if (!/UNIQUE constraint failed: users\.email/.test(e.message)) throw e;
      shopQ.freeEmail.run(u.email + '#replaced-' + Date.now(), u.email, u.id);   /* an old row holding this email */
      shopQ.upsert.run(...args);
    }
    mirrored.set(u.id, sig);
  }

  /* ---------- who is calling ---------- */
  const publicUser = u => ({ id: u.id, name: u.name, email: u.email, role: u.role || null, emailVerified: !!u.email_verified, status: u.account_status, created: u.created_at, lastLogin: u.last_login_at || null });
  const allowed = u => !!u && u.email_verified && u.account_status === 'active';

  /* the router calls this once per /api request; afterwards userOf / requireUser are synchronous */
  async function load(req) {
    if (req.auth !== undefined) return req.auth;
    req.auth = null;
    const tok = cookies(req)[COOKIE];
    if (!tok || !TOKEN_RE.test(tok)) return null;
    const row = await db.one(`SELECT s.id AS session_id, s.remember AS session_remember, s.last_used_at AS session_last_used_at,
        (s.token_hash = $1) AS session_current, u.*
      FROM user_sessions s JOIN users u ON u.id = s.user_id
      WHERE (s.token_hash = $1 OR (s.previous_token_hash = $1 AND s.rotated_at > now() - make_interval(secs => $2)))
        AND s.revoked_at IS NULL AND s.expires_at > now()`, [sha256(tok), ROTATE_GRACE_SECONDS]);
    if (!row) return null;
    const { session_id, session_remember, session_last_used_at, session_current, ...user } = row;
    req.auth = { user, session: { id: session_id, remember: session_remember, current: session_current } };
    if (allowed(user)) mirror(user);
    if (Date.now() - session_last_used_at > 5 * 60e3) db.run('UPDATE user_sessions SET last_used_at = now() WHERE id = $1', [session_id]).catch(() => {});
    return req.auth;
  }
  function loaded(req) { if (req.auth === undefined) throw new Error('auth.load(req) has not run for this request'); return req.auth; }
  /* the signed-in customer, or null — only a confirmed, active account counts */
  function userOf(req) { const a = loaded(req); return a && allowed(a.user) ? a.user : null; }
  /* the AUTHENTICATION MIDDLEWARE's check: 401 without a session, 403 for an account that may not be used */
  function requireUser(req) {
    const a = loaded(req);
    if (!a) fail(401, 'Sign in to continue.', { code: 'signin' });
    if (a.user.account_status === 'suspended') fail(403, 'This account is suspended — write to us if you think this is a mistake.', { code: 'account_suspended' });
    if (!a.user.email_verified) fail(403, 'Confirm your email address first — open the email we sent you and press Accept & Continue.', { code: 'email_unverified' });
    return a.user;
  }

  /* ---------- sessions ---------- */
  const ttlSeconds = remember => (remember ? A.sessionDays * 86400 : A.shortSessionHours * 3600);
  async function startSession(req, res, user, remember) {
    const tok = newToken(), { ip, ua } = who(req);
    const s = await db.one(`INSERT INTO user_sessions (user_id, token_hash, remember, ip, user_agent, expires_at)
      VALUES ($1, $2, $3, $4, $5, now() + make_interval(secs => $6)) RETURNING id, expires_at`, [user.id, sha256(tok), !!remember, ip, ua, ttlSeconds(remember)]);
    setCookie(res, req, COOKIE, tok, remember ? { maxAge: s.expires_at - Date.now() } : null);
    return s;
  }
  const revokeAll = (userId, reason) => db.run("UPDATE user_sessions SET revoked_at = now(), revoke_reason = $2 WHERE user_id = $1 AND revoked_at IS NULL", [userId, reason]);

  /* ---------- POST /api/auth/signup ---------- */
  async function signup(req, res) {
    const { ip } = who(req);
    const b = await readBody(req);
    const name = cleanName(b.name), email = normEmail(b.email);
    const errors = {};
    if (!name) errors.name = 'Tell us your name.'; else if (name.length > 80) errors.name = 'Keep the name under 80 characters.';
    if (!validEmail(email)) errors.email = 'Enter a valid email address.';
    if (Object.keys(errors).length) fail(400, Object.values(errors)[0], { errors });
    if (!limit.signup(ip || '-')) tooMany();
    if (!mail.ready) fail(503, 'Sign-up is paused because the server cannot send email yet. Please try again later.', { code: 'mail_unavailable' });
    if (await db.one('SELECT 1 FROM users WHERE email = $1', [email])) fail(409, 'That email already has an account. Sign in instead — or use Forgot password.', { code: 'email_taken', errors: { email: 'That email already has an account.' } });

    const password = passwords.generate(), hash = await passwords.hash(password), token = newToken();
    let user;
    try {
      user = await db.tx(async () => {
        const u = await db.one('INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING *', [name, email, hash]);
        await db.run('INSERT INTO email_verification_tokens (user_id, token_hash, expires_at, created_ip) VALUES ($1, $2, now() + make_interval(hours => $3), $4)', [u.id, sha256(token), A.verifyTtlHours, ip]);
        return u;
      });
    } catch (e) {
      if (e.code === '23505') fail(409, 'That email already has an account. Sign in instead — or use Forgot password.', { code: 'email_taken', errors: { email: 'That email already has an account.' } });
      throw e;
    }
    const sent = await mail.send(emails.welcome({ name, email, password, link: link('verify', token), hours: A.verifyTtlHours }));
    if (!sent.ok) {
      /* nobody can sign in to an account whose password never arrived: take it back */
      await db.run('DELETE FROM users WHERE id = $1', [user.id]);
      console.warn('[auth] sign-up for ' + email + ' undone, welcome email not sent: ' + sent.error);
      fail(502, 'We could not send your welcome email just now, so the account was not created. Please try again in a few minutes.', { code: 'mail_failed' });
    }
    await securityEvent(req, user.id, 'signup', { email_delivered: sent.delivered });
    json(res, 201, { ok: true, verificationRequired: true, email, message: 'Account created! We have emailed your password to ' + email + '. Open that email and press Accept & Continue to confirm your address, then sign in here.' });
  }

  /* ---------- POST /api/auth/login (and the old name, /signin) ---------- */
  async function login(req, res) {
    const { ip } = who(req);
    const b = await readBody(req);
    const email = normEmail(b.email), password = b.password == null ? '' : String(b.password);
    const errors = {};
    if (!validEmail(email)) errors.email = 'Enter a valid email address.';
    if (!password) errors.password = 'Enter your password.';
    if (Object.keys(errors).length) fail(400, Object.values(errors)[0], { errors });
    if (password.length > passwords.MAX_LENGTH) fail(401, BAD_LOGIN, { code: 'bad_credentials' });
    if (!limit.loginIp(ip || '-') || !limit.login((ip || '-') + '|' + email)) { await loginActivity(req, null, email, 'rate_limited'); tooMany(); }

    const user = await db.one('SELECT *, (locked_until IS NOT NULL AND locked_until > now()) AS locked FROM users WHERE email = $1', [email]);
    if (!user) { await passwords.verify(await dummyHash(), password); await loginActivity(req, null, email, 'bad_credentials'); fail(401, BAD_LOGIN, { code: 'bad_credentials' }); }
    const lockedFail = until => fail(429, 'Too many wrong passwords — this account is locked for ' + Math.max(1, Math.ceil((until - Date.now()) / 60e3)) + ' more minute(s). You can unlock it now with Forgot password.', { code: 'account_locked', lockedUntil: until });
    if (user.locked) { await loginActivity(req, user.id, email, 'account_locked'); lockedFail(user.locked_until); }

    if (!(await passwords.verify(user.password_hash, password))) {
      /* count the failure; the Nth in a row locks the account (an expired lock starts the count again) */
      const r = await db.one(`UPDATE users SET
          failed_login_attempts = CASE WHEN locked_until IS NOT NULL AND locked_until <= now() THEN 1 ELSE failed_login_attempts + 1 END,
          locked_until = CASE
            WHEN (CASE WHEN locked_until IS NOT NULL AND locked_until <= now() THEN 1 ELSE failed_login_attempts + 1 END) >= $2 THEN now() + make_interval(mins => $3)
            WHEN locked_until IS NOT NULL AND locked_until <= now() THEN NULL
            ELSE locked_until END
        WHERE id = $1 RETURNING failed_login_attempts, locked_until`, [user.id, A.maxFailedLogins, A.lockMinutes]);
      await loginActivity(req, user.id, email, 'bad_credentials');
      if (r.locked_until && r.failed_login_attempts >= A.maxFailedLogins) {
        await securityEvent(req, user.id, 'account_locked', { attempts: r.failed_login_attempts, minutes: A.lockMinutes });
        lockedFail(r.locked_until);
      }
      fail(401, BAD_LOGIN, { code: 'bad_credentials' });
    }
    /* the password is right — but only a confirmed, active account may sign in */
    if (user.account_status === 'suspended') { await loginActivity(req, user.id, email, 'account_suspended'); fail(403, 'This account is suspended — write to us if you think this is a mistake.', { code: 'account_suspended' }); }
    if (!user.email_verified) {
      await db.run('UPDATE users SET failed_login_attempts = 0, locked_until = NULL WHERE id = $1', [user.id]);
      await loginActivity(req, user.id, email, 'email_unverified');
      fail(403, 'Please confirm your email first: open the email we sent to ' + email + ' and press Accept & Continue.', { code: 'email_unverified', email });
    }
    const rehash = passwords.needsRehash(user.password_hash) ? await passwords.hash(password) : null;
    const fresh = await db.one(`UPDATE users SET failed_login_attempts = 0, locked_until = NULL, last_login_at = now(),
        password_hash = COALESCE($2, password_hash) WHERE id = $1 RETURNING *`, [user.id, rehash]);
    if (rehash) await securityEvent(req, user.id, 'password_rehashed', { to: 'argon2id' });
    await startSession(req, res, fresh, !!b.remember);
    await loginActivity(req, user.id, email, null);
    mirror(fresh);
    json(res, 200, { user: publicUser(fresh) });
  }

  /* ---------- POST /api/auth/logout ---------- */
  async function logout(req, res) {
    const tok = cookies(req)[COOKIE];
    if (tok && TOKEN_RE.test(tok)) {
      const h = sha256(tok);
      const r = await db.one("UPDATE user_sessions SET revoked_at = now(), revoke_reason = 'logout' WHERE (token_hash = $1 OR previous_token_hash = $1) AND revoked_at IS NULL RETURNING user_id", [h]);
      if (r) await securityEvent(req, r.user_id, 'logout', null);
    }
    setCookie(res, req, COOKIE, '', { maxAge: 0 });
    json(res, 200, { ok: true });
  }

  /* ---------- GET /api/auth/me · PATCH /api/auth/me ---------- */
  function me(req, res) { json(res, 200, { user: publicUser(requireUser(req)) }); }
  async function update(req, res) {
    const u = requireUser(req); const b = await readBody(req);
    let role = u.role, name = u.name;
    if (b.role !== undefined) { role = b.role == null || b.role === '' ? null : String(b.role); if (role && !ROLES.includes(role)) fail(400, 'Unknown role.'); }
    if (b.name !== undefined) { name = cleanName(b.name); if (!name || name.length > 80) fail(400, 'Enter a name of 1 to 80 characters.'); }
    const fresh = await db.one('UPDATE users SET role = $2, name = $3 WHERE id = $1 RETURNING *', [u.id, role, name]);
    mirror(fresh);
    json(res, 200, { user: publicUser(fresh) });
  }

  /* ---------- POST /api/auth/refresh-token ---------- */
  async function refreshToken(req, res) {
    const user = requireUser(req), s = req.auth.session;
    let expiresAt = null;
    /* only the current token rotates; the previous one (a parallel tab, within the grace window) just gets the user back */
    if (s.current) {
      const tok = newToken();
      const r = await db.one(`UPDATE user_sessions SET previous_token_hash = token_hash, token_hash = $2, rotated_at = now(), last_used_at = now(),
          expires_at = LEAST(now() + make_interval(secs => $3), created_at + make_interval(days => $4))
        WHERE id = $1 AND token_hash = $5 AND revoked_at IS NULL RETURNING expires_at, remember`, [s.id, sha256(tok), ttlSeconds(s.remember), A.maxSessionDays, sha256(cookies(req)[COOKIE])]);
      if (r) { expiresAt = r.expires_at; setCookie(res, req, COOKIE, tok, r.remember ? { maxAge: Math.max(0, r.expires_at - Date.now()) } : null); }
    }
    json(res, 200, { user: publicUser(user), expiresAt });
  }

  /* ---------- POST /api/auth/verify-email — the Accept & Continue link ---------- */
  async function verifyEmail(req, res) {
    if (!limit.token(who(req).ip || '-')) tooMany();
    const b = await readBody(req); const token = String(b.token || '');
    const bad = () => fail(400, 'This confirmation link is not valid. Sign in to get a new one sent to you.', { code: 'token_invalid' });
    if (!TOKEN_RE.test(token)) bad();
    const out = await db.tx(async () => {
      const t = await db.one(`SELECT t.id, t.user_id, t.used_at, (t.expires_at <= now()) AS expired, u.email, u.email_verified
        FROM email_verification_tokens t JOIN users u ON u.id = t.user_id WHERE t.token_hash = $1 FOR UPDATE OF t`, [sha256(token)]);
      if (!t) return { error: 'invalid' };
      if (t.email_verified) return { already: true, email: t.email };
      if (t.used_at) return { error: 'invalid' };
      if (t.expired) return { error: 'expired', email: t.email };
      await db.run('UPDATE email_verification_tokens SET used_at = now() WHERE id = $1', [t.id]);
      await db.run(`UPDATE users SET email_verified = true, email_verified_at = now(),
          account_status = CASE WHEN account_status = 'pending_verification' THEN 'active' ELSE account_status END WHERE id = $1`, [t.user_id]);
      return { verified: true, email: t.email, userId: t.user_id };
    });
    if (out.error === 'invalid') bad();
    if (out.error === 'expired') fail(400, 'This confirmation link has expired. Sign in and choose "Send the email again" to get a new one.', { code: 'token_expired', email: out.email });
    if (out.verified) await securityEvent(req, out.userId, 'email_verified', null);
    json(res, 200, { ok: true, verified: true, alreadyVerified: !!out.already, email: out.email, message: out.already ? 'Your email is already confirmed — sign in with your password.' : 'Email confirmed! Sign in with the password from your welcome email.' });
  }

  /* the forgot / resend endpoints: same answer for every address, and the email goes out after the response */
  function mailLimits(req, email) { if (!limit.mailIp(who(req).ip || '-') || !limit.mailEmail(email)) tooMany(); }
  function sendLater(what, email, message) { mail.send(message).then(r => { if (!r.ok) console.warn('[auth] ' + what + ' email to ' + email + ' not sent: ' + r.error); }); }

  /* ---------- POST /api/auth/resend-verification ---------- */
  async function resendVerification(req, res) {
    const b = await readBody(req); const email = normEmail(b.email);
    if (!validEmail(email)) fail(400, 'Enter a valid email address.', { errors: { email: 'Enter a valid email address.' } });
    mailLimits(req, email);
    if (!mail.ready) fail(503, 'The server cannot send email yet. Please try again later.', { code: 'mail_unavailable' });
    const generic = { ok: true, message: 'If ' + email + ' has an account that still needs confirming, a new email with a fresh password and confirmation link is on its way.' };
    const user = await db.one('SELECT * FROM users WHERE email = $1', [email]);
    if (!user || user.email_verified || user.account_status === 'suspended') return json(res, 200, generic);
    const password = passwords.generate(), hash = await passwords.hash(password), token = newToken();
    await db.tx(async () => {
      await db.run('UPDATE users SET password_hash = $2, failed_login_attempts = 0, locked_until = NULL WHERE id = $1', [user.id, hash]);
      await db.run('UPDATE email_verification_tokens SET expires_at = LEAST(expires_at, now()) WHERE user_id = $1 AND used_at IS NULL', [user.id]);
      await db.run('INSERT INTO email_verification_tokens (user_id, token_hash, expires_at, created_ip) VALUES ($1, $2, now() + make_interval(hours => $3), $4)', [user.id, sha256(token), A.verifyTtlHours, who(req).ip]);
    });
    await securityEvent(req, user.id, 'verification_resent', null);
    sendLater('verification', email, emails.welcome({ name: user.name, email, password, link: link('verify', token), hours: A.verifyTtlHours, again: true }));
    json(res, 200, generic);
  }

  /* ---------- POST /api/auth/forgot-password ---------- */
  async function forgotPassword(req, res) {
    const b = await readBody(req); const email = normEmail(b.email);
    if (!validEmail(email)) fail(400, 'Enter a valid email address.', { errors: { email: 'Enter a valid email address.' } });
    mailLimits(req, email);
    if (!mail.ready) fail(503, 'The server cannot send email yet. Please try again later.', { code: 'mail_unavailable' });
    const generic = { ok: true, message: 'If ' + email + ' has an account, a password reset link is on its way. It works once, for ' + A.resetTtlMinutes + ' minutes.' };
    const user = await db.one('SELECT * FROM users WHERE email = $1', [email]);
    if (!user || user.account_status === 'suspended') return json(res, 200, generic);
    const token = newToken();
    await db.tx(async () => {
      await db.run('UPDATE password_reset_tokens SET expires_at = LEAST(expires_at, now()) WHERE user_id = $1 AND used_at IS NULL', [user.id]);
      await db.run('INSERT INTO password_reset_tokens (user_id, token_hash, expires_at, created_ip) VALUES ($1, $2, now() + make_interval(mins => $3), $4)', [user.id, sha256(token), A.resetTtlMinutes, who(req).ip]);
    });
    await securityEvent(req, user.id, 'password_reset_requested', null);
    sendLater('reset', email, emails.passwordReset({ name: user.name, email, link: link('reset', token), minutes: A.resetTtlMinutes }));
    json(res, 200, generic);
  }

  /* ---------- POST /api/auth/reset-password ---------- */
  async function resetPassword(req, res) {
    if (!limit.token(who(req).ip || '-')) tooMany();
    const b = await readBody(req); const token = String(b.token || ''), password = b.password == null ? '' : String(b.password);
    const bad = () => fail(400, 'This reset link is not valid. Ask for a new one with Forgot password.', { code: 'token_invalid' });
    if (!TOKEN_RE.test(token)) bad();
    const weak = passwords.strength(password); if (weak) fail(400, weak, { errors: { password: weak } });
    const hash = await passwords.hash(password);
    const out = await db.tx(async () => {
      const t = await db.one(`SELECT t.id, t.user_id, t.used_at, (t.expires_at <= now()) AS expired, u.account_status, u.email, u.name
        FROM password_reset_tokens t JOIN users u ON u.id = t.user_id WHERE t.token_hash = $1 FOR UPDATE OF t`, [sha256(token)]);
      if (!t || t.account_status === 'suspended') return { error: 'invalid' };
      if (t.used_at) return { error: 'used' };
      if (t.expired) return { error: 'expired' };
      await db.run('UPDATE password_reset_tokens SET used_at = now() WHERE user_id = $1 AND used_at IS NULL', [t.user_id]);
      /* the link came through the inbox, so it also confirms the email address */
      await db.run(`UPDATE users SET password_hash = $2, password_changed_at = now(), failed_login_attempts = 0, locked_until = NULL,
          email_verified = true, email_verified_at = COALESCE(email_verified_at, now()),
          account_status = CASE WHEN account_status = 'pending_verification' THEN 'active' ELSE account_status END WHERE id = $1`, [t.user_id, hash]);
      await revokeAll(t.user_id, 'password_reset');
      return { userId: t.user_id, email: t.email, name: t.name };
    });
    if (out.error === 'invalid') bad();
    if (out.error === 'used') fail(400, 'This reset link was already used. Ask for a new one with Forgot password.', { code: 'token_used' });
    if (out.error === 'expired') fail(400, 'This reset link has expired. Ask for a new one with Forgot password.', { code: 'token_expired' });
    await securityEvent(req, out.userId, 'password_reset', null);
    sendLater('password-changed', out.email, emails.passwordChanged({ name: out.name, email: out.email, siteUrl: cfg.siteUrl }));
    json(res, 200, { ok: true, message: 'Password updated. Sign in with your new password.' });
  }

  /* ---------- staff (called from admin.cjs after the admin key is checked) ---------- */
  const staff = {
    users: () => db.many('SELECT id, name, email, role, email_verified, account_status, failed_login_attempts, locked_until, created_at, updated_at, last_login_at FROM users ORDER BY created_at DESC LIMIT 1000'),
    count: async () => (await db.one('SELECT COUNT(*)::int AS n FROM users')).n,
    byEmail: email => db.one('SELECT * FROM users WHERE email = $1', [normEmail(email)]),
    mirror,
    async setStatus(req, id, status) {
      if (!['active', 'suspended'].includes(status)) fail(400, 'Status is active or suspended.');
      const u = await db.one('SELECT * FROM users WHERE id = $1', [id]); if (!u) fail(404, 'No such customer.');
      if (status === 'active' && !u.email_verified) fail(400, 'This customer has not confirmed their email yet.');
      const fresh = await db.one('UPDATE users SET account_status = $2 WHERE id = $1 RETURNING *', [id, status]);
      if (status === 'suspended') await revokeAll(id, 'suspended');
      await securityEvent(req, id, 'account_' + status, { by: 'admin' });
      return publicUser(fresh);
    },
    events: n => db.many('SELECT e.*, u.email FROM security_events e LEFT JOIN users u ON u.id = e.user_id ORDER BY e.created_at DESC LIMIT $1', [n]),
    logins: n => db.many('SELECT * FROM login_activity ORDER BY created_at DESC LIMIT $1', [n]),
  };

  /* old rows are kept 30 days for the security trail, then removed */
  const sweep = () => Promise.all([
    db.run("DELETE FROM user_sessions WHERE expires_at < now() - interval '30 days' OR revoked_at < now() - interval '30 days'"),
    db.run("DELETE FROM email_verification_tokens WHERE expires_at < now() - interval '30 days'"),
    db.run("DELETE FROM password_reset_tokens WHERE expires_at < now() - interval '30 days'"),
  ]).catch(e => console.warn('[auth] sweep:', e.message));
  const timer = setInterval(sweep, 3600e3); timer.unref();

  return {
    COOKIE, load, userOf, requireUser, publicUser, securityEvent,
    signup, login, logout, me, update, refreshToken, verifyEmail, resendVerification, forgotPassword, resetPassword,
    staff, sweep, close: () => clearInterval(timer),
  };
}

module.exports = { make, normEmail, cleanName };
