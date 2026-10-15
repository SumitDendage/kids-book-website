/* Browser errors, kept small and private. The Developer panel now reads its error and
   API figures from the server, so nothing here is written to localStorage any more and
   fetch() is no longer wrapped. The last few errors stay in memory only (recentErrors()),
   which helps when someone looks at the page in the browser console. Installed once
   from main.jsx; it never throws and never changes what the page does. */
export const BOOT_AT = Date.now();
let installed = false;
const errors = [];

const keep = e => { errors.push(e); if (errors.length > 50) errors.shift(); };
export const recentErrors = () => errors.slice();

export function installTelemetry() {
  if (installed) return; installed = true;
  /* the old browser logs (every fetch and error) are not needed any more: tidy them away */
  try { localStorage.removeItem('lww_api'); localStorage.removeItem('lww_errors'); } catch (_) { /* storage blocked */ }
  try {
    addEventListener('error', e => keep({ at: Date.now(), msg: String((e && e.message) || e), file: e && e.filename, line: e && e.lineno }));
    addEventListener('unhandledrejection', e => keep({ at: Date.now(), msg: 'Unhandled promise: ' + String((e && e.reason && e.reason.message) || (e && e.reason)) }));
  } catch (_) { /* never in the way */ }
}
