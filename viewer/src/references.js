import { destinationHeight } from './sections.js';
/**
 * What is clickable on a page: the citations, and the PDF's own links.
 *
 * Two sources, and they are not equals. Some PDFs — anything built by
 * LaTeX with hyperref, which is most of the last twenty years of arXiv —
 * already contain a link on every "[12]", pointing at the exact line of
 * the bibliography it means. That is the author's own answer, and it is
 * better than any analysis of the page could be. Where those links exist
 * they are used; where they do not, the boxes the analyzer found are.
 *
 * The link only says *where* it lands, never *what* it means, so the
 * matching runs the other way round from what one might expect: the
 * destination is resolved to a point on a page, and the reference printed
 * at that point is the one the link cites. That test needs no guesswork
 * about how the PDF names its anchors — a link that lands on a reference
 * is a citation of it, whatever it is called.
 *
 * The same pass yields everything else the author linked: "see Section 3.2",
 * "Figure 4", a URL in a footnote. Those are not citations and get no card
 * — they simply go where they say they go. They fall out of the same walk
 * over the annotations, so a page costs one look either way.
 */

// How near a link's destination has to land to a reference's first line to
// be that reference, as a fraction of page height. A destination is
// usually set a little above the line it points at, so this is generous
// downward and tight upward.
const ABOVE = 0.012;
const BELOW = 0.06;
// Two bibliography entries set side by side in different columns sit at the
// same height, so a destination's y cannot tell them apart. Entries this far
// apart across the page are in different columns.
const COLUMN_GAP = 0.15;
// A bibliography is set in reading order: down one column, then down the
// next. Walking a page's entries in printed order, y climbs steadily and then
// drops back towards the top where a column breaks. That fall is how the
// layout gives itself away without anyone measuring across the page.
const COLUMN_RESET = 0.02;
// Two printed entries whose numbers start this far apart across the page
// begin different columns. Entries within one column share a left edge to
// within a rounding error, so this only has to be wider than that.
const COLUMN_SPLIT = 0.05;
// How far left of its entry numbers a column still reaches. Only enough to
// forgive the rounding: a hanging indent sets continuation lines to the
// right, never the left, and reaching any further picks up the tail of the
// column alongside.
const COLUMN_EDGE = 0.005;
// Blank space this wide within one printed line is a gutter, not a word
// space. It catches the column alongside even where that column numbers no
// entry of its own — the tail of a long reference carried over, which the
// entry annotations cannot see.
const COLUMN_GUTTER = 0.02;
// hyperref raises a destination slightly above the bibliography line so a
// jump does not pin the text flush to the window edge. Matching the nearest
// line mistakes a tightly spaced next entry for the preceding one. This is
// the typical raised-link distance on a letter-sized page (about 5.5pt).
const EXPECTED_DROP = 0.007;

/**
 * Citation boxes for one page, in fractions of the page from its
 * top-left corner: [{ referenceUuid, label, x, y, w, h, exact }].
 *
 * `analysis` is what the backend returned; `doc` and `pageNumber` are the
 * open PDF. Returns the analyzer's boxes when the PDF offers nothing
 * better.
 */
export async function pageOverlays(doc, pageNumber, analysis) {
  const references = (analysis?.references || []).filter(
    (r) => r.page != null && r.y != null
  );

  // Read before the annotations, which are matched against these: an
  // analyzed citation names the entry its marker means.
  const analyzed = (analysis?.citations || [])
    .filter((c) => c.page === pageNumber)
    .map((c) => ({
      referenceUuid: c.reference_uuid,
      label: c.label,
      x: c.x,
      y: c.y,
      w: c.w,
      h: c.h,
      exact: !c.inferred,
    }));

  let annotated = { citations: [], links: [] };
  try {
    annotated = await fromAnnotations(doc, pageNumber, references, analyzed);
  } catch {
    // A PDF with unreadable annotations still has the analyzer's boxes.
    annotated = { citations: [], links: [] };
  }

  const fromAnalyzer = consolidateCitations(analyzed);

  // A link names the float it goes to; the float is where it lands, as a
  // box the viewer brings into view. A section is where it begins: its
  // heading goes to the top of the window, as a PDF's own link would take it.
  const floats = new Map((analysis?.floats || []).map((float) => [float.uuid, float]));
  const analyzedLinks = (analysis?.links || [])
    .filter((link) => link.page === pageNumber && floats.has(link.float_uuid))
    .map((link) => {
      const float = floats.get(link.float_uuid);
      return {
        kind: float.kind,
        label: link.label,
        x: link.x,
        y: link.y,
        w: link.w,
        h: link.h,
        spot: float.kind === 'section'
          ? { page: float.page, y: float.y }
          : { page: float.page, y: float.y, box: { x: float.x, y: float.y, w: float.w, h: float.h } },
      };
    });

  // A single PDF link is sometimes emitted as several adjacent annotation
  // rectangles (one per text run). Treat those fragments the same way as
  // analyzer rows so the printed citation is one clickable target rather
  // than a row of tiny, independent buttons.
  // The analyzer's reading comes first: it knows a whole marker ("66–73",
  // "76,77", "Fig. 3b") where a publisher links only its first number. The
  // PDF's own links fill in where the analyzer found nothing.
  const fromPdf = consolidateCitations(annotated.citations);
  let citations = [...fromAnalyzer, ...fromPdf.filter((pdf) => !fromAnalyzer.some((known) => overlaps(known, pdf)))];
  if (references.length) {
    try {
      const inferred = await numberedCitations(doc, pageNumber, references);
      for (const candidate of inferred) {
        const covered = citations.filter((known) => overlaps(known, candidate));
        // PDFs commonly link only the two endpoint digits in "[1–7]".
        // Selectable text is the only place where the range itself survives,
        // so let that complete group replace those incomplete native boxes.
        if (candidate.referenceUuids.length > 1 && covered.length) {
          citations = citations.filter((known) => !overlaps(known, candidate));
          citations.push(candidate);
        } else if (!covered.length) {
          citations.push(candidate);
        }
      }
    } catch {
      // Selectable text is a fallback, never a reason to lose PDF-native or
      // GROBID-provided citation markers.
    }
  }

  const pdfLinks = annotated.links.filter((pdf) => ![...analyzedLinks, ...fromAnalyzer].some((known) => overlaps(known, pdf)));
  return {
    citations,
    links: [...analyzedLinks, ...pdfLinks],
  };
}

/** Numbered markers GROBID omitted, recovered from selectable PDF text. */
async function numberedCitations(doc, pageNumber, references) {
  const page = await doc.getPage(pageNumber);
  const viewport = page.getViewport({ scale: 1 });
  const content = await page.getTextContent();
  const found = [];
  const byNumber = new Map(references.map((ref) => [ref.index + 1, ref]));
  // Require a closing bracket. OCR fragments such as "[9," are too
  // ambiguous; GROBID can still supply them when its structural model is
  // confident, but this deliberately conservative fallback cannot.
  const marker = /\[\s*(\d{1,3}(?:(?:\s*[,;]\s*|\s*[–—-]\s*)\d{1,3})*)\s*\]/g;

  for (const item of content.items || []) {
    if (!item?.str || !Array.isArray(item.transform) || !item.str.includes('[')) continue;
    marker.lastIndex = 0;
    let match;
    while ((match = marker.exec(item.str))) {
      const ids = citationNumbers(match[1]);
      const targets = ids.map((n) => byNumber.get(n));
      if (!targets.length || targets.some((ref) => !ref)) continue;

      const transform = multiply(viewport.transform, item.transform);
      const height = Math.max(1, Math.hypot(transform[2], transform[3]));
      const fullWidth = Math.max(1, item.width * viewport.scale);
      const start = match.index / item.str.length;
      const share = match[0].length / item.str.length;
      const box = {
        x: (transform[4] + fullWidth * start) / viewport.width,
        y: (transform[5] - height) / viewport.height,
        w: Math.max(3, fullWidth * share) / viewport.width,
        h: height / viewport.height,
      };
      found.push({
        referenceUuid: targets[0].uuid,
        referenceUuids: targets.map((reference) => reference.uuid),
        label: match[0],
        ...box,
        exact: false,
      });
    }
  }
  return found;
}

/** Expand a printed numeric citation list, including inclusive ranges. */
export function citationNumbers(text) {
  const numbers = [];
  for (const part of String(text).split(/[,;]/)) {
    const range = part.trim().match(/^(\d{1,3})\s*[–—-]\s*(\d{1,3})$/);
    if (!range) {
      const value = Number(part.trim());
      if (Number.isInteger(value)) numbers.push(value);
      continue;
    }
    const start = Number(range[1]);
    const end = Number(range[2]);
    if (end < start || end - start > 100) continue;
    for (let value = start; value <= end; value += 1) numbers.push(value);
  }
  return [...new Set(numbers)];
}

/**
 * GROBID represents a marker which cites several works as one citation row
 * per work. For a printed range, most of those rows can have the very same
 * box (the collapsed middle numbers have no glyphs of their own), while the
 * range endpoints occupy touching boxes. Turn that physical marker back into
 * one target and retain every referenced work for the card's range controls.
 */
export function consolidateCitations(citations) {
  const ordered = [...citations].sort((a, b) => a.y - b.y || a.x - b.x);
  const groups = [];

  for (const citation of ordered) {
    const right = citation.x + citation.w;
    const group = groups.find((candidate) => {
      const sameLine = Math.abs(candidate.y - citation.y) <= Math.min(candidate.h, citation.h) * 0.35;
      const horizontalGap = Math.max(candidate.x, citation.x) - Math.min(candidate.x + candidate.w, right);
      return sameLine && horizontalGap <= 0.0005;
    });

    if (!group) {
      groups.push({
        ...citation,
        referenceUuids: [citation.referenceUuid],
      });
      continue;
    }

    const bottom = Math.max(group.y + group.h, citation.y + citation.h);
    const groupRight = Math.max(group.x + group.w, right);
    group.x = Math.min(group.x, citation.x);
    group.y = Math.min(group.y, citation.y);
    group.w = groupRight - group.x;
    group.h = bottom - group.y;
    group.exact = group.exact && citation.exact;
    if (!group.referenceUuids.includes(citation.referenceUuid)) {
      group.referenceUuids.push(citation.referenceUuid);
    }
  }

  return groups;
}

function multiply(a, b) {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}

function overlaps(a, b) {
  const left = Math.max(a.x, b.x);
  const top = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.w, b.x + b.w);
  const bottom = Math.min(a.y + a.h, b.y + b.h);
  return right > left && bottom > top;
}

/**
 * One walk over a page's link annotations, sorting each into what it is:
 * a citation of a reference, a place in the document, or somewhere on the
 * web.
 */
async function fromAnnotations(doc, pageNumber, references, analyzed = []) {
  const page = await doc.getPage(pageNumber);
  const annotations = await page.getAnnotations({ intent: 'display' });
  const links = annotations.filter(
    (a) => a.subtype === 'Link' && (a.url || a.dest)
  );
  if (!links.length) return { citations: [], links: [] };

  const viewport = page.getViewport({ scale: 1 });
  const citations = [];
  const elsewhere = [];

  for (const link of links) {
    const box = rectToFractions(link.rect, viewport);
    if (!box) continue;

    // With no analyzed references there is nothing to match the destination
    // against. A hyperref `cite.*` name already tells us this is a citation,
    // so make its card clickable immediately instead of resolving a trip to
    // the bibliography first. Large papers can have hundreds of these.
    if (!references.length && isNamedCitation(link.dest)) {
      citations.push(namedCitation(link.dest, box));
      continue;
    }

    // The analyzer read both the marker and the bibliography, so where it
    // has already labelled this very spot it knows which entry "[20]" means.
    // That is a reading of the document; a link destination is only a place
    // on a page, and a columned bibliography puts several entries at the
    // same height. Prefer the reading, and keep the PDF's own box, which is
    // the part these annotations are reliably good at.
    const labelled = analyzed.find(
      (candidate) => candidate.referenceUuid && overlaps(candidate, box)
    );
    if (labelled) {
      citations.push({
        referenceUuid: labelled.referenceUuid,
        label: labelled.label,
        ...box,
        exact: true,
      });
      continue;
    }

    const spot = link.dest ? await destinationSpot(doc, link.dest) : null;
    // A destination named after the entry's printed number says which entry
    // it is outright. Trust it only when it lands on the page that entry is
    // printed on, so a document whose "c12" means something else entirely
    // cannot quietly claim a reference.
    const numbered = numberedReference(references, link.dest, spot);
    if (numbered) {
      citations.push({ referenceUuid: numbered.uuid, label: null, ...box, exact: true });
      continue;
    }
    const reference = spot && references.length ? referenceAt(references, spot) : null;
    if (reference) {
      citations.push({ referenceUuid: reference.uuid, label: null, ...box, exact: true });
      continue;
    }
    // LaTeX/hyperref gives bibliography jumps stable names even before
    // Papol's reference analysis has finished (and even when no analyzer is
    // configured). Do not let those temporarily behave like ordinary
    // cross-references: clicking a citation should always open the reference
    // card, never whisk the user to the bibliography. The card can replace
    // this placeholder with analyzed details as soon as they arrive.
    if (isNamedCitation(link.dest)) {
      citations.push(namedCitation(link.dest, box));
      continue;
    }
    if (link.url) {
      const href = safeHref(link.url);
      if (href) elsewhere.push({ href, ...box });
      continue;
    }
    if (spot) elsewhere.push({ spot, ...box });
  }

  return { citations, links: elsewhere };
}

// Publishers name a bibliography destination after the entry's printed
// number: Elsevier writes "bib0020", REVTeX "c20", hyperref "cite.20". That
// number is the document's own answer about which entry is meant, and unlike
// a landing position it cannot be confused by a columned bibliography.
const NUMBERED_DEST = /^(?:bib|c|cite\.)0*(\d{1,3})$/i;

/** The printed entry number a destination names, when it names one. */
export function destinationNumber(dest) {
  const match = typeof dest === 'string' ? dest.match(NUMBERED_DEST) : null;
  return match ? Number(match[1]) : null;
}

/** The reference a numbered destination names, when it lands where it should. */
function numberedReference(references, dest, spot) {
  const number = destinationNumber(dest);
  if (!number) return null;
  const reference = references.find((candidate) => candidate.index === number - 1);
  if (!reference || !spot) return null;
  return reference.page === spot.page ? reference : null;
}

function citationDestinationKey(dest) {
  if (typeof dest !== 'string') return null;
  if (/^cite\./i.test(dest)) return dest.replace(/^cite\./i, '');
  // Elsevier's "bib0020" is a citation destination as much as "cite.20" is;
  // without this it would read as an ordinary jump to the bibliography.
  if (/^bib\d+$/i.test(dest)) return String(destinationNumber(dest));

  // Springer Nature PDFs exported from InDesign use the bibliography entry
  // itself as the destination name. Their in-text markers are bare
  // superscript numbers, so treating these as ordinary document links also
  // means selection cleanup cannot tell the citation number from prose.
  // Strip the invisible layout characters before recognizing the leading
  // bibliography number (for example, "...indd:\uFEFF1.\uFEFF\tRus, D. ...").
  const printable = dest.replace(/[\uFEFF\u200B-\u200D]/g, '');
  const springer = printable.match(/^springernature_.*\.indd:\s*(\d{1,3})\./i);
  return springer?.[1] || null;
}

function isNamedCitation(dest) {
  return citationDestinationKey(dest) != null;
}

function namedCitation(dest, box) {
  const key = citationDestinationKey(dest);
  return {
    referenceUuid: `pdf:${dest}`,
    label: null,
    reference: {
      uuid: `pdf:${dest}`,
      key,
      dest,
      raw: null,
      resolved_status: 'pending_analysis',
    },
    ...box,
    exact: true,
  };
}

/**
 * One page's text as printed lines, alongside every numbered entry it sets.
 *
 * The entry annotations are collected here because they are the only thing on the
 * page that says where its columns are: "[24]" at the head of an item, and
 * the x it was set at.
 */
async function printedLines(page) {
  const content = await page.getTextContent();
  const width = page.getViewport({ scale: 1 })?.width || 0;
  const lines = [];
  const printed = [];
  for (const item of content.items || []) {
    const y = item?.transform?.[5];
    const x = item?.transform?.[4];
    if (typeof y !== 'number' || typeof x !== 'number' || !item.str) continue;
    const entry = /^\s*\[(\d{1,3})\]/.exec(item.str);
    if (entry) printed.push({ number: Number(entry[1]), x, y });
    let line = lines.find((candidate) => Math.abs(candidate.y - y) < 1.5);
    if (!line) {
      line = { y, items: [] };
      lines.push(line);
    }
    line.items.push({ x, w: item.width || 0, text: item.str });
  }
  lines.sort((a, b) => b.y - a.y);
  return { lines, printed, width };
}

/**
 * Read the printed bibliography entry behind a named PDF citation.
 *
 * This is the no-server fallback used while reference analysis is absent.
 * Text is grouped into its printed lines, then collected from the entry the
 * destination names until the next entry begins.
 *
 * Which entry that is comes from the destination's *name* wherever it has
 * one, not from where it lands. A columned bibliography gives every y to two
 * entries at once, and a publisher is free to raise a destination well clear
 * of the line it points at — Elsevier's "bib0027" is set some twenty points
 * above entry [27], which is nearer entry [26] and nearer still to [19] in
 * the column alongside. Landing position cannot tell those apart. The number
 * printed on the page can, and the destination is carrying it.
 */
export async function readNamedReference(doc, dest) {
  if (!isNamedCitation(dest)) return null;
  const target = await doc.getDestination(dest);
  if (!Array.isArray(target) || !target.length) return null;
  const pageIndex = await doc.getPageIndex(target[0]);
  const page = await doc.getPage(pageIndex + 1);
  const targetY = destinationHeight(target);
  if (targetY == null) return null;

  const number = destinationNumber(dest);
  let { lines, printed, width } = await printedLines(page);
  let named = number == null
    ? null
    : printed.find((entry) => entry.number === number);
  // A destination set right at a page break points at the seam: Elsevier's
  // "bib0016" lands at the foot of page 9, and entry [16] is the first thing
  // printed on page 10. The number says which entry is meant, so follow it
  // over the fold rather than reading whatever the annotation happened to land on.
  if (number != null && !named && pageIndex + 2 <= (doc.numPages || 0)) {
    const overleaf = await printedLines(await doc.getPage(pageIndex + 2));
    const found = overleaf.printed.find((entry) => entry.number === number);
    if (found) {
      ({ lines, printed, width } = overleaf);
      named = found;
    }
  }

  // A bibliography is usually set in columns, and two entries side by side
  // share every y a line of either one has. Grouping by height alone splices
  // the neighbouring column's words into the entry being read. Keep only the
  // column the entry starts in — measured from where the page set its own
  // entry numbers, so a column runs to wherever the next one begins and no
  // further, and a single-column page keeps its full measure.
  const edges = [...new Set(printed.map((entry) => entry.x))].sort((a, b) => a - b);
  const columnFrom = (left) => {
    const next = edges.find((edge) => edge > left + width * COLUMN_SPLIT);
    if (edges.length) return { from: left - width * COLUMN_EDGE, to: next ?? Infinity };
    // Nothing numbered to read the columns off — an author-year
    // bibliography. Guess at how wide a column is, as this did before the
    // entries themselves could say.
    const gutter = width * COLUMN_GAP;
    return { from: left - gutter, to: left + gutter * 2 };
  };
  const leftOf = (line) => Math.min(...line.items.map((item) => item.x));
  const textOf = (line, column) => {
    const across = line.items
      .filter((item) => !column || (item.x >= column.from && item.x < column.to))
      .sort((a, b) => a.x - b.x);
    const kept = [];
    for (const item of across) {
      const previous = kept[kept.length - 1];
      if (previous && item.x - (previous.x + previous.w) > width * COLUMN_GUTTER) break;
      kept.push(item);
    }
    return kept.map((item) => item.text).join(' ').replace(/\s+/g, ' ').trim();
  };
  const marker = /^\s*(?:\[\d+\]|\d+\.)/;

  let start = named
    ? lines.findIndex((line) => Math.abs(line.y - named.y) < 1.5)
    : -1;
  let column = named ? columnFrom(named.x) : null;
  if (start < 0) {
    // An opaque destination such as hyperref's "cite.knuth74" names no
    // number, so its landing position is all there is. Take the column from
    // the destination's own x where it has one; /XYZ often carries it, and a
    // publisher that writes left=0 leaves this exactly as it was.
    const x = target[1]?.name === 'XYZ' && typeof target[2] === 'number' ? target[2] : 0;
    const anchored = x > 0
      ? [...edges].reverse().find((edge) => edge <= x + width * COLUMN_SPLIT)
      : null;
    const bandFor = (line) => columnFrom(anchored ?? leftOf(line));
    start = lines.findIndex(
      (line) => line.y <= targetY + 2 && marker.test(textOf(line, bandFor(line)))
    );
    // Author-year bibliographies have no [n] boundary. Their named hyperref
    // destination still sits immediately above the first line, so begin at
    // the first printed line below it and stop when another surname-led entry
    // begins. This is deliberately only the PDF-native fallback; analyzed
    // references continue to use GROBID's structure.
    if (start < 0) start = lines.findIndex((line) => line.y <= targetY + 2);
    if (start < 0) return null;
    column = bandFor(lines[start]);
  }

  const numbered = marker.test(textOf(lines[start], column));
  const gathered = [];
  for (let i = start; i < lines.length && gathered.length < 8; i += 1) {
    const text = textOf(lines[i], column);
    if (i > start && (
      (numbered && marker.test(text)) ||
      (!numbered && /^[A-ZÀ-ÖØ-Þ][\p{L}'’.-]+,\s+(?:[A-Z]\.|[A-Z][\p{L}'’.-]+)/u.test(text))
    )) break;
    if (text) gathered.push(text);
  }
  return gathered.join(' ').replace(numbered ? marker : /^$/, '').trim() || null;
}

/**
 * A URL from a PDF is untrusted input, and a link layer is a fine place to
 * hide something nasty. Only the schemes that mean "open this elsewhere"
 * are followed; anything that could run in this page is dropped.
 */
function safeHref(url) {
  try {
    // Absolute only. A relative URL in a PDF has no meaningful base — it
    // would resolve against Papol's own origin, which is never what the
    // author meant.
    const parsed = new URL(url);
    return ['http:', 'https:', 'mailto:'].includes(parsed.protocol) ? parsed.href : null;
  } catch {
    return null;
  }
}

/** Where a link's destination lands: { page, y } in top-left fractions. */
async function destinationSpot(doc, dest) {
  const target = typeof dest === 'string' ? await doc.getDestination(dest) : dest;
  if (!Array.isArray(target) || !target.length) return null;

  const index = await doc.getPageIndex(target[0]);
  const page = await doc.getPage(index + 1);
  const viewport = page.getViewport({ scale: 1 });

  // Destination arrays are shaped by their fit mode. /XYZ stores top at
  // index 3, while /FitH and /FitBH store it at index 2. A destination with
  // no y at all (/Fit) points at a page, not a line, and is no use for
  // telling references apart.
  const y = destinationHeight(target);
  if (y == null) return null;
  return { page: index + 1, y: (viewport.height - y) / viewport.height };
}

/** Which column each entry printed on this page sits in. */
export function columnsOnPage(references, page) {
  const printed = references
    .filter((reference) => reference.page === page && reference.y != null)
    .sort((a, b) => a.index - b.index);
  const column = new Map();
  let current = 0;
  let previous = null;
  for (const reference of printed) {
    if (previous != null && reference.y < previous - COLUMN_RESET) current += 1;
    column.set(reference, current);
    previous = reference.y;
  }
  return column;
}

export function referenceAt(references, spot) {
  const near = references.filter((reference) => {
    if (reference.page !== spot.page) return false;
    const drop = reference.y - spot.y; // positive: the entry is below the annotation
    return drop >= -ABOVE && drop <= BELOW;
  });

  // A destination says where to scroll to, not which column to read, and it
  // arrives without an x to say: Elsevier and REVTeX both write /XYZ with
  // left=0. So when entries from more than one column are in range, its y is
  // equally true of all of them and picking the closest is picking at random.
  // A confidently wrong reference is worse than none, because the user is
  // never told it was a guess. Leave it unmatched: the caller still opens a
  // card, and reads the entry the destination actually lands on.
  const column = columnsOnPage(references, spot.page);
  if (new Set(near.map((reference) => column.get(reference))).size > 1) return null;

  let best = null;
  for (const reference of near) {
    const drop = reference.y - spot.y;
    if (
      !best ||
      Math.abs(drop - EXPECTED_DROP) <
        Math.abs((best.y - spot.y) - EXPECTED_DROP)
    ) {
      best = reference;
    }
  }
  return best;
}

/** A PDF rect as fractions of the page from its top-left corner. */
function rectToFractions(rect, viewport) {
  if (!Array.isArray(rect) || rect.length !== 4) return null;
  // convertToViewportPoint puts the rect into the same top-left space the
  // page is drawn in, rotation included.
  const [x1, y1] = viewport.convertToViewportPoint(rect[0], rect[1]);
  const [x2, y2] = viewport.convertToViewportPoint(rect[2], rect[3]);
  const left = Math.min(x1, x2);
  const top = Math.min(y1, y2);
  const width = Math.abs(x2 - x1);
  const height = Math.abs(y2 - y1);
  if (!width || !height) return null;
  return {
    x: left / viewport.width,
    y: top / viewport.height,
    w: width / viewport.width,
    h: height / viewport.height,
  };
}
