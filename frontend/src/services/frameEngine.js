/* FRAME ENGINE — 960 frames, a ladder of key frames stays resident and a window
   follows the playhead; the rest is released (memory-safe). Moved from the page
   script in legacy/old-static-site/index.html with the same numbers:
   KEY 24 (every 24th frame is kept), WINDOW 32 frames either side of the playhead,
   at most 96 decoded frames in memory, 6 downloads at a time, 3 retries per frame.
   Nothing here touches React: the canvas is drawn directly. */
export const TOTAL = 960;
const KEY = 24, WINDOW = 32, MAX_RESIDENT = 96, CONCURRENCY = 6;
export const frameSrc = i => '/frames-webp/frame_' + String(i + 1).padStart(6, '0') + '.webp';

/* live numbers for the Developer panel (Dashboard + Performance) */
export const engineStats = { total: TOTAL, readyCount: 0, inflight: 0, painted: false };

export function createFrameEngine(canvas, { total = TOTAL, srcOf = frameSrc } = {}) {
  const ctx = canvas.getContext('2d', { alpha: false });
  const frames = new Array(total), status = new Uint8Array(total), tries = new Uint8Array(total);
  let lastDrawn = -1, readyCount = 0, inflight = 0, painted = false, tick = 0, progress = 0, destroyed = false;
  const sync = () => { engineStats.total = total; engineStats.readyCount = readyCount; engineStats.inflight = inflight; engineStats.painted = painted; };
  const frameAt = () => Math.round(Math.min(1, Math.max(0, progress)) * (total - 1));
  const decodeWidth = () => Math.max(1024, Math.min(1440, innerWidth || 1280));

  function release(i) { const f = frames[i]; if (!f) return; if (f.close) f.close(); frames[i] = undefined; status[i] = 0; readyCount--; }
  function loadFrame(i) {
    if (status[i] !== 0 || destroyed) return;
    status[i] = 1; inflight++;
    const img = new Image(); img.decoding = 'async';
    const settle = ok => { img.onload = img.onerror = null; inflight--; if (!ok) { status[i] = 3; tries[i]++; } sync(); pump(); };
    img.onload = () => {
      if (destroyed) { settle(true); return; }
      const w = Math.min(img.naturalWidth || decodeWidth(), decodeWidth());
      const keep = f => { if (destroyed) { if (f.close) f.close(); settle(true); return; } frames[i] = f; status[i] = 2; readyCount++; lastDrawn = -1; settle(true); };
      if (typeof createImageBitmap === 'function') createImageBitmap(img, { resizeWidth: w, resizeQuality: 'high' }).then(keep, () => keep(img)); else keep(img);
    };
    img.onerror = () => settle(false);
    img.src = srcOf(i);
  }
  function nextWanted() {
    const c = frameAt();
    if (status[c] === 0) return c;
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
  function resize() { const dpr = Math.min(devicePixelRatio || 1, 2); canvas.width = Math.floor(innerWidth * dpr); canvas.height = Math.floor(innerHeight * dpr); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); lastDrawn = -1; }
  /* one animation frame: show the nearest decoded frame to the playhead (0…1) */
  function paint(p) {
    progress = p;
    let i = frameAt();
    if (status[i] !== 2) for (let d = 1; d < total; d++) { if (i - d >= 0 && status[i - d] === 2) { i -= d; break; } if (i + d < total && status[i + d] === 2) { i += d; break; } }
    const img = status[i] === 2 ? frames[i] : null;
    if (img && i !== lastDrawn) {
      const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height, s = Math.max(innerWidth / iw, innerHeight / ih);
      ctx.drawImage(img, (innerWidth - iw * s) / 2, (innerHeight - ih * s) / 2, iw * s, ih * s); lastDrawn = i;
      if (!painted) { painted = true; sync(); }
    } else if (!painted) { const g = ctx.createLinearGradient(0, 0, 0, innerHeight); g.addColorStop(0, '#0b1a26'); g.addColorStop(1, '#05090d'); ctx.fillStyle = g; ctx.fillRect(0, 0, innerWidth, innerHeight); }
    if ((tick++ & 7) === 0) { pump(); evict(); }
    if ((tick & 127) === 0) retry();
  }
  function start() { resize(); loadFrame(0); pump(); }
  function destroy() { destroyed = true; for (let i = 0; i < total; i++) if (status[i] === 2) release(i); sync(); }
  return { start, paint, resize, destroy, get painted() { return painted; } };
}
