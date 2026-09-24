// Citation markers in the text, each tied to the bibliography entry it
// names.
//
// A paper cites one way, and which way is decided by the paper rather than
// assumed: each way the analyzer knows is tried, only what names entries
// that exist counts, and the way that found the most is the paper's. That
// is what keeps "a = [4, 5, 6] mm" from becoming three citations in a paper
// that cites with (1, 2), and equation numbers "(3)" from becoming
// citations in one that cites with [3].

import { least, most } from "./numbers";
import type { Entry, Bibliography } from "./bibliography";
import { normalizeName } from "./bibliography";
import { boxesOf, type Box, type Flow, type Layout, type Line } from "./layout";
import {
  CITE_AUTHOR_YEAR_GROUP, CITE_AUTHOR_YEAR_NARRATIVE, CITE_BRACKET, CITE_LABEL, CITE_PAREN, CITE_SUPERSCRIPT, NOT_A_NAME,
} from "./registry";
import type { Trace } from "./trace";

export interface CitationOut extends Box {
  key: string;
  label: string;
  inferred: boolean;
}

interface Hit { rule: string; entries: Entry[]; label: string; boxes: Box[]; page: number }

// A way of citing is kept where it found at least this many citations.
const LEAST_HITS = 3;

// "1, 4–6" → [1, 4, 5, 6]. Ranges longer than this are a misreading.
const LONGEST_RANGE = 40;
function numbersOf(list: string): number[] | null {
  const out: number[] = [];
  for (const part of list.split(/[,;]/)) {
    const range = part.trim().split(/\s*[-–—]\s*/);
    if (range.some((r) => !/^\d{1,4}$/.test(r))) return null;
    if (range.length === 1) out.push(Number(range[0]));
    else {
      const [a, b] = range.map(Number);
      if (!(b > a) || b - a > LONGEST_RANGE) return null;
      for (let n = a; n <= b; n += 1) out.push(n);
    }
  }
  return out;
}

function numbered(bibliography: Bibliography): Map<number, Entry> {
  const map = new Map<number, Entry>();
  bibliography.entries.forEach((entry, i) => map.set(entry.number ?? i + 1, entry));
  return map;
}

// ------------------------------------------------------------ numeric ways

const EQUATION_BEFORE = /\b(?:Eqs?|Equations?|equations?|eqs?|Eqn|eqn|Fig|Figs|Figure|Figures|Table|Section|Sec|Step|step|Chapter|Theorem|Lemma|Rule|rule)\.?\s*$/;

function bracketHits(flows: Flow[], byNumber: Map<number, Entry>, size: (p: number) => [number, number]): Hit[] {
  const hits: Hit[] = [];
  for (const flow of flows) {
    const re = new RegExp(CITE_BRACKET.pattern!.source, "g");
    let m: RegExpExecArray | null;
    while ((m = re.exec(flow.text))) {
      const numbers = numbersOf(m.groups!.list);
      if (!numbers?.length || numbers.some((n) => !byNumber.has(n))) continue;
      const boxes = boxesOf(flow, m.index, m.index + m[0].length, size);
      if (!boxes.length) continue;
      hits.push({ rule: CITE_BRACKET.id, entries: numbers.map((n) => byNumber.get(n)!), label: m[0], boxes, page: boxes[0].page });
    }
  }
  return hits;
}

function parenHits(flows: Flow[], byNumber: Map<number, Entry>, size: (p: number) => [number, number]): Hit[] {
  const hits: Hit[] = [];
  for (const flow of flows) {
    const re = new RegExp(CITE_PAREN.pattern!.source, "g");
    let m: RegExpExecArray | null;
    while ((m = re.exec(flow.text))) {
      const numbers = numbersOf(m.groups!.list);
      if (!numbers?.length || numbers.some((n) => !byNumber.has(n))) continue;
      if (EQUATION_BEFORE.test(flow.text.slice(Math.max(0, m.index - 14), m.index))) continue;
      // A number that is all its line holds is a display equation's.
      const alone = flow.at[m.index];
      if (alone && alone.line.text.trim() === m[0].trim()) continue;
      // A number set alone at the right of its line is an equation's.
      const end = flow.at[m.index + m[0].length - 1], start = flow.at[m.index];
      if (end && start && end.line === start.line && start.char > 0) {
        const line = start.line, run = line.runs[line.chars[start.char]?.run ?? 0];
        const before = line.chars.slice(0, start.char).map((c) => line.runs[c.run]).filter(Boolean).pop();
        const trailing = end.char >= line.text.trimEnd().length - 1;
        if (trailing && before && run && run.x - (before.x + before.width) > 2 * line.size) continue;
      }
      const boxes = boxesOf(flow, m.index, m.index + m[0].length, size);
      if (!boxes.length) continue;
      hits.push({ rule: CITE_PAREN.id, entries: numbers.map((n) => byNumber.get(n)!), label: m[0], boxes, page: boxes[0].page });
    }
  }
  return hits;
}

const UNIT = /(?:^|\s)(?:m|cm|mm|µm|μm|nm|km|s|ms|kg|g|N|J|Pa|kPa|MPa|GPa|W|K|Hz|mol|L|m\/s|N\/m)$/;
const MATH_FONT = /math|cmmi|cmsy|symbol|cmex|msbm|stix.*math/i;

function superscriptHits(layout: Layout, skip: Set<Line>, byNumber: Map<number, Entry>): Hit[] {
  const hits: Hit[] = [];
  for (const page of layout.pages) {
    for (const line of page.lines) {
      if (line.furniture || skip.has(line)) continue;
      const tokens: { start: number; end: number }[] = [];
      line.runs.forEach((run, i) => {
        if (!run.sup) return;
        const last = tokens[tokens.length - 1];
        if (last && last.end === i) last.end = i + 1; else tokens.push({ start: i, end: i + 1 });
      });
      // A line of names with a note mark after them is an author list.
      if (page.number === 1 && tokens.length >= 1) {
        const words = line.text.split(/\s+/).filter((w) => /\p{L}/u.test(w));
        if (words.length && words.filter((w) => /^\p{Lu}/u.test(w)).length >= 0.6 * words.length) continue;
      }
      for (const token of tokens) {
        const runs = line.runs.slice(token.start, token.end);
        const text = runs.map((r) => r.text).join("").replace(/\s+/g, "");
        const m = CITE_SUPERSCRIPT.pattern!.exec(text);
        if (!m) continue;
        const before = line.runs.slice(0, token.start).filter((r) => !r.sup && !r.sub);
        const prev = before[before.length - 1];
        // At the start of a line it is a footnote's mark; after a digit,
        // a unit or a mathematical symbol, a power.
        if (!prev) continue;
        const prevText = before.map((r) => r.text).join("");
        if (/\d\s*$/.test(prevText) || UNIT.test(prevText.trimEnd()) || MATH_FONT.test(prev.font)) continue;
        // In mathematics: after a variable (one italic letter), or after a
        // bracket on a line that has an operator on it.
        if (prev.italic && /(?:^|\s)\p{L}\s*$/u.test(prevText)) continue;
        if (/\b(?:sin|cos|tan|cot|sec|csc|sinh|cosh|tanh|log|ln|exp)\s*$/.test(prevText)) continue;
        if (/[)\]}|]\s*$/.test(prevText) && /[=+−×÷±√∑∫≤≥≈]/.test(line.text)) continue;
        const numbers = numbersOf(m.groups!.list);
        if (!numbers?.length || numbers.some((n) => !byNumber.has(n))) continue;
        const x0 = least(runs.map((r) => r.x)), x1 = most(runs.map((r) => r.x + r.width));
        const top = least(runs.map((r) => r.baseline - r.size * 0.8)), bottom = most(runs.map((r) => r.baseline + r.size * 0.22));
        const box = { page: page.number, x: x0 / page.width, y: top / page.height, w: (x1 - x0) / page.width, h: (bottom - top) / page.height };
        hits.push({ rule: CITE_SUPERSCRIPT.id, entries: numbers.map((n) => byNumber.get(n)!), label: text, boxes: [box], page: page.number });
      }
    }
  }
  return hits;
}

// --------------------------------------------------------- author–year way

const YEAR_ITEM = /(?:1[5-9]\d\d|20\d\d)[a-z]?|\b[a-z]\b/g;

// The entries a first author and a list of years name. A year without its
// letter where the bibliography gives two works that year names the first;
// a letter names the work lettered so, or else the n-th of that year.
function lookup(entries: Entry[], names: string, years: string[]): Entry[] {
  const people = names.replace(/\bet al\.?/g, "").split(/\s(?:and|&)\s|,\s/).map((n) => n.trim()).filter(Boolean);
  const firstWords = (people[0] ?? "").split(/\s+/).filter((w) => /^\p{Lu}/u.test(w) || /^(?:van|von|de|der|den|du|la|le|da|di)$/.test(w));
  const first = normalizeName(firstWords.join(" "));
  const second = people[1] ? normalizeName(people[1].split(/\s+/).pop() ?? "") : null;
  if (!first || NOT_A_NAME.has(firstWords[0] ?? "")) return [];
  // "van den Bos" is cited whole and listed under "Bos": one name ending
  // the other counts.
  const same = (a: string, b: string) => a === b || (Math.min(a.length, b.length) >= 3 && (a.endsWith(b) || b.endsWith(a)));
  const byAuthor = entries.filter((e) => e.surnames[0] && same(e.surnames[0], first));
  const out: Entry[] = [];
  let lastYear: number | null = null;
  for (const item of years) {
    const letterOnly = /^[a-z]$/.test(item);
    const year: number | null = letterOnly ? lastYear : Number(item.slice(0, 4));
    const letter = letterOnly ? item : item.slice(4);
    if (!year) continue;
    lastYear = year;
    let candidates = byAuthor.filter((e) => e.year === year);
    if (second && candidates.length > 1) {
      const withSecond = candidates.filter((e) => e.surnames[1] && same(e.surnames[1], second));
      if (withSecond.length) candidates = withSecond;
    }
    if (!candidates.length) continue;
    const lettered = letter ? candidates.find((e) => e.yearSuffix === letter) ?? candidates[letter.charCodeAt(0) - 97] : candidates[0];
    if (lettered) out.push(lettered);
  }
  return out;
}

function authorYearHits(flows: Flow[], entries: Entry[], size: (p: number) => [number, number]): Hit[] {
  const hits: Hit[] = [];
  for (const flow of flows) {
    const claimed: [number, number][] = [];
    const group = new RegExp(CITE_AUTHOR_YEAR_GROUP.pattern!.source, "gu");
    let m: RegExpExecArray | null;
    while ((m = group.exec(flow.text))) {
      const inner = m.groups!.group;
      const innerStart = m.index + 1;
      let offset = 0, names = "";
      for (const part of inner.split(";")) {
        const partStart = innerStart + offset;
        offset += part.length + 1;
        const text = part.replace(/^\s*(?:(?:see|See|e\.g\.|cf\.|i\.e\.|and|also)[,]?\s+)+/, (s) => " ".repeat(s.length));
        const parsed = /^(?<lead>\s*)(?<names>(?:(?:van|von|de|der|den|du|la|le|da|di|del|dos|ten|ter)\s+)*[\p{Lu}][^0-9]*?)?[,]?\s*(?<years>(?:(?:1[5-9]\d\d|20\d\d)[a-z]?)(?:\s*,\s*(?:(?:1[5-9]\d\d|20\d\d)[a-z]?|[a-z]\b))*)/u.exec(text);
        if (!parsed?.groups?.years) continue;
        if (parsed.groups.names) names = parsed.groups.names.trim();
        if (!names) continue;
        const found = lookup(entries, names, parsed.groups.years.match(YEAR_ITEM) ?? []);
        if (!found.length) continue;
        const from = partStart + parsed.groups.lead.length, to = partStart + parsed[0].length;
        const boxes = boxesOf(flow, from, to, size);
        if (!boxes.length) continue;
        claimed.push([from, to]);
        hits.push({ rule: CITE_AUTHOR_YEAR_GROUP.id, entries: found, label: flow.text.slice(from, to).trim(), boxes, page: boxes[0].page });
      }
    }
    const narrative = new RegExp(CITE_AUTHOR_YEAR_NARRATIVE.pattern!.source, "gu");
    while ((m = narrative.exec(flow.text))) {
      const from = m.index, to = m.index + m[0].length;
      if (claimed.some(([a, b]) => from < b && to > a)) continue;
      const found = lookup(entries, m.groups!.names, m.groups!.years.match(YEAR_ITEM) ?? []);
      if (!found.length) continue;
      const boxes = boxesOf(flow, from, to, size);
      if (!boxes.length) continue;
      hits.push({ rule: CITE_AUTHOR_YEAR_NARRATIVE.id, entries: found, label: m[0], boxes, page: boxes[0].page });
    }
  }
  return hits;
}

function labelHits(flows: Flow[], entries: Entry[], size: (p: number) => [number, number]): Hit[] {
  const byLabel = new Map(entries.filter((e) => e.label).map((e) => [e.label!, e]));
  const hits: Hit[] = [];
  for (const flow of flows) {
    const re = new RegExp(CITE_LABEL.pattern!.source, "g");
    let m: RegExpExecArray | null;
    while ((m = re.exec(flow.text))) {
      const labels = m.groups!.list.split(/\s*,\s*/);
      if (!labels.every((l) => byLabel.has(l))) continue;
      const boxes = boxesOf(flow, m.index, m.index + m[0].length, size);
      if (!boxes.length) continue;
      hits.push({ rule: CITE_LABEL.id, entries: labels.map((l) => byLabel.get(l)!), label: m[0], boxes, page: boxes[0].page });
    }
  }
  return hits;
}

// ------------------------------------------------------------- the whole

export function findCitations(layout: Layout, flows: Flow[], bibliography: Bibliography, trace: Trace): CitationOut[] {
  if (!bibliography.entries.length) return [];
  const size = (page: number): [number, number] => [layout.pages[page - 1].width, layout.pages[page - 1].height];
  const ways: Hit[][] = [];
  if (bibliography.numbering === "bracket" || bibliography.numbering === "number") {
    const byNumber = numbered(bibliography);
    ways.push(bracketHits(flows, byNumber, size), parenHits(flows, byNumber, size), superscriptHits(layout, bibliography.lines, byNumber));
  } else if (bibliography.numbering === "label") {
    ways.push(labelHits(flows, bibliography.entries, size));
  } else {
    ways.push(authorYearHits(flows, bibliography.entries, size));
  }
  // A paper cites one way: the way that names the most different entries
  // (then the most citations) is kept. Counting entries rather than hits is
  // what tells citations from the powers in a paper's equations, which are
  // many but name entries 2 and 3 over and over.
  const breadth = (hits: Hit[]) => new Set(hits.flatMap((h) => h.entries.map((e) => e.key))).size;
  const best = ways.reduce((a, b) => (breadth(b) > breadth(a) || (breadth(b) === breadth(a) && b.length > a.length) ? b : a), [] as Hit[]);
  const kept = best.length >= LEAST_HITS ? best : [];
  const out: CitationOut[] = [];
  for (const hit of kept) {
    trace.add(hit.rule, hit.page, `${hit.label} → ${hit.entries.map((e) => e.key).join(",")}`, hit.boxes);
    for (const entry of hit.entries) for (const box of hit.boxes) out.push({ key: entry.key, label: hit.label, inferred: false, ...box });
  }
  return out;
}
