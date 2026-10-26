import { useCallback, useEffect, useRef, useState } from 'react';
import Rise from '../common/Rise.jsx';
import { QUOTES, THANKS } from '../../data/content.js';

/* CHAPTER 06 — testimonials coverflow with pause; auto-advances every 4.5 s while
   the chapter is in view (never with reduced motion). */
export default function Testimonials({ active, quotes = QUOTES, onWrite }) {
  const [idx, setIdx] = useState(0);
  const [paused, setPaused] = useState(false);
  const timer = useRef(0);
  const n = quotes.length;
  const go = useCallback(d => setIdx(i => (i + d + n) % n), [n]);
  const stop = () => { clearInterval(timer.current); timer.current = 0; };
  const start = useCallback(() => {
    stop();
    if (active && !paused && !matchMedia('(prefers-reduced-motion: reduce)').matches) timer.current = setInterval(() => go(1), 4500);
  }, [active, paused, go]);
  useEffect(() => { start(); return stop; }, [start]);
  const pos = i => { const d = ((i - idx + n + 1) % n) - 1; return Math.abs(d) <= 1 ? String(d) : 'hidden'; };

  return (
    <>
      <Rise className="flow" id="flow" i={2}>
        {quotes.map((q, i) => (
          <article key={i} className="quote-card" data-pos={pos(i)} aria-hidden={pos(i) === 'hidden' ? 'true' : undefined} onClick={() => { setIdx(i); start(); }}>
            <div className="stars" aria-label={(q.rating || 5) + ' stars'}>{'★'.repeat(q.rating || 5)}<i>{'★'.repeat(5 - (q.rating || 5))}</i></div><blockquote>“{q.text}”</blockquote><div className="who"><i aria-hidden="true">{q.initials}</i><span><b>{q.who}</b><small>{q.meta}</small></span>{q.live ? <em className="verified">Rated on the website</em> : null}</div>
          </article>
        ))}
      </Rise>
      <Rise className="flow-ctrl" i={3}>
        <button type="button" className="icon-btn" id="qPrev" aria-label="Previous story" onClick={() => { go(-1); start(); }}>←</button>
        <span id="qCount" aria-live="polite">{idx + 1}/{n}</span>
        <button type="button" className="icon-btn" id="qNext" aria-label="Next story" onClick={() => { go(1); start(); }}>→</button>
        <button type="button" className="btn btn-ghost" id="qPause" aria-pressed={paused} onClick={() => setPaused(p => !p)}>{paused ? 'Play ▶' : 'Pause ‖'}</button>
        {onWrite ? <button type="button" className="btn btn-primary write-review" onClick={onWrite}><span aria-hidden="true">★</span> Write a review</button> : null}
      </Rise>
      <Rise className="thanks-wall" i={4} aria-label="More thank-you notes"><div className="thanks-track" id="thanksTrack">{THANKS.concat(THANKS).map((t, i) => <span key={i} className="thanks-chip" aria-hidden={i >= THANKS.length ? 'true' : undefined}>{t}</span>)}</div></Rise>
    </>
  );
}
