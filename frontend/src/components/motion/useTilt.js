import { useMotionValue, useReducedMotion, useSpring } from 'framer-motion';

/* A card leans gently towards the mouse, like a picture card held in the hand, and a soft light
   follows the pointer across it (--mx / --my feed .mo-glare in 40-motion.css). Mouse only: on a
   phone a finger would just tilt the card it is trying to tap. Nothing re-renders while it moves. */
export default function useTilt(max = 6) {
  const reduce = useReducedMotion();
  const rx = useMotionValue(0), ry = useMotionValue(0);
  const rotateX = useSpring(rx, { stiffness: 200, damping: 18 }), rotateY = useSpring(ry, { stiffness: 200, damping: 18 });
  const onPointerMove = e => {
    if (reduce || e.pointerType !== 'mouse') return;
    const r = e.currentTarget.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height;
    ry.set((px - 0.5) * 2 * max); rx.set((0.5 - py) * 2 * max);
    e.currentTarget.style.setProperty('--mx', (px * 100).toFixed(1) + '%');
    e.currentTarget.style.setProperty('--my', (py * 100).toFixed(1) + '%');
  };
  const onPointerLeave = () => { rx.set(0); ry.set(0); };
  return { style: { rotateX, rotateY, transformPerspective: 900 }, onPointerMove, onPointerLeave };
}
