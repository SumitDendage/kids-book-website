/* Shared motion vocabulary. Every React transition on the site uses one of
   these springs; the CSS reveals use the matching tokens in styles/index.css
   (--ease, --d-*), so class-driven and Motion-driven movement feel the same. */

export const springs = {
  ui: { type: 'spring', stiffness: 260, damping: 28, mass: 0.9 },     /* drawers, toast, carousel */
  micro: { type: 'spring', stiffness: 480, damping: 30 },             /* badges, button labels */
};

/* useSpring configs (motion values, no `type` key) */
export const follow = {
  magnet: { stiffness: 180, damping: 18, mass: 0.4 },
  tilt: { stiffness: 220, damping: 22, mass: 0.5 },
};

/* Parent/child variants: `hide` → `show` with a stagger. */
export const fadeUp = {
  hide: { opacity: 0, y: 14 },
  show: { opacity: 1, y: 0, transition: springs.ui },
};
export const staggered = (gap = 0.045, start = 0.12) => ({
  hide: {},
  show: { transition: { staggerChildren: gap, delayChildren: start } },
});
