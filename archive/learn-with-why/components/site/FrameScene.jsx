'use client';
import { useEffect, useRef } from 'react';
import { useMotionValueEvent, useScroll, useSpring, useTransform } from 'motion/react';

/* The fox-and-rabbit frame sequence, scrubbed by how far the stage has been
   scrolled. Stays on frame 1 through the hero, plays through the sheets, and
   holds the last frame at the end. Frames are decoded once and drawn with a
   cover fit; a missing frame falls back to the nearest one already loaded. */
export const TOTAL = 50;
const src = i => '/frames/frame_' + String(i + 1).padStart(3, '0') + '.jpg';

export default function FrameScene({ targetRef, from = 0.18, to = 0.86 }) {
  const canvas = useRef(null);
  const frames = useRef([]);
  const drawn = useRef(-1);
  const { scrollYProgress } = useScroll({ target: targetRef, offset: ['start start', 'end end'] });
  const mapped = useTransform(scrollYProgress, [from, to], [0, 1], { clamp: true });
  const progress = useSpring(mapped, { stiffness: 140, damping: 32, mass: 0.5 });

  function draw(i, force) {
    const el = canvas.current;
    if (!el) return;
    let k = i;
    while (k >= 0 && !frames.current[k]) k--;           /* nearest loaded frame below */
    if (k < 0) { k = frames.current.findIndex(Boolean); if (k < 0) return; }
    if (!force && k === drawn.current) return;
    const img = frames.current[k];
    const ctx = el.getContext('2d', { alpha: false });
    const W = el.width, H = el.height;
    const s = Math.max(W / img.naturalWidth, H / img.naturalHeight);
    const w = img.naturalWidth * s, h = img.naturalHeight * s;
    ctx.drawImage(img, (W - w) / 2, (H - h) / 2, w, h);
    drawn.current = k;
  }

  useEffect(() => {
    const el = canvas.current;
    let alive = true;
    const resize = () => {
      const dpr = Math.min(devicePixelRatio || 1, 2);
      el.width = Math.floor(el.clientWidth * dpr);
      el.height = Math.floor(el.clientHeight * dpr);
      draw(Math.round(progress.get() * (TOTAL - 1)), true);
    };
    resize();
    addEventListener('resize', resize);
    const load = i => new Promise(res => {
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => { if (alive) { frames.current[i] = img; res(); } };
      img.onerror = () => res();
      img.src = src(i);
    });
    (async () => {
      await load(0);
      draw(0, true);
      /* the rest in order of likely need: every 5th first, then the gaps */
      const order = [];
      for (let i = 5; i < TOTAL; i += 5) order.push(i);
      for (let i = 1; i < TOTAL; i++) if (i % 5) order.push(i);
      for (const i of order) { if (!alive) return; await load(i); }
      draw(Math.round(progress.get() * (TOTAL - 1)), true);
    })();
    return () => { alive = false; removeEventListener('resize', resize); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useMotionValueEvent(progress, 'change', v => draw(Math.round(v * (TOTAL - 1))));

  return <canvas ref={canvas} className="scene-canvas" aria-hidden="true" />;
}
