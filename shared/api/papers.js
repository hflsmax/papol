import { appPath, backendPath } from '../appUrls.js';
import {
  discardNativeBlob, importNativeSharedPaper, nativeBlobImport, nativeDataActive,
  annotationView, nativeRepository, paperView, shelfView, newUuid,
} from '../nativeData.js';
import { inOfflineMode, runtimeFetch } from '../connectivity.js';
import { API_BASE, authHeaders, handleResponse, jsonRequest, request } from '../httpClient.js';
import { withAbortTimeout } from '../requestTimeout.js';
import { planOfflineNookAddition } from '../nookTransition.js';
import { onServer } from './serverOperation.js';
import appLimits from '../appLimits.js';
import {
  forgetPendingPaperBlob, hasPendingPaperBlob, paperCopyUuid, rememberPaperIdentity,
  rememberPendingPaperBlob, setPaperCopyUuid,
} from './paperState.js';

const DESKTOP_EXTRACT_TIMEOUT_MS = appLimits.timeouts_ms.desktop_metadata;

// ---------- Papers ----------

// Papers are addressed by their UUID, and only by it.
export function paperHref(paper) {
  return appPath(`/paper/${paper.uuid}`);
}

// Uploaded PDFs live in uploads/. Demo papers link to each paper's
// canonical open-access copy; demo-created papers use a bundled placeholder.
export function pdfHref(paper) {
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

export async function lookupPaperMetadata(file, filename = file?.name) {
  if (inOfflineMode() || globalThis.navigator?.onLine === false) return null;
  const formData = new FormData();
  if (filename) formData.append('file', file, filename);
  else formData.append('file', file);
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
    rememberPendingPaperBlob(blob);
    return {
      doi: null,
      title: file.name.replace(/\.pdf$/i, '').replace(/[_-]+/g, ' ').trim(),
      authors: null,
      journal: null,
      year: null,
      file_path: `${blob.sha256}.pdf`,
      sha256: blob.sha256,
      metadata_offline: false,
    };
  }
  const formData = new FormData();
  formData.append('file', file);
  return request('/papers/extract', { method: 'POST', body: formData });
}

export async function discardPaperImport(extractedData) {
  const sha256 = extractedData?.sha256;
  if (!nativeDataActive() || !sha256 || !hasPendingPaperBlob(sha256)) return;
  forgetPendingPaperBlob(sha256);
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
  if (nativeDataActive() && hasPendingPaperBlob(sha256)) {
    const localShelves = await nativeRepository.shelves();
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
    await nativeRepository.transact(changes);
    forgetPendingPaperBlob(sha256);
    setPaperCopyUuid(paperUuid, copyUuid);
    return paperView(await nativeRepository.paper(paperUuid));
  }
  return jsonRequest('/papers', 'POST', paperData);
}

export async function getPaper(uuid) {
  let localComments = null;
  if (nativeDataActive()) {
    // A nook paper is read from the replica: the server may not have it yet,
    // or may be out of reach.
    try {
      localComments = nativeRepository.annotations(uuid, null, 'note');
      const [row, comments] = await Promise.all([
        nativeRepository.paper(uuid), localComments,
      ]);
      const paper = paperView(row);
      paper.notes = comments.map(annotationView);
      setPaperCopyUuid(uuid, paper.copy_uuid);
      return paper;
    } catch (error) {
      // A paper outside this nook, opened from the library, comes from the service.
      if (String(error?.message ?? error) !== 'Paper not found') throw error;
    }
  }
  const localState = nativeDataActive()
    ? Promise.all([
      localComments || nativeRepository.annotations(uuid, null, 'note'),
      nativeRepository.nook(),
    ])
    : null;
  const remotePaper = request(`/papers/${uuid}`);
  const [paperResult, state] = await Promise.all([remotePaper, localState]);
  const paper = rememberPaperIdentity(paperResult);
  if (state) {
    const [comments, nook] = state;
    paper.notes = comments.map(annotationView);
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
      setPaperCopyUuid(paper.uuid, copy.uuid);
    }
  }
  return paper;
}

async function downloadNativePaperPdf(paper, expectedSha256) {
  const filePath = paper.file_path
    || paper.editions?.find((edition) => edition.sha256 === expectedSha256)?.file_path;
  if (!filePath) {
    const failure = new Error('This Library paper does not have a downloadable PDF.');
    failure.reportable = false;
    throw failure;
  }
  let response;
  try {
    // Library PDFs are public. Do not attach the Papol bearer token: an
    // edition may point at an external open-access URL.
    response = await runtimeFetch(pdfHref({ ...paper, file_path: filePath }));
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
  if (stored.sha256 !== expectedSha256) {
    await discardNativeBlob(stored.sha256).catch(() => {});
    throw new Error('The downloaded PDF did not match the Library edition.');
  }
}

export async function addToNook(paper) {
  const paperUuid = typeof paper === 'string' ? paper : paper?.uuid;
  if (!paperUuid) throw new Error('Paper not found');
  if (!nativeDataActive() || typeof paper === 'string') {
    return request(`/papers/${paperUuid}/add-to-nook`, { method: 'POST' });
  }

  const shelves = await nativeRepository.shelves();
  const { copyUuid, change } = planOfflineNookAddition(paper, shelves, newUuid);
  if (change.values.edition_sha256) {
    await downloadNativePaperPdf(paper, change.values.edition_sha256);
  }
  await importNativeSharedPaper(paper);
  await nativeRepository.transact([change]);
  setPaperCopyUuid(paperUuid, copyUuid);
  return paperView(await nativeRepository.paper(paperUuid));
}

export async function addPaperEdition(uuid, file) {
  if (nativeDataActive()) {
    const stored = await nativeBlobImport(file);
    try {
      const paper = paperView(await nativeRepository.paper(uuid));
      const editionUuid = newUuid();
      await nativeRepository.transact([
        {
          table: 'paper_editions', uuid: editionUuid, operation: 'upsert',
          values: { paper_uuid: uuid, file_path: `${stored.sha256}.pdf`, sha256: stored.sha256 },
        },
        {
          table: 'copies', uuid: paper.copy_uuid, operation: 'patch',
          values: {
            edition_uuid: editionUuid,
            edition_sha256: stored.sha256,
            ignored_edition_uuid: editionUuid,
          },
        },
      ]);
      return rememberPaperIdentity(paperView(await nativeRepository.paper(uuid)));
    } catch (error) {
      await discardNativeBlob(stored.sha256).catch(() => {});
      throw error;
    }
  }
  const formData = new FormData();
  formData.append('file', file);
  return onServer(() => request(`/papers/${uuid}/editions`, { method: 'POST', body: formData }));
}

export async function adoptEdition(uuid, editionUuid) {
  if (nativeDataActive()) {
    const paper = paperView(await nativeRepository.paper(uuid));
    const edition = (paper.editions || []).find((candidate) => candidate.uuid === editionUuid);
    if (!edition?.sha256) throw new Error('Edition is not available in the local replica');
    await nativeRepository.transact([{
      table: 'copies', uuid: paper.copy_uuid, operation: 'patch',
      values: {
        edition_uuid: edition.uuid,
        edition_sha256: edition.sha256,
        ignored_edition_uuid: paper.latest_edition?.uuid || edition.uuid,
      },
    }]);
    return rememberPaperIdentity(paperView(await nativeRepository.paper(uuid)));
  }
  return onServer(() => jsonRequest(`/papers/${uuid}/adopt-edition`, 'POST', {
    edition_uuid: editionUuid ?? null,
  }));
}

export async function ignoreEdition(uuid, editionUuid) {
  if (nativeDataActive()) {
    const paper = paperView(await nativeRepository.paper(uuid));
    await nativeRepository.transact([{
      table: 'copies', uuid: paper.copy_uuid, operation: 'patch',
      values: { ignored_edition_uuid: editionUuid ?? paper.latest_edition?.uuid ?? null },
    }]);
    return rememberPaperIdentity(paperView(await nativeRepository.paper(uuid)));
  }
  return onServer(() => jsonRequest(`/papers/${uuid}/ignore-edition`, 'POST', {
    edition_uuid: editionUuid ?? null,
  }));
}

async function localCopyUuid(uuid) {
  const remembered = paperCopyUuid(uuid);
  if (remembered) return remembered;
  if (!nativeDataActive()) return null;
  try {
    const paper = await nativeRepository.paper(uuid);
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
    if (!copyUuid) return rememberPaperIdentity(await onServer(() => jsonRequest(`/papers/${uuid}`, 'PUT', data)));
    const values = { ...data };
    const desiredTags = values.tag_uuids;
    delete values.tag_uuids;
    const changes = Object.keys(values).length ? [{
      table: 'copies', uuid: copyUuid, operation: 'patch', values,
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
  return rememberPaperIdentity(await onServer(() => jsonRequest(`/papers/${uuid}`, 'PUT', data)));
}

export async function deletePaper(uuid) {
  const copyUuid = await localCopyUuid(uuid);
  if (nativeDataActive() && copyUuid) {
    return nativeRepository.transact([{
      table: 'copies', uuid: copyUuid, operation: 'delete', values: {},
    }]).then(() => ({ message: 'Paper removed from your nook' }));
  }
  return request(`/papers/${uuid}`, { method: 'DELETE' });
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

// ---------- Notes ----------
//
// A note written on the paper page is an annotation with no place on a page:
// the same row a located note uses, without an edition or a page.

export function addComment(paperUuid, content) {
  if (nativeDataActive()) {
    return nativeRepository.transact([{
      table: 'annotations', uuid: newUuid(), operation: 'upsert',
      values: { kind: 'note', paper_uuid: paperUuid, content, body: '{}' },
    }]).then((receipt) => annotationView(receipt.rows[0]));
  }
  return jsonRequest(`/papers/${paperUuid}/annotations`, 'POST', {
    kind: 'note', content,
  });
}

export function updateComment(commentUuid, content) {
  if (nativeDataActive() && typeof commentUuid === 'string') {
    return nativeRepository.transact([{
      table: 'annotations', uuid: commentUuid, operation: 'patch', values: { content },
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
