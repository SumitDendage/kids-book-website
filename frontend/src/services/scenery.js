/* THE LIVE SCENERY — the birds and the waterfalls of the landscape picture, moving on their
   own (Sumit, Oct 7: "this bird also move and the waterfall is also flow"). The frames follow
   the scroll and stand still when the page does; this canvas runs on the clock instead.
   - The four birds sitting on the rocks and branches stay where they are in the picture, and
     now and then one flies off with flapping wings, out over the middle of the picture (so
     phones see it too), makes a loop and lands back on its spot.
   - Birds cross the sky one after another, and a far flock passes now and then.
   - The water in the waterfalls keeps flowing down.
   Everything is drawn in the picture's own pixels (1600 × 900) through the same camera move
   as the frames and the same cover fit, so it stays on the picture on every screen.
   With reduced motion the birds simply sit and the water is still. */
import blue1Src from '../assets/scene/perch-blue-1.webp';
import blue2Src from '../assets/scene/perch-blue-2.webp';
import purple1Src from '../assets/scene/perch-purple-1.webp';
import purple2Src from '../assets/scene/perch-purple-2.webp';
import flySrc from '../assets/scene/bird-fly.webp';
import flyBlueSrc from '../assets/scene/bird-fly-blue.webp';
import waterSrc from '../assets/scene/water-mask.webp';

const FRAMES = 960, PW = 1600, PH = 900, FW = 1920, FH = 1080;
/* the frames' camera (tools/render.py): a gentle zoom in and out while panning left to right */
function camera(i) {
  const p = i / (FRAMES - 1), z = 1 + 0.05 * Math.sin(Math.PI * p), w = PW / z, h = PH / z;
  return { x0: (PW - w) * (0.5 - 0.5 * Math.cos(Math.PI * p)), y0: (PH - h) * 0.6, k: FW / w };
}

/* the sitting birds: where each one is in the picture (top-left, size), which way it faces
   (1 = right), its flying look, where its flight goes and when in the 24-second round it flies */
const SITTERS = [
  { src: blue1Src, x: 52, y: 616, w: 81, h: 55, face: 1, fly: 'blue', reach: 560, up: 260, loop: 80, at: 2, dur: 8.5 },
  { src: purple1Src, x: 1462, y: 605, w: 86, h: 54, face: -1, fly: 'purple', reach: -600, up: 280, loop: 90, at: 8, dur: 9 },
  { src: blue2Src, x: 119, y: 644, w: 46, h: 54, face: 1, fly: 'blue', reach: 480, up: 200, loop: 70, at: 14, dur: 8 },
  { src: purple2Src, x: 1386, y: 664, w: 95, h: 55, face: -1, fly: 'purple', reach: -520, up: 300, loop: 80, at: 19, dur: 8.5 },
];
const ROUND = 24;
/* birds crossing the sky: which look, from x to x, height, how long the crossing takes, how
   often it comes round and when it starts; the flying sprite faces left */
const CROSSERS = [
  { fly: 'purple', from: 1700, to: -120, y: 330, size: 0.95, dur: 13, every: 22, at: 4 },
  { fly: 'blue', from: -120, to: 1720, y: 215, size: 0.7, dur: 15, every: 26, at: 11 },
  { fly: 'purple', from: 1720, to: -120, y: 430, size: 0.85, dur: 14, every: 31, at: 20 },
];
const FLOCK = { every: 28, dur: 16, at: 6, y: 165 };
/* the water mask covers this part of the picture */
const WATER = { x: 600, y: 255, w: 770, h: 550, speed: 115, tile: 256 };

const load = src => { const img = new Image(); img.decoding = 'async'; img.src = src; return img; };
const ready = img => img.complete && img.naturalWidth > 0;
const ease = t => t - Math.sin(2 * Math.PI * t) / (2 * Math.PI);   /* leaves and arrives gently */

/* falling-water streaks, one tile that repeats downwards: long thin light streaks with a few
   darker ones between, each column on its own rhythm */
function streakTile(w, h) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d'), img = g.createImageData(w, h), d = img.data;
  const ph = [[], [], []], R = [2, 3, 5];
  let a = [Math.random(), Math.random(), Math.random()];
  for (let x = 0; x < w; x++) {               /* phases drift slowly across the columns so streaks are a few pixels wide */
    for (let k = 0; k < 3; k++) { if (x % 3 === 0) a[k] = (a[k] + 0.18 + Math.random() * 0.5) % 1; ph[k][x] = a[k]; }
  }
  for (let x = 0; x < w; x++) {
    const p0 = ph[0][x], p1 = ph[1][Math.max(0, x - 1)], p2 = ph[2][Math.min(w - 1, x + 1)];
    for (let y = 0; y < h; y++) {
      const n = 0.5 + 0.22 * Math.sin(2 * Math.PI * (R[0] * y / h + p0)) + 0.17 * Math.sin(2 * Math.PI * (R[1] * y / h + p1)) + 0.11 * Math.sin(2 * Math.PI * (R[2] * y / h + p2));
      const i = (y * w + x) * 4, hi = Math.min(1, Math.max(0, (n - 0.62) * 3.2)), lo = Math.min(1, Math.max(0, (0.36 - n) * 3));
      if (hi > 0) { d[i] = 255; d[i + 1] = 255; d[i + 2] = 255; d[i + 3] = 200 * hi; }
      else if (lo > 0) { d[i] = 120; d[i + 1] = 150; d[i + 2] = 185; d[i + 3] = 80 * lo; }
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

export function createScenery(canvas) {
  const ctx = canvas.getContext('2d');
  const still = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const sitters = SITTERS.map(s => Object.assign({ img: load(s.src) }, s));
  const flyer = { purple: load(flySrc), blue: load(flyBlueSrc) };
  const mask = load(waterSrc);
  let W = 0, H = 0, dpr = 1, tile = null, water = null, lastI = -1;
  const t0 = performance.now();

  function resize() {
    dpr = Math.min(devicePixelRatio || 1, 2); W = innerWidth; H = innerHeight;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); lastI = -1;
  }

  /* a bird in flight at picture point (x, y): the flying sprite, wings beating by a squash,
     turned the way it is going and tipped a little with its climb */
  function flying(look, x, y, width, dir, beat, tilt, alpha) {
    const img = flyer[look]; if (!ready(img) || alpha <= 0) return;
    const w = width, h = w * img.naturalHeight / img.naturalWidth, f = 0.62 + 0.38 * (0.5 + 0.5 * Math.cos(beat));
    ctx.save(); ctx.globalAlpha = alpha; ctx.translate(x, y); ctx.rotate(tilt);
    ctx.scale(dir > 0 ? -1 : 1, f); ctx.drawImage(img, -w / 2, -h / 2, w, h); ctx.restore();
  }

  function drawSitter(s, t) {
    const hx = s.x + s.w / 2, hy = s.y + s.h;                 /* its feet */
    const q = (((t - s.at) % ROUND) + ROUND) % ROUND;
    const away = !still && q < s.dur ? q / s.dur : -1;
    if (away < 0) { if (ready(s.img)) ctx.drawImage(s.img, s.x, s.y, s.w, s.h); return; }
    /* the loop: out and up, round, and back onto the same spot from behind */
    const u = ease(away), dir = Math.sign(s.reach);
    const x = hx + s.reach * (1 - Math.cos(2 * Math.PI * u)) / 2 - dir * s.loop * Math.sin(2 * Math.PI * u);
    const y = hy - s.h * 0.55 - s.up * Math.sin(Math.PI * u) - 25 * Math.sin(2 * Math.PI * u);
    const vx = s.reach * Math.PI * Math.sin(2 * Math.PI * u) - dir * s.loop * 2 * Math.PI * Math.cos(2 * Math.PI * u);
    const going = Math.abs(vx) > 1 ? Math.sign(vx) : s.face;
    const vy = -s.up * Math.PI * Math.cos(Math.PI * u);
    const tilt = Math.max(-0.35, Math.min(0.35, Math.atan2(vy, Math.abs(vx) + 60) * 0.5)) * -going;
    /* sitting look and flying look cross over for a moment as it lifts off and settles */
    const edge = Math.min(away, 1 - away) / 0.07, sw = Math.min(1, edge);
    if (sw < 1 && ready(s.img)) {
      ctx.save(); ctx.globalAlpha = 1 - sw; ctx.drawImage(s.img, s.x, s.y - sw * 6, s.w, s.h); ctx.restore();
    }
    flying(s.fly, x, y, s.w * 0.95, going, t * 2 * Math.PI * 5.5, tilt, sw);
  }

  function drawCrossers(t) {
    CROSSERS.forEach((c, j) => {
      const q = (((t - c.at) % c.every) + c.every) % c.every; if (q > c.dur) return;
      const u = q / c.dur, x = c.from + (c.to - c.from) * u, y = c.y + 28 * Math.sin(2 * Math.PI * u * 1.5 + j) - 30 * Math.sin(Math.PI * u);
      const dir = Math.sign(c.to - c.from), tilt = 0.06 * Math.cos(2 * Math.PI * u * 1.5 + j) * -dir;
      flying(c.fly, x, y, 77 * c.size, dir, t * 2 * Math.PI * (4.5 + j * 0.4), tilt, 1);
    });
    /* the far flock: five small dark "v" shapes beating their wings */
    const q = (((t - FLOCK.at) % FLOCK.every) + FLOCK.every) % FLOCK.every;
    if (q > FLOCK.dur) return;
    const u = q / FLOCK.dur;
    ctx.save(); ctx.strokeStyle = 'rgba(52,64,92,0.85)'; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (let j = 0; j < 5; j++) {
      const x = -80 + (PW + 160) * u + j * 20, y = FLOCK.y + 20 * j + 12 * Math.sin(2 * Math.PI * (u * 2 + j * 0.2)) + (j % 2) * 10;
      const span = 11 - j * 0.6, a = Math.sin(t * 2 * Math.PI * 3.2 + j) * 0.7;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(x - span, y - Math.sin(a) * span * 0.55);
      ctx.quadraticCurveTo(x - span * 0.45, y - Math.sin(a) * span * 0.2 - 2, x, y);
      ctx.quadraticCurveTo(x + span * 0.45, y - Math.sin(a) * span * 0.2 - 2, x + span, y - Math.sin(a) * span * 0.55);
      ctx.stroke();
    }
    ctx.restore();
  }

  /* the water: streaks slide down through the waterfall mask */
  function drawWater(t) {
    if (!ready(mask)) return;
    if (!tile) { tile = streakTile(WATER.w, WATER.tile); water = document.createElement('canvas'); water.width = WATER.w; water.height = WATER.h; }
    const g = water.getContext('2d');
    g.globalCompositeOperation = 'source-over'; g.clearRect(0, 0, WATER.w, WATER.h);
    const off = (t * WATER.speed) % WATER.tile;
    for (let y = off - WATER.tile; y < WATER.h; y += WATER.tile) g.drawImage(tile, 0, y);
    g.globalCompositeOperation = 'destination-in'; g.drawImage(mask, 0, 0, WATER.w, WATER.h);
    g.globalCompositeOperation = 'source-over';
    ctx.drawImage(water, WATER.x, WATER.y);
  }

  /* one animation frame; i is the frame the background is showing (0…959) */
  function paint(i) {
    if (!W) resize();
    if (still && i === lastI) return;
    lastI = i;
    const t = (performance.now() - t0) / 1000;
    const cam = camera(Math.max(0, Math.min(FRAMES - 1, i)));
    const S = Math.max(W / FW, H / FH), sc = cam.k * S, ox = (W - FW * S) / 2, oy = (H - FH * S) / 2;
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(dpr * sc, 0, 0, dpr * sc, dpr * (ox - cam.x0 * sc), dpr * (oy - cam.y0 * sc));
    if (!still) { drawWater(t); drawCrossers(t); }
    sitters.forEach(s => drawSitter(s, t));
  }
  return { paint, resize, destroy() {} };
}
