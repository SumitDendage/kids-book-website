import { useEffect, useRef } from 'react';

/* A light, magical layer over the forest frames: warm glow, fireflies, floating
   letters, drifting leaves and a sparkle burst wherever a child taps. One small
   canvas, no images, no React state per frame. Scrolling gives everything a
   gentle push. Calm (few, slow particles) and off for reduced motion. */
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const LEAF_COLOURS = ['#d98b3a', '#e0a64a', '#b9612f', '#8fae4a', '#c7793a'];
const rand = (a, b) => a + Math.random() * (b - a);

export default function MagicLayer() {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current, ctx = canvas.getContext('2d');
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined;
    let W = 0, H = 0, dpr = 1, raf = 0, last = performance.now(), push = 0;
    let flies = [], letters = [], leaves = [], sparks = [];

    /* one soft glow sprite, drawn once and reused for every firefly */
    const glow = document.createElement('canvas'); glow.width = glow.height = 64;
    const g = glow.getContext('2d'), grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, 'rgba(255,246,190,1)'); grd.addColorStop(0.18, 'rgba(255,226,120,0.85)'); grd.addColorStop(0.5, 'rgba(255,200,80,0.22)'); grd.addColorStop(1, 'rgba(255,190,60,0)');
    g.fillStyle = grd; g.fillRect(0, 0, 64, 64);

    const fly = () => ({ x: rand(0, W), y: rand(H * 0.25, H), vx: rand(-12, 12), vy: rand(-8, 8), r: rand(10, 22), ph: rand(0, 6.3), sp: rand(0.8, 2) });
    const letter = (y = rand(0, H)) => ({ ch: LETTERS[Math.floor(Math.random() * LETTERS.length)], x: rand(0, W), y, vy: rand(-14, -7), size: rand(22, 46), ph: rand(0, 6.3), rot: rand(-0.3, 0.3), a: rand(0.16, 0.3) });
    const leaf = (y = rand(-H, H)) => ({ x: rand(0, W), y, vy: rand(18, 34), sway: rand(20, 50), ph: rand(0, 6.3), rot: rand(0, 6.3), vr: rand(-1.2, 1.2), s: rand(7, 13), c: LEAF_COLOURS[Math.floor(Math.random() * LEAF_COLOURS.length)] });

    function resize() {
      dpr = Math.min(devicePixelRatio || 1, 1.5);
      W = innerWidth; H = innerHeight; sprites.clear();
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const small = W < 700;   /* fewer on phones: lighter and less busy */
      flies = Array.from({ length: small ? 14 : 26 }, fly);
      letters = Array.from({ length: small ? 5 : 9 }, () => letter());
      leaves = Array.from({ length: small ? 5 : 9 }, () => leaf());
    }

    function burst(x, y) {
      for (let i = 0; i < 16; i++) {
        const a = rand(0, 6.3), v = rand(60, 190);
        sparks.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 40, life: 1, s: rand(2, 4.5), hue: rand(38, 56) });
      }
      if (sparks.length > 160) sparks.splice(0, sparks.length - 160);
    }

    function star(x, y, r) {
      ctx.beginPath();
      for (let i = 0; i < 8; i++) { const rr = i % 2 ? r * 0.4 : r, a = i * Math.PI / 4; ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
      ctx.closePath(); ctx.fill();
    }

    /* a letter's soft glow is drawn once into its own little picture, then reused on every frame:
       a canvas blur worked out 60 times a second was one of the heaviest jobs on a phone */
    const sprites = new Map();
    function sprite(ch, size) {
      const key = ch + (size | 0);
      let c = sprites.get(key);
      if (c) return c;
      const pad = 18, px = Math.round(size * dpr), side = Math.ceil(px * 1.4 + pad * 2 * dpr);
      c = document.createElement('canvas'); c.width = c.height = side;
      const g2 = c.getContext('2d');
      g2.textAlign = 'center'; g2.textBaseline = 'middle'; g2.font = '500 ' + px + 'px "Cormorant Garamond", Georgia, serif';
      g2.shadowColor = 'rgba(255,220,140,0.9)'; g2.shadowBlur = 14 * dpr; g2.fillStyle = '#fff4d6';
      g2.fillText(ch, side / 2, side / 2);
      if (sprites.size > 120) sprites.clear();
      sprites.set(key, c);
      return c;
    }

    /* nothing is drawn behind the opening veil; on phones the layer moves at 30 frames a second */
    const lite = matchMedia('(pointer: coarse), (max-width: 820px)').matches;
    let skip = false;
    /* the letters' own font arrived: draw their glows again in it */
    const onFonts = () => sprites.clear();
    if (document.fonts) document.fonts.addEventListener('loadingdone', onFonts);
    function frame(now) {
      raf = requestAnimationFrame(frame);
      if (document.body.dataset.stage === 'boot') { last = now; return; }
      if (lite && (skip = !skip)) return;
      const dt = Math.min((now - last) / 1000, 0.05), t = now / 1000; last = now;
      push *= 0.92;
      ctx.clearRect(0, 0, W, H);

      /* leaves: fall, sway and turn; scrolling lifts or drops them a little */
      for (const l of leaves) {
        l.y += (l.vy + push * 0.6) * dt; l.ph += dt; l.rot += l.vr * dt;
        const x = l.x + Math.sin(l.ph) * l.sway;
        if (l.y > H + 30) Object.assign(l, leaf(-30));
        if (l.y < -60) l.y = H + 20;
        ctx.save(); ctx.translate(x, l.y); ctx.rotate(l.rot); ctx.scale(1, 0.55 + 0.45 * Math.abs(Math.cos(l.ph * 1.3)));
        ctx.globalAlpha = 0.75; ctx.fillStyle = l.c;
        ctx.beginPath(); ctx.moveTo(-l.s, 0); ctx.quadraticCurveTo(0, -l.s * 0.8, l.s, 0); ctx.quadraticCurveTo(0, l.s * 0.8, -l.s, 0); ctx.fill();
        ctx.globalAlpha = 0.45; ctx.strokeStyle = 'rgba(70,40,20,0.9)'; ctx.lineWidth = 0.8;
        ctx.beginPath(); ctx.moveTo(-l.s, 0); ctx.lineTo(l.s, 0); ctx.stroke();
        ctx.restore();
      }

      /* floating letters: rise slowly, sway, fade in and out */
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      for (const L of letters) {
        L.y += (L.vy + push * 0.4) * dt; L.ph += dt * 0.7;
        if (L.y < -60) Object.assign(L, letter(H + 40));
        if (L.y > H + 80) L.y = -40;
        const edge = Math.min(1, Math.max(0, Math.min(L.y / (H * 0.25), (H - L.y) / (H * 0.2))));
        const img = sprite(L.ch, L.size), side = img.width / dpr;
        ctx.save(); ctx.translate(L.x + Math.sin(L.ph) * 18, L.y); ctx.rotate(L.rot + Math.sin(L.ph * 0.8) * 0.12);
        ctx.globalAlpha = L.a * edge; ctx.drawImage(img, -side / 2, -side / 2, side, side); ctx.restore();
      }

      /* fireflies: wander and pulse */
      ctx.globalCompositeOperation = 'lighter';
      for (const f of flies) {
        f.vx += rand(-14, 14) * dt; f.vy += rand(-14, 14) * dt; f.vx *= 0.99; f.vy *= 0.99;
        f.x += f.vx * dt; f.y += (f.vy + push * 0.25) * dt; f.ph += f.sp * dt;
        if (f.x < -20) f.x = W + 20; if (f.x > W + 20) f.x = -20;
        if (f.y < H * 0.1) f.vy += 10 * dt; if (f.y > H + 20) f.y = H * 0.3;
        const k = 0.35 + 0.65 * Math.max(0, Math.sin(f.ph)), r = f.r * (0.7 + 0.3 * k);
        ctx.globalAlpha = 0.25 + 0.6 * k; ctx.drawImage(glow, f.x - r, f.y - r, r * 2, r * 2);
      }

      /* tap sparkles */
      for (let i = sparks.length - 1; i >= 0; i--) {
        const s = sparks[i];
        s.life -= dt * 1.4; if (s.life <= 0) { sparks.splice(i, 1); continue; }
        s.vy += 160 * dt; s.vx *= 0.97; s.x += s.vx * dt; s.y += s.vy * dt;
        ctx.globalAlpha = s.life; ctx.fillStyle = 'hsl(' + s.hue + ',100%,72%)';
        star(s.x, s.y, s.s * (0.6 + s.life) + Math.sin(t * 20 + i) * 0.4);
      }
      ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
    }

    const onTap = e => { if (e.isPrimary !== false) burst(e.clientX, e.clientY); };
    const onWheel = e => { push = Math.max(-120, Math.min(120, push - e.deltaY * 0.25)); };
    let ty = 0;
    const onTouchStart = e => { ty = e.touches[0].clientY; };
    const onTouchMove = e => { const y = e.touches[0].clientY; push = Math.max(-120, Math.min(120, push + (y - ty) * 0.6)); ty = y; };
    const onVis = () => { cancelAnimationFrame(raf); if (!document.hidden) { last = performance.now(); raf = requestAnimationFrame(frame); } };

    resize();
    raf = requestAnimationFrame(frame);
    addEventListener('resize', resize);
    addEventListener('pointerdown', onTap, { passive: true });
    addEventListener('wheel', onWheel, { passive: true });
    addEventListener('touchstart', onTouchStart, { passive: true });
    addEventListener('touchmove', onTouchMove, { passive: true });
    document.addEventListener('visibilitychange', onVis);
    return () => {
      cancelAnimationFrame(raf);
      removeEventListener('resize', resize); removeEventListener('pointerdown', onTap); removeEventListener('wheel', onWheel);
      removeEventListener('touchstart', onTouchStart); removeEventListener('touchmove', onTouchMove);
      document.removeEventListener('visibilitychange', onVis);
      if (document.fonts) document.fonts.removeEventListener('loadingdone', onFonts);
    };
  }, []);

  return (
    <>
      <div id="magic-light" aria-hidden="true" />
      <canvas id="magic" ref={canvasRef} aria-hidden="true" />
    </>
  );
}
