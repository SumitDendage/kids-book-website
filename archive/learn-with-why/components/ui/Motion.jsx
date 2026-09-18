'use client';
import { Fragment, useEffect, useRef, useState } from 'react';
import { motion, useInView, useReducedMotion, useSpring } from 'motion/react';
import { follow, springs } from '@/lib/motion';

/* ---------- Reveal: fade-up when it scrolls into view ---------- */
export function Reveal({ as = 'div', children, className, delay = 0, y = 22, once = true, ...rest }) {
  const Comp = motion[as];
  return (
    <Comp
      className={className}
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once, margin: '0px 0px -12% 0px' }}
      transition={{ ...springs.ui, delay }}
      {...rest}
    >
      {children}
    </Comp>
  );
}

/* ---------- SplitWords: word-by-word headline reveal ---------- */
export function SplitWords({ as: Tag = 'span', text, className, delay, style, once = true, ...rest }) {
  const ref = useRef(null);
  const inView = useInView(ref, { once, margin: '0px 0px -10% 0px' });
  const words = text.split(' ');
  return (
    <Tag ref={ref} className={'split' + (inView ? ' in' : '') + (className ? ' ' + className : '')} style={delay != null ? { ...style, '--delay': delay + 'ms' } : style} aria-label={text} {...rest}>
      {words.map((w, i) => (
        <Fragment key={i}>
          <span className="w" style={{ '--i': i }} aria-hidden="true"><span>{w}</span></span>
          {i < words.length - 1 ? ' ' : null}
        </Fragment>
      ))}
    </Tag>
  );
}

/* ---------- Magnetic: a CTA that leans toward the pointer ---------- */
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

/* ---------- Tilt: a card that tilts toward the pointer with a spotlight ---------- */
export function Tilt({ as = 'div', className, children, max = 6, style, ...rest }) {
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
    <Comp ref={ref} className={className} style={{ ...style, rotateX, rotateY, transformPerspective: 900 }} whileHover={reduce ? undefined : { y: -4 }} onPointerMove={move} onPointerLeave={leave} {...rest}>
      {children}
    </Comp>
  );
}

/* ---------- CountUp: a number that counts in when seen ---------- */
export function CountUp({ value, duration = 1.2 }) {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true });
  const reduce = useReducedMotion();
  const [txt, setTxt] = useState(value);
  useEffect(() => {
    const m = String(value).match(/^([\d,.]+)(.*)$/);
    if (!inView || reduce || !m) { setTxt(value); return undefined; }
    const target = parseFloat(m[1].replace(/,/g, '')), suffix = m[2], decimals = (m[1].split('.')[1] || '').length;
    const t0 = performance.now();
    let raf = 0;
    const tick = now => {
      const p = Math.min(1, (now - t0) / (duration * 1000));
      const eased = 1 - Math.pow(1 - p, 3);
      const n = target * eased;
      setTxt((decimals ? n.toFixed(decimals) : Math.round(n).toLocaleString('en-IN')) + suffix);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [inView, value, duration, reduce]);
  return <span ref={ref}>{txt}</span>;
}
