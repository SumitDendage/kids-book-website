import { useEffect, useMemo, useState } from 'react';
import { useSite } from '../../context/SiteContext.jsx';
import useMyWorksheets from '../../hooks/useMyWorksheets.js';
import { ITEMS, sheetOf } from '../../data/catalogue.js';
import ReviewForm from './ReviewForm.jsx';
import { loadMyReviews, myReviewOf } from './myReviews.js';

/* "Write a review" from the home page's customer reviews: pick one of your sheets (or a free one),
   then rate it. The review joins that sheet's ratings once it has been checked. */
export default function WriteReview() {
  const { closeModal, session } = useSite();
  const { sheets, expired } = useMyWorksheets();
  const groups = useMemo(() => {
    const seen = new Set();
    const take = list => list.filter(it => it && it.pdf && !it.unlisted && !seen.has(it.id) && seen.add(it.id));
    const yours = take(sheets.map(s => s.it).concat(expired.map(s => s.it)));
    const free = take(ITEMS.filter(it => it.price === 0));
    return [['Your sheets', yours], ['Free sheets', free]].filter(g => g[1].length);
  }, [sheets, expired]);
  const first = groups.length ? groups[0][1][0].id : '';
  const [id, setId] = useState(first);
  const [mine, setMine] = useState([]);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => { if (!id && first) setId(first); }, [id, first]);
  useEffect(() => { let live = true; if (session) loadMyReviews(session.id).then(l => { if (live) { setMine(l); setLoaded(true); } }); return () => { live = false; }; }, [session]);
  const it = sheetOf(id);
  return (
    <>
      <div className="modal-head"><div><p className="eyebrow">Customer reviews</p><h3 id="modalTitle">Write a review</h3></div><button type="button" className="icon-btn" aria-label="Close" onClick={closeModal}>✕</button></div>
      <p className="lead">Which sheet would you like to rate? Your review helps other parents and teachers choose.</p>
      {groups.length ? <>
        <label className="field-label" htmlFor="rvSheet">Sheet</label>
        <select id="rvSheet" className="review-select" value={id} onChange={e => setId(e.target.value)}>
          {groups.map(([label, list]) => <optgroup key={label} label={label}>{list.map(s => <option key={s.id} value={s.id}>{s.title}</option>)}</optgroup>)}
        </select>
        {it ? <ReviewForm key={it.id + (loaded ? ':ready' : '')} it={it} mine={myReviewOf(mine, it.id)} onSaved={r => setMine(l => l.filter(x => x.worksheet !== it.id).concat({ ...r, worksheet: it.id }))} /> : null}
      </> : <p className="rating-none">Open a free sheet or buy one first, then come back to rate it.</p>}
    </>
  );
}
