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

const {
  handoffOpenedFileToNookViewer, nookViewerHref, resolveSource,
} = await import('./source.js');
const { hydrateCredential } = await import('../../shared/credentials.js');

test('a nook source exposes the content hash before its paper query resolves', () => {
  const previous = location.search;
  location.search = `?pdf=${HASH}`;
  try {
    const source = resolveSource();
    assert.equal(source.pdfHash, HASH);
    assert.equal(source.openedFile, undefined);
  } finally {
    location.search = previous;
  }
});

test('the nook handoff keeps navigation context and removes file-only identity', () => {
  const href = nookViewerHref(
    `http://127.0.0.1/viewer/?pdf=${HASH}&file=1&name=Local%20paper`
      + '&opened_at_ms=1&native_read_ms=2&native_hash_ms=3&page=7&note=kept'
  );
  const handedOff = new URL(href);

  assert.equal(handedOff.searchParams.get('pdf'), HASH);
  assert.equal(handedOff.searchParams.get('page'), '7');
  assert.equal(handedOff.searchParams.get('note'), 'kept');
  for (const key of ['file', 'name', 'opened_at_ms', 'native_read_ms', 'native_hash_ms']) {
    assert.equal(handedOff.searchParams.has(key), false);
  }
});

test('a standalone file neither reads nor exposes persistent paper state', async () => {
  values.delete('papol.localAccountUuid');
  existingPaper = null;
  calls.length = 0;
  annotations.set('legacy-annotation', { uuid: 'legacy-annotation', kind: 'note', sha256: HASH });
  const source = resolveSource();
  assert.deepEqual(source.initialPaper, {
    title: 'Local paper', sha256: HASH, opened_file: true,
  });
  const loaded = await source.load();

  assert.equal(source.openedFile, true);
  assert.equal(source.requiresSignIn, false);
  // The pair a paper that is not yet yours carries, whether it arrived by
  // link or off the file system: nothing here is yours to change, and a
  // annotation you make needs a nook to go into. An opened file satisfies the
  // first the easy way, by having no annotations on it at all.
  assert.equal(source.readOnly, true);
  assert.equal(source.annotationsRequireNook, true);
  assert.equal(loaded.doc.title, 'Local paper');
  assert.deepEqual(loaded.notes, []);
  assert.equal(source.annotations, undefined);
  assert.equal(calls.some(([command]) => command === 'data_query'), false);
  assert.equal(calls.some(([command]) => command.startsWith('local_annotation')), false);
  await assert.rejects(source.addToNook(), /Sign in to add this paper/);
  assert.equal(calls.some(([command]) => command === 'opened_file_read'), false);
});

test('an opened file already in the nook exposes its paper identity', async () => {
  values.set('papol.localAccountUuid', ACCOUNT);
  existingPaper = {
    uuid: '55555555-5555-4555-8555-555555555555',
    title: 'Saved paper',
    sha256: HASH,
  };
  calls.length = 0;

  const source = resolveSource();
  const loaded = await source.load();
  assert.deepEqual(loaded.doc, source.initialPaper);
  assert.equal(calls.some(([, args]) => args.queryName === 'paper_by_pdf'), false);

  const nookPaper = await source.loadNookPaper();

  assert.equal(nookPaper.uuid, existingPaper.uuid);
  assert.equal(nookPaper.title, 'Saved paper');
  assert.equal(nookPaper.opened_file, true);
  assert.deepEqual(loaded.notes, []);
  assert.equal(calls.filter(([, args]) => args.queryName === 'paper_by_pdf').length, 1);
  assert.equal(calls.some(([, args]) => args.queryName === 'comments'), false);
  assert.equal(calls.some(([command]) => command === 'opened_file_read'), false);
});

test('an opened file already in the nook hands the viewer to its canonical version', async () => {
  values.set('papol.localAccountUuid', ACCOUNT);
  existingPaper = {
    uuid: '55555555-5555-4555-8555-555555555555',
    title: 'Saved paper',
    sha256: HASH,
  };
  const source = resolveSource();
  const found = await source.loadNookPaper();
  const navigations = [];

  const handedOff = handoffOpenedFileToNookViewer(
    found,
    `${location.href}&page=4`,
    (href) => navigations.push(href),
  );

  assert.equal(handedOff, true);
  assert.deepEqual(navigations, [
    `http://127.0.0.1/viewer/?pdf=${HASH}&page=4`,
  ]);
});

test('an opened file absent from the nook stays in local-file mode', () => {
  const navigations = [];

  const handedOff = handoffOpenedFileToNookViewer(
    null,
    location.href,
    (href) => navigations.push(href),
  );

  assert.equal(handedOff, false);
  assert.deepEqual(navigations, []);
});

test('Add to nook imports only the paper graph, with no file-viewer annotations', async () => {
  values.set('papol.localAccountUuid', ACCOUNT);
  existingPaper = null;
  calls.length = 0;
  const source = resolveSource();
  await source.load();
  const paperUuid = await source.addToNook();

  assert.match(paperUuid, /^[0-9a-f-]{36}$/);
  assert.equal(calls.filter(([command]) => command === 'opened_file_read').length, 1);
  assert.equal(calls.filter(([command]) => command === 'blob_import').length, 1);
  const mutations = calls.filter(([command]) => command === 'data_mutate').map(([, args]) => args.changes);
  assert.deepEqual(mutations[0].map((change) => change.table), ['papers', 'copies']);
  assert.equal(mutations[0][0].uuid, paperUuid);
  assert.equal(mutations[0][0].values.sha256, HASH);
  assert.equal(mutations[0][1].values.shelf_uuid, SHELF);
  assert.equal(mutations.length, 1);
  assert.equal(calls.some(([command]) => command.startsWith('local_annotation')), false);
});

test('simultaneous post-login callbacks import an opened PDF only once', async () => {
  values.set('papol.localAccountUuid', ACCOUNT);
  existingPaper = null;
  calls.length = 0;
  const source = resolveSource();

  const [first, second] = await Promise.all([source.addToNook(), source.addToNook()]);

  assert.equal(first, second);
  assert.equal(calls.filter(([command]) => command === 'opened_file_read').length, 1);
  assert.equal(calls.filter(([command]) => command === 'blob_import').length, 1);
  assert.equal(calls.filter(([command]) => command === 'data_mutate').length, 1);
});

test('an online opened-file import stores parsed bibliographic metadata', async () => {
  values.set('papol.localAccountUuid', ACCOUNT);
  existingPaper = null;
  calls.length = 0;
  navigator.onLine = true;
  global.fetch = async () => new Response(JSON.stringify({
    doi: '10.1234/parsed', title: 'Parsed title',
    authors: '[{"name":"Ada Lovelace"}]', journal: 'Parsing Letters', year: 2026,
    file_path: `${HASH}.pdf`, sha256: HASH,
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  try {
    await resolveSource().addToNook();
  } finally {
    navigator.onLine = false;
    global.fetch = async () => { throw new Error('an opened file must remain private before Add to nook'); };
  }

  const paperChange = calls.find(([, args]) => args.changes?.[0]?.table === 'papers')[1].changes[0];
  assert.deepEqual(paperChange.values, {
    doi: '10.1234/parsed', title: 'Parsed title',
    authors: '[{"name":"Ada Lovelace"}]', journal: 'Parsing Letters', year: 2026,
    // A paper is its PDF, so the row carries the file it is.
    file_path: `${HASH}.pdf`, sha256: HASH,
  });
});

test('first sign-in adds an open file locally without waiting for its nook snapshot', async () => {
  values.delete('papol.localAccountUuid');
  values.delete('papol_token');
  await hydrateCredential();
  existingPaper = null;
  shelvesReady = false;
  calls.length = 0;
  const source = resolveSource();
  await source.load();

  values.set('papol_token', 'new-session-token');
  await hydrateCredential();
  values.set('papol.localAccountUuid', ACCOUNT);
  const paperUuid = await source.addToNook();

  assert.match(paperUuid, /^[0-9a-f-]{36}$/);
  const syncs = calls.filter(([command]) => command === 'sync_now');
  assert.ok(syncs.length > 0);
  assert.ok(syncs.every(([, args]) => (
    args.request.pullOnly === true && args.request.pushOnly === false
  )));
  const paperGraph = calls.find(([, args]) => args.changes?.some((change) => change.table === 'copies'));
  assert.equal(paperGraph[1].changes.find((change) => change.table === 'copies').values.shelf_uuid, null);
  assert.deepEqual(
    calls.filter(([command]) => command === 'data_mutate')
      .flatMap(([, args]) => args.changes.map((change) => change.table)),
    ['papers', 'copies'],
  );
  assert.equal(calls.some(([command]) => command.startsWith('local_annotation')), false);
});
