'use client';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion } from 'motion/react';
import { BRAND, LIBRARY, classById, sheetById, subjectById } from '@/lib/content';
import { isDrm, isLocked, licence, readerCredentials } from '@/lib/libraryStore';
import { pagesFor } from '@/lib/pages';
import { springs } from '@/lib/motion';
import { useStore } from '@/lib/store';
import { Reveal, SplitWords } from '@/components/ui/Motion';

const dateOf = ms => new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
/* "Licensed copy LW-105842 · Individual licence · © Learn With Why" */
const licenceLine = e => LIBRARY.watermark + ' ' + e.id + ' · ' + licence(e.licence).label + ' licence · © ' + BRAND.name;

/* ---------- My Library page ----------
   Purchase → open here → print → one copy used → locked (record only). */
export default function LibraryView() {
  const { booted, session, shelf, setAuth, consumePrint, retryProtect } = useStore();
  const router = useRouter();
  const [reader, setReader] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [printing, setPrinting] = useState(null);

  useEffect(() => {
    const onKey = e => { if (e.key !== 'Escape') return; if (confirm) setConfirm(null); else if (reader) setReader(null); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [confirm, reader]);

  async function confirmPrint() {
    const e = confirm;
    setConfirm(null);
    const updated = await consumePrint(e.id);
    if (!updated) { setReader(null); return; }
    if (isLocked(updated)) setReader(null);
    else if (reader && reader.id === updated.id) setReader(updated);
    setPrinting(updated);
  }

  return (
    <main className="library container">
      <Reveal><p className="eyebrow">{LIBRARY.eyebrow}</p></Reveal>
      {!booted ? null : !session ? (
        <>
          <SplitWords as="h2" className="h2" text={LIBRARY.guestTitle} />
          <Reveal><p className="lede">{LIBRARY.guestText}</p></Reveal>
          <Reveal className="btn-row"><button type="button" className="btn btn-primary" onClick={() => setAuth('signin')}>{LIBRARY.signIn}</button></Reveal>
        </>
      ) : (
        <>
          <SplitWords as="h2" className="h2" text={LIBRARY.title} />
          <Reveal><p className="lede">{LIBRARY.lede}</p></Reveal>
          {!shelf.length ? (
            <Reveal><p className="cart-empty" style={{ paddingTop: 0 }}>{LIBRARY.empty}</p><button type="button" className="btn btn-ghost" onClick={() => router.push('/#sheets')}>{LIBRARY.browse}</button></Reveal>
          ) : (
            <div className="lib-list">
              {shelf.map((e, i) => <LibraryCard key={e.id} item={e} index={i} onOpen={setReader} onPrint={setConfirm} onRetry={x => retryProtect(x.id)} />)}
            </div>
          )}
        </>
      )}
      <AnimatePresence>{reader && <Reader key={reader.id} item={reader} email={session ? session.email : ''} onPrint={() => setConfirm(reader)} onClose={() => setReader(null)} />}</AnimatePresence>
      <AnimatePresence>{confirm && <PrintConfirm key="confirm" item={confirm} onCancel={() => setConfirm(null)} onConfirm={confirmPrint} />}</AnimatePresence>
      {printing && <PrintJob item={printing} onDone={() => setPrinting(null)} />}
    </main>
  );
}

function LibraryCard({ item, index, onOpen, onPrint, onRetry }) {
  const sheet = sheetById(item.productId);
  if (!sheet) return null;
  const locked = isLocked(item), drm = isDrm(item), D = LIBRARY.drm;
  let actions;
  if (locked) actions = <p className="lib-note">{LIBRARY.usedNote}</p>;
  else if (item.drmStatus === 'pending') actions = <p className="lib-note"><span className="status pending">{D.pending}</span></p>;
  else if (item.drmStatus === 'failed') actions = <div className="btn-row"><p className="lib-note">{D.failed}</p><button type="button" className="btn btn-ghost" onClick={() => onRetry(item)}>{D.retry}</button></div>;
  else if (drm) actions = <div className="btn-row"><button type="button" className="btn btn-primary" onClick={() => onOpen(item)}>{D.open}</button></div>;
  else actions = <div className="btn-row"><button type="button" className="btn btn-primary" onClick={() => onOpen(item)}>{LIBRARY.open}</button><button type="button" className="btn btn-ghost" onClick={() => onPrint(item)}>{LIBRARY.print}</button></div>;
  return (
    <Reveal as="article" className={'panel lib-card' + (locked ? ' locked' : '')} delay={index * 0.05}>
      <div className="thumb" style={{ '--hue': subjectById(sheet.subject).hue }} aria-hidden="true"><small>{classById(sheet.cls).label}</small>{sheet.glyph}</div>
      <div>
        <h3>{sheet.title}</h3>
        <dl className="lib-meta">
          <div><dt>{LIBRARY.purchased}</dt><dd>{dateOf(item.purchasedAt)}</dd></div>
          <div><dt>{LIBRARY.licence}</dt><dd>{licence(item.licence).label} · <span className="lib-id">{item.id}</span></dd></div>
          <div><dt>{LIBRARY.access}</dt><dd><span className={'status' + (locked ? ' locked' : '')}>{locked ? LIBRARY.locked : LIBRARY.active}</span></dd></div>
          {!locked && <div><dt>{LIBRARY.allowance}</dt><dd>{LIBRARY.copies(item.copies)}{drm ? ' · ' + D.enforced : ''}</dd></div>}
          {!locked && !drm && <div><dt>{LIBRARY.remaining}</dt><dd>{item.remaining}</dd></div>}
        </dl>
        {actions}
      </div>
    </Reveal>
  );
}

/* ---------- one page — shared by the viewer, the detail preview and print ---------- */
export function Sheet({ sheet, page, total, mark }) {
  return (
    <div className="sheet">
      <header className="sheet-head"><span>{sheet.title}</span><span>{page.heading}</span></header>
      <div className="sheet-glyph">{page.glyph}</div>
      <div className="sheet-lines" aria-hidden="true"><i /><i /><i /></div>
      <p className="sheet-task">{page.task}</p>
      <footer className="sheet-foot"><span>{BRAND.name} · {page.n} / {total}</span><span>{mark}</span></footer>
    </div>
  );
}

function DrmPanel({ item, email }) {
  const D = LIBRARY.drm;
  const [cred, setCred] = useState(null);
  useEffect(() => { let on = true; readerCredentials(email).then(c => { if (on) setCred(c); }); return () => { on = false; }; }, [email]);
  return (
    <div className="panel drm-panel">
      <h3>{D.title}</h3>
      <p>{D.text}</p>
      <dl className="lib-meta" style={{ marginTop: 12 }}>
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

/* ---------- protected viewer: pages render inside the site, no file URL ---------- */
export function Reader({ item, email, onPrint, onClose }) {
  const sheet = sheetById(item.productId);
  const pages = pagesFor(sheet);
  const drm = isDrm(item);
  const [i, setI] = useState(0);
  const last = pages.length - 1, R = LIBRARY.reader;
  useEffect(() => {
    const onKey = e => { if (e.key === 'ArrowRight') setI(x => Math.min(last, x + 1)); else if (e.key === 'ArrowLeft') setI(x => Math.max(0, x - 1)); };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [last]);
  return (
    <motion.div className="reader" role="dialog" aria-label={sheet.title} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }}>
      <div className="reader-bar">
        <h2>{sheet.title}</h2>
        {!drm && <span className="count">{R.page} {i + 1} {R.of} {pages.length}</span>}
        <span className="count reader-note">{R.note}</span>
        {!drm && <button type="button" className="btn btn-primary" onClick={onPrint}>{LIBRARY.print}</button>}
        <button type="button" className="icon-btn" onClick={onClose} aria-label={R.close}>✕</button>
      </div>
      {drm ? <div className="reader-stage"><DrmPanel item={item} email={email} /></div> : (
        <div className="reader-stage" onContextMenu={e => e.preventDefault()}>
          <button type="button" className="icon-btn" onClick={() => setI(x => Math.max(0, x - 1))} disabled={i === 0} aria-label={R.prev}>←</button>
          <motion.div key={i} className="reader-page" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0, x: 0 }} transition={springs.ui} drag="x" dragConstraints={{ left: 0, right: 0 }} dragElastic={0.2}
            onDragEnd={(_, info) => { const s = info.offset.x + info.velocity.x * 0.2; if (s < -60) setI(x => Math.min(last, x + 1)); else if (s > 60) setI(x => Math.max(0, x - 1)); }}>
            <Sheet sheet={sheet} page={pages[i]} total={pages.length} mark={licenceLine(item)} />
          </motion.div>
          <button type="button" className="icon-btn" onClick={() => setI(x => Math.min(last, x + 1))} disabled={i === last} aria-label={R.next}>→</button>
        </div>
      )}
    </motion.div>
  );
}

/* ---------- print confirmation ---------- */
export function PrintConfirm({ item, onCancel, onConfirm }) {
  const C = LIBRARY.confirm, lastCopy = item.remaining <= 1;
  return (
    <motion.div className="modal-scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} onClick={onCancel}>
      <motion.div className="modal" role="alertdialog" aria-labelledby="printTitle" initial={{ opacity: 0, scale: 0.94, y: 12 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96, y: 8 }} transition={springs.ui} onClick={e => e.stopPropagation()}>
        <h3 id="printTitle">{C.title}</h3>
        <p className="sub">{C.allows(item.copies)} {lastCopy ? C.last : C.more(item.remaining - 1)}</p>
        <div className="btn-row"><button type="button" className="btn btn-ghost" onClick={onCancel}>{C.cancel}</button><button type="button" className="btn btn-primary" onClick={onConfirm} autoFocus>{C.go}</button></div>
      </motion.div>
    </motion.div>
  );
}

/* ---------- print job: every page with the licence line, print-only layer ---------- */
export function PrintJob({ item, onDone }) {
  const sheet = sheetById(item.productId);
  const pages = pagesFor(sheet);
  useEffect(() => {
    let finished = false;
    const done = () => { if (!finished) { finished = true; onDone(); } };
    addEventListener('afterprint', done);
    const t = setTimeout(() => { window.print(); done(); }, 60);
    return () => { clearTimeout(t); removeEventListener('afterprint', done); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  /* A direct child of <body>, so the print stylesheet can hide everything else */
  return createPortal(<div className="print-root" aria-hidden="true">{pages.map(p => <Sheet key={p.n} sheet={sheet} page={p} total={pages.length} mark={licenceLine(item)} />)}</div>, document.body);
}
