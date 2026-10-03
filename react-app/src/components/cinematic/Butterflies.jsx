/* A few painted butterflies drifting slowly near the edges of the screen, behind
   the words and cards so they never get in the way. Watercolour cut-outs from
   Sumit's pictures (public/animals/), CSS animation only, no clicks caught,
   two on phones, off for reduced motion. */
const FLIGHT = [
  { img: 'butterfly-purple', path: 'a', top: '16%', left: '1.5%', dur: '38s', delay: '0s', w: 40 },
  { img: 'butterfly-blue', path: 'b', top: '64%', left: '94.5%', dur: '44s', delay: '-12s', w: 32 },
  { img: 'butterfly-yellow', path: 'b', top: '22%', left: '94.5%', dur: '41s', delay: '-25s', w: 36 },
  { img: 'butterfly-rose', path: 'a', top: '72%', left: '1.5%', dur: '47s', delay: '-18s', w: 32 },
];

export default function Butterflies() {
  return (
    <div className="butterflies" aria-hidden="true">
      {FLIGHT.map((f, n) => (
        <span key={f.img} className={'bfly bfly-' + f.path} style={{ top: f.top, left: f.left, '--dur': f.dur, '--delay': f.delay, '--s': f.w + 'px' }}>
          <span className="bfly-bob"><img src={'/animals/' + f.img + '.webp'} alt="" draggable="false" style={{ '--n': n }} /></span>
        </span>
      ))}
    </div>
  );
}
