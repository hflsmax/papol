import test from 'node:test';
import assert from 'node:assert/strict';
import { homePath } from '../../shared/appUrls.js';

test('the home button leads to Papol itself, naming nothing', () => {
  // Not the nook the board sits in, and not the board: a home button that
  // points back at the thing just closed is a back button wearing a house.
  assert.equal(homePath(), '/');
});

test('a demo board goes home to the demo', () => {
  assert.equal(homePath({ demo: true }), '/demo');
});
