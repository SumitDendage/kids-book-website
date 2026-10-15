import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const code = (await readFile(new URL('../src/services/api.js', import.meta.url), 'utf8'))
  .replace("import { validateStaffResponse } from './staffResponse.js';", "const validateStaffResponse = (path, data) => data;")
  .replace("import { fetchProducts } from './products.js';", "const fetchProducts = () => api('GET', '/api/worksheets');")
  .replace("import * as sdkAuth from './supabaseAuth.js';", `const sdkAuth = {
    snapshot: () => ({ accessToken: 'session-token' }),
    getHeaders: async () => ({ apikey: 'public-key', Authorization: 'Bearer session-token' })
  };`)
  .replace("import { BRAND, WEB3FORMS_KEY } from '../data/content.js';", "const BRAND = 'Test', WEB3FORMS_KEY = '';")
  .replaceAll('import.meta.env.VITE_SUPABASE_URL', "'https://wjqmrcglzqemrvafjeel.supabase.co'")
  .replaceAll('import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY', "'public-key'");
const api = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));

test('legacy API transport and account requests use the configured project and SDK bearer token', async t => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, options });
    return Response.json({ worksheets: [], orders: [] });
  });
  await api.catalogueApi.worksheets();
  await api.meApi.orders();
  assert.equal(calls[0].url, 'https://wjqmrcglzqemrvafjeel.supabase.co/functions/v1/api/worksheets');
  assert.equal(calls[1].url, 'https://wjqmrcglzqemrvafjeel.supabase.co/functions/v1/api/me/orders');
  assert.equal(calls[1].options.headers.Authorization, 'Bearer session-token');
  assert.equal(calls[0].options.headers.apikey, 'public-key');
});
test('invalid project key surfaces the actual error without reporting a user logout', async t => {
  let signedOut = false;
  api.setUnauthorizedHandler(() => { signedOut = true; });
  t.mock.method(globalThis, 'fetch', async () => Response.json({ message: 'Invalid API key' }, { status: 401 }));
  await assert.rejects(api.meApi.orders(), { message: 'Invalid API key', status: 401 });
  assert.equal(signedOut, false);
});
test('missing functions surface 404 rather than returning fake catalogue data', async t => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ message: 'Requested function was not found', code: 'NOT_FOUND' }, { status: 404 }));
  await assert.rejects(api.catalogueApi.worksheets(), { status: 404, code: 'NOT_FOUND' });
});
test('HTML fallback with HTTP 200 is rejected, not treated as a working API', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response('<html>Vite fallback</html>'));
  await assert.rejects(api.meApi.orders(), { status: 502, code: 'invalid_response' });
});
test('catalogue rejects a wrong envelope and nonnumeric prices', async t => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ products: [] }));
  await assert.rejects(api.catalogueApi.worksheets(), { code: 'invalid_response' });
  t.mock.method(globalThis, 'fetch', async () => Response.json({ worksheets: [{ id: 'one', price: '49' }] }));
  await assert.rejects(api.catalogueApi.worksheets(), { code: 'invalid_response' });
});
test('account lists distinguish empty data from missing response fields', async t => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({}));
  await assert.rejects(api.meApi.orders(), { code: 'invalid_response' });
  await assert.rejects(api.meApi.entitlements(), { code: 'invalid_response' });
  t.mock.method(globalThis, 'fetch', async () => Response.json({ orders: [], entitlements: [] }));
  assert.deepEqual((await api.meApi.orders()).orders, []);
  assert.deepEqual((await api.meApi.entitlements()).entitlements, []);
});
test('checkout verification forwards proof to the server and never grants a local purchase', async t => {
  const proof = { order_id: 'local-order', razorpay_order_id: 'provider-order', razorpay_payment_id: 'payment', razorpay_signature: 'invalid-signature' };
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.ok(url.endsWith('/api/pay/verify'));
    assert.deepEqual(JSON.parse(options.body), proof);
    return Response.json({ error: 'Invalid signature' }, { status: 400 });
  });
  await assert.rejects(api.payApi.verify(proof), { status: 400, message: 'Invalid signature' });
});
