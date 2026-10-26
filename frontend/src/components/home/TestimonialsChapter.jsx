import Chapter from '../layout/Chapter.jsx';
import Rise from '../common/Rise.jsx';
import Testimonials from './Testimonials.jsx';
import Footer from '../layout/Footer.jsx';
import { useEffect, useState } from 'react';
import { useSite } from '../../context/SiteContext.jsx';
import { QUOTES } from '../../data/content.js';
import { fetchReviews } from '../../services/api.js';
import { StarRow } from '../reviews/Stars.jsx';

/* the customer reviews posted on the website (published in Admin → Homepage → Reviews), shown
   first in the coverflow; the notes customers sent on WhatsApp and Instagram follow them */
const asQuote = r => ({ text: r.body || r.title, who: r.name, meta: r.worksheetTitle || 'Learn With Why sheet', initials: String(r.name || '').replace(/[^A-Za-zÀ-ÿ]/g, '').slice(0, 2) || '★', rating: r.rating, live: true });

/* 06 · Testimonials — a community of curious minds, and the footer */
export default function TestimonialsChapter() {
  const { section, openShop, openReview } = useSite();
  const [rv, setRv] = useState(null);
  /* asked once the reader is one chapter away, so the first screen does not wait for it */
  const near = section >= 4;
  useEffect(() => {
    if (!near || rv) return;
    let live = true;
    fetchReviews(12).then(r => { if (live) setRv(r); }).catch(() => { if (live) setRv({ count: 0, reviews: [] }); });
    return () => { live = false; };
  }, [near, rv]);
  const posted = ((rv && rv.reviews) || []).filter(r => r.body || r.title).map(asQuote);
  const quotes = posted.concat(QUOTES);
  const count = (rv && Number(rv.count)) || 0;
  return (
    <Chapter index={5}>
      <Rise as="p" i={0} className="eyebrow" style={{ textAlign: 'center' }}>06 / A community of curious minds</Rise>
      <Rise as="h2" i={1} className="h2" style={{ textAlign: 'center' }}>Little moments. <em>Lovely words.</em></Rise>
      {count && rv.avg != null
        ? <Rise as="p" i={1} className="trust-line"><StarRow value={Number(rv.avg)} className="trust-rating" /><span><b>{Number(rv.avg).toFixed(1)}</b> from <b id="qTotal">{count}</b> {count === 1 ? 'review' : 'reviews'} on our sheets</span><span className="dot">·</span><span>plus {QUOTES.length} notes on WhatsApp &amp; Instagram</span></Rise>
        : <Rise as="p" i={1} className="trust-line"><span className="trust-stars" aria-hidden="true">★★★★★</span><span><b id="qTotal">{QUOTES.length}</b> happy customers</span><span className="dot">·</span><span>parents, teachers &amp; schools</span><span className="dot">·</span><span>sent to us on WhatsApp &amp; Instagram</span></Rise>}
      <Testimonials active={section === 5} quotes={quotes} onWrite={openReview} />
      <Rise as="p" i={4} className="flow-more"><button type="button" className="arrow-link" onClick={() => openShop('all')}>A new adventure starts here <span aria-hidden="true">→</span></button></Rise>
      <Rise as="p" i={4} className="whisper" style={{ textAlign: 'center' }}>Read by parents. Tested by five-year-olds. Approved by one very picky fox.</Rise>
      <Footer />
    </Chapter>
  );
}
