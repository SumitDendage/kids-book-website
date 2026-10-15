import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useSite } from './SiteContext.jsx';
import { getSiteRules, isPaused, normalizeStatus, securityService, SUPPORT_EMAIL, unreadWarnings } from '../services/security.js';
import SecurityWarningModal from '../components/security/SecurityWarningModal.jsx';
import AccountNotice from '../components/security/AccountNotice.jsx';

/* Account security for the signed-in customer, on top of the site store (SiteContext):
   - asks the server for the security status (GET /api/me/security) after sign-in, when the
     page comes back into view, and every few minutes while it is open;
   - shows the Security Warning popup once for each new warning, oldest first. "I Understand"
     tells the server it was read (POST /api/me/security/acknowledge); the count never changes here;
   - keeps the site's copy of "paid sheets paused" in step with the server;
   - shows the site's notices (access ended, sign-in stopped, paid sheets paused, ...).
   The server decides everything: no status is made up or kept in this browser. */
const SecurityContext = createContext(null);
export const useSecurity = () => useContext(SecurityContext);

const POLL = 4 * 60e3;          /* every few minutes while the page is open and in view */
const FOCUS_GAP = 30e3;         /* coming back to the page asks again, at most this often */
const AFTER_SIGNIN = 8e3;       /* the sharing rules look at a new sign-in just after it: ask again then */
const EMPTY = { email: null, status: null, loading: false, error: null };

export function SecurityProvider({ children }) {
  const site = useSite();
  const { session, siteStage, portalKind, securitySeed, securityNonce, securityLock, notice, closeNotice, noteAccessStatus } = site;
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const email = session ? session.email : null;
  const [state, setState] = useState(EMPTY);
  const [acked, setAcked] = useState(() => new Set());   /* warnings read on this page (even if saving that failed) */
  const [supportEmail, setSupportEmail] = useState(SUPPORT_EMAIL);
  const emailRef = useRef(email), lastLoad = useRef(0), seq = useRef(0);
  emailRef.current = email;

  useEffect(() => { let alive = true; getSiteRules().then(r => { if (alive) setSupportEmail(r.supportEmail); }); return () => { alive = false; }; }, []);

  const apply = useCallback((who, status) => {
    if (!status || who !== emailRef.current) return;
    setState({ email: who, status, loading: false, error: null });
    noteAccessStatus(status.accessStatus);
  }, [noteAccessStatus]);

  const load = useCallback(async () => {
    const who = emailRef.current;
    if (!who) return null;
    const n = ++seq.current; lastLoad.current = Date.now();
    setState(s => (s.email === who ? { ...s, loading: true, error: null } : { email: who, status: null, loading: true, error: null }));
    try {
      const status = await securityService.status();
      if (n === seq.current) apply(who, status);
      return status;
    } catch (err) {
      if (n === seq.current && who === emailRef.current) {
        setState(s => ({ ...s, loading: false, error: err.status === 0 ? 'We could not reach Learn With Why just now.' : err.message }));
      }
      return null;
    }
  }, [apply]);

  /* a new customer (or sign-out) starts from scratch; a fresh sign-in answer is used straight away */
  useEffect(() => {
    setAcked(new Set());
    if (!email) { seq.current++; setState(EMPTY); return undefined; }
    const seed = securitySeed && securitySeed.email === email && Date.now() - securitySeed.at < 60e3 ? normalizeStatus(securitySeed.status) : null;
    let t = 0;
    if (seed) { apply(email, seed); lastLoad.current = Date.now(); t = setTimeout(load, AFTER_SIGNIN); }
    else load();
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [email]);

  /* someone asked for a fresh status (a block came back from another call) */
  useEffect(() => { if (securityNonce) load(); }, [securityNonce, load]);

  /* back on the page, and every few minutes while it is in view */
  useEffect(() => {
    if (!email) return undefined;
    const onBack = () => { if (document.visibilityState !== 'hidden' && Date.now() - lastLoad.current > FOCUS_GAP) load(); };
    const iv = setInterval(() => { if (document.visibilityState === 'visible') load(); }, POLL);
    addEventListener('focus', onBack);
    document.addEventListener('visibilitychange', onBack);
    return () => { clearInterval(iv); removeEventListener('focus', onBack); document.removeEventListener('visibilitychange', onBack); };
  }, [email, load]);

  const status = state.email === email ? state.status : null;
  const unread = unreadWarnings(status).filter(w => !acked.has(w.id));
  const current = unread[0] || null;
  const onBlockedPage = pathname === '/account-blocked';
  const warningOpen = !!(email && current && siteStage === 'site' && !portalKind && !onBlockedPage);
  /* the popup owns the keys and the wheel while it is open */
  useEffect(() => { securityLock.current = warningOpen; return () => { securityLock.current = false; }; }, [warningOpen, securityLock]);

  /* "I Understand": close this warning now and tell the server it was read */
  const acknowledge = useCallback(() => {
    if (!current) return;
    const w = current, who = email;
    setAcked(s => new Set(s).add(w.id));
    securityService.acknowledge(w.upTo).then(st => apply(who, st)).catch(err => console.warn('security: the warning was not marked as read (' + err.message + ')'));
  }, [current, email, apply]);

  const signOutHere = useCallback(() => { site.signOut(); navigate('/'); }, [site, navigate]);
  const openBlockedPage = useCallback(() => navigate('/account-blocked'), [navigate]);
  const last = status && status.warnings.length ? status.warnings[status.warnings.length - 1] : null;

  const value = {
    email, status, loading: state.loading, error: state.error, paused: isPaused(status), supportEmail,
    reload: load, acknowledge, signOut: signOutHere, openBlockedPage,
  };
  return (
    <SecurityContext.Provider value={value}>
      {children}
      {notice ? <AccountNotice notice={notice} onClose={closeNotice} supportEmail={supportEmail} /> : null}
      {warningOpen ? (
        <SecurityWarningModal
          key={current.id}
          level={current.level}
          max={status.maxWarnings}
          reason={current.reason}
          endsAt={current.expiresAt}
          paused={isPaused(status) && (current.level >= status.maxWarnings || (last && last.id === current.id))}
          timeZone={session && session.timeZone}
          supportEmail={supportEmail}
          onAcknowledge={acknowledge}
        />
      ) : null}
    </SecurityContext.Provider>
  );
}
