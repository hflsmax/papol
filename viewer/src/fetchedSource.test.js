import assert from 'node:assert/strict';
import test from 'node:test';

const FROM = 'https://example.org/papers/liquid_types.pdf';
const HASH = 'c'.repeat(64);
const PDF = new TextEncoder().encode('%PDF-1.4\n%%EOF\n');

const values = new Map();
global.localStorage = {
  getItem: (key) => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, String(value)),
  removeItem: (key) => values.delete(key),
};
global.location = new URL(`http://127.0.0.1/viewer/?from=${encodeURIComponent(FROM)}`);
global.window = { location: global.location, addEventListener() {}, dispatchEvent() {} };
Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true, writable: true });

const { fetchedSource, nookViewerHref, resolveSource } = await import('./source.js');
const { showInNookTarget } = await import('./nookOffer.js');
const { fetchedPdfBytes } = await import('./fetchedPdf.js');

function source({ kept = null, signedIn = true, fetches = [] } = {}) {
  return fetchedSource(FROM, {
    fetchPdf: async (url, { onProgress } = {}) => {
      fetches.push(url);
      onProgress?.({ loaded: PDF.length, total: PDF.length });
      return PDF;
    },
    hash: async () => HASH,
    lookUpKept: async () => { if (kept === 'explode') throw new Error('403'); return kept; },
    add: async (given) => ({ sha256: given.sha256, added: given }),
    isSignedIn: () => signedIn,
  });
}

test('?from= opens the PDF at that address', () => {
  const resolved = resolveSource();
  assert.equal(resolved.fetchedFrom, FROM);
  assert.equal(resolved.openedFile, true);
  assert.equal(resolved.readOnly, true);
  assert.equal(resolved.annotationsRequireNook, true);
  assert.equal(resolved.requiresSignIn, false);
});

test('opening fetches once, names the paper by its file, and keeps the bytes for pdf.js', async () => {
  const fetches = [];
  const progress = [];
  const opened = source({ fetches });
  const { doc } = await opened.load({ onProgress: (p) => progress.push(p) });
  await opened.loadNookPaper();
  assert.deepEqual(fetches, [FROM]);
  assert.deepEqual(progress, [{ loaded: PDF.length, total: PDF.length }]);
  assert.deepEqual(doc, { title: 'liquid_types.pdf', sha256: HASH, opened_file: true, fetched_from: FROM });
  assert.deepEqual(fetchedPdfBytes(HASH), PDF);
});

test('a reader who keeps these bytes is found; anyone else is not asked about', async () => {
  assert.deepEqual(await source({ kept: { sha256: HASH, copy_uuid: 'x' } }).loadNookPaper(), { sha256: HASH, copy_uuid: 'x' });
  assert.equal(await source({ kept: 'explode' }).loadNookPaper(), null);
  assert.equal(await source({ kept: { sha256: HASH }, signedIn: false }).loadNookPaper(), null);
});

test('adding sends the fetched bytes by digest, and leads to the nook viewer', async () => {
  const opened = source();
  const added = await opened.addToNook({ identifier: null });
  assert.equal(added.added.sha256, HASH);
  assert.equal(added.added.name, 'liquid_types.pdf');
  assert.equal(opened.nookHref(added), `/viewer/?pdf=${HASH}`);
  // The bar offers the reader's copy by its viewer, not by raising a window.
  assert.equal(showInNookTarget(opened, { sha256: HASH }), `/viewer/?pdf=${HASH}`);
});

test('the nook viewer for a fetched PDF names it by digest and drops where it came from', () => {
  const href = `http://127.0.0.1/viewer/?from=${encodeURIComponent(FROM)}&nook=add&page=3`;
  assert.equal(nookViewerHref(href, HASH), `http://127.0.0.1/viewer/?page=3&pdf=${HASH}`);
});
