#!/usr/bin/env node
// Copies the worksheet PDFs and page pictures from the old server's "protected" folder into the
// private Supabase Storage bucket "worksheets", keeping the same folder layout
// (a-to-z/A.pdf, vocab-colours/colours-1-1.jpg, …), which is what the products table expects.
//
// Usage (Node 18 or newer, no packages needed):
//   set SUPABASE_URL=https://liaqgyskuhnxmlvmrnrl.supabase.co
//   set SUPABASE_SECRET_KEY=sb_secret_...        (Dashboard → Project Settings → API Keys)
//   node supabase/scripts/upload-files.mjs ..\backend\protected
//   node supabase/scripts/upload-files.mjs ..\backend\protected --dry-run
//
// The secret key gives full access to the project: paste it only into your own terminal, never
// into the website or a chat, and close the terminal afterwards.
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative, sep, extname } from 'node:path';

const TYPES = { '.pdf': 'application/pdf', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };
const BUCKET = 'worksheets';
const MAX_BYTES = 50 * 1024 * 1024;

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const dir = args.find((a) => !a.startsWith('--'));
const url = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!dir) {
  console.error('Tell me where the files are, e.g.  node supabase/scripts/upload-files.mjs ..\\backend\\protected');
  process.exit(1);
}
if (!dryRun && (!/^(https:\/\/[a-z0-9]+\.supabase\.co|http:\/\/127\.0\.0\.1:\d+)$/.test(url) || !key)) {
  console.error('Set SUPABASE_URL (https://<ref>.supabase.co) and SUPABASE_SECRET_KEY first. See the comments at the top of this file.');
  process.exit(1);
}

async function* walk(root) {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const full = join(root, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.isFile()) yield full;
  }
}

const headers = { apikey: key, 'x-upsert': 'true', 'Cache-Control': 'no-store' };
if (/^eyJ/.test(key)) headers.Authorization = `Bearer ${key}`;

async function upload(path, file, type) {
  const body = await readFile(file);
  const encoded = path.split('/').map(encodeURIComponent).join('/');
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(`${url}/storage/v1/object/${BUCKET}/${encoded}`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': type },
        body,
      });
      if (res.ok) return;
      const text = (await res.text()).slice(0, 200);
      if (res.status < 500) throw new Error(`${res.status} ${text}`);
      if (attempt === 3) throw new Error(`${res.status} ${text}`);
    } catch (e) {
      if (attempt === 3 || /^4\d\d /.test(String(e.message))) throw e;
    }
    await new Promise((r) => setTimeout(r, attempt * 1500));
  }
}

const files = [];
for await (const file of walk(dir)) {
  const type = TYPES[extname(file).toLowerCase()];
  if (!type) continue;
  const size = (await stat(file)).size;
  const path = relative(dir, file).split(sep).join('/');
  if (path.includes('..') || !/^[A-Za-z0-9][A-Za-z0-9._\/-]*$/.test(path)) {
    console.warn(`skipped (unusual name): ${path}`);
    continue;
  }
  if (size > MAX_BYTES) {
    console.warn(`skipped (over 50 MB): ${path}`);
    continue;
  }
  files.push({ file, path, type, size });
}

const total = files.reduce((n, f) => n + f.size, 0);
console.log(`${files.length} files, ${(total / 1048576).toFixed(1)} MB → bucket "${BUCKET}"${dryRun ? ' (dry run, nothing sent)' : ''}`);
if (dryRun) {
  for (const f of files) console.log(`  ${f.path}`);
  process.exit(0);
}

let done = 0, failed = 0;
const queue = [...files];
async function worker() {
  for (;;) {
    const f = queue.shift();
    if (!f) return;
    try {
      await upload(f.path, f.file, f.type);
      done++;
      if (done % 10 === 0 || done === files.length) console.log(`  uploaded ${done}/${files.length}`);
    } catch (e) {
      failed++;
      console.error(`  FAILED ${f.path}: ${e.message}`);
    }
  }
}
await Promise.all([worker(), worker(), worker(), worker()]);
console.log(failed ? `Finished with ${failed} failures — run the same command again to retry.` : 'All files uploaded.');
process.exit(failed ? 1 : 0);
