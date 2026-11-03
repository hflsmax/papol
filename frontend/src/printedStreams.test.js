import test from 'node:test';
import assert from 'node:assert/strict';

// Safari's ReadableStream has no async iterator, and pdf.js's getTextContent
// iterates one, so the upload form read nothing off a PDF there and fell back
// to its file name. Loading the reader (shared/printed.js) must give the
// browser's stream the iterator before any page is read.
test('loading the PDF reader makes a Safari-like ReadableStream iterable', async () => {
  const native = globalThis.ReadableStream;
  class SafariStream {
    constructor(source) { this.inner = new native(source); }
    getReader() { return this.inner.getReader(); }
  }
  globalThis.ReadableStream = SafariStream;
  try {
    await import('../../shared/printed.js');
    const stream = new SafariStream({ start(controller) { controller.enqueue('page text'); controller.close(); } });
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    assert.deepEqual(chunks, ['page text']);
  } finally {
    globalThis.ReadableStream = native;
  }
});
