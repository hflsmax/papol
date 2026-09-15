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
  annotationView, boardView, nativeBlobBytes, nativeBlobImport, nativeBlobUrl,
  nativeDataActive, nativeRepository, openedFileBlob, openedFileBytes,
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
    return listAnnotations(paper.uuid, { kind: 'note' });
  }
  return paper.notes || [];
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

  // One table now, so the three kinds are the same mapping with a different
  // kind and a different body.
  const stored = (kind, { uuid, page, content, name, group_uuid: groupUuid, ...body }) => ({
    table: 'annotations', uuid, operation: 'upsert',
    values: {
      kind, paper_uuid: paperUuid, edition_uuid: editionUuid,
      page: page ?? null, group_uuid: groupUuid ?? null,
      content: content || '', name: name || null,
      body: JSON.stringify(body),
    },
  });
  const marks = [
    ...notes.map(({ anchor, ...note }) => stored('note', { ...note, anchor: anchor ?? null })),
    ...ink.map(({ created_at: _drawn, ...stroke }) => stored('ink', stroke)),
    ...clips.map(({ created_at: _cut, ...clip }) => stored('clip', clip)),
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

// ---- Annotations ----
//
// Notes, ink and clips are one kind of thing with three shapes, so they are
// made, changed and erased through one pair of calls. `kind` says which, and
// `body` carries the geometry only that kind has.

export function listAnnotations(paperUuid, { editionUuid, kind } = {}) {
  if (nativeDataActive()) {
    return nativeRepository
      .annotations(paperUuid, editionUuid ?? null, kind ?? null)
      .then((rows) => rows.map(annotationView));
  }
  const query = new URLSearchParams();
  if (editionUuid) query.set('edition_uuid', editionUuid);
  if (kind) query.set('kind', kind);
  const suffix = query.size ? `?${query}` : '';
  return request(`/papers/${paperUuid}/annotations${suffix}`);
}

export function createAnnotation(paperUuid, annotation) {
  const editionUuid = annotation.edition_uuid
    ?? activeEditionByPaper.get(paperUuid)
    ?? null;
  if (nativeDataActive()) {
    return nativeRepository.transact([{
      table: 'annotations', uuid: newUuid(), operation: 'upsert',
      values: {
        kind: annotation.kind,
        paper_uuid: paperUuid,
        edition_uuid: annotation.kind === 'note' ? editionUuid : editionUuid,
        page: annotation.page ?? null,
        group_uuid: annotation.group_uuid ?? null,
        content: annotation.content ?? '',
        name: annotation.name ?? null,
        body: JSON.stringify(annotation.body ?? {}),
      },
    }]).then((receipt) => annotationView(receipt.rows[0]));
  }
  return jsonRequest(`/papers/${paperUuid}/annotations`, 'POST', {
    ...annotation, edition_uuid: editionUuid,
  });
}

export function updateAnnotation(uuid, changes) {
  if (nativeDataActive() && typeof uuid === 'string') {
    const values = {};
    for (const field of ['page', 'content', 'name']) {
      if (changes[field] !== undefined) values[field] = changes[field];
    }
    if (changes.body !== undefined) values.body = JSON.stringify(changes.body);
    return nativeRepository
      .transact([{ table: 'annotations', uuid, operation: 'patch', values }])
      .then((receipt) => annotationView(receipt.rows[0]));
  }
  return jsonRequest(`/annotations/${uuid}`, 'PUT', changes);
}

export function deleteAnnotation(uuid) {
  if (nativeDataActive() && typeof uuid === 'string') {
    return nativeRepository
      .transact([{ table: 'annotations', uuid, operation: 'delete', values: {} }])
      .then(() => null);
  }
  return request(`/annotations/${uuid}`, { method: 'DELETE' });
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

// ---- Feedback ----

export function submitFeedback({ content, page, contact }) {
  return jsonRequest('/feedback', 'POST', {
    content,
    page: page || null,
    contact: contact || null,
  });
}
