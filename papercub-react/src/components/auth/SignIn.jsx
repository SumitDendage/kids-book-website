import { useEffect, useState } from 'react';
import { AUTH } from '../../content';
import { isEmail, signIn } from '../../lib/authStore';
import { Alert, AuthChapter, Field, LinkButton, PasswordInput, Steps } from './FormBits';

const C = AUTH.signin;
const M = AUTH.messages;

export default function SignIn({ active, notice, onSignedIn, onGuest, onGo }) {
  const [email, setEmail] = useState('');
  const [pass, setPass] = useState('');
  const [remember, setRemember] = useState(true);
  const [errors, setErrors] = useState({});
  const [alert, setAlert] = useState(null);
  const [busy, setBusy] = useState(false);

  /* "Password updated" / "Signed out" notices arrive from the app after a beat. */
  useEffect(() => { if (notice) setAlert(notice); }, [notice]);

  async function submit(e) {
    e.preventDefault();
    setAlert(null);
    const next = {};
    if (!isEmail(email)) next.email = M.badEmail;
    if (!pass) next.pass = M.needPassword;
    setErrors(next);
    if (Object.keys(next).length) return;
    setBusy(true);
    try { onSignedIn(await signIn(email, pass, remember)); }
    catch (err) { setAlert({ type: 'err', msg: err.message || M.signinFail }); }
    finally { setBusy(false); }
  }

  return (
    <AuthChapter view="signin" active={active} aside={C}>
      <form className="auth-card rise" style={{ '--i': 1 }} onSubmit={submit} noValidate>
        <Steps on={1} />
        <h1 className="auth-title">{C.title}</h1>
        <p className="auth-sub">{C.sub}</p>
        <Alert alert={alert} />
        <Field id="siEmail" label="Email" error={errors.email}>
          <input id="siEmail" type="email" autoComplete="email" placeholder={C.emailPlaceholder} value={email} onChange={e => setEmail(e.target.value)} />
        </Field>
        <Field id="siPass" label="Password" error={errors.pass}>
          <PasswordInput id="siPass" value={pass} onChange={setPass} autoComplete="current-password" placeholder="••••••••" />
        </Field>
        <div className="between">
          <label className="check"><input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)} /> {C.remember}</label>
          <LinkButton onClick={() => onGo('forgot')}>{C.forgot}</LinkButton>
        </div>
        <button type="submit" className="btn btn-primary btn-block" disabled={busy}>{C.submit}</button>
        <p className="switch">{C.switchText} <LinkButton onClick={() => onGo('signup')}>{C.switchLink}</LinkButton></p>
        <p className="switch" style={{ marginTop: 10 }}><LinkButton onClick={onGuest}>{C.guest}</LinkButton></p>
      </form>
    </AuthChapter>
  );
}
