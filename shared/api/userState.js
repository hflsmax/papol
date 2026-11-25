import { jsonRequest, request } from '../httpClient.js';

// Changes to the small things a user's devices share: [{ kind, key, value, at }].
// Papol keeps, for each, the change made last.
export function sendUserState(changes) {
  return jsonRequest('/user-state', 'POST', { changes });
}

// Every flag the user has: [{ key, value, at }], value null when unset.
export async function getUserFlags() {
  return (await request('/user-state/flag')).states;
}

// Where the user left a paper: { key, value: { page, x, y, scale }, at }, or null.
export async function getUserPlace(sha256) {
  return (await request(`/user-state/place/${sha256}`)).state;
}

// Every paper the user pinned or unpinned: [{ key, value, at }], the key
// the paper's sha256 and the value true, or null once unpinned.
export async function getUserPins() {
  return (await request('/user-state/pin')).states;
}
