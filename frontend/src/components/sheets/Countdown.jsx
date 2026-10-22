import { useEffect, useState } from 'react';

/* "23h 59m 10s left", "2d 3h 15m left", "4m 05s left", "19s left" — how long a bought sheet still opens */
export function leftText(ms) {
  if (!(ms > 0)) return 'Your access has expired';
  const s = Math.floor(ms / 1000), d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const two = n => String(n).padStart(2, '0');
  if (d) return d + 'd ' + h + 'h ' + m + 'm left';
  if (h) return h + 'h ' + two(m) + 'm ' + two(sec) + 's left';
  if (m) return m + 'm ' + two(sec) + 's left';
  return sec + 's left';
}

/* A live timer to `end` (ms, the server's clock). skew = the server's clock minus this device's.
   onDone runs once when it reaches zero (the sheet then leaves My Worksheets). */
export default function Countdown({ end, skew = 0, onDone, className = 'countdown' }) {
  const [now, setNow] = useState(() => Date.now() + skew);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now() + skew), 1000);
    return () => clearInterval(t);
  }, [skew]);
  const done = end != null && end - now <= 0;
  useEffect(() => { if (done && onDone) onDone(); }, [done]); // eslint-disable-line react-hooks/exhaustive-deps
  if (end == null) return null;
  return <span className={className + (end - now < 3600e3 ? ' soon' : '')} role="timer"><span aria-hidden="true">⏱ </span>{leftText(end - now)}</span>;
}
