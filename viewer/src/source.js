import { IS_DESKTOP } from '../../shared/appEnvironment.js';
import { nativeDataActive } from '../../shared/nativeData.js';
import { addSharedToNook, readSharable, sharedInNook } from '../../shared/api/sharables.js';
import { anchorsIn } from './annotationKinds.js';
import { appPath } from './base.js';
import { projectPaperPath } from '../../shared/appUrls.js';
import { paperName } from '../../shared/paperName.js';
import { addToNook as addPaperToNook } from '../../shared/api/papers.js';
import {
  getPaperByPdf, getPaperLink, getPaperAnchors, getNookPaperByPdf, addOpenedFileToNook,
  lookUpViewerReference, getViewerPaperInfo,
  listAnnotations, createAnnotation, updateAnnotation, deleteAnnotation, restoreAnnotation,
  getToken, getReader, addFetchedPdfToNook,
} from './api.js';
import { fetchPdfFrom, fromParam, pdfNameFromUrl, rememberFetchedPdf } from './fetchedPdf.js';
import { sha256Hex } from '../../shared/api/files.js';
import { listProjectAnnotations, personalDigsOn } from '../../shared/api/projects.js';
import { projectParam } from './project.js';

/**
 * Where this document and its annotations come from — decided once, from the URL,
 * so nothing below has to care which it is.
 *
 *   ?pdf=<sha256>          an exact PDF in the user's nook: annotations live in Papol;
 *                          for anyone else, the PDF alone, as a lean link
 *   &project=<uuid>        the same, with one of the user's projects on: every
 *                          member's annotations on the pages (project.js)
 *   ?pdf=<sha256>&file=1   a PDF opened from the file system in Papol macOS
 *   ?share=<code>          someone's reading of a PDF, handed over by link
 *   ?from=<url>            a PDF elsewhere on the web, fetched by this page
 *                          (fetchedPdf.js): what the Safari extension opens
 *
 * A nook source exposes the annotation interfaces, and knows the lean source
 * to fall back to when the paper turns out not to be this user's. A file source
 * intentionally omits them; if its bytes already belong to a nook paper, the
 * viewer hands the window over to that canonical source. A shared source
 * declares itself read-only: its annotations are someone else's.
 */
export function resolveSource() {
  const params = new URLSearchParams(window.location.search);
  // A code's case is part of it, so it is read exactly as written.
  const share = params.get('share') || '';
  // A link is the whole permission, so it is answered before anything else
  // and without a hash: the sharable says which PDF it opens.
  if (/^[0-9A-Za-z]{10}$/.test(share)) return sharedSource(share);
  // The Mac app opens files from disk instead, and has no use for this.
  const from = IS_DESKTOP ? null : fromParam(window.location.search);
  if (from) return fetchedSource(from);
  const pdf = (params.get('pdf') || '').toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(pdf)) return null;
  if (IS_DESKTOP && params.get('file') === '1') return openedFileSource(pdf, params.get('name'));
  // The digest is a lean link in itself: a visitor, or a user who does not
  // keep this PDF, reads the paper alone. Only someone signed in can keep
  // it, so only they are asked first.
  return signedIn() ? apiSource(pdf, undefined, undefined, projectParam()) : paperLinkSource(pdf);
}

// The ordinary nook URL for the PDF this window has open: what an opened
// or fetched PDF becomes once it is in the nook. A fetched PDF's address
// names it by where it came from, so its digest is given.
export function nookViewerHref(href = window.location.href, sha256 = null) {
  const nookUrl = new URL(href);
  for (const key of [
    'file', 'name', 'opened_at_ms', 'native_read_ms', 'native_hash_ms', 'from', 'nook',
  ]) nookUrl.searchParams.delete(key);
  if (sha256) nookUrl.searchParams.set('pdf', sha256);
  return nookUrl.href;
}

export function handoffOpenedFileToNookViewer(
  nookPaper,
  href = window.location.href,
  replace = (nextHref) => window.location.replace(nextHref),
) {
  if (!nookPaper) return false;
  replace(nookViewerHref(href, nookPaper.sha256));
  return true;
}

function apiSource(
  pdfHash,
  loadPaper = () => getPaperByPdf(pdfHash),
  loadPaperAnchors = (paper) => getPaperAnchors(paper),
  project = null,
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
    // What this URL opens for someone who turns out not to keep the paper:
    // the paper alone, as a lean link opens it, rather than a refusal.
    // A project paper someone else added keeps the project on: its members'
    // marks and digs are the project's to show, kept in a nook or not.
    leanFallback: () => paperLinkSource(pdfHash, undefined, project),
    async load() {
      const loaded = await paper();
      source.homeHref = project
        ? projectPaperPath(project, paperName(loaded.sha256))
        : appPath(`/paper/${paperName(loaded.sha256)}`);
      return { doc: loaded, anchors: [] };
    },
    async loadAnchors() {
      const loaded = await paper();
      return anchorsIn(await loadPaperAnchors(loaded));
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
      restore: (uuid, was) => restoreAnnotation(uuid, was),
    },
    // The project on, if one is: its name and members, and what every
    // member left on this paper. Read from the service, as projects always
    // are; the reader's own annotations still come from the list above,
    // which on the Mac is the replica, and are told from the others' by
    // who wrote them.
    project,
    loadProject: project ? () => listProjectAnnotations(project, pdfHash) : null,
    // With no project on, the digs on these pages are the reader's own
    // (personal digs): the same pins and margin, nobody else's.
    loadPersonalDigs: project ? null : async () => {
      const [read, me] = await Promise.all([personalDigsOn(pdfHash), getReader()]);
      return { ...read, me };
    },
  };
  return source;
}

// Someone with an account here, however they proved it: a session on the
// web, a signed-in account on the desktop. A link reads without either.
export function signedIn() {
  return nativeDataActive() || Boolean(getToken());
}

// Someone else's reading, opened by link. Everything about it is settled by
// one request: which PDF, whose annotations, and what they say. The interfaces it
// exposes are the reading half of the ones a nook source exposes — list, and
// no more — so the parts of the viewer that write have nothing to call.
function sharedSource(shareUuid, load = () => readSharable(shareUuid)) {
  return linkSource({
    load,
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
    // What the PDF cites belongs to the file, so a shared reading carries
    // its bibliography — read through the link, which is the only
    // permission whoever is holding it has.
    references: {
      lookUp: (paperSha256, reference) => lookUpViewerReference(paperSha256, reference, shareUuid),
    },
    info: (reading) => getViewerPaperInfo(reading.paper.sha256, shareUuid),
  });
}

// The paper a viewer URL names by its digest, for someone who does not keep
// it: what a lean link opens, because the digest is one. Nobody's reading,
// so nothing is attributed; the references and the paper's card need no
// link to be read, so the viewer's own lookups serve them.
export function paperLinkSource(pdfHash, load = () => getPaperLink(pdfHash), project = null) {
  return linkSource({
    load,
    project,
    // Its way home is the project's page for the paper, as for a reader who keeps it.
    homeHref: project ? projectPaperPath(project, paperName(pdfHash)) : null,
    loadProject: project ? () => listProjectAnnotations(project, pdfHash) : null,
    // Only a user who does not keep it gets here, or a visitor, who keeps
    // nothing: there is no copy to offer, only the chance to make one.
    loadNookPaper: async () => null,
    addToNook: () => addPaperToNook(pdfHash),
  });
}

// What every source opened by link has in common: one request settles the
// PDF and whose annotations are on it, and the interfaces it exposes are the
// reading half of a nook source's.
function linkSource({ load, loadNookPaper, addToNook, references, info, project = null, loadProject = null, homeHref = null }) {
  let readingReady = null;
  const reading = () => {
    if (!readingReady) readingReady = load();
    return readingReady;
  };
  return {
    // Where the home button leads. A link hands over one reading of one
    // PDF, not a place in the Desk — and the Desk asks for an account
    // besides — so the way out names no paper and goes to Papol itself.
    homeHref: homeHref ?? appPath('/'),
    requiresSignIn: false,
    // Their annotations are theirs: whatever is already on these pages was put
    // there by the sharer and nothing in the viewer may change it.
    readOnly: true,
    // A visitor's own annotations are a different matter. The tools stay in the
    // bar, because a shared paper should read like any other PDF — and
    // reaching for one asks for the paper to be theirs first, which is the
    // honest price of writing on it.
    annotationsRequireNook: true,
    loadNookPaper,
    addToNook,
    // Their own copy of this PDF, once they have one. The link's own URL
    // would keep showing them the sharer's reading; what they asked for
    // was the paper as theirs, which is the ordinary nook viewer.
    nookHref: (nook) => (nook?.sha256
      ? appPath(`/viewer/?pdf=${nook.sha256}${project ? `&project=${project}` : ''}`)
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
        anchors: anchorsIn(shared.annotations),
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
    references,
    info: info ? async () => info(await reading()) : undefined,
    // A project paper opened by a member who does not keep it: the project
    // is still on, as it is for a member who does (apiSource).
    ...(project ? { project, loadProject } : {}),
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
      return { doc: initialPaper, anchors: [] };
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
        sha256: pdfHash, name: title, identifier, anchors: [], ink: [], clips: [], onProgress,
      });
    },
  };
  return source;
}

// A PDF elsewhere on the web, opened by its address. It is an opened file
// in every way that matters to the viewer: nothing on it is the reader's
// until they add it, adding needs an account, and if the reader keeps
// these exact bytes already the window moves to their copy. The difference
// is where the bytes come from, and that they arrive over the network, so
// the opening shows its progress (`load`'s `onProgress`).
export function fetchedSource(url, {
  fetchPdf = fetchPdfFrom, hash = (bytes) => sha256Hex(new Blob([bytes])),
  lookUpKept = (sha256) => getPaperByPdf(sha256), add = addFetchedPdfToNook,
  isSignedIn = signedIn,
} = {}) {
  const name = pdfNameFromUrl(url);
  let arriving = null;
  const arrived = (onProgress) => {
    if (!arriving) {
      arriving = fetchPdf(url, { onProgress }).then(async (bytes) => {
        const sha256 = await hash(bytes);
        rememberFetchedPdf(sha256, bytes);
        return { sha256 };
      });
      // A failed fetch may be tried again (after signing in to the host).
      arriving.catch(() => { arriving = null; });
    }
    return arriving;
  };
  return {
    homeHref: appPath('/'),
    requiresSignIn: false,
    openedFile: true,
    fetchedFrom: url,
    readOnly: true,
    annotationsRequireNook: true,
    initialPaper: null,
    openingTimings: {},
    async load({ onProgress } = {}) {
      const { sha256 } = await arrived(onProgress);
      return {
        doc: { title: name, sha256, opened_file: true, fetched_from: url },
        anchors: [],
      };
    },
    // Only someone signed in keeps anything; for them, whether they keep
    // these bytes, asked of the service by their digest.
    async loadNookPaper() {
      if (!isSignedIn()) return null;
      const { sha256 } = await arrived();
      try {
        const kept = await lookUpKept(sha256);
        return kept?.sha256 ? kept : null;
      } catch {
        return null;
      }
    },
    // Nothing about the paper is asked of Papol before it is added: the
    // reader may be reading something they never meant to send anywhere.
    info: () => Promise.resolve({}),
    nookHref: (paper) => (paper?.sha256 ? appPath(`/viewer/?pdf=${paper.sha256}`) : null),
    async addToNook({ onProgress, identifier } = {}) {
      const { sha256 } = await arrived();
      return add({ sha256, name, identifier, onProgress });
    },
  };
}

export { getToken };
