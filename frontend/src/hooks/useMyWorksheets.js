import { useSite } from '../context/SiteContext.jsx';
import { ITEMS, sheetOf } from '../data/catalogue.js';

/* My Account → My Worksheets, from every access record the server sent:
   - subs:       class plans running now (or about to start), with their end
   - endedPlans: class plans that ran out, with nothing running for that class ("Renew")
   - sheets:     every sheet that opens right now: bought on its own, free, added for the customer,
                 or in a running class plan. Each has { it, kind: 'paid' | 'grant' | 'free' | 'plan',
                 since, end, title }
   - expired:    sheets bought on their own whose time ran out ("Buy Access Again"): { id, it, title, end }
   - activeCount: what the Cart button counts: paid sheets open now plus running class plans
   - paused:     the server paused paid sheets on this account */
export default function useMyWorksheets() {
  const { access, session } = useSite();
  const now = access.now;
  const subs = access.subsOf().slice().sort((a, b) => (b.start || 0) - (a.start || 0));
  const endedPlans = access.endedPlans().sort((a, b) => (b.end || 0) - (a.end || 0));

  const singles = access.ownedOf().map(id => {
    const e = access.itemEnt(id); if (!e) return null;
    const it = sheetOf(id) || null;
    return { id, it, kind: e.kind === 'free' ? 'free' : e.kind === 'grant' ? 'grant' : 'paid', since: e.start, end: e.end ?? null, title: (it && it.title) || e.title || id };
  }).filter(Boolean).sort((a, b) => (b.since || 0) - (a.since || 0));

  const inPlans = subs.flatMap(x => ITEMS.filter(it => it.cls === x.cls && it.pdf && !singles.some(s => s.id === it.id))
    .map(it => ({ id: it.id, it, kind: 'plan', cls: x.cls, since: x.start, end: x.end, title: it.title })));
  const sheets = singles.concat(inPlans);

  /* bought on its own, time up, and nothing else opens it now */
  const seen = new Set();
  const expired = [];
  access.ent.filter(e => e.scope === 'worksheet' && e.kind !== 'free').forEach(e => {
    if (seen.has(e.worksheet)) return; seen.add(e.worksheet);
    if (sheets.some(s => s.id === e.worksheet)) return;
    const ended = access.endedOf(e.worksheet); if (!ended) return;
    const it = sheetOf(e.worksheet) || null;
    expired.push({ id: e.worksheet, it, title: (it && it.title) || ended.title || e.worksheet, end: ended.end, kind: ended.kind });
  });
  expired.sort((a, b) => (b.end || 0) - (a.end || 0));

  const activeCount = singles.filter(s => s.kind === 'paid').length + subs.length;
  const paused = !!session && session.accessStatus === 'suspended';
  return { now, subs, endedPlans, sheets, singles, expired, activeCount, paused, mine: sheets };
}
