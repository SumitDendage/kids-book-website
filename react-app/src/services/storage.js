/* STORAGE — accounts, orders and entitlements live on the server (SQLite behind
   /api/*). The browser keeps only a copy of the signed-in customer for an instant
   first paint, plus the staff panels' local telemetry (lww_* keys). */
export const read = (k, f) => { try { const r = localStorage.getItem(k); return r ? JSON.parse(r) : f; } catch (_) { return f; } };
export const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} };
export const readSession = (k, f) => { try { const r = sessionStorage.getItem(k); return r ? JSON.parse(r) : f; } catch (_) { return f; } };

/* telemetry for the staff panels — all in this browser for the demo */
export function pushLog(key, entry, cap = 400) { const l = read(key, []); l.push(entry); if (l.length > cap) l.splice(0, l.length - cap); write(key, l); }

/* who is signed in, for the event log (set by the site store) */
let whoEmail = null;
export const setLogIdentity = email => { whoEmail = email || null; };
export function logEvent(type, data) { pushLog('lww_events', Object.assign({ type, at: Date.now(), who: whoEmail }, data || {})); }
export function audit(actor, action, detail) { pushLog('lww_audit', { at: Date.now(), actor, action, detail: detail || '' }); }

/* the signed-in customer: localStorage when "Keep me signed in", sessionStorage otherwise */
export function loadSession() { return read('lww_session', null) || readSession('lww_session', null); }
export function rememberSession(s) { try { if (!s) { localStorage.removeItem('lww_session'); sessionStorage.removeItem('lww_session'); return; } (localStorage.getItem('lww_session') || !sessionStorage.getItem('lww_session') ? localStorage : sessionStorage).setItem('lww_session', JSON.stringify(s)); } catch (_) {} }
export function storeSession(s, remember) { try { if (remember) { sessionStorage.removeItem('lww_session'); localStorage.setItem('lww_session', JSON.stringify(s)); } else { localStorage.removeItem('lww_session'); sessionStorage.setItem('lww_session', JSON.stringify(s)); } } catch (_) {} }

/* staff (admin / developer) demo accounts — still in this browser until staff accounts move to the database */
export const staffSession = () => readSession('lww_staff', null);
export const setStaffSession = s => { try { if (s) sessionStorage.setItem('lww_staff', JSON.stringify(s)); else sessionStorage.removeItem('lww_staff'); } catch (_) {} };
