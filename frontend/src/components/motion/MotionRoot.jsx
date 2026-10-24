import { LazyMotion, MotionConfig } from 'framer-motion';
import '../../styles/40-motion.css';

/* Framer Motion for the whole site. Only the small `m` elements are in the first download; the
   animation engine (features.js) follows as its own file once the page has loaded and the phone
   has a free moment (3 s at the latest), so it never competes with the first screen.
   `reducedMotion="user"`: anyone who asked their phone or computer for less motion gets fades
   only, no sliding, springing or tilting. */
const loadFeatures = () => new Promise(done => {
  const get = () => import('./features.js').then(r => done(r.default));
  const idle = () => (window.requestIdleCallback ? requestIdleCallback(get, { timeout: 3000 }) : setTimeout(get, 200));
  if (document.readyState === 'complete') idle(); else addEventListener('load', idle, { once: true });
});

export default function MotionRoot({ children }) {
  return (
    <LazyMotion features={loadFeatures} strict>
      <MotionConfig reducedMotion="user">{children}</MotionConfig>
    </LazyMotion>
  );
}
