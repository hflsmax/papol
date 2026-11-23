import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createPdfFinder, firstResultFrom, itemLayout, itemTops, matchParts } from './pdfSearch.js';

test('lays items out as the find controller reads them', () => {
  // The controller's offsets leave line ends out; an empty item has no
  // span, so it does not count towards the span indexes.
  const layout = itemLayout([
    { str: 'Title', hasEOL: false },
    { str: '', hasEOL: true },
    { str: 'Author', hasEOL: true },
    { str: 'Body' },
  ]);
  assert.deepEqual(layout, [
    { start: 0, str: 'Title', spanIndex: 0 },
    { start: 5, str: 'Author', spanIndex: 1 },
    { start: 11, str: 'Body', spanIndex: 2 },
  ]);
});

test('a match across a line end covers each span it touches', () => {
  // "transduc-" + "tion": the match covers the hyphen too.
  const layout = itemLayout([{ str: 'the transduc-', hasEOL: true }, { str: 'tion model' }]);
  assert.deepEqual(matchParts(layout, 4, 13), [
    { spanIndex: 0, start: 4, end: 13 },
    { spanIndex: 1, start: 0, end: 4 },
  ]);
});

test('offsets inside a span count the text as the span shows it', () => {
  // The controller searches "ﬁ" as one character; the span says "fi".
  const normalize = (s) => s.replaceAll('ﬁ', 'fi');
  const layout = itemLayout([{ str: 'a ﬁne result' }]);
  // "result" starts at 6 in the raw text and at 7 in the span.
  assert.deepEqual(matchParts(layout, 6, 6, normalize), [
    { spanIndex: 0, start: 7, end: 13 },
  ]);
});

// pdf.js's viewer module expects a browser: a DOM to measure against at
// load, animation frames, and the core library as a global.
async function loadPdfjs() {
  const saved = { document: globalThis.document, raf: globalThis.requestAnimationFrame };
  globalThis.document = {
    ...saved.document,
    createElement: () => ({ style: {} }),
    documentElement: { style: {} },
    addEventListener() {},
  };
  globalThis.requestAnimationFrame ??= (callback) => setTimeout(callback, 0);
  globalThis.window ??= globalThis;
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  globalThis.pdfjsLib ??= pdfjs;
  const viewer = await import('pdfjs-dist/legacy/web/pdf_viewer.mjs');
  return { pdfjs, viewer };
}

test('finds words as a reader means them in a real paper', async () => {
  const { pdfjs, viewer } = await loadPdfjs();
  const data = new Uint8Array(await readFile(new URL(
    '../../frontend/scripts/fixtures/attention.pdf', import.meta.url,
  )));
  const task = pdfjs.getDocument({ data, verbosity: 0 });
  const doc = await task.promise;
  const finder = createPdfFinder(doc, {
    EventBus: viewer.EventBus,
    PDFFindController: viewer.PDFFindController,
    normalizeUnicode: pdfjs.normalizeUnicode,
  });
  const shown = async (pageIndex, { parts }) => {
    const page = await doc.getPage(pageIndex + 1);
    const spans = (await page.getTextContent()).items.filter((item) => item.str);
    return parts.map((part) => spans[part.spanIndex].str.slice(part.start, part.end)).join('|');
  };
  try {
    // Broken at the end of a line by a hyphen, on page 2 and on page 10.
    const allShown = async (pages, pageIndex) => Promise.all(
      pages[pageIndex].map((match) => shown(pageIndex, match)),
    );
    assert.ok((await allShown(await finder.find('transduction'), 1)).includes('transduc-|tion'));
    assert.ok((await allShown(await finder.find('surprisingly'), 9)).includes('sur-|prisingly'));
    // A subscript is its own text item, not a space: d_model is "dmodel".
    const dmodel = await finder.find('dmodel');
    assert.ok(dmodel.flat().length > 0);
    // Case does not matter, and the count is every occurrence.
    const attention = await finder.find('Attention');
    assert.ok(attention.flat().length > 50);
    assert.equal((await finder.find('no such phrase anywhere')).flat().length, 0);
    assert.equal(finder.warm, true);
  } finally {
    finder.destroy();
    await task.destroy();
  }
});

test('a newer search overtakes one still under way', async () => {
  const { pdfjs, viewer } = await loadPdfjs();
  const data = new Uint8Array(await readFile(new URL(
    '../../frontend/scripts/fixtures/attention.pdf', import.meta.url,
  )));
  const task = pdfjs.getDocument({ data, verbosity: 0 });
  const doc = await task.promise;
  const finder = createPdfFinder(doc, {
    EventBus: viewer.EventBus,
    PDFFindController: viewer.PDFFindController,
    normalizeUnicode: pdfjs.normalizeUnicode,
  });
  try {
    const first = finder.find('attention');
    const second = finder.find('encoder');
    assert.equal(await first, null);
    assert.ok((await second).flat().length > 0);
  } finally {
    finder.destroy();
    await task.destroy();
  }
});

test('places each span by its top, measured down the page', () => {
  // A 100pt page: a 10pt line on a baseline 80pt up has its top 10pt down.
  const tops = itemTops([
    { str: 'Title', transform: [1, 0, 0, 1, 0, 80], height: 10 },
    { str: '', transform: [1, 0, 0, 1, 0, 50], height: 10 },
    { str: 'Body', transform: [1, 0, 0, 1, 0, 30], height: 10 },
  ], [0, 0, 100, 100]);
  assert.deepEqual(tops, [0.1, 0.6]);
});

test('a search begins at the reader, not at the first page', () => {
  const results = [
    { page: 1, y: 0.5 },
    { page: 3, y: 0.2 },
    { page: 3, y: 0.7 },
    { page: 5, y: 0.1 },
  ];
  assert.equal(firstResultFrom(results, null), 0);
  // The middle of the view is halfway down page 3.
  assert.equal(firstResultFrom(results, { page: 3, y: 0.5 }), 2);
  // On a page with no result of its own, the next page's.
  assert.equal(firstResultFrom(results, { page: 4, y: 0.9 }), 3);
  // Past the last result, round to the first.
  assert.equal(firstResultFrom(results, { page: 5, y: 0.5 }), 0);
});
