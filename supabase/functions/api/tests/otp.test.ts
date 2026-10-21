const assert = {
  ok(v: unknown) { if (!v) throw new Error('Assertion failed'); },
  equal(a: unknown, b: unknown) { if (a !== b) throw new Error('Values differ'); },
  deepEqual(a: unknown, b: unknown) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error('Objects differ'); },
  throws(fn: () => unknown) { try { fn(); } catch { return; } throw new Error('Expected rejection'); }
};
import { Webhook } from 'npm:standardwebhooks@1.0.0';
import { verifyEmailHook } from '../routes/auth_email.ts';
import { requestEmailOtp, verifyEmailOtp } from '../lib/gotrue.ts';
import { setEnvForTests } from '../lib/env.ts';
import { brandedEmail } from '../services/otp_email.ts';

const secret = btoa('a-secret-long-enough-for-hook-tests');
const raw = JSON.stringify({ user: { email: 'parent@example.test' }, email_data: { token: '123456', email_action_type: 'magiclink' } });
function headers(at = new Date()) {
  return { 'webhook-id': 'test-message', 'webhook-timestamp': String(Math.floor(at.getTime()/1000)), 'webhook-signature': new Webhook(secret).sign('test-message', at, raw) };
}
Deno.test('email hook accepts valid signatures and rejects modified payloads', () => {
  assert.equal(verifyEmailHook(raw, headers(), 'v1,whsec_' + secret).email_data.token, '123456');
  assert.throws(() => verifyEmailHook(raw.replace('123456','654321'), headers(), secret));
  assert.throws(() => verifyEmailHook(raw, {}, secret));
});
Deno.test('email hook rejects old signatures', () => {
  assert.throws(() => verifyEmailHook(raw, headers(new Date(Date.now()-600000)), secret));
});
Deno.test('email template escapes customer input', () => {
  assert.ok(!brandedEmail('<script>', '<img src=x>').includes('<img'));
});
Deno.test('Supabase owns OTP generation and email verification', async () => {
  setEnvForTests({ SUPABASE_URL: 'https://auth.example.test', SUPABASE_SERVICE_ROLE_KEY: 'test-key' });
  const previous = globalThis.fetch;
  const calls: { url: string; body: any }[] = [];
  globalThis.fetch = async (input, init) => {
    calls.push({ url: String(input), body: JSON.parse(String(init?.body)) });
    return Response.json(calls.length === 1 ? {} : { access_token: 'token', refresh_token: 'refresh', user: { id: 'user', email_confirmed_at: '2026-01-01' } });
  };
  try {
    await requestEmailOtp('parent@example.test', false, {});
    const session = await verifyEmailOtp('parent@example.test', '123456');
    assert.equal(calls[0].body.create_user, false);
    assert.ok(calls[0].url.endsWith('/auth/v1/otp'));
    assert.deepEqual(calls[1].body, { email: 'parent@example.test', token: '123456', type: 'email' });
    assert.equal(session.emailConfirmed, true);
  } finally { globalThis.fetch = previous; setEnvForTests(null); }
});
