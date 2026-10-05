/* Copyright (c) 2026 Learn With Why. All rights reserved. Proprietary — see LICENSE. This notice may not be removed. */
/* MIGRATIONS — the PostgreSQL schema is the numbered .sql files in site/db/migrations,
   applied in order, each in its own transaction, once. schema_migrations remembers
   what was applied and a checksum of it: a file that changed after it ran stops the
   server (write a new migration instead). An advisory lock keeps two servers that
   start together from applying the same file twice. Runs on every start, and with
   `npm run migrate`. */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const DIR = path.join(__dirname, '..', 'db', 'migrations');
const LOCK = 7310227;   /* any constant: the advisory lock this app takes while migrating */

const checksum = sql => crypto.createHash('sha256').update(sql.replace(/\r\n/g, '\n')).digest('hex');

async function migrate(pool, dir = DIR) {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK]);
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY, name TEXT NOT NULL, checksum TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
    const done = new Map((await client.query('SELECT version, checksum FROM schema_migrations')).rows.map(r => [r.version, r.checksum]));
    const files = fs.readdirSync(dir).filter(f => /^\d{3,}_[\w-]+\.sql$/.test(f)).sort();
    const applied = [];
    for (const file of files) {
      const version = file.split('_')[0], sql = fs.readFileSync(path.join(dir, file), 'utf8'), sum = checksum(sql);
      if (done.has(version)) {
        if (done.get(version) !== sum) throw new Error('Migration ' + file + ' was edited after it was applied. Put the change in a new migration file instead.');
        continue;
      }
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (version, name, checksum) VALUES ($1, $2, $3)', [version, file, sum]);
        await client.query('COMMIT');
        applied.push(file);
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        throw new Error('Migration ' + file + ' failed: ' + e.message);
      }
    }
    return applied;
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK]).catch(() => {});
    client.release();
  }
}

module.exports = { migrate, DIR };
