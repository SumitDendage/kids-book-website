import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { applyServerCatalogue, sheetOf } from '../src/data/catalogue.js';

const source = (await readFile(new URL('../src/services/products.js', import.meta.url), 'utf8'))
  .replace("import { supabase } from '../lib/supabase.js';", 'const supabase = null;');
const { fetchProducts, productView, PRODUCT_COLUMNS } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
const row = i => ({ id: `product-${i}`, title: `Worksheet ${i}`, price_inr: 49, class_id: 'kg', description: 'Practice', status: 'active', pages: 1 });
test('maps INR prices without a 100x currency error and preserves the public product shape', () => {
  assert.deepEqual(productView(row(1)), { id: 'product-1', title: 'Worksheet 1', price: 49, cls: 'kg', blurb: 'Practice', pages: 1, available: true, onSale: true });
  assert.equal(productView({ ...row(1), price_inr: 0 }).price, 0);
  assert.throws(() => productView({ ...row(1), price_inr: -1 }));
  assert.throws(() => productView({ ...row(1), price_inr: '49' }));
});
test('loads all 105 products over multiple pages using only verified public columns', async () => {
  const rows = Array.from({ length: 105 }, (_, i) => row(i));
  const ranges = [];
  const query = {
    select(columns) { assert.equal(columns, PRODUCT_COLUMNS); assert.ok(!columns.includes('*')); return this; },
    eq(key, value) { assert.equal(key, 'status'); assert.equal(value, 'active'); return this; },
    order(key) { assert.equal(key, 'id'); return this; },
    async range(start, end) { ranges.push([start, end]); return { data: rows.slice(start, end + 1) }; },
  };
  const client = { from(table) { assert.equal(table, 'products'); return query; } };
  const out = await fetchProducts(client);
  assert.equal(out.worksheets.length, 105);
  assert.deepEqual(ranges, [[0, 99], [100, 199]]);
});
test('does not turn a database permission error into an empty catalogue', async () => {
  const q = { select() { return this; }, eq() { return this; }, order() { return this; },
    async range() { return { data: null, status: 401, error: { code: '42501', message: 'permission denied' } }; } };
  await assert.rejects(fetchProducts({ from: () => q }), { status: 401, code: '42501' });
});
test('generated alphabet cards receive database titles, prices and availability', () => {
  const original = sheetOf('az-A');
  applyServerCatalogue([{ id: 'az-A', title: 'Updated alphabet title', price: 75,
    cls: 'kg', blurb: 'Database description', pages: 2, available: true, onSale: true }]);
  const updated = sheetOf('az-A');
  assert.equal(updated.title, 'Updated alphabet title');
  assert.equal(updated.price, 75);
  assert.equal(updated.free, false);
  assert.equal(updated.pdf, original.pdf);
});
