import { useEffect, useState } from 'react';
import { AUTH } from '../../content';
import { passwordStrength } from '../../lib/authStore';
import { Alert, AuthChapter, Field, LinkButton, PasswordInput, Steps } from './FormBits';

const C = AUTH.password;
const M = AUTH.messages;

/* Create Account (step 2 of sign up) — also reused as "Create new password"
   at the end of the forgot-password flow. `seq` changes every time the parent
   shows this page, which clears the fields. */
export default function CreateAccount({ active, seq, mode, email, alert: outerAlert, onDone, onGo }) {
  const [pass, setPass] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const isReset = mode === 'reset';
  const strength = pass ? passwordStrength(pass) : 0;

  useEffect(() => { setPass(''); setConfirm(''); setErrors({}); }, [seq]);

  async function submit(e) {
    e.preventDefault();
    const next = {};
    if (pass.length < 8) next.pass = M.shortPassword;
    else if (!/[A-Z]/.test(pass) || !/[0-9]/.test(pass)) next.pass = M.weakPassword;
    if (confirm !== pass) next.confirm = M.mismatch;
    setErrors(next);
    if (Object.keys(next).length) return;
    setBusy(true);
    try { await onDone(pass); } finally { setBusy(false); }
  }

  return (
    <AuthChapter view="password" active={active} aside={C}>
      <form className="auth-card rise" style={{ '--i': 1 }} onSubmit={submit} noValidate>
        <Steps on={2} />
        <h1 className="auth-title">{isReset ? C.resetTitle : C.createTitle}</h1>
        <p className="auth-sub">{isReset ? C.resetSub : C.createSub}<b>{email}</b>.</p>
        <Alert alert={outerAlert} />
        <Field id="cpPass" label="Password" error={errors.pass}>
          <PasswordInput id="cpPass" value={pass} onChange={setPass} autoComplete="new-password" placeholder="At least 8 characters" />
          <div className={'meter' + (strength ? ' s' + strength : '')}><i /><i /><i /><i /></div>
          <div className="pw-hint">{C.strength[strength]}</div>
        </Field>
        <Field id="cpConfirm" label="Confirm password" error={errors.confirm}>
          <PasswordInput id="cpConfirm" value={confirm} onChange={setConfirm} autoComplete="new-password" placeholder="Repeat it once more" />
        </Field>
        <button type="submit" className="btn btn-primary btn-block" disabled={busy}>{isReset ? C.resetSubmit : C.createSubmit}</button>
        <p className="switch"><LinkButton onClick={() => onGo('signin')}>{C.back}</LinkButton></p>
      </form>
    </AuthChapter>
  );
}
