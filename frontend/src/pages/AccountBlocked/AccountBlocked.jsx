import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSecurity } from '../../context/SecurityContext.jsx';
import { useSite } from '../../context/SiteContext.jsx';
import { SUPPORT_EMAIL, mailTo, onAccountBlockedChange, readAccountBlocked } from '../../services/security.js';
import LogoTile from '../../components/common/LogoTile.jsx';

/* /account-blocked: what a customer sees when the server says the whole account is suspended
   (403 account_suspended: every sign-in has ended), or, when signed in, that paid sheets are
   paused. It opens over the site like the store does, so the free pages stay one tap away
   (✕, Escape or "Back to the home page"). The page enforces nothing: the server refuses the
   sign-in and the protected sheets by itself. */
export default function AccountBlocked() {
  const sec = useSecurity();
  const { session, closeDrawers, closeModal, closeCheckout, closeShop, closeNotice, openAccount } = useSite();
  const navigate = useNavigate();
  const headRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState(readAccountBlocked);

  /* fade in on the next frame, over whatever was open */
  useEffect(() => {
    closeDrawers(); closeModal(); closeCheckout(); closeShop(); closeNotice();
    const raf = requestAnimationFrame(() => setOpen(true));
    const off = onAccountBlockedChange(() => setNote(readAccountBlocked()));
    return () => { cancelAnimationFrame(raf); off(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const home = () => navigate('/');
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') navigate('/'); };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [navigate]);

  const support = (sec && sec.supportEmail) || SUPPORT_EMAIL;
  const suspended = !!note && !session;
  const paused = !!session && ((sec && sec.paused) || session.accessStatus === 'suspended');
  const checking = !!session && !paused && !!sec && !sec.status && (sec.loading || !sec.error);
  const variant = suspended ? 'suspended' : paused ? 'paused' : checking ? 'checking' : 'none';
  useEffect(() => { if (open && headRef.current) headRef.current.focus(); }, [open, variant]);

  let body;
  if (variant === 'suspended') {
    const who = note.email;
    body = (
      <>
        <p className="eyebrow">Account security</p>
        <h1 className="sec-blocked-title" id="blockedTitle" tabIndex={-1} ref={headRef}>This account is suspended</h1>
        <p className="sec-blocked-text">{who ? <>The account for <b>{who}</b> has been suspended,</> : 'This account has been suspended,'} so it cannot be signed in to right now. If you think this is a mistake, write to us and we will look at it.</p>
        <div className="sec-blocked-actions">
          <a className="btn btn-primary" href={mailTo(support, 'My account is suspended' + (who ? ' (' + who + ')' : ''))}>Write to us</a>
          <button type="button" className="btn btn-ghost" onClick={home}>Back to the home page</button>
        </div>
        <p className="sec-blocked-mail">Our email: <a className="link" href={mailTo(support)}>{support}</a></p>
        <p className="sec-blocked-foot">The free pages of the site stay open to everyone.</p>
      </>
    );
  } else if (variant === 'paused') {
    body = (
      <>
        <p className="eyebrow">Account security</p>
        <h1 className="sec-blocked-title" id="blockedTitle" tabIndex={-1} ref={headRef}>Paid sheets are paused</h1>
        <p className="sec-blocked-text">Paid sheets are paused on this account under our account-sharing rules. Free sheets still open, and you can still sign in and see your orders. If you think this is a mistake, send us a note from My Account → Security.</p>
        <div className="sec-blocked-actions">
          <button type="button" className="btn btn-primary" onClick={() => { navigate('/'); setTimeout(() => openAccount('security'), 50); }}>Open My Account → Security</button>
          <button type="button" className="btn btn-ghost" onClick={sec.signOut}>Sign out</button>
        </div>
        <p className="sec-blocked-mail">Or email us: <a className="link" href={mailTo(support, 'Paid sheets are paused on my account')}>{support}</a></p>
        <p className="sec-blocked-foot">The free pages of the site stay open. <button type="button" className="link" onClick={home}>Back to the home page</button></p>
      </>
    );
  } else if (variant === 'checking') {
    body = <p className="sec-card-note" role="status"><span className="sec-spin" aria-hidden="true" />Checking your account…</p>;
  } else {
    body = (
      <>
        <p className="eyebrow">Account security</p>
        <h1 className="sec-blocked-title sm" id="blockedTitle" tabIndex={-1} ref={headRef}>Nothing is blocked here</h1>
        <p className="sec-blocked-text">{session ? 'Your account is open and your sheets work as usual.' : 'There is nothing to show for this browser. If you were signed out, you can sign in again from the home page.'}</p>
        <div className="sec-blocked-actions"><button type="button" className="btn btn-primary" onClick={home}>Back to the home page</button></div>
      </>
    );
  }
  return (
    <div className={'sec-blocked' + (open ? ' open' : '')} role="dialog" aria-modal="true" aria-labelledby="blockedTitle" aria-busy={variant === 'checking' ? 'true' : 'false'} data-variant={variant}>
      <button type="button" className="icon-btn sec-blocked-x" aria-label="Back to the site" onClick={home}>✕</button>
      <div className="panel sec-blocked-card">
        <LogoTile as="span" />
        {body}
      </div>
    </div>
  );
}
