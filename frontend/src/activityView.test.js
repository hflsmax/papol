// The activity panel's arithmetic, in a time zone with a clock change.
process.env.TZ = 'Europe/London';

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  blocksOfDay, formatDuration, formatDurationShort, lastWhen, periodLabel, periodOf, secondsWithin,
  shadeOf, stepPeriod, subjectsWithin, totalsWithin,
} from './activityView.js';

const local = (y, m, d, h = 0, min = 0) => new Date(y, m - 1, d, h, min);
const span = (kind, subject, start, minutes, seconds = minutes * 60) => ({
  kind, subject, started_at: start.toISOString(), ended_at: new Date(+start + minutes * 60_000).toISOString(), seconds,
});

test('a week runs Monday to Monday, and a month asks for the whole weeks it shows', () => {
  const week = periodOf('week', local(2026, 9, 25, 15));
  assert.deepEqual([week.start, week.end], [local(2026, 9, 21), local(2026, 9, 28)]);
  assert.equal(week.days.length, 7);
  const month = periodOf('month', local(2026, 9, 25));
  assert.deepEqual([month.start, month.end], [local(2026, 9, 1), local(2026, 10, 1)]);
  assert.deepEqual([month.from, month.to], [local(2026, 8, 31), local(2026, 10, 5)]);
  assert.equal(month.days.length, 35);
  assert.deepEqual(stepPeriod('month', local(2026, 1, 31), 1), local(2026, 2, 1));
  assert.deepEqual(stepPeriod('week', local(2026, 9, 25), -1), local(2026, 9, 18));
});

test('periods are named as a person would', () => {
  const dashed = (text) => text.replace(/\s*[–-]\s*/g, '–');
  assert.equal(dashed(periodLabel(periodOf('week', local(2026, 9, 25)), 'en-GB')), '21–27 September 2026');
  assert.equal(dashed(periodLabel(periodOf('week', local(2026, 9, 25)), 'en-US')), 'September 21–27, 2026');
  assert.equal(dashed(periodLabel(periodOf('week', local(2026, 10, 1)), 'en-GB')), '28 September–4 October 2026');
  assert.equal(periodLabel(periodOf('month', local(2026, 9, 25)), 'en-GB'), 'September 2026');
  assert.equal(periodLabel(periodOf('day', local(2026, 9, 25)), 'en-GB'), 'Friday, 25 September 2026');
});

test('a span across midnight is shared between its days by its length', () => {
  const late = span('reading', 'p', local(2026, 9, 24, 23, 50), 20, 600);
  assert.equal(secondsWithin(late, local(2026, 9, 24), local(2026, 9, 25)), 300);
  assert.equal(secondsWithin(late, local(2026, 9, 25), local(2026, 9, 26)), 300);
  const [block] = blocksOfDay([late], local(2026, 9, 25));
  assert.equal(block.left, 0);
  assert.equal(block.seconds, 300);
});

test('a day the clocks go back is still drawn edge to edge', () => {
  // 25 October 2026 is 25 hours long in London.
  const evening = span('board', 'b', local(2026, 10, 25, 23, 0), 30);
  const [block] = blocksOfDay([evening], local(2026, 10, 25));
  assert.ok(block.left > 0.95 && block.left + block.width < 1.0001);
});

test('totals and subjects are counted by kind, most time first', () => {
  const day = local(2026, 9, 25);
  const spans = [
    span('reading', 'p1', local(2026, 9, 25, 9), 30),
    span('reading', 'p2', local(2026, 9, 25, 10), 10),
    span('board', 'b1', local(2026, 9, 25, 11), 20),
    span('reading', 'p2', local(2026, 9, 25, 14), 30),
    span('reading', 'p1', local(2026, 9, 26, 9), 30),
  ];
  const next = local(2026, 9, 26);
  assert.deepEqual(totalsWithin(spans, day, next), { reading: 4200, board: 1200, all: 5400 });
  assert.deepEqual(subjectsWithin(spans, day, next).map((s) => [s.subject, s.seconds]), [['p2', 2400], ['p1', 1800], ['b1', 1200]]);
});

test('a day is shaded against fixed marks', () => {
  assert.deepEqual([0, 60, 15 * 60, 3600, 2 * 3600, 5 * 3600].map(shadeOf), [0, 1, 2, 3, 4, 5]);
});

test('durations read as a person would say them', () => {
  assert.deepEqual([0, 20, 60, 40 * 60, 125 * 60, 180 * 60].map(formatDuration),
    ['0 min', 'under a minute', '1 min', '40 min', '2 h 5 min', '3 h']);
  assert.deepEqual([20, 40 * 60, 125 * 60, 180 * 60].map(formatDurationShort), ['1m', '40m', '2h05', '3h']);
  const now = local(2026, 9, 25, 12);
  assert.equal(lastWhen(local(2026, 9, 25, 8).toISOString(), now, 'en-GB'), 'today');
  assert.equal(lastWhen(local(2026, 9, 24, 23).toISOString(), now, 'en-GB'), 'yesterday');
  assert.equal(lastWhen(local(2026, 9, 22, 9).toISOString(), now, 'en-GB'), 'on Tuesday');
  assert.equal(lastWhen(local(2026, 8, 2, 9).toISOString(), now, 'en-GB'), 'on 2 Aug');
});
