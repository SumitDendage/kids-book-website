'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useReducedMotion } from 'motion/react';
import { SHEETS_COPY, classById, isFree, money, subjectById } from '@/lib/content';

/* A ring of sheet covers with the camera standing in the middle — the
   "carousel gallery" idea, rebuilt with Three.js. The ring turns slowly,
   pauses when you hover a cover (the others go glassy and the title shows),
   drag to spin it, click to open the sheet. Covers are drawn on the fly
   (there are no cover images), so nothing is fetched. */
const VERT = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    vec3 p = position;
    p.z += sin(uv.x * 3.14159265) * -0.06;      /* a gentle curve, like a page around a drum */
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }`;
const FRAG = `
  precision highp float;
  uniform sampler2D tex; uniform float hover; uniform float radius;
  varying vec2 vUv;
  float box(vec2 uv, float r) { vec2 d = abs(uv - 0.5) - 0.5 + vec2(r); return length(max(d, 0.0)) - r; }
  void main() {
    vec4 c = texture2D(tex, vUv);
    float l = dot(c.rgb, vec3(0.299, 0.587, 0.114));
    vec3 glassy = mix(c.rgb, vec3(l), 0.7) * 0.55;
    vec3 rgb = mix(c.rgb, glassy, hover);
    float d = box(vUv, radius);
    float mask = smoothstep(0.0, fwidth(d), -d);
    if (mask < 0.5) discard;
    gl_FragColor = vec4(rgb, mix(1.0, 0.6, hover));
  }`;

function coverTexture(THREE, sheet) {
  const W = 512, H = 640, c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  const hue = subjectById(sheet.subject).hue;
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, `hsl(${hue} 70% 86%)`); g.addColorStop(0.6, `hsl(${hue} 60% 70%)`); g.addColorStop(1, `hsl(${hue + 40} 55% 76%)`);
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = `hsl(${hue} 40% 30% / 0.18)`; ctx.lineWidth = 2;
  for (let y = 150; y < H - 120; y += 34) { ctx.beginPath(); ctx.setLineDash([6, 8]); ctx.moveTo(50, y); ctx.lineTo(W - 50, y); ctx.stroke(); }
  ctx.setLineDash([]);
  ctx.fillStyle = `hsl(${hue} 40% 22% / 0.8)`;
  ctx.font = '700 22px system-ui, sans-serif'; ctx.textAlign = 'left';
  ctx.fillText((classById(sheet.cls).label + '  ·  ' + subjectById(sheet.subject).label).toUpperCase(), 40, 62);
  ctx.textAlign = 'center';
  ctx.font = '700 150px Georgia, serif'; ctx.fillStyle = `hsl(${hue} 40% 14%)`;
  ctx.fillText(sheet.glyph.length > 4 ? sheet.glyph.slice(0, 4) : sheet.glyph, W / 2, H / 2 + 40);
  ctx.font = '600 34px Georgia, serif';
  const words = sheet.title.split(' '); const lines = []; let line = '';
  words.forEach(w => { const t = (line + ' ' + w).trim(); if (ctx.measureText(t).width > W - 90) { lines.push(line); line = w; } else line = t; });
  lines.push(line);
  lines.slice(0, 2).forEach((l, i) => ctx.fillText(l, W / 2, H - 120 + i * 40));
  ctx.font = '700 24px system-ui, sans-serif';
  ctx.fillStyle = isFree(sheet) ? `hsl(${hue} 60% 20%)` : `hsl(${hue} 40% 26% / 0.8)`;
  ctx.fillText(isFree(sheet) ? 'FREE' : money(sheet.price), W / 2, H - 42);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export default function RingGallery({ sheets, onOpen }) {
  const mount = useRef(null);
  const router = useRouter();
  const reduce = useReducedMotion();
  const [label, setLabel] = useState('');
  const open = onOpen || (id => router.push('/sheets/' + id));

  useEffect(() => {
    const el = mount.current;
    let alive = true, cleanup = () => {};
    (async () => {
      const THREE = await import('three');
      if (!alive || !el) return;
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(70, el.clientWidth / el.clientHeight, 0.1, 100);
      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
      renderer.setSize(el.clientWidth, el.clientHeight);
      el.appendChild(renderer.domElement);
      const group = new THREE.Group();
      scene.add(group);
      const R = 4.2, n = sheets.length, planes = [];
      sheets.forEach((sheet, i) => {
        const a = (i / n) * Math.PI * 2;
        const mat = new THREE.ShaderMaterial({ uniforms: { tex: { value: coverTexture(THREE, sheet) }, hover: { value: 0 }, radius: { value: 0.06 } }, vertexShader: VERT, fragmentShader: FRAG, transparent: true, side: THREE.DoubleSide, depthWrite: false });
        const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1.35, 1.7, 12, 1), mat);
        mesh.position.set(Math.sin(a) * R, 0, Math.cos(a) * R);
        mesh.lookAt(0, 0, 0);
        mesh.userData = { sheet, target: 0 };
        group.add(mesh); planes.push(mesh);
      });
      const ray = new THREE.Raycaster(), mouse = new THREE.Vector2();
      let rotation = 0, targetRot = 0, hovered = null, paused = false, dragging = false, moved = false, lastX = 0, downX = 0;
      const speed = reduce ? 0 : 0.0025;
      const canvas = renderer.domElement;
      const pick = e => {
        const r = canvas.getBoundingClientRect();
        mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
        ray.setFromCamera(mouse, camera);
        const hit = ray.intersectObjects(planes)[0];
        return hit ? hit.object : null;
      };
      const onMove = e => {
        if (dragging) { const dx = e.clientX - lastX; lastX = e.clientX; targetRot += dx * 0.006; if (Math.abs(e.clientX - downX) > 6) moved = true; return; }
        const h = e.pointerType === 'touch' ? null : pick(e);
        if (h !== hovered) {
          hovered = h;
          planes.forEach(p => { p.userData.target = h && p !== h ? 1 : 0; });
          paused = !!h;
          setLabel(h ? h.userData.sheet.title : '');
          canvas.style.cursor = h ? 'pointer' : 'grab';
        }
      };
      const onLeave = () => { hovered = null; planes.forEach(p => { p.userData.target = 0; }); paused = false; setLabel(''); };
      const onDown = e => { dragging = true; moved = false; downX = lastX = e.clientX; canvas.setPointerCapture(e.pointerId); };
      const onUp = e => {
        dragging = false;
        try { canvas.releasePointerCapture(e.pointerId); } catch (_) { /* ignore */ }
        if (moved) return;
        const h = pick(e);
        if (h) open(h.userData.sheet.id);
      };
      canvas.addEventListener('pointermove', onMove);
      canvas.addEventListener('pointerleave', onLeave);
      canvas.addEventListener('pointerdown', onDown);
      canvas.addEventListener('pointerup', onUp);
      canvas.style.cursor = 'grab';
      canvas.style.touchAction = 'pan-y';
      const resize = () => { camera.aspect = el.clientWidth / el.clientHeight; camera.updateProjectionMatrix(); renderer.setSize(el.clientWidth, el.clientHeight); };
      addEventListener('resize', resize);
      let raf = 0, visible = true;
      const io = new IntersectionObserver(([en]) => { visible = en.isIntersecting; }, { threshold: 0 });
      io.observe(el);
      const tick = () => {
        raf = requestAnimationFrame(tick);
        if (!visible) return;
        if (!paused && !dragging) targetRot += speed;
        rotation += (targetRot - rotation) * 0.08;
        group.rotation.y = rotation;
        planes.forEach(p => { const u = p.material.uniforms.hover; u.value += (p.userData.target - u.value) * 0.12; });
        renderer.render(scene, camera);
      };
      tick();
      cleanup = () => {
        cancelAnimationFrame(raf); io.disconnect(); removeEventListener('resize', resize);
        canvas.removeEventListener('pointermove', onMove); canvas.removeEventListener('pointerleave', onLeave);
        canvas.removeEventListener('pointerdown', onDown); canvas.removeEventListener('pointerup', onUp);
        planes.forEach(p => { p.geometry.dispose(); p.material.uniforms.tex.value.dispose(); p.material.dispose(); });
        renderer.dispose();
        if (canvas.parentNode === el) el.removeChild(canvas);
      };
    })();
    return () => { alive = false; cleanup(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheets]);

  return (
    <div className="gallery-wrap" ref={mount} aria-label="Sheet gallery">
      <div className={'gallery-label' + (label ? ' on' : '')} aria-live="polite">{label}</div>
      <div className="gallery-note">{SHEETS_COPY.gallery}</div>
    </div>
  );
}
