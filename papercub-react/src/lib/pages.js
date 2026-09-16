/* The pages of a title, drawn in the browser. The demo has no PDF masters —
   with a backend, the protected viewer would stream pages from private
   storage instead (brief §3). Page count follows the catalogue's "NN pages". */
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
const SHAPES = [['circle', '●'], ['square', '■'], ['triangle', '▲'], ['star', '★'], ['heart', '♥'], ['diamond', '◆'], ['hexagon', '⬢'], ['moon', '☾']];
const COLOURS = ['Red', 'Blue', 'Yellow', 'Green', 'Orange', 'Purple', 'Pink', 'Brown', 'Grey', 'Black'];

export function pagesFor(product) {
  const n = parseInt(product.pages, 10) || 12;
  const page = (i, heading, glyph, task) => ({ n: i + 1, heading, glyph, task });
  switch (product.id) {
    case 'sh-alpha':
      return LETTERS.slice(0, n).map((L, i) => page(i, 'Letter ' + L, L + L.toLowerCase(), 'Trace the dotted letters, then write your own on the lines below.'));
    case 'sh-num':
      return Array.from({ length: n }, (_, i) => page(i, 'Number ' + (i + 1), String(i + 1), 'Count out loud, trace the number, then draw that many dots.'));
    case 'sh-col':
      return Array.from({ length: n }, (_, i) => {
        const [shape, glyph] = SHAPES[i % SHAPES.length];
        const colour = COLOURS[i % COLOURS.length];
        return page(i, colour + ' ' + shape, glyph, 'Trace the shape, colour it ' + colour.toLowerCase() + ', and find one like it at home.');
      });
    default:
      return Array.from({ length: n }, (_, i) => page(i, 'Week ' + (Math.floor(i / 6) + 1) + ' · Day ' + ((i % 6) + 1), product.mark, product.desc));
  }
}
