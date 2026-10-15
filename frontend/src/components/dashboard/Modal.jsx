import { useEffect, useId, useRef } from 'react';

/* A dialog in the dashboard's look, for a question or a short form (a reason, a date, a reply).
   Accessible: a modal dialog with a title; focus starts on the first field (or Cancel), Tab stays
   inside, Escape and a click outside close it, except while the request is running.
   With onSubmit the body is a form, so Enter in a field submits. */
export default function Modal({ title, children, onClose, onSubmit, submitLabel, busyLabel, cancelLabel = 'Cancel', danger = false, busy = false, error = null, wide = false, hideSubmit = false, submitDisabled = false }) {
  const uid = useId(), boxRef = useRef(null);
  const busyRef = useRef(busy); busyRef.current = busy;
  const closeFn = useRef(onClose); closeFn.current = onClose;

  useEffect(() => {
    const prev = document.activeElement, box = boxRef.current;
    const first = box.querySelector('[data-autofocus], input:not([type=hidden]):not([disabled]), select:not([disabled]), textarea:not([disabled])') || box.querySelector('button:not([disabled])');
    if (first) first.focus();
    const onKey = e => {
      e.stopPropagation();   /* the panel's own Escape must not close the whole staff page */
      if (e.key === 'Escape') { e.preventDefault(); if (!busyRef.current) closeFn.current(); return; }
      if (e.key !== 'Tab') return;
      const f = Array.from(box.querySelectorAll('button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'));
      if (!f.length) { e.preventDefault(); return; }
      const a = f[0], z = f[f.length - 1];
      if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); }
      else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
    };
    box.addEventListener('keydown', onKey);
    return () => { box.removeEventListener('keydown', onKey); if (prev && prev.focus && document.contains(prev)) prev.focus(); };
  }, []);

  const Box = onSubmit ? 'form' : 'div';
  const boxProps = onSubmit ? { noValidate: true, onSubmit: e => { e.preventDefault(); if (!busy && !submitDisabled) onSubmit(e); } } : {};
  return (
    <div className="dm-scrim" onMouseDown={e => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <Box className={'dm' + (wide ? ' wide' : '')} role="dialog" aria-modal="true" aria-labelledby={uid + 't'} aria-busy={busy ? 'true' : 'false'} ref={boxRef} {...boxProps}>
        <h2 className="dm-title" id={uid + 't'}>{title}</h2>
        <div className="dm-body">{children}</div>
        {error ? <div className="dm-note err" role="alert">{error}</div> : null}
        <div className="dm-actions">
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={onClose}>{cancelLabel}</button>
          {hideSubmit ? null : <button type={onSubmit ? 'submit' : 'button'} className={'btn ' + (danger ? 'btn-destructive' : 'btn-primary')} disabled={busy || submitDisabled}>{busy ? <><span className="dm-spin" aria-hidden="true" />{busyLabel || 'Working…'}</> : submitLabel}</button>}
        </div>
      </Box>
    </div>
  );
}
