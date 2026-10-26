import { useSite } from '../../context/SiteContext.jsx';
import { RC_WORDS } from '../../data/catalogue.js';
import { TileRating } from '../reviews/Stars.jsx';

/* the price is shown when the sheet is opened, not on the tile */
const useBadge = () => { const { access } = useSite(); return it => (it.price === 0 ? 'Free' : (access.canOpen(it) ? 'Yours' : '🔒')); };

/* a letter tile: A to Z tracing and Colour the letter, showing the sheet's own picture (the big letter when there is none) */
export function AzTile({ it, n }) {
  const { openSheet } = useSite(); const badge = useBadge();
  const L = it.az || it.letter;
  return (
    <button type="button" className={'az-card' + (it.price === 0 ? '' : ' paid')} style={{ '--n': n }} aria-label={it.title} onClick={() => openSheet(it.id)}>
      <b>{badge(it)}</b>
      {it.img
        ? <span className="az-pic"><img src={it.img} alt="" loading="lazy" /></span>
        : <span className="glyph">{L}<small>{L.toLowerCase()}</small></span>}
      <span>{it.tileLabel || 'Alphabet ' + L}</span>
      <TileRating it={it} />
    </button>
  );
}

/* a picture tile: reading charts (landscape) and the matching / spotting sheets (portrait) */
export function PicTile({ it, n }) {
  const { openSheet } = useSite(); const badge = useBadge();
  return (
    <button type="button" className={'rc-card' + (it.landscape ? '' : ' portrait') + (it.price === 0 ? '' : ' paid')} style={{ '--n': n }} aria-label={it.title} onClick={() => openSheet(it.id)}>
      <span className="rc-pic"><img src={it.img} alt="" loading="lazy" /><b>{badge(it)}</b></span>
      <span className="rc-name">{it.rc ? 'Letter ' + it.rc : it.tileName}<small>{it.rc ? RC_WORDS[it.rc].split(',').slice(0, 2).join(' · ') + ' · …' : it.tileSub}</small><TileRating it={it} /></span>
    </button>
  );
}
