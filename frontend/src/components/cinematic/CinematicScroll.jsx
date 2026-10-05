import { useEffect, useRef } from 'react';
import { createFrameEngine, TOTAL, frameSrc } from '../../services/frameEngine.js';

/* The scroll-controlled landscape behind the whole site: 960 WebP frames drawn on
   one full-screen canvas. `onTick` runs once per animation frame (before painting)
   and returns the playhead, 0…1 — the chapter stage eases the scroll there.
   No React state changes per frame: the engine draws straight onto the canvas. */
export default function CinematicScroll({ onTick, engineRef, total = TOTAL, srcOf = frameSrc, label = 'Landscape animation controlled by scrolling' }) {
  const canvasRef = useRef(null);
  const tickRef = useRef(onTick);
  useEffect(() => { tickRef.current = onTick; }, [onTick]);

  useEffect(() => {
    const engine = createFrameEngine(canvasRef.current, { total, srcOf });
    if (engineRef) engineRef.current = engine;
    engine.start();
    let raf = 0;
    const loop = () => { const p = tickRef.current ? tickRef.current() : 0; engine.paint(p); raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
    const onResize = () => engine.resize();
    addEventListener('resize', onResize);
    return () => { cancelAnimationFrame(raf); removeEventListener('resize', onResize); engine.destroy(); if (engineRef) engineRef.current = null; };
  }, [engineRef, total, srcOf]);

  return <canvas id="scene" ref={canvasRef} aria-label={label} />;
}
