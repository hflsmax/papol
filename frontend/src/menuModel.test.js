import test from 'node:test';
import assert from 'node:assert/strict';

import { menuEntries, menuPosition, nextEnabled, submenuPosition } from '../../shared/menuModel.js';

const labels = (entries) => entries.map((entry) => (entry.separator ? '—' : entry.label));

test('a menu drops what is not there and never doubles a separator', () => {
  const entries = menuEntries([
    { separator: true },
    { label: 'Open' },
    false,
    null,
    { separator: true },
    { separator: true },
    { label: 'Move to', submenu: [false, { separator: true }] },
    { label: 'Delete' },
    { separator: true },
  ]);
  assert.deepEqual(labels(entries), ['Open', '—', 'Delete']);
});

test('a submenu is tidied the same way and kept when it has entries', () => {
  const [entry] = menuEntries([{ label: 'Move to', submenu: [{ label: 'Reading' }, { separator: true }] }]);
  assert.deepEqual(labels(entry.submenu), ['Reading']);
});

test('the arrow keys skip separators and disabled entries, and wrap round', () => {
  const entries = menuEntries([
    { label: 'Open' },
    { separator: true },
    { label: 'Paste', disabled: true },
    { label: 'Copy' },
    { label: 'Delete' },
  ]);
  assert.equal(nextEnabled(entries, -1, 1), 0, 'down from nothing is the first');
  assert.equal(nextEnabled(entries, -1, -1), 4, 'up from nothing is the last');
  assert.equal(nextEnabled(entries, 0, 1), 3, 'past the separator and the disabled entry');
  assert.equal(nextEnabled(entries, 4, 1), 0, 'round from the bottom');
  assert.equal(nextEnabled(entries, 0, -1), 4, 'round from the top');
  assert.equal(nextEnabled(menuEntries([{ label: 'Paste', disabled: true }]), -1, 1), -1);
});

test('a menu opens below-right of the pointer, and moves only as far as it must', () => {
  const viewport = { width: 1000, height: 800 };
  const size = { width: 200, height: 150 };
  assert.deepEqual(menuPosition({ x: 100, y: 100 }, size, viewport), { left: 100, top: 100 });
  assert.deepEqual(menuPosition({ x: 900, y: 100 }, size, viewport), { left: 700, top: 100 }, 'to the left at the right edge');
  assert.deepEqual(menuPosition({ x: 100, y: 750 }, size, viewport), { left: 100, top: 600 }, 'upward at the bottom');
  assert.deepEqual(menuPosition({ x: 100, y: 100 }, { width: 200, height: 780 }, viewport), { left: 100, top: 16 }, 'a tall menu is kept in the window');
});

test('a submenu opens beside its entry, on whichever side has room', () => {
  const viewport = { width: 1000, height: 800 };
  const size = { width: 180, height: 120 };
  assert.deepEqual(submenuPosition({ left: 300, right: 500, top: 200 }, size, viewport), { left: 498, top: 195 });
  assert.deepEqual(submenuPosition({ left: 700, right: 900, top: 200 }, size, viewport), { left: 522, top: 195 });
  assert.deepEqual(submenuPosition({ left: 300, right: 500, top: 760 }, size, viewport), { left: 498, top: 676 });
});
