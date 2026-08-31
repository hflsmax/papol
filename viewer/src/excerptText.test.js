import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanExcerptText } from './excerptText.js';

test('unwraps PDF line breaks while preserving paragraphs', () => {
  assert.equal(
    cleanExcerptText('A sentence wraps\nonto another line.\n\nA new paragraph.'),
    'A sentence wraps onto another line.\n\nA new paragraph.',
  );
});

test('repairs line-broken words without guessing what is a citation', () => {
  assert.equal(
    cleanExcerptText('The represen-\ntation uses Morph31 [31].'),
    'The representation uses Morph31 [31].',
  );
});

test('does not remove bracketed prose or authored inline hyphens', () => {
  assert.equal(
    cleanExcerptText('A state-of-the-art result [see appendix].'),
    'A state-of-the-art result [see appendix].',
  );
});
