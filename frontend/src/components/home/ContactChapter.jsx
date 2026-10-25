import { useState } from 'react';
import Chapter from '../layout/Chapter.jsx';
import Rise from '../common/Rise.jsx';
import { contactApi, sendContact } from '../../services/api.js';
import { getCoConfig, loadCoConfig } from '../../services/checkout.js';
import { isEmail } from '../../utils/format.js';
import { Sticker } from '../common/Slogans.jsx';
import { TAGLINES } from '../../data/content.js';

/* 05 · Contact us. The note goes to our own server first (POST /api/contact): it lands in the staff
   inbox and is emailed to the shop once email is set up there. While the server cannot send email yet
   (GET /api/config features.email is false), the old Web3Forms copy goes too, so the owner still gets
   an email. If our server cannot be reached at all, Web3Forms alone carries the note.
   The email, WhatsApp and Instagram line is gone from here (Sumit, Oct 7); those buttons
   live in the footer. */
const FIELD = { name: 'ctName', email: 'ctEmail', message: 'ctMsg' };
async function deliver(note) {
  try {
    await contactApi.send(note);
  } catch (err) {
    if (err.status === 0 || err.status >= 500) return sendContact(note);   /* our server is out of reach: Web3Forms alone */
    throw err;   /* the server said what is wrong (a field, too many notes) */
  }
  let emailOn = false;
  try { const cfg = getCoConfig() || await loadCoConfig(); emailOn = !!(cfg && cfg.features && cfg.features.email); } catch (_) { emailOn = false; }
  if (!emailOn) { try { await sendContact(note); } catch (_) { /* the note is safe in our inbox already */ } }
  return null;
}
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
      await deliver({ name, email, message: msg });
      setF({ name: '', email: '', msg: '' });
      setAlert({ type: 'ok', body: <>Thank you, {name.split(' ')[0]}. Your note is with us, and we reply within one working day.</> });
    } catch (err) {
      const fe = err.body && err.body.errors;
      if (fe && typeof fe === 'object') setErrs(Object.fromEntries(Object.keys(fe).filter(k => FIELD[k]).map(k => [FIELD[k], fe[k]])));
      setAlert({ type: 'err', body: err.status === 429 ? 'You have sent a few notes already. Please wait a few minutes and try again.' : err.message });
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
          <Rise i={1} className="sticker-row"><Sticker tilt={-3}>{TAGLINES.contact}</Sticker></Rise>
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
