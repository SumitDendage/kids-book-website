'use client';
import { MotionConfig } from 'motion/react';
import { StoreProvider } from '@/lib/store';

/* reducedMotion="user": Motion skips transform animations when the OS asks
   for reduced motion; the CSS reveals do the same via the media query. */
export default function Providers({ children }) {
  return (
    <MotionConfig reducedMotion="user">
      <StoreProvider>{children}</StoreProvider>
    </MotionConfig>
  );
}
