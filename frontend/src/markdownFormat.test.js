import test from 'node:test';
import assert from 'node:assert/strict';
import { linkSelection, plainWords, prefixLines, wrapSelection } from '../../shared/markdownFormat.js';

test('a mark wraps the selection, and comes off when pressed again', () => {
  const bold = wrapSelection({ text: 'the gain halves', start: 4, end: 8 }, '**');
  assert.deepEqual(bold, { text: 'the **gain** halves', start: 6, end: 10 });
  assert.deepEqual(wrapSelection(bold, '**'), { text: 'the gain halves', start: 4, end: 8 });
  assert.deepEqual(wrapSelection({ text: 'the **gain** halves', start: 4, end: 12 }, '**'), { text: 'the gain halves', start: 4, end: 8 });
});

test('with nothing selected a mark goes around a word to write over', () => {
  assert.deepEqual(wrapSelection({ text: 'so ', start: 3, end: 3 }, '`', 'code'), { text: 'so `code`', start: 4, end: 8 });
});

test('a list mark starts every line the selection touches, and comes off again', () => {
  const text = 'first\nsecond\nthird';
  const list = prefixLines({ text, start: 2, end: 9 }, 'bullet');
  assert.deepEqual(list, { text: '- first\n- second\nthird', start: 0, end: 16 });
  assert.equal(prefixLines(list, 'bullet').text, text);
  assert.equal(prefixLines({ text, start: 0, end: text.length }, 'number').text, '1. first\n2. second\n3. third');
  // One kind of line turns into another rather than stacking.
  assert.equal(prefixLines({ text: '- first', start: 0, end: 7 }, 'quote').text, '> first');
});

test('a link takes the selection as its words, or as its address when it is one', () => {
  assert.deepEqual(linkSelection({ text: 'see the paper', start: 8, end: 13 }), { text: 'see the [paper](https://)', start: 16, end: 24 });
  assert.deepEqual(linkSelection({ text: 'https://papol.io', start: 0, end: 16 }), { text: '[link](https://papol.io)', start: 1, end: 5 });
});

test('a title is the words with their marks off', () => {
  assert.equal(plainWords('Split a **poster session**? See [the call](https://x.test/a_b).\n\n- one\n- *two*\n> `three` ~~four~~'), 'Split a poster session? See the call. one two three four');
  assert.equal(plainWords('snake_case_name and 2 * 3 * 4'), 'snake_case_name and 2 * 3 * 4');
});
