/* Copyright (c) 2026 Learn With Why. All rights reserved. Proprietary — see LICENSE. This notice may not be removed.
   Database tests: migrations, the schema's rules, transactions and the one-time carry-over
   of accounts from the SQLite store — against a throw-away PostgreSQL database.
     TEST_DATABASE_URL=postgres://… node --test test/db.test.cjs */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const H = require('./helpers.cjs');
const PG = require('../server/pg.cjs');
const { migrate, DIR } = require('../server/migrate.cjs');
const { importAccounts } = require('../server/legacy.cjs');
const passwords = require('../server/passwords.cjs');
const DB = require('../server/db.cjs');

let pdb, db;
const rejects = (p, constraint) => assert.rejects(p, e => (constraint ? e.constraint === constraint : true) && /^23/.test(e.code), 'expected constraint ' + constraint);
const hex64 = () => crypto.randomBytes(32).toString('hex');
async function user(email, extra = {}) {
  return db.one('INSERT INTO users (name, email, password_hash, email_verified, email_verified_at, account_status) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
    [extra.name || 'Test', email, 'x', !!extra.verified, extra.verified ? new Date() : null, extra.verified ? 'active' : 'pending_verification']);
}

before(async () => { pdb = await H.freshDatabase(); db = PG.connect({ url: pdb.url, ssl: 'disable', max: 4 }); });
after(async () => { if (db) await db.close(); if (pdb) await pdb.drop(); });

test('migrations apply once and are recorded with a checksum', async () => {
  assert.deepEqual(await migrate(db.pool), ['001_auth_schema.sql']);
  assert.deepEqual(await migrate(db.pool), [], 'running again changes nothing');
  const rows = await db.many('SELECT version, name, checksum FROM schema_migrations');
  assert.equal(rows.length, 1); assert.equal(rows[0].version, '001'); assert.match(rows[0].checksum, /^[0-9a-f]{64}$/);
});

test('two servers starting together apply each migration once', async () => {
  const other = await H.freshDatabase(); const a = PG.connect({ url: other.url, ssl: 'disable', max: 2 }), b = PG.connect({ url: other.url, ssl: 'disable', max: 2 });
  try {
    const [x, y] = await Promise.all([migrate(a.pool), migrate(b.pool)]);
    assert.deepEqual([...x, ...y], ['001_auth_schema.sql']);
  } finally { await a.close(); await b.close(); await other.drop(); }
});

test('a migration edited after it ran stops the start', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lww-mig-'));
  fs.copyFileSync(path.join(DIR, '001_auth_schema.sql'), path.join(dir, '001_auth_schema.sql'));
  fs.appendFileSync(path.join(dir, '001_auth_schema.sql'), '\n-- edited\n');
  await assert.rejects(migrate(db.pool, dir), /was edited after it was applied/);
  fs.writeFileSync(path.join(dir, '001_auth_schema.sql'), fs.readFileSync(path.join(DIR, '001_auth_schema.sql'), 'utf8').replace(/\r?\n/g, '\r\n'));
  assert.deepEqual(await migrate(db.pool, dir), [], 'Windows line endings are the same file');
  fs.writeFileSync(path.join(dir, '002_broken.sql'), 'CREATE TABLE ok_table (id int); SELECT * FROM no_such_table;');
  await assert.rejects(migrate(db.pool, dir), /002_broken.sql failed/);
  assert.equal(await db.one("SELECT to_regclass('ok_table') AS t").then(r => r.t), null, 'a failed migration leaves nothing behind');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('the tables and columns the account system needs exist', async () => {
  const cols = await db.many("SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public'");
  const has = (t, list) => list.forEach(c => assert.ok(cols.some(x => x.table_name === t && x.column_name === c), t + '.' + c));
  has('users', ['id', 'name', 'email', 'password_hash', 'email_verified', 'account_status', 'created_at', 'updated_at', 'last_login_at', 'failed_login_attempts', 'locked_until']);
  has('email_verification_tokens', ['user_id', 'token_hash', 'expires_at', 'used_at']);
  has('password_reset_tokens', ['user_id', 'token_hash', 'expires_at', 'used_at']);
  has('user_sessions', ['user_id', 'token_hash', 'expires_at', 'revoked_at', 'remember']);
  has('login_activity', ['user_id', 'email', 'success', 'failure_reason', 'ip', 'created_at']);
  has('security_events', ['user_id', 'event_type', 'detail', 'created_at']);
});

test('users: unique, lower-case email; an active account must be confirmed; updated_at moves', async () => {
  const u = await user('one@example.com');
  await rejects(user('one@example.com'), 'users_email_key');
  await rejects(user('One@example.com'), 'users_email_check');
  await rejects(user('not-an-email'), 'users_email_check');
  await rejects(db.run("UPDATE users SET account_status = 'active' WHERE id = $1", [u.id]), 'users_active_is_verified');
  await rejects(db.run("UPDATE users SET account_status = 'deleted' WHERE id = $1", [u.id]), 'users_account_status_check');
  await rejects(db.run('UPDATE users SET email_verified = true WHERE id = $1', [u.id]), 'users_verified_at');
  await rejects(db.run("UPDATE users SET role = 'admin' WHERE id = $1", [u.id]), 'users_role_check');
  await new Promise(r => setTimeout(r, 15));
  const v = await db.one("UPDATE users SET name = 'Renamed' WHERE id = $1 RETURNING updated_at, created_at", [u.id]);
  assert.ok(v.updated_at > u.updated_at); assert.equal(v.created_at, u.created_at);
  assert.equal(typeof v.created_at, 'number', 'timestamps come back as epoch milliseconds');
});

test('tokens: only SHA-256 hex, unique; deleting a user removes tokens and sessions, keeps the trail', async () => {
  const u = await user('two@example.com', { verified: true });
  const h = hex64();
  await db.run("INSERT INTO email_verification_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, now() + interval '1 day')", [u.id, h]);
  await rejects(db.run("INSERT INTO email_verification_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, now())", [u.id, h]), 'email_verification_tokens_token_hash_key');
  await rejects(db.run("INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1, 'plain-token', now())", [u.id]), 'password_reset_tokens_token_hash_check');
  await db.run("INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, now())", [u.id, hex64()]);
  await db.run("INSERT INTO user_sessions (user_id, token_hash, expires_at) VALUES ($1, $2, now() + interval '1 day')", [u.id, hex64()]);
  await db.run("INSERT INTO login_activity (user_id, email, success) VALUES ($1, $2, true)", [u.id, u.email]);
  await rejects(db.run("INSERT INTO login_activity (user_id, email, success, failure_reason) VALUES ($1, $2, true, 'bad_credentials')", [u.id, u.email]), 'login_activity_reason');
  await db.run("INSERT INTO security_events (user_id, event_type, detail) VALUES ($1, 'signup', $2)", [u.id, JSON.stringify({ a: 1 })]);
  await db.run('DELETE FROM users WHERE id = $1', [u.id]);
  for (const t of ['email_verification_tokens', 'password_reset_tokens', 'user_sessions']) assert.equal((await db.one('SELECT COUNT(*)::int AS n FROM ' + t + ' WHERE user_id = $1', [u.id])).n, 0, t);
  const la = await db.one("SELECT * FROM login_activity WHERE email = 'two@example.com'"); assert.equal(la.user_id, null);
  const se = await db.one("SELECT * FROM security_events WHERE event_type = 'signup' AND detail->>'a' = '1'"); assert.equal(se.user_id, null);
});

test('db.tx commits together or not at all; queries inside it share one connection', async () => {
  await assert.rejects(db.tx(async () => {
    await user('tx1@example.com');
    await user('tx1@example.com');   /* duplicate: the whole transaction rolls back */
  }));
  assert.equal(await db.one("SELECT * FROM users WHERE email = 'tx1@example.com'"), null);
  const pids = await db.tx(async () => [await db.one('SELECT pg_backend_pid() AS p'), await db.one('SELECT pg_backend_pid() AS p')]);
  assert.equal(pids[0].p, pids[1].p);
  await db.tx(async () => { await user('tx2@example.com'); });
  assert.ok(await db.one("SELECT * FROM users WHERE email = 'tx2@example.com'"));
});

test('parameters are never SQL', async () => {
  const evil = "x@example.com'; DROP TABLE users; --";
  assert.equal(await db.one('SELECT * FROM users WHERE email = $1', [evil]), null);
  assert.ok(await db.one("SELECT to_regclass('users') AS t").then(r => r.t), 'users is still there');
});

test('accounts from the SQLite store come over once, with the same ids, and still sign in', async () => {
  const other = await H.freshDatabase(); const pg = PG.connect({ url: other.url, ssl: 'disable', max: 2 });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lww-legacy-'));
  const shop = DB.open(path.join(tmp, 'shop.sqlite'));
  try {
    await migrate(pg.pool);
    /* the old backend's scrypt format */
    const scrypt = pw => { const salt = crypto.randomBytes(16); return salt.toString('hex') + ':' + crypto.scryptSync(pw, salt, 64).toString('hex'); };
    const ins = shop.q('INSERT INTO users (id, email, name, role, pw_hash, created_at, last_login_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
    ins.run(3, 'old@example.com', 'Old Customer', 'teacher', scrypt('Oldpass123'), Date.now() - 86400e3, null);
    ins.run(41, 'Mixed@Example.com', 'Mixed', 'weird-role', scrypt('Another123'), Date.now() - 3600e3, Date.now() - 60e3);
    shop.q("INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES ('s1', 3, 1, 9999999999999)").run();

    assert.deepEqual(await importAccounts(pg, shop), [3, 41]);
    const a = await pg.one('SELECT * FROM users WHERE id = 3'), b = await pg.one('SELECT * FROM users WHERE id = 41');
    assert.equal(a.email, 'old@example.com'); assert.equal(a.role, 'teacher'); assert.equal(a.email_verified, true); assert.equal(a.account_status, 'active');
    assert.equal(b.email, 'mixed@example.com'); assert.equal(b.role, null); assert.ok(b.last_login_at);
    assert.ok(await passwords.verify(a.password_hash, 'Oldpass123'), 'the old password still works');
    assert.ok(!(await passwords.verify(a.password_hash, 'oldpass123')));
    assert.ok(passwords.needsRehash(a.password_hash), 're-hashed with Argon2id at the next sign-in');
    assert.equal(shop.q('SELECT pw_hash FROM users WHERE id = 3').get().pw_hash, '!postgresql', 'no password copy left in SQLite');
    assert.equal(shop.q('SELECT COUNT(*) AS n FROM sessions').get().n, 0);
    assert.deepEqual(await importAccounts(pg, shop), [], 'a second start imports nothing');
    const next = await pg.one("INSERT INTO users (name, email, password_hash) VALUES ('New', 'new@example.com', 'x') RETURNING id");
    assert.ok(next.id > 41, 'a new account never reuses an old customer id (got ' + next.id + ')');

    /* the same email under another id in PostgreSQL is refused loudly */
    shop.q('INSERT INTO users (id, email, name, role, pw_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(90, 'new@example.com', 'Clash', null, scrypt('Clash1234'), Date.now());
    await assert.rejects(importAccounts(pg, shop), /Account clash/);
  } finally { shop.close(); await pg.close(); await other.drop(); fs.rmSync(tmp, { recursive: true, force: true }); }
});
