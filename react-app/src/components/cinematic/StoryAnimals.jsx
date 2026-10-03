/* Storybook animals that live in the scene the whole way down the page:
   butterflies flutter over the words, parrots and little birds fly across,
   the fawns trot along the bottom, the fox jumps up in the corner and the
   bunny naps. Watercolour cut-outs from Sumit's pictures (public/animals/),
   CSS animation only, no clicks caught, off for reduced motion. */
const A = name => '/animals/' + name + '.webp';

/* fly across: dir 'lr' faces right and flies left to right, 'rl' the other way */
const FLYERS = [
  { img: 'parrot-1', dir: 'lr', top: '12%', w: 112, dur: '44s', delay: '-2s' },
  { img: 'parrot-2', dir: 'rl', top: '30%', w: 104, dur: '52s', delay: '-30s' },
  { img: 'bluebird-1', dir: 'lr', top: '56%', w: 62, dur: '38s', delay: '-14s' },
  { img: 'bluebird-2', dir: 'rl', top: '18%', w: 62, dur: '41s', delay: '-6s' },
  { img: 'bird-blue', dir: 'lr', top: '42%', w: 66, dur: '47s', delay: '-35s', small: true },
  { img: 'bird-green', dir: 'rl', top: '66%', w: 58, dur: '43s', delay: '-22s', small: true },
  { img: 'bird-orange', dir: 'lr', top: '7%', w: 50, dur: '36s', delay: '-25s', small: true },
];
/* butterflies loop over the words */
const BUTTERFLIES = [
  { img: 'butterfly-purple', path: 'a', top: '18%', left: '8%', dur: '26s', delay: '0s', w: 64 },
  { img: 'butterfly-blue', path: 'b', top: '62%', left: '70%', dur: '31s', delay: '-6s', w: 46 },
  { img: 'butterfly-yellow', path: 'c', top: '35%', left: '40%', dur: '23s', delay: '-11s', w: 58 },
  { img: 'butterfly-rose', path: 'a', top: '75%', left: '22%', dur: '29s', delay: '-17s', w: 50 },
  { img: 'butterfly-pink', path: 'b', top: '12%', left: '62%', dur: '34s', delay: '-3s', w: 40 },
  { img: 'butterfly-violet', path: 'c', top: '50%', left: '86%', dur: '27s', delay: '-20s', w: 48 },
];
/* trot along the bottom of the screen */
const WALKERS = [
  { img: 'fawn', dir: 'lr', h: 150, bottom: '26px', dur: '40s', delay: '-4s' },
  { img: 'fawn-pink', dir: 'rl', h: 128, bottom: '34px', dur: '46s', delay: '-27s', flip: true },
];

export default function StoryAnimals() {
  return (
    <div className="story-animals" aria-hidden="true">
      {FLYERS.map(f => (
        <span key={f.img} className={'an-fly an-' + f.dir + (f.small ? ' an-small' : '')} style={{ top: f.top, '--w': f.w + 'px', '--dur': f.dur, '--delay': f.delay }}>
          <span className="an-wave"><img src={A(f.img)} alt="" draggable="false" /></span>
        </span>
      ))}
      {WALKERS.map(f => (
        <span key={f.img} className={'an-walk an-' + f.dir} style={{ bottom: f.bottom, '--h': f.h + 'px', '--dur': f.dur, '--delay': f.delay }}>
          <span className="an-hop"><img className={f.flip ? 'an-flip' : ''} src={A(f.img)} alt="" draggable="false" /></span>
        </span>
      ))}
      <span className="an-fox"><img src={A('fox')} alt="" draggable="false" /></span>
      <span className="an-bunny"><img src={A('bunny')} alt="" draggable="false" /></span>
      <span className="an-perch an-perch-1 an-small"><img src={A('bird-purple')} alt="" draggable="false" /></span>
      <span className="an-perch an-perch-2 an-small"><img src={A('bird-blue-2')} alt="" draggable="false" /></span>
      <div className="butterflies">
        {BUTTERFLIES.map((f, n) => (
          <span key={f.img} className={'bfly bfly-' + f.path} style={{ top: f.top, left: f.left, '--dur': f.dur, '--delay': f.delay, '--s': f.w + 'px' }}>
            <span className="bfly-bob"><img src={A(f.img)} alt="" draggable="false" style={{ '--n': n }} /></span>
          </span>
        ))}
      </div>
    </div>
  );
}
