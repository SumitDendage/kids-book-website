import { SLOGANS } from '../../data/content.js';

/* A ribbon of slogans drifting across the screen (styles/39-slogans.css). The list is drawn twice
   so the loop has no gap; screen readers hear it once. Reduced motion shows one still row. */
export function SloganRibbon({ items = SLOGANS, tone = 'sun', className = '' }) {
  const row = hidden => (
    <ul className="slogan-row" aria-hidden={hidden || undefined}>
      {items.map(s => <li key={s}><span className="slogan-star" aria-hidden="true">✦</span>{s}</li>)}
    </ul>
  );
  return (
    <div className={'slogan-ribbon slogan-' + tone + (className ? ' ' + className : '')} role="marquee" aria-label="Learn With Why in a few words">
      <div className="slogan-track">{row(false)}{row(true)}</div>
    </div>
  );
}

/* a hand-written sticker that pops in, tilted, and wobbles now and then */
export function Sticker({ children, tilt = -3, className = '' }) {
  return <span className={'sticker' + (className ? ' ' + className : '')} style={{ '--tilt': tilt + 'deg' }}>{children}</span>;
}
