import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

// The script the capture window runs before its picture is taken
// (desktop/src-tauri/src/capture.rs embeds this file). It decides which
// pictures a page is holding back, which is what left a profile's grid
// as grey squares in a card.
const script = await readFile(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..', 'desktop/src-tauri/scripts/capture-page.js'),
  'utf8',
);

// A page of pictures, as much of one as the rule reads.
function pageWith(images) {
  const made = images.map((image) => ({
    complete: true, naturalWidth: 640, visibility: 'hidden', away: false,
    box: { width: 300, height: 300, top: 350, bottom: 650 }, style: {},
    ...image,
  }));
  const context = {
    innerHeight: 800,
    performance: { now: () => 0 },
    setInterval: () => 0,
    clearInterval: () => {},
    getComputedStyle: (image) => ({ visibility: image.visibility }),
    document: {
      images: made.map((image) => ({
        ...image,
        getBoundingClientRect: () => image.box,
        closest: () => (image.away ? {} : null),
        style: { setProperty: (name, value) => { image.style[name] = value; } },
      })),
    },
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(script, context);
  return { made, capture: context.papolCapture };
}

test('a picture the page has loaded and hidden behind its own grey square is shown', () => {
  const { made, capture } = pageWith([{}]);
  capture.reveal();
  assert.equal(made[0].style.visibility, 'visible');
});

test('a picture the page is right to hide is left alone', () => {
  const cases = [
    { what: 'still loading', image: { complete: false } },
    { what: 'a tracking pixel', image: { naturalWidth: 1, box: { width: 1, height: 1, top: 10, bottom: 11 } } },
    { what: 'a sliver', image: { box: { width: 8, height: 8, top: 10, bottom: 18 } } },
    { what: 'above the window', image: { box: { width: 300, height: 300, top: -900, bottom: -600 } } },
    { what: 'below the window', image: { box: { width: 300, height: 300, top: 1200, bottom: 1500 } } },
    { what: 'in a dialog the page put away', image: { away: true } },
    { what: 'already shown', image: { visibility: 'visible' } },
  ];
  for (const { what, image } of cases) {
    const { made, capture } = pageWith([image]);
    capture.reveal();
    assert.equal(made[0].style.visibility, undefined, what);
  }
});

test('the page says it is quiet by the name it gives itself, which the application reads', () => {
  const { capture } = pageWith([]);
  assert.equal(capture.QUIET_TITLE, 'papol-capture-quiet');
});
