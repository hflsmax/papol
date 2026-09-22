import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { putWithProgress, storeFile, uploadProgressView } from '../../shared/api/files.js';

const MB = 1024 * 1024;

// XMLHttpRequest as the test plays it: the request opened, its headers
// set, its body sent, the upload's progress fired, then the answer.
class FakeXhr {
  static sent = [];
  static answer = { status: 200, steps: [0.5, 1] };
  constructor() { this.headers = {}; this.upload = {}; }
  open(method, url) { this.method = method; this.url = url; }
  setRequestHeader(name, value) { this.headers[name] = value; }
  send(body) {
    FakeXhr.sent.push({ method: this.method, url: this.url, headers: this.headers, size: body.size });
    setTimeout(() => {
      for (const step of FakeXhr.answer.steps) this.upload.onprogress?.({ loaded: Math.round(body.size * step), total: body.size, lengthComputable: true });
      if (FakeXhr.answer.fail) { this.onerror?.(); return; }
      this.status = FakeXhr.answer.status;
      this.onload?.();
    }, 0);
  }
  abort() { this.onabort?.(); }
}

test.beforeEach(() => { globalThis.XMLHttpRequest = FakeXhr; FakeXhr.sent = []; FakeXhr.answer = { status: 200, steps: [0.5, 1] }; });

test('putWithProgress sends the headers it is given and reports the bytes as they go', async () => {
  const body = new Blob([new Uint8Array(1000)]);
  const seen = [];
  const answer = await putWithProgress('https://bucket.test/k', {
    headers: { 'content-type': 'application/pdf', 'x-amz-checksum-sha256': 'c2ln' }, body, onProgress: (p) => seen.push(p),
  });
  assert.deepEqual(answer, { status: 200, ok: true });
  assert.deepEqual(FakeXhr.sent, [{ method: 'PUT', url: 'https://bucket.test/k', headers: { 'content-type': 'application/pdf', 'x-amz-checksum-sha256': 'c2ln' }, size: 1000 }]);
  assert.deepEqual(seen, [{ loaded: 0, total: 1000 }, { loaded: 500, total: 1000 }, { loaded: 1000, total: 1000 }, { loaded: 1000, total: 1000 }]);
});

test('putWithProgress answers a refusal as a status and a network failure as a rejection', async () => {
  FakeXhr.answer = { status: 403, steps: [] };
  assert.deepEqual(await putWithProgress('https://bucket.test/k', { body: new Blob(['x']) }), { status: 403, ok: false });
  FakeXhr.answer = { fail: true, steps: [] };
  await assert.rejects(putWithProgress('https://bucket.test/k', { body: new Blob(['x']) }), /could not reach the bucket/);
});

test('storeFile hashes in slices, PUTs where it is told, and reports both phases', async () => {
  const bytes = new Uint8Array(3000).map((_, i) => i % 251);
  const digest = createHash('sha256').update(bytes).digest('hex');
  const asked = [];
  globalThis.window = { localStorage: { getItem: () => null }, location: { origin: 'https://papol.test' }, dispatchEvent() {}, addEventListener() {} };
  globalThis.localStorage = window.localStorage;
  globalThis.fetch = async (url, options) => {
    asked.push({ url: String(url), body: JSON.parse(options.body) });
    return new Response(JSON.stringify({ stored: false, url: 'https://bucket.test/uploads/x.pdf', file_path: `${digest}.pdf`, headers: { 'content-type': 'application/pdf' } }), { status: 200 });
  };
  const seen = [];
  const stored = await storeFile('paper', new Blob([bytes]), { name: 'x.pdf', mime: 'application/pdf', onProgress: (p) => seen.push(p) });
  assert.equal(stored.sha256, digest);
  assert.equal(stored.file_path, `${digest}.pdf`);
  assert.equal(asked.length, 1);
  assert.match(asked[0].url, /\/files\/upload-address$/);
  assert.deepEqual(asked[0].body, { kind: 'paper', sha256: digest, size: 3000, name: 'x.pdf', mime: 'application/pdf' });
  assert.deepEqual(seen.map((p) => p.phase), ['hashing', 'hashing', 'uploading', 'uploading', 'uploading', 'uploading', 'stored']);
  assert.deepEqual(seen.at(-1), { phase: 'stored', loaded: 3000, total: 3000 });
  assert.equal(FakeXhr.sent[0].headers['content-type'], 'application/pdf');
});

test('storeFile skips the PUT when the server holds the bytes, and the bar is full at once', async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ stored: true, file_path: 'k.pdf' }), { status: 200 });
  const seen = [];
  await storeFile('paper', new Blob([new Uint8Array(10)]), { name: 'x.pdf', onProgress: (p) => seen.push(p) });
  assert.deepEqual(FakeXhr.sent, []);
  assert.deepEqual(seen.map((p) => p.phase), ['hashing', 'hashing', 'stored']);
  assert.deepEqual(uploadProgressView(seen.at(-1)), { fraction: 1, detail: '10 bytes of 10 bytes' });
});

test('uploadProgressView is one bar over both phases, the hash a sliver of it', () => {
  assert.equal(uploadProgressView(null), null);
  assert.equal(uploadProgressView({ phase: 'hashing', loaded: 0, total: 0 }), null);
  const hashing = uploadProgressView({ phase: 'hashing', loaded: 15 * MB, total: 30 * MB });
  assert.ok(hashing.fraction > 0 && hashing.fraction < 0.1, `hashing half way is ${hashing.fraction}`);
  assert.equal(hashing.detail, '15 MB of 30 MB');
  const starting = uploadProgressView({ phase: 'uploading', loaded: 0, total: 30 * MB });
  const halfway = uploadProgressView({ phase: 'uploading', loaded: 15 * MB, total: 30 * MB });
  const done = uploadProgressView({ phase: 'uploading', loaded: 30 * MB, total: 30 * MB });
  assert.ok(starting.fraction >= hashing.fraction);
  assert.ok(halfway.fraction > 0.5 && halfway.fraction < 0.6);
  assert.equal(done.fraction, 1);
  assert.equal(halfway.detail, '15 MB of 30 MB');
  assert.deepEqual(uploadProgressView({ phase: 'stored', loaded: 30 * MB, total: 30 * MB }), { fraction: 1, detail: '30 MB of 30 MB' });
});
