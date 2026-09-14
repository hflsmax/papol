import test from 'node:test';
import assert from 'node:assert/strict';
import { copySelectionSnapshot } from './selectionCopy.js';

function copyEvent(target = { tagName: 'DIV' }) {
  const writes = [];
  return {
    target,
    writes,
    prevented: false,
    clipboardData: { setData: (...args) => writes.push(args) },
    preventDefault() { this.prevented = true; },
  };
}

test('copies a snapshotted PDF selection when the native range is gone', () => {
  const event = copyEvent();
  assert.equal(copySelectionSnapshot(event, 'Selected paper text', { isCollapsed: true }), true);
  assert.deepEqual(event.writes, [['text/plain', 'Selected paper text']]);
  assert.equal(event.prevented, true);
});

test('leaves native text and form-field selections to WebKit', () => {
  const nativeEvent = copyEvent();
  assert.equal(copySelectionSnapshot(nativeEvent, 'old PDF text', { isCollapsed: false }), false);
  assert.deepEqual(nativeEvent.writes, []);

  const inputEvent = copyEvent({ tagName: 'TEXTAREA' });
  assert.equal(copySelectionSnapshot(inputEvent, 'old PDF text', { isCollapsed: true }), false);
  assert.deepEqual(inputEvent.writes, []);
});
