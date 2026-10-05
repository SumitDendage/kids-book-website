/* Copyright (c) 2026 Learn With Why. All rights reserved. Proprietary — see LICENSE. This notice may not be removed. */
/* PATHS — every folder the backend uses, in one place.

     kids-book-website/
       frontend/dist                    the built website (npm run build in frontend/), served as the site
       backend/                         this server: server.cjs, src/, scripts/, test/, .env (your settings)
       backend/protected/               the private PDFs, only ever streamed through /api/view/*
       database/postgresql/migrations   the PostgreSQL schema (customer accounts), applied at every start
       database/data/lww.sqlite         the shop database (orders, purchases), made on the first start

   Until October 2026 the backend lived in site/ and the website in react-app/. A checkout updated
   from that layout keeps the files git never tracked where they were: the settings in site/.env,
   the shop database in site/data and admin uploads in site/protected/uploads. The functions below
   find them there and keep using them (or stop before anything is changed), and say exactly how to
   move them. The server itself never moves, copies or deletes any of them. */
const fs = require('node:fs');
const path = require('node:path');

const BACKEND = path.resolve(__dirname, '..', '..');
const ROOT = path.dirname(BACKEND);
const OLD = path.join(ROOT, 'site');
const FRONTEND_BUILD = path.join(ROOT, 'frontend', 'dist');
const MIGRATIONS = path.join(ROOT, 'database', 'postgresql', 'migrations');
const DATA = path.join(ROOT, 'database', 'data');
const PROTECTED = path.join(BACKEND, 'protected');

const WIN = process.platform === 'win32';
const notes = [];   /* things to tell the person starting the server, printed as "!! …" lines */
const rel = p => path.relative(ROOT, p) || '.';
const exists = p => { try { fs.accessSync(p); return true; } catch (_) { return false; } };
const files = d => { try { return fs.readdirSync(d, { withFileTypes: true }).filter(e => e.isFile()).map(e => e.name); } catch (_) { return []; } };
/* the command that moves a folder (or, when the target already exists, the files in it), typed in the kids-book-website folder */
const moveCmd = (from, to) => exists(to)
  ? (WIN ? 'move ' + rel(from) + '\\* ' + rel(to) : 'mv ' + rel(from) + '/* ' + rel(to) + '/')
  : (WIN ? 'move ' : 'mv ') + rel(from) + ' ' + rel(to);

/* a plain sentence instead of "Cannot find module 'pg'" when npm install has not been run in backend/ yet */
function needInstall() {
  const missing = ['pg', 'argon2', 'nodemailer'].filter(m => { try { require.resolve(m); return false; } catch (_) { return true; } });
  if (!missing.length) return;
  console.error('The backend packages are not installed yet (' + missing.join(', ') + ').\nIn the ' + rel(BACKEND) + ' folder run:  npm install   and then  npm start');
  process.exit(1);
}

/* the settings: backend/.env, or the old site/.env while backend/.env does not exist yet.
   The tests set LWW_NO_DOTENV so a developer's settings never leak into them. */
function loadEnv() {
  if (process.env.LWW_NO_DOTENV) return null;
  const now = path.join(BACKEND, '.env'), old = path.join(OLD, '.env');
  const file = exists(now) ? now : exists(old) ? old : null;
  if (!file) return null;   /* no .env: defaults, and DATABASE_URL must come from the environment */
  if (file === old) notes.push('your settings were read from the OLD file ' + rel(old) + '. Copy them once (in the kids-book-website folder): ' + (WIN ? 'copy ' : 'cp ') + rel(old) + ' ' + rel(now));
  try { process.loadEnvFile(file); } catch (_) { /* unreadable: same as no .env */ }
  return file;
}

/* the built website: STATIC_DIR (a relative path is read from backend/), else frontend/dist */
const staticRoot = () => path.resolve(BACKEND, process.env.STATIC_DIR || FRONTEND_BUILD);

/* The private PDFs. Stops (nothing changed) when the folder is missing or empty — a half-finished
   update would otherwise unlink every sheet from its PDF on start — and when PDFs uploaded in the
   admin panel are still only in the old site/protected/uploads. */
function protectedDir() {
  const dir = process.env.PROTECTED_DIR ? path.resolve(process.env.PROTECTED_DIR) : PROTECTED;
  const pdfs = d => files(d).some(f => /\.pdf$/i.test(f)) || (() => { try { return fs.readdirSync(d, { withFileTypes: true }).some(e => e.isDirectory() && files(path.join(d, e.name)).some(f => /\.pdf$/i.test(f))); } catch (_) { return false; } })();
  if (!pdfs(dir)) throw new Error('the private PDF folder ' + dir + ' is missing or has no PDFs, so nothing was started or changed. ' + (process.env.PROTECTED_DIR ? 'Check PROTECTED_DIR in backend/.env.' : 'Run git status and git pull in the kids-book-website folder, then npm start again.'));
  if (process.env.PROTECTED_DIR) return dir;
  const oldUp = path.join(OLD, 'protected', 'uploads'), newUp = path.join(dir, 'uploads');
  const stranded = files(oldUp).filter(f => !exists(path.join(newUp, f)));
  if (stranded.length) throw new Error(stranded.length + ' PDF' + (stranded.length === 1 ? '' : 's') + ' uploaded in the admin panel ' + (stranded.length === 1 ? 'is' : 'are') + ' still only in the OLD folder ' + rel(oldUp) + ', so nothing was started or changed. Move ' + (stranded.length === 1 ? 'it' : 'them') + ' (in the kids-book-website folder): ' + moveCmd(oldUp, newUp) + '   and then npm start again.');
  return dir;
}

/* The shop database file: DB_PATH, else database/data/lww.sqlite — or, while the shop of an older
   checkout is still in site/data, that one, used where it is so no order is ever lost. */
function shopDb() {
  if (process.env.DB_PATH) return process.env.DB_PATH;
  const has = d => exists(path.join(d, 'lww.sqlite')) || exists(path.join(d, 'db.json'));
  const oldData = path.join(OLD, 'data');
  if (has(oldData) && !has(DATA)) {
    notes.push('the shop database (orders, purchases) is still in the OLD folder ' + rel(oldData) + ' and is used there, so nothing is lost. To move it: stop the server (Ctrl+C), then in the kids-book-website folder run: ' + moveCmd(oldData, DATA));
    return path.join(oldData, 'lww.sqlite');
  }
  if (has(oldData)) notes.push('an older shop database is still in ' + rel(oldData) + ' and is NOT used (the one in ' + rel(DATA) + ' is).');
  return path.join(DATA, 'lww.sqlite');
}

module.exports = { ROOT, BACKEND, OLD, FRONTEND_BUILD, MIGRATIONS, DATA, PROTECTED, notes, needInstall, loadEnv, staticRoot, protectedDir, shopDb };
