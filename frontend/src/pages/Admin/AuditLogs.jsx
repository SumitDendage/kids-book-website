import { useEffect, useMemo, useState } from 'react';
import DataTable from '../../components/dashboard/DataTable.jsx';
import { Guard, ErrorNote } from '../../components/dashboard/States.jsx';
import { useDash } from '../Portal/DashContext.js';
import { useStaffGet, fmt, qs, tzName, ROLE_LABEL } from '../Portal/dashboard.js';
import { startOfDayIso, endOfDayIso } from './common.js';

/* what each logged action means, in a few words */
const ACTION = {
  'worksheet.create': 'Added a sheet', 'worksheet.update': 'Changed a sheet', 'worksheet.archive': 'Archived a sheet', 'worksheet.restore': 'Restored a sheet',
  'worksheet.delete': 'Deleted a sheet', 'worksheet.file_upload': 'Uploaded a sheet PDF', 'worksheet.cover_upload': 'Uploaded a cover', 'worksheet.page_upload': 'Uploaded a page picture',
  'class.create': 'Added a class', 'class.update': 'Changed a class', 'plan.create': 'Added a plan', 'plan.update': 'Changed a plan price',
  'coupon.create': 'Added a coupon', 'coupon.update': 'Changed a coupon', 'coupon.delete': 'Deleted a coupon', 'coupon.deactivate': 'Switched a coupon off',
  'order.update': 'Changed an order', 'order.refund': 'Recorded a refund', 'order.cancelled': 'Cancelled an order',
  'order.paid': 'Order paid', 'order.refunded': 'Refunded by the payment gateway', 'payment.refunded': 'Payment refunded in the gateway',
  'session.block': 'Stopped a sign-in', 'session.unblock': 'Allowed a sign-in again',
  'entitlement.grant': 'Gave access', 'entitlement.revoke': 'Took access away', 'entitlement.extend': 'Extended access',
  'account.block': 'Blocked an account', 'account.unblock': 'Unblocked an account', 'account.sessions_end': 'Signed a customer out everywhere',
  'account.password_reset_link': 'Sent a password reset', 'account.password_reset_failed': 'Password reset email failed',
  'access.suspend': 'Paused paid access', 'access.restore': 'Restored paid access',
  'security.warning_issue': 'Gave a sharing warning', 'security.warning_revoke': 'Removed a warning', 'security.warnings_reset': 'Cleared warnings',
  'security.incident_open': 'Opened a sharing case', 'security.incident_confirm': 'Confirmed a sharing case', 'security.incident_dismiss': 'Dismissed a sharing case',
  'security.appeal_decide': 'Answered an appeal', 'security.rule_update': 'Changed a sharing rule', 'security.report': 'Reported sharing',
  'staff.create': 'Added a staff member', 'staff.update': 'Changed a staff member', 'staff.deactivate': 'Removed a staff member', 'staff.create_failed': 'Could not add a staff member',
  'message.read': 'Read a message', 'message.replied': 'Marked a message replied', 'message.reply': 'Replied to a message', 'message.status': 'Moved a message',
  'content.update': 'Changed site text', 'content.publish': 'Published site text', 'content.reset': 'Reset site text',
  'faq.create': 'Added an answer', 'faq.update': 'Changed an answer', 'faq.delete': 'Deleted an answer', 'review.status': 'Moderated a review',
  'settings.update': 'Changed a setting', 'export.run': 'Downloaded a CSV', 'backup.download': 'Downloaded a backup',
  'email.retry': 'Resent an email', 'email.skip': 'Skipped an email', 'email.process': 'Sent waiting emails', 'notification.read': 'Read notifications',
};
const AREAS = [['', 'Everything'], ['worksheet.*', 'Products'], ['order.*', 'Orders'], ['payment.*', 'Payments'], ['entitlement.*', 'Access'], ['account.*', 'Accounts'], ['security.*', 'Sharing and safety'], ['session.*', 'Sign-ins'], ['access.*', 'Paid access'],
  ['coupon.*', 'Coupons'], ['plan.*', 'Plans'], ['content.*', 'Site text'], ['faq.*', 'Answers'], ['review.*', 'Reviews'], ['message.*', 'Messages'],
  ['staff.*', 'Staff'], ['settings.*', 'Settings'], ['export.*', 'Downloads'], ['email.*', 'Emails']];
const keep = { area: '', limit: 50 };

/* a short line for the change: "price: 19 → 25" */
function summary(detail) {
  if (!detail || typeof detail !== 'object') return detail == null ? '' : String(detail);
  const show = v => (v == null ? 'none' : typeof v === 'object' ? JSON.stringify(v).slice(0, 40) : String(v).slice(0, 40));
  const b = detail.before && typeof detail.before === 'object' ? detail.before : null, a = detail.after && typeof detail.after === 'object' ? detail.after : null;
  if (a || b) {
    const keys = [...new Set([...Object.keys(b || {}), ...Object.keys(a || {})])].slice(0, 4);
    if (keys.length) return keys.map(k => k + ': ' + show(b ? b[k] : null) + ' → ' + show(a ? a[k] : null)).join(' · ');
  }
  if (detail.reason) return 'Reason: ' + String(detail.reason).slice(0, 120);
  return JSON.stringify(detail).slice(0, 120);
}

/* Audit logs: everything staff changed, from the server, newest first (read-only). Shared by the
   Admin and Developer panels. */
export default function AuditLogs() {
  const { can, me } = useDash();
  const [area, setAreaState] = useState(keep.area);
  const [limit, setLimitState] = useState(keep.limit);
  const [offset, setOffset] = useState(0);
  const [text, setText] = useState(''), [search, setSearch] = useState('');
  const [actor, setActor] = useState(''), [who, setWho] = useState('');
  const [from, setFrom] = useState(''), [to, setTo] = useState('');
  useEffect(() => { const t = setTimeout(() => { setSearch(text.trim()); setOffset(0); }, 300); return () => clearTimeout(t); }, [text]);
  useEffect(() => { const t = setTimeout(() => { const a = actor.trim(); if (!a || a.includes('@') || a.toLowerCase() === 'system') { setWho(a); setOffset(0); } }, 400); return () => clearTimeout(t); }, [actor]);
  const setArea = a => { keep.area = a; setAreaState(a); setOffset(0); };
  const setLimit = n => { keep.limit = n; setLimitState(n); setOffset(0); };
  const q = useStaffGet('/api/admin/audit' + qs({ action: area, q: search, actor: who, from: startOfDayIso(from), to: endOfDayIso(to), tz: tzName(), limit, offset }), { keep: true });
  const rows = (q.data && q.data.audit) || [];
  /* staff names by account id: the server's actorName when it sends one, else the staff list
     (staff managers), else at least the signed-in staff member's own name */
  const staff = useStaffGet(can('staff.manage') ? '/api/admin/staff' : null);
  const names = useMemo(() => {
    const m = new Map();
    ((staff.data && staff.data.staff) || []).forEach(s => { if (s.name) m.set(s.userId || s.id, s.name); });
    if (me && me.user && me.user.name) m.set(me.user.id, me.user.name);
    return m;
  }, [staff.data, me]);
  const nameOf = x => x.actorName || (x.actorId ? names.get(x.actorId) : null) || null;
  return (
    <Guard state={q} rows={8}>
      <section className="panel">
        <div className="row-between"><div><p className="eyebrow">Audit logs{q.data ? ' · ' + q.data.total : ''}</p><p className="auth-sub">Every change made by staff, newest first. Nothing here can be edited or removed.</p></div>
          <div className="btn-row"><input className="search" type="search" placeholder="Search the log…" aria-label="Search the log" value={text} onChange={e => setText(e.target.value)} /></div></div>
        <div className="filters">
          <label className="inline-field"><span>Area</span><select value={area} onChange={e => setArea(e.target.value)}>{AREAS.map(([v, l]) => <option key={v || 'all'} value={v}>{l}</option>)}</select></label>
          <label className="inline-field"><span>Who</span><input type="search" placeholder="staff email, or system" value={actor} onChange={e => setActor(e.target.value)} /></label>
          <label className="inline-field"><span>From</span><input type="date" value={from} onChange={e => { setFrom(e.target.value); setOffset(0); }} /></label>
          <label className="inline-field"><span>To</span><input type="date" value={to} onChange={e => { setTo(e.target.value); setOffset(0); }} /></label>
        </div>
        {q.error ? <ErrorNote error={q.error} onRetry={q.reload} compact /> : null}
        <DataTable head={['When', 'Who', 'What', 'Change']} empty={q.loading ? 'Loading…' : 'Nothing logged for these filters.'}
          page={{ total: q.data ? q.data.total : 0, offset, limit, onPage: setOffset, onLimit: setLimit, sizes: [25, 50, 100, 200] }}
          rows={rows.map(x => ({ key: x.id, cells: [
            <span key="t" className="nowrap">{fmt(x.at)}</span>,
            <span key="w" className="audit-who">{nameOf(x) ? <><b>{nameOf(x)}</b><small>{x.actor}</small></> : (x.actor && x.actor !== 'system' ? x.actor : 'System')}{x.role ? <small>{ROLE_LABEL[x.role] || x.role}</small> : null}</span>,
            <span key="a"><b>{ACTION[x.action] || x.action}</b>{x.targetId ? <small className="mono">{x.targetType ? x.targetType + ' ' : ''}{String(x.targetId)}</small> : null}</span>,
            x.detail ? <details key="d" className="audit-detail"><summary>{summary(x.detail)}</summary><pre className="code">{JSON.stringify(x.detail, null, 2)}</pre></details> : '',
          ] }))} />
      </section>
    </Guard>
  );
}
