// What the host's analyzer reads off a paper (host/analyzer/src/rules/), in the
// shapes the Worker stores: the reference list, the in-text markers that
// point at it, the cross-references to figures, tables and boxes, and the
// title block. The analyzer imports these types too, so the two can never
// disagree about them.

export interface Reference {
  key: string; // the entry's id, e.g. "b11" — what markers target
  index: number; // position in the list, 0-based
  raw: string | null; // the reference exactly as printed, for matching
  title: string | null;
  authors: string[];
  year: number | null;
  journal: string | null;
  doi: string | null;
  arxiv_id: string | null;
  // Where the entry itself is printed, so a PDF's own citation links —
  // which point at a place, not at an id — can be matched to it.
  page: number | null;
  y: number | null;
}

export interface Box { page: number; x: number; y: number; w: number; h: number }

// One marker in the text, whole: every work it names and every piece of
// the page it is printed on. "[3–5]" names three works in one box;
// "Matsuda et al. 2007" broken over a line is one work in two boxes. Either
// way it is one thing to point at, and it arrives as one.
export interface Citation {
  keys: string[]; // the references it points at, in the order printed
  label: string; // what is printed, e.g. "[13]"
  // True when the analyzer found the marker but could not say which entry
  // it meant, and Papol read the number instead: a guess.
  inferred: boolean;
  boxes: Box[]; // one a printed line, in reading order
}

// A figure, table or box, where a link to it lands: its caption.
export interface Float extends Box {
  key: string; // what links name it by
  kind: string; // figure, table, box, algorithm, listing
  label: string; // its number, as printed
}

// A place in the text that points at a float.
export interface DocumentLink extends Box {
  float: string; // the float's key
  label: string; // what is printed, e.g. "2a"
}

export interface Analysis { references: Reference[]; citations: Citation[]; floats: Float[]; links: DocumentLink[] }

// The format of the analysis above, which a Worker asks POST /analyze for
// and the analyzer states in its answer. Format 2 is citations as whole
// markers; an analyzer that states no format predates it.
export const ANALYSIS_FORMAT = 2;

export interface HeaderMetadata {
  title: string | null;
  authors: string[];
  journal: string | null;
  year: number | null;
  // What the first pages print: how the upload is looked up in the indexes.
  doi: string | null;
  arxiv_id: string | null;
}

const SMALL_WORDS = new Set(["a", "an", "and", "as", "at", "but", "by", "for", "from", "in", "into", "nor", "of", "on", "or", "over", "per", "the", "to", "via", "with", "without", "yet"]);

// Undo display-only all-caps styling in a header title. Mixed-case titles
// pass through untouched; an all-caps heading takes ordinary title casing
// while short acronyms stay, and a leading X-name (XGrammar, XLA) keeps
// its X as a prefix.
export function normalizeTitle(title: string | null): string | null {
  if (!title) return title;
  const letters = title.replace(/[^A-Za-z]/g, "");
  if (!letters || letters !== letters.toUpperCase()) return title;
  const parts = title.match(/[A-Za-z]+|[^A-Za-z]+/g) ?? [];
  const wordIndexes = parts.map((p, i) => (/^[A-Za-z]+$/.test(p) ? i : -1)).filter((i) => i >= 0);
  const first = wordIndexes[0], last = wordIndexes[wordIndexes.length - 1];
  let afterColon = false;
  parts.forEach((part, index) => {
    if (!/^[A-Za-z]+$/.test(part)) {
      if (part.includes(":")) afterColon = true;
      return;
    }
    const lower = part.toLowerCase();
    if (SMALL_WORDS.has(lower) && index !== first && index !== last && !afterColon) parts[index] = lower;
    else if (part.length <= 4 && !SMALL_WORDS.has(lower)) parts[index] = part;
    else if (index === first && part.startsWith("X") && part.length > 5) parts[index] = "X" + lower[1].toUpperCase() + lower.slice(2);
    else parts[index] = lower[0].toUpperCase() + lower.slice(1);
    afterColon = false;
  });
  return parts.join("");
}
