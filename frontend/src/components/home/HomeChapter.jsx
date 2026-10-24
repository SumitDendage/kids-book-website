import Chapter from '../layout/Chapter.jsx';
import Rise from '../common/Rise.jsx';
import WhyLine from './WhyLine.jsx';
import AuthCard from './AuthCard.jsx';
import { AnimatedHtml, AnimatedLetters, AnimatedWords } from './AnimatedText.jsx';
import Magnetic from '../motion/Magnetic.jsx';
import { useSite } from '../../context/SiteContext.jsx';
import { HERO } from '../../data/content.js';

/* 01 · Landing — the headline, today's why, and the sign-up / sign-in card.
   The words move in one after another (AnimatedText.jsx, styles/31-landing-text.css). */
export default function HomeChapter() {
  const { content, whys, goTo } = useSite();
  return (
    <Chapter index={0}>
      <div className="start-grid">
        <div>
          <Rise as="p" i={0} className="eyebrow hero-eyebrow"><AnimatedLetters text={content.badge || HERO.badge} /></Rise>
          {/* the admin's Content section may set this headline, HTML allowed (e.g. <em>why</em>) */}
          <Rise as="h1" i={1} className="display hero-title"><AnimatedHtml html={content.heroTitle || HERO.titleHtml} /></Rise>
          <Rise as="p" i={2} className="lede hero-lede"><AnimatedWords text={content.heroLede || HERO.lede} /></Rise>
          <Rise as="p" i={3} className="why-line" aria-live="polite"><span>Today&apos;s why:</span> <WhyLine whys={whys} /></Rise>
          <Rise i={4} className="hero-peek"><Magnetic className="arrow-link" onClick={() => goTo(3)}>Take a peek at the collection <span aria-hidden="true">→</span></Magnetic></Rise>
        </div>
        <AuthCard />
      </div>
    </Chapter>
  );
}
