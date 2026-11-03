import { supabase } from '../lib/supabase.js';

// Compatibility snapshots for the existing UI. Only the SDK persists/refreshes tokens.
let session = null;
let recovery = false;
const listeners = new Set();
export const snapshot = () => session ? {
  accessToken: session.access_token,
  refreshToken: session.refresh_token,
  expiresAt: session.expires_at * 1000,
  localExp: session.expires_at * 1000,
  userId: session.user.id,
} : null;
export const isRecovery = () => recovery;
supabase.auth.onAuthStateChange((event, next) => {
  session = next;
  if (event === 'PASSWORD_RECOVERY') recovery = true;
  if (event === 'SIGNED_OUT') recovery = false;
  // Never invoke SDK methods inside its synchronous auth callback (lock re-entry).
  setTimeout(() => listeners.forEach(fn => fn(snapshot())), 0);
});
export const authReady = supabase.auth.getSession().then(({ data, error }) => {
  if (!error) session = data.session;
});
export const subscribe = fn => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};
export function authError(error) {
  if (!error) return;
  const codes = { invalid_credentials: 'bad_credentials', email_not_confirmed: 'email_unverified' };
  throw Object.assign(new Error(error.message), {
    status: error.status || 400, code: codes[error.code] || error.code, body: {},
  });
}
export function userView(user) {
  const meta = user.user_metadata || {};
  return {
    id: user.id, email: user.email, name: meta.name || meta.full_name || '',
    // Customer preferences confer no administrative privileges.
    role: ['parent', 'teacher', 'tutor', 'school'].includes(meta.role) ? meta.role : null,
    timeZone: meta.timeZone || null,
  };
}
export async function currentUser() {
  const { data, error } = await supabase.auth.getUser();
  authError(error);
  return { user: userView(data.user), session: snapshot() };
}
export async function updateProfile(body) {
  const data = {};
  if ('role' in body) {
    if (!['parent', 'teacher', 'tutor', 'school'].includes(body.role)) {
      throw Object.assign(new Error('Choose a customer profile type.'), { status: 400, code: 'invalid_role' });
    }
    data.role = body.role;
  }
  if ('name' in body) data.name = String(body.name).trim().slice(0, 80);
  if ('timeZone' in body) data.timeZone = String(body.timeZone).slice(0, 100);
  // These are display preferences only. Never write app_metadata or staff roles.
  const { data: result, error } = await supabase.auth.updateUser({ data });
  authError(error);
  return { user: userView(result.user) };
}
export async function login({ email, password }) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  authError(error);
  session = data.session;
  return { user: userView(data.user), session: snapshot() };
}
/* Sign-up straight with Supabase Auth: the customer picks the password, so no email service is
   needed. With the project's "Confirm email" switch on, Supabase emails a 6-digit code and the
   account only opens once verifySignupCode accepts it; with it off the account is ready at once. */
export async function signUp({ name, email, password, timeZone }) {
  const { data, error } = await supabase.auth.signUp({
    email, password,
    options: { data: { name, ...(timeZone ? { timeZone } : {}) }, emailRedirectTo: new URL('/', window.location.origin).href },
  });
  if (error) {
    if (error.code === 'user_already_exists' || error.code === 'email_exists' || /already (been )?registered/i.test(error.message)) {
      throw Object.assign(new Error('That email already has an account.'), { status: 409, code: 'email_taken', body: {} });
    }
    if (error.code === 'weak_password') {
      throw Object.assign(new Error(error.message), { status: 400, code: 'weak_password', body: { errors: { password: error.message } } });
    }
    authError(error);
  }
  /* Supabase answers a sign-up for a taken address (while confirming emails) with an empty user */
  if (data.user && Array.isArray(data.user.identities) && !data.user.identities.length) {
    throw Object.assign(new Error('That email already has an account.'), { status: 409, code: 'email_taken', body: {} });
  }
  const ready = !!data.session;
  /* the real sign-in goes through our server next, which opens its own record of it */
  if (ready) await supabase.auth.signOut({ scope: 'local' }).catch(() => {});
  return { email: (data.user && data.user.email) || email, ready };
}
/* tokens from our server's sign-in become the Supabase client's session */
export async function adoptSession(s) {
  if (!s || !s.accessToken || !s.refreshToken) throw Object.assign(new Error('Sign-in is briefly unavailable. Please try again in a minute.'), { status: 503, code: 'auth_unavailable', body: {} });
  const { data, error } = await supabase.auth.setSession({ access_token: s.accessToken, refresh_token: s.refreshToken });
  authError(error);
  session = data.session;
  return snapshot();
}
/* this tab signed itself out (not another tab): the site says "Signed out", not "in another tab" */
let localSignOutAt = 0;
export const signedOutHere = () => Date.now() - localSignOutAt < 5000;
export async function logout() {
  localSignOutAt = Date.now();
  const { error } = await supabase.auth.signOut({ scope: 'local' });
  authError(error);
  session = null;
  return { ok: true };
}
export async function getHeaders() {
  const { data, error } = await supabase.auth.getSession();
  authError(error);
  return {
    apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
    ...(data.session ? { Authorization: 'Bearer ' + data.session.access_token } : {}),
  };
}
export async function forgotPassword({ email }) {
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: new URL('/', window.location.origin).href,
  });
  authError(error);
  return { message: 'If that email has an account, a reset link is on its way.' };
}
export async function resetPassword({ password }) {
  const { error } = await supabase.auth.updateUser({ password });
  authError(error);
  recovery = false;
  await logout();
  return { message: 'Password updated. Sign in with your new password.' };
}
/* The code from the sign-up email ({{ .Token }} in Supabase's "Confirm signup" template) confirms
   the address; only then is the account usable. The real sign-in goes through our server next. */
export async function verifySignupCode({ email, code }) {
  const token = String(code || '').replace(/\s+/g, '');
  if (!/^\d{6,10}$/.test(token)) {
    throw Object.assign(new Error('Enter the code from the email. It is 6 numbers.'), { status: 400, code: 'otp_format', body: {} });
  }
  const { data, error } = await supabase.auth.verifyOtp({ email, token, type: 'signup' });
  if (error) {
    if (error.code === 'otp_expired' || /expired|invalid/i.test(error.message)) {
      throw Object.assign(new Error('That code is wrong or too old. Check the newest email, or send a new code.'), { status: 400, code: 'otp_invalid', body: {} });
    }
    authError(error);
  }
  if (data && data.session) await supabase.auth.signOut({ scope: 'local' }).catch(() => {});
  return { ok: true };
}
export async function resendVerification({ email }) {
  const { error } = await supabase.auth.resend({ type: 'signup', email });
  authError(error);
  return { message: 'A new code is on its way to ' + email + '. Use the newest one.' };
}
