// The clock that decides which time counts, and the outbox that keeps it
// until Papol has it (shared/activity.js).
import test from 'node:test';
import assert from 'node:assert/strict';

import { accountMark, activityOutbox, activityTracker } from '../../shared/activity.js';
import limits from '../../shared/appLimits.js';

const { tick_ms: TICK, idle_ms: IDLE, span_max_ms: SPAN_MAX, away_grace_ms: GRACE } = limits.activity;
const START = Date.parse('2026-09-25T09:00:00Z');

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

function clock() {
  let at = START;
  return { now: () => at, advance: (ms) => { at += ms; } };
}

function tracked({ elsewhere = () => false } = {}) {
  const time = clock();
  const saved = new Map();
  let n = 0;
  const tracker = activityTracker({
    kind: 'reading', subject: 'a'.repeat(64), account: 'acct',
    save: (span) => saved.set(span.uuid, span), now: time.now, newId: () => `span-${++n}`,
    elsewhere: (since) => elsewhere(since),
  });
  // Ticks at the tracker's own pace, touching as it goes when asked.
  const run = (ms, { present = true, touching = true } = {}) => {
    for (let t = 0; t < ms; t += TICK) {
      time.advance(TICK);
      if (touching) tracker.touch();
      tracker.tick(present);
    }
  };
  return { tracker, saved, time, run, spans: () => [...saved.values()] };
}

test('time counts while the window is in front and in use', () => {
  const { tracker, run, spans } = tracked();
  tracker.tick(true);
  run(5 * 60_000);
  tracker.end();
  const [span] = spans();
  assert.equal(spans().length, 1);
  assert.equal(span.seconds, 300);
  assert.equal(span.open, false);
  assert.equal(span.started_at, new Date(START).toISOString());
});

test('a window left for longer than the grace stops counting where it was left', () => {
  const { tracker, run, spans } = tracked();
  tracker.tick(true);
  run(60_000);
  run(GRACE + 60_000, { present: false });
  run(60_000);
  // Leaving is seen at the next tick here, and the time up to it counts;
  // in the browser, blur ticks at the moment of leaving. A new span begins
  // at the first tick back.
  assert.deepEqual(spans().map((s) => s.seconds), [75, 45]);
  assert.equal(spans()[0].open, false);

  const idle = tracked();
  idle.tracker.tick(true);
  idle.run(60_000);
  idle.run(10 * 60_000, { touching: false });
  // What was touched a minute in counts until it has been idle for IDLE.
  assert.equal(idle.spans()[0].seconds, (60_000 + IDLE - TICK) / 1000);
  assert.equal(idle.spans()[0].open, false);
});

test('going off to another tab and coming back within the grace is reading the paper', () => {
  const { tracker, run, spans } = tracked();
  tracker.tick(true);
  run(5 * 60_000);
  // Looking something up, three times over, for a few minutes each.
  for (const away of [2, 6, 4]) {
    run(away * 60_000, { present: false });
    run(3 * 60_000);
  }
  tracker.end();
  const all = spans();
  assert.equal(all.length, 1);
  assert.equal(all[0].seconds, (5 + 2 + 3 + 6 + 3 + 4 + 3) * 60);
});

test('time away that went to another paper in Papol is that paper\'s, not this one\'s', () => {
  let other = false;
  const { tracker, run, spans } = tracked({ elsewhere: () => other });
  tracker.tick(true);
  run(5 * 60_000);
  run(60_000, { present: false });
  other = true;
  run(3 * 60_000, { present: false });
  run(2 * 60_000);
  tracker.end();
  assert.deepEqual(spans().map((s) => s.seconds), [315, 105]);
});

test('coming back after the idle limit, within the grace, still counts', () => {
  const { tracker, run, spans } = tracked();
  tracker.tick(true);
  run(60_000);
  run(IDLE + 60_000, { present: false });
  run(30_000, { touching: false });
  tracker.end();
  assert.deepEqual(spans().map((s) => s.seconds), [(60_000 + IDLE + 60_000 + 30_000) / 1000]);
});

test('a span bridged past its length is cut, and the next carries on', () => {
  const { tracker, run, spans } = tracked();
  tracker.tick(true);
  run(SPAN_MAX - 60_000);
  run(5 * 60_000, { present: false });
  run(60_000);
  tracker.end();
  const all = spans();
  assert.equal(all.length, 2);
  assert.equal(all[1].started_at, all[0].ended_at);
  assert.equal(all.reduce((sum, s) => sum + s.seconds, 0), (SPAN_MAX - 60_000 + 5 * 60_000 + 60_000) / 1000);
});

test('a gap in the ticks, as when the computer sleeps, is not counted', () => {
  const { tracker, time, run, spans } = tracked();
  tracker.tick(true);
  run(60_000);
  time.advance(60 * 60_000);
  tracker.touch();
  tracker.tick(true);
  run(60_000);
  assert.deepEqual(spans().map((s) => s.seconds), [60, 60]);
});

test('a long stretch is cut into spans that carry on from each other', () => {
  const { tracker, run, spans } = tracked();
  tracker.tick(true);
  run(SPAN_MAX * 2 + 60_000);
  tracker.end();
  const all = spans();
  assert.equal(all.length, 3);
  assert.equal(all.reduce((sum, s) => sum + s.seconds, 0), (SPAN_MAX * 2 + 60_000) / 1000);
  assert.equal(all[1].started_at, all[0].ended_at);
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
