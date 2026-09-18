import { BRAND, FOOTER, NAV } from '../../content';

/* Compact footer that closes the last chapter; reveals as its final `.rise`. */
export default function Footer({ onGo }) {
  return (
    <footer className="site-footer">
      <button type="button" className="nav-brand" onClick={() => onGo(0)}><span className="mark" aria-hidden="true" />{BRAND.name}</button>
      <nav aria-label="Footer">
        {NAV.map((label, i) => <button key={label} type="button" onClick={() => onGo(i)}>{label}</button>)}
      </nav>
      <div className="fine">
        <span>{FOOTER.tagline}</span>
        <span>© {new Date().getFullYear()} {BRAND.name} · <a href={FOOTER.href}>{FOOTER.email}</a></span>
      </div>
    </footer>
  );
}
