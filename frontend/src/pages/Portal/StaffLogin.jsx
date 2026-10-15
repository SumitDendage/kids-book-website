import { useState } from 'react';
import { authApi, staffAuth } from '../../services/api.js';
import { isEmail } from '../../utils/format.js';

export const STAFF = {
  admin: { title: 'Admin account', kicker: 'Staff · admin', blurb: 'Customers, sheets, prices and access.' },
  developer: { title: 'Developer', kicker: 'Staff · developer', blurb: 'How the site and the server are running.' },
};

/* what to tell staff for each answer of POST /api/auth/login (the server's own codes) */
function loginProblem(e) {
  switch (e.code) {
    case 'bad_credentials': return 'We could not match that email and password. Check them and try again, or use Forgot password.';
    case 'account_locked': {
      const left = e.body && e.body.lockedUntil ? Math.max(1, Math.ceil((e.body.lockedUntil - Date.now()) / 60000)) : null;
      return 'Too many wrong passwords, so this account is locked' + (left ? ' for ' + left + ' more minute' + (left === 1 ? '' : 's') : ' for a while') + '. You can unlock it now with Forgot password.';
    }
    case 'not_staff': return 'This account is not a staff account. Customers sign in on the main site.';
    case 'account_suspended': return 'This account is blocked. Ask the shop owner to unblock it.';
    case 'email_unverified': return 'This email address is not confirmed yet. Open the email we sent you, press Accept & Continue, then sign in here.';
    case 'rate_limited': return 'Too many attempts. Wait a few minutes and try again.';
    case 'auth_unavailable': return 'Sign-in is briefly unavailable. Please try again in a minute.';
    case 'network': return 'We could not reach the server. Check your internet connection and try again.';
    default:
      if (e.status === 429) return 'Too many attempts. Wait a few minutes and try again.';
      if (e.status >= 500) return 'Something went wrong on our side. Please try again in a minute.';
      return e.message || 'That did not work. Please try again.';
  }
}

/* Staff sign in with their own account (made by an owner on the Roles page). There is no sign-up
   here; a forgotten password is reset by email like any other account. */
export default function StaffLogin({ kind, note, onSignedIn }) {
  const [view, setView] = useState('signin');   /* 'signin' | 'forgot' */
  const [alert, setAlert] = useState('');
  const [ok, setOk] = useState('');
  const [errs, setErrs] = useState({});
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState('');
  const cfg = STAFF[kind], forgot = view === 'forgot';
  const switchTo = v => { setView(v); setAlert(''); setOk(''); setErrs({}); };

  const signIn = async e => {
    e.preventDefault();
    if (busy) return;
    const f = new FormData(e.currentTarget);
    const em = String(f.get('email') || '').trim().toLowerCase(), pw = String(f.get('password') || '');
    const bad = {};
    if (!isEmail(em)) bad.email = 'Enter a valid email address.';
    if (!pw) bad.password = 'Enter your password.';
    setErrs(bad); setAlert('');
    if (Object.keys(bad).length) return;
    setBusy(true);
    try {
      const out = await staffAuth.login({ email: em, password: pw, remember: f.get('remember') === 'on' });
      setBusy(false);
      const name = out && out.user ? (out.user.name || out.user.email) : em;
      onSignedIn('Signed in as ' + name);
    } catch (err) {
      setBusy(false);
      const fe = (err.body && err.body.errors) || {};
      if (err.status === 400 && (fe.email || fe.password)) setErrs({ email: fe.email, password: fe.password });
      else setAlert(loginProblem(err));
    }
  };

  const sendReset = async e => {
    e.preventDefault();
    if (busy) return;
    const em = email.trim().toLowerCase();
    if (!isEmail(em)) { setErrs({ email: 'Enter a valid email address.' }); return; }
    setErrs({}); setAlert(''); setOk(''); setBusy(true);
    try {
      await authApi.forgotPassword({ email: em });
      setOk('If ' + em + ' has an account, a link to choose a new password is on its way. Check your inbox (and the spam folder). The link works once.');
    } catch (err) {
      if (err.code === 'mail_unavailable') setAlert('The server cannot send email just now. Please try again later, or ask the shop owner.');
      else if (err.status === 429) setAlert('Too many requests for this address. Wait a few minutes and try again.');
      else setAlert(loginProblem(err));
    }
    setBusy(false);
  };

  if (forgot) {
    return (
      <form className="panel portal-login" noValidate onSubmit={sendReset} aria-busy={busy ? 'true' : 'false'}>
        <h3 className="card-title" style={{ marginBottom: '6px' }}>Reset your password</h3>
        <p className="auth-sub">We will email you a link to choose a new password.</p>
        <div role="alert">{alert ? <div className="alert err">{alert}</div> : null}</div>
        <div role="status">{ok ? <div className="alert ok">{ok}</div> : null}</div>
        <div className="field"><label htmlFor="stResetEmail">Email</label><input id="stResetEmail" name="email" type="email" autoComplete="username" placeholder="you@learnwithwhy.in" value={email} onChange={e => setEmail(e.target.value)} aria-invalid={errs.email ? 'true' : undefined} aria-describedby="stResetEmailErr" /><div className="err" id="stResetEmailErr">{errs.email || ''}</div></div>
        <button type="submit" className="btn btn-primary btn-block" disabled={busy}>{busy ? 'Sending…' : 'Send the reset link'}</button>
        <p className="switch">Remembered it? <button type="button" className="link" onClick={() => switchTo('signin')}>Back to sign in</button></p>
      </form>
    );
  }
  return (
    <form className="panel portal-login" noValidate onSubmit={signIn} aria-busy={busy ? 'true' : 'false'}>
      <h3 className="card-title" style={{ marginBottom: '6px' }}>Sign in as staff</h3><p className="auth-sub">{cfg.blurb}</p>
      <div role="alert">{alert ? <div className="alert err">{alert}</div> : note ? <div className="alert info">{note}</div> : null}</div>
      <div className="field"><label htmlFor="stEmail">Email</label><input id="stEmail" name="email" type="email" autoComplete="username" placeholder="you@learnwithwhy.in" value={email} onChange={e => setEmail(e.target.value)} aria-invalid={errs.email ? 'true' : undefined} aria-describedby="stEmailErr" /><div className="err" id="stEmailErr">{errs.email || ''}</div></div>
      <div className="field"><label htmlFor="stPass">Password</label><input id="stPass" name="password" type="password" autoComplete="current-password" placeholder="Your password" aria-invalid={errs.password ? 'true' : undefined} aria-describedby="stPassErr" /><div className="err" id="stPassErr">{errs.password || ''}</div></div>
      <label className="portal-remember"><input type="checkbox" name="remember" id="stRemember" /> <span>Keep me signed in</span></label>
      <button type="submit" className="btn btn-primary btn-block" disabled={busy}>{busy ? 'Signing in…' : 'Sign in →'}</button>
      <p className="switch"><button type="button" className="link" onClick={() => switchTo('forgot')}>Forgot password?</button></p>
    </form>
  );
}
