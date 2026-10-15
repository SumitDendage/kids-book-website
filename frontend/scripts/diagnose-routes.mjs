import { loadEnv } from 'vite';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

const env = { ...loadEnv('production', process.cwd(), 'VITE_'), ...process.env };
const url = env.VITE_SUPABASE_URL;
const key = env.VITE_SUPABASE_PUBLISHABLE_KEY;
if (url !== 'https://wjqmrcglzqemrvafjeel.supabase.co') throw new Error('Unexpected project URL; inspect configuration before probing.');
if (!key?.startsWith('sb_publishable_')) throw new Error('A publishable key is required.');
const routes = [];
async function scan(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const file = join(dir, e.name);
    if (e.isDirectory()) await scan(file);
    else if (/\.(jsx?|tsx?)$/.test(e.name)) {
      const src = await readFile(file, 'utf8');
      for (const match of src.matchAll(/(['"`])(\/api\/[^'"`\s]*)\1/g)) {
        routes.push({ file: relative(process.cwd(), file).replaceAll('\\', '/'),
          line: src.slice(0, match.index).split('\n').length, pathOrPrefix: match[2] });
      }
    }
  }
}
await scan(join(process.cwd(), 'src'));
// GET only. No signup, login attempts, orders, emails or payments are created.
const probes = [
  ['auth', '/auth/v1/settings', true],
  ['data-api', '/rest/v1/', true],
  ...['health', 'worksheets', 'config', 'content', 'faq', 'me/orders', 'me/entitlements'].flatMap(p => [
    [p, '/functions/v1/api/' + p, true],
    [p + ' gateway diagnosis (no key)', '/functions/v1/api/' + p, false],
  ]),
];
const results = [];
for (const [name, path, withKey] of probes) {
  try {
    const response = await fetch(url + path, {
      headers: withKey ? { apikey: key } : {}, signal: AbortSignal.timeout(15000),
    });
    const body = await response.json().catch(() => null);
    // Only error codes and structural metadata are recorded, never private rows or tokens.
    const result = { name, url: url + path, status: response.status,
      code: body?.code || null, message: response.ok ? null : body?.message || body?.error || null,
      responseKeys: body && typeof body === 'object' ? Object.keys(body) : [],
      worksheetCount: Array.isArray(body?.worksheets) ? body.worksheets.length : null };
    results.push(result);
    console.log(`${name}: HTTP ${result.status} ${result.message || ''}`);
  } catch (error) { results.push({ name, url: url + path, error: error.message }); }
}
await writeFile('route-diagnostics.json', JSON.stringify({ checkedAt: new Date().toISOString(), routes, results }, null, 2) + '\n');
console.log(`Recorded ${routes.length} API path references. Dynamic paths are prefixes, not fully resolved requests.`);
if (results.some(r => !r.status || r.status >= 400)) process.exitCode = 1;
