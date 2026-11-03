import { m, useMotionValue, useReducedMotion, useSpring, useTransform } from 'framer-motion';

/* A magnetic button: as the mouse comes near, the button leans towards it and springs back when
   it leaves — the small touch that makes a Framer site feel expensive. Mouse only (a finger is
   already on the button), and still for anyone who asked for less motion. */
export default function Magnetic({ as = 'button', pull = 0.3, className = '', children, ...rest }) {
  /* a bare <button> inside a form would submit it, so say what it is unless the caller did */
  const kind = as === 'button' && rest.type === undefined ? 'button' : rest.type;
  const reduce = useReducedMotion();
  const mx = useMotionValue(0), my = useMotionValue(0);
  const x = useSpring(mx, { stiffness: 260, damping: 18 }), y = useSpring(my, { stiffness: 260, damping: 18 });
  /* the words inside lean a little further than the button itself, so it feels soft rather than stiff */
  const tx = useTransform(x, v => v * 0.35), ty = useTransform(y, v => v * 0.35);
  const M = m[as];
  const move = e => {
    if (reduce || e.pointerType !== 'mouse') return;
    const r = e.currentTarget.getBoundingClientRect();
    mx.set((e.clientX - (r.left + r.width / 2)) * pull);
    my.set((e.clientY - (r.top + r.height / 2)) * pull);
  };
  const reset = () => { mx.set(0); my.set(0); };
  return (
    <M className={'mo-magnet' + (className ? ' ' + className : '')} style={{ x, y }}
      onPointerMove={move} onPointerLeave={reset} onBlur={reset} whileTap={{ scale: 0.96 }} {...rest} type={kind}>
      <m.span className="mo-magnet-in" style={{ x: tx, y: ty }}>{children}</m.span>
    </M>
  );
}
