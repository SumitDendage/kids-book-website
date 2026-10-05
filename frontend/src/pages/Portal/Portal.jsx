import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSite } from '../../context/SiteContext.jsx';
import { staffSession, setStaffSession } from '../../services/storage.js';
import StaffLogin, { STAFF } from './StaffLogin.jsx';
import Dashboard from './Dashboard.jsx';

const FADE_MS = 450;   /* .shop fades out in 0.45 s */

/* The staff page (/admin and /developer): opens over the site like the store does.
   Signed out → the staff sign-in; signed in as this kind → the dashboard. */
export default function Portal({ kind }) {
  const site = useSite();
  const { toast, portalCloser, closeDrawers, closeModal, closeCheckout } = site;
  const navigate = useNavigate();
  const ref = useRef(null);
  const [open, setOpen] = useState(false);
  const [, setTick] = useState(0);
  const who = staffSession(), inn = !!(who && who.kind === kind);

  /* fade in on the next frame, so the transition runs */
  useEffect(() => {
    closeDrawers(); closeModal(); closeCheckout();
    const raf = requestAnimationFrame(() => setOpen(true));
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { if (ref.current) ref.current.scrollTop = 0; }, [kind, inn]);

  /* close: fade out, then leave the route (the site stays where it was) */
  const close = useCallback(() => {
    setOpen(false);
    setTimeout(() => navigate('/' + window.location.hash), FADE_MS);
  }, [navigate]);
  useEffect(() => { portalCloser.current = close; return () => { portalCloser.current = null; }; }, [portalCloser, close]);

  const signOut = () => { setStaffSession(null); setTick(t => t + 1); };
  const signedIn = msg => { setTick(t => t + 1); toast(msg); };
  const cfg = STAFF[kind];
  return (
    <div className={'shop' + (open ? ' open' : '') + (inn ? ' is-dash' : '')} id="portal" ref={ref} role="dialog" aria-label={cfg.title} aria-hidden={open ? 'false' : 'true'}>
      <div className="shop-shade" style={{ background: '#071018' }} />
      <header className="shop-bar">
        <div><p className="eyebrow" id="portalKicker">{cfg.kicker}</p><h2 className="card-title" id="portalTitle">{cfg.title}</h2></div>
        <div className="shop-actions"><button type="button" className="btn btn-ghost" id="portalOut" hidden={!inn} onClick={signOut}>Sign out</button><button type="button" className="icon-btn" id="portalClose" aria-label="Back to the site" onClick={close}>✕</button></div>
      </header>
      <div className="portal-body" id="portalBody">
        {inn
          ? <Dashboard kind={kind} who={who} site={site} portalRef={ref} onSwitch={k => navigate('/' + k)} onBack={close} onSignOut={signOut} />
          : <StaffLogin key={kind} kind={kind} onSignedIn={signedIn} />}
      </div>
    </div>
  );
}
