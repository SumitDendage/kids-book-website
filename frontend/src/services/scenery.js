/* THE LIVE SCENERY — the birds and the waterfalls of the landscape picture, moving on their
   own (Sumit, Oct 7: "this bird also move and the waterfall is also flow"). The frames follow
   the scroll and stand still when the page does; this canvas runs on the clock instead.
   - The four birds of the picture never sit: they fly side to side all the time, each on its
     own height and rhythm, turning round at each end ("the bird is side moving not sitting").
     Their paths cross the middle of the picture, so phones see them too.
   - Each bird really flaps (Sumit, Oct 7: "it fly animation is not good"): the sprite is cut
     into its body and its two wings, and the wings beat up and down from the shoulder, a
     quick downstroke and a slower upstroke, with the body lifting a little on each beat.
     After a few beats the bird glides with its wings held out, then flaps again, and at the
     end of its path it turns round instead of flipping.
   - Birds cross the sky one after another, and a far flock passes now and then.
   - The water in the waterfalls keeps running from the top to the bottom.
   Everything is drawn in the picture's own pixels (1600 × 900) through the same camera move
   as the frames and the same cover fit, so it stays on the picture on every screen.
   With reduced motion the birds hold still in the air and the water is still. */
import flySrc from '../assets/scene/bird-fly.webp';
import flyBlueSrc from '../assets/scene/bird-fly-blue.webp';
import waterSrc from '../assets/scene/water-mask.webp';

const FRAMES = 960, PW = 1600, PH = 900, FW = 1920, FH = 1080;
/* the frames' camera (tools/render.py): a gentle zoom in and out while panning left to right */
function camera(i) {
  const p = i / (FRAMES - 1), z = 1 + 0.05 * Math.sin(Math.PI * p), w = PW / z, h = PH / z;
  return { x0: (PW - w) * (0.5 - 0.5 * Math.cos(Math.PI * p)), y0: (PH - h) * 0.6, k: FW / w };
}

/* the picture's four birds (two bluebirds, two purple birds): the middle and half-width of
   each one's side-to-side flight, its height, width, seconds for there and back, phase,
   seconds per wing beat, beats before a glide and how long the glide lasts */
const GLIDERS = [
  { fly: 'blue', cx: 430, span: 330, y: 560, w: 77, period: 17, phase: 0, beat: 0.26, flaps: 6, glide: 0.8 },
  { fly: 'purple', cx: 1180, span: 330, y: 500, w: 82, period: 19, phase: 1.7, beat: 0.28, flaps: 5, glide: 0.9 },
  { fly: 'blue', cx: 760, span: 420, y: 655, w: 52, period: 21, phase: 3.1, beat: 0.22, flaps: 7, glide: 0.6 },
  { fly: 'purple', cx: 930, span: 480, y: 390, w: 88, period: 23, phase: 4.4, beat: 0.3, flaps: 4, glide: 1.0 },
];
/* birds crossing the sky: which look, from x to x, height, how long the crossing takes, how
   often it comes round and when it starts; the flying sprite faces left */
const CROSSERS = [
  { fly: 'purple', from: 1700, to: -120, y: 330, size: 0.95, dur: 13, every: 22, at: 4 },
  { fly: 'blue', from: -120, to: 1720, y: 215, size: 0.7, dur: 15, every: 26, at: 11 },
  { fly: 'purple', from: 1720, to: -120, y: 430, size: 0.85, dur: 14, every: 31, at: 20 },
];
const FLOCK = { every: 28, dur: 16, at: 6, y: 165 };
/* the water mask covers this part of the picture */
const WATER = { x: 600, y: 255, w: 770, h: 550, speed: 150, drops: 290, tile: 256 };

const load = src => { const img = new Image(); img.decoding = 'async'; img.src = src; return img; };
const ready = img => img.complete && img.naturalWidth > 0;

/* the flying sprites are 77 × 77 and face left. Their two wings, in sprite pixels: the near
   wing (the big one on the right) and the far wing (behind the head), each with the shoulder
   it turns from; the body keeps a patch round each shoulder so no gap opens when a wing moves */
const BIRD = 77;
const NEAR = { pts: [[28, 40], [33, 30], [42, 20], [52, 8], [58, 1], [67, 0], [76, 5], [76, 30], [71, 43], [64, 50], [54, 52], [46, 51], [38, 50], [30, 47]], at: [36, 46], keep: [35, 44, 8, 6] };
const FAR = { pts: [[0, 4], [11, 3], [23, 11], [30, 21], [32, 29], [27, 31], [21, 27], [13, 25], [5, 26], [0, 27]], at: [26, 29], keep: [26, 29, 4, 3] };
function cutBird(img) {
  const piece = () => { const c = document.createElement('canvas'); c.width = c.height = BIRD; return c; };
  const path = (g, pts) => { g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); };
  const wing = w => { const c = piece(), g = c.getContext('2d'); path(g, w.pts); g.clip(); g.drawImage(img, 0, 0, BIRD, BIRD); return c; };
  const body = piece(), g = body.getContext('2d');
  g.drawImage(img, 0, 0, BIRD, BIRD);
  g.globalCompositeOperation = 'destination-out'; path(g, NEAR.pts); g.fill(); path(g, FAR.pts); g.fill();
  g.globalCompositeOperation = 'source-over';
  [NEAR, FAR].forEach(w => { const [x, y, rx, ry] = w.keep; g.save(); g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, 2 * Math.PI); g.clip(); g.drawImage(img, 0, 0, BIRD, BIRD); g.restore(); });
  return { body, near: wing(NEAR), far: wing(FAR) };
}

/* where the wings are at time t: 1 = up as drawn, -1 = down. A beat is a quick downstroke and
   a slower upstroke; after `flaps` beats the bird glides with its wings half out, then flaps
   again. lift is how far the body rises (in picture pixels) */
function wingsAt(t, beat, flaps, glide, phase) {
  const cyc = flaps * beat + glide, c = ((t + phase) % cyc + cyc) % cyc;
  if (c >= flaps * beat) {   /* gliding: wings ease out to half way and back up, the bird sinks a little */
    const g = (c - flaps * beat) / glide;
    return { pos: 1 - 0.62 * Math.sin(Math.PI * g), lift: -2.5 * Math.sin(Math.PI * g) };
  }
  const q = (c % beat) / beat, D = 0.42;
  const pos = q < D ? Math.cos(Math.PI * q / D) : -Math.cos(Math.PI * (q - D) / (1 - D));
  return { pos, lift: q < D ? 2.2 * Math.sin(Math.PI * q / D) : -0.8 * Math.sin(Math.PI * (q - D) / (1 - D)) };
}

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
      const i = (y * w + x) * 4, hi = Math.min(1, Math.max(0, (n - 0.56) * 3.5)), lo = Math.min(1, Math.max(0, (0.4 - n) * 3));
      if (hi > 0) { d[i] = 255; d[i + 1] = 255; d[i + 2] = 255; d[i + 3] = 235 * hi; }
      else if (lo > 0) { d[i] = 90; d[i + 1] = 125; d[i + 2] = 165; d[i + 3] = 120 * lo; }
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}
/* falling drops: short bright dashes with a fading tail above them, slid down faster than the
   streaks, so the eye reads the water running from the top to the bottom */
function dropTile(w, h) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d');
  for (let k = 0; k < w * 0.6; k++) {
    const x = Math.random() * w, y = Math.random() * h, len = 16 + Math.random() * 36, lw = 1.2 + Math.random() * 1.8;
    [y, y - h].forEach(y0 => {
      const gr = g.createLinearGradient(0, y0 - len, 0, y0);
      gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(1, 'rgba(255,255,255,0.9)');
      g.fillStyle = gr; g.fillRect(x, y0 - len, lw, len);
    });
  }
  return c;
}

export function createScenery(canvas) {
  const ctx = canvas.getContext('2d');
  const still = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const flyer = { purple: load(flySrc), blue: load(flyBlueSrc) }, cut = {};
  const mask = load(waterSrc);
  let W = 0, H = 0, dpr = 1, tile = null, drops = null, water = null, lastI = -1;
  const t0 = performance.now();

  function resize() {
    dpr = Math.min(devicePixelRatio || 1, 2); W = innerWidth; H = innerHeight;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); lastI = -1;
  }

  /* a bird in flight at picture point (x, y), `width` wide. face: 1 = flying right, -1 = left,
     anything between while it turns round. The far wing beats behind the body, the near wing
     in front: each swings down round its shoulder and shortens a little as it goes, and the
     far wing tucks in behind the head instead of reaching past the beak */
  function flying(look, x, y, width, face, wings, tilt, alpha) {
    const img = flyer[look]; if (!ready(img) || alpha <= 0) return;
    const p = cut[look] || (cut[look] = cutBird(img)), k = width / BIRD, pos = wings.pos;
    const flap = (c, w, sx, sy, turn) => {
      const [ax, ay] = w.at;
      ctx.save(); ctx.translate(ax, ay); ctx.rotate(turn); ctx.scale(sx, sy); ctx.translate(-ax, -ay);
      ctx.drawImage(c, 0, 0); ctx.restore();
    };
    ctx.save(); ctx.globalAlpha = alpha;
    ctx.translate(x, y - wings.lift); ctx.rotate(tilt + 0.04 * (1 - pos) * (face < 0 ? 1 : -1));
    ctx.scale(-face * k, k); ctx.translate(-BIRD / 2, -BIRD / 2);
    const down = (1 - pos) / 2;   /* 0 with the wings up, 1 at the bottom of the stroke */
    flap(p.far, FAR, 1 - 0.3 * down, 1 - 0.72 * down, -0.25 * down);
    ctx.drawImage(p.body, 0, 0);
    flap(p.near, NEAR, 1, 1 - 0.4 * down, 1.55 * down);
    ctx.restore();
  }

  /* side to side: steady across the middle, easing round at each end, where it turns about */
  function drawGlider(b, t) {
    const th = 2 * Math.PI * t / b.period + b.phase, K = 3;
    const x = b.cx + b.span * Math.atan(K * Math.sin(th)) / Math.atan(K);
    const c = Math.cos(th), face = (c < 0 ? -1 : 1) * Math.max(0.45, Math.min(1, 5 * Math.abs(c)));   /* narrows as it turns round, never to a sliver */
    const y = b.y + 10 * Math.sin(2 * th + b.phase) - 12 * (1 - Math.abs(Math.cos(th)));
    const wings = still ? { pos: 0.6, lift: 0 } : wingsAt(t, b.beat, b.flaps, b.glide, b.phase);
    flying(b.fly, x, y, b.w, face, wings, 0, 1);
  }

  function drawCrossers(t) {
    CROSSERS.forEach((c, j) => {
      const q = (((t - c.at) % c.every) + c.every) % c.every; if (q > c.dur) return;
      const u = q / c.dur, x = c.from + (c.to - c.from) * u, y = c.y + 28 * Math.sin(2 * Math.PI * u * 1.5 + j) - 30 * Math.sin(Math.PI * u);
      const dir = Math.sign(c.to - c.from), tilt = 0.06 * Math.cos(2 * Math.PI * u * 1.5 + j) * -dir;
      flying(c.fly, x, y, 77 * c.size, dir, wingsAt(t, 0.24 + j * 0.02, 5, 0.7, j), tilt, 1);
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
    if (!tile) { tile = streakTile(WATER.w, WATER.tile); drops = dropTile(WATER.w, WATER.tile); water = document.createElement('canvas'); water.width = WATER.w; water.height = WATER.h; }
    const g = water.getContext('2d');
    g.globalCompositeOperation = 'source-over'; g.clearRect(0, 0, WATER.w, WATER.h);
    const off = (t * WATER.speed) % WATER.tile, off2 = (t * WATER.drops) % WATER.tile;
    for (let y = off - WATER.tile; y < WATER.h; y += WATER.tile) g.drawImage(tile, 0, y);
    for (let y = off2 - WATER.tile; y < WATER.h; y += WATER.tile) g.drawImage(drops, 0, y);
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
    GLIDERS.forEach(b => drawGlider(b, still ? 0 : t));
  }
  return { paint, resize, destroy() {} };
}
