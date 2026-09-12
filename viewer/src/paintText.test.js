import test from 'node:test';
import assert from 'node:assert/strict';

import { joinTextPieces, markBounds, markContains, textUnderMarks } from './paintText.js';
import { selectionStrokes } from './selectionInk.js';

const PAGE = { width: 600, height: 800 };
const pages = new Map([[1, PAGE], [2, PAGE]]);

// A line of text as a text layer would lay it out: one character box per
// letter, 6 units wide and 10 tall, starting at `left` on a line whose top is
// `top`. Spaces are characters too.
function line(text, { left = 40, top = 100, page = 1, span = 0 } = {}) {
  return [...text].map((letter, offset) => ({
    page,
    span,
    offset,
    text: letter,
    box: { left: left + offset * 6, right: left + offset * 6 + 6, top, bottom: top + 10, width: 6, height: 10 },
  }));
}

// A stroke as the page stores it: points as fractions of the page, y from
// the bottom, width as a fraction of the page width.
const stroke = (points, { width = 10 / 600, shape = 'flat', page = 1 } = {}) => ({
  page,
  shape,
  width,
  points: points.map(([x, y]) => ({ x: x / PAGE.width, y: 1 - y / PAGE.height })),
});

test('a flat mark covers what its swept nib covers, and nothing past it', () => {
  const band = stroke([[100, 105], [200, 105]]);
  assert.equal(markContains(band, { x: 150, y: 105 }, PAGE), true);
  assert.equal(markContains(band, { x: 150, y: 109.5 }, PAGE), true, 'within half the weight');
  assert.equal(markContains(band, { x: 150, y: 111 }, PAGE), false, 'past half the weight');
  assert.equal(markContains(band, { x: 201, y: 105 }, PAGE), true, 'within the nib beyond the last point');
  assert.equal(markContains(band, { x: 203, y: 105 }, PAGE), false);
});

test('a flat mark drawn on a slant sweeps its rectangle along the slant', () => {
  const slant = stroke([[100, 100], [200, 200]]);
  assert.equal(markContains(slant, { x: 150, y: 150 }, PAGE), true);
  assert.equal(markContains(slant, { x: 150, y: 158 }, PAGE), false, 'the nib is tall, not wide');
  assert.equal(markContains(slant, { x: 150, y: 154 }, PAGE), true);
});

test('a round mark is a capsule round its path, and a dot is a disc', () => {
  const round = stroke([[100, 100], [200, 100]], { shape: 'round', width: 20 / 600 });
  assert.equal(markContains(round, { x: 205, y: 100 }, PAGE), true, 'the round end reaches past the point');
  assert.equal(markContains(round, { x: 150, y: 111 }, PAGE), false);
  const dot = stroke([[300, 300]], { shape: 'round', width: 20 / 600 });
  assert.equal(markContains(dot, { x: 307, y: 307 }, PAGE), true);
  assert.equal(markContains(dot, { x: 308, y: 308 }, PAGE), false);
});

test('the bounds of a mark contain everything it paints', () => {
  const band = stroke([[100, 105], [200, 105]]);
  const bounds = markBounds(band, PAGE);
  const slack = 1e-9;
  assert.ok(bounds.left <= 99 && bounds.right >= 201, `across ${bounds.left}–${bounds.right}`);
  assert.ok(bounds.top <= 100 + slack && bounds.bottom >= 110 - slack, `down ${bounds.top}–${bounds.bottom}`);
});

test('painting a selection and asking the paint for its text gives the selection back', () => {
  const characters = [
    ...line('The indices of the key', { top: 100, span: 0 }),
    ...line('exchange are secret here', { top: 114, span: 1 }),
  ];
  // Selected from "of" (the thirteenth character) on the first line to
  // "exchange" on the second.
  const selected = [
    ...characters.filter((c) => c.span === 0 && c.offset >= 12),
    ...characters.filter((c) => c.span === 1 && c.offset <= 7),
  ];
  const bands = selectionStrokes(selected.map((c) => c.box), [{
    page: 1,
    box: { left: 0, top: 0, right: 600, bottom: 800, width: 600, height: 800 },
  }]).map((band) => ({ ...band, shape: 'flat' }));

  const { text } = textUnderMarks(characters, bands, pages);
  assert.equal(text, 'of the key\nexchange');
});

test('a freehand highlight takes the words whose middles it covers', () => {
  const characters = line('secret keys are exchanged');
  // Over "keys are" (characters 7–14), drawn a little loosely.
  const highlight = stroke([[40 + 7 * 6 + 1, 104], [40 + 15 * 6 - 1, 106]], { shape: 'round', width: 12 / 600 });
  assert.equal(textUnderMarks(characters, [highlight], pages).text, 'keys are');
});

test('a hand that clips the words either side takes only the words it was over', () => {
  const characters = line('necessary for the communicating');
  // From the last letter of "necessary" (8) to the second of "communicating" (19).
  const highlight = stroke([[40 + 8 * 6 + 3, 105], [40 + 19 * 6 + 3, 105]], { width: 10 / 600 });
  assert.equal(textUnderMarks(characters, [highlight], pages).text, 'for the');
});

test('a word mostly under the mark is taken whole', () => {
  const characters = line('of secure key');
  // From the second letter of "secure" (4) to the end of "key" (12).
  const highlight = stroke([[40 + 4 * 6, 105], [40 + 13 * 6, 105]], { width: 10 / 600 });
  assert.equal(textUnderMarks(characters, [highlight], pages).text, 'secure key');
});

test('an underline below the words is not over them, so it has no text', () => {
  const characters = line('secret keys');
  const underline = stroke([[40, 113], [40 + 11 * 6, 113]], { width: 2 / 600 });
  assert.equal(textUnderMarks(characters, [underline], pages).text, '');
});

test('a mark only takes text from its own page', () => {
  const characters = [...line('first page', { page: 1 }), ...line('second page', { page: 2, span: 0 })];
  const band = stroke([[40, 105], [40 + 10 * 6, 105]], { page: 2 });
  const { text, bands } = textUnderMarks(characters, [band], pages);
  // Three of the four letters of "page" are under it, so the word is taken.
  assert.equal(text, 'second page');
  assert.deepEqual([...new Set(bands.map((b) => b.page))], [2]);
});

test('pieces are joined with spaces, line breaks and page breaks as a reader would copy them', () => {
  const box = (left, top) => ({ left, right: left + 30, top, bottom: top + 10, height: 10 });
  assert.equal(joinTextPieces([
    { page: 1, text: 'one', box: box(0, 0) },
    { page: 1, text: 'two', box: box(40, 0) },
    { page: 1, text: 'three', box: box(0, 14) },
    { page: 1, text: 'four', box: box(0, 60) },
    { page: 2, text: 'five', box: box(0, 0) },
  ]), 'one two\nthree\n\nfour\n\nfive');
});
