import test from 'node:test';
import assert from 'node:assert/strict';
import {
  bridgeState, fetchPdfFrom, fetchedPdfBytes, fromParam, isPdfBytes, pdfNameFromUrl, rememberFetchedPdf,
} from './fetchedPdf.js';

const PDF = new TextEncoder().encode('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n');
const HTML = new TextEncoder().encode('<!doctype html><title>Sign in</title>');

test('?from= opens only web addresses', () => {
  assert.equal(fromParam('?from=https%3A%2F%2Farxiv.org%2Fpdf%2F1706.03762'), 'https://arxiv.org/pdf/1706.03762');
  assert.equal(fromParam('?from=javascript%3Aalert(1)'), null);
  assert.equal(fromParam('?from=file%3A%2F%2F%2Fetc%2Fpasswd'), null);
  assert.equal(fromParam('?from=not%20a%20url'), null);
  assert.equal(fromParam('?pdf=abc'), null);
});

test('a fetched PDF is named by its file, or its host', () => {
  assert.equal(pdfNameFromUrl('https://example.org/papers/liquid_types.pdf'), 'liquid_types.pdf');
  assert.equal(pdfNameFromUrl('https://arxiv.org/pdf/1706.03762v7'), '1706.03762v7.pdf');
  assert.equal(pdfNameFromUrl('https://example.org/'), 'example.org.pdf');
});

test('only bytes that start like a PDF are a PDF', () => {
  assert.equal(isPdfBytes(PDF), true);
  assert.equal(isPdfBytes(new Uint8Array([0xef, 0xbb, 0xbf, ...PDF])), true);
  assert.equal(isPdfBytes(HTML), false);
  assert.equal(isPdfBytes(new Uint8Array()), false);
});

const respond = (bytes, init = {}) => async () => new Response(bytes, { status: 200, ...init });

test('without the extension, the viewer asks the host', async () => {
  const bytes = await fetchPdfFrom('https://example.org/a.pdf', { win: null, doc: null, fetchImpl: respond(PDF) });
  assert.deepEqual(bytes, PDF);
});

test('a page served in place of the PDF is refused', async () => {
  await assert.rejects(
    fetchPdfFrom('https://example.org/a.pdf', { win: null, doc: null, fetchImpl: respond(HTML) }),
    /did not answer with a PDF/,
  );
});

test('a host that refuses the request is explained', async () => {
  const refusing = async () => { throw new TypeError('Failed to fetch'); };
  await assert.rejects(
    fetchPdfFrom('https://example.org/a.pdf', { win: null, doc: null, fetchImpl: refusing }),
    /does not let Papol fetch/,
  );
});

// A window and document standing in for a page the extension's bridge is on.
function bridgedPage(answer) {
  const listeners = new Set();
  const attributes = { 'data-papol-extension': 'ready' };
  const win = {
    location: { origin: 'https://papol.io' },
    setTimeout,
    addEventListener: (type, fn) => listeners.add(fn),
    removeEventListener: (type, fn) => listeners.delete(fn),
    postMessage(message) {
      if (message.source !== 'papol-viewer') return;
      for (const reply of answer(message)) {
        queueMicrotask(() => {
          for (const fn of [...listeners]) fn({ origin: 'https://papol.io', data: { source: 'papol-extension', id: message.id, ...reply } });
        });
      }
    },
  };
  const doc = { documentElement: { getAttribute: (name) => attributes[name] ?? null } };
  return { win, doc };
}

test('with the extension, the bytes come through it, with progress', async () => {
  const asked = [];
  const { win, doc } = bridgedPage((message) => {
    asked.push(message.url);
    return [{ type: 'progress', loaded: 10, total: PDF.length }, { type: 'pdf', bytes: PDF.slice().buffer }];
  });
  const progress = [];
  const bytes = await fetchPdfFrom('https://example.org/a.pdf', { win, doc, onProgress: (p) => progress.push(p) });
  assert.deepEqual(asked, ['https://example.org/a.pdf']);
  assert.deepEqual(bytes, PDF);
  assert.deepEqual(progress, [{ loaded: 10, total: PDF.length }]);
});

test("the extension's refusal is the reader's error", async () => {
  const { win, doc } = bridgedPage(() => [{ type: 'error', error: 'The site answered with error 403.', status: 403 }]);
  await assert.rejects(fetchPdfFrom('https://example.org/a.pdf', { win, doc }), /error 403/);
});

test('a bridge still starting is waited for, then passed over', async () => {
  const doc = { documentElement: { getAttribute: () => 'pending' } };
  assert.equal(bridgeState(doc), 'pending');
  const bytes = await fetchPdfFrom('https://example.org/a.pdf', {
    win: { setTimeout }, doc, bridgeStartMs: 60, fetchImpl: respond(PDF),
  });
  assert.deepEqual(bytes, PDF);
});

test('pdf.js is handed a copy, so the upload still has the bytes', () => {
  rememberFetchedPdf('a'.repeat(64), PDF);
  const first = fetchedPdfBytes('a'.repeat(64));
  first.fill(0);
  assert.deepEqual(fetchedPdfBytes('a'.repeat(64)), PDF);
  assert.throws(() => fetchedPdfBytes('b'.repeat(64)), /no longer open/);
});
