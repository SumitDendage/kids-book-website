import { topicSheets } from '../../data/catalogue.js';
import { VOCAB, TopicOpen } from './KgTopics.jsx';

/* Kindergarten › Vocabulary (Sumit, Oct 6): "Explore Vocabulary" with a picture card for each
   of the twelve topics, after Sumit's picture. A topic with sheets opens to them; the rest say
   "Coming soon" until their sheets are added (TOPIC_SHEETS in catalogue.js). */
const PICS = import.meta.glob('../../assets/vocab/*.webp', { eager: true, import: 'default' });
const picOf = name => PICS['../../assets/vocab/' + name + '.webp'];
/* a soft colour per card, in the order of the picture */
const TONES = ['pink', 'lemon', 'lilac', 'mint', 'peach', 'sky', 'pink', 'mint', 'lilac', 'sky', 'peach', 'lemon'];
const HINT = 'Most sheets have a second page with the answers filled in.';
const topics = () => VOCAB.items.map(([id, label, pic], n) => ({ id, label, pic, tone: TONES[n % TONES.length], focus: HINT, list: topicSheets(id) }));

export default function VocabBoard({ open, onOpen }) {
  const all = topics();
  const s = open && all.find(x => x.id === open);
  if (s) return <TopicOpen s={s} crumb="Kindergarten › Vocabulary" back="← All topics" onBack={() => onOpen(null)} />;
  return (
    <section className="vocab rise" style={{ '--i': 3 }} aria-label="Kindergarten · Vocabulary">
      <div className="vocab-head">
        <p className="eyebrow">Kindergarten · Vocabulary</p>
        <h3>Explore Vocabulary</h3>
        <p className="vocab-sub"><em>Little words. Big discoveries.</em></p>
      </div>
      <div className="vocab-grid">
        {all.map((x, n) => {
          const k = x.list.length, free = x.list.filter(it => it.price === 0).length, inside = (
            <>
              {k ? <span className="vocab-n">{k} {k === 1 ? 'sheet' : 'sheets'}{free ? ' · ' + free + ' free' : ''}</span> : null}
              <span className="vocab-pic"><img src={picOf(x.pic)} alt="" loading="lazy" decoding="async" /></span>
              <span className="vocab-name">{x.label}</span>
              {k ? <span className="vocab-go">Explore <span aria-hidden="true">→</span></span> : <span className="vocab-soon">Coming soon</span>}
            </>
          );
          const style = { '--card': 'var(--c-' + x.tone + ')', '--n': n };
          return k
            ? <button key={x.id} type="button" className="vocab-card" style={style} onClick={() => onOpen(x.id)} aria-label={'Explore ' + x.label + ', ' + k + ' sheets' + (free ? ', ' + free + ' free' : '')}>{inside}</button>
            : <div key={x.id} className="vocab-card soon" style={style}>{inside}</div>;
        })}
      </div>
      <p className="vocab-foot">Choose a topic and start exploring.</p>
    </section>
  );
}
