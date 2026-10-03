/* A few storybook butterflies drifting over the words: plain SVG and CSS
   animation (wings flap, each one follows its own looping path), no clicks
   caught, off for reduced motion. Colours come from the forest palette. */
const FLIGHT = [
  { path: 'a', top: '18%', left: '8%', dur: '26s', delay: '0s', c1: '#ffd977', c2: '#ff9f7a', size: 50 },
  { path: 'b', top: '62%', left: '70%', dur: '31s', delay: '-6s', c1: '#a8f0c6', c2: '#5ec4a0', size: 42 },
  { path: 'c', top: '35%', left: '40%', dur: '23s', delay: '-11s', c1: '#b9e3ff', c2: '#8c9cff', size: 46 },
  { path: 'a', top: '75%', left: '22%', dur: '29s', delay: '-17s', c1: '#ffb3d9', c2: '#ff86b4', size: 40 },
  { path: 'b', top: '12%', left: '62%', dur: '34s', delay: '-3s', c1: '#ffcf8a', c2: '#ffa94d', size: 38 },
  { path: 'c', top: '50%', left: '86%', dur: '27s', delay: '-20s', c1: '#d6b8ff', c2: '#a98bff', size: 42 },
];

function Butterfly() {
  return (
    <svg viewBox="-20 -16 40 32" aria-hidden="true" focusable="false">
      <g className="wing wing-l">
        <path className="w1" d="M-1 -2 C-6 -16 -19 -15 -18 -6 C-17 0 -9 1 -1 0 Z" />
        <path className="w2" d="M-1 1 C-8 2 -15 7 -12 12 C-9 16 -3 10 -1 3 Z" />
        <circle className="spot" cx="-11" cy="-7" r="2.2" />
      </g>
      <g className="wing wing-r">
        <path className="w1" d="M1 -2 C6 -16 19 -15 18 -6 C17 0 9 1 1 0 Z" />
        <path className="w2" d="M1 1 C8 2 15 7 12 12 C9 16 3 10 1 3 Z" />
        <circle className="spot" cx="11" cy="-7" r="2.2" />
      </g>
      <path className="body" d="M0 -6 C1.3 -6 1.3 9 0 11 C-1.3 9 -1.3 -6 0 -6 Z" />
      <path className="feelers" d="M-0.5 -6 C-2 -10 -4 -12 -5 -12 M0.5 -6 C2 -10 4 -12 5 -12" />
    </svg>
  );
}

export default function Butterflies() {
  return (
    <div className="butterflies" aria-hidden="true">
      {FLIGHT.map((f, n) => (
        <span key={n} className={'bfly bfly-' + f.path} style={{ top: f.top, left: f.left, '--dur': f.dur, '--delay': f.delay, '--c1': f.c1, '--c2': f.c2, '--s': f.size + 'px' }}>
          <span className="bfly-bob"><Butterfly /></span>
        </span>
      ))}
    </div>
  );
}
