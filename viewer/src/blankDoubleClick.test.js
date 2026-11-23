import test from 'node:test';
import assert from 'node:assert/strict';
import { doubleClickDropsAnchor, nearText, onBareGround } from './blankDoubleClick.js';

const bare = { tool: 'arrow', button: 0, pointerType: 'mouse', bare: true, selectedText: '', nearText: false, overReference: false };

test('a double-click with the arrow on bare paper drops an anchor', () => {
  assert.equal(doubleClickDropsAnchor(bare), true);
  assert.equal(doubleClickDropsAnchor({ ...bare, pointerType: 'pen' }), true);
  // What Chrome selects on a double-click between lines of a text layer.
  assert.equal(doubleClickDropsAnchor({ ...bare, selectedText: '\n' }), true);
  // No pointer seen before the click (a synthetic or keyboard-free path).
  assert.equal(doubleClickDropsAnchor({ ...bare, pointerType: undefined }), true);
});

test('every other double-click keeps what it meant', () => {
  for (const tool of ['brush', 'eraser', 'anchor', 'clipper', 'cow']) {
    assert.equal(doubleClickDropsAnchor({ ...bare, tool }), false, tool);
  }
  assert.equal(doubleClickDropsAnchor({ ...bare, button: 2 }), false);
  assert.equal(doubleClickDropsAnchor({ ...bare, pointerType: 'touch' }), false);
  assert.equal(doubleClickDropsAnchor({ ...bare, bare: false }), false);
  assert.equal(doubleClickDropsAnchor({ ...bare, selectedText: 'dominant' }), false);
  assert.equal(doubleClickDropsAnchor({ ...bare, nearText: true }), false);
  assert.equal(doubleClickDropsAnchor({ ...bare, overReference: true }), false);
});

// Just enough of an element for the test: classes, a tag, a parent.
function el(tag, className, parent = null) {
  const node = {
    tagName: tag,
    parent,
    classList: { contains: (name) => className.split(' ').includes(name) },
    closest: (selector) => {
      const name = selector.slice(1);
      for (let at = node; at; at = at.parent) if (at.classList.contains(name)) return at;
      return null;
    },
  };
  return node;
}
const holderOf = (...inside) => ({ contains: (node) => inside.includes(node) });

test('the page drawing and the text layer between words are bare ground', () => {
  const page = el('DIV', 'pdf-page');
  const drawing = el('DIV', 'page-canvas', page);
  const canvas = el('CANVAS', '', drawing);
  const layer = el('DIV', 'textLayer', page);
  const holder = holderOf(page, drawing, canvas, layer);
  assert.equal(onBareGround(canvas, holder), true);
  assert.equal(onBareGround(layer, holder), true);
  assert.equal(onBareGround(drawing, holder), true);
});

test('a word, a pin, a stroke or another page is not', () => {
  const page = el('DIV', 'pdf-page');
  const layer = el('DIV', 'textLayer', page);
  const word = el('SPAN', '', layer);
  const pin = el('BUTTON', 'pin', page);
  const grab = el('path', 'ink-grab', page);
  const elsewhere = el('DIV', 'textLayer');
  const holder = holderOf(page, layer, word, pin, grab);
  assert.equal(onBareGround(word, holder), false);
  assert.equal(onBareGround(pin, holder), false);
  assert.equal(onBareGround(grab, holder), false);
  assert.equal(onBareGround(elsewhere, holder), false);
  assert.equal(onBareGround(null, holder), false);
});

test('the gap between two lines is near text; a margin is not', () => {
  const line = (top) => ({ left: 100, right: 500, top, bottom: top + 12, width: 400, height: 12 });
  const lines = [line(100), line(116)];
  assert.equal(nearText(lines, 300, 106), true, 'on a line');
  assert.equal(nearText(lines, 300, 114), true, 'between two lines');
  assert.equal(nearText(lines, 300, 160), false, 'well below the paragraph');
  assert.equal(nearText(lines, 560, 106), false, 'in the margin beside it');
  assert.equal(nearText([{ left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 }], 0, 0), false, 'an empty span');
});
