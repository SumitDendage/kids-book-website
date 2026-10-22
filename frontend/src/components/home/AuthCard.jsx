import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSite } from '../../context/SiteContext.jsx';
import { authApi } from '../../services/api.js';
import { write } from '../../services/storage.js';
import { getSiteRules, markAccountBlocked, DEFAULT_AGREEMENT } from '../../services/security.js';
import AcceptRules from '../security/AcceptRules.jsx';
import { isEmail, strongPass, dateTimeTz } from '../../utils/format.js';
import { classById, printsText } from '../../data/content.js';

/* Two ways in: Sign up (name, email, a password the customer picks and the account rules; Supabase
   Auth emails a 6-digit code, view 'verify' takes it, and only then is the account open and signed
   in through our server) and Sign in. Forgot password emails a reset
   link; the link opens the new-password form here (view 'reset', token in auth.token). When the
   account rules change, sign-in asks for them once more (view 'agree'). Every branch is one call
   to /api/auth/*; the server keeps the record of who signed in and when. */
const COPY = {
  signup: { title: 'Let curiosity in.', sub: 'Tell us your name and email, and choose a password.', submit: 'Create my account →' },
  signin: { title: 'Welcome back.', sub: 'Sign in to open your worksheets, plans and orders.', submit: 'Sign in →' },
   loginOtp: {
  title: 'Check your email.',
  sub: 'Enter the 6-digit code we sent you to finish signing in.',
  submit: 'Verify and sign in →'
},
  forgot: { title: 'Forgot it? That happens.', sub: 'Tell us the email on the account and we will email you a link to choose a new password.', submit: 'Send reset link →' },
  reset: { title: 'Create a new password.', sub: 'Eight characters or more, with a number and a capital letter.', submit: 'Save new password →' },
  verify: { title: 'Check your email.', sub: 'We sent a 6-digit code to your email. Type it here to finish making your account.', submit: 'Confirm and create account →' },
  agree: { title: 'One more step.', sub: 'Our account rules have changed. Please read them and tick the box to sign in.', submit: 'Accept and sign in →' },
};
const TAB_OF = { signup: 'signup', loginOtp: 'signin', verify: 'signup', signin: 'signin', forgot: 'signin', reset: 'signin', agree: 'signin' };
const EMPTY = { name: '', email: '', pass: '', confirm: '', code: '' };
const zone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined; } catch (_) { return undefined; } };

/* the server's words for most answers; our own for the ones a parent should read differently */
function friendly(err, email) {
  const c = err.code;
  if (err.status === 0) return err.message;
  if (c === 'email_taken') return 'That email already has an account. Sign in instead, or use Forgot password.';
  if (c === 'email_unverified') return 'Please confirm your email first with the 6-digit code we sent' + (email ? ' to ' + email : '') + '.';
  if (c === 'account_locked') {
    const until = err.body && Number(err.body.lockedUntil), mins = until ? Math.max(1, Math.ceil((until - Date.now()) / 60e3)) : null;
    return 'Too many wrong passwords, so this account is locked' + (mins ? ' for ' + mins + (mins === 1 ? ' more minute' : ' more minutes') : ' for a little while') + '. You can open it now by choosing a new password.';
  }
  if (c === 'rate_limited' || err.status === 429) return 'Too many tries just now. Please wait a few minutes and try again.';
  if (c === 'auth_unavailable') return 'Sign-in is resting for a moment. Please try again in a minute.';
  if (c === 'mail_unavailable') return 'We cannot send email just now, so this has to wait a little. Please try again later.';
  if (c === 'mail_failed') return 'We could not send your welcome email just now, so the account was not made. Please try again in a few minutes.';
  if (c === 'account_suspended') return 'This account is suspended. If you think this is a mistake, please write to us.';
  return err.message;
}

function Field({ id, label, show, error, children }) {
  return (
    <div className={'field' + (error ? ' bad' : '')} style={show ? undefined : { display: 'none' }}>
      <label htmlFor={id}>{label}</label>{children}<div className="err" id={id + 'Err'} role={error ? 'alert' : undefined}>{error || ''}</div>
    </div>
  );
}

export default function AuthCard() {
  const site = useSite();
  const { auth, access, setAuthView, setAuthAlert, signedIn, signOut, openShop, openAccount, resendWelcome, accountType, printsPerSheet } = site;
  const navigate = useNavigate();
  const session = access.session;
  const view = COPY[auth.view] ? auth.view : 'signin';
  const [f, setF] = useState(EMPTY);
   const [loginChallenge, setLoginChallenge] = useState(null);
  const remember = true;
  const [agreed, setAgreed] = useState(false);
  const [rules, setRules] = useState({ agreement: DEFAULT_AGREEMENT });
  const [errs, setErrs] = useState({});
  const [busy, setBusy] = useState(false);
  const [showPass, setShowPass] = useState(false);
  const busyRef = useRef(false);

  /* the account rules as the server words them (GET /api/config) */
  useEffect(() => { let alive = true; getSiteRules().then(r => { if (alive) setRules(r); }); return () => { alive = false; }; }, []);
  /* a new view clears the field errors (and the alert, in the store) and fills in the email it was given */
  useEffect(() => {
    setErrs({});
    if (auth.email) setF(x => ({ ...x, email: auth.email, code: '' }));
    if (auth.view === 'agree' || auth.view === 'signup') setAgreed(false);
  }, [auth.nonce, auth.email, auth.view]);
  /* signed in: the form is emptied */
  useEffect(() => { if (session) { setF(EMPTY); setAgreed(false); } }, [session]);

  const set = k => e => setF(x => ({ ...x, [k]: e.target.value }));
  const shows = list => list.split(' ').includes(view);
  const copy = COPY[view];
  const agreement = view === 'agree' && auth.agreement && auth.agreement.text ? auth.agreement : rules.agreement;

  async function signInWith(email, pass, extra) {
    let r;
    try { r = await authApi.login({ email, password: pass, remember, ...(extra || {}) }); }
    catch (err) {
      const code = err.code;
      if (code === 'agreement_required') {
        setAuthView('agree', null, { email, agreement: (err.body && err.body.agreement) || rules.agreement });
        return;
      }
      if (code === 'email_unverified') {
        setAuthView('verify', null, { email });
        setTimeout(() => setAuthAlert({ type: 'err', msg: friendly(err, email), action: { label: 'Send a new code', run: () => resendWelcome(email) } }), 0);
        return;
      }
      if (code === 'account_locked') { setAuthAlert({ type: 'err', msg: friendly(err), action: { label: 'Choose a new password', run: () => setAuthView('forgot', null, { email }) } }); return; }
      if (code === 'account_suspended') { markAccountBlocked(email); navigate('/account-blocked'); setAuthAlert({ type: 'err', msg: friendly(err) }); return; }
      throw err;
    }
     if (r.otpRequired) {
  setLoginChallenge({
    challengeId: r.challengeId,
    email: r.email
  });
  setAuthView('loginOtp', null, { email });
  setTimeout(() => setAuthAlert({
    type: 'ok',
    msg: 'We sent a 6-digit login code to ' + r.email + '. Check your inbox and Spam folder.'
  }), 0);
  return;
}
    write('lww_seen', true);
    const first = String((r.user && r.user.name) || '').trim().split(/\s+/)[0];
    await signedIn(r.user, first ? 'Welcome back, ' + first + '!' : 'Welcome back!', remember, r.security || null);
  }

  async function onSubmit(e) {
    e.preventDefault(); setAuthAlert(null); if (busyRef.current) return;
    const email = f.email.trim().toLowerCase(), pass = f.pass, confirm = f.confirm, name = f.name.trim();
    const errors = {};
    const bad = (k, msg) => { if (msg) errors[k] = msg; return !!msg; };
    const busyOn = on => { busyRef.current = on; setBusy(on); };
    try {
      if (view === 'signup') {
        const b = bad('auName', name ? (name.length > 80 ? 'Keep the name under 80 letters.' : '') : 'Tell us your name.')
          | bad('auEmail', isEmail(email) ? '' : 'Enter a valid email address.')
          | bad('auPass', strongPass(pass))
          | bad('auConfirm', confirm === pass ? '' : 'Both passwords must match.')
          | bad('auAccept', agreed ? '' : 'Please tick the box to agree. Your account is just for you.');
        setErrs(errors); if (b) return;
        busyOn(true);
        let r;
        try { r = await authApi.signup({ name, email, password: pass, timeZone: zone() }); }
        catch (err) {
          if (err.code === 'agreement_required' && err.body && err.body.agreement) {
            setRules(x => ({ ...x, agreement: err.body.agreement })); setAgreed(false);
            setErrs({ auAccept: 'The rules were just updated. Please read them again and tick the box.' }); return;
          }
          if (err.code === 'email_taken') {
            setErrs({ auEmail: 'That email already has an account.' });
            setAuthAlert({ type: 'err', msg: friendly(err), action: { label: 'Sign in instead', run: () => setAuthView('signin', null, { email }) } }); return;
          }
          throw err;
        }
        write('lww_seen', true);
        /* ready: sign in now (the ticked rules are recorded with this first sign-in) */
        if (r && r.ready) { await signInWith(email, pass, { agreement: true }); return; }
        /* Supabase is confirming emails: the code is in the inbox, and the account opens once it is typed here */
        const to = (r && r.email) || email;
        setAuthView('verify', null, { email: to });
        setTimeout(() => setAuthAlert({
          type: 'ok',
          msg: 'We sent a 6-digit code to ' + to + '. It can take a minute. Look in Spam too.',
          action: { label: 'No email? Send a new code', run: () => resendWelcome(to) },
        }), 0);
      } else if (view === 'verify') {
        const code = f.code.replace(/\s+/g, '');
        const b = bad('auEmail', isEmail(email) ? '' : 'Enter a valid email address.')
          | bad('auCode', /^\d{6,10}$/.test(code) ? '' : 'Type the 6 numbers from the email.');
        setErrs(errors); if (b) return;
        busyOn(true);
        try { await authApi.verifySignupCode({ email, code }); }
        catch (err) {
          if (err.code === 'otp_invalid' || err.code === 'otp_format') {
            setErrs({ auCode: err.message });
            setAuthAlert({ type: 'err', msg: err.message, action: { label: 'Send a new code', run: () => resendWelcome(email) } }); return;
          }
          throw err;
        }
        write('lww_seen', true);
        /* the password chosen a moment ago is still in the form: sign straight in */
        if (pass) { await signInWith(email, pass, { agreement: true }); return; }
        setAuthView('signin', null, { email });
        setTimeout(() => setAuthAlert({ type: 'ok', msg: 'Your email is confirmed and your account is ready. Sign in with your password.' }), 0);
               } else if (view === 'loginOtp') {
        const code = f.code.replace(/\s+/g, '');
        const b = bad('auCode', /^\d{6}$/.test(code) ? '' : 'Enter the 6-digit code from your email.');
        setErrs(errors);
        if (b) return;
        if (!loginChallenge?.challengeId) {
          setAuthView('signin', null, { email });
          setAuthAlert({ type: 'err', msg: 'Your login code has expired. Please sign in again.' });
          return;
        }
        busyOn(true);
        const r = await authApi.verifyLoginOtp({
          challengeId: loginChallenge.challengeId,
          code
        });
        setLoginChallenge(null);
        write('lww_seen', true);
        const first = String((r.user && r.user.name) || '').trim().split(/\s+/)[0];
        await signedIn(r.user, first ? 'Welcome back, ' + first + '!' : 'Welcome back!', remember, r.security || null);
      } else if (view === 'signin') {
         
        const b = bad('auEmail', isEmail(email) ? '' : 'Enter a valid email address.') | bad('auPass', pass ? '' : 'Enter your password.');
        setErrs(errors); if (b) return;
        busyOn(true);
        await signInWith(email, pass);
      } else if (view === 'agree') {
        if (!pass || !isEmail(email)) { setAuthView('signin', null, { email }); return; }
        const b = bad('auAccept', agreed ? '' : 'Please tick the box to agree. Your account is just for you.');
        setErrs(errors); if (b) return;
        busyOn(true);
        await signInWith(email, pass, { agreement: true });
      } else if (view === 'forgot') {
        const b = bad('auEmail', isEmail(email) ? '' : 'Enter a valid email address.'); setErrs(errors); if (b) return;
        busyOn(true); const r = await authApi.forgotPassword({ email });
        setAuthAlert({ type: 'ok', msg: r.message || 'If that email has an account, a reset link is on its way.' });
      } else if (view === 'reset') {
        if (!auth.token) { setAuthView('forgot'); setTimeout(() => setAuthAlert({ type: 'err', msg: 'Open the reset link from your email, or ask for a new one here.' }), 0); return; }
        const b = bad('auPass', strongPass(pass)) | bad('auConfirm', confirm === pass ? '' : 'Both passwords must match.');
        setErrs(errors); if (b) return;
        busyOn(true);
        let r; try { r = await authApi.resetPassword({ token: auth.token, password: pass }); }
        catch (err) { if (/^token_/.test(err.code || '')) { setAuthView('forgot'); setTimeout(() => setAuthAlert({ type: 'err', msg: err.message }), 0); return; } throw err; }
        setAuthView('signin'); setTimeout(() => setAuthAlert({ type: 'ok', msg: r.message || 'Password updated. Sign in with your new password.' }), 0);
      }
    } catch (err) {
      const fe = err.body && err.body.errors;
      if (fe) setErrs({ auName: fe.name, auEmail: fe.email, auPass: fe.password, auAccept: fe.agreement });
      setAuthAlert({ type: 'err', msg: friendly(err, email) });
    } finally { busyOn(false); }
  }

  /* the account type is asked once in its own popup (AccountTypePopup) and only staff change it later */
  const hasRole = !!accountType;
  const subs = access.subsOf();
  const paused = !!session && session.accessStatus === 'suspended';
  const tz = (session && session.timeZone) || undefined;
  const Link = ({ to, children }) => <button type="button" className="link" onClick={() => setAuthView(to, null, { email: f.email.trim() })}>{children}</button>;
  const switchLine = {
    signup: <>Already have an account? <Link to="signin">Sign in</Link> &nbsp;·&nbsp; <Link to="forgot">Forgot password?</Link></>,
    signin: <>New here? <Link to="signup">Sign up</Link></>,
    forgot: <>Remembered it? <Link to="signin">Sign in</Link></>,
   loginOtp: <Link to="signin">Back to sign in</Link>,
    reset: <Link to="signin">Back to sign in</Link>,
    verify: <>Wrong email? <Link to="signup">Start again</Link> &nbsp;·&nbsp; <button type="button" className="link" onClick={() => resendWelcome(f.email.trim().toLowerCase())}>Send a new code</button></>,
    agree: <Link to="signin">Back to sign in</Link>,
  }[view];

  return (
    <div className={'panel auth-card rise' + (session ? ' is-signed' : '')} id="authCard" style={{ '--i': 2 }}>
      <p className="eyebrow">01 / Your adventure starts here</p>
      <div className="guest">
        <div className="tabs" role="tablist">
          <button type="button" className={'tab' + (TAB_OF[view] === 'signup' ? ' on' : '')} role="tab" aria-selected={TAB_OF[view] === 'signup'} onClick={() => setAuthView('signup')}>Sign up</button>
          <button type="button" className={'tab' + (TAB_OF[view] === 'signin' ? ' on' : '')} role="tab" aria-selected={TAB_OF[view] === 'signin'} onClick={() => setAuthView('signin')}>Sign in</button>
        </div>
        <form id="authForm" noValidate onSubmit={onSubmit} data-view={view}>
          <h2 className="card-title" id="authTitle">{copy.title}</h2>
          <p className="auth-sub" id="authSub">{copy.sub}</p>
          <div id="authAlert" aria-live="polite">{auth.alert && <div className={'alert ' + auth.alert.type}>{auth.alert.msg}{auth.alert.action && <> <button type="button" className="link" onClick={auth.alert.action.run}>{auth.alert.action.label}</button></>}</div>}</div>
          {view === 'agree' ? <p className="auth-note">Signing in as <b>{f.email}</b></p> : null}
          <Field id="auName" label="Your name" show={shows('signup')} error={errs.auName}><input id="auName" type="text" autoComplete="name" placeholder="Your name" maxLength={80} value={f.name} onChange={set('name')} /></Field>
          <Field id="auEmail" label="Email address" show={shows('signup signin forgot verify')} error={errs.auEmail}><input id="auEmail" type="email" autoComplete="email" placeholder="you@example.com" value={f.email} onChange={set('email')} /></Field>
          <Field id="auCode" label="6-digit code" show={shows('verify loginOtp')} error={errs.auCode}><input id="auCode" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]*" placeholder="123456" maxLength={10} value={f.code} onChange={e => setF(x => ({ ...x, code: e.target.value.replace(/[^0-9]/g, '') }))} /></Field>
          <Field id="auPass" label={view === 'reset' ? 'New password' : 'Password'} show={shows('signup signin reset')} error={errs.auPass}>
            <div className="pw-wrap"><input id="auPass" type={showPass ? 'text' : 'password'} autoComplete={view === 'signin' ? 'current-password' : 'new-password'} placeholder={view === 'signin' ? 'Your password' : 'At least 8 characters'} maxLength={128} value={f.pass} onChange={set('pass')} /><button type="button" className="pw-toggle" id="pwToggle" aria-label={showPass ? 'Hide password' : 'Show password'} onClick={() => setShowPass(v => !v)}>{showPass ? 'HIDE' : 'SHOW'}</button></div>
          </Field>
          <Field id="auConfirm" label="Confirm password" show={shows('signup reset')} error={errs.auConfirm}><input id="auConfirm" type="password" autoComplete="new-password" placeholder="Once more" maxLength={128} value={f.confirm} onChange={set('confirm')} /></Field>
          {shows('signup agree') ? <AcceptRules id="auAccept" text={agreement.text} checked={agreed} onChange={v => { setAgreed(v); if (v) setErrs(x => ({ ...x, auAccept: undefined })); }} error={errs.auAccept} /> : null}
          {view === 'signup' ? <p className="auth-note">Eight characters or more, with a number and a capital letter. Keep it to yourself.</p> : null}
          <div className="between" style={shows('signin agree') ? undefined : { display: 'none' }}><span className="auth-note">You stay signed in until you sign out.</span>{view === 'signin' ? <button type="button" className="link" onClick={() => setAuthView('forgot', null, { email: f.email.trim() })}>Forgot password?</button> : null}</div>
          <button type="submit" className="btn btn-primary btn-block" id="authSubmit" disabled={busy}>{busy ? 'One moment…' : copy.submit}</button>
          <p className="switch" id="authSwitch">{switchLine}</p>
        </form>
      </div>
      <div className="signed">
        <h2 className="card-title">You&apos;re in, <span id="signedName">{session ? session.name : ''}</span>.</h2>
        <p className="auth-sub" id="roleLine" hidden={!hasRole}><b id="signedRole">{hasRole ? accountType.label : ''}</b> account · {hasRole ? printsText(printsPerSheet).toLowerCase() : ''} per sheet. Your plans and sheets are kept with it.</p>
        {paused ? <p className="auth-sub" id="pausedLine">Paid sheets are paused on this account. Free sheets still open. <button type="button" className="link" onClick={() => openAccount('security')}>See why</button></p> : null}
        <p className="auth-sub" id="subLine" hidden={!hasRole}>
          {subs.length
            ? <>{subs.map((x, n) => <span key={x.cls}>{n ? ' ' : ''}Your <b>{(classById(x.cls) || { label: 'class' }).label}</b> plan is open{x.end ? ' until ' + dateTimeTz(x.end, tz) : ''}.</span>)} <button type="button" className="link" onClick={() => openAccount('sheets')}>My Worksheets</button></>
            : <>Your sheets are under <button type="button" className="link" onClick={() => openAccount('sheets')}>My Account → My Worksheets</button>.</>}
        </p>
        <div className="btn-row"><button type="button" className="btn btn-primary" onClick={() => openShop('all')}>Explore the sheets →</button><button type="button" className="btn btn-ghost" id="signOutBtn" onClick={signOut}>Sign out</button></div>
      </div>
    </div>
  );
}
