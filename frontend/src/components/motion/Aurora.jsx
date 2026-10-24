import { m, useMotionTemplate, useMotionValue, useReducedMotion, useSpring } from 'framer-motion';

/* A soft light that follows the pointer across a card, the way the newest landing pages do: a warm
   glow behind the writing, and the card's own edge lighting up on the side your mouse is on. Both
   are built from two motion values with useMotionTemplate, so they are written straight into the
   style as the mouse moves, without React re-rendering a single time. Mouse only, and off under
   reduced motion (styles/40-motion.css). */
export default function Aurora({ children, className = '', ...rest }) {
  const reduce = useReducedMotion();
  const mx = useMotionValue(50), my = useMotionValue(0), lit = useMotionValue(0);
  const x = useSpring(mx, { stiffness: 220, damping: 26 }), y = useSpring(my, { stiffness: 220, damping: 26 });
  const glow = useSpring(lit, { stiffness: 160, damping: 28 });
  const background = useMotionTemplate`radial-gradient(360px circle at ${x}% ${y}%, rgba(255, 226, 138, 0.85), rgba(255, 141, 198, 0.4) 40%, rgba(255, 255, 255, 0) 68%)`;
  /* the edge: the same circle, used as a mask over a bright ring, so only the near side glows */
  const mask = useMotionTemplate`radial-gradient(240px circle at ${x}% ${y}%, #000 0%, transparent 72%)`;
  const move = e => {
    if (reduce || e.pointerType !== 'mouse') return;
    const r = e.currentTarget.getBoundingClientRect();
    mx.set(((e.clientX - r.left) / r.width) * 100);
    my.set(((e.clientY - r.top) / r.height) * 100);
    lit.set(1);
  };
  return (
    <div className={'mo-aurora ' + className} onPointerMove={move} onPointerLeave={() => lit.set(0)} {...rest}>
      <m.span className="mo-aurora-glow" aria-hidden="true" style={{ background, opacity: glow }} />
      <m.span className="mo-aurora-edge" aria-hidden="true" style={{ maskImage: mask, WebkitMaskImage: mask, opacity: glow }} />
      {children}
    </div>
  );
}
