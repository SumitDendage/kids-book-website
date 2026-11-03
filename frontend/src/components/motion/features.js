/* The part of Framer Motion that actually moves things (springs, hover, in-view, shared layout).
   MotionRoot downloads it on its own, after the page has started, so the first screen never waits for it. */
export { domMax as default } from 'framer-motion';
