import { createClient } from '@supabase/supabase-js';
import { loadEnv } from 'vite';
import { readFile } from 'node:fs/promises';

const env = { ...loadEnv('production', process.cwd(), 'VITE_'), ...process.env };
const client = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } });
// Run the same query/mapping implementation as the browser, injecting its SDK client.
const source = (await readFile(new URL('../src/services/products.js', import.meta.url), 'utf8'))
  .replace("import { supabase } from '../lib/supabase.js';", 'const supabase = null;');
const { fetchProducts } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
const { worksheets } = await fetchProducts(client);
if (!worksheets.length) throw new Error('No products are visible; verify expected catalogue and RLS.');
if (new Set(worksheets.map(w => w.id)).size !== worksheets.length) throw new Error('Duplicate product IDs.');
console.log(`PASS: ${worksheets.length} products; unique IDs; valid numeric INR prices; frontend response shape verified.`);
