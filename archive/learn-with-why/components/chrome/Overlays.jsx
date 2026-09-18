'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion } from 'motion/react';
import { AUTH, CART, CLASSES, LICENCES, classById, money, subjectById } from '@/lib/content';
import { springs } from '@/lib/motion';
import { licence } from '@/lib/libraryStore';
import { completeReset, isEmail, online, passwordStrength, requestReset, signIn, signUp, verifyReset } from '@/lib/authStore';
import { useStore } from '@/lib/store';

const M = AUTH.messages;
const drawerAnim = { hide: { x: '100%' }, show: { x: 0, transition: { ...springs.ui, staggerChildren: 0.045, delayChildren: 0.12 } } };
const item = { hide: { opacity: 0, x: 16 }, show: { opacity: 1, x: 0, transition: springs.ui } };

/* Toast + bag drawer + auth dialog, mounted once in the layout. */
export default function Overlays() {
  const { drawer, setDrawer, auth, setAuth, toastState } = useStore();
  useEffect(() => {
    const onKey = e => { if (e.key !== 'Escape') return; if (auth) setAuth(null); else if (drawer) setDrawer(null); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [auth, drawer, setAuth, setDrawer]);
  return (
    <>
      <AnimatePresence>{drawer === 'cart' && <CartDrawer key="cart" onClose={() => setDrawer(null)} />}</AnimatePresence>
      <AnimatePresence>{auth && <AuthDialog key="auth" view={auth} onView={setAuth} onClose={() => setAuth(null)} />}</AnimatePresence>
      <AnimatePresence>
        {toastState && (
          <motion.div key={toastState.key} className="toast" initial={{ opacity: 0, y: 14, x: '-50%' }} animate={{ opacity: 1, y: 0, x: '-50%' }} exit={{ opacity: 0, y: 8, x: '-50%' }} transition={springs.ui}>{toastState.msg}</motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

/* ---------- bag ---------- */
function CartDrawer({ onClose }) {
  const { cartItems, cartTotal, changeQty, setLicence, checkout } = useStore();
  const router = useRouter();
  return (
    <>
      <motion.div className="drawer-scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }} onClick={onClose} />
      <motion.aside className="drawer" aria-label={CART.title} variants={drawerAnim} initial="hide" animate="show" exit="hide">
        <div className="drawer-head">
          <span className="drawer-title">{CART.title}</span>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close bag">✕</button>
        </div>
        {!cartItems.length ? (
          <>
            <motion.p className="cart-empty" variants={item}>{CART.empty}</motion.p>
            <motion.button type="button" className="drawer-cta" variants={item} onClick={() => { onClose(); router.push('/#sheets'); }}>{CART.browse}</motion.button>
          </>
        ) : (
          <>
            <AnimatePresence initial={false}>
              {cartItems.map(({ sheet, qty, licence: lic }) => (
                <motion.div className="cart-row" key={sheet.id} layout initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 24 }} transition={springs.ui}>
                  <div className="thumb" style={{ '--hue': subjectById(sheet.subject).hue }} aria-hidden="true">{sheet.glyph}</div>
                  <div className="nm">
                    {sheet.title}
                    <span>{classById(sheet.cls).label} · {money(sheet.price * licence(lic).factor)}</span>
                    <select value={lic} onChange={e => setLicence(sheet.id, e.target.value)} aria-label={CART.licence}>
                      {LICENCES.map(l => <option key={l.id} value={l.id}>{l.label} · {l.copies === 1 ? '1 copy' : l.copies + ' copies'}</option>)}
                    </select>
                  </div>
                  <div className="qty">
                    <button type="button" onClick={() => changeQty(sheet.id, -1)} aria-label="Remove one">−</button>
                    <motion.b key={qty} initial={{ scale: 0.6 }} animate={{ scale: 1 }} transition={springs.micro}>{qty}</motion.b>
                    <button type="button" onClick={() => changeQty(sheet.id, 1)} aria-label="Add one">+</button>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
            <motion.div layout className="cart-total"><span>{CART.total}</span><span>{money(cartTotal)}</span></motion.div>
            <motion.button layout type="button" className="btn btn-primary btn-block" onClick={async () => { if (await checkout()) router.push('/library'); }}>{CART.checkout}</motion.button>
            <motion.p layout className="cart-empty" style={{ fontSize: '0.78rem' }}>{CART.note}</motion.p>
          </>
        )}
      </motion.aside>
    </>
  );
}

/* ---------- auth dialog: sign in · create account · reset ---------- */
function Field({ id, label, error, children }) {
  return <div className={'field' + (error ? ' bad' : '')}><label htmlFor={id}>{label}</label>{children}<div className="err">{error || ''}</div></div>;
}

function AuthDialog({ view, onView, onClose }) {
  const { signedIn, notice, setNotice } = useStore();
  const [email, setEmail] = useState('');
  const [pass, setPass] = useState('');
  const [confirm, setConfirm] = useState('');
  const [name, setName] = useState('');
  const [kid, setKid] = useState(CLASSES[0].id);
  const [code, setCode] = useState('');
  const [reset, setReset] = useState(null);      /* { email, code|null } after a reset request */
  const [step, setStep] = useState('email');     /* forgot: email → code → password */
  const [errors, setErrors] = useState({});
  const [alert, setAlert] = useState(notice);
  const [busy, setBusy] = useState(false);
  useEffect(() => () => setNotice(null), [setNotice]);
  const switchTo = v => { setErrors({}); setAlert(null); setStep('email'); onView(v); };

  async function submit(e) {
    e.preventDefault();
    setAlert(null);
    const next = {};
    if (view !== 'forgot' || step === 'email') { if (!isEmail(email)) next.email = M.badEmail; }
    if (view === 'signin' && !pass) next.pass = M.needPassword;
    if (view === 'signup') {
      if (!name.trim()) next.name = M.needName;
      if (pass.length < 8) next.pass = M.shortPassword; else if (!/[A-Z]/.test(pass) || !/[0-9]/.test(pass)) next.pass = M.weakPassword;
    }
    if (view === 'forgot' && step === 'password') { if (pass.length < 8) next.pass = M.shortPassword; else if (!/[A-Z]/.test(pass) || !/[0-9]/.test(pass)) next.pass = M.weakPassword; if (confirm !== pass) next.confirm = 'Both passwords must match.'; }
    setErrors(next);
    if (Object.keys(next).length) return;
    setBusy(true);
    try {
      if (view === 'signin') { const s = await signIn(email, pass, true); signedIn(s, M.signinWelcome + (s.name || 'friend')); }
      else if (view === 'signup') {
        const r = await signUp({ name: name.trim(), kidAge: kid, email, password: pass });
        if (r.confirm) { setAlert({ type: 'ok', msg: M.confirmEmail }); onView('signin'); }
        else signedIn(r.session, M.accountCreated);
      } else if (step === 'email') { setReset(await requestReset(email)); setStep('code'); }
      else if (step === 'code') { if (!(await verifyReset(reset.email, code))) { setErrors({ code: M.badCode }); } else setStep('password'); }
      else { await completeReset(reset.email, pass); setAlert({ type: 'ok', msg: M.passwordUpdated }); setPass(''); setConfirm(''); onView('signin'); setStep('email'); }
    } catch (err) { setAlert({ type: 'err', msg: err.message }); }
    finally { setBusy(false); }
  }

  const C = view === 'signin' ? AUTH.signin : view === 'signup' ? AUTH.signup : AUTH.forgot;
  const strength = pass ? passwordStrength(pass) : 0;
  return (
    <motion.div className="modal-scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} onClick={onClose}>
      <motion.form className="modal" role="dialog" aria-labelledby="authTitle" onSubmit={submit} noValidate initial={{ opacity: 0, scale: 0.94, y: 12 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96, y: 8 }} transition={springs.ui} onClick={e => e.stopPropagation()}>
        <h3 id="authTitle">{view === 'forgot' && step === 'password' ? C.newTitle : C.title}</h3>
        <p className="sub">{C.sub}</p>
        {alert && <div className={'alert ' + alert.type}>{alert.msg}</div>}
        {view === 'signup' && (
          <div className="row-2">
            <Field id="auName" label={C.name} error={errors.name}><input id="auName" type="text" autoComplete="name" value={name} onChange={e => setName(e.target.value)} placeholder="Asha" /></Field>
            <div className="field"><label htmlFor="auKid">{C.kid}</label>
              <select id="auKid" value={kid} onChange={e => setKid(e.target.value)} style={{ background: 'rgba(246,240,228,0.07)', border: '1px solid var(--glass-border)', padding: '14px 16px', borderRadius: 'var(--r-md)', color: 'var(--fg)', font: 'inherit' }}>
                {CLASSES.map(c => <option key={c.id} value={c.id} style={{ color: '#000' }}>{c.label}</option>)}
              </select>
              <div className="err" />
            </div>
          </div>
        )}
        {(view !== 'forgot' || step === 'email') && (
          <Field id="auEmail" label="Email" error={errors.email}><input id="auEmail" type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="parent@email.com" autoFocus /></Field>
        )}
        {view === 'forgot' && step === 'code' && (
          <Field id="auCode" label={C.code} error={errors.code}>
            <input id="auCode" className="code-input" type="text" inputMode="numeric" maxLength={6} value={code} onChange={e => setCode(e.target.value)} placeholder="000000" autoFocus />
            {reset && reset.code && <div className="demo-chip">{C.demo} <b>{reset.code}</b></div>}
            {online && <div className="demo-chip">{AUTH.forgot.sub}</div>}
          </Field>
        )}
        {(view === 'signin' || view === 'signup' || step === 'password') && (
          <Field id="auPass" label="Password" error={errors.pass}>
            <input id="auPass" type="password" autoComplete={view === 'signin' ? 'current-password' : 'new-password'} value={pass} onChange={e => setPass(e.target.value)} placeholder={view === 'signin' ? '••••••••' : 'At least 8 characters'} />
            {view !== 'signin' && <div className="meter" style={{ display: 'flex', gap: 5 }}>{[1, 2, 3, 4].map(i => <i key={i} style={{ flex: 1, height: 3, borderRadius: 3, background: i <= strength ? 'var(--accent)' : 'rgba(246,240,228,0.16)', transition: 'background .25s' }} />)}</div>}
          </Field>
        )}
        {view === 'forgot' && step === 'password' && (
          <Field id="auConfirm" label="Confirm password" error={errors.confirm}><input id="auConfirm" type="password" autoComplete="new-password" value={confirm} onChange={e => setConfirm(e.target.value)} placeholder="Repeat it once more" /></Field>
        )}
        {view === 'signin' && <div className="between"><span /><button type="button" className="link" onClick={() => switchTo('forgot')}>{C.forgot}</button></div>}
        <button type="submit" className="btn btn-primary btn-block" disabled={busy}>{view === 'forgot' && step === 'password' ? C.newSubmit : C.submit}</button>
        {view === 'signin' && <p className="switch">{C.switchText} <button type="button" className="link" onClick={() => switchTo('signup')}>{C.switchLink}</button></p>}
        {view === 'signup' && <p className="switch">{C.switchText} <button type="button" className="link" onClick={() => switchTo('signin')}>{C.switchLink}</button></p>}
        {view === 'forgot' && <p className="switch"><button type="button" className="link" onClick={() => switchTo('signin')}>{C.back}</button></p>}
      </motion.form>
    </motion.div>
  );
}
