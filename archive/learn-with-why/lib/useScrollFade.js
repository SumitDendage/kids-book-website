import { useEffect } from 'react';

/* A chapter taller than the viewport scrolls inside `.chapter-inner` with the
   scrollbar hidden. This writes --ft / --fb (0…1) onto the element so the
   stylesheet can show a soft edge where content continues. No re-renders. */
export function useScrollFade(ref) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const update = () => {
      const below = el.scrollHeight - el.clientHeight - el.scrollTop;
      el.style.setProperty('--ft', Math.min(1, el.scrollTop / 40).toFixed(2));
      el.style.setProperty('--fb', Math.max(0, Math.min(1, below / 40)).toFixed(2));
    };
    update();
    el.addEventListener('scroll', update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    Array.from(el.children).forEach(child => ro.observe(child));
    return () => { el.removeEventListener('scroll', update); ro.disconnect(); };
  }, [ref]);
}
