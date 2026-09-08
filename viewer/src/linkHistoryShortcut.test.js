import test from 'node:test';
import assert from 'node:assert/strict';
import { linkHistoryDirection } from './linkHistoryShortcut.js';

test('uses the physical bracket keys when the reported character changes', () => {
  assert.equal(linkHistoryDirection({ code: 'BracketLeft', key: 'Dead' }), 'back');
  assert.equal(linkHistoryDirection({ code: 'BracketRight', key: 'Unidentified' }), 'forward');
});

test('retains character fallback for synthetic and older keyboard events', () => {
  assert.equal(linkHistoryDirection({ key: '[' }), 'back');
  assert.equal(linkHistoryDirection({ key: ']' }), 'forward');
});

test('does not claim modified bracket shortcuts', () => {
  assert.equal(linkHistoryDirection({ code: 'BracketLeft', key: '{', shiftKey: true }), null);
  assert.equal(linkHistoryDirection({ code: 'BracketRight', key: ']', ctrlKey: true }), null);
});
