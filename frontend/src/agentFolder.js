// A folder of papers an agent gathered, and the manifest beside them
// (USER_STORIES.md §2c). The agent never touches Papol: it writes PDFs
// into a folder and `papol.json` beside them, and the user drops the
// folder in. What the format is lives in one place, the page the agent
// is pointed at: frontend/public/agent-folder.txt.
//
// The manifest describes papers, never where they go. Shelves and tags
// are the user's to pick in the review; a manifest that names them is
// read as if it did not.

import appLimits from '../../shared/appLimits.js';
import { isPdfFile } from '../../shared/fileDrop.js';
import { appPath, backendPath } from '../../shared/appUrls.js';
import { authorList } from './paperFormat.js';
import { titleFromFilename } from './uploadReview.js';

export const MANIFEST_NAME = 'papol.json';
export const MANIFEST_VERSION = 1;

// The most a folder is read for: a review is tens of papers, and a folder
// dropped by mistake — a home directory — should stop being walked soon.
export const FOLDER_FILE_LIMIT = 500;
const FOLDER_DEPTH_LIMIT = 4;

// ---------------------------------------------------------------- the prompt

// Where the format is described, absolute, since the only use for it is
// being handed to an agent outside Papol.
export function formatAddress() {
  const path = backendPath('/agent-folder.txt');
  if (/^https?:/i.test(path) || typeof window === 'undefined') return path;
  return `${window.location.origin}${path.startsWith('/') ? path : appPath(`/${path}`)}`;
}

// What the user pastes into their agent: short, because the format is
// on the page it points to, and a prompt saved long ago still works.
export function agentInstructions(address = formatAddress()) {
  return 'Gather the PDFs of the papers in this review into one folder, with a papol.json beside them'
    + ` as described at ${address} — then tell me the folder's path, so I can drop it into Papol.`;
}

// ---------------------------------------------------------------- the manifest

// A path as the manifest or the folder gives it: forward slashes, no
// leading `./` or `/`.
export function folderPath(path) {
  return String(path || '').replace(/\\/g, '/').replace(/^(\.\/|\/)+/, '').trim();
}

function bareDoi(value) {
  const doi = String(value || '').trim()
    .replace(/^(https?:\/\/)?(dx\.)?doi\.org\//i, '')
    .replace(/^doi:\s*/i, '');
  return /^10\.\d{4,9}\/\S+$/.test(doi) ? doi : null;
}

function bareArxiv(value) {
  const id = String(value || '').trim()
    .replace(/^(https?:\/\/)?arxiv\.org\/(abs|pdf)\//i, '')
    .replace(/^arxiv:\s*/i, '')
    .replace(/\.pdf$/i, '');
  return /^(\d{4}\.\d{4,5}|[a-z-]+(\.[A-Z]{2})?\/\d{7})(v\d+)?$/i.test(id) ? id : null;
}

function text(value, max) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

// `papol.json`, read: `{ papers }`, one entry per work it lists, or
// `{ error }` saying why it could not be. An entry is `{ file, doi,
// arxiv_id, title, note }`, each null when not given; one with no file
// is a work the agent could not get a PDF of.
export function parseManifest(source) {
  let data;
  try {
    data = JSON.parse(source);
  } catch (failure) {
    return { error: `${MANIFEST_NAME} is not valid JSON (${failure.message}).` };
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { error: `${MANIFEST_NAME} should hold an object with a "papers" list.` };
  }
  if (data.papol != null && data.papol !== MANIFEST_VERSION) {
    return { error: `${MANIFEST_NAME} was written for a newer Papol (format ${data.papol}).` };
  }
  if (!Array.isArray(data.papers)) {
    return { error: `${MANIFEST_NAME} has no "papers" list.` };
  }
  const papers = data.papers
    .filter((entry) => entry && typeof entry === 'object')
    .map((entry) => ({
      file: text(entry.file, appLimits.text.source_url) && folderPath(entry.file),
      doi: bareDoi(entry.doi),
      arxiv_id: bareArxiv(entry.arxiv ?? entry.arxiv_id),
      title: text(entry.title, appLimits.text.paper_title),
      note: text(entry.note, appLimits.text.comment),
    }))
    .filter((entry) => entry.file || entry.doi || entry.arxiv_id || entry.title);
  return { papers };
}

// The identifier an upload is sent with: the one the PDF prints when it
// prints one, else the manifest's. `printed` is what readIdentifier gives,
// a promise of `{ doi }`, `{ arxiv_id }` or null.
export async function identifierFor(printed, entry) {
  let found = null;
  try {
    found = await printed;
  } catch {
    found = null;
  }
  if (found && (found.doi || found.arxiv_id)) return found;
  if (entry?.doi) return { doi: entry.doi };
  if (entry?.arxiv_id) return { arxiv_id: entry.arxiv_id };
  return null;
}

// ---------------------------------------------------------------- the folder

// The folder a drop carries, when it carries exactly one: its entry, read
// while the drop event lasts (the list of items does not outlive it).
export function droppedFolder(dataTransfer) {
  const items = Array.from(dataTransfer?.items || []).filter((item) => item.kind === 'file');
  if (items.length !== 1) return null;
  const entry = items[0].webkitGetAsEntry?.();
  return entry?.isDirectory ? entry : null;
}

const hidden = (name) => name.startsWith('.') || name.startsWith('__MACOSX');

function readBatch(reader) {
  return new Promise((resolve, reject) => reader.readEntries(resolve, reject));
}

function fileOf(entry) {
  return new Promise((resolve, reject) => entry.file(resolve, reject));
}

// A dropped folder's files, as `{ name, files: [{ path, file }] }`, where
// a path is relative to the folder. Hidden files are skipped, and the walk
// stops at FOLDER_FILE_LIMIT files or FOLDER_DEPTH_LIMIT levels down.
export async function filesInFolder(entry) {
  const files = [];
  const walk = async (directory, prefix, depth) => {
    const reader = directory.createReader();
    for (;;) {
      const batch = await readBatch(reader);
      if (!batch.length) return;
      for (const child of batch) {
        if (files.length >= FOLDER_FILE_LIMIT || hidden(child.name)) continue;
        const path = `${prefix}${child.name}`;
        if (child.isDirectory) {
          if (depth < FOLDER_DEPTH_LIMIT) await walk(child, `${path}/`, depth + 1);
        } else {
          files.push({ path, file: await fileOf(child) });
        }
      }
    }
  };
  await walk(entry, '', 0);
  return { name: entry.name, files };
}

// The same, from a folder chosen with `<input webkitdirectory>`: each
// file's path is given under the folder's own name, which is taken off.
export function filesFromPicker(fileList) {
  const all = Array.from(fileList || []);
  const name = folderPath(all[0]?.webkitRelativePath).split('/')[0] || '';
  const files = all
    .map((file) => ({ path: folderPath(file.webkitRelativePath || file.name).split('/').slice(1).join('/') || file.name, file }))
    .filter(({ path }) => !path.split('/').some(hidden))
    .slice(0, FOLDER_FILE_LIMIT);
  return { name, files };
}

// PDFs dropped or chosen together, with no folder around them: read as a
// folder with no name and no manifest, so they come in through the same
// review. `name` is '' — there is no folder to name the batch after.
export function looseFiles(files) {
  return {
    name: '',
    files: Array.from(files || []).slice(0, FOLDER_FILE_LIMIT).map((file) => ({ path: file.name, file })),
  };
}

// What a drop or a pick of several files carries into the review: the
// PDFs among them, when there is more than one file. One file is the
// one-paper upload's.
export function severalPdfs(files) {
  const all = Array.from(files || []);
  return all.length > 1 ? all.filter(isPdfFile) : [];
}

// ---------------------------------------------------------------- the review

// The rows the review opens on, from the folder's files and its manifest
// (`{ papers }`, or null when there is none): the manifest's works in its
// own order, then the folder's other PDFs by path. A row is
// `{ key, path, file, entry, problem }`: `problem` is 'missing' for a
// work whose file is not in the folder, 'no-pdf' for one listed with no
// file, 'too-large' for a PDF over the upload limit, else null.
export function folderRows(files, manifest) {
  const pdfs = files.filter(({ path, file }) => isPdfFile({ name: path, type: file?.type }));
  const byPath = new Map(pdfs.map((pdf) => [pdf.path, pdf]));
  const byLowerPath = new Map(pdfs.map((pdf) => [pdf.path.toLowerCase(), pdf]));
  const byName = new Map();
  for (const pdf of pdfs) {
    const name = pdf.path.split('/').pop().toLowerCase();
    byName.set(name, byName.has(name) ? null : pdf);
  }
  const find = (file) => byPath.get(file) || byLowerPath.get(file.toLowerCase())
    || byName.get(file.split('/').pop().toLowerCase()) || null;

  const limit = appLimits.files.paper_mb * 1024 * 1024;
  const rows = [];
  const taken = new Set();
  const row = (pdf, entry) => ({
    key: pdf ? `file:${pdf.path}` : `entry:${rows.length}`,
    path: pdf?.path ?? entry?.file ?? null,
    file: pdf?.file ?? null,
    entry: entry ?? null,
    problem: !pdf ? (entry?.file ? 'missing' : 'no-pdf') : pdf.file.size > limit ? 'too-large' : null,
  });
  for (const entry of manifest?.papers || []) {
    const pdf = entry.file ? find(entry.file) : null;
    if (pdf && taken.has(pdf.path)) continue;
    if (pdf) taken.add(pdf.path);
    rows.push(row(pdf, entry));
  }
  for (const pdf of [...pdfs].sort((a, b) => a.path.localeCompare(b.path))) {
    if (!taken.has(pdf.path)) rows.push(row(pdf, null));
  }
  return rows;
}

// The title a row shows and saves: the one the user typed, else the one
// the PDF was read for, else the manifest's, else the filename's.
export function rowTitle(row) {
  return row.editedTitle?.trim() || row.reading?.title || row.entry?.title || titleFromFilename(row.path || '');
}

// The metadata a row is saved with. A PDF Papol already holds keeps the
// metadata it has, since metadata is shared (US-2.4) and nobody reviewed
// this batch's reading against it — unless the user retyped the title.
// Otherwise what the PDF was read for, with the manifest's identifier
// and title filling what the reading did not find.
export function rowMetadata(row) {
  const held = row.library;
  if (held) {
    return {
      title: row.editedTitle?.trim() || held.title,
      authors: held.authors ?? null,
      journal: held.journal ?? null,
      year: held.year ?? null,
      doi: held.doi ?? null,
    };
  }
  const read = row.reading || {};
  const authors = authorList(read.authors);
  const year = parseInt(read.year, 10);
  return {
    title: rowTitle(row),
    authors: JSON.stringify(authors),
    journal: read.journal || null,
    year: Number.isFinite(year) ? year : null,
    doi: read.doi || row.entry?.doi || null,
  };
}

// What the review says a row is. `row.state` moves through 'waiting',
// 'uploading', 'reading', 'ready' and, once saved, 'added'; 'yours' is a
// PDF already in the nook, 'failed' one that could not be sent or saved.
export function rowStatus(row) {
  if (row.problem === 'missing') return 'Not in the folder';
  if (row.problem === 'no-pdf') return 'No PDF: find it yourself';
  if (row.problem === 'too-large') return `Larger than ${appLimits.files.paper_mb} MB`;
  switch (row.state) {
    case 'waiting': return 'Waiting';
    case 'uploading': return 'Uploading…';
    case 'reading': return 'Reading…';
    case 'yours': return 'Already in your nook';
    case 'failed': return row.error || 'Could not be added';
    case 'saving': return 'Adding…';
    case 'added': return 'Added';
    default: return row.library ? 'Already in Papol' : 'New';
  }
}

// Whether a row can be added: it has a PDF that went up and is not one
// the nook holds already.
export function rowAddable(row) {
  return !row.problem && (row.state === 'ready' || row.state === 'reading');
}

// The line the import ends on.
export function importSummary(rows) {
  const count = (test) => rows.filter(test).length;
  const added = count((row) => row.state === 'added');
  const yours = count((row) => row.state === 'yours');
  const problems = count((row) => row.problem || row.state === 'failed');
  return [
    `${added} added`,
    yours ? `${yours} already yours` : null,
    problems ? `${problems} ${problems === 1 ? 'problem' : 'problems'}` : null,
  ].filter(Boolean).join(', ');
}
