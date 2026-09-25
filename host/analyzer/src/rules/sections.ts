// Numbered sections: where each one begins, and the places in the text
// that point at it ("Section 2.1", "§3"). A section is kept as a float of
// kind `section` whose box is its heading's line, as wide as the column it
// is set in, so a link to it is stored and followed like a link to a
// figure (cloudflare/src/papers/reading.ts).

import type { DocumentLink } from "../../../../cloudflare/src/papers/reading";
import { typeOf, type Found } from "./floats";
import { citedAway } from "./cited";
import { boxesOf, type Flow, type Layout, type Line } from "./layout";
import { MENTION_CITED, MENTION_SECTION, SECTION_HEADING, SECTION_HEADING_LEAD, SECTION_HEADING_STYLE, SECTION_NOT_RUNNING_HEAD, SECTION_ROMAN, SECTION_SPLIT_NUMBER } from "./registry";
import type { Trace } from "./trace";

const keyOf = (number: string) => `section\n${number.toLowerCase()}`;

// A contents entry: the title ends in its page number, or runs to it along
// dot leaders.
const isContents = (title: string) => /\s\d{1,4}$/.test(title.trim()) || /\.\s?\.\s?\.|…/.test(title);

// Every numbered heading. The first pass (section.heading): a line opening
// with a section number and a capitalised title, mostly bold or larger
// than the text, not inside a float, not a running head. A number set
// apart from its title, in a tab of its own, is read with the title level
// with it (section.split-number). The second pass (section.heading-styled-
// lead) takes subsections set in the text's size with a bold or italic
// lead, once their parent and predecessor are headings. The first line
// for a number is the section's; `skip` holds lines that are no one's
// heading (the bibliography's).
export function findSections(layout: Layout, skip: Set<Line>, floats: Iterable<Found>, trace: Trace): Map<string, Found> {
  const sections = new Map<string, Found>();
  const type = typeOf(layout);
  // Nothing inside a float heads a section: a figure's "70 Hz" label.
  const within = [...floats];
  const inFloat = (line: Line, page: Page) => within.some((f) => f.page === page.number
    && line.x0 / page.width >= f.x - 0.001 && line.x1 / page.width <= f.x + f.w + 0.001
    && line.top / page.height >= f.y - 0.001 && line.bottom / page.height <= f.y + f.h + 0.001);
  const letters = (runs: Line["runs"]) => runs.reduce((n, r) => n + r.text.replace(/\s/g, "").length, 0);
  const add = (page: Page, line: Line, number: string, rule: string) => {
    // Across, the box is the column the section begins in — its heading's
    // column on a page set in two, else the text's width — so a link can
    // bring that column into view from its top (section.column).
    const middle = (line.x0 + line.x1) / 2;
    const column = (page.twoColumn && type.columns.length > 1 && type.columns.find((c) => middle >= c.x0 && middle <= c.x1)) || type.text;
    const x0 = Math.min(column.x0, line.x0), x1 = Math.max(column.x1, line.x1);
    const box = { page: page.number, x: x0 / page.width, y: line.top / page.height, w: (x1 - x0) / page.width, h: (line.bottom - line.top) / page.height };
    sections.set(keyOf(number), { key: `s${sections.size}`, kind: "section", label: number, caption: line, ...box });
    trace.add(rule, page.number, line.text.slice(0, 80), [box]);
  };
  // A scanned page is one picture with its text laid over it: the text
  // layer has no bold and sizes that wander, so a heading there is a
  // numbered title in capitals alone on its row, narrower than the
  // measure (section.scanned).
  const scanned = (page: Page) => page.drawn.some((d) => d.image && d.w * d.h >= 0.8 * page.width * page.height);
  const scannedHeading = (line: Line, page: Page, title: string) => {
    const letter = title.replace(/[^\p{L}]/gu, "");
    return letter.length >= 3 && letter === letter.toUpperCase() && !title.includes(",") && line.x1 - line.x0 < 0.75 * type.measure
      && !page.lines.some((o) => o !== line && !o.furniture && Math.abs(o.baseline - line.baseline) <= 2);
  };
  const candidates = layout.pages.map((page) => candidatesOn(page, skip, trace));
  // A running head in the page's top margin, level with its folio, names
  // the section it is in; it heads nothing (section.not-running-head).
  const runningHead = (line: Line, page: Page) => type.margins.y0 > 0 && line.bottom <= type.margins.y0 + 1
    && page.lines.some((o) => o !== line && o.furniture && /^[\divxlc.\s-]+$/i.test(o.text) && Math.abs(o.baseline - line.baseline) <= 1.5);
  layout.pages.forEach((page, p) => {
    for (const line of candidates[p]) {
      // Normalised, so a mathematical italic "𝜆" reads as the letter "λ".
      const match = SECTION_HEADING.pattern!.exec(line.text.normalize("NFKC"));
      if (!match?.groups || isContents(match.groups.title) || inFloat(line, page)) continue;
      // Mostly bold — the title too, not only a list item's number — or
      // larger than the text by more than the half point the text's size is
      // measured to (layout.ts).
      const set = scanned(page)
        ? scannedHeading(line, page, match.groups.title)
        : letters(line.runs.filter((r) => r.bold)) > letters(line.runs) / 2 || line.size > layout.bodySize + 0.5;
      if (!set) continue;
      const number = match.groups.number;
      if (sections.has(keyOf(number))) continue;
      if (runningHead(line, page)) { trace.add(SECTION_NOT_RUNNING_HEAD.id, page.number, line.text.slice(0, 80), []); continue; }
      add(page, line, number, SECTION_HEADING.id);
    }
  });
  // Subsections with a styled lead: "2.1. Metamaterials" all in italic, or
  // "1.2 Case Study Overview." in bold with the paragraph running on.
  const known = (n: string) => sections.has(keyOf(n));
  const pageOf = (n: string) => sections.get(keyOf(n))!.page;
  const style = (r: Line["runs"][number]) => (r.bold ? "bold" : r.italic ? "italic" : "roman");
  const styledShare = (l: Line) => letters(l.runs.filter((r) => r.bold || r.italic)) / Math.max(1, letters(l.runs));
  layout.pages.forEach((page, p) => {
    for (const line of candidates[p]) {
      const match = SECTION_HEADING.pattern!.exec(line.text.normalize("NFKC"));
      if (!match?.groups || isContents(match.groups.title) || inFloat(line, page) || runningHead(line, page)) continue;
      const number = match.groups.number;
      const parts = number.split(".");
      if (parts.length < 2 || known(number)) continue;
      const parent = parts.slice(0, -1).join(".");
      const last = Number(parts[parts.length - 1]);
      const predecessor = last === 1 ? parent : `${parent}.${last - 1}`;
      if (!known(parent) || !Number.isFinite(last) || !known(predecessor) || pageOf(predecessor) > page.number) continue;
      // The lead: past the number, the first run's style and every run after
      // it in that style — the whole line, or ending in "." or ":" with the
      // rest in another style.
      const runs = line.runs.filter((r) => letters([r]) > 0);
      let i = 0;
      while (i < runs.length && /^[\d.\s]*$/.test(runs[i].text)) i += 1;
      if (i >= runs.length) continue;
      const lead = style(runs[i]);
      if (lead === "roman") continue;
      let j = i;
      while (j < runs.length && style(runs[j]) === lead) j += 1;
      const leadText = runs.slice(i, j).map((r) => r.text).join("");
      const whole = j >= runs.length;
      if (!whole && !(/[.:]\s*$/.test(leadText) || /^\s*[.:]/.test(runs[j].text))) continue;
      // A whole styled line ends within two: not a line of an italic
      // theorem or list, whose next lines are styled too.
      if (whole) {
        const after = page.lines.slice(page.lines.indexOf(line) + 1).filter((o) => o.column === line.column && !o.furniture).slice(0, 2);
        if (after.length && !after.some((o) => styledShare(o) < 0.5)) continue;
      }
      add(page, line, number, SECTION_HEADING_LEAD.id);
    }
  });
  // Headings in the paper's own heading style (section.heading-style): a
  // numbered line — any letter opening its title — whose number is set in
  // the font and size of at least two headings already found at its depth,
  // and continues their numbering: "9 user study" between 8 and 10. An
  // appendix's lone letter ("A Printing Settings…") takes the top level's
  // style, comes after the last numbered top-level heading, runs A, B, C,
  // and — where the letter is a run of its own — stands a real gap from its
  // title, not an article's word space. One a float's box grew over is
  // taken only when it fills a gap on both sides of the numbering (a
  // figure's panel label continues nothing); an appendix letter, when the
  // float's box only begins at it.
  const styleOf = (l: Line) => `${l.runs[0]?.font}@${l.size.toFixed(1)}`;
  const depthOf = (n: string) => (/^[A-Z]$/.test(n) ? 1 : n.split(".").length);
  const counted = new Map<string, number>();
  for (const s of sections.values()) {
    if (/^[A-Z]/.test(s.label)) continue;
    const k = `${depthOf(s.label)} ${styleOf(s.caption as Line)}`;
    counted.set(k, (counted.get(k) ?? 0) + 1);
  }
  const headingStyle = (l: Line, depth: number) => (counted.get(`${depth} ${styleOf(l)}`) ?? 0) >= 2;
  const LOOSE = /^(?<number>(?:\d{1,2}|[A-Z])(?:\.\d{1,2}){0,3})\.?\s+(?<title>\p{L}.*)$/u;
  const topLevel = () => [...sections.values()].filter((s) => /^\d+$/.test(s.label));
  const lastTop = () => topLevel().reduce((a, s) => (!a || s.page > a.page || (s.page === a.page && s.y > a.y) ? s : a), null as Found | null);
  const nextOf = (n: string) => {
    const parts = n.split(".").map(Number);
    const after = [...parts.slice(0, -1), parts[parts.length - 1] + 1].join(".");
    const parentNext = parts.length > 1 ? [...parts.slice(0, -2), parts[parts.length - 2] + 1].join(".") : null;
    return [after, parentNext].filter(Boolean) as string[];
  };
  const floatStartsAt = (line: Line, page: Page) => within.some((f) => f.page === page.number && Math.abs(f.y * page.height - line.top) <= 3);
  layout.pages.forEach((page, p) => {
    for (const line of candidates[p]) {
      const match = LOOSE.exec(line.text.normalize("NFKC"));
      if (!match?.groups || isContents(match.groups.title) || runningHead(line, page)) continue;
      const number = match.groups.number;
      if (known(number)) continue;
      const set = letters(line.runs.filter((r) => r.bold)) > letters(line.runs) / 2 || line.size > layout.bodySize + 0.5;
      if (!set || !headingStyle(line, depthOf(number))) continue;
      const floated = inFloat(line, page);
      if (/^[A-Z]$/.test(number)) {
        const top = lastTop();
        const after = top && (page.number > top.page || (page.number === top.page && line.top / page.height > top.y));
        const inTurn = number === "A" || known(String.fromCharCode(number.charCodeAt(0) - 1));
        const first = line.runs[0], second = line.runs[1];
        const gapped = first && first.text.trim() === number && second ? second.x - (first.x + first.width) >= 0.6 * line.size : true;
        if (!after || !inTurn || !gapped || (floated && !floatStartsAt(line, page))) continue;
      } else {
        const parts = number.split(".");
        const last = Number(parts[parts.length - 1]);
        const parent = parts.slice(0, -1).join(".");
        const predecessor = parts.length === 1 ? String(last - 1) : last === 1 ? parent : `${parent}.${last - 1}`;
        const continues = (parts.length === 1 && last === 1) || (known(predecessor) && pageOf(predecessor) <= page.number && (parts.length === 1 || known(parent)));
        if (!continues) continue;
        if (floated && !nextOf(number).some(known)) continue;
      }
      add(page, line, number, SECTION_HEADING_STYLE.id);
    }
  });
  // Roman-numbered headings (section.roman): "I. INTRODUCTION" … bold or
  // larger, a run I, II, III … of three or more in reading order, none
  // level with another (a figure's panels "I. …", "II. …" side by side).
  const roman = (s: string) => { const v: Record<string, number> = { I: 1, V: 5, X: 10 }; let n = 0; for (let i = 0; i < s.length; i += 1) { const a = v[s[i]], b = v[s[i + 1]] ?? 0; n += a < b ? -a : a; } return n; };
  const ROMAN = /^(?<number>[IVX]{1,5})\.\s+(?<title>[A-Z][A-Za-z][^,]*)$/;
  const romans: { page: Page; line: Line; number: string }[] = [];
  layout.pages.forEach((page, p) => {
    for (const line of candidates[p]) {
      const match = ROMAN.exec(line.text.normalize("NFKC"));
      if (!match?.groups || isContents(match.groups.title) || inFloat(line, page) || runningHead(line, page)) continue;
      const set = letters(line.runs.filter((r) => r.bold)) > letters(line.runs) / 2 || line.size > layout.bodySize + 0.5;
      if (set) romans.push({ page, line, number: match.groups.number });
    }
  });
  const levelWithAnother = (c: (typeof romans)[number]) => romans.some((o) => o !== c && o.page === c.page && Math.abs(o.line.top - c.line.top) <= 2);
  const run: typeof romans = [];
  for (const c of romans.filter((c) => !levelWithAnother(c))) if (roman(c.number) === run.length + 1) run.push(c);
  if (run.length >= 3) for (const c of run) if (!known(c.number)) add(c.page, c.line, c.number, SECTION_ROMAN.id);
  return sections;
}

type Page = Layout["pages"][number];

// A page's lines as headings are looked for in them: each line, except
// that a line that is only a section number is read with the line level
// with it on its right — a number set in a tab of its own ("19.1" |
// "TRISECTION") — when the two are alone on their row, the same size, and
// close (section.split-number).
function candidatesOn(page: Page, skip: Set<Line>, trace: Trace): Line[] {
  const lines = page.lines.filter((l) => !l.furniture && !skip.has(l));
  const used = new Set<Line>();
  const out: Line[] = [];
  for (const line of lines) {
    if (used.has(line)) continue;
    if (/^(?:\d{1,2}|[A-Z](?=\.\d))(?:\.\d{1,2}){0,3}\.?$/.test(line.text.trim())) {
      const level = lines.filter((o) => o !== line && Math.abs(o.baseline - line.baseline) <= 1.5);
      const title = level.length === 1 ? level[0] : undefined;
      if (title && Math.abs(title.size - line.size) <= 0.5 && title.x0 > line.x1 && title.x0 - line.x1 <= 4 * line.size) {
        used.add(title);
        const joined: Line = { ...title, text: `${line.text.trim()} ${title.text}`, runs: [...line.runs, ...title.runs],
          x0: line.x0, top: Math.min(line.top, title.top), bottom: Math.max(line.bottom, title.bottom) };
        trace.add(SECTION_SPLIT_NUMBER.id, page.number, joined.text.slice(0, 80), []);
        out.push(joined);
        continue;
      }
    }
    out.push(line);
  }
  return out;
}

// The numbers a mention lists, with where each sits: "Sections 3 and 4" is
// two, "§§2–4" three (the middle one has no print of its own and points at
// the whole range).
function numbersIn(list: string): { number: string; start: number; end: number }[] {
  const out: { number: string; start: number; end: number }[] = [];
  const re = /(?:\d{1,2}|[IVX]{1,5}(?![A-Za-z\d])|[A-Z](?![A-Za-z]))(?:\.\d{1,2}){0,3}/g;
  let previous: { number: string; start: number; end: number } | null = null;
  let match: RegExpExecArray | null;
  while ((match = re.exec(list))) {
    const number = match[0];
    const start = match.index, end = start + number.length;
    const between = previous ? list.slice(previous.end, start) : "";
    if (previous && /^\s*(?:[-–—]|to)\s*$/.test(between) && /^\d+$/.test(previous.number) && /^\d+$/.test(number)) {
      for (let n = Number(previous.number) + 1; n < Number(number); n += 1) out.push({ number: String(n), start: previous.start, end });
    }
    out.push({ number, start, end });
    previous = { number, start, end };
  }
  return out;
}

// Mentions of sections (mention.section), as links to their headings.
export function findSectionMentions(flow: Flow, sections: Map<string, Found>, layout: Layout, trace: Trace): DocumentLink[] {
  const links: DocumentLink[] = [];
  const size = (page: number): [number, number] => [layout.pages[page - 1].width, layout.pages[page - 1].height];
  const re = new RegExp(MENTION_SECTION.pattern!.source, "g");
  let match: RegExpExecArray | null;
  while ((match = re.exec(flow.text))) {
    const groups = match.groups!;
    // A mention inside a citation, or of a cited work's part, is the cited
    // paper's, not this one's (mention.cited-locator, mention.cited-of).
    if (citedAway(flow.text, match.index, match.index + match[0].length)) {
      trace.add(MENTION_CITED.id, 0, match[0], []);
      continue;
    }
    const listStart = match.index + match[0].length - groups.list.length;
    // "Section C: Theory of…" names a journal's section, not this paper's.
    if (/^\s*:/.test(flow.text.slice(match.index + match[0].length))) continue;
    numbersIn(groups.list).forEach((item, index) => {
      const section = sections.get(keyOf(item.number));
      if (!section) return;
      // The first number takes the word before it: "Section 2.1" is one
      // thing to press.
      const from = index === 0 ? match!.index : listStart + item.start;
      const boxes = boxesOf(flow, from, listStart + item.end, size);
      for (const box of boxes) links.push({ float: section.key, label: groups.list.slice(item.start, item.end).trim(), ...box });
      trace.add(MENTION_SECTION.id, boxes[0]?.page ?? 0, `${groups.kind} ${item.number}`, boxes);
    });
  }
  return links;
}
