// The viewer is its own app but not its own world: it runs on Papol's
// origin and carries the same session token, so there is no second sign-in
// and no second idea of who a reader is.
// Both /viewer and /demo/viewer run this build. Step back once from the
// former and twice from the latter to reach Papol's root API and assets.
import { appPath, backendPath, inDemo } from './base.js';
import { IS_DESKTOP } from '../../shared/appEnvironment.js';
import { demoPaperMedia, hydrateDesktopMedia } from '../../shared/desktopMedia.js';
import { jsonRequest, request } from '../../shared/httpClient.js';
import {
  boardView, clipView, inkView, nativeBlobBytes, nativeBlobImport, nativeBlobUrl, nativeDataActive,
  nativeRepository, noteView, openedFileBlob, openedFileBytes,
  openedFileUrl, paperView, newUuid,
} from '../../shared/nativeData.js';
import { currentCredential } from '../../shared/credentials.js';
import { lookupPaperMetadata } from '../../shared/api/papers.js';

// The edition a paper's located notes are placed on.
const activeEditionByPaper = new Map();
const openedFileImports = new Map();

export function rememberPaperIdentity(paper) {
  if (paper?.uuid != null && paper.edition_uuid) activeEditionByPaper.set(paper.uuid, paper.edition_uuid);
  return paper;
}

export function getToken() {
  return currentCredential();
}

export async function getPaperByPdf(hash) {
  if (nativeDataActive()) {
    try {
      return rememberPaperIdentity(paperView(await nativeRepository.paperByPdf(hash)));
    } catch {
      // A public paper that has not been retained locally still comes from the service.
    }
  }
  return rememberPaperIdentity(await request(`/viewer/${hash}`));
}

export async function getPaperNotes(paper) {
  if (nativeDataActive()) {
    return (await nativeRepository.comments(paper.uuid)).map(noteView);
  }
  return paper.comments || [];
}

// A share uuid stands in for a session: the same public metadata, asked for
// by someone who is holding a link rather than signed in.
export function getViewerPaperInfo(hash, share) {
  return request(`/viewer/${hash}/info${share ? `?share=${share}` : ''}`);
}

export function pdfHref(paper) {
  if (!paper?.file_path) return null;
  if (paper.file_path.startsWith('http')) return paper.file_path;
  return backendPath(`/uploads/${paper.file_path}`);
}

// The reader's nook paper for these exact bytes, or null. Only the local
// replica is asked: a file opened from disk is not announced to Papol.
export async function getNookPaperByPdf(hash) {
  if (!nativeDataActive()) return null;
  try {
    return rememberPaperIdentity(paperView(await nativeRepository.paperByPdf(hash)));
  } catch {
    return null;
  }
}

function storedAnchor(anchor) {
  if (!anchor) return { anchor_type: null, anchor: null };
  const { type, ...rest } = anchor;
  return { anchor_type: type || null, anchor: JSON.stringify(rest) };
}

// A file opened from disk becomes a nook paper, and the notes, ink and clips
// made on it before then come along. Online imports are enriched before the
// local commit; offline imports retain the filename-derived fallback.
export async function addOpenedFileToNook({ sha256, name, notes = [], ink = [], clips = [] }) {
  if (!nativeDataActive()) throw new Error('Sign in to add this paper to your nook.');
  const pending = openedFileImports.get(sha256);
  if (pending) return pending;
  const importing = importOpenedFileToNook({ sha256, name, notes, ink, clips });
  openedFileImports.set(sha256, importing);
  try {
    return await importing;
  } finally {
    if (openedFileImports.get(sha256) === importing) openedFileImports.delete(sha256);
  }
}

async function importOpenedFileToNook({ sha256, name, notes, ink, clips }) {
  let paper = await getNookPaperByPdf(sha256);
  if (!paper) {
    const blob = await openedFileBlob(sha256);
    const stored = await nativeBlobImport(blob);
    if (stored.sha256 !== sha256) throw new Error('The file changed while it was open.');
    // Opening a file remains private. Once the reader explicitly adds it,
    // use the same authenticated parser as the upload form so the replica
    // starts with bibliographic metadata instead of a filename-only stub.
    const metadata = await lookupPaperMetadata(blob, name);
    const shelves = await nativeRepository.shelves();
    const shelf = shelves.find((row) => row.is_default === true || row.is_default === 1)
      || shelves[0];
    const paperUuid = newUuid();
    const editionUuid = newUuid();
    await nativeRepository.transact([
      {
        table: 'papers', uuid: paperUuid, operation: 'upsert',
        values: {
          doi: metadata?.doi ?? null,
          title: metadata?.title || name,
          authors: metadata?.authors ?? null,
          journal: metadata?.journal ?? null,
          year: metadata?.year ?? null,
        },
      },
      {
        table: 'paper_editions', uuid: editionUuid, operation: 'upsert',
        values: { paper_uuid: paperUuid, file_path: `${sha256}.pdf`, sha256 },
      },
      {
        table: 'copies', uuid: newUuid(), operation: 'upsert',
        values: {
          paper_uuid: paperUuid, shelf_uuid: shelf?.uuid ?? null,
          edition_uuid: editionUuid, edition_sha256: sha256,
        },
      },
    ]);
    paper = { uuid: paperUuid, edition_uuid: editionUuid };
  }

  const paperUuid = paper.uuid;
  const editionUuid = paper.edition_uuid;
  if (!editionUuid) throw new Error('This paper has no readable PDF edition.');

  const marks = [
    ...notes.map((note) => ({
      table: 'comments', uuid: note.uuid, operation: 'upsert',
      values: {
        paper_uuid: paperUuid, edition_uuid: editionUuid, page: note.page ?? null,
        ...storedAnchor(note.anchor), content: note.content || '', name: note.name || null,
      },
    })),
    ...ink.map(({ uuid, kind: _kind, created_at: _createdAt, ...stroke }) => ({
      table: 'ink_strokes', uuid, operation: 'upsert',
      values: { ...stroke, edition_uuid: editionUuid, points: JSON.stringify(stroke.points) },
    })),
    ...clips.map(({ uuid, kind: _kind, created_at: _createdAt, ...clip }) => ({
      table: 'paper_clips', uuid, operation: 'upsert',
      values: {
        ...clip, edition_uuid: editionUuid,
        source: JSON.stringify(clip.source), frame: JSON.stringify(clip.frame),
      },
    })),
  ];
  for (let start = 0; start < marks.length; start += 200) {
    await nativeRepository.transact(marks.slice(start, start + 200));
  }
  return paperUuid;
}

// A PDF someone shared is theirs, not this machine's: its bytes come from
// the service even when a local replica is open in the same app.
const sharedReading = (paper) => Boolean(paper?.shared_by);

export async function downloadablePdfHref(paper) {
  if (paper?.opened_file && !paper.uuid) return openedFileUrl(paper.edition_sha256);
  if (sharedReading(paper)) return pdfHref(paper);
  if (nativeDataActive()) {
    if (!paper?.edition_sha256) throw new Error('PDF is not available in the local replica');
    return nativeBlobUrl(paper.edition_sha256, 'application/pdf');
  }
  return pdfHref(paper);
}

// PDF.js treats a URL as a network request. macOS WebKit reports requests to
// Tauri-created blob: URLs with status 0, which PDF.js rejects even though the
// bytes are present. Native viewers therefore hand PDF.js the bytes directly.
export async function pdfLoadInput(paper) {
  if (paper?.opened_file && !paper.uuid) {
    return { data: await openedFileBytes(paper.edition_sha256) };
  }
  if (sharedReading(paper)) return { url: pdfHref(paper) };
  if (IS_DESKTOP && inDemo()) {
    const asset = demoPaperMedia(paper?.edition_sha256);
    if (!asset) throw new Error('This paper requires a network connection.');
    return { data: await hydrateDesktopMedia(asset) };
  }
  if (nativeDataActive()) {
    if (!paper?.edition_sha256) throw new Error('PDF is not available in the local replica');
    return { data: await nativeBlobBytes(paper.edition_sha256) };
  }
  return { url: pdfHref(paper) };
}

export function listBoards() {
  if (nativeDataActive()) return nativeRepository.boards().then((rows) => rows.map((row) => boardView(row)));
  return request('/boards');
}

export function stageBoardExcerpt(boardUuid, data) {
  if (nativeDataActive()) {
    return nativeRepository.transact([{
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
    const receipt = await nativeRepository.transact([{
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
    return nativeRepository.transact([{
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
    return nativeRepository.transact([{ table: 'comments', uuid, operation: 'patch', values: { content } }])
      .then((receipt) => noteView(receipt.rows[0]));
  }
  return jsonRequest(`/comments/${uuid}`, 'PUT', { content });
}

export function moveNote(uuid, { page, anchor }) {
  if (nativeDataActive() && typeof uuid === 'string') {
    const payload = { ...anchor }; const anchorType = payload.type; delete payload.type;
    return nativeRepository.transact([{
      table: 'comments', uuid, operation: 'patch',
      values: { page, anchor_type: anchorType, anchor: JSON.stringify(payload) },
    }]).then((receipt) => noteView(receipt.rows[0]));
  }
  return jsonRequest(`/comments/${uuid}`, 'PUT', { page, anchor });
}

export function renameNote(uuid, name) {
  if (nativeDataActive() && typeof uuid === 'string') {
    return nativeRepository.transact([{ table: 'comments', uuid, operation: 'patch', values: { name } }])
      .then((receipt) => noteView(receipt.rows[0]));
  }
  return jsonRequest(`/comments/${uuid}`, 'PUT', { name });
}

export function deleteNote(uuid) {
  if (nativeDataActive() && typeof uuid === 'string') {
    return nativeRepository.transact([{ table: 'comments', uuid, operation: 'delete', values: {} }]).then(() => null);
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

// The same two questions, asked on the authority of a shared link. The
// bibliography belongs to the PDF, so the answers are the same ones; only
// what allows the asking differs.
export function getSharedReferences(share, pdfHash, editionUuid) {
  return request(`/viewer-references/${pdfHash}?edition_uuid=${editionUuid}&share=${share}`);
}

export function getSharedReference(share, referenceUuid) {
  return request(`/viewer-references/item/${referenceUuid}?share=${share}`);
}

export function resolveViewerReference(pdfHash, { key, raw }) {
  return jsonRequest(`/viewer-references/${pdfHash}/preview`, 'POST', { key, raw });
}

// ---- Ink ----

// What the reader has drawn on this edition. Kept per edition, like the
// references: the marks were made over a particular PDF.
export function getInk(editionUuid) {
  if (nativeDataActive()) {
    return nativeRepository.ink(editionUuid)
      .then((rows) => rows.map(inkView));
  }
  return request(`/editions/${editionUuid}/ink`);
}

export function addInk(editionUuid, stroke) {
  if (nativeDataActive()) {
    return nativeRepository.transact([{
      table: 'ink_strokes', uuid: newUuid(), operation: 'upsert',
      values: { ...stroke, edition_uuid: editionUuid, points: JSON.stringify(stroke.points) },
    }]).then((receipt) => inkView(receipt.rows[0]));
  }
  return jsonRequest(`/editions/${editionUuid}/ink`, 'POST', stroke);
}

export function moveInk(strokeUuid, points) {
  if (nativeDataActive() && typeof strokeUuid === 'string') {
    return nativeRepository.transact([{
      table: 'ink_strokes', uuid: strokeUuid, operation: 'patch', values: { points: JSON.stringify(points) },
    }]).then((receipt) => inkView(receipt.rows[0]));
  }
  return jsonRequest(`/ink/${strokeUuid}`, 'PUT', { points });
}

export function eraseInk(strokeUuid) {
  if (nativeDataActive() && typeof strokeUuid === 'string') {
    return nativeRepository.transact([{ table: 'ink_strokes', uuid: strokeUuid, operation: 'delete', values: {} }]).then(() => null);
  }
  return request(`/ink/${strokeUuid}`, { method: 'DELETE' });
}

// ---- Clips ----

export function getClips(editionUuid) {
  if (nativeDataActive()) {
    return nativeRepository.clips(editionUuid)
      .then((rows) => rows.map(clipView));
  }
  return request(`/editions/${editionUuid}/clips`);
}

export function addClip(editionUuid, clip) {
  if (nativeDataActive()) {
    return nativeRepository.transact([{
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
    return nativeRepository.transact([{
      table: 'paper_clips', uuid: clipUuid, operation: 'patch',
      values: { frame: JSON.stringify(frame), floating },
    }]).then((receipt) => clipView(receipt.rows[0]));
  }
  return jsonRequest(`/clips/${clipUuid}`, 'PUT', { frame, floating });
}

export function eraseClip(clipUuid) {
  if (nativeDataActive() && typeof clipUuid === 'string') {
    return nativeRepository.transact([{ table: 'paper_clips', uuid: clipUuid, operation: 'delete', values: {} }]).then(() => null);
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
