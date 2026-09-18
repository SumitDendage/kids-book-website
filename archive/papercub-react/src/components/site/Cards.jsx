import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { BRAND, CART } from '../../content';
import { pagesFor } from '../../lib/pages';
import { Tilt } from '../ui/Motion';

export const money = n => BRAND.currency + n;

const label = {
  initial: { y: 8, opacity: 0 },
  animate: { y: 0, opacity: 1 },
  exit: { y: -8, opacity: 0 },
  transition: { duration: 0.16 },
};

/* A free title (price 0) skips the bag: one click puts it in the Library,
   where it is opened and printed like any purchase. */
export function ProductCard({ product, onAdd, owned, onClaim, onLibrary }) {
  const [added, setAdded] = useState(false);
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  const free = product.price === 0;
  const first = pagesFor(product)[0];   /* the page revealed when the cover opens */

  function add() {
    onAdd(product.id);
    setAdded(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setAdded(false), 1400);
  }

  let key = 'add', text = CART.add, act = add;
  if (free && owned) { key = 'owned'; text = CART.inLibrary; act = onLibrary; }
  else if (free) { key = 'claim'; text = CART.claim; act = () => onClaim(product.id); }
  else if (added) { key = 'added'; text = CART.added; }

  return (
    <Tilt as="article" className={'panel card' + (free ? ' is-free' : '')}>
      {/* A closed book: the cover opens on hover to show the tracing page */}
      <div className="thumb book" aria-hidden="true">
        <span className="page"><b>{first.glyph}</b><small>{first.heading}</small></span>
        <span className="cover">{product.mark}{free && <b className="free-tag">{CART.free}</b>}</span>
      </div>
      <h3>{product.title}</h3>
      <p>{product.desc}</p>
      <div className="meta"><span>{product.pages}</span><span>{CART.format}</span></div>
      <div className="meta">
        <span className="price">{free ? CART.free : money(product.price)}{product.was ? <small>{money(product.was)}</small> : null}</span>
        <motion.button type="button" className={'add-btn' + (added || (free && owned) ? ' added' : '')} onClick={act} whileHover={{ y: -1 }} whileTap={{ scale: 0.94 }}>
          <AnimatePresence mode="wait" initial={false}>
            <motion.span key={key} {...label} style={{ display: 'inline-block' }}>{text}</motion.span>
          </AnimatePresence>
        </motion.button>
      </div>
    </Tilt>
  );
}

export function QuoteCard({ quote, ...rest }) {
  return (
    <Tilt as="article" className="panel card" max={4} {...rest}>
      <div className="stars" aria-label="5 out of 5">★★★★★</div>
      <blockquote>“{quote.text}”</blockquote>
      <div className="who">
        <span className="avatar" aria-hidden="true">{quote.initials}</span>
        <div><h4>{quote.name}</h4><span>{quote.meta}</span></div>
      </div>
    </Tilt>
  );
}

export function InfoCard({ mark, title, text }) {
  return (
    <Tilt as="article" className="panel card">
      <div className="thumb" aria-hidden="true">{mark}</div>
      <h3>{title}</h3>
      <p>{text}</p>
    </Tilt>
  );
}
