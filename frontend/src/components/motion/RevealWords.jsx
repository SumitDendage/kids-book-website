import { Children, cloneElement, isValidElement } from 'react';

/* Chapter headings arrive word by word, out of a soft blur, the way the first screen's headline
   does. The words are numbered (--w) so styles/40-motion.css can bring them in one after another
   when the chapter opens; the coloured words keep their own candy gradient (.rw-em .rw).
   Spaces stay plain text, so the line still wraps wherever it needs to. */

const split = (text, count, key) => text.split(/([ \t\n\r]+)/).filter(Boolean).map((part, k) => (
  /^\s+$/.test(part) ? ' ' : <span key={key + k} className="rw" style={{ '--w': count.n++ }}>{part}</span>
));

function walk(children, count, key) {
  return Children.map(children, (child, k) => {
    if (typeof child === 'string' || typeof child === 'number') return split(String(child), count, key + k + '-');
    if (!isValidElement(child)) return child;
    /* a coloured word (<em>) keeps its gradient, so mark it and walk inside */
    const cls = (child.props.className ? child.props.className + ' ' : '') + (child.type === 'em' ? 'rw-em' : '');
    return cloneElement(child, { className: cls.trim() || undefined }, walk(child.props.children, count, key + k + '.'));
  });
}

export default function RevealWords({ children }) {
  return <>{walk(children, { n: 0 }, 'r')}</>;
}
