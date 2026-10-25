/* THE LIVE SCENERY — the birds and the waterfalls of the landscape picture, moving on their
   own (Sumit, Oct 7: "this bird also move and the waterfall is also flow"). The frames follow
   the scroll and stand still when the page does; this canvas runs on the clock instead.
   - The birds of the picture fly the way real birds do (Sumit, Oct 15: "moving of birds
     naturally"): each one crosses the whole sky in a long, gentle curve and comes back later
     from the other side, so they never pace to and fro or spin round in mid-air. The body
     follows the path, nose up when climbing and down when it sinks; climbing birds flap,
     sinking birds glide with their wings held out, and the speed changes a little along the
     way. Their paths are staggered so a few are always in the sky, phones included.
   - Each bird really flaps (Sumit, Oct 7: "it fly animation is not good"): the sprite is cut
     into its body and its two wings, and the wings beat up and down from the shoulder, a
     quick downstroke and a slower upstroke, with the body lifting a little on each beat.
   - A far flock passes now and then.
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

/* the birds of the picture (bluebirds and purple birds). Each crosses the sky from `from` to
   `to` (picture x) in `dur` seconds, comes round every `every` seconds starting at `at`, at
   height y with long slow rises and dips (`amp` pixels, `waves` half-waves per crossing), `w`
   wide, and `beat` seconds per wing beat. The flying sprite faces left */
const BIRDS = [
  { fly: 'blue', from: -110, to: 1710, y: 560, amp: 34, waves: 1.6, ph: 0.4, w: 74, dur: 24, every: 30, at: 0, beat: 0.26 },
  { fly: 'purple', from: 1710, to: -110, y: 470, amp: 42, waves: 1.2, ph: 2.1, w: 82, dur: 27, every: 34, at: 9, beat: 0.29 },
  { fly: 'blue', from: 1710, to: -110, y: 650, amp: 26, waves: 2.0, ph: 1.0, w: 54, dur: 22, every: 29, at: 15, beat: 0.22 },
  { fly: 'purple', from: -110, to: 1710, y: 380, amp: 46, waves: 1.4, ph: 3.3, w: 86, dur: 29, every: 37, at: 21, beat: 0.3 },
  { fly: 'purple', from: 1710, to: -110, y: 300, amp: 30, waves: 1.0, ph: 0.9, w: 64, dur: 25, every: 41, at: 30, beat: 0.27 },
  { fly: 'blue', from: -110, to: 1710, y: 230, amp: 24, waves: 1.8, ph: 2.6, w: 50, dur: 23, every: 45, at: 38, beat: 0.23 },
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
  const lite = typeof matchMedia === 'function' && matchMedia('(pointer: coarse), (max-width: 820px)').matches;
  const flyer = { purple: load(flySrc), blue: load(flyBlueSrc) }, cut = {};
  const mask = load(waterSrc);
  let W = 0, H = 0, dpr = 1, tile = null, drops = null, water = null, lastI = -1;
  const t0 = performance.now();

  function resize() {
    W = innerWidth; H = innerHeight;
    /* no sharper than the picture the birds and water belong to (see frameEngine.js) */
    dpr = Math.min(devicePixelRatio || 1, 2, Math.max(1, 1 / Math.max(W / FW, H / FH)));
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

  /* where a crossing bird is u (0…1) of the way along: picture x, y and the path's slope */
  function along(b, u) {
    const dir = Math.sign(b.to - b.from), v = u + 0.025 * Math.sin(2 * Math.PI * u + b.ph);   /* a little faster, then slower */
    const x = b.from + (b.to - b.from) * v, a = Math.PI * b.waves * v + b.ph;
    const y = b.y + b.amp * Math.sin(a) + 0.35 * b.amp * Math.sin(2.3 * a + 1);
    return { x, y, dir };
  }

  /* one bird crossing the sky: the body follows its path, it flaps while it climbs and glides
     with its wings out while it sinks, easing between the two */
  function drawBird(b, t, j) {
    const q = (((t - b.at) % b.every) + b.every) % b.every; if (q > b.dur) return;
    const u = q / b.dur, p = along(b, u), n = along(b, Math.min(1, u + 0.004));
    const dx = n.x - p.x || p.dir, dy = n.y - p.y;
    const slope = Math.max(-0.3, Math.min(0.3, Math.atan(dy / dx)));
    const climb = -dy / Math.abs(dx);                   /* > 0 rising, < 0 sinking */
    const flapping = Math.max(0, Math.min(1, 0.5 + climb * 6));
    const f = wingsAt(t, b.beat, 4 + (j % 3), 0.5, j * 0.7);
    const wings = { pos: 0.45 + (f.pos - 0.45) * flapping, lift: f.lift * flapping };
    const fade = Math.min(1, u * 12, (1 - u) * 12);     /* no pop at the picture's edges */
    flying(b.fly, p.x, p.y, b.w, p.dir, wings, 0.75 * slope, fade);
  }

  function drawCrossers(t) {
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

  /* the water: streaks slide down through the waterfall mask. Only the part of the falls that is
     on the screen is worked out (v, in picture pixels): on a phone held upright that is about half
     of it, and none at all once the camera has panned past */
  function drawWater(t, v) {
    if (!ready(mask)) return;
    const x0 = Math.max(0, Math.floor(v.x0 - WATER.x)), y0 = Math.max(0, Math.floor(v.y0 - WATER.y));
    const x1 = Math.min(WATER.w, Math.ceil(v.x1 - WATER.x)), y1 = Math.min(WATER.h, Math.ceil(v.y1 - WATER.y));
    const w = x1 - x0, h = y1 - y0;
    if (w <= 0 || h <= 0) return;
    /* on phones the water is worked out at half size and stretched: a quarter of the work, and on
       a small screen the streaks look the same */
    const q = lite ? 0.5 : 1;
    if (!tile) { tile = streakTile(WATER.w, WATER.tile); drops = dropTile(WATER.w, WATER.tile); water = document.createElement('canvas'); water.width = Math.ceil(WATER.w * q); water.height = Math.ceil(WATER.h * q); }
    const g = water.getContext('2d');
    g.setTransform(q, 0, 0, q, 0, 0);
    g.globalCompositeOperation = 'source-over'; g.clearRect(x0, y0, w, h);
    g.save(); g.beginPath(); g.rect(x0, y0, w, h); g.clip();
    const off = (t * WATER.speed) % WATER.tile, off2 = (t * WATER.drops) % WATER.tile;
    for (let y = off - WATER.tile; y < y1; y += WATER.tile) if (y + WATER.tile > y0) g.drawImage(tile, 0, y);
    for (let y = off2 - WATER.tile; y < y1; y += WATER.tile) if (y + WATER.tile > y0) g.drawImage(drops, 0, y);
    const mx = mask.naturalWidth / WATER.w, my = mask.naturalHeight / WATER.h;
    g.globalCompositeOperation = 'destination-in'; g.drawImage(mask, x0 * mx, y0 * my, w * mx, h * my, x0, y0, w, h);
    g.restore();
    ctx.drawImage(water, x0 * q, y0 * q, w * q, h * q, WATER.x + x0, WATER.y + y0, w, h);
  }

  /* one animation frame; i is the frame the background is showing (0…959). On phones the birds
     and the water move at 30 frames a second instead of 60: the eye can't tell on a small screen,
     and it leaves the phone half its time free for the finger's scrolling */
  let skip = false;
  function paint(i) {
    if (!W) resize();
    if (still && i === lastI) return;
    if (lite && !still && (skip = !skip)) return;
    lastI = i;
    const t = (performance.now() - t0) / 1000;
    const cam = camera(Math.max(0, Math.min(FRAMES - 1, i)));
    const S = Math.max(W / FW, H / FH), sc = cam.k * S, ox = (W - FW * S) / 2, oy = (H - FH * S) / 2;
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(dpr * sc, 0, 0, dpr * sc, dpr * (ox - cam.x0 * sc), dpr * (oy - cam.y0 * sc));
    if (!still) { drawWater(t, { x0: cam.x0 - ox / sc, y0: cam.y0 - oy / sc, x1: cam.x0 + (W - ox) / sc, y1: cam.y0 + (H - oy) / sc }); drawCrossers(t); }
    if (still) BIRDS.slice(0, 4).forEach((b, j) => { const p = along(b, 0.25 + 0.15 * j); flying(b.fly, p.x, p.y, b.w, p.dir, { pos: 0.6, lift: 0 }, 0, 1); });
    else BIRDS.forEach((b, j) => drawBird(b, t, j));
  }
  return { paint, resize, destroy() {} };
}
