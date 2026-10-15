import { useCallback, useEffect, useRef, useState } from 'react';
import { viewerFetch } from '../../services/api.js';
import { renderPdf, renderImages } from '../../services/viewerRender.js';
import { classById, INBOX } from '../../data/content.js';
import { dateTimeTz } from '../../utils/format.js';

/* back to the site: close this tab (it was opened by the site); if the browser keeps it open, go to the sheets */
const back = () => { window.close(); setTimeout(() => { location.href = '/#sheets'; }, 150); };
/* "Buy Access Again" / "Renew my plan": the site tab that opened this one is told (same site only) and
   brought forward; with no such tab, the site opens with the sheet (or class) in the address. */
function toSite(d) {
  let told = false;
  try { if (window.opener && !window.opener.closed) { window.opener.postMessage(Object.assign({ type: 'lww:buy-again' }, d), location.origin); window.opener.focus(); told = true; } } catch (_) { told = false; }
  if (told) { window.close(); setTimeout(() => { location.href = '/#sheets'; }, 300); return; }
  location.href = d.scope === 'class' ? '/?renew=' + encodeURIComponent(d.cls || '') + '#sheets' : '/?again=' + encodeURIComponent(d.id || '') + '#sheets';
}
const goFull = () => { const el = document.documentElement, f = el.requestFullscreen || el.webkitRequestFullscreen; if (f && !document.fullscreenElement) Promise.resolve(f.call(el)).catch(() => {}); };
const setBlur = on => document.body.classList.toggle('blur', on);
const shortDate = v => { try { return new Date(v).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }); } catch (_) { return ''; } };
/* the customer's own time zone when the server sends it with meta (user.timeZone), else this device's */
const tzOf = meta => (meta && meta.user && meta.user.timeZone) || undefined;
/* the server said no to a view (or a print / download): 401 signed out, 403 a block or the access ended,
   404 the sheet is gone, 410 its PDF is being prepared. 403 not_allowed only means "no copies for this sheet". */
const isDenial = (status, b) => status === 401 || status === 404 || status === 410 || (status === 403 && !(b && b.code === 'not_allowed'));
/* the sheet a view token was made for (its first part is readable; the server checks the signature) */
const tokenSheet = t => {
  try {
    const p = String(t).split('.')[0].replace(/-/g, '+').replace(/_/g, '/'), id = atob(p + '='.repeat((4 - (p.length % 4)) % 4)).split('|')[1];
    return /^[A-Za-z0-9-]{1,64}$/.test(id || '') ? id : null;
  } catch (_) { return null; }
};

/* What the customer reads when the sheet closes (or cannot open), in plain words, with a way back. */
function reasonOf(status, b, meta) {
  const code = (b && b.code) || '';
  const sheet = meta && meta.worksheet, cls = meta && meta.cls;
  if (status === 401 || code === 'signin') return { title: 'Please sign in again', text: 'You were signed out, so this sheet has closed. Sign in on the site and open it again from My Account → My Worksheets.' };
  if (code === 'expired') {
    if (meta && meta.scope === 'class') {
      const c = classById(cls);
      return { title: 'Your plan has ended', text: 'Your ' + (c ? c.label + ' ' : '') + 'plan has ended, so this sheet has closed. You can renew the plan on the site, or buy this sheet on its own.', action: 'Renew my plan', go: { scope: 'class', cls, id: sheet } };
    }
    if (meta && meta.kind === 'free') return { title: 'This sheet is not free any more', text: 'This sheet has become a paid sheet, so it has closed. You can buy it on the site.', action: 'Buy this sheet', go: { id: sheet } };
    return { title: 'Your access has ended', text: 'Your access to this sheet ended' + (b.expiredAt ? ' on ' + dateTimeTz(b.expiredAt, tzOf(meta)) : '') + ', so it has closed. You can buy access again on the site.', action: 'Buy Access Again', go: { id: sheet } };
  }
  if (code === 'access_suspended') return { title: 'Paid sheets are paused', text: 'Paid sheets are paused on this account, so this sheet has closed. Free sheets still open. You can see why, and write to us, in My Account → Security.' };
  if (code === 'session_blocked') return { title: 'This sign-in was stopped', text: 'This sign-in was stopped, so the sheet has closed. Please sign in again on the site. If you think this is a mistake, write to us at ' + INBOX + '.' };
  if (code === 'account_suspended') return { title: 'This account is blocked', text: 'This account has been blocked, so the sheet has closed. If you think this is a mistake, please write to us at ' + INBOX + '.' };
  if (code === 'email_unverified') return { title: 'Please confirm your email', text: 'Confirm your email address with the link in your welcome email, then open the sheet again from the site.' };
  if (code === 'revoked') return { title: 'This sheet is no longer on your account', text: 'It was taken off your account, so it has closed. If you think this is a mistake, please write to us at ' + INBOX + '.' };
  if (code === 'invalid') return b && b.tokenExpired
    ? { title: 'This viewer link has run out', text: 'Viewer links work for a few hours at a time. Open the sheet again from the site.' }
    : { title: 'This link does not work', text: 'Please open the sheet again from the site.' };
  if (status === 410 || code === 'unavailable') return { title: 'This sheet is being prepared', text: 'It is not ready to open yet. Please check back soon.' };
  if (status === 404) return { title: 'We could not find this sheet', text: 'Please open it again from the site.' };
  return { title: 'This sheet is not available', text: (b && b.error) || 'Please open it again from the site.' };
}

/* The protected sheet viewer. The view token comes from the site in the URL hash (never sent to a
   server as a URL); every request carries it in the X-View-Token header together with the
   customer's own sign-in (the bearer token shared with the site tab). The SERVER decides what may
   be shown: meta, the stamped PDF or page images, a fresh check every recheckSeconds and whenever
   this tab comes back, and the counted prints and downloads some sheets come with. */
export default function Viewer() {
  const stageRef = useRef(null);
  const zoom = useRef(1);
  const [veil, setVeil] = useState({ title: 'Checking your access…', text: 'We are making sure this sheet is open on your account.', spin: true, off: false });
  const [head, setHead] = useState(null);   /* { title, sub, pill, pillShort, who, line, closed } */
  /* printsLeft / printLimit come from the server: the sheet's own number, or the prints the account type
     gets (Parent 3, Teacher 30, Organization 300 unless staff change them), counted per access record */
  const [copies, setCopies] = useState({ printsLeft: 0, printLimit: 0, downloadsLeft: 0 });
  const [busyCopy, setBusyCopy] = useState('');
  const [pageNo, setPageNo] = useState('');
  const [chromeOn, setChromeOn] = useState(true);
  const [toastMsg, setToastMsg] = useState({ msg: '', show: false });
  const toastT = useRef(0);
  const toast = useCallback((m, ms = 2600) => { setToastMsg({ msg: m, show: true }); clearTimeout(toastT.current); toastT.current = setTimeout(() => setToastMsg(t => ({ ...t, show: false })), ms); }, []);
  /* an A4 page as big as the space between the bar (and, on a phone, the Print / Download row) and the footer */
  const fit = useCallback(() => {
    const s = stageRef.current; if (!s) return;
    const cs = getComputedStyle(s), room = (parseFloat(cs.paddingTop) || 64) + (parseFloat(cs.paddingBottom) || 56);
    const w = Math.min(s.clientWidth - 32, (s.clientHeight - room) / 1.414) * zoom.current; s.style.setProperty('--w', Math.max(280, w) + 'px');
  }, []);
  const run = useRef({ ended: false, meta: null });
  const copiesRef = useRef(copies); copiesRef.current = copies;

  useEffect(() => {
    const token = new URLSearchParams(location.hash.slice(1)).get('t') || '';
    const api = (p, opt) => viewerFetch(token, p, opt);
    const r0 = { ended: false, meta: null, cancelled: false, checking: false, last: 0, deny: null, recheck: null }; run.current = r0;
    const stage = stageRef.current;
    let timer = 0, endTimer = 0;
    const screen = (title, text, opts = {}) => { if (!r0.cancelled) setVeil({ title, text, spin: !!opts.spin, action: opts.action, onAction: opts.onAction, back: !!opts.back, off: false }); };

    /* what the header and footer say: "Open until 8 Oct 2027, 9:15 pm IST" (in the customer's zone) */
    const describe = meta => {
      const until = meta.expiresAt || meta.until || null, plan = meta.scope === 'class', free = meta.kind === 'free', c = classById(meta.cls), tz = tzOf(meta);
      const who = (meta.user && meta.user.name ? meta.user.name + ' · ' : '') + ((meta.user && meta.user.email) || '');
      return {
        title: meta.title, sub: meta.pages > 1 ? ' · ' + meta.pages + ' pages' : '', who,
        pill: until ? 'Open until ' + dateTimeTz(until, tz) : free ? 'Free sheet' : plan ? 'In your plan' : 'On your account',
        pillShort: until ? 'Until ' + shortDate(until) : free ? 'Free' : plan ? 'In your plan' : 'Open',
        line: (free ? 'Free sheet' : plan ? 'In your ' + (c ? c.label + ' ' : '') + 'plan' : 'Bought ' + (meta.since ? dateTimeTz(meta.since, tz) : '')) + (until ? ' · open until ' + dateTimeTz(until, tz) : ''),
        closed: false,
      };
    };
    const keepCounts = meta => {
      const left = Math.max(0, Number(meta.printsLeft) || 0);
      setCopies({ printsLeft: left, printLimit: Math.max(left, Number(meta.printLimit) || 0), downloadsLeft: Math.max(0, Number(meta.downloadsLeft) || 0) });
    };
    /* check again right when the access is due to end, so the sheet does not stay open past it */
    const watchEnd = meta => {
      clearTimeout(endTimer);
      const at = meta.expiresAt ? Date.parse(meta.expiresAt) : (meta.until || 0);
      const wait = at ? at - Date.now() + 1500 : 0;
      if (wait > 0 && wait < 2147483000) endTimer = setTimeout(() => recheck('end'), wait);
    };

    /* the server said no: the pages are wiped and the reason shown, with a way back to the site */
    const closed = (status, body) => {
      if (r0.ended) return; r0.ended = true;
      clearTimeout(timer); clearTimeout(endTimer);
      stage.replaceChildren(); setBlur(false); document.body.classList.remove('printing');
      if (document.fullscreenElement) { try { document.exitFullscreen(); } catch (_) {} }
      setCopies({ printsLeft: 0, printLimit: 0, downloadsLeft: 0 }); setPageNo('');
      setHead(h => (h ? { ...h, closed: true, pill: 'Closed', pillShort: 'Closed' } : h));
      const why = reasonOf(status, body || {}, r0.meta);
      screen(why.title, why.text, why.go ? { action: why.action, onAction: () => toSite(why.go), back: true } : { action: 'Back to the site', onAction: back });
    };
    r0.deny = closed;

    /* asked again every recheckSeconds (from the server), when the access is due to end, and when this tab
       comes back: a sign-out, an ended purchase, a block or a removal closes the sheet */
    const schedule = () => { clearTimeout(timer); if (!r0.ended && !r0.cancelled && r0.meta) timer = setTimeout(() => recheck('timer'), Math.min(3600, Math.max(15, Number(r0.meta.recheckSeconds) || 60)) * 1000); };
    const recheck = async why => {
      if (r0.ended || r0.cancelled || !r0.meta || r0.checking) return;
      if (why === 'focus' && Date.now() - r0.last < 3000) return;   /* focus and visibility often come together */
      r0.checking = true; r0.last = Date.now();
      try {
        const r = await api('/api/view/meta');
        if (r.ok) {
          const m = await r.json();
          if (!r0.ended && !r0.cancelled) { r0.meta = Object.assign({}, r0.meta, m); setHead(describe(r0.meta)); keepCounts(m); watchEnd(m); }
        } else {
          const e = await r.json().catch(() => ({}));
          if (isDenial(r.status, e)) closed(r.status, e);
        }
      } catch (_) { /* no connection: keep showing what is already drawn, and ask again later */ }
      finally { r0.checking = false; schedule(); }
    };
    r0.recheck = recheck;

    (async () => {
      if (!token) { screen('This link does not work', 'Please open the sheet again from the site.', { back: true }); return; }
      let r; try { r = await api('/api/view/meta'); } catch (_) { screen('We could not reach Learn With Why', 'Check your internet connection, then open the sheet again from the site.', { back: true }); return; }
      if (r0.cancelled) return;
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        if (isDenial(r.status, e)) {
          r0.ended = true;
          const why = reasonOf(r.status, e, { worksheet: tokenSheet(token) });
          screen(why.title, why.text, why.go && (why.go.id || why.go.cls) ? { action: why.action, onAction: () => toSite(why.go), back: true } : { back: true });
        }
        else screen('We could not open the sheet', 'Please try again in a minute from the site.', { back: true });
        return;
      }
      const meta = await r.json(); if (r0.cancelled) return; r0.meta = meta; r0.last = Date.now();
      document.title = meta.title + ' · Learn With Why';
      const info = describe(meta);
      setHead(info); keepCounts(meta); watchEnd(meta); schedule();
      const wm = meta.watermark || {}, when = new Date(wm.issuedAt || Date.now());
      const stamp = info.who + (wm.orderId ? ' · ' + wm.orderId : '') + ' · ' + when.toLocaleDateString('en-IN') + ' ' + when.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
      const email = (meta.user && meta.user.email) || '';
      screen('Loading ' + meta.title + '…', 'Licensed to ' + email + '. Please do not copy, share or take screenshots of it.', { spin: true });
      const isEnded = () => r0.ended || r0.cancelled;
      const images = () => renderImages(stage, { pages: meta.pages, stamp, isEnded, fetchPage: n => api('/api/view/page?n=' + n), onDenied: closed });
      try {
        if (meta.hasPdf !== false) {
          const f = await api('/api/view/file');
          if (!f.ok) { const e = await f.json().catch(() => ({})); if (isDenial(f.status, e) && e.code !== 'nofile') { closed(f.status, e); return; } if (!meta.hasImages) throw new Error(e.error || 'The PDF could not be loaded'); await images(); }
          else {
            const data = await f.arrayBuffer();
            try { await renderPdf(stage, data, { stamp, isEnded, onPages: n => { meta.pages = n; } }); }
            catch (err) { if (meta.hasImages && !isEnded()) await images(); else throw err; }
          }
        } else if (meta.hasImages) await images();
        else throw new Error('This sheet has nothing to show yet');
      } catch (err) { if (!isEnded()) screen('We could not show this sheet', 'Something went wrong while drawing the pages. Please open it again from the site.', { back: true }); return; }
      if (isEnded()) return;
      fit();
      const until = meta.expiresAt ? ', open until ' + dateTimeTz(meta.expiresAt, tzOf(meta)) : '';
      screen(meta.title, 'Licensed to ' + email + until + '. Please do not copy, share or take screenshots of it.', { action: 'Open full screen', onAction: () => { goFull(); setVeil(v => ({ ...v, off: true })); }, back: true });
    })();

    /* ---- copy-discouraging: no menu, no drag, no copy/save/print keys, blur when the window is not in front.
       These make casual copying harder; they cannot stop every screenshot or photo, which is why every page
       carries the customer's name and email. ---- */
    const block = e => { e.preventDefault(); toast('This sheet is protected'); };
    const BLOCK = ['contextmenu', 'dragstart', 'selectstart', 'copy', 'cut'];
    BLOCK.forEach(ev => document.addEventListener(ev, block));
    let unblurT = 0;
    const onKey = e => {
      const k = (e.key || '').toLowerCase(), c = copiesRef.current;
      if ((e.ctrlKey || e.metaKey) && ['s', 'p', 'c', 'u', 'a'].includes(k)) {
        e.preventDefault();
        toast(k === 'p' && c.printsLeft > 0 ? 'Use the Print button. You have ' + c.printsLeft + ' left.'
          : k === 'p' && c.printLimit > 0 ? 'You have used all ' + c.printLimit + ' prints of this sheet.'
          : k === 's' && c.downloadsLeft > 0 ? 'Use the Download button. You have ' + c.downloadsLeft + ' left.'
          : 'Saving, printing and copying are not allowed');
      }
      if (k === 'printscreen') { e.preventDefault(); setBlur(true); toast('Screenshots are not allowed'); try { navigator.clipboard.writeText(''); } catch (_) {} clearTimeout(unblurT); unblurT = setTimeout(() => setBlur(false), 1500); }
      if (k === 'escape' && !document.fullscreenElement) back();
    };
    const onKeyUp = e => { if (e.key === 'PrintScreen') { try { navigator.clipboard.writeText(''); } catch (_) {} } };
    const onVis = () => { if (!r0.ended && r0.meta && !document.body.classList.contains('printing')) setBlur(document.hidden || !document.hasFocus()); };
    const onVisChange = () => { onVis(); if (!document.hidden) recheck('focus'); };
    const onFocus = () => { onVis(); recheck('focus'); };
    document.addEventListener('keydown', onKey); document.addEventListener('keyup', onKeyUp);
    document.addEventListener('visibilitychange', onVisChange); addEventListener('blur', onVis); addEventListener('focus', onFocus);
    /* hide the chrome while reading, show it on movement */
    let hideT = 0;
    const wake = () => { setChromeOn(true); clearTimeout(hideT); hideT = setTimeout(() => setChromeOn(false), 2500); };
    addEventListener('mousemove', wake); addEventListener('touchstart', wake, { passive: true });
    addEventListener('resize', fit);
    return () => {
      r0.cancelled = true; clearTimeout(timer); clearTimeout(endTimer); clearTimeout(hideT); clearTimeout(unblurT); clearTimeout(toastT.current);
      BLOCK.forEach(ev => document.removeEventListener(ev, block));
      document.removeEventListener('keydown', onKey); document.removeEventListener('keyup', onKeyUp);
      document.removeEventListener('visibilitychange', onVisChange); removeEventListener('blur', onVis); removeEventListener('focus', onFocus);
      removeEventListener('mousemove', wake); removeEventListener('touchstart', wake); removeEventListener('resize', fit);
      stage.replaceChildren(); setBlur(false);
    };
  }, [fit, toast]);

  /* Print and Download: only for sheets that come with copies (most are view-only). The server counts
     each one (POST /api/view/print | download) before it is handed over. */
  const token = () => new URLSearchParams(location.hash.slice(1)).get('t') || '';
  const copyFailed = (r, b, kind) => {
    const r0 = run.current;
    if (isDenial(r.status, b)) { if (r0.deny) r0.deny(r.status, b); return; }
    if (b && b.code === 'quota_exhausted') {
      /* the server's own words: "You have used all 3 prints of this sheet." */
      toast(String(b.error || 'You have used all the prints that come with this sheet.').replace(/\s+\u2014\s+/g, ', '), 6000);
      setCopies(c => (kind === 'print' ? { ...c, printsLeft: 0 } : { ...c, downloadsLeft: 0 }));
      if (r0.recheck) r0.recheck('copy');
      return;
    }
    if (b && b.code === 'not_allowed') { toast('This sheet opens in the viewer only.'); setCopies({ printsLeft: 0, printLimit: 0, downloadsLeft: 0 }); return; }
    toast(r.status === 429 ? 'Please wait a little before trying again.' : 'That did not work. Please try again.');
  };
  const doPrint = async () => {
    if (busyCopy || run.current.ended) return;
    setBusyCopy('print');
    try {
      const r = await viewerFetch(token(), '/api/view/print', { method: 'POST' });
      const b = await r.json().catch(() => ({}));
      if (!r.ok) { copyFailed(r, b, 'print'); return; }
      setCopies(c => ({ ...c, printsLeft: Math.max(0, Number(b.printsLeft) || 0), printLimit: Math.max(c.printLimit, Number(b.printLimit) || 0) }));
      /* the print styles show only the pages (with their watermark) while this class is on */
      const body = document.body, done = () => { body.classList.remove('printing'); removeEventListener('afterprint', done); };
      setBlur(false); body.classList.add('printing'); addEventListener('afterprint', done);
      await new Promise(res => requestAnimationFrame(() => setTimeout(res, 60)));
      window.print();
      setTimeout(done, 1000);
      toast(Number(b.printsLeft) > 0 ? 'Sent to your printer. ' + b.printsLeft + ' left.' : 'Sent to your printer. That was your last print.');
    } catch (_) { toast('No connection. Please try again.'); }
    finally { setBusyCopy(''); }
  };
  const doDownload = async () => {
    if (busyCopy || run.current.ended) return;
    setBusyCopy('download');
    try {
      const r = await viewerFetch(token(), '/api/view/download', { method: 'POST' });
      if (!r.ok) { const b = await r.json().catch(() => ({})); copyFailed(r, b, 'download'); return; }
      const blob = await r.blob();
      const cd = r.headers.get('Content-Disposition') || '', m = /filename="?([^";]+)"?/i.exec(cd);
      const name = (m && m[1]) || 'learn-with-why-' + ((run.current.meta && run.current.meta.worksheet) || 'sheet') + '.pdf';
      const url = URL.createObjectURL(blob), a = document.createElement('a');
      a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60e3);
      /* the server's count is in X-Downloads-Left once the API lets the browser read it; until then, one less */
      const h = r.headers.get('X-Downloads-Left');
      const left = h != null && h !== '' && !isNaN(Number(h)) ? Math.max(0, Number(h)) : Math.max(0, (copiesRef.current.downloadsLeft || 1) - 1);
      setCopies(c => ({ ...c, downloadsLeft: left }));
      toast(left > 0 ? 'Downloaded, with your name on every page. ' + left + ' left.' : 'Downloaded, with your name on every page. That was your last download.');
      if (run.current.recheck) run.current.recheck('copy');   /* the server's own count */
    } catch (_) { toast('No connection. Please try again.'); }
    finally { setBusyCopy(''); }
  };

  /* which page is in the middle of the screen */
  const onScroll = () => {
    const s = stageRef.current; if (!run.current.meta || !s) return;
    const pages = s.querySelectorAll('.page'); let cur = 0;
    pages.forEach((p, i) => { if (p.offsetTop - s.scrollTop < s.clientHeight / 2) cur = i; });
    setPageNo(pages.length > 1 ? (cur + 1) + ' / ' + pages.length : '');
  };
  const zoomBy = d => { zoom.current = Math.max(0.5, Math.min(2.5, zoom.current + d)); fit(); };
  /* on a phone the Print / Download buttons get a row of their own under the bar. Print stays (disabled,
     "No prints left") once they are used up, so the customer sees why */
  const canPrint = copies.printLimit > 0 || copies.printsLeft > 0, outOfPrints = canPrint && copies.printsLeft <= 0;
  const hasCopies = canPrint || copies.downloadsLeft > 0;
  useEffect(() => { fit(); }, [hasCopies, fit]);

  return (
    <>
      <div className={'veil' + (veil.off ? ' off' : '')} id="veil" role="dialog" aria-modal="true" aria-labelledby="veilTitle" aria-hidden={veil.off ? 'true' : undefined}>
        <div>
          <div className="spin" id="spin" hidden={!veil.spin} />
          <h1 id="veilTitle">{veil.title}</h1>
          <p id="veilText">{veil.text}</p>
          <div className="row">
            <button type="button" className="btn primary" id="veilBtn" hidden={!veil.action} onClick={veil.onAction}>{veil.action}</button>
            <button type="button" className="btn" id="veilBack" hidden={!veil.back} onClick={back}>Back to the site</button>
          </div>
        </div>
      </div>
      <header className={'bar' + (chromeOn ? '' : ' hide') + (hasCopies ? ' has-copies' : '')} id="bar">
        <span className="brand"><i>LW</i><span>Learn With Why</span></span>
        <span className="title" id="title">{head ? <><b>{head.title}</b>{head.sub}</> : null}</span>
        <span className={'lic' + (head && head.closed ? ' closed' : '')} id="lic" title={head ? head.pill : ''}><i /><span id="licText"><span className="l">{head ? head.pill : 'Checking…'}</span><span className="s">{head ? head.pillShort : '…'}</span></span></span>
        <button type="button" className="btn ic" id="zoomOut" title="Zoom out" aria-label="Zoom out" onClick={() => zoomBy(-0.25)}>−</button>
        <button type="button" className="btn ic" id="zoomIn" title="Zoom in" aria-label="Zoom in" onClick={() => zoomBy(0.25)}>+</button>
        <span id="pageNo" style={{ fontSize: '.78rem', color: 'var(--dim)' }} aria-live="polite">{pageNo}</span>
        {hasCopies && <span className="copies" id="copies">
          {canPrint && <button type="button" className={'btn' + (outOfPrints ? ' out' : '')} id="printBtn" disabled={!!busyCopy || outOfPrints} onClick={doPrint}
            title={outOfPrints ? 'You have used all ' + copies.printLimit + ' prints of this sheet' : 'Print · ' + copies.printsLeft + ' of ' + copies.printLimit + ' left'}
            aria-label={outOfPrints ? 'No prints left. You have used all ' + copies.printLimit + ' prints of this sheet.' : 'Print. ' + copies.printsLeft + ' of ' + copies.printLimit + ' prints left.'}>
            <span className="s" aria-hidden="true">⎙</span><span className="l">{outOfPrints ? 'No prints left' : busyCopy === 'print' ? 'Printing…' : 'Print'}</span>{outOfPrints ? null : <span className="cnt">{copies.printsLeft} of {copies.printLimit} left</span>}</button>}
          {copies.downloadsLeft > 0 && <button type="button" className="btn" id="downloadBtn" disabled={!!busyCopy} onClick={doDownload} title={'Download · ' + copies.downloadsLeft + ' left'}><span className="s" aria-hidden="true">⇩</span><span className="l">Download</span><span className="cnt">{copies.downloadsLeft} left</span></button>}
        </span>}
        <button type="button" className="btn" id="fs" aria-label="Full screen" onClick={() => { if (document.fullscreenElement) document.exitFullscreen(); else goFull(); }}><span className="l">Full screen</span><span className="s">⛶</span></button>
        <button type="button" className="btn primary" id="close" onClick={back}>Close</button>
      </header>
      <main className="stage" id="stage" ref={stageRef} onScroll={onScroll} aria-label="Sheet pages" />
      <footer className={'foot' + (chromeOn ? '' : ' hide')} id="foot"><span>Licensed to <b id="who">{head ? head.who : ''}</b></span><span>·</span><span id="sinceLine">{head ? head.line : ''}</span><span>·</span><span>Esc or Close to go back to the site</span></footer>
      <div className={'toast' + (toastMsg.show ? ' show' : '')} id="toast" role="status" aria-live="polite">{toastMsg.msg}</div>
    </>
  );
}
