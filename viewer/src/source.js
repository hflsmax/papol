import { IS_DESKTOP } from '../../shared/appEnvironment.js';
import { nativeDataActive } from '../../shared/nativeData.js';
import { addSharedToNook, readSharable, sharedInNook } from '../../shared/api/sharables.js';
import { notesIn } from './annotationKinds.js';
import { appPath } from './base.js';
import { paperName } from '../../shared/paperName.js';
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
 *   ?pdf=<sha256>          an exact PDF in the user's nook: notes live in Papol
 *   ?pdf=<sha256>&file=1   a PDF opened from the file system in Papol macOS
 *   ?share=<uuid>          someone's reading of a PDF, handed over by link
 *
 * A nook source exposes the annotation interfaces. A file source
 * intentionally omits them; if its bytes already belong to a nook paper, the
 * viewer hands the window over to that canonical source. A shared source
 * declares itself read-only: its annotations are someone else's.
 */
export function resolveSource() {
  const params = new URLSearchParams(window.location.search);
  const share = (params.get('share') || '').toLowerCase();
  // A link is the whole permission, so it is answered before anything else
  // and without a hash: the sharable says which PDF it opens.
  if (/^[0-9a-f-]{36}$/.test(share)) return sharedSource(share);
  const pdf = (params.get('pdf') || '').toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(pdf)) return null;
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
  let paperReady = null;
  const paper = () => {
    if (!paperReady) paperReady = loadPaper();
    return paperReady;
  };
  const source = {
    homeHref: appPath('/'),
    // The desktop blob store is content-addressed, so the viewer can begin
    // reading these bytes before this source's paper metadata query returns.
    pdfHash,
    requiresSignIn: true,
    async load() {
      const loaded = await paper();
      source.homeHref = appPath(`/paper/${paperName(loaded.sha256)}`);
      return { doc: loaded, notes: [] };
    },
    async loadNotes() {
      const loaded = await paper();
      return notesIn(await loadPaperNotes(loaded));
    },
    // One interface for every kind of annotation. A caller says which kind it is
    // making and what its geometry is; nothing else differs between them.
    // A paper is its PDF, so the digest in the URL already names the paper:
    // nothing here waits on the metadata query for a second copy of the name.
    annotations: {
      list: (kind) => listAnnotations(pdfHash, { kind }),
      create: (annotation) => createAnnotation(pdfHash, annotation),
      update: (uuid, changes) => updateAnnotation(uuid, changes),
      remove: (uuid) => deleteAnnotation(uuid),
    },
  };
  return source;
}

// Someone else's reading, opened by link. Everything about it is settled by
// one request: which PDF, whose annotations, and what they say. The interfaces it
// exposes are the reading half of the ones a nook source exposes — list, and
// no more — so the parts of the viewer that write have nothing to call.
// Someone with an account here, however they proved it: a session on the
// web, a signed-in account on the desktop. A link reads without either.
export function signedIn() {
  return nativeDataActive() || Boolean(getToken());
}

function sharedSource(shareUuid, load = () => readSharable(shareUuid)) {
  let readingReady = null;
  const reading = () => {
    if (!readingReady) readingReady = load();
    return readingReady;
  };
  return {
    // Where the home button leads. A link hands over one reading of one
    // PDF, not a place in the Desk — and the Desk asks for an account
    // besides — so the way out names no paper and goes to Papol itself.
    homeHref: appPath('/'),
    requiresSignIn: false,
    // Their annotations are theirs: whatever is already on these pages was put
    // there by the sharer and nothing in the viewer may change it.
    readOnly: true,
    // A visitor's own annotations are a different matter. The tools stay in the
    // bar, because a shared paper should read like any other PDF — and
    // reaching for one asks for the paper to be theirs first, which is the
    // honest price of writing on it.
    annotationsRequireNook: true,
    // Whether this visitor already keeps the paper, so the bar can offer
    // their own copy instead of a second one. Never asked of someone with
    // no account: there is no nook to ask about, and the link reads either
    // way.
    async loadNookPaper() {
      if (!signedIn()) return null;
      try {
        return await sharedInNook(shareUuid);
      } catch {
        // Not knowing is the same as not having it: the offer becomes "add",
        // and adding says so plainly if the paper is already there.
        return null;
      }
    },
    addToNook: () => addSharedToNook(shareUuid),
    // Their own copy of this PDF, once they have one. The link's own URL
    // would keep showing them the sharer's reading; what they asked for
    // was the paper as theirs, which is the ordinary nook viewer.
    nookHref: (nook) => (nook?.sha256
      ? appPath(`/viewer/?pdf=${nook.sha256}`)
      : null),
    async load() {
      const shared = await reading();
      return {
        doc: {
          ...shared.paper,
          // Whose reading this is, so the viewer can say so. It is the one
          // thing on the page that is about a person rather than a paper.
          shared_by: shared.user,
          // A lean link shares the paper and nothing of theirs, so it is
          // not a reading and must not be named as one.
          shared_kind: shared.kind,
        },
        notes: notesIn(shared.annotations),
      };
    },
    annotations: {
      list: async (kind) => {
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
      list: (pdfHash, paperSha256) => getSharedReferences(shareUuid, pdfHash, paperSha256),
      open: (referenceUuid) => getSharedReference(shareUuid, referenceUuid),
    },
    async info() {
      const shared = await reading();
      return getViewerPaperInfo(shared.paper.sha256, shareUuid);
    },
  };
}

// A file-system document is deliberately ephemeral. Opening a file never
// reads or writes annotations by itself. An exact match in the user's nook
// moves the window onto the ordinary nook URL, where its saved paper state is
// loaded; a new file stays ephemeral until the user adds it.
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
    title, sha256: pdfHash, opened_file: true,
  };

  const source = {
    homeHref: appPath('/'),
    requiresSignIn: false,
    openedFile: true,
    // The same pair a shared paper carries, and for the same reason. Nothing
    // on these pages is this user's to change — vacuously so, an opened
    // file having no annotations on it at all — and any annotation they make needs a
    // nook to go into. One reading of a PDF that is not yet yours, whether
    // it came from a link or from the file system.
    readOnly: true,
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
        ? { ...nookPaper, sha256: pdfHash, opened_file: true }
        : null;
    },
    // Public metadata lookup would send the hash to Papol. The membership
    // check stays entirely inside the signed-in user's local replica.
    info: () => Promise.resolve({}),
    async addToNook({ onProgress, identifier } = {}) {
      return addOpenedFileToNook({
        sha256: pdfHash, name: title, identifier, notes: [], ink: [], clips: [], onProgress,
      });
    },
  };
  return source;
}

export { getToken };
