/* Auth service — one async API, two backends.
   Online (Supabase Auth) when VITE_SUPABASE_* is set; otherwise the front-end
   demo store in this browser's localStorage. Every function throws an Error
   with a customer-facing message on failure. */
import { AUTH } from '../content';
import { online, supabase } from './supabase';
import { LS_USERS, LS_SESSION, read, write, remove } from './storage';

export { online };
const M = AUTH.messages;

export function isEmail(v) { return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(v || '').trim()); }

export function passwordStrength(v) {
  let s = 0;
  if (v.length >= 8) s++;
  if (/[A-Z]/.test(v)) s++;
  if (/[0-9]/.test(v)) s++;
  if (/[^A-Za-z0-9]/.test(v) || v.length >= 12) s++;
  return s;
}

const norm = e => String(e || '').trim().toLowerCase();
const session = (email, name) => ({ email, name: name || '', at: Date.now() });
const fail = msg => { throw new Error(msg); };

/* ---------- local demo store ---------- */
const users = () => read(LS_USERS, []);
const findUser = email => users().filter(u => u.email === norm(email))[0] || null;
function saveUser(user) {
  const list = users();
  const i = list.findIndex(x => x.email === user.email);
  if (i >= 0) list[i] = user; else list.push(user);
  write(LS_USERS, list);
}
/* Not cryptographic — demo only. Supabase hashes real passwords server-side. */
function hash(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return 'p' + h.toString(36);
}
const resetCodes = {};   /* email → six-digit code, demo only */

/* ---------- session ---------- */
export async function currentSession() {
  if (!online) return read(LS_SESSION, null);
  const { data } = await supabase.auth.getSession();
  const u = data.session && data.session.user;
  return u ? session(u.email, u.user_metadata && u.user_metadata.name) : null;
}

/* Fires when the session ends elsewhere (another tab, token expiry). */
export function onSignedOut(cb) {
  if (!online) return () => {};
  const { data } = supabase.auth.onAuthStateChange(event => { if (event === 'SIGNED_OUT') cb(); });
  return () => data.subscription.unsubscribe();
}

export async function signIn(email, password, remember) {
  if (!online) {
    const u = findUser(email);
    if (!u || u.pw !== hash(password)) fail(M.signinFail);
    const s = session(u.email, u.name);
    if (remember) write(LS_SESSION, s);
    return s;
  }
  const { data, error } = await supabase.auth.signInWithPassword({ email: norm(email), password });
  if (error) fail(M.signinFail);
  return session(data.user.email, data.user.user_metadata && data.user.user_metadata.name);
}

/* Supabase deliberately does not reveal whether an email exists; duplicates
   surface when the account is created. */
export async function emailTaken(email) { return !online && !!findUser(email); }

/* Returns { session } or { confirm: true } when the project requires the
   customer to confirm their email before the first sign in. */
export async function signUp({ name, kidAge, email, password }) {
  const e = norm(email);
  if (!online) {
    if (findUser(e)) fail(M.emailTaken);
    saveUser({ name, email: e, kidAge, pw: hash(password), created: Date.now() });
    const s = session(e, name);
    write(LS_SESSION, s);
    return { session: s };
  }
  const { data, error } = await supabase.auth.signUp({ email: e, password, options: { data: { name, kid_age: kidAge } } });
  if (error) fail(error.message);
  if (data.user && data.user.identities && data.user.identities.length === 0) fail(M.emailTaken);
  if (!data.session) return { confirm: true };
  return { session: session(e, name) };
}

export async function signOut() {
  if (online) await supabase.auth.signOut();
  else remove(LS_SESSION);
}

/* ---------- password reset: code → verify → new password ---------- */
export async function requestReset(email) {
  const e = norm(email);
  if (!online) {
    if (!findUser(e)) fail(M.noAccount);
    const code = String(Math.floor(100000 + Math.random() * 900000));
    resetCodes[e] = code;
    return { email: e, code };                 /* shown on screen in the demo */
  }
  const { error } = await supabase.auth.resetPasswordForEmail(e);
  if (error) fail(error.message);
  return { email: e, code: null };             /* the code arrives by email */
}

export async function verifyReset(email, code) {
  const c = String(code || '').trim();
  if (!online) return resetCodes[email] === c;
  const { error } = await supabase.auth.verifyOtp({ email, token: c, type: 'recovery' });
  return !error;
}

export async function completeReset(email, password) {
  if (!online) {
    const u = findUser(email);
    if (!u) fail(M.accountGone);
    u.pw = hash(password);
    saveUser(u);
    delete resetCodes[email];
    return;
  }
  const { error } = await supabase.auth.updateUser({ password });
  if (error) fail(error.message);
  await supabase.auth.signOut();               /* sign in again with the new password */
}
