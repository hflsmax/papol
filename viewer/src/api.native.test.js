import test from 'node:test';
import assert from 'node:assert/strict';

import { installNativeHarness, sha256Hex } from '../../shared/testing/nativeHarness.js';

const native = await installNativeHarness({
  surface: 'viewer', documentWindow: true, href: 'https://papol.test/viewer/index.html',
});

const {
  createAnnotation, deleteAnnotation, listAnnotations, getPaperByPdf, getPaperNotes, pdfLoadInput,
} = await import('./api.js');
// A paper is its file, so the digest the viewer was opened on is also the
// name every annotation call gives it.
const PDF = [37, 80, 68, 70];
const PAPER = sha256Hex(new Uint8Array(PDF));
const calls = native.calls;

test('every kind of annotation reaches the one native table', async () => {
  const note = await createAnnotation(PAPER, {
    kind: 'note', page: 3, content: 'Offline',
    body: { anchor: { type: 'point', x: 0.25, y: 0.5 } },
  });
  const call = calls.find(([command, args]) => command === 'data_mutate'
    && args.changes[0].table === 'annotations');
  assert.equal(call[1].changes[0].values.kind, 'note');
  assert.equal(call[1].changes[0].values.paper_sha256, PAPER);
  assert.equal(call[1].changes[0].values.page, 3);
  // Geometry travels as text and comes back parsed.
  assert.equal(typeof call[1].changes[0].values.body, 'string');
  assert.deepEqual(note.body.anchor, { type: 'point', x: 0.25, y: 0.5 });

  const stroke = await createAnnotation(PAPER, {
    kind: 'ink', page: 1,
    body: {
      points: [{ x: 0.1, y: 0.2 }], color: '#b3923d',
      width: 0.004, opacity: 1, shape: 'flat',
    },
  });
  assert.deepEqual(stroke.body.points, [{ x: 0.1, y: 0.2 }]);

  const clip = await createAnnotation(PAPER, {
    kind: 'clip', page: 1,
    body: {
      source: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 },
      frame: { x: 0.2, y: 0.2, w: 0.3, h: 0.3 },
      floating: false,
    },
  });
  assert.equal(clip.body.frame.w, 0.3);

  await deleteAnnotation(stroke.uuid);
  const deleteCall = calls.find(([, args]) => args?.changes?.[0]?.operation === 'delete');
  assert.equal(deleteCall[1].changes[0].table, 'annotations');
});

test('a local paper digest reads annotations without falling through to integer REST routes', async () => {
  await listAnnotations(PAPER, { kind: 'ink' });
  await listAnnotations(PAPER, { kind: 'clip' });
  const reads = calls.filter(([command, args]) => command === 'data_query'
    && args.queryName === 'annotations');
  assert.deepEqual(reads.map(([, args]) => args.parameters.paper_sha256), [PAPER, PAPER]);
  assert.deepEqual(reads.map(([, args]) => args.parameters.kind), ['ink', 'clip']);
});

test('paper identity is available before its notes are queried', async () => {
  native.query('paper_by_pdf', ({ sha256 }) => ({ sha256 }));
  const paper = await getPaperByPdf(PAPER);

  assert.equal(paper.sha256, PAPER);
  assert.equal(calls.some(([, args]) => args?.queryName === 'annotations'), false);

  await getPaperNotes(paper);
  assert.equal(calls.filter(([, args]) => args?.queryName === 'annotations').length, 1);
});

test('desktop PDF rendering gives PDF.js bytes instead of a Tauri blob URL', async () => {
  native.importBlob(PDF);
  native.on('opened_file_read', () => [37, 80, 68, 70, 45, 49, 46, 52]);
  const nook = await pdfLoadInput({ sha256: PAPER });
  assert.ok(nook.data instanceof Uint8Array);
  assert.deepEqual([...nook.data], [37, 80, 68, 70]);
  assert.equal('url' in nook, false);

  const opened = await pdfLoadInput({
    opened_file: true,
    sha256: 'b'.repeat(64),
  });
  assert.ok(opened.data instanceof Uint8Array);
  assert.deepEqual([...opened.data], [37, 80, 68, 70, 45, 49, 46, 52]);
  assert.equal('url' in opened, false);
});

test('a handed-off PDF missing locally syncs only that file and then opens it', async () => {
  // Not in the store until the one file is fetched.
  native.on('blob_ensure', () => { native.importBlob(PDF); return null; });

  const input = await pdfLoadInput({ sha256: PAPER });

  assert.deepEqual([...input.data], [37, 80, 68, 70]);
  assert.deepEqual(
    calls.filter(([command]) => command === 'blob_read' || command === 'blob_ensure')
      .map(([command]) => command),
    ['blob_read', 'blob_ensure', 'blob_read'],
  );
  const ensure = calls.find(([command]) => command === 'blob_ensure')[1];
  assert.equal(ensure.sha256, PAPER);
  assert.equal(ensure.token, 'secret-token');
  assert.equal(calls.some(([command]) => command === 'sync_now'), false);
});
