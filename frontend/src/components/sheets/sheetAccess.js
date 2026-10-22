/* What this customer has for one sheet, worked out from the access records the server sent
   (SiteContext's makeAccess: only live records open anything, the rest is history). It only
   paints labels and buttons: the server decides again every time a sheet opens.
     free    a free sheet (open once its PDF is ready, signed in or not)
     bought  bought on its own and still open (until: when it closes, ms)
     plan    opens through a running class plan (until: the plan's end, ms)
     ended   bought before, and that access has ended (endedAt, ms): "Buy Access Again"
     buy     not bought yet
   ready is false while the sheet's PDF is still being prepared ("Coming soon"). */
import { accessSpan, printsText } from '../../data/content.js';

export function sheetState(access, it) {
  const ready = it.available !== false;
  if (it.price === 0) return { kind: 'free', ready, open: ready };
  const own = access && access.itemEnt ? access.itemEnt(it.id) : null;
  if (own && own.kind !== 'free') return { kind: 'bought', ready, open: ready, until: own.end != null ? own.end : null };
  const sub = access && access.activeSub ? access.activeSub(it.cls) : null;
  if (sub) return { kind: 'plan', ready, open: ready, until: sub.end != null ? sub.end : null };
  const ended = access && access.session && access.endedOf ? access.endedOf(it.id) : null;
  if (ended) return { kind: 'ended', ready, open: false, endedAt: ended.end != null ? ended.end : null };
  return { kind: 'buy', ready, open: false };
}

/* "Open for 24 hours once bought", "Open for 3 days once bought" */
export const openForText = it => 'Open for ' + accessSpan(it) + ' once bought';

/* Can this sheet go in the cart? Paid, ready, on sale and not open on the account now
   (a purchase that ended can be bought again from the cart too). */
export const cartable = (it, st) => !!(it && it.price > 0 && st.ready && !st.open && it.onSale !== false && (st.kind === 'buy' || st.kind === 'ended'));

/* How many times the sheet can be printed, in a few words. Most sheets follow the account type
   (Parent 3, Teacher 30, Organization 300 unless staff change them); some have their own number.
   site: { session, accountType, printsPerSheet, printsTable } from the site store. */
export function printsLine(it, site) {
  /* a free sheet opens without an account, view only: printing comes with an account */
  if (it && it.price === 0 && !(site && site.session)) return 'View only · sign in to print';
  if (it && it.printRule === 'sheet') { const n = Number(it.printLimit) || 0; return n > 0 ? printsText(n) + ' with this sheet' : 'View only, no printing'; }
  const t = (site && site.printsTable) || { parent: 2, teacher: 3, organization: 300 };
  if (site && site.session) return printsText(site.printsPerSheet != null ? site.printsPerSheet : t.parent) + ' with your account';
  return 'Parent ' + t.parent + ' · Teacher ' + t.teacher + ' · Organization ' + t.organization;
}
