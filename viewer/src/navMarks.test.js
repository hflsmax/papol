import assert from 'node:assert/strict';
import test from 'node:test';

import { NAV_KINDS, NAV_NAMES, NAV_SHOWN, floatMarks } from './navMarks.js';

const floats = [
  { uuid: 't1', kind: 'proof', label: 'Proof', page: 2, y: 0.5 },
  { uuid: 'f0', kind: 'figure', label: '1', page: 1, y: 0.25, h: 0.5 },
  { uuid: 'b0', kind: 'box', label: '1', page: 3, y: 0 },
  { uuid: 'l0', kind: 'listing', label: '2', page: 3, y: 0.5 },
  { uuid: 't0', kind: 'theorem', label: 'Proposition 3', page: 2, y: 0.25 },
  { uuid: 's0', kind: 'section', label: '2', page: 2, y: 0 },
  { uuid: 'n0', kind: 'footnote', label: '1', page: 2, y: 0.9 },
];

test('every kind the bar can mark has a name in the gear', () => {
  for (const kind of NAV_KINDS) assert.ok(NAV_NAMES[kind], kind);
  for (const kind of NAV_SHOWN) assert.ok(NAV_KINDS.includes(kind), kind);
});

test('marks the kinds asked for, at their middles, named as the paper names them', () => {
  assert.deepEqual(floatMarks(floats, ['figure', 'algorithm', 'theorem'], 3).map(({ kind, name, at }) => [kind, name, at]), [
    ['figure', 'Figure 1', 0.5], // the middle of its box
    ['theorem', 'Proposition 3', 1.25],
    ['figure', 'Box 1', 2],
    ['algorithm', 'Listing 2', 2.5],
  ]);
  // Sections and footnotes are never marked from the analysis.
  assert.deepEqual(floatMarks(floats, NAV_KINDS).map((mark) => mark.id), ['f0', 't0', 't1', 'b0', 'l0']);
  assert.deepEqual(floatMarks(floats, []), []);
});
