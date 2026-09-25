import test from 'node:test';
import assert from 'node:assert/strict';
import { installNativeHarness } from '../../shared/testing/nativeHarness.js';

// On the web, where a PDF is read once it is sent and the page waits for
// the job that reads it.
const native = await installNativeHarness({ runtime: 'web' });
const { awaitPaperReading, uploadPaper } = await import('../../shared/api/papers.js');

const flush = () => new Promise((resolve) => setImmediate(resolve));

// Time moves only when the test says: the reading's schedule and its
// deadline are under test, not the clock.
async function tickUntilSettled(t, promise, stepMs = 250) {
  let settled = false;
  promise.then(() => { settled = true; }, () => { settled = true; });
  for (let turns = 0; !settled; turns += 1) {
    if (turns > 2000) throw new Error('The reading never settled');
    t.mock.timers.tick(stepMs);
    await flush();
  }
  return promise;
}

function job(...answers) {
  let asked = 0;
  native.route('GET /api/jobs/reading-job', () => {
    const answer = answers[Math.min(asked, answers.length - 1)];
    asked += 1;
    return { json: { uuid: 'reading-job', kind: 'extract_metadata', ...answer } };
  });
  return { get asked() { return asked; } };
}

test('a web upload is sent and answers with the reading to wait for', async () => {
  native.route('POST /api/files/upload-address', ({ json }) => ({ json: { stored: true, file_path: `${json().sha256}.pdf` } }));
  native.route('POST /api/papers/uploaded', ({ json }) => ({
    status: 202, json: { job: 'reading-job', file_path: json().file_path, sha256: json().file_path.slice(0, 64) },
  }));
  const uploaded = await uploadPaper(new File(['%PDF-1.4\n%%EOF'], 'web.pdf', { type: 'application/pdf' }));
  assert.equal(uploaded.job, 'reading-job');
  assert.match(uploaded.sha256, /^[0-9a-f]{64}$/);
});

test('a web upload whose send fails throws, since nothing was kept', async () => {
  native.route('POST /api/files/upload-address', { status: 500, json: { detail: 'The bucket is away' } });
  await assert.rejects(
    uploadPaper(new File(['%PDF-1.4\n%%EOF'], 'web.pdf', { type: 'application/pdf' })),
    (failure) => failure.status === 500 && failure.message === 'The bucket is away',
  );
});

test('a reading that finishes answers what the PDF says, and the version Papol already holds', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const existing = { sha256: 'e'.repeat(64), title: 'The published version' };
  job({ status: 'running' }, {
    status: 'done',
    result: { doi: '10.1234/read', title: 'Read', authors: '[]', journal: 'J', year: 2026, existing },
  });
  const read = await tickUntilSettled(t, awaitPaperReading({ job: 'reading-job' }));
  assert.equal(read.doi, '10.1234/read');
  assert.equal(read.title, 'Read');
  assert.equal(read.year, 2026);
  assert.deepEqual(read.existing, existing);
});

test('a reading that fails is no reading', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  job({ status: 'queued' }, { status: 'failed', detail: 'The PDF could not be read: Invalid PDF structure.' });
  assert.equal(await tickUntilSettled(t, awaitPaperReading({ job: 'reading-job' })), null);
});

test('a reading that never finishes is given up on at its deadline', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const reading = job({ status: 'running' });
  assert.equal(await tickUntilSettled(t, awaitPaperReading({ job: 'reading-job' }, { timeoutMs: 5000 })), null);
  const asked = reading.asked;
  assert.ok(asked > 1, 'it was asked more than once before the deadline');
  t.mock.timers.tick(60_000);
  await flush();
  assert.equal(reading.asked, asked, 'and not asked after once the wait is over');
});

test('a reading the caller stops waiting for is no reading', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const reading = job({ status: 'running' });
  const stop = new AbortController();
  const waiting = awaitPaperReading({ job: 'reading-job' }, { signal: stop.signal });
  await native.until(() => reading.asked === 1, { what: 'the first ask' });
  stop.abort();
  assert.equal(await waiting, null);
});

test('an upload with no job has no reading to wait for', async () => {
  assert.equal(await awaitPaperReading({ job: null, sha256: 'a'.repeat(64) }), null);
  assert.equal(await awaitPaperReading(null), null);
  assert.deepEqual(native.requests(), []);
});
