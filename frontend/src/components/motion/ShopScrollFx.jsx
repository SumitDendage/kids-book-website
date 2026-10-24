import { useEffect } from 'react';
import { scroll } from 'framer-motion';

/* Scroll-driven animation, the newest way browsers do this: the shop's wallpaper drifts and the
   bar under its header fills **on the browser's own scroll timeline**, so the motion keeps up with
   your finger even while the page is busy — nothing is measured in JavaScript on the way.
   Where a browser has no scroll timeline yet, Framer Motion falls back to listening to the scroll.
   `ref` is the shop panel, which is the thing that scrolls (styles/13-shop.css). */
export default function ShopScrollFx({ shopRef, open }) {
  useEffect(() => {
    const shop = shopRef.current;
    if (!open || !shop) return;
    if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const scene = shop.querySelector('.shop-scene img');
    const bar = shop.querySelector('.shop-progress span');
    const stops = [];
    if (scene) stops.push(scroll(p => { scene.style.transform = 'translate3d(0,' + (p * -7).toFixed(2) + '%,0) scale(' + (1.06 + p * 0.04).toFixed(3) + ')'; }, { source: shop }));
    if (bar) stops.push(scroll(p => { bar.style.transform = 'scaleX(' + p.toFixed(4) + ')'; }, { source: shop }));
    return () => { stops.forEach(s => s && s()); if (scene) scene.style.transform = ''; };
  }, [shopRef, open]);
  return null;
}
