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

// The runs the first `length` characters of a line come from.
function runsOver(line: Line, from: number, length: number) {
  const runs = new Set<number>();
  for (const { run } of line.chars.slice(from, from + length)) if (run >= 0) runs.add(run);
  return [...runs].map((i) => line.runs[i]);
}

// Every statement (statement.lead): a line opening with the word, set apart
// from the text by its face. `skip` holds the bibliography's lines, which
// open a statement only by a face of their own (see below); nothing inside a figure or table opens a statement
// either — a rule set in a figure headed "Definition" is part of the figure.
export function findStatements(layout: Layout, skip: Set<Line>, floats: Iterable<Found>, trace: Trace): Map<string, Found> {
  const statements = new Map<string, Found>();
  const within = [...floats];
  const inFloat = (line: Line, page: Page) => within.some((f) => f.page === page.number
    && line.x0 / page.width >= f.x - 0.001 && line.x1 / page.width <= f.x + f.w + 0.001
    && line.top / page.height >= f.y - 0.001 && line.bottom / page.height <= f.y + f.h + 0.001);
  for (const page of layout.pages) {
    for (const line of page.lines) {
      if (line.furniture) continue;
      const match = STATEMENT_LEAD.pattern!.exec(line.text);
      if (!match?.groups) continue;
      const { word, number, stop } = match.groups;
      const at = match[0].indexOf(word);
      const face = runsOver(line, at, word.length);
      if (!face.length) continue;
      const letters = word.replace(/\s/g, "");
      const capitals = letters === letters.toUpperCase();
      const bold = face.every((r) => r.bold);
      const italic = face.every((r) => r.italic);
      // acmart sets the word in small capitals of the text's own font, which
      // read as the text does; what sets it apart there is what follows: a
      // theorem's words in italic, or, for a proof, nothing needed — no
      // sentence opens a line with "Proof." but a proof.
      const rest = runsOver(line, match[0].length, line.text.length).filter((r) => /\p{L}/u.test(r.text));
      const italicAfter = !italic && rest.length > 0 && rest[0].italic;
      const proof = /^p/i.test(word);
      const set = bold || italic || capitals || Boolean(stop && (proof || italicAfter));
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
      if (inFloat(line, page)) continue;
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
