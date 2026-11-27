import { jsonRequest, request } from '../httpClient.js';

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

// People Papol suggests I ask: those in a project with me, and friends
// of my friends.
export function getSuggestions() {
  return request('/friends/suggestions');
}

// Not interested: they are not suggested to me again. Answers with who is left.
export function hideSuggestion(userUuid) {
  return request(`/friends/suggestions/${userUuid}`, { method: 'DELETE' });
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

// A thread in the Lounge: something a friend, or I, sent there from a
// paper. Read for its jacket, it comes with its paper. Replying, and
// taking a reply back, answer with the thread as it now stands.
export function getThread(threadUuid) {
  return request(`/threads/${threadUuid}`);
}

// A thread started in the Lounge itself: words alone, from no paper.
export function startThread(words) {
  return jsonRequest('/threads', 'POST', { words });
}

export function replyInThread(threadUuid, body) {
  return jsonRequest(`/threads/${threadUuid}/replies`, 'POST', { body });
}

export function removeThread(threadUuid) {
  return request(`/threads/${threadUuid}`, { method: 'DELETE' });
}

export function removeThreadReply(replyUuid) {
  return request(`/thread-replies/${replyUuid}`, { method: 'DELETE' });
}

// Where a thread came from: the viewer's address for its paper, on the
// page and at the passage or rectangle it was sent from.
export function threadPlacePath(thread) {
  if (!thread.paper_sha256) return null;
  const place = new URLSearchParams({ pdf: thread.paper_sha256, page: String(thread.page), y: String(thread.y) });
  if (thread.mark) place.set('mark', thread.mark);
  if (thread.box) place.set('box', thread.box);
  return `/viewer/?${place}`;
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
