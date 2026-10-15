import { useEffect, useId, useRef, useState } from 'react';
import { SUPPORT_EMAIL, mailTo } from '../../services/security.js';

const EYEBROW = {
  expired: 'Access ended', payment: 'Payment', signed_out: 'Signed out', session_blocked: 'Sign-in stopped',
  access_suspended: 'Account security', account: 'My Account',
};

/* A short message on a paper card, for things the customer must not miss: a sheet's access ended
   (with "Buy Access Again"), a sign-in that was stopped, paid sheets that are paused, a payment we
   could not confirm yet. notice = { kind, title, text, actions: [{ label, run?, primary?, mail? }] };
   an action without `run` just closes it, `mail` writes to us. Escape and the backdrop close it. */
export default function AccountNotice({ notice, onClose, supportEmail = SUPPORT_EMAIL }) {
  const uid = useId(), titleId = uid + 't', textId = uid + 'x';
  const boxRef = useRef(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const prev = document.activeElement;
    const raf = requestAnimationFrame(() => {
      setShown(true);
      const box = boxRef.current, first = box && (box.querySelector('.btn-primary') || box.querySelector('.btn'));
      if (first) first.focus();
    });
    return () => { cancelAnimationFrame(raf); if (prev && prev.focus && document.contains(prev)) prev.focus(); };
  }, [notice]);

  const onKey = e => {
    e.stopPropagation();   /* keys inside the card must not move the page behind */
    if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
    if (e.key !== 'Tab') return;
    const f = Array.from(boxRef.current.querySelectorAll('a[href], button:not([disabled])'));
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };
  const actions = Array.isArray(notice.actions) && notice.actions.length ? notice.actions : [{ label: 'Close', primary: true }];
  return (
    <div className={'modal-scrim notice-scrim' + (shown ? ' open' : '')} onClick={e => { if (e.target === e.currentTarget) onClose(); }} onWheel={e => e.stopPropagation()}>
      <div className="modal notice" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={textId} data-kind={notice.kind || 'info'} ref={boxRef} onKeyDown={onKey}>
        <button type="button" className="icon-btn close-x" aria-label="Close" onClick={onClose}>✕</button>
        <p className="eyebrow">{EYEBROW[notice.kind] || 'Learn With Why'}</p>
        <h3 id={titleId}>{notice.title}</h3>
        <p id={textId}>{notice.text}</p>
        <div className="sheet-actions">
          {actions.map((a, i) => (a.mail
            ? <a key={i} className={'btn ' + (a.primary ? 'btn-primary' : 'btn-ghost')} href={mailTo(supportEmail, notice.title)}>{a.label}</a>
            : <button key={i} type="button" className={'btn ' + (a.primary ? 'btn-primary' : 'btn-ghost')} onClick={() => { onClose(); if (a.run) a.run(); }}>{a.label}</button>))}
        </div>
      </div>
    </div>
  );
}
