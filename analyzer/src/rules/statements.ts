// Theorems, lemmas, definitions and proofs: where each one opens. A
// statement is kept as a float of kind `theorem`, `lemma`, `definition` or
// `proof` whose box is the line it opens on, so the viewer's nav bar can
// mark it as it marks a figure (cloudflare/src/papers/reading.ts).
// Propositions and corollaries are theorems: they are the same kind of
// claim, and a reader looking for what a paper proves wants all three.

import type { Found } from "./floats";
import type { Layout, Line } from "./layout";
import { STATEMENT_LEAD } from "./registry";
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
export function findStatements(layout: Layout, skip: Set<Line>, floats: Iterable<Found>, trace: Trace): Map<string, Found> {
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
      const proof = /^p/i.test(word);
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
      statements.set(`${kind}\n${page.number}\n${line.index}`, {
        key: `t${statements.size}`, kind, label: number ? `${name} ${number}` : name, caption: line, ...box,
      });
      trace.add(STATEMENT_LEAD.id, page.number, line.text.slice(0, 80), [box]);
    }
  }
  return statements;
}
