import { loadEnv } from 'vite';

const env = { ...loadEnv('production', process.cwd(), 'VITE_'), ...process.env };
const url = env.VITE_SUPABASE_URL;
const key = env.VITE_SUPABASE_PUBLISHABLE_KEY;
if (!url || !key) throw new Error('Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY.');
if (!key.startsWith('sb_publishable_')) throw new Error('Use a publishable frontend key, never a secret key.');
let failed = false;
for (const [name, path] of [['Auth key validation', '/auth/v1/settings'], ['Existing API health', '/functions/v1/api/health']]) {
  try {
    const res = await fetch(url + path, { headers: { apikey: key }, signal: AbortSignal.timeout(15000) });
    console.log(`${name}: HTTP ${res.status}`);
    if (!res.ok) {
      failed = true;
      const body = await res.json().catch(() => ({}));
      console.log(body.message || body.error || 'Request rejected');
    }
  } catch (error) { failed = true; console.log(`${name}: ${error.message}`); }
}
process.exitCode = failed ? 1 : 0;
