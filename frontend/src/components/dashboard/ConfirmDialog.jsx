import { useEffect, useId, useRef } from 'react';

/* A confirmation dialog in the dashboard's look, for every action that changes something that
   matters (blocking a sign-in, pausing paid access, blocking an account, removing a warning ...).
   Ported from the account-security pages. Accessible: an alertdialog with a title and description.
   Focus starts in the first field of the dialog (a reason box, say) or else on Cancel, the safe
   choice; Tab stays inside; Escape and a click outside cancel, except while the request runs.
   Fields go in `children`; the caller keeps their values. It renders inside .dash, so it uses the
   dashboard's colours (light and dark), and carries its own styles. */
const CSS = `
@keyframes cfmFade { from { opacity: 0; } to { opacity: 1; } }
@keyframes cfmRise { from { opacity: 0; transform: translateY(14px) scale(0.98); } to { opacity: 1; transform: none; } }
@keyframes cfmSpin { to { transform: rotate(360deg); } }
.cfm-scrim { position: fixed; inset: 0; z-index: 320; display: grid; place-items: center; padding: 16px; overflow-y: auto; background: rgb(0 0 0 / 0.5); animation: cfmFade 0.2s ease both; }
.cfm { width: min(100%, 30rem); display: grid; gap: 14px; padding: 24px; text-align: left; border: 1px solid var(--border, #e2e8f0); border-radius: var(--radius, 10px); background: var(--background, #fff); color: var(--foreground, #0f172a); box-shadow: 0 10px 40px rgb(0 0 0 / 0.25); animation: cfmRise 0.25s ease both; }
.cfm-title { margin: 0; font-family: inherit; font-size: 18px; font-weight: 600; letter-spacing: -0.01em; line-height: 1.3; overflow-wrap: anywhere; }
.cfm-body { display: grid; gap: 12px; font-size: 14px; line-height: 1.55; color: var(--muted-foreground, #64748b); }
.cfm-body p { margin: 0; }
.cfm-body b { color: var(--foreground, #0f172a); font-weight: 600; overflow-wrap: anywhere; }
.cfm-body .field { margin: 0; display: grid; gap: 6px; }
.cfm-body label { color: var(--foreground, #0f172a); }
.cfm-body textarea { min-height: 76px; resize: vertical; }
.cfm-body .check { display: flex; align-items: flex-start; gap: 8px; color: var(--foreground, #0f172a); cursor: pointer; }
.cfm-body .check input { margin-top: 3px; }
.cfm-err { position: relative; padding: 10px 12px 10px 34px; border-radius: calc(var(--radius, 10px) - 2px); border: 1px solid color-mix(in oklab, var(--bad, #dc2626) 30%, transparent); background: var(--bad-bg, #fee2e2); font-size: 13px; line-height: 1.5; color: var(--foreground, #0f172a); }
.cfm-err::before { content: '!'; position: absolute; left: 11px; top: 10px; width: 16px; height: 16px; border-radius: 50%; display: grid; place-items: center; font-size: 11px; font-weight: 800; color: #fff; background: var(--bad, #dc2626); }
.cfm-actions { display: flex; justify-content: flex-end; gap: 8px; flex-wrap: wrap; }
.cfm-spin { display: inline-block; flex: none; width: 14px; height: 14px; margin-right: 8px; border-radius: 50%; border: 2px solid currentColor; border-right-color: transparent; vertical-align: -2px; animation: cfmSpin 0.8s linear infinite; }
.dash .btn-destructive { background: var(--destructive); color: #fff; border-color: transparent; }
.dash .btn-destructive:hover { background: color-mix(in oklab, var(--destructive) 88%, black); }
.dash .btn-destructive:disabled, .cfm .btn:disabled { opacity: 0.6; cursor: not-allowed; }
@media (max-width: 520px) { .cfm { padding: 20px 16px; } .cfm-actions { flex-direction: column-reverse; } .cfm-actions .btn { width: 100%; } }
@media (prefers-reduced-motion: reduce) { .cfm-scrim, .cfm { animation: none; } .cfm-spin { animation-duration: 2s; } }
`;

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]):not([type="hidden"]), textarea:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

export default function ConfirmDialog({ title, children, confirmLabel, busyLabel, cancelLabel = 'Cancel', danger = false, busy = false, error = null, confirmDisabled = false, onConfirm, onCancel }) {
  const uid = useId(), boxRef = useRef(null), cancelRef = useRef(null);
  const busyRef = useRef(busy); busyRef.current = busy;
  const cancelFn = useRef(onCancel); cancelFn.current = onCancel;

  useEffect(() => {
    const prev = document.activeElement, box = boxRef.current;
    const field = box.querySelector('.cfm-body input:not([disabled]):not([type="hidden"]):not([type="checkbox"]), .cfm-body textarea:not([disabled]), .cfm-body select:not([disabled])');
    (field || cancelRef.current).focus();
    const onKey = e => {
      e.stopPropagation();   /* the staff page's own Escape must not close the whole panel */
      if (e.key === 'Escape') { e.preventDefault(); if (!busyRef.current) cancelFn.current(); return; }
      if (e.key !== 'Tab') return;
      const f = Array.from(box.querySelectorAll(FOCUSABLE));
      if (!f.length) { e.preventDefault(); return; }
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    box.addEventListener('keydown', onKey);
    return () => { box.removeEventListener('keydown', onKey); if (prev && prev.focus && document.contains(prev)) prev.focus(); };
  }, []);

  return (
    <>
      <style href="lww-confirm-dialog" precedence="medium">{CSS}</style>
      <div className="cfm-scrim" onMouseDown={e => { if (e.target === e.currentTarget && !busy) onCancel(); }}>
        <div className="cfm" role="alertdialog" aria-modal="true" aria-labelledby={uid + 't'} aria-describedby={uid + 'd'} aria-busy={busy ? 'true' : 'false'} ref={boxRef}>
          <h2 className="cfm-title" id={uid + 't'}>{title}</h2>
          <div className="cfm-body" id={uid + 'd'}>{children}</div>
          {error ? <div className="cfm-err" role="alert">{error}</div> : null}
          <div className="cfm-actions">
            <button type="button" className="btn btn-ghost" ref={cancelRef} disabled={busy} onClick={onCancel}>{cancelLabel}</button>
            <button type="button" className={'btn ' + (danger ? 'btn-destructive' : 'btn-primary')} disabled={busy || confirmDisabled} onClick={onConfirm} data-confirm="">
              {busy ? <><span className="cfm-spin" aria-hidden="true" />{busyLabel || 'Working…'}</> : confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
