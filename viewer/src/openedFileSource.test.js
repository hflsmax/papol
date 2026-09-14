import assert from 'node:assert/strict';
import test from 'node:test';

const HASH = 'a'.repeat(64);
const ACCOUNT = '77777777-7777-4777-8777-777777777777';
const SHELF = '88888888-8888-4888-8888-888888888888';
const OTHER_SHELF = '66666666-6666-4666-8666-666666666666';
const values = new Map([['papol.syncPreference', 'manual']]);
const annotations = new Map();
const calls = [];
let existingPaper = null;
let shelvesReady = true;

global.localStorage = {
  getItem: (key) => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, String(value)),
  removeItem: (key) => values.delete(key),
};
global.location = new URL(`http://127.0.0.1/viewer/?pdf=${HASH}&file=1&name=Local%20paper`);
global.window = {
  location: global.location,
  __PAPOL_ENV__: { runtime: 'desktop', surface: 'viewer', documentWindow: true },
  __TAURI_INTERNALS__: {
    invoke: async (command, args = {}) => {
      calls.push([command, args]);
      if (command === 'local_setting_get') return 'manual';
      if (command === 'local_annotations_list') {
        return [...annotations.values()].filter((row) => row.sha256 === args.sha256);
      }
      if (command === 'local_annotation_put') {
        const stored = { ...args.row, uuid: args.uuid, kind: args.kind, sha256: args.sha256 };
        annotations.set(args.uuid, stored);
        return stored;
      }
      if (command === 'local_annotation_delete') {
        annotations.delete(args.uuid);
        return null;
      }
      if (command === 'local_annotations_clear') {
        let removed = 0;
        for (const [uuid, row] of annotations) {
          if (row.sha256 === args.sha256) {
            annotations.delete(uuid);
            removed += 1;
          }
        }
        return removed;
      }
      if (command === 'opened_file_read') return [...new TextEncoder().encode('%PDF-1.4\n%%EOF')];
      if (command === 'blob_import') return { sha256: HASH, size: args.bytes.length, mime_type: args.mimeType };
      if (command === 'data_query') {
        if (args.queryName === 'paper_by_pdf') {
          if (existingPaper) return existingPaper;
          throw new Error('Paper not in nook');
        }
        if (args.queryName === 'comments') return [];
        if (args.queryName === 'shelves') return shelvesReady ? [
          { uuid: OTHER_SHELF, is_default: 0, is_public: 0 },
          { uuid: SHELF, is_default: 1, is_public: 1 },
        ] : [];
        return [];
      }
      if (command === 'sync_now') {
        shelvesReady = true;
        return { pushed: 0, pulled: 1, cursor: 1 };
      }
      if (command === 'data_mutate') return { rows: [] };
      return null;
    },
    transformCallback: () => 1,
  },
  addEventListener() {},
  dispatchEvent() {},
};
global.Event = class Event { constructor(type) { this.type = type; } };
Object.defineProperty(globalThis, 'navigator', {
  value: { onLine: false }, configurable: true, writable: true,
});
global.fetch = async () => { throw new Error('an opened file must remain private before Add to nook'); };

const { resolveSource } = await import('./source.js');
const { hydrateCredential } = await import('../../shared/credentials.js');

function seedMarks() {
  annotations.clear();
  annotations.set('11111111-1111-4111-8111-111111111111', {
    uuid: '11111111-1111-4111-8111-111111111111', kind: 'note', sha256: HASH,
    page: 2, anchor: { type: 'point', x: 0.2, y: 0.4 }, content: 'Device note', name: null,
  });
  annotations.set('22222222-2222-4222-8222-222222222222', {
    uuid: '22222222-2222-4222-8222-222222222222', kind: 'ink', sha256: HASH,
    page: 1, points: [{ x: 0.1, y: 0.2 }], color: '#123456', width: 0.004,
    opacity: 0.7, shape: 'flat',
  });
  annotations.set('33333333-3333-4333-8333-333333333333', {
    uuid: '33333333-3333-4333-8333-333333333333', kind: 'clip', sha256: HASH,
    page: 1, source: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 },
    frame: { x: 0.2, y: 0.2, w: 0.3, h: 0.3 }, floating: false,
  });
}

test('an unsigned standalone viewer keeps every annotation type on the device by PDF hash', async () => {
  values.delete('papol.localAccountUuid');
  existingPaper = null;
  calls.length = 0;
  seedMarks();
  const source = resolveSource();
  const loaded = await source.load();

  assert.equal(source.openedFile, true);
  assert.equal(source.requiresSignIn, false);
  assert.equal(loaded.doc.title, 'Local paper');
  assert.equal(loaded.notes[0].content, 'Device note');
  assert.equal((await source.ink.list()).length, 1);
  assert.equal((await source.clips.list()).length, 1);
  assert.equal(calls.some(([command]) => command === 'data_query'), false);

  const note = await source.notes.create({
    page: 3, anchor: { type: 'point', x: 0.5, y: 0.6 }, content: 'New note',
  });
  await source.notes.update(note.uuid, 'Edited note');
  await source.notes.move(note.uuid, { page: 4, anchor: { type: 'point', x: 0.7, y: 0.8 } });
  await source.notes.rename(note.uuid, 'Named note');
  assert.equal(annotations.get(note.uuid).content, 'Edited note');
  assert.equal(annotations.get(note.uuid).page, 4);
  assert.equal(annotations.get(note.uuid).name, 'Named note');
  assert.ok(calls.filter(([command]) => command === 'local_annotation_put')
    .every(([, args]) => args.sha256 === HASH));
  await source.notes.remove(note.uuid);
  assert.equal(annotations.has(note.uuid), false);
  await assert.rejects(source.addToNook(), /Sign in to add this paper/);
  assert.equal(calls.some(([command]) => command === 'opened_file_read'), false);

  // The library window can sign the reader in while this viewer stays open.
  // Keep the same source instance: its device-local marks must become the
  // newly signed-in account's queued annotations, rather than being lost or
  // left as an inaccessible second copy.
  values.set('papol.localAccountUuid', ACCOUNT);
  calls.length = 0;
  const paperUuid = await source.addToNook();
  assert.match(paperUuid, /^[0-9a-f-]{36}$/);
  const mutations = calls.filter(([command]) => command === 'data_mutate').map(([, args]) => args.changes);
  assert.deepEqual(mutations[0].map((change) => change.table), ['papers', 'paper_editions', 'copies']);
  assert.deepEqual(mutations[1].map((change) => change.table), ['comments', 'ink_strokes', 'paper_clips']);
  assert.equal(calls.filter(([command]) => command === 'local_annotations_clear').length, 1);
  assert.equal(annotations.size, 0);
});

test('Add to nook creates the account graph on the default shelf and carries all device annotations', async () => {
  values.set('papol.localAccountUuid', ACCOUNT);
  existingPaper = null;
  calls.length = 0;
  seedMarks();
  const source = resolveSource();
  await source.load();
  const paperUuid = await source.addToNook();

  assert.match(paperUuid, /^[0-9a-f-]{36}$/);
  assert.equal(calls.filter(([command]) => command === 'opened_file_read').length, 1);
  assert.equal(calls.filter(([command]) => command === 'blob_import').length, 1);
  const mutations = calls.filter(([command]) => command === 'data_mutate').map(([, args]) => args.changes);
  assert.deepEqual(mutations[0].map((change) => change.table), ['papers', 'paper_editions', 'copies']);
  assert.equal(mutations[0][1].values.paper_uuid, paperUuid);
  assert.equal(mutations[0][1].values.sha256, HASH);
  assert.equal(mutations[0][2].values.shelf_uuid, SHELF);
  assert.deepEqual(mutations[1].map((change) => change.table), ['comments', 'ink_strokes', 'paper_clips']);
  assert.equal(mutations[1][0].values.paper_uuid, paperUuid);
  assert.deepEqual(JSON.parse(mutations[1][0].values.anchor), { x: 0.2, y: 0.4 });
  assert.deepEqual(JSON.parse(mutations[1][1].values.points), [{ x: 0.1, y: 0.2 }]);
  assert.deepEqual(JSON.parse(mutations[1][2].values.frame), { x: 0.2, y: 0.2, w: 0.3, h: 0.3 });
  assert.equal(calls.filter(([command]) => command === 'local_annotations_clear').length, 1);
  assert.equal(annotations.size, 0);
});

test('reopening after a partial Add to nook finishes migrating retained device annotations', async () => {
  values.set('papol.localAccountUuid', ACCOUNT);
  existingPaper = {
    uuid: '99999999-9999-4999-8999-999999999999',
    edition_uuid: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    edition_sha256: HASH,
    title: 'Existing nook paper',
  };
  calls.length = 0;
  seedMarks();
  const source = resolveSource();
  const loaded = await source.load();

  assert.equal(loaded.doc.uuid, existingPaper.uuid);
  assert.equal(source.backHref, `/paper/${existingPaper.uuid}`);
  assert.equal(calls.some(([command]) => command === 'opened_file_read'), false);
  const mutations = calls.filter(([command]) => command === 'data_mutate').map(([, args]) => args.changes);
  assert.equal(mutations.length, 1);
  assert.deepEqual(mutations[0].map((change) => change.table), ['comments', 'ink_strokes', 'paper_clips']);
  assert.ok(mutations[0].every((change) => change.values.edition_uuid === existingPaper.edition_uuid));
  assert.equal(calls.filter(([command]) => command === 'local_annotations_clear').length, 1);
  assert.equal(annotations.size, 0);
});

test('first sign-in supplies the credential before an open file asks for its nook snapshot', async () => {
  values.delete('papol.localAccountUuid');
  values.delete('papol_token');
  await hydrateCredential();
  existingPaper = null;
  shelvesReady = false;
  calls.length = 0;
  seedMarks();
  const source = resolveSource();
  await source.load();

  values.set('papol_token', 'new-session-token');
  await hydrateCredential();
  values.set('papol.localAccountUuid', ACCOUNT);
  const paperUuid = await source.addToNook();

  assert.match(paperUuid, /^[0-9a-f-]{36}$/);
  const sync = calls.find(([command]) => command === 'sync_now');
  assert.equal(sync[1].token, 'new-session-token');
  assert.deepEqual(
    calls.filter(([command]) => command === 'data_mutate')
      .flatMap(([, args]) => args.changes.map((change) => change.table)),
    ['papers', 'paper_editions', 'copies', 'comments', 'ink_strokes', 'paper_clips'],
  );
  assert.equal(annotations.size, 0);
});
