import { jsonRequest, request } from '../httpClient.js';

// ---------- Friends and the Common room ----------

// Friends are shared, online-only state, as projects are: Papol macOS asks
// the server for them rather than keeping them in its private replica.

// Who my friends are, who waits for my answer, whom I asked, my friend
// link and whether my friends see what I am reading. Every call below
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

export function openFriendLink() {
  return request('/friends/link', { method: 'POST' });
}

export function closeFriendLink() {
  return request('/friends/link', { method: 'DELETE' });
}

export function previewFriendLink(code) {
  return request(`/friend-links/${code}`);
}

export function acceptFriendLink(code) {
  return request(`/friend-links/${code}`, { method: 'POST' });
}

export function shareReading(sharesReading) {
  return jsonRequest('/friends/settings', 'PUT', { shares_reading: sharesReading });
}

export function hideSuggestion(userUuid) {
  return request(`/friends/suggestions/${userUuid}/hide`, { method: 'POST' });
}

// The Common room: `view` is friends or everyone, `order` latest or most.
export function getRoom({ view = 'friends', order = 'latest' } = {}) {
  return request(`/room?view=${view}&order=${order}`);
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

export function friendLinkPath(code) {
  return `/friends/join/${code}`;
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
