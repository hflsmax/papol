import {
  boardView, discardNativeBlob, ensureNativeBlob, nativeBlobImport, nativeBlobUrl, nativeCaptureWebpage, nativeDataActive,
  nativeRepository, newUuid,
} from '../nativeData.js';
import { boardSourceDigests } from '../boardPapers.js';
import { inOfflineMode, runtimeFetch } from '../connectivity.js';
import { handleResponse, jsonRequest, request } from '../httpClient.js';
import { storeFile } from './files.js';
import { JobFailed, awaitJob } from './jobs.js';
import { canPreview, videoLink, videoPreview } from '../videos.js';

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

// A video card — YouTube or Bilibili — with its title and thumbnail
// (shared/videos.js), and nothing left for the server to do. The
// thumbnail is the card's file: in the nook's store on the desktop, which
// sync puts in the bucket before the card, or in the bucket already on the
// web, where the Cloudflare Worker put it. When the video's site cannot
// be reached the
// card is made as the link alone, and the promise rejects with it on the
// error, as a page card whose capture failed does. Where nothing can be
// tried — offline on the desktop, or a Bilibili link on the web, whose
// details only the Mac can fetch — nothing is wrong: the card is the
// link, and `fillVideoCard` fetches the rest when a board that can is
// open.
export async function addBoardVideo(uuid, url, x, y) {
  const link = videoLink(url);
  if (!link) throw new Error('Paste a YouTube or Bilibili video link');
  if (!canPreview(link) || (nativeDataActive() && inOfflineMode())) return makeVideoCard(uuid, url, link, x, y, null);
  let preview = null, failure = null;
  try {
    preview = await videoPreview(url);
  } catch (error) {
    failure = error;
  }
  const item = await makeVideoCard(uuid, url, link, x, y, preview);
  if (failure) {
    const error = new Error(`The video's title and thumbnail could not be fetched: ${failure.message || failure}`);
    error.item = item;
    throw error;
  }
  return item;
}

// Whether a card is a video card still waiting for its title and
// thumbnail, and this surface could fetch them: made as the link alone,
// offline, with the site unreachable, or (Bilibili) on the web.
export function videoCardUnfilled(item) {
  if (!['youtube', 'bilibili'].includes(item?.kind) || item.sha256 || item.file_path) return false;
  const link = videoLink(item.source_url || '');
  return link?.kind === item.kind && canPreview(link);
}

// Give such a card what it was made without, asked for as when a card is
// made: the thumbnail as its file, and the title as its text while that
// is still the bare link, so a description written since stands. Answers
// the card, or null when there is nothing to do or no way to do it now
// (offline on the desktop). Rejects when the video's site could not be
// reached; the caller tries again another time.
export async function fillVideoCard(item) {
  if (!videoCardUnfilled(item)) return null;
  if (nativeDataActive() && inOfflineMode()) return null;
  const preview = await videoPreview(item.source_url);
  const bare = !item.content || item.content === item.source_url;
  if (nativeDataActive()) {
    const picture = await nativePicture(item.kind, preview);
    return writeNativeCard(picture, {
      uuid: item.uuid, values: { ...picture.values, ...(bare && preview.title ? { content: preview.title } : {}) },
    });
  }
  return jsonRequest(`/board-items/${item.uuid}/thumbnail`, 'POST', { sha256: preview.sha256, title: preview.title });
}

const thumbnailName = (kind, id) => `${kind}-${id || 'video'}.jpg`;

// A video's picture in the nook's store, as its card records it: a
// YouTube picture brought from the bucket by its digest, a Bilibili cover
// the Mac fetched put in as it is.
async function nativePicture(kind, preview) {
  const sha256 = preview.sha256
    ? (await ensureNativeBlob(preview.sha256, undefined, { kind: 'board_file' }), preview.sha256)
    : (await nativeBlobImport(preview.image)).sha256;
  return { sha256, values: { sha256, original_filename: thumbnailName(kind, preview.id), mime_type: 'image/jpeg' } };
}

// The card written in the nook, and the picture let go if it could not be.
async function writeNativeCard(picture, { uuid, values }) {
  try {
    const receipt = await nativeRepository.transact([{ table: 'board_items', uuid, operation: 'upsert', values }]);
    return receipt.rows[0];
  } catch (error) {
    if (picture) await discardNativeBlob(picture.sha256).catch(() => {});
    throw error;
  }
}

// Whether a page card is waiting for its picture where this surface can
// take it: on the Mac, which takes it itself (nativeCaptureWebpage); the
// web's picture is the Cloudflare Worker's job, queued when the card is made.
export function pageCardUnfilled(item) {
  return item?.kind === 'webpage' && !item.sha256 && !item.file_path && Boolean(item.source_url) && nativeDataActive();
}

// Take the picture a page card was made without — offline, or when the
// page could not be captured — and give it to the card, with the page's
// title as its text while that is still the bare hostname. Answers the
// card, or null when there is nothing to do or no way to do it now.
export async function fillPageCard(item) {
  if (!pageCardUnfilled(item) || inOfflineMode()) return null;
  const picture = await nativeCaptureWebpage(item.source_url);
  const bare = !item.content || item.content === pageHost(item.source_url);
  try {
    const receipt = await nativeRepository.transact([{
      table: 'board_items', uuid: item.uuid, operation: 'upsert',
      values: {
        sha256: picture.sha256, original_filename: pageCaptureName(item.source_url), mime_type: 'image/jpeg',
        ...(bare && picture.title ? { content: picture.title } : {}),
      },
    }]);
    return receipt.rows[0];
  } catch (error) {
    await discardNativeBlob(picture.sha256).catch(() => {});
    throw error;
  }
}

// Every card a board can still give a picture to here: a video's title and
// thumbnail, a page's capture.
export function cardAwaitingPicture(item) {
  return videoCardUnfilled(item) || pageCardUnfilled(item);
}

export function fillCardPicture(item) {
  return item?.kind === 'webpage' ? fillPageCard(item) : fillVideoCard(item);
}

const pageHost = (url) => {
  try { return new URL(url).hostname; } catch { return ''; }
};

const pageCaptureName = (url) => `webpage-${(pageHost(url) || 'page').slice(0, 80)}.jpg`;

async function makeVideoCard(uuid, url, link, x, y, preview) {
  if (nativeDataActive()) {
    const picture = preview ? await nativePicture(link.kind, preview) : null;
    return writeNativeCard(picture, {
      uuid: newUuid(),
      values: { board_uuid: uuid, kind: link.kind, content: preview?.title || url, source_url: url, x, y, ...picture?.values },
    });
  }
  // The thumbnail is in the bucket already (POST /api/video-preview):
  // the card names it.
  return jsonRequest(`/boards/${uuid}/video`, 'POST', {
    url, x, y, ...(preview ? { sha256: preview.sha256, title: preview.title } : {}),
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

// A page card. On the web the Cloudflare Worker renders the page and the
// card waits for its job (`captured`). On the Mac the app takes the
// picture itself (nativeCaptureWebpage) and makes the card with it;
// offline the card is the link, and `fillPageCard` takes the picture when
// a board is next open online; a page that could not be captured is the
// link too, and the promise rejects with the card on the error, as on the
// web.
export async function addBoardWebpage(uuid, url, x, y) {
  if (!nativeDataActive()) return captured(jsonRequest(`/boards/${uuid}/webpage`, 'POST', { url, x, y }));
  const parsed = new URL(url);
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Page links must use http or https');
  let picture = null, failure = null;
  if (!inOfflineMode()) {
    try {
      picture = await nativeCaptureWebpage(url);
    } catch (error) {
      failure = error;
    }
  }
  let item;
  try {
    const receipt = await nativeRepository.transact([{
      table: 'board_items', uuid: newUuid(), operation: 'upsert',
      values: {
        board_uuid: uuid, kind: 'webpage', content: picture?.title || parsed.hostname, source_url: url, x, y, width: 480,
        ...(picture ? { sha256: picture.sha256, original_filename: pageCaptureName(url), mime_type: 'image/jpeg' } : {}),
      },
    }]);
    item = receipt.rows[0];
  } catch (error) {
    if (picture) await discardNativeBlob(picture.sha256).catch(() => {});
    throw error;
  }
  if (failure) {
    const error = new Error(`The page's picture could not be taken: ${failure.message || failure}`);
    error.item = item;
    throw error;
  }
  return item;
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
