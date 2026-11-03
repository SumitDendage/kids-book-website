import { useEffect, useState } from 'react';
import { catalogueApi } from '../../services/api.js';
import { useSite } from '../../context/SiteContext.jsx';
import { dateOf } from '../../utils/format.js';
import { StarRow, StarBars } from './Stars.jsx';
import ReviewForm from './ReviewForm.jsx';
import { loadMyReviews, myReviewOf } from './myReviews.js';

const STATUS = { pending: 'Waiting for a quick check', published: 'Showing on the website', hidden: 'Not shown on the website' };

/* "Ratings and reviews" in a sheet's window, like the Play Store: the average, the five bars,
   rate it yourself, and what other customers wrote (published reviews only). */
export default function SheetRatings({ it, st }) {
  const { session } = useSite();
  const [data, setData] = useState(null);
  const [mine, setMine] = useState(null);
  const [editing, setEditing] = useState(false);
  const [all, setAll] = useState(false);
  useEffect(() => {
    let live = true;
    setData(null); setAll(false);
    catalogueApi.reviews(it.id).then(r => { if (live) setData(r); }).catch(() => { if (live) setData({ avg: null, count: 0, reviews: [] }); });
    return () => { live = false; };
  }, [it.id]);
  useEffect(() => {
    let live = true;
    setMine(null); setEditing(false);
    if (session) loadMyReviews(session.id).then(list => { if (live) setMine(myReviewOf(list, it.id)); });
    return () => { live = false; };
  }, [it.id, session]);

  const count = data ? Number(data.count) || 0 : it.reviewCount || 0;
  const avg = data && data.avg != null ? Number(data.avg) : it.reviewAvg;
  const list = (data && data.reviews) || [];
  /* an older server sends no bars: count the reviews it sent */
  const stars = (data && data.stars) || list.reduce((m, r) => { m[r.rating] = (m[r.rating] || 0) + 1; return m; }, {});
  const canRate = st.kind !== 'buy';
  const shown = all ? list : list.slice(0, 3);

  return (
    <section className="sheet-ratings" aria-labelledby={'rt-' + it.id}>
      <h4 id={'rt-' + it.id}>Ratings and reviews</h4>
      {count && avg != null ? (
        <div className="rating-sum">
          <div className="rating-big"><b>{avg.toFixed(1)}</b><StarRow value={avg} /><small>{count === 1 ? '1 review' : count + ' reviews'}</small></div>
          <StarBars stars={stars} count={count} />
        </div>
      ) : <p className="rating-none">{data ? 'No reviews yet. Be the first to rate this sheet.' : 'Loading reviews…'}</p>}

      <div className="rate-it">
        {mine && !editing ? (
          <div className="my-review">
            <p className="rate-title">Your rating</p>
            <div className="my-review-row"><StarRow value={mine.rating} /><span className="pill-s">{STATUS[mine.status] || ''}</span><button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(true)}>Edit</button></div>
            {mine.body ? <p className="review-text">{mine.body}</p> : null}
          </div>
        ) : canRate || !session ? <>
          <p className="rate-title">{mine ? 'Change your rating' : 'Rate this sheet'}</p>
          <ReviewForm key={it.id + (mine ? mine.id : '')} it={it} mine={mine} onSaved={r => { setMine({ ...r, worksheet: it.id }); setEditing(false); }} />
        </> : <p className="rating-none">Buy or open this sheet to rate it.</p>}
      </div>

      {shown.length ? <ul className="review-items">{shown.map(r => (
        <li key={r.id}>
          <div className="review-who"><i aria-hidden="true">{String(r.name || 'A').replace(/[^A-Za-zÀ-ÿ]/g, '').slice(0, 2) || '★'}</i><b>{r.name}</b></div>
          <div className="review-meta"><StarRow value={r.rating} />{r.at ? <small>{dateOf(r.at)}</small> : null}</div>
          {r.title ? <p className="review-title">{r.title}</p> : null}
          {r.body ? <p className="review-text">{r.body}</p> : null}
        </li>
      ))}</ul> : null}
      {list.length > 3 && !all ? <button type="button" className="arrow-link" onClick={() => setAll(true)}>See all reviews <span aria-hidden="true">→</span></button> : null}
    </section>
  );
}
