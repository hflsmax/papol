import test from 'node:test';
import assert from 'node:assert/strict';
import { downloadPdf } from './pdfDownload.js';

const respond = (chunks, headers = {}, status = 200) => async () => new Response(
  new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(new Uint8Array(chunk));
      controller.close();
    },
  }),
  { status, headers },
);

test('reads the whole file, and reports each chunk against the size the server gave', async () => {
  const heard = [];
  const bytes = await downloadPdf('https://files.example/a.pdf', {
    fetchImpl: respond([[1, 2], [3, 4, 5]], { 'content-length': '5' }),
    onProgress: (progress) => heard.push(progress),
  });
  assert.deepEqual([...bytes], [1, 2, 3, 4, 5]);
  assert.deepEqual(heard, [
    { loaded: 0, total: 5 }, { loaded: 2, total: 5 }, { loaded: 5, total: 5 },
  ]);
});

test('a compressed body has no total to measure against', async () => {
  const heard = [];
  await downloadPdf('https://files.example/a.pdf', {
    fetchImpl: respond([[1]], { 'content-length': '40', 'content-encoding': 'gzip' }),
    onProgress: (progress) => heard.push(progress),
  });
  assert.equal(heard.at(-1).total, 0);
});

test('a refusal is an error, not a PDF', async () => {
  await assert.rejects(
    downloadPdf('https://files.example/a.pdf', { fetchImpl: respond([], {}, 404) }),
    /error 404/,
  );
});
