import { useEffect, useState } from 'react';

/* frames per second, measured live while the card is on screen */
export function Fps() {
  const [fps, setFps] = useState('…');
  useEffect(() => {
    let n = 0, t0 = performance.now(), raf = 0;
    const tick = () => { n++; const dt = performance.now() - t0; if (dt >= 1000) { setFps(Math.round(n * 1000 / dt)); n = 0; t0 = performance.now(); } raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  return <span>{fps}</span>;
}

/* the browser's storage estimate: used / quota in MB */
export function Quota() {
  const [q, setQ] = useState('…');
  useEffect(() => {
    let alive = true;
    if (navigator.storage && navigator.storage.estimate) navigator.storage.estimate().then(e => { if (alive) setQ(Math.round((e.usage || 0) / 1048576) + ' / ' + Math.round((e.quota || 0) / 1048576) + ' MB'); });
    return () => { alive = false; };
  }, []);
  return <span>{q}</span>;
}
