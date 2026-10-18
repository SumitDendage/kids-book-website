import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { SUPPORT_EMAIL, mailTo } from '../../services/security.js';
import { dateTimeTz } from '../../utils/format.js';

/* The Security Warning popup: one warning at a time ("Warning 1 of 3"), what we saw, and what
   happens next. At the last warning it says that paid sheets are now paused. Accessible: an
   alertdialog with a title and description, focus starts on the button, Tab stays inside, the
   page behind is inert while it is open, and focus goes back afterwards. Escape does not close
   it: the customer presses "I Understand" (which marks it read; the count never changes here). */
export default function SecurityWarningModal({ level, max = 3, reason, endsAt, paused = false, timeZone, supportEmail = SUPPORT_EMAIL, onAcknowledge }) {
  const uid = useId(), titleId = uid + 'title', bodyId = uid + 'body';
  const boxRef = useRef(null), btnRef = useRef(null);

  useEffect(() => {
    const prev = document.activeElement, root = document.getElementById('root'), wasInert = root ? root.inert : false;
    if (root) root.inert = true;
    if (btnRef.current) btnRef.current.focus();
    const box = boxRef.current;
    const onKey = e => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); return; }
      e.stopPropagation();   /* arrows and space must not move the page behind */
      if (e.key !== 'Tab') return;
      const f = Array.from(box.querySelectorAll('a[href], button:not([disabled])'));
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    box.addEventListener('keydown', onKey);
    return () => {
      box.removeEventListener('keydown', onKey);
      if (root) root.inert = wasInert;
      if (prev && prev.focus && document.contains(prev)) prev.focus();
    };
  }, []);

  const n = Math.max(1, Math.min(max, level || 1));
  const tone = n >= max || paused ? 3 : n >= 2 ? 2 : 1;
  const ends = endsAt ? dateTimeTz(endsAt, timeZone || undefined) : '';
  return createPortal(
    <div className="sec-scrim" onWheel={e => e.stopPropagation()}>
      <div className="sec-modal" role="alertdialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={bodyId} ref={boxRef} data-level={tone}>
        <div className="sec-modal-top">
          <span className="sec-shield" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" /><path d="M12 8v4" /><path d="M12 16h.01" /></svg>
          </span>
          <ol className="sec-steps" aria-hidden="true">{Array.from({ length: max }, (_, i) => <li key={i} className={i < n ? 'on' : ''} />)}</ol>
        </div>
        <h2 id={titleId} className="sec-modal-title">Security warning <span className="sec-of">{n} of {max}</span></h2>
        <div id={bodyId} className="sec-modal-body">
          <p>We saw signs that your account may be used by more than one person. Your account is personal, so please keep your sign-in codes to yourself and do not share your account.</p>
          {reason ? <p className="sec-reason"><b>What we saw:</b> {reason}</p> : null}
          {paused
            ? <p className="sec-final">This is warning {n} of {max}, so paid sheets on this account are now paused. Free sheets still open, and you can still sign in and see your orders. If you think this is a mistake, write to us from My Account → Security.</p>
            : <p>After {max} warnings, paid sheets on the account are paused.{ends ? ' This warning ends on ' + ends + '.' : ''} If you think this is a mistake, write to us from My Account → Security.</p>}
        </div>
        <button type="button" className="btn btn-primary btn-block" ref={btnRef} onClick={onAcknowledge}>I Understand</button>
        <p className="sec-modal-help">Questions? Write to us at <a href={mailTo(supportEmail, 'About my security warning')}>{supportEmail}</a></p>
      </div>
    </div>,
    document.body,
  );
}
