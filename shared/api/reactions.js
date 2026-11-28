import { jsonRequest, request } from '../httpClient.js';

// ---------- Reactions ----------

// An emoji set on something said: a thread, a reply in one, a dig, or a
// post in one (`kind`). Whoever sees the thing can set one and take their
// own back; each call answers with the thing's reactions as they now
// stand, for the reader: [{ emoji, count, mine, who }].
export function setReaction(kind, uuid, emoji) {
  return jsonRequest(`/reactions/${kind}/${uuid}`, 'PUT', { emoji });
}

export function takeBackReaction(kind, uuid, emoji) {
  return request(`/reactions/${kind}/${uuid}?emoji=${encodeURIComponent(emoji)}`, { method: 'DELETE' });
}
