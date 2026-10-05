/* Copyright (c) 2026 Learn With Why. All rights reserved. Proprietary — see LICENSE. This notice may not be removed. */
/* npm run migrate — bring the PostgreSQL schema up to date (site/db/migrations) and carry
   over any customer accounts still only in the SQLite store. The server does both at every
   start too; run this on its own to prepare a database before the first deploy. */
const path = require('node:path');
try { process.loadEnvFile(path.join(__dirname, '..', '.env')); } catch (_) { /* no .env: use the environment */ }
const Config = require('../server/config.cjs');
const PG = require('../server/pg.cjs');
const DB = require('../server/db.cjs');
const { migrate } = require('../server/migrate.cjs');
const { importAccounts } = require('../server/legacy.cjs');

(async () => {
  const cfg = Config.load();
  const pg = PG.connect(cfg.db);
  try {
    const applied = await migrate(pg.pool);
    console.log(applied.length ? 'applied: ' + applied.join(', ') : 'schema already up to date');
    const shop = DB.open(process.env.DB_PATH || path.join(__dirname, '..', 'data', 'lww.sqlite'));
    try { const n = await importAccounts(pg, shop); console.log(n.length ? 'carried over ' + n.length + ' account(s) from SQLite' : 'no SQLite accounts to carry over'); }
    finally { shop.close(); }
  } finally { await pg.close(); }
})().catch(e => { console.error('migrate failed: ' + e.message); process.exit(1); });
