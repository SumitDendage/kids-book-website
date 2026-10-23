import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSite } from '../../context/SiteContext.jsx';
import { staffAuth } from '../../services/api.js';
import StaffLogin, { STAFF } from './StaffLogin.jsx';
import Dashboard from './Dashboard.jsx';
import { canWith, panelAllowed, problem, ROLE_LABEL } from './dashboard.js';
import '../../styles/admin.css';   /* the staff look, downloaded with these pages and not before */

const FADE_MS = 450;   /* .shop fades out in 0.45 s */

/* The staff page (/admin and /developer): opens over the site like the store does.
   Signed out → the staff sign-in. Signed in → the server says who this is (GET /api/admin/me)
   and what they may do; the dashboard shows only that. */
export default function Portal({ kind }) {
  const site = useSite();
  const { toast, portalCloser, closeDrawers, closeModal, closeCheckout } = site;
  const navigate = useNavigate();
  const ref = useRef(null);
  const [open, setOpen] = useState(false);
  /* 'checking' → asking the server; 'in' → signed in; 'out' → the sign-in form; 'error' → could not ask */
  const [state, setState] = useState(() => (staffAuth.signedIn() ? 'checking' : 'out'));
  const [me, setMe] = useState(null);
  const [note, setNote] = useState('');
  const [err, setErr] = useState(null);

  /* fade in on the next frame, so the transition runs */
  useEffect(() => {
    closeDrawers(); closeModal(); closeCheckout();
    const raf = requestAnimationFrame(() => setOpen(true));
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { if (ref.current) ref.current.scrollTop = 0; }, [kind, state]);

  /* who is signed in, and with which permissions (asked again when the tab comes back) */
  const check = useCallback(async quiet => {
    if (!staffAuth.signedIn()) { setMe(null); setState('out'); return; }
    if (!quiet) setState(s => (s === 'in' ? s : 'checking'));
    try {
      const m = await staffAuth.me();
      setMe(m); setErr(null); setState('in');
    } catch (e) {
      if (e.status === 401 || e.status === 403) {
        await staffAuth.logout();
        setMe(null); setState('out');
        setNote(e.status === 401 ? 'Your staff sign-in has ended. Please sign in again.'
          : e.code === 'account_suspended' ? 'This account is blocked. Ask the shop owner to unblock it.'
            : 'This account is not a staff account any more. Ask the shop owner if you need access.');
      } else if (!quiet) { setErr(e); setState('error'); }
    }
  }, []);
  useEffect(() => { check(); }, [check]);
  useEffect(() => {
    const onVis = () => { if (document.visibilityState === 'visible' && staffAuth.signedIn()) check(true); };
    const onStore = e => { if (e.key === null || e.key === 'lww_staff_tokens') check(true); };
    document.addEventListener('visibilitychange', onVis);
    addEventListener('storage', onStore);
    return () => { document.removeEventListener('visibilitychange', onVis); removeEventListener('storage', onStore); };
  }, [check]);

  /* close: fade out, then leave the route (the site stays where it was) */
  const close = useCallback(() => {
    setOpen(false);
    setTimeout(() => navigate('/' + window.location.hash), FADE_MS);
  }, [navigate]);
  useEffect(() => { portalCloser.current = close; return () => { portalCloser.current = null; }; }, [portalCloser, close]);

  const signOut = useCallback(async () => {
    await staffAuth.logout();
    setMe(null); setNote(''); setState('out');
    toast('Signed out');
  }, [toast]);
  /* a call answered 401: the sign-in ended (it ran out, or the owner removed this staff member) */
  const authLost = useCallback(() => {
    setMe(null); setState('out');
    setNote('Your staff sign-in has ended. Please sign in again.');
    staffAuth.logout();
  }, []);
  const signedIn = useCallback(async (msg) => { setNote(''); await check(); if (msg) toast(msg); }, [check, toast]);

  const cfg = STAFF[kind];
  const can = canWith(me);
  const inn = state === 'in' && !!me && panelAllowed(kind, can);
  let body;
  if (state === 'checking') body = <div className="panel portal-login" aria-busy="true"><p className="auth-sub" role="status">Checking your staff sign-in…</p></div>;
  else if (state === 'error') body = (
    <div className="panel portal-login" role="alert">
      <h3 className="card-title">We could not open the panel</h3>
      <p className="auth-sub">{problem(err)}</p>
      <button type="button" className="btn btn-primary btn-block" onClick={() => check()}>Try again</button>
      <p className="switch"><button type="button" className="link" onClick={signOut}>Sign out</button></p>
    </div>
  );
  else if (state === 'in' && me && !inn) body = (
    <div className="panel portal-login" role="alert">
      <h3 className="card-title">{kind === 'developer' ? 'No developer access' : 'No admin access'}</h3>
      <p className="auth-sub">You are signed in as {me.user.name || me.user.email} ({ROLE_LABEL[me.staff.role] || me.staff.role}). {kind === 'developer' ? 'Your staff role cannot open the developer panel.' : 'Your staff role cannot open any part of the admin panel.'} Ask an owner if you need it.</p>
      {kind === 'developer' && panelAllowed('admin', can) ? <button type="button" className="btn btn-primary btn-block" onClick={() => navigate('/admin')}>Open the admin panel</button> : null}
      <p className="switch"><button type="button" className="link" onClick={signOut}>Sign out</button></p>
    </div>
  );
  else if (inn) body = <Dashboard kind={kind} me={me} site={site} portalRef={ref} onSwitch={k => navigate('/' + k)} onBack={close} onSignOut={signOut} authLost={authLost} reloadMe={check} />;
  else body = <StaffLogin key={kind} kind={kind} note={note} onSignedIn={signedIn} />;

  return (
    <div className={'shop' + (open ? ' open' : '') + (inn ? ' is-dash' : '')} id="portal" ref={ref} role="dialog" aria-label={cfg.title} aria-hidden={open ? 'false' : 'true'}>
      <div className="shop-shade" style={{ background: '#071018' }} />
      <header className="shop-bar">
        <div><p className="eyebrow" id="portalKicker">{cfg.kicker}</p><h2 className="card-title" id="portalTitle">{cfg.title}</h2></div>
        <div className="shop-actions"><button type="button" className="btn btn-ghost" id="portalOut" hidden={state !== 'in' && state !== 'error'} onClick={signOut}>Sign out</button><button type="button" className="icon-btn" id="portalClose" aria-label="Back to the site" onClick={close}>✕</button></div>
      </header>
      <div className="portal-body" id="portalBody">{body}</div>
    </div>
  );
}
