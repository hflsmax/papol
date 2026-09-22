import { appPath, backendPath } from '../appUrls.js';
import {
  discardNativeBlob, importNativeSharedPaper, nativeBlobImport, nativeDataActive,
  annotationView, nativeRepository, paperView, shelfView, newUuid,
} from '../nativeData.js';
import { inOfflineMode, runtimeFetch } from '../connectivity.js';
import { API_BASE, authHeaders, handleResponse, jsonRequest, request } from '../httpClient.js';
import { withAbortTimeout } from '../requestTimeout.js';
import { awaitJob } from './jobs.js';
import { planOfflineNookAddition } from '../nookTransition.js';
import { onServer } from './serverOperation.js';
import { mySharable } from './sharables.js';
import appLimits from '../appLimits.js';
import { paperName } from '../paperName.js';
import {
  forgetPendingPaperBlob, hasPendingPaperBlob, paperCopyUuid, rememberPaperIdentity,
  rememberPendingPaperBlob, setPaperCopyUuid,
} from './paperState.js';

const DESKTOP_EXTRACT_TIMEOUT_MS = appLimits.timeouts_ms.desktop_metadata;

// ---------- Papers ----------

// A paper is addressed by the name it goes by in a URL: the first half of
// the digest of its PDF. See shared/paperName.js.
export function paperHref(paper) {
  return appPath(`/paper/${paperName(paper.sha256)}`);
}

// An uploaded PDF is served from its content-addressed media URL: the
// address the server gives for it when it gives one (the bucket's own,
// which the edge caches and no Worker touches), else Papol's own route,
// which sends the client on to the same place.
export function pdfHref(paper) {
  if (paper.file_url) return paper.file_url;
  if (paper.file_path.startsWith('http')) return paper.file_path;
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

// The wait for what the server reads out of an upload. The PDF is on the
// server the moment the upload answers, and the reading — the printed DOI,
// the bibliographic APIs, the title block — takes as long as it takes; the
// form does not wait for it, and after this long stops asking. The paper
// page has a button that asks again.
const UPLOAD_READING_TIMEOUT_MS = 2 * 60 * 1000;

// The file's SHA-256, in hex: the name it is stored under.
async function sha256Hex(file) {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// The identifier an upload sends: what the caller read off the PDF's
// first pages, given as a value or a promise of one, or nothing.
async function identifierFor(identifier) {
  try {
    const found = await identifier;
    return found && (found.doi || found.arxiv_id) ? found : null;
  } catch {
    return null;
  }
}

// Upload a PDF through the server: the bytes in a form, stored by the
// Worker under their digest. The way every Papol uploaded before the
// bucket took uploads directly, and still the way when the server has no
// address to give (an older Worker, or one without the bucket's keys).
async function uploadThroughServer(file, filename, signal) {
  const formData = new FormData();
  if (filename) formData.append('file', file, filename);
  else formData.append('file', file);
  return handleResponse(await runtimeFetch(`${API_BASE}/papers/extract`, {
    method: 'POST', headers: authHeaders(), body: formData, signal,
  }));
}

// Upload a PDF. Hashed here, so the server can say whether it holds the
// bytes already and, if not, where the browser PUTs them: the bucket
// itself, by a signed URL, with the headers the server lists and no
// credential of Papol's. The server is then told the bytes are in, with
// the identifier read off the file, and answers with the job that reads
// it: `{ job, file_path, sha256 }`. A server that gives no address gets
// the bytes itself.
async function upload(file, filename, signal, identifier) {
  const name = filename || file.name;
  const sha256 = await sha256Hex(file);
  let address;
  try {
    address = await request('/papers/upload-address', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sha256, size: file.size, name }), signal,
    });
  } catch (failure) {
    if (failure?.status === 404 || failure?.status === 503) return uploadThroughServer(file, filename, signal);
    throw failure;
  }
  if (!address.stored) {
    const put = await runtimeFetch(address.url, { method: 'PUT', headers: address.headers, body: file, signal });
    if (!put.ok) {
      const failure = new Error(`The PDF could not be stored (the bucket answered ${put.status})`);
      failure.status = put.status;
      throw failure;
    }
  }
  return request('/papers/uploaded', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ file_path: address.file_path, uploaded_name: name, identifier: await identifierFor(identifier) }), signal,
  });
}

// Upload a PDF and wait for what the server reads out of it: the job's
// result plus the digest the upload was stored under.
async function uploadAndRead(file, filename, signal) {
  const queued = await upload(file, filename, signal);
  const metadata = await awaitJob(queued.job, { signal });
  return { ...metadata, file_path: queued.file_path, sha256: queued.sha256 };
}

export async function lookupPaperMetadata(file, filename = file?.name) {
  if (inOfflineMode()) return null;
  try {
    return await withAbortTimeout(
      (signal) => uploadAndRead(file, filename, signal),
      DESKTOP_EXTRACT_TIMEOUT_MS,
    );
  } catch {
    return null;
  }
}

// Take a PDF in: stored at once — in the bucket under its digest, or in
// the nook's own store — and answered with where it went, `{ file_path,
// sha256, job }`. Nothing is read from it here; that is `awaitPaperReading`,
// and the form is open in the meantime. `identifier` is what the caller
// read off the PDF's first pages (frontend/src/pdfIdentifier.js), a value
// or a promise of one; it goes to the server with the upload, and the
// reading starts from it.
export async function uploadPaper(file, { identifier = null } = {}) {
  if (nativeDataActive()) {
    const blob = await nativeBlobImport(file);
    rememberPendingPaperBlob(blob);
    return { file_path: `${blob.sha256}.pdf`, sha256: blob.sha256, job: null };
  }
  const queued = await upload(file, file.name, undefined, identifier);
  return { file_path: queued.file_path, sha256: queued.sha256, job: queued.job };
}

// What the PDF says about itself, once the server has read it: the job's
// fields — `doi, title, authors, journal, year` — or null when it could not
// be read: the job failed, the wait was given up on or ended by `signal`,
// the server could not be reached. A nook import has no job yet, so the
// PDF goes to the server for reading, as the viewer's import does, unless
// offline. None of it is worth a dialog: the form is open, and the user
// can type what was not read.
export async function awaitPaperReading(uploaded, file, { signal, identifier = null } = {}) {
  if (!uploaded.job && inOfflineMode()) return null;
  try {
    return await withAbortTimeout(async (stop) => {
      const job = uploaded.job ?? (await upload(file, file?.name, stop, identifier)).job;
      return awaitJob(job, { signal: stop });
    }, UPLOAD_READING_TIMEOUT_MS, { signal });
  } catch {
    return null;
  }
}

export async function discardPaperImport(extractedData) {
  const sha256 = extractedData?.sha256;
  if (!nativeDataActive() || !sha256 || !hasPendingPaperBlob(sha256)) return;
  forgetPendingPaperBlob(sha256);
  await discardNativeBlob(sha256);
}

export function reextractPaperMetadata(paperSha256) {
  return onServer(
    () => request(`/papers/${paperName(paperSha256)}/extract-metadata`, { method: 'POST' }),
    { pull: false },
  );
}

export async function createPaper(paperData) {
  const sha256 = paperData.sha256 || paperData.file_path?.replace(/\.pdf$/i, '');
  if (nativeDataActive() && hasPendingPaperBlob(sha256)) {
    const localShelves = await nativeRepository.shelves();
    let shelfUuid = paperData.shelf_uuid;
    const selectedShelf = localShelves.find((shelf) => shelf.uuid === shelfUuid);
    if (selectedShelf?.is_public) {
      shelfUuid = localShelves.find((shelf) => !shelf.is_public)?.uuid ?? shelfUuid;
    }
    // The paper is the file: its name is read off the bytes, not invented.
    // Minting one here is what the service would have had to undo, and it
    // would refuse a paper named any other way.
    const copyUuid = newUuid();
    const changes = [
      {
        table: 'papers', uuid: sha256, operation: 'upsert',
        values: {
          doi: paperData.doi, title: paperData.title, authors: paperData.authors,
          journal: paperData.journal, year: paperData.year,
          file_path: `${sha256}.pdf`, sha256,
        },
      },
      {
        table: 'copies', uuid: copyUuid, operation: 'upsert',
        values: {
          paper_sha256: sha256, shelf_uuid: shelfUuid,
          summary: paperData.summary,
        },
      },
    ];
    for (const tagUuid of paperData.tag_uuids || []) changes.push({
      table: 'copy_tags', uuid: newUuid(), operation: 'upsert',
      values: { copy_uuid: copyUuid, tag_uuid: tagUuid },
    });
    if (paperData.initial_comment?.trim()) changes.push({
      // Notes, ink and clips share one table; a first thought is a note
      // about the paper, placed on no page.
      table: 'annotations', uuid: newUuid(), operation: 'upsert',
      values: {
        kind: 'note', paper_sha256: sha256, page: null, group_uuid: null,
        content: paperData.initial_comment.trim(), name: null, body: '{}',
      },
    });
    await nativeRepository.transact(changes);
    forgetPendingPaperBlob(sha256);
    setPaperCopyUuid(sha256, copyUuid);
    return paperView(await nativeRepository.paper(paperName(sha256)));
  }
  return jsonRequest('/papers', 'POST', paperData);
}

// Whether this user has a link out on a paper read from the replica.
// Unknown is reported as none: offline there is no link to be managed —
// stopping one and making one both happen on the service — so not being able
// to ask is no reason to fail to open the paper.
async function liveLinkOn(uuid) {
  if (inOfflineMode()) return null;
  try {
    return (await mySharable(uuid))?.uuid ?? null;
  } catch {
    return null;
  }
}

export async function getPaper(name) {
  const uuid = paperName(name);
  let localComments = null;
  if (nativeDataActive()) {
    // A nook paper is read from the replica: the server may not have it yet,
    // or may be out of reach.
    try {
      localComments = nativeRepository.annotations(uuid, 'note');
      // A link out is a state of the paper, but the replica has no sharables
      // to answer with, so it is asked for beside the paper rather than after
      // it: one round trip alongside the local reads costs the page nothing.
      const [row, comments, link] = await Promise.all([
        nativeRepository.paper(uuid), localComments, liveLinkOn(uuid),
      ]);
      const paper = paperView(row);
      paper.notes = comments.map(annotationView);
      paper.sharable_uuid = link;
      // Keyed by the paper's own digest, which is what reads it back.
      setPaperCopyUuid(paper.sha256, paper.copy_uuid);
      return paper;
    } catch (error) {
      // A paper outside this nook, opened from the library, comes from the service.
      if (String(error?.message ?? error) !== 'Paper not found') throw error;
    }
  }
  const localState = nativeDataActive()
    ? Promise.all([
      localComments || nativeRepository.annotations(uuid, 'note'),
      nativeRepository.nook(),
    ])
    : null;
  const remotePaper = request(`/papers/${uuid}`);
  const [paperResult, state] = await Promise.all([remotePaper, localState]);
  const paper = rememberPaperIdentity(paperResult);
  if (state) {
    const [comments, nook] = state;
    paper.notes = comments.map(annotationView);
    const copy = nook.copies.find((candidate) => candidate.paper_sha256 === paper.sha256);
    if (copy) {
      Object.assign(paper, {
        copy_uuid: copy.uuid,
        shelf_uuid: copy.shelf_uuid,
        summary: copy.summary,
        thought: copy.thought,
        // On display is the shelf's answer, so the shelf is where it is
        // read from; a copy on no shelf has nothing standing behind it.
        is_public: nook.shelves.some((shelf) => shelf.uuid === copy.shelf_uuid && shelf.is_public),
        is_author: Boolean(copy.is_author),
        rating_expertise: copy.rating_expertise,
        rating_reading: copy.rating_reading,
        rating_liking: copy.rating_liking,
        tags: nook.copy_tags.filter((link) => link.copy_uuid === copy.uuid)
          .map((link) => nook.tags.find((tag) => tag.uuid === link.tag_uuid)).filter(Boolean),
      });
      setPaperCopyUuid(paper.sha256, copy.uuid);
    }
  }
  return paper;
}

async function downloadNativePaperPdf(paper) {
  let response;
  try {
    // Library PDFs are public. Do not attach the Papol bearer token.
    response = await runtimeFetch(pdfHref(paper));
  } catch (cause) {
    const failure = new Error(
      'The paper could not be downloaded. Check your connection and try again.',
      { cause },
    );
    failure.reportable = false;
    throw failure;
  }
  if (!response.ok) {
    const failure = new Error(
      `The paper could not be downloaded from the server (error ${response.status}). Try again later.`,
    );
    failure.reportable = false;
    throw failure;
  }
  const stored = await nativeBlobImport(await response.blob());
  if (stored.sha256 !== paper.sha256) {
    await discardNativeBlob(stored.sha256).catch(() => {});
    throw new Error('The downloaded PDF did not match the Library paper.');
  }
}

export async function addToNook(paper) {
  const paperSha256 = typeof paper === 'string' ? paper : paper?.sha256;
  if (!paperSha256) throw new Error('Paper not found');
  if (!nativeDataActive() || typeof paper === 'string') {
    return request(`/papers/${paperName(paperSha256)}/add-to-nook`, { method: 'POST' });
  }

  const shelves = await nativeRepository.shelves();
  const { copyUuid, change } = planOfflineNookAddition(paper, shelves, newUuid);
  await downloadNativePaperPdf(paper);
  await importNativeSharedPaper(paper);
  await nativeRepository.transact([change]);
  setPaperCopyUuid(paperSha256, copyUuid);
  return paperView(await nativeRepository.paper(paperName(paperSha256)));
}

async function localCopyUuid(uuid) {
  const remembered = paperCopyUuid(uuid);
  if (remembered) return remembered;
  if (!nativeDataActive()) return null;
  try {
    const paper = await nativeRepository.paper(paperName(uuid));
    setPaperCopyUuid(uuid, paper.copy_uuid);
    return paper.copy_uuid;
  } catch (error) {
    if (String(error?.message ?? error) === 'Paper not found') return null;
    throw error;
  }
}

export async function updatePaper(uuid, data) {
  const localFields = new Set([
    'summary', 'shelf_uuid', 'tag_uuids',
    'rating_expertise', 'rating_reading', 'rating_liking',
  ]);
  if (nativeDataActive() && Object.keys(data).every((key) => localFields.has(key))) {
    const copyUuid = await localCopyUuid(uuid);
    if (!copyUuid) return rememberPaperIdentity(await onServer(() => jsonRequest(`/papers/${paperName(uuid)}`, 'PUT', data)));
    const values = { ...data };
    const desiredTags = values.tag_uuids;
    delete values.tag_uuids;
    const changes = Object.keys(values).length ? [{
      table: 'copies', uuid: copyUuid, operation: 'upsert', values,
    }] : [];
    if (desiredTags) {
      const nook = await nativeRepository.nook();
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
    const receipt = await nativeRepository.transact(changes);
    return receipt.rows[0];
  }
  return rememberPaperIdentity(await onServer(() => jsonRequest(`/papers/${paperName(uuid)}`, 'PUT', data)));
}

export async function deletePaper(uuid) {
  const copyUuid = await localCopyUuid(uuid);
  if (nativeDataActive() && copyUuid) {
    return nativeRepository.transact([{
      table: 'copies', uuid: copyUuid, operation: 'delete', values: {},
    }]).then(() => ({ message: 'Paper removed from your nook' }));
  }
  return request(`/papers/${paperName(uuid)}`, { method: 'DELETE' });
}

export function createTag(name) {
  if (nativeDataActive()) {
    return nativeRepository.transact([{
      table: 'tags', uuid: newUuid(), operation: 'upsert', values: { name },
    }]).then((receipt) => receipt.rows[0]);
  }
  return jsonRequest('/tags', 'POST', { name });
}

export function listTags() {
  if (nativeDataActive()) return nativeRepository.tags();
  return request('/tags');
}

export function deleteTag(tagUuid) {
  if (nativeDataActive()) {
    return nativeRepository.transact([{
      table: 'tags', uuid: tagUuid,
      operation: 'delete', values: {},
    }]).then(() => null);
  }
  return request(`/tags/${tagUuid}`, { method: 'DELETE' });
}

export function listShelves() {
  if (nativeDataActive()) return nativeRepository.shelves().then((rows) => rows.map(shelfView));
  return request('/shelves');
}

export function createShelf(data) {
  if (nativeDataActive() && !data.is_public) {
    return nativeRepository.transact([{
      table: 'shelves', uuid: newUuid(), operation: 'upsert',
      values: { name: data.name, color: data.color, position: data.position || 0 },
    }]).then((receipt) => shelfView(receipt.rows[0]));
  }
  return onServer(() => jsonRequest('/shelves', 'POST', data));
}

export function updateShelf(uuid, data) {
  if (nativeDataActive() && !('is_public' in data) && !('is_default' in data)) {
    return nativeRepository.transact([{
      table: 'shelves', uuid, operation: 'upsert', values: data,
    }]).then((receipt) => shelfView(receipt.rows[0]));
  }
  return onServer(() => jsonRequest(`/shelves/${uuid}`, 'PUT', data));
}

// Deleting moves the shelf's papers and boards to another shelf, which may
// publish or hide them, so it happens on the server.
export function deleteShelf(uuid) {
  return onServer(() => request(`/shelves/${uuid}`, { method: 'DELETE' }));
}

// ---------- Notes ----------
//
// A note written on the paper page is an annotation with no place on a page:
// the same row a located note uses, without a page.

export function addComment(paperSha256, content) {
  if (nativeDataActive()) {
    return nativeRepository.transact([{
      table: 'annotations', uuid: newUuid(), operation: 'upsert',
      values: { kind: 'note', paper_sha256: paperSha256, content, body: '{}' },
    }]).then((receipt) => annotationView(receipt.rows[0]));
  }
  return jsonRequest(`/papers/${paperName(paperSha256)}/annotations`, 'POST', {
    kind: 'note', content,
  });
}

export function updateComment(commentUuid, content) {
  if (nativeDataActive() && typeof commentUuid === 'string') {
    return nativeRepository.transact([{
      table: 'annotations', uuid: commentUuid, operation: 'upsert', values: { content },
    }]).then((receipt) => annotationView(receipt.rows[0]));
  }
  return jsonRequest(`/annotations/${commentUuid}`, 'PUT', { content });
}

export function deleteComment(commentUuid) {
  if (nativeDataActive() && typeof commentUuid === 'string') {
    return nativeRepository.transact([{ table: 'annotations', uuid: commentUuid, operation: 'delete', values: {} }])
      .then(() => null);
  }
  return request(`/comments/${commentUuid}`, { method: 'DELETE' });
}
