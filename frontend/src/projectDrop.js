import {
  awaitPaperReading, createPaper, discardPaperImport, listShelves, uploadPaper,
} from '../../shared/api/papers.js';
import { addPaperToProject } from '../../shared/api/projects.js';
import { sha256Hex } from '../../shared/api/files.js';
import { authorList } from './paperFormat.js';
import { savedFile, titleFromFilename } from './uploadReview.js';

// A PDF dropped on a project, or chosen from its Add papers: it goes into
// the member's nook as the one-paper upload puts it there, on the default
// shelf with what the reading found, and then into the project. There is
// no form to fill in on the way: the paper's page is where it can be
// corrected, and a project only needs the paper itself.
//
// A paper already in the nook is not sent again; it is only added.

// How long the reading is waited for before the paper is saved under its
// file name. Shorter than the form's wait: nobody is looking at a form.
export const DROP_READING_TIMEOUT_MS = 45_000;

const defaultApi = {
  sha256Hex, uploadPaper, awaitPaperReading, createPaper, discardPaperImport, listShelves, addPaperToProject,
  // Loaded when first needed: it brings PDF.js along.
  readIdentifier: (file) => import('./pdfIdentifier.js').then((m) => m.readIdentifier(file)),
};

// What is saved for a paper the reading did, or did not, describe.
export function droppedMetadata(file, read) {
  const year = parseInt(read?.year, 10);
  let authors = [];
  try { authors = Array.isArray(read?.authors) ? read.authors : authorList(read?.authors); } catch { authors = []; }
  return {
    title: read?.title || titleFromFilename(file.name),
    authors: JSON.stringify(authors),
    journal: read?.journal || null,
    year: Number.isFinite(year) ? year : null,
    doi: read?.doi || null,
  };
}

// `nookShas` is the set of papers already in the member's nook, read once
// for the whole drop. `onState` hears 'uploading', 'reading', 'saving' and
// 'adding' as the PDF moves along. Answers the project as the server has
// it after the add, and the digest the project holds the paper under.
export async function addPdfToProject(projectUuid, file, { nookShas = new Set(), onState = () => {} } = {}, api = defaultApi) {
  onState('uploading');
  const digest = await api.sha256Hex(file);
  if (!nookShas.has(digest)) {
    const uploaded = await api.uploadPaper(file, { identifier: api.readIdentifier(file) });
    onState('reading');
    const read = await api.awaitPaperReading(uploaded, { timeoutMs: DROP_READING_TIMEOUT_MS });
    // Papol holds another version of this work: the project gets that one,
    // as the form's default does, so members read the same file.
    const known = read?.existing?.sha256 && read.existing.sha256 !== uploaded.sha256 ? read.existing : null;
    onState('saving');
    const shelves = await api.listShelves();
    const shelf = shelves.find((s) => s.is_default) ?? shelves[0];
    try {
      await api.createPaper({
        ...droppedMetadata(file, read),
        ...savedFile(uploaded, known, true),
        shelf_uuid: shelf?.uuid,
      });
    } catch (failure) {
      if (!/already in your nook/i.test(failure?.message || '')) throw failure;
    }
    if (known) await api.discardPaperImport(uploaded).catch(() => {});
    const held = known?.sha256 ?? uploaded.sha256 ?? digest;
    nookShas.add(held);
    onState('adding');
    return { project: await api.addPaperToProject(projectUuid, held), sha256: held };
  }
  onState('adding');
  return { project: await api.addPaperToProject(projectUuid, digest), sha256: digest };
}
