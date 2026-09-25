// The time a user spends with a paper or a board, recorded where it is
// spent: in the viewer with a paper open, on one of their boards. There is
// one rule. Time runs from one use of the paper to the next — a scroll, a
// key, the pointer, or bringing its window back to the front — and a pause
// between two uses counts if it is no longer than GAP_MS, whether the
// reader sat still over a page or went off to another tab to look
// something up. A longer pause, or one spent on another paper or board in
// Papol (which counted it already), ends the stretch at the last use.
// Nothing after the last use counts unless the reader comes back.
//
// A stretch of that time is a span. The window that sees it names it and
// keeps it in this browser's storage until Papol has it, sending it again
// as it grows (the server keeps the longest), so time spent offline, or in
// a window closed before it could send, arrives with the next window that
// can. Each span is stored under its own key, so two windows never write
// over each other's.

import limits from './appLimits.js';
import { currentCredential } from './credentials.js';
import { sendActivity } from './api/activity.js';

const {
  gap_ms: GAP_MS, tick_ms: TICK_MS, span_max_ms: SPAN_MAX_MS, flush_ms: FLUSH_MS,
  spans_per_request: SPANS_PER_REQUEST, span_age_days_max: SPAN_AGE_DAYS_MAX,
} = limits.activity;

const PREFIX = 'papol.activity.span.';
// Which Papol window last counted time, and when: a window coming back
// from time away asks it whether the time away went to another paper.
const LAST_COUNTED = 'papol.activity.lastCounted';
const ANNOUNCE_MS = 5000;
const DAY_MS = 24 * 60 * 60 * 1000;
// A span still marked open that has not grown for this long belongs to a
// window that is gone: it is finished, whatever it says.
const ABANDONED_MS = 5 * 60 * 1000;

// Which account a span was spent under, without keeping the credential
// twice: a span recorded before signing out is never sent as someone
// else's.
export function accountMark(credential) {
  let hash = 5381;
  for (let i = 0; i < credential.length; i++) hash = ((hash * 33) ^ credential.charCodeAt(i)) >>> 0;
  return hash.toString(36);
}

// The rule, as a clock. `use()` is called on each use of the paper while
// its window is in front; `persist()` every few seconds writes the span if
// it grew, and `end()` closes it. A use within GAP_MS of the last carries
// the span on to it, unless `elsewhere(since)` says another paper counted
// time since; any other use begins a new span there. A span is cut at
// SPAN_MAX_MS and the next carries on from where it stopped, so no span is
// so long that laying it out on a day's hours needs to guess.
export function activityTracker({
  kind, subject, account, save, now = Date.now, newId = () => crypto.randomUUID(),
  announce = () => {}, elsewhere = () => false,
}) {
  let span = null;
  let dirty = false;

  const record = () => ({
    uuid: span.uuid, kind, subject, account, open: span.open,
    started_at: new Date(span.startMs).toISOString(),
    ended_at: new Date(span.lastMs).toISOString(),
    seconds: Math.round((span.lastMs - span.startMs) / 1000),
  });
  const persist = () => {
    if (span && dirty && span.lastMs > span.startMs) save(record());
    dirty = false;
  };
  const end = () => {
    if (!span) return;
    span.open = false;
    dirty = true;
    persist();
    span = null;
  };
  const begin = (at) => { span = { uuid: newId(), startMs: at, lastMs: at, open: true }; };

  return {
    use() {
      const at = now();
      if (span && at - span.lastMs <= GAP_MS && !elsewhere(span.lastMs)) {
        if (at - span.startMs > SPAN_MAX_MS) {
          const from = span.lastMs;
          end();
          begin(from);
        }
        span.lastMs = at;
      } else {
        end();
        begin(at);
      }
      dirty = true;
      announce(at);
    },
    persist,
    end,
  };
}

// The spans this browser holds, in `storage`.
export function activityOutbox(storage) {
  const entries = () => {
    const found = [];
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (!key?.startsWith(PREFIX)) continue;
      const text = storage.getItem(key);
      try { found.push({ key, text, span: JSON.parse(text) }); }
      catch { found.push({ key, text, span: null }); }
    }
    return found;
  };
  const drop = (entry) => {
    // Only if no window has grown it since it was read.
    if (storage.getItem(entry.key) === entry.text) storage.removeItem(entry.key);
  };

  return {
    save(span) {
      try { storage.setItem(PREFIX + span.uuid, JSON.stringify(span)); }
      catch { /* storage full or refused: this stretch goes unrecorded */ }
    },

    // Send what this account has waiting; forget what Papol now holds
    // and has finished growing, and what is too old for Papol to take.
    async flush(account, send, at = Date.now()) {
      const mine = [];
      for (const entry of entries()) {
        const ended = Date.parse(entry.span?.ended_at);
        if (!entry.span || !Number.isFinite(ended) || ended < at - SPAN_AGE_DAYS_MAX * DAY_MS) drop(entry);
        else if (entry.span.account === account) mine.push({ ...entry, finished: !entry.span.open || ended < at - ABANDONED_MS });
      }
      const batch = mine.slice(0, SPANS_PER_REQUEST);
      if (!batch.length) return 0;
      try {
        await send(batch.map(({ span: { uuid, kind, subject, started_at, ended_at, seconds } }) => ({ uuid, kind, subject, started_at, ended_at, seconds })));
      } catch (failure) {
        // Offline, or Papol unwell: keep them for next time. Refused
        // outright: keeping them would only refuse them again.
        if (failure?.status !== 400 && failure?.status !== 422) return 0;
      }
      for (const entry of batch) if (entry.finished) drop(entry);
      return batch.length;
    },
  };
}

function storageOrNull() {
  try { return globalThis.localStorage ?? null; }
  catch { return null; }
}

// Send whatever this browser holds for the signed-in user now, as the
// activity panel does before it asks what there is: the time in a window
// closed before it could send is theirs to see too.
export async function flushActivity() {
  const credential = currentCredential();
  const storage = storageOrNull();
  if (!credential || !storage) return;
  await activityOutbox(storage).flush(accountMark(credential), sendActivity).catch(() => {});
}

const INPUTS = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart'];

// Record the time spent here on `subject`, a paper's sha256 (kind
// 'reading') or a board's uuid (kind 'board'), until the returned function
// is called. Only a signed-in user's time is recorded.
export function recordActivity({ kind, subject }) {
  const credential = currentCredential();
  const storage = storageOrNull();
  if (!credential || !subject || !storage || typeof document === 'undefined') return () => {};
  const account = accountMark(credential);
  const outbox = activityOutbox(storage);
  const windowId = crypto.randomUUID();
  // Which window last used its paper, and when: at most every few seconds,
  // so the key stays cheap however busy the pointer is.
  let announced = 0;
  const announce = (at) => {
    if (at - announced < ANNOUNCE_MS) return;
    announced = at;
    try { storage.setItem(LAST_COUNTED, JSON.stringify({ window: windowId, at })); }
    catch { /* only a hint */ }
  };
  const elsewhere = (since) => {
    try {
      const last = JSON.parse(storage.getItem(LAST_COUNTED));
      return Boolean(last && last.window !== windowId && last.at > since);
    } catch { return false; }
  };
  const tracker = activityTracker({ kind, subject, account, save: outbox.save, announce, elsewhere });
  const present = () => document.visibilityState === 'visible' && document.hasFocus();

  let sending = false;
  const flush = () => {
    if (sending || currentCredential() !== credential) return;
    sending = true;
    outbox.flush(account, sendActivity).catch(() => {}).finally(() => { sending = false; });
  };
  // Input reaches a window that is not in front too — the pointer passing
  // over it — so a use is only what happens while it is.
  const use = () => { if (present()) tracker.use(); };
  const onVisibility = () => {
    use();
    if (document.visibilityState === 'hidden') { tracker.persist(); flush(); }
  };

  for (const name of INPUTS) window.addEventListener(name, use, { passive: true, capture: true });
  document.addEventListener('scroll', use, { passive: true, capture: true });
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('focus', use);
  window.addEventListener('pagehide', onVisibility);
  const persisting = setInterval(() => tracker.persist(), TICK_MS);
  const flushing = setInterval(flush, FLUSH_MS);
  // Opening the paper is using it.
  use();
  flush();

  return () => {
    clearInterval(persisting);
    clearInterval(flushing);
    for (const name of INPUTS) window.removeEventListener(name, use, { capture: true });
    document.removeEventListener('scroll', use, { capture: true });
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('focus', use);
    window.removeEventListener('pagehide', onVisibility);
    tracker.end();
    flush();
  };
}
