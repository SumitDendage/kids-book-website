import { useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { BRAND, LIBRARY, PRODUCTS } from '../../content';
import { isDrm, isLocked, licence, protect, readerCredentials } from '../../lib/libraryStore';
import { pagesFor } from '../../lib/pages';
import { springs } from '../../lib/motion';
import { useScrollFade } from '../../hooks/useScrollFade';
import { SplitWords } from '../ui/Motion';

const productOf = e => PRODUCTS.find(p => p.id === e.productId);
const dateOf = ms => new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
/* "Licensed copy LW-105842 · Individual licence · © Papercub" (brief §6) */
const licenceLine = e => LIBRARY.watermark + ' ' + e.id + ' · ' + licence(e.licence).label + ' licence · © ' + BRAND.name;

/* ---------- My Library (brief §2, §7) ----------
   A state-driven chapter, like the auth pages: shown over the landscape
   while the frames pause. Locked titles keep only their purchase record. */
export function LibraryPage({ open, signedIn, items, onOpen, onPrint, onRetry, onGo, onSignIn }) {
  const inner = useRef(null);
  useScrollFade(inner);
  return (
    <section className={'chapter page' + (open ? ' is-active in-fwd' : '')} aria-label={LIBRARY.nav}>
      <div className="chapter-inner" ref={inner}>
        <p className="eyebrow rise" style={{ '--i': 0 }}>{LIBRARY.eyebrow}</p>
        {!signedIn ? (
          <>
            <SplitWords as="h2" className="h2 rise" style={{ '--i': 1 }} delay={200} text={LIBRARY.guestTitle} />
            <p className="lede rise" style={{ '--i': 2 }}>{LIBRARY.guestText}</p>
            <div className="btn-row rise" style={{ '--i': 3 }}>
              <button type="button" className="btn btn-primary" onClick={onSignIn}>{LIBRARY.signIn}</button>
            </div>
          </>
        ) : (
          <>
            <SplitWords as="h2" className="h2 rise" style={{ '--i': 1 }} delay={200} text={LIBRARY.title} />
            <p className="lede rise" style={{ '--i': 2 }}>{LIBRARY.lede}</p>
            {!items.length ? (
              <div className="rise" style={{ '--i': 3 }}>
                <p className="cart-empty" style={{ paddingTop: 0 }}>{LIBRARY.empty}</p>
                <button type="button" className="btn btn-ghost" onClick={() => onGo(2)}>{LIBRARY.browse}</button>
              </div>
            ) : (
              <div className="lib-list rise" style={{ '--i': 3 }}>
                {items.map(e => <LibraryCard key={e.id} item={e} onOpen={onOpen} onPrint={onPrint} onRetry={onRetry} />)}
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}

function LibraryCard({ item, onOpen, onPrint, onRetry }) {
  const product = productOf(item);
  const locked = isLocked(item);
  const drm = isDrm(item);
  const D = LIBRARY.drm;
  if (!product) return null;
  let actions;
  if (locked) actions = <p className="lib-note">{LIBRARY.usedNote}</p>;
  else if (item.drmStatus === 'pending') actions = <p className="lib-note"><span className="status pending">{D.pending}</span></p>;
  else if (item.drmStatus === 'failed') actions = (
    <div className="btn-row">
      <p className="lib-note">{D.failed}</p>
      <button type="button" className="btn btn-ghost" onClick={() => onRetry(item)}>{D.retry}</button>
    </div>
  );
  else if (drm) actions = (
    <div className="btn-row">
      <button type="button" className="btn btn-primary" onClick={() => onOpen(item)}>{D.open}</button>
    </div>
  );
  else actions = (
    <div className="btn-row">
      <button type="button" className="btn btn-primary" onClick={() => onOpen(item)}>{LIBRARY.open}</button>
      <button type="button" className="btn btn-ghost" onClick={() => onPrint(item)}>{LIBRARY.print}</button>
    </div>
  );
  return (
    <article className={'panel lib-card' + (locked ? ' locked' : '')}>
      <div className="thumb" aria-hidden="true">{product.mark}</div>
      <div>
        <h3>{product.title}</h3>
        <dl className="lib-meta">
          <div><dt>{LIBRARY.purchased}</dt><dd>{dateOf(item.purchasedAt)}</dd></div>
          <div><dt>{LIBRARY.licence}</dt><dd>{licence(item.licence).label} · <span className="lib-id">{item.id}</span></dd></div>
          <div><dt>{LIBRARY.access}</dt><dd><span className={'status' + (locked ? ' locked' : '')}>{locked ? LIBRARY.locked : LIBRARY.active}</span></dd></div>
          {!locked && <div><dt>{LIBRARY.allowance}</dt><dd>{LIBRARY.copies(item.copies)}{drm ? ' · ' + D.enforced : ''}</dd></div>}
          {!locked && !drm && <div><dt>{LIBRARY.remaining}</dt><dd>{item.remaining}</dd></div>}
        </dl>
        {actions}
      </div>
    </article>
  );
}

/* ---------- One page of a title — shared by the viewer and the print job ---------- */
function Sheet({ product, page, total, mark }) {
  return (
    <div className="sheet">
      <header className="sheet-head"><span>{product.title}</span><span>{page.heading}</span></header>
      <div className="sheet-glyph">{page.glyph}</div>
      <div className="sheet-lines" aria-hidden="true"><i /><i /><i /></div>
      <p className="sheet-task">{page.task}</p>
      <footer className="sheet-foot"><span>{BRAND.name} · {page.n} / {total}</span><span>{mark}</span></footer>
    </div>
  );
}

/* ---------- Protected viewer (brief §3) ----------
   Pages render inside the site; there is no file URL and no download. */
/* Secure-reader hand-off for a DRM-protected copy: VeryPDF's reader opens the
   file, counts the prints and locks it when the allowance is used. */
function DrmPanel({ item, email }) {
  const D = LIBRARY.drm;
  const [cred, setCred] = useState(null);
  useEffect(() => { let on = true; readerCredentials(email).then(c => { if (on) setCred(c); }); return () => { on = false; }; }, [email]);
  return (
    <div className="panel drm-panel">
      <h3>{D.title}</h3>
      <p>{D.text}</p>
      <dl className="lib-meta">
        <div><dt>{D.user}</dt><dd>{email}</dd></div>
        <div><dt>{D.password}</dt><dd className="lib-id">{cred ? cred.password : '…'}</dd></div>
        <div><dt>{LIBRARY.allowance}</dt><dd>{LIBRARY.copies(item.copies)} · {D.enforced}</dd></div>
        <div><dt>{LIBRARY.licence}</dt><dd className="lib-id">{item.id}</dd></div>
      </dl>
      <div className="btn-row">
        <a className="btn btn-primary" href={item.drmUrl} target="_blank" rel="noopener noreferrer">{D.open}</a>
        <a className="btn btn-ghost" href={D.readerHref} target="_blank" rel="noopener noreferrer">{D.reader}</a>
      </div>
    </div>
  );
}

export function Reader({ item, email, onPrint, onClose }) {
  const product = productOf(item);
  const pages = pagesFor(product);
  const drm = isDrm(item);
  const [i, setI] = useState(0);
  const last = pages.length - 1;
  const R = LIBRARY.reader;

  useEffect(() => {
    const onKey = e => {
      if (e.key === 'ArrowRight') setI(x => Math.min(last, x + 1));
      else if (e.key === 'ArrowLeft') setI(x => Math.max(0, x - 1));
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [last]);

  return (
    <motion.div className="reader" role="dialog" aria-label={product.title} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }}>
      <div className="reader-bar">
        <h2>{product.title}</h2>
        {!drm && <span className="count">{R.page} {i + 1} {R.of} {pages.length}</span>}
        <span className="count reader-note">{R.note}</span>
        {!drm && <button type="button" className="btn btn-primary" onClick={onPrint}>{LIBRARY.print}</button>}
        <button type="button" className="icon-btn" onClick={onClose} aria-label={R.close}>✕</button>
      </div>
      {drm ? (
        <div className="reader-stage"><DrmPanel item={item} email={email} /></div>
      ) : (
      <div className="reader-stage" onContextMenu={e => e.preventDefault()}>
        <button type="button" className="icon-btn" onClick={() => setI(x => Math.max(0, x - 1))} disabled={i === 0} aria-label={R.prev}>←</button>
        <motion.div
          key={i}
          className="reader-page"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0, x: 0 }}
          transition={springs.ui}
          drag="x"
          dragConstraints={{ left: 0, right: 0 }}
          dragElastic={0.2}
          onDragEnd={(_, info) => { const s = info.offset.x + info.velocity.x * 0.2; if (s < -60) setI(x => Math.min(last, x + 1)); else if (s > 60) setI(x => Math.max(0, x - 1)); }}
        >
          <Sheet product={product} page={pages[i]} total={pages.length} mark={licenceLine(item)} />
        </motion.div>
        <button type="button" className="icon-btn" onClick={() => setI(x => Math.min(last, x + 1))} disabled={i === last} aria-label={R.next}>→</button>
      </div>
      )}
    </motion.div>
  );
}

/* ---------- Print confirmation (brief §4) ---------- */
export function PrintConfirm({ item, onCancel, onConfirm }) {
  const C = LIBRARY.confirm;
  const lastCopy = item.remaining <= 1;
  return (
    <motion.div className="modal-scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} onClick={onCancel}>
      <motion.div
        className="modal"
        role="alertdialog"
        aria-labelledby="printTitle"
        initial={{ opacity: 0, scale: 0.94, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 8 }}
        transition={springs.ui}
        onClick={e => e.stopPropagation()}
      >
        <h3 id="printTitle">{C.title}</h3>
        <p>{C.allows(item.copies)} {lastCopy ? C.last : C.more(item.remaining - 1)}</p>
        <div className="btn-row">
          <button type="button" className="btn btn-ghost" onClick={onCancel}>{C.cancel}</button>
          <button type="button" className="btn btn-primary" onClick={onConfirm} autoFocus>{C.go}</button>
        </div>
      </motion.div>
    </motion.div>
  );
}

/* ---------- Print job (brief §6) ----------
   Mounted only while printing: every page, each carrying the licence line,
   in a print-only layer. Unmounts once the print dialog closes. */
export function PrintJob({ item, onDone }) {
  const product = productOf(item);
  const pages = pagesFor(product);
  useEffect(() => {
    let finished = false;
    const done = () => { if (!finished) { finished = true; onDone(); } };
    addEventListener('afterprint', done);
    const t = setTimeout(() => { window.print(); done(); }, 60);   /* let the pages lay out first */
    return () => { clearTimeout(t); removeEventListener('afterprint', done); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="print-root" aria-hidden="true">
      {pages.map(p => <Sheet key={p.n} product={product} page={p} total={pages.length} mark={licenceLine(item)} />)}
    </div>
  );
}
