import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { spring } from 'framer-motion';
import { animate } from 'framer-motion/dom/mini';
import { useSite } from '../../context/SiteContext.jsx';

/* The printed page flies out of the card you tapped and grows into the sheet window — the one
   move that makes the site feel expensive. A copy of the picture is laid exactly over the card,
   then sprung to where the real picture sits inside the window, and faded out once it lands, so
   what you are left looking at is the window itself.
   openSheet(id, from) gives us where the tap came from (components/sheets/*). */
/* the small animate() runs on the browser's own engine, so the spring is given as a generator */
const SPRING = { type: spring, stiffness: 150, damping: 21, mass: 0.85 };

/* where the window's own picture ends up; it is laid out a frame or two after the window opens */
function findTarget(tries, done) {
  const el = document.querySelector('.modal.sheet .sheet-view img, .modal.sheet .sheet-view .sheet-mock');
  const r = el && el.getBoundingClientRect();
  if (r && r.width > 20 && r.height > 20) { done(r); return; }
  if (tries > 0) requestAnimationFrame(() => findTarget(tries - 1, done));
  else done(null);
}

export default function SheetFlight() {
  const { modal } = useSite();
  const [flight, setFlight] = useState(null);     /* { src, from } while the copy is in the air */
  const box = useRef(null);
  const shown = useRef('');

  /* a sheet window just opened from a card that had a picture: start the flight */
  useEffect(() => {
    const key = modal.open && modal.kind === 'sheet' ? String(modal.id) + ':' + (modal.at || '') : '';
    if (!key || key === shown.current) { if (!key) shown.current = ''; return; }
    shown.current = key;
    const from = modal.from;
    if (!from || !from.src || typeof matchMedia !== 'function' || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    setFlight({ src: from.src, from });
  }, [modal.open, modal.kind, modal.id, modal.at, modal.from]);

  /* fly to the window's picture, then hand over to it */
  useEffect(() => {
    if (!flight || !box.current) return;
    let stop = null, gone = 0;
    const el = box.current;
    findTarget(30, r => {
      if (!r) { setFlight(null); return; }
      const f = flight.from;
      stop = animate(el, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' }, SPRING);
      /* the copy steps aside once it is sitting on top of the real picture */
      gone = setTimeout(() => { animate(el, { opacity: 0 }, { duration: 0.18 }); setTimeout(() => setFlight(null), 190); }, 480);
      void f;
    });
    return () => { if (stop && stop.stop) stop.stop(); clearTimeout(gone); };
  }, [flight]);

  if (!flight) return null;
  const f = flight.from;
  return createPortal(
    <img
      ref={box} className="mo-flight" src={flight.src} alt="" aria-hidden="true" draggable="false"
      style={{ left: f.left + 'px', top: f.top + 'px', width: f.width + 'px', height: f.height + 'px' }}
    />,
    document.body,
  );
}

/* what a card hands to openSheet: where its picture is on the screen right now */
export const flightFrom = el => {
  const img = el && el.querySelector && el.querySelector('img');
  if (!img || !img.currentSrc) return null;
  const r = img.getBoundingClientRect();
  if (r.width < 20 || r.height < 20) return null;
  return { src: img.currentSrc, left: r.left, top: r.top, width: r.width, height: r.height };
};
