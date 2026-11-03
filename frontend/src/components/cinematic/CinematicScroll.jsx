import { useEffect, useRef } from 'react';
import { createFrameEngine, TOTAL, frameSrc } from '../../services/frameEngine.js';
import { createWalkers } from '../../services/walkers.js';
import { createScenery } from '../../services/scenery.js';

/* The scroll-controlled landscape behind the whole site: 960 WebP frames drawn on
   one full-screen canvas. `onTick` runs once per animation frame (before painting)
   and returns the playhead, 0…1 — the chapter stage eases the scroll there.
   The fox, deer and rabbit walk on a second canvas over it, at the same playhead,
   so they fit every screen (services/walkers.js). Between the two, the birds and the
   waterfalls move on their own clock (services/scenery.js), following the frame on show.
   No React state changes per frame: the engine draws straight onto the canvas. */
export default function CinematicScroll({ onTick, engineRef, total = TOTAL, srcOf = frameSrc, label = 'Landscape animation controlled by scrolling' }) {
  const canvasRef = useRef(null), sceneryRef = useRef(null), walkersRef = useRef(null);
  const tickRef = useRef(onTick);
  useEffect(() => { tickRef.current = onTick; }, [onTick]);

  useEffect(() => {
    const engine = createFrameEngine(canvasRef.current, { total, srcOf });
    const walkers = createWalkers(walkersRef.current);
    const scenery = createScenery(sceneryRef.current);
    if (engineRef) engineRef.current = engine;
    engine.start();
    let raf = 0;
    /* the birds, the water and the walking animals wait behind the opening veil until it lifts,
       so a phone spends those first seconds on getting the page ready, not on drawing under a cover */
    const open = () => document.body.dataset.stage !== 'boot';
    const loop = () => { const p = tickRef.current ? tickRef.current() : 0; engine.paint(p); if (open()) { scenery.paint(engine.shown); walkers.paint(p); } raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
    const onResize = () => { engine.resize(); scenery.resize(); walkers.resize(); };
    addEventListener('resize', onResize);
    return () => { cancelAnimationFrame(raf); removeEventListener('resize', onResize); engine.destroy(); scenery.destroy(); walkers.destroy(); if (engineRef) engineRef.current = null; };
  }, [engineRef, total, srcOf]);

  return <><canvas id="scene" ref={canvasRef} aria-label={label} /><canvas id="scenery" ref={sceneryRef} aria-hidden="true" /><canvas id="walkers" ref={walkersRef} aria-hidden="true" /></>;
}
