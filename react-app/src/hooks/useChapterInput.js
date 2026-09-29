import { useEffect } from 'react';
import { scrollableAncestor } from '../services/chapterStage.js';
import { IDS } from '../data/content.js';

/* input: wheel / touch / keys drive the playhead unless a panel needs it.
   Passive listeners everywhere except the keys we turn into chapter moves. */
export default function useChapterInput(stage, contentRef, { isInputLocked, onStaffHash }) {
  useEffect(() => {
    let touchY = 0, hoverScroller = null, innerScroller = null;
    const typing = el => el && ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName);
    const locked = (delta, touch) => {
      if (isInputLocked()) return true;
      const el = touch ? innerScroller : hoverScroller; if (!el) return false;
      const atTop = el.scrollTop <= 0, atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 1;
      if (delta < 0 && atTop) return false; if (delta > 0 && atBottom) return false; return true;
    };
    const onWheel = e => { const d = e.deltaY * (e.deltaMode === 1 ? 30 : e.deltaMode === 2 ? innerHeight : 1); if (locked(d, false)) return; stage.target = stage.clamp(stage.target + d * 0.6); stage.onHideHint(); };
    const onTouchStart = e => { touchY = e.touches[0].clientY; innerScroller = scrollableAncestor(e.target); };
    const onTouchMove = e => { const y = e.touches[0].clientY, dy = touchY - y; if (locked(dy, true)) { touchY = y; return; } stage.target = stage.clamp(stage.target + dy * 1.2); touchY = y; stage.onHideHint(); };
    const onKey = e => {
      if (typing(e.target) || isInputLocked()) return;
      if (['ArrowDown', 'PageDown', ' '].includes(e.key)) stage.target = stage.clamp(stage.target + innerHeight * 0.85); else if (['ArrowUp', 'PageUp'].includes(e.key)) stage.target = stage.clamp(stage.target - innerHeight * 0.85); else if (e.key === 'ArrowRight') stage.goTo(stage.section + 1); else if (e.key === 'ArrowLeft') stage.goTo(stage.section - 1); else if (e.key === 'Home') stage.target = 0; else if (e.key === 'End') stage.target = stage.maxScroll; else return;
      e.preventDefault(); stage.onHideHint();
    };
    const onOver = e => { hoverScroller = scrollableAncestor(e.target); };
    const onResize = () => stage.measure();
    /* anchors in the URL must move our stack, never the layer itself */
    const content = contentRef.current;
    const onContentScroll = () => { content.scrollTop = 0; };
    const onHash = () => { content.scrollTop = 0; const h = location.hash.slice(1); if (onStaffHash(h)) return; const n = IDS.indexOf(h); if (n >= 0) stage.goTo(n); };
    const ro = new ResizeObserver(() => stage.measure());
    if (stage.stack) ro.observe(stage.stack);

    addEventListener('wheel', onWheel, { passive: true });
    addEventListener('touchstart', onTouchStart, { passive: true });
    addEventListener('touchmove', onTouchMove, { passive: true });
    addEventListener('keydown', onKey);
    document.addEventListener('mouseover', onOver, { passive: true });
    addEventListener('resize', onResize);
    addEventListener('hashchange', onHash);
    content.addEventListener('scroll', onContentScroll);
    return () => {
      removeEventListener('wheel', onWheel); removeEventListener('touchstart', onTouchStart); removeEventListener('touchmove', onTouchMove);
      removeEventListener('keydown', onKey); document.removeEventListener('mouseover', onOver); removeEventListener('resize', onResize);
      removeEventListener('hashchange', onHash); content.removeEventListener('scroll', onContentScroll); ro.disconnect();
    };
  }, [stage, contentRef, isInputLocked, onStaffHash]);
}
