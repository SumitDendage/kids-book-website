import { useSite } from '../context/SiteContext.jsx';
import { ITEMS, sheetOf } from '../data/catalogue.js';

/* My Account → My Worksheets: every sheet the customer can open (plans, bought PDFs,
   free sheets opened before), newest first, and the count shown on the Cart button. */
export default function useMyWorksheets() {
  const { access } = useSite();
  const subs = access.subsOf().slice().sort((a, b) => b.start - a.start);
  const singles = [];
  access.ent.filter(e => e.scope === 'worksheet').sort((a, b) => b.start - a.start).forEach(e => {
    if (!singles.some(s => s.it.id === e.worksheet)) { const it = sheetOf(e.worksheet); if (it && it.pdf) singles.push({ it, since: e.start, kind: e.kind }); }
  });
  const activeCount = subs.length + singles.filter(s => s.kind === 'paid').length;
  const mine = singles.concat(subs.flatMap(x => ITEMS.filter(it => it.cls === x.cls && it.pdf && !singles.some(s => s.it.id === it.id)).map(it => ({ it, since: x.start, kind: 'plan' }))));
  return { subs, singles, mine, activeCount };
}
