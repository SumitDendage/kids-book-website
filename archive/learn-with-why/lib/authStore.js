/* Auth service — accounts and sessions in this browser's localStorage (demo store).
   Every function throws an Error with a customer-facing message on failure. */
import { AUTH } from './content';
import { LS_USERS, LS_SESSION, read, write, remove } from './storage';

export const online = false;   /* no hosted backend is connected to this build */
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
/* Not cryptographic — demo only. */
function hash(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return 'p' + h.toString(36);
}
const resetCodes = {};   /* email → six-digit code, demo only */

/* ---------- session ---------- */
export async function currentSession() { return read(LS_SESSION, null); }

/* Nothing ends a session from outside in the local store. */
export function onSignedOut() { return () => {}; }

export async function signIn(email, password, remember) {
  const u = findUser(email);
  if (!u || u.pw !== hash(password)) fail(M.signinFail);
  const s = session(u.email, u.name);
  if (remember) write(LS_SESSION, s);
  return s;
}

export async function emailTaken(email) { return !!findUser(email); }

export async function signUp({ name, kidAge, email, password }) {
  const e = norm(email);
  if (findUser(e)) fail(M.emailTaken);
  saveUser({ name, email: e, kidAge, pw: hash(password), created: Date.now() });
  const s = session(e, name);
  write(LS_SESSION, s);
  return { session: s };
}

export async function signOut() { remove(LS_SESSION); }

/* ---------- password reset: code → verify → new password ---------- */
export async function requestReset(email) {
  const e = norm(email);
  if (!findUser(e)) fail(M.noAccount);
  const code = String(Math.floor(100000 + Math.random() * 900000));
  resetCodes[e] = code;
  return { email: e, code };                 /* shown on screen in the demo */
}

export async function verifyReset(email, code) {
  return resetCodes[email] === String(code || '').trim();
}

export async function completeReset(email, password) {
  const u = findUser(email);
  if (!u) fail(M.accountGone);
  u.pw = hash(password);
  saveUser(u);
  delete resetCodes[email];
}
