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
// hyperref raises a destination slightly above the bibliography line so a
// jump does not pin the text flush to the window edge. Matching the nearest
// line mistakes a tightly spaced next entry for the preceding one. This is
// the typical raised-link distance on a letter-sized page (about 5.5pt).
const EXPECTED_DROP = 0.007;

/**
 * Citation boxes for one page, in fractions of the page from its
 * top-left corner: [{ referenceId, label, x, y, w, h, exact }].
 *
 * `analysis` is what the backend returned; `doc` and `pageNumber` are the
 * open PDF. Returns the analyzer's boxes when the PDF offers nothing
 * better.
 */
export async function pageOverlays(doc, pageNumber, analysis) {
  const references = (analysis?.references || []).filter(
    (r) => r.page != null && r.y != null
  );

  let annotated = { citations: [], links: [] };
  try {
    annotated = await fromAnnotations(doc, pageNumber, references);
  } catch {
    // A PDF with unreadable annotations still has the analyzer's boxes.
    annotated = { citations: [], links: [] };
  }

  const fromAnalyzer = (analysis?.citations || [])
    .filter((c) => c.page === pageNumber)
    .map((c) => ({
      referenceId: c.reference_id,
      label: c.label,
      x: c.x,
      y: c.y,
      w: c.w,
      h: c.h,
      exact: !c.inferred,
    }));

  let citations = annotated.citations.length ? annotated.citations : fromAnalyzer;
  if (references.length) {
    try {
      const inferred = await numberedCitations(doc, pageNumber, references);
      citations = [...citations, ...inferred.filter(
        (candidate) => !citations.some((known) => overlaps(known, candidate))
      )];
    } catch {
      // Selectable text is a fallback, never a reason to lose PDF-native or
      // GROBID-provided citation markers.
    }
  }

  return {
    citations,
    links: annotated.links,
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
  const marker = /\[\s*(\d{1,3}(?:\s*[,;]\s*\d{1,3})*)\s*\]/g;

  for (const item of content.items || []) {
    if (!item?.str || !Array.isArray(item.transform) || !item.str.includes('[')) continue;
    marker.lastIndex = 0;
    let match;
    while ((match = marker.exec(item.str))) {
      const ids = match[1].split(/[,;]/).map((part) => Number(part.trim()));
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
      for (const reference of targets) {
        found.push({
          referenceId: reference.id,
          label: match[0],
          ...box,
          exact: false,
        });
      }
    }
  }
  return found;
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
async function fromAnnotations(doc, pageNumber, references) {
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

    const spot = link.dest ? await destinationSpot(doc, link.dest) : null;
    const reference = spot && references.length ? referenceAt(references, spot) : null;
    if (reference) {
      citations.push({ referenceId: reference.id, label: null, ...box, exact: true });
      continue;
    }
    // LaTeX/hyperref gives bibliography jumps stable names even before
    // Papol's reference analysis has finished (and even when no analyzer is
    // configured). Do not let those temporarily behave like ordinary
    // cross-references: clicking a citation should always open the reference
    // card, never whisk the reader to the bibliography. The card can replace
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

function isNamedCitation(dest) {
  return typeof dest === 'string' && /^cite\./i.test(dest);
}

function namedCitation(dest, box) {
  const key = String(dest).replace(/^cite\./i, '');
  return {
    referenceId: `pdf:${dest}`,
    label: null,
    reference: {
      id: `pdf:${dest}`,
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
 * Read the printed bibliography entry behind a named PDF citation.
 *
 * This is the no-server fallback used while reference analysis is absent.
 * Hyperref destinations sit just above an entry; text is grouped into its
 * printed lines, then collected from the first numbered entry below that
 * destination until the next entry begins.
 */
export async function readNamedReference(doc, dest) {
  if (!isNamedCitation(dest)) return null;
  const target = await doc.getDestination(dest);
  if (!Array.isArray(target) || !target.length) return null;
  const pageIndex = await doc.getPageIndex(target[0]);
  const page = await doc.getPage(pageIndex + 1);
  const targetY = destinationY(target);
  if (targetY == null) return null;

  const content = await page.getTextContent();
  const lines = [];
  for (const item of content.items || []) {
    const y = item?.transform?.[5];
    const x = item?.transform?.[4];
    if (typeof y !== 'number' || typeof x !== 'number' || !item.str) continue;
    let line = lines.find((candidate) => Math.abs(candidate.y - y) < 1.5);
    if (!line) {
      line = { y, items: [] };
      lines.push(line);
    }
    line.items.push({ x, text: item.str });
  }
  lines.sort((a, b) => b.y - a.y);
  const textOf = (line) => line.items.sort((a, b) => a.x - b.x)
    .map((item) => item.text).join(' ').replace(/\s+/g, ' ').trim();
  const marker = /^\s*\[\d+\]/;
  let start = lines.findIndex((line) => line.y <= targetY + 2 && marker.test(textOf(line)));
  const numbered = start >= 0;
  // Author-year bibliographies have no [n] boundary. Their named hyperref
  // destination still sits immediately above the first line, so begin at
  // the first printed line below it and stop when another surname-led entry
  // begins. This is deliberately only the PDF-native fallback; analyzed
  // references continue to use GROBID's structure.
  if (!numbered) start = lines.findIndex((line) => line.y <= targetY + 2);
  if (start < 0) return null;

  const gathered = [];
  for (let i = start; i < lines.length && gathered.length < 8; i += 1) {
    const text = textOf(lines[i]);
    if (i > start && (
      (numbered && marker.test(text)) ||
      (!numbered && /^[A-ZÀ-ÖØ-Þ][\p{L}'’.-]+,\s+(?:[A-Z]\.|[A-Z][\p{L}'’.-]+)/u.test(text))
    )) break;
    if (text) gathered.push(text);
  }
  return gathered.join(' ').replace(numbered ? marker : /^$/, '').trim() || null;
}

export function destinationY(target) {
  const kind = target[1]?.name;
  if (kind === 'XYZ') return typeof target[3] === 'number' ? target[3] : null;
  if (kind === 'FitH' || kind === 'FitBH') {
    return typeof target[2] === 'number' ? target[2] : null;
  }
  return null;
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
  const y = destinationY(target);
  if (y == null) return null;
  return { page: index + 1, y: (viewport.height - y) / viewport.height };
}

export function referenceAt(references, spot) {
  let best = null;
  for (const reference of references) {
    if (reference.page !== spot.page) continue;
    const drop = reference.y - spot.y; // positive: the entry is below the mark
    if (drop < -ABOVE || drop > BELOW) continue;
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
