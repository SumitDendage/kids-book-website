import Chapter from '../layout/Chapter.jsx';
import Rise from '../common/Rise.jsx';
import RevealWords from '../motion/RevealWords.jsx';
import { accessSpan } from '../../data/content.js';
import { getCoConfig } from '../../services/checkout.js';

/* 03 · What we do */
export default function WhatWeDoChapter() {
  /* how long a bought sheet stays open: the server's setting (GET /api/config), 24 hours until it answers */
  const cfg = getCoConfig() || {};
  return (
    <Chapter index={2}>
      <Rise as="p" i={0} className="eyebrow">03 / What we do</Rise>
      <Rise as="h2" i={1} className="h2"><RevealWords>We turn big ideas into <em>one calm page</em>.</RevealWords></Rise>
      <Rise as="p" i={2} className="lede">Learn With Why designs, tests and delivers printable sheets from Kindergarten to Class 3 — alphabet, numbers, colours, shapes, stories and handwriting — so practice at home feels like play.</Rise>
      <Rise i={3} className="trio">
        <div className="panel"><span className="mark" aria-hidden="true">✎</span><h3>We design</h3><p>Every sheet is drawn by hand around a single idea: one letter, one number, one shape. Generous white space, thick guide lines and letterforms small hands can copy.</p></div>
        <div className="panel"><span className="mark" aria-hidden="true">✓</span><h3>We test</h3><p>Early-years teachers try each page in real classrooms before it reaches the shelf. If a four-year-old gets stuck, we redraw it.</p></div>
        <div className="panel"><span className="mark" aria-hidden="true">⇩</span><h3>We deliver</h3><p>Unlock a sheet and it opens full screen in our protected viewer, with your name on every page. A bought sheet stays open for {accessSpan(cfg)} from the moment you pay, with a timer in My Worksheets.</p></div>
      </Rise>
      <Rise as="ul" i={4} className="ticks"><li>Sheets for daily five-minute practice, worksheets for week-by-week progress.</li><li>Ink-friendly, black-and-white friendly, tablet friendly.</li><li>Free sheets to try first: open them straight away, no sign-in needed.</li></Rise>
      <Rise as="p" i={5} className="whisper">One idea per page. One giggle per sheet. No clip art was harmed.</Rise>
    </Chapter>
  );
}
