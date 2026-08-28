import test from 'node:test';
import assert from 'node:assert/strict';

import { selectionStrokes } from './selectionInk.js';

test('joins a raised citation to the selected body-text line around it', () => {
  const pageBoxes = [{
    page: 9,
    box: { left: 0, right: 600, top: 0, bottom: 800, width: 600, height: 800 },
  }];
  const rects = [
    { left: 40, right: 125, top: 400, bottom: 410, width: 85, height: 10 },
    { left: 125, right: 138, top: 396, bottom: 402, width: 13, height: 6 },
    { left: 138, right: 295, top: 400, bottom: 410, width: 157, height: 10 },
  ];

  const strokes = selectionStrokes(rects, pageBoxes);

  assert.equal(strokes.length, 1);
  assert.equal(strokes[0].page, 9);
  assert.ok(strokes[0].points[0].x < 0.08);
  assert.ok(strokes[0].points[1].x > 0.48);
});

test('does not join text across a wide column gap', () => {
  const pageBoxes = [{
    page: 1,
    box: { left: 0, right: 600, top: 0, bottom: 800, width: 600, height: 800 },
  }];
  const rects = [
    { left: 40, right: 290, top: 100, bottom: 110, width: 250, height: 10 },
    { left: 330, right: 560, top: 100, bottom: 110, width: 230, height: 10 },
  ];

  assert.equal(selectionStrokes(rects, pageBoxes).length, 2);
});
