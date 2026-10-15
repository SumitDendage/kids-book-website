import { useEffect, useRef, useState } from 'react';
import { useSite } from '../../context/SiteContext.jsx';
import usePreviewPlayer from '../../hooks/usePreviewPlayer.js';
import { PLAYER_IDS, sheetOf } from '../../data/catalogue.js';
import { classById } from '../../data/content.js';
import Rise from '../common/Rise.jsx';
import { sheetState } from './sheetAccess.js';
import { priceLine } from './SheetCard.jsx';

/* The fox and rabbit preview (50 frames, 14 fps) with the sheet carousel on top.
   It plays only while the Sheets chapter is in view. */
export default function PreviewPlayer({ active }) {
  const { access, openViewer, unlock, buy, buyAgain, openShop } = useSite();
  const canvasRef = useRef(null);
  const [paused, setPaused] = useState(false);
  const [slide, setSlide] = useState(0);
  /* coming back to the chapter always plays again */
  useEffect(() => { if (active) setPaused(false); }, [active]);
  usePreviewPlayer(canvasRef, 14, active && !paused);

  const SHEETS = PLAYER_IDS.map(sheetOf).filter(Boolean);
  const s = SHEETS[slide % SHEETS.length], st = sheetState(access, s);
  const go = d => setSlide(n => (n + d + SHEETS.length) % SHEETS.length);
  return (
    <Rise i={1} className="player">
      <canvas id="preview" ref={canvasRef} aria-label="A fox and a rabbit studying together — preview animation" />
      <div className="shade" />
      <div className="player-copy">
        <p className="eyebrow">Print. Play. Ask why.</p>
        <h3 className="h2">Make room for a little discovery.</h3>
        <p>Thoughtful activities.<br />Happy little learners.<br /><em>Small hands, big questions.</em></p>
        <button type="button" className="btn btn-ghost" id="pauseBtn" aria-pressed={paused} onClick={() => setPaused(p => !p)}>{paused ? 'Play preview ▶' : 'Pause preview ‖'}</button>
      </div>
      <div className="panel player-card" id="playerCard" aria-live="polite">
        <div className="slide-swap" key={slide}>
          <div className="glyph">{s.glyph || s.az || s.rc || s.letter || 'Aa'}</div><p className="eyebrow">Learn With Why · Preview</p><p className="meta">{classById(s.cls).label} · {s.subject}</p><h3 className="card-title">{s.title}</h3>
          <p className={'price' + (s.price === 0 ? ' free' : '')}>{priceLine(st, s)}</p>
          {!st.ready ? <button type="button" className="btn btn-primary" disabled>Coming soon</button>
            : st.open ? <button type="button" className="btn btn-primary" onClick={() => openViewer(s.id)}>Open PDF ↗</button>
            : s.price === 0 ? <button type="button" className="btn btn-primary" onClick={() => unlock(s.id)}>Open it free →</button>
            : st.kind === 'ended' ? <button type="button" className="btn btn-primary" onClick={() => (buyAgain || buy)(s.id)}>Buy Access Again →</button>
            : <button type="button" className="btn btn-primary" onClick={() => buy(s.id)}>Buy PDF →</button>}
          {' '}<button type="button" className="btn btn-ghost" onClick={() => openShop('all')}>All sheets</button>
        </div>
      </div>
      <div className="player-ctrl">
        <button type="button" className="icon-btn" id="slidePrev" aria-label="Previous sheet" onClick={() => go(-1)}>←</button>
        <div className="dots" id="slideDots">{SHEETS.map((_, k) => <button key={k} type="button" className={'dot' + (k === slide ? ' on' : '')} aria-label={'Sheet ' + (k + 1)} aria-current={k === slide ? 'true' : undefined} onClick={() => setSlide(k)} />)}</div>
        <button type="button" className="icon-btn" id="slideNext" aria-label="Next sheet" onClick={() => go(1)}>→</button>
      </div>
    </Rise>
  );
}
