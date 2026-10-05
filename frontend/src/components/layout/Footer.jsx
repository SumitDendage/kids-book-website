import { Link } from 'react-router-dom';
import Rise from '../common/Rise.jsx';
import { NAV, IDS, INBOX } from '../../data/content.js';
import { useSite } from '../../context/SiteContext.jsx';

/* the footer at the end of the last chapter: chapter links, copyright, staff links */
export default function Footer() {
  const { goTo } = useSite();
  return (
    <Rise as="footer" i={5} className="site-foot">
      <div><b>Learn With Why</b> · printable worksheets for Kindergarten to Class 3 · Pune, India</div>
      <nav aria-label="Footer">{NAV.map((l, i) => <a key={IDS[i]} href={'#' + IDS[i]} onClick={e => { e.preventDefault(); goTo(i); }}>{l}</a>)}</nav>
      <div>© <span id="year">{new Date().getFullYear()}</span> Learn With Why · All rights reserved · <a href={'mailto:' + INBOX}>{INBOX}</a></div>
      <div className="staff-links"><Link to="/admin">Admin account</Link><Link to="/developer">Developer</Link></div>
    </Rise>
  );
}
