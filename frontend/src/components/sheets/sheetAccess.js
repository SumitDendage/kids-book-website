/* What this customer has for one sheet, worked out from the access records the server sent
   (SiteContext's makeAccess: only live records open anything, the rest is history). It only
   paints labels and buttons: the server decides again every time a sheet opens.
     free    a free sheet (open: signed in and its PDF is ready)
     bought  bought on its own and still open (until: when it closes, ms)
     plan    opens through a running class plan (until: the plan's end, ms)
     ended   bought before, and that access has ended (endedAt, ms): "Buy Access Again"
     buy     not bought yet
   ready is false while the sheet's PDF is still being prepared ("Coming soon"). */
import { accessSpan } from '../../data/content.js';

export function sheetState(access, it) {
  const ready = it.available !== false;
  if (it.price === 0) return { kind: 'free', ready, open: ready && !!(access && access.session) };
  const own = access && access.itemEnt ? access.itemEnt(it.id) : null;
  if (own && own.kind !== 'free') return { kind: 'bought', ready, open: ready, until: own.end != null ? own.end : null };
  const sub = access && access.activeSub ? access.activeSub(it.cls) : null;
  if (sub) return { kind: 'plan', ready, open: ready, until: sub.end != null ? sub.end : null };
  const ended = access && access.session && access.endedOf ? access.endedOf(it.id) : null;
  if (ended) return { kind: 'ended', ready, open: false, endedAt: ended.end != null ? ended.end : null };
  return { kind: 'buy', ready, open: false };
}

/* "Open for 1 year once bought" (365 days), "Open for 30 days once bought" otherwise */
export const openForText = it => 'Open for ' + accessSpan(it && it.accessDays) + ' once bought';
