import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeSelection, selectionMode } from './selection.js';

test('plain selection replaces the current selection', () => {
  assert.equal(selectionMode({ shiftKey: false, metaKey: false, ctrlKey: false }), 'replace');
  assert.deepEqual(mergeSelection([1, 2], [3], 'replace'), [3]);
});

test('Shift and Cmd or Ctrl all toggle selection membership', () => {
  assert.equal(selectionMode({ shiftKey: true, metaKey: false, ctrlKey: false }), 'toggle');
  assert.equal(selectionMode({ shiftKey: false, metaKey: true, ctrlKey: false }), 'toggle');
  assert.equal(selectionMode({ shiftKey: false, metaKey: false, ctrlKey: true }), 'toggle');
  assert.deepEqual(mergeSelection([1, 2], [2, 3], 'toggle'), [1, 3]);
});
