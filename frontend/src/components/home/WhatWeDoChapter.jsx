import Chapter from '../layout/Chapter.jsx';
import Rise from '../common/Rise.jsx';
import { accessSpan } from '../../data/content.js';
import { getCoConfig } from '../../services/checkout.js';

/* 03 · What we do */
export default function WhatWeDoChapter() {
  /* how long a bought sheet stays open: the server's setting (GET /api/config), 24 hours until it answers */
  const cfg = getCoConfig() || {};
  return (
    <Chapter index={2}>
      <Rise as="p" i={0} className="eyebrow">03 / What we do</Rise>
      <Rise as="h2" i={1} className="h2">Make learning feel like <em>an adventure</em>.</Rise>
      <Rise as="p" i={2} className="lede">Discover printable worksheets and early-learning activities for Kindergarten to Class 3. From alphabet tracing and phonics to numbers, shapes and handwriting, give curious children a fun, focused way to practise new skills at home or in the classroom.</Rise>
      <Rise i={3} className="trio">
        <div className="panel"><span className="mark" aria-hidden="true">✎</span><h3>Easy to explore</h3><p>Find activities by class and subject, with clear layouts that help children focus on one skill at a time.</p></div>
        <div className="panel"><span className="mark" aria-hidden="true">✓</span><h3>Fun to practise</h3><p>Build early reading, writing and number confidence through playful exercises that fit into a busy family or classroom day.</p></div>
        <div className="panel"><span className="mark" aria-hidden="true">⇩</span><h3>Simple to access</h3><p>Unlock a sheet and it opens full screen in our protected viewer, with your name on every page. A bought sheet stays open for {accessSpan(cfg)} from the moment you pay, with a timer in My Worksheets.</p></div>
      </Rise>
      <Rise as="ul" i={4} className="ticks"><li>Short activities for everyday practice and worksheets to revisit growing skills.</li><li>Clear, printer-friendly activities with engaging topics for young learners.</li><li>Explore available free worksheets before choosing more activities.</li></Rise>
      <Rise as="p" i={5} className="whisper">A little practice today. A big reason to smile tomorrow.</Rise>
    </Chapter>
  );
}
