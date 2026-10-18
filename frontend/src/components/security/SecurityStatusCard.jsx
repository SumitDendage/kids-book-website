import { useCallback, useEffect, useRef, useState } from 'react';
import { useSecurity } from '../../context/SecurityContext.jsx';
import { useSite } from '../../context/SiteContext.jsx';
import { APPEAL_KINDS, APPEAL_STATUS, appealKindLabel, mailTo, securityService } from '../../services/security.js';
import { dateTimeTz } from '../../utils/format.js';

/* My Account → Security: the warning count ("2 of 3"), whether paid sheets are open or paused,
   each warning with what we saw and when it ends, and a note to the team (one open note at a
   time). Everything comes from the server; nothing is shown before it answers. */
export default function SecurityStatusCard() {
  const sec = useSecurity();
  const { session, drawer } = useSite();
  /* opening My Account on this card asks the server again */
  const reload = sec ? sec.reload : null, shown = drawer === 'bag';
  useEffect(() => { if (shown && reload) reload(); }, [shown, reload]);
  if (!sec || !sec.email) return null;
  const { status, loading, error, supportEmail } = sec;
  const tz = (session && session.timeZone) || undefined;
  const paused = !!status && status.accessStatus === 'suspended';
  const max = status ? status.maxWarnings : 3;
  return (
    <>
      <section className={'sec-card' + (paused ? ' is-suspended' : '')} aria-labelledby="secCardTitle" aria-busy={loading ? 'true' : 'false'}>
        <div className="sec-card-head"><p className="eyebrow" id="secCardTitle">Account security</p></div>
        {loading && !status ? <p className="sec-card-note" role="status"><span className="sec-spin" aria-hidden="true" />Checking your account…</p> : null}
        {error && !status ? <div className="alert err" role="alert">We could not load your account security just now. <button type="button" className="link" onClick={sec.reload}>Try again</button></div> : null}
        {status ? (
          <>
            <p className="sec-count">Security warnings: <b>{status.warningCount} of {max}</b></p>
            <ol className="sec-steps" aria-hidden="true">{Array.from({ length: max }, (_, i) => <li key={i} className={i < status.warningCount ? 'on' : ''} />)}</ol>
            <p className="sec-access">Paid sheets <span className={'sec-pill ' + (paused ? 'suspended' : 'active')}>{paused ? 'Paused' : 'Open'}</span></p>
            <p className="sec-card-note">
              {paused
                ? 'Paid sheets are paused on this account under our account-sharing rules. Free sheets still open, and you can still sign in and see your orders. If you think this is a mistake, send us a note below.'
                : status.warningCount === 0
                  ? 'No warnings on your account. Your account is personal, so please keep it and your sign-in codes to yourself.'
                  : 'We saw signs that your account may be shared. Each warning ends on its own after a while. After ' + max + ' warnings, paid sheets are paused.'}
            </p>
            {status.warnings.length ? (
              <ul className="sec-warn-list">
                {status.warnings.map(w => (
                  <li key={w.id}>
                    <b>Warning {w.level}</b><span className="sec-when">{w.issuedAt ? dateTimeTz(w.issuedAt, tz) : ''}</span>
                    {w.reason ? <span className="sec-what">{w.reason}</span> : null}
                    {w.expiresAt ? <small>Ends on {dateTimeTz(w.expiresAt, tz)}</small> : null}
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        ) : null}
      </section>
      {status ? <AppealBox status={status} tz={tz} supportEmail={supportEmail} onSent={sec.reload} /> : null}
    </>
  );
}

/* A note to the team about a warning, paused sheets or a stopped sign-in (POST /api/me/appeals).
   The server keeps one open note per account; the answer comes by email and shows here. */
function AppealBox({ status, tz, supportEmail, onSent }) {
  const paused = status.accessStatus === 'suspended';
  const [list, setList] = useState(null);
  const [listErr, setListErr] = useState('');
  const [open, setOpen] = useState(paused || status.warningCount > 0);
  const [kind, setKind] = useState(paused ? 'suspension' : status.warningCount > 0 ? 'warning' : 'block');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const load = useCallback(() => {
    securityService.appeals().then(l => { if (alive.current) { setList(l); setListErr(''); } }, e => { if (alive.current) setListErr(e.status === 0 ? 'We could not reach Learn With Why just now.' : e.message); });
  }, []);
  const openId = status.openAppeal ? status.openAppeal.id : null;
  useEffect(() => { load(); }, [load, openId]);

  const waiting = status.openAppeal || (list && list.find(a => a.status === 'open')) || null;
  const send = async e => {
    e.preventDefault(); setErr(''); setOk('');
    const text = msg.trim();
    if (text.length < 10) { setErr('Write a few words so we can help (10 letters or more).'); return; }
    setBusy(true);
    try {
      const w = kind === 'warning' && status.warnings.length ? status.warnings[status.warnings.length - 1].id : null;
      await securityService.sendAppeal({ kind, message: text, warningId: w });
      if (!alive.current) return;
      setMsg(''); setOk('Thank you. We have your note and will answer by email soon.');
      load(); if (onSent) onSent();
    } catch (x) {
      if (!alive.current) return;
      if (x.code === 'appeal_open' || x.status === 409) { setErr('You already sent us a note that is waiting for an answer. We will reply soon.'); load(); if (onSent) onSent(); }
      else if (x.status === 429) setErr('You have sent a few notes already. Please wait a little and try again.');
      else setErr(x.status === 0 ? 'We could not reach Learn With Why just now. Please try again.' : x.message);
    } finally { if (alive.current) setBusy(false); }
  };

  return (
    <section className="sec-card sec-appeal" aria-labelledby="secAppealTitle">
      <div className="sec-card-head"><p className="eyebrow" id="secAppealTitle">Write to us</p></div>
      {ok ? <div className="alert ok" role="status">{ok}</div> : null}
      {waiting ? (
        <p className="sec-card-note">We have your note from {waiting.createdAt ? dateTimeTz(waiting.createdAt, tz) : 'earlier'} and will answer by email. You can send another note once we have answered.</p>
      ) : open ? (
        <form className="sec-appeal-form" noValidate onSubmit={send}>
          <p className="sec-card-note">Think a warning or a pause is a mistake? Tell us what happened and we will look at it.</p>
          <div className="field">
            <label htmlFor="apKind">What is it about?</label>
            <select id="apKind" value={kind} onChange={e => setKind(e.target.value)}>{APPEAL_KINDS.map(k => <option key={k.id} value={k.id}>{k.label}</option>)}</select>
          </div>
          <div className={'field' + (err ? ' bad' : '')}>
            <label htmlFor="apMsg">Your note</label>
            <textarea id="apMsg" maxLength={4000} placeholder="For example: my child and I use the same tablet at home." value={msg} onChange={e => setMsg(e.target.value)} aria-invalid={err ? 'true' : undefined} aria-describedby="apMsgErr" />
            <div className="err" id="apMsgErr" role={err ? 'alert' : undefined}>{err}</div>
          </div>
          <button type="submit" className="btn btn-primary btn-block" disabled={busy}>{busy ? 'Sending…' : 'Send my note'}</button>
        </form>
      ) : (
        <p className="sec-card-note">Something not right with your account? <button type="button" className="link" onClick={() => setOpen(true)}>Send us a note</button> or email <a className="link" href={mailTo(supportEmail, 'My account')}>{supportEmail}</a>.</p>
      )}
      {listErr && !list ? <p className="sec-card-note">{listErr} <button type="button" className="link" onClick={load}>Try again</button></p> : null}
      {list && list.length ? (
        <ul className="sec-appeals">
          {list.map(a => (
            <li key={a.id}>
              <div className="sec-appeal-top"><b>{appealKindLabel(a.kind)}</b><span className={'sec-pill ' + (a.status === 'accepted' ? 'active' : 'unknown')}>{APPEAL_STATUS[a.status] || a.status}</span></div>
              <small>Sent {a.createdAt ? dateTimeTz(a.createdAt, tz) : ''}</small>
              <p>{a.message}</p>
              {a.response ? <p className="sec-answer"><b>Our answer:</b> {a.response}</p> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
