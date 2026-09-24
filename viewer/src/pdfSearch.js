// Search is pdf.js's own: its PDFFindController, the find engine of the
// pdf.js viewer. It knows what a reader means by a phrase better than a
// lowercase indexOf ever did — a word broken by a hyphen at the end of a
// line is one word, "naive" finds "naïve", curly quotes match straight
// ones, CJK runs on across a line break — and it improves each time
// pdf.js does.
//
// The controller was written for the pdf.js viewer's find bar: it expects a
// link service to tell it the current page and an event bus to report on.
// Papol keeps its own find bar and asks only for every match on every page,
// the way the viewer's highlighter does: `updatetextlayermatches` names a
// page whose matches are ready, and `pageMatches` / `pageMatchesLength` hold
// them as offsets into that page's raw text.

// Where each text item sits in the text the controller's offsets count: the
// items' raw strings run together. It searches with a newline at each line
// end, but reports offsets without them, as pdf.js's own highlighter reads
// them. Only an item with text gets a span in the text layer, so only those
// are counted in spanIndex.
export function itemLayout(items) {
  const layout = [];
  let at = 0;
  let spanIndex = 0;
  for (const item of items) {
    if (typeof item?.str !== 'string' || !item.str) continue;
    layout.push({ start: at, str: item.str, spanIndex: spanIndex++ });
    at += item.str.length;
  }
  return layout;
}

// A match, as offsets into the raw text, as the spans it covers. The spans
// hold the text as pdf.js normalizes it for reading ("ﬁ" becomes "fi"), so
// an offset inside a span is the length of the normalized text before it.
export function matchParts(layout, start, length, normalize = (s) => s) {
  const end = start + length;
  const parts = [];
  for (const entry of layout) {
    const entryEnd = entry.start + entry.str.length;
    if (entryEnd <= start) continue;
    if (entry.start >= end) break;
    const from = Math.max(start, entry.start) - entry.start;
    const to = Math.min(end, entryEnd) - entry.start;
    parts.push({
      spanIndex: entry.spanIndex,
      start: normalize(entry.str.slice(0, from)).length,
      end: normalize(entry.str.slice(0, to)).length,
    });
  }
  return parts;
}

// A finder for one document. `find` resolves to each page's matches, as
// arrays of { parts }, or to null when a newer search overtook it. The
// first search reads every page's text, as the controller does; later ones
// reuse it.
export function createPdfFinder(doc, { EventBus, PDFFindController, normalizeUnicode }) {
  const eventBus = new EventBus();
  const controller = new PDFFindController({
    linkService: { pagesCount: doc.numPages, page: 1 },
    eventBus,
    // The controller waits this long after a keystroke before searching;
    // Papol's input already settles the query.
    delay: 0,
  });
  controller.setDocument(doc);

  let pending = null;
  eventBus.on('updatetextlayermatches', ({ pageIndex }) => {
    if (!pending) return;
    // -1 is every page at once: matches were cleared for a new search.
    if (pageIndex < 0) {
      pending.reported.clear();
      return;
    }
    pending.reported.add(pageIndex);
    if (pending.reported.size === doc.numPages) {
      const done = pending;
      pending = null;
      done.resolve(true);
    }
  });

  // The raw items behind a page's matches, read again only for a page that
  // has any: the controller keeps its text to itself.
  const layouts = new Map();
  const layoutOf = (pageIndex) => {
    if (!layouts.has(pageIndex)) {
      layouts.set(pageIndex, doc.getPage(pageIndex + 1)
        .then((page) => page.getTextContent({ disableNormalization: true }))
        .then((content) => itemLayout(content.items)));
    }
    return layouts.get(pageIndex);
  };

  return {
    // Whether the text has been read: a search from here on is quick.
    warm: false,
    async find(query) {
      pending?.resolve(false);
      const ready = new Promise((resolve) => { pending = { reported: new Set(), resolve }; });
      eventBus.dispatch('find', {
        source: null,
        type: '',
        query,
        caseSensitive: false,
        entireWord: false,
        highlightAll: true,
        findPrevious: false,
        matchDiacritics: false,
      });
      if (!await ready) return null;
      this.warm = true;
      // Copied now: the next search rewrites these in place.
      const starts = controller.pageMatches.map((page) => page?.slice() || []);
      const lengths = controller.pageMatchesLength.map((page) => page?.slice() || []);
      return Promise.all(starts.map(async (pageStarts, pageIndex) => {
        if (!pageStarts.length) return [];
        const layout = await layoutOf(pageIndex);
        return pageStarts.map((start, i) => ({
          parts: matchParts(layout, start, lengths[pageIndex][i], normalizeUnicode),
        }));
      }));
    },
    destroy() {
      pending?.resolve(false);
      pending = null;
      controller.setDocument(null);
    },
  };
}
