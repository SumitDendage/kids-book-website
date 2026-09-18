'use client';
import { motion } from 'motion/react';

/* The Learn With Why mark: an old tree inside a crescent, its leaves the
   symbols children learn — ×, +, −, ÷, A, B, C. Drawn as SVG so it scales,
   tints and can draw itself on (see Loader). */
const BADGES = [
  { x: 62, y: 62, t: '×' }, { x: 100, y: 46, t: '+' }, { x: 138, y: 60, t: 'B' },
  { x: 50, y: 92, t: '−' }, { x: 150, y: 94, t: 'C' }, { x: 66, y: 118, t: 'A' }, { x: 134, y: 122, t: '÷' },
];
const LEAVES = [
  [100, 52], [76, 58], [124, 58], [60, 76], [140, 76], [86, 72], [114, 72], [100, 84],
  [70, 100], [130, 100], [88, 94], [112, 94], [78, 116], [122, 116], [100, 108],
];

export function Mark({ className, draw = false, color = 'currentColor' }) {
  const stroke = { fill: 'none', stroke: color, strokeLinecap: 'round', strokeLinejoin: 'round' };
  const path = draw
    ? { initial: { pathLength: 0, opacity: 0 }, animate: { pathLength: 1, opacity: 1 }, transition: { duration: 1.6, ease: 'easeInOut' } }
    : {};
  const pop = i => (draw
    ? { initial: { scale: 0, opacity: 0 }, animate: { scale: 1, opacity: 1 }, transition: { delay: 1.1 + i * 0.06, type: 'spring', stiffness: 320, damping: 20 } }
    : {});
  return (
    <svg viewBox="0 0 200 200" className={className} aria-hidden="true" style={{ color }}>
      {/* crescent — thick at the bottom, open at the top */}
      <motion.path d="M 34 66 A 78 78 0 1 0 166 66" {...stroke} strokeWidth="15" {...path} />
      {/* trunk and roots */}
      <motion.path d="M100 172 C 100 150 98 136 96 124 M100 172 C 100 154 104 140 106 126 M84 172 C 90 166 96 165 100 172 C 104 165 110 166 116 172 M96 124 C 84 118 76 108 72 100 M106 126 C 118 118 126 108 130 100 M100 132 C 100 120 100 112 100 104" {...stroke} strokeWidth="6" {...path} />
      {/* leaves */}
      {LEAVES.map(([x, y], i) => (
        <motion.ellipse key={i} cx={x} cy={y} rx="7" ry="4.2" fill={color} transform={`rotate(${(i * 37) % 180} ${x} ${y})`} style={{ transformOrigin: `${x}px ${y}px` }} {...pop(i)} />
      ))}
      {/* symbol badges */}
      {BADGES.map((b, i) => (
        <motion.g key={b.t} style={{ transformOrigin: `${b.x}px ${b.y}px` }} {...pop(i + 6)}>
          <circle cx={b.x} cy={b.y} r="9.5" fill={color} />
          <text x={b.x} y={b.y + 3.6} textAnchor="middle" fontSize="11" fontWeight="700" fontFamily="Georgia, serif" fill="var(--bg, #0a1310)">{b.t}</text>
        </motion.g>
      ))}
    </svg>
  );
}

export default function Logo({ className, stacked = true, draw = false, color = 'currentColor' }) {
  return (
    <div className={'logo' + (className ? ' ' + className : '')} style={{ display: 'grid', justifyItems: 'center', gap: stacked ? 4 : 0, color }}>
      <Mark draw={draw} color={color} className="logo-mark" />
      {stacked && (
        <div style={{ textAlign: 'center', fontFamily: 'var(--font-display)', lineHeight: 1 }}>
          <div style={{ fontSize: '1.9em', fontWeight: 700, letterSpacing: '0.12em' }}>LEARN</div>
          <div style={{ fontSize: '0.78em', fontWeight: 600, letterSpacing: '0.42em', marginTop: 6, fontFamily: 'var(--font-body)' }}>WITH WHY</div>
        </div>
      )}
    </div>
  );
}
