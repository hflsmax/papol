// Theorems, lemmas, definitions and proofs: where each one opens. A
// statement is kept as a float of kind `theorem`, `lemma`, `definition` or
// `proof` whose box is the line it opens on, so the viewer's nav bar can
// mark it as it marks a figure (cloudflare/src/papers/reading.ts).
// Propositions and corollaries are theorems: they are the same kind of
// claim, and a reader looking for what a paper proves wants all three.

import type { Found } from "./floats";
import type { Layout, Line } from "./layout";
import { STATEMENT_LEAD, STATEMENT_WHOLE } from "./registry";
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
    const stops = (line: Line) => line.furniture || leads.has(line) || headings.has(line) || skip.has(line)
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

// How much blank under a line of prose ends its paragraph, how far in a
// paragraph's first line may be set (a displayed formula is set further),
// how far a line may stand from the left edge and still begin there, all in
// the line's size; and how many lines a statement is followed for.
const PARAGRAPH_GAP = 0.6;
const INDENT = [0.8, 3];
const FLUSH = 0.5;
const WHOLE_LINES = 30;

// The lines of a statement, from the line it opens on: down its column to
// the end of its paragraph, through the formulas it displays and what it
// says after them. `stops` says which lines are something else's.
export function wholeOf(lead: Line, lines: Line[], stops: (line: Line) => boolean): Line[] {
  const whole = [lead];
  let left = lead.x0;
  for (let i = lead.index + 1; i < lines.length && whole.length < WHOLE_LINES; i += 1) {
    const line = lines[i], last = whole[whole.length - 1];
    const size = lead.size;
    if (stops(line)) break;
    // Reading on goes down the column; a line higher up begins the next.
    if (line.top < last.top - 0.5 * size) break;
    // A piece of the last line's own baseline (an equation's number).
    if (line.top < last.bottom - 0.5 * size) { whole.push(line); continue; }
    // No part of this column: what follows starts past its right edge.
    if (line.x0 > Math.max(...whole.map((l) => l.x1))) break;
    const flush = (l: Line) => l.x0 <= left + FLUSH * size;
    const body = whole.length > 1;
    const indent = line.x0 - (body ? left : Math.min(left, line.x0));
    const indented = indent >= INDENT[0] * size && indent <= INDENT[1] * size;
    const gap = line.top - last.bottom > PARAGRAPH_GAP * size;
    const displayed = body && !flush(last);
    // A paragraph's end: blank under prose and prose again, or a first
    // line set in, under prose or under a formula with blank after it.
    if (gap && !displayed && (flush(line) || indented)) break;
    if (body && indented && (!displayed || gap)) break;
    if (!body) left = Math.min(left, line.x0);
    whole.push(line);
  }
  return whole;
}
