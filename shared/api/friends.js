import { request } from '../httpClient.js';

// ---------- Friends and the Lounge ----------

// Friends are shared, online-only state, as projects are: Papol macOS asks
// the server for them rather than keeping them in its private replica.

// Who my friends are, who waits for my answer, and whom I asked. Every call below
// that changes any of it answers with the same shape.
export function getFriends() {
  return request('/friends');
}

export function askFriend(userUuid) {
  return request(`/friends/${userUuid}`, { method: 'POST' });
}

export function acceptFriend(userUuid) {
  return request(`/friends/${userUuid}/accept`, { method: 'POST' });
}

// Not now: nothing is said to whoever asked.
export function declineFriend(userUuid) {
  return request(`/friends/${userUuid}/decline`, { method: 'POST' });
}

// Ends a friendship, or takes back a request not yet answered.
export function endFriend(userUuid) {
  return request(`/friends/${userUuid}`, { method: 'DELETE' });
}

// People to ask to be friends, by name or address.
export function findPeople(query) {
  return request(`/friends/people?q=${encodeURIComponent(query)}`);
}


// The Lounge: my friends' news.
export function getRoom() {
  return request('/room');
}

export function markRoomSeen() {
  return request('/room/seen', { method: 'POST' });
}

export function getRoomNews() {
  return request('/room/news');
}

export function askToJoinProject(projectUuid) {
  return request(`/projects/${projectUuid}/ask`, { method: 'POST' });
}

// What my friends dug on a paper and on their marks on it.
export function friendDigsOn(paperName) {
  return request(`/papers/${paperName}/friend-digs`);
}

// What stands between me and someone, from what getFriends answered:
// 'friend', 'requested' (I asked), 'asked' (they asked me), or null.
export function relationTo(friends, userUuid) {
  if (!friends || !userUuid) return null;
  if (friends.friends.some((f) => f.user.uuid === userUuid)) return 'friend';
  if (friends.sent.includes(userUuid)) return 'requested';
  if (friends.requests.some((r) => r.user.uuid === userUuid)) return 'asked';
  return null;
}
