import { useState } from 'react';
import Chapter from '../layout/Chapter.jsx';
import Rise from '../common/Rise.jsx';
import { sendContact } from '../../services/api.js';
import { isEmail } from '../../utils/format.js';

/* 05 · Contact us — the note goes through Web3Forms (services/api.js) to the shop's inbox.
   The email, WhatsApp and Instagram line is gone from here (Sumit, Oct 7); those buttons
   live in the footer. */
export default function ContactChapter() {
  const [f, setF] = useState({ name: '', email: '', msg: '' });
  const [errs, setErrs] = useState({});
  const [alert, setAlert] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = k => e => setF(x => ({ ...x, [k]: e.target.value }));

  async function onSubmit(e) {
    e.preventDefault();
    const name = f.name.trim(), email = f.email.trim(), msg = f.msg.trim();
    const errors = { ctName: name ? '' : 'Your name, please.', ctEmail: isEmail(email) ? '' : 'Enter a valid email address.', ctMsg: msg.length >= 10 ? '' : 'A little more detail helps us reply.' };
    setErrs(errors);
    if (errors.ctName || errors.ctEmail || errors.ctMsg) return;
    setBusy(true); setAlert(null);
    try {
      await sendContact({ name, email, message: msg });
      setF({ name: '', email: '', msg: '' });
      setAlert({ type: 'ok', body: <>Thank you, {name.split(' ')[0]} — your note is with us. We reply within one working day.</> });
    } catch (err) {
      setAlert({ type: 'err', body: err.message });
    } finally { setBusy(false); }
  }
  const field = (id, label, input) => (
    <div className={'field' + (errs[id] ? ' bad' : '')}><label htmlFor={id}>{label}</label>{input}<div className="err" role={errs[id] ? 'alert' : undefined}>{errs[id] || ''}</div></div>
  );
  return (
    <Chapter index={4}>
      <div className="contact-grid">
        <div>
          <Rise as="p" i={0} className="eyebrow">05 / Every good thing starts with hello</Rise>
          <Rise as="h2" i={1} className="h2">A little question?<br />A big <em>idea</em>?</Rise>
          <Rise as="p" i={2} className="lede">Tell us what your learners need. We&apos;d love to make their next discovery a little more wonderful.</Rise>
          <Rise as="p" i={2} className="whisper">Even the rabbit wrote in once. We answered before teatime.</Rise>
        </div>
        <Rise as="form" i={2} className="panel contact-card" id="contactForm" noValidate onSubmit={onSubmit}>
          <h2 className="card-title">Leave a little note.</h2>
          <div id="contactAlert" aria-live="polite">{alert && <div className={'alert ' + alert.type}>{alert.body}</div>}</div>
          {field('ctName', 'Your name', <input id="ctName" type="text" autoComplete="name" placeholder="Your name" value={f.name} onChange={set('name')} />)}
          {field('ctEmail', 'Email address', <input id="ctEmail" type="email" autoComplete="email" placeholder="you@example.com" value={f.email} onChange={set('email')} />)}
          {field('ctMsg', 'Your message', <textarea id="ctMsg" placeholder="What's on your mind?" value={f.msg} onChange={set('msg')} />)}
          <button type="submit" className="btn btn-primary btn-block" disabled={busy}>{busy ? 'Sending…' : 'Send a little note →'}</button>
        </Rise>
      </div>
    </Chapter>
  );
}
