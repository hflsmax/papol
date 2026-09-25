import assert from 'node:assert/strict';
import test from 'node:test';
import { ACCOUNT, installNativeHarness, sha256Hex } from '../../shared/testing/nativeHarness.js';

// The file on disk, and the name the Mac gave it: the digest of its bytes.
const PDF = new TextEncoder().encode('%PDF-1.4\n%%EOF');
const HASH = sha256Hex(PDF);
const SHELF = '88888888-8888-4888-8888-888888888888';
const OTHER_SHELF = '66666666-6666-4666-8666-666666666666';
const SAVED = { uuid: '55555555-5555-4555-8555-555555555555', title: 'Saved paper', sha256: HASH };

// An opened file is private until it is added: offline, signed out, and
// with no route for any request, so one that leaves fails the test.
const native = await installNativeHarness({
  surface: 'viewer', documentWindow: true, signedIn: false, onLine: false,
  href: `http://127.0.0.1/viewer/?pdf=${HASH}&file=1&name=Local%20paper`,
});

const {
  handoffOpenedFileToNookViewer, nookViewerHref, resolveSource,
} = await import('./source.js');
const { hydrateCredential } = await import('../../shared/credentials.js');
const { takeNookNotice } = await import('./api.js');
const { enterOfflineMode } = await import('../../shared/connectivity.js');

// Signed in, and offline unless a test says otherwise: Papol is offline
// when it has latched so, which is what keeps an add from sending.
function signedIn({ inNook = null, offline = true } = {}) {
  native.storage.set('papol.localAccountUuid', ACCOUNT);
  if (offline) enterOfflineMode();
  native.on('opened_file_read', () => [...PDF]);
  native.query('paper_by_pdf', () => {
    if (inNook) return inNook;
    throw 'Paper not in nook';
  });
  native.query('shelves', [
    { uuid: OTHER_SHELF, is_default: 0, is_public: 0 },
    { uuid: SHELF, is_default: 1, is_public: 1 },
  ]);
}

const mutatedTables = () => native.argsOf('data_mutate').flatMap(({ changes }) => changes.map((change) => change.table));

test('a nook source exposes the content hash before its paper query resolves', () => {
  location.search = `?pdf=${HASH}`;
  native.storage.set('papol.localAccountUuid', ACCOUNT);
  try {
    const source = resolveSource();
    assert.equal(source.pdfHash, HASH);
    assert.equal(source.openedFile, undefined);
  } finally {
    native.storage.delete('papol.localAccountUuid');
  }
});

test('signed out, a paper\u2019s address is a lean link and reads nothing local', () => {
  location.search = `?pdf=${HASH}`;
  const source = resolveSource();
  assert.equal(source.pdfHash, undefined);
  assert.equal(source.readOnly, true);
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
  const source = resolveSource();
  assert.deepEqual(source.initialPaper, {
    title: 'Local paper', sha256: HASH, opened_file: true,
  });
  const loaded = await source.load();

  assert.equal(source.openedFile, true);
  assert.equal(source.requiresSignIn, false);
  // The pair a paper that is not yet yours carries, whether it arrived by
  // link or off the file system: nothing here is yours to change, and an
  // annotation you make needs a nook to go into. An opened file satisfies the
  // first the easy way, by having no annotations on it at all.
  assert.equal(source.readOnly, true);
  assert.equal(source.annotationsRequireNook, true);
  assert.equal(loaded.doc.title, 'Local paper');
  assert.deepEqual(loaded.notes, []);
  assert.equal(source.annotations, undefined);
  assert.deepEqual(native.argsOf('data_query'), []);
  await assert.rejects(source.addToNook(), /Sign in to add this paper/);
  assert.deepEqual(native.argsOf('opened_file_read'), []);
});

test('an opened file already in the nook exposes its paper identity', async () => {
  signedIn({ inNook: SAVED });
  const source = resolveSource();
  const loaded = await source.load();
  assert.deepEqual(loaded.doc, source.initialPaper);
  assert.deepEqual(native.argsOf('data_query'), [], 'showing page one consults nothing');

  const nookPaper = await source.loadNookPaper();

  assert.equal(nookPaper.uuid, SAVED.uuid);
  assert.equal(nookPaper.title, 'Saved paper');
  assert.equal(nookPaper.opened_file, true);
  assert.deepEqual(native.argsOf('data_query').map(({ queryName, parameters }) => [queryName, parameters]), [
    ['paper_by_pdf', { sha256: HASH }],
  ]);
  assert.deepEqual(native.argsOf('opened_file_read'), []);
});

test('an opened file already in the nook hands the viewer to its canonical version', async () => {
  signedIn({ inNook: SAVED });
  const found = await resolveSource().loadNookPaper();
  const navigations = [];

  const handedOff = handoffOpenedFileToNookViewer(
    found,
    `${location.href}&page=4`,
    (href) => navigations.push(href),
  );

  assert.equal(handedOff, true);
  assert.deepEqual(navigations, [`http://127.0.0.1/viewer/?pdf=${HASH}&page=4`]);
});

test('an opened file absent from the nook stays in local-file mode', () => {
  const navigations = [];
  const handedOff = handoffOpenedFileToNookViewer(null, location.href, (href) => navigations.push(href));
  assert.equal(handedOff, false);
  assert.deepEqual(navigations, []);
});

test('Add to nook imports only the paper graph, with no file-viewer annotations', async () => {
  signedIn();
  const source = resolveSource();
  await source.load();
  const paperSha256 = await source.addToNook();

  assert.equal(paperSha256, HASH);
  assert.equal(native.argsOf('opened_file_read').length, 1);
  assert.equal(native.argsOf('blob_import').length, 1);
  assert.ok(native.blobs.has(HASH), 'the nook holds the file itself');
  const mutations = native.argsOf('data_mutate').map(({ changes }) => changes);
  assert.equal(mutations.length, 1);
  assert.deepEqual(mutations[0].map((change) => change.table), ['papers', 'copies']);
  assert.equal(mutations[0][0].uuid, HASH);
  // The paper's name is the file, and it is said among the values too, as
  // the upload form says it: that is what has sync put the PDF in the
  // bucket, here where this offline add never sent it.
  assert.equal(mutations[0][0].values.sha256, HASH);
  assert.equal(mutations[0][1].values.shelf_uuid, SHELF);
});

test('simultaneous post-login callbacks import an opened PDF only once', async () => {
  signedIn();
  const source = resolveSource();

  const [first, second] = await Promise.all([source.addToNook(), source.addToNook()]);

  assert.equal(first, second);
  assert.equal(native.argsOf('opened_file_read').length, 1);
  assert.equal(native.argsOf('blob_import').length, 1);
  assert.equal(native.argsOf('data_mutate').length, 1);
});

test('a file that changed on disk while it was open is not added under the old name', async () => {
  signedIn();
  native.on('opened_file_read', () => [...new TextEncoder().encode('%PDF-1.4\nedited\n%%EOF')]);
  await assert.rejects(resolveSource().addToNook(), /The file changed while it was open/);
  assert.deepEqual(native.argsOf('data_mutate'), []);
});

test('an online opened-file import stores parsed bibliographic metadata', async () => {
  signedIn({ offline: false });
  navigator.onLine = true;
  await hydrateCredential();
  // The server already holds the bytes, so no PUT; no index knows the
  // identifier, so telling it they are in answers with a job, and the
  // reading is the job's result.
  native.route('POST /api/files/upload-address', { json: { stored: true, file_path: `${HASH}.pdf` } });
  native.route('POST /api/papers/lookup', { status: 404, json: { detail: 'No index knows this identifier' } });
  native.route('POST /api/papers/uploaded', { status: 202, json: { job: 'job-1', file_path: `${HASH}.pdf`, sha256: HASH } });
  native.route('GET /api/jobs/job-1', {
    json: {
      uuid: 'job-1', kind: 'extract_metadata', status: 'done', detail: null,
      result: {
        doi: '10.1234/parsed', title: 'Parsed title',
        authors: '[{"name":"Ada Lovelace"}]', journal: 'Parsing Letters', year: 2026,
        file_path: `${HASH}.pdf`,
      },
    },
  });

  // The identifier the open document prints goes with the bytes.
  await resolveSource().addToNook({ identifier: Promise.resolve({ doi: '10.1234/parsed' }) });

  const paperChange = native.argsOf('data_mutate')[0].changes[0];
  assert.deepEqual(paperChange.values, {
    doi: '10.1234/parsed', title: 'Parsed title',
    authors: '[{"name":"Ada Lovelace"}]', journal: 'Parsing Letters', year: 2026,
    // A paper is its PDF: the row is named by it, and carries the path.
    file_path: `${HASH}.pdf`, sha256: HASH,
  });
  const [told] = native.requests().filter(({ url }) => url.endsWith('/api/papers/uploaded'));
  assert.deepEqual(told.json(), { file_path: `${HASH}.pdf`, uploaded_name: 'Local paper.pdf', identifier: { doi: '10.1234/parsed' } });
});

test('an opened file whose send fails is added under its name, and the nook page says why', async () => {
  signedIn({ offline: false });
  navigator.onLine = true;
  // What the Tauri HTTP plugin rejects with for a host outside its scope:
  // the command's Err string, not an Error.
  native.route(/./, () => { throw 'url not allowed on the configured scope'; });
  await resolveSource().addToNook();

  const paperChange = native.argsOf('data_mutate')[0].changes[0];
  assert.equal(paperChange.values.title, 'Local paper');
  const notice = takeNookNotice();
  assert.match(notice.message, /could not be sent to be read \(url not allowed on the configured scope\)/);
  assert.match(notice.report, /Area: sending a PDF to be read/);
  assert.equal(takeNookNotice(), null, 'said once');
});

test('an opened file the nook could not keep leaves no notice behind', async () => {
  signedIn();
  // The bridge rejects with a plain string, as Tauri does for a command's Err.
  native.on('data_mutate', () => { throw 'database is locked'; });
  // Offline, so unread: the notice would say so, were there a paper.
  await assert.rejects(resolveSource().addToNook(), (failure) => failure === 'database is locked');
  assert.equal(takeNookNotice(), null);
});

test('first sign-in adds an open file locally without waiting for its nook snapshot', async () => {
  let shelvesReady = false;
  const source = resolveSource();
  await source.load();

  native.storage.set('papol_token', 'new-session-token');
  await hydrateCredential();
  signedIn({ offline: false });
  // The send finds no network; the add goes on without it.
  native.route(/./, () => { throw new TypeError('Load failed'); });
  // The snapshot that brings the shelves down has not arrived yet.
  native.query('shelves', () => (shelvesReady ? [{ uuid: SHELF, is_default: 1, is_public: 1 }] : []));
  native.on('sync_now', () => { shelvesReady = true; return { pushed: 0, pulled: 1, cursor: 1 }; });
  const paperSha256 = await source.addToNook();

  assert.equal(paperSha256, HASH);
  await native.until(() => native.argsOf('sync_now').length > 0, { what: 'the background pull' });
  assert.ok(native.argsOf('sync_now').every(({ request }) => request.mode === 'pull'));
  const copies = native.argsOf('data_mutate')[0].changes.find((change) => change.table === 'copies');
  assert.equal(copies.values.shelf_uuid, null);
  assert.deepEqual(mutatedTables(), ['papers', 'copies']);
});
