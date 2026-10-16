import { useEffect, useState } from 'react';
import { topicSheets } from '../../data/catalogue.js';
import { VOCAB, TopicOpen } from './KgTopics.jsx';

/* Kindergarten › Vocabulary. Since Oct 16 (Sumit: "what i send you paste that exactly in page")
   the board is Sumit's own picture, shown whole, with a see-through button over each of its
   twelve cards. A topic with sheets opens to them; the rest say "Coming soon" until their
   sheets are added (TOPIC_SHEETS in catalogue.js). */
import BOARD from '../../assets/vocab/board-picture.webp';
/* where each card sits in the 1664 × 928 picture, in the order of VOCAB.items */
const W = 1664, H = 928, SIZE = 165, COLS = [463, 655, 845, 1037], ROWS = [248, 432, 615];
const spot = n => ({ left: (COLS[n % 4] / W * 100) + '%', top: (ROWS[Math.floor(n / 4)] / H * 100) + '%', width: (SIZE / W * 100) + '%', height: (SIZE / H * 100) + '%' });
const HINT = 'Most sheets have a second page with the answers filled in.';
const topics = () => VOCAB.items.map(([id, label, pic]) => ({ id, label, pic, focus: HINT, list: topicSheets(id) }));

export default function VocabBoard({ open, onOpen }) {
  const [soon, setSoon] = useState(null);
  useEffect(() => { if (!soon) return; const t = setTimeout(() => setSoon(null), 1800); return () => clearTimeout(t); }, [soon]);
  const all = topics();
  const s = open && all.find(x => x.id === open);
  if (s) return <TopicOpen s={s} crumb="Kindergarten › Vocabulary" back="← All topics" onBack={() => onOpen(null)} />;
  return (
    <section className="vocab-photo rise" style={{ '--i': 3 }} aria-label="Kindergarten · Explore Vocabulary">
      <img className="vocab-photo-img" src={BOARD} width={W} height={H} alt="Explore Vocabulary. Little words. Big discoveries. Choose a topic and start exploring." decoding="async" />
      {all.map((x, n) => {
        const k = x.list.length, free = x.list.filter(it => it.price === 0).length;
        return (
          <button key={x.id} type="button" className={'vocab-spot' + (k ? '' : ' soon')} style={spot(n)}
            onClick={() => (k ? onOpen(x.id) : setSoon(x.id))}
            aria-label={k ? 'Explore ' + x.label + ', ' + k + ' sheets' + (free ? ', ' + free + ' free' : '') : x.label + ', coming soon'}>
            {soon === x.id ? <span className="vocab-spot-tip">Coming soon</span> : null}
          </button>
        );
      })}
    </section>
  );
}
