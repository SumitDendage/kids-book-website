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
/* While a checked code's session is being made a sign-in of this site, the rest of the page is not
   told about it yet (it would ask our server about a sign-in the server has not opened). */
let holdEvents = false;
export const holdAuthEvents = on => { holdEvents = !!on; };
supabase.auth.onAuthStateChange((event, next) => {
  session = next;
  if (holdEvents) return;
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
/* Staff sign-up (/admin and /developer) with a chosen password. Customers use sendCode below. */
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
/* Customers sign up and sign in with a 6-digit code that Supabase Auth emails (no links, no
   passwords). Supabase Auth makes, hashes, expires and rate-limits the code; this page never sees
   it until the customer types it. shouldCreateUser is only true on Sign up, so Sign in never makes
   an account. The record Supabase Auth makes before the code is checked opens nothing on this site. */
const fail = (message, status, code) => Object.assign(new Error(message), { status, code, body: {} });
export async function sendCode({ email, signup = false, name, timeZone }) {
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: !!signup, ...(signup ? { data: { name, ...(timeZone ? { timeZone } : {}) } } : {}) },
  });
  if (error) {
    if (error.code === 'otp_disabled' || error.code === 'signup_disabled' || /signups not allowed/i.test(error.message)) {
      throw fail('There is no account with this email yet. Sign up first.', 404, 'no_account');
    }
    if (error.status === 429 || error.code === 'over_email_send_rate_limit' || /after \d+ seconds|rate limit/i.test(error.message)) {
      throw fail('Please wait a minute before asking for a new code.', 429, 'otp_cooldown');
    }
    authError(error);
  }
  return { email };
}
/* The right code opens a Supabase Auth session here; our server then makes it a sign-in of this
   site (POST /api/auth/otp/session). A wrong or old code opens nothing. */
export async function verifyCode({ email, code }) {
  const token = String(code || '').replace(/\s+/g, '');
  if (!/^\d{6,10}$/.test(token)) throw fail('Type the 6 numbers from the email.', 400, 'otp_format');
  holdEvents = true;
  const { data, error } = await supabase.auth.verifyOtp({ email, token, type: 'email' });
  if (error || !data || !data.session) holdEvents = false;
  if (error) {
    if (error.status === 429) throw fail('Too many tries. Please wait a few minutes, then send a new code.', 429, 'otp_attempts');
    if (error.code === 'user_banned') throw fail('This account is suspended. If you think this is a mistake, please write to us.', 403, 'account_suspended');
    if (error.code === 'otp_expired' || /expired|invalid/i.test(error.message)) {
      throw fail('That code is wrong or has expired. Check the newest email, or send a new code.', 400, 'otp_invalid');
    }
    authError(error);
  }
  if (!data || !data.session) throw fail('Sign-in is briefly unavailable. Please try again in a minute.', 503, 'auth_unavailable');
  session = data.session;
  return { refreshToken: data.session.refresh_token };
}
export async function resendVerification({ email }) {
  const { error } = await supabase.auth.resend({ type: 'signup', email });
  authError(error);
  return { message: 'A confirmation email is on its way to ' + email + '.' };
}
