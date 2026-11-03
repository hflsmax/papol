import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanExcerptText, wordsIn } from './excerptText.js';

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

test('a word broken across lines at a hyphen is one word again', () => {
  assert.equal(cleanExcerptText('the evalua-\ntion of an un-\nlikely ex-\npression'), 'the evaluation of an unlikely expression');
  assert.equal(cleanExcerptText('a soft­\nhyphen and a typographic‐\nhyphen alike'), 'a softhyphen and a typographichyphen alike');
});

test('a compound written with a hyphen keeps it when it breaks at the line', () => {
  assert.equal(cleanExcerptText('a type-\ndirected, flow-\nsensitive and higher-\norder analysis'),
    'a type-directed, flow-sensitive and higher-order analysis');
  assert.equal(cleanExcerptText('self-\nevident and well-\nknown'), 'self-evident and well-known');
  assert.equal(cleanExcerptText('state-of-the-\nart'), 'state-of-the-art');
  // A prefix the typesetter split off is not a compound's first half.
  assert.equal(cleanExcerptText('dis-\norder and un-\nlike'), 'disorder and unlike');
});

test('a capital or a digit after the hyphen keeps it, with no space', () => {
  assert.equal(cleanExcerptText('Hindley-\nMilner inference on x86-\n64'), 'Hindley-Milner inference on x86-64');
});

test('the paper\'s own spelling settles a hyphen at a line\'s end', () => {
  const knownWords = wordsIn('A type-safe language. The sublanguage is small. A represen-');
  assert.ok(knownWords.has('type-safe'));
  assert.ok(knownWords.has('sublanguage'));
  assert.ok(!knownWords.has('represen'));
  assert.equal(cleanExcerptText('call-\nby-value, type-\nsafe, sub-\nlanguage, co-\nrecursive',
    { knownWords: new Set([...knownWords, 'co-recursive']) }),
  'call-by-value, type-safe, sublanguage, co-recursive');
  // Without the paper's word, "co-" is a prefix like any other.
  assert.equal(cleanExcerptText('co-\nrecursive'), 'corecursive');
});

test('a dash at a line\'s end joins the next word without a space', () => {
  assert.equal(cleanExcerptText('sound—\nand complete; pages 3–\n9'), 'sound—and complete; pages 3–9');
  assert.equal(cleanExcerptText('sound —\nand complete'), 'sound — and complete');
});

test('lines are joined with one space, whatever the layer\'s spacing', () => {
  assert.equal(cleanExcerptText('  first line  \n   second line ,\nthird.\n\n\n\nNext.'), 'first line second line, third.\n\nNext.');
});

test('two halves the paper writes as words of their own are a compound', () => {
  const knownWords = wordsIn('Each sequence is aligned. The representation of a word. Something else.');
  assert.equal(cleanExcerptText('sequence-\naligned RNNs; a represen-\ntation; some-\nthing', { knownWords }),
    'sequence-aligned RNNs; a representation; something');
});
