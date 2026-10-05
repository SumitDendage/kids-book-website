/* Copyright (c) 2026 Learn With Why. All rights reserved. Proprietary — see LICENSE. This notice may not be removed. */
/* Test helpers: a throw-away PostgreSQL database per test file, a server on a random
   port with its own SQLite shop store and emails captured in memory, and a small HTTP
   client that keeps the session cookie like a browser.

   TEST_DATABASE_URL must point at a PostgreSQL server where that user may CREATE DATABASE,
   e.g. postgres://lww:lww@127.0.0.1:5432/postgres. The tests never touch DATABASE_URL. */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Client } = require('pg');

const ADMIN_URL = process.env.TEST_DATABASE_URL;
function needDatabase() {
  if (ADMIN_URL) return;
  console.error('\nTEST_DATABASE_URL is not set. Point it at a PostgreSQL server where the user may create databases, e.g.\n' +
    '  TEST_DATABASE_URL=postgres://lww:lww@127.0.0.1:5432/postgres npm test\n(see backend/README.md → Tests)\n');
  process.exit(1);
}

async function adminQuery(sql) { const c = new Client({ connectionString: ADMIN_URL }); await c.connect(); try { return await c.query(sql); } finally { await c.end(); } }
/* CREATE DATABASE lww_test_<random>; returns its URL and a drop() */
async function freshDatabase() {
  needDatabase();
  const name = 'lww_test_' + crypto.randomBytes(5).toString('hex');
  await adminQuery('CREATE DATABASE ' + name);
  const u = new URL(ADMIN_URL); u.pathname = '/' + name;
  return { name, url: u.toString(), drop: () => adminQuery('DROP DATABASE IF EXISTS ' + name + ' WITH (FORCE)') };
}

/* the environment a test server runs with; extra overrides it */
function testEnv(dbUrl, extra) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lww-'));
  const st = path.join(tmp, 'static'); fs.mkdirSync(path.join(st, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(st, 'index.html'), '<!doctype html><div id="root"></div>'); fs.writeFileSync(path.join(st, 'viewer.html'), '<!doctype html><div id="viewer-root"></div>');
  fs.writeFileSync(path.join(st, 'assets', 'main-test.js'), 'console.log(1)');
  const env = {
    DATABASE_URL: dbUrl, DATABASE_SSL: 'disable', DB_PATH: path.join(tmp, 'shop.sqlite'), PROTECTED_DIR: path.join(__dirname, '..', 'protected'), STATIC_DIR: st,
    MAIL_TRANSPORT: 'memory', SITE_URL: 'https://site.test', ADMIN_KEY: 'test-admin-key', NODE_ENV: 'test', LWW_NO_DOTENV: '1',
  };
  ['RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET', 'RAZORPAY_WEBHOOK_SECRET', 'STRIPE_SECRET_KEY', 'PAYPAL_CLIENT_ID', 'PAYPAL_SECRET', 'SMTP_HOST', 'RESEND_API_KEY', 'CORS_ORIGINS', 'PORT', 'HOST'].forEach(k => delete process.env[k]);
  Object.assign(process.env, env, extra || {});
  return { tmp, cleanup: () => fs.rmSync(tmp, { recursive: true, force: true }) };
}

/* start a server on a random port (call testEnv first) */
async function startApp() {
  const { createApp } = require('../server.cjs');
  const app = await createApp();
  await new Promise(r => app.server.listen(0, '127.0.0.1', r));
  app.base = 'http://127.0.0.1:' + app.server.address().port;
  return app;
}

/* a browser-like client: JSON in and out, Origin set, cookie jar of one cookie */
function client(base, opts = {}) {
  const c = { cookie: '', setCookie: '' };
  c.req = async (method, p, body, headers) => {
    const h = Object.assign({ 'Content-Type': 'application/json', Origin: base }, c.cookie ? { Cookie: c.cookie } : {}, opts.ip ? { 'X-Forwarded-For': opts.ip } : {}, headers || {});
    const r = await fetch(base + p, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
    const sc = r.headers.get('set-cookie');
    if (sc) { c.setCookie = sc; const v = sc.split(';')[0]; c.cookie = /=$/.test(v) || /Max-Age=0/.test(sc) ? '' : v; }
    const ct = r.headers.get('content-type') || '';
    return { status: r.status, headers: r.headers, body: ct.includes('json') ? await r.json() : await r.text() };
  };
  ['get', 'post', 'patch', 'put'].forEach(m => { c[m] = (p, body, h) => c.req(m.toUpperCase(), p, body, h); });
  return c;
}

/* emails captured by MAIL_TRANSPORT=memory */
const mailsTo = (app, to) => app.mail.outbox.filter(m => m.to === to);
const lastMail = (app, to) => { const l = mailsTo(app, to); return l[l.length - 1] || null; };
const passwordIn = m => { const x = /Password:\s+([A-Za-z0-9-]{16,})/.exec(m.text); return x && x[1]; };
const tokenIn = (m, param) => { const x = new RegExp('[?&]' + param + '=([A-Za-z0-9_-]+)').exec(m.text); return x && x[1]; };

/* sign up + confirm through the emails; resolves the generated password */
async function signUpAndConfirm(app, c, name, email) {
  const r = await c.post('/api/auth/signup', { name, email });
  if (r.status !== 201) throw new Error('signup ' + r.status + ' ' + JSON.stringify(r.body));
  const m = lastMail(app, email.toLowerCase());
  const v = await c.post('/api/auth/verify-email', { token: tokenIn(m, 'verify') });
  if (v.status !== 200) throw new Error('verify ' + v.status + ' ' + JSON.stringify(v.body));
  return passwordIn(m);
}

const sha256 = s => crypto.createHash('sha256').update(s).digest('hex');
const cookieValue = c => c.cookie.split('=').slice(1).join('=');

module.exports = { freshDatabase, testEnv, startApp, client, mailsTo, lastMail, passwordIn, tokenIn, signUpAndConfirm, sha256, cookieValue, needDatabase, adminQuery };
