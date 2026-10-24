import { m } from 'framer-motion';
import useTilt from './useTilt.js';
import { CARD_HOVER, CARD_IN, CARD_TAP } from './presets.js';

/* Every sheet card and tile on the site: it pops up when it first scrolls into view, lifts and
   leans towards the mouse, catches a little light, and squeezes when tapped.
   `as` is the element (article or button), `n` its place in the grid. */
export default function MotionCard({ as = 'article', n = 0, className = '', style, children, ...rest }) {
  const tilt = useTilt();
  const M = m[as];
  return (
    <M
      className={'mo-card ' + className} style={{ ...style, ...tilt.style }} custom={n} variants={CARD_IN}
      initial="hide" whileInView="show" viewport={{ once: true, amount: 0.15 }}
      whileHover={CARD_HOVER} whileTap={CARD_TAP}
      onPointerMove={tilt.onPointerMove} onPointerLeave={tilt.onPointerLeave}
      {...rest}
    >
      {children}
      <span className="mo-glare" aria-hidden="true" />
    </M>
  );
}
