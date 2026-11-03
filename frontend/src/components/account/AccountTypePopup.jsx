import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSite } from '../../context/SiteContext.jsx';
import { ACCOUNT_TYPES, printsText } from '../../data/content.js';

/* "Who will use these sheets?" Asked once, right after "Create my account" (AuthCard passes onChoose
   and the new name; the choice is saved at the account's first sign-in), or, for an account that
   still has no type, after it signs in (SiteContext's askRole: signed in, no account type yet, never
   staff; saved here with PATCH /api/auth/me { role }). Parent, Teacher or Organization, each with the
   prints per sheet it gets (GET /api/config prints, which staff change in Admin → Settings). It cannot
   be changed here afterwards. There is no close button: Escape does nothing, Tab stays inside, the
   page behind is inert, and the arrow keys move between the three choices (they are radio buttons). */
export default function AccountTypePopup({ onChoose, name } = {}) {
  const { session, printsTable, chooseAccountType } = useSite();
  const uid = useId(), titleId = uid + 'title', bodyId = uid + 'body';
  const boxRef = useRef(null), firstRef = useRef(null);
  const [pick, setPick] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const prev = document.activeElement, root = document.getElementById('root'), wasInert = root ? root.inert : false;
    if (root) root.inert = true;
    const t = setTimeout(() => { if (firstRef.current) firstRef.current.focus(); }, 60);
    const box = boxRef.current;
    const onKey = e => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); return; }
      e.stopPropagation();   /* arrows and space must not move the page behind */
      if (e.key !== 'Tab') return;
      /* the three choices are one stop for Tab (the arrows move inside it), then the button */
      const radios = Array.from(box.querySelectorAll('input[type="radio"]:not([disabled])'));
      const f = [radios.find(r => r.checked) || radios[0], box.querySelector('button:not([disabled])')].filter(Boolean);
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    box.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(t);
      box.removeEventListener('keydown', onKey);
      if (root) root.inert = wasInert;
      if (prev && prev.focus && document.contains(prev)) prev.focus();
    };
  }, []);

  const save = async e => {
    e.preventDefault();
    if (!pick || busy) { if (!pick) setError('Choose one of the three to carry on.'); return; }
    setBusy(true); setError('');
    try {
      if (onChoose) { await onChoose(pick); return; }
      const ok = await chooseAccountType(pick);
      if (!ok) { setError('We could not save that just now. Please try again.'); setBusy(false); }
      /* saved: the popup closes by itself, the account now has a type */
    } catch (err) {
      setError(err.status === 0 ? 'We could not reach Learn With Why just now. Check your connection and try again.' : err.message || 'That did not work. Please try again.');
      setBusy(false);
    }
  };

  const first = String(name || (session && session.name) || '').trim().split(/\s+/)[0];
  return createPortal(
    <div className="type-scrim" onWheel={e => e.stopPropagation()} onTouchMove={e => e.stopPropagation()}>
      <form className="panel type-card" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={bodyId} ref={boxRef} onSubmit={save} noValidate>
        <p className="eyebrow">{first ? 'Welcome, ' + first : 'Welcome'}</p>
        <h2 id={titleId} className="type-title">Who will use these sheets?</h2>
        <p id={bodyId} className="type-sub">Pick the one that fits you best. It sets how many times you can print each sheet.</p>
        <div className="type-choices" role="radiogroup" aria-labelledby={titleId}>
          {ACCOUNT_TYPES.map((t, i) => {
            const n = printsTable[t.key];
            return (
              <label key={t.id} className={'type-choice' + (pick === t.id ? ' on' : '')} data-type={t.key}>
                <input ref={i === 0 ? firstRef : undefined} type="radio" name="accountType" value={t.id} checked={pick === t.id} disabled={busy}
                  onChange={() => { setPick(t.id); setError(''); }} />
                <span className="type-name"><b>{t.label}</b><small>{t.hint}</small></span>
                <span className="type-prints"><b>{n}</b><small>{n === 1 ? 'print' : 'prints'} per sheet</small></span>
              </label>
            );
          })}
        </div>
        <p className="type-once">You choose once.</p>
        {error ? <div className="alert err" role="alert">{error}</div> : null}
        <button type="submit" className="btn btn-primary btn-block type-go" disabled={busy || !pick}>
          {busy ? 'Saving…' : pick ? 'Continue as ' + ACCOUNT_TYPES.find(t => t.id === pick).label + ' · ' + printsText(printsTable[ACCOUNT_TYPES.find(t => t.id === pick).key]).toLowerCase() : 'Choose one to continue'}
        </button>
      </form>
    </div>,
    document.body,
  );
}
