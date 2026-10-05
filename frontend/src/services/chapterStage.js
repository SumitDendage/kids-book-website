/* CHAPTERS — one continuous glide through six screens. Native scrolling is
   replaced by an eased playhead in pixels through the chapter stack; the stack is
   moved with a transform and the landscape frame follows from how far along it
   we are. Moved from the page script in legacy/old-static-site/index.html; the numbers
   (0.06 glide, 0.6 wheel, 1.2 touch, 0.85 screen per key) are unchanged. */
import { IDS } from '../data/content.js';

export function createStage() {
  const s = {
    target: 0, current: 0, maxScroll: 1, lastProgress: -1, lastY: -1, section: -1,
    stack: null, chapters: [], inners: [],
    site: false,                 /* true once the opening veil has lifted (body[data-stage="site"]) */
    isLocked: () => false,       /* an overlay, drawer or modal owns the input */
    onSection: () => {},         /* the chapter in the middle of the screen changed */
    onHideHint: () => {},
    reduceMotion: typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches,
  };
  s.clamp = v => Math.max(0, Math.min(s.maxScroll, v));
  s.measure = () => {
    if (!s.stack) return;
    s.maxScroll = Math.max(1, s.stack.offsetHeight - innerHeight);
    s.target = s.clamp(s.target); s.current = s.clamp(s.current); s.lastY = -1;
  };
  s.goTo = n => {
    const count = IDS.length; n = Math.max(0, Math.min(count - 1, n));
    s.measure(); if (s.chapters[n]) s.target = s.clamp(s.chapters[n].offsetTop); s.onHideHint();
  };
  s.jump = n => { s.measure(); s.target = n > 0 && s.chapters[n] ? s.clamp(s.chapters[n].offsetTop) : 0; s.current = s.target; s.lastY = -1; s.onFrame(); };
  s.setSection = n => {
    if (n === s.section) return;
    s.section = n;
    /* keep the address bar on the chapter (only on the site itself, not under /admin) */
    if (s.site && location.pathname === '/') history.replaceState(history.state, '', '#' + IDS[n]);
    s.onSection(n);
  };
  /* Once per frame: move the stack, soften the chapters leaving the screen, pick the one in the middle. */
  s.onFrame = () => {
    if (!s.site || !s.stack) return;
    const p = Math.min(1, Math.max(0, s.current / s.maxScroll));
    if (Math.abs(p - s.lastProgress) > 0.0004) { s.lastProgress = p; document.documentElement.style.setProperty('--scroll', p); }
    if (Math.abs(s.current - s.lastY) < 0.01) return;
    s.lastY = s.current;
    s.stack.style.transform = 'translate3d(0,' + (-s.current).toFixed(2) + 'px,0)';
    let nearest = 0, nearestD = Infinity;
    const mid = innerHeight / 2;
    s.chapters.forEach((c, i) => {
      if (!c) return;
      const top = c.offsetTop - s.current, bottom = top + c.offsetHeight;
      /* 0 while the middle of the screen is inside the chapter, ±1 a screen away */
      const d = top > mid ? (top - mid) / innerHeight : bottom < mid ? (bottom - mid) / innerHeight : 0;
      const a = Math.min(1, Math.abs(d));
      /* no tilt or shrink — text stays flat and readable; chapters only soften a little as they leave the screen */
      if (!s.reduceMotion && s.inners[i]) s.inners[i].style.opacity = (1 - a * 0.35).toFixed(3);
      if (a < nearestD) { nearestD = a; nearest = i; }
      c.classList.toggle('is-active', a < 0.62 || (c.classList.contains('is-active') && a < 0.9));
    });
    s.setSection(nearest);
  };
  /* called by the cinematic canvas every animation frame; returns the playhead 0…1 */
  s.tick = () => {
    s.current += (s.target - s.current) * 0.06;   /* a slow, floating glide */
    if (Math.abs(s.target - s.current) < 0.05) s.current = s.target;
    s.onFrame();
    return Math.min(1, Math.max(0, s.current / s.maxScroll));
  };
  return s;
}

/* the nearest element that scrolls on its own (a drawer list, a long card) keeps the wheel until it reaches its end */
export function scrollableAncestor(node) { while (node && node !== document.body) { if (node.nodeType === 1) { const oy = getComputedStyle(node).overflowY; if ((oy === 'auto' || oy === 'scroll') && node.scrollHeight > node.clientHeight + 2) return node; } node = node.parentNode; } return null; }
