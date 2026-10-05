import { useEffect, useRef, useState } from 'react';
import { useSite } from '../../context/SiteContext.jsx';
import { authApi } from '../../services/api.js';
import { write, logEvent, pushLog } from '../../services/storage.js';
import { isEmail, strongPass, dateOf } from '../../utils/format.js';
import { ROLES, roleOf, classById } from '../../data/content.js';

/* Two ways in: Sign up (name, email — the server emails a generated password and an
   Accept & Continue link that confirms the address) and Sign in. Forgot password emails a
   reset link; the link opens the new-password form here (view 'reset', token in auth.token).
   The role is asked after. Every branch below is one call to /api/auth/*. */
const COPY = {
  signup: { title: 'Let curiosity in.', sub: 'Create your account — we will email you a password and a link to confirm your address.', submit: 'Create account →' },
  signin: { title: 'Welcome back.', sub: 'Sign in to reach your cart and unlocked sheets.', submit: 'Sign in →' },
  forgot: { title: 'Forgot it? That happens.', sub: 'Tell us the email on the account and we will email you a link to choose a new password.', submit: 'Send reset link →' },
  reset: { title: 'Create a new password.', sub: 'Eight characters or more, with a number and a capital letter.', submit: 'Save new password →' },
};
const TAB_OF = { signup: 'signup', signin: 'signin', forgot: 'signin', reset: 'signin' };
const EMPTY = { name: '', email: '', pass: '', confirm: '' };

function Field({ id, label, show, error, children }) {
  return (
    <div className={'field' + (error ? ' bad' : '')} style={show ? undefined : { display: 'none' }}>
      <label htmlFor={id}>{label}</label>{children}<div className="err" id={id + 'Err'} role={error ? 'alert' : undefined}>{error || ''}</div>
    </div>
  );
}

export default function AuthCard() {
  const site = useSite();
  const { auth, access, setAuthView, setAuthAlert, signedIn, signOut, setRole, openShop, toast } = site;
  const session = access.session;
  const view = auth.view;
  const [f, setF] = useState(EMPTY);
  const [remember, setRemember] = useState(true);
  const [errs, setErrs] = useState({});
  const [busy, setBusy] = useState(false);
  const [showPass, setShowPass] = useState(false);
  const [changingRole, setChangingRole] = useState(false);
  const busyRef = useRef(false);

  /* a new view clears the field errors (and the alert, in the store) */
  useEffect(() => { setErrs({}); }, [auth.nonce]);
  /* signed in: the form is emptied */
  useEffect(() => { if (session) setF(EMPTY); }, [session]);

  const set = k => e => setF(x => ({ ...x, [k]: e.target.value }));
  /* not confirmed yet: a new email (fresh password + link) on request */
  const resend = email => authApi.resendVerification({ email })
    .then(r => setAuthAlert({ type: 'ok', msg: r.message }), err => setAuthAlert({ type: 'err', msg: err.message }));
  const shows = list => list.split(' ').includes(view);
  const copy = COPY[view];

  async function onSubmit(e) {
    e.preventDefault(); setAuthAlert(null); if (busyRef.current) return;
    const email = f.email.trim().toLowerCase(), pass = f.pass, confirm = f.confirm, name = f.name.trim();
    const errors = {};
    const bad = (k, msg) => { if (msg) errors[k] = msg; return !!msg; };
    const busyOn = on => { busyRef.current = on; setBusy(on); };
    try {
      if (view === 'signup') {
        const b = bad('auName', name ? '' : 'Tell us your name.') | bad('auEmail', isEmail(email) ? '' : 'Enter a valid email address.');
        setErrs(errors); if (b) return;
        busyOn(true); const r = await authApi.signup({ name, email });
        logEvent('signup', { email }); write('lww_seen', true);
        /* no session yet: the password is in the email, and the address must be confirmed first */
        setAuthView('signin'); setTimeout(() => setAuthAlert({ type: 'ok', msg: r.message }), 0);
      } else if (view === 'signin') {
        const b = bad('auEmail', isEmail(email) ? '' : 'Enter a valid email address.') | bad('auPass', pass ? '' : 'Enter your password.');
        setErrs(errors); if (b) return;
        busyOn(true);
        let r; try { r = await authApi.login({ email, password: pass, remember }); }
        catch (err) {
          if (err.status === 401) { logEvent('signin_failed', { email }); pushLog('lww_security', { at: Date.now(), type: 'failed_login', email, where: 'customer' }, 300); }
          if (err.body && err.body.code === 'email_unverified') { setAuthAlert({ type: 'err', msg: err.message, action: { label: 'Send the email again', run: () => resend(email) } }); return; }
          throw err;
        }
        logEvent('signin', { email }); write('lww_seen', true);
        await signedIn(r.user, 'Signed in — welcome back, ' + r.user.name, remember);
      } else if (view === 'forgot') {
        const b = bad('auEmail', isEmail(email) ? '' : 'Enter a valid email address.'); setErrs(errors); if (b) return;
        busyOn(true); const r = await authApi.forgotPassword({ email });
        setAuthAlert({ type: 'ok', msg: r.message });
      } else if (view === 'reset') {
        if (!auth.token) { setAuthView('forgot'); setTimeout(() => setAuthAlert({ type: 'err', msg: 'Open the reset link from your email, or ask for a new one here.' }), 0); return; }
        const b = bad('auPass', strongPass(pass)) | bad('auConfirm', confirm === pass ? '' : 'Both passwords must match.');
        setErrs(errors); if (b) return;
        busyOn(true);
        let r; try { r = await authApi.resetPassword({ token: auth.token, password: pass }); }
        catch (err) { if (/^token_/.test((err.body && err.body.code) || '')) { setAuthView('forgot'); setTimeout(() => setAuthAlert({ type: 'err', msg: err.message }), 0); return; } throw err; }
        setAuthView('signin'); setTimeout(() => setAuthAlert({ type: 'ok', msg: r.message }), 0);
      }
    } catch (err) {
      const fe = err.body && err.body.errors; if (fe) setErrs({ auName: fe.name, auEmail: fe.email, auPass: fe.password });
      setAuthAlert({ type: 'err', msg: err.status === 0 || /fetch/i.test(err.message) ? 'Cannot reach the server — start it with npm start in site/.' : err.message });
    } finally { busyOn(false); }
  }

  const pickRole = id => {
    setRole(id); setChangingRole(false);
    toast(roleOf(id).label + ' account — pick a class to subscribe to');
    setTimeout(() => openShop('all'), 450);
  };
  const hasRole = !!(session && session.role) && !changingRole;
  const subs = access.subsOf();
  const Link = ({ to, children }) => <button type="button" className="link" onClick={() => setAuthView(to)}>{children}</button>;
  const switchLine = {
    signup: <>Already have an account? <Link to="signin">Sign in</Link> &nbsp;·&nbsp; <Link to="forgot">Forgot password?</Link></>,
    signin: <>New here? <Link to="signup">Sign up</Link></>,
    forgot: <>Remembered it? <Link to="signin">Sign in</Link></>,
    reset: <Link to="signin">Back to sign in</Link>,
  }[view];

  return (
    <div className={'panel auth-card rise' + (session ? ' is-signed' : '')} id="authCard" style={{ '--i': 2 }}>
      <p className="eyebrow">01 / Your adventure starts here</p>
      <div className="guest">
        <div className="tabs" role="tablist">
          <button type="button" className={'tab' + (TAB_OF[view] === 'signup' ? ' on' : '')} role="tab" aria-selected={TAB_OF[view] === 'signup'} onClick={() => setAuthView('signup')}>Sign up</button>
          <button type="button" className={'tab' + (TAB_OF[view] === 'signin' ? ' on' : '')} role="tab" aria-selected={TAB_OF[view] === 'signin'} onClick={() => setAuthView('signin')}>Sign in</button>
        </div>
        <form id="authForm" noValidate onSubmit={onSubmit}>
          <h2 className="card-title" id="authTitle">{copy.title}</h2>
          <p className="auth-sub" id="authSub">{copy.sub}</p>
          <div id="authAlert" aria-live="polite">{auth.alert && <div className={'alert ' + auth.alert.type}>{auth.alert.msg}{auth.alert.action && <> <button type="button" className="link" onClick={auth.alert.action.run}>{auth.alert.action.label}</button></>}</div>}</div>
          <Field id="auName" label="Your name" show={shows('signup')} error={errs.auName}><input id="auName" type="text" autoComplete="name" placeholder="Your name" value={f.name} onChange={set('name')} /></Field>
          <Field id="auEmail" label="Email address" show={shows('signup signin forgot')} error={errs.auEmail}><input id="auEmail" type="email" autoComplete="email" placeholder="you@example.com" value={f.email} onChange={set('email')} /></Field>
          <Field id="auPass" label={view === 'reset' ? 'New password' : 'Password'} show={shows('signin reset')} error={errs.auPass}>
            <div className="pw-wrap"><input id="auPass" type={showPass ? 'text' : 'password'} autoComplete={view === 'signin' ? 'current-password' : 'new-password'} placeholder="At least 8 characters" value={f.pass} onChange={set('pass')} /><button type="button" className="pw-toggle" id="pwToggle" aria-label={showPass ? 'Hide password' : 'Show password'} onClick={() => setShowPass(v => !v)}>{showPass ? 'HIDE' : 'SHOW'}</button></div>
          </Field>
          <Field id="auConfirm" label="Confirm password" show={shows('reset')} error={errs.auConfirm}><input id="auConfirm" type="password" autoComplete="new-password" placeholder="Once more" value={f.confirm} onChange={set('confirm')} /></Field>
          <div className="between" style={shows('signin') ? undefined : { display: 'none' }}><label className="check"><input type="checkbox" id="auRemember" checked={remember} onChange={e => setRemember(e.target.checked)} /> Keep me signed in</label><button type="button" className="link" onClick={() => setAuthView('forgot')}>Forgot password?</button></div>
          <button type="submit" className="btn btn-primary btn-block" id="authSubmit" disabled={busy}>{busy ? 'One moment…' : copy.submit}</button>
          <p className="switch" id="authSwitch">{switchLine}</p>
        </form>
      </div>
      <div className="signed">
        <h2 className="card-title">You&apos;re in, <span id="signedName">{session ? session.name : ''}</span>.</h2>
        <div id="rolePick" hidden={hasRole}>
          <p className="auth-sub">One more thing — who are the sheets for?</p>
          <div className="roles" id="auRoles">
            {ROLES.map(r => (
              <button key={r.id} type="button" className={'role' + (session && session.role === r.id ? ' on' : '')} aria-pressed={!!session && session.role === r.id} onClick={() => pickRole(r.id)}>
                <span>{r.label}</span><small>{{ parent: 'at home', teacher: 'classroom', tutor: 'small groups', school: 'whole school' }[r.id]}</small>
              </button>
            ))}
          </div>
        </div>
        <p className="auth-sub" id="roleLine" hidden={!hasRole}><span id="signedRole">{hasRole ? roleOf(session.role).label : ''}</span> account — your subscriptions and free sheets are kept with it. <button type="button" className="link" id="roleChange" onClick={() => setChangingRole(true)}>Change</button></p>
        <p className="auth-sub" id="subLine" hidden={!hasRole}>
          {subs.length
            ? <>Subscribed to {subs.map((x, n) => <span key={x.cls}>{n ? ', ' : ''}<b>{classById(x.cls).label}</b> {x.end ? 'until ' + dateOf(x.end) : 'since ' + dateOf(x.start)}</span>)}.</>
            : <>Your sheets are under My Account → My Worksheets — <button type="button" className="link" onClick={() => openShop('all')}>browse all sheets</button>.</>}
        </p>
        <div className="btn-row"><button type="button" className="btn btn-primary" onClick={() => openShop('all')}>Explore the sheets →</button><button type="button" className="btn btn-ghost" id="signOutBtn" onClick={signOut}>Sign out</button></div>
      </div>
    </div>
  );
}
