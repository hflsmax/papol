import test from 'node:test';
import assert from 'node:assert/strict';

const values = new Map([
  ['papol.localAccountUuid', '77777777-7777-4777-8777-777777777777'],
  ['papol.syncPreference', 'manual'],
  ['papol_token', 'token'],
]);
const calls = [];
global.localStorage = {
  getItem: (key) => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, String(value)),
  removeItem: (key) => values.delete(key),
};
global.location = new URL('tauri://localhost/viewer/index.html');
global.window = {
  location: global.location,
  __PAPOL_ENV__: { runtime: 'desktop', surface: 'viewer', documentWindow: true },
  __TAURI_INTERNALS__: {
    invoke: async (command, arguments_) => {
      calls.push([command, arguments_]);
      if (command === 'local_setting_get') return 'manual';
      if (command === 'data_query' && arguments_.queryName === 'paper_by_pdf') {
        return {
          uuid: '11111111-1111-4111-8111-111111111111',
          sha256: 'a'.repeat(64),
        };
      }
      if (command === 'data_query') return [];
      if (command === 'blob_read') return [37, 80, 68, 70];
      if (command === 'opened_file_read') return [37, 80, 68, 70, 45, 49, 46, 52];
      if (command === 'data_mutate') {
        return { rows: [{ uuid: arguments_.changes[0].uuid, ...arguments_.changes[0].values }] };
      }
      return null;
    },
    transformCallback: () => 1,
  },
  addEventListener() {},
  dispatchEvent() {},
};
global.Event = class Event { constructor(type) { this.type = type; } };

const {
  createAnnotation, deleteAnnotation, listAnnotations, getPaperByPdf, getPaperNotes,
  pdfLoadInput, rememberPaperIdentity,
} = await import('./api.js');
const PAPER = '11111111-1111-4111-8111-111111111111';

rememberPaperIdentity({
  uuid: '11111111-1111-4111-8111-111111111111',
  sha256: 'a'.repeat(64),
});

test('every kind of annotation reaches the one native table', async () => {
  const note = await createAnnotation(PAPER, {
    kind: 'note', page: 3, content: 'Offline',
    body: { anchor: { type: 'point', x: 0.25, y: 0.5 } },
  });
  const call = calls.find(([command, args]) => command === 'data_mutate'
    && args.changes[0].table === 'annotations');
  assert.equal(call[1].changes[0].values.kind, 'note');
  assert.equal(call[1].changes[0].values.paper_uuid, PAPER);
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

test('a local paper UUID reads annotations without falling through to integer REST routes', async () => {
  calls.length = 0;
  await listAnnotations(PAPER, { kind: 'ink' });
  await listAnnotations(PAPER, { kind: 'clip' });
  const reads = calls.filter(([command, args]) => command === 'data_query'
    && args.queryName === 'annotations');
  assert.deepEqual(reads.map(([, args]) => args.parameters.paper_uuid), [PAPER, PAPER]);
  assert.deepEqual(reads.map(([, args]) => args.parameters.kind), ['ink', 'clip']);
});

test('paper identity is available before its notes are queried', async () => {
  calls.length = 0;
  const paper = await getPaperByPdf('a'.repeat(64));

  assert.equal(paper.uuid, PAPER);
  assert.equal(calls.some(([, args]) => args?.queryName === 'annotations'), false);

  await getPaperNotes(paper);
  assert.equal(calls.filter(([, args]) => args?.queryName === 'annotations').length, 1);
});

test('desktop PDF rendering gives PDF.js bytes instead of a Tauri blob URL', async () => {
  const nook = await pdfLoadInput({
    uuid: '11111111-1111-4111-8111-111111111111',
    sha256: 'a'.repeat(64),
  });
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
