// The small things a user's devices share: where they left each paper
// ('place', keyed by the paper's sha256), the papers they pinned to the
// top of their nook ('pin', keyed the same; pins.js) and the tips they
// have seen or dismissed ('flag', keyed by the tip's storage key).
//
// One rule for all of them. Each device keeps the thing itself where it
// always has (the viewer's position key, the tip's key), so it works at
// once and offline; a change is also put in the device outbox, stamped
// with when it was made, and sent when it can. Papol keeps the change made
// last. When a device opens something, it takes Papol's value unless it
// has a change of its own still waiting to go: that one is newer than
// anything Papol has seen from it, and goes next.

import limits from './appLimits.js';
import { accountMark } from './activity.js';
import { currentCredential } from './credentials.js';
import { deviceOutbox } from './deviceOutbox.js';
import { getUserFlags, getUserPlace, sendUserState } from './api/userState.js';

const PREFIX = 'papol.state.change.';
const {
  changes_per_request: CHANGES_PER_REQUEST, age_days_max: AGE_DAYS_MAX, send_delay_ms: SEND_DELAY_MS,
} = limits.user_state;
const DAY_MS = 24 * 60 * 60 * 1000;

function storageOrNull() {
  try { return globalThis.localStorage ?? null; }
  catch { return null; }
}

function signedIn() {
  const credential = currentCredential();
  const storage = storageOrNull();
  return credential && storage ? { account: accountMark(credential), outbox: deviceOutbox(storage, PREFIX) } : null;
}

const id = (kind, key) => `${kind}:${key}`;

let timer = null;
let sending = null;

// Send every change this device holds for the signed-in user, now.
export function sendUserStateNow() {
  if (timer != null) clearTimeout(timer);
  timer = null;
  const here = signedIn();
  if (!here) return Promise.resolve(0);
  if (sending) return sending.then(() => sendUserStateNow());
  const at = Date.now();
  sending = here.outbox.flush(here.account, sendUserState, {
    limit: CHANGES_PER_REQUEST,
    wire: ({ kind, key, value, at: made }) => ({ kind, key, value, at: made }),
    expired: (change) => !(Date.parse(change.at) > at - AGE_DAYS_MAX * DAY_MS),
  }).catch(() => 0).finally(() => { sending = null; });
  return sending;
}

// A change made on this device, sent once things have been still for a
// moment. Signed out, it is this device's alone.
export function rememberState(kind, key, value, at = new Date()) {
  const here = signedIn();
  if (!here) return;
  here.outbox.save(id(kind, key), { account: here.account, kind, key, value, at: at.toISOString() });
  if (timer != null) clearTimeout(timer);
  timer = setTimeout(sendUserStateNow, SEND_DELAY_MS);
}

// This device's change to `key`, still waiting to go, or null.
export function waitingState(kind, key) {
  const here = signedIn();
  return here ? here.outbox.pending(id(kind, key), here.account) : null;
}

// Papol's flags, without those this device has changed and not yet sent:
// [{ key, value }]. Null when Papol cannot be asked.
export async function flagsFromPapol() {
  if (!signedIn()) return null;
  let states;
  try { states = await getUserFlags(); } catch { return null; }
  return states.filter((state) => !waitingState('flag', state.key));
}

// Papol's place for a paper, or null when it has none, cannot be asked,
// or this device has a newer one waiting to go.
export async function placeFromPapol(sha256) {
  if (!signedIn() || waitingState('place', sha256)) return null;
  let state;
  try { state = await getUserPlace(sha256); } catch { return null; }
  return state && !waitingState('place', sha256) ? state : null;
}

// Changes waiting go when the network comes back, and when a window is
// put away or closed, rather than after the pause.
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  window.addEventListener('online', () => { sendUserStateNow(); });
  window.addEventListener('pagehide', () => { sendUserStateNow(); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') sendUserStateNow();
  });
}
