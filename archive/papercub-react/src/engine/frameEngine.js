/* =====================================================================
   BACKGROUND — frame-by-frame scroll animation.
   Sequence, easing, scroll ratios, loading order and draw maths are
   exactly as delivered in the original build. The only change is that the
   engine is created against a canvas React owns, talks to the content
   layer through a `hooks` object, and can be destroyed on unmount.
   ===================================================================== */

export const TOTAL_FRAMES = 960;

/* Memory policy.  960 frames at 1920x1080 is ~8 GB once decoded, which is
   what made the tab run out of memory and paint nothing but black.  We keep
   a permanent ladder of every KEY-th frame so any scroll position always has
   something to show, plus a window of neighbours around the playhead, and we
   release the rest — ImageBitmap.close() hands the memory straight back. */
const KEY = 24, WINDOW = 32, MAX_RESIDENT = 96, CONCURRENCY = 6;

export function createFrameEngine(canvas, hooks = {}, options = {}) {
  const total = options.total || TOTAL_FRAMES;
  const base = options.base || '';
  const ctx = canvas.getContext('2d', { alpha: false });
  const frames = new Array(total);          /* ImageBitmap (or Image) once ready */
  const status = new Uint8Array(total);     /* 0 idle · 1 loading · 2 ready · 3 failed */
  const tries = new Uint8Array(total);
  let current = 0, target = 0, lastDrawn = -1, touchY = 0, readyCount = 0, inflight = 0, painted = false, tick = 0;
  let alive = true, raf = 0;

  const clamp = value => Math.max(0, Math.min(total - 1, value));
  const srcOf = i => base + 'frames-webp/frame_' + String(i + 1).padStart(6, '0') + '.webp';
  const call = (name, ...args) => (typeof hooks[name] === 'function' ? hooks[name](...args) : undefined);
  const isKey = i => i % KEY === 0;

  function decodeWidth() {
    return Math.max(1024, Math.min(1440, innerWidth || 1280));
  }

  function release(i) {
    const frame = frames[i];
    if (!frame) return;
    if (frame.close) frame.close();
    frames[i] = undefined; status[i] = 0; readyCount--;
  }

  function loadFrame(i) {
    if (!alive || status[i] !== 0) return;
    status[i] = 1; inflight++;
    const image = new Image();
    image.decoding = 'async';
    const settle = ok => { image.onload = image.onerror = null; inflight--; if (!ok) { status[i] = 3; tries[i]++; } pump(); };
    image.onload = () => {
      if (!alive) { inflight--; return; }
      const width = Math.min(image.naturalWidth || decodeWidth(), decodeWidth());
      const keep = frame => { frames[i] = frame; status[i] = 2; readyCount++; lastDrawn = -1; settle(true); };
      if (typeof createImageBitmap === 'function') {
        createImageBitmap(image, { resizeWidth: width, resizeQuality: 'high' }).then(keep, () => keep(image));
      } else keep(image);
    };
    image.onerror = () => settle(false);
    image.src = srcOf(i);
  }

  /* Next frame worth fetching: the one under the playhead, then the ladder,
     then outward from the playhead. */
  function nextWanted() {
    const centre = Math.round(current);
    if (status[centre] === 0) return centre;
    for (let i = 0; i < total; i += KEY) if (status[i] === 0) return i;
    for (let d = 1; d <= WINDOW; d++) {
      if (centre - d >= 0 && status[centre - d] === 0) return centre - d;
      if (centre + d < total && status[centre + d] === 0) return centre + d;
    }
    return -1;   /* ladder + window satisfied — stay quiet until the playhead moves */
  }

  function pump() {
    while (alive && inflight < CONCURRENCY) {
      const i = nextWanted();
      if (i < 0) break;
      loadFrame(i);
    }
  }

  function evict() {
    if (readyCount <= MAX_RESIDENT) return;
    const centre = Math.round(current);
    const spare = [];
    for (let i = 0; i < total; i++) if (status[i] === 2 && !isKey(i) && Math.abs(i - centre) > WINDOW) spare.push(i);
    spare.sort((a, b) => Math.abs(b - centre) - Math.abs(a - centre));
    for (let k = 0; k < spare.length && readyCount > MAX_RESIDENT; k++) release(spare[k]);
  }

  /* A frame that failed gets another chance rather than leaving a hole. */
  function retry() {
    const centre = Math.round(current);
    for (let d = 0; d <= WINDOW; d++) {
      const a = centre - d, b = centre + d;
      if (a >= 0 && status[a] === 3 && tries[a] < 3) status[a] = 0;
      if (b < total && status[b] === 3 && tries[b] < 3) status[b] = 0;
    }
    for (let i = 0; i < total; i += KEY) if (status[i] === 3 && tries[i] < 3) status[i] = 0;
  }

  /* Something soft rather than a black void while the first frame arrives. */
  function placeholder() {
    const g = ctx.createLinearGradient(0, 0, 0, innerHeight);
    g.addColorStop(0, '#0b1020'); g.addColorStop(1, '#05070d');
    ctx.fillStyle = g; ctx.fillRect(0, 0, innerWidth, innerHeight);
  }

  function resize() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.floor(innerWidth * dpr); canvas.height = Math.floor(innerHeight * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); lastDrawn = -1;
  }

  function draw() {
    if (!alive) return;
    current += (target - current) * 0.1;
    let index = Math.round(current);
    if (status[index] !== 2) {
      for (let distance = 1; distance < total; distance++) {
        if (index - distance >= 0 && status[index - distance] === 2) { index -= distance; break; }
        if (index + distance < total && status[index + distance] === 2) { index += distance; break; }
      }
    }
    const image = status[index] === 2 ? frames[index] : null;
    if (image && index !== lastDrawn) {
      const iw = image.naturalWidth || image.width, ih = image.naturalHeight || image.height;
      const scale = Math.max(innerWidth / iw, innerHeight / ih);
      const w = iw * scale, h = ih * scale;
      ctx.drawImage(image, (innerWidth - w) / 2, (innerHeight - h) / 2, w, h); lastDrawn = index;
      if (!painted) { painted = true; call('onFirstFrame'); }
    } else if (!painted) placeholder();
    if ((tick++ & 7) === 0) { pump(); evict(); }
    if ((tick & 127) === 0) retry();
    call('onFrame', current, target);
    raf = requestAnimationFrame(draw);
  }

  const onWheel = event => {
    const delta = event.deltaY * (event.deltaMode === 1 ? 30 : event.deltaMode === 2 ? innerHeight : 1);
    if (call('scrollLocked', delta, false)) return;
    target = clamp(target + delta * 0.15);
    call('onScrollInput');
  };
  const onTouchStart = event => { touchY = event.touches[0].clientY; call('onTouchStart', event); };
  const onTouchMove = event => {
    const y = event.touches[0].clientY, dy = touchY - y;
    if (call('scrollLocked', dy, true)) { touchY = y; return; }
    target = clamp(target + dy * 0.65); touchY = y;
    call('onScrollInput');
  };
  const onKeyDown = event => {
    if (call('isTyping', event.target)) return;
    if (['ArrowDown', 'ArrowRight', 'PageDown', ' '].includes(event.key)) target = clamp(target + 60);
    else if (['ArrowUp', 'ArrowLeft', 'PageUp'].includes(event.key)) target = clamp(target - 60);
    else if (event.key === 'Home') target = 0;
    else if (event.key === 'End') target = total - 1;
    else return;
    event.preventDefault();
    call('onScrollInput');
  };

  addEventListener('resize', resize);
  addEventListener('wheel', onWheel, { passive: true });
  addEventListener('touchstart', onTouchStart, { passive: true });
  addEventListener('touchmove', onTouchMove, { passive: true });
  addEventListener('keydown', onKeyDown);

  resize();
  loadFrame(0);
  pump();
  raf = requestAnimationFrame(draw);

  return {
    total,
    clamp,
    srcOf,
    get current() { return current; },
    get target() { return target; },
    /* The content layer moves the playhead through these instead of touching globals. */
    setTarget(value) { target = clamp(value); },
    snap() { current = target; },
    isPainted() { return painted; },
    /* Handy in DevTools: window.papercubFrames() reports what the loader is holding. */
    stats() {
      let ready = 0, failed = 0, loading = 0;
      for (let i = 0; i < total; i++) { if (status[i] === 2) ready++; else if (status[i] === 3) failed++; else if (status[i] === 1) loading++; }
      return { ready, failed, loading, resident: readyCount, cap: MAX_RESIDENT, frame: Math.round(current), painted };
    },
    destroy() {
      alive = false;
      cancelAnimationFrame(raf);
      removeEventListener('resize', resize);
      removeEventListener('wheel', onWheel);
      removeEventListener('touchstart', onTouchStart);
      removeEventListener('touchmove', onTouchMove);
      removeEventListener('keydown', onKeyDown);
      for (let i = 0; i < total; i++) release(i);
    },
  };
}
