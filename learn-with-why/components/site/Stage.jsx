'use client';
import { useRef } from 'react';
import { motion, useScroll, useTransform } from 'motion/react';
import { HERO } from '@/lib/content';
import { springs } from '@/lib/motion';
import FrameScene from './FrameScene';
import Sheets from './Sheets';
import Logo from '@/components/ui/Logo';
import { CountUp, Magnetic, SplitWords } from '@/components/ui/Motion';

/* The first screens of the site share one pinned canvas: the hero sits on
   frame 1, then the catalogue scrolls over the frames as they play. Every
   surface on top is translucent so the fox and rabbit stay in view. */
export default function Stage() {
  const ref = useRef(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end end'] });
  const heroY = useTransform(scrollYProgress, [0, 0.18], [0, -80]);
  const heroOpacity = useTransform(scrollYProgress, [0, 0.14], [1, 0]);
  const logoY = useTransform(scrollYProgress, [0, 0.18], [0, -140]);

  return (
    <section className="stage" ref={ref}>
      <div className="stage-sticky">
        <FrameScene targetRef={ref} />
        <div className="scrim" />
      </div>
      <div className="stage-content">
        <div className="hero" id="home">
          <div className="container hero-grid">
            <motion.div style={{ y: heroY, opacity: heroOpacity }}>
              <motion.div className="badge" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ ...springs.ui, delay: 0.4 }}>{HERO.badge}</motion.div>
              <SplitWords as="h1" className="display" text={HERO.title} delay={500} />
              <motion.p className="lede" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ ...springs.ui, delay: 0.9 }}>{HERO.lede}</motion.p>
              <motion.div className="btn-row" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ ...springs.ui, delay: 1.05 }}>
                <Magnetic><a className="btn btn-primary" href="#sheets">{HERO.primary}</a></Magnetic>
                <Magnetic><a className="btn btn-ghost" href="#about">{HERO.secondary}</a></Magnetic>
              </motion.div>
              <motion.div className="stats" style={{ marginTop: 36, maxWidth: 560 }} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ ...springs.ui, delay: 1.2 }}>
                {HERO.stats.map(s => <div className="stat" key={s.label}><b><CountUp value={s.value} /></b><span>{s.label}</span></div>)}
              </motion.div>
            </motion.div>
            <motion.div className="hero-art" style={{ y: logoY, opacity: heroOpacity }} initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ ...springs.ui, delay: 0.6 }}>
              <Logo className="logo-big" color="var(--fg)" />
              {[['×', '8%', '18%', 0], ['+', '82%', '12%', 1.1], ['A', '4%', '70%', 2.2], ['÷', '86%', '68%', 0.6], ['B', '50%', '-4%', 1.7]].map(([t, l, tp, d]) => (
                <motion.span key={t} className="floater" style={{ left: l, top: tp }} animate={{ y: [0, -10, 0], rotate: [0, 6, 0] }} transition={{ duration: 5 + d, repeat: Infinity, ease: 'easeInOut', delay: d }}>{t}</motion.span>
              ))}
            </motion.div>
          </div>
          <motion.div className="hint" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 2 }} style={{ opacity: heroOpacity }}><i />Scroll to open the book</motion.div>
        </div>
        <Sheets />
      </div>
    </section>
  );
}
