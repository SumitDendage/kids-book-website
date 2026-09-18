import { useEffect, useRef, useState } from 'react';

/* Reproduces the original chapter switch: the outgoing chapter gets an
   `out-*` class for 560ms, the incoming one an `in-*` class for 950ms,
   direction-aware. Nothing animates when a chapter is shown from cold
   (section -1), so the staggered `.rise` children play instead. */
export function useChapterTransition(section) {
  const prev = useRef(section);
  const [anim, setAnim] = useState({ entering: null, leaving: null });

  useEffect(() => {
    const from = prev.current;
    prev.current = section;
    if (from === section) return undefined;
    if (from === -1 || section === -1) { setAnim({ entering: null, leaving: null }); return undefined; }
    const dir = section > from ? 'fwd' : 'back';
    setAnim({ leaving: { index: from, dir }, entering: { index: section, dir } });
    const t1 = setTimeout(() => setAnim(a => ({ ...a, leaving: null })), 560);
    const t2 = setTimeout(() => setAnim(a => ({ ...a, entering: null })), 950);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [section]);

  return anim;
}
