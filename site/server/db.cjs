/* Copyright (c) 2026 Learn With Why. All rights reserved. Proprietary — see LICENSE. This notice may not be removed. */
/* DATABASE — SQLite through Node's built-in node:sqlite (no npm packages).
   One file, data/lww.sqlite, holds everything the business needs to remember:
   customers, sessions, the worksheet catalogue, orders, payments, entitlements
   (who may open what — once granted, for good), the access log and the notes sent
   through the contact form. Store settings that the
   admin can change (plans, coupons, rates, fees, access hours) live in the
   settings table as JSON values. */
const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { SEED_WORKSHEETS, REMOVED_IDS, SEED_V1, SEED_VERSION } = require('./seed.cjs');

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
  updated_at INTEGER NOT NULL,
  seed TEXT
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
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  body TEXT NOT NULL,
  user_id INTEGER,
  ip TEXT, ua TEXT,
  read_at INTEGER,
  replied_at INTEGER,
  mailed INTEGER NOT NULL DEFAULT 0,
  mail_error TEXT
);
CREATE INDEX IF NOT EXISTS messages_at ON messages(at);
`;

/* store settings the admin can change; base prices are in INR and are the source of truth */
const DEFAULT_SETTINGS = {
  plans: { m1: { label: '1 month', months: 1, price: 199 }, m3: { label: '3 months', months: 3, price: 499 }, m6: { label: '6 months', months: 6, price: 899 }, y1: { label: '12 months', months: 12, price: 1499 } },   /* India: m1, m3, m6; other countries also y1 (pricing.cjs) */
  classes: { kg: 'Kindergarten', c1: 'Class 1', c2: 'Class 2', c3: 'Class 3' },   /* Nursery was folded into Kindergarten (seed v2) */
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
  if (!hasCol('worksheets', 'seed')) db.exec('ALTER TABLE worksheets ADD COLUMN seed TEXT');   /* databases made before seed tracking */
  const st = {
    getSetting: db.prepare('SELECT value FROM settings WHERE key = ?'),
    setSetting: db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'),
  };
  const api = {
    raw: db,
    /* settings: JSON values keyed by name, defaults filled in */
    get(key) {
      const fallback = DEFAULT_SETTINGS[key] == null ? null : JSON.parse(JSON.stringify(DEFAULT_SETTINGS[key]));
      const r = st.getSetting.get(key); if (r) { try { const v = JSON.parse(r.value); return key === 'plans' ? Object.assign(fallback, v) : v; } catch (_) {} }   /* plans added later (6 months) show up in stores saved before them */
      return fallback;
    },
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
  api.tx(() => syncSeed(api));
  return api;
}

/* THE SEED, KEPT IN STEP WITHOUT TRAMPLING THE ADMIN.
   New sheets are inserted. For a sheet that is already there, each seed-owned field
   (title, class, subject, pages, price, thumb) is moved to the new seed value only
   while it still holds what the seed wrote last time — the `seed` column remembers
   that (rows from before it existed are compared with SEED_V1). A field the admin
   changed, such as a price, is left alone for good. Once per SEED_VERSION, sheets the
   shelf dropped are made inactive and the old Nursery class moves into Kindergarten. */
const SEED_FIELDS = ['title', 'cls', 'subject', 'pages', 'price', 'thumb'];
function syncSeed(api) {
  const now = Date.now(), q = sql => api.q(sql);
  const get = q('SELECT * FROM worksheets WHERE id = ?');
  const insert = q(`INSERT INTO worksheets (id, title, cls, subject, pages, price, file, thumb, active, created_at, updated_at, seed) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
    ON CONFLICT(id) DO NOTHING`);
  const update = q('UPDATE worksheets SET title = ?, cls = ?, subject = ?, pages = ?, price = ?, thumb = ?, seed = ?, updated_at = ? WHERE id = ?');
  let added = 0, updated = 0;
  for (const w of SEED_WORKSHEETS) {
    const want = { title: w.title, cls: w.cls, subject: w.subject, pages: w.pages || 1, price: w.price || 0, thumb: w.thumb || null }, mark = JSON.stringify(want);
    const row = get.get(w.id);
    if (!row) { insert.run(w.id, want.title, want.cls, want.subject, want.pages, want.price, w.file || null, want.thumb, now, now, mark); added++; continue; }
    if (row.seed === mark) continue;
    let prev = null; try { prev = row.seed ? JSON.parse(row.seed) : null; } catch (_) {}
    if (!prev) prev = SEED_V1[w.id] ? Object.assign({ thumb: null }, SEED_V1[w.id]) : {};
    const next = {}; let changed = false;
    SEED_FIELDS.forEach(f => { const untouched = prev[f] !== undefined && row[f] === prev[f]; next[f] = untouched ? want[f] : row[f]; if (next[f] !== row[f]) changed = true; });
    update.run(next.title, next.cls, next.subject, next.pages, next.price, next.thumb, mark, changed ? now : row.updated_at, w.id);
    if (changed) updated++;
  }
  const version = api.get('seed_version') || 1;
  if (version < SEED_VERSION) {
    const off = q('UPDATE worksheets SET active = 0, updated_at = ? WHERE id = ? AND active = 1');
    REMOVED_IDS.forEach(id => off.run(now, id));
    /* Nursery → Kindergarten: sheets the admin made in Nursery, and Nursery class plans (they now open Kindergarten) */
    q("UPDATE worksheets SET cls = 'kg', updated_at = ? WHERE cls = 'nursery'").run(now);
    q("UPDATE entitlements SET cls = 'kg' WHERE scope = 'class' AND cls = 'nursery'").run();
    const cls = api.get('classes'); if (cls && cls.nursery) { delete cls.nursery; api.set('classes', cls); }
    const disc = api.get('discounts'); if (disc && disc.nursery != null) { if (disc.kg == null) disc.kg = disc.nursery; delete disc.nursery; api.set('discounts', disc); }
    api.set('seed_version', SEED_VERSION);
  }
  return { added, updated };
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

module.exports = { open, attachFiles, syncSeed, DEFAULT_SETTINGS };
