import { useEffect, useState } from 'react';
import Chapter from '../layout/Chapter.jsx';
import Rise from '../common/Rise.jsx';
import { useSite } from '../../context/SiteContext.jsx';
import { fetchReviews } from '../../services/api.js';
import { sheetOf } from '../../data/catalogue.js';
import { dateOf } from '../../utils/format.js';
import { StarRow, StarBars } from '../reviews/Stars.jsx';

/* 06 · Reviews — what customers rated the sheets on the website (published in Admin → Homepage →
   Reviews): the shop's score with its five bars, then the newest reviews as little glass notes, each
   with the sheet it is about (tap to open it). With no reviews yet, five big stars invite the first one. */
const FILTERS = [['all', 'All'], ['5', '5 ★'], ['4', '4 ★'], ['low', '3 ★ and below']];
const initialsOf = name => String(name || '').replace(/[^A-Za-zÀ-ÿ]/g, '').slice(0, 2) || '★';

function ReviewNote({ r, n }) {
  const { openSheet } = useSite();
  const it = sheetOf(r.worksheet);
  return (
    <article className="rv-note" style={{ '--n': n }}>
      <div className="rv-note-top"><StarRow value={r.rating} /><small>{r.at ? dateOf(r.at) : ''}</small></div>
      {r.title ? <h3 className="rv-note-title">{r.title}</h3> : null}
      {r.body ? <p className="rv-note-text">“{r.body}”</p> : null}
      <div className="rv-note-foot">
        <span className="rv-who"><i aria-hidden="true">{initialsOf(r.name)}</i><b>{r.name}</b></span>
        {it ? <button type="button" className="rv-sheet" onClick={() => openSheet(it.id)} aria-label={'Open ' + it.title}>
          {it.img ? <img src={it.img} alt="" loading="lazy" /> : null}<span>{it.title}</span>
        </button> : r.worksheetTitle ? <span className="rv-sheet plain"><span>{r.worksheetTitle}</span></span> : null}
      </div>
    </article>
  );
}

export default function ReviewsChapter() {
  const { section, openReview } = useSite();
  const [rv, setRv] = useState(null);
  const [filter, setFilter] = useState('all');
  const [hover, setHover] = useState(0);
  /* asked once the reader is near, so the first screen does not wait for it */
  const near = section >= 3;
  useEffect(() => {
    if (!near || rv) return;
    let live = true;
    fetchReviews(24).then(r => { if (live) setRv(r); }).catch(() => { if (live) setRv({ count: 0, reviews: [] }); });
    return () => { live = false; };
  }, [near, rv]);
  const count = (rv && Number(rv.count)) || 0;
  const avg = rv && rv.avg != null ? Number(rv.avg) : null;
  const all = ((rv && rv.reviews) || []);
  const shown = all.filter(r => filter === 'all' || (filter === 'low' ? r.rating <= 3 : String(r.rating) === filter)).slice(0, 6);

  return (
    <Chapter index={5}>
      <div className="rv-head">
        <Rise as="p" i={0} className="eyebrow" style={{ textAlign: 'center' }}>06 / Customer reviews</Rise>
        <Rise as="h2" i={1} className="h2" style={{ textAlign: 'center' }}>Stars from <em>real families</em>.</Rise>
      </div>
      <div className={'rv-grid' + (count ? '' : ' empty')}>
        <Rise className="rv-score panel" i={2}>
          {count && avg != null ? <>
            <p className="rv-score-label">Our sheets are rated</p>
            <div className="rv-big"><b>{avg.toFixed(1)}</b><span>out of 5</span></div>
            <StarRow value={avg} className="rv-big-stars" />
            <p className="rv-count">{count === 1 ? 'from 1 review' : 'from ' + count + ' reviews'}</p>
            <StarBars stars={rv.stars} count={count} />
          </> : <>
            <p className="rv-score-label">No reviews yet</p>
            <p className="rv-first">Be the first to give our sheets a star.</p>
            <div className="rv-wish" role="group" aria-label="Rate a sheet" onMouseLeave={() => setHover(0)}>
              {[1, 2, 3, 4, 5].map(n => <button key={n} type="button" className={n <= hover ? 'on' : ''} style={{ '--n': n }} aria-label={'Rate ' + n + (n === 1 ? ' star' : ' stars')} onMouseEnter={() => setHover(n)} onFocus={() => setHover(n)} onClick={openReview}>★</button>)}
            </div>
          </>}
          <button type="button" className="btn btn-primary rv-write" onClick={openReview}><span aria-hidden="true">✎</span> Write a review</button>
          <p className="rv-fine">Only customers who used a sheet can rate it. We read every review before it shows here.</p>
        </Rise>

        {count ? (
          <Rise className="rv-wall" i={3}>
            <div className="chips rv-filters" role="group" aria-label="Show reviews">
              {FILTERS.map(([id, label]) => <button key={id} type="button" className={'chip' + (filter === id ? ' on' : '')} aria-pressed={filter === id} onClick={() => setFilter(id)}>{label}</button>)}
            </div>
            {shown.length
              ? <div className="rv-notes">{shown.map((r, n) => <ReviewNote key={r.id} r={r} n={n} />)}</div>
              : <p className="rv-none">No reviews with those stars yet.</p>}
          </Rise>
        ) : (
          <Rise className="rv-steps" i={3}>
            {[['📄', 'Open a sheet', 'A free sheet or one you bought.'], ['★', 'Tap the stars', '1 to 5, and a few words if you like.'], ['🌼', 'It shows here', 'After a quick check, for other parents and teachers.']].map(([icon, t, s], n) => (
              <div key={t} className="rv-step panel" style={{ '--n': n }}><i aria-hidden="true">{icon}</i><b>{t}</b><span>{s}</span></div>
            ))}
          </Rise>
        )}
      </div>
    </Chapter>
  );
}
