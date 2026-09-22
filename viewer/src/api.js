// The viewer is its own app but not its own world: it runs on Papol's
// origin and carries the same session token, so there is no second sign-in
// and no second idea of who a user is.
import { appPath, backendPath } from './base.js';
import { jsonRequest, request } from '../../shared/httpClient.js';
import {
  annotationView, boardView, nativeBlobBytes, nativeBlobImport, nativeBlobUrl,
  ensureNativeBlob, nativeDataActive, nativeRepository, openedFileBlob, openedFileBytes,
  openedFileUrl, paperView, newUuid,
} from '../../shared/nativeData.js';
import { currentCredential } from '../../shared/credentials.js';
import { paperName } from '../../shared/paperName.js';
import { awaitPaperReading, uploadPaper } from '../../shared/api/papers.js';
import { storeFile } from '../../shared/api/files.js';
import appLimits from '../../shared/appLimits.js';
import { unexpectedDesktopErrorReport } from '../../shared/errorReport.js';
import { isReportableUploadError } from '../../shared/uploadError.js';

const openedFileImports = new Map();

// How long "Add to nook" waits for the reading before it writes the paper
// without it. Short, unlike the form's wait: the user is watching.
const NOOK_ADD_READING_TIMEOUT_MS = appLimits.timeouts_ms.nook_add_reading;

// What the nook page this window goes to next says once: `{ message,
// report }`, where `report` is a diagnostic report's text to offer, as
// the upload form offers one for a send that failed. The window's own
// session storage carries it across the navigation.
const NOOK_NOTICE = 'papol.viewer.nookNotice';

function leaveNookNotice(notice) {
  try { sessionStorage.setItem(NOOK_NOTICE, JSON.stringify(notice)); } catch { /* it is only said */ }
}

export function takeNookNotice() {
  try {
    const stored = sessionStorage.getItem(NOOK_NOTICE);
    sessionStorage.removeItem(NOOK_NOTICE);
    return stored ? JSON.parse(stored) : null;
  } catch {
    return null;
  }
}

// Why a paper added from an opened file has no details but its file name.
function unreadNotice(uploaded) {
  const failure = uploaded.sendFailure;
  const why = uploaded.offline
    ? 'Papol was offline, so the PDF was not read'
    : failure
      ? `the PDF could not be sent to be read (${failure.message || failure})`
      : 'Papol could not read the PDF in time';
  const report = failure && isReportableUploadError(failure)
    ? unexpectedDesktopErrorReport(failure, 'sending a PDF to be read', {
      surface: window.__PAPOL_ENV__?.surface, platform: navigator.platform,
    }).content
    : null;
  return {
    message: `Added to your nook, but ${why}; its title is the file name. Edit the details on the paper's page.`,
    report,
  };
}

export function getToken() {
  return currentCredential();
}

export async function getPaperByPdf(hash) {
  if (nativeDataActive()) {
    try {
      return paperView(await nativeRepository.paperByPdf(hash));
    } catch {
      // A public paper that has not been retained locally still comes from the service.
    }
  }
  return request(`/viewer/${hash}`);
}

export async function getPaperNotes(paper) {
  if (nativeDataActive()) {
    return listAnnotations(paper.sha256, { kind: 'note' });
  }
  return paper.notes;
}

// A share uuid stands in for a session: the same public metadata, asked for
// by someone who is holding a link rather than signed in.
export function getViewerPaperInfo(hash, share) {
  return request(`/viewer/${hash}/info${share ? `?share=${share}` : ''}`);
}

// Where the PDF's bytes are: the address the server gives when it gives
// one — the bucket's own, so the stream never passes through the Worker,
// not even for a redirect — else Papol's route, which sends us on.
export function pdfHref(paper) {
  if (paper?.file_url) return paper.file_url;
  if (!paper?.file_path) return null;
  return backendPath(`/uploads/${paper.file_path}`);
}

// The user's nook paper for these exact bytes, or null. Only the local
// replica is asked: a file opened from disk is not announced to Papol.
export async function getNookPaperByPdf(hash) {
  if (!nativeDataActive()) return null;
  try {
    return paperView(await nativeRepository.paperByPdf(hash));
  } catch {
    return null;
  }
}

// A file opened from disk becomes a nook paper, and the notes, ink and clips
// made on it before then come along. It comes in as the upload form's PDF
// does (shared/api/papers.js): kept in the nook, sent to be read, and read.
// Only the last step differs: there is no form to fill in later, so the
// reading is waited for, briefly, before the paper is written, and a paper
// added without it keeps the file's name as its title. Why is said on the
// nook page this window goes to next (`takeNookNotice`).
//
// `identifier` is what the open document's first pages print
// (shared/identifiers.js). `onProgress` hears the send of the bytes to
// Papol as it goes (shared/api/files.js), the one measurable part of it.
export async function addOpenedFileToNook({ sha256, name, identifier = null, notes = [], ink = [], clips = [], onProgress }) {
  if (!nativeDataActive()) throw new Error('Sign in to add this paper to your nook.');
  const pending = openedFileImports.get(sha256);
  if (pending) return pending;
  const importing = importOpenedFileToNook({ sha256, name, identifier, notes, ink, clips, onProgress });
  openedFileImports.set(sha256, importing);
  try {
    return await importing;
  } finally {
    if (openedFileImports.get(sha256) === importing) openedFileImports.delete(sha256);
  }
}

async function importOpenedFileToNook({ sha256, name, identifier, notes, ink, clips, onProgress }) {
  let paper = await getNookPaperByPdf(sha256);
  if (!paper) {
    // Opening a file remains private. Only once the user adds it do its
    // bytes go to Papol, to be read as an upload is.
    const blob = await openedFileBlob(sha256);
    const uploaded = await uploadPaper(blob, { name, identifier, onProgress });
    if (uploaded.sha256 !== sha256) throw new Error('The file changed while it was open.');
    const metadata = await awaitPaperReading(uploaded, { timeoutMs: NOOK_ADD_READING_TIMEOUT_MS });
    if (!metadata) leaveNookNotice(unreadNotice(uploaded));
    const shelves = await nativeRepository.shelves();
    const shelf = shelves.find((row) => row.is_default) || shelves[0];
    // No name is invented for it. The paper is the file, and the service
    // reads the same name off the same bytes.
    await nativeRepository.transact([
      {
        table: 'papers', uuid: sha256, operation: 'upsert',
        values: {
          doi: metadata?.doi ?? null,
          title: metadata?.title || name,
          authors: metadata?.authors ?? null,
          journal: metadata?.journal ?? null,
          year: metadata?.year ?? null,
          file_path: `${sha256}.pdf`,
        },
      },
      {
        table: 'copies', uuid: newUuid(), operation: 'upsert',
        values: { paper_sha256: sha256, shelf_uuid: shelf?.uuid ?? null },
      },
    ]);
    paper = { sha256 };
  }

  const paperSha256 = paper.sha256;

  // One table now, so the three kinds are the same mapping with a different
  // kind and a different body.
  const stored = (kind, { uuid, page, content, name, group_uuid: groupUuid, ...body }) => ({
    table: 'annotations', uuid, operation: 'upsert',
    values: {
      kind, paper_sha256: paperSha256,
      page: page ?? null, group_uuid: groupUuid ?? null,
      content: content || '', name: name || null,
      body: JSON.stringify(body),
    },
  });
  const annotations = [
    ...notes.map(({ anchor, ...note }) => stored('note', { ...note, anchor: anchor ?? null })),
    ...ink.map(({ created_at: _drawn, ...stroke }) => stored('ink', stroke)),
    ...clips.map(({ created_at: _cut, ...clip }) => stored('clip', clip)),
  ];
  for (let start = 0; start < annotations.length; start += 200) {
    await nativeRepository.transact(annotations.slice(start, start + 200));
  }
  return paperSha256;
}

// A PDF someone shared is theirs, not this machine's: its bytes come from
// the service even when a local replica is open in the same app.
const sharedReading = (paper) => Boolean(paper?.shared_by);

export async function downloadablePdfHref(paper) {
  if (paper?.opened_file && !paper.copy_uuid) return openedFileUrl(paper.sha256);
  if (sharedReading(paper)) return pdfHref(paper);
  if (nativeDataActive()) {
    if (!paper?.sha256) throw new Error('PDF is not available in the local replica');
    return nativeBlobUrl(paper.sha256, 'application/pdf');
  }
  return pdfHref(paper);
}

// PDF.js treats a URL as a network request. macOS WebKit reports requests to
// Tauri-created blob: URLs with status 0, which PDF.js rejects even though the
// bytes are present. Native viewers therefore hand PDF.js the bytes directly.
export async function pdfLoadInput(paper, { onSyncProgress } = {}) {
  if (paper?.opened_file && !paper.copy_uuid) {
    return { data: await openedFileBytes(paper.sha256) };
  }
  if (sharedReading(paper)) return { url: pdfHref(paper) };
  if (nativeDataActive()) {
    if (!paper?.sha256) throw new Error('PDF is not available in the local replica');
    try {
      return { data: await nativeBlobBytes(paper.sha256) };
    } catch (error) {
      const message = error?.message || String(error || '');
      if (!/blob is not available offline|pdf is not available in the local replica/i.test(message)) {
        throw error;
      }
      await ensureNativeBlob(paper.sha256, onSyncProgress);
      return { data: await nativeBlobBytes(paper.sha256) };
    }
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
  // The picture into the bucket (shared/api/files.js), then the card that names it.
  const stored = await storeFile('board_file', blob, { name: 'paper-clip.png', mime: 'image/png' });
  return jsonRequest(`/boards/${boardUuid}/staging/clip`, 'POST', {
    sha256: stored.sha256, caption: comment || '', source_url: sourceUrl, source_label: sourceLabel,
  });
}

// ---- Annotations ----
//
// Notes, ink and clips are one kind of thing with three shapes, so they are
// made, changed and erased through one pair of calls. `kind` says which, and
// `body` carries the geometry only that kind has.

export function listAnnotations(paperSha256, { kind } = {}) {
  if (nativeDataActive()) {
    return nativeRepository
      .annotations(paperSha256, kind ?? null)
      .then((rows) => rows.map(annotationView));
  }
  const query = new URLSearchParams();
  if (kind) query.set('kind', kind);
  const suffix = query.size ? `?${query}` : '';
  // The service answers to a paper's name, which is half its digest; the
  // replica above is storage and is keyed by the whole of it. Everything
  // here holds the full digest, so the shortening happens at the URL and
  // nowhere before it (shared/paperName.js).
  return request(`/papers/${paperName(paperSha256)}/annotations${suffix}`);
}

export function createAnnotation(paperSha256, annotation) {
  if (nativeDataActive()) {
    return nativeRepository.transact([{
      table: 'annotations', uuid: newUuid(), operation: 'upsert',
      values: {
        kind: annotation.kind,
        paper_sha256: paperSha256,
        page: annotation.page ?? null,
        group_uuid: annotation.group_uuid ?? null,
        content: annotation.content ?? '',
        name: annotation.name ?? null,
        body: JSON.stringify(annotation.body ?? {}),
      },
    }]).then((receipt) => annotationView(receipt.rows[0]));
  }
  return jsonRequest(`/papers/${paperName(paperSha256)}/annotations`, 'POST', annotation);
}

export function updateAnnotation(uuid, changes) {
  if (nativeDataActive() && typeof uuid === 'string') {
    const values = {};
    for (const field of ['page', 'content', 'name']) {
      if (changes[field] !== undefined) values[field] = changes[field];
    }
    if (changes.body !== undefined) values.body = JSON.stringify(changes.body);
    return nativeRepository
      .transact([{ table: 'annotations', uuid, operation: 'upsert', values }])
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
export function getViewerReferences(paperSha256) {
  return request(`/viewer-references/${paperSha256}?paper_sha256=${paperSha256}`);
}

// One reference, looked up the first time anyone opens it.
export function getViewerReference(uuid) {
  return request(`/viewer-references/item/${uuid}`);
}

// The same two questions, asked on the authority of a shared link. The
// bibliography belongs to the PDF, so the answers are the same ones; only
// what allows the asking differs.
export function getSharedReferences(share, pdfHash, paperSha256) {
  return request(`/viewer-references/${pdfHash}?paper_sha256=${paperSha256}&share=${share}`);
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
