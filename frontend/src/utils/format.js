/* Small helpers shared by the site, the staff panels and the viewer. */
export const isEmail = v => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(v || '').trim());
export function strongPass(p) { if (p.length < 8) return 'At least 8 characters.'; if (!/[A-Z]/.test(p) || !/[0-9]/.test(p)) return 'Add a capital letter and a number.'; return ''; }
/* staff demo accounts only — never used for customer passwords (those are scrypt-hashed on the server) */
export const hash = s => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0; return 'p' + h.toString(36); };
export const dateOf = ms => new Date(ms).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
export const dateTimeOf = ms => new Date(ms).toLocaleString('en-IN', { day: 'numeric', month: 'long', year: 'numeric', hour: 'numeric', minute: '2-digit' });
export const flagOf = code => code === 'OTHER' ? '🌐' : String.fromCodePoint(...code.split('').map(ch => 0x1F1E6 + ch.charCodeAt(0) - 65));
export const shortClass = label => label.replace('Kindergarten', 'KG').replace('Class ', 'C');
/* Date and time with the time zone named, e.g. "8 Oct 2027, 9:15 pm IST". Stored times are UTC;
   this shows them in the visitor's zone (or `tz`), and always says which zone that is. */
export function dateTimeTz(v, tz) {
  const d = new Date(v);
  if (v == null || Number.isNaN(d.getTime())) return '';
  let zone = tz;
  try { zone = zone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Kolkata'; } catch { zone = 'Asia/Kolkata'; }
  let text, name;
  try {
    text = d.toLocaleString('en-IN', { timeZone: zone, day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
    name = /^Asia\/(Kolkata|Calcutta)$/.test(zone) ? 'IST'
      : (new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'short' }).formatToParts(d).find(p => p.type === 'timeZoneName') || {}).value || zone;
  } catch {
    text = d.toLocaleString('en-IN', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
    name = 'UTC';
  }
  return `${text} ${name}`;
}
/* "just now", "5 minutes ago", "3 hours ago", "2 days ago"; older than a month shows the date */
export function timeAgo(v, now = Date.now()) {
  const t = new Date(v).getTime();
  if (v == null || !Number.isFinite(t)) return '';
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60); if (m < 60) return m + (m === 1 ? ' minute ago' : ' minutes ago');
  const h = Math.round(m / 60); if (h < 24) return h + (h === 1 ? ' hour ago' : ' hours ago');
  const d = Math.round(h / 24); if (d < 31) return d + (d === 1 ? ' day ago' : ' days ago');
  return 'on ' + dateOf(t);
}
