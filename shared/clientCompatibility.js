// Whether this build can still talk to the server it is pointed at.
//
// Two answers: `supported`, and `incompatible` (this build was made for
// another schema than the one the server serves). Being incompatible stops
// synchronization and nothing else — the user keeps their papers, their
// annotations, and everything already on this computer.
//
// Only a real answer from the server moves this. A refused connection, a
// timeout, or offline mode leaves the last known verdict exactly where it
// was: being unreachable is not the same as being obsolete, and a user on
// a train must not be told to go and reinstall.

import { getClientRequirements } from './api/clientRequirements.js';

const SUPPORTED = 'supported';
export const INCOMPATIBLE = 'incompatible';

const CACHE_KEY = 'papol.clientCompatibility';
export const COMPATIBILITY_EVENT = 'papol-client-compatibility';

const VERDICTS = new Set([SUPPORTED, INCOMPATIBLE]);

let state = { verdict: SUPPORTED, downloadUrl: null };

function readCache() {
  try {
    const stored = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
    if (stored && VERDICTS.has(stored.verdict)) return stored;
  } catch { /* storage can be unavailable; an unknown verdict is supported */ }
  return null;
}

function writeCache(next) {
  try {
    // A supported answer is the absence of news, not news worth keeping.
    if (next.verdict === SUPPORTED) localStorage.removeItem(CACHE_KEY);
    else localStorage.setItem(CACHE_KEY, JSON.stringify(next));
  } catch { /* best effort */ }
}

function announce(next) {
  state = next;
  writeCache(next);
  try {
    window.dispatchEvent(new CustomEvent(COMPATIBILITY_EVENT, { detail: next }));
  } catch { /* no DOM */ }
}

export function getClientCompatibility() {
  return state;
}

// The cached verdict, so a window that opens offline still shows the bar it
// showed yesterday rather than pretending all is well.
export function hydrateClientCompatibility() {
  const stored = readCache();
  if (stored) state = stored;
  return state;
}

// Called when the server itself has answered, from the startup check or
// from a 426 on the synchronization path.
export function setClientCompatibility({ verdict, downloadUrl = null }) {
  if (!VERDICTS.has(verdict)) return state;
  announce({ verdict, downloadUrl });
  return state;
}

// Ask the server where this build stands. Resolves to the verdict; never
// rejects, because a failed check is not a verdict.
export async function checkClientCompatibility() {
  try {
    const asked = await getClientRequirements();
    return setClientCompatibility({ verdict: asked.verdict, downloadUrl: asked.download_url });
  } catch {
    return state;
  }
}
