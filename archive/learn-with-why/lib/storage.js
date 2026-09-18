/* Tiny localStorage wrapper; every read/write is guarded so blocked
   storage (private windows, cleared site data) never breaks the page. */
export const LS_USERS = 'lww_users';
export const LS_SESSION = 'lww_session';
export const LS_CART = 'lww_cart';
export const LS_LIBRARY = 'lww_library';

export function read(key, fallback) {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; } catch (_) { return fallback; }
}

export function write(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) {}
}

export function remove(key) {
  try { localStorage.removeItem(key); } catch (_) {}
}
