/* status pills — the tone comes from the value (paid → green, cancelled → red …) or is given */
const TONE = { paid: 'ok', active: 'ok', delivered: 'ok', ok: 'ok', loaded: 'ok', online: 'ok', signin: 'ok', signup: 'info', pending: 'info', shipped: 'info', invited: 'info', cancelled: 'bad', refunded: 'bad', expired: 'neutral', failed: 'bad', 'signin failed': 'bad', none: 'neutral', '#1f6b47': 'ok', '#7a2b2b': 'bad' };

export default function Pill({ children, tone }) {
  const cls = TONE[tone] || tone || TONE[String(children).toLowerCase()] || '';
  return <span className={'pill' + (cls ? ' ' + cls : '')}>{children}</span>;
}
