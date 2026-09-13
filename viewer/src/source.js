import { demoPapers, demoNotes, demoEditionFor } from '../../shared/demoWorld';
import { appPath } from './base';
import {
  getPaperByPdf, createNote, updateNote, moveNote, renameNote, deleteNote,
  getInk, addInk, moveInk, eraseInk,
  getClips, addClip, moveClip, eraseClip,
  getToken,
} from './api';

/**
 * Where this document and its notes come from — decided once, from the URL,
 * so nothing below has to care which it is.
 *
 *   ?pdf=<sha256>  an exact PDF in the reader's nook: notes live in Papol
 * Demo PDFs use the same hash identity; only their storage is local.
 *
 * Both return the same shape, so the viewer only ever calls load(),
 * notes, ink and clips through the same small persistence interfaces.
 */
export function resolveSource() {
  const params = new URLSearchParams(window.location.search);
  const inDemo = window.location.pathname.includes('/demo/viewer');
  const pdf = (params.get('pdf') || '').toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(pdf)) return null;
  if (inDemo) return DEMO_PDFS[pdf] ? localSource(DEMO_PDFS[pdf]) : null;
  return apiSource(pdf);
}

function apiSource(pdfHash) {
  let paperUuid = null;
  const source = {
    backHref: appPath('/'),
    requiresSignIn: true,
    async load() {
      const paper = await getPaperByPdf(pdfHash);
      paperUuid = paper.uuid;
      source.backHref = appPath(`/paper/${paper.uuid}`);
      return { doc: paper, notes: paper.comments || [] };
    },
    notes: {
      create: (note) => createNote(paperUuid, note),
      update: (uuid, content) => updateNote(uuid, content),
      move: (uuid, spot) => moveNote(uuid, spot),
      rename: (uuid, name) => renameNote(uuid, name),
      remove: (uuid) => deleteNote(uuid),
    },
    ink: {
      list: (editionUuid) => getInk(editionUuid),
      create: (editionUuid, stroke) => addInk(editionUuid, stroke),
      move: (uuid, points) => moveInk(uuid, points),
      remove: (uuid) => eraseInk(uuid),
    },
    clips: {
      list: (editionUuid) => getClips(editionUuid),
      create: (editionUuid, clip) => addClip(editionUuid, clip),
      move: (uuid, frame, floating) => moveClip(uuid, frame, floating),
      remove: (uuid) => eraseClip(uuid),
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
      page: n.page,
      anchor: { type: 'point', x: n.x, y: n.y },
      anchor_type: 'point',
      content: n.content,
      created_at: daysAgo(n.daysAgo),
    }));
}

function localSource(paperUuid) {
  const paper = DEMO_PAPERS[paperUuid];
  // The demo's papers live in memory and reset on reload (see demo.js);
  // its notes do the same, so "nothing is saved" stays true.
  let notes = seedFor(paperUuid);
  let strokes = [];
  let clips = [];

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
        notes,
      };
    },
    notes: {
      async create({ page, anchor, content }) {
        const note = {
          uuid: crypto.randomUUID(),
          page,
          anchor,
          anchor_type: anchor.type,
          content,
          created_at: new Date().toISOString(),
        };
        notes = [...notes, note];
        return note;
      },
      async update(uuid, content) {
        notes = notes.map((n) => (n.uuid === uuid ? { ...n, content } : n));
        return notes.find((n) => n.uuid === uuid);
      },
      async move(uuid, spot) {
        notes = notes.map((n) => (n.uuid === uuid ? { ...n, ...spot } : n));
        return notes.find((n) => n.uuid === uuid);
      },
      async rename(uuid, name) {
        notes = notes.map((n) => (n.uuid === uuid ? { ...n, name } : n));
        return notes.find((n) => n.uuid === uuid);
      },
      async remove(uuid) {
        notes = notes.filter((n) => n.uuid !== uuid);
      },
    },
    // The demo keeps ink the way it keeps everything else: in memory, and
    // gone on reload. The brush is worth meeting even where nothing is
    // saved — it is how a visitor finds out the feature is there.
    ink: {
      async list() {
        return strokes;
      },
      async create(_editionId, stroke) {
        const drawn = { ...stroke, uuid: crypto.randomUUID() };
        strokes = [...strokes, drawn];
        return drawn;
      },
      async move(uuid, points) {
        strokes = strokes.map((s) => (s.uuid === uuid ? { ...s, points } : s));
        return strokes.find((s) => s.uuid === uuid);
      },
      async remove(uuid) {
        strokes = strokes.filter((s) => s.uuid !== uuid);
      },
    },
    clips: {
      async list() { return clips; },
      async create(_editionId, clip) {
        const made = { ...clip, uuid: crypto.randomUUID() };
        clips = [...clips, made];
        return made;
      },
      async move(uuid, frame, floating) {
        clips = clips.map((clip) => (clip.uuid === uuid ? { ...clip, frame, floating } : clip));
        return clips.find((clip) => clip.uuid === uuid);
      },
      async remove(uuid) { clips = clips.filter((clip) => clip.uuid !== uuid); },
    },
  };
}


export { getToken };
