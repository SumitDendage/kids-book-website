import Chapter from '../layout/Chapter.jsx';
import Rise from '../common/Rise.jsx';
import WhyLine from './WhyLine.jsx';
import AuthCard from './AuthCard.jsx';
import { useSite } from '../../context/SiteContext.jsx';
import { HERO } from '../../data/content.js';

const DEFAULT_TITLE = <>Every great adventure begins with <em>why</em>.</>;

/* 01 · Landing — the headline, today's why, and the sign-up / sign-in card */
export default function HomeChapter() {
  const { content, whys, goTo } = useSite();
  return (
    <Chapter index={0}>
      <div className="start-grid">
        <div>
          <Rise as="p" i={0} className="eyebrow">{content.badge || HERO.badge}</Rise>
          {/* the admin's Content section may set this headline, HTML allowed (e.g. <em>why</em>) */}
          {content.heroTitle
            ? <Rise as="h1" i={1} className="display" dangerouslySetInnerHTML={{ __html: content.heroTitle }} />
            : <Rise as="h1" i={1} className="display">{DEFAULT_TITLE}</Rise>}
          <Rise as="p" i={2} className="lede">{content.heroLede || HERO.lede}</Rise>
          <Rise as="p" i={3} className="why-line" aria-live="polite"><span>Today&apos;s why:</span> <WhyLine whys={whys} /></Rise>
          <Rise i={4}><button type="button" className="arrow-link" onClick={() => goTo(3)}>Take a peek at the collection <span aria-hidden="true">→</span></button></Rise>
        </div>
        <AuthCard />
      </div>
    </Chapter>
  );
}
