/* Browser telemetry for the Developer panel (Errors and API monitoring):
   every error, unhandled rejection and fetch() call is logged to localStorage,
   exactly as the original page script did. Installed once from main.jsx. */
import { pushLog } from './storage.js';

export const BOOT_AT = Date.now();
let installed = false;

export function installTelemetry() {
  if (installed) return; installed = true;
  addEventListener('error', e => pushLog('lww_errors', { at: Date.now(), msg: String(e.message || e), file: e.filename, line: e.lineno, stack: e.error && e.error.stack ? String(e.error.stack).slice(0, 1200) : '' }, 100));
  addEventListener('unhandledrejection', e => pushLog('lww_errors', { at: Date.now(), msg: 'Unhandled promise: ' + String(e.reason && e.reason.message || e.reason), stack: e.reason && e.reason.stack ? String(e.reason.stack).slice(0, 1200) : '' }, 100));
  const _fetch = window.fetch.bind(window);
  window.fetch = async (url, opt) => { const t0 = performance.now(); try { const r = await _fetch(url, opt); pushLog('lww_api', { at: Date.now(), url: String(url).slice(0, 160), status: r.status, ms: Math.round(performance.now() - t0) }, 200); return r; } catch (err) { pushLog('lww_api', { at: Date.now(), url: String(url).slice(0, 160), status: 0, ms: Math.round(performance.now() - t0), error: String(err.message || err) }, 200); throw err; } };
}
