import { demoActive, demoRequest } from './demo';
import { appPath, backendPath } from './base';
import { fetch as tauriHttpFetch } from '@tauri-apps/plugin-http';
import { IS_DESKTOP } from '../../shared/appEnvironment.js';
import {
  boardView, discardNativeBlob, nativeAccountId, nativeBlobImport, nativeBlobUrl, nativeDataActive, nativeMutate, nativeQuery, nativeSyncNow,
  noteView, paperView, prepareNativeAccount, removeNativeAccount, scheduleAutomaticNativeSync, setNativeAccount, shelfView, uuid,
} from './nativeData.js';
import {
  cachedBlobUrl, clearOfflineData, configureNetworkFetch, configureReplayAuthorization, offlineFetch,
  refreshSyncStatus, rememberOfflineIdentity, runtimeFetch,
} from '../../shared/offlineStore';
import { currentCredential, storeCredential } from '../../shared/credentials.js';
import { withAbortTimeout } from './requestTimeout.js';

configureNetworkFetch(IS_DESKTOP
  ? tauriHttpFetch
  : (...args) => window.fetch(...args));
configureReplayAuthorization(() => {
  const token = currentCredential();
  return token ? `Bearer ${token}` : null;
});

// Relative, so it resolves against the app's own base URL — works at / and
// under a proxied subpath like mc-pony.com/papol/.
const API_BASE = backendPath('/api');

const paperSyncIds = new Map();
const copySyncIds = new Map();
const shelfSyncIds = new Map();
const serverShelfIds = new Map();
const tagSyncIds = new Map();
const pendingPaperBlobs = new Map();
// A developer backend may arrive through an SSH/IDE port forward. Keep auth
// bounded without treating a healthy forwarded request as offline too early.
const DESKTOP_AUTH_TIMEOUT_MS = 10_000;

function forgetAccountData() {
  paperSyncIds.clear();
  copySyncIds.clear();
  shelfSyncIds.clear();
  serverShelfIds.clear();
  tagSyncIds.clear();
  pendingPaperBlobs.clear();
}

function rememberPaperIdentity(paper) {
  if (paper?.id != null && paper.sync_id) paperSyncIds.set(String(paper.id), paper.sync_id);
  if (paper?.id != null && paper.copy_sync_id) copySyncIds.set(String(paper.id), paper.copy_sync_id);
  if (paper?.shelf_id != null && paper.shelf_sync_id) shelfSyncIds.set(String(paper.shelf_id), paper.shelf_sync_id);
  for (const tag of paper?.tags || []) {
    if (tag.id != null && tag.sync_id) tagSyncIds.set(String(tag.id), tag.sync_id);
  }
  return paper;
}

function rememberShelfIdentity(shelf) {
  if (shelf?.id != null && shelf.sync_id) {
    shelfSyncIds.set(String(shelf.id), shelf.sync_id);
    serverShelfIds.set(shelf.sync_id, shelf.id);
  }
  return shelf;
}

function rememberTagIdentity(tag) {
  if (tag?.id != null && tag.sync_id) tagSyncIds.set(String(tag.id), tag.sync_id);
  return tag;
}

function localShelfId(id) {
  return shelfSyncIds.get(String(id)) || id;
}

export function getToken() {
  return currentCredential();
}

export function setToken(token, accountId = null) {
  return storeCredential(token, accountId);
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
  const response = await offlineFetch(`${API_BASE}${path}`, {
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

async function desktopAuthRequest(requester) {
  if (!IS_DESKTOP) return requester(undefined);
  try {
    return await withAbortTimeout(requester, DESKTOP_AUTH_TIMEOUT_MS);
  } catch (error) {
    if (error?.name === 'OnlineRequiredError' || error?.name === 'AbortError') {
      throw new Error('Cannot reach the Papol backend. Start it or choose a working backend URL.');
    }
    throw error;
  }
}

// ---------- Auth ----------

export async function register(email, displayName, affiliation, password) {
  const result = await desktopAuthRequest((signal) => request('/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      display_name: displayName,
      affiliation: affiliation || null,
      password,
    }),
    signal,
  }));
  await rememberOfflineIdentity(result.token, result.user).catch(() => {});
  await prepareNativeAccount(result.user);
  await setToken(result.token, result.user.id);
  void scheduleAutomaticNativeSync().catch(() => {});
  return result;
}

export async function login(email, password) {
  const result = await desktopAuthRequest((signal) => request('/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
    signal,
  }));
  await rememberOfflineIdentity(result.token, result.user).catch(() => {});
  await prepareNativeAccount(result.user);
  await setToken(result.token, result.user.id);
  void scheduleAutomaticNativeSync().catch(() => {});
  return result;
}

export async function logout(accountId = nativeAccountId()) {
  if (IS_DESKTOP && accountId != null) await removeNativeAccount(accountId);
  else await clearOfflineData();
  forgetAccountData();
  try {
    await desktopAuthRequest((signal) => request('/auth/logout', { method: 'POST', signal }));
  } catch {
    // Local sign-out must remain available while the backend is offline.
  } finally {
    try {
      await storeCredential(null, accountId);
    } finally {
      setNativeAccount(null);
    }
  }
}

export async function pendingLocalChanges() {
  const compatibility = await refreshSyncStatus();
  if (!nativeDataActive()) return compatibility.pending;
  const native = await nativeQuery('sync_status');
  return compatibility.pending + native.pending;
}

export async function getMe() {
  let user;
  try {
    // A half-open backend must not hold the desktop shell on “Loading…”.
    // offlineFetch first tries its upgrade-era response cache; native SQLite
    // supplies the identity below when that bridge has no cached response.
    user = await desktopAuthRequest((signal) => request('/auth/me', { signal }));
  } catch (error) {
    if (!nativeDataActive() || error?.status === 401 || error?.status === 403) throw error;
    // SQLite owns the signed-in reader's offline identity. IndexedDB remains
    // only an upgrade bridge and may legitimately have no cached /auth/me.
    user = await nativeQuery('account');
  }
  if (!user) throw new Error('Account profile is unavailable');
  if (!nativeDataActive()) {
    await prepareNativeAccount(user);
  }
  // Connectivity is not part of rendering the local shell. The sync status
  // control reports this background attempt independently.
  void scheduleAutomaticNativeSync().catch(() => {});
  return user;
}

export function sendPresence() {
  return request('/presence', { method: 'POST' });
}

export async function updateProfile(data) {
  const user = await jsonRequest('/auth/profile', 'PUT', data);
  await prepareNativeAccount(user);
  return user;
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
  const response = await runtimeFetch(`${API_BASE}/auth/export`, {
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

function isMissingLocalAccountProfile(error) {
  return (error?.message || String(error)) === 'Local account profile is not available';
}

export async function getUserSpace(userId) {
  if (nativeDataActive() && Number(userId) === nativeAccountId()) {
    try {
      const [user, boards, nook, localPapers] = await Promise.all([
        nativeQuery('account'), nativeQuery('boards'), nativeQuery('nook'), nativeQuery('papers'),
      ]);
      return {
        user,
        papers: localPapers.map((row) => paperView(row)),
        boards: boards.map((row) => boardView(row)),
        shelves: nook.shelves.map(shelfView),
        tags: nook.tags,
      };
    } catch (error) {
      // One upgrade release retains the response cache as a fallback until
      // the account profile has been written into SQLite.
      if (!isMissingLocalAccountProfile(error)) throw error;
    }
  }
  const space = await request(`/users/${userId}/space`);
  (space.papers || []).forEach(rememberPaperIdentity);
  (space.shelves || []).forEach(rememberShelfIdentity);
  (space.tags || []).forEach(rememberTagIdentity);
  return space;
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
  if (paper.file_path.startsWith('offline-file:')) return paper.file_path;
  if (paper.file_path.startsWith('assets/')) return appPath(`/${paper.file_path}`);
  return backendPath(`/uploads/${paper.file_path}`);
}

// The name a downloaded PDF is saved under: the paper's title, with the
// characters a file name cannot hold replaced, as the viewer names it.
export function pdfFileName(paper) {
  const title = (paper.title || '').replace(/[\\/:*?"<>|]/g, '-').trim();
  return `${title || 'paper'}.pdf`;
}

export async function listPapers() {
  const papers = await request('/papers');
  papers.forEach(rememberPaperIdentity);
  return papers;
}

// ---------- Boards (private spaces inside the reader's nook) ----------

export function listBoards() {
  if (nativeDataActive()) return nativeQuery('boards').then((rows) => rows.map((row) => boardView(row)));
  return request('/boards');
}

export function listLibraryBoards() {
  return request('/library/boards');
}

export async function createBoard(data) {
  const board = nativeDataActive()
    ? boardView((await nativeMutate([{
      table: 'boards', id: uuid(), operation: 'upsert', values: data,
    }])).rows[0])
    : await jsonRequest('/boards', 'POST', data);
  try { window.sessionStorage.setItem('papol.newBoardHint', board.guid); } catch { /* best effort */ }
  return board;
}

export function getBoard(id) {
  if (nativeDataActive()) return nativeQuery('board', { id }).then((row) => boardView(row, true));
  return request(`/boards/${id}`);
}

export function updateBoard(id, data) {
  if (nativeDataActive()) {
    return nativeMutate([{ table: 'boards', id, operation: 'patch', values: data }])
      .then((receipt) => nativeQuery('board', { id }).then((row) => boardView(row, true)));
  }
  return jsonRequest(`/boards/${id}`, 'PUT', data);
}

export function deleteBoard(id) {
  if (nativeDataActive()) {
    return nativeMutate([{ table: 'boards', id, operation: 'delete', values: {} }]).then(() => null);
  }
  return request(`/boards/${id}`, { method: 'DELETE' });
}

export async function createBoardGroup(id, data) {
  if (nativeDataActive()) {
    const groupId = uuid();
    const changes = [{
      table: 'board_groups', id: groupId, operation: 'upsert',
      values: {
        board_id: id, kind: data.kind === 'chapter' ? 'booklet' : data.kind,
        title: data.title, header: data.header, auto_arrange: data.auto_arrange,
      },
    }, ...data.item_ids.map((itemId) => ({
      table: 'board_items', id: itemId, operation: 'patch', values: { group_id: groupId },
    }))];
    const receipt = await nativeMutate(changes);
    return { ...receipt.rows[0], item_ids: data.item_ids };
  }
  return jsonRequest(`/boards/${id}/groups`, 'POST', data);
}

export async function moveBoardGroup(id, dx, dy) {
  if (nativeDataActive()) {
    const context = await nativeQuery('board_group', { id });
    const receipt = await nativeMutate(context.items.map((item) => ({
      table: 'board_items', id: item.id, operation: 'patch',
      values: { x: item.x + dx, y: item.y + dy },
    })));
    return receipt.rows;
  }
  return jsonRequest(`/board-groups/${id}/move`, 'PUT', { dx, dy });
}

export async function updateBoardGroup(id, data) {
  if (nativeDataActive()) {
    await nativeMutate([{ table: 'board_groups', id, operation: 'patch', values: data }]);
    const context = await nativeQuery('board_group', { id });
    return { ...context.group, item_ids: context.items.map((item) => item.id) };
  }
  return jsonRequest(`/board-groups/${id}`, 'PUT', data);
}

export function ungroupBoardGroup(id, items) {
  if (nativeDataActive()) {
    return nativeMutate([
      { table: 'board_groups', id, operation: 'delete', values: {} },
      ...items.map((item) => ({
        table: 'board_items', id: item.id, operation: 'patch',
        values: { group_id: item.group_id, x: item.x, y: item.y },
      })),
    ]).then(() => null);
  }
  return jsonRequest(`/board-groups/${id}/ungroup`, 'POST', { items });
}

export function layoutBoardGroup(id, items) {
  if (nativeDataActive()) {
    return nativeMutate(items.map((item) => ({
      table: 'board_items', id: item.id, operation: 'patch',
      values: { x: item.x, y: item.y },
    }))).then((receipt) => receipt.rows);
  }
  return jsonRequest(`/board-groups/${id}/layout`, 'PUT', { items });
}

export async function addBoardComment(id, content, x, y) {
  if (nativeDataActive()) {
    const receipt = await nativeMutate([{
      table: 'board_items', id: uuid(), operation: 'upsert',
      values: { board_id: id, kind: 'comment', content, x, y },
    }]);
    return receipt.rows[0];
  }
  return jsonRequest(`/boards/${id}/comments`, 'POST', { content, x, y });
}

export async function addBoardFile(id, file, caption = '', position = null) {
  if (nativeDataActive()) {
    const blob = await nativeBlobImport(file);
    try {
      const receipt = await nativeMutate([{
        table: 'board_items', id: uuid(), operation: 'upsert',
        values: {
          board_id: id,
          kind: file.type?.startsWith('image/') ? 'image' : 'file',
          content: caption || null,
          sha256: blob.sha256,
          original_filename: file.name || 'file',
          mime_type: file.type || 'application/octet-stream',
          x: position?.x ?? 0,
          y: position?.y ?? 0,
        },
      }]);
      return receipt.rows[0];
    } catch (error) {
      await discardNativeBlob(blob.sha256).catch(() => {});
      throw error;
    }
  }
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
  if (nativeDataActive()) {
    return nativeMutate([{ table: 'board_items', id, operation: 'delete', values: {} }]).then(() => null);
  }
  return request(`/board-items/${id}`, { method: 'DELETE' });
}

export function restoreBoardItem(id) {
  if (nativeDataActive()) {
    return nativeMutate([{ table: 'board_items', id, operation: 'patch', values: {} }])
      .then((receipt) => receipt.rows[0]);
  }
  return request(`/board-items/${id}/restore`, { method: 'POST' });
}

export function moveBoardItem(id, x, y) {
  if (nativeDataActive()) {
    return nativeMutate([{ table: 'board_items', id, operation: 'patch', values: { x, y } }])
      .then((receipt) => receipt.rows[0]);
  }
  return jsonRequest(`/board-items/${id}`, 'PUT', { x, y });
}

export function updateBoardItem(id, data) {
  if (nativeDataActive()) {
    return nativeMutate([{ table: 'board_items', id, operation: 'patch', values: data }])
      .then((receipt) => receipt.rows[0]);
  }
  return jsonRequest(`/board-items/${id}`, 'PUT', data);
}

export function addBoardYouTube(id, url, x, y) {
  if (nativeDataActive()) {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Video links must use http or https');
    return nativeMutate([{
      table: 'board_items', id: uuid(), operation: 'upsert',
      values: { board_id: id, kind: 'youtube', content: url, source_url: url, x, y },
    }]).then((receipt) => receipt.rows[0]);
  }
  return jsonRequest(`/boards/${id}/youtube`, 'POST', { url, x, y });
}

export function addBoardWebpage(id, url, x, y) {
  if (nativeDataActive()) {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Page links must use http or https');
    const label = parsed.hostname;
    return nativeMutate([{
      table: 'board_items', id: uuid(), operation: 'upsert',
      values: { board_id: id, kind: 'webpage', content: label, source_url: url, x, y, width: 480 },
    }]).then((receipt) => receipt.rows[0]);
  }
  return jsonRequest(`/boards/${id}/webpage`, 'POST', { url, x, y });
}

export function placeStagedBoardItem(id, x, y) {
  if (nativeDataActive()) {
    return nativeMutate([{
      table: 'board_items', id, operation: 'patch', values: { x, y, staged: false },
    }]).then((receipt) => receipt.rows[0]);
  }
  return jsonRequest(`/board-items/${id}/place`, 'POST', { x, y });
}

export async function boardFileBlob(item) {
  if (nativeDataActive()) {
    if (!item.sha256) throw new Error('Board image is not available in the local replica');
    return nativeBlobUrl(item.sha256, item.mime_type);
  }
  if (item.file_path?.startsWith('offline-file:')) return cachedBlobUrl(item.file_path);
  const key = `${API_BASE}/board-items/${item.id}/file`;
  return cachedBlobUrl(key, async () => {
    const response = await runtimeFetch(key, { headers: authHeaders() });
    if (!response.ok) await handleResponse(response);
    return response.blob();
  });
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
  if (nativeDataActive()) {
    return nativeBlobImport(file).then((blob) => {
      pendingPaperBlobs.set(blob.sha256, blob);
      return {
        doi: null,
        title: file.name.replace(/\.pdf$/i, '').replace(/[_-]+/g, ' ').trim(),
        authors: null,
        journal: null,
        year: null,
        file_path: `${blob.sha256}.pdf`,
        sha256: blob.sha256,
      };
    });
  }
  const formData = new FormData();
  formData.append('file', file);
  return request('/papers/extract', { method: 'POST', body: formData });
}

export async function discardPaperImport(extractedData) {
  const sha256 = extractedData?.sha256;
  if (!nativeDataActive() || !sha256 || !pendingPaperBlobs.has(sha256)) return;
  pendingPaperBlobs.delete(sha256);
  await discardNativeBlob(sha256);
}

export function reextractPaperMetadata(paperId) {
  return request(`/papers/${paperId}/extract-metadata`, { method: 'POST' });
}

export async function createPaper(paperData) {
  const sha256 = paperData.sha256 || paperData.file_path?.replace(/\.pdf$/i, '');
  if (nativeDataActive() && pendingPaperBlobs.has(sha256)) {
    const localShelves = await nativeQuery('shelves');
    let shelfId = localShelfId(paperData.shelf_id);
    const selectedShelf = localShelves.find((shelf) => shelf.id === shelfId);
    if (selectedShelf && (selectedShelf.is_public === true || selectedShelf.is_public === 1)) {
      shelfId = localShelves.find((shelf) => !(shelf.is_public === true || shelf.is_public === 1))?.id
        ?? shelfId;
    }
    const paperId = uuid();
    const editionId = uuid();
    const copyId = uuid();
    const changes = [
      {
        table: 'papers', id: paperId, operation: 'upsert',
        values: {
          doi: paperData.doi, title: paperData.title, authors: paperData.authors,
          journal: paperData.journal, year: paperData.year,
        },
      },
      {
        table: 'paper_editions', id: editionId, operation: 'upsert',
        values: { paper_id: paperId, file_path: `${sha256}.pdf`, sha256 },
      },
      {
        table: 'copies', id: copyId, operation: 'upsert',
        values: {
          paper_id: paperId, shelf_id: shelfId,
          edition_id: editionId, edition_sha256: sha256,
          summary: paperData.summary,
        },
      },
    ];
    for (const tagId of paperData.tag_ids || []) changes.push({
      table: 'copy_tags', id: uuid(), operation: 'upsert',
      values: { copy_id: copyId, tag_id: tagSyncIds.get(String(tagId)) || tagId },
    });
    if (paperData.initial_comment?.trim()) changes.push({
      table: 'comments', id: uuid(), operation: 'upsert',
      values: { paper_id: paperId, edition_id: editionId, content: paperData.initial_comment.trim() },
    });
    await nativeMutate(changes);
    pendingPaperBlobs.delete(sha256);
    copySyncIds.set(paperId, copyId);
    return paperView(await nativeQuery('paper', { id: paperId }));
  }
  return jsonRequest('/papers', 'POST', paperData);
}

export async function getPaper(id) {
  if (nativeDataActive() && typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id)) {
    const paper = paperView(await nativeQuery('paper', { id }));
    paper.comments = (await nativeQuery('comments', { parent_id: id })).map(noteView);
    copySyncIds.set(id, paper.copy_sync_id);
    return paper;
  }
  const paper = rememberPaperIdentity(await request(`/papers/${id}`));
  if (nativeDataActive() && paper.sync_id) {
    const [comments, nook] = await Promise.all([
      nativeQuery('comments', { parent_id: paper.sync_id }), nativeQuery('nook'),
    ]);
    paper.comments = comments.map(noteView);
    const copy = nook.copies.find((candidate) => candidate.paper_id === paper.sync_id);
    if (copy) {
      Object.assign(paper, {
        copy_sync_id: copy.id,
        shelf_id: copy.shelf_id,
        summary: copy.summary,
        thought: copy.thought,
        marketed: copy.marketed === true || copy.marketed === 1,
        is_author: copy.is_author === true || copy.is_author === 1,
        rating_expertise: copy.rating_expertise,
        rating_reading: copy.rating_reading,
        rating_liking: copy.rating_liking,
        tags: (nook.copy_tags || []).filter((link) => link.copy_id === copy.id)
          .map((link) => nook.tags.find((tag) => tag.id === link.tag_id)).filter(Boolean),
      });
      copySyncIds.set(String(paper.id), copy.id);
    }
  }
  return paper;
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

export async function updatePaper(id, data) {
  const copyId = copySyncIds.get(String(id));
  const localFields = new Set(['summary', 'shelf_id', 'tag_ids']);
  if (nativeDataActive() && copyId && Object.keys(data).every((key) => localFields.has(key))) {
    const values = { ...data };
    if ('shelf_id' in values) values.shelf_id = localShelfId(values.shelf_id);
    const desiredTags = values.tag_ids;
    delete values.tag_ids;
    const changes = Object.keys(values).length ? [{
      table: 'copies', id: copyId, operation: 'patch', values,
    }] : [];
    if (desiredTags) {
      const nook = await nativeQuery('nook');
      const desired = new Set(desiredTags.map((tagId) => tagSyncIds.get(String(tagId)) || tagId));
      const current = (nook.copy_tags || []).filter((link) => link.copy_id === copyId);
      for (const link of current) {
        if (!desired.has(link.tag_id)) changes.push({
          table: 'copy_tags', id: link.id, operation: 'delete', values: {},
        });
        desired.delete(link.tag_id);
      }
      for (const tagId of desired) changes.push({
        table: 'copy_tags', id: uuid(), operation: 'upsert',
        values: { copy_id: copyId, tag_id: tagId },
      });
    }
    if (!changes.length) return data;
    const receipt = await nativeMutate(changes);
    return receipt.rows[0];
  }
  return rememberPaperIdentity(await jsonRequest(`/papers/${id}`, 'PUT', data));
}

export function deletePaper(id) {
  const copyId = copySyncIds.get(String(id));
  if (nativeDataActive() && copyId) {
    return nativeMutate([{
      table: 'copies', id: copyId, operation: 'delete', values: {},
    }]).then(() => ({ message: 'Paper removed from your nook' }));
  }
  return request(`/papers/${id}`, { method: 'DELETE' });
}

export function createTag(name) {
  if (nativeDataActive()) {
    return nativeMutate([{
      table: 'tags', id: uuid(), operation: 'upsert', values: { name },
    }]).then((receipt) => receipt.rows[0]);
  }
  return jsonRequest('/tags', 'POST', { name });
}

export function listTags() {
  if (nativeDataActive()) return nativeQuery('tags');
  return request('/tags');
}

export function deleteTag(tagId) {
  if (nativeDataActive()) {
    return nativeMutate([{
      table: 'tags', id: tagSyncIds.get(String(tagId)) || tagId,
      operation: 'delete', values: {},
    }]).then(() => null);
  }
  return request(`/tags/${tagId}`, { method: 'DELETE' });
}

export function listShelves() {
  if (nativeDataActive()) return nativeQuery('shelves').then((rows) => rows.map(shelfView));
  return request('/shelves');
}

export function createShelf(data) {
  if (nativeDataActive() && !data.is_public) {
    return nativeMutate([{
      table: 'shelves', id: uuid(), operation: 'upsert',
      values: { name: data.name, color: data.color, position: data.position || 0 },
    }]).then((receipt) => shelfView(receipt.rows[0]));
  }
  return jsonRequest('/shelves', 'POST', data).then(async (shelf) => {
    rememberShelfIdentity(shelf);
    if (nativeDataActive()) await nativeSyncNow();
    return shelf;
  });
}

export function updateShelf(id, data) {
  if (nativeDataActive() && !('is_public' in data) && !('is_default' in data)) {
    return nativeMutate([{
      table: 'shelves', id: shelfSyncIds.get(String(id)) || id,
      operation: 'patch', values: data,
    }]).then((receipt) => shelfView(receipt.rows[0]));
  }
  return jsonRequest(`/shelves/${serverShelfIds.get(String(id)) || id}`, 'PUT', data)
    .then(async (shelf) => {
      rememberShelfIdentity(shelf);
      if (nativeDataActive()) await nativeSyncNow();
      return shelf;
    });
}

export async function deleteShelf(id) {
  const result = await request(`/shelves/${serverShelfIds.get(String(id)) || id}`, { method: 'DELETE' });
  if (nativeDataActive()) await nativeSyncNow();
  return result;
}

// ---------- Comments ----------

export function addComment(paperId, content) {
  if (nativeDataActive() && paperSyncIds.has(String(paperId))) {
    return nativeMutate([{
      table: 'comments', id: uuid(), operation: 'upsert',
      values: { paper_id: paperSyncIds.get(String(paperId)), content },
    }]).then((receipt) => noteView(receipt.rows[0]));
  }
  return jsonRequest(`/papers/${paperId}/comments`, 'POST', { content });
}

export function updateComment(commentId, content) {
  if (nativeDataActive() && typeof commentId === 'string') {
    return nativeMutate([{
      table: 'comments', id: commentId, operation: 'patch', values: { content },
    }]).then((receipt) => noteView(receipt.rows[0]));
  }
  return jsonRequest(`/comments/${commentId}`, 'PUT', { content });
}

export function deleteComment(commentId) {
  if (nativeDataActive() && typeof commentId === 'string') {
    return nativeMutate([{ table: 'comments', id: commentId, operation: 'delete', values: {} }])
      .then(() => null);
  }
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
