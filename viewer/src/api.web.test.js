// What the viewer asks the service for, in a browser.
//
// A paper is stored under the whole of its digest and named in a URL by the
// first half of it (shared/paperName.js). The viewer holds the full digest —
// it was opened on those bytes — so every path it builds has to do the
// shortening, and a call that forgot spent its 404 on "Paper not found" while
// the PDF beside it loaded perfectly: ink and clips simply never arrived.
import test from 'node:test';
import assert from 'node:assert/strict';

const stored = new Map([['papol_token', 'token']]);
global.localStorage = {
  getItem: (key) => stored.get(key) ?? null,
  setItem: (key, value) => stored.set(key, String(value)),
  removeItem: (key) => stored.delete(key),
};
global.location = new URL('http://papol.test/viewer/');
global.window = {
  location: global.location,
  __PAPOL_ENV__: { runtime: 'web', surface: 'viewer' },
  addEventListener() {},
  dispatchEvent() {},
};
global.Event = class Event { constructor(type) { this.type = type; } };

const asked = [];
global.fetch = async (url, options = {}) => {
  asked.push({ url: String(url), method: options.method || 'GET' });
  return {
    ok: true,
    status: 200,
    json: async () => [],
  };
};

const { createAnnotation, listAnnotations } = await import('./api.js');

const PAPER = '5cf24221f8fa36824ddd1178cbfb5cf36d0dcfcf335c8de87826c4082b70cbf1';
const NAME = '5cf24221f8fa36824ddd1178cbfb5cf3';

// The client builds paths, not absolute addresses; the origin is the page's.
function paperSegmentOf(url) {
  return new URL(url, global.location).pathname.match(/\/papers\/([^/]+)\//)?.[1];
}

test('reading annotations names the paper the way the service answers to', async () => {
  asked.length = 0;
  await listAnnotations(PAPER, { kind: 'ink' });
  assert.equal(asked.length, 1);
  assert.equal(paperSegmentOf(asked[0].url), NAME);
  assert.match(asked[0].url, /\/annotations\?kind=ink$/);
});

test('writing an annotation names it the same way', async () => {
  asked.length = 0;
  await createAnnotation(PAPER, { kind: 'note', page: 1, content: 'Hello', body: {} });
  assert.equal(asked.length, 1);
  assert.equal(asked[0].method, 'POST');
  assert.equal(paperSegmentOf(asked[0].url), NAME);
});

test('the PDF is read from the address the service gives, else from the upload route', async () => {
  const { pdfHref, pdfLoadInput } = await import('./api.js');
  assert.equal(pdfHref({ file_path: `${PAPER}.pdf` }), `/uploads/${PAPER}.pdf`);
  assert.equal(pdfHref({ file_path: `${PAPER}.pdf`, file_url: `https://files.test/uploads/${PAPER}.pdf` }), `https://files.test/uploads/${PAPER}.pdf`);
  assert.equal(pdfHref({}), null);
  // pdf.js is handed the bucket's address and never Papol's redirect.
  assert.deepEqual(await pdfLoadInput({ file_path: `${PAPER}.pdf`, file_url: `https://files.test/uploads/${PAPER}.pdf` }), { url: `https://files.test/uploads/${PAPER}.pdf` });
});

test('a PDF is asked for by the whole of its digest, because it is its bytes', async () => {
  asked.length = 0;
  const { getPaperByPdf } = await import('./api.js');
  await getPaperByPdf(PAPER);
  assert.equal(asked.length, 1);
  assert.match(asked[0].url, new RegExp(`/api/viewer/${PAPER}$`));
});
