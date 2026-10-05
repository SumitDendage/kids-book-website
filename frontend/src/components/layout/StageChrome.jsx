import { NAV } from '../../data/content.js';
import { useSite } from '../../context/SiteContext.jsx';

/* the fixed bits around the stage: soft edge bands, chapter counter, brand line, scroll hint, progress bar */
export default function StageChrome() {
  const { section, hintHidden, goTo } = useSite();
  const hint = hintHidden ? { opacity: 0, transform: 'translate(-50%, 10px)', pointerEvents: 'none' } : undefined;
  return (
    <>
      <div className="edge-scrim top" aria-hidden="true" /><div className="edge-scrim bottom" aria-hidden="true" />
      <div className="counter" id="counter"><b>{String(section + 1).padStart(2, '0')}</b> / {NAV[section]}</div>
      <div className="brandline">Learn With Why</div>
      <button type="button" className="hint" id="hint" style={hint} tabIndex={hintHidden ? -1 : 0} onClick={() => goTo(section + 1)}>Scroll to discover <i>↓</i></button>
      <div className="progress" aria-hidden="true"><i /></div>
    </>
  );
}
