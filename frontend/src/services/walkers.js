/* THE WALKING FRIENDS — the fox, the deer and the rabbit from the landscape picture,
   with the two butterflies that keep them company. They are drawn on a canvas of their
   own over the frames, so every screen gets them whole: sized from the screen (as big
   as they look in the picture, smaller when the screen is narrow or short), standing
   above the bottom labels and walking from the left edge towards the Ask AI button as
   the page scrolls. Their legs move only while the page moves, like the frames.
   Numbers are in the picture's own pixels (1600 × 900), as the sprites were cut. */
import foxSrc from '../assets/scene/fox.webp';
import deerSrc from '../assets/scene/deer.webp';
import rabbitSrc from '../assets/scene/rabbit.webp';
import pinkSrc from '../assets/scene/butterfly-pink.webp';
import aquaSrc from '../assets/scene/butterfly-aqua.webp';

const FRAMES = 960;                    /* the walk follows the same playhead as the 960 frames */
/* where each friend stands in the picture: centre x and feet y. They walk in a line, one
   behind the other on the same path (Sumit, Oct 7): the fox, then the deer, the rabbit in front */
const FRIENDS = [
  { name: 'fox', src: foxSrc, x: 357, feet: 875, gait: { period: 26, amp: 7, split: 0.64 } },
  { name: 'rabbit', src: rabbitSrc, x: 682, feet: 875, hop: true },
  { name: 'deer', src: deerSrc, x: 537, feet: 875, gait: { period: 30, amp: 8, split: 0.57 } },
];
const GROUP_LEFT = 263, GROUP_W = 466, GROUP_H = 218, GROUND = 875;
/* the butterflies: who they follow, and where they flutter from that friend's feet */
const BUTTERFLIES = [
  { src: pinkSrc, who: 'rabbit', dx: 30, dy: -170 },
  { src: aquaSrc, who: 'fox', dx: -40, dy: -205 },
];

const load = src => { const img = new Image(); img.decoding = 'async'; img.src = src; return img; };
const ready = img => img.complete && img.naturalWidth > 0;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export function createWalkers(canvas) {
  const ctx = canvas.getContext('2d');
  const sprites = FRIENDS.map(f => Object.assign({ img: load(f.src) }, f));
  const flies = BUTTERFLIES.map(b => Object.assign({ img: load(b.src) }, b));
  let W = 0, H = 0, lay = null, lastT = -1, whole = false;

  /* the home-indicator strip on phones, read from the browser once per resize */
  const probe = document.createElement('div');
  probe.style.cssText = 'position:fixed;left:0;bottom:0;width:0;height:env(safe-area-inset-bottom,0px);visibility:hidden;pointer-events:none';
  document.body.appendChild(probe);

  function resize() {
    const dpr = Math.min(devicePixelRatio || 1, 1.5);   /* like the magic layer: sharp enough for the sprites, much less work on phones */
    W = innerWidth; H = innerHeight;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const safe = probe.getBoundingClientRect().height || 0;
    const left = Math.max(12, W * 0.03);
    /* stop before the round Ask AI button in the bottom-right corner (same size and place as its CSS) */
    const right = W - clamp(W * 0.05, 20, 72) - 70;
    /* as big as they are in the picture on this screen, but never wider than two thirds of the
       path, never taller than 30% of the screen, and never blown up past the sprites' own detail */
    const inPicture = Math.max(W / 1920, H / 1080) * 1.2;
    const u = Math.min(inPicture, (right - left) * 0.66 / GROUP_W, H * 0.3 / GROUP_H, 1.3);
    /* the deer's feet stand above the chapter counter, the scroll hint and the phone's home bar */
    const ground = H - Math.max(64, H * 0.07) - safe;
    lay = { u, left, span: Math.max(0, right - left - GROUP_W * u), ground };
    lastT = -1;
  }

  /* fox and deer: the legs under the belly swing in turn — the back half and the front half lean opposite ways */
  function walk(s, X, Y, w, h, t, moving) {
    const { period, amp, split } = s.gait, img = s.img, iw = img.naturalWidth, ih = img.naturalHeight;
    const wave = Math.sin(2 * Math.PI * t / period);
    const top = h * split, low = h - top, lean = amp * lay.u * moving * wave / low;
    const bob = 2.4 * Math.abs(wave) * lay.u * moving;
    ctx.save();
    ctx.translate(X, Y - h / 2 - bob); ctx.rotate(-1.2 * wave * moving * Math.PI / 180); ctx.translate(-w / 2, -h / 2);
    ctx.drawImage(img, 0, 0, iw, ih * split, 0, 0, w, top);
    [[0, lean], [0.5, -lean]].forEach(([from, k]) => {
      ctx.save(); ctx.translate(w * from, top); ctx.transform(1, 0, k, 1, 0, 0);
      ctx.drawImage(img, iw * from, ih * split, iw / 2, ih - ih * split, 0, 0, w / 2, low);
      ctx.restore();
    });
    ctx.restore();
  }
  /* the rabbit hops: up in an arc, a little squash when it lands */
  function hop(s, X, Y, w, h, t, moving) {
    const ph = (t % 30) / 30, up = ph < 0.62;
    const lift = (up ? 26 * Math.sin(Math.PI * ph / 0.62) : 0) * moving * lay.u;
    const squash = 1 - (up ? 0 : 0.08 * Math.sin(Math.PI * (ph - 0.62) / 0.38)) * moving;
    const sw = w * (2 - squash), sh = h * squash;
    ctx.save();
    ctx.translate(X, Y - lift - sh / 2); ctx.rotate((up ? 6 * Math.sin(Math.PI * ph / 0.62) : 0) * moving * Math.PI / 180);
    ctx.drawImage(s.img, -sw / 2, -sh / 2, sw, sh);
    ctx.restore();
    return lift;
  }
  function shadow(X, Y, w, strength) {
    const h = Math.max(4, w * 0.16);
    ctx.save(); ctx.translate(X, Y - 2); ctx.scale(1, h / w);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, w / 2 + 6);
    g.addColorStop(0, 'rgba(20,30,10,' + (0.37 * strength).toFixed(3) + ')'); g.addColorStop(1, 'rgba(20,30,10,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, w / 2 + 6, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  /* one animation frame at the playhead p (0…1); nothing is redrawn while the page stands still */
  function paint(p) {
    if (!lay) resize();
    const t = clamp(p, 0, 1) * (FRAMES - 1);
    if (t === lastT && whole) return;
    lastT = t; whole = sprites.concat(flies).every(s => ready(s.img));
    ctx.clearRect(0, 0, W, H);
    const { u, left, span, ground } = lay;
    const moving = Math.min(1, clamp(p, 0, 1) / 0.02);
    const gx = left + span * Math.pow(clamp(p, 0, 1), 1.35);   /* the group's left edge: a slow start, then a steady walk */
    const at = {};
    sprites.forEach(s => {
      const X = gx + (s.x - GROUP_LEFT) * u, Y = ground - (GROUND - s.feet) * u;
      at[s.name] = { X, Y };
      if (!ready(s.img)) return;
      const w = s.img.naturalWidth * u, h = s.img.naturalHeight * u;
      if (s.hop) { const lift = hop(s, X, Y, w, h, t, moving); shadow(X, Y, w * 0.75, 1 - 0.5 * lift / (26 * u)); }
      else { shadow(X, Y, w * 0.7, 1); walk(s, X, Y, w, h, t, moving); }
    });
    flies.forEach((b, j) => {
      if (!ready(b.img)) return;
      const f = at[b.who];
      const X = f.X + (b.dx + 40 * Math.sin(2 * Math.PI * t / 120 + j)) * u, Y = f.Y + (b.dy + 18 * Math.sin(2 * Math.PI * t / 70 + 2 * j)) * u;
      const flap = 0.28 + 0.72 * Math.abs(Math.cos(Math.PI * t / (7 + j)));
      const w = b.img.naturalWidth * u * 0.9, h = b.img.naturalHeight * u * 0.9;
      ctx.drawImage(b.img, X - w * flap / 2, Y - h / 2, w * flap, h);
    });
  }
  function destroy() { probe.remove(); }
  return { paint, resize, destroy };
}
