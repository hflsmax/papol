// The viewer with a project on.
//
// A paper opens alone: what is on its pages is the reader's own. Opened
// with one of their projects on (`?project=<uuid>`), the pages carry every
// member's notes, ink and clips, and the reader has to be able to tell at a
// glance whose each is. So with a project on, ink is drawn in its author's
// colour rather than the colour it was painted in: one colour per member,
// the reader's own included, and the same colour their avatar wears. What
// another member left is theirs alone to change; it can be read, followed
// and dug into.

import { tintOf } from '../../shared/identityTint.js';

// One ink per identity tint (shared/designTokens.js): the avatar's own
// colour is too dark to read as a wash over print, so each has a brighter
// sibling of the same hue, told apart from the others at a stroke's width.
export const MEMBER_INKS = ['#2f6fd1', '#1a9aa6', '#2f9e5a', '#d8571f', '#b23e9a', '#6a56d6'];

export function memberInk(user) {
  return MEMBER_INKS[tintOf(user)];
}

// The project named in the URL, if any.
export function projectParam(search = window.location.search) {
  const value = new URLSearchParams(search).get('project') || '';
  return /^[0-9a-f-]{36}$/i.test(value) ? value.toLowerCase() : null;
}

// The same URL with a project on, or with none.
export function withProject(href, projectUuid) {
  const url = new URL(href);
  if (projectUuid) url.searchParams.set('project', projectUuid);
  else url.searchParams.delete('project');
  return url.href;
}

// What the project reads (the annotations route) sorted into the reader's
// own and the other members', each of the others' marked `theirs` and
// carrying its author.
export function sortAnnotations(read) {
  const mine = [];
  const theirs = [];
  for (const annotation of read.annotations) {
    if (annotation.user?.uuid === read.me) mine.push(annotation);
    else theirs.push({ ...annotation, theirs: true });
  }
  return { mine, theirs };
}

// A stroke as it is drawn with the project on: in its author's colour.
// The reader's own ink has no author on it (it came from their own list),
// so the reader is passed.
export function inMemberInk(stroke, me) {
  const author = stroke.user ?? me;
  return author ? { ...stroke, color: memberInk(author) } : stroke;
}

// The members whose marks are on this paper, the reader first, each once.
export function whoMarked(annotations, me) {
  const seen = new Map();
  if (me) seen.set(me.uuid, me);
  for (const annotation of annotations) {
    if (annotation.user && !seen.has(annotation.user.uuid)) seen.set(annotation.user.uuid, annotation.user);
  }
  return [...seen.values()];
}

// How far down its page an annotation sits, as a fraction from the top: an
// anchor at its point, ink at its highest point, a clip at the top of its
// frame. Anchors and ink are PDF-space (y up); a clip's frame is measured
// from the top. The Worker orders a paper's digs by the same rule.
export function annotationDown(annotation) {
  const ys = (annotation.points ?? []).map((point) => point.y).filter(Number.isFinite);
  const down = typeof annotation.anchor?.y === 'number' ? 1 - annotation.anchor.y
    : ys.length ? 1 - Math.max(...ys)
    : typeof annotation.frame?.y === 'number' ? annotation.frame.y
    : 0.5;
  return Math.min(1, Math.max(0, down));
}

// The lines of the dig margin: one for each thing dug, the paper's own at
// the head of its first page, then every dug annotation where it sits,
// page by page, top to bottom. `writing` is a thing nobody has dug that
// the reader is starting a dig on: it has its line while they write.
export function marginLinesOf({ paper, paperDigs, digs, notes = [], ink = [], clips = [], writing = null }) {
  const lines = [];
  if (paperDigs) {
    lines.push({ key: 'paper', subject: `paper:${paper.sha256}`, label: paper.title || 'this paper', page: 1, down: 0, pin: paperDigs });
  }
  const all = [...notes.map((a) => ['note', a]), ...ink.map((a) => ['ink', a]), ...clips.map((a) => ['clip', a])];
  for (const [kind, a] of all) {
    const pin = digs?.[a.uuid] ?? (a.uuid === writing ? {} : null);
    if (!pin || !a.page) continue;
    const label = kind === 'note' ? (a.name || a.content || `An anchor on page ${a.page}`)
      : kind === 'ink' ? `Ink on page ${a.page}` : `A clip on page ${a.page}`;
    // A note's own words head its line's card: the thing the dig is about.
    const quote = kind === 'note' && a.content ? { name: a.name || null, text: a.content } : null;
    lines.push({ key: a.uuid, annotation: a.uuid, kind, subject: `annotation:${a.uuid}`, label, quote, page: a.page, down: annotationDown(a), pin });
  }
  return lines.sort((x, y) => x.page - y.page || x.down - y.down);
}
