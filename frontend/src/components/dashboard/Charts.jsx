/* inline SVG charts, theme-aware (colours are CSS variables of the dashboard) */

/* shadcn "Overview" bar chart: rounded bars, dashed grid, muted tick labels, hover titles */
export function BarChart({ series, labels, color = 'var(--primary)', prefix = '', h, small }) {
  if (!series.length) return <p className="cart-empty">No data yet.</p>;
  const W = 640, H = h || 260, PL = 44, PR = 8, PT = 12, PB = 28, n = series.length, max = Math.max(1, ...series);
  const plotW = W - PL - PR, plotH = H - PT - PB, base = H - PB, slot = plotW / n, gap = Math.min(10, slot * 0.3), bw = slot - gap;
  let lastLabel = null;
  const grid = [0, 0.25, 0.5, 0.75, 1].map(f => {
    const yy = (base - f * plotH).toFixed(1), lab = Math.round(max * f), same = lab === lastLabel; lastLabel = lab;
    return <g key={f}><line x1={PL} x2={W - PR} y1={yy} y2={yy} stroke="var(--border)" strokeDasharray="3 3" />{same ? null : <text x={PL - 8} y={yy} dy="4" fontSize="11" textAnchor="end" fill="var(--muted-foreground)">{prefix + lab}</text>}</g>;
  });
  const step = Math.ceil(n / 7), r = Math.min(4, bw / 2);
  const bar = (v, i) => {
    const x = PL + i * slot + gap / 2, hh = Math.max(v > 0 ? 2 : 0, v / max * plotH);
    const d = hh <= r ? `M${x} ${base}h${bw}v-${hh}h-${bw}z` : `M${x} ${base}v-${(hh - r).toFixed(1)}a${r} ${r} 0 0 1 ${r} -${r}h${(bw - 2 * r).toFixed(1)}a${r} ${r} 0 0 1 ${r} ${r}v${(hh - r).toFixed(1)}z`;
    return <path key={i} className="bar" d={d} fill={color}><title>{labels[i] + ': ' + prefix + series[i]}</title></path>;
  };
  return (
    <svg className={'chart' + (small ? ' sm' : '')} viewBox={`0 0 ${W} ${H}`}>
      {grid}
      {series.map(bar)}
      {labels.map((l, i) => (i % step === 0 || i === n - 1 ? <text key={'l' + i} x={(PL + i * slot + slot / 2).toFixed(1)} y={H - 8} fontSize="11" textAnchor="middle" fill="var(--muted-foreground)">{l.length > 5 ? l.slice(5) : l}</text> : null))}
    </svg>
  );
}

/* visits → sign-ups → subscriptions */
export function Funnel({ steps }) {
  const max = Math.max(1, steps[0][1]);
  return (
    <div className="funnel">
      {steps.map(([l, v], i) => (
        <div key={l} className="funnel-row"><span>{l}</span><i style={{ width: Math.max(4, v / max * 100) + '%' }} /><b>{v}{i ? ' · ' + Math.round(v / Math.max(1, steps[i - 1][1]) * 100) + '%' : ''}</b></div>
      ))}
    </div>
  );
}
