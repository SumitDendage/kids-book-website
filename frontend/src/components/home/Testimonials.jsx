import { useCallback, useEffect, useRef, useState } from 'react';
import { m } from 'framer-motion';
import Rise from '../common/Rise.jsx';
import { PANEL } from '../motion/presets.js';
import { QUOTES, THANKS } from '../../data/content.js';

/* where each card sits in the coverflow: in front, either side (turned towards the middle), or tucked away behind */
const PLACE = {
  0: { x: '-50%', y: '-50%', z: 0, rotateY: 0, scale: 1, opacity: 1 },
  '-1': { x: '-114%', y: '-50%', z: -160, rotateY: 32, scale: 0.9, opacity: 0.6 },
  1: { x: '14%', y: '-50%', z: -160, rotateY: -32, scale: 0.9, opacity: 0.6 },
  hidden: { x: '-50%', y: '-50%', z: -400, rotateY: 0, scale: 0.7, opacity: 0 },
};

/* CHAPTER 06 — testimonials coverflow with pause; auto-advances every 4.5 s while
   the chapter is in view (never with reduced motion). */
export default function Testimonials({ active }) {
  const [idx, setIdx] = useState(0);
  const [paused, setPaused] = useState(false);
  const timer = useRef(0);
  const n = QUOTES.length;
  /* on a phone only the front card shows (24-testimonials.css hides the side ones there too) */
  const [narrow, setNarrow] = useState(() => matchMedia('(max-width: 760px)').matches);
  useEffect(() => {
    const q = matchMedia('(max-width: 760px)'), f = () => setNarrow(q.matches);
    q.addEventListener('change', f);
    return () => q.removeEventListener('change', f);
  }, []);
  const placeOf = p => (narrow && (p === '1' || p === '-1') ? { ...PLACE[p], opacity: 0 } : PLACE[p]);
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
        {QUOTES.map((q, i) => (
          <m.article key={i} className="quote-card" data-pos={pos(i)} aria-hidden={pos(i) === 'hidden' ? 'true' : undefined} onClick={() => { setIdx(i); start(); }}
            initial={false} animate={placeOf(pos(i))} transition={PANEL}>
            <div className="stars" aria-label="5 stars">★★★★★</div><blockquote>“{q.text}”</blockquote><div className="who"><i aria-hidden="true">{q.initials}</i><span><b>{q.who}</b><small>{q.meta}</small></span></div>
          </m.article>
        ))}
      </Rise>
      <Rise className="flow-ctrl" i={3}>
        <button type="button" className="icon-btn" id="qPrev" aria-label="Previous story" onClick={() => { go(-1); start(); }}>←</button>
        <span id="qCount" aria-live="polite">{idx + 1}/{n}</span>
        <button type="button" className="icon-btn" id="qNext" aria-label="Next story" onClick={() => { go(1); start(); }}>→</button>
        <button type="button" className="btn btn-ghost" id="qPause" aria-pressed={paused} onClick={() => setPaused(p => !p)}>{paused ? 'Play ▶' : 'Pause ‖'}</button>
      </Rise>
      <Rise className="thanks-wall" i={4} aria-label="More thank-you notes"><div className="thanks-track" id="thanksTrack">{THANKS.concat(THANKS).map((t, i) => <span key={i} className="thanks-chip" aria-hidden={i >= THANKS.length ? 'true' : undefined}>{t}</span>)}</div></Rise>
    </>
  );
}
