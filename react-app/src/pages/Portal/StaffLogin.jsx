import { useState } from 'react';
import { read, write, audit, pushLog, setStaffSession } from '../../services/storage.js';
import { isEmail, strongPass, hash } from '../../utils/format.js';

export const STAFF = {
  admin: { title: 'Admin account', kicker: 'Staff · admin', blurb: 'Customers, unlocked sheets, prices and licences.' },
  developer: { title: 'Developer', kicker: 'Staff · developer', blurb: 'Where things live and what plugs in where.' },
};
/* staff accounts: sign up, then sign in (admin and developer kept apart).
   A browser-only demo, as before — real staff logins belong on the server. */
const staffUsers = () => read('lww_staff_users', []);
const findStaff = (kind, email) => staffUsers().find(u => u.kind === kind && u.email === email) || null;

export default function StaffLogin({ kind, onSignedIn }) {
  const [view, setView] = useState('signin');
  const [alert, setAlert] = useState('');
  const up = view === 'signup', cfg = STAFF[kind];
  const switchTo = v => { setView(v); setAlert(''); };
  const submit = e => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const em = String(f.get('email') || '').trim().toLowerCase(), pw = String(f.get('password') || '');
    if (!isEmail(em)) return setAlert('Enter a valid email address.');
    if (up) {
      audit(em, 'staff signup', kind);
      const name = String(f.get('name') || '').trim();
      if (!name) return setAlert('Tell us your name.');
      const weak = strongPass(pw); if (weak) return setAlert(weak);
      if (findStaff(kind, em)) return setAlert('That email already has a ' + kind + ' account. Sign in instead.');
      write('lww_staff_users', staffUsers().concat([{ kind, name, email: em, pw: hash(pw), created: Date.now() }]));
    } else {
      const u = findStaff(kind, em);
      if (!u || u.pw !== hash(pw)) { pushLog('lww_security', { at: Date.now(), type: 'failed_staff_login', email: em, where: kind }, 300); return setAlert('We could not match that ' + kind + ' email and password.'); }
      audit(em, 'staff signin', kind);
    }
    setStaffSession({ kind, email: em, at: Date.now() });
    onSignedIn((up ? 'Account created — signed in as ' : 'Signed in as ') + kind);
  };
  return (
    <form className="panel portal-login" noValidate onSubmit={submit} key={view}>
      <div className="tabs" role="tablist" style={{ gridTemplateColumns: '1fr 1fr' }}><button type="button" role="tab" aria-selected={up} className={'tab' + (up ? ' on' : '')} onClick={() => switchTo('signup')}>Sign up</button><button type="button" role="tab" aria-selected={!up} className={'tab' + (up ? '' : ' on')} onClick={() => switchTo('signin')}>Sign in</button></div>
      <h3 className="card-title" style={{ marginBottom: '6px' }}>{up ? 'Create a ' + kind + ' account' : 'Sign in as ' + kind}</h3><p className="auth-sub">{cfg.blurb}</p>
      <div role="alert">{alert ? <div className="alert err">{alert}</div> : null}</div>
      {up ? <div className="field"><label htmlFor="stName">Name</label><input id="stName" name="name" type="text" autoComplete="name" placeholder="Your name" /><div className="err" /></div> : null}
      <div className="field"><label htmlFor="stEmail">Email</label><input id="stEmail" name="email" type="email" autoComplete="username" placeholder="you@learnwithwhy.in" /><div className="err" /></div>
      <div className="field"><label htmlFor="stPass">Password</label><input id="stPass" name="password" type="password" autoComplete={up ? 'new-password' : 'current-password'} placeholder={up ? 'At least 8 characters' : '••••••••'} /><div className="err" /></div>
      <button type="submit" className="btn btn-primary btn-block">{up ? 'Create account →' : 'Sign in →'}</button>
      <p className="switch">{up ? <>Already have one? <button type="button" className="link" onClick={() => switchTo('signin')}>Sign in</button></> : <>New here? <button type="button" className="link" onClick={() => switchTo('signup')}>Sign up</button></>}</p>
    </form>
  );
}
