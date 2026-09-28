import test from 'node:test';
import assert from 'node:assert/strict';
import { hasTex, plainTitle, titleParts } from '../../shared/texTitle.js';

test('a title keeps its math apart from its words', () => {
  assert.deepEqual(titleParts('$$\\mathsf {CoreFun}$$: A Typed Functional Reversible Core Language'), [
    { tex: '\\mathsf {CoreFun}' },
    { text: ': A Typed Functional Reversible Core Language' },
  ]);
  assert.deepEqual(titleParts('The $\\lambda$-calculus in \\(O(n^2)\\)'), [
    { text: 'The ' }, { tex: '\\lambda' }, { text: '-calculus in ' }, { tex: 'O(n^2)' },
  ]);
});

test('dollars that are money are not math', () => {
  assert.equal(hasTex('From $5 to $10 a paper'), false);
  assert.equal(hasTex('A \\$5 paper and a $ sign'), false);
  assert.equal(plainTitle('A \\$5 paper'), 'A $5 paper');
  assert.equal(hasTex('Attention Is All You Need'), false);
});

test('plain text reads the math as its words', () => {
  assert.equal(plainTitle('$$\\mathsf {CoreFun}$$: A Typed Functional Reversible Core Language'), 'CoreFun: A Typed Functional Reversible Core Language');
  assert.equal(plainTitle('The $\\lambda$-calculus'), 'The λ-calculus');
  assert.equal(plainTitle('$\\mathcal{O}(n \\log n)$ sorting'), 'O(n log n) sorting');
  assert.equal(plainTitle(null), null);
});
