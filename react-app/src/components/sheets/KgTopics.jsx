import { useSite } from '../../context/SiteContext.jsx';
import { groupSheets, groupTitle, kgOrdered, topicLabel, topicSheets } from '../../data/catalogue.js';
import SheetCard from './SheetCard.jsx';
import { AzTile, PicTile } from './SheetTiles.jsx';

/* Kindergarten topics: eight groups, every sub-topic is a shelf of its own.
   `open` is { topic } for one skill, { group } for a whole group, or null for the board. */
export default function KgTopics({ open, onOpen }) {
  const { openShop } = useSite();
  if (open) {
    const t = open.group ? { group: 'All skills', label: groupTitle(open.group) } : topicLabel(open.topic);
    const list = open.group ? groupSheets(open.group) : topicSheets(open.topic);
    const az = list.filter(it => it.az || it.letter), rc = list.filter(it => it.rc || it.chart), rest = list.filter(it => !it.az && !it.letter && !it.rc && !it.chart);
    return (
      <section className="kg-open rise" style={{ '--i': 3 }}>
        <div className="kg-open-head">
          <button type="button" className="btn btn-ghost btn-back" onClick={() => onOpen(null)}>← All topics</button>
          <div><p className="eyebrow">Kindergarten › {t.group}{open.group ? '' : ' › ' + t.label}</p><h3>{t.label} <em>· {list.length} {list.length === 1 ? 'sheet' : 'sheets'}</em></h3></div>
          <p className="kg-hint">{list.length ? 'Tap a sheet to see its price and what is inside. The free samples open after sign-in; the rest are yours to keep once bought.' : ''}</p>
        </div>
        {az.length > 0 && <div className="az-grid">{az.map((it, n) => <AzTile key={it.id} it={it} n={n} />)}</div>}
        {rc.length > 0 && <div className="rc-grid">{rc.map((it, n) => <PicTile key={it.id} it={it} n={n} />)}</div>}
        {rest.length > 0 && <div className="shop-grid" style={{ marginTop: (az.length || rc.length ? 18 : 0) + 'px' }}>{rest.map((it, n) => <SheetCard key={it.id} it={it} n={n} />)}</div>}
        {list.length ? null : <p className="cart-empty">No sheets in this topic yet — they are being drawn. Try another topic meanwhile.</p>}
      </section>
    );
  }
  return (
    <section className="kg-topics rise" style={{ '--i': 3 }} aria-label="Kindergarten topics">
      <div className="kg-head"><p className="eyebrow">Explore by skill</p><h3>Learning made simple</h3><p>Choose a category and find the right worksheets for your child&apos;s learning journey.</p></div>
      <div className="kg-grid">
        {kgOrdered().map(g => {
          const total = groupSheets(g.id).length;
          return (
            <article key={g.id} className={'kg-card tone-' + g.tone}>
              <h4 className="card-title">{g.title}</h4>
              <ul className="kg-list">
                {g.items.map(([id, label]) => { const n = topicSheets(id).length; return (
                  <li key={id}><button type="button" className={'kg-item' + (n ? '' : ' soon')} onClick={() => onOpen({ topic: id })}><span>{label}</span>{n ? <b>{n}</b> : null}</button></li>
                ); })}
              </ul>
              <div className="kg-foot">
                <span>{total ? total + (total === 1 ? ' sheet' : ' sheets') : 'Coming soon'}</span>
                {total ? <button type="button" className="btn btn-sm btn-primary" onClick={() => onOpen({ group: g.id })}>Browse worksheets <span aria-hidden="true">→</span></button> : null}
              </div>
            </article>
          );
        })}
        <aside className="kg-slogan" aria-label="Learn With Why">
          <p className="eyebrow">Small steps · big whys</p>
          <h4>One idea per page.<br /><em>One happy little win.</em></h4>
          <p className="kg-slogan-sub">Every sheet is drawn by hand, tested by five-year-olds and ready for your printer.</p>
          <button type="button" className="kg-browse" onClick={() => openShop('all')}>See every sheet <span aria-hidden="true">→</span></button>
        </aside>
      </div>
    </section>
  );
}
