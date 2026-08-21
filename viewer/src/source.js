import { demoPapers, demoNotes } from '../../shared/demoWorld';
import {
  getPaper, createNote, updateNote, moveNote, renameNote, markPlace, deleteNote,
  getInk, addInk, eraseInk,
  getToken,
} from './api';

/**
 * Where this document and its notes come from — decided once, from the URL,
 * so nothing below has to care which it is.
 *
 *   ?paper=9   a paper in the reader's nook: notes live in Papol
 *   ?url=…     a file the app already serves: notes live only in memory
 *
 * Both return the same shape, so the viewer only ever calls load(),
 * notes.{create,update,remove} and ink.{list,create,remove}.
 */
export function resolveSource() {
  const params = new URLSearchParams(window.location.search);
  const paper = params.get('paper');
  if (!paper || !/^\d+$/.test(paper)) return null;
  const inDemo = localStorage.getItem('papol_demo') === '1';
  if (inDemo && DEMO_PAPERS[paper]) return localSource(paper);
  return apiSource(paper);
}

function apiSource(paperId) {
  return {
    backHref: `../#/paper/${paperId}`,
    requiresSignIn: true,
    async load() {
      const paper = await getPaper(paperId);
      return { doc: paper, notes: paper.comments || [] };
    },
    notes: {
      create: (note) => createNote(paperId, note),
      update: (id, content) => updateNote(id, content),
      move: (id, spot) => moveNote(id, spot),
      rename: (id, name) => renameNote(id, name),
      markPlace: (id) => markPlace(id),
      remove: (id) => deleteNote(id),
    },
    ink: {
      list: (editionId) => getInk(editionId),
      create: (editionId, stroke) => addInk(editionId, stroke),
      remove: (id) => eraseInk(id),
    },
  };
}

// The demo opens with a few anchors already in place, so a visitor meets
// the feature rather than an empty rail. Fictional, like the rest of the
// demo, and gone on reload.
// The demo world is shared with Papol's own demo, so a note written into
// it appears on the paper page and in the viewer alike.
const DEMO_PAPERS = Object.fromEntries(demoPapers.map((p) => [p.id, p]));

const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString();

function seedFor(paperId) {
  return demoNotes
    .filter((n) => n.paperId === Number(paperId))
    .map((n) => ({
      id: n.id,
      page: n.page,
      anchor: { type: 'point', x: n.x, y: n.y },
      anchor_type: 'point',
      content: n.content,
      current_place: !!n.currentPlace,
      created_at: daysAgo(n.daysAgo),
    }));
}

function localSource(paperId) {
  const paper = DEMO_PAPERS[paperId];
  // The demo's papers live in memory and reset on reload (see demo.js);
  // its notes do the same, so "nothing is saved" stays true.
  let notes = seedFor(paperId);
  let strokes = [];
  let nextInkId = 1;

  return {
    backHref: `../#/paper/${paperId}`,
    async load() {
      return { doc: paper, notes };
    },
    notes: {
      async create({ page, anchor, content }) {
        const note = {
          id: notes.reduce((m, n) => Math.max(m, n.id), 0) + 1,
          page,
          anchor,
          anchor_type: anchor.type,
          content,
          created_at: new Date().toISOString(),
        };
        notes = [...notes, note];
        return note;
      },
      async update(id, content) {
        notes = notes.map((n) => (n.id === id ? { ...n, content } : n));
        return notes.find((n) => n.id === id);
      },
      async move(id, spot) {
        notes = notes.map((n) => (n.id === id ? { ...n, ...spot } : n));
        return notes.find((n) => n.id === id);
      },
      async rename(id, name) {
        notes = notes.map((n) => (n.id === id ? { ...n, name } : n));
        return notes.find((n) => n.id === id);
      },
      async markPlace(id) {
        notes = notes
          .filter((n) => !n.current_place || n.id === id)
          .map((n) => ({ ...n, current_place: n.id === id }));
        return notes.find((n) => n.id === id);
      },
      async remove(id) {
        notes = notes.filter((n) => n.id !== id);
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
        const drawn = { ...stroke, id: nextInkId++ };
        strokes = [...strokes, drawn];
        return drawn;
      },
      async remove(id) {
        strokes = strokes.filter((s) => s.id !== id);
      },
    },
  };
}


export { getToken };
