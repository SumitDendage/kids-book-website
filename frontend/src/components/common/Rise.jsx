import { useEffect, useRef } from 'react';
import { spring, useInView } from 'framer-motion';
import { animate } from 'framer-motion/dom/mini';
import { useSite } from '../../context/SiteContext.jsx';

/* The chapters' staggered entrance: each line floats up on a soft spring, in order (`i`), when it
   comes into view once the opening veil has lifted, and again every time you come back to it.
   There are dozens of these, so they use Framer Motion's small animate() (the browser's own
   animation engine, off the main thread) instead of a full motion element each. */
const HIDDEN = 'translateY(28px) scale(0.985)';
const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export default function Rise({ as: Tag = 'div', i = 0, className = '', style, children, ...rest }) {
  const ref = useRef(null);
  const { siteStage } = useSite();
  const inView = useInView(ref);
  const show = siteStage === 'site' && inView;
  const first = useRef(true);
  useEffect(() => {
    const el = ref.current;
    if (!el || (first.current && !show)) return;
    first.current = false;
    const still = reduced();
    const a = show
      ? animate(el, { opacity: 1, transform: 'none' }, still ? { duration: 0.4 } : { type: spring, stiffness: 120, damping: 18, mass: 0.9, delay: 0.14 + i * 0.09 })
      : animate(el, { opacity: 0, transform: still ? 'none' : HIDDEN }, { duration: 0.25 });
    return () => a.stop();
  }, [show, i]);
  return (
    <Tag ref={ref} className={'rise-m' + (className ? ' ' + className : '')} style={{ '--i': i, opacity: 0, transform: reduced() ? 'none' : HIDDEN, ...style }} {...rest}>
      {children}
    </Tag>
  );
}
