import { Link } from 'react-router-dom';
import Rise from '../common/Rise.jsx';
import { NAV, IDS, INBOX, WHATSAPP, INSTAGRAM } from '../../data/content.js';
import { WhatsAppIcon, InstagramIcon } from '../common/SocialIcons.jsx';
import { useSite } from '../../context/SiteContext.jsx';

/* the footer at the end of the last chapter: chapter links, copyright with the email and the
   WhatsApp and Instagram buttons (Sumit, Oct 7), staff links */
export default function Footer() {
  const { goTo } = useSite();
  return (
    <Rise as="footer" i={5} className="site-foot">
      <nav aria-label="Footer">{NAV.map((l, i) => <a key={IDS[i]} href={'#' + IDS[i]} onClick={e => { e.preventDefault(); goTo(i); }}>{l}</a>)}<a href="/kindergarten-worksheets/">All Kindergarten worksheets</a></nav>
      <div>© <span id="year">{new Date().getFullYear()}</span> Learn With Why · All rights reserved · <a href={'mailto:' + INBOX}>{INBOX}</a><span className="foot-social"><a className="wa-link" href={WHATSAPP} target="_blank" rel="noopener noreferrer" aria-label="Chat with us on WhatsApp" title="Chat with us on WhatsApp"><WhatsAppIcon /></a><a className="ig-link" href={INSTAGRAM} target="_blank" rel="noopener noreferrer" aria-label="Follow us on Instagram" title="Follow us on Instagram"><InstagramIcon /></a></span></div>
      <div className="staff-links"><Link to="/admin">Admin account</Link><Link to="/developer">Developer</Link></div>
    </Rise>
  );
}
