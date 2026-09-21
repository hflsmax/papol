import { isFrontMatter, topLevel } from './sections.js';

/**
 * The paper as a list of places to stop: what the Navigator draws across
 * the bar on a desktop and what the phone's strip names one after another.
 * Both are the same list, made here once, so a section is the same stop
 * on either screen.
 *
 * Everything is placed in document units: 0 at the top of page one, one
 * unit per page. A stop has `at`, where it begins, and `span`, how far it
 * runs to the next one, which is what the bar draws to length and what
 * decides which stop the reader is in.
 */

/** A place in the paper, from a page and a height on it, in document units. */
export const positionOf = (page, y) => (
  (Math.max(1, page || 1) - 1) + (1 - Math.max(0, Math.min(1, y ?? 0)))
);

/**
 * The paper's sections, one level only, in the paper's order, with the
 * front of the paper standing before the first heading.
 *
 * One level, because a paper's subsections outnumber its sections three to
 * one, and named as their equals they crowd the sections out — on the bar
 * as a barcode of boxes too narrow to name, on a strip as a row too long to
 * scan. Which level that is comes from the outline rather than being
 * assumed to be its first: a paper filed under one bookmark of its own
 * title keeps its sections a level down (see topLevel).
 *
 * Whatever comes before the first heading is the front of the paper — its
 * title, its authors, usually its abstract. Part of the document, so part
 * of the list, as Start. Unless the outline already names it: a paper whose
 * first heading is Abstract has the front of itself under the author's own
 * name for it, and Start beside it would name the same place twice.
 */
export function sectionStops(sections, pages) {
  if (!pages) return [];
  const top = topLevel(sections);
  const marks = (sections || [])
    .filter((section) => (section.level ?? 0) === top)
    .map((section) => ({ ...section, at: positionOf(section.page, section.y) }))
    .filter((section) => section.at >= 0 && section.at <= pages)
    // The outline keeps the author's order; a list keeps the paper's.
    .sort((a, b) => a.at - b.at);
  if (!marks.length) return [];
  const out = marks.map((mark, index) => ({
    ...mark,
    span: Math.max(0, (index + 1 < marks.length ? marks[index + 1].at : pages) - mark.at),
  }));
  if (marks[0].at > 0.02 && !isFrontMatter(marks[0].title)) {
    out.unshift({ id: 'front', front: true, at: 0, span: marks[0].at, title: 'Start' });
  }
  return out;
}

/**
 * The pages as stops, for a paper whose outline names no sections. A strip
 * with nothing on it says nothing; the page numbers at least say how far
 * along the reader is, and take a tap to go somewhere.
 */
export function pageStops(pages) {
  return Array.from({ length: Math.max(0, Math.floor(pages || 0)) }, (_, index) => ({
    id: `page-${index + 1}`,
    page: index + 1,
    at: index,
    span: 1,
    title: String(index + 1),
  }));
}

/** What a stop is called: its number and title, or Start for the front. */
export const stopName = (stop) => (
  stop.front ? stop.title : [stop.number, stop.title].filter(Boolean).join(' ')
);

/**
 * Which stop a place in the paper falls in: the last one that begins at or
 * before it. A place before the first stop is in the first, since a paper
 * has nowhere else to be; an empty list holds no place at all.
 */
export function stopAt(stops, at) {
  if (!stops?.length) return -1;
  let found = 0;
  for (let index = 0; index < stops.length; index += 1) {
    if (stops[index].at <= at) found = index;
    else break;
  }
  return found;
}
