import { useState } from 'react';
import { AUTH } from '../../content';
import { emailTaken, isEmail } from '../../lib/authStore';
import { Alert, AuthChapter, Field, LinkButton, Steps } from './FormBits';

const C = AUTH.signup;
const M = AUTH.messages;

/* Step 1 of 2 — who the account is for. Password comes on the next screen. */
export default function SignUp({ active, onContinue, onGo }) {
  const [name, setName] = useState('');
  const [kid, setKid] = useState('');
  const [email, setEmail] = useState('');
  const [terms, setTerms] = useState(false);
  const [errors, setErrors] = useState({});
  const [alert, setAlert] = useState(null);

  async function submit(e) {
    e.preventDefault();
    setAlert(null);
    const next = {};
    if (!name.trim()) next.name = M.needName;
    if (kid && !/^\d{1,2}$/.test(kid.trim())) next.kid = M.badAge;
    if (!isEmail(email)) next.email = M.badEmail;
    setErrors(next);
    let ok = !Object.keys(next).length;
    if (!terms) { setAlert({ type: 'err', msg: M.acceptTerms }); ok = false; }
    if (!ok) return;
    if (await emailTaken(email)) { setAlert({ type: 'err', msg: M.emailTaken }); return; }
    onContinue({ name: name.trim(), kidAge: kid.trim(), email: email.trim().toLowerCase() });
  }

  return (
    <AuthChapter view="signup" active={active} aside={C}>
      <form className="auth-card rise" style={{ '--i': 1 }} onSubmit={submit} noValidate>
        <Steps on={1} />
        <h1 className="auth-title">{C.title}</h1>
        <p className="auth-sub">{C.sub}</p>
        <Alert alert={alert} />
        <div className="row-2">
          <Field id="suName" label={C.nameLabel} error={errors.name}>
            <input id="suName" type="text" autoComplete="name" placeholder={C.namePlaceholder} value={name} onChange={e => setName(e.target.value)} />
          </Field>
          <Field id="suKid" label={C.kidLabel} error={errors.kid}>
            <input id="suKid" type="text" inputMode="numeric" placeholder={C.kidPlaceholder} value={kid} onChange={e => setKid(e.target.value)} />
          </Field>
        </div>
        <Field id="suEmail" label="Email" error={errors.email}>
          <input id="suEmail" type="email" autoComplete="email" placeholder={AUTH.signin.emailPlaceholder} value={email} onChange={e => setEmail(e.target.value)} />
        </Field>
        <label className="check" style={{ fontSize: '0.82rem', color: 'var(--fg-muted)', marginBottom: 16, display: 'flex' }}>
          <input type="checkbox" checked={terms} onChange={e => setTerms(e.target.checked)} /> {C.terms}
        </label>
        <button type="submit" className="btn btn-primary btn-block">{C.submit}</button>
        <p className="switch">{C.switchText} <LinkButton onClick={() => onGo('signin')}>{C.switchLink}</LinkButton></p>
      </form>
    </AuthChapter>
  );
}
