// The viewer is its own app but not its own world: it runs on Papol's
// origin and carries the same session token, so there is no second sign-in
// and no second idea of who a reader is.
// Both /viewer and /demo/viewer run this build. Step back once from the
// former and twice from the latter to reach Papol's root API and assets.
import { appPath, backendPath } from './base.js';
import { fetch as tauriHttpFetch } from '@tauri-apps/plugin-http';
import { IS_DESKTOP } from '../../shared/appEnvironment.js';
import {
  configureNetworkFetch, configureReplayAuthorization, offlineFetch, offlinePdfUrl,
} from '../../shared/offlineStore.js';
import {
  boardView, clipView, inkView, nativeBlobImport, nativeBlobUrl, nativeDataActive, nativeMutate,
  nativeQuery, noteView, paperView, uuid,
} from '../../frontend/src/nativeData.js';
import { currentCredential } from '../../shared/credentials.js';

const networkFetch = IS_DESKTOP
  ? tauriHttpFetch
  : (...args) => window.fetch(...args);
configureNetworkFetch(networkFetch);
configureReplayAuthorization(() => {
  const token = currentCredential();
  return token ? `Bearer ${token}` : null;
});

const API_BASE = backendPath('/api');
const paperSyncIds = new Map();
const editionSyncIds = new Map();
const activeEditionByPaper = new Map();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function nativeEditionId(editionId) {
  const key = String(editionId);
  return editionSyncIds.get(key) || (UUID.test(key) ? key : null);
}

export function rememberPaperIdentity(paper) {
  if (paper?.id != null && paper.sync_id) paperSyncIds.set(String(paper.id), paper.sync_id);
  for (const edition of paper?.editions || []) {
    if (edition?.id != null && edition.sync_id) editionSyncIds.set(String(edition.id), edition.sync_id);
  }
  if (paper?.id != null && paper.edition_sync_id) {
    activeEditionByPaper.set(String(paper.id), paper.edition_sync_id);
  }
  return paper;
}

export function getToken() {
  return currentCredential();
}

async function request(path, options = {}) {
  const token = getToken();
  const response = await offlineFetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      ...(options.headers || {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!response.ok) {
    let message = `Error ${response.status}`;
    try {
      message = (await response.json()).detail || message;
    } catch {
      /* keep the status */
    }
    const err = new Error(typeof message === 'string' ? message : JSON.stringify(message));
    err.status = response.status;
    throw err;
  }
  return response.json();
}

function jsonRequest(path, method, body) {
  return request(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export async function getPaperByPdf(hash) {
  if (nativeDataActive()) {
    try {
      const paper = rememberPaperIdentity(paperView(await nativeQuery('paper_by_pdf', { sha256: hash })));
      paper.comments = (await nativeQuery('comments', { parent_id: paper.sync_id })).map(noteView);
      return paper;
    } catch {
      // A public paper that has not been retained locally still comes from the service.
    }
  }
  const paper = rememberPaperIdentity(await request(`/viewer/${hash}`));
  if (nativeDataActive() && paper.sync_id) {
    paper.comments = (await nativeQuery('comments', { parent_id: paper.sync_id })).map(noteView);
  }
  return paper;
}

export function getViewerPaperInfo(hash) {
  return request(`/viewer/${hash}/info`);
}

export function pdfHref(paper) {
  if (!paper?.file_path) return null;
  if (paper.file_path.startsWith('http')) return paper.file_path;
  if (paper.file_path.startsWith('offline-file:')) return paper.file_path;
  // Demo papers are shipped with the app; uploaded ones live in /uploads.
  if (paper.file_path.startsWith('assets/')) return appPath(`/${paper.file_path}`);
  return backendPath(`/uploads/${paper.file_path}`);
}

export async function cachedPdfHref(paper) {
  if (nativeDataActive() && paper?.edition_sha256) {
    try { return await nativeBlobUrl(paper.edition_sha256, 'application/pdf'); } catch { /* fetch below */ }
  }
  return offlinePdfUrl(pdfHref(paper));
}

export function listBoards() {
  if (nativeDataActive()) return nativeQuery('boards').then((rows) => rows.map((row) => boardView(row)));
  return request('/boards');
}

export function stageBoardExcerpt(boardGuid, data) {
  if (nativeDataActive()) {
    return nativeMutate([{
      table: 'board_items', id: uuid(), operation: 'upsert',
      values: {
        board_id: boardGuid, kind: 'excerpt', excerpt_text: data.excerpt_text,
        content: data.content, source_url: data.source_url,
        source_label: data.source_label, staged: true,
      },
    }]).then((receipt) => receipt.rows[0]);
  }
  return jsonRequest(`/boards/${boardGuid}/staging`, 'POST', data);
}

export async function stageBoardClip(boardGuid, { blob, comment, sourceUrl, sourceLabel }) {
  if (nativeDataActive()) {
    const stored = await nativeBlobImport(blob);
    const receipt = await nativeMutate([{
      table: 'board_items', id: uuid(), operation: 'upsert',
      values: {
        board_id: boardGuid, kind: 'image', content: comment || null,
        blob_sha256: stored.sha256, original_filename: 'paper-clip.png',
        mime_type: 'image/png', source_url: sourceUrl,
        source_label: sourceLabel, staged: true,
      },
    }]);
    return receipt.rows[0];
  }
  const body = new FormData();
  body.append('file', blob, 'paper-clip.png');
  body.append('caption', comment || '');
  body.append('source_url', sourceUrl);
  body.append('source_label', sourceLabel);
  return request(`/boards/${boardGuid}/staging/clip`, { method: 'POST', body });
}

// A located note is a note: the same endpoints Papol's own notes use, with
// a page and an anchor attached.
export function createNote(paperId, { page, anchor, content }) {
  if (nativeDataActive() && paperSyncIds.has(String(paperId))) {
    const payload = anchor ? { ...anchor } : null;
    const anchorType = payload?.type || null;
    if (payload) delete payload.type;
    return nativeMutate([{
      table: 'comments', id: uuid(), operation: 'upsert',
      values: {
        paper_id: paperSyncIds.get(String(paperId)),
        edition_id: activeEditionByPaper.get(String(paperId)) || null,
        page: page ?? null, anchor_type: anchorType,
        anchor: payload ? JSON.stringify(payload) : null, content,
      },
    }]).then((receipt) => noteView(receipt.rows[0]));
  }
  return jsonRequest(`/papers/${paperId}/comments`, 'POST', { page, anchor, content });
}

export function updateNote(id, content) {
  if (nativeDataActive() && typeof id === 'string') {
    return nativeMutate([{ table: 'comments', id, operation: 'patch', values: { content } }])
      .then((receipt) => noteView(receipt.rows[0]));
  }
  return jsonRequest(`/comments/${id}`, 'PUT', { content });
}

export function moveNote(id, { page, anchor }) {
  if (nativeDataActive() && typeof id === 'string') {
    const payload = { ...anchor }; const anchorType = payload.type; delete payload.type;
    return nativeMutate([{
      table: 'comments', id, operation: 'patch',
      values: { page, anchor_type: anchorType, anchor: JSON.stringify(payload) },
    }]).then((receipt) => noteView(receipt.rows[0]));
  }
  return jsonRequest(`/comments/${id}`, 'PUT', { page, anchor });
}

export function renameNote(id, name) {
  if (nativeDataActive() && typeof id === 'string') {
    return nativeMutate([{ table: 'comments', id, operation: 'patch', values: { name } }])
      .then((receipt) => noteView(receipt.rows[0]));
  }
  return jsonRequest(`/comments/${id}`, 'PUT', { name });
}

export function deleteNote(id) {
  if (nativeDataActive() && typeof id === 'string') {
    return nativeMutate([{ table: 'comments', id, operation: 'delete', values: {} }]).then(() => null);
  }
  return request(`/comments/${id}`, { method: 'DELETE' });
}

// ---- References ----

// The bibliography of the PDF being read, and where each work is cited in
// it. The first ask may answer `pending`: reading a PDF's references takes
// a pass over the whole document, which happens once and is then kept.
export function getViewerReferences(pdfHash, editionId) {
  return request(`/viewer-references/${pdfHash}?edition_id=${editionId}`);
}

// One reference, looked up the first time anyone opens it.
export function getViewerReference(id) {
  return request(`/viewer-references/item/${id}`);
}

export function resolveViewerReference(pdfHash, { key, raw }) {
  return jsonRequest(`/viewer-references/${pdfHash}/preview`, 'POST', { key, raw });
}

// ---- Ink ----

// What the reader has drawn on this edition. Kept per edition, like the
// references: the marks were made over a particular PDF.
export function getInk(editionId) {
  const localEditionId = nativeEditionId(editionId);
  if (nativeDataActive() && localEditionId) {
    return nativeQuery('ink', { parent_id: localEditionId })
      .then((rows) => rows.map(inkView));
  }
  return request(`/editions/${editionId}/ink`);
}

export function addInk(editionId, stroke) {
  const localEditionId = nativeEditionId(editionId);
  if (nativeDataActive() && localEditionId) {
    return nativeMutate([{
      table: 'ink_strokes', id: uuid(), operation: 'upsert',
      values: { ...stroke, edition_id: localEditionId, points: JSON.stringify(stroke.points) },
    }]).then((receipt) => inkView(receipt.rows[0]));
  }
  return jsonRequest(`/editions/${editionId}/ink`, 'POST', stroke);
}

export function moveInk(strokeId, points) {
  if (nativeDataActive() && typeof strokeId === 'string') {
    return nativeMutate([{
      table: 'ink_strokes', id: strokeId, operation: 'patch', values: { points: JSON.stringify(points) },
    }]).then((receipt) => inkView(receipt.rows[0]));
  }
  return jsonRequest(`/ink/${strokeId}`, 'PUT', { points });
}

export function eraseInk(strokeId) {
  if (nativeDataActive() && typeof strokeId === 'string') {
    return nativeMutate([{ table: 'ink_strokes', id: strokeId, operation: 'delete', values: {} }]).then(() => null);
  }
  return request(`/ink/${strokeId}`, { method: 'DELETE' });
}

// ---- Clips ----

export function getClips(editionId) {
  const localEditionId = nativeEditionId(editionId);
  if (nativeDataActive() && localEditionId) {
    return nativeQuery('clips', { parent_id: localEditionId })
      .then((rows) => rows.map(clipView));
  }
  return request(`/editions/${editionId}/clips`);
}

export function addClip(editionId, clip) {
  const localEditionId = nativeEditionId(editionId);
  if (nativeDataActive() && localEditionId) {
    return nativeMutate([{
      table: 'paper_clips', id: uuid(), operation: 'upsert',
      values: {
        ...clip, edition_id: localEditionId,
        source: JSON.stringify(clip.source), frame: JSON.stringify(clip.frame),
      },
    }]).then((receipt) => clipView(receipt.rows[0]));
  }
  return jsonRequest(`/editions/${editionId}/clips`, 'POST', clip);
}

export function moveClip(clipId, frame, floating) {
  if (nativeDataActive() && typeof clipId === 'string') {
    return nativeMutate([{
      table: 'paper_clips', id: clipId, operation: 'patch',
      values: { frame: JSON.stringify(frame), floating },
    }]).then((receipt) => clipView(receipt.rows[0]));
  }
  return jsonRequest(`/clips/${clipId}`, 'PUT', { frame, floating });
}

export function eraseClip(clipId) {
  if (nativeDataActive() && typeof clipId === 'string') {
    return nativeMutate([{ table: 'paper_clips', id: clipId, operation: 'delete', values: {} }]).then(() => null);
  }
  return request(`/clips/${clipId}`, { method: 'DELETE' });
}

// ---- Feedback ----

export function submitFeedback({ content, page, contact }) {
  return jsonRequest('/feedback', 'POST', {
    content,
    page: page || null,
    contact: contact || null,
  });
}
