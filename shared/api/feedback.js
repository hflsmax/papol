import { jsonRequest } from '../httpClient.js';

// ---------- Feedback ----------

export function submitFeedback({ content, page, context, contact }) {
  return jsonRequest('/feedback', 'POST', {
    content,
    page: page || null,
    context: context || null,
    contact: contact || null,
  });
}
