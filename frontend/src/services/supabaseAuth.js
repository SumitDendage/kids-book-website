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
export async function logout() {
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
export async function resendVerification({ email }) {
  const { error } = await supabase.auth.resend({ type: 'signup', email });
  authError(error);
  return { message: 'A confirmation link is on its way. Your password has not changed. Use Forgot password if you need a new one.' };
}
