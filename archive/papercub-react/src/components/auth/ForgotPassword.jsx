import { useState } from 'react';
import { AUTH } from '../../content';
import { isEmail, requestReset } from '../../lib/authStore';
import { Alert, AuthChapter, Field, LinkButton, Steps } from './FormBits';

const C = AUTH.forgot;
const M = AUTH.messages;

export default function ForgotPassword({ active, onSent, onGo }) {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [alert, setAlert] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setAlert(null); setError('');
    if (!isEmail(email)) { setError(M.badEmail); return; }
    setBusy(true);
    try { onSent(await requestReset(email)); }
    catch (err) { setAlert({ type: 'err', msg: err.message || M.noAccount }); }
    finally { setBusy(false); }
  }

  return (
    <AuthChapter view="forgot" active={active} aside={C}>
      <form className="auth-card rise" style={{ '--i': 1 }} onSubmit={submit} noValidate>
        <Steps on={1} />
        <h1 className="auth-title">{C.title}</h1>
        <p className="auth-sub">{C.sub}</p>
        <Alert alert={alert} />
        <Field id="fpEmail" label="Email" error={error}>
          <input id="fpEmail" type="email" autoComplete="email" placeholder={AUTH.signin.emailPlaceholder} value={email} onChange={e => setEmail(e.target.value)} />
        </Field>
        <button type="submit" className="btn btn-primary btn-block" disabled={busy}>{C.submit}</button>
        <p className="switch">{C.switchText} <LinkButton onClick={() => onGo('signin')}>{C.switchLink}</LinkButton></p>
      </form>
    </AuthChapter>
  );
}
