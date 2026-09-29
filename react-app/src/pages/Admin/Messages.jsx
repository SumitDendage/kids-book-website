import MetricCard from '../../components/dashboard/MetricCard.jsx';
import Pill from '../../components/dashboard/Pill.jsx';
import Icon from '../../components/dashboard/Icon.jsx';
import { useDash } from '../Portal/DashContext.js';
import { save, log, fmt, adminKey, adminApi, sync } from '../Portal/dashboard.js';
import { read } from '../../services/storage.js';
import { INBOX } from '../../data/content.js';

/* Messages — the contact form's inbox. Every note is in the database; the
   Delivered pill says whether the copy by email went out as well. */
export default function Messages() {
  const { toast, refresh } = useDash();
  const ms = read('lww_messages', []).slice().sort((a, b) => b.at - a.at), inbox = read('lww_inbox', INBOX);
  const unread = ms.filter(m => !m.read).length, stuck = ms.filter(m => !m.mailed).length;
  /* opening a note marks it read (the pill stays until the next redraw, as before) */
  const markRead = (e, id) => {
    if (e.currentTarget.parentElement.open) return;
    const all = read('lww_messages', []), m = all.find(x => x.id === id);
    if (m && !m.read) { m.read = Date.now(); save('lww_messages', all); if (adminKey()) adminApi('POST', '/api/admin/messages/read', { id }).catch(() => {}); }
  };
  const replied = id => {
    const all = read('lww_messages', []), m = all.find(x => x.id === id); if (!m) return;
    m.replied = Date.now(); m.read = m.read || Date.now(); save('lww_messages', all); log('replied to note', m.email); toast('Marked as replied');
    if (adminKey()) adminApi('POST', '/api/admin/messages/replied', { id }).catch(err => toast('Server: ' + err.message));
    refresh();
  };
  return (
    <>
      <div className="kpi-row" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))' }}>
        <MetricCard label="Notes" value={ms.length} sub="through the contact form" icon="messages" />
        <MetricCard label="Unread" value={unread} sub={unread ? 'waiting for a reply' : 'all caught up'} icon="clock" />
        <MetricCard label="Inbox" value={inbox} sub={stuck ? stuck + ' not emailed on' : 'every note is emailed here'} icon="panel" />
      </div>
      <section className="panel"><p className="eyebrow">Messages · {ms.length}</p>
        <p className="auth-sub">{adminKey() ? 'Live from the database' + (sync.at ? ' · synced ' + fmt(sync.at) : '') + '. ' : 'Save the admin key under Settings → Server connection to load the inbox. '}Everything sent through <b>Contact us</b> lands here and is emailed to <b>{inbox}</b>. Open one and hit Reply — the customer&apos;s address is already filled in.</p>
        {ms.length ? <div>{ms.map(m => (
          <details key={m.id} className="err-item">
            <summary onClick={e => markRead(e, m.id)}><b>{m.name}</b> <small>{m.email} · {fmt(m.at)}</small> {m.read ? null : <Pill tone="info">new</Pill>} {m.replied ? <Pill tone="ok">replied</Pill> : null} {m.mailed ? <Pill tone="ok">emailed</Pill> : <Pill tone="neutral">in the panel only</Pill>}</summary>
            <p style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6, margin: '10px 0 14px' }}>{m.body}</p>
            {m.mailed ? null : <p className="auth-sub" style={{ marginBottom: '10px' }}>Not emailed on{m.mailError ? ' — ' + m.mailError : ''}. The note itself is safe here.</p>}
            <div className="btn-row"><a className="btn btn-primary btn-sm" href={'mailto:' + m.email + '?subject=' + encodeURIComponent('Re: your note to Learn With Why')}><Icon id="messages" size={14} />Reply by email</a>
              <button type="button" className="btn btn-ghost btn-sm" disabled={!!m.replied} onClick={() => replied(m.id)}>{m.replied ? 'Replied ' + fmt(m.replied) : 'Mark as replied'}</button></div>
          </details>
        ))}</div> : <p className="cart-empty">No notes yet — they appear the moment a visitor sends one.</p>}
      </section>
    </>
  );
}
