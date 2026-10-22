import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSite } from '../../context/SiteContext.jsx';
import { authApi } from '../../services/api.js';
import { write } from '../../services/storage.js';
import { getSiteRules, markAccountBlocked, DEFAULT_AGREEMENT } from '../../services/security.js';
import AcceptRules from '../security/AcceptRules.jsx';
import { isEmail, strongPass, dateTimeTz } from '../../utils/format.js';
import { ACCOUNT_TYPES, classById, printsText } from '../../data/content.js';

/* Customers come in with a 6-digit code, never a password or a link. Sign up asks for name, email,
   Parent / Teacher / Organization and the account rules; Sign in asks for the email only. Supabase
   Auth emails the code (view 'code'), the customer types it, and only then does our server open the
   sign-in. A customer whose rules changed ticks them on the code screen (no second code needed).
   The 'reset' view only opens from a staff password-reset link. */
const COPY = {
  signup: { title: 'Let curiosity in.', sub: 'Tell us about you. We will email you a 6-digit code, no password needed.', submit: 'Email me a code →' },
  signin: { title: 'Welcome back.', sub: 'Type your email and we will send you a 6-digit code to sign in.', submit: 'Email me a code →' },
  code: { title: 'Check your email.', sub: '', submit: 'Confirm →' },
  reset: { title: 'Create a new password.', sub: 'Eight characters or more, with a number and a capital letter.', submit: 'Save new password →' },
};
const TAB_OF = { signup: 'signup', signin: 'signin', reset: 'signin' };
const EMPTY = { name: '', email: '', role: '', pass: '', confirm: '', code: '' };
const WAIT = 60;   /* seconds before another code may be asked for (Supabase Auth holds it as well) */
const zone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined; } catch (_) { return undefined; } };

function friendly(err) {
  const c = err.code || '';
  if (err.status === 0) return err.message;
  if (c === 'rate_limited' || (err.status === 429 && !/^otp_/.test(c))) return 'Too many tries just now. Please wait a few minutes and try again.';
  if (c === 'auth_unavailable') return 'Sign-in is resting for a moment. Please try again in a minute.';
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
  const { auth, access, setAuthView, setAuthAlert, signedIn, signOut, openShop, openAccount, accountType, printsPerSheet } = site;
  const navigate = useNavigate();
  const session = access.session;
  const view = COPY[auth.view] ? auth.view : 'signin';
  const [f, setF] = useState(EMPTY);
  const [agreed, setAgreed] = useState(false);
  const [rules, setRules] = useState({ agreement: DEFAULT_AGREEMENT });
  const [errs, setErrs] = useState({});
  const [busy, setBusy] = useState(false);
  const [showPass, setShowPass] = useState(false);
  /* the code screen: which form asked, for which email, when, and (rules changed) the checked code's session */
  const [codeFor, setCodeFor] = useState({ from: 'signin', email: '', at: 0, rules: null, refreshToken: null });
  const [now, setNow] = useState(Date.now());
  const busyRef = useRef(false);

  /* the account rules as the server words them (GET /api/config) */
  useEffect(() => { let alive = true; getSiteRules().then(r => { if (alive) setRules(r); }); return () => { alive = false; }; }, []);
  /* a new view clears the field errors (and the alert, in the store) and fills in the email it was given */
  useEffect(() => {
    setErrs({});
    if (auth.email) setF(x => ({ ...x, email: auth.email }));
    if (auth.view === 'signup') setAgreed(false);
  }, [auth.nonce, auth.email, auth.view]);
  /* signed in: the form is emptied */
  useEffect(() => { if (session) { setF(EMPTY); setAgreed(false); } }, [session]);
  /* the "new code in 42s" countdown ticks only while the code screen shows */
  const waitLeft = Math.max(0, Math.ceil((codeFor.at + WAIT * 1000 - now) / 1000));
  useEffect(() => {
    if (view !== 'code' || !waitLeft) return undefined;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [view, waitLeft]);

  const set = k => e => setF(x => ({ ...x, [k]: e.target.value }));
  const shows = list => list.split(' ').includes(view);
  const busyOn = on => { busyRef.current = on; setBusy(on); };
  const needsRules = view === 'code' && !!codeFor.rules;
  const agreement = needsRules && codeFor.rules.text ? codeFor.rules : rules.agreement;
  const copy = view === 'code'
    ? { ...COPY.code, sub: 'We sent a 6-digit code to ' + codeFor.email + '. Type it here ' + (codeFor.from === 'signup' ? 'to finish making your account.' : 'to sign in.') }
    : COPY[view];

  async function ask(email, from, extra) {
    await authApi.sendCode({ email, signup: from === 'signup', ...(extra || {}) });
    write('lww_seen', true);
    setCodeFor({ from, email, at: Date.now(), rules: null, refreshToken: null });
    setNow(Date.now());
    setF(x => ({ ...x, code: '' }));
    setAuthView('code', null, { email });
    setTimeout(() => setAuthAlert({ type: 'ok', msg: 'Code sent. It can take a minute, so look in Spam too.' }), 0);
  }

  async function resend() {
    if (busyRef.current || waitLeft) return;
    setAuthAlert(null); busyOn(true);
    try {
      await authApi.sendCode({ email: codeFor.email, signup: codeFor.from === 'signup', name: f.name.trim(), timeZone: zone() });
      setAuthAlert({ type: 'ok', msg: 'A new code is on its way. Use the newest one.' });
    } catch (err) {
      setAuthAlert({ type: 'err', msg: friendly(err) });
    } finally {
      setCodeFor(x => ({ ...x, at: Date.now() })); setNow(Date.now());
      busyOn(false);
    }
  }

  /* back to the form to fix the email; a checked code that waited for the rules is dropped */
  async function changeEmail() {
    if (codeFor.refreshToken) await authApi.cancelCode();
    setCodeFor(x => ({ ...x, rules: null, refreshToken: null }));
    setAuthView(codeFor.from, null, { email: codeFor.email });
  }

  async function finish(r) {
    let user = r.user;
    /* the type picked on Sign up is kept once, by our server (a customer can never pick a staff role) */
    if (codeFor.from === 'signup' && f.role && user && !user.role) {
      try { user = (await authApi.updateMe({ role: f.role })).user || user; } catch (_) { /* asked again in its own popup */ }
    }
    write('lww_seen', true);
    const first = String((user && user.name) || '').trim().split(/\s+/)[0];
    const hello = codeFor.from === 'signup' ? 'Welcome to Learn With Why' : 'Welcome back';
    await signedIn(user, first ? hello + ', ' + first + '!' : hello + '!', true, r.security || null);
  }

  async function onSubmit(e) {
    e.preventDefault(); setAuthAlert(null); if (busyRef.current) return;
    const email = f.email.trim().toLowerCase(), name = f.name.trim();
    const errors = {};
    const bad = (k, msg) => { if (msg) errors[k] = msg; return !!msg; };
    try {
      if (view === 'signup') {
        const b = bad('auName', name ? (name.length > 80 ? 'Keep the name under 80 letters.' : '') : 'Tell us your name.')
          | bad('auEmail', isEmail(email) ? '' : 'Enter a valid email address.')
          | bad('auRole', f.role ? '' : 'Choose Parent, Teacher or Organization.')
          | bad('auAccept', agreed ? '' : 'Please tick the box to agree. Your account is just for you.');
        setErrs(errors); if (b) return;
        busyOn(true);
        await ask(email, 'signup', { name, timeZone: zone() });
      } else if (view === 'signin') {
        const b = bad('auEmail', isEmail(email) ? '' : 'Enter a valid email address.');
        setErrs(errors); if (b) return;
        busyOn(true);
        try { await ask(email, 'signin'); }
        catch (err) {
          if (err.code === 'no_account') {
            setErrs({ auEmail: 'No account with this email yet.' });
            setAuthAlert({ type: 'err', msg: err.message, action: { label: 'Sign up instead', run: () => setAuthView('signup', null, { email }) } }); return;
          }
          throw err;
        }
      } else if (view === 'code') {
        const code = f.code.replace(/\s+/g, '');
        const b = (needsRules ? false : bad('auCode', /^\d{6,10}$/.test(code) ? '' : 'Type the 6 numbers from the email.'))
          | bad('auAccept', needsRules && !agreed ? 'Please tick the box to agree. Your account is just for you.' : '');
        setErrs(errors); if (b) return;
        busyOn(true);
        let r;
        try {
          r = needsRules
            ? await authApi.otpSession({ refreshToken: codeFor.refreshToken, agreement: true })
            : await authApi.verifyCode({ email: codeFor.email, code, agreement: codeFor.from === 'signup' });
        } catch (err) {
          if (err.code === 'agreement_required') {
            /* the code was right: tick the changed rules and press Confirm again, no new code needed */
            setCodeFor(x => ({ ...x, rules: (err.body && err.body.agreement) || rules.agreement, refreshToken: err.refreshToken || x.refreshToken }));
            setAgreed(false);
            setAuthAlert({ type: 'ok', msg: 'Your code is right. Our account rules have changed, so please read them and tick the box.' }); return;
          }
          if (/^otp_/.test(err.code || '')) {
            setAuthAlert({ type: 'err', msg: err.message, action: waitLeft ? null : { label: 'Send a new code', run: resend } }); return;
          }
          if (err.code === 'account_suspended') { markAccountBlocked(codeFor.email); navigate('/account-blocked'); }
          throw err;
        }
        await finish(r);
      } else if (view === 'reset') {
        const pass = f.pass, confirm = f.confirm;
        const b = bad('auPass', strongPass(pass)) | bad('auConfirm', confirm === pass ? '' : 'Both passwords must match.');
        setErrs(errors); if (b) return;
        busyOn(true);
        const r = await authApi.resetPassword({ password: pass });
        setAuthView('signin'); setTimeout(() => setAuthAlert({ type: 'ok', msg: r.message || 'Password updated.' }), 0);
      }
    } catch (err) {
      const fe = err.body && err.body.errors;
      if (fe) setErrs({ auName: fe.name, auEmail: fe.email, auAccept: fe.agreement, auCode: fe.code });
      setAuthAlert({ type: 'err', msg: friendly(err) });
    } finally { busyOn(false); }
  }

  /* the account type is asked once in its own popup (AccountTypePopup) when Sign up did not keep it, and only staff change it later */
  const hasRole = !!accountType;
  const subs = access.subsOf();
  const paused = !!session && session.accessStatus === 'suspended';
  const tz = (session && session.timeZone) || undefined;
  const tab = view === 'code' ? codeFor.from : TAB_OF[view];
  const Link = ({ to, children }) => <button type="button" className="link" onClick={() => setAuthView(to, null, { email: f.email.trim() })}>{children}</button>;
  const switchLine = {
    signup: <>Already have an account? <Link to="signin">Sign in</Link></>,
    signin: <>New here? <Link to="signup">Sign up</Link></>,
    code: <><button type="button" className="link" onClick={changeEmail}>Change email</button> &nbsp;·&nbsp; {waitLeft
      ? <span aria-live="polite">New code in {waitLeft}s</span>
      : <button type="button" className="link" disabled={busy} onClick={resend}>Send a new code</button>}</>,
    reset: <Link to="signin">Back to sign in</Link>,
  }[view];

  return (
    <div className={'panel auth-card rise' + (session ? ' is-signed' : '')} id="authCard" style={{ '--i': 2 }}>
      <p className="eyebrow">01 / Your adventure starts here</p>
      <div className="guest">
        <div className="tabs" role="tablist">
          <button type="button" className={'tab' + (tab === 'signup' ? ' on' : '')} role="tab" aria-selected={tab === 'signup'} onClick={() => setAuthView('signup')}>Sign up</button>
          <button type="button" className={'tab' + (tab === 'signin' ? ' on' : '')} role="tab" aria-selected={tab === 'signin'} onClick={() => setAuthView('signin')}>Sign in</button>
        </div>
        <form id="authForm" noValidate onSubmit={onSubmit} data-view={view}>
          <h2 className="card-title" id="authTitle">{copy.title}</h2>
          <p className="auth-sub" id="authSub">{copy.sub}</p>
          <div id="authAlert" aria-live="polite">{auth.alert && <div className={'alert ' + auth.alert.type}>{auth.alert.msg}{auth.alert.action && <> <button type="button" className="link" onClick={auth.alert.action.run}>{auth.alert.action.label}</button></>}</div>}</div>
          <Field id="auName" label="Your name" show={shows('signup')} error={errs.auName}><input id="auName" type="text" autoComplete="name" placeholder="Your name" maxLength={80} value={f.name} onChange={set('name')} /></Field>
          <Field id="auEmail" label="Email address" show={shows('signup signin')} error={errs.auEmail}><input id="auEmail" type="email" autoComplete="email" placeholder="you@example.com" value={f.email} onChange={set('email')} /></Field>
          {view === 'signup' ? (
            <div className={'field' + (errs.auRole ? ' bad' : '')}>
              <span className="field-label" id="auRoleLabel">I am a</span>
              <div className="role-pick" role="radiogroup" aria-labelledby="auRoleLabel">
                {ACCOUNT_TYPES.map(t => <button key={t.id} type="button" role="radio" aria-checked={f.role === t.id} className={'role-opt' + (f.role === t.id ? ' on' : '')} onClick={() => { setF(x => ({ ...x, role: t.id })); setErrs(x => ({ ...x, auRole: undefined })); }}>{t.label}</button>)}
              </div>
              <div className="err" id="auRoleErr" role={errs.auRole ? 'alert' : undefined}>{errs.auRole || ''}</div>
            </div>
          ) : null}
          <Field id="auCode" label="6-digit code" show={shows('code') && !needsRules} error={errs.auCode}><input id="auCode" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]*" placeholder="123456" maxLength={10} value={f.code} onChange={e => setF(x => ({ ...x, code: e.target.value.replace(/[^0-9]/g, '') }))} /></Field>
          <Field id="auPass" label="New password" show={shows('reset')} error={errs.auPass}>
            <div className="pw-wrap"><input id="auPass" type={showPass ? 'text' : 'password'} autoComplete="new-password" placeholder="At least 8 characters" maxLength={128} value={f.pass} onChange={set('pass')} /><button type="button" className="pw-toggle" id="pwToggle" aria-label={showPass ? 'Hide password' : 'Show password'} onClick={() => setShowPass(v => !v)}>{showPass ? 'HIDE' : 'SHOW'}</button></div>
          </Field>
          <Field id="auConfirm" label="Confirm password" show={shows('reset')} error={errs.auConfirm}><input id="auConfirm" type="password" autoComplete="new-password" placeholder="Once more" maxLength={128} value={f.confirm} onChange={set('confirm')} /></Field>
          {view === 'signup' || needsRules ? <AcceptRules id="auAccept" text={agreement.text} checked={agreed} onChange={v => { setAgreed(v); if (v) setErrs(x => ({ ...x, auAccept: undefined })); }} error={errs.auAccept} /> : null}
          {shows('signup signin') ? <p className="auth-note">No password needed. You stay signed in until you sign out.</p> : null}
          <button type="submit" className="btn btn-primary btn-block" id="authSubmit" disabled={busy}>{busy ? (view === 'code' ? 'Checking…' : view === 'reset' ? 'One moment…' : 'Sending…') : copy.submit}</button>
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
