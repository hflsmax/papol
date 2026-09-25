// What the activity panel draws, worked out from the spans Papol sends:
// the day, week or month around a date in the user's own calendar, and
// how the time in each span falls across it. All in local time — the
// server keeps instants, and the reader's day is the one they lived.

export const VIEWS = ['day', 'week', 'month'];
export const KINDS = ['reading', 'board'];

const HOUR_S = 3600;

function midnight(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date, n) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + n);
}

// Weeks begin on Monday.
function mondayOf(date) {
  const day = midnight(date);
  return addDays(day, -((day.getDay() + 6) % 7));
}

// The period of `view` that holds `date`: where it starts and ends, its
// days, and the range to ask Papol for. A month is asked for by the whole
// weeks its calendar shows, so the days either side are filled in too.
export function periodOf(view, date) {
  if (view === 'day') {
    const start = midnight(date), end = addDays(start, 1);
    return { view, start, end, days: [start], from: start, to: end };
  }
  if (view === 'week') {
    const start = mondayOf(date), end = addDays(start, 7);
    return { view, start, end, days: Array.from({ length: 7 }, (_, i) => addDays(start, i)), from: start, to: end };
  }
  const start = new Date(date.getFullYear(), date.getMonth(), 1);
  const end = new Date(date.getFullYear(), date.getMonth() + 1, 1);
  const from = mondayOf(start), to = mondayOf(addDays(end, 6));
  const days = [];
  for (let day = from; day < to; day = addDays(day, 1)) days.push(day);
  return { view, start, end, days, from, to };
}

// The date `n` periods on from `date`.
export function stepPeriod(view, date, n) {
  if (view === 'day') return addDays(date, n);
  if (view === 'week') return addDays(date, 7 * n);
  return new Date(date.getFullYear(), date.getMonth() + n, 1);
}

export function periodLabel(period, locale) {
  const { view, start, end } = period;
  if (view === 'day') return start.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  if (view === 'month') return start.toLocaleDateString(locale, { month: 'long', year: 'numeric' });
  // The locale's own way of saying a run of days: "21–27 September 2026",
  // "Sep 21 – 27, 2026".
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', year: 'numeric' }).formatRange(start, addDays(end, -1));
}

// How much of a span's counted time falls in [from, to): its seconds
// shared out over its length, since a span is at most half an hour and
// nothing says which of its minutes were the idle ones.
export function secondsWithin(span, from, to) {
  const started = Date.parse(span.started_at), ended = Date.parse(span.ended_at);
  const lo = Math.max(started, +from), hi = Math.min(ended, +to);
  if (ended <= started) return started >= +from && started < +to ? span.seconds : 0;
  return hi > lo ? span.seconds * (hi - lo) / (ended - started) : 0;
}

// Seconds by kind in [from, to), and the total.
export function totalsWithin(spans, from, to) {
  const totals = { reading: 0, board: 0, all: 0 };
  for (const span of spans) {
    const seconds = secondsWithin(span, from, to);
    totals[span.kind] += seconds;
    totals.all += seconds;
  }
  return totals;
}

// Each paper and board with time in [from, to), most time first.
export function subjectsWithin(spans, from, to) {
  const found = new Map();
  for (const span of spans) {
    const seconds = secondsWithin(span, from, to);
    if (seconds <= 0) continue;
    const key = `${span.kind}:${span.subject}`;
    const entry = found.get(key) ?? { kind: span.kind, subject: span.subject, seconds: 0 };
    entry.seconds += seconds;
    found.set(key, entry);
  }
  return [...found.values()].sort((a, b) => b.seconds - a.seconds || a.subject.localeCompare(b.subject));
}

// The spans that touch the day starting at `day`, as fractions of it: what
// the timeline lays across its width. A day is measured by its own
// length, so a day that loses or gains an hour to the clocks is still
// drawn edge to edge.
export function blocksOfDay(spans, day) {
  const from = midnight(day), to = addDays(from, 1);
  const length = to - from;
  const blocks = [];
  for (const span of spans) {
    const started = Date.parse(span.started_at), ended = Date.parse(span.ended_at);
    if (ended < +from || started >= +to) continue;
    const lo = Math.max(started, +from), hi = Math.min(ended, +to);
    blocks.push({
      kind: span.kind, subject: span.subject, started: new Date(lo), ended: new Date(hi),
      left: (lo - from) / length, width: (hi - lo) / length, seconds: secondsWithin(span, from, to),
    });
  }
  return blocks;
}

// A day's shade on the month's calendar: 0 for nothing, then five steps
// at fixed marks, so a month is compared with every other month rather
// than with itself.
export const SHADE_MARKS = [0, 15 * 60, HOUR_S, 2 * HOUR_S, 4 * HOUR_S];

export function shadeOf(seconds) {
  if (!(seconds > 0)) return 0;
  let step = 0;
  for (const mark of SHADE_MARKS) if (seconds >= mark) step++;
  return step;
}

// "40 min", "2 h 5 min", "3 h". Under a minute that was counted at all
// is "under a minute", which a reader can believe; "0 min" says nothing.
export function formatDuration(seconds) {
  const minutes = Math.round(seconds / 60);
  if (seconds > 0 && minutes === 0) return 'under a minute';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60), rest = minutes % 60;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

// The same, as short as it can go, for where room is tight: "40m",
// "2h05", "3h".
export function formatDurationShort(seconds) {
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${Math.max(minutes, seconds > 0 ? 1 : 0)}m`;
  const hours = Math.floor(minutes / 60), rest = minutes % 60;
  return rest ? `${hours}h${String(rest).padStart(2, '0')}` : `${hours}h`;
}

// When something last was, as a person says it: "today", "yesterday",
// "on Tuesday" within the week, else the date.
export function lastWhen(iso, now = new Date(), locale) {
  const at = new Date(iso);
  const days = Math.round((midnight(now) - midnight(at)) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `on ${at.toLocaleDateString(locale, { weekday: 'long' })}`;
  const sameYear = at.getFullYear() === now.getFullYear();
  return `on ${at.toLocaleDateString(locale, sameYear ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' })}`;
}

export function clockTime(date, locale) {
  return date.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' });
}

// Which colour each paper wears in a period's timelines: the four that
// took the most time get one of four hues, the rest share "other papers",
// and boards are drawn apart (hatched) whatever they are. Four, because
// blocks of any two papers may sit side by side, and four is as many hues
// as stay distinct from every other one, for colour-blind eyes too. A
// paper keeps the hue its digest points to unless a paper with more time
// already has it, so it tends to wear the same colour week to week.
export const PAPER_HUES = 4;

function hueOf(subject) {
  let hash = 0;
  for (let i = 0; i < subject.length; i++) hash = (hash * 31 + subject.charCodeAt(i)) >>> 0;
  return hash % PAPER_HUES;
}

// `subjects` most time first, as subjectsWithin gives them. Answers a
// map from `kind:subject` to 'paper-1'…'paper-4', 'other' or 'board'.
export function coloursFor(subjects) {
  const colours = new Map();
  const taken = new Set();
  for (const { kind, subject } of subjects) {
    const key = `${kind}:${subject}`;
    if (kind === 'board') { colours.set(key, 'board'); continue; }
    if (taken.size === PAPER_HUES) { colours.set(key, 'other'); continue; }
    let hue = hueOf(subject);
    while (taken.has(hue)) hue = (hue + 1) % PAPER_HUES;
    taken.add(hue);
    colours.set(key, `paper-${hue + 1}`);
  }
  return colours;
}

// A paper's own recent days, newest first: when the day's first span
// began and its last ended, and the time in between that counted. A span
// belongs to the day it began.
export function daysOf(spans) {
  const byDay = new Map();
  for (const span of spans) {
    const started = new Date(span.started_at), ended = new Date(span.ended_at);
    const day = midnight(started);
    const entry = byDay.get(+day) ?? { day, first: started, last: ended, seconds: 0 };
    if (started < entry.first) entry.first = started;
    if (ended > entry.last) entry.last = ended;
    entry.seconds += span.seconds;
    byDay.set(+day, entry);
  }
  return [...byDay.values()].sort((a, b) => b.day - a.day);
}

// The last `weeks` whole weeks to today, Monday first, as the columns of
// a small calendar: each day with the seconds it held, or null for a day
// still to come.
export function recentWeeks(spans, weeks, now = new Date()) {
  const start = addDays(mondayOf(now), -7 * (weeks - 1));
  const today = midnight(now);
  return Array.from({ length: weeks * 7 }, (_, i) => {
    const day = addDays(start, i);
    return { day, seconds: day > today ? null : totalsWithin(spans, day, addDays(day, 1)).all };
  });
}

// A day as the nearest words for it: "Today", "Yesterday", the weekday
// within the week, else its date.
export function dayName(day, now = new Date(), locale) {
  const days = Math.round((midnight(now) - midnight(day)) / 86_400_000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days > 1 && days < 7) return day.toLocaleDateString(locale, { weekday: 'long' });
  return day.toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short' });
}
