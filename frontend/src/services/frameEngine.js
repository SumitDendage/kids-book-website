/* FRAME ENGINE — 960 frames, a ladder of key frames stays resident and a window
   follows the playhead; the rest is released (memory-safe). Moved from the page
   script in legacy/old-static-site/index.html with the same numbers:
   KEY 24 (every 24th frame is kept), WINDOW 32 frames either side of the playhead,
   at most 96 decoded frames in memory, 6 downloads at a time, 3 retries per frame.
   Nothing here touches React: the canvas is drawn directly.
   Until the visitor first scrolls, taps or presses a key (or 6 s after the page has loaded), only
   the frames just around the opening one are fetched, so the first screen isn't competing with
   ~70 downloads (about 15 MB): the full ladder starts the moment it's needed. (Oct 25: that early
   window is now just the opening frame; its neighbours follow with the ladder.)
   Phones (Oct 25): a frame is decoded away from the page's own thread (fetch → blob →
   createImageBitmap) and only the part of the picture the screen shows is kept. On a phone held
   upright that is a slice about a quarter of the picture's width, kept at full sharpness, so
   there is no costly shrinking step and no blur from shrinking and then stretching it again.
   At most two frames are decoded at once, so the page stays free to answer the finger. */
export const TOTAL = 960;
const KEY = 24, WINDOW = 32, MAX_RESIDENT = 96, CONCURRENCY = 6, DECODERS = 2, EARLY_WINDOW = 0, WARM_AFTER_LOAD = 6000;
/* the slice kept is this much larger than the screen shows, so a phone's address bar coming and
   going still fits inside it */
const MARGIN = 1.15;
export const frameSrc = i => '/frames-webp/frame_' + String(i + 1).padStart(6, '0') + '.webp';

/* live numbers for the Developer panel (Dashboard + Performance) */
export const engineStats = { total: TOTAL, readyCount: 0, inflight: 0, painted: false };

export function createFrameEngine(canvas, { total = TOTAL, srcOf = frameSrc } = {}) {
  const ctx = canvas.getContext('2d', { alpha: false });
  /* frames[i] = { img, c }: the decoded picture and the part of the frame it holds */
  const frames = new Array(total), status = new Uint8Array(total), tries = new Uint8Array(total);
  let lastDrawn = -1, shown = 0, readyCount = 0, inflight = 0, painted = false, tick = 0, progress = 0, destroyed = false, warm = false, warmTimer = 0;
  /* the picture's own size (every frame matches), the part of it being kept, the frame left on
     screen while frames are cut again for a new window shape, and the frames waiting to decode */
  let iw = 0, ih = 0, crop = null, standIn = null, decoding = 0;
  let bitmaps = typeof createImageBitmap === 'function' && typeof fetch === 'function';
  const queue = [];
  const sync = () => { engineStats.total = total; engineStats.readyCount = readyCount; engineStats.inflight = inflight; engineStats.painted = painted; };
  const frameAt = () => Math.round(Math.min(1, Math.max(0, progress)) * (total - 1));
  const decodeWidth = () => Math.max(1024, Math.min(1440, innerWidth || 1280));

  /* the part of the picture a cover fit shows on this screen, times `margin` */
  function visible(margin) {
    const s = Math.max(innerWidth / iw, innerHeight / ih);
    const w = Math.min(iw, Math.ceil(innerWidth / s * margin)), h = Math.min(ih, Math.ceil(innerHeight / s * margin));
    return { sx: Math.floor((iw - w) / 2), sy: Math.floor((ih - h) / 2), sw: w, sh: h };
  }
  const covers = (c, v) => v.sx >= c.sx && v.sy >= c.sy && v.sx + v.sw <= c.sx + c.sw && v.sy + v.sh <= c.sy + c.sh;

  function release(i) { const f = frames[i]; if (!f) return; if (f.img.close) f.img.close(); frames[i] = undefined; status[i] = 0; readyCount--; }
  function keep(i, img, c) {
    inflight--;
    /* cut for an older window shape: throw it away and fetch it again (from the cache) */
    if (destroyed || c !== crop) { if (img.close) img.close(); if (!destroyed) status[i] = 0; sync(); pump(); return; }
    frames[i] = { img, c }; status[i] = 2; readyCount++; lastDrawn = -1; sync(); pump();
  }
  function fail(i) { inflight--; status[i] = 3; tries[i]++; sync(); pump(); }

  /* older browsers: an <img>, shrunk to the screen's width, the whole picture kept */
  function loadAsImage(i) {
    const img = new Image(); img.decoding = 'async';
    img.onload = () => {
      img.onload = img.onerror = null;
      if (!iw) { iw = img.naturalWidth; ih = img.naturalHeight; resize(); }
      if (!crop) crop = { sx: 0, sy: 0, sw: iw, sh: ih };
      const c = crop, w = Math.min(iw || decodeWidth(), decodeWidth());
      if (typeof createImageBitmap === 'function') createImageBitmap(img, { resizeWidth: w, resizeQuality: 'high' }).then(f => keep(i, f, c), () => keep(i, img, c)); else keep(i, img, c);
    };
    img.onerror = () => { img.onload = img.onerror = null; fail(i); };
    img.src = srcOf(i);
  }
  function loadFrame(i) {
    if (status[i] !== 0 || destroyed) return;
    status[i] = 1; inflight++;
    if (!bitmaps) { loadAsImage(i); return; }
    fetch(srcOf(i))
      .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.blob(); })
      .then(blob => new Promise((done, bad) => { queue.push({ blob, done, bad }); decodeNext(); }))
      .then(([img, c]) => keep(i, img, c), err => {
        /* this browser cannot cut a blob: use the <img> way from now on */
        if (err === 'unsupported') { bitmaps = false; loadAsImage(i); } else fail(i);
      });
  }
  /* decode waiting frames, at most DECODERS at a time, keeping only the part on show (shrunk
     only when that part is wider than the screen could use, as on a wide computer screen) */
  function decodeNext() {
    while (decoding < DECODERS && queue.length) {
      const job = queue.shift(); decoding++;
      const cut = () => {
        if (!crop) crop = visible(MARGIN);
        const c = crop, w = decodeWidth();
        const opts = c.sw > w ? { resizeWidth: w, resizeHeight: Math.round(c.sh * w / c.sw), resizeQuality: 'medium' } : undefined;
        return (opts ? createImageBitmap(job.blob, c.sx, c.sy, c.sw, c.sh, opts) : createImageBitmap(job.blob, c.sx, c.sy, c.sw, c.sh)).then(img => [img, c]);
      };
      /* the first frame tells us the picture's size; after that every frame is cut straight away */
      const work = iw ? cut() : createImageBitmap(job.blob).then(img => { iw = img.width; ih = img.height; img.close(); resize(); return cut(); });
      work.then(r => { decoding--; job.done(r); decodeNext(); }, () => { decoding--; job.bad(iw ? 'failed' : 'unsupported'); decodeNext(); });
    }
  }
  function nextWanted() {
    const c = frameAt();
    if (status[c] === 0) return c;
    if (!warm) { for (let d = 1; d <= EARLY_WINDOW; d++) { if (c + d < total && status[c + d] === 0) return c + d; if (c - d >= 0 && status[c - d] === 0) return c - d; } return -1; }
    for (let i = 0; i < total; i += KEY) if (status[i] === 0) return i;
    for (let d = 1; d <= WINDOW; d++) { if (c - d >= 0 && status[c - d] === 0) return c - d; if (c + d < total && status[c + d] === 0) return c + d; }
    return -1;
  }
  function pump() { if (destroyed) return; while (inflight < CONCURRENCY) { const i = nextWanted(); if (i < 0) break; loadFrame(i); } }
  function evict() {
    if (readyCount <= MAX_RESIDENT) return;
    const c = frameAt(), spare = [];
    for (let i = 0; i < total; i++) if (status[i] === 2 && i % KEY && Math.abs(i - c) > WINDOW) spare.push(i);
    spare.sort((a, b) => Math.abs(b - c) - Math.abs(a - c));
    for (let k = 0; k < spare.length && readyCount > MAX_RESIDENT; k++) release(spare[k]);
    sync();
  }
  function retry() { const c = frameAt(); for (let i = 0; i < total; i++) if (status[i] === 3 && tries[i] < 3 && (i % KEY === 0 || Math.abs(i - c) <= WINDOW)) status[i] = 0; }
  function resize() {
    /* no sharper than the picture itself: a phone's screen has more dots than the frames have
       pixels, and every extra dot is work for the phone on every frame for nothing */
    const fit = iw ? Math.max(innerWidth / iw, innerHeight / ih) : 0, dpr = Math.min(devicePixelRatio || 1, 2, fit ? Math.max(1, 1 / fit) : 2);
    canvas.width = Math.floor(innerWidth * dpr); canvas.height = Math.floor(innerHeight * dpr); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); lastDrawn = -1;
    /* the window changed shape (a phone turned round) and the kept slice no longer covers the
       screen: cut every frame again for the new shape (they come from the browser's cache). The
       frame on show stays on screen until its replacement is ready, so nothing goes blank */
    if (!iw || !crop || covers(crop, visible(1))) return;
    crop = visible(MARGIN);
    const f = frames[shown];
    if (f) { if (standIn && standIn.img.close) standIn.img.close(); standIn = f; frames[shown] = undefined; status[shown] = 0; readyCount--; }
    for (let i = 0; i < total; i++) if (status[i] === 2) release(i);
    sync(); pump();
  }
  /* one animation frame: show the nearest decoded frame to the playhead (0…1) */
  function paint(p) {
    progress = p;
    let i = frameAt();
    if (status[i] !== 2) for (let d = 1; d < total; d++) { if (i - d >= 0 && status[i - d] === 2) { i -= d; break; } if (i + d < total && status[i + d] === 2) { i += d; break; } }
    let f = status[i] === 2 ? frames[i] : null;
    if (f && standIn) { if (standIn.img.close) standIn.img.close(); standIn = null; }
    if (!f && standIn && lastDrawn !== -2) { f = standIn; i = -2; }
    if (f && i !== lastDrawn) {
      /* the cover fit of the whole picture, of which the kept slice c is drawn in its place */
      const { img, c } = f, s = Math.max(innerWidth / iw, innerHeight / ih), x0 = (innerWidth - iw * s) / 2, y0 = (innerHeight - ih * s) / 2;
      ctx.drawImage(img, x0 + c.sx * s, y0 + c.sy * s, c.sw * s, c.sh * s); lastDrawn = i;
      if (i >= 0) shown = i;
      if (!painted) { painted = true; sync(); }
    } else if (!painted) { const g = ctx.createLinearGradient(0, 0, 0, innerHeight); g.addColorStop(0, '#0b1a26'); g.addColorStop(1, '#05090d'); ctx.fillStyle = g; ctx.fillRect(0, 0, innerWidth, innerHeight); }
    if ((tick++ & 7) === 0) { pump(); evict(); }
    if ((tick & 127) === 0) retry();
  }
  const WARM_EVENTS = ['wheel', 'touchstart', 'pointerdown', 'keydown', 'scroll'];
  function warmUp() {
    if (warm) return;
    warm = true; clearTimeout(warmTimer);
    WARM_EVENTS.forEach(e => removeEventListener(e, warmUp, true));
    removeEventListener('load', onLoad);
    pump();
  }
  function onLoad() { warmTimer = setTimeout(warmUp, WARM_AFTER_LOAD); }
  function start() {
    resize(); loadFrame(0);
    WARM_EVENTS.forEach(e => addEventListener(e, warmUp, { capture: true, passive: true }));
    if (document.readyState === 'complete') onLoad(); else addEventListener('load', onLoad);
    pump();
  }
  function destroy() {
    destroyed = true; warmUp(); queue.length = 0;
    for (let i = 0; i < total; i++) if (status[i] === 2) release(i);
    if (standIn && standIn.img.close) standIn.img.close(); standIn = null; sync();
  }
  /* shown: the frame on the canvas now, so the live scenery (scenery.js) follows the same camera */
  return { start, paint, resize, destroy, get painted() { return painted; }, get shown() { return shown; } };
}
