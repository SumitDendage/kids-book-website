import { Fragment, useRef } from 'react';
import { motion, useReducedMotion, useSpring } from 'motion/react';
import { follow } from '../../lib/motion';

/* Three small primitives reused across the site.
   - SplitWords: word-by-word headline reveal (CSS-driven, see `.split`)
   - Magnetic:   a CTA that leans toward the pointer
   - Tilt:       a card that tilts toward the pointer with a spotlight
   All of them move transform-only and go still under prefers-reduced-motion. */

export function SplitWords({ as: Tag = 'span', text, className, delay, style, ...rest }) {
  const words = text.split(' ');
  return (
    <Tag className={'split' + (className ? ' ' + className : '')} style={delay != null ? { ...style, '--delay': delay + 'ms' } : style} aria-label={text} {...rest}>
      {words.map((w, i) => (
        <Fragment key={i}>
          <span className="w" style={{ '--i': i }} aria-hidden="true"><span>{w}</span></span>
          {i < words.length - 1 ? ' ' : null}
        </Fragment>
      ))}
    </Tag>
  );
}

export function Magnetic({ children, strength = 0.3, className }) {
  const reduce = useReducedMotion();
  const ref = useRef(null);
  const x = useSpring(0, follow.magnet);
  const y = useSpring(0, follow.magnet);

  function move(e) {
    if (reduce || e.pointerType === 'touch') return;
    const r = ref.current.getBoundingClientRect();
    x.set((e.clientX - r.left - r.width / 2) * strength);
    y.set((e.clientY - r.top - r.height / 2) * strength);
  }
  function leave() { x.set(0); y.set(0); }

  return (
    <motion.span ref={ref} className={'magnet' + (className ? ' ' + className : '')} style={{ x, y }} onPointerMove={move} onPointerLeave={leave}>
      {children}
    </motion.span>
  );
}

export function Tilt({ as = 'div', className, children, max = 6, ...rest }) {
  const reduce = useReducedMotion();
  const ref = useRef(null);
  const rotateX = useSpring(0, follow.tilt);
  const rotateY = useSpring(0, follow.tilt);
  const Comp = motion[as];

  function move(e) {
    if (reduce || e.pointerType === 'touch') return;
    const r = ref.current.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height;
    rotateY.set((px - 0.5) * 2 * max);
    rotateX.set((0.5 - py) * 2 * max);
    ref.current.style.setProperty('--mx', px * 100 + '%');
    ref.current.style.setProperty('--my', py * 100 + '%');
  }
  function leave() { rotateX.set(0); rotateY.set(0); }

  return (
    <Comp
      ref={ref}
      className={className}
      style={{ rotateX, rotateY, transformPerspective: 900 }}
      whileHover={reduce ? undefined : { y: -4 }}
      onPointerMove={move}
      onPointerLeave={leave}
      {...rest}
    >
      {children}
    </Comp>
  );
}
