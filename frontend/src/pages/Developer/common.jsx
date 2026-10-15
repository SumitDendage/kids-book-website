import { useCallback, useEffect, useState } from 'react';
import { staffApi, staffAuth, staffFetch, staffTokens } from '../../services/api.js';
import { validateStaffResponse } from '../../services/staffResponse.js';
import { useDash } from '../Portal/DashContext.js';
import { dateTimeTz } from '../../utils/format.js';
import Icon from '../../components/dashboard/Icon.jsx';

/* Shared by the Developer pages and Admin → Security: who is signed in and what they may do,
   loading from the server, friendly errors, number and date formats, small notes, file downloads
   and the styles these pages add to the dashboard's own. Everything shown comes from the server
   (/api/admin/*); nothing is kept in this browser. */

/* ---------- the staff member's permissions ----------
   The server decides; this only hides buttons the server would refuse. GET /api/admin/me answers
   { user, staff: { role, permissions } } (the permissions this member really has). One request per
   sign-in, shared by every page. */
let meCache = { key: null, promise: null, value: null };
const tokenKey = () => { const t = staffTokens.get(); return t ? String(t.refreshToken || t.accessToken || '') : ''; };
export function loadMe(force) {
  const key = tokenKey();
  if (!force && meCache.promise && meCache.key === key) return meCache.promise;
  const p = staffAuth.me().then(
    b => { if (meCache.promise === p) meCache.value = b; return b; },
    err => { if (meCache.promise === p) meCache = { key: null, promise: null, value: null }; throw err; },
  );
  meCache = { key, promise: p, value: null };
  return p;
}
const accessOf = b => (b && b.staff && Array.isArray(b.staff.permissions) ? { role: b.staff.role || null, permissions: b.staff.permissions, user: b.user || null } : null);
/* the dashboard may already hold the answer (the /api/admin/me body, or { role, permissions }) */
function accessFromDash(ctx) {
  if (!ctx) return null;
  const fromMe = accessOf(ctx.me);
  if (fromMe) return fromMe;
  const s = ctx.staff;
  if (s && Array.isArray(s.permissions) && s.role) return { role: s.role, permissions: s.permissions, user: ctx.user || null };
  return null;
}

/* { ready, error, role, user, can(p), canAny([...]) }. Until the answer arrives nothing is allowed. */
export function useStaffAccess() {
  const dash = useDash();
  const given = accessFromDash(dash);
  const [mine, setMine] = useState(() => (meCache.value && meCache.key === tokenKey() ? accessOf(meCache.value) : null));
  const [error, setError] = useState(null);
  const need = !given;
  useEffect(() => {
    if (!need) return undefined;
    let alive = true;
    loadMe().then(b => { if (alive) { setMine(accessOf(b)); setError(null); } }, err => { if (alive) setError(err); });
    return () => { alive = false; };
  }, [need]);
  const a = given || mine;
  const perms = a ? a.permissions : [];
  const can = p => !!a && (a.role === 'owner' || perms.includes(p));
  return { ready: !!a, error, role: a ? a.role : null, user: a ? a.user : null, can, canAny: list => list.some(can) };
}

/* ---------- loading from the server ---------- */
/* GET `path` as staff: { data, error, loading, reload }. A new path forgets the old answer; a reload
   keeps it on screen until the new one arrives. `skip` (no permission, nothing chosen) asks nothing. */
export function useServer(path, opt) {
  const skip = !!(opt && opt.skip) || !path;
  const version = (opt && opt.version) || 0;
  const dash = useDash();
  const lost = dash && typeof dash.authLost === 'function' ? dash.authLost : null;
  const [st, setSt] = useState({ key: null, data: null, error: null, loading: !skip });
  const [n, setN] = useState(0);
  const reload = useCallback(() => setN(x => x + 1), []);
  useEffect(() => {
    if (skip) { setSt({ key: null, data: null, error: null, loading: false }); return undefined; }
    let alive = true;
    setSt(s => ({ key: path, data: s.key === path ? s.data : null, error: null, loading: true }));
    staffApi('GET', path).then(d => validateStaffResponse(path, d)).then(
      d => { if (alive) setSt({ key: path, data: d, error: null, loading: false }); },
      e => {
        if (!alive) return;
        setSt(s => ({ key: path, data: s.key === path ? s.data : null, error: e, loading: false }));
        if (e && e.status === 401 && lost) lost(e);   /* the sign-in ended: the panel shows the sign-in page */
      },
    );
    return () => { alive = false; };
  }, [path, skip, version, n]);   // eslint-disable-line react-hooks/exhaustive-deps
  return { data: st.data, error: st.error, loading: st.loading, reload };
}

/* a button handler that opens another section of this panel, or null when it cannot be opened */
export function useGo() {
  const dash = useDash();
  return id => (dash && typeof dash.go === 'function' && (typeof dash.allowed !== 'function' || dash.allowed(id)) ? () => dash.go(id) : null);
}

/* a query string from an object, leaving out empty values */
export function qs(o) {
  const p = new URLSearchParams();
  Object.entries(o || {}).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '' && v !== false) p.set(k, String(v)); });
  const s = p.toString();
  return s ? '?' + s : '';
}

/* ---------- errors in plain words ---------- */
export const NO_PERMISSION = 'You do not have permission for this.';
const GENERIC_403 = 'Your staff role does not allow this.';
export function problem(err) {
  if (!err) return '';
  if (err.status === 403 && (!err.code || ['forbidden', 'not_staff', 'owner_only', 'staff_only'].includes(err.code))) {
    const m = String(err.message || '');
    return m && m !== GENERIC_403 && !/^HTTP \d+$/.test(m) ? NO_PERMISSION + ' ' + m : NO_PERMISSION;
  }
  if (err.status === 401) return 'Your staff sign-in has ended. Sign in again to carry on.';
  if (err.status === 429) return err.message && !/^HTTP \d+$/.test(err.message) ? err.message : 'Too many requests just now. Wait a minute and try again.';
  if (/^HTTP \d+$/.test(String(err.message || ''))) return 'That did not work (the server answered ' + err.message.slice(5) + '). Please try again.';
  return err.message || 'That did not work. Please try again.';
}
export const isForbidden = err => !!err && err.status === 403 && (!err.code || err.code === 'forbidden' || err.code === 'not_staff' || err.code === 'owner_only');

/* ---------- formats ---------- */
export const when = ms => (ms ? dateTimeTz(ms) : '');
export function ago(ms, now) {
  if (!ms) return '';
  const t = now || Date.now();
  const s = Math.round((t - ms) / 1000);
  if (s < 0) {
    const m = Math.round(-s / 60);
    if (m < 1) return 'in a moment';
    if (m < 60) return 'in ' + m + (m === 1 ? ' minute' : ' minutes');
    const h = Math.round(m / 60);
    if (h < 48) return 'in ' + h + (h === 1 ? ' hour' : ' hours');
    return 'on ' + when(ms);
  }
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return m + (m === 1 ? ' minute ago' : ' minutes ago');
  const h = Math.round(m / 60);
  if (h < 24) return h + (h === 1 ? ' hour ago' : ' hours ago');
  const d = Math.round(h / 24);
  if (d < 31) return d + (d === 1 ? ' day ago' : ' days ago');
  return 'on ' + when(ms);
}
export const count = n => (n == null || !Number.isFinite(Number(n)) ? '' : Number(n).toLocaleString('en-IN'));
export const plural = (n, one, many) => count(n) + ' ' + (Number(n) === 1 ? one : (many || one + 's'));
export const rupees = n => (n == null || !Number.isFinite(Number(n)) ? '' : '₹' + Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 }));
export function money(amount, currency) {
  if (amount == null || !Number.isFinite(Number(amount))) return '';
  const cur = String(currency || 'INR').toUpperCase();
  if (cur === 'INR') return rupees(amount);
  try { return new Intl.NumberFormat('en-IN', { style: 'currency', currency: cur }).format(Number(amount)); } catch (_) { return Number(amount).toLocaleString('en-IN') + ' ' + cur; }
}
export function bytes(n) {
  if (n == null || !Number.isFinite(Number(n))) return '';
  const v0 = Number(n);
  if (v0 < 1024) return v0 + ' bytes';
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = v0 / 1024, i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return (v >= 10 ? Math.round(v) : v.toFixed(1)) + ' ' + units[i];
}
export const ms = n => (n == null || !Number.isFinite(Number(n)) ? '' : (Number(n) < 10 ? Number(n).toFixed(1) : Math.round(Number(n))) + ' ms');
export const initialsOf = s => String(s || '').trim().split(/[\s@._-]+/).filter(Boolean).slice(0, 2).map(x => x[0].toUpperCase()).join('') || '?';
/* the zone the times on these pages are shown in */
export const ZONE_NAME = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch (_) { return 'UTC'; } })();

/* ---------- small pieces ---------- */
export function Loading({ children }) {
  return <p className="lw-loading" role="status"><span className="lw-spin" aria-hidden="true" />{children || 'Loading…'}</p>;
}
const NOTE_ICON = { ok: 'health', err: 'errors', info: 'activity', neutral: 'activity' };
export function Note({ tone = 'info', children, action }) {
  return (
    <div className={'lw-note ' + tone} role={tone === 'err' ? 'alert' : 'status'}>
      <Icon id={NOTE_ICON[tone] || 'activity'} size={16} />
      <div className="lw-note-text">{children}</div>
      {action || null}
    </div>
  );
}
/* a failed load: what failed, the reason in plain words and a Try again button */
export function LoadError({ error, what, onRetry }) {
  if (!error) return null;
  const denied = isForbidden(error);
  return (
    <Note tone={denied ? 'neutral' : 'err'} action={onRetry && !denied ? <button type="button" className="btn btn-ghost btn-sm" onClick={onRetry}>Try again</button> : null}>
      {denied ? problem(error) : <>{what ? 'Could not load ' + what + '. ' : ''}{problem(error)}</>}
    </Note>
  );
}
/* the whole section needs a permission this staff member does not have */
export function NoAccess({ title, need }) {
  return (
    <section className="panel" data-no-access="">
      {title ? <p className="eyebrow">{title}</p> : null}
      <Note tone="neutral">{NO_PERMISSION} {need ? 'It needs the “' + need + '” permission, which the owner can give you under Roles.' : ''}</Note>
    </section>
  );
}
/* a panel heading with a line under it and room for buttons on the right */
export function PanelHead({ title, sub, id, children }) {
  return (
    <div className="row-between">
      <div><p className="eyebrow" id={id}>{title}</p>{sub ? <p className="auth-sub">{sub}</p> : null}</div>
      {children ? <div className="lw-actions">{children}</div> : null}
    </div>
  );
}
/* filter chips: options [[value, label, count?]] */
export function Chips({ value, onChange, options, label }) {
  return (
    <div className="chips" role="group" aria-label={label}>
      {options.map(([v, l, n]) => (
        <button key={v} type="button" className={'chip' + (value === v ? ' on' : '')} aria-pressed={value === v} data-chip={v} onClick={() => onChange(v)}>
          {l}{n != null && n !== '' ? <small>{n}</small> : null}
        </button>
      ))}
    </div>
  );
}
/* the dashboard's tab strip: options [[value, label, count?]] */
export function Tabs({ value, onChange, options, label }) {
  return (
    <div className="tabs-s" role="tablist" aria-label={label}>
      {options.map(([v, l, n]) => (
        <button key={v} type="button" role="tab" aria-selected={value === v} className={value === v ? 'on' : ''} data-tab={v} onClick={() => onChange(v)}>
          {l}{n ? <small>{n}</small> : null}
        </button>
      ))}
    </div>
  );
}
/* a status label in the dashboard's pill style, written exactly as given */
export function Tag({ tone = 'neutral', children, title }) {
  return <span className={'pill lw-plain ' + tone} title={title}>{children}</span>;
}
export const Missing = ({ children }) => <span className="lw-missing">{children || 'Not recorded'}</span>;
/* where the Supabase dashboard keeps something: words only, no link guessed for the project */
export const Where = ({ children }) => <span className="lw-where">{children}</span>;
/* label/value list */
export function KV({ rows }) {
  return (
    <dl className="lw-kv">
      {rows.filter(Boolean).map(([k, v]) => <div key={k} className="lw-kv-row"><dt>{k}</dt><dd>{v === '' || v == null ? <Missing /> : v}</dd></div>)}
    </dl>
  );
}

/* ---------- downloads (CSV exports, the settings backup) ----------
   Fetched with the staff sign-in, then saved under the server's file name. Returns
   { name, rows, truncated, size }; rows are counted here when the server's count is not readable. */
function csvRecords(text) {
  let n = 0, quoted = false, any = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') { quoted = !quoted; any = true; continue; }
    if (c === '\n' && !quoted) { if (any) n++; any = false; continue; }
    if (c !== '\r' && c !== '﻿') any = true;
  }
  if (any) n++;
  return Math.max(0, n - 1);   /* the first line is the header */
}
export async function downloadFrom(path, fallbackName) {
  const r = await staffFetch(path);
  if (!r.ok) {
    let b = {};
    try { b = await r.json(); } catch (_) { /* not JSON */ }
    throw Object.assign(new Error(b.error || 'HTTP ' + r.status), { status: r.status, code: b.code || null, body: b });
  }
  const cd = r.headers.get('Content-Disposition') || '';
  const m = /filename\*=UTF-8''([^;]+)/i.exec(cd) || /filename="?([^";]+)"?/i.exec(cd);
  let name = fallbackName || 'download';
  if (m) { try { name = decodeURIComponent(m[1]); } catch (_) { name = m[1]; } }
  const blob = await r.blob();
  const headerRows = r.headers.get('X-Row-Count'), headerTrunc = r.headers.get('X-Truncated');
  let rows = headerRows != null && headerRows !== '' ? Number(headerRows) : null;
  if (rows == null && /\.csv$/i.test(name)) rows = csvRecords(await blob.text());
  const url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = name; a.rel = 'noopener'; a.style.display = 'none';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return { name, rows, truncated: headerTrunc == null ? null : headerTrunc === 'true', size: blob.size };
}

/* ---------- styles (inside .dash, in the dashboard's colours, light and dark) ---------- */
const CSS = `
@keyframes lwSpin { to { transform: rotate(360deg); } }
.dash .lw-spin { display: inline-block; flex: none; width: 14px; height: 14px; border-radius: 50%; border: 2px solid currentColor; border-right-color: transparent; animation: lwSpin 0.8s linear infinite; }
.dash .lw-loading { display: flex; align-items: center; gap: 8px; margin: 0; font-size: 13px; color: var(--muted-foreground); }
.dash .lw-note { display: flex; align-items: flex-start; gap: 10px; padding: 10px 12px; border: 1px solid var(--border); border-radius: calc(var(--radius) - 2px); background: var(--muted); color: var(--foreground); font-size: 13px; line-height: 1.5; }
.dash .lw-note > svg { margin-top: 2px; color: var(--muted-foreground); }
.dash .lw-note.ok { background: var(--ok-bg); border-color: color-mix(in oklab, var(--ok) 30%, transparent); } .dash .lw-note.ok > svg { color: var(--ok); }
.dash .lw-note.err { background: var(--bad-bg); border-color: color-mix(in oklab, var(--bad) 30%, transparent); } .dash .lw-note.err > svg { color: var(--bad); }
.dash .lw-note.info { background: var(--info-bg); border-color: color-mix(in oklab, var(--info) 30%, transparent); } .dash .lw-note.info > svg { color: var(--info); }
.dash .lw-note-text { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.dash .lw-note-text p { margin: 0; } .dash .lw-note-text p + p { margin-top: 4px; }
.dash .lw-note .btn { flex: none; margin: -4px 0; }
.dash .pill.lw-plain { text-transform: none; }
.dash .lw-missing { color: var(--muted-foreground); font-style: italic; }
.dash .lw-muted { color: var(--muted-foreground); }
.dash .lw-where { font-weight: 500; color: var(--foreground); }
.dash .lw-mono, .dash code.lw-mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; overflow-wrap: anywhere; }
.dash .lw-small { font-size: 12px; color: var(--muted-foreground); }
.dash .lw-actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.dash .lw-bar { display: flex; flex-wrap: wrap; gap: 8px 12px; align-items: center; justify-content: space-between; }
.dash .lw-bar .search { width: 260px; max-width: 100%; }
.dash .lw-stack { display: grid; gap: 16px; min-width: 0; }
.dash .lw-who { display: flex; align-items: center; gap: 10px; min-width: 0; }
.dash .lw-who > span:last-child { min-width: 0; }
.dash .lw-who b { display: block; font-weight: 500; overflow-wrap: anywhere; }
.dash .lw-who small { display: block; font-size: 12px; color: var(--muted-foreground); overflow-wrap: anywhere; }
.dash .lw-kv { display: grid; gap: 0; margin: 0; font-size: 14px; }
.dash .lw-kv-row { display: grid; grid-template-columns: minmax(150px, 34%) 1fr; gap: 12px; padding: 8px 0; border-bottom: 1px solid var(--border); }
.dash .lw-kv-row:last-child { border-bottom: 0; }
.dash .lw-kv dt { color: var(--muted-foreground); }
.dash .lw-kv dd { margin: 0; min-width: 0; overflow-wrap: anywhere; }
.dash .lw-three { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
.dash .lw-three > div { display: grid; gap: 4px; align-content: start; padding: 12px 14px; border: 1px solid var(--border); border-radius: calc(var(--radius) - 2px); background: var(--background); }
.dash .lw-three b { font-size: 14px; font-weight: 600; }
.dash .lw-three p { margin: 0; font-size: 13px; line-height: 1.5; color: var(--muted-foreground); }
.dash .lw-controls { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
.dash .lw-control { display: flex; flex-direction: column; gap: 10px; padding: 14px 16px; border: 1px solid var(--border); border-radius: calc(var(--radius) - 2px); background: var(--background); }
.dash .lw-control.is-on { border-color: color-mix(in oklab, var(--bad) 40%, var(--border)); background: color-mix(in oklab, var(--bad-bg) 60%, var(--background)); }
.dash .lw-control-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
.dash .lw-control-head b { font-size: 14px; font-weight: 600; }
.dash .lw-control p { margin: 0; font-size: 13px; line-height: 1.5; color: var(--muted-foreground); }
.dash .lw-control .btn { align-self: flex-start; margin-top: auto; }
.dash .lw-cards { display: grid; gap: 12px; }
.dash .lw-card { display: grid; gap: 10px; padding: 14px 16px; border: 1px solid var(--border); border-radius: calc(var(--radius) - 2px); background: var(--background); min-width: 0; }
.dash .lw-card-head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; }
.dash .lw-card-head b { font-weight: 600; }
.dash .lw-card p { margin: 0; }
.dash .lw-meta { display: flex; flex-wrap: wrap; gap: 4px 16px; font-size: 12px; color: var(--muted-foreground); }
.dash .lw-quote { margin: 0; padding: 8px 12px; border-left: 3px solid var(--border); border-radius: 4px; background: var(--muted); font-size: 13px; line-height: 1.55; white-space: pre-wrap; overflow-wrap: anywhere; }
.dash .lw-pre { margin: 0; padding: 10px 12px; max-height: 240px; overflow: auto; border: 1px solid var(--border); border-radius: calc(var(--radius) - 2px); background: var(--muted); font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; white-space: pre-wrap; overflow-wrap: anywhere; }
.dash .lw-sub-title { margin: 0; font-size: 14px; font-weight: 600; }
.dash .lw-detail-head { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.dash .lw-detail-head .av { width: 40px; height: 40px; font-size: 14px; }
.dash .lw-detail-head h3 { margin: 0; }
.dash .lw-grow { flex: 1 1 auto; min-width: 0; }
.dash .lw-rule-params { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 12px; }
.dash .lw-rule-params .field { margin: 0; }
.dash .lw-switches { display: flex; flex-wrap: wrap; gap: 8px 20px; align-items: center; }
.dash .lw-switches .check { display: inline-flex; align-items: center; gap: 8px; cursor: pointer; }
.dash .lw-switches .check input:disabled + span { opacity: 0.6; }
.dash .lw-switches select { width: auto; height: 32px; }
.dash .lw-table td .btn { white-space: nowrap; }
.dash .lw-sr { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip: rect(0 0 0 0); border: 0; }
.dash .lw-filters { display: flex; flex-wrap: wrap; gap: 8px; align-items: flex-end; }
.dash .lw-filters .field { margin: 0; min-width: 150px; }
.dash .lw-filters input, .dash .lw-filters select { height: 32px; }
.dash .lw-bars { display: grid; gap: 8px; }
.dash .lw-barrow { display: grid; grid-template-columns: minmax(120px, 30%) 1fr auto; gap: 10px; align-items: center; font-size: 13px; }
.dash .lw-barrow i { display: block; height: 8px; border-radius: 4px; background: var(--chart-2); min-width: 2px; }
.dash .lw-barrow span:first-child { overflow-wrap: anywhere; }
@media (min-width: 641px) { .dash .tbl-wrap.lw-table td .lw-mono { overflow-wrap: break-word; } }
@media (max-width: 1024px) { .dash .lw-controls { grid-template-columns: 1fr; } }
@media (max-width: 900px) { .dash .lw-three { grid-template-columns: 1fr; } }
@media (max-width: 640px) {
  .dash .lw-bar .search { width: 100%; }
  .dash .lw-kv-row { grid-template-columns: 1fr; gap: 2px; }
  .dash .tbl-wrap.lw-table { border: 0; overflow: visible; }
  .dash .tbl-wrap.lw-table table, .dash .tbl-wrap.lw-table tbody, .dash .tbl-wrap.lw-table tr, .dash .tbl-wrap.lw-table td { display: block; width: 100%; }
  .dash .tbl-wrap.lw-table thead { display: none; }
  .dash .tbl-wrap.lw-table tr { padding: 6px 12px; margin-bottom: 10px; border: 1px solid var(--border); border-radius: calc(var(--radius) - 2px); }
  .dash .tbl-wrap.lw-table tr:last-child { margin-bottom: 0; }
  .dash .tbl-wrap.lw-table td, .dash .tbl-wrap.lw-table td:first-child, .dash .tbl-wrap.lw-table td:last-child { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 6px 0; text-align: right; border-bottom: 1px solid var(--border); }
  .dash .tbl-wrap.lw-table tbody tr:last-child td { border-bottom: 1px solid var(--border); }
  .dash .tbl-wrap.lw-table tbody tr td:last-child, .dash .tbl-wrap.lw-table tbody tr:last-child td:last-child { border-bottom: 0; }
  .dash .tbl-wrap.lw-table td::before { content: attr(data-label); flex: none; max-width: 45%; text-align: left; font-size: 12px; color: var(--muted-foreground); }
  .dash .tbl-wrap.lw-table td[data-label=""]::before { display: none; }
  .dash .tbl-wrap.lw-table td[data-label=""] { justify-content: flex-end; }
  .dash .tbl-wrap.lw-table td > * { min-width: 0; }
  .dash .tbl-wrap.lw-table .lw-who { text-align: left; }
  .dash .lw-barrow { grid-template-columns: 1fr auto; } .dash .lw-barrow i { grid-column: 1 / -1; grid-row: 2; }
}
@media (prefers-reduced-motion: reduce) { .dash .lw-spin { animation-duration: 2s; } }
`;
export const StaffStyles = () => <style href="lww-staff-tools" precedence="medium">{CSS}</style>;

/* A table whose rows turn into label/value cards on a phone. cols: [[label, render(row)]].
   rowProps(row) adds attributes to a row (data-* for tests). */
export function CardTable({ cols, rows, rowKey, rowProps, empty, caption }) {
  if (!rows.length) return <p className="cart-empty">{empty}</p>;
  return (
    <div className="tbl-wrap lw-table">
      <table className="table">
        {caption ? <caption className="lw-sr">{caption}</caption> : null}
        <thead><tr>{cols.map(([l], i) => <th key={i}>{l || <span className="lw-sr">Action</span>}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => (
          <tr key={rowKey ? rowKey(r) : i} {...(rowProps ? rowProps(r) : {})}>
            {cols.map(([l, f], j) => <td key={j} data-label={l || ''}>{f(r)}</td>)}
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}
