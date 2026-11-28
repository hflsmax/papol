// Theorems, lemmas, definitions and proofs: where each one opens. A
// statement is kept as a float of kind `theorem`, `lemma`, `definition` or
// `proof` whose box is the line it opens on, so the viewer's nav bar can
// mark it as it marks a figure (cloudflare/src/papers/reading.ts).
// Propositions and corollaries are theorems: they are the same kind of
// claim, and a reader looking for what a paper proves wants all three.

import type { DocumentLink } from "../../../cloudflare/src/papers/reading";
import { citedAway } from "./cited";
import type { Found } from "./floats";
import { boxesOf, type Flow, type Layout, type Line } from "./layout";
import { MENTION_CITED, MENTION_STATEMENT, STATEMENT_LEAD, STATEMENT_WHOLE } from "./registry";
import { briefly, joined } from "./title";
import type { Trace } from "./trace";

type Page = Layout["pages"][number];

const KINDS: Record<string, string> = {
  theorem: "theorem", proposition: "theorem", corollary: "theorem",
  lemma: "lemma", definition: "definition", proof: "proof",
};

// The word as a reader names it, whatever case the paper set it in.
const named = (word: string) => {
  const w = word.replace(/\s/g, "").toLowerCase();
  return { kind: KINDS[w], name: w[0].toUpperCase() + w.slice(1) };
};

// The runs `length` characters of a line from `from` come from; with
// `letters`, only the runs its letters come from.
function runsOver(line: Line, from: number, length: number, letters = false) {
  const runs = new Set<number>();
  line.chars.slice(from, from + length).forEach(({ run }, i) => {
    if (run >= 0 && (!letters || /\p{L}/u.test(String.fromCodePoint(line.text.codePointAt(from + i)!)))) runs.add(run);
  });
  return [...runs].map((i) => line.runs[i]);
}

// Every statement (statement.lead): a line opening with the word, set apart
// from the text by its face. `skip` holds the bibliography's lines, which
// open a statement only by a face of their own (see below); inside a
// figure or table only a numbered head with its stop opens one — a rule
// set in a figure headed "Definition" is part of the figure.
export function findStatements(layout: Layout, skip: Set<Line>, floats: Iterable<Found>, trace: Trace, headings: Set<Line> = new Set()): Map<string, Found> {
  const statements = new Map<string, Found>();
  const within = [...floats];
  const inFloat = (line: Line, page: Page) => within.some((f) => f.page === page.number
    && line.x0 / page.width >= f.x - 0.001 && line.x1 / page.width <= f.x + f.w + 0.001
    && line.top / page.height >= f.y - 0.001 && line.bottom / page.height <= f.y + f.h + 0.001);
  for (const page of layout.pages) {
    for (const line of page.lines) {
      if (line.furniture) continue;
      // A margin's line number (lineno, as LIPIcs prints one) in a smaller
      // face can be taken into the line it sits beside: "187 Proof.".
      const [first, second] = line.runs;
      const lead = second && /^\d{1,5}$/.test(first.text.trim()) && first.size < second.size * 0.9
        ? line.text.indexOf(first.text.trim()) + first.text.trim().length : 0;
      const match = STATEMENT_LEAD.pattern!.exec(line.text.slice(lead));
      if (!match?.groups) continue;
      const { word, number, open } = match.groups;
      // A name in brackets that runs on past the line has its stop there.
      const stop = match.groups.stop || open !== undefined;
      const end = lead + match[0].length;
      const at = lead + match[0].indexOf(word);
      const face = runsOver(line, at, word.length);
      // Set larger than the text, the word opens a heading ("A Proof of
      // Lemma 2.8"), not a statement.
      if (!face.length || face[0].size > 1.1 * layout.bodySize) continue;
      const letters = word.replace(/\s/g, "");
      const capitals = letters === letters.toUpperCase();
      const bold = face.every((r) => r.bold);
      const italic = face.every((r) => r.italic);
      // acmart sets the word in small capitals of the text's own font, which
      // read as the text does; what sets it apart there is what follows: a
      // theorem's words in italic, or, for a proof, nothing needed — no
      // sentence opens a line with "Proof." but a proof.
      // What follows the head: the rest of its line, or, where the head
      // (or a name in brackets that runs on) fills the line, the next.
      // A name still open there closes on the next line: what follows is
      // after its bracket.
      const next = page.lines[line.index + 1];
      const onNext = end >= line.text.trimEnd().length && next && !next.furniture;
      const from = open !== undefined && next ? next.text.indexOf(")") + 1 : 0;
      const rest = [
        ...runsOver(line, end, line.text.length, true),
        ...(onNext ? runsOver(next, from, next.text.length, true) : []),
      ];
      // Slanted: italic, or a mathematical italic, which a statement's
      // words open with as often as with a word ("Lemma 5.16. 𝑃 ∈ Ω").
      const slanted = (r: Line["runs"][number]) => r.italic || /math.?(?:it|mi)|cmmi/i.test(r.font);
      const italicAfter = !italic && rest.length > 0 && slanted(rest[0]);
      const proof = /^p\s?roof/i.test(word);
      const set = bold || italic || capitals || (stop && (proof || italicAfter));
      // With no stop after it, a number (or what a proof proves, as an
      // appendix heads one: "Proof of Lemma 2.8") is a statement's only
      // when the word is bold: an italic "Lemma 2 gives" can open a line of
      // an italic theorem's own text.
      if (!set || (!stop && !((number || proof) && bold))) continue;
      // Where the bibliography was taken to run on past its end (into an
      // appendix), only a word set apart by a face of its own opens a
      // statement: an entry's title can end a line on "Proof.", in the
      // entry's own face, with the journal's italic after it.
      const ownFace = rest.length > 0 && !rest[0].italic && face[0].font !== rest[0].font;
      if (skip.has(line) && !(bold || capitals || (italic && number) || ownFace)) continue;
      // A numbered head with its stop is a statement even where a float's
      // box was grown over it; inside a float, anything less is the
      // float's own text.
      if (!(number && stop) && inFloat(line, page)) continue;
      const { kind, name } = named(word);
      const box = { page: page.number, x: line.x0 / page.width, y: line.top / page.height, w: (line.x1 - line.x0) / page.width, h: (line.bottom - line.top) / page.height };
      // Named as the paper heads it: a proof by what it proves ("Proof of
      // Lemma 2.8", "Proof sketch"), anything else by its number.
      const head = match[0].slice(match[0].indexOf(word) + word.length).replace(/\s*\([^]*$/, "").replace(/[.:]\s*$/, "").trim();
      const label = number ? `${name} ${number}` : proof && head ? `${name} ${head}` : name;
      // What it is about: its name in brackets, less the works it cites
      // ("Lemma 4 ([AH12])" has none), or else the words it opens with.
      const bracketed = match.groups.name !== undefined
        ? joined([match.groups.name, open !== undefined && next ? next.text.slice(0, from - 1) : ""]).replace(/[,;]?\s*\[[^\]]*\]?\s*$/, "").replace(/^\[[^\]]*\]$/, "")
        : "";
      // (A name can stand after the stop, "Theorem 12.2. (Progress)", and
      // a citation before the words, "Theorem 1. [2] The relation".)
      const opening = joined([line.text.slice(end), onNext ? next.text : ""]).replace(/^\[[^\]]*\]\s*/, "");
      const after = /^\(([^()]{1,80})\)/.exec(opening)?.[1];
      const title = bracketed ? briefly(bracketed)
        : proof ? undefined : briefly(after ?? opening);
      statements.set(`${kind}\n${page.number}\n${line.index}`, {
        key: `t${statements.size}`, kind, label, ...(title ? { title } : {}), caption: line, ...box,
      });
      trace.add(STATEMENT_LEAD.id, page.number, line.text.slice(0, 80), [box]);
    }
  }
  // A definition whole (statement.whole): what a reader sent to it reads.
  const leads = new Set([...statements.values()].map((s) => s.caption));
  for (const statement of statements.values()) {
    if (statement.kind !== "definition") continue;
    const page = layout.pages[statement.page - 1];
    const stops = (line: Line) => line.furniture || leads.has(line) || headings.has(line) || skip.has(line) || OTHER_LEAD.test(line.text)
      || line.size > 1.1 * layout.bodySize || inFloat(line, page);
    const lines = wholeOf(statement.caption, page.lines, stops);
    if (lines.length < 2) continue;
    const pad = 0.35 * statement.caption.size;
    const x0 = Math.max(0, Math.min(...lines.map((l) => l.x0)) - pad), x1 = Math.min(page.width, Math.max(...lines.map((l) => l.x1)) + pad);
    const y0 = Math.max(0, Math.min(...lines.map((l) => l.top)) - pad), y1 = Math.min(page.height, Math.max(...lines.map((l) => l.bottom)) + pad);
    statement.whole = { x: x0 / page.width, y: y0 / page.height, w: (x1 - x0) / page.width, h: (y1 - y0) / page.height };
    trace.add(STATEMENT_WHOLE.id, page.number, `${statement.label}: ${lines.length} lines`, [{ page: page.number, ...statement.whole }]);
  }
  return statements;
}

// What else a paper numbers as it numbers its statements, and sets as it
// sets them: a line opening with one is no part of the statement over it.
const OTHER_LEAD = /^\s*(?:Example|Remark|Note|Notation|Claim|Fact|Observation|Assumption|Conjecture|Axiom|Property|Problem|Exercise|Case)\s+(?:\d|[A-Z]\.?\d)[\w.]*\s*[.:(]/i;

// How much blank under a line of prose ends its paragraph, how far in a
// paragraph's first line may be set (a displayed formula is set further),
// how far a line may stand from the left edge and still begin there, how
// much blank may stand before an item of a list, all in the line's size;
// and how many lines a statement is followed for.
const PARAGRAPH_GAP = 0.6;
const INDENT = [0.8, 3];
const FLUSH = 0.5;
const ITEM_GAP = 1.5;
const ITEM_IN = 0.4;
const WHOLE_LINES = 30;
// A line that opens an item of a list: a bullet, or a number or letter
// in brackets or with a stop. (What follows a bracket can be a tall sign
// read apart from its line, and no space.)
const ITEM = /^\s*(?:[•◦▪■‣∙·∗*–—-]\s|\(?(?:\d{1,2}|[a-z]|[ivx]{1,4})\)|\d{1,2}\.\s)/;

// The lines of a statement, from the line it opens on: down its column to
// the end of its paragraph, through the formulas it displays, the lists it
// sets out and what it says after them. `stops` says which lines are
// something else's.
export function wholeOf(lead: Line, lines: Line[], stops: (line: Line) => boolean): Line[] {
  const whole = [lead];
  const size = lead.size;
  // The line that began the row being read (a row's other pieces, an
  // equation's number or a tall sign's own glyph, say nothing of where its
  // text stands), how far down what was read reaches, and how many rows.
  let row = lead, bottom = lead.bottom, rows = 1;
  let left = lead.x0;
  // Where a list's items begin, while one is being read; and whether the
  // row before was the list's.
  let list: number | null = null, listed = false;
  // A sign set tall (a big union, a brace) can be read as a line of its
  // own, a glyph and no more, a little off the row it is printed in: it
  // says nothing of where the text stands.
  const mark = (l: Line) => l.text.trim().length <= 1;
  for (let i = lead.index + 1; i < lines.length && rows < WHOLE_LINES; i += 1) {
    const line = lines[i];
    if (stops(line)) break;
    if (mark(line)) continue;
    // Reading on goes down the column. A line higher up begins the next,
    // unless it stands beside what was read: a formula's name or number,
    // set at the right of its row and read after the rows under it.
    if (line.top < row.top - 0.5 * size) {
      if (line.top < lead.bottom - 0.5 * size || line.bottom > bottom + 0.5 * size) break;
      whole.push(line);
      continue;
    }
    // A piece of the row's own baseline.
    if (line.top < bottom - 0.5 * size) { whole.push(line); bottom = Math.max(bottom, line.bottom); continue; }
    // No part of this column: what follows starts past its right edge.
    if (line.x0 > Math.max(...whole.map((l) => l.x1))) break;
    const body = rows > 1;
    const flush = (l: Line) => l.x0 <= left + FLUSH * size;
    // The blank over the line: under prose, measured from where a line of
    // its size ends, whatever a formula in it hangs below.
    const prose = flush(row) || listed;
    const blank = line.top - (prose ? Math.min(row.bottom, row.top + 1.1 * size) : bottom);
    const gap = blank > PARAGRAPH_GAP * size;
    const take = (inList: boolean) => {
      whole.push(line); row = line; left = Math.min(left, line.x0); bottom = Math.max(bottom, line.bottom); rows += 1; listed = inList;
    };
    // A list the statement sets out: its items, and under an item what is
    // set further in than its mark.
    const item = ITEM.test(line.text) && !flush(line);
    if (blank <= ITEM_GAP * size && (item || (list !== null && line.x0 >= list + ITEM_IN * size))) {
      if (item && (list === null || line.x0 < list)) list = line.x0;
      take(true);
      continue;
    }
    // Under a list, a line set where its items are and no item is the
    // text's again.
    if (list !== null && line.x0 >= list - 0.2 * size) break;
    list = null;
    const indent = line.x0 - left;
    const indented = body && indent >= INDENT[0] * size && indent <= INDENT[1] * size;
    const displayed = body && !flush(row) && !listed;
    // An end: blank under prose and prose again, or a first line set in,
    // under prose, under a list, or under a formula with blank after it.
    if (gap && !displayed && (flush(line) || indented)) break;
    if (indented && (!displayed || gap)) break;
    take(false);
  }
  return whole;
}

// The word a mention means, whole: "Def." and "Defn." are Definition,
// "Thm." Theorem, "Lemmata" Lemma. A statement is labelled by the same
// word and its number ("Definition 3.1").
const MEANT: [RegExp, string][] = [
  [/^def/i, "Definition"], [/^th/i, "Theorem"], [/^lem/i, "Lemma"], [/^prop/i, "Proposition"], [/^cor/i, "Corollary"],
];

// The numbers a mention lists, with where each sits: "Lemmas 2 and 3" is
// two, "Theorems 4.1–4.3" three (the middle one has no print of its own
// and points at the whole range).
function numbersIn(list: string): { number: string; start: number; end: number }[] {
  const out: { number: string; start: number; end: number }[] = [];
  const re = /(?:[A-Z]\.)?\d{1,3}(?:\.\d{1,3}){0,2}/g;
  let previous: { number: string; start: number; end: number } | null = null;
  let match: RegExpExecArray | null;
  while ((match = re.exec(list))) {
    const number = match[0];
    const start = match.index, end = start + number.length;
    if (previous && /^\s*(?:[-–—]|to)\s*$/.test(list.slice(previous.end, start))) {
      // A range counts in its last part, the parts before it the same.
      const [, stem, from] = /^(.*?)(\d+)$/.exec(previous.number)!;
      const [, toStem, to] = /^(.*?)(\d+)$/.exec(number)!;
      if (stem === toStem) for (let n = Number(from) + 1; n < Number(to) && n - Number(from) <= 20; n += 1) out.push({ number: `${stem}${n}`, start: previous.start, end });
    }
    out.push({ number, start, end });
    previous = { number, start, end };
  }
  return out;
}

// Mentions of statements (mention.statement), as links to where each opens.
export function findStatementMentions(flow: Flow, statements: Map<string, Found>, layout: Layout, trace: Trace): DocumentLink[] {
  const links: DocumentLink[] = [];
  // By the word and number it is headed with; where a paper states one
  // twice (in the text, and again in an appendix), the first.
  const headed = new Map<string, Found>();
  for (const statement of statements.values()) {
    const key = statement.label.toLowerCase();
    if (statement.kind !== "proof" && !headed.has(key)) headed.set(key, statement);
  }
  if (!headed.size) return links;
  const size = (page: number): [number, number] => [layout.pages[page - 1].width, layout.pages[page - 1].height];
  const re = new RegExp(MENTION_STATEMENT.pattern!.source, "gu");
  let match: RegExpExecArray | null;
  while ((match = re.exec(flow.text))) {
    const groups = match.groups!;
    const word = MEANT.find(([abbreviated]) => abbreviated.test(groups.kind))![1];
    const of = (number: string) => headed.get(`${word} ${number}`.toLowerCase());
    // A mention inside a citation, or of a cited work's part, is the cited
    // paper's, not this one's (mention.cited-locator, mention.cited-of).
    if (citedAway(flow.text, match.index, match.index + match[0].length)) {
      trace.add(MENTION_CITED.id, 0, match[0], []);
      continue;
    }
    const listStart = match.index + match[0].length - groups.list.length;
    const items = numbersIn(groups.list);
    // The head of a statement is not a pointer to itself: its word is the
    // first on the line it opens on.
    const first = flow.at[match.index];
    const own = items[0] && of(items[0].number);
    if (first && own && own.caption === first.line && !/\p{L}/u.test(first.line.text.slice(0, Math.max(0, first.char)))) continue;
    items.forEach((item, index) => {
      const statement = of(item.number);
      if (!statement) return;
      // The first number takes the word before it: "Def. 3.1" is one
      // thing to press.
      const from = index === 0 ? match!.index : listStart + item.start;
      const boxes = boxesOf(flow, from, listStart + item.end, size);
      for (const box of boxes) links.push({ float: statement.key, label: groups.list.slice(item.start, item.end).trim(), ...box });
      trace.add(MENTION_STATEMENT.id, boxes[0]?.page ?? 0, `${groups.kind} ${item.number}`, boxes);
    });
  }
  return links;
}
