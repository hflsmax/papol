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
  nativeQuery, noteView, paperView, newUuid,
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
// The edition a paper's located notes are placed on.
const activeEditionByPaper = new Map();

export function rememberPaperIdentity(paper) {
  if (paper?.uuid != null && paper.edition_uuid) activeEditionByPaper.set(paper.uuid, paper.edition_uuid);
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
      paper.comments = (await nativeQuery('comments', { parent_uuid: paper.uuid })).map(noteView);
      return paper;
    } catch {
      // A public paper that has not been retained locally still comes from the service.
    }
  }
  const paper = rememberPaperIdentity(await request(`/viewer/${hash}`));
  if (nativeDataActive()) {
    paper.comments = (await nativeQuery('comments', { parent_uuid: paper.uuid })).map(noteView);
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
  return backendPath(`/uploads/${paper.file_path}`);
}

export async function cachedPdfHref(paper) {
  if (nativeDataActive()) {
    if (!paper?.edition_sha256) throw new Error('PDF is not available in the local replica');
    return nativeBlobUrl(paper.edition_sha256, 'application/pdf');
  }
  return offlinePdfUrl(pdfHref(paper));
}

export function listBoards() {
  if (nativeDataActive()) return nativeQuery('boards').then((rows) => rows.map((row) => boardView(row)));
  return request('/boards');
}

export function stageBoardExcerpt(boardUuid, data) {
  if (nativeDataActive()) {
    return nativeMutate([{
      table: 'board_items', uuid: newUuid(), operation: 'upsert',
      values: {
        board_uuid: boardUuid, kind: 'excerpt', excerpt_text: data.excerpt_text,
        content: data.content, source_url: data.source_url,
        source_label: data.source_label, staged: true,
      },
    }]).then((receipt) => receipt.rows[0]);
  }
  return jsonRequest(`/boards/${boardUuid}/staging`, 'POST', data);
}

export async function stageBoardClip(boardUuid, { blob, comment, sourceUrl, sourceLabel }) {
  if (nativeDataActive()) {
    const stored = await nativeBlobImport(blob);
    const receipt = await nativeMutate([{
      table: 'board_items', uuid: newUuid(), operation: 'upsert',
      values: {
        board_uuid: boardUuid, kind: 'image', content: comment || null,
        sha256: stored.sha256, original_filename: 'paper-clip.png',
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
  return request(`/boards/${boardUuid}/staging/clip`, { method: 'POST', body });
}

// A located note is a note: the same endpoints Papol's own notes use, with
// a page and an anchor attached.
export function createNote(paperUuid, { page, anchor, content }) {
  if (nativeDataActive()) {
    const payload = anchor ? { ...anchor } : null;
    const anchorType = payload?.type || null;
    if (payload) delete payload.type;
    return nativeMutate([{
      table: 'comments', uuid: newUuid(), operation: 'upsert',
      values: {
        paper_uuid: paperUuid,
        edition_uuid: activeEditionByPaper.get(paperUuid) || null,
        page: page ?? null, anchor_type: anchorType,
        anchor: payload ? JSON.stringify(payload) : null, content,
      },
    }]).then((receipt) => noteView(receipt.rows[0]));
  }
  return jsonRequest(`/papers/${paperUuid}/comments`, 'POST', { page, anchor, content });
}

export function updateNote(uuid, content) {
  if (nativeDataActive() && typeof uuid === 'string') {
    return nativeMutate([{ table: 'comments', uuid, operation: 'patch', values: { content } }])
      .then((receipt) => noteView(receipt.rows[0]));
  }
  return jsonRequest(`/comments/${uuid}`, 'PUT', { content });
}

export function moveNote(uuid, { page, anchor }) {
  if (nativeDataActive() && typeof uuid === 'string') {
    const payload = { ...anchor }; const anchorType = payload.type; delete payload.type;
    return nativeMutate([{
      table: 'comments', uuid, operation: 'patch',
      values: { page, anchor_type: anchorType, anchor: JSON.stringify(payload) },
    }]).then((receipt) => noteView(receipt.rows[0]));
  }
  return jsonRequest(`/comments/${uuid}`, 'PUT', { page, anchor });
}

export function renameNote(uuid, name) {
  if (nativeDataActive() && typeof uuid === 'string') {
    return nativeMutate([{ table: 'comments', uuid, operation: 'patch', values: { name } }])
      .then((receipt) => noteView(receipt.rows[0]));
  }
  return jsonRequest(`/comments/${uuid}`, 'PUT', { name });
}

export function deleteNote(uuid) {
  if (nativeDataActive() && typeof uuid === 'string') {
    return nativeMutate([{ table: 'comments', uuid, operation: 'delete', values: {} }]).then(() => null);
  }
  return request(`/comments/${uuid}`, { method: 'DELETE' });
}

// ---- References ----

// The bibliography of the PDF being read, and where each work is cited in
// it. The first ask may answer `pending`: reading a PDF's references takes
// a pass over the whole document, which happens once and is then kept.
export function getViewerReferences(pdfHash, editionUuid) {
  return request(`/viewer-references/${pdfHash}?edition_uuid=${editionUuid}`);
}

// One reference, looked up the first time anyone opens it.
export function getViewerReference(uuid) {
  return request(`/viewer-references/item/${uuid}`);
}

export function resolveViewerReference(pdfHash, { key, raw }) {
  return jsonRequest(`/viewer-references/${pdfHash}/preview`, 'POST', { key, raw });
}

// ---- Ink ----

// What the reader has drawn on this edition. Kept per edition, like the
// references: the marks were made over a particular PDF.
export function getInk(editionUuid) {
  if (nativeDataActive()) {
    return nativeQuery('ink', { parent_uuid: editionUuid })
      .then((rows) => rows.map(inkView));
  }
  return request(`/editions/${editionUuid}/ink`);
}

export function addInk(editionUuid, stroke) {
  if (nativeDataActive()) {
    return nativeMutate([{
      table: 'ink_strokes', uuid: newUuid(), operation: 'upsert',
      values: { ...stroke, edition_uuid: editionUuid, points: JSON.stringify(stroke.points) },
    }]).then((receipt) => inkView(receipt.rows[0]));
  }
  return jsonRequest(`/editions/${editionUuid}/ink`, 'POST', stroke);
}

export function moveInk(strokeUuid, points) {
  if (nativeDataActive() && typeof strokeUuid === 'string') {
    return nativeMutate([{
      table: 'ink_strokes', uuid: strokeUuid, operation: 'patch', values: { points: JSON.stringify(points) },
    }]).then((receipt) => inkView(receipt.rows[0]));
  }
  return jsonRequest(`/ink/${strokeUuid}`, 'PUT', { points });
}

export function eraseInk(strokeUuid) {
  if (nativeDataActive() && typeof strokeUuid === 'string') {
    return nativeMutate([{ table: 'ink_strokes', uuid: strokeUuid, operation: 'delete', values: {} }]).then(() => null);
  }
  return request(`/ink/${strokeUuid}`, { method: 'DELETE' });
}

// ---- Clips ----

export function getClips(editionUuid) {
  if (nativeDataActive()) {
    return nativeQuery('clips', { parent_uuid: editionUuid })
      .then((rows) => rows.map(clipView));
  }
  return request(`/editions/${editionUuid}/clips`);
}

export function addClip(editionUuid, clip) {
  if (nativeDataActive()) {
    return nativeMutate([{
      table: 'paper_clips', uuid: newUuid(), operation: 'upsert',
      values: {
        ...clip, edition_uuid: editionUuid,
        source: JSON.stringify(clip.source), frame: JSON.stringify(clip.frame),
      },
    }]).then((receipt) => clipView(receipt.rows[0]));
  }
  return jsonRequest(`/editions/${editionUuid}/clips`, 'POST', clip);
}

export function moveClip(clipUuid, frame, floating) {
  if (nativeDataActive() && typeof clipUuid === 'string') {
    return nativeMutate([{
      table: 'paper_clips', uuid: clipUuid, operation: 'patch',
      values: { frame: JSON.stringify(frame), floating },
    }]).then((receipt) => clipView(receipt.rows[0]));
  }
  return jsonRequest(`/clips/${clipUuid}`, 'PUT', { frame, floating });
}

export function eraseClip(clipUuid) {
  if (nativeDataActive() && typeof clipUuid === 'string') {
    return nativeMutate([{ table: 'paper_clips', uuid: clipUuid, operation: 'delete', values: {} }]).then(() => null);
  }
  return request(`/clips/${clipUuid}`, { method: 'DELETE' });
}

// ---- Feedback ----

export function submitFeedback({ content, page, contact }) {
  return jsonRequest('/feedback', 'POST', {
    content,
    page: page || null,
    contact: contact || null,
  });
}
