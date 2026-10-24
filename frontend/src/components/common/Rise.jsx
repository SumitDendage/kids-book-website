import { useRef } from 'react';
import { m, useInView } from 'framer-motion';
import { useSite } from '../../context/SiteContext.jsx';
import { RISE } from '../motion/presets.js';

/* The chapters' staggered entrance: each line floats up on a soft spring, in order (`i`), when it
   comes into view once the opening veil has lifted, and again every time you come back to it. */
export default function Rise({ as: Tag = 'div', i = 0, className = '', style, children, ...rest }) {
  const ref = useRef(null);
  const { siteStage } = useSite();
  const inView = useInView(ref);
  const M = m[Tag];
  return (
    <M
      ref={ref} className={'rise-m' + (className ? ' ' + className : '')} style={{ '--i': i, ...style }}
      custom={i} variants={RISE} initial="hide" animate={siteStage === 'site' && inView ? 'show' : 'hide'}
      {...rest}
    >
      {children}
    </M>
  );
}
