/* Copyright (c) 2026 Learn With Why. All rights reserved. Proprietary — see LICENSE. This notice may not be removed. */
/* npm run migrate — bring the PostgreSQL schema up to date (database/postgresql/migrations) and
   carry over any customer accounts still only in the SQLite store. The server does both at every
   start too; run this on its own to prepare a database before the first deploy. */
const Paths = require('../src/config/paths.cjs');
Paths.needInstall();
Paths.loadEnv();
const Config = require('../src/config/config.cjs');
const PG = require('../src/database/pg.cjs');
const DB = require('../src/database/db.cjs');
const { migrate } = require('../src/database/migrate.cjs');
const { importAccounts } = require('../src/database/legacy.cjs');

(async () => {
  const cfg = Config.load();
  const shopFile = Paths.shopDb();   /* the same shop file the server uses — decided before anything is changed */
  Paths.notes.forEach(n => console.log('!! ' + n));
  const pg = PG.connect(cfg.db);
  try {
    const applied = await migrate(pg.pool);
    console.log(applied.length ? 'applied: ' + applied.join(', ') : 'schema already up to date');
    const shop = DB.open(shopFile);
    try { const n = await importAccounts(pg, shop); console.log(n.length ? 'carried over ' + n.length + ' account(s) from SQLite' : 'no SQLite accounts to carry over'); }
    finally { shop.close(); }
  } finally { await pg.close(); }
})().catch(e => { console.error('migrate failed: ' + e.message); process.exit(1); });
