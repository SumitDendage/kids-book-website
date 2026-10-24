/* The springs and moves every animation on the site shares, so they all feel like one storybook. */

/* soft and floaty: chapters, cards, tiles */
export const SPRING = { type: 'spring', stiffness: 120, damping: 18, mass: 0.9 };
/* quick and bouncy: hover, tap, the nav pill */
export const SNAPPY = { type: 'spring', stiffness: 380, damping: 26 };
/* panels sliding over the page: drawers, the chat, the sheet window */
export const PANEL = { type: 'spring', stiffness: 260, damping: 30, mass: 0.9 };

/* a chapter's lines float up one after another (Rise.jsx); `i` is the line's place in the chapter */
export const RISE = {
  hide: { opacity: 0, y: 28, scale: 0.985, transition: { duration: 0.25 } },
  show: i => ({ opacity: 1, y: 0, scale: 1, transition: { ...SPRING, delay: 0.14 + i * 0.09 } }),
};

/* a card or tile pops up the first time it scrolls into view; `n` is its place in the grid */
export const CARD_IN = {
  hide: { opacity: 0, y: 22, scale: 0.94 },
  show: n => ({ opacity: 1, y: 0, scale: 1, transition: { ...SPRING, delay: Math.min(n, 14) * 0.045 } }),
};
export const CARD_HOVER = { y: -7, scale: 1.025, transition: SNAPPY };
export const CARD_TAP = { scale: 0.97, transition: SNAPPY };

/* a menu's links slide in one after another when it opens */
export const LIST = { open: { transition: { staggerChildren: 0.05, delayChildren: 0.12 } }, closed: {} };
export const LIST_ITEM = { open: { opacity: 1, x: 0, transition: SPRING }, closed: { opacity: 0, x: 26, transition: { duration: 0.15 } } };
