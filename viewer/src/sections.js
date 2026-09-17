/**
 * Where a paper's sections are.
 *
 * One source: the PDF's own outline. A file built by LaTeX with hyperref,
 * or exported by any of the publishers, carries the author's table of
 * contents — a title and a destination for every heading — and that is
 * what every other reader uses. Preview, Acrobat, Chrome and pdf.js all
 * walk the same `/Outlines` tree and, where a file has none, show no
 * contents at all.
 *
 * Papol used to try harder, reading headings out of the printed text where
 * the outline was missing. Measured over eighty papers it was wrong more
 * often than right: the rule it turned on — a heading is set larger or
 * heavier than the body — is false for most journal typography and for
 * every scan, where headings are frequently *smaller* than the text they
 * head. It returned nothing for a dozen papers that plainly have sections,
 * and for Shannon it returned thirty-seven display equations. A contents
 * that is wrong is worse than a contents that is absent, because only one
 * of the two can be disbelieved at a glance. So that pass is gone, and a
 * paper with no outline now has no Navigator — the same answer Preview
 * gives, arrived at honestly.
 *
 * Everything here speaks the viewer's own coordinates: a page numbered
 * from one, and a y that is a fraction of the page measured from its
 * bottom, the same as an anchor's. A section and an anchor can then be
 * handed to the same scroller without either knowing about the other.
 */

const collapseSpace = (text) => String(text ?? '').replace(/\s+/g, ' ').trim();

const normalizeName = (text) => collapseSpace(text).toLocaleLowerCase();

// Nature and Springer bookmark every float alongside the prose, so an
// outline arrives holding "Fig. 3 Metre-scale inflatable archway." as a
// sibling of Conclusion. A caption is not a section: it names a picture,
// and it is filed after the text it belongs beside, so leaving it in also
// sends the last rows of the Navigator backwards through the paper.
const FLOAT_LABEL = /^(fig|figure|table|tab|box|scheme|chart|plate)\b[\s.:]*\d/i;

/** Whether an outline entry names a float rather than a section. */
export const isFloatLabel = (title) => FLOAT_LABEL.test(collapseSpace(title));

/** Whether a section opens the back of the paper. */
export function looksAppendix({ number = '', title = '' } = {}) {
  if (/^(appendix|appendices|supplement)/i.test(collapseSpace(title))) return true;
  return /^[A-Z](\.\d+)*$/.test(number);
}

const BIBLIOGRAPHY = new Set(['references', 'bibliography', 'works cited']);

/**
 * Which level of the outline is the paper's own sections.
 *
 * Normally level 0. But a publisher's outline often wraps the whole article
 * in a single bookmark named after its title, and hangs every real section
 * underneath it — at which point level 0 is one entry spanning the paper,
 * and drawing it would be drawing a contents with one line in it. So the
 * top level is the shallowest one holding more than a single entry, which
 * is level 0 for a paper that bookmarks its sections directly and level 1
 * for a paper filed under its own name.
 */
export function topLevel(sections) {
  const counts = new Map();
  for (const section of sections || []) {
    const level = section.level ?? 0;
    counts.set(level, (counts.get(level) || 0) + 1);
  }
  for (const level of [...counts.keys()].sort((a, b) => a - b)) {
    if (counts.get(level) > 1) return level;
  }
  return 0;
}

/**
 * The finished list: an id for each section, and the point at which the
 * paper stops being its body and starts being its back matter.
 */
export function markParts(sections) {
  let appendix = false;
  let afterReferences = false;
  // Back matter is decided among the paper's own sections, whichever level
  // of the outline those turned out to be.
  const top = topLevel(sections);
  return (sections || []).map((section, index) => {
    if ((section.level ?? 0) === top) {
      // A paper that names its appendix says so. One that does not still
      // marks the boundary, because nothing follows a bibliography except
      // the material that was held back from the paper.
      if (section.appendix || looksAppendix(section) || afterReferences) appendix = true;
      if (BIBLIOGRAPHY.has(normalizeName(section.title))) afterReferences = true;
    }
    return { ...section, id: `s${index}`, appendix };
  });
}

/**
 * A number printed at the head of an outline entry, split off so the panel
 * can set it in its own column. A bare capital letter is left alone: an
 * entry called "A Simple Baseline" is not section A.
 */
export function headingParts(title) {
  const line = collapseSpace(title);
  const match = line.match(/^(\d+(?:\.\d+)*|[A-Z]\.\d+(?:\.\d+)*)[.)]?\s+(\S.*)$/);
  if (match) return { number: match[1], title: collapseSpace(match[2]) };
  return { number: '', title: line };
}

/**
 * Every entry of a PDF outline, in reading order, with its depth. Anything
 * below the second level is folded into it: a paper's subsections already
 * outnumber its sections three to one, and a third indent is detail the
 * bar has no room to draw.
 */
export function flattenOutline(items, level = 0, into = []) {
  if (!Array.isArray(items)) return into;
  for (const item of items) {
    const title = collapseSpace(item?.title);
    if (title && item?.dest != null && !isFloatLabel(title)) {
      into.push({ level: Math.min(1, level), title, dest: item.dest });
    }
    if (Array.isArray(item?.items) && item.items.length && level < 2) {
      flattenOutline(item.items, level + 1, into);
    }
  }
  return into;
}

/**
 * How far down a page an outline destination lands, as a fraction of the
 * page measured from its bottom. A destination naming no height — a plain
 * Fit — means the whole page, so it lands at the top of it.
 */
export function destinationY(dest, view = [0, 0, 0, 0]) {
  const bottom = view?.[1] ?? 0;
  const top = view?.[3] ?? 0;
  const height = top - bottom;
  const kind = Array.isArray(dest) ? (dest[1]?.name ?? dest[1]) : null;
  let y = null;
  if (kind === 'XYZ') y = dest[3];
  else if (kind === 'FitH' || kind === 'FitBH') y = dest[2];
  else if (kind === 'FitR') y = dest[5];
  if (typeof y !== 'number' || !Number.isFinite(y) || !(height > 0)) return 1;
  return Math.max(0, Math.min(1, (y - bottom) / height));
}

async function placeOutline(doc, flat, cancelled) {
  const views = new Map();
  const placed = [];
  for (const entry of flat) {
    if (cancelled()) return null;
    let dest = entry.dest;
    if (typeof dest === 'string') {
      try {
        dest = await doc.getDestination(dest);
      } catch {
        dest = null;
      }
    }
    const target = Array.isArray(dest) ? dest[0] : null;
    let index = null;
    if (target && typeof target === 'object') {
      try {
        index = await doc.getPageIndex(target);
      } catch {
        index = null;
      }
    } else if (Number.isInteger(target)) {
      index = target;
    }
    // A destination that will not resolve names no place. Dropping the
    // entry is the honest answer; keeping it would put a heading on page
    // one and send the Navigator backwards.
    if (index == null || index < 0) continue;
    const page = index + 1;
    if (!views.has(page)) {
      let view = null;
      try {
        view = (await doc.getPage(page)).view;
      } catch {
        view = null;
      }
      views.set(page, view || [0, 0, 0, 0]);
    }
    placed.push({
      ...headingParts(entry.title),
      level: entry.level,
      page,
      y: destinationY(dest, views.get(page)),
      appendix: false,
    });
  }
  return placed;
}

/**
 * The paper's sections, or none. Resolves to `null` when the read was
 * cancelled.
 *
 * One bookmark is a cover link rather than a table of contents, so it is
 * not worth a Navigator; two is a paper describing itself. The outline's
 * order is the author's and is kept as given.
 */
export async function readSections(doc, { cancelled = () => false } = {}) {
  if (!doc?.numPages) return { sections: [] };

  let outline = null;
  try {
    outline = await doc.getOutline();
  } catch {
    outline = null;
  }
  if (cancelled()) return null;

  const flat = flattenOutline(outline);
  if (flat.length < 2) return { sections: [] };

  const placed = await placeOutline(doc, flat, cancelled);
  if (cancelled()) return null;
  if (!placed || placed.length < 2) return { sections: [] };
  return { sections: markParts(placed) };
}

/**
 * The section a reading position falls in: the last one that begins at or
 * above it. Both y values are fractions from the bottom of their page, so a
 * section is above the reader when its y is the larger.
 */
export function sectionAt(sections, place) {
  if (!sections?.length || !place) return null;
  let found = null;
  for (const section of sections) {
    if (section.page > place.page) break;
    // A heading sitting a hair above the top of the view still counts as
    // the section being read: landing on one should name it, not the one
    // before it.
    if (section.page < place.page || section.y >= place.y - 0.02) found = section;
  }
  return found;
}
