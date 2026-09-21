import {
  boardView, discardNativeBlob, nativeBlobImport, nativeBlobUrl, nativeDataActive,
  nativeRepository, newUuid,
} from '../nativeData.js';
import { runtimeFetch } from '../connectivity.js';
import { API_BASE, authHeaders, handleResponse, jsonRequest, request } from '../httpClient.js';
import { JobFailed, awaitJob } from './jobs.js';

// ---------- Boards (private spaces inside the user's nook) ----------

export function listBoards() {
  if (nativeDataActive()) return nativeRepository.boards().then((rows) => rows.map((row) => boardView(row)));
  return request('/boards');
}

export function listLibraryBoards() {
  return request('/library/boards');
}

export async function createBoard(data) {
  const board = nativeDataActive()
    ? boardView((await nativeRepository.transact([{
      table: 'boards', uuid: newUuid(), operation: 'upsert', values: data,
    }])).rows[0])
    : await jsonRequest('/boards', 'POST', data);
  try { window.sessionStorage.setItem('papol.newBoardHint', board.uuid); } catch { /* best effort */ }
  return board;
}

export function getBoard(uuid) {
  if (nativeDataActive()) return nativeRepository.board(uuid).then((row) => boardView(row, true));
  return request(`/boards/${uuid}`);
}

export function updateBoard(uuid, data) {
  if (nativeDataActive()) {
    return nativeRepository.transact([{ table: 'boards', uuid, operation: 'upsert', values: data }])
      .then((receipt) => nativeRepository.board(uuid).then((row) => boardView(row, true)));
  }
  return jsonRequest(`/boards/${uuid}`, 'PUT', data);
}

export function deleteBoard(uuid) {
  if (nativeDataActive()) {
    return nativeRepository.transact([{ table: 'boards', uuid, operation: 'delete', values: {} }]).then(() => null);
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
      table: 'board_items', uuid: itemUuid, operation: 'upsert', values: { group_uuid: groupUuid },
    }))];
    const receipt = await nativeRepository.transact(changes);
    return { ...receipt.rows[0], item_uuids: data.item_uuids };
  }
  return jsonRequest(`/boards/${uuid}/groups`, 'POST', data);
}

export async function moveBoardGroup(uuid, dx, dy) {
  if (nativeDataActive()) {
    const context = await nativeRepository.boardGroup(uuid);
    const receipt = await nativeRepository.transact(context.items.map((item) => ({
      table: 'board_items', uuid: item.uuid, operation: 'upsert',
      values: { x: item.x + dx, y: item.y + dy },
    })));
    return receipt.rows;
  }
  return jsonRequest(`/board-groups/${uuid}/move`, 'PUT', { dx, dy });
}

export async function updateBoardGroup(uuid, data) {
  if (nativeDataActive()) {
    await nativeRepository.transact([{ table: 'board_groups', uuid, operation: 'upsert', values: data }]);
    const context = await nativeRepository.boardGroup(uuid);
    return { ...context.group, item_uuids: context.items.map((item) => item.uuid) };
  }
  return jsonRequest(`/board-groups/${uuid}`, 'PUT', data);
}

export function ungroupBoardGroup(uuid, items) {
  if (nativeDataActive()) {
    return nativeRepository.transact([
      { table: 'board_groups', uuid, operation: 'delete', values: {} },
      ...items.map((item) => ({
        table: 'board_items', uuid: item.uuid, operation: 'upsert',
        values: { group_uuid: item.group_uuid, x: item.x, y: item.y },
      })),
    ]).then(() => null);
  }
  return jsonRequest(`/board-groups/${uuid}/ungroup`, 'POST', { items });
}

export function layoutBoardGroup(uuid, items) {
  if (nativeDataActive()) {
    return nativeRepository.transact(items.map((item) => ({
      table: 'board_items', uuid: item.uuid, operation: 'upsert',
      values: { x: item.x, y: item.y },
    }))).then((receipt) => receipt.rows);
  }
  return jsonRequest(`/board-groups/${uuid}/layout`, 'PUT', { items });
}

export async function addBoardComment(uuid, content, x, y) {
  if (nativeDataActive()) {
    const receipt = await nativeRepository.transact([{
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
      const receipt = await nativeRepository.transact([{
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
    return nativeRepository.transact([{ table: 'board_items', uuid, operation: 'delete', values: {} }]).then(() => null);
  }
  return request(`/board-items/${uuid}`, { method: 'DELETE' });
}

export function restoreBoardItem(uuid) {
  if (nativeDataActive()) {
    return nativeRepository.transact([{ table: 'board_items', uuid, operation: 'upsert', values: {} }])
      .then((receipt) => receipt.rows[0]);
  }
  return request(`/board-items/${uuid}/restore`, { method: 'POST' });
}

export function moveBoardItem(uuid, x, y) {
  if (nativeDataActive()) {
    return nativeRepository.transact([{ table: 'board_items', uuid, operation: 'upsert', values: { x, y } }])
      .then((receipt) => receipt.rows[0]);
  }
  return jsonRequest(`/board-items/${uuid}`, 'PUT', { x, y });
}

export function updateBoardItem(uuid, data) {
  if (nativeDataActive()) {
    return nativeRepository.transact([{ table: 'board_items', uuid, operation: 'upsert', values: data }])
      .then((receipt) => receipt.rows[0]);
  }
  return jsonRequest(`/board-items/${uuid}`, 'PUT', data);
}

export function addBoardYouTube(uuid, url, x, y) {
  if (nativeDataActive()) {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Video links must use http or https');
    return nativeRepository.transact([{
      table: 'board_items', uuid: newUuid(), operation: 'upsert',
      values: { board_uuid: uuid, kind: 'youtube', content: url, source_url: url, x, y },
    }]).then((receipt) => receipt.rows[0]);
  }
  return captured(jsonRequest(`/boards/${uuid}/youtube`, 'POST', { url, x, y }));
}

// A link card is on the board as soon as the server answers; its picture
// is a job. This resolves to the card once the picture is there, and
// rejects — with the card still on the board, as a link — when it could
// not be made. The error carries the card so the caller can show both.
// No job means the picture came with the answer.
async function captured(queuing) {
  const { job, item } = await queuing;
  if (!job) return item;
  try {
    await awaitJob(job);
  } catch (error) {
    if (error instanceof JobFailed) error.item = item;
    throw error;
  }
  return item;
}

export function addBoardWebpage(uuid, url, x, y) {
  if (nativeDataActive()) {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Page links must use http or https');
    const label = parsed.hostname;
    return nativeRepository.transact([{
      table: 'board_items', uuid: newUuid(), operation: 'upsert',
      values: { board_uuid: uuid, kind: 'webpage', content: label, source_url: url, x, y, width: 480 },
    }]).then((receipt) => receipt.rows[0]);
  }
  return captured(jsonRequest(`/boards/${uuid}/webpage`, 'POST', { url, x, y }));
}

export function placeStagedBoardItem(uuid, x, y) {
  if (nativeDataActive()) {
    return nativeRepository.transact([{
      table: 'board_items', uuid, operation: 'upsert', values: { x, y, staged: false },
    }]).then((receipt) => receipt.rows[0]);
  }
  return jsonRequest(`/board-items/${uuid}/place`, 'POST', { x, y });
}

export async function boardFileBlob(item) {
  if (nativeDataActive()) {
    if (!item.sha256) throw new Error('Board image is not available in the local replica');
    return nativeBlobUrl(item.sha256, item.mime_type);
  }
  const key = `${API_BASE}/board-items/${item.uuid}/file`;
  const response = await runtimeFetch(key, { headers: authHeaders() });
  if (!response.ok) await handleResponse(response);
  return URL.createObjectURL(await response.blob());
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
