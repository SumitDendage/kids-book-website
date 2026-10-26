import { useState } from 'react';

/* Play Store style stars. StarRow paints a rating (4.6 fills four and a bit stars);
   StarPicker is five big buttons a customer taps to rate. */
export function StarRow({ value = 0, className = '' }) {
  const pct = Math.max(0, Math.min(5, Number(value) || 0)) / 5 * 100;
  return (
    <span className={'star-row ' + className} role="img" aria-label={(Math.round((Number(value) || 0) * 10) / 10) + ' out of 5 stars'}>
      <span className="star-row-off" aria-hidden="true">★★★★★</span>
      <span className="star-row-on" aria-hidden="true" style={{ width: pct + '%' }}>★★★★★</span>
    </span>
  );
}

const WORDS = ['', 'Not good', 'Could be better', 'Okay', 'Good', 'Loved it'];
export function StarPicker({ value = 0, onChange, disabled = false, label = 'Your rating' }) {
  const [hover, setHover] = useState(0);
  const shown = hover || value;
  return (
    <div className="star-pick" role="radiogroup" aria-label={label} onMouseLeave={() => setHover(0)}>
      {[1, 2, 3, 4, 5].map(n => (
        <button key={n} type="button" role="radio" aria-checked={value === n} aria-label={n + (n === 1 ? ' star' : ' stars')}
          className={n <= shown ? 'on' : ''} disabled={disabled}
          onMouseEnter={() => setHover(n)} onFocus={() => setHover(n)} onBlur={() => setHover(0)} onClick={() => onChange && onChange(n)}>★</button>
      ))}
      <span className="star-word" aria-live="polite">{WORDS[shown] || ''}</span>
    </div>
  );
}

/* "4.6 ★ (12)" — the short line on a sheet card; nothing when the sheet has no reviews yet */
export function CardRating({ it }) {
  if (!it || !it.reviewCount || it.reviewAvg == null) return null;
  return <span className="card-rating" aria-label={'Rated ' + it.reviewAvg.toFixed(1) + ' out of 5 by ' + it.reviewCount + (it.reviewCount === 1 ? ' customer' : ' customers')}><b>{it.reviewAvg.toFixed(1)}</b><i aria-hidden="true">★</i><small>({it.reviewCount})</small></span>;
}

/* "★ 4.7" — the tiny badge on a letter or picture tile */
export function TileRating({ it }) {
  if (!it || !it.reviewCount || it.reviewAvg == null) return null;
  return <span className="tile-rating" aria-label={'Rated ' + it.reviewAvg.toFixed(1) + ' out of 5'}><i aria-hidden="true">★</i>{it.reviewAvg.toFixed(1)}</span>;
}

/* the five Play Store bars: how many reviews gave 5, 4, 3, 2 and 1 stars */
export function StarBars({ stars, count }) {
  const total = count || Object.values(stars || {}).reduce((a, b) => a + (Number(b) || 0), 0) || 0;
  return (
    <div className="star-bars" aria-hidden="true">
      {[5, 4, 3, 2, 1].map(n => {
        const k = Number((stars || {})[n]) || 0;
        return <div key={n} className="star-bar"><span>{n}</span><i><b style={{ width: (total ? k / total * 100 : 0) + '%' }} /></i></div>;
      })}
    </div>
  );
}
