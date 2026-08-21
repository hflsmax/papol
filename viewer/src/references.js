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

  return {
    citations: annotated.citations.length ? annotated.citations : fromAnalyzer,
    links: annotated.links,
  };
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

    const spot = link.dest ? await destinationSpot(doc, link.dest) : null;
    const reference = spot && references.length ? referenceAt(references, spot) : null;
    if (reference) {
      citations.push({ referenceId: reference.id, label: null, ...box, exact: true });
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

  // An explicit destination is [ref, {name}, left, top, zoom] for /XYZ and
  // similar; the y is in PDF user space, measured from the bottom. A
  // destination with no y at all (/Fit) points at a page, not a line, and
  // is no use for telling references apart.
  const y = target[3];
  if (typeof y !== 'number') return null;
  return { page: index + 1, y: (viewport.height - y) / viewport.height };
}

function referenceAt(references, spot) {
  let best = null;
  for (const reference of references) {
    if (reference.page !== spot.page) continue;
    const drop = reference.y - spot.y; // positive: the entry is below the mark
    if (drop < -ABOVE || drop > BELOW) continue;
    if (!best || Math.abs(drop) < Math.abs(best.y - spot.y)) best = reference;
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
