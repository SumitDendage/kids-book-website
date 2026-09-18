'use client';
import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { UI } from '@/lib/content';
import Logo from '@/components/ui/Logo';

/* Opening veil: the tree draws itself on, then the curtain lifts once the
   first frame of the forest is ready (and never before 1.9s). Shows once
   per session so navigating back and forth stays quick. */
const MIN_MS = 1900;
const MAX_MS = 6000;

export default function Loader() {
  const [show, setShow] = useState(true);
  const [quick, setQuick] = useState(false);   /* already seen this session: no curtain */
  useEffect(() => {
    let booted = false;
    try { booted = !!sessionStorage.getItem('lww_booted'); } catch (_) { /* ignore */ }
    if (booted) { setQuick(true); setShow(false); return undefined; }
    const started = Date.now();
    const img = new Image();
    let ready = false;
    img.onload = img.onerror = () => { ready = true; };
    img.src = '/frames/frame_001.jpg';
    const t = setInterval(() => {
      const elapsed = Date.now() - started;
      if ((ready && elapsed >= MIN_MS) || elapsed >= MAX_MS) {
        clearInterval(t);
        try { sessionStorage.setItem('lww_booted', '1'); } catch (_) { /* ignore */ }
        setShow(false);
      }
    }, 100);
    return () => clearInterval(t);
  }, []);
  return (
    <AnimatePresence>
      {show && (
        <motion.div className="loader" key="loader" exit={{ y: '-100%', transition: { duration: quick ? 0 : 0.85, ease: [0.65, 0, 0.35, 1] } }}>
          <div className="loader-inner">
            <Logo draw color="var(--fg)" />
            <motion.p className="loader-note" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.6 }}>{UI.loading}</motion.p>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
