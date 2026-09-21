import test from 'node:test';
import assert from 'node:assert/strict';
import { anchorKeyAction, isEditingTarget } from './anchorKeys.js';

const page = { tagName: 'DIV' };
const held = { selected: true };

test('Delete and Backspace take away the anchor in hand', () => {
  assert.equal(anchorKeyAction({ key: 'Delete', target: page }, held), 'delete');
  assert.equal(anchorKeyAction({ key: 'Backspace', target: page }, held), 'delete');
});

test('Escape puts the anchor down without deleting it', () => {
  assert.equal(anchorKeyAction({ key: 'Escape', target: page }, held), 'deselect');
});

test('nothing happens while no anchor is in hand, so Backspace stays the browser\'s', () => {
  assert.equal(anchorKeyAction({ key: 'Backspace', target: page }, { selected: false }), null);
  assert.equal(anchorKeyAction({ key: 'Delete', target: page }, { selected: false }), null);
  assert.equal(anchorKeyAction({ key: 'Escape', target: page }, { selected: false }), null);
});

test('typing in the card, or any field, is typing', () => {
  for (const tagName of ['INPUT', 'TEXTAREA', 'SELECT']) {
    assert.equal(anchorKeyAction({ key: 'Backspace', target: { tagName } }, held), null);
    assert.equal(anchorKeyAction({ key: 'Delete', target: { tagName } }, held), null);
    assert.equal(anchorKeyAction({ key: 'Escape', target: { tagName } }, held), null);
  }
  const editable = { tagName: 'DIV', isContentEditable: true };
  assert.equal(anchorKeyAction({ key: 'Backspace', target: editable }, held), null);
});

test('a modified key is somebody else\'s shortcut', () => {
  assert.equal(anchorKeyAction({ key: 'Backspace', metaKey: true, target: page }, held), null);
  assert.equal(anchorKeyAction({ key: 'Delete', ctrlKey: true, target: page }, held), null);
  assert.equal(anchorKeyAction({ key: 'Escape', altKey: true, target: page }, held), null);
});

test('a shared reading can be put down but not deleted from', () => {
  const shared = { selected: true, readOnly: true };
  assert.equal(anchorKeyAction({ key: 'Delete', target: page }, shared), null);
  assert.equal(anchorKeyAction({ key: 'Backspace', target: page }, shared), null);
  assert.equal(anchorKeyAction({ key: 'Escape', target: page }, shared), 'deselect');
});

test('other keys are left to the rest of the viewer', () => {
  assert.equal(anchorKeyAction({ key: 'z', target: page }, held), null);
  assert.equal(anchorKeyAction({ key: 'd', target: page }, held), null);
});

test('knows a field from the page', () => {
  assert.equal(isEditingTarget({ tagName: 'INPUT' }), true);
  assert.equal(isEditingTarget({ tagName: 'TEXTAREA' }), true);
  assert.equal(isEditingTarget({ tagName: 'SELECT' }), true);
  assert.equal(isEditingTarget({ tagName: 'P', isContentEditable: true }), true);
  assert.equal(isEditingTarget({ tagName: 'BUTTON' }), false);
  assert.equal(isEditingTarget(null), false);
});
