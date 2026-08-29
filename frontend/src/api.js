import { demoActive, demoRequest } from './demo';
import { appPath } from './base';

// Relative, so it resolves against the app's own base URL — works at / and
// under a proxied subpath like mc-pony.com/papol/.
const API_BASE = appPath('/api');

const TOKEN_KEY = 'papol_token';

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token) {
  if (token) {
    localStorage.setItem(TOKEN_KEY, token);
  } else {
    localStorage.removeItem(TOKEN_KEY);
  }
}

function authHeaders(extra = {}) {
  const token = getToken();
  return token ? { ...extra, Authorization: `Bearer ${token}` } : extra;
}

async function handleResponse(response) {
  if (!response.ok) {
    let message = `Error ${response.status}`;
    try {
      const error = await response.json();
      message = error.detail || message;
    } catch {
      message = await response.text() || message;
    }
    const err = new Error(
      typeof message === 'string' ? message : JSON.stringify(message)
    );
    err.status = response.status;
    throw err;
  }
  if (response.status === 204) return null;
  return response.json();
}

async function request(path, options = {}) {
  // Signing in or registering always talks to the real backend — that is
  // how a demo visitor becomes a real member. So does feedback: a bug a
  // visitor hits in the demo is a real bug.
  const alwaysReal = ['/auth/login', '/auth/register', '/feedback'];
  if (demoActive() && !alwaysReal.some((p) => path.startsWith(p))) {
    return demoRequest(path, options);
  }
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: authHeaders(options.headers || {}),
  });
  return handleResponse(response);
}

function jsonRequest(path, method, body) {
  return request(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// ---------- Auth ----------

export function register(email, displayName, affiliation, password) {
  return jsonRequest('/auth/register', 'POST', {
    email,
    display_name: displayName,
    affiliation: affiliation || null,
    password,
  });
}

export function login(email, password) {
  return jsonRequest('/auth/login', 'POST', { email, password });
}

export function logout() {
  return request('/auth/logout', { method: 'POST' });
}

export function getMe() {
  return request('/auth/me');
}

export function sendPresence() {
  return request('/presence', { method: 'POST' });
}

export function updateProfile(data) {
  return jsonRequest('/auth/profile', 'PUT', data);
}

/**
 * Download everything Papol holds about the reader, as a zip.
 *
 * Fetched rather than linked: the export needs the bearer token, and a
 * plain <a href> cannot carry one. The blob is handed to the browser
 * through a link that is clicked and thrown away — the only way to name a
 * downloaded file from script.
 */
export async function downloadMyData() {
  if (demoActive()) {
    throw new Error(
      'The demo has nothing of yours to export — create a real account first.'
    );
  }
  const response = await fetch(`${API_BASE}/auth/export`, {
    headers: authHeaders(),
  });
  if (!response.ok) {
    let message = `Error ${response.status}`;
    try {
      message = (await response.json()).detail || message;
    } catch {
      /* a failed export may not answer in JSON */
    }
    throw new Error(message);
  }
  // The server names the file; fall back to the same shape if the header
  // is missing (a proxy may strip it).
  const disposition = response.headers.get('Content-Disposition') || '';
  const named = /filename="?([^"]+)"?/.exec(disposition);
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = named ? named[1] : `papol-export-${new Date().toISOString().slice(0, 10)}.zip`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  return blob.size;
}

export function deleteAccount(confirmEmail) {
  return jsonRequest('/auth/account', 'DELETE', { confirm_email: confirmEmail });
}

export function uploadAvatar(file) {
  const formData = new FormData();
  formData.append('file', file);
  return request('/auth/avatar', { method: 'POST', body: formData });
}

export function deleteAvatar() {
  return request('/auth/avatar', { method: 'DELETE' });
}

export function changePassword(currentPassword, newPassword) {
  return jsonRequest('/auth/password', 'PUT', {
    current_password: currentPassword,
    new_password: newPassword,
  });
}

// ---------- Users / spaces ----------

export function listUsers() {
  return request('/users');
}

export function getUserSpace(userId) {
  return request(`/users/${userId}/space`);
}

// ---------- Papers ----------

// Papers are addressed by DOI when they have one, else by numeric id.
export function paperHref(paper) {
  return appPath(`/paper/${paper.doi || paper.id}`);
}

// Uploaded PDFs live in uploads/. Demo papers link to each paper's
// canonical open-access copy; demo-created papers use a bundled placeholder.
export function pdfHref(paper) {
  if (paper.file_path.startsWith('http')) return paper.file_path;
  if (paper.file_path.startsWith('assets/')) return appPath(`/${paper.file_path}`);
  return appPath(`/uploads/${paper.file_path}`);
}

export function listPapers() {
  return request('/papers');
}

// ---------- Boards (private spaces inside the reader's nook) ----------

export function listBoards() {
  return request('/boards');
}

export function createBoard(data) {
  return jsonRequest('/boards', 'POST', data);
}

export function getBoard(id) {
  return request(`/boards/${id}`);
}

export function updateBoard(id, data) {
  return jsonRequest(`/boards/${id}`, 'PUT', data);
}

export function addBoardFile(id, file, caption = '', position = null) {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('caption', caption);
  if (position) {
    formData.append('x', String(position.x));
    formData.append('y', String(position.y));
  }
  return request(`/boards/${id}/files`, { method: 'POST', body: formData });
}

export function deleteBoardItem(id) {
  return request(`/board-items/${id}`, { method: 'DELETE' });
}

export function restoreBoardItem(id) {
  return request(`/board-items/${id}/restore`, { method: 'POST' });
}

export function moveBoardItem(id, x, y) {
  return jsonRequest(`/board-items/${id}`, 'PUT', { x, y });
}

export function updateBoardItem(id, data) {
  return jsonRequest(`/board-items/${id}`, 'PUT', data);
}

export function addBoardYouTube(id, url, x, y) {
  return jsonRequest(`/boards/${id}/youtube`, 'POST', { url, x, y });
}

export function addBoardWebpage(id, url, x, y) {
  return jsonRequest(`/boards/${id}/webpage`, 'POST', { url, x, y });
}

export async function boardFileBlob(item) {
  const response = await fetch(`${API_BASE}/board-items/${item.id}/file`, {
    headers: authHeaders(),
  });
  if (!response.ok) await handleResponse(response);
  return URL.createObjectURL(await response.blob());
}

export async function downloadBoardFile(item) {
  const href = await boardFileBlob(item);
  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.download = item.original_filename || 'board-file';
  anchor.click();
  URL.revokeObjectURL(href);
}

export function extractPaperMetadata(file) {
  const formData = new FormData();
  formData.append('file', file);
  return request('/papers/extract', { method: 'POST', body: formData });
}

export function reextractPaperMetadata(paperId) {
  return request(`/papers/${paperId}/extract-metadata`, { method: 'POST' });
}

export function createPaper(paperData) {
  return jsonRequest('/papers', 'POST', paperData);
}

export function getPaper(id) {
  return request(`/papers/${id}`);
}

export function addToNook(paperId) {
  return request(`/papers/${paperId}/add-to-nook`, { method: 'POST' });
}

export function addPaperEdition(id, file) {
  const formData = new FormData();
  formData.append('file', file);
  return request(`/papers/${id}/editions`, { method: 'POST', body: formData });
}

export function adoptEdition(id, editionId) {
  return jsonRequest(`/papers/${id}/adopt-edition`, 'POST', {
    edition_id: editionId ?? null,
  });
}

export function ignoreEdition(id, editionId) {
  return jsonRequest(`/papers/${id}/ignore-edition`, 'POST', {
    edition_id: editionId ?? null,
  });
}

export function updatePaper(id, data) {
  return jsonRequest(`/papers/${id}`, 'PUT', data);
}

export function deletePaper(id) {
  return request(`/papers/${id}`, { method: 'DELETE' });
}

export function createTag(name) {
  return jsonRequest('/tags', 'POST', { name });
}

export function listTags() {
  return request('/tags');
}

export function deleteTag(tagId) {
  return request(`/tags/${tagId}`, { method: 'DELETE' });
}

export function listShelves() {
  return request('/shelves');
}

export function createShelf(data) {
  return jsonRequest('/shelves', 'POST', data);
}

export function updateShelf(id, data) {
  return jsonRequest(`/shelves/${id}`, 'PUT', data);
}

export function deleteShelf(id) {
  return request(`/shelves/${id}`, { method: 'DELETE' });
}

// ---------- Comments ----------

export function addComment(paperId, content) {
  return jsonRequest(`/papers/${paperId}/comments`, 'POST', { content });
}

export function updateComment(commentId, content) {
  return jsonRequest(`/comments/${commentId}`, 'PUT', { content });
}

export function deleteComment(commentId) {
  return request(`/comments/${commentId}`, { method: 'DELETE' });
}

// ---------- Seminar rooms ----------

export function callSeminar(paperId) {
  return request(`/papers/${paperId}/room`, { method: 'POST' });
}

export function getRoom(roomId) {
  return request(`/rooms/${roomId}`);
}

export function leadRoom(roomId) {
  return request(`/rooms/${roomId}/lead`, { method: 'POST' });
}

export function joinRoom(roomId) {
  return request(`/rooms/${roomId}/join`, { method: 'POST' });
}

export function unhostRoom(roomId) {
  return request(`/rooms/${roomId}/unhost`, { method: 'POST' });
}

export function leaveRoom(roomId, successorId = null) {
  return jsonRequest(`/rooms/${roomId}/leave`, 'POST', {
    successor_id: successorId,
  });
}

export function postRoomMessage(roomId, content) {
  return jsonRequest(`/rooms/${roomId}/messages`, 'POST', { content });
}

export function setRoomAvailability(roomId, availability) {
  return jsonRequest(`/rooms/${roomId}/availability`, 'POST', { availability });
}

export function finishRoom(roomId) {
  return request(`/rooms/${roomId}/finish`, { method: 'POST' });
}

export function announceRoom(roomId, scheduledTime, platform, style, styleDesc = null) {
  return jsonRequest(`/rooms/${roomId}/announce`, 'PUT', {
    scheduled_time: scheduledTime,
    platform,
    style,
    style_desc: styleDesc,
  });
}

// ---------- Notifications ----------

export function getNotifications() {
  return request('/notifications');
}

export function markNotificationRead(id) {
  return request(`/notifications/${id}/read`, { method: 'POST' });
}

export function markNotificationsRead() {
  return request('/notifications/read', { method: 'POST' });
}

// ---------- Feedback ----------

export function submitFeedback({ content, page, contact }) {
  return jsonRequest('/feedback', 'POST', {
    content,
    page: page || null,
    contact: contact || null,
  });
}

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

export function adminActiveUsers() {
  return request('/admin/active-users');
}

export function adminConcurrencySeries() {
  return request('/admin/concurrency-series');
}

export function adminListFeedback() {
  return request('/admin/feedback');
}

export function adminSetFeedbackResolved(id, resolved) {
  return jsonRequest(`/admin/feedback/${id}`, 'PUT', { resolved });
}
