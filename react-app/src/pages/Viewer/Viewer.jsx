import { useCallback, useEffect, useRef, useState } from 'react';
import { viewerFetch } from '../../services/api.js';
import { renderPdf, renderImages, renderDemo } from '../../services/viewerRender.js';

const fmt = ms => new Date(ms).toLocaleString('en-IN', { day: 'numeric', month: 'long', year: 'numeric', hour: 'numeric', minute: '2-digit' });
/* back to the site: close this tab (it was opened by the site); if the browser keeps it open, go to the sheets */
const back = () => { window.close(); setTimeout(() => { location.href = '/#sheets'; }, 150); };
const goFull = () => { const el = document.documentElement, f = el.requestFullscreen || el.webkitRequestFullscreen; if (f && !document.fullscreenElement) Promise.resolve(f.call(el)).catch(() => {}); };
const setBlur = on => document.body.classList.toggle('blur', on);

/* The protected sheet viewer. The token comes from the site in the URL hash (never sent to
   a server as a URL); every request carries it in a header and the session cookie goes along.
   The SERVER decides what may be shown: meta, the file or page images, and a recheck every minute. */
export default function Viewer() {
  const stageRef = useRef(null);
  const zoom = useRef(1);
  const [veil, setVeil] = useState({ title: 'Checking your access…', text: 'The server is confirming that this sheet is licensed to you.', spin: true, off: false });
  const [head, setHead] = useState(null);   /* { title, sub, lic, who, since } */
  const [pageNo, setPageNo] = useState('');
  const [chromeOn, setChromeOn] = useState(true);
  const [toastMsg, setToastMsg] = useState({ msg: '', show: false });
  const toastT = useRef(0);
  const toast = useCallback(m => { setToastMsg({ msg: m, show: true }); clearTimeout(toastT.current); toastT.current = setTimeout(() => setToastMsg(t => ({ ...t, show: false })), 2200); }, []);
  const fit = useCallback(() => { const s = stageRef.current; if (!s) return; const w = Math.min(s.clientWidth - 32, (s.clientHeight - 120) / 1.414) * zoom.current; s.style.setProperty('--w', Math.max(280, w) + 'px'); }, []);
  const run = useRef({ ended: false, meta: null });

  useEffect(() => {
    const token = new URLSearchParams(location.hash.slice(1)).get('t') || '';
    const api = (p, opt) => viewerFetch(token, p, opt);
    const r0 = { ended: false, meta: null, cancelled: false }; run.current = r0;
    const stage = stageRef.current;
    const screen = (title, text, opts = {}) => { if (!r0.cancelled) setVeil({ title, text, spin: !!opts.spin, action: opts.action, onAction: opts.onAction, back: !!opts.back, off: false }); };
    /* the server said no (signed out elsewhere, or the sheet was removed from the account): pages are wiped */
    const closed = reason => {
      if (r0.ended) return; r0.ended = true;
      stage.replaceChildren(); setBlur(false);
      if (document.fullscreenElement) { try { document.exitFullscreen(); } catch (_) {} }
      screen('This sheet is not available', reason || 'Open it again from the site.', { action: 'Back to the sheets', onAction: back });
    };
    /* asked again every minute and when the tab comes back: a sign-out or an admin revoke closes the sheet */
    const recheck = async () => {
      if (r0.ended || r0.cancelled) return;
      try { const r = await api('/api/view/meta'); if (r.status === 401 || r.status === 403) { const e = await r.json().catch(() => ({})); closed(e.error); } }
      catch (_) { /* offline: keep showing what is already rendered */ }
    };
    let timer = 0;
    (async () => {
      if (!token) { screen('This link has expired', 'Open the sheet again from the site.', { back: true }); return; }
      let r; try { r = await api('/api/view/meta'); } catch (_) { screen('Cannot reach the server', 'Check your connection and open the sheet again from the site.', { back: true }); return; }
      if (r0.cancelled) return;
      if (r.status === 401) { screen('Sign in to open this sheet', 'Go back to the site, sign in, and open the sheet again.', { back: true }); return; }
      if (!r.ok) { const e = await r.json().catch(() => ({})); if (r.status === 403) { r0.ended = true; screen('This sheet is not available', e.error || 'Open it again from the site.', { action: 'Back to the sheets', onAction: back }); } else screen('Could not open the sheet', e.error || 'Please try again.', { back: true }); return; }
      const meta = await r.json(); if (r0.cancelled) return; r0.meta = meta;
      document.title = meta.title + ' — Learn With Why';
      const who = (meta.user.name ? meta.user.name + ' · ' : '') + meta.user.email;
      const info = { title: meta.title, sub: meta.pages > 1 ? ' · ' + meta.pages + ' pages' : '', lic: meta.kind === 'free' ? 'Free · yours' : 'Yours to keep', who, since: (meta.kind === 'free' ? 'Free sheet' : 'Bought') + ' · on your account since ' + fmt(meta.since) };
      setHead(info);
      const stamp = who + ' · ' + new Date().toLocaleDateString('en-IN') + ' ' + new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
      timer = setInterval(recheck, 60e3);
      screen('Loading ' + meta.title + '…', 'Licensed to ' + meta.user.email + '. Copying, downloading and screenshots are not permitted.', { spin: true });
      const isEnded = () => r0.ended || r0.cancelled;
      const images = () => renderImages(stage, { pages: meta.pages, stamp, isEnded, fetchPage: n => api('/api/view/page?n=' + n), onDenied: closed });
      try {
        if (meta.hasPdf) {
          const f = await api('/api/view/file');
          if (!f.ok) { const e = await f.json().catch(() => ({})); if (f.status === 401 || f.status === 403) { closed(e.error); return; } throw new Error(e.error || 'Could not load the PDF'); }
          const data = await f.arrayBuffer();
          try { await renderPdf(stage, data, { stamp, isEnded, onPages: n => { meta.pages = n; } }); }
          catch (err) { if (meta.hasImages) await images(); else throw err; }
        } else if (meta.hasImages) await images();
        else { meta.pages = 1; setHead({ ...info, sub: ' · placeholder page' }); renderDemo(stage, meta, stamp); }
      } catch (err) { if (!isEnded()) screen('Could not render this sheet', String(err.message || err) + ' — try again from the site.', { back: true }); return; }
      if (isEnded()) return;
      fit();
      screen(meta.title, 'Licensed to ' + meta.user.email + ' — it stays on your account. Copying, downloading and screenshots are not permitted.', { action: 'Open full screen', onAction: () => { goFull(); setVeil(v => ({ ...v, off: true })); }, back: true });
    })();

    /* ---- protection: no menu, no drag, no copy/save/print keys, blur when the window is not in front ---- */
    const block = e => { e.preventDefault(); toast('This sheet is protected'); };
    const BLOCK = ['contextmenu', 'dragstart', 'selectstart', 'copy', 'cut'];
    BLOCK.forEach(ev => document.addEventListener(ev, block));
    let unblurT = 0;
    const onKey = e => {
      const k = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && ['s', 'p', 'c', 'u', 'a'].includes(k)) { e.preventDefault(); toast('Saving, printing and copying are disabled'); }
      if (k === 'printscreen') { e.preventDefault(); setBlur(true); toast('Screenshots are not allowed'); try { navigator.clipboard.writeText(''); } catch (_) {} clearTimeout(unblurT); unblurT = setTimeout(() => setBlur(false), 1500); }
      if (k === 'escape' && !document.fullscreenElement) back();
    };
    const onKeyUp = e => { if (e.key === 'PrintScreen') { try { navigator.clipboard.writeText(''); } catch (_) {} } };
    const onVis = () => { if (!r0.ended && r0.meta) setBlur(document.hidden || !document.hasFocus()); };
    const onVisChange = () => { onVis(); if (!document.hidden) recheck(); };
    const onFocus = () => { onVis(); recheck(); };
    document.addEventListener('keydown', onKey); document.addEventListener('keyup', onKeyUp);
    document.addEventListener('visibilitychange', onVisChange); addEventListener('blur', onVis); addEventListener('focus', onFocus);
    /* hide the chrome while reading, show it on movement */
    let hideT = 0;
    const wake = () => { setChromeOn(true); clearTimeout(hideT); hideT = setTimeout(() => setChromeOn(false), 2500); };
    addEventListener('mousemove', wake); addEventListener('touchstart', wake, { passive: true });
    addEventListener('resize', fit);
    return () => {
      r0.cancelled = true; clearInterval(timer); clearTimeout(hideT); clearTimeout(unblurT); clearTimeout(toastT.current);
      BLOCK.forEach(ev => document.removeEventListener(ev, block));
      document.removeEventListener('keydown', onKey); document.removeEventListener('keyup', onKeyUp);
      document.removeEventListener('visibilitychange', onVisChange); removeEventListener('blur', onVis); removeEventListener('focus', onFocus);
      removeEventListener('mousemove', wake); removeEventListener('touchstart', wake); removeEventListener('resize', fit);
      stage.replaceChildren(); setBlur(false);
    };
  }, [fit, toast]);

  /* which page is in the middle of the screen */
  const onScroll = () => {
    const s = stageRef.current; if (!run.current.meta || !s) return;
    const pages = s.querySelectorAll('.page'); let cur = 0;
    pages.forEach((p, i) => { if (p.offsetTop - s.scrollTop < s.clientHeight / 2) cur = i; });
    setPageNo(pages.length > 1 ? (cur + 1) + ' / ' + pages.length : '');
  };
  const zoomBy = d => { zoom.current = Math.max(0.5, Math.min(2.5, zoom.current + d)); fit(); };

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
      <header className={'bar' + (chromeOn ? '' : ' hide')} id="bar">
        <span className="brand"><i>LW</i><span>Learn With Why</span></span>
        <span className="title" id="title">{head ? <><b>{head.title}</b>{head.sub}</> : null}</span>
        <span className="lic" id="lic" title="This sheet is on your account"><i /><span id="licText">{head ? head.lic : 'Yours'}</span></span>
        <button type="button" className="btn ic" id="zoomOut" title="Zoom out" aria-label="Zoom out" onClick={() => zoomBy(-0.25)}>−</button>
        <button type="button" className="btn ic" id="zoomIn" title="Zoom in" aria-label="Zoom in" onClick={() => zoomBy(0.25)}>+</button>
        <span id="pageNo" style={{ fontSize: '.78rem', color: 'var(--dim)' }} aria-live="polite">{pageNo}</span>
        <button type="button" className="btn" id="fs" aria-label="Full screen" onClick={() => { if (document.fullscreenElement) document.exitFullscreen(); else goFull(); }}><span className="l">Full screen</span><span className="s">⛶</span></button>
        <button type="button" className="btn primary" id="close" onClick={back}>Close</button>
      </header>
      <main className="stage" id="stage" ref={stageRef} onScroll={onScroll} aria-label="Sheet pages" />
      <footer className={'foot' + (chromeOn ? '' : ' hide')} id="foot"><span>Licensed to <b id="who">{head ? head.who : ''}</b></span><span>·</span><span id="sinceLine">{head ? head.since : ''}</span><span>·</span><span>Esc or Close to go back to the site</span></footer>
      <div className={'toast' + (toastMsg.show ? ' show' : '')} id="toast" role="status" aria-live="polite">{toastMsg.msg}</div>
    </>
  );
}
