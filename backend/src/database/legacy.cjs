/* Copyright (c) 2026 Learn With Why. All rights reserved. Proprietary — see LICENSE. This notice may not be removed. */
/* ACCOUNTS FROM THE SQLITE STORE → POSTGRESQL, once, at start.

   Before PostgreSQL, customers lived in the SQLite users table, and their orders and
   entitlements still point at those ids. Each such account is copied into PostgreSQL
   WITH THE SAME ID, so nothing in the shop changes owner. Its scrypt password hash comes
   along (it is re-hashed with Argon2id at the next sign-in) and the account counts as
   confirmed — it existed before email confirmation did. The SQLite row then keeps only
   the customer's name and email for the shop (pw_hash = '!postgresql'), and the old
   SQLite sessions and reset codes are deleted: everyone signs in again once.

   Afterwards the PostgreSQL id sequence is moved past every id the SQLite store has
   used, so a new account can never receive the id of an old customer's orders. */
const { normEmail, cleanName } = require('./auth.cjs');
const ROLES = ['parent', 'teacher', 'tutor', 'school'];

async function importAccounts(pg, shop) {
  const rows = shop.q("SELECT id, email, name, role, pw_hash, created_at, last_login_at FROM users WHERE pw_hash NOT LIKE '!%' ORDER BY id").all();
  const imported = [];
  if (rows.length) {
    await pg.tx(async () => {
      for (const r of rows) {
        const id = Number(r.id), email = normEmail(r.email);
        const clash = await pg.one('SELECT id, email FROM users WHERE id = $1 OR email = $2', [id, email]);
        if (clash) {
          if (clash.id === id && clash.email === email) continue;   /* already carried over */
          throw new Error('Account clash between SQLite and PostgreSQL: SQLite user ' + id + ' <' + email + '> vs PostgreSQL user ' + clash.id + ' <' + clash.email + '>. Resolve it by hand before starting the server.');
        }
        await pg.run(`INSERT INTO users (id, name, email, password_hash, email_verified, email_verified_at, account_status, role, created_at, last_login_at)
          VALUES ($1, $2, $3, $4, true, to_timestamp($5::bigint / 1000.0), 'active', $6, to_timestamp($5::bigint / 1000.0),
                  CASE WHEN $7::bigint IS NULL THEN NULL ELSE to_timestamp($7::bigint / 1000.0) END)`,
        [id, cleanName(r.name).slice(0, 80) || 'Customer', email, String(r.pw_hash), Number(r.created_at) || Date.now(), ROLES.includes(r.role) ? r.role : null, r.last_login_at == null ? null : Number(r.last_login_at)]);
        await pg.run("INSERT INTO security_events (user_id, event_type, detail) VALUES ($1, 'account_imported', $2)", [id, JSON.stringify({ from: 'sqlite' })]);
        imported.push(id);
      }
    });
    if (imported.length) {
      const mark = shop.q("UPDATE users SET pw_hash = '!postgresql' WHERE id = ?");
      shop.tx(() => { imported.forEach(id => mark.run(id)); shop.q('DELETE FROM sessions').run(); shop.q('DELETE FROM password_resets').run(); });
    }
  }
  const top = Number(shop.q('SELECT COALESCE(MAX(id), 0) AS n FROM users').get().n);
  await pg.one(`SELECT setval(pg_get_serial_sequence('users', 'id'), GREATEST((SELECT COALESCE(MAX(id), 0) FROM users), $1::bigint, 1),
    GREATEST((SELECT COALESCE(MAX(id), 0) FROM users), $1::bigint) > 0)`, [top]);
  return imported;
}

module.exports = { importAccounts };
