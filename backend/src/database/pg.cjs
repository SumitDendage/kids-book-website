/* Copyright (c) 2026 Learn With Why. All rights reserved. Proprietary — see LICENSE. This notice may not be removed. */
/* POSTGRESQL — the connection pool for the account tables.

   Every query is parameterised ($1, $2, …): values never become part of the SQL text,
   which is what keeps SQL injection out. Timestamps come back as epoch milliseconds
   (the shape the rest of the server and the front end already use), BIGINT ids and
   counts as plain numbers.

   db.tx(fn) runs fn inside one transaction: every db.one/many/run made while fn runs
   (found through AsyncLocalStorage) uses the transaction's connection. Nothing started
   inside fn may outlive it — await everything. */
const { Pool, types } = require('pg');
const { AsyncLocalStorage } = require('node:async_hooks');

const parseTimestamp = types.getTypeParser(1184);
const PARSERS = {
  20: v => Number(v),                                                            /* int8 */
  1184: v => { const d = parseTimestamp(v); return d instanceof Date ? d.getTime() : d; },  /* timestamptz */
};
const TYPES = { getTypeParser: (oid, format) => PARSERS[oid] || types.getTypeParser(oid, format) };

function sslOption(mode) {
  if (mode === 'require' || mode === 'verify-full') return { rejectUnauthorized: true };
  if (mode === 'no-verify') return { rejectUnauthorized: false };
  return false;
}

function connect(cfg) {
  if (!cfg.url) throw new Error('DATABASE_URL is not set — point it at your PostgreSQL database (put it in backend/.env — see backend/.env.example).');
  const pool = new Pool({ connectionString: cfg.url, ssl: sslOption(cfg.ssl), max: cfg.max, types: TYPES, statement_timeout: 15000, connectionTimeoutMillis: 10000, idleTimeoutMillis: 30000, application_name: 'learn-with-why' });
  pool.on('error', err => console.error('[pg] idle client error:', err.message));
  const als = new AsyncLocalStorage();
  const exec = (text, params) => (als.getStore() || pool).query(text, params);

  return {
    pool,
    async one(text, params) { return (await exec(text, params)).rows[0] || null; },
    async many(text, params) { return (await exec(text, params)).rows; },
    async run(text, params) { const r = await exec(text, params); return { count: r.rowCount, rows: r.rows }; },
    async tx(fn) {
      if (als.getStore()) return fn();   /* already inside one: join it */
      const client = await pool.connect();
      let broken;
      try {
        await client.query('BEGIN');
        const out = await als.run(client, fn);
        await client.query('COMMIT');
        return out;
      } catch (e) {
        await client.query('ROLLBACK').catch(err => { broken = err; });
        throw e;
      } finally { client.release(broken); }   /* a connection that could not roll back is closed, not reused */
    },
    close() { return pool.end(); },
  };
}

module.exports = { connect };
