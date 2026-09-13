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
  addClip, addInk, createNote, eraseInk, getClips, getInk, pdfLoadInput, rememberPaperIdentity,
} = await import('./api.js');

rememberPaperIdentity({
  uuid: '11111111-1111-4111-8111-111111111111',
  edition_uuid: '22222222-2222-4222-8222-222222222222',
});

test('viewer notes use native UUID relationships and serialized anchors', async () => {
  const note = await createNote('11111111-1111-4111-8111-111111111111', {
    page: 3, anchor: { type: 'point', x: 0.25, y: 0.5 }, content: 'Offline',
  });
  const call = calls.find(([command, args]) => command === 'data_mutate'
    && args.changes[0].table === 'comments');
  assert.equal(call[1].changes[0].values.paper_uuid, '11111111-1111-4111-8111-111111111111');
  assert.equal(call[1].changes[0].values.edition_uuid, '22222222-2222-4222-8222-222222222222');
  assert.deepEqual(note.anchor, { type: 'point', x: 0.25, y: 0.5 });
});

test('ink and clips enter the native transactional outbox', async () => {
  const stroke = await addInk('22222222-2222-4222-8222-222222222222', {
    page: 1, points: [{ x: 0.1, y: 0.2 }], color: '#b3923d',
    width: 0.004, opacity: 1, shape: 'flat',
  });
  assert.deepEqual(stroke.points, [{ x: 0.1, y: 0.2 }]);
  const clip = await addClip('22222222-2222-4222-8222-222222222222', {
    page: 1,
    source: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 },
    frame: { x: 0.2, y: 0.2, w: 0.3, h: 0.3 },
    floating: false,
  });
  assert.equal(clip.frame.w, 0.3);
  const inkCall = calls.find(([command, args]) => command === 'data_mutate'
    && args.changes[0].table === 'ink_strokes');
  assert.equal(typeof inkCall[1].changes[0].values.points, 'string');
  await eraseInk(stroke.uuid);
  const deleteCall = calls.find(([, args]) => args?.changes?.[0]?.operation === 'delete');
  assert.equal(deleteCall[1].changes[0].table, 'ink_strokes');
});

test('a local edition UUID reads annotations without falling through to integer REST routes', async () => {
  const localEditionUuid = '6e13e900-fece-4d91-8eaa-f8e0c48a75cc';
  await getInk(localEditionUuid);
  await getClips(localEditionUuid);
  const reads = calls.filter(([command, args]) => command === 'data_query'
    && ['ink', 'clips'].includes(args.queryName));
  assert.deepEqual(reads.map(([, args]) => args.parameters.parent_uuid), [
    localEditionUuid, localEditionUuid,
  ]);
});

test('desktop PDF rendering gives PDF.js bytes instead of a Tauri blob URL', async () => {
  const nook = await pdfLoadInput({
    uuid: '11111111-1111-4111-8111-111111111111',
    edition_sha256: 'a'.repeat(64),
  });
  assert.ok(nook.data instanceof Uint8Array);
  assert.deepEqual([...nook.data], [37, 80, 68, 70]);
  assert.equal('url' in nook, false);

  const opened = await pdfLoadInput({
    opened_file: true,
    edition_sha256: 'b'.repeat(64),
  });
  assert.ok(opened.data instanceof Uint8Array);
  assert.deepEqual([...opened.data], [37, 80, 68, 70, 45, 49, 46, 52]);
  assert.equal('url' in opened, false);
});
