import Chapter from '../layout/Chapter.jsx';
import Rise from '../common/Rise.jsx';
import PreviewPlayer from './PreviewPlayer.jsx';
import Shelf from './Shelf.jsx';
import PickedRow from './PickedRow.jsx';
import { useSite } from '../../context/SiteContext.jsx';
import { Sticker } from '../common/Slogans.jsx';
import { TAGLINES } from '../../data/content.js';

/* 04 · Sheets — the fox & rabbit preview, then the shelf */
export default function SheetsChapter() {
  const { section } = useSite();
  return (
    <Chapter index={3}>
      <Rise i={0} className="sheets-head"><p className="eyebrow" style={{ textAlign: 'center', marginBottom: '10px' }}>04 / Sheets</p><h2 className="h2">A moment of <em>wonder</em>.</h2><Sticker tilt={-3}>{TAGLINES.sheets}</Sticker><p>Choose the sheet that sparks their curiosity. Psst — the fox says start with the free one.</p></Rise>
      <PreviewPlayer active={section === 3} />
      <PickedRow />
      <Shelf />
    </Chapter>
  );
}
