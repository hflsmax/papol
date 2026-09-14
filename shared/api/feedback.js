import { jsonRequest } from '../httpClient.js';

// ---------- Feedback ----------

export function submitFeedback({ content, page, contact }) {
  return jsonRequest('/feedback', 'POST', {
    content,
    page: page || null,
    contact: contact || null,
  });
}
