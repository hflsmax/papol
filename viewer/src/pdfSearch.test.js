import test from 'node:test';
import assert from 'node:assert/strict';
import { findTextMatches, indexPdfDocument, indexTextItems } from './pdfSearch.js';

test('finds repeated text and maps it to rendered items', () => {
  const page = indexTextItems([{ str: 'Alpha beta' }, { str: 'alpha' }]);
  assert.deepEqual(findTextMatches(page, 'alpha'), [
    { parts: [{ spanIndex: 0, start: 0, end: 5 }] },
    { parts: [{ spanIndex: 1, start: 0, end: 5 }] },
  ]);
});

test('finds a phrase across adjacent PDF text items', () => {
  const page = indexTextItems([{ str: 'search' }, { str: 'works' }]);
  assert.deepEqual(findTextMatches(page, 'search works'), [
    { parts: [
      { spanIndex: 0, start: 0, end: 6 },
      { spanIndex: 1, start: 0, end: 5 },
    ] },
  ]);
});

test('empty PDF layout items do not shift rendered span indexes', () => {
  const page = indexTextItems([
    { str: 'Title' },
    { str: '', hasEOL: true },
    { str: 'Author' },
  ]);
  assert.deepEqual(findTextMatches(page, 'Author'), [
    { parts: [{ spanIndex: 1, start: 0, end: 6 }] },
  ]);
});

test('indexes document pages sequentially and yields between batches', async () => {
  const events = [];
  const doc = {
    numPages: 5,
    async getPage(pageNumber) {
      events.push(`page:${pageNumber}`);
      return {
        async getTextContent() {
          events.push(`text:${pageNumber}`);
          return { items: [{ str: `Page ${pageNumber}` }] };
        },
      };
    },
  };

  const pages = await indexPdfDocument(doc, {
    yieldEvery: 2,
    yieldToMain: async () => events.push('yield'),
  });

  assert.deepEqual(pages.map((page) => page.text), [
    'Page 1 ', 'Page 2 ', 'Page 3 ', 'Page 4 ', 'Page 5 ',
  ]);
  assert.deepEqual(events, [
    'page:1', 'text:1', 'page:2', 'text:2', 'yield',
    'page:3', 'text:3', 'page:4', 'text:4', 'yield',
    'page:5', 'text:5',
  ]);
});

test('stops document indexing when its consumer is cancelled', async () => {
  let cancelled = false;
  const requested = [];
  const doc = {
    numPages: 3,
    async getPage(pageNumber) {
      requested.push(pageNumber);
      return {
        async getTextContent() {
          if (pageNumber === 1) cancelled = true;
          return { items: [{ str: `Page ${pageNumber}` }] };
        },
      };
    },
  };

  assert.equal(await indexPdfDocument(doc, { cancelled: () => cancelled }), null);
  assert.deepEqual(requested, [1]);
});
