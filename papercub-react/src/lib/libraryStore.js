/* Licence service — one async API, two backends (see authStore.js).
   Online: entitlements live in Supabase; `checkout` and `consume_print` are
   database functions that run with the customer's identity, so a locked title
   is rejected server-side however the request is made (brief §9). After a
   checkout the `drm-protect` edge function asks VeryPDF DRM Protector for a
   protected copy whose print count is enforced by their secure reader (§10).
   Offline: the same rules in this browser's localStorage. */
import { BRAND, LICENCES } from '../content';
import { online, supabase } from './supabase';
import { LS_LIBRARY, read, write } from './storage';

export { online };
export function licence(id) { return LICENCES.find(l => l.id === id) || LICENCES[0]; }
export const isLocked = e => e.remaining <= 0;
/* A protected copy exists and the secure reader governs it */
export const isDrm = e => e.drmStatus === 'ready' && !!e.drmUrl;

/* ---------- local demo store ---------- */
const all = () => read(LS_LIBRARY, {});
const save = (email, items) => { const a = all(); a[email] = items; write(LS_LIBRARY, a); };
const localItems = email => (email ? all()[email] || [] : []);

function newId(existing) {   /* LW-105842 style, unique per purchase (brief §6) */
  let id;
  do id = BRAND.licencePrefix + '-' + Math.floor(100000 + Math.random() * 900000);
  while (existing.some(e => e.id === id));
  return id;
}

function localGrant(email, productId, licenceId) {
  const items = localItems(email);
  const lic = licence(licenceId);
  const e = { id: newId(items), productId, licence: lic.id, copies: lic.copies, remaining: lic.copies, purchasedAt: Date.now(), drmStatus: 'none', drmUrl: null };
  save(email, [e, ...items]);
  return e;
}

/* ---------- online rows → the shape the UI uses ---------- */
const fromRow = r => ({
  id: r.id, productId: r.product_id, licence: r.licence, copies: r.copies, remaining: r.remaining,
  purchasedAt: new Date(r.purchased_at).getTime(), drmStatus: r.drm_status, drmUrl: r.drm_url,
});

/* Newest first. */
export async function library(email) {
  if (!online) return localItems(email);
  const { data, error } = await supabase.from('entitlements').select('*').order('purchased_at', { ascending: false });
  if (error) throw new Error(error.message);
  return data.map(fromRow);
}

/* lines: [{ productId, licence, qty }] → the new entitlements.
   Payment is not part of this demo: the `checkout` database function marks
   where the gateway's payment id must be verified before going live. */
export async function checkout(email, lines) {
  if (!online) return lines.flatMap(l => Array.from({ length: l.qty }, () => localGrant(email, l.productId, l.licence)));
  const { data, error } = await supabase.rpc('checkout', { lines: lines.map(l => ({ product_id: l.productId, licence: l.licence, qty: l.qty })) });
  if (error) throw new Error(error.message);
  const items = data.map(fromRow);
  protect(items.map(i => i.id));   /* runs in the background; the Library polls until ready */
  return items;
}

/* Ask the edge function to prepare the DRM-protected copies. */
export async function protect(ids) {
  if (!online || !ids.length) return;
  try { await supabase.functions.invoke('drm-protect', { body: { ids } }); } catch (_) { /* the Library shows the status */ }
}

/* One confirmed print session consumes one copy; null when the title is
   locked or not the customer's. */
export async function consumePrint(email, id) {
  if (!online) {
    const items = localItems(email);
    const e = items.find(x => x.id === id);
    if (!e || isLocked(e)) return null;
    e.remaining -= 1;
    save(email, items);
    return { ...e };
  }
  const { data, error } = await supabase.rpc('consume_print', { p_id: id });
  if (error) return null;
  return fromRow(data);
}

/* Logon for VeryPDF's secure reader: the customer's email plus a password the
   edge function generated for them. */
export async function readerCredentials(email) {
  if (!online) return null;
  const { data } = await supabase.from('profiles').select('drm_password').maybeSingle();
  return data && data.drm_password ? { user: email, password: data.drm_password } : null;
}
