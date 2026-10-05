import LogoTile from '../common/LogoTile.jsx';

/* the opening veil: shown until the first landscape frame is painted (at least 1.8 s) */
export default function Veil({ gone, slow }) {
  return (
    <div id="veil" className={gone ? 'gone' : ''} aria-hidden={gone ? 'true' : undefined}>
      <div className="veil-inner">
        <LogoTile />
        <div className="veil-word">Learn<small>with why</small></div>
        <div className="veil-line"><i /></div>
        <p className="veil-note" id="veilNote">{slow ? 'Still opening — the frames are large' : 'Opening the forest'}</p>
      </div>
    </div>
  );
}
