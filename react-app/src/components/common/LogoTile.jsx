/* LOGO — the tree in a crescent, its leaves the symbols children learn */
const LEAVES = [[100, 52], [76, 58], [124, 58], [60, 76], [140, 76], [86, 72], [114, 72], [100, 84], [70, 100], [130, 100], [88, 94], [112, 94], [78, 116], [122, 116], [100, 108]];
const SYMBOLS = [[62, 62, '×'], [100, 46, '+'], [138, 60, 'B'], [50, 92, '−'], [150, 94, 'C'], [66, 118, 'A'], [134, 122, '÷']];

export function LogoMark() {
  return (
    <svg viewBox="0 0 200 200" aria-hidden="true">
      <g fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
        <path d="M 34 66 A 78 78 0 1 0 166 66" strokeWidth="15" />
        <path d="M100 172 C 100 150 98 136 96 124 M100 172 C 100 154 104 140 106 126 M84 172 C 90 166 96 165 100 172 C 104 165 110 166 116 172 M96 124 C 84 118 76 108 72 100 M106 126 C 118 118 126 108 130 100 M100 132 C 100 120 100 112 100 104" strokeWidth="6" />
      </g>
      {LEAVES.map(([x, y], i) => <ellipse key={i} cx={x} cy={y} rx="7" ry="4.2" fill="currentColor" transform={`rotate(${(i * 37) % 180} ${x} ${y})`} />)}
      {SYMBOLS.map(([x, y, t]) => (
        <g key={t}>
          <circle cx={x} cy={y} r="9.5" fill="currentColor" />
          <text x={x} y={y + 3.6} textAnchor="middle" fontSize="11" fontWeight="700" fontFamily="Georgia,serif" fill="var(--bg-tile, #0b1420)">{t}</text>
        </g>
      ))}
    </svg>
  );
}

/* the white (or glass) tile with the tree and the word LEARN / WITH WHY */
export default function LogoTile({ as: Tag = 'div', className = '', ...rest }) {
  return (
    <Tag className={'logo-tile' + (className ? ' ' + className : '')} {...rest}>
      <LogoMark /><b>LEARN</b><small>WITH WHY</small>
    </Tag>
  );
}
