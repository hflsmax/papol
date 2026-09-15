import { demoPapers, demoNotes, demoEditionFor } from '../../shared/demoWorld.js';
import { IS_DESKTOP } from '../../shared/appEnvironment.js';
import { readSharable } from '../../shared/api/sharables.js';
import { notesIn } from './annotationKinds.js';
import { appPath } from './base.js';
import {
  getPaperByPdf, getPaperNotes, getNookPaperByPdf, addOpenedFileToNook,
  getSharedReferences, getSharedReference, getViewerPaperInfo,
  listAnnotations, createAnnotation, updateAnnotation, deleteAnnotation,
  getToken,
} from './api.js';

/**
 * Where this document and its notes come from — decided once, from the URL,
 * so nothing below has to care which it is.
 *
 *   ?pdf=<sha256>          an exact PDF in the reader's nook: notes live in Papol
 *   ?pdf=<sha256>&file=1   a PDF opened from the file system in Papol Desktop
 *   ?share=<uuid>          someone's reading of a PDF, handed over by link
 * Demo PDFs use the same hash identity; only their storage is local.
 *
 * Nook and demo sources expose the same annotation interfaces. A file source
 * intentionally omits them; if its bytes already belong to a nook paper, the
 * viewer hands the window over to that canonical source. A shared source
 * declares itself read-only: its marks are someone else's.
 */
export function resolveSource() {
  const params = new URLSearchParams(window.location.search);
  const inDemo = window.location.pathname.includes('/demo/viewer');
  const share = (params.get('share') || '').toLowerCase();
  // A link is the whole permission, so it is answered before anything else
  // and without a hash: the sharable says which PDF it opens.
  if (!inDemo && /^[0-9a-f-]{36}$/.test(share)) return sharedSource(share);
  const pdf = (params.get('pdf') || '').toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(pdf)) return null;
  if (inDemo) return DEMO_PDFS[pdf] ? localSource(DEMO_PDFS[pdf]) : null;
  if (IS_DESKTOP && params.get('file') === '1') return openedFileSource(pdf, params.get('name'));
  return apiSource(pdf);
}

export function nookViewerHref(href = window.location.href) {
  const nookUrl = new URL(href);
  for (const key of [
    'file', 'name', 'opened_at_ms', 'native_read_ms', 'native_hash_ms',
  ]) nookUrl.searchParams.delete(key);
  return nookUrl.href;
}

export function handoffOpenedFileToNookViewer(
  nookPaper,
  href = window.location.href,
  replace = (nextHref) => window.location.replace(nextHref),
) {
  if (!nookPaper) return false;
  replace(nookViewerHref(href));
  return true;
}

function apiSource(
  pdfHash,
  loadPaper = () => getPaperByPdf(pdfHash),
  loadPaperNotes = (paper) => getPaperNotes(paper),
) {
  let paperUuid = null;
  let paperReady = null;
  const paper = () => {
    if (!paperReady) paperReady = loadPaper();
    return paperReady;
  };
  const source = {
    backHref: appPath('/'),
    // The desktop blob store is content-addressed, so the viewer can begin
    // reading these bytes before this source's paper metadata query returns.
    pdfHash,
    requiresSignIn: true,
    async load() {
      const loaded = await paper();
      paperUuid = loaded.uuid;
      source.backHref = appPath(`/paper/${loaded.uuid}`);
      return { doc: loaded, notes: [] };
    },
    async loadNotes() {
      const loaded = await paper();
      paperUuid = loaded.uuid;
      return notesIn(await loadPaperNotes(loaded));
    },
    // One interface for every kind of mark. A caller says which kind it is
    // making and what its geometry is; nothing else differs between them.
    annotations: {
      list: (editionUuid, kind) => listAnnotations(paperUuid, { editionUuid, kind }),
      create: (annotation) => createAnnotation(paperUuid, annotation),
      update: (uuid, changes) => updateAnnotation(uuid, changes),
      remove: (uuid) => deleteAnnotation(uuid),
    },
  };
  return source;
}

// Someone else's reading, opened by link. Everything about it is settled by
// one request: which PDF, whose marks, and what they say. The interfaces it
// exposes are the reading half of the ones a nook source exposes — list, and
// no more — so the parts of the viewer that write have nothing to call.
function sharedSource(shareUuid, load = () => readSharable(shareUuid)) {
  let readingReady = null;
  const reading = () => {
    if (!readingReady) readingReady = load();
    return readingReady;
  };
  return {
    // A visitor following a link has no nook to go back to, so the way out
    // is Papol's front door.
    backHref: appPath('/'),
    requiresSignIn: false,
    readOnly: true,
    async load() {
      const shared = await reading();
      const edition = {
        uuid: shared.paper.edition_uuid,
        file_path: shared.paper.file_path,
        sha256: shared.paper.edition_sha256,
      };
      return {
        doc: {
          ...shared.paper,
          // Whose reading this is, so the viewer can say so. It is the one
          // thing on the page that is about a person rather than a paper.
          shared_by: shared.reader,
          // A lean link shares the paper and nothing of theirs, so it is
          // not a reading and must not be named as one.
          shared_kind: shared.kind,
          editions: [edition],
          latest_edition: edition,
        },
        notes: notesIn(shared.annotations),
      };
    },
    annotations: {
      list: async (_editionUuid, kind) => {
        const shared = await reading();
        return kind
          ? shared.annotations.filter((row) => row.kind === kind)
          : shared.annotations;
      },
    },
    // What the PDF cites belongs to the file, so a shared reading carries
    // its bibliography — read through the link, which is the only
    // permission whoever is holding it has.
    references: {
      list: (pdfHash, editionUuid) => getSharedReferences(shareUuid, pdfHash, editionUuid),
      open: (referenceUuid) => getSharedReference(shareUuid, referenceUuid),
    },
    async info() {
      const shared = await reading();
      return getViewerPaperInfo(shared.paper.edition_sha256, shareUuid);
    },
  };
}

// A file-system document is deliberately ephemeral. Opening a file never
// reads or writes annotations by itself. An exact match in the reader's nook
// moves the window onto the ordinary nook URL, where its saved paper state is
// loaded; a new file stays ephemeral until the reader adds it.
function openedFileSource(pdfHash, name) {
  const title = name || 'Untitled PDF';
  const params = new URLSearchParams(window.location.search);
  const measured = (key) => {
    const value = Number(params.get(key));
    return Number.isFinite(value) && value >= 0 ? value : null;
  };
  // Enough identity to begin reading the bytes immediately. No paper state
  // needs to be consulted before showing page one.
  const initialPaper = {
    title, sha256: pdfHash, edition_sha256: pdfHash, opened_file: true,
  };

  const source = {
    backHref: appPath('/'),
    requiresSignIn: false,
    openedFile: true,
    annotationsRequireNook: true,
    initialPaper,
    openingTimings: {
      openedAtMs: measured('opened_at_ms'),
      nativeReadMs: measured('native_read_ms'),
      nativeHashMs: measured('native_hash_ms'),
    },
    async load() {
      return { doc: initialPaper, notes: [] };
    },
    async loadNookPaper() {
      const nookPaper = await getNookPaperByPdf(pdfHash);
      return nookPaper
        ? { ...nookPaper, edition_sha256: pdfHash, opened_file: true }
        : null;
    },
    // Public metadata lookup would send the hash to Papol. The membership
    // check stays entirely inside the signed-in reader's local replica.
    info: () => Promise.resolve({}),
    async addToNook() {
      return addOpenedFileToNook({
        sha256: pdfHash, name: title, notes: [], ink: [], clips: [],
      });
    },
  };
  return source;
}

// The demo opens with a few anchors already in place, so a visitor meets
// the feature rather than an empty rail. Fictional, like the rest of the
// demo, and gone on reload.
// The demo world is shared with Papol's own demo, so a note written into
// it appears on the paper page and in the viewer alike.
const DEMO_PAPERS = Object.fromEntries(demoPapers.map((p) => [p.uuid, p]));
const DEMO_PDFS = Object.fromEntries(demoPapers.map((p) => [p.sha256, p.uuid]));

const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString();

function seedFor(paperUuid) {
  return demoNotes
    .filter((n) => n.paperUuid === paperUuid)
    .map((n) => ({
      uuid: n.uuid,
      kind: 'note',
      page: n.page,
      body: { anchor: { type: 'point', x: n.x, y: n.y } },
      content: n.content,
      created_at: daysAgo(n.daysAgo),
    }));
}

function localSource(paperUuid) {
  const paper = DEMO_PAPERS[paperUuid];
  // The demo's papers live in memory and reset on reload (see demo.js);
  // its marks do the same, so "nothing is saved" stays true.
  let marks = seedFor(paperUuid);

  return {
    backHref: appPath(`/demo/paper/${paperUuid}`),
    // The paper's details panel shows the demo paper's own fields; there is
    // no catalogue entry to add to them.
    async info() {
      return {};
    },
    async load() {
      const edition = demoEditionFor(paper);
      return {
        doc: {
          ...paper,
          edition_uuid: edition.uuid,
          edition_sha256: edition.sha256,
          editions: [edition],
          latest_edition: edition,
        },
        notes: notesIn(marks),
      };
    },
    // The demo keeps its marks the way it keeps everything else: in memory,
    // and gone on reload. They are worth meeting even where nothing is
    // saved — it is how a visitor finds out the features are there.
    annotations: {
      async list(_editionUuid, kind) {
        return kind ? marks.filter((row) => row.kind === kind) : marks;
      },
      async create(annotation) {
        const made = {
          ...annotation,
          uuid: crypto.randomUUID(),
          created_at: new Date().toISOString(),
        };
        marks = [...marks, made];
        return made;
      },
      async update(uuid, changes) {
        marks = marks.map((row) => (row.uuid === uuid
          ? { ...row, ...changes, body: { ...row.body, ...(changes.body || {}) } }
          : row));
        return marks.find((row) => row.uuid === uuid);
      },
      async remove(uuid) {
        marks = marks.filter((row) => row.uuid !== uuid);
      },
    },
  };
}


export { getToken };
