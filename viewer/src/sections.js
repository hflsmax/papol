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
 * The printed text is still consulted for one thing, and it is not the
 * same thing. Many outlines say which *page* a heading is on and nothing
 * more — a `/Fit` destination — so two sections on one page land on the
 * same spot, and the first of them is no length at all. For those, the
 * heading the outline has already named is looked for on the page the
 * outline has already given, and its height is read off the line (see
 * headingY). That is finding where a known title is printed, not deciding
 * what is a title; when the line is not found the section stays at the top
 * of its page, which is what the outline said.
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

// The notices a journal prints at the end of every paper. They are headings
// and the outline lists them, but nobody navigates to "Competing interests":
// each is a sentence or two of form, they come four or five in a row, and on
// a bar where every section is given room to be read they take that room
// from the sections a reader does go to.
//
// Every one of these was read off the outlines of the papers held — they
// account for 34 of 1071 entries, in 24 of 42 papers. The rest of the same
// publishers' end matter (Funding, Conflict of interest, Ethics
// declarations, Reporting summary…) is left out until a paper here is seen
// to carry it. Whole titles only, so "Funding models for open science"
// would still be a section. References are not here: a bibliography is
// somewhere people go.
const END_MATTER = new Set([
  'acknowledgment', 'acknowledgments', 'acknowledgement', 'acknowledgements',
  'author contributions',
  'competing interests',
  'additional information', 'further information',
  'data availability', 'data availability statement',
  'publishers note',
]);

const noticeName = (title) => collapseSpace(
  headingParts(title).title.toLocaleLowerCase().replace(/&/g, ' and ').replace(/[^a-z ]+/g, ''),
);

/** Whether a heading is one of a journal's end-of-paper notices. */
export const isEndMatter = (title) => END_MATTER.has(noticeName(title));

/**
 * The sections without the notices, and without anything filed under one.
 * What came before a notice simply runs on through it: the bar is about
 * where to go, and the way to a notice is the end of the section above.
 */
export function withoutEndMatter(sections) {
  const kept = [];
  let under = null;
  for (const section of sections || []) {
    const level = section.level ?? 0;
    if (under != null && level > under) continue;
    under = isEndMatter(section.title) ? level : null;
    if (under == null) kept.push(section);
  }
  return kept;
}

/** Whether a section opens the back of the paper. */
export function looksAppendix({ number = '', title = '' } = {}) {
  if (/^(appendix|appendices|supplement)/i.test(collapseSpace(title))) return true;
  return /^[A-Z](\.\d+)*$/.test(number);
}

const BIBLIOGRAPHY = new Set(['references', 'bibliography', 'works cited']);

/** Whether a section is the paper's list of references. */
export const isBibliography = (title) => BIBLIOGRAPHY.has(normalizeName(headingParts(title).title));

// What a paper opens with, before it begins: the title and authors, then
// the summary of the whole.
//
// Read from the outlines of the papers held, and holding nothing else. Of
// the 42 with an outline, 29 open on "Abstract"; no other front-matter
// heading occurs in any of them. The obvious other names — Summary at Cell,
// Significance at PNAS, Highlights at Elsevier — are left out until a paper
// on the shelf is seen to use one, because a name nobody here prints is a
// guess, and a guess here narrows a section somebody might be reading.
// Matching is by whole title and only at the very front of the paper, so
// the real sections this shelf does hold — "Overview of CompCertX", "The
// Abstract Stack", "Summary of supplementary information" — are untouched.
const FRONT_MATTER = new Set(['abstract']);

/** Whether a section is the paper's front matter rather than its body. */
export const isFrontMatter = (title) => FRONT_MATTER.has(
  collapseSpace(headingParts(title).title.toLocaleLowerCase().replace(/[^a-z ]+/g, '')),
);

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
 * Every entry of a PDF outline, in reading order, at the depth the outline
 * gave it.
 *
 * The depth is kept true. It used to be folded — everything below the top
 * was called level 1 — which was harmless while level 0 was always the
 * sections. It stopped being harmless with topLevel: in a paper filed
 * under its own title the sections *are* level 1, so folding poured their
 * subsections in among them as equals, and the Navigator drew "Heat-driven
 * soft actuators" as a chapter beside the chapter it belongs to. Which
 * depths get drawn, and how, is the Navigator's business; what depth a
 * heading has is the outline's. Below a sub-subsection nothing is read:
 * there is no use for it, and each entry costs a lookup.
 */
export function flattenOutline(items, level = 0, into = []) {
  if (!Array.isArray(items)) return into;
  for (const item of items) {
    const title = collapseSpace(item?.title);
    if (title && item?.dest != null && !isFloatLabel(title)) {
      into.push({ level, title, dest: item.dest });
    }
    if (Array.isArray(item?.items) && item.items.length && level < 3) {
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
  const y = destinationHeight(dest);
  if (y == null || !(height > 0)) return 1;
  return Math.max(0, Math.min(1, (y - bottom) / height));
}

/** The height a destination names on its page, in PDF units, or null. */
export function destinationHeight(dest) {
  const kind = Array.isArray(dest) ? (dest[1]?.name ?? dest[1]) : null;
  const y = kind === 'XYZ' ? dest[3]
    : kind === 'FitH' || kind === 'FitBH' ? dest[2]
      : kind === 'FitR' ? dest[5] : null;
  return typeof y === 'number' && Number.isFinite(y) ? y : null;
}

// Letters and digits only, ligatures undone and case dropped: a heading is
// printed in small capitals, letterspaced, or with "fi" as one glyph, and
// bookmarked as none of those.
const compact = (text) => String(text ?? '')
  .normalize('NFKD').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

/**
 * How far down a page a named heading is printed, as a fraction of the page
 * from its bottom — or null where it is not found.
 *
 * pdf.js hands a line back in pieces: "8" and "CONCLUSION" are two items,
 * and small capitals make it "C" and "ONCLUSION". Two columns put a line of
 * body text on the same baseline as a heading. So the match is a run of
 * neighbouring pieces on one baseline that spell the title and nothing
 * more — never a title found inside a longer piece, which is how a
 * sentence mentioning "related work" would pass for the section.
 */
export function headingY(items, { number = '', title = '' } = {}, view = [0, 0, 0, 0]) {
  const bottom = view?.[1] ?? 0;
  const height = (view?.[3] ?? 0) - bottom;
  const wanted = [compact(`${number}${title}`), compact(title)].filter(Boolean);
  if (!wanted.length || !(height > 0)) return null;

  const rows = [];
  for (const item of items || []) {
    const text = compact(item?.str);
    if (!text) continue;
    const x = item.transform?.[4] ?? 0;
    const y = item.transform?.[5] ?? 0;
    const size = Math.abs(item.height || item.transform?.[3] || 0);
    const row = rows.find((candidate) => Math.abs(candidate.y - y) <= 2);
    const end = x + Math.abs(item.width || 0);
    if (row) row.pieces.push({ x, end, text, size });
    else rows.push({ y, pieces: [{ x, end, text, size }] });
  }
  // Down the page, so the first match is the heading and not a running
  // head's echo of it further on.
  rows.sort((a, b) => b.y - a.y);

  for (const target of wanted) {
    for (const row of rows) {
      const pieces = [...row.pieces].sort((a, b) => a.x - b.x);
      for (let from = 0; from < pieces.length; from += 1) {
        let spelled = '';
        let size = 0;
        let to = from;
        for (; to < pieces.length && spelled.length < target.length; to += 1) {
          spelled += pieces[to].text;
          size = Math.max(size, pieces[to].size);
        }
        if (spelled !== target) continue;
        // The whole of the line, not the head of a longer one: "Results"
        // is not found at the front of "Results and Discussion". Whatever
        // follows on the baseline has to be a column away.
        const next = pieces[to];
        if (next && next.x - pieces[to - 1].end < size * 2) continue;
        // The top of the line, not its baseline: a place is where the
        // heading starts.
        return Math.max(0, Math.min(1, (row.y + size - bottom) / height));
      }
    }
  }
  return null;
}

async function placeOutline(doc, flat, cancelled) {
  const views = new Map();
  const texts = new Map();
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
    const parts = headingParts(entry.title);
    let y = destinationY(dest, views.get(page));
    if (destinationHeight(dest) == null) {
      // The outline gave a page and no more. Its text is read once, however
      // many headings the page holds.
      if (!texts.has(page)) {
        let items = [];
        try {
          const sheet = await doc.getPage(page);
          items = (await sheet.getTextContent()).items;
        } catch {
          items = [];
        }
        if (cancelled()) return null;
        texts.set(page, items);
      }
      y = headingY(texts.get(page), parts, views.get(page)) ?? y;
    }
    placed.push({
      ...parts,
      level: entry.level,
      page,
      y,
      appendix: false,
    });
  }
  return placed;
}

// A title a person wrote has a space in it, or is a single plain word. What
// a typesetter's tools leave behind does not: "0521857570c01_p7-16.pdf",
// "AUMACA002E-800598-20170701".
const machineTitle = (title) => !/\s/.test(title) && /[\d_]|\.pdf$/i.test(title);

/**
 * Whether an outline, taken as a whole, is a table of contents.
 *
 * Each entry can look fine while the set is plainly not one, and there are
 * two ways that has actually happened. A book assembled from per-chapter
 * files keeps the files' names as its bookmarks, so every title is a
 * production filename. And an outline whose destinations resolve wrongly
 * lists its headings in an order the paper does not have — one review put
 * References on page 1 of 11. Either way the honest drawing is no drawing:
 * an empty bar can be disbelieved at a glance, and a wrong one cannot.
 */
export function looksLikeContents(sections) {
  if (!sections || sections.length < 2) return false;
  const machine = sections.filter((section) => machineTitle(section.title)).length;
  if (machine * 2 > sections.length) return false;
  // Judged by page, never by height on the page: in two columns the next
  // heading is often at the top of the right-hand column, *above* the one
  // before it, and a paper is not doubling back by being typeset.
  let backwards = 0;
  for (let index = 1; index < sections.length; index += 1) {
    if (sections[index].page < sections[index - 1].page) backwards += 1;
  }
  // A stray bookmark is forgiven; an outline that keeps doubling back is
  // not describing this paper.
  return backwards <= (sections.length - 1) * 0.2;
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
  // The outline is judged whole, as it was written; the notices are taken
  // out of what is drawn only after it has passed.
  if (!placed || !looksLikeContents(placed)) return { sections: [] };
  return { sections: withoutEndMatter(markParts(placed)) };
}
