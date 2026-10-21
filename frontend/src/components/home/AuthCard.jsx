import { useEffect, useRef, useState } from 'react';
import { useSite } from '../../context/SiteContext.jsx';
import { authApi } from '../../services/api.js';
import { getSiteRules, DEFAULT_AGREEMENT } from '../../services/security.js';
import AcceptRules from '../security/AcceptRules.jsx';
import { classById, printsText } from '../../data/content.js';
import { dateTimeTz } from '../../utils/format.js';

export default function AuthCard() {
  const { auth, access, setAuthView, signedIn, signOut, openShop, openAccount, accountType, printsPerSheet } = useSite();
  const session = access.session, signup = auth.view === 'signup';
  const [form, setForm] = useState({ name: '', email: '', role: 'parent', code: '' });
  const [requested, setRequested] = useState(false), [agreed, setAgreed] = useState(false);
  const [rules, setRules] = useState(null), [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null), [cooldown, setCooldown] = useState(0);
  const lock = useRef(false), codeInput = useRef(null);
  useEffect(() => { let alive = true; getSiteRules().then(r => { if (alive) setRules(r); }); return () => { alive = false; }; }, []);
  useEffect(() => { if (!cooldown) return; const t = setTimeout(() => setCooldown(v => Math.max(0,v-1)),1000); return () => clearTimeout(t); }, [cooldown]);
  useEffect(() => { setRequested(false); setAgreed(false); setNotice(null); setForm(f => ({ ...f, code: '', email: auth.email || f.email })); }, [auth.view, auth.nonce]);
  useEffect(() => { if (requested) codeInput.current?.focus(); }, [requested]);
  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }));
  const agreement = rules?.agreement || DEFAULT_AGREEMENT;
  async function submit(e, resend = false) {
    e?.preventDefault(); if (lock.current) return;
    if (!rules || !agreed) { setNotice({ error: true, text: 'Please read and accept the account rules.' }); return; }
    lock.current = true; setBusy(true); setNotice(null);
    const body = { ...form, email: form.email.trim().toLowerCase(), signup, agreement: true, agreementVersion: agreement.version, remember: true };
    try {
      if (!requested || resend) {
        if (cooldown) return;
        const r = await authApi.requestOtp(body);
        setRequested(true); setCooldown(r.cooldown || 60); setForm(f => ({ ...f, code: '' })); setNotice({ text: r.message });
      } else {
        const r = await authApi.verifyOtp(body);
        await signedIn(r.user, 'Welcome to Learn With Why!', true, r.security || null);
        setForm({ name: '', email: '', role: 'parent', code: '' });
      }
    } catch (err) {
      if (err.body?.agreement) { setRules(r => ({ ...r, agreement: err.body.agreement })); setAgreed(false); }
      setNotice({ error: true, text: err.message || 'Please try again shortly.' });
    } finally { lock.current = false; setBusy(false); }
  }
  const hasRole = !!accountType, subs = access.subsOf();
  const paused = !!session && session.accessStatus === 'suspended', tz = session?.timeZone;
  return (
    <div className={'panel auth-card rise' + (session ? ' is-signed' : '')} id="authCard" style={{ '--i': 2 }}>
      <p className="eyebrow">01 / Your adventure starts here</p>
      <div className="guest">
        <div className="tabs">
          <button type="button" disabled={busy} className={'tab' + (signup ? ' on' : '')} onClick={() => setAuthView('signup')}>Sign up</button>
          <button type="button" disabled={busy} className={'tab' + (!signup ? ' on' : '')} onClick={() => setAuthView('signin')}>Sign in</button>
        </div>
        <form id="authForm" onSubmit={submit} aria-busy={busy}>
          <h2 className="card-title">{requested ? 'Check your email.' : signup ? 'Let curiosity in.' : 'Welcome back.'}</h2>
          <p className="auth-sub">{requested ? 'Enter your six-digit code. Never share it.' : 'We will email you a one-time sign-in code. No password needed.'}</p>
          {notice && <div className={'alert ' + (notice.error ? 'err' : 'ok')} role={notice.error ? 'alert' : 'status'}>{notice.text}</div>}
          {signup && <div className="field"><label htmlFor="auName">Your name</label><input id="auName" autoComplete="name" required maxLength={80} disabled={busy || requested} value={form.name} onChange={set('name')} /></div>}
          <div className="field"><label htmlFor="auEmail">Email address</label><input id="auEmail" type="email" autoComplete="email" required maxLength={254} disabled={busy || requested} value={form.email} onChange={set('email')} /></div>
          {signup && <div className="field"><label htmlFor="auRole">Account type</label><select id="auRole" disabled={busy || requested} value={form.role} onChange={set('role')}><option value="parent">Parent</option><option value="teacher">Teacher</option></select></div>}
          {requested && <div className="field"><label htmlFor="auCode">Six-digit code</label><input ref={codeInput} id="auCode" autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required disabled={busy} value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value.replace(/[^0-9]/g, '') }))} /></div>}
          <AcceptRules id="auAccept" text={agreement.text} checked={agreed} onChange={setAgreed} />
          <button className="btn btn-primary btn-block" type="submit" disabled={busy || !rules || (!requested && cooldown > 0)}>{busy ? 'One moment…' : requested ? 'Verify and sign in →' : cooldown ? `Please wait ${cooldown}s` : 'Email my code →'}</button>
          {requested && <p className="switch"><button type="button" className="link" disabled={busy || cooldown > 0} onClick={e => submit(e, true)}>{cooldown ? `Resend in ${cooldown}s` : 'Resend code'}</button> · <button type="button" className="link" disabled={busy} onClick={() => { setRequested(false); setForm(f => ({ ...f, code: '' })); }}>Change email</button></p>}
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
