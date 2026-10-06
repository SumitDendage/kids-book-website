import { useState } from 'react';
import Chapter from '../layout/Chapter.jsx';
import Rise from '../common/Rise.jsx';
import { sendContact } from '../../services/api.js';
import { isEmail } from '../../utils/format.js';
import { INBOX, WHATSAPP } from '../../data/content.js';

/* the WhatsApp mark (Simple Icons, CC0), drawn in the current colour */
const WhatsAppIcon = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><path fill="currentColor" d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z" /></svg>
);

/* 05 · Contact us — the note is posted to /api/contact, which writes it to the
   database and emails a copy to the shop inbox, so nothing is lost even if mail is down. */
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
      setAlert({ type: 'ok', body: <>Thank you, {name.split(' ')[0]} — your note is with us at <b>{INBOX}</b>. We reply within one working day.</> });
    } catch (err) {
      setAlert({ type: 'err', body: <>{err.message} You can also write straight to <a href={'mailto:' + INBOX}>{INBOX}</a>.</> });
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
          <Rise i={3} className="contact-lines"><span className="contact-reach">✉ <a href={'mailto:' + INBOX}>{INBOX}</a><a className="wa-link" href={WHATSAPP} target="_blank" rel="noopener noreferrer" aria-label="Chat with us on WhatsApp" title="Chat with us on WhatsApp"><WhatsAppIcon /></a></span><span>Mon – Sat, 10:00 – 18:00 IST · Pune, India</span></Rise>
        </div>
        <Rise as="form" i={2} className="panel contact-card" id="contactForm" noValidate onSubmit={onSubmit}>
          <h2 className="card-title">Leave a little note.</h2>
          <div id="contactAlert" aria-live="polite">{alert && <div className={'alert ' + alert.type}>{alert.body}</div>}</div>
          {field('ctName', 'Your name', <input id="ctName" type="text" autoComplete="name" placeholder="Your name" value={f.name} onChange={set('name')} />)}
          {field('ctEmail', 'Email address', <input id="ctEmail" type="email" autoComplete="email" placeholder="you@example.com" value={f.email} onChange={set('email')} />)}
          {field('ctMsg', 'Your message', <textarea id="ctMsg" placeholder="What's on your mind?" value={f.msg} onChange={set('msg')} />)}
          <button type="submit" className="btn btn-primary btn-block" disabled={busy}>{busy ? 'Sending…' : 'Send a little note →'}</button>
          <p className="switch">Your note goes straight to <a href={'mailto:' + INBOX}>{INBOX}</a>.</p>
        </Rise>
      </div>
    </Chapter>
  );
}
