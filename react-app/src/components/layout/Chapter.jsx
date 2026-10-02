import { useSite } from '../../context/SiteContext.jsx';
import { IDS } from '../../data/content.js';

/* One screen of the chapter stack. The stage keeps a handle on the section and its
   inner block so it can move, soften and activate them without re-rendering. */
export default function Chapter({ index, children }) {
  const { stage } = useSite();
  return (
    <section className="chapter" id={IDS[index]} data-index={index} ref={el => { stage.chapters[index] = el; }}>
      <div className="chapter-inner" ref={el => { stage.inners[index] = el; }}>{children}</div>
    </section>
  );
}
