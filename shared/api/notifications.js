import { request } from '../httpClient.js';

// ---------- Notifications ----------

export function getNotifications() {
  return request('/notifications');
}

export function markNotificationRead(uuid) {
  return request(`/notifications/${uuid}/read`, { method: 'POST' });
}

export function markNotificationsRead() {
  return request('/notifications/read', { method: 'POST' });
}

export function getPendingAdminMessages() {
  return request('/admin-messages/pending');
}

export function dismissAdminMessage(uuid) {
  return request(`/admin-messages/${uuid}/dismiss`, { method: 'POST' });
}
