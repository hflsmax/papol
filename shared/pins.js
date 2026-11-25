// The papers a user pinned to the top of their nook.
//
// One of the small things a user's devices share (userState.js, kind
// 'pin', keyed by the paper's sha256): kept here in this device's storage,
// so the nook is ordered at once and offline, and each change sent to Papol
// when it can be, where the change made last wins. Not a column on the
// copy: the nook's order is not part of the paper's record, and a pin made
// on the website shows in the Mac app without the replica learning a field.

import { accountMark } from './activity.js';
import { currentCredential } from './credentials.js';
import { getUserPins } from './api/userState.js';
import { rememberState, waitingState } from './userState.js';

const KEY = 'papol.pins';

// Told on `window` when the pinned papers changed here, for a list
// already showing to order itself again.
export const PINS_CHANGED = 'papol:pins-changed';

function storageOrNull() {
  try { return globalThis.localStorage ?? null; }
  catch { return null; }
}

function account() {
  const credential = currentCredential();
  return credential ? accountMark(credential) : null;
}

// What this device holds, if it is the signed-in user's.
function held(storage, mine) {
  try {
    const kept = JSON.parse(storage.getItem(KEY));
    return kept?.account === mine && Array.isArray(kept.pinned) ? kept.pinned.filter((each) => typeof each === 'string') : [];
  } catch { return []; }
}

function keep(storage, mine, pinned) {
  try { storage.setItem(KEY, JSON.stringify({ account: mine, pinned: [...pinned].sort() })); }
  catch { return false; /* storage full or refused */ }
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') window.dispatchEvent(new Event(PINS_CHANGED));
  return true;
}

// The sha256 of every paper the signed-in user has pinned, as this device
// knows them. Signed out, none.
export function pinnedPapers() {
  const storage = storageOrNull();
  const mine = account();
  return new Set(storage && mine ? held(storage, mine) : []);
}

// Pin a paper, or unpin it: here at once, and on the user's other devices
// once Papol has it. Answers whether it could be kept.
export function setPaperPinned(sha256, on) {
  const storage = storageOrNull();
  const mine = account();
  if (!storage || !mine || typeof sha256 !== 'string') return false;
  const paper = sha256.toLowerCase();
  const pinned = new Set(held(storage, mine));
  if (on) pinned.add(paper);
  else pinned.delete(paper);
  if (!keep(storage, mine, pinned)) return false;
  rememberState('pin', paper, on ? true : null);
  return true;
}

// What the user's other devices pinned and unpinned, taken here. A paper
// this device changed and has not yet sent keeps its own answer; for every
// other paper Papol's is the answer. Returns whether anything changed here.
export async function takePinsFromPapol() {
  const storage = storageOrNull();
  const mine = account();
  if (!storage || !mine) return false;
  let states;
  try { states = await getUserPins(); } catch { return false; }
  if (account() !== mine) return false;
  const papol = new Map(states.map((state) => [state.key, state.value === true]));
  const before = held(storage, mine);
  const pinned = new Set();
  for (const paper of new Set([...papol.keys(), ...before])) {
    const waiting = waitingState('pin', paper);
    if (waiting ? waiting.value === true : papol.get(paper) === true) pinned.add(paper);
  }
  if (pinned.size === before.length && before.every((paper) => pinned.has(paper))) return false;
  return keep(storage, mine, pinned);
}
