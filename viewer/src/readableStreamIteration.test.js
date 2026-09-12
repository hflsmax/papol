import test from 'node:test';
import assert from 'node:assert/strict';
import { installReadableStreamIteration } from './readableStreamIteration.js';

// Node's own ReadableStream can already be iterated, so each test hands the
// polyfill a stream class that, like WebKit's before Safari 26, cannot.
function webkitLikeStreamClass() {
  return class Stream {
    constructor(source) {
      this.inner = new ReadableStream(source);
    }

    getReader() {
      return this.inner.getReader();
    }
  };
}

const counting = (log) => {
  let next = 0;
  return {
    pull(controller) { controller.enqueue(next++); },
    cancel() { log.cancelled = true; },
  };
};

test('installs only where the stream cannot already be iterated', () => {
  const Stream = webkitLikeStreamClass();
  assert.equal(installReadableStreamIteration(Stream), true);
  assert.equal(installReadableStreamIteration(Stream), false);
  assert.equal(installReadableStreamIteration(ReadableStream), false);
});

test('yields every chunk of a finished stream, then releases it', async () => {
  const Stream = webkitLikeStreamClass();
  installReadableStreamIteration(Stream);
  const stream = new Stream({
    start(controller) {
      ['a', 'b', 'c'].forEach((chunk) => controller.enqueue(chunk));
      controller.close();
    },
  });
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  assert.deepEqual(chunks, ['a', 'b', 'c']);
  assert.equal(stream.inner.locked, false);
});

test('leaving the loop early cancels the stream', async () => {
  const Stream = webkitLikeStreamClass();
  installReadableStreamIteration(Stream);
  const log = {};
  const stream = new Stream(counting(log));
  for await (const chunk of stream) if (chunk === 1) break;
  assert.equal(log.cancelled, true);
  assert.equal(stream.inner.locked, false);
});

test('preventCancel leaves the stream open for another reader', async () => {
  const Stream = webkitLikeStreamClass();
  installReadableStreamIteration(Stream);
  const log = {};
  const stream = new Stream(counting(log));
  for await (const chunk of stream.values({ preventCancel: true })) if (chunk === 1) break;
  assert.equal(log.cancelled, undefined);
  assert.equal(stream.inner.locked, false);
});
