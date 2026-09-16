import { useEffect, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { QUOTES } from '../../content';
import { springs } from '../../lib/motion';
import { QuoteCard } from './Cards';

const AUTO_MS = 5200;
const n = QUOTES.length;
const half = Math.floor(n / 2);

/* One quote centred, neighbours peeking at the sides. Auto-advances while the
   chapter is on screen, pauses on hover/focus, never moves under
   prefers-reduced-motion. Drag or swipe the active card to change. */
export default function TestimonialCarousel({ active }) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const reduce = useReducedMotion();
  const go = d => setIndex(i => (i + d + n) % n);

  useEffect(() => {
    if (reduce || paused || !active) return undefined;
    const t = setInterval(() => go(1), AUTO_MS);
    return () => clearInterval(t);
  }, [reduce, paused, active]);

  function dragEnd(_, info) {
    const swipe = info.offset.x + info.velocity.x * 0.2;
    if (swipe < -60) go(1);
    else if (swipe > 60) go(-1);
  }

  return (
    <div
      className="carousel"
      onPointerEnter={() => setPaused(true)}
      onPointerLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
    >
      <div className="carousel-track">
        {QUOTES.map((q, i) => {
          const offset = ((i - index + n + half) % n) - half;   /* …-1, 0, 1… */
          const on = offset === 0;
          return (
            <motion.div
              key={q.name}
              animate={{ x: offset * 104 + '%', scale: on ? 1 : 0.9, opacity: on ? 1 : 0.35 }}
              transition={springs.ui}
              drag={on ? 'x' : false}
              dragConstraints={{ left: 0, right: 0 }}
              dragElastic={0.25}
              onDragEnd={dragEnd}
              style={{ pointerEvents: on ? 'auto' : 'none', zIndex: on ? 2 : 1 }}
              aria-hidden={!on}
            >
              <QuoteCard quote={q} />
            </motion.div>
          );
        })}
      </div>
      <div className="carousel-nav">
        <button type="button" className="icon-btn" onClick={() => go(-1)} aria-label="Previous review">←</button>
        <div className="carousel-dots">
          {QUOTES.map((q, i) => (
            <button key={q.name} type="button" className={'carousel-dot' + (i === index ? ' on' : '')} onClick={() => setIndex(i)} aria-label={'Review ' + (i + 1)} />
          ))}
        </div>
        <button type="button" className="icon-btn" onClick={() => go(1)} aria-label="Next review">→</button>
      </div>
    </div>
  );
}
