import assert from 'node:assert/strict';
import test from 'node:test';

import { ruleName, sharedNames } from './sameNamedRules.js';

const rule = (uuid, label, page, y) => ({ uuid, kind: 'rule', label, page, x: 0.3, y, w: 0.5, h: 0.03 });

test('rules by one name are all shown, in reading order; a name only one rule goes by is not', () => {
  // Relax! (ICFP 25): (commute) for choreographies on p. 8, for the prophecy relation on p. 18.
  const floats = [rule('r50', 'commute', 18, 0.22), rule('r23', 'app', 8, 0.42), rule('r27', 'commute', 8, 0.57), { uuid: 'f1', kind: 'figure', label: 'commute', page: 3, y: 0.1 }];
  const shared = sharedNames(floats);
  assert.deepEqual([...shared.keys()], ['commute']);
  assert.deepEqual(shared.get('commute').map((f) => f.uuid), ['r27', 'r50']);
});

test('names compare as a reader reads them', () => {
  assert.equal(ruleName('(Commute)'), 'commute');
  assert.equal(ruleName('[T-App]'), 't-app');
  assert.equal(ruleName('𝑇-App'), 't-app');
});
