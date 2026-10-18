import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/services/supabaseAuth.js', import.meta.url), 'utf8');
let counter = 0;
async function fixture(overrides = {}) {
  let callback;
  const calls = [];
  const user = { id: 'customer-1', email: 'parent@example.test', user_metadata: { name: 'Parent', role: 'parent' } };
  const session = { user, access_token: 'access', refresh_token: 'refresh', expires_at: 2000000000 };
  const auth = {
    onAuthStateChange(fn) { callback = fn; },
    async getSession() { return { data: { session } }; },
    async getUser() { return { data: { user } }; },
    async signInWithPassword(body) { calls.push(['login', body]); return { data: { user, session } }; },
    async signOut(body) { calls.push(['logout', body]); callback('SIGNED_OUT', null); return {}; },
    async resetPasswordForEmail(...args) { calls.push(['forgot', ...args]); return {}; },
    async resend(body) { calls.push(['resend', body]); return {}; },
    async updateUser(body) { calls.push(['update', body]); return { data: { user } }; },
    ...overrides,
  };
  const id = '__authTest' + counter++;
  globalThis[id] = { auth };
  const code = source.replace("import { supabase } from '../lib/supabase.js';", `const supabase = globalThis.${id};`)
    .replaceAll('import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY', "'public-key'");
  const mod = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
  await mod.authReady;
  delete globalThis[id];
  return { mod, calls, emit: callback, session };
}

test('restores a persistent SDK session and sends its current bearer token', async () => {
  const { mod } = await fixture();
  assert.equal(mod.snapshot().userId, 'customer-1');
  assert.deepEqual(await mod.getHeaders(), { apikey: 'public-key', Authorization: 'Bearer access' });
});
test('login sends only email and password, never regenerating a password', async () => {
  const { mod, calls } = await fixture();
  await mod.login({ email: 'parent@example.test', password: 'input-password', role: 'admin' });
  assert.deepEqual(calls, [['login', { email: 'parent@example.test', password: 'input-password' }]]);
});
test('failed login preserves the server error', async () => {
  const { mod } = await fixture({ signInWithPassword: async () => ({ error: { message: 'Invalid credentials', status: 400, code: 'invalid_credentials' } }) });
  await assert.rejects(mod.login({}), { code: 'bad_credentials', status: 400 });
});
test('confirmation resend does not update any password', async () => {
  const { mod, calls } = await fixture();
  await mod.resendVerification({ email: 'parent@example.test' });
  assert.deepEqual(calls, [['resend', { type: 'signup', email: 'parent@example.test' }]]);
});
test('customer profile edits reject admin assignment and discard privileged fields', async () => {
  const { mod, calls } = await fixture();
  await assert.rejects(mod.updateProfile({ role: 'admin' }), { code: 'invalid_role' });
  await mod.updateProfile({ role: 'teacher', app_metadata: { role: 'admin' }, permissions: ['*'] });
  assert.deepEqual(calls, [['update', { data: { role: 'teacher' } }]]);
  assert.equal(mod.userView({ user_metadata: { role: 'admin' } }).role, null);
});
test('recovery event survives initialization and resets through the SDK', async () => {
  const { mod, emit, session, calls } = await fixture();
  emit('PASSWORD_RECOVERY', session);
  assert.equal(mod.isRecovery(), true);
  await mod.resetPassword({ password: 'New-password-123' });
  assert.deepEqual(calls, [['update', { password: 'New-password-123' }], ['logout', { scope: 'local' }]]);
  assert.equal(mod.isRecovery(), false);
  assert.equal(mod.snapshot(), null);
});
test('refresh notifications use the new SDK token', async () => {
  const { mod, emit, session } = await fixture();
  const event = new Promise(resolve => mod.subscribe(resolve));
  emit('TOKEN_REFRESHED', { ...session, access_token: 'renewed' });
  assert.equal((await event).accessToken, 'renewed');
});
test('failed logout reports failure rather than claiming success', async () => {
  const { mod } = await fixture({ signOut: async () => ({ error: { message: 'Offline', status: 503 } }) });
  await assert.rejects(mod.logout(), { message: 'Offline' });
  assert.ok(mod.snapshot());
});
test('sign up asks Supabase for a code that may make the account; sign in never makes one', async () => {
  const { mod, calls } = await fixture({ async signInWithOtp(body) { calls.push(['otp', body]); return { data: {} }; } });
  await mod.sendCode({ email: 'new@example.test', signup: true, name: 'Asha', timeZone: 'Asia/Kolkata' });
  await mod.sendCode({ email: 'old@example.test' });
  assert.deepEqual(calls, [
    ['otp', { email: 'new@example.test', options: { shouldCreateUser: true, data: { name: 'Asha', timeZone: 'Asia/Kolkata' } } }],
    ['otp', { email: 'old@example.test', options: { shouldCreateUser: false } }],
  ]);
});
test('sign in for an unknown email reads as no_account; a quick resend as otp_cooldown', async () => {
  let n = 0;
  const { mod } = await fixture({
    async signInWithOtp() {
      return n++ ? { error: { message: 'For security purposes, you can only request this after 42 seconds.', status: 429, code: 'over_email_send_rate_limit' } }
        : { error: { message: 'Signups not allowed for otp', status: 422, code: 'otp_disabled' } };
    },
  });
  await assert.rejects(mod.sendCode({ email: 'nobody@example.test' }), { code: 'no_account' });
  await assert.rejects(mod.sendCode({ email: 'nobody@example.test' }), { code: 'otp_cooldown' });
});
test('the code is checked by Supabase as type email and its session is kept for our server', async () => {
  const { mod, calls } = await fixture({
    async verifyOtp(body) { calls.push(['verify', body]); return { data: { session: { access_token: 'a', refresh_token: 'r', expires_at: 2000000000, user: { id: 'u' } } } }; },
  });
  assert.deepEqual(await mod.verifyCode({ email: 'parent@example.test', code: ' 123 456 ' }), { refreshToken: 'r' });
  assert.deepEqual(calls, [['verify', { email: 'parent@example.test', token: '123456', type: 'email' }]]);
});
test('a malformed code never reaches Supabase; a wrong or expired one reads as otp_invalid', async () => {
  const { mod, calls } = await fixture({ async verifyOtp() { calls.push(['verify']); return { data: {}, error: { message: 'Token has expired or is invalid', status: 403, code: 'otp_expired' } }; } });
  await assert.rejects(mod.verifyCode({ email: 'a@b.test', code: '12ab' }), { code: 'otp_format' });
  assert.equal(calls.length, 0);
  await assert.rejects(mod.verifyCode({ email: 'a@b.test', code: '123456' }), { code: 'otp_invalid' });
});
