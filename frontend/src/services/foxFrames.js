/* the 50 fox-and-rabbit frames, loaded once (in order, one after another) and
   shared by every player — the Sheets chapter and the store background.
   Nothing is fetched until a player first plays. */
export const FOX = (() => {
  const N = 50, imgs = []; let loading = false; const waiting = [];
  const src = k => '/preview-frames/frame_' + String(k + 1).padStart(3, '0') + '.jpg';
  async function load(onFirst) {
    if (loading) { if (imgs[0]) onFirst(); else waiting.push(onFirst); return; }
    loading = true;
    for (let k = 0; k < N; k++) await new Promise(res => { const im = new Image(); im.decoding = 'async'; im.onload = () => { imgs[k] = im; if (k === 0) { onFirst(); waiting.splice(0).forEach(f => f()); } res(); }; im.onerror = res; im.src = src(k); });
  }
  return { N, imgs, load };
})();

/* a ping-pong player on one canvas; drawing happens directly, never through React */
export function makePlayer(canvas, fps) {
  const cx = canvas.getContext('2d', { alpha: false });
  let i = 0, dir = 1, playing = false, last = 0, raf = 0, alive = true;
  function fit() { const dpr = Math.min(devicePixelRatio || 1, 2); canvas.width = Math.floor(canvas.clientWidth * dpr); canvas.height = Math.floor(canvas.clientHeight * dpr); }
  function paint() { const img = FOX.imgs[i]; if (!img || !canvas.width) return; const W = canvas.width, H = canvas.height, s = Math.max(W / img.naturalWidth, H / img.naturalHeight), w = img.naturalWidth * s, h = img.naturalHeight * s; cx.drawImage(img, (W - w) / 2, (H - h) / 2, w, h); }
  function loop(t) { if (!alive) return; raf = requestAnimationFrame(loop); if (!playing || t - last < 1000 / fps) return; last = t; let n = i + dir; if (n >= FOX.N || n < 0) { dir = -dir; n = i + dir; } if (FOX.imgs[n]) { i = n; paint(); } }
  const onResize = () => { fit(); paint(); };
  addEventListener('resize', onResize);
  return {
    play() { FOX.load(() => { if (alive) { fit(); paint(); } }); fit(); paint(); if (!raf) raf = requestAnimationFrame(loop); playing = true; },
    pause() { playing = false; },
    get playing() { return playing; },
    destroy() { alive = false; playing = false; cancelAnimationFrame(raf); raf = 0; removeEventListener('resize', onResize); },
  };
}
