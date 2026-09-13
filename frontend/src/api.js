import { demoActive, demoRequest } from './demo';
import { appPath, backendPath } from './base';
import { fetch as tauriHttpFetch } from '@tauri-apps/plugin-http';
import { IS_DESKTOP } from '../../shared/appEnvironment.js';
import {
  boardView, discardNativeBlob, nativeAccountUuid, nativeBlobImport, nativeBlobUrl, nativeDataActive, nativeMutate, nativeQuery, nativeSyncNow,
  noteView, paperView, prepareNativeAccount, removeNativeAccount, scheduleAutomaticNativeSync, setNativeAccount, shelfView, newUuid,
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

// Which copy holds a nook paper's private fields.
const copyUuids = new Map();
const pendingPaperBlobs = new Map();
// A developer backend may arrive through an SSH/IDE port forward. Keep auth
// bounded without treating a healthy forwarded request as offline too early.
const DESKTOP_AUTH_TIMEOUT_MS = 10_000;
const DESKTOP_EXTRACT_TIMEOUT_MS = 15_000;

function forgetAccountData() {
  copyUuids.clear();
  pendingPaperBlobs.clear();
}

function rememberPaperIdentity(paper) {
  if (paper?.uuid != null && paper.copy_uuid) copyUuids.set(paper.uuid, paper.copy_uuid);
  return paper;
}

export function getToken() {
  return currentCredential();
}

export function setToken(token, accountUuid = null) {
  return storeCredential(token, accountUuid);
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

// Some changes exist only on the server: publishing, seminars, shared
// metadata, new PDFs. Papol Desktop names rows by sync UUID, which those
// routes accept once the row exists there, so push local work first and pull
// the result back into the replica after.
async function onServer(send, { pull = true } = {}) {
  if (!nativeDataActive()) return send();
  if (globalThis.navigator?.onLine === false) {
    throw new Error('This change needs a connection to Papol.');
  }
  try {
    await nativeSyncNow();
  } catch (error) {
    throw new Error(`This change needs a connection to Papol. ${error?.message || error}`);
  }
  const result = await send();
  if (pull) await nativeSyncNow().catch(() => {});
  return result;
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
  await setToken(result.token, result.user.uuid);
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
  await setToken(result.token, result.user.uuid);
  void scheduleAutomaticNativeSync().catch(() => {});
  return result;
}

export async function logout(accountUuid = nativeAccountUuid()) {
  if (IS_DESKTOP && accountUuid != null) await removeNativeAccount(accountUuid);
  else await clearOfflineData();
  forgetAccountData();
  try {
    await desktopAuthRequest((signal) => request('/auth/logout', { method: 'POST', signal }));
  } catch {
    // Local sign-out must remain available while the backend is offline.
  } finally {
    try {
      await storeCredential(null, accountUuid);
    } finally {
      setNativeAccount(null);
    }
  }
}

export async function pendingLocalChanges() {
  const queued = await refreshSyncStatus();
  if (!nativeDataActive()) return queued.pending;
  const native = await nativeQuery('sync_status');
  return queued.pending + native.pending;
}

export async function getMe() {
  let user;
  try {
    // A half-open backend must not hold the desktop shell on “Loading…”.
    user = await desktopAuthRequest((signal) => request('/auth/me', { signal }));
  } catch (error) {
    if (!nativeDataActive() || error?.status === 401 || error?.status === 403) throw error;
    // Offline, SQLite holds the signed-in reader's identity.
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
  // WebKit may not consume the URL until after the click handler returns.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
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

export async function getUserSpace(userUuid) {
  if (nativeDataActive() && userUuid === nativeAccountUuid()) {
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
  }
  const space = await request(`/users/${userUuid}/space`);
  (space.papers || []).forEach(rememberPaperIdentity);
  return space;
}

// ---------- Papers ----------

// Papers are addressed by their UUID, and only by it.
export function paperHref(paper) {
  return appPath(`/paper/${paper.uuid}`);
}

// Uploaded PDFs live in uploads/. Demo papers link to each paper's
// canonical open-access copy; demo-created papers use a bundled placeholder.
export function pdfHref(paper) {
  if (paper.file_path.startsWith('http')) return paper.file_path;
  if (paper.file_path.startsWith('offline-file:')) return paper.file_path;
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
      table: 'boards', uuid: newUuid(), operation: 'upsert', values: data,
    }])).rows[0])
    : await jsonRequest('/boards', 'POST', data);
  try { window.sessionStorage.setItem('papol.newBoardHint', board.uuid); } catch { /* best effort */ }
  return board;
}

export function getBoard(uuid) {
  if (nativeDataActive()) return nativeQuery('board', { uuid }).then((row) => boardView(row, true));
  return request(`/boards/${uuid}`);
}

export function updateBoard(uuid, data) {
  if (nativeDataActive()) {
    return nativeMutate([{ table: 'boards', uuid, operation: 'patch', values: data }])
      .then((receipt) => nativeQuery('board', { uuid }).then((row) => boardView(row, true)));
  }
  return jsonRequest(`/boards/${uuid}`, 'PUT', data);
}

export function deleteBoard(uuid) {
  if (nativeDataActive()) {
    return nativeMutate([{ table: 'boards', uuid, operation: 'delete', values: {} }]).then(() => null);
  }
  return request(`/boards/${uuid}`, { method: 'DELETE' });
}

export async function createBoardGroup(uuid, data) {
  if (nativeDataActive()) {
    const groupUuid = newUuid();
    const changes = [{
      table: 'board_groups', uuid: groupUuid, operation: 'upsert',
      values: {
        board_uuid: uuid, kind: data.kind,
        title: data.title, header: data.header, auto_arrange: data.auto_arrange,
      },
    }, ...data.item_uuids.map((itemUuid) => ({
      table: 'board_items', uuid: itemUuid, operation: 'patch', values: { group_uuid: groupUuid },
    }))];
    const receipt = await nativeMutate(changes);
    return { ...receipt.rows[0], item_uuids: data.item_uuids };
  }
  return jsonRequest(`/boards/${uuid}/groups`, 'POST', data);
}

export async function moveBoardGroup(uuid, dx, dy) {
  if (nativeDataActive()) {
    const context = await nativeQuery('board_group', { uuid });
    const receipt = await nativeMutate(context.items.map((item) => ({
      table: 'board_items', uuid: item.uuid, operation: 'patch',
      values: { x: item.x + dx, y: item.y + dy },
    })));
    return receipt.rows;
  }
  return jsonRequest(`/board-groups/${uuid}/move`, 'PUT', { dx, dy });
}

export async function updateBoardGroup(uuid, data) {
  if (nativeDataActive()) {
    await nativeMutate([{ table: 'board_groups', uuid, operation: 'patch', values: data }]);
    const context = await nativeQuery('board_group', { uuid });
    return { ...context.group, item_uuids: context.items.map((item) => item.uuid) };
  }
  return jsonRequest(`/board-groups/${uuid}`, 'PUT', data);
}

export function ungroupBoardGroup(uuid, items) {
  if (nativeDataActive()) {
    return nativeMutate([
      { table: 'board_groups', uuid, operation: 'delete', values: {} },
      ...items.map((item) => ({
        table: 'board_items', uuid: item.uuid, operation: 'patch',
        values: { group_uuid: item.group_uuid, x: item.x, y: item.y },
      })),
    ]).then(() => null);
  }
  return jsonRequest(`/board-groups/${uuid}/ungroup`, 'POST', { items });
}

export function layoutBoardGroup(uuid, items) {
  if (nativeDataActive()) {
    return nativeMutate(items.map((item) => ({
      table: 'board_items', uuid: item.uuid, operation: 'patch',
      values: { x: item.x, y: item.y },
    }))).then((receipt) => receipt.rows);
  }
  return jsonRequest(`/board-groups/${uuid}/layout`, 'PUT', { items });
}

export async function addBoardComment(uuid, content, x, y) {
  if (nativeDataActive()) {
    const receipt = await nativeMutate([{
      table: 'board_items', uuid: newUuid(), operation: 'upsert',
      values: { board_uuid: uuid, kind: 'comment', content, x, y },
    }]);
    return receipt.rows[0];
  }
  return jsonRequest(`/boards/${uuid}/comments`, 'POST', { content, x, y });
}

export async function addBoardFile(uuid, file, caption = '', position = null) {
  if (nativeDataActive()) {
    const blob = await nativeBlobImport(file);
    try {
      const receipt = await nativeMutate([{
        table: 'board_items', uuid: newUuid(), operation: 'upsert',
        values: {
          board_uuid: uuid,
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
  return request(`/boards/${uuid}/files`, { method: 'POST', body: formData });
}

export function deleteBoardItem(uuid) {
  if (nativeDataActive()) {
    return nativeMutate([{ table: 'board_items', uuid, operation: 'delete', values: {} }]).then(() => null);
  }
  return request(`/board-items/${uuid}`, { method: 'DELETE' });
}

export function restoreBoardItem(uuid) {
  if (nativeDataActive()) {
    return nativeMutate([{ table: 'board_items', uuid, operation: 'patch', values: {} }])
      .then((receipt) => receipt.rows[0]);
  }
  return request(`/board-items/${uuid}/restore`, { method: 'POST' });
}

export function moveBoardItem(uuid, x, y) {
  if (nativeDataActive()) {
    return nativeMutate([{ table: 'board_items', uuid, operation: 'patch', values: { x, y } }])
      .then((receipt) => receipt.rows[0]);
  }
  return jsonRequest(`/board-items/${uuid}`, 'PUT', { x, y });
}

export function updateBoardItem(uuid, data) {
  if (nativeDataActive()) {
    return nativeMutate([{ table: 'board_items', uuid, operation: 'patch', values: data }])
      .then((receipt) => receipt.rows[0]);
  }
  return jsonRequest(`/board-items/${uuid}`, 'PUT', data);
}

export function addBoardYouTube(uuid, url, x, y) {
  if (nativeDataActive()) {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Video links must use http or https');
    return nativeMutate([{
      table: 'board_items', uuid: newUuid(), operation: 'upsert',
      values: { board_uuid: uuid, kind: 'youtube', content: url, source_url: url, x, y },
    }]).then((receipt) => receipt.rows[0]);
  }
  return jsonRequest(`/boards/${uuid}/youtube`, 'POST', { url, x, y });
}

export function addBoardWebpage(uuid, url, x, y) {
  if (nativeDataActive()) {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Page links must use http or https');
    const label = parsed.hostname;
    return nativeMutate([{
      table: 'board_items', uuid: newUuid(), operation: 'upsert',
      values: { board_uuid: uuid, kind: 'webpage', content: label, source_url: url, x, y, width: 480 },
    }]).then((receipt) => receipt.rows[0]);
  }
  return jsonRequest(`/boards/${uuid}/webpage`, 'POST', { url, x, y });
}

export function placeStagedBoardItem(uuid, x, y) {
  if (nativeDataActive()) {
    return nativeMutate([{
      table: 'board_items', uuid, operation: 'patch', values: { x, y, staged: false },
    }]).then((receipt) => receipt.rows[0]);
  }
  return jsonRequest(`/board-items/${uuid}/place`, 'POST', { x, y });
}

export async function boardFileBlob(item) {
  if (nativeDataActive()) {
    if (!item.sha256) throw new Error('Board image is not available in the local replica');
    return nativeBlobUrl(item.sha256, item.mime_type);
  }
  if (item.file_path?.startsWith('offline-file:')) return cachedBlobUrl(item.file_path);
  const key = `${API_BASE}/board-items/${item.uuid}/file`;
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
  setTimeout(() => URL.revokeObjectURL(href), 60_000);
}

// The server reads the PDF's DOI or arXiv identifier and looks it up. On
// desktop this is best-effort: the file is already safe in the local replica,
// so being offline or a slow backend only costs the prefilled fields.
async function remotePaperMetadata(file) {
  if (globalThis.navigator?.onLine === false) return null;
  const formData = new FormData();
  formData.append('file', file);
  try {
    return await withAbortTimeout(async (signal) => handleResponse(
      await runtimeFetch(`${API_BASE}/papers/extract`, {
        method: 'POST', headers: authHeaders(), body: formData, signal,
      }),
    ), DESKTOP_EXTRACT_TIMEOUT_MS);
  } catch {
    return null;
  }
}

export async function extractPaperMetadata(file) {
  if (nativeDataActive()) {
    const blob = await nativeBlobImport(file);
    pendingPaperBlobs.set(blob.sha256, blob);
    const remote = await remotePaperMetadata(file);
    return {
      doi: remote?.doi || null,
      title: remote?.title || file.name.replace(/\.pdf$/i, '').replace(/[_-]+/g, ' ').trim(),
      authors: remote?.authors || null,
      journal: remote?.journal || null,
      year: remote?.year || null,
      file_path: `${blob.sha256}.pdf`,
      sha256: blob.sha256,
    };
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

export function reextractPaperMetadata(paperUuid) {
  return onServer(
    () => request(`/papers/${paperUuid}/extract-metadata`, { method: 'POST' }),
    { pull: false },
  );
}

export async function createPaper(paperData) {
  const sha256 = paperData.sha256 || paperData.file_path?.replace(/\.pdf$/i, '');
  if (nativeDataActive() && pendingPaperBlobs.has(sha256)) {
    const localShelves = await nativeQuery('shelves');
    let shelfUuid = paperData.shelf_uuid;
    const selectedShelf = localShelves.find((shelf) => shelf.uuid === shelfUuid);
    if (selectedShelf && (selectedShelf.is_public === true || selectedShelf.is_public === 1)) {
      shelfUuid = localShelves.find((shelf) => !(shelf.is_public === true || shelf.is_public === 1))?.uuid
        ?? shelfUuid;
    }
    const paperUuid = newUuid();
    const editionUuid = newUuid();
    const copyUuid = newUuid();
    const changes = [
      {
        table: 'papers', uuid: paperUuid, operation: 'upsert',
        values: {
          doi: paperData.doi, title: paperData.title, authors: paperData.authors,
          journal: paperData.journal, year: paperData.year,
        },
      },
      {
        table: 'paper_editions', uuid: editionUuid, operation: 'upsert',
        values: { paper_uuid: paperUuid, file_path: `${sha256}.pdf`, sha256 },
      },
      {
        table: 'copies', uuid: copyUuid, operation: 'upsert',
        values: {
          paper_uuid: paperUuid, shelf_uuid: shelfUuid,
          edition_uuid: editionUuid, edition_sha256: sha256,
          summary: paperData.summary,
        },
      },
    ];
    for (const tagUuid of paperData.tag_uuids || []) changes.push({
      table: 'copy_tags', uuid: newUuid(), operation: 'upsert',
      values: { copy_uuid: copyUuid, tag_uuid: tagUuid },
    });
    if (paperData.initial_comment?.trim()) changes.push({
      table: 'comments', uuid: newUuid(), operation: 'upsert',
      values: { paper_uuid: paperUuid, edition_uuid: editionUuid, content: paperData.initial_comment.trim() },
    });
    await nativeMutate(changes);
    pendingPaperBlobs.delete(sha256);
    copyUuids.set(paperUuid, copyUuid);
    return paperView(await nativeQuery('paper', { uuid: paperUuid }));
  }
  return jsonRequest('/papers', 'POST', paperData);
}

export async function getPaper(uuid) {
  if (nativeDataActive()) {
    // A nook paper is read from the replica: the server may not have it yet,
    // or may be out of reach.
    try {
      const paper = paperView(await nativeQuery('paper', { uuid }));
      paper.comments = (await nativeQuery('comments', { parent_uuid: uuid })).map(noteView);
      copyUuids.set(uuid, paper.copy_uuid);
      return paper;
    } catch (error) {
      // A paper outside this nook, opened from the library, comes from the service.
      if (String(error?.message ?? error) !== 'Paper not found') throw error;
    }
  }
  const paper = rememberPaperIdentity(await request(`/papers/${uuid}`));
  if (nativeDataActive()) {
    const [comments, nook] = await Promise.all([
      nativeQuery('comments', { parent_uuid: paper.uuid }), nativeQuery('nook'),
    ]);
    paper.comments = comments.map(noteView);
    const copy = nook.copies.find((candidate) => candidate.paper_uuid === paper.uuid);
    if (copy) {
      Object.assign(paper, {
        copy_uuid: copy.uuid,
        shelf_uuid: copy.shelf_uuid,
        summary: copy.summary,
        thought: copy.thought,
        marketed: copy.marketed === true || copy.marketed === 1,
        is_author: copy.is_author === true || copy.is_author === 1,
        rating_expertise: copy.rating_expertise,
        rating_reading: copy.rating_reading,
        rating_liking: copy.rating_liking,
        tags: (nook.copy_tags || []).filter((link) => link.copy_uuid === copy.uuid)
          .map((link) => nook.tags.find((tag) => tag.uuid === link.tag_uuid)).filter(Boolean),
      });
      copyUuids.set(paper.uuid, copy.uuid);
    }
  }
  return paper;
}

export function addToNook(paperUuid) {
  return request(`/papers/${paperUuid}/add-to-nook`, { method: 'POST' });
}

export function addPaperEdition(uuid, file) {
  const formData = new FormData();
  formData.append('file', file);
  return onServer(() => request(`/papers/${uuid}/editions`, { method: 'POST', body: formData }));
}

export function adoptEdition(uuid, editionUuid) {
  return onServer(() => jsonRequest(`/papers/${uuid}/adopt-edition`, 'POST', {
    edition_uuid: editionUuid ?? null,
  }));
}

export function ignoreEdition(uuid, editionUuid) {
  return onServer(() => jsonRequest(`/papers/${uuid}/ignore-edition`, 'POST', {
    edition_uuid: editionUuid ?? null,
  }));
}

export async function updatePaper(uuid, data) {
  const copyUuid = copyUuids.get(uuid);
  const localFields = new Set([
    'summary', 'shelf_uuid', 'tag_uuids',
    'rating_expertise', 'rating_reading', 'rating_liking',
  ]);
  if (nativeDataActive() && copyUuid && Object.keys(data).every((key) => localFields.has(key))) {
    const values = { ...data };
    const desiredTags = values.tag_uuids;
    delete values.tag_uuids;
    const changes = Object.keys(values).length ? [{
      table: 'copies', uuid: copyUuid, operation: 'patch', values,
    }] : [];
    if (desiredTags) {
      const nook = await nativeQuery('nook');
      const desired = new Set(desiredTags);
      const current = (nook.copy_tags || []).filter((link) => link.copy_uuid === copyUuid);
      for (const link of current) {
        if (!desired.has(link.tag_uuid)) changes.push({
          table: 'copy_tags', uuid: link.uuid, operation: 'delete', values: {},
        });
        desired.delete(link.tag_uuid);
      }
      for (const tagUuid of desired) changes.push({
        table: 'copy_tags', uuid: newUuid(), operation: 'upsert',
        values: { copy_uuid: copyUuid, tag_uuid: tagUuid },
      });
    }
    if (!changes.length) return data;
    const receipt = await nativeMutate(changes);
    return receipt.rows[0];
  }
  return rememberPaperIdentity(await onServer(() => jsonRequest(`/papers/${uuid}`, 'PUT', data)));
}

export function deletePaper(uuid) {
  const copyUuid = copyUuids.get(uuid);
  if (nativeDataActive() && copyUuid) {
    return nativeMutate([{
      table: 'copies', uuid: copyUuid, operation: 'delete', values: {},
    }]).then(() => ({ message: 'Paper removed from your nook' }));
  }
  return request(`/papers/${uuid}`, { method: 'DELETE' });
}

export function createTag(name) {
  if (nativeDataActive()) {
    return nativeMutate([{
      table: 'tags', uuid: newUuid(), operation: 'upsert', values: { name },
    }]).then((receipt) => receipt.rows[0]);
  }
  return jsonRequest('/tags', 'POST', { name });
}

export function listTags() {
  if (nativeDataActive()) return nativeQuery('tags');
  return request('/tags');
}

export function deleteTag(tagUuid) {
  if (nativeDataActive()) {
    return nativeMutate([{
      table: 'tags', uuid: tagUuid,
      operation: 'delete', values: {},
    }]).then(() => null);
  }
  return request(`/tags/${tagUuid}`, { method: 'DELETE' });
}

export function listShelves() {
  if (nativeDataActive()) return nativeQuery('shelves').then((rows) => rows.map(shelfView));
  return request('/shelves');
}

export function createShelf(data) {
  if (nativeDataActive() && !data.is_public) {
    return nativeMutate([{
      table: 'shelves', uuid: newUuid(), operation: 'upsert',
      values: { name: data.name, color: data.color, position: data.position || 0 },
    }]).then((receipt) => shelfView(receipt.rows[0]));
  }
  return onServer(() => jsonRequest('/shelves', 'POST', data));
}

export function updateShelf(uuid, data) {
  if (nativeDataActive() && !('is_public' in data) && !('is_default' in data)) {
    return nativeMutate([{
      table: 'shelves', uuid, operation: 'patch', values: data,
    }]).then((receipt) => shelfView(receipt.rows[0]));
  }
  return onServer(() => jsonRequest(`/shelves/${uuid}`, 'PUT', data));
}

// Deleting moves the shelf's papers and boards to another shelf, which may
// publish or hide them, so it happens on the server.
export function deleteShelf(uuid) {
  return onServer(() => request(`/shelves/${uuid}`, { method: 'DELETE' }));
}

// ---------- Comments ----------

export function addComment(paperUuid, content) {
  if (nativeDataActive()) {
    return nativeMutate([{
      table: 'comments', uuid: newUuid(), operation: 'upsert',
      values: { paper_uuid: paperUuid, content },
    }]).then((receipt) => noteView(receipt.rows[0]));
  }
  return jsonRequest(`/papers/${paperUuid}/comments`, 'POST', { content });
}

export function updateComment(commentUuid, content) {
  if (nativeDataActive() && typeof commentUuid === 'string') {
    return nativeMutate([{
      table: 'comments', uuid: commentUuid, operation: 'patch', values: { content },
    }]).then((receipt) => noteView(receipt.rows[0]));
  }
  return jsonRequest(`/comments/${commentUuid}`, 'PUT', { content });
}

export function deleteComment(commentUuid) {
  if (nativeDataActive() && typeof commentUuid === 'string') {
    return nativeMutate([{ table: 'comments', uuid: commentUuid, operation: 'delete', values: {} }])
      .then(() => null);
  }
  return request(`/comments/${commentUuid}`, { method: 'DELETE' });
}

// ---------- Seminar rooms ----------

export function callSeminar(paperUuid) {
  return onServer(() => request(`/papers/${paperUuid}/room`, { method: 'POST' }), { pull: false });
}

export function getRoom(roomUuid) {
  return request(`/rooms/${roomUuid}`);
}

export function leadRoom(roomUuid) {
  return request(`/rooms/${roomUuid}/lead`, { method: 'POST' });
}

export function joinRoom(roomUuid) {
  return request(`/rooms/${roomUuid}/join`, { method: 'POST' });
}

export function unhostRoom(roomUuid) {
  return request(`/rooms/${roomUuid}/unhost`, { method: 'POST' });
}

export function leaveRoom(roomUuid, successorUuid = null) {
  return jsonRequest(`/rooms/${roomUuid}/leave`, 'POST', {
    successor_uuid: successorUuid,
  });
}

export function postRoomMessage(roomUuid, content) {
  return jsonRequest(`/rooms/${roomUuid}/messages`, 'POST', { content });
}

export function setRoomAvailability(roomUuid, availability) {
  return jsonRequest(`/rooms/${roomUuid}/availability`, 'POST', { availability });
}

export function finishRoom(roomUuid) {
  return request(`/rooms/${roomUuid}/finish`, { method: 'POST' });
}

export function announceRoom(roomUuid, scheduledTime, platform, style, styleDesc = null) {
  return jsonRequest(`/rooms/${roomUuid}/announce`, 'PUT', {
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

export function markNotificationRead(uuid) {
  return request(`/notifications/${uuid}/read`, { method: 'POST' });
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

export function adminListFeedback() {
  return request('/admin/feedback');
}

export function adminSetFeedbackResolved(uuid, resolved) {
  return jsonRequest(`/admin/feedback/${uuid}`, 'PUT', { resolved });
}
