import {
  boardView, discardNativeBlob, nativeBlobImport, nativeBlobUrl, nativeDataActive,
  nativeRepository, newUuid,
} from '../nativeData.js';
import { boardSourceDigests } from '../boardPapers.js';
import { inOfflineMode, runtimeFetch } from '../connectivity.js';
import { handleResponse, jsonRequest, request } from '../httpClient.js';
import { storeFile } from './files.js';
import { JobFailed, awaitJob } from './jobs.js';
import { youtubeId, youtubePreview } from '../youtube.js';

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

// The service answers a board with the papers its cards come from
// (`papers`); the replica is asked for each of them from what it keeps,
// which is every paper in this user's nook. One it does not keep is left
// to the title its cards were labelled with.
export async function getBoard(uuid) {
  if (!nativeDataActive()) return request(`/boards/${uuid}`);
  const board = boardView(await nativeRepository.board(uuid), true);
  const kept = await Promise.all(boardSourceDigests(board.items).map(
    (sha256) => nativeRepository.paperByPdf(sha256).catch(() => null),
  ));
  board.papers = kept.filter(Boolean).map((paper) => ({
    sha256: paper.sha256, title: paper.title, authors: paper.authors ?? null, year: paper.year ?? null,
  }));
  return board;
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

// `onProgress` hears the upload as it goes (shared/api/files.js).
export async function addBoardFile(uuid, file, caption = '', position = null, { onProgress } = {}) {
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
  // The bytes into the bucket (shared/api/files.js), then the card that names them.
  const stored = await storeFile('board_file', file, { name: file.name || 'file', onProgress });
  return jsonRequest(`/boards/${uuid}/files`, 'POST', {
    sha256: stored.sha256, caption, original_filename: file.name || 'file',
    mime_type: file.type || 'application/octet-stream',
    ...(position ? { x: position.x, y: position.y } : {}),
  });
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

// A video card, with the title and thumbnail the app fetches from YouTube
// itself (shared/youtube.js) — on the web and on the desktop alike, and
// with nothing left for the server to do. The thumbnail is the card's
// file: in the nook's store on the desktop, which sync puts in the bucket
// before the card, or in the bucket at once on the web. When YouTube
// cannot be reached the card is made as the link alone, and the promise
// rejects with it on the error, as a page card whose capture failed does.
// Offline on the desktop nothing is tried and nothing is wrong: the card
// is the link, and `fillVideoCard` fetches the rest once a board is open
// online.
export async function addBoardYouTube(uuid, url, x, y) {
  const videoId = youtubeId(url);
  if (!videoId) throw new Error('Paste a valid YouTube video URL');
  if (nativeDataActive() && inOfflineMode()) return makeVideoCard(uuid, url, videoId, x, y, null);
  let preview = null, failure = null;
  try {
    preview = await youtubePreview(videoId);
  } catch (error) {
    failure = error;
  }
  const item = await makeVideoCard(uuid, url, videoId, x, y, preview);
  if (failure) {
    const error = new Error(`The video's title and thumbnail could not be fetched: ${failure.message || failure}`);
    error.item = item;
    throw error;
  }
  return item;
}

// Whether a card is a video card still waiting for its title and
// thumbnail: made as the link alone, offline or with YouTube unreachable.
export function videoCardUnfilled(item) {
  return item?.kind === 'youtube' && !item.sha256 && !item.file_path && Boolean(youtubeId(item.source_url || ''));
}

// Give such a card what it was made without, fetched by the app as when a
// card is made: the thumbnail as its file, and the title as its text
// while that is still the bare link, so a description written since
// stands. Answers the card, or null when there is nothing to do or no way
// to do it now (offline on the desktop). Rejects when YouTube could not
// be reached; the caller tries again another time.
export async function fillVideoCard(item) {
  if (!videoCardUnfilled(item)) return null;
  if (nativeDataActive() && inOfflineMode()) return null;
  const videoId = youtubeId(item.source_url);
  const preview = await youtubePreview(videoId);
  const name = `youtube-${videoId}.jpg`;
  const bare = !item.content || item.content === item.source_url;
  if (nativeDataActive()) {
    const blob = await nativeBlobImport(preview.image);
    try {
      const receipt = await nativeRepository.transact([{
        table: 'board_items', uuid: item.uuid, operation: 'upsert',
        values: {
          sha256: blob.sha256, original_filename: name, mime_type: 'image/jpeg',
          ...(bare && preview.title ? { content: preview.title } : {}),
        },
      }]);
      return receipt.rows[0];
    } catch (error) {
      await discardNativeBlob(blob.sha256).catch(() => {});
      throw error;
    }
  }
  const stored = await storeFile('board_file', preview.image, { name, mime: 'image/jpeg' });
  return jsonRequest(`/board-items/${item.uuid}/thumbnail`, 'POST', { sha256: stored.sha256, title: preview.title });
}

async function makeVideoCard(uuid, url, videoId, x, y, preview) {
  const name = `youtube-${videoId}.jpg`;
  if (nativeDataActive()) {
    const blob = preview ? await nativeBlobImport(preview.image) : null;
    try {
      const receipt = await nativeRepository.transact([{
        table: 'board_items', uuid: newUuid(), operation: 'upsert',
        values: {
          board_uuid: uuid, kind: 'youtube', content: preview?.title || url, source_url: url, x, y,
          ...(blob ? { sha256: blob.sha256, original_filename: name, mime_type: 'image/jpeg' } : {}),
        },
      }]);
      return receipt.rows[0];
    } catch (error) {
      if (blob) await discardNativeBlob(blob.sha256).catch(() => {});
      throw error;
    }
  }
  // The thumbnail into the bucket (shared/api/files.js), then the card that names it.
  const stored = preview ? await storeFile('board_file', preview.image, { name, mime: 'image/jpeg' }) : null;
  return jsonRequest(`/boards/${uuid}/youtube`, 'POST', {
    url, x, y, ...(stored ? { sha256: stored.sha256, title: preview.title } : {}),
  });
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

// A card's file as an object URL: from the local replica on the desktop,
// else from where the card says it is fetched from — the bucket's own
// address, which no Worker touches, or a local Worker's route.
export async function boardFileBlob(item) {
  if (nativeDataActive()) {
    if (!item.sha256) throw new Error('Board image is not available in the local replica');
    return nativeBlobUrl(item.sha256, item.mime_type);
  }
  const response = await runtimeFetch(item.file_url);
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
