/**
 * Where a paper's sections are, for the Contents panel in the bar.
 *
 * Two sources, and they are not equals — the same order of preference the
 * citations follow. A PDF built by LaTeX with hyperref carries an outline:
 * the author's own table of contents, with a destination for every heading.
 * That is the author's answer and no reading of the page improves on it.
 * Where it is missing — a scan, a Word export, an older submission — the
 * headings have to be found in the printed text, which is the rest of this
 * file.
 *
 * Everything here speaks the viewer's own coordinates: a page numbered from
 * one, and a y that is a fraction of the page measured from its bottom, the
 * same as an anchor's. A section and an anchor can then be handed to the
 * same scroller without either knowing about the other.
 */

const collapseSpace = (text) => String(text ?? '').replace(/\s+/g, ' ').trim();

const TRAILING_PUNCTUATION = /[.:·•–—-]+$/;

const normalizeName = (text) =>
  collapseSpace(text).replace(TRAILING_PUNCTUATION, '').trim().toLocaleLowerCase();

// A heading is short. Anything longer is a sentence that happens to open
// with a number.
const LONGEST_HEADING = 90;

// The sections nearly every paper has, printed without a number. Matched
// against a whole line, so "Introduction" is a heading and "the
// introduction of a prior" is not.
// Single generic words are left out on purpose. "Model", "Results" and
// "Setup" head as many table columns as they do sections, and a column
// heading is short, set apart, and often bold — indistinguishable from a
// section heading by every test this file can apply. They are found anyway
// wherever the paper numbers them.
const KNOWN_HEADINGS = new Set([
  'abstract', 'introduction', 'background', 'related work', 'prior work',
  'preliminaries', 'problem statement',
  'methods', 'methodology', 'our approach', 'our method',
  'experiments', 'experimental setup', 'experimental results',
  'evaluation', 'ablation study', 'ablation studies',
  'discussion', 'limitations', 'future work',
  'conclusion', 'conclusions',
  'conclusion and future work', 'conclusions and future work',
  'acknowledgment', 'acknowledgments', 'acknowledgement', 'acknowledgements',
  'references', 'bibliography', 'works cited',
  'appendix', 'appendices', 'supplementary material', 'supplementary materials',
  'broader impact', 'broader impacts', 'ethics statement',
  'reproducibility statement', 'impact statement',
]);

// Those of the above that open the back of the paper rather than continue
// its body.
const APPENDIX_NAMES = new Set([
  'appendix', 'appendices', 'supplementary material', 'supplementary materials',
]);

// A line of a printed table of contents: a title, leader dots, a page
// number. It names a heading without being one, and a paper that prints a
// contents page would otherwise list every section twice.
const LEADER_DOTS = /(\.\s?){4,}|…\s*\d/;

// Captions are numbered, short, and often set larger than the body, so
// without this they pass for headings on sight.
const CAPTION =
  /^(figure|fig\.?|table|tab\.?|algorithm|alg\.?|listing|equation|eq\.?|scheme|corollary|lemma|theorem|definition|proposition|remark|example|proof)\b\s*\d/i;

const startsUpper = (text) => /^["'“(\[]?[A-Z]/.test(collapseSpace(text));

// A title is words. Old papers scanned into text put whole lines of
// mathematics where a heading would sit — "Z Z", "C Wlog 1+ !1:" — and
// every rule about length, case and position lets them through. What they
// are short of is letters.
const readsAsWords = (title) => {
  const text = collapseSpace(title);
  if (text.length < 3) return false;
  const letters = (text.match(/[A-Za-z ]/g) || []).length;
  return letters / text.length >= 0.6;
};

// A heading rarely ends in a full stop, and a sentence of any length almost
// always does. Together those two facts throw out "Appendix A contains the
// proofs." without touching "Appendix A".
const looksLikeSentence = (line) =>
  /[.!?]$/.test(line) && line.split(/\s+/).length >= 5;

/**
 * What a single printed line says, if it says a heading.
 *
 * `appendixOpen` is the one piece of context this needs. A bare capital
 * letter at the head of a line is a section number in the back of a paper
 * and the word "A" everywhere else, and nothing about the line itself can
 * tell those apart — only whether the paper has said it has an appendix yet.
 */
export function headingFromText(text, { appendixOpen = false } = {}) {
  const line = collapseSpace(text);
  if (!line || line.length > LONGEST_HEADING) return null;
  if (LEADER_DOTS.test(line)) return null;
  if (CAPTION.test(line)) return null;
  if (looksLikeSentence(line)) return null;

  // "Appendix", "Appendix B", "Appendix C: Proofs" — the heading that says
  // in words which part of the paper it opens.
  const named = line.match(
    /^(appendix|appendices|supplementary(?: materials?)?)\b[\s.:–—-]*((?:[A-Z](?:\.\d+)*|\d+))?\b[\s.:–—-]*(.*)$/i,
  );
  if (named) {
    const word = collapseSpace(named[1]);
    const number = named[2] || '';
    const rest = collapseSpace(named[3] || '');
    return {
      number,
      // "APPENDIX 5" has a number and no name of its own. Naming it "5"
      // would put a bare digit in the panel where a title goes, so it
      // keeps the only words it has.
      title: rest || [word, number].filter(Boolean).join(' '),
      level: 0,
      appendix: true,
    };
  }

  // "A.2 Proofs" — a lettered part with a numbered subsection under it.
  // Two levels deep is unambiguous wherever it appears.
  const lettered = line.match(/^([A-Z](?:\.\d+)+)[.)]?\s+(\S.*)$/);
  if (lettered && startsUpper(lettered[2]) && readsAsWords(lettered[2])) {
    return {
      number: lettered[1],
      title: collapseSpace(lettered[2]),
      level: 1,
      appendix: true,
    };
  }

  // "3", "3.2", "3.2.1" — the ordinary case.
  const numbered = line.match(/^(\d+(?:\.\d+)*)[.)]?\s+(\S.*)$/);
  if (numbered && startsUpper(numbered[2]) && readsAsWords(numbered[2])) {
    const depth = numbered[1].split('.').length - 1;
    return {
      number: numbered[1],
      title: collapseSpace(numbered[2]),
      // Deeper than a subsection is folded into one: three widths of
      // indent in a 340px panel read as noise, not as structure.
      level: Math.min(1, depth),
      appendix: false,
    };
  }

  // "B Proofs" — only once the paper has announced an appendix.
  const bare = line.match(/^([A-Z])[.)]?\s+(\S.*)$/);
  if (appendixOpen && bare && startsUpper(bare[2]) && readsAsWords(bare[2])) {
    return {
      number: bare[1],
      title: collapseSpace(bare[2]),
      level: 0,
      appendix: true,
    };
  }

  const name = normalizeName(line);
  if (KNOWN_HEADINGS.has(name)) {
    return {
      number: '',
      title: collapseSpace(line).replace(TRAILING_PUNCTUATION, '').trim(),
      level: 0,
      appendix: APPENDIX_NAMES.has(name),
    };
  }
  return null;
}

/** Whether a parsed heading opens the back of the paper. */
export function looksAppendix({ number = '', title = '' } = {}) {
  if (/^(appendix|appendices|supplement)/i.test(collapseSpace(title))) return true;
  return /^[A-Z](\.\d+)*$/.test(number);
}

// pdf.js hands back the loaded font's family rather than its PostScript
// name, so this fires only where the family survived. It is a bonus signal,
// never the only one.
const isBold = (style) =>
  typeof style?.fontFamily === 'string' && /bold|black|heavy|semib/i.test(style.fontFamily);

const runLine = (pieces, { pageHeight, pageBottom, y }) => {
  let text = '';
  const size = pieces.reduce((largest, piece) => Math.max(largest, piece.size), 0);
  pieces.forEach((piece, index) => {
    const previous = pieces[index - 1];
    if (previous) {
      const gap = piece.x - (previous.x + previous.width);
      // pdf.js breaks a line wherever the font or the positioning changes,
      // which happens mid-word as often as between words. Only a gap wide
      // enough to be a space becomes one.
      if (gap > size * 0.18 && !/\s$/.test(text) && !/^\s/.test(piece.str)) text += ' ';
    }
    text += piece.str;
  });
  return {
    text: collapseSpace(text),
    x: pieces[0].x,
    y: pageHeight > 0 ? (y - pageBottom) / pageHeight : y,
    size,
    bold: pieces.some((piece) => piece.bold),
  };
};

/**
 * pdf.js text items, gathered into printed lines.
 *
 * Two columns are the reason this is more than a sort. Items set side by
 * side in different columns share a baseline, so joining a whole baseline
 * would read "3 Method 4 Results" as one heading. A run of items is cut
 * wherever the space between them is wider than any word space could be —
 * which is what a gutter is.
 */
export function linesFromItems(items, {
  pageWidth = 0, pageHeight = 0, pageBottom = 0, styles = {},
} = {}) {
  const rows = [];
  for (const item of items || []) {
    if (!item || typeof item.str !== 'string' || !item.str.trim()) continue;
    const x = item.transform?.[4] ?? 0;
    const y = item.transform?.[5] ?? 0;
    const size = Math.abs(item.height || item.transform?.[3] || 0) || 1;
    const piece = {
      x,
      width: Math.abs(item.width || 0),
      str: item.str,
      size,
      bold: isBold(styles?.[item.fontName]),
    };
    // The same baseline, within the slop a superscript or a font change
    // costs.
    const row = rows.find(
      (candidate) => Math.abs(candidate.y - y) <= Math.max(1.2, candidate.size * 0.25),
    );
    if (row) {
      row.pieces.push(piece);
      if (size > row.size) row.size = size;
    } else {
      rows.push({ y, size, pieces: [piece] });
    }
  }

  const gutter = pageWidth > 0 ? pageWidth * 0.06 : Infinity;
  const lines = [];
  for (const row of rows) {
    const pieces = [...row.pieces].sort((a, b) => a.x - b.x);
    let run = [];
    const flush = () => {
      if (run.length) lines.push(runLine(run, { pageHeight, pageBottom, y: row.y }));
      run = [];
    };
    for (const piece of pieces) {
      const previous = run[run.length - 1];
      if (previous && piece.x - (previous.x + previous.width) > gutter) flush();
      run.push(piece);
    }
    flush();
  }
  return lines.filter((line) => line.text).sort((a, b) => b.y - a.y || a.x - b.x);
}

/**
 * The size the paper's body text is set at: the size carrying the most
 * characters. Everything else is measured against it, so a paper set in 9pt
 * and one set in 12pt are read by the same rules.
 */
export function bodyTextSize(lines) {
  const weight = new Map();
  for (const line of lines || []) {
    const size = Math.round((line.size || 0) * 2) / 2;
    if (!(size > 0)) continue;
    weight.set(size, (weight.get(size) || 0) + line.text.length);
  }
  let best = 0;
  let most = 0;
  for (const [size, characters] of weight) {
    if (characters > most) {
      most = characters;
      best = size;
    }
  }
  return best;
}

// A running header or a folio is printed in the margin, and prints there on
// every page.
const MARGIN = 0.045;

// More candidates than this on one page is a printed table of contents, not
// a page with headings on it.
const CONTENTS_PAGE = 8;

/**
 * The headings one page offers, by what they say and where they sit. Size
 * is not judged here: the body size is only known once every page has been
 * read, so `keepHeadings` applies it afterwards.
 */
export function headingsFromLines(lines, { page = 1, appendixOpen = false } = {}) {
  const headings = [];
  const loose = [];
  const seen = new Set();
  let open = appendixOpen;
  for (const line of lines || []) {
    if (line.y > 1 - MARGIN || line.y < MARGIN) continue;
    const heading = headingFromText(line.text, { appendixOpen: open });
    if (!heading) {
      if (couldBeTitle(line.text)) {
        loose.push({
          number: '', title: collapseSpace(line.text), level: 0, appendix: false,
          page, y: line.y, size: line.size, bold: line.bold,
        });
      }
      continue;
    }
    const key = normalizeName(`${heading.number} ${heading.title}`);
    if (seen.has(key)) continue;
    seen.add(key);
    if (heading.appendix) open = true;
    headings.push({ ...heading, page, y: line.y, size: line.size, bold: line.bold });
  }
  if (headings.length > CONTENTS_PAGE) return { headings: [], loose: [], appendixOpen };
  return { headings, loose, appendixOpen: open };
}

// A line that would make a heading if the paper turned out to set its
// headings that way: a short phrase of words, capitalised, whole on its
// line. On its own this describes half the table headers and figure labels
// in a paper, which is why nothing is made of it until `promoteTitles` has
// something to compare it against.
function couldBeTitle(text) {
  const line = collapseSpace(text);
  if (line.length < 4 || line.length > 60) return false;
  if (!startsUpper(line) || !readsAsWords(line)) return false;
  if (CAPTION.test(line) || LEADER_DOTS.test(line) || looksLikeSentence(line)) return false;
  const words = line.split(' ');
  return words.length >= 2 && words.length <= 6;
}

/**
 * Which candidates are really headings.
 *
 * A line that says "3.1 Results" is either a section or an item in a
 * numbered list, and the words cannot tell them apart. What tells them
 * apart is the type: a heading is set larger than the body, or heavier than
 * it. A candidate that is neither is kept only when it is one of the
 * sections every paper has, standing alone on its line — "Abstract",
 * "References" — which no list item ever is.
 */
export function keepHeadings(candidates, { bodySize = 0, pageCount = 1 } = {}) {
  const wanted = (candidates || []).filter((heading) => (
    !bodySize || heading.size >= bodySize * 1.04 || heading.bold
  ));

  // A phrase that keeps its place page after page is furniture: the paper's
  // own title in a running head, or a journal's name.
  const pages = new Map();
  for (const heading of wanted) {
    const key = normalizeName(heading.title);
    const on = pages.get(key) || new Set();
    on.add(heading.page);
    pages.set(key, on);
  }
  return wanted.filter((heading) => {
    const on = pages.get(normalizeName(heading.title));
    return !(on && on.size > 3 && on.size > pageCount * 0.3);
  });
}

/**
 * The headings a paper sets without numbering and without one of the names
 * every paper uses — "Attention Visualizations", "Broader Impact".
 *
 * Nothing a single line says can identify one, which is why this asks a
 * different question: at what size does *this paper* set its headings? The
 * ones already found answer it, and any loose phrase set at exactly that
 * size is one too. It is anchored to the document's own evidence, so it
 * cannot invent a heading in a paper that has none — and it declines to
 * guess when a paper's headings are set at body size, where the question
 * has no answer.
 */
export function promoteTitles(headings, loose, { bodySize = 0 } = {}) {
  if (!bodySize || !loose?.length) return headings;
  const sizes = new Set(
    (headings || [])
      .map((heading) => Math.round(heading.size * 2) / 2)
      .filter((size) => size > bodySize * 1.04),
  );
  if (sizes.size === 0) return headings;
  const already = new Set((headings || []).map((heading) => normalizeName(heading.title)));
  const found = loose.filter((line) => {
    if (!sizes.has(Math.round(line.size * 2) / 2)) return false;
    const key = normalizeName(line.title);
    if (already.has(key)) return false;
    already.add(key);
    return true;
  });
  return [...(headings || []), ...found];
}

// A scan that finds fewer than this has not found a paper's structure; it
// has found a heading or two by luck. One line in a panel called Contents
// is worse than an honest empty one.
const ENOUGH = 3;

/**
 * Whether the numbering the scan found is a paper's numbering.
 *
 * A section heading is a line, and every test so far has been a test of one
 * line. This is the test the set has to pass: a paper's sections are
 * numbered 1, 2, 3 from near its front, and nothing else in a paper is.
 * Lines that borrow the shape of a heading — a numbered list, an enumerated
 * theorem, a page of mathematics read as text — never form that run, and
 * this is where they are thrown out in a body rather than one at a time.
 */
export function coherentSections(sections, { pageCount = 1 } = {}) {
  const tops = (sections || []).filter(
    (section) => section.level === 0 && /^\d+$/.test(section.number),
  );
  if (tops.length === 0) return sections || [];

  const first = Number(tops[0].number);
  // Numbering that starts at 7, or only halfway through the paper, is not
  // the paper's own. The unnumbered headings may still be real.
  if (first > 2 || tops[0].page > Math.max(2, pageCount * 0.4)) {
    return (sections || []).filter((section) => !section.number);
  }

  // Kept by identity, not by number: a paper numbered 1, 2, 3 with a
  // numbered list further in has two sections calling themselves "1", and
  // only the first of them is a section.
  const run = new Set();
  const numbers = new Set();
  let last = first - 1;
  for (const section of tops) {
    const number = Number(section.number);
    // One gap is forgiven: a section can be missed where its heading broke
    // across a column. Going backwards or standing still cannot happen.
    if (number === last + 1 || number === last + 2) {
      run.add(section);
      numbers.add(section.number);
      last = number;
    }
  }
  return (sections || []).filter((section) => {
    if (!section.number) return true;
    const top = section.number.split('.')[0];
    if (!/^\d+$/.test(top)) return true;
    // A subsection belongs to the run its own section belongs to.
    return section.level === 0 ? run.has(section) : numbers.has(top);
  });
}

/** Document order: down the pages, and down each page. */
export const sortSections = (sections) =>
  [...(sections || [])].sort((a, b) => a.page - b.page || b.y - a.y);

/**
 * The finished list: an id for each section, and the point at which the
 * paper stops being its body and starts being its back matter. Appendices
 * come last, so the first one that announces itself opens a part running to
 * the end.
 */
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

const BIBLIOGRAPHY = new Set(['references', 'bibliography', 'works cited']);

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
 * below the second level is folded into it, for the same reason a deeply
 * printed number is.
 */
export function flattenOutline(items, level = 0, into = []) {
  if (!Array.isArray(items)) return into;
  for (const item of items) {
    const title = collapseSpace(item?.title);
    if (title && item?.dest != null) {
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

async function scanSections(doc, {
  cancelled, yieldEvery, yieldToMain, maxPages, from = 1,
}) {
  const pages = Math.min(doc.numPages, maxPages);
  // Only the size histogram survives each page, not its text: a long
  // document read for its headings should not also be held in memory as one.
  const sizes = [];
  const candidates = [];
  const loose = [];
  let appendixOpen = false;
  for (let number = 1; number <= pages; number += 1) {
    const page = await doc.getPage(number);
    const content = await page.getTextContent();
    if (cancelled()) return null;
    const [left, bottom, right, top] = page.view || [0, 0, 0, 0];
    const lines = linesFromItems(content.items, {
      pageWidth: right - left,
      pageHeight: top - bottom,
      pageBottom: bottom,
      styles: content.styles,
    });
    // The body size is measured over the whole document even when only its
    // tail is being read for headings: a tail measures itself as mostly
    // bibliography, which is set smaller than the body it should be
    // compared against.
    for (const line of lines) sizes.push({ size: line.size, text: line.text });
    if (number >= from) {
      const found = headingsFromLines(lines, { page: number, appendixOpen });
      appendixOpen = found.appendixOpen;
      candidates.push(...found.headings);
      loose.push(...found.loose);
    }
    page.cleanup?.();
    if (number < pages && number % yieldEvery === 0) {
      await yieldToMain();
      if (cancelled()) return null;
    }
  }
  const bodySize = bodyTextSize(sizes);
  const kept = keepHeadings(candidates, { bodySize, pageCount: pages });
  return promoteTitles(kept, loose, { bodySize });
}

/**
 * The headings on the pages an outline never reaches. Only the back of a
 * paper is read this way, and only what sits after the outline's last entry
 * is kept, so nothing here can contradict what the author bookmarked.
 */
async function backMatter(doc, placed, options) {
  const last = placed.reduce(
    (furthest, section) => (section.page > furthest.page ? section : furthest),
    placed[0],
  );
  // A page or two past the last bookmark is the end of the last section,
  // not a part of the paper that was left out.
  if (doc.numPages - last.page < 2) return [];
  let scanned = null;
  try {
    scanned = await scanSections(doc, { ...options, from: last.page });
  } catch {
    // The outline is the answer; this was only ever a supplement to it.
    // A page that will not give up its text costs the appendix, not the
    // contents.
    return [];
  }
  if (!scanned) return [];
  // The last bookmarked heading is itself on that page, and the scan finds
  // it again. Anything the outline already names is the outline's.
  const bookmarked = new Set(placed.map((section) => normalizeName(section.title)));
  return sortSections(scanned).filter((section) => (
    (section.page > last.page || section.y < last.y)
    && !bookmarked.has(normalizeName(section.title))
  ));
}

/**
 * The paper's sections. Resolves to `null` when the read was cancelled, and
 * otherwise to `{ from, sections }` — `from` naming which of the two sources
 * answered, which is only ever of interest to a test.
 */
export async function readSections(doc, options = {}) {
  const {
    cancelled = () => false,
    yieldEvery = 4,
    yieldToMain = () => new Promise((resolve) => { requestAnimationFrame(resolve); }),
    maxPages = 400,
  } = options;
  if (!doc?.numPages) return { from: 'none', sections: [] };

  let outline = null;
  try {
    outline = await doc.getOutline();
  } catch {
    outline = null;
  }
  if (cancelled()) return null;

  const flat = flattenOutline(outline);
  // One bookmark is a cover link, not a table of contents, and a text scan
  // will beat it. Two is a paper describing itself.
  if (flat.length >= 2) {
    const placed = await placeOutline(doc, flat, cancelled);
    if (cancelled()) return null;
    if (placed && placed.length >= 2) {
      // What an author bookmarks is the paper they wrote; what they forget
      // is what LaTeX added after it. References and appendices fall off
      // the end of an outline often enough that the pages past its last
      // entry are worth reading, and only those pages.
      const tail = await backMatter(doc, placed, {
        cancelled, yieldEvery, yieldToMain, maxPages,
      });
      if (cancelled()) return null;
      // The outline is already in the author's order; nothing here reorders
      // it on the strength of a resolved destination.
      return { from: 'outline', sections: markParts([...placed, ...tail]) };
    }
  }

  const scanned = await scanSections(doc, { cancelled, yieldEvery, yieldToMain, maxPages });
  if (cancelled()) return null;
  const sections = coherentSections(sortSections(scanned || []), { pageCount: doc.numPages });
  return {
    from: 'text',
    sections: sections.length >= ENOUGH ? markParts(sections) : [],
  };
}

/**
 * The section a reading position falls in: the last one beginning at or
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
