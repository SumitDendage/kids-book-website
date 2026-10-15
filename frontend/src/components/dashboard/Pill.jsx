/* status pills: the tone comes from the value (paid → green, cancelled → red …) or is given */
const TONE = {
  paid: 'ok', active: 'ok', delivered: 'ok', ok: 'ok', loaded: 'ok', online: 'ok', signin: 'ok', published: 'ok', replied: 'ok', live: 'ok', sent: 'ok', granted: 'ok', yes: 'ok', on: 'ok',
  signup: 'info', pending: 'info', shipped: 'info', invited: 'info', created: 'info', unpaid: 'info', new: 'info', scheduled: 'info', draft: 'neutral', planned: 'neutral', queued: 'info', pending_verification: 'info',
  cancelled: 'bad', refunded: 'bad', failed: 'bad', 'signin failed': 'bad', revoked: 'bad', blocked: 'bad', suspended: 'bad', rejected: 'bad', missing: 'bad',
  expired: 'neutral', none: 'neutral', archived: 'neutral', hidden: 'neutral', read: 'neutral', lapsed: 'neutral', off: 'neutral', no: 'neutral', ended: 'neutral',
  '#1f6b47': 'ok', '#7a2b2b': 'bad',
};

export default function Pill({ children, tone, title }) {
  const cls = TONE[tone] || tone || TONE[String(children).toLowerCase()] || '';
  return <span className={'pill' + (cls ? ' ' + cls : '')} title={title}>{children}</span>;
}
