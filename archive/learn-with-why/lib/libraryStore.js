/* Licence service — licences and print allowances in this browser's localStorage
   (demo store). A locked title is rejected here whatever the caller sends. */
import { BRAND, LICENCES } from './content';
import { LS_LIBRARY, read, write } from './storage';

export const online = false;   /* no hosted backend is connected to this build */
export function licence(id) { return LICENCES.find(l => l.id === id) || LICENCES[0]; }
export const isLocked = e => e.remaining <= 0;
/* No protected-copy service is connected: nothing is ever DRM-governed here. */
export const isDrm = () => false;

/* ---------- local demo store ---------- */
const all = () => read(LS_LIBRARY, {});
const save = (email, items) => { const a = all(); a[email] = items; write(LS_LIBRARY, a); };
const localItems = email => (email ? all()[email] || [] : []);

function newId(existing) {   /* LW-105842 style, unique per purchase */
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

/* Newest first. */
export async function library(email) { return localItems(email); }

/* lines: [{ productId, licence, qty }] → the new entitlements. Payment is not part of this demo. */
export async function checkout(email, lines) {
  return lines.flatMap(l => Array.from({ length: l.qty }, () => localGrant(email, l.productId, l.licence)));
}

/* Kept for callers; there is no protection service to ask. */
export async function protect() { return; }

/* One confirmed print session consumes one copy; null when the title is
   locked or not the customer's. */
export async function consumePrint(email, id) {
  const items = localItems(email);
  const e = items.find(x => x.id === id);
  if (!e || isLocked(e)) return null;
  e.remaining -= 1;
  save(email, items);
  return { ...e };
}

/* No secure reader is connected. */
export async function readerCredentials() { return null; }
