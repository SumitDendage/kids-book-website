import { LazyMotion, MotionConfig } from 'framer-motion';
import '../../styles/40-motion.css';

/* Framer Motion for the whole site. Only the small `m` elements are in the first download; the
   animation engine (features.js) follows as its own file. `reducedMotion="user"`: anyone who asked
   their phone or computer for less motion gets fades only, no sliding, springing or tilting. */
const loadFeatures = () => import('./features.js').then(r => r.default);

export default function MotionRoot({ children }) {
  return (
    <LazyMotion features={loadFeatures} strict>
      <MotionConfig reducedMotion="user">{children}</MotionConfig>
    </LazyMotion>
  );
}
