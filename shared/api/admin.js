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

export function adminDbMetrics() {
  return request('/admin/db-metrics');
}

export function adminResetDbMetrics() {
  return request('/admin/db-metrics/reset', { method: 'POST' });
}

export function adminListFeedback() {
  return request('/admin/feedback');
}

export function adminSetFeedbackResolved(uuid, resolved) {
  return jsonRequest(`/admin/feedback/${uuid}`, 'PUT', { resolved });
}
