import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const code = (await readFile(new URL('../src/services/api.js', import.meta.url), 'utf8'))
  .replace("import * as sdkAuth from './supabaseAuth.js';", `const sdkAuth = {
    snapshot: () => ({ accessToken: 'session-token' }),
    getHeaders: async () => ({ apikey: 'public-key', Authorization: 'Bearer session-token' }),
    adopted: [], loggedOut: 0,
    adoptSession: async s => { sdkAuth.adopted.push(s); },
    logout: async () => { sdkAuth.loggedOut++; },
    authReady: Promise.resolve()
  }; globalThis.__sdk = sdkAuth;`)
  .replace("import { BRAND, WEB3FORMS_KEY } from '../data/content.js';", "const BRAND = 'Test', WEB3FORMS_KEY = '';")
  .replaceAll('import.meta.env.VITE_SUPABASE_URL', "'https://liaqgyskuhnxmlvmrnrl.supabase.co'")
  .replaceAll('import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY', "'public-key'");
const api = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));

test('catalogue and account requests use the configured project and SDK bearer token', async t => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, options });
    return Response.json({ worksheets: [], orders: [] });
  });
  await api.catalogueApi.worksheets();
  await api.meApi.orders();
  assert.equal(calls[0].url, 'https://liaqgyskuhnxmlvmrnrl.supabase.co/functions/v1/api/worksheets');
  assert.equal(calls[1].url, 'https://liaqgyskuhnxmlvmrnrl.supabase.co/functions/v1/api/me/orders');
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
test('a GET is asked once more after a 503 or no answer; a POST never is', async t => {
  let n = 0;
  t.mock.method(globalThis, 'fetch', async () => (++n === 1 ? Response.json({ message: 'busy' }, { status: 503 }) : Response.json({ worksheets: [] })));
  assert.deepEqual((await api.catalogueApi.worksheets()).worksheets, []);
  assert.equal(n, 2);
  n = 0;
  t.mock.method(globalThis, 'fetch', async () => { if (++n === 1) throw new TypeError('Failed to fetch'); return Response.json({ country: 'IN' }); });
  assert.equal((await api.fetchGeo()).country, 'IN');
  assert.equal(n, 2);
  n = 0;
  t.mock.method(globalThis, 'fetch', async () => { n++; return Response.json({ message: 'busy' }, { status: 503 }); });
  await assert.rejects(api.catalogueApi.worksheets(), { status: 503 });
  assert.equal(n, 2, 'only one retry');
  n = 0;
  await assert.rejects(api.payApi.quote({ worksheet: 'az-C' }), { status: 503 });
  assert.equal(n, 1, 'a POST is sent once');
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

test('sign-in goes through the server, which opens its sign-in record, then the SDK keeps the tokens', async t => {
  const calls = [];
  const session = { accessToken: 'a.b.c', refreshToken: 'refresh-1', sessionExpiresAt: 1 };
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, options });
    return Response.json({ user: { id: 'u1', email: 'p@example.com' }, session, staff: null, security: null });
  });
  const r = await api.authApi.login({ email: 'p@example.com', password: 'pw', remember: true });
  assert.equal(calls[0].url, 'https://liaqgyskuhnxmlvmrnrl.supabase.co/functions/v1/api/auth/login');
  assert.equal(calls[0].options.method, 'POST');
  assert.deepEqual(JSON.parse(calls[0].options.body), { email: 'p@example.com', password: 'pw', remember: true });
  assert.deepEqual(globalThis.__sdk.adopted.at(-1), session);
  assert.equal(r.user.id, 'u1');
});
test('server sign-in errors (agreement, lock, unconfirmed) reach the form and adopt nothing', async t => {
  const before = globalThis.__sdk.adopted.length;
  t.mock.method(globalThis, 'fetch', async () => Response.json({ error: 'Please accept', code: 'agreement_required', agreement: { version: 'v2' } }, { status: 403 }));
  await assert.rejects(api.authApi.login({ email: 'p@example.com', password: 'pw' }), { status: 403, code: 'agreement_required' });
  assert.equal(globalThis.__sdk.adopted.length, before);
});
test('the account and role come from the server, and sign-out ends the server record then the SDK one', async t => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, method: options.method });
    return Response.json({ user: { id: 'u1', role: 'teacher' }, ok: true });
  });
  assert.equal((await api.authApi.me()).user.role, 'teacher');
  await api.authApi.updateMe({ role: 'teacher' });
  const out = globalThis.__sdk.loggedOut;
  await api.authApi.logout();
  assert.deepEqual(calls.map(c => [c.method || 'GET', c.url.split('/functions/v1')[1]]), [
    ['GET', '/api/auth/me'], ['PATCH', '/api/auth/me'], ['POST', '/api/auth/logout'],
  ]);
  assert.equal(globalThis.__sdk.loggedOut, out + 1);
});
test('sign-out still forgets this browser when the server cannot be reached', async t => {
  t.mock.method(globalThis, 'fetch', async () => { throw new TypeError('offline'); });
  const out = globalThis.__sdk.loggedOut;
  assert.deepEqual(await api.authApi.logout(), { ok: true });
  assert.equal(globalThis.__sdk.loggedOut, out + 1);
});
