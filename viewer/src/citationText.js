const median = (values) => {
  if (!values.length) return 0;
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2
    ? ordered[middle]
    : (ordered[middle - 1] + ordered[middle]) / 2;
};

const heightOf = (box) => box.height ?? box.bottom - box.top;
const centreY = (box) => (box.top + box.bottom) / 2;

// Which citation overlay contains the middle of a character. PDF annotation
// boxes are sometimes a fraction of a pixel tighter than the text layer.
export function citationAt(box, citations, slack = 1) {
  const x = (box.left + box.right) / 2;
  const y = centreY(box);
  return citations.findIndex((citation) => (
    x >= citation.left - slack && x <= citation.right + slack
    && y >= citation.top - slack && y <= citation.bottom + slack
  ));
}

/**
 * Citation overlays whose text is genuinely superscripted.
 *
 * `characters` is in reading order and contains `{ box, citation }`, where
 * citation is the overlay index returned by citationAt (or -1). Merely being
 * a citation is deliberately insufficient: author-year citations are body
 * text and belong on the clipboard. A marker is omitted only when its glyphs
 * are both materially smaller and raised above nearby, same-line prose.
 */
export function superscriptCitationIndexes(characters, citations) {
  const superscript = new Set();

  citations.forEach((citation, index) => {
    const marked = characters.filter((character) => character.citation === index);
    if (!marked.length) return;

    const citationHeight = median(marked.map(({ box }) => heightOf(box)).filter(Boolean));
    const citationBottom = median(marked.map(({ box }) => box.bottom));
    const citationCentre = median(marked.map(({ box }) => centreY(box)));
    if (!citationHeight) return;

    // Look beside the marker, not merely before and after it in DOM order:
    // multi-column PDFs and wrapped citations can otherwise lend us a body
    // line from somewhere else on the page.
    const neighbours = characters
      .filter((character) => character.citation < 0)
      .map((character) => {
        const { box } = character;
        const height = heightOf(box);
        const horizontalGap = box.right < citation.left
          ? citation.left - box.right
          : box.left > citation.right
            ? box.left - citation.right
            : 0;
        return { box, height, horizontalGap, centreGap: Math.abs(centreY(box) - citationCentre) };
      })
      .filter(({ height, horizontalGap, centreGap }) => (
        height > 0
        && horizontalGap <= Math.max(48, height * 6)
        && centreGap <= Math.max(height, citationHeight) * 0.85
      ))
      .sort((a, b) => a.horizontalGap - b.horizontalGap || a.centreGap - b.centreGap)
      .slice(0, 16);

    if (!neighbours.length) return;
    const bodyHeight = median(neighbours.map(({ height }) => height));
    const bodyBottom = median(neighbours.map(({ box }) => box.bottom));

    const rise = bodyBottom - citationBottom;
    const smallerAndRaised = citationHeight <= bodyHeight * 0.86
      && rise >= bodyHeight * 0.12;
    // Some PDFs raise a full-size glyph instead of selecting a smaller font.
    // Demand a much clearer baseline shift in that case, so small annotation
    // box inaccuracies cannot turn an inline citation into a superscript.
    const fullSizeAndClearlyRaised = citationHeight <= bodyHeight * 1.05
      && rise >= bodyHeight * 0.28;
    if (smallerAndRaised || fullSizeAndClearlyRaised) superscript.add(index);
  });

  return superscript;
}
