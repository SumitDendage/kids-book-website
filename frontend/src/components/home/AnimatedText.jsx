import { Fragment, createElement, useMemo } from 'react';

/* The first screen's moving words. Text is cut into word (.tw) or letter (.tl) spans,
   each numbered (--w / --c) so styles/31-landing-text.css can bring them in one after
   another when the chapter opens. Spaces stay plain text, so lines wrap as before. */

// tags the admin's headline may use; anything else keeps only its words, no attributes but class
const KEEP = new Set(['EM', 'I', 'STRONG', 'B', 'U', 'MARK', 'SMALL', 'SPAN']);

function pushWords(text, count, out, key) {
  // split on ordinary spaces only, so a non-breaking space keeps its two words together
  text.split(/([ \t\n\r]+)/).forEach((part, k) => {
    if (!part) return;
    if (/^[ \t\n\r]+$/.test(part)) out.push(' ');
    else out.push(<span key={key + '-' + k} className="tw" style={{ '--w': count.n++ }}>{part}</span>);
  });
}

function walk(node, count, key) {
  const out = [];
  node.childNodes.forEach((child, k) => {
    const ck = key + '.' + k;
    if (child.nodeType === 3) pushWords(child.textContent, count, out, ck);
    else if (child.nodeType !== 1) return;
    else if (child.tagName === 'BR') out.push(<br key={ck} />);
    else if (KEEP.has(child.tagName)) out.push(createElement(child.tagName.toLowerCase(), { key: ck, className: child.getAttribute('class') || undefined }, ...walk(child, count, ck)));
    else out.push(<Fragment key={ck}>{walk(child, count, ck)}</Fragment>);
  });
  return out;
}

/* a headline that may hold a little HTML (e.g. <em>why</em>), one word at a time */
export function AnimatedHtml({ html }) {
  const nodes = useMemo(() => {
    const t = document.createElement('template');
    t.innerHTML = html;
    return walk(t.content, { n: 0 }, 'h');
  }, [html]);
  return <>{nodes}</>;
}

/* plain text, one word at a time */
export function AnimatedWords({ text }) {
  const nodes = useMemo(() => { const out = []; pushWords(text, { n: 0 }, out, 'w'); return out; }, [text]);
  return <>{nodes}</>;
}

/* plain text, one letter at a time (screen readers get the whole line once) */
export function AnimatedLetters({ text }) {
  return (
    <>
      <span className="sr-only">{text}</span>
      <span aria-hidden="true">{Array.from(text).map((ch, c) => <span key={c} className="tl" style={{ '--c': c }}>{ch}</span>)}</span>
    </>
  );
}
