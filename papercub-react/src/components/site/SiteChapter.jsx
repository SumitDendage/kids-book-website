import { useRef } from 'react';
import { useScrollFade } from '../../hooks/useScrollFade';

/* One landing-page chapter mapped onto the frame scroll. The class list
   reproduces the original cinematic entry/exit: `is-active` for the chapter
   under the playhead, `in-*` / `out-*` while a transition is running. */
export default function SiteChapter({ index, section, anim, children }) {
  const inner = useRef(null);
  useScrollFade(inner);
  let cls = 'chapter site';
  if (index === section) cls += ' is-active';
  if (anim.entering && anim.entering.index === index) cls += ' in-' + anim.entering.dir;
  if (anim.leaving && anim.leaving.index === index) cls += ' out-' + anim.leaving.dir;
  return (
    <section className={cls} data-index={index}>
      <div className="chapter-inner" ref={inner}>{children}</div>
    </section>
  );
}

export function Stats({ items, style, className }) {
  return (
    <div className={'stats' + (className ? ' ' + className : '')} style={style}>
      {items.map(s => <div className="stat" key={s.label}><b>{s.value}</b><span>{s.label}</span></div>)}
    </div>
  );
}

export function Ticks({ items }) {
  return <ul className="ticks">{items.map(t => <li key={t}>{t}</li>)}</ul>;
}
