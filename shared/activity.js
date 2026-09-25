// The time a user spends with a paper or a board, recorded where it is
// spent: in the viewer with a paper open, on one of their boards. Time
// counts while the window is in front of them and they have touched it —
// a scroll, a key, the pointer — in the last few minutes; a paper left
// open behind another window, or on a desk nobody is at, adds nothing.
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
  idle_ms: IDLE_MS, tick_ms: TICK_MS, span_max_ms: SPAN_MAX_MS, flush_ms: FLUSH_MS, away_grace_ms: AWAY_GRACE_MS,
  spans_per_request: SPANS_PER_REQUEST, span_age_days_max: SPAN_AGE_DAYS_MAX,
} = limits.activity;

const PREFIX = 'papol.activity.span.';
// Which Papol window last counted time, and when: a window coming back
// from time away asks it whether the time away went to another paper.
const LAST_COUNTED = 'papol.activity.lastCounted';
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

// The clock. `tick(present)` is called every few seconds with whether the
// window is in front of the user, `touch()` on every input; it opens a
// span on the first tick that counts, adds the time since the last tick
// to it on each that follows, and ends it when the user stops using it.
//
// Reading is not only looking at the paper: a reader goes off to another
// tab or app to look something up and comes back. So leaving does not end
// the span. It is held open from the moment the window was left, and a
// return within AWAY_GRACE_MS carries it on with the time away counted as
// reading it — unless that time went to another paper or board in Papol,
// which counted it already (`elsewhere(since)` says so), in which case the
// span ends where it was left and a new one begins. Not coming back in
// time ends it where it was left, and the time away is not counted.
//
// A gap in the ticks while the window was in front — the computer asleep,
// the timers held back — is not time away that was seen to begin, and is
// never counted. A span is cut at SPAN_MAX_MS and the next carries on from
// where it stopped, so no span is so long that laying it out on a day's
// hours needs to guess.
export function activityTracker({
  kind, subject, account, save, now = Date.now, newId = () => crypto.randomUUID(),
  announce = () => {}, elsewhere = () => false,
}) {
  let lastInput = now();
  let span = null;
  // When the window was left, while a span waits for it to come back.
  let leftAt = null;

  const record = () => ({
    uuid: span.uuid, kind, subject, account, open: span.open,
    started_at: new Date(span.startMs).toISOString(),
    ended_at: new Date(span.lastMs).toISOString(),
    seconds: Math.round(span.ms / 1000),
  });
  const end = () => {
    leftAt = null;
    if (!span) return;
    span.open = false;
    if (span.ms > 0) save(record());
    span = null;
  };
  const grow = (at) => {
    span.ms += at - span.lastMs;
    span.lastMs = at;
    if (span.ms > 0) save(record());
  };

  return {
    touch() { lastInput = now(); },
    tick(present) {
      const at = now();
      if (!present) {
        if (!span) return;
        if (leftAt == null) {
          // Just left: what ran up to now counts, if the ticks were keeping up.
          if (at - span.lastMs <= 2 * TICK_MS) grow(at);
          leftAt = span.lastMs;
        } else if (at - leftAt > AWAY_GRACE_MS) {
          end();
        }
        return;
      }
      if (leftAt != null) {
        // Back. Coming back is using it.
        lastInput = at;
        const bridged = at - leftAt <= AWAY_GRACE_MS && !elsewhere(leftAt);
        leftAt = null;
        if (bridged) {
          if (at - span.startMs >= SPAN_MAX_MS) {
            const from = span.lastMs;
            end();
            span = { uuid: newId(), startMs: from, lastMs: from, ms: 0, open: true };
          }
          grow(at);
          announce(at);
          return;
        }
        end();
      }
      if (at - lastInput >= IDLE_MS) { end(); return; }
      if (span && at - span.lastMs > 2 * TICK_MS) end();
      let from = at;
      if (span && at - span.startMs >= SPAN_MAX_MS) { from = span.lastMs; end(); }
      if (!span) span = { uuid: newId(), startMs: from, lastMs: from, ms: 0, open: true };
      grow(at);
      announce(at);
    },
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
  // Written at most every few seconds by whichever window is counting, so
  // the key stays cheap however many windows are open.
  const announce = (at) => {
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
  const touch = () => tracker.touch();
  const tick = () => tracker.tick(present());
  const onVisibility = () => {
    tick();
    if (document.visibilityState === 'hidden') flush();
  };

  for (const name of INPUTS) window.addEventListener(name, touch, { passive: true, capture: true });
  document.addEventListener('scroll', touch, { passive: true, capture: true });
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('focus', tick);
  window.addEventListener('blur', tick);
  window.addEventListener('pagehide', onVisibility);
  const ticking = setInterval(tick, TICK_MS);
  const flushing = setInterval(flush, FLUSH_MS);
  flush();

  return () => {
    clearInterval(ticking);
    clearInterval(flushing);
    for (const name of INPUTS) window.removeEventListener(name, touch, { capture: true });
    document.removeEventListener('scroll', touch, { capture: true });
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('focus', tick);
    window.removeEventListener('blur', tick);
    window.removeEventListener('pagehide', onVisibility);
    tick();
    tracker.end();
    flush();
  };
}
