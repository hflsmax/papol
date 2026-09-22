import { jsonRequest, request } from '../httpClient.js';

// ---------- Admin ----------

export function adminListTables() {
  return request('/admin/tables');
}

export function adminGetTable(name) {
  return request(`/admin/tables/${name}`);
}

export function adminUpdateRow(name, pk, data) {
  return jsonRequest(`/admin/tables/${name}/rows/${encodeURIComponent(pk)}`, 'PUT', data);
}

export function adminDeleteRow(name, pk) {
  return request(`/admin/tables/${name}/rows/${encodeURIComponent(pk)}`, {
    method: 'DELETE',
  });
}

export function adminRunSql(query) {
  return jsonRequest('/admin/sql', 'POST', { query });
}

export function adminListFeedback() {
  return request('/admin/feedback');
}

export function adminSetFeedbackResolved(uuid, resolved) {
  return jsonRequest(`/admin/feedback/${uuid}`, 'PUT', { resolved });
}

export function adminSendMessage(content, userUuids = null) {
  return jsonRequest('/admin/messages', 'POST', {
    content,
    ...(userUuids == null ? {} : { user_uuids: userUuids }),
  });
}

export function adminListMessageRecipients() {
  return request('/admin/message-recipients');
}

export function adminSendAnnouncement(subject, body, { userUuids = null, test = false } = {}) {
  return jsonRequest('/admin/announcements', 'POST', {
    subject,
    body,
    test,
    ...(userUuids == null ? {} : { user_uuids: userUuids }),
  });
}

export function adminListEmails() {
  return request('/admin/emails');
}

export function adminGetEmail(id) {
  return request(`/admin/emails/${encodeURIComponent(id)}`);
}
