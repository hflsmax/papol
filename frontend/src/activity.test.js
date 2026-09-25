// The clock that decides which time counts, and the outbox that keeps it
// until Papol has it (shared/activity.js).
import test from 'node:test';
import assert from 'node:assert/strict';

import { accountMark, activityOutbox, activityTracker } from '../../shared/activity.js';
import limits from '../../shared/appLimits.js';

const { gap_ms: GAP, span_max_ms: SPAN_MAX } = limits.activity;
const START = Date.parse('2026-09-25T09:00:00Z');
const MIN = 60_000;

function memoryStorage() {
  const stored = new Map();
  return {
    get length() { return stored.size; },
    key: (i) => [...stored.keys()][i] ?? null,
    getItem: (key) => stored.get(key) ?? null,
    setItem: (key, value) => stored.set(key, String(value)),
    removeItem: (key) => stored.delete(key),
    stored,
  };
}

function tracked({ elsewhere = () => false } = {}) {
  let at = START;
  const saved = new Map();
  let n = 0;
  const tracker = activityTracker({
    kind: 'reading', subject: 'a'.repeat(64), account: 'acct',
    save: (span) => saved.set(span.uuid, span), now: () => at, newId: () => `span-${++n}`,
    elsewhere: (since) => elsewhere(since),
  });
  // Uses of the paper every `every` ms for `ms`, then a pause of `pause`.
  const read = (ms, every = 20_000) => {
    tracker.use();
    for (let t = every; t <= ms; t += every) { at += every; tracker.use(); }
  };
  const pause = (ms) => { at += ms; };
  const seconds = () => { tracker.end(); return [...saved.values()].map((s) => s.seconds); };
  return { tracker, saved, read, pause, seconds };
}

test('time runs from one use of the paper to the next', () => {
  const { read, seconds, saved } = tracked();
  read(5 * MIN);
  assert.deepEqual(seconds(), [300]);
  const [span] = saved.values();
  assert.equal(span.open, false);
  assert.equal(span.started_at, new Date(START).toISOString());
});

test('a pause no longer than the gap counts, whatever filled it', () => {
  // Sitting still over a page, or off in another tab looking something up:
  // to the rule they are one thing, a pause between two uses.
  const { read, pause, seconds } = tracked();
  read(5 * MIN);
  for (const minutes of [2, 7, 4]) {
    pause(minutes * MIN);
    read(3 * MIN);
  }
  assert.deepEqual(seconds(), [(5 + 2 + 3 + 7 + 3 + 4 + 3) * 60]);
});

test('a longer pause ends the stretch at the last use, and is not counted', () => {
  const { read, pause, seconds } = tracked();
  read(5 * MIN);
  pause(GAP + MIN);
  read(2 * MIN);
  assert.deepEqual(seconds(), [300, 120]);
});

test('nothing after the last use counts unless the reader comes back', () => {
  const { read, pause, seconds } = tracked();
  read(MIN);
  pause(GAP - MIN);
  assert.deepEqual(seconds(), [60]);
});

test('a pause spent on another paper in Papol is that paper\'s, not this one\'s', () => {
  // Another window's use is the last one until this window's own next use
  // takes its place, as the mark in storage does.
  let other = false;
  const { read, pause, seconds } = tracked({ elsewhere: () => { const was = other; other = false; return was; } });
  read(5 * MIN);
  pause(MIN);
  other = true;
  pause(2 * MIN);
  read(2 * MIN);
  assert.deepEqual(seconds(), [300, 120]);
});

test('a long stretch is cut into spans that carry on from each other', () => {
  const { read, seconds, saved } = tracked();
  read(SPAN_MAX * 2 + MIN);
  const all = seconds();
  assert.equal(all.length, 3);
  assert.equal(all.reduce((sum, s) => sum + s, 0), (SPAN_MAX * 2 + MIN) / 1000);
  const spans = [...saved.values()];
  assert.equal(spans[1].started_at, spans[0].ended_at);
});

test('a single use is no time at all, and saves nothing', () => {
  const { tracker, seconds } = tracked();
  tracker.use();
  assert.deepEqual(seconds(), []);
});

test('the outbox sends its account\'s spans, and forgets only what is finished', async () => {
  const storage = memoryStorage();
  const outbox = activityOutbox(storage);
  const at = START + 60 * 60_000;
  const iso = (ms) => new Date(ms).toISOString();
  outbox.save({ uuid: 'done', kind: 'reading', subject: 'x', account: 'me', open: false, started_at: iso(START), ended_at: iso(START + 60_000), seconds: 60 });
  outbox.save({ uuid: 'growing', kind: 'reading', subject: 'x', account: 'me', open: true, started_at: iso(at - 60_000), ended_at: iso(at), seconds: 60 });
  outbox.save({ uuid: 'abandoned', kind: 'board', subject: 'y', account: 'me', open: true, started_at: iso(START), ended_at: iso(START + 60_000), seconds: 60 });
  outbox.save({ uuid: 'theirs', kind: 'reading', subject: 'x', account: 'them', open: false, started_at: iso(START), ended_at: iso(START + 60_000), seconds: 60 });
  outbox.save({ uuid: 'ancient', kind: 'reading', subject: 'x', account: 'me', open: false, started_at: iso(START - 90 * 86_400_000), ended_at: iso(START - 90 * 86_400_000), seconds: 1 });

  let sent = null;
  // Offline: everything stays.
  await outbox.flush('me', async () => { throw Object.assign(new Error('offline'), { status: 0 }); }, at);
  assert.equal(storage.stored.size, 4);

  await outbox.flush('me', async (spans) => { sent = spans; }, at);
  assert.deepEqual(sent.map((s) => s.uuid).sort(), ['abandoned', 'done', 'growing']);
  assert.deepEqual(Object.keys(sent[0]).sort(), ['ended_at', 'kind', 'seconds', 'started_at', 'subject', 'uuid']);
  assert.deepEqual([...storage.stored.keys()].map((k) => k.split('.').pop()).sort(), ['growing', 'theirs']);
});

test('an account is marked without keeping its credential', () => {
  assert.equal(accountMark('token-one'), accountMark('token-one'));
  assert.notEqual(accountMark('token-one'), accountMark('token-two'));
  assert.ok(!accountMark('token-one').includes('token'));
});
