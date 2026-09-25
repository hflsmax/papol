import { jsonRequest, request } from '../httpClient.js';

// Spans of activity, new or grown (shared/activity.js keeps them until
// they are sent).
export function sendActivity(spans) {
  return jsonRequest('/activity', 'POST', { spans });
}

// The spans in [from, to), two Dates, with what each paper and board is
// called and when the user's record begins.
export function getActivity(from, to) {
  const query = new URLSearchParams({ from: from.toISOString(), to: to.toISOString() });
  return request(`/activity?${query}`);
}

// One paper's or board's effort: its total, when it began and last was,
// and its spans of the last weeks.
export function getSubjectActivity(kind, subject) {
  return request(`/activity/${kind}/${subject}`);
}
