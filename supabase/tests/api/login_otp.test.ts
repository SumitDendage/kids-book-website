// Email-code sign-in (routes/auth.ts login + verify-login-otp, lib/loginOtp.ts): the password
// alone opens nothing; the 6-digit code emailed after it opens the session, once.
import { assert, assertEquals, assertStatus, startHarness, test, type Harness } from './harness.ts';

const h: Harness = await startHarness();

const codeIn = (text: string | undefined) => text?.match(/code is: (\d{6})/)?.[1] ?? null;

test('the password alone sends a code and opens no session; the code opens it once', async () => {
  const c = await h.customer();
  const first = await h.login(c.email, c.password, { otp: false });
  assertStatus(first, 200);
  assertEquals(first.body.otpRequired, true);
  assertEquals(first.token, undefined);
  assert(!JSON.stringify(first.body).includes('accessToken'), 'no tokens before the code');
  const code = codeIn(h.mail.last(c.email)?.text);
  assert(code, 'the email holds a 6-digit code');
  const [row] = await h.sql`select otp_hash, encrypted_session from login_otp_challenges where id = ${first.body.challengeId}`;
  assert(row.otp_hash.length === 64 && row.otp_hash !== code, 'the code is stored only as a hash');

  const ok = await h.call('POST', '/api/auth/verify-login-otp', { body: { challengeId: first.body.challengeId, code } });
  assertStatus(ok, 200);
  assert(ok.body.session?.accessToken, 'session handed over');
  assert(!row.encrypted_session.includes(ok.body.session.accessToken), 'the session waited encrypted');
  const me = await h.call('GET', '/api/auth/me', { token: ok.body.session.accessToken });
  assertStatus(me, 200);

  const again = await h.call('POST', '/api/auth/verify-login-otp', { body: { challengeId: first.body.challengeId, code } });
  assertStatus(again, 400);
  assertEquals(again.body.code, 'otp_expired');
});

test('wrong codes count; the fifth locks the code', async () => {
  const c = await h.customer();
  const first = await h.login(c.email, c.password, { otp: false });
  const code = codeIn(h.mail.last(c.email)?.text)!;
  const wrong = code === '000000' ? '111111' : '000000';
  for (let i = 0; i < 5; i++) {
    const r = await h.call('POST', '/api/auth/verify-login-otp', { body: { challengeId: first.body.challengeId, code: wrong } });
    assertStatus(r, 400);
    assertEquals(r.body.code, 'invalid_otp');
  }
  const locked = await h.call('POST', '/api/auth/verify-login-otp', { body: { challengeId: first.body.challengeId, code } });
  assertStatus(locked, 429);
  assertEquals(locked.body.code, 'otp_attempts_exceeded');
});

test('an expired code is refused, and bad input is a 400', async () => {
  const c = await h.customer();
  const first = await h.login(c.email, c.password, { otp: false });
  const code = codeIn(h.mail.last(c.email)?.text)!;
  await h.sql`update login_otp_challenges set expires_at = now() - interval '1 second' where id = ${first.body.challengeId}`;
  const r = await h.call('POST', '/api/auth/verify-login-otp', { body: { challengeId: first.body.challengeId, code } });
  assertStatus(r, 400);
  assertEquals(r.body.code, 'otp_expired');
  const bad = await h.call('POST', '/api/auth/verify-login-otp', { body: { challengeId: 'nope', code: '12' } });
  assertStatus(bad, 400);
  assertEquals(bad.body.code, 'invalid_otp');
});

test('a code from one account cannot open another challenge', async () => {
  const a = await h.customer(), b = await h.customer();
  const fa = await h.login(a.email, a.password, { otp: false });
  const fb = await h.login(b.email, b.password, { otp: false });
  const codeA = codeIn(h.mail.last(a.email)?.text)!;
  const codeB = codeIn(h.mail.last(b.email)?.text)!;
  if (codeA !== codeB) {
    const r = await h.call('POST', '/api/auth/verify-login-otp', { body: { challengeId: fb.body.challengeId, code: codeA } });
    assertStatus(r, 400);
  }
  const ok = await h.call('POST', '/api/auth/verify-login-otp', { body: { challengeId: fa.body.challengeId, code: codeA } });
  assertStatus(ok, 200);
  assertEquals(ok.body.user.email, a.email);
});

test('staff sign in with the code too, and get a staff session', async () => {
  const s = await h.staff('admin');
  const r = await h.login(s.email, s.password, { staff: true });
  assertStatus(r, 200);
  assert(r.challenge?.code, 'a code was emailed');
  const me = await h.call('GET', '/api/admin/me', { token: r.token });
  assertStatus(me, 200);
});

test('a sign-in from a new IP address emails the security alert', async () => {
  const c = await h.customer();
  h.setEnv({ ADMIN_SECURITY_EMAIL: 'owner@test.local' });
  try {
    const r = await h.login(c.email, c.password, { ip: '10.9.9.9' });
    assertStatus(r, 200);
    const alert = h.mail.last('owner@test.local');
    assert(alert && alert.text.includes(c.email) && alert.text.includes('10.9.9.9'), 'alert names the account and the new address');
  } finally {
    h.resetEnv();
  }
});

test('mail off: the password step answers 503 and leaves no code behind', async () => {
  const c = await h.customer();
  h.setEnv({ BREVO_API_KEY: undefined, MAIL_PROVIDER: undefined, MAIL_FROM: undefined });
  try {
    const r = await h.login(c.email, c.password, { otp: false });
    assertStatus(r, 503);
    assertEquals(r.body.code, 'mail_unavailable');
  } finally {
    h.resetEnv();
  }
  const [{ n }] = await h.sql`select count(*)::int n from login_otp_challenges where user_id = ${c.id}`;
  assertEquals(n, 0);
});
