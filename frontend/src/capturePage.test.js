import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

// The script the capture window runs before its picture is taken
// (desktop/src-tauri/src/capture.rs embeds this file). It decides which
// pictures a page is holding back, which is what left a profile's grid
// as grey squares in a card, and whether the page is showing anything
// at all yet, which is what had a shop's results photographed white.
const script = await readFile(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..', 'desktop/src-tauri/scripts/capture-page.js'),
  'utf8',
);

// A page, as much of one as the rules read: some pictures, some text,
// and whatever it draws for itself.
function pageWith(images, { text = '', drawings = [] } = {}) {
  const made = images.map((image) => ({
    complete: true, naturalWidth: 640, visibility: 'hidden', away: false,
    box: { width: 300, height: 300, top: 350, bottom: 650 }, style: {},
    ...image,
  }));
  const drawn = drawings.map((drawing) => ({
    box: { width: 300, height: 300, top: 350, bottom: 650 }, ...drawing,
  }));
  const context = {
    innerHeight: 800,
    performance: { now: () => 0 },
    setInterval: () => 0,
    clearInterval: () => {},
    getComputedStyle: (image) => ({ visibility: image.visibility }),
    document: {
      body: { innerText: text },
      images: made.map((image) => ({
        ...image,
        getBoundingClientRect: () => image.box,
        closest: () => (image.away ? {} : null),
        style: { setProperty: (name, value) => { image.style[name] = value; } },
      })),
      querySelectorAll: () => drawn.map((drawing) => ({ getBoundingClientRect: () => drawing.box })),
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

test('what the page counts as showing is what a picture of it would hold', () => {
  const { capture } = pageWith(
    [{ visibility: 'visible' }, { visibility: 'hidden' }, { complete: false, visibility: 'visible' }],
    { text: 'A shop full of things', drawings: [{}] },
  );
  const report = { ...capture.showing() }; // the page's own realm makes it
  // The hidden one counts: `reveal` brings it back before the picture.
  assert.deepEqual(report, { text: 21, pictures: 2, drawings: 1 });
});

test('a shell that has not handed over to the page yet is not worth a picture', () => {
  // A shop answering a stranger: complete, unchanging, and empty. Its
  // own text is in scripts, so the page shows none of it.
  const shell = pageWith([], { text: '' }).capture;
  assert.equal(shell.worth(shell.showing()), false);
  // A wall that draws a line and nothing else is no better.
  const wall = pageWith([], { text: 'Please enable JavaScript' }).capture;
  assert.equal(wall.worth(wall.showing()), false);
});

test('a page with something in it is worth a picture, by text, picture or drawing alone', () => {
  const worthy = [
    { what: 'its words', images: [], page: { text: 'x'.repeat(41) } },
    { what: 'one picture', images: [{ visibility: 'visible' }], page: { text: '' } },
    { what: 'one drawing', images: [], page: { text: '', drawings: [{}] } },
  ];
  for (const { what, images, page } of worthy) {
    const { capture } = pageWith(images, page);
    assert.equal(capture.worth(capture.showing()), true, what);
  }
});
