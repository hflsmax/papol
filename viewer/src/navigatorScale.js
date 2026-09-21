/**
 * The Navigator's scale, read off the laid-out pages.
 *
 * The bar is drawn in document units — 0 at the top of page one, one unit
 * per page — and the scroller moves in pixels. These two functions are the
 * whole of the conversion, one in each direction, so the marker that follows
 * the reader and the press that moves them cannot disagree about where a
 * place is.
 *
 * pages: [{ top, height }], one per page, in reading order, in any one
 * vertical coordinate system. The line and the offset are in the same one.
 */

/**
 * The sheets as the scroller has them laid out now, measured down its own
 * content so a scroll offset can be read straight off them — the shape the
 * two conversions below take.
 */
export function laidOut(scroller) {
  const origin = scroller.getBoundingClientRect().top - scroller.scrollTop;
  return [...scroller.querySelectorAll('.pdf-page[data-page]')].map((sheet) => {
    const rect = sheet.getBoundingClientRect();
    return { top: rect.top - origin, height: rect.height };
  });
}

/** How far into the document a line falls, in document units. */
export function positionAtLine(pages, line) {
  let at = 0;
  for (let index = 0; index < (pages?.length || 0); index += 1) {
    const { top, height } = pages[index];
    // The gap between two sheets belongs to neither: a line in it has
    // finished the page above and not begun the one below.
    if (line < top) break;
    at = index + (height > 0 ? Math.min(1, (line - top) / height) : 0);
  }
  return at;
}

/** Where a place in the document sits, as an offset on the same axis. */
export function lineAtPosition(pages, at) {
  const count = pages?.length || 0;
  if (!count) return 0;
  const bounded = Math.max(0, Math.min(count, at));
  const index = Math.min(count - 1, Math.floor(bounded));
  const { top, height } = pages[index];
  return top + (bounded - index) * Math.max(0, height);
}

/**
 * Sections' lengths, evened out by one number.
 *
 * Drawn strictly to length, a paper is mostly its longest section: one
 * segment takes half the bar to say one name, and the six short sections
 * after it share what a thumb could cover. The width a long section has
 * beyond its name says nothing, and the width the short ones lack is
 * exactly what they need. So each length is raised to the power
 * (1 - evenness): 0 leaves the paper to scale, 1 gives every section the
 * same width, and between the two the long ones give way to the short
 * ones while longer still means wider — the order of the lengths is never
 * changed, only how far apart they stand. At a half, a section four times
 * as long is drawn twice as wide.
 */
export function evened(spans, evenness = 0) {
  const power = 1 - Math.max(0, Math.min(1, evenness));
  // Nothing long is still nothing at any power but the last, where every
  // section counts the same whatever its length.
  return (spans || []).map((span) => (power === 0 ? 1 : Math.max(0, span) ** power));
}

/**
 * How much of the bar each section gets: its share of the paper, except
 * that none gets less than `floor` (a fraction of the bar).
 *
 * A section two paragraphs long is a few pixels of a paper drawn strictly
 * to length — too little to read a name in or to aim at. So the short ones
 * are held to a minimum and the rest divide what is left in proportion to
 * their lengths, which keeps the long sections in their true ratios to one
 * another. Holding some back shrinks the others, which can push one of
 * those under the floor in its turn, so it is settled in rounds; and where
 * there are more sections than floors to go round, everyone gets an equal
 * share, which is the floor nobody can be given.
 */
export function shareOut(spans, floor = 0, fixed = null) {
  const count = spans?.length || 0;
  if (!count) return [];
  // Some sections are given a width outright (see Navigator: a bibliography
  // is pages long and one word to say). They take theirs first — never more
  // than half the bar between them — and the rest is shared as usual among
  // the others, whose floor is the same number of pixels of a smaller bar.
  if (fixed?.some((share) => share != null)) {
    const asked = fixed.reduce((sum, share) => sum + (share ?? 0), 0);
    const open = spans.filter((_, index) => fixed[index] == null);
    if (!open.length) return fixed.map((share) => share / asked);
    const given = Math.min(asked, 0.5);
    const rest = shareOut(open, floor / (1 - given));
    let next = 0;
    return spans.map((_, index) => {
      if (fixed[index] != null) return (fixed[index] / asked) * given;
      next += 1;
      return rest[next - 1] * (1 - given);
    });
  }
  const least = Math.max(0, Math.min(floor, 1 / count));
  const held = new Array(count).fill(false);
  for (;;) {
    const holding = held.filter(Boolean).length;
    const free = 1 - holding * least;
    const open = spans.reduce((sum, span, index) => (held[index] ? sum : sum + Math.max(0, span)), 0);
    const shareOf = (index) => (
      open > 0 ? (Math.max(0, spans[index]) / open) * free : free / (count - holding)
    );
    let changed = false;
    for (let index = 0; index < count; index += 1) {
      if (!held[index] && shareOf(index) < least - 1e-12) {
        held[index] = true;
        changed = true;
      }
    }
    if (!changed) return spans.map((_, index) => (held[index] ? least : shareOf(index)));
  }
}

/**
 * The bar's scale once the sections have been shared out: document units
 * to a fraction of the bar and back.
 *
 * edges: where each section begins, in document units, ascending, with the
 * end of the paper last — one more entry than there are shares. Within a
 * section the scale is even; between sections it changes pace. Everything
 * on the Navigator is placed through this one pair — segments, ticks,
 * marks, the marker, and a press — so stretching a short section moves all
 * of them together and a place on the bar is still one place in the paper.
 */
export function barScale(edges, shares) {
  const count = shares?.length || 0;
  const total = edges?.[count] ?? 0;
  if (!count || !(total > 0)) return { toBar: () => 0, toDoc: () => 0 };
  const starts = [0];
  for (let index = 0; index < count; index += 1) starts.push(starts[index] + shares[index]);
  // The last section that begins at or before a value, by either measure.
  const find = (list, value) => {
    let found = 0;
    for (let index = 0; index < count; index += 1) if (list[index] <= value) found = index;
    return found;
  };
  return {
    toBar(at) {
      const bounded = Math.max(0, Math.min(total, at));
      const index = find(edges, bounded);
      const span = edges[index + 1] - edges[index];
      const into = span > 0 ? Math.min(1, (bounded - edges[index]) / span) : 0;
      return starts[index] + into * shares[index];
    },
    toDoc(fraction) {
      const bounded = Math.max(0, Math.min(1, fraction));
      const index = find(starts, bounded);
      const share = shares[index];
      const into = share > 0 ? Math.min(1, (bounded - starts[index]) / share) : 0;
      return edges[index] + into * (edges[index + 1] - edges[index]);
    },
  };
}
