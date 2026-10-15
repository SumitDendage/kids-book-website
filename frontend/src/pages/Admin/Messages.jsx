import { useState } from 'react';
import MetricCard from '../../components/dashboard/MetricCard.jsx';
import Pill from '../../components/dashboard/Pill.jsx';
import Icon from '../../components/dashboard/Icon.jsx';
import Modal from '../../components/dashboard/Modal.jsx';
import { Pager } from '../../components/dashboard/DataTable.jsx';
import { Guard, ErrorNote } from '../../components/dashboard/States.jsx';
import { useDash } from '../Portal/DashContext.js';
import { useStaffGet, useAct, fmt, ago, qs, plural, problem, fieldErrors } from '../Portal/dashboard.js';
import { staffApi } from '../../services/api.js';

const STATUS = [['', 'All'], ['new', 'New'], ['read', 'Read'], ['replied', 'Replied'], ['archived', 'Archived']];
const STATUS_LABEL = { new: 'New', read: 'Read', replied: 'Replied', archived: 'Archived' };
const keep = { status: '', limit: 20 };

/* Messages: the contact form's inbox from the server. Open a note to mark it read; reply by
   email from here (the customer gets it from the shop, with replies going to the shop inbox),
   mark it replied, or archive it. */
export default function Messages() {
  const { can, go, refreshCounts } = useDash();
  const act = useAct();
  const [status, setStatusState] = useState(keep.status);
  const [limit, setLimitState] = useState(keep.limit);
  const [offset, setOffset] = useState(0);
  const [reply, setReply] = useState(null);
  const setStatus = s => { keep.status = s; setStatusState(s); setOffset(0); };
  const setLimit = n => { keep.limit = n; setLimitState(n); setOffset(0); };
  const list = useStaffGet('/api/admin/messages' + qs({ status, limit, offset }), { keep: true });
  const d = list.data;
  const ms = (d && d.messages) || [];
  const canWrite = can('messages.write');

  /* one note changed on the server: show its new state */
  const put = m => { if (m) list.setData(x => ({ ...x, messages: ((x && x.messages) || []).map(y => (y.id === m.id ? m : y)) })); list.reload(true); };
  const setStatusOf = async (m, to, msg) => { const r = await act(() => staffApi('POST', '/api/admin/messages/' + m.id + '/status', { status: to }), msg); if (r && r.message) put(r.message); };
  const opened = (e, m) => {
    if (e.currentTarget.parentElement.open) return;   /* closing it */
    if (m.status === 'new' && canWrite) staffApi('POST', '/api/admin/messages/' + m.id + '/status', { status: 'read' }).then(r => { list.setData(x => ({ ...x, unread: Math.max(0, ((x && x.unread) || 0) - 1), messages: ((x && x.messages) || []).map(y => (y.id === r.message.id ? r.message : y)) })); refreshCounts(); }).catch(() => {});
  };

  return (
    <Guard state={list} rows={6}>
      {d ? <div className="kpi-row" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))' }}>
        <MetricCard label="Notes" value={d.total} sub="through the contact form" icon="messages" />
        <MetricCard label="Unread" value={d.unread} sub={d.unread ? 'waiting to be read' : 'all caught up'} icon="clock" />
        <MetricCard label="Shop inbox" value={d.inbox || 'Not set'} sub={d.mail ? 'each note is also emailed here' : 'email is not set up, so notes stay here only'} icon="mail" />
      </div> : null}
      <section className="panel">
        <div className="row-between"><div><p className="eyebrow">Messages</p>
          <p className="auth-sub">Everything sent through <b>Contact us</b> lands here. {canWrite ? 'Open a note to read it, then reply from here or mark it done.' : 'Your role can read notes but not answer them.'}</p></div></div>
        <div className="chips" role="group" aria-label="Show">
          {STATUS.map(([id, label]) => <button key={id || 'all'} type="button" className={'chip' + (status === id ? ' on' : '')} onClick={() => setStatus(id)}>{label}</button>)}
        </div>
        {list.error ? <ErrorNote error={list.error} onRetry={list.reload} compact /> : null}
        {ms.length ? <div className="msg-list">{ms.map(m => (
          <details key={m.id} className={'err-item msg' + (m.status === 'new' ? ' unread' : '')}>
            <summary onClick={e => opened(e, m)}><b>{m.name}</b> <small>{m.email} · {fmt(m.at)}</small>{' '}
              <Pill tone={m.status === 'new' ? 'info' : m.status === 'replied' ? 'ok' : 'neutral'}>{STATUS_LABEL[m.status] || m.status}</Pill>{' '}
              {m.mailed ? <Pill tone="ok" title="A copy went to the shop inbox">Emailed</Pill> : <Pill tone="neutral" title={m.mailError || undefined}>In the panel only</Pill>}</summary>
            <p className="msg-body">{m.body}</p>
            {m.mailed ? null : <p className="auth-sub">The copy to the shop inbox was not sent{m.mailError ? ' (' + m.mailError.replace(/\s+—\s+/g, ', ') + ')' : ''}. The note itself is safe here.</p>}
            {m.replied ? <p className="auth-sub">Replied {ago(m.replied)}.</p> : null}
            <div className="btn-row">
              {canWrite ? <button type="button" className="btn btn-primary btn-sm" onClick={() => setReply(m)}><Icon id="reply" size={14} />Reply</button> : null}
              <a className="btn btn-ghost btn-sm" href={'mailto:' + m.email + '?subject=' + encodeURIComponent('Re: your note to Learn With Why')}><Icon id="mail" size={14} />Reply in my email app</a>
              {canWrite && m.status !== 'replied' ? <button type="button" className="btn btn-ghost btn-sm" onClick={() => setStatusOf(m, 'replied', 'Marked as replied')}>Mark as replied</button> : null}
              {canWrite && m.status !== 'archived' ? <button type="button" className="btn btn-ghost btn-sm" onClick={() => setStatusOf(m, 'archived', 'Archived')}><Icon id="archive" size={14} />Archive</button> : null}
              {canWrite && m.status === 'archived' ? <button type="button" className="btn btn-ghost btn-sm" onClick={() => setStatusOf(m, 'read', 'Back in the inbox')}><Icon id="undo" size={14} />Back to the inbox</button> : null}
              {canWrite && m.status === 'read' ? <button type="button" className="btn btn-ghost btn-sm" onClick={() => setStatusOf(m, 'new', 'Marked as unread')}>Mark as unread</button> : null}
              {m.user && can('customers.read') ? <button type="button" className="btn btn-ghost btn-sm" onClick={() => go('customers', { customer: m.user })}><Icon id="users" size={14} />Open the customer</button> : null}
            </div>
          </details>
        ))}</div> : <p className="cart-empty">{list.loading ? 'Loading…' : status ? 'No ' + STATUS_LABEL[status].toLowerCase() + ' notes.' : 'No notes yet. They appear the moment a visitor sends one.'}</p>}
        {d && d.total > limit && !status ? <Pager total={d.total} offset={offset} limit={limit} count={ms.length} onPage={setOffset} onLimit={setLimit} /> : null}
        {d && status && (ms.length === limit || offset > 0) ? <div className="btn-row pager-lite">
          <button type="button" className="btn btn-ghost btn-sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - limit))}>Newer</button>
          <button type="button" className="btn btn-ghost btn-sm" disabled={ms.length < limit} onClick={() => setOffset(offset + limit)}>Older</button>
        </div> : null}
      </section>
      {reply ? <ReplyDialog m={reply} onClose={() => setReply(null)} onDone={msg => { setReply(null); put(msg); refreshCounts(); }} /> : null}
    </Guard>
  );
}

function ReplyDialog({ m, onClose, onDone }) {
  const { toast } = useDash();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false), [err, setErr] = useState(null);
  const submit = async () => {
    if (text.trim().length < 2) { setErr('Write the reply first.'); return; }
    setBusy(true); setErr(null);
    try {
      const r = await staffApi('POST', '/api/admin/messages/' + m.id + '/reply', { body: text.trim() });
      toast('Reply sent to ' + m.email);
      onDone(r.message);
    } catch (e) { const fe = fieldErrors(e); setErr(fe.body || problem(e)); setBusy(false); }
  };
  return (
    <Modal title={'Reply to ' + m.name} onClose={onClose} onSubmit={submit} submitLabel="Send the reply" busyLabel="Sending…" busy={busy} error={err} wide>
      <p>It goes by email to <b>{m.email}</b> with their note quoted below. Their answer comes back to the shop inbox.</p>
      <blockquote className="msg-quote">{m.body}</blockquote>
      <div className="field"><label htmlFor="msgReply">Your reply</label><textarea id="msgReply" rows={7} maxLength={5000} value={text} onChange={e => setText(e.target.value)} placeholder={'Hello ' + m.name + ','} /><small>{plural(text.trim().length, 'character')} of 5000</small></div>
    </Modal>
  );
}
