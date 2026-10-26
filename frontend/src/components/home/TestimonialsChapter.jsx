import Chapter from '../layout/Chapter.jsx';
import Rise from '../common/Rise.jsx';
import Testimonials from './Testimonials.jsx';
import Footer from '../layout/Footer.jsx';
import { useSite } from '../../context/SiteContext.jsx';
import { QUOTES } from '../../data/content.js';

/* 07 · Testimonials — a community of curious minds, and the footer. The star reviews customers post
   on the website have their own chapter just before this one (ReviewsChapter). */
export default function TestimonialsChapter() {
  const { section, openShop } = useSite();
  return (
    <Chapter index={6}>
      <Rise as="p" i={0} className="eyebrow" style={{ textAlign: 'center' }}>07 / A community of curious minds</Rise>
      <Rise as="h2" i={1} className="h2" style={{ textAlign: 'center' }}>Little moments. <em>Lovely words.</em></Rise>
      <Rise as="p" i={1} className="trust-line"><span className="trust-stars" aria-hidden="true">★★★★★</span><span><b id="qTotal">{QUOTES.length}</b> happy customers</span><span className="dot">·</span><span>parents, teachers &amp; schools</span><span className="dot">·</span><span>sent to us on WhatsApp &amp; Instagram</span></Rise>
      <Testimonials active={section === 6} />
      <Rise as="p" i={4} className="flow-more"><button type="button" className="arrow-link" onClick={() => openShop('all')}>A new adventure starts here <span aria-hidden="true">→</span></button></Rise>
      <Rise as="p" i={4} className="whisper" style={{ textAlign: 'center' }}>Read by parents. Tested by five-year-olds. Approved by one very picky fox.</Rise>
      <Footer />
    </Chapter>
  );
}
