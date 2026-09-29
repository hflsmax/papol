import test from 'node:test';
import assert from 'node:assert/strict';
import { ruleClipFrame } from './ruleClip.js';

const mention = { x: 0.3, y: 0.5, w: 0.05, h: 0.012 };

test('a rule clip lands under the mention, at the rule\'s printed size, left edges together', () => {
  const frame = ruleClipFrame(mention, { x: 0.55, y: 0.2, w: 0.3, h: 0.04 });
  assert.equal(frame.x, 0.3);
  assert.ok(frame.y > 0.512 && frame.y < 0.52);
  assert.equal(frame.w, 0.3);
  assert.equal(frame.h, 0.04);
});

test('a rule printed on a larger page keeps its size on the mention\'s page', () => {
  const frame = ruleClipFrame(mention, { x: 0, y: 0, w: 0.3, h: 0.04 }, { rule: { width: 800, height: 1000 }, mention: { width: 400, height: 500 } });
  assert.equal(frame.w, 0.6);
  assert.equal(frame.h, 0.08);
});

test('a wide rule stays on the page, and a mention at the foot gets its clip above the line', () => {
  const wide = ruleClipFrame({ ...mention, x: 0.8 }, { x: 0, y: 0, w: 0.5, h: 0.04 });
  assert.ok(wide.x + wide.w <= 0.98 + 1e-9);
  const low = ruleClipFrame({ ...mention, y: 0.97 }, { x: 0, y: 0, w: 0.3, h: 0.04 });
  assert.ok(low.y + low.h < 0.97);
});
