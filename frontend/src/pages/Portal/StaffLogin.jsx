import { useState } from 'react';
import { authApi, staffAuth } from '../../services/api.js';
import { isEmail, strongPass } from '../../utils/format.js';

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
    case 'not_staff': return 'This account is not on the staff list yet. Ask the shop owner to add your email on Admin → Roles, then sign in again.';
    case 'account_suspended': return 'This account is blocked. Ask the shop owner to unblock it.';
    case 'email_unverified': return 'This email address is not confirmed yet. Open the email we sent you, press Accept & Continue, then sign in here.';
    case 'rate_limited': return 'Too many attempts. Wait a few minutes and try again.';
    case 'auth_unavailable': return 'Sign-in is briefly unavailable. Please try again in a minute.';
    case 'invalid_otp': return 'That code is not right. Use the code from the newest email we sent.';
    case 'otp_expired': return 'That code has expired or was already used. Sign in again to get a new one.';
    case 'otp_attempts_exceeded': return 'Too many wrong codes. Sign in again to get a new one.';
    case 'mail_unavailable': return 'The server cannot send the sign-in code just now. Please try again later.';
    case 'network': return 'We could not reach the server. Check your internet connection and try again.';
    default:
      if (e.status === 429) return 'Too many attempts. Wait a few minutes and try again.';
      if (e.status >= 500) return 'Something went wrong on our side. Please try again in a minute.';
      return e.message || 'That did not work. Please try again.';
  }
}

const zone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined; } catch (_) { return undefined; } };

/* Staff sign in with their own account. A new person can make an account here (no email service
   needed), but it opens the panels only after an owner adds that email on Admin → Roles; the
   server decides who is staff, never this form. A forgotten password is reset by email. */
export default function StaffLogin({ kind, note, onSignedIn }) {
  const [view, setView] = useState('signin');   /* 'signin' | 'code' | 'signup' | 'forgot' */
  const [challenge, setChallenge] = useState(null);   /* { challengeId, email } after the password */
  const [code, setCode] = useState('');
  const [alert, setAlert] = useState('');
  const [ok, setOk] = useState('');
  const [errs, setErrs] = useState({});
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
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
      const out = await staffAuth.login({ email: em, password: pw, remember: true });
      setBusy(false);
      /* the server emailed a 6-digit code: the panel opens once it is typed in */
      if (out && out.otpRequired) {
        setChallenge({ challengeId: out.challengeId, email: out.email || em });
        setCode(''); setView('code');
        setOk('We sent a 6-digit sign-in code to ' + (out.email || em) + '. Check your inbox and the spam folder.');
        return;
      }
      const name = out && out.user ? (out.user.name || out.user.email) : em;
      onSignedIn('Signed in as ' + name);
    } catch (err) {
      setBusy(false);
      const fe = (err.body && err.body.errors) || {};
      if (err.status === 400 && (fe.email || fe.password)) setErrs({ email: fe.email, password: fe.password });
      else setAlert(loginProblem(err));
    }
  };

  const sendCode = async e => {
    e.preventDefault();
    if (busy) return;
    const c = code.replace(/\s+/g, '');
    if (!/^\d{6}$/.test(c)) { setErrs({ code: 'Enter the 6-digit code from the email.' }); return; }
    if (!challenge) { switchTo('signin'); return; }
    setErrs({}); setAlert(''); setBusy(true);
    try {
      const out = await staffAuth.verifyOtp({ challengeId: challenge.challengeId, code: c });
      setBusy(false); setChallenge(null);
      const name = out && out.user ? (out.user.name || out.user.email) : challenge.email;
      onSignedIn('Signed in as ' + name);
    } catch (err) {
      setBusy(false); setOk('');
      setAlert(loginProblem(err));
      /* a used-up or locked code cannot be tried again: back to the password */
      if (['otp_expired', 'otp_attempts_exceeded', 'signin', 'account_unavailable', 'agreement_updated'].includes(err.code)) { setChallenge(null); setView('signin'); }
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

  const signUp = async e => {
    e.preventDefault();
    if (busy) return;
    const f = new FormData(e.currentTarget);
    const nm = name.trim(), em = email.trim().toLowerCase(), pw = String(f.get('password') || ''), cf = String(f.get('confirm') || '');
    const bad = {};
    if (!nm) bad.name = 'Tell us your name.'; else if (nm.length > 80) bad.name = 'Keep the name under 80 letters.';
    if (!isEmail(em)) bad.email = 'Enter a valid email address.';
    const weak = strongPass(pw); if (weak) bad.password = weak;
    if (!bad.password && cf !== pw) bad.confirm = 'Both passwords must match.';
    setErrs(bad); setAlert(''); setOk('');
    if (Object.keys(bad).length) return;
    setBusy(true);
    try {
      const r = await authApi.signup({ name: nm, email: em, password: pw, timeZone: zone() });
      setBusy(false); setView('signin'); setErrs({});
      setOk(r && r.ready
        ? 'Your account is made. Ask the shop owner to add ' + em + ' on Admin → Roles, then sign in here with your password.'
        : 'Your account is made. Open the email we sent to ' + em + ' to confirm it, ask the shop owner to add you on Admin → Roles, then sign in here.');
    } catch (err) {
      setBusy(false);
      if (err.code === 'email_taken') { setView('signin'); setErrs({}); setAlert('That email already has an account. Sign in with its password. If it is not on the staff list yet, ask the shop owner to add it on Admin → Roles.'); }
      else if (err.code === 'weak_password') setErrs({ password: err.message });
      else setAlert(loginProblem(err));
    }
  };

  if (view === 'signup') {
    return (
      <form className="panel portal-login" noValidate onSubmit={signUp} aria-busy={busy ? 'true' : 'false'}>
        <h3 className="card-title" style={{ marginBottom: '6px' }}>Create a staff account</h3>
        <p className="auth-sub">Choose your password. The panel opens once the shop owner adds your email on Admin → Roles.</p>
        <div role="alert">{alert ? <div className="alert err">{alert}</div> : null}</div>
        <div className="field"><label htmlFor="stName">Your name</label><input id="stName" name="name" type="text" autoComplete="name" placeholder="Your name" value={name} onChange={e => setName(e.target.value)} aria-invalid={errs.name ? 'true' : undefined} aria-describedby="stNameErr" /><div className="err" id="stNameErr">{errs.name || ''}</div></div>
        <div className="field"><label htmlFor="stUpEmail">Email</label><input id="stUpEmail" name="email" type="email" autoComplete="username" placeholder="you@learnwithwhy.com" value={email} onChange={e => setEmail(e.target.value)} aria-invalid={errs.email ? 'true' : undefined} aria-describedby="stUpEmailErr" /><div className="err" id="stUpEmailErr">{errs.email || ''}</div></div>
        <div className="field"><label htmlFor="stUpPass">Password</label><input id="stUpPass" name="password" type="password" autoComplete="new-password" placeholder="8+ characters, a capital and a number" aria-invalid={errs.password ? 'true' : undefined} aria-describedby="stUpPassErr" /><div className="err" id="stUpPassErr">{errs.password || ''}</div></div>
        <div className="field"><label htmlFor="stUpConfirm">Password again</label><input id="stUpConfirm" name="confirm" type="password" autoComplete="new-password" placeholder="Type it again" aria-invalid={errs.confirm ? 'true' : undefined} aria-describedby="stUpConfirmErr" /><div className="err" id="stUpConfirmErr">{errs.confirm || ''}</div></div>
        <button type="submit" className="btn btn-primary btn-block" disabled={busy}>{busy ? 'Creating…' : 'Create my staff account →'}</button>
        <p className="switch">Already have an account? <button type="button" className="link" onClick={() => switchTo('signin')}>Sign in</button></p>
      </form>
    );
  }
  if (view === 'code') {
    return (
      <form className="panel portal-login" noValidate onSubmit={sendCode} aria-busy={busy ? 'true' : 'false'}>
        <h3 className="card-title" style={{ marginBottom: '6px' }}>Check your email</h3>
        <p className="auth-sub">Type the 6-digit code we sent you to finish signing in.</p>
        <div role="alert">{alert ? <div className="alert err">{alert}</div> : null}</div>
        <div role="status">{ok ? <div className="alert ok">{ok}</div> : null}</div>
        <div className="field"><label htmlFor="stCode">6-digit code</label><input id="stCode" name="code" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]*" placeholder="123456" maxLength={6} value={code} onChange={e => setCode(e.target.value.replace(/[^0-9]/g, ''))} aria-invalid={errs.code ? 'true' : undefined} aria-describedby="stCodeErr" /><div className="err" id="stCodeErr">{errs.code || ''}</div></div>
        <button type="submit" className="btn btn-primary btn-block" disabled={busy}>{busy ? 'Checking…' : 'Verify and sign in →'}</button>
        <p className="switch">No email? <button type="button" className="link" onClick={() => { setChallenge(null); switchTo('signin'); }}>Sign in again for a new code</button></p>
      </form>
    );
  }
  if (forgot) {
    return (
      <form className="panel portal-login" noValidate onSubmit={sendReset} aria-busy={busy ? 'true' : 'false'}>
        <h3 className="card-title" style={{ marginBottom: '6px' }}>Reset your password</h3>
        <p className="auth-sub">We will email you a link to choose a new password.</p>
        <div role="alert">{alert ? <div className="alert err">{alert}</div> : null}</div>
        <div role="status">{ok ? <div className="alert ok">{ok}</div> : null}</div>
        <div className="field"><label htmlFor="stResetEmail">Email</label><input id="stResetEmail" name="email" type="email" autoComplete="username" placeholder="you@learnwithwhy.com" value={email} onChange={e => setEmail(e.target.value)} aria-invalid={errs.email ? 'true' : undefined} aria-describedby="stResetEmailErr" /><div className="err" id="stResetEmailErr">{errs.email || ''}</div></div>
        <button type="submit" className="btn btn-primary btn-block" disabled={busy}>{busy ? 'Sending…' : 'Send the reset link'}</button>
        <p className="switch">Remembered it? <button type="button" className="link" onClick={() => switchTo('signin')}>Back to sign in</button></p>
      </form>
    );
  }
  return (
    <form className="panel portal-login" noValidate onSubmit={signIn} aria-busy={busy ? 'true' : 'false'}>
      <h3 className="card-title" style={{ marginBottom: '6px' }}>Sign in as staff</h3><p className="auth-sub">{cfg.blurb}</p>
      <div role="alert">{alert ? <div className="alert err">{alert}</div> : note ? <div className="alert info">{note}</div> : null}</div>
      <div role="status">{ok ? <div className="alert ok">{ok}</div> : null}</div>
      <div className="field"><label htmlFor="stEmail">Email</label><input id="stEmail" name="email" type="email" autoComplete="username" placeholder="you@learnwithwhy.com" value={email} onChange={e => setEmail(e.target.value)} aria-invalid={errs.email ? 'true' : undefined} aria-describedby="stEmailErr" /><div className="err" id="stEmailErr">{errs.email || ''}</div></div>
      <div className="field"><label htmlFor="stPass">Password</label><input id="stPass" name="password" type="password" autoComplete="current-password" placeholder="Your password" aria-invalid={errs.password ? 'true' : undefined} aria-describedby="stPassErr" /><div className="err" id="stPassErr">{errs.password || ''}</div></div>
      <p className="portal-remember">You stay signed in until you sign out.</p>
      <button type="submit" className="btn btn-primary btn-block" disabled={busy}>{busy ? 'Signing in…' : 'Sign in →'}</button>
      <p className="switch">New staff? <button type="button" className="link" onClick={() => switchTo('signup')}>Create an account</button> &nbsp;·&nbsp; <button type="button" className="link" onClick={() => switchTo('forgot')}>Forgot password?</button></p>
    </form>
  );
}
