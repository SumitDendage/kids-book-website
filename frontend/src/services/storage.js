/* STORAGE: accounts, orders and access live on the server (the Supabase database behind
   /api/*). The browser keeps only a copy of the signed-in customer for an instant first
   paint, a little telemetry of its own, and the staff panel's look (lww_dash_theme,
   lww_dash_sb). Staff sign in with their own accounts (services/api.js, staffAuth). */
export const read = (k, f) => { try { const r = localStorage.getItem(k); return r ? JSON.parse(r) : f; } catch (_) { return f; } };
export const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} };
export const readSession = (k, f) => { try { const r = sessionStorage.getItem(k); return r ? JSON.parse(r) : f; } catch (_) { return f; } };

/* a short log kept in this browser only (capped); the staff panels never show it as store data */
export function pushLog(key, entry, cap = 400) { const l = read(key, []); l.push(entry); if (l.length > cap) l.splice(0, l.length - cap); write(key, l); }

/* kept so older imports still work: site events are now recorded by the server
   (POST /api/events), never in this browser */
export const setLogIdentity = () => {};
export const logEvent = () => {};

/* the signed-in customer: localStorage when "Keep me signed in", sessionStorage otherwise */
export function loadSession() { return read('lww_session', null) || readSession('lww_session', null); }
export function rememberSession(s) { try { if (!s) { localStorage.removeItem('lww_session'); sessionStorage.removeItem('lww_session'); return; } (localStorage.getItem('lww_session') || !sessionStorage.getItem('lww_session') ? localStorage : sessionStorage).setItem('lww_session', JSON.stringify(s)); } catch (_) {} }
export function storeSession(s, remember) { try { if (remember) { sessionStorage.removeItem('lww_session'); localStorage.setItem('lww_session', JSON.stringify(s)); } else { localStorage.removeItem('lww_session'); sessionStorage.setItem('lww_session', JSON.stringify(s)); } } catch (_) {} }
