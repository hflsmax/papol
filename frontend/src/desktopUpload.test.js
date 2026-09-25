import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SHELF, installNativeHarness, sha256Hex } from '../../shared/testing/nativeHarness.js';

const native = await installNativeHarness();
const { enterOfflineMode } = await import('../../shared/connectivity.js');
const {
  addToNook, awaitPaperReading, createPaper, LOOKUP_GRACE_MS, uploadPaper,
} = await import('../../shared/api/papers.js');

const pdf = (text) => new File([`%PDF-1.4\n${text}\n%%EOF`], `${text}.pdf`, { type: 'application/pdf' });
const digestOf = async (file) => sha256Hex(new Uint8Array(await file.arrayBuffer()));

// The server holds the bytes already, so there is no PUT; being told
// they are in, it queues the reading.
// The indexes know no paper unless told one: the upload's job reads it.
function serverReadsUploads({ uploaded = null, known = null } = {}) {
  native.route('POST /api/files/upload-address', ({ json }) => ({
    json: { stored: true, file_path: `${json().sha256}.pdf` },
  }));
  native.route('POST /api/papers/lookup', () => (known
    ? { json: known }
    : { status: 404, json: { detail: 'No index knows this identifier' } }));
  native.route('POST /api/papers/uploaded', uploaded ?? (({ json }) => ({
    json: json().doi
      ? { job: null, file_path: json().file_path, sha256: json().file_path.slice(0, 64) }
      : { job: 'reading-job', file_path: json().file_path, sha256: json().file_path.slice(0, 64) },
  })));
}

test('a desktop PDF is kept in the nook and sent to be read, as a web upload is', async () => {
  serverReadsUploads();
  const file = pdf('sent');
  const uploaded = await uploadPaper(file, { identifier: { doi: '10.1145/3526113.3545636' } });

  const digest = await digestOf(file);
  assert.equal(uploaded.job, 'reading-job');
  assert.equal(uploaded.sha256, digest);
  assert.equal(uploaded.sendFailure, undefined);
  assert.equal(uploaded.offline, undefined);
  assert.ok(native.blobs.has(digest), 'the nook holds the bytes');
  const commands = native.commandNames();
  const kept = commands.indexOf('blob_import');
  const told = native.calls.findIndex(([command, request]) => (
    command === 'network_fetch' && request.url.endsWith('/papers/uploaded')));
  assert.ok(kept >= 0 && told > kept, 'kept first, then sent');
  assert.deepEqual(native.calls[told][1].json().identifier, { doi: '10.1145/3526113.3545636' });
});

test('a desktop PDF the indexes know is read by them while it is sent, and no job is waited for', async () => {
  const known = { doi: '10.1145/3526113.3545636', title: 'Known to the indexes', authors: '["Ada Lovelace"]', journal: 'UIST', year: 2022 };
  serverReadsUploads({ known });
  const uploaded = await uploadPaper(pdf('known'), { identifier: { doi: '10.1145/3526113.3545636' } });
  assert.equal(uploaded.job, null);
  assert.deepEqual(uploaded.reading, { ...known, file_path: `${uploaded.sha256}.pdf` });
  assert.deepEqual(await awaitPaperReading(uploaded), uploaded.reading);
  const told = native.calls.find(([command, request]) => (
    command === 'network_fetch' && request.url.endsWith('/papers/uploaded')));
  assert.equal(told[1].json().doi, '10.1145/3526113.3545636');
});

test('indexes still silent once the bytes are in are left to the job', async () => {
  serverReadsUploads();
  native.route('POST /api/papers/lookup', () => new Promise(() => {}));
  const started = Date.now();
  const uploaded = await uploadPaper(pdf('slow indexes'), { identifier: { doi: '10.1145/3526113.3545636' } });
  assert.equal(uploaded.job, 'reading-job');
  assert.equal(uploaded.reading, undefined);
  assert.ok(Date.now() - started < LOOKUP_GRACE_MS + 1000, 'the wait is bounded');
  const told = native.calls.find(([command, request]) => (
    command === 'network_fetch' && request.url.endsWith('/papers/uploaded')));
  assert.equal(told[1].json().doi, undefined);
});

test('a desktop PDF whose send fails is kept, and says why rather than that it could not be read', async () => {
  // What the Tauri HTTP plugin rejects with for a host outside its scope:
  // the command's Err string, not an Error.
  native.route(/./, () => { throw 'url not allowed on the configured scope: https://papol.test/api'; });
  const uploaded = await uploadPaper(pdf('refused'));
  assert.ok(native.blobs.has(uploaded.sha256), 'the nook has it all the same');
  assert.equal(uploaded.job, null);
  assert.match(String(uploaded.sendFailure?.message ?? uploaded.sendFailure), /not allowed on the configured scope/);
  assert.equal(await awaitPaperReading(uploaded), null);
});

test('a desktop PDF the server refuses to read is kept, and the refusal is what it says', async () => {
  // An answer, not a thrown error: the server was reached and failed.
  serverReadsUploads({ uploaded: { status: 503, json: { detail: 'The reader is resting' } } });
  const uploaded = await uploadPaper(pdf('unread'));
  assert.ok(native.blobs.has(uploaded.sha256));
  assert.equal(uploaded.job, null);
  assert.equal(uploaded.sendFailure.status, 503);
  assert.equal(uploaded.sendFailure.message, 'The reader is resting');
});

test('a PDF the nook cannot keep is not sent anywhere', async () => {
  serverReadsUploads();
  native.on('blob_import', () => { throw 'No space left on device'; });
  await assert.rejects(uploadPaper(pdf('full')), (failure) => failure === 'No space left on device');
  assert.deepEqual(native.requests(), [], 'nothing leaves for a file the nook does not hold');
});

test('a PDF added offline is named by its file, and its first thought is a note', async () => {
  // A paper is its PDF on this side of the wire too. Naming the row anything
  // else is refused by the replica before it is refused by the service, so
  // the import simply never lands.
  const file = pdf('offline');
  const digest = await digestOf(file);
  enterOfflineMode();
  const extracted = await uploadPaper(file);
  assert.equal(extracted.sha256, digest);
  assert.equal(extracted.offline, true);
  assert.equal(extracted.job, null, 'offline, it is not sent to be read');
  assert.deepEqual(native.requests(), []);
  assert.equal(await awaitPaperReading(extracted), null, 'and there is no reading to wait for');

  native.query('paper', { sha256: digest, copy_uuid: '22222222-2222-4222-8222-222222222222' });
  await createPaper({
    ...extracted, title: 'Added while offline',
    shelf_uuid: DEFAULT_SHELF,
    initial_comment: 'Worth a second read',
  });

  const [mutation] = native.argsOf('data_mutate');
  const byTable = Object.fromEntries(mutation.changes.map((change) => [change.table, change]));
  assert.equal(byTable.papers.uuid, digest, 'the paper is named by its file');
  assert.equal(byTable.copies.values.paper_sha256, digest);
  // Notes, ink and clips are one table; `comments` is not synchronized at all.
  assert.equal(byTable.comments, undefined);
  assert.equal(byTable.annotations.values.kind, 'note');
  assert.equal(byTable.annotations.values.paper_sha256, digest);
  assert.equal(byTable.annotations.values.content, 'Worth a second read');
});

test('adding a Library paper directly downloads it without running manual sync', async () => {
  const bytes = new TextEncoder().encode('%PDF-1.4\nready\n%%EOF');
  const digest = sha256Hex(bytes);
  const paper = {
    title: 'Ready to read', file_path: 'ready.pdf', sha256: digest,
    created_at: '2026-09-14T00:00:00Z',
  };
  native.route('GET /uploads/ready.pdf', { body: bytes, headers: { 'Content-Type': 'application/pdf' } });
  native.query('paper', { ...paper, copy_uuid: '33333333-3333-4333-8333-333333333333' });

  const added = await addToNook(paper);

  assert.ok(native.argsOf('sync_now').every(({ request }) => request.mode === 'pull'));
  const commands = native.commandNames();
  assert.ok(commands.indexOf('network_fetch') < commands.indexOf('blob_import'));
  assert.ok(commands.indexOf('blob_import') < commands.indexOf('data_mutate'));
  const [download] = native.requests('plugin');
  assert.equal(download.options.headers, undefined, 'a public PDF is fetched without the session');
  assert.ok(native.blobs.has(digest));
  assert.ok(added.copy_uuid);
});

test('a Library PDF that is not the paper it claims to be is not kept', async () => {
  const paper = { title: 'Swapped', file_path: 'swapped.pdf', sha256: 'e'.repeat(64) };
  native.route('GET /uploads/swapped.pdf', { body: 'not those bytes' });
  await assert.rejects(addToNook(paper), /did not match the Library paper/);
  assert.equal(native.blobs.size, 0, 'the wrong bytes are discarded');
  assert.equal(native.argsOf('data_mutate').length, 0);
});
