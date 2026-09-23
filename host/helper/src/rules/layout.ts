// Runs into lines, lines into reading order, and a page's text into one
// string whose every character still knows where it was printed.
//
// Everything a rule matches is matched against that string (the page's
// flow), and every match is turned back into boxes on the page through it.
// That is what lets a rule be a pattern over text while its answer stays a
// place on a page.

import type { Doc, Drawn, Page, Run } from "./pdf";

export interface Placed extends Run {
  sup: boolean; // raised and smaller than its line: a superscript
  sub: boolean;
}

export interface Line {
  page: number;
  index: number; // in reading order, within its page
  runs: Placed[];
  text: string;
  // Where each character of `text` came from: the run, and the character
  // within it. Spaces put between runs point at no run (-1).
  chars: { run: number; at: number }[];
  x0: number;
  x1: number;
  top: number;
  bottom: number;
  baseline: number;
  size: number; // the line's main font size, superscripts aside
  bold: boolean; // every letter of it is bold
  column: string; // the region of the page it was read in (see xyCut)
  furniture: boolean; // a running head, a footer, a page number
}

export interface Box { page: number; x: number; y: number; w: number; h: number }

export interface Layout {
  pages: { number: number; width: number; height: number; lines: Line[]; drawn: Drawn[]; twoColumn: boolean }[];
  bodySize: number;
}

// Two runs are on one line when their baselines are this close, in their
// font size.
const SAME_LINE = 0.3;
// Blank space this wide on one line, in font sizes, is a gutter between
// columns, not a space between words.
const GUTTER = 1.4;
// A run this much smaller than the line beside it, and raised or lowered
// within this band of that line's size, is a superscript or a subscript.
const SCRIPT_SIZE = 0.86;
const RAISED = [0.12, 0.8] as const;
const LOWERED = [0.08, 0.5] as const;
// Space between two runs this wide, in font sizes, is a word space.
const WORD_SPACE = 0.12;
// The page margin running heads and footers sit in, as a fraction of its
// height, and on how many pages the same text has to recur there.
const MARGIN = 0.09;
const RECURS = 3;

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

// The size most of the words are set in, weighted by characters.
function bodySizeOf(doc: Doc): number {
  const counts = new Map<number, number>();
  for (const page of doc.pages) for (const run of page.runs) {
    const size = Math.round(run.size * 2) / 2;
    counts.set(size, (counts.get(size) ?? 0) + run.text.length);
  }
  let best = 10, most = -1;
  for (const [size, count] of counts) if (count > most) { best = size; most = count; }
  return best;
}

// Whether blank space between two runs on one baseline is a gutter between
// columns: the lines just above and below leave the same space blank, and
// have text on both sides of it.
function isGutter(runs: Placed[], left: number, right: number, baseline: number, size: number): boolean {
  let crossing = 0, before = 0, after = 0;
  for (const r of runs) {
    if (Math.abs(r.baseline - baseline) < SAME_LINE * size || Math.abs(r.baseline - baseline) > 5 * size) continue;
    if (r.x < right - 1 && r.x + r.width > left + 1) crossing += 1;
    else if (r.x + r.width <= left + 1) before += 1;
    else after += 1;
  }
  return crossing === 0 && before >= 2 && after >= 2;
}

// Whether the blank on a baseline between two runs is taken by a script
// raised or lowered off it: "enables⁵⁻⁸, or" is one line with a
// superscript in it, not two lines either side of a gap.
function scriptFills(runs: Placed[], left: number, right: number, baseline: number, size: number): boolean {
  const scripts = runs.filter((r) => {
    if (r.size > SCRIPT_SIZE * size || r.x < left - 1 || r.x + r.width > right + 1) return false;
    const lift = (baseline - r.baseline) / size;
    return (lift >= RAISED[0] && lift <= RAISED[1]) || (-lift >= LOWERED[0] && -lift <= LOWERED[1]);
  });
  if (!scripts.length) return false;
  // The script has to sit against the text on its left, and leave no more
  // than a word space before the text on its right: a gutter with a
  // superscript at its edge is still a gutter.
  const from = Math.min(...scripts.map((r) => r.x)), to = Math.max(...scripts.map((r) => r.x + r.width));
  return from - left <= 0.5 * size && right - to <= 0.8 * size;
}

export function buildLines(page: Page): Placed[][] {
  const runs: Placed[] = page.runs.map((run) => ({ ...run, sup: false, sub: false }));
  runs.sort((a, b) => a.baseline - b.baseline || a.x - b.x);
  // First every run on one baseline together, then each baseline cut
  // left to right wherever a gutter or a gap too wide for a word space
  // separates its runs. Grouping in two steps keeps the answer from
  // depending on which of two runs a hair apart in height came first.
  const clusters: Placed[][] = [];
  for (const run of runs) {
    const current = clusters[clusters.length - 1];
    const anchor = current?.[0];
    if (anchor && Math.abs(anchor.baseline - run.baseline) <= SAME_LINE * Math.min(anchor.size, run.size)
      && Math.abs(run.size - anchor.size) <= 0.25 * anchor.size) current.push(run);
    else clusters.push([run]);
  }
  const groups: { runs: Placed[] }[] = [];
  for (const cluster of clusters) {
    cluster.sort((a, b) => a.x - b.x);
    let line: Placed[] = [];
    for (const run of cluster) {
      const last = line[line.length - 1];
      if (last) {
        const size = Math.max(last.size, run.size);
        const gap = run.x - (last.x + last.width);
        const bridged = gap > GUTTER * size && scriptFills(runs, last.x + last.width, run.x, run.baseline, size);
        // Text that changes size across more than a word space, on the
        // same baseline (a superscript is raised), is two lines side by
        // side: a caption level with the column beside it.
        const resized = Math.abs(run.size - last.size) > 0.03 * size && gap > 0.5 * Math.min(run.size, last.size)
          && Math.abs(run.baseline - last.baseline) < 0.1 * Math.min(run.size, last.size);
        const split = (gap > GUTTER * size && !bridged)
          || (gap > 0.5 * size && !bridged && isGutter(runs, last.x + last.width, run.x, run.baseline, size))
          || (resized && !scriptFills(runs, last.x + last.width, run.x, run.baseline, size));
        if (split) { groups.push({ runs: line }); line = []; }
      }
      line.push(run);
    }
    if (line.length) groups.push({ runs: line });
  }
  // Scripts: a small line raised or lowered against a bigger one it
  // touches is part of that line.
  const lines = groups.map((g) => g.runs);
  const merged = new Set<number>();
  lines.forEach((small, i) => {
    const size = Math.max(...small.map((r) => r.size));
    const chars = small.reduce((n, r) => n + r.text.length, 0);
    if (chars > 16) return;
    const x0 = Math.min(...small.map((r) => r.x)), x1 = Math.max(...small.map((r) => r.x + r.width));
    const base = median(small.map((r) => r.baseline));
    let best = -1, bestGap = Infinity, raised = false;
    lines.forEach((big, j) => {
      if (j === i || merged.has(j)) return;
      const bigSize = median(big.map((r) => r.size));
      if (size > SCRIPT_SIZE * bigSize) return;
      const bigBase = median(big.map((r) => r.baseline));
      const lift = (bigBase - base) / bigSize;
      const up = lift >= RAISED[0] && lift <= RAISED[1];
      const down = -lift >= LOWERED[0] && -lift <= LOWERED[1];
      if (!up && !down) return;
      // Touching: within a word space or so of one of the big line's runs.
      const gap = Math.min(...big.map((r) => Math.max(0, x0 - (r.x + r.width), r.x - x1)));
      if (gap > 0.6 * bigSize) return;
      if (gap < bestGap) { best = j; bestGap = gap; raised = up; }
    });
    if (best < 0) return;
    for (const r of small) { r.sup = raised; r.sub = !raised; }
    lines[best].push(...small);
    merged.add(i);
  });
  const kept = lines.filter((_, i) => !merged.has(i)).map((l) => l.sort((a, b) => a.x - b.x));
  return joinLabels(kept);
}

// A list's labels are often set in a column of their own: "2" at the left
// margin and the entry's text a gutter to its right, on one baseline. A
// line that is only such a label joins the text beside it.
const LABEL = /^\s*(?:\[?\d{1,4}[.\])]?|[•∙·▪◦–-]|\([a-z0-9]{1,3}\))\s*$/;
function joinLabels(lines: Placed[][]): Placed[][] {
  const gone = new Set<number>();
  lines.forEach((label, i) => {
    const text = label.map((r) => r.text).join("");
    if (!LABEL.test(text)) return;
    const size = median(label.map((r) => r.size));
    const base = median(label.map((r) => r.baseline));
    const x1 = Math.max(...label.map((r) => r.x + r.width));
    let best = -1, bestGap = Infinity;
    lines.forEach((other, j) => {
      if (j === i || gone.has(j)) return;
      const otherBase = median(other.map((r) => r.baseline));
      if (Math.abs(otherBase - base) > SAME_LINE * size) return;
      const gap = Math.min(...other.map((r) => r.x)) - x1;
      if (gap >= 0 && gap <= 6 * size && gap < bestGap) { best = j; bestGap = gap; }
    });
    if (best < 0) return;
    lines[best].unshift(...label);
    gone.add(i);
  });
  return lines.filter((_, i) => !gone.has(i));
}

function lineOf(runs: Placed[], page: number): Line {
  const main = runs.filter((r) => !r.sup && !r.sub);
  const body = main.length ? main : runs;
  const size = median(body.map((r) => r.size));
  const baseline = median(body.map((r) => r.baseline));
  let text = "";
  const chars: Line["chars"] = [];
  runs.forEach((run, index) => {
    if (index > 0) {
      const prev = runs[index - 1];
      const gap = run.x - (prev.x + prev.width);
      const joined = text.endsWith(" ") || run.text.startsWith(" ");
      // A script sits against the word it belongs to, whatever the gap.
      const afterScript = prev.sup || prev.sub;
      if (!joined && gap > WORD_SPACE * size && !(run.sup || run.sub) && !(afterScript && gap < 0.3 * size)) {
        text += " ";
        chars.push({ run: -1, at: 0 });
      }
    }
    for (let at = 0; at < run.text.length; at += 1) {
      text += run.text[at];
      chars.push({ run: index, at });
    }
  });
  const letters = body.filter((r) => /\p{L}/u.test(r.text));
  return {
    page, index: 0, runs, text, chars,
    x0: Math.min(...runs.map((r) => r.x)),
    x1: Math.max(...runs.map((r) => r.x + r.width)),
    top: Math.min(...runs.map((r) => r.baseline - r.size * 0.8)),
    bottom: Math.max(...runs.map((r) => r.baseline + r.size * 0.22)),
    baseline, size,
    bold: letters.length > 0 && letters.every((r) => r.bold),
    column: "",
    furniture: false,
  };
}

// Reading order by recursive XY-cut: a region of the page is split at its
// widest blank vertical strip (columns, read left to right) if it has one,
// else at its widest blank horizontal band (read top to bottom), and each
// part is ordered the same way. A band must be wider than the space between
// lines, or two columns whose lines happen to align would be cut into rows.
// Each final region is a column, whatever the page's layout: two columns
// under a full-width title, a bibliography in three, a sidebar.
function xyCut(lines: Line[], bodySize: number, path: string, out: { lines: Line[]; regions: number; vertical: boolean }): void {
  if (lines.length <= 1) {
    for (const l of lines) l.column = path;
    out.lines.push(...lines);
    return;
  }
  const gapIn = (spans: [number, number][], minimum: number): [number, number] | null => {
    spans.sort((a, b) => a[0] - b[0]);
    let reach = spans[0][1], best: [number, number] | null = null;
    for (const [from, to] of spans.slice(1)) {
      if (from - reach >= minimum && (!best || from - reach > best[1] - best[0])) best = [reach, from];
      reach = Math.max(reach, to);
    }
    return best;
  };
  const vertical = gapIn(lines.map((l) => [l.x0, l.x1]), 0.8 * bodySize);
  if (vertical) {
    const cut = (vertical[0] + vertical[1]) / 2;
    const left = lines.filter((l) => l.x1 <= cut), right = lines.filter((l) => l.x0 >= cut);
    out.vertical = true;
    xyCut(left, bodySize, `${path}.0`, out);
    xyCut(right, bodySize, `${path}.1`, out);
    return;
  }
  const horizontal = gapIn(lines.map((l) => [l.top, l.bottom]), 0.9 * bodySize);
  if (horizontal) {
    const cut = (horizontal[0] + horizontal[1]) / 2;
    xyCut(lines.filter((l) => l.bottom <= cut), bodySize, `${path}.0`, out);
    xyCut(lines.filter((l) => l.top >= cut), bodySize, `${path}.1`, out);
    return;
  }
  const sorted = [...lines].sort((a, b) => a.top - b.top || a.x0 - b.x0);
  // No clean cut: often a line across the whole region (a wide caption, a
  // title) set too close to what is under it to leave a band. Set the wide
  // lines apart and cut the bands between them on their own.
  const left = Math.min(...lines.map((l) => l.x0)), right = Math.max(...lines.map((l) => l.x1));
  const wide = (l: Line) => l.x1 - l.x0 > 0.6 * (right - left);
  const narrow = sorted.filter((l) => !wide(l));
  if (narrow.length && narrow.length < sorted.length && gapIn(narrow.map((l) => [l.x0, l.x1]), 0.8 * bodySize)) {
    let band: Line[] = [], n = 0;
    const flush = () => { if (band.length) xyCut(band, bodySize, `${path}.b${n++}`, out); band = []; };
    for (const l of sorted) {
      if (wide(l)) { flush(); l.column = `${path}.w`; out.lines.push(l); } else band.push(l);
    }
    flush();
    return;
  }
  for (const l of sorted) l.column = path;
  out.lines.push(...sorted);
}

function readingOrder(lines: Line[], bodySize: number): { lines: Line[]; twoColumn: boolean } {
  // Page furniture is read last and cut apart from nothing.
  const content = lines.filter((l) => !l.furniture);
  const out = { lines: [] as Line[], regions: 0, vertical: false };
  xyCut(content, bodySize, "r", out);
  const furniture = lines.filter((l) => l.furniture).sort((a, b) => a.top - b.top);
  for (const l of furniture) l.column = "furniture";
  return { lines: [...out.lines, ...furniture], twoColumn: out.vertical };
}

const shape = (text: string) => text.replace(/\d+/g, "#").replace(/\s+/g, " ").trim().toLowerCase();

function markFurniture(pages: Layout["pages"]): void {
  const seen = new Map<string, number>();
  const marginal = (line: Line, height: number) => line.top < height * MARGIN || line.bottom > height * (1 - MARGIN);
  for (const page of pages) {
    const shapes = new Set(page.lines.filter((l) => marginal(l, page.height)).map((l) => shape(l.text)));
    for (const s of shapes) seen.set(s, (seen.get(s) ?? 0) + 1);
  }
  const recurring = Math.min(RECURS, Math.max(2, Math.ceil(pages.length / 3)));
  for (const page of pages) for (const line of page.lines) {
    if (!marginal(line, page.height)) continue;
    const s = shape(line.text);
    if ((seen.get(s) ?? 0) >= recurring || /^[#ivxlc.\s-]+$/i.test(s)) line.furniture = true;
  }
}

export function layout(doc: Doc): Layout {
  const bodySize = bodySizeOf(doc);
  const pages = doc.pages.map((page) => ({
    number: page.number, width: page.width, height: page.height, twoColumn: false, drawn: page.drawn,
    lines: buildLines(page).map((runs) => lineOf(runs, page.number)),
  }));
  markFurniture(pages);
  for (const page of pages) {
    const ordered = readingOrder(page.lines, bodySize);
    page.lines = ordered.lines;
    page.twoColumn = ordered.twoColumn;
    page.lines.forEach((line, index) => { line.index = index; });
  }
  return { pages, bodySize };
}

// ------------------------------------------------------------ the flow

// A stretch of text in reading order, as one string, with each character's
// line and place in it. Lines are joined with a space, and a word broken
// across two lines by a hyphen is joined back without it: "Fig-" and
// "ure 2" read as "Figure 2", which is how the rules are written.
export interface Flow {
  text: string;
  at: { line: Line; char: number }[];
}

export function flowOf(lines: Line[]): Flow {
  let text = "";
  const at: Flow["at"] = [];
  lines.forEach((line, index) => {
    const body = line.text;
    let end = body.length;
    const next = lines[index + 1];
    const hyphenated = next && /[A-Za-z]-$/.test(body) && /^[a-z]/.test(next.text) && next.page === line.page;
    if (hyphenated) end -= 1;
    for (let i = 0; i < end; i += 1) { text += body[i]; at.push({ line, char: i }); }
    if (next && !hyphenated) { text += " "; at.push({ line, char: -1 }); }
  });
  return { text, at };
}

// The boxes a stretch of the flow was printed in, one per line it crosses,
// as fractions of the page.
export function boxesOf(flow: Flow, start: number, end: number, pageSize: (page: number) => [number, number]): Box[] {
  const spans = new Map<Line, { x0: number; x1: number; top: number; bottom: number }>();
  for (let i = start; i < end; i += 1) {
    const where = flow.at[i];
    if (!where || where.char < 0) continue;
    const ref = where.line.chars[where.char];
    if (!ref || ref.run < 0) continue;
    const run = where.line.runs[ref.run];
    const per = run.width / Math.max(run.text.length, 1);
    const x0 = run.x + per * ref.at, x1 = x0 + per;
    const top = run.baseline - run.size * 0.8, bottom = run.baseline + run.size * 0.22;
    const span = spans.get(where.line);
    if (!span) spans.set(where.line, { x0, x1, top, bottom });
    else { span.x0 = Math.min(span.x0, x0); span.x1 = Math.max(span.x1, x1); span.top = Math.min(span.top, top); span.bottom = Math.max(span.bottom, bottom); }
  }
  const out: Box[] = [];
  for (const [line, s] of spans) {
    const [width, height] = pageSize(line.page);
    out.push({ page: line.page, x: s.x0 / width, y: s.top / height, w: (s.x1 - s.x0) / width, h: (s.bottom - s.top) / height });
  }
  return out;
}
