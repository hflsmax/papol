// The bibliography: where it is, where each entry begins, and what each
// entry says about the work it names.

import { extractArxivId } from "../../../../cloudflare/src/papers/identifiers";
import { flowOf, type Layout, type Line } from "./layout";
import {
  BIB_EDITORIAL, BIB_HEADING, BIB_QUALITY, BIB_STOP, BIB_TRAILING_LIST, ENTRY_BRACKET, ENTRY_GAP, ENTRY_HANGING, ENTRY_LABEL, ENTRY_NUMBER, ENTRY_NUMBER_BARE,
  FIELD_AUTHORS_INVERTED, FIELD_AUTHORS_YEAR_FIRST, FIELD_DOI, FIELD_TITLE_QUOTED, FIELD_YEAR_AFTER_AUTHORS,
  FIELD_YEAR_ANY, FIELD_YEAR_PAREN, type Rule,
} from "./registry";
import { Trace } from "./trace";

export interface Entry {
  key: string;
  index: number;
  number: number | null; // as numbered in print
  label: string | null; // as labelled in print: "Knu84"
  raw: string;
  lines: Line[];
  title: string | null;
  authors: string[];
  surnames: string[]; // normalized, for matching author–year citations
  year: number | null;
  yearSuffix: string; // the "a" of 2019a
  journal: string | null;
  doi: string | null;
  arxiv_id: string | null;
  page: number;
  y: number;
}

export type Numbering = "bracket" | "number" | "label" | "none";

export interface Bibliography {
  entries: Entry[];
  numbering: Numbering;
  lines: Set<Line>; // every line inside a bibliography, headings included
}

// ------------------------------------------------------------- the blocks

function isHeadingLike(line: Line, bodySize: number): boolean {
  return line.bold || line.size >= bodySize * 1.05 || (line.text === line.text.toUpperCase() && /[A-Z]{4}/.test(line.text));
}

// Each stretch of lines under a bibliography heading, down to a heading that
// ends it. Nature papers have two (the article's and the Methods'), which
// number on from each other.
function blocks(layout: Layout, trace: Trace): { lines: Line[]; heading: Line | null }[] {
  const lines = layout.pages.flatMap((p) => p.lines.filter((l) => !l.furniture));
  const out: { lines: Line[]; heading: Line | null }[] = [];
  let current: { lines: Line[]; heading: Line | null } | null = null;
  for (const line of lines) {
    if (BIB_HEADING.pattern!.test(line.text) && line.text.length < 40) {
      if (current) out.push(current);
      current = { lines: [], heading: line };
      trace.add(BIB_HEADING.id, line.page, line.text, []);
      continue;
    }
    if (!current) continue;
    const ends = (BIB_STOP.pattern!.test(line.text) && isHeadingLike(line, layout.bodySize) && line.text.length < 80)
      // A section heading ends it too: set well above the list's size, or
      // bold and numbered ("A PROOFS", "B.1 Lemmas") at the text's size.
      || (line.bold && line.size >= layout.bodySize * 1.15 && line.text.length < 80)
      || (line.bold && line.size >= layout.bodySize * 0.95 && line.text.length < 80 && /^(?:[A-Z]|\d+)(?:\.\d+)*\.?\s+\p{Lu}/u.test(line.text))
      // or numbered and in capitals throughout, bold or not.
      || (line.text.length < 80 && /^(?:[A-Z]|\d+)(?:\.\d+)*\.?\s+[A-Z][A-Z-]+(?:\s+[A-Z-]+)+\s*$/.test(line.text));
    const editorial = BIB_EDITORIAL.pattern!.test(line.text);
    if (ends || editorial) {
      trace.add(editorial ? BIB_EDITORIAL.id : BIB_STOP.id, line.page, line.text, []);
      out.push(current);
      current = null;
      continue;
    }
    current.lines.push(line);
  }
  if (current) out.push(current);
  return out.filter((b) => b.lines.length > 0);
}

// With no heading: the last run of lines numbered 1., 2., 3. … in order.
function trailingList(layout: Layout, trace: Trace): { lines: Line[]; heading: Line | null }[] {
  const lines = layout.pages.flatMap((p) => p.lines.filter((l) => !l.furniture));
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const m = ENTRY_NUMBER.pattern!.exec(lines[i].text) ?? ENTRY_BRACKET.pattern!.exec(lines[i].text);
    if (!m || Number(m.groups!.number) !== 1) continue;
    let expected = 2, seen = 1;
    for (let j = i + 1; j < lines.length && seen < 5; j += 1) {
      const n = ENTRY_NUMBER.pattern!.exec(lines[j].text) ?? ENTRY_BRACKET.pattern!.exec(lines[j].text);
      if (n && Number(n.groups!.number) === expected) { expected += 1; seen += 1; }
    }
    if (seen >= 5 && i > lines.length * 0.3) {
      trace.add(BIB_TRAILING_LIST.id, lines[i].page, lines[i].text.slice(0, 60), []);
      return [{ lines: lines.slice(i), heading: null }];
    }
  }
  return [];
}

// ------------------------------------------------------------ the entries

interface Start { at: number; number: number | null; label: string | null; prefix: number; rule: Rule }

// Where entries begin, by a numbering that runs in order: a line only
// starts entry n+1 after entry n, so a "12. Springer" inside an entry
// starts nothing.
function numberedStarts(lines: Line[], rule: Rule, from: number): Start[] {
  const starts: Start[] = [];
  let next = from;
  lines.forEach((line, at) => {
    const m = rule.pattern!.exec(line.text);
    if (!m) return;
    const n = Number(m.groups!.number);
    if (starts.length === 0 ? n >= 1 && n <= from + 3 : n === next) {
      starts.push({ at, number: n, label: null, prefix: m[0].length, rule });
      next = n + 1;
    }
  });
  return starts;
}

function labelStarts(lines: Line[]): Start[] {
  return lines.flatMap((line, at) => {
    const m = ENTRY_LABEL.pattern!.exec(line.text);
    return m ? [{ at, number: null, label: m.groups!.label, prefix: m[0].length, rule: ENTRY_LABEL }] : [];
  });
}

// Unnumbered: by the hanging indent where the list has one, else by the
// gaps between entries. The indent is learned from the list: the step most
// often seen from a line's left edge to the next line's, in the same page
// region. The left edges that step leads away from are where entries start,
// wherever on the page they recur — so a column that is all one entry's
// continuation (a paper with four hundred authors) is still read as that.
function layoutStarts(lines: Line[]): Start[] {
  const size = lines.length ? lines.reduce((sum, l) => sum + l.size, 0) / lines.length : 10;
  const steps = new Map<number, number>();
  for (let i = 1; i < lines.length; i += 1) {
    const a = lines[i - 1], b = lines[i];
    if (a.page !== b.page || a.column !== b.column) continue;
    const step = Math.round((b.x0 - a.x0) * 2) / 2;
    if (step > 0.4 * size && step < 3 * size) steps.set(step, (steps.get(step) ?? 0) + 1);
  }
  let indent = 0, most = 0;
  for (const [step, count] of steps) if (count > most) { indent = step; most = count; }
  const near = (a: number, b: number) => Math.abs(a - b) <= 1.5;
  const edges = new Set<number>();
  if (indent) {
    const lefts = lines.map((l) => l.x0);
    for (const x of lefts) if (lefts.some((y) => near(y, x + indent))) edges.add(Math.round(x));
  }
  const indentedCount = lines.filter((l) => [...edges].some((e) => near(l.x0, e + indent))).length;
  const hanging = indent > 0 && edges.size > 0 && indentedCount >= 0.15 * lines.length;
  const starts: Start[] = [];
  lines.forEach((line, at) => {
    if (hanging) {
      const atEdge = [...edges].some((e) => near(line.x0, e)) && ![...edges].some((e) => near(line.x0, e + indent));
      if (atEdge || at === 0) starts.push({ at, number: null, label: null, prefix: 0, rule: ENTRY_HANGING });
      return;
    }
    const prev = lines[at - 1];
    const sameColumn = prev && prev.page === line.page && prev.column === line.column;
    const gap = sameColumn ? line.top - prev.bottom : 0;
    const spacing = line.size * 0.35;
    if (at === 0 || (sameColumn && gap > spacing + line.size * 0.3)
      || (!sameColumn && /[.)]\s*$/.test(prev.text) && /^\p{Lu}/u.test(line.text))) {
      starts.push({ at, number: null, label: null, prefix: 0, rule: ENTRY_GAP });
    }
  });
  return starts;
}

// ------------------------------------------------------------- the fields

export function normalizeName(name: string): string {
  return name.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z]/g, "");
}

const surnameOf = (name: string) => {
  const words = name.replace(/\s+/g, " ").trim().split(" ").filter((w) => !/^(?:[\p{Lu}]\.)+$/u.test(w) && !/^(?:jr\.?|sr\.?|ii|iii)$/i.test(w));
  // "Chen J", "Hopkins JB": surname first, initials after without stops.
  if (words.length >= 2 && /^[\p{Lu}]{1,3}$/u.test(words[words.length - 1]) && /\p{Ll}/u.test(words[0])) return words[0];
  return words[words.length - 1] ?? name;
};

function sentenceEnd(text: string): number {
  // The first full stop, question or exclamation mark that ends a
  // sentence: not the one after an initial ("J.") or inside "et al.".
  const re = /[.?!](?=\s|$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const before = text.slice(Math.max(0, m.index - 3), m.index);
    if (/(?:^|\s)\p{Lu}$/u.test(before) || /\bal$/.test(before) || /\b(?:vs|Vol|No|pp|Proc|Int|Conf)$/.test(text.slice(Math.max(0, m.index - 4), m.index))) continue;
    return m.index;
  }
  return text.length;
}

const cleanTitle = (title: string | null) => {
  const t = (title ?? "").replace(/\s+/g, " ").replace(/^[\s"“”,.:]+|[\s"“”,.:]+$/g, "").trim();
  return t.length >= 4 ? t : null;
};

export function parseEntry(raw: string): Pick<Entry, "title" | "authors" | "surnames" | "year" | "yearSuffix" | "doi" | "arxiv_id" | "journal"> & { rules: string[] } {
  const rules: string[] = [];
  const doiMatch = FIELD_DOI.pattern!.exec(raw);
  const doi = doiMatch ? doiMatch.groups!.doi.replace(/[.,;:)\]}>]+$/, "").toLowerCase() : null;
  if (doi) rules.push(FIELD_DOI.id);
  const arxiv = extractArxivId(raw);
  // The year, as each style places it.
  const withoutUrls = raw.replace(/https?:\/\/\S+|10\.\d{4,9}\/\S+/g, " ");
  let year: number | null = null, suffix = "";
  for (const [rule, pick] of [[FIELD_YEAR_AFTER_AUTHORS, "first"], [FIELD_YEAR_PAREN, "last"]] as const) {
    const all = [...withoutUrls.matchAll(new RegExp(rule.pattern!.source, "g" + rule.pattern!.flags.replace("g", "")))];
    const m = pick === "first" ? all[0] : all[all.length - 1];
    if (m) { year = Number(m.groups!.year); suffix = m.groups!.suffix ?? ""; rules.push(rule.id); break; }
  }
  if (year === null) {
    const all = [...withoutUrls.matchAll(FIELD_YEAR_ANY.pattern!)];
    const m = all[all.length - 1];
    if (m) { year = Number(m.groups!.year); suffix = m.groups!.suffix ?? ""; rules.push(FIELD_YEAR_ANY.id); }
  }
  let authors: string[] = [], title: string | null = null;
  const inverted = FIELD_AUTHORS_INVERTED.pattern!.exec(raw);
  const yearFirst = FIELD_AUTHORS_YEAR_FIRST.pattern!.exec(raw);
  const quoted = FIELD_TITLE_QUOTED.pattern!.exec(raw);
  if (inverted?.groups && inverted.groups.rest) {
    rules.push(FIELD_AUTHORS_INVERTED.id);
    authors = [...inverted.groups.authors.matchAll(/([\p{Lu}][\p{L}'’-]+(?:\s[\p{Lu}][\p{L}'’-]+)?),\s((?:[\p{Lu}]\.\s?-?)+)/gu)].map((m) => `${m[2].trim()} ${m[1]}`);
    const rest = inverted.groups.rest;
    title = cleanTitle(rest.slice(0, sentenceEnd(rest)));
  } else if (yearFirst?.groups && yearFirst.groups.authors.length < 400 && yearFirst.groups.authors.length < 0.6 * raw.length) {
    rules.push(FIELD_AUTHORS_YEAR_FIRST.id);
    authors = yearFirst.groups.authors.split(/,\s(?:and\s)?|\sand\s|\s&\s/).map((a) => a.trim()).filter((a) => a && !/^et al\.?$/.test(a));
    const rest = yearFirst.groups.rest;
    title = cleanTitle(rest.slice(0, sentenceEnd(rest)));
  } else if (quoted?.groups) {
    rules.push(FIELD_TITLE_QUOTED.id);
    title = cleanTitle(quoted.groups.title);
    authors = raw.slice(0, quoted.index).split(/,\s(?:and\s)?|\sand\s|\s&\s/).map((a) => a.trim()).filter((a) => /\p{L}/u.test(a) && a.length < 60);
  } else {
    // LNCS ("Author, A., Author, B.: Title. In: …") and whatever else: the
    // authors are the first sentence (or up to a colon), the title the next.
    const colon = raw.indexOf(": ");
    const first = colon > 0 && colon < sentenceEnd(raw) + 1 ? colon : sentenceEnd(raw);
    authors = raw.slice(0, first).split(/,\s(?:and\s)?|\sand\s|\s&\s/).map((a) => a.trim()).filter((a) => /\p{L}/u.test(a) && a.length < 60);
    const rest = raw.slice(first + 1).trim();
    title = cleanTitle(rest.slice(0, sentenceEnd(rest)));
  }
  // An inverted name ("Smith, J.") that the plain splitter cut in two.
  if (authors.length >= 2 && authors.every((a, i) => i % 2 === 0 || /^(?:[\p{Lu}]\.\s?-?)+$/u.test(a))) {
    const joined: string[] = [];
    for (let i = 0; i < authors.length; i += 2) joined.push(`${authors[i + 1] ?? ""} ${authors[i]}`.trim());
    authors = joined;
  }
  authors = authors.map((a) => a.replace(/\s+/g, " ").replace(/\.$/, "").trim()).filter((a) => a.length > 1 && a.length < 80);
  const surnames = authors.map((a) => normalizeName(a.includes(",") ? a.split(",")[0] : surnameOf(a))).filter(Boolean);
  return { title, authors, surnames, year, yearSuffix: suffix, doi, arxiv_id: arxiv, journal: null, rules };
}

// ----------------------------------------------------------- the whole

export function findBibliography(layout: Layout, trace: Trace): Bibliography {
  let found = blocks(layout, trace);
  const parse = (candidate: typeof found, into: Trace = trace) => {
    const entries: Entry[] = [];
    const inside = new Set<Line>();
    let numbering: Numbering = "none";
    let nextNumber = 1;
    for (const block of candidate) {
      if (block.heading) inside.add(block.heading);
      block.lines.forEach((l) => inside.add(l));
      const bracket = numberedStarts(block.lines, ENTRY_BRACKET, nextNumber);
      const number = numberedStarts(block.lines, ENTRY_NUMBER, nextNumber);
      const bare = numberedStarts(block.lines, ENTRY_NUMBER_BARE, nextNumber);
      const label = labelStarts(block.lines);
      const best = [bracket, number, bare, label].reduce((a, b) => (b.length > a.length ? b : a));
      let starts: Start[];
      if (best.length >= 3) {
        starts = best;
        numbering = best === bracket ? "bracket" : best === label ? "label" : "number";
        if (numbering !== "label") nextNumber = (starts[starts.length - 1].number ?? 0) + 1;
      } else {
        starts = layoutStarts(block.lines);
      }
      starts.forEach((start, i) => {
        const end = i + 1 < starts.length ? starts[i + 1].at : block.lines.length;
        const lines = block.lines.slice(start.at, end);
        const flow = flowOf(lines);
        const raw = flow.text.slice(start.prefix).replace(/\s+/g, " ").trim();
        if (raw.length < 12) return;
        const fields = parseEntry(raw);
        const page = layout.pages[lines[0].page - 1];
        const entry: Entry = {
          key: `b${entries.length}`, index: entries.length, number: start.number, label: start.label, raw, lines,
          ...fields, page: lines[0].page, y: lines[0].top / page.height,
        };
        entries.push(entry);
        into.add(start.rule.id, entry.page, raw.slice(0, 90), lines.map((l) => ({
          page: l.page, x: l.x0 / page.width, y: l.top / layout.pages[l.page - 1].height,
          w: (l.x1 - l.x0) / page.width, h: (l.bottom - l.top) / layout.pages[l.page - 1].height,
        })));
        for (const rule of fields.rules) into.add(rule, entry.page, raw.slice(0, 60), []);
      });
    }
    return { entries, numbering, lines: inside };
  };
  // Each stretch alone first: only those that read as a bibliography are
  // kept, and then read together, so numbering carries from one to the next.
  found = found.filter((block) => {
    const alone = parse([block], new Trace());
    const dated = alone.entries.filter((e) => e.year !== null).length;
    const kept = alone.entries.length >= 3 && dated >= 0.5 * alone.entries.length;
    if (!kept && block.heading) trace.add(BIB_QUALITY.id, block.heading.page, `dropped: ${block.heading.text} (${alone.entries.length} entries, ${dated} dated)`, []);
    return kept;
  });
  let result = parse(found);
  if (result.entries.length < 3) {
    found = trailingList(layout, trace);
    const fallback = parse(found);
    if (fallback.entries.length > result.entries.length) result = fallback;
  }
  return result;
}
