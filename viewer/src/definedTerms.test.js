import assert from 'node:assert/strict';
import test from 'node:test';

import { definableTerm, definitionsIn, findTerms } from './definedTerms.js';

const term = (text) => ({ term: text });
const found = (text, ...terms) => findTerms(text, terms.map(term)).map((f) => text.slice(f.index, f.index + f.length));

test('a selection is a term without the punctuation at its ends, and a passage is none', () => {
  assert.equal(definableTerm('  well-typed\n term, '), 'well-typed term');
  assert.equal(definableTerm('(redex)'), 'redex');
  assert.equal(definableTerm('f(x).'), 'f(x)');
  assert.equal(definableTerm('(a redex,'), 'a redex');
  assert.equal(definableTerm('β-reduction'), 'β-reduction');
  assert.equal(definableTerm(' — '), null);
  assert.equal(definableTerm('one two three four five six seven eight nine'), null);
  assert.equal(definableTerm('x'.repeat(121)), null);
});

test('a term is found whatever its case and spacing, as whole words, with its plural', () => {
  assert.deepEqual(found('A Redex is reduced; redexes abound, and a  redex\nis one.', 'redex'), ['Redex', 'redexes', 'redex']);
  assert.deepEqual(found('Predexes and redexing are not it.', 'redex'), []);
  assert.deepEqual(found('a well-typed   term, and well-typed terms', 'well-typed term'), ['well-typed   term', 'well-typed terms']);
  // A line broken at the term's hyphen is joined (textLinks.js).
  assert.deepEqual(found('every well-typed term halts', 'well- typed term'), ['well-typed term']);
});

test('of two terms at one place the longer is meant', () => {
  const at = findTerms('a typing context and a context', [term('context'), term('typing context')]);
  assert.deepEqual(at.map((f) => f.term.term), ['typing context', 'context']);
});

test("a term of symbols is found as printed, and a pattern's own marks are only letters", () => {
  assert.deepEqual(found('where Γ ⊢ e holds, and f(x) too', 'Γ ⊢ e'), ['Γ ⊢ e']);
  assert.deepEqual(found('call f(x) and g(x)', 'f(x)'), ['f(x)']);
});

test('a symbol is found in the letters the paper sets it in, in its own case, with no plural', () => {
  const text = 'operator 𝜏𝑃 : 𝜏𝑃 (⊥) and 𝜏𝑝 and 𝜏𝑃𝑄 and τP too, never 𝜏𝑃s';
  assert.deepEqual(found(text, '𝜏𝑃'), ['𝜏𝑃', '𝜏𝑃', 'τP']);
  assert.deepEqual(found(text, 'τP'), ['𝜏𝑃', '𝜏𝑃', 'τP']);
  // A ligature in the paper is its letters.
  assert.deepEqual(found('a ﬁxpoint, and ﬁxpoints', 'fixpoint'), ['ﬁxpoint', 'ﬁxpoints']);
  assert.deepEqual(found('the prefix ﬁ', 'prefix'), ['prefix']);
});

test('the definitions a term can be pointed at: whole where the reading has it, in reading order', () => {
  const floats = [
    { uuid: 't2', kind: 'definition', label: 'Definition 2', page: 3, x: 0.1, y: 0.2, w: 0.3, h: 0.01 },
    { uuid: 't0', kind: 'theorem', label: 'Theorem 1', page: 1, x: 0.1, y: 0.2, w: 0.3, h: 0.01 },
    { uuid: 't1', kind: 'definition', label: 'Definition 1', title: 'Typing', page: 2, x: 0.1, y: 0.5, w: 0.3, h: 0.01, whole: { x: 0.1, y: 0.5, w: 0.8, h: 0.1 } },
  ];
  assert.deepEqual(definitionsIn(floats).map((d) => [d.label, d.title, d.box.h]), [['Definition 1', 'Typing', 0.1], ['Definition 2', null, 0.01]]);
});
