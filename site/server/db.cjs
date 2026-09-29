/* Copyright (c) 2026 Learn With Why. All rights reserved. Proprietary — see LICENSE. This notice may not be removed. */
/* DATABASE — SQLite through Node's built-in node:sqlite (no npm packages).
   One file, data/lww.sqlite, holds everything the business needs to remember:
   customers, sessions, the worksheet catalogue, orders, payments, entitlements
   (who may open what — once granted, for good) and the access log. Store settings that the
   admin can change (plans, coupons, rates, fees, access hours) live in the
   settings table as JSON values. */
const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { SEED_WORKSHEETS } = require('./seed.cjs');

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  role TEXT,
  pw_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_login_at INTEGER
);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  ua TEXT, ip TEXT
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
CREATE TABLE IF NOT EXISTS password_resets (
  email TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS worksheets (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  cls TEXT NOT NULL,
  subject TEXT NOT NULL,
  pages INTEGER NOT NULL DEFAULT 1,
  price INTEGER NOT NULL DEFAULT 0,
  file TEXT,
  thumb TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL,
  cls TEXT, plan TEXT, worksheet_id TEXT,
  currency TEXT NOT NULL,
  total REAL NOT NULL,
  total_inr REAL NOT NULL,
  amount_minor INTEGER NOT NULL,
  lines TEXT NOT NULL,
  coupon TEXT,
  address TEXT,
  method TEXT NOT NULL,
  status TEXT NOT NULL,
  gateway_order_id TEXT,
  gateway_payment_id TEXT,
  created_at INTEGER NOT NULL,
  paid_at INTEGER
);
CREATE INDEX IF NOT EXISTS orders_user ON orders(user_id);
CREATE INDEX IF NOT EXISTS orders_gateway ON orders(gateway_order_id);
CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  order_id TEXT,
  gateway TEXT NOT NULL,
  event TEXT NOT NULL,
  ok INTEGER NOT NULL,
  detail TEXT
);
CREATE TABLE IF NOT EXISTS entitlements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  scope TEXT NOT NULL,
  worksheet_id TEXT,
  cls TEXT,
  plan TEXT,
  order_id TEXT,
  kind TEXT NOT NULL,
  starts_at INTEGER NOT NULL,
  revoked_at INTEGER
);
CREATE INDEX IF NOT EXISTS entitlements_user ON entitlements(user_id);
CREATE TABLE IF NOT EXISTS access_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  user_id INTEGER,
  worksheet_id TEXT,
  action TEXT NOT NULL,
  ok INTEGER NOT NULL,
  detail TEXT,
  ip TEXT
);
`;

/* store settings the admin can change; base prices are in INR and are the source of truth */
const DEFAULT_SETTINGS = {
  plans: { m1: { label: '1 month', months: 1, price: 199 }, m3: { label: '3 months', months: 3, price: 499 }, y1: { label: '1 year', months: 12, price: 1499 } },
  classes: { nursery: 'Nursery', kg: 'Kindergarten', c1: 'Class 1', c2: 'Class 2', c3: 'Class 3' },
  coupons: {},          /* CODE: { pct, max, uses, active } */
  discounts: {},        /* classId: pct */
  rates: { INR: 1, USD: 0.012, EUR: 0.011, GBP: 0.0094, AED: 0.044, AUD: 0.018, CAD: 0.016, SGD: 0.016, NZD: 0.02, JPY: 1.8 },
  fees: { IN: { pct: 2, fixed: 3 }, INTL: { pct: 3.9, fixed: 0.3 } },
};

function open(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  /* an earlier build gave entitlements an expiry; access is permanent now, so that column goes */
  const hasCol = (t, c) => { try { return db.prepare('PRAGMA table_info(' + t + ')').all().some(r => r.name === c); } catch (_) { return false; } };
  if (hasCol('entitlements', 'expires_at')) db.exec('DROP INDEX IF EXISTS entitlements_user; ALTER TABLE entitlements DROP COLUMN expires_at');
  if (hasCol('orders', 'access_until')) db.exec('ALTER TABLE orders DROP COLUMN access_until');
  db.exec(SCHEMA);
  const st = {
    getSetting: db.prepare('SELECT value FROM settings WHERE key = ?'),
    setSetting: db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'),
    upsertWorksheet: db.prepare(`INSERT INTO worksheets (id, title, cls, subject, pages, price, file, thumb, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
      ON CONFLICT(id) DO NOTHING`),
    setFile: db.prepare('UPDATE worksheets SET file = ?, pages = ?, updated_at = ? WHERE id = ?'),
  };
  const api = {
    raw: db,
    /* settings: JSON values keyed by name, defaults filled in */
    get(key) { const r = st.getSetting.get(key); if (r) { try { return JSON.parse(r.value); } catch (_) {} } return DEFAULT_SETTINGS[key] == null ? null : JSON.parse(JSON.stringify(DEFAULT_SETTINGS[key])); },
    set(key, value) { st.setSetting.run(key, JSON.stringify(value)); return value; },
    /* one signing secret for quotes and view tokens, made on first run */
    secret() { let s = api.get('secret'); if (!s) { s = crypto.randomBytes(32).toString('hex'); api.set('secret', s); } return s; },
    /* prepared statements the modules share */
    q(sql) { return db.prepare(sql); },
    tx(fn) { db.exec('BEGIN'); try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; } },
    close() { db.close(); },
  };
  /* first run: carry the settings over from the old JSON database, if there is one */
  const legacy = path.join(path.dirname(file), 'db.json');
  if (!st.getSetting.get('migrated') && fs.existsSync(legacy)) {
    try { const j = JSON.parse(fs.readFileSync(legacy, 'utf8')); ['secret', 'plans', 'coupons', 'discounts', 'rates', 'fees'].forEach(k => { if (j[k] != null && !st.getSetting.get(k)) st.setSetting.run(k, JSON.stringify(j[k])); }); } catch (_) {}
    st.setSetting.run('migrated', JSON.stringify({ from: 'db.json', at: Date.now() }));
  }
  /* seed the catalogue on first run and pick up any PDF that has appeared in protected/ */
  const now = Date.now();
  api.tx(() => { SEED_WORKSHEETS.forEach(w => st.upsertWorksheet.run(w.id, w.title, w.cls, w.subject, w.pages || 1, w.price || 0, w.file || null, w.thumb || null, now, now)); });
  return api;
}

/* Attach PDFs that exist on disk: a worksheet whose `file` is empty gets
   protected/<id>.pdf or its seed path if that file is present. The admin can also
   upload a PDF through the API, which sets `file` directly. */
function attachFiles(api, protectedDir) {
  const rows = api.q('SELECT id, file FROM worksheets').all();
  const set = api.q('UPDATE worksheets SET file = ?, updated_at = ? WHERE id = ?');
  let n = 0;
  for (const r of rows) {
    const seed = SEED_WORKSHEETS.find(w => w.id === r.id);
    const candidates = [r.file, seed && seed.file, r.id + '.pdf'].filter(Boolean);
    const found = candidates.find(f => { try { return fs.statSync(path.join(protectedDir, f)).isFile(); } catch (_) { return false; } });
    if (found && found !== r.file) { set.run(found, Date.now(), r.id); n++; }
    else if (!found && r.file) { set.run(null, Date.now(), r.id); n++; }
  }
  return n;
}

module.exports = { open, attachFiles, DEFAULT_SETTINGS };
