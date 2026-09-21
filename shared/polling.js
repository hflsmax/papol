// Asking again until the answer has settled.
//
// The server takes on work it finishes after answering — reading an
// upload, the reference pass over a paper, a card's picture — and a
// client learns the outcome by asking again. Every such wait in Papol is
// this one loop: ask, hand each answer on, stop when it has settled, and
// otherwise wait a little longer than last time before asking again. A
// metadata lookup answers in a second and a long paper takes a minute;
// neither deserves a request every half second for a minute, and the
// schedule below asks about a dozen times over that minute.
//
// An AbortSignal ends the waiting, not the work: the job goes on, and
// whoever asks next gets its outcome.

export const FIRST_WAIT_MS = 750;
export const BACKOFF = 1.5;
export const LONGEST_WAIT_MS = 5000;

function aborted(signal) {
  return signal.reason instanceof Error ? signal.reason : new DOMException('Aborted', 'AbortError');
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(aborted(signal)); return; }
    const timer = setTimeout(() => { signal?.removeEventListener('abort', stop); resolve(); }, ms);
    const stop = () => { clearTimeout(timer); reject(aborted(signal)); };
    signal?.addEventListener('abort', stop, { once: true });
  });
}

// Resolves with the first answer for which `settled(answer)` is true.
// `onAnswer` sees every answer, settled or not, so a screen can show
// "pending" while it waits. Rejects with the signal's reason when aborted,
// and with whatever `ask` rejects with — an answer that cannot be had is
// not one to keep asking for.
export async function pollUntil(ask, settled, {
  signal, onAnswer, firstWaitMs = FIRST_WAIT_MS, backoff = BACKOFF, longestWaitMs = LONGEST_WAIT_MS,
} = {}) {
  let wait = firstWaitMs;
  for (;;) {
    if (signal?.aborted) throw aborted(signal);
    const answer = await ask();
    if (signal?.aborted) throw aborted(signal);
    onAnswer?.(answer);
    if (settled(answer)) return answer;
    await sleep(wait, signal);
    wait = Math.min(wait * backoff, longestWaitMs);
  }
}
