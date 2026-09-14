import test from 'node:test';
import assert from 'node:assert/strict';

import { citationAt, superscriptCitationIndexes } from './citationText.js';

function text(text, { left = 0, top = 100, width = 6, height = 10 } = {}) {
  return [...text].map((letter, offset) => ({
    text: letter,
    box: {
      left: left + offset * width,
      right: left + (offset + 1) * width,
      top,
      bottom: top + height,
      width,
      height,
    },
  }));
}

function classified(characters, citations) {
  return characters.map((character) => ({
    ...character,
    citation: citationAt(character.box, citations),
  }));
}

test('keeps an inline author-year citation flush with the prose', () => {
  const before = text('to it ', { left: 0 });
  const citationText = text('[Cuni 2010]', { left: 36 });
  const after = text('. The bridge', { left: 102 });
  const citations = [{ left: 36, right: 102, top: 100, bottom: 110 }];

  assert.deepEqual(
    [...superscriptCitationIndexes(classified([...before, ...citationText, ...after], citations), citations)],
    [],
  );
});

test('keeps an inline citation that wraps onto the following line', () => {
  const firstLine = [
    ...text('separately ', { left: 0 }),
    ...text('[Hillerström', { left: 66 }),
  ];
  const secondLine = [
    ...text('et al. 2017]', { left: 0, top: 114 }),
    ...text(' and did not change.', { left: 78, top: 114 }),
  ];
  const citations = [{ left: 0, right: 138, top: 100, bottom: 124 }];

  assert.deepEqual(
    [...superscriptCitationIndexes(classified([...firstLine, ...secondLine], citations), citations)],
    [],
  );
});

test('omits a smaller citation raised above the body-text baseline', () => {
  const before = text('result', { left: 0 });
  const citationText = text('12', { left: 38, top: 96, width: 4, height: 6 });
  const after = text(' follows', { left: 48 });
  const citations = [{ left: 37, right: 47, top: 95, bottom: 103 }];

  assert.deepEqual(
    [...superscriptCitationIndexes(classified([...before, ...citationText, ...after], citations), citations)],
    [0],
  );
});

test('omits a full-size citation when its baseline is clearly raised', () => {
  const before = text('result', { left: 0 });
  const citationText = text('[2]', { left: 38, top: 96, width: 5, height: 10 });
  const after = text(' follows', { left: 55 });
  const citations = [{ left: 37, right: 54, top: 95, bottom: 107 }];

  assert.deepEqual(
    [...superscriptCitationIndexes(classified([...before, ...citationText, ...after], citations), citations)],
    [0],
  );
});

test('keeps a citation when surrounding text does not prove it is superscript', () => {
  const citationText = text('12', { left: 38, top: 96, width: 4, height: 6 });
  const citations = [{ left: 37, right: 47, top: 95, bottom: 103 }];

  assert.deepEqual(
    [...superscriptCitationIndexes(classified(citationText, citations), citations)],
    [],
  );
});
