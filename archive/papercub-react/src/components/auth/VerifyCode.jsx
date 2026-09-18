import { useEffect, useState } from 'react';
import { AUTH } from '../../content';
import { online, verifyReset } from '../../lib/authStore';
import { Alert, AuthChapter, Field, LinkButton, Steps } from './FormBits';

const C = AUTH.code;
const M = AUTH.messages;
/* Online the code arrives by email; the demo shows it on screen. */
const aside = online ? { ...C, text: C.textOnline } : C;

/* Second step of Forgot Password. A new `reset` (fresh code) clears the
   input. Demo only: the code is shown on screen instead of emailed. */
export default function VerifyCode({ active, reset, onVerified, onGo }) {
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { setCode(''); setError(''); }, [reset]);

  async function submit(e) {
    e.preventDefault();
    setError('');
    if (!reset) { onGo('forgot'); return; }
    setBusy(true);
    const ok = await verifyReset(reset.email, code);
    setBusy(false);
    if (!ok) { setError(M.badCode); return; }
    onVerified();
  }

  return (
    <AuthChapter view="code" active={active} aside={aside}>
      <form className="auth-card rise" style={{ '--i': 1 }} onSubmit={submit} noValidate>
        <Steps on={2} />
        <h1 className="auth-title">{C.title}</h1>
        <p className="auth-sub">{C.sub}{reset ? reset.email : 'your email'}.</p>
        <Alert alert={null} />
        <Field id="rcCode" label="Reset code" error={error}>
          <input id="rcCode" className="code-input" type="text" inputMode="numeric" maxLength={6} placeholder="000000" value={code} onChange={e => setCode(e.target.value)} />
          {reset && reset.code && <div className="demo-chip">{C.demo} <b>{reset.code}</b></div>}
        </Field>
        <button type="submit" className="btn btn-primary btn-block" disabled={busy}>{C.submit}</button>
        <p className="switch"><LinkButton onClick={() => onGo('forgot')}>{C.back}</LinkButton></p>
      </form>
    </AuthChapter>
  );
}
