import test from 'node:test';
import assert from 'node:assert/strict';

const values = new Map([
  ['papol.localAccountId', '7'],
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
      if (command === 'data_mutate') {
        return { rows: [{ id: arguments_.changes[0].id, ...arguments_.changes[0].values }] };
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
  addClip, addInk, createNote, eraseInk, rememberPaperIdentity,
} = await import('./api.js');

rememberPaperIdentity({
  id: 11,
  sync_id: '11111111-1111-4111-8111-111111111111',
  edition_sync_id: '22222222-2222-4222-8222-222222222222',
  editions: [{ id: 22, sync_id: '22222222-2222-4222-8222-222222222222' }],
});

test('viewer notes use native UUID relationships and serialized anchors', async () => {
  const note = await createNote(11, {
    page: 3, anchor: { type: 'point', x: 0.25, y: 0.5 }, content: 'Offline',
  });
  const call = calls.find(([command, args]) => command === 'data_mutate'
    && args.changes[0].table === 'comments');
  assert.equal(call[1].changes[0].values.paper_id, '11111111-1111-4111-8111-111111111111');
  assert.equal(call[1].changes[0].values.edition_id, '22222222-2222-4222-8222-222222222222');
  assert.deepEqual(note.anchor, { type: 'point', x: 0.25, y: 0.5 });
});

test('ink and clips enter the native transactional outbox', async () => {
  const stroke = await addInk(22, {
    page: 1, points: [{ x: 0.1, y: 0.2 }], color: '#b3923d',
    width: 0.004, opacity: 1, shape: 'flat',
  });
  assert.deepEqual(stroke.points, [{ x: 0.1, y: 0.2 }]);
  const clip = await addClip(22, {
    page: 1,
    source: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 },
    frame: { x: 0.2, y: 0.2, w: 0.3, h: 0.3 },
    floating: false,
  });
  assert.equal(clip.frame.w, 0.3);
  const inkCall = calls.find(([command, args]) => command === 'data_mutate'
    && args.changes[0].table === 'ink_strokes');
  assert.equal(typeof inkCall[1].changes[0].values.points, 'string');
  await eraseInk(stroke.id);
  const deleteCall = calls.find(([, args]) => args?.changes?.[0]?.operation === 'delete');
  assert.equal(deleteCall[1].changes[0].table, 'ink_strokes');
});
