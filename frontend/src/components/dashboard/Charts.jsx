import { useState } from 'react';
/* inline SVG charts, theme-aware (colours are CSS variables of the dashboard) */

/* shadcn "Overview" bar chart: rounded bars, dashed grid, muted tick labels, hover titles */
export function BarChart({ series, labels, color = 'var(--primary)', prefix = '', h, small, empty = 'Nothing counted in this period yet.' }) {
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
    <div className="viz-plot">
      <svg className={'chart' + (small ? ' sm' : '')} viewBox={`0 0 ${W} ${H}`}>
        {grid}
        {series.map(bar)}
        {labels.map((l, i) => (i % step === 0 || i === n - 1 ? <text key={'l' + i} x={(PL + i * slot + slot / 2).toFixed(1)} y={H - 8} fontSize="11" textAnchor="middle" fill="var(--muted-foreground)">{l.length > 5 ? l.slice(5) : l}</text> : null))}
      </svg>
      {series.some(v => v > 0) ? null : <p className="viz-empty">{empty}</p>}
    </div>
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

/* ---------- more charts (staff dashboards) ----------
   Colours come from --viz-1..4 (a checked colour-blind-safe set, with dark steps of its own) and
   --viz-other for "everything else". Every chart says so in words when it has nothing to show,
   so an empty shop still gets a tidy picture instead of a broken one. */
export const VIZ = ['var(--viz-1)', 'var(--viz-2)', 'var(--viz-3)', 'var(--viz-4)'];
const sum = list => list.reduce((n, v) => n + (Number(v) || 0), 0);
const num = v => Number(v || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const short = l => (l && l.length > 5 && /^\d{4}-/.test(l) ? l.slice(5) : l);
/* a clean top for the y-axis: four whole-number steps (0, 5, 10, 15, 20 ...) */
function niceMax(v) {
  const raw = Math.max(1, v / 4), p = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].map(f => f * p).find(s => s >= raw && (s >= 1 ? Number.isInteger(s) : true)) || 10 * p;
  return step * 4;
}
const compact = v => (v >= 1e5 ? Math.round(v / 1e3) + 'K' : v >= 1e3 ? (Math.round(v / 100) / 10) + 'K' : String(Math.round(v * 100) / 100));

/* a small line under a KPI number: the last days, with a dot on today */
export function Sparkline({ values, color = 'var(--viz-1)', label }) {
  const v = (values || []).map(x => Number(x) || 0);
  if (v.length < 2) return null;
  const W = 120, H = 28, max = Math.max(1, ...v), step = W / (v.length - 1);
  const pts = v.map((y, i) => [i * step, H - 3 - y / max * (H - 6)]);
  const line = pts.map(([x, y], i) => (i ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1)).join('');
  const [lx, ly] = pts[pts.length - 1];
  return (
    <div className="spark" role="img" aria-label={(label || 'Trend') + ': ' + v.join(', ')}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
        <path d={line + `L${W} ${H}L0 ${H}z`} fill={color} opacity="0.1" />
        <path d={line} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      </svg>
      <i style={{ left: lx / W * 100 + '%', top: ly / H * 100 + '%', background: color }} />
    </div>
  );
}

/* lines over time (one to three series in the same unit), with a crosshair and a tooltip */
export function LineChart({ series, labels, prefix = '', h = 240, empty = 'Nothing counted in this period yet.' }) {
  const [hover, setHover] = useState(null);
  const n = labels.length;
  if (!n) return <p className="cart-empty">{empty}</p>;
  const W = 640, H = h, PL = 44, PR = 12, PT = 12, PB = 28, plotW = W - PL - PR, plotH = H - PT - PB, base = H - PB;
  const all = series.flatMap(s => s.values.map(v => Number(v) || 0));
  const none = !all.some(v => v > 0);
  const max = niceMax(Math.max(0, ...all));
  const x = i => PL + (n === 1 ? plotW / 2 : i / (n - 1) * plotW), y = v => base - (Number(v) || 0) / max * plotH;
  const step = Math.ceil(n / 7), slot = plotW / Math.max(1, n - 1);
  const pathOf = vals => vals.map((v, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1)).join('');
  return (
    <div className="viz">
      {series.length > 1 ? <Legend items={series.map((s, i) => [s.name, s.color || VIZ[i], sum(s.values)])} line /> : null}
      <div className="viz-plot" onMouseLeave={() => setHover(null)}>
        <svg className="chart line" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={series.map(s => s.name + ' ' + num(sum(s.values))).join(', ')}>
          {[0, 0.25, 0.5, 0.75, 1].map(f => <g key={f}><line x1={PL} x2={W - PR} y1={base - f * plotH} y2={base - f * plotH} stroke="var(--border)" /><text x={PL - 8} y={base - f * plotH} dy="4" fontSize="11" textAnchor="end" fill="var(--muted-foreground)">{prefix + compact(max * f)}</text></g>)}
          {series.map((s, si) => <g key={s.name}>
            {si === 0 && !none ? <path d={pathOf(s.values) + `L${x(n - 1)} ${base}L${x(0)} ${base}z`} fill={s.color || VIZ[si]} opacity="0.1" /> : null}
            <path d={pathOf(s.values)} fill="none" stroke={none ? 'var(--border)' : s.color || VIZ[si]} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
          </g>)}
          {hover != null ? <line x1={x(hover)} x2={x(hover)} y1={PT} y2={base} stroke="var(--muted-foreground)" strokeOpacity="0.5" /> : null}
          {hover != null && !none ? series.map((s, si) => <circle key={s.name} cx={x(hover)} cy={y(s.values[hover])} r="4.5" fill={s.color || VIZ[si]} stroke="var(--card)" strokeWidth="2" />) : null}
          {labels.map((l, i) => (i % step === 0 || (i === n - 1 && (n - 1) % step > step / 2) ? <text key={'l' + i} x={x(i)} y={H - 8} fontSize="11" textAnchor={i === 0 && n > 1 ? 'start' : i === n - 1 && n > 1 ? 'end' : 'middle'} fill="var(--muted-foreground)">{short(l)}</text> : null))}
          {labels.map((l, i) => <rect key={'h' + i} x={x(i) - slot / 2} y={PT} width={slot} height={plotH} fill="transparent" onMouseEnter={() => setHover(i)} onTouchStart={() => setHover(i)} />)}
        </svg>
        {none ? <p className="viz-empty">{empty}</p> : null}
        {hover != null ? (
          <div className="viz-tip" style={{ left: (x(hover) / W * 100) + '%' }}>
            <b>{labels[hover]}</b>
            {series.map((s, si) => <span key={s.name}><i style={{ background: s.color || VIZ[si] }} />{s.name}<em>{prefix + num(s.values[hover])}</em></span>)}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/* the key under a chart: a swatch, the name and its number */
export function Legend({ items, line }) {
  return (
    <ul className={'viz-legend' + (line ? ' line' : '')}>
      {items.map(([l, c, v]) => <li key={l}><i style={{ background: c }} /><span>{l}</span>{v != null ? <b>{typeof v === 'number' ? num(v) : v}</b> : null}</li>)}
    </ul>
  );
}

/* parts of one whole: [label, value] rows, the four biggest coloured and the rest as "Other" */
function slices(parts) {
  const rows = parts.map(([l, v, c]) => [l, Number(v) || 0, c]).filter(([, v]) => v > 0);
  if (rows.some(r => r[2])) return rows;
  rows.sort((a, b) => b[1] - a[1]);
  const top = rows.slice(0, rows.length > 5 ? 4 : 5).map((r, i) => [r[0], r[1], i < 4 ? VIZ[i] : 'var(--viz-other)']);
  const rest = sum(rows.slice(top.length).map(r => r[1]));
  return rest ? top.concat([['Other', rest, 'var(--viz-other)']]) : top;
}

/* a ring with the total in the middle and a key beside it */
export function Donut({ parts, center, sub, empty = 'Nothing to show yet.', format = num }) {
  const [hover, setHover] = useState(null);
  const rows = slices(parts);
  const total = sum(rows.map(r => r[1]));
  const R = 52, C = 2 * Math.PI * R, gap = rows.length > 1 ? 2 : 0;
  let at = 0;
  const shown = hover != null ? rows[hover] : null;
  return (
    <div className="donut">
      <svg viewBox="0 0 140 140" role="img" aria-label={rows.length ? rows.map(([l, v]) => l + ' ' + format(v)).join(', ') : empty}>
        <circle cx="70" cy="70" r={R} fill="none" stroke="var(--muted)" strokeWidth="16" />
        {rows.map(([l, v, c], i) => {
          const len = v / total * C, seg = <circle key={l} cx="70" cy="70" r={R} fill="none" stroke={c} strokeWidth={hover === i ? 20 : 16}
            strokeDasharray={`${Math.max(0.5, len - gap)} ${C}`} strokeDashoffset={-at} transform="rotate(-90 70 70)"
            onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} style={{ transition: 'stroke-width .15s' }}><title>{l + ': ' + format(v) + ' (' + Math.round(v / total * 100) + '%)'}</title></circle>;
          at += len; return seg;
        })}
        <text x="70" y="68" textAnchor="middle" fontSize="20" fontWeight="600" fill="var(--foreground)">{shown ? format(shown[1]) : center != null ? center : format(total)}</text>
        <text x="70" y="86" textAnchor="middle" fontSize="10" fill="var(--muted-foreground)">{shown ? Math.round(shown[1] / total * 100) + '% ' + shown[0].toLowerCase().slice(0, 16) : total ? sub || 'in all' : 'none yet'}</text>
      </svg>
      {rows.length ? <ul className="viz-legend col">{rows.map(([l, v, c], i) => <li key={l} className={hover === i ? 'on' : ''} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}><i style={{ background: c }} /><span>{l}</span><b>{format(v)}</b><small>{Math.round(v / total * 100)}%</small></li>)}</ul>
        : <p className="cart-empty">{empty}</p>}
    </div>
  );
}

/* one bar split into parts (sent / failed / waiting ...), with a key */
export function SplitBar({ parts, empty = 'Nothing yet.', format = num }) {
  const rows = parts.map(([l, v, c], i) => [l, Number(v) || 0, c || VIZ[i]]);
  const total = sum(rows.map(r => r[1]));
  return (
    <div className="viz">
      <div className={'split' + (total ? '' : ' none')} role="img" aria-label={total ? rows.map(([l, v]) => l + ' ' + format(v)).join(', ') : empty}>
        {total ? rows.filter(r => r[1] > 0).map(([l, v, c]) => <i key={l} style={{ flexGrow: v, background: c }} title={l + ': ' + format(v) + ' (' + Math.round(v / total * 100) + '%)'} />) : <span>{empty}</span>}
      </div>
      <Legend items={rows.map(([l, v, c]) => [l, c, format(v)])} />
    </div>
  );
}

/* a ranked list: label, a bar as long as its share of the biggest, and the number */
export function RankBars({ rows, color = 'var(--viz-1)', format = num, empty = 'Nothing yet.', limit = 8 }) {
  const list = (rows || []).map(([l, v, note]) => [l, Number(v) || 0, note]).sort((a, b) => b[1] - a[1]).slice(0, limit);
  if (!list.length || !list.some(r => r[1] > 0)) return <p className="cart-empty">{empty}</p>;
  const max = Math.max(1, ...list.map(r => r[1]));
  return (
    <ul className="rank">
      {list.map(([l, v, note], i) => (
        <li key={l + i} title={l + ': ' + format(v)}>
          <span className="rank-l">{l}{note ? <small>{note}</small> : null}</span>
          <span className="rank-t"><i style={{ width: Math.max(1.5, v / max * 100) + '%', background: color }} /></span>
          <b>{format(v)}</b>
        </li>
      ))}
    </ul>
  );
}

/* how full something is: "92 of 115 sheets have a PDF" */
export function Meter({ value, max, label, tone }) {
  const v = Number(value) || 0, m = Number(max) || 0, p = m ? Math.min(100, v / m * 100) : 0;
  const t = tone || (!m ? 'none' : p >= 100 ? 'ok' : p >= 60 ? 'mid' : 'low');
  return (
    <div className={'meter ' + t}>
      <div className="meter-top"><span>{label}</span><b>{m ? Math.round(p) + '%' : 'None yet'}</b></div>
      <div className="meter-t" role="progressbar" aria-valuemin={0} aria-valuemax={m || 1} aria-valuenow={v} aria-label={label}><i style={{ width: p + '%' }} /></div>
      <small>{num(v)} of {num(m)}</small>
    </div>
  );
}

/* columns that can go below zero (profit and loss): above the line in --ok, below in --bad */
export function PosNegBars({ series, labels, prefix = '', h = 240, empty = 'Nothing yet.', posLabel = 'Profit', negLabel = 'Loss' }) {
  const [hover, setHover] = useState(null);
  const n = series.length;
  if (!n) return <p className="cart-empty">{empty}</p>;
  const v = series.map(x => Number(x) || 0);
  const W = 640, H = h, PL = 52, PR = 8, PT = 12, PB = 28, plotW = W - PL - PR, plotH = H - PT - PB;
  const top = niceMax(Math.max(0, ...v)), bottom = Math.min(0, ...v) < 0 ? niceMax(-Math.min(...v)) : 0;
  const span = top + bottom, y = val => PT + (top - val) / span * plotH, zero = y(0);
  const slot = plotW / n, bw = Math.min(24, slot * 0.6), r = Math.min(4, bw / 2), step = Math.ceil(n / 7);
  const ticks = [top, top / 2, 0].concat(bottom ? [-bottom / 2, -bottom] : []);
  const none = !v.some(x => x !== 0);
  return (
    <div className="viz">
      <Legend items={[[posLabel, 'var(--ok)'], [negLabel, 'var(--bad)']]} />
      <div className="viz-plot" onMouseLeave={() => setHover(null)}>
        <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={labels.map((l, i) => l + ' ' + prefix + num(v[i])).join(', ')}>
          {ticks.map(t => <g key={t}><line x1={PL} x2={W - PR} y1={y(t)} y2={y(t)} stroke="var(--border)" strokeWidth={t === 0 ? 1.5 : 1} /><text x={PL - 8} y={y(t)} dy="4" fontSize="11" textAnchor="end" fill="var(--muted-foreground)">{(t < 0 ? '−' : '') + prefix + compact(Math.abs(t))}</text></g>)}
          {v.map((val, i) => {
            if (!val) return null;
            const x = PL + i * slot + (slot - bw) / 2, hh = Math.max(2, Math.abs(val) / span * plotH), up = val > 0;
            const d = up
              ? `M${x} ${zero}v-${(hh - r).toFixed(1)}a${r} ${r} 0 0 1 ${r} -${r}h${(bw - 2 * r).toFixed(1)}a${r} ${r} 0 0 1 ${r} ${r}v${(hh - r).toFixed(1)}z`
              : `M${x} ${zero}v${(hh - r).toFixed(1)}a${r} ${r} 0 0 0 ${r} ${r}h${(bw - 2 * r).toFixed(1)}a${r} ${r} 0 0 0 ${r} -${r}v-${(hh - r).toFixed(1)}z`;
            return <path key={i} d={d} fill={up ? 'var(--ok)' : 'var(--bad)'} opacity={hover == null || hover === i ? 1 : 0.5} />;
          })}
          {labels.map((l, i) => (i % step === 0 || (i === n - 1 && (n - 1) % step > step / 2) ? <text key={'l' + i} x={PL + i * slot + slot / 2} y={H - 8} fontSize="11" textAnchor="middle" fill="var(--muted-foreground)">{l}</text> : null))}
          {labels.map((l, i) => <rect key={'h' + i} x={PL + i * slot} y={PT} width={slot} height={plotH} fill="transparent" onMouseEnter={() => setHover(i)} onTouchStart={() => setHover(i)} />)}
        </svg>
        {none ? <p className="viz-empty">{empty}</p> : null}
        {hover != null ? <div className="viz-tip" style={{ left: ((PL + hover * slot + slot / 2) / W * 100) + '%' }}><b>{labels[hover]}</b><span><i style={{ background: v[hover] < 0 ? 'var(--bad)' : 'var(--ok)' }} />{v[hover] < 0 ? negLabel : posLabel}<em>{(v[hover] < 0 ? '−' : '') + prefix + num(Math.abs(v[hover]))}</em></span></div> : null}
      </div>
    </div>
  );
}
