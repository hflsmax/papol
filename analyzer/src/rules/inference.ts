// Named inference rules: where each one is defined, and the places in the
// text that name it. A programming-language paper sets its typing and
// reduction rules in a figure, each labelled with a name ("T-App",
// "[LT-IF]", "(BIND)", "Cut", "E Beta"), and cites the names throughout
// its prose. A rule is kept as a float of kind `rule` whose box is the
// rule as set — its premises, bar and conclusion around the label — so a
// link to it is stored and followed like a link to a figure, and a clip
// of it shows the rule whole (cloudflare/src/papers/reading.ts).
//
// The shape of a name is the least stable thing about a rule: small
// capitals reach the text layer in lowercase or in capitals by font, LNCS
// puts a space where acmart puts a hyphen, Sequent Core uses a bare word.
// What is stable is the setting — how the label stands to its rule — and
// that one paper sets every label the same way. So a label is read in
// passes: a token set apart (rule.candidate); its setting to the nearest
// bar and its row, which is its category (rule.setting); what a name may
// look like in that category (rule.name.*); whether the paper sets its
// labels that way (rule.convention); and what stands like a label but is
// a comment, a heading or a cell (rule.heading, rule.cell).

import type { DocumentLink } from "../../../cloudflare/src/papers/reading";
import { citedAway } from "./cited";
import { typeOf, type Found, type Type } from "./floats";
import { boxesOf, type Flow, type Layout, type Line } from "./layout";
import type { Drawn } from "./page";
import {
  RULE_BAR,
  RULE_BOX, RULE_CANDIDATE, RULE_CELL, RULE_CONVENTION, RULE_DERIVATION, RULE_HEADING, RULE_MENTION, RULE_NAME_BESIDE, RULE_NAME_LETTERS,
  RULE_NAME_MARGIN, RULE_NAME_OVER, RULE_NAME_ROW, RULE_SETTING, RULE_SHAPE_HYPHEN, RULE_SHAPE_SPACED, RULE_SHAPE_SYMBOL, RULE_SHAPE_WORD,
} from "./registry";
import type { Trace } from "./trace";

export type Shape = "hyphen" | "spaced" | "word" | "symbol";
export type Category = "beside" | "over" | "row" | "margin";

export interface Rule extends Found {
  name: string; // as printed at its label, without brackets
  shape: Shape;
  bracketed: boolean; // the label is in brackets
  category: Category;
  labels: Line[]; // every line that labels a rule by this name
}

type Page = Layout["pages"][number];

// How far a label stands from the rest of its line, in its size, to be set
// apart from it (rule.candidate). How far a bar may be from a label, in
// the text's leading, and how far beside its bar a rule's lines may begin
// or end, in the label's size; a label stands up to twice that from its
// bar's end (rule.setting). How much blank two lines of
// one rule may have between them, in their size, and how many lines a
// rule reaches from its label (rule.box). How wide a rule's bar may be, in
// the page's width: a table's rule spans the column (rule.cell). How much
// larger than the body a label may be (rule.name.letters).
const APART = 1;
const NEAR_BAR = 1.5;
const LEVEL = 0.6; // sizes a bar may stand from a label's middle and be beside it
const BESIDE = 1;
const TOUCH = 0.35;
const REACH = 4; // leadings from the label a rule's lines may reach: a stack of four premises
const PAD = 2;
const BAR_SHARE = 0.92; // of the text column: a wider bar needs its conclusion centred under it
const OVER_REACH = 6; // leadings a label over its premises may stand from the bar
const LABEL_SIZE = 1.2;

const keyOf = (name: string) => name.toLowerCase().replace(/[‐‑–]/g, "-").replace(/\s+/g, " ");

// ------------------------------------------------------------ pass 1: candidates

interface Token {
  text: string; // the name as printed, without brackets or a trailing colon
  bracketed: boolean;
  colon: boolean; // set off by a colon after it ("Load:")
  side: "whole" | "head" | "tail"; // the whole line, or its head or tail set apart
  start: number; // in the line's text
  end: number;
}

// A token begins with a letter or digit, or with the connectives of a
// symbol name (→L, ∀R, ×T) where a capital follows them; it may end in a
// sign (WF-var+), a parenthesised tag (Choice(L)) or a spaced capital,
// digit or arrow (Val T, Interchange 1, Propagate ↓).
// A capital as a rule name has it: in the text's face, or a mathematical
// bold or italic one (𝑇 in ×𝑇); a Greek letter likewise (𝛽 in 𝛽 Box).
const CAP = "A-Z\\u{1D400}-\\u{1D419}\\u{1D434}-\\u{1D44D}\\u{1D468}-\\u{1D481}";
const GREEK = "\\p{Script=Greek}\\u{1D6A8}-\\u{1D7CB}";
const CONNECTIVE = "→⇒⇓∀∃⊢⊗⊕⊸∧∨¬<:=×+&∼⋍≃≈≡⊲⊳▷◁";
const TOKEN = `(?:(?:[A-Z]{1,2}|[${GREEK}]) (?=[${CAP}]))?(?:[\\p{L}\\d]|[${CONNECTIVE}]{1,2}(?=[${CAP}\\d∞]))[\\p{L}\\d\\p{Co}'′<:=→⇒⇓∀∃⊢⊗⊕⊸~*∧∨¬|/_\\-‐‑–∞]{0,23}[+−±†‡♠♣♦?!↓↑]?(?:\\([\\p{L}\\d]{1,4}\\)| (?:[${CAP}]{1,2}|\\d{1,2}|[↓↑]))?`;
const WHOLE = new RegExp(`^\\s*(?:(?<open>[\\[(])\\s*)?(?<token>${TOKEN})(?<colon>:)?(?:\\s*(?<close>[\\])]))?\\s*$`, "u");
const HEAD = new RegExp(`^\\s*(?:(?<open>[\\[(])\\s*)?(?<token>${TOKEN})(?<colon>:)?(?:\\s*(?<close>[\\])]))?(?=\\s)`, "u");
const TAIL = new RegExp(`(?<=\\s)(?:(?<open>[\\[(])\\s*)?(?<token>${TOKEN})(?<colon>:)?(?:\\s*(?<close>[\\])]))?\\s*$`, "u");
// A name as its shape is judged: mathematical letters folded to the
// plain ones (×𝑇 is ×T, 𝜂-Red is η-Red).
const fold = (text: string) => text.normalize("NFKC");

// Where a character of a line begins and ends across the page.
function edgesOf(line: Line, char: number): [number, number] | null {
  const ref = line.chars[char];
  if (!ref || ref.run < 0) return null;
  const run = line.runs[ref.run];
  const at = (i: number) => run.offsets?.[i] ?? (run.width * i) / Math.max(run.text.length, 1);
  return [run.x + at(ref.at), run.x + at(ref.at + 1)];
}

// The blank between a stretch of a line and the nearest printed character
// past it, in points: the label's distance from the rest of the line.
function blankAfter(line: Line, end: number): number {
  const last = edgesOf(line, end - 1);
  let next: [number, number] | null = null;
  for (let i = end; i < line.text.length && !next; i += 1) if (!/\s/.test(line.text[i])) next = edgesOf(line, i);
  return last && next ? next[0] - last[1] : Infinity;
}
function blankBefore(line: Line, start: number): number {
  const first = edgesOf(line, start);
  let prev: [number, number] | null = null;
  for (let i = start - 1; i >= 0 && !prev; i -= 1) if (!/\s/.test(line.text[i])) prev = edgesOf(line, i);
  return first && prev ? first[0] - prev[1] : Infinity;
}

// A token could be a label: a letter in it, brackets that pair, not a
// number, a citation or a word ending a sentence (rule.candidate).
// The fonts that hold the pieces of large braces and brackets: a piece
// set at a label's end reaches the text as a letter ("m-typen").
const EXTENSION = /exs$|cmex|MathExt|Extension/i;
// The symbol fonts: a letter read from one is a bracket or an operator
// drawn as that letter ("J" and "K" for the ⟦ ⟧ of a denotation).
const SYMBOLIC = /stmary|symbol|txsy|cmsy|msam|msbm|esint|wasy|rsfs|MnSymbol/i;

function tokenOf(line: Line): Token | null {
  const text = line.text.split("").map((c, i) => (line.chars[i]?.run >= 0 && EXTENSION.test(line.runs[line.chars[i].run].font) ? " " : c)).join("");
  const found = (match: RegExpExecArray | null, side: Token["side"]): Token | null => {
    if (!match?.groups) return null;
    const { open, close, token, colon } = match.groups;
    if (Boolean(open) !== Boolean(close)) return null;
    if (open && close && "[(".indexOf(open) !== "])".indexOf(close)) return null;
    // A letter in it, unless it opens with a connective (⋍0); not a
    // number or a citation.
    if ((!/\p{L}/u.test(token) && !new RegExp(`^[${CONNECTIVE}]`, "u").test(token)) || /^\d+$/.test(token) || /^[A-Z][A-Za-z]*\d{2,4}[a-z]?$/.test(token)) return null;
    // One opening with a letter whose letters are all mathematical
    // alphanumerics is a formula (𝑒0, 𝜇𝐹); ×𝑇 and 1𝐼 open otherwise.
    if (/^\p{L}/u.test(token) && !/\p{L}/u.test(token.replace(/[\u{1D400}-\u{1D7FF}]/gu, ""))) return null;
    const start = match.index + match[0].indexOf(token);
    const font = (i: number) => (line.chars[i]?.run >= 0 ? line.runs[line.chars[i].run].font : "");
    if (/\p{L}/u.test(token[0]) && SYMBOLIC.test(font(start))) return null;
    return { text: token, bracketed: Boolean(open), colon: Boolean(colon), side, start, end: start + token.length };
  };
  const whole = found(WHOLE.exec(text), "whole");
  if (whole) return whole;
  const headMatch = HEAD.exec(text);
  const head = found(headMatch, "head");
  if (head && headMatch && (head.colon || blankAfter(line, headMatch.index + headMatch[0].trimEnd().length) >= APART * line.size)) return head;
  const tailMatch = TAIL.exec(text);
  const tail = found(tailMatch, "tail");
  if (tail && tailMatch && blankBefore(line, tailMatch.index + tailMatch[0].length - tailMatch[0].trimStart().length) >= APART * line.size) return tail;
  return null;
}

// ------------------------------------------------------------ pass 2: setting

interface Setting {
  category: Category | "cell" | "group" | "comment" | "none";
  bar: Drawn | null;
  row: Line[]; // the lines level with the label, in its column
  side: "left" | "right" | "over"; // where the label stands to its rule
  other?: Setting; // beside a bar on either side: the setting on the other side
  derived?: boolean; // the bar is a step of a derivation, not a rule's definition
  step?: Drawn | null; // the wider bar under it the conclusion leads into: a step, unless that bar has a label
}

const tolerance = (a: { size: number }, b: { size: number }) => TOUCH * Math.min(a.size, b.size);
const level = (a: Line, b: Line) => a.top <= b.bottom + tolerance(a, b) && b.top <= a.bottom + tolerance(a, b);
// Sharing most of its height with the label: on its row, not the line
// under it that merely touches.
const onRow = (a: Line, b: Line) => Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) >= 0.5 * Math.min(a.size, b.size);

// Two lines are in one column: on a two-column page, on the same side of
// the middle.
// Whether a page's text runs in two columns: judged so by the layout, with
// no line of running text across the middle (a one-column page is judged
// two-column when a figure on it sets things side by side).
const columns = new WeakMap<Page, boolean>();
function twoColumn(page: Page): boolean {
  let two = columns.get(page);
  if (two === undefined) {
    const middle = page.width / 2;
    two = page.twoColumn && !page.lines.some((l) => !l.furniture && l.text.length >= 40 && l.x0 < middle - 0.1 * page.width && l.x1 > middle + 0.1 * page.width);
    columns.set(page, two);
  }
  return two;
}

function sameColumn(page: Page, a: Line, b: Line): boolean {
  if (!twoColumn(page)) return true;
  const middle = page.width / 2;
  const gutter = 0.02 * page.width;
  const left = (l: Line) => l.x1 <= middle + gutter;
  const right = (l: Line) => l.x0 >= middle - gutter;
  return !((left(a) && right(b)) || (right(a) && left(b)));
}

// The lines a rule may be made of: not furniture, not the label, near the
// label's size (a page whose broken font reads as 120pt does not reach
// into a rule).
const ruleLines = (page: Page, label: Line) => page.lines.filter((l) => !l.furniture && l !== label && l.size <= 2 * label.size && /[^\s\p{C}]/u.test(l.text));

// What a line level with a bracketed word says when the word comments a
// grammar production: the production itself, or a "|" alternative under
// one within a few lines at the production's own indent ("| f" in "H | f"
// is a heap).
const GRAMMAR = /⩴|::=|∷=|∶∶=|:=[^|]*\|/u;
function production(line: Line, page: Page, type: Type, depth = 0): boolean {
  if (GRAMMAR.test(line.text)) return true;
  if (!/^\s*\|/.test(line.text) || depth > 12) return false;
  const over = (l: Line) => Math.abs(l.x0 - line.x0) <= 4 * line.size && l.top < line.top && l.top >= line.top - 1.5 * type.leading;
  return page.lines.some((l) => over(l) && (GRAMMAR.test(l.text) || production(l, page, type, depth + 1)))
    || page.lines.some((l) => GRAMMAR.test(l.text) && Math.abs(l.x0 - line.x0) <= 4 * line.size && l.top < line.top && l.top >= line.top - 4 * type.leading);
}

// The edges of the text column a line is in: the furthest lines of
// running text over or under it reach.
function columnSpan(page: Page, line: Line): [number, number] | null {
  const text = page.lines.filter((l) => !l.furniture && l.text.length >= 40 && sameColumn(page, l, line));
  return text.length ? [Math.min(...text.map((l) => l.x0)), Math.max(...text.map((l) => l.x1))] : null;
}
const columnRight = (page: Page, line: Line) => columnSpan(page, line)?.[1] ?? null;

// A stroke drawn across or down the page: a path, or the thin image some
// TeX engines paint a rule as.
const across = (d: Drawn) => d.h <= 1.5 && d.w > d.h;
const upright = (d: Drawn) => d.w < 1.5 && d.h > d.w;

// A horizontal line with a vertical one standing at either end, or as
// wide as a rectangle drawn round it: the edge of a box drawn round a
// judgement form or a diagram's cell, not a rule's bar. One with a small
// mark at an end is an arrow.
function framed(page: Page, d: Drawn): boolean {
  const ends = (v: Drawn) => Math.abs(v.x - d.x) <= 1 || Math.abs(v.x + v.w - d.x - d.w) <= 1;
  const through = (v: Drawn) => v.y <= d.y + 1 && v.y + v.h >= d.y - 1;
  return page.drawn.some((v) => v !== d && through(v)
    && ((upright(v) && v.h >= 3 && ends(v))
      || (v.w > 1.5 && v.h > 1.5 && Math.abs(v.x - d.x) <= 1.5 && Math.abs(v.x + v.w - d.x - d.w) <= 1.5)
      || (v.w > 1.5 && v.w <= 8 && v.h > 1.5 && v.h <= 8 && (Math.abs(v.x - d.x - d.w) <= 2 || Math.abs(v.x + v.w - d.x) <= 2))));
}

// A line drawn just under a line of text, from its first letter or to its
// last: an underline, not a bar (a premise stands clear of its bar).
function underline(page: Page, d: Drawn): boolean {
  return page.lines.some((l) => !l.furniture && l.x0 <= d.x + 1 && l.x1 >= d.x + d.w - 1 && (Math.abs(l.x0 - d.x) <= 0.8 || Math.abs(l.x1 - d.x - d.w) <= 0.8)
    && d.y > l.bottom - 0.22 * l.size && d.y <= l.bottom + 0.05 * l.size);
}

// A line drawn through a line of running text: a leader or a rule set
// inline, not a bar.
const prose = (l: Line, type: Type) => !l.furniture && l.text.length >= 40 && faceOf(l) === family(type.font);
function inProse(page: Page, d: Drawn, type: Type): boolean {
  return page.lines.some((l) => prose(l, type) && l.top + 0.3 * l.size < d.y && l.bottom - 0.3 * l.size > d.y && l.x0 < d.x + d.w && l.x1 > d.x);
}

// A bar is a step of a derivation tree, not a rule's definition, where a
// narrower bar stands within its span just over it with a line between
// touching both and as wide as the upper bar: that line is the upper
// step's conclusion and this step's premise (rule.derivation); an accent
// drawn over part of a premise is no bar.
// Or a wider bar stands just under it spanning it with a line between:
// this step's conclusion is the lower step's premise.
// For a label over its bar the upper bar stands under the label (`from`):
// a heading's underline over the label is no step.
function derivation(page: Page, bar: Drawn, lines: Line[], type: Type, slack: number, from = -Infinity): boolean {
  return page.drawn.some((d) => d !== bar && across(d) && d.y > from && d.y < bar.y - 2 && d.y >= bar.y - 2.2 * type.leading
    && d.x >= bar.x - slack && d.x + d.w <= bar.x + bar.w + slack && d.w < bar.w
    && lines.some((l) => l.top >= d.y - 1 && l.bottom <= bar.y + 1 && l.bottom >= bar.y - 0.8 * type.leading && l.x0 >= d.x - 1 && l.x1 <= d.x + d.w + 1));
}
// The wider bar a step's conclusion leads into, where no label of its
// own names that bar (findRules knows): a rule's own bar set right under
// another's conclusion is not a step.
function stepInto(page: Page, bar: Drawn, lines: Line[], type: Type, slack: number): Drawn | null {
  return page.drawn.find((d) => d !== bar && across(d) && d.y > bar.y + 2 && d.y <= bar.y + 2.2 * type.leading
    && d.x <= bar.x + slack && d.x + d.w >= bar.x + bar.w - slack && d.w > bar.w
    && lines.some((l) => l.top >= bar.y - 1 && l.top <= bar.y + 0.8 * type.leading && l.bottom <= d.y + 1 && l.bottom >= d.y - 0.6 * type.leading && l.x0 >= bar.x - 1 && l.x1 <= bar.x + bar.w + 1)) ?? null;
}

// What stands at a row's end names a rule only where the row is one: a
// relation between its sides (an arrow, a turnstile, an equation), not a
// table's numbers or a paragraph's words.
const RELATION = /[→⟶↦⟼⇒⟹⇛⤇⇓⇝↝⤳⇐⊢⊨⊩⊑⊆≡≜≔=∼≈⊕⊗∗⊸⊳⊲▷◁]|->|=>|~>|<:|:>|::=/u;

// A relation between two terms, a blank on each side of it.
const BETWEEN = new RegExp(`(?:^|\\s)(?:${RELATION.source})(?:\\s|$)`, "u");

// A figure's or table's caption under a rule concludes nothing.
const CAPTION = /^\s*(?:Fig(?:ure)?|Table|Listing)\.?\s*\d/i;

// A listing's face: a word at the head of a row set in it is code.
const MONO = /mono|consol|courier|typewriter|cmtt|lmtt|menlo|firacode|sourcecodepro|dejavusansm/i;

// A vertical rule drawn beside the label, on its row: a table's.
function ruledAside(page: Page, label: Line, span: [number, number], type: Type): boolean {
  const mid = (label.top + label.bottom) / 2;
  return page.drawn.some((d) => upright(d) && d.h >= label.size && d.h <= 3 * type.leading && d.y <= mid && d.y + d.h >= mid && !boxSide(page, d, label)
    && d.x >= span[0] - 3 * label.size && d.x <= span[1] + 3 * label.size);
}
// Where a token stands across the page: the line's extent for a whole
// line, the token's own characters for its head or tail.
function spanOf(label: Line, token: Token): [number, number] {
  if (token.side === "whole") return [label.x0, label.x1];
  const first = edgesOf(label, token.start), last = edgesOf(label, token.end - 1);
  return [first?.[0] ?? label.x0, last?.[1] ?? label.x1];
}

// An upright stroke closed by a stroke across at each end is the side of
// a box no taller than two lines: a judgment's form set in a box beside
// its rules, not a table's rule.
function boxSide(page: Page, d: Drawn, label: Line): boolean {
  if (d.h >= 3 * label.size) return false;
  const closes = (y: number) => page.drawn.some((h) => across(h) && Math.abs(h.y - y) <= 1 && h.x <= d.x + 1 && h.x + h.w >= d.x - 1);
  return closes(d.y) && closes(d.y + d.h);
}

// A vertical stroke or a box's edge crossing the label's row between the
// label and its row: the row is a diagram's other panel or a listing's.
function walled(page: Page, label: Line, span: [number, number], row: Line[]): boolean {
  const mid = (label.top + label.bottom) / 2;
  const x0 = Math.min(label.x0, ...row.map((l) => l.x0)), x1 = Math.max(label.x1, ...row.map((l) => l.x1));
  const edges = (d: Drawn) => (upright(d) && d.h >= label.size && !boxSide(page, d, label) ? [d.x] : d.w > 1.5 && d.h >= 3 * label.size ? [d.x, d.x + d.w] : []);
  return page.drawn.some((d) => d.y <= mid && d.y + d.h >= mid && edges(d).some((x) => x > x0 + 1 && x < x1 - 1 && (x >= span[1] - 1 || x <= span[0] + 1)));
}

// How a token stands to notation: beside a bar, over it, at the end of a
// row, at the margin (rule.setting); or as a cell, a group heading or a
// comment (rule.cell, rule.heading).
function settingOf(page: Page, label: Line, token: Token, type: Type): Setting {
  const lines = ruleLines(page, label);
  if (CAPTION.test(label.text)) return { category: "none", bar: null, row: [], side: "right" };
  const slack = BESIDE * label.size;
  const mid = (label.top + label.bottom) / 2;
  const centre = (label.x0 + label.x1) / 2;
  const column = columnSpan(page, label) ?? (type.columns.find((c) => c.x0 <= centre && centre <= c.x1) ?? type.text);
  const measure = Array.isArray(column) ? column[1] - column[0] : column.x1 - column.x0;
  const wide = BAR_SHARE * measure;
  const widest = measure + 3 * label.size;
  // A bar as wide as the text could be a figure's own rule: it is a rule's
  // only with a conclusion centred under it and clearly shorter.
  const concluded = (d: Drawn) => lines.some((l) => !CAPTION.test(l.text) && l.top >= d.y - 1 && l.top <= d.y + 2 * type.leading && l.x0 < d.x + d.w && l.x1 > d.x
    && Math.abs((l.x0 + l.x1) / 2 - (d.x + d.w / 2)) <= 2 * label.size && l.x1 - l.x0 <= 0.8 * d.w);
  // ... or with the label standing beside it, level with it.
  const besides = (d: Drawn) => Math.abs(d.y - mid) <= LEVEL * label.size && (d.x >= label.x1 - slack || d.x + d.w <= label.x0 + slack);
  // What counts as a rule's bar (rule.bar).
  // A short bar (an axiom's, as wide as its one-symbol conclusion) is a
  // bar only level with the label or under it; a stroke that touches the
  // line over it is a bar only with a conclusion centred under it.
  const near = page.drawn.filter((d) => across(d) && d.w <= widest && (d.w >= 2 * label.size || (d.w >= 1.3 * label.size && (besides(d) || d.y >= label.bottom - 1)))
    && (d.w <= wide || concluded(d) || besides(d))
    && d.y >= label.top - OVER_REACH * type.leading && d.y <= label.bottom + OVER_REACH * type.leading
    && d.x <= label.x1 + 2 * slack && d.x + d.w >= label.x0 - 2 * slack && !framed(page, d) && (!underline(page, d) || concluded(d)) && !inProse(page, d, type));
  const bars = near.filter((d) => d.y >= label.top - NEAR_BAR * type.leading && d.y <= label.bottom + NEAR_BAR * type.leading)
    .sort((a, b) => Math.abs(a.y - mid) - Math.abs(b.y - mid));
  // The nearest bar under the label, for a label standing over its premises.
  const aside = (d: Drawn) => Math.abs(d.x + d.w / 2 - (label.x0 + label.x1) / 2);
  const below = near.filter((d) => d.y >= label.bottom - 1).sort((a, b) => (Math.abs(a.y - b.y) > 1 ? a.y - b.y : aside(a) - aside(b)));
  let row = lines.filter((l) => onRow(l, label) && sameColumn(page, l, label));
  // A conclusion stands under a bar; an axiom's has nothing over it.
  // The conclusion sits within the bar's span, the bar being as wide as
  // the widest of premises and conclusion: a plot's tick labels and a
  // caption run past a legend's line sample.
  const concluded1 = (bar: Drawn) => {
    const spans = (l: Line) => l.x0 < bar.x + bar.w && l.x1 > bar.x;
    return lines.some((l) => spans(l) && !CAPTION.test(l.text) && l.top >= bar.y - 1 && l.top <= bar.y + 2 * type.leading && l.x0 >= bar.x - 2 * label.size && l.x1 <= bar.x + bar.w + 2 * label.size);
  };
  // A token between two rules of one span, the upper right over it, sits
  // in a table's header band (rule.cell).
  const banded = page.drawn.some((top) => across(top) && top.y < label.top && top.y >= label.top - 0.8 * type.leading && top.x <= label.x0 + 1 && top.x + top.w >= label.x1 - 1 && !framed(page, top)
    && page.drawn.some((b) => b !== top && across(b) && b.y > label.bottom - 1 && b.y <= label.bottom + 2 * type.leading && Math.abs(b.x - top.x) <= 1 && Math.abs(b.w - top.w) <= 1 && top.w >= 4 * label.size));
  if (banded) return { category: "cell", bar: null, row, side: "over" };
  const beside: Setting[] = [];
  for (const bar of bars) {
    if (!concluded1(bar)) continue;
    if (Math.abs(bar.y - mid) <= LEVEL * label.size) {
      // Level with the bar: beside it, or a cell over a table's rule.
      if (label.x0 < bar.x + bar.w - slack && label.x1 > bar.x + slack) return { category: "cell", bar, row, side: "over" };
      const right = bar.x + bar.w <= label.x0 + slack;
      // A word set into a rule, the bar touching it on both sides, heads a
      // group ("——— Structural ———"); a rule's label has a gap on its side.
      const touching = (d: Drawn) => across(d) && Math.abs(d.y - bar.y) <= 1
        && (Math.abs(d.x - label.x1) <= TOUCH * label.size || Math.abs(d.x + d.w - label.x0) <= TOUCH * label.size);
      const goesOn = touching(bar) && page.drawn.some((d) => d !== bar && touching(d));
      if (goesOn) return { category: "group", bar, row, side: right ? "right" : "left" };
      beside.push({ category: "beside", bar, row, side: right ? "right" : "left", derived: derivation(page, bar, lines, type, slack), step: stepInto(page, bar, lines, type, slack) });
    }
  }
  // Level with a bar on either side (TypeWhich sets Id's rule, "Const" and
  // its rule on one row), the label stands on the side the paper's other
  // labels do: findRules picks, so the other side is kept.
  if (beside.length) {
    const other = beside.find((s) => s.side !== beside[0].side);
    return other ? { ...beside[0], other } : beside[0];
  }
  // On its own line over the premises, aligned with the rule's left edge
  // or its middle: mathpar's label, as far up as the premises stack.
  for (const bar of below) {
    const spans = (l: Line) => l.x0 < bar.x + bar.w && l.x1 > bar.x;
    const under = concluded1(bar);
    const fits = (l: Line) => l.x0 >= bar.x - 2 * label.size && l.x1 <= bar.x + bar.w + 2 * label.size;
    // The conclusion under the bar fits it: a table's header runs past
    // the rule over its column.
    const spanning = lines.filter((l) => spans(l) && !CAPTION.test(l.text) && l.top >= bar.y - 1 && l.top <= bar.y + 2 * type.leading);
    const first = Math.min(...spanning.map((l) => l.top));
    const concluding = spanning.filter((l) => l.top <= first + 0.5 * type.leading);
    // Nothing else on the label's row reaches over the bar, a bracketed
    // heading at the margin aside ("(Moving)") and the premises the
    // label heads ("Assume  Γ ⊨ e ⇓ z"); accents and braces the layout
    // sets as lines of their own block nothing.
    const blocks = (l: Line) => spans(l) && /[\p{L}\d]/u.test(l.text) && !/^\s*[[(].*[\])]\s*$/.test(l.text) && (l.x0 < label.x1 - tolerance(l, label) || !fits(l) || !RELATION.test(l.text) || GRAMMAR.test(l.text));
    const heads = row.some((l) => spans(l) && RELATION.test(l.text) && l.x0 >= label.x1 - tolerance(l, label) && fits(l));
    const aligned = Math.abs(label.x0 - bar.x) <= 2 * label.size || Math.abs((label.x0 + label.x1) / 2 - (bar.x + bar.w / 2)) <= 2 * label.size
      || (heads && label.x0 >= bar.x - 2 * label.size && label.x1 <= bar.x + bar.w);
    // The premises between the label and the bar stand over the bar; a
    // listing's lines run past a rule drawn under it.
    const between = lines.filter((l) => l.top >= label.bottom - tolerance(l, label) && l.bottom <= bar.y + 1 && spans(l));
    const overhangs = between.some((l) => !fits(l)) || concluding.some((l) => !fits(l));
    // No other bar between the label and this one spans the label: the
    // label is that rule's, or its premise.
    const barred = page.drawn.some((d) => d !== bar && across(d) && d.w >= 2 * label.size && d.y > label.bottom - 1 && d.y < bar.y && d.x < label.x1 && d.x + d.w > label.x0
      && !lines.some((l) => l.top < d.y && d.y < l.bottom && l.x0 <= d.x + 1 && d.x + d.w <= l.x1 + 1));
    if (under && token.side === "whole" && aligned && !overhangs && !barred && !row.some(blocks)) return { category: "over", bar, row, side: "over", derived: derivation(page, bar, lines, type, slack, label.bottom - 1), step: stepInto(page, bar, lines, type, slack) };
  }
  // Under the conclusion, its edge at the bar's: the bar just over the
  // label with a conclusion between, nothing on the label's row over it.
  if (token.side === "whole") {
    for (const bar of bars) {
      if (bar.y >= label.top || !concluded1(bar)) continue;
      const spans = (l: Line) => l.x0 < bar.x + bar.w && l.x1 > bar.x;
      const conclusion = lines.filter((l) => spans(l) && l.top >= bar.y - 1 && l.top <= bar.y + 2 * type.leading);
      if (!conclusion.length || Math.min(...conclusion.map((l) => l.top)) >= label.top || label.top - Math.max(...conclusion.map((l) => l.bottom)) > type.leading) continue;
      const right = Math.abs(label.x1 - bar.x - bar.w) <= 2 * slack, left = Math.abs(label.x0 - bar.x) <= 2 * slack;
      if ((right || left) && !row.some((l) => spans(l) && /[\p{L}\d]/u.test(l.text))) return { category: "beside", bar, row, side: right ? "right" : "left" };
    }
  }
  // Over the one line of an axiom set without a bar, aligned with it:
  // the line under the label holds a relation and nothing else on the
  // label's row reaches over it. Only a name of a strong shape (hyphen,
  // spaced, bracketed) stands so: a bare word over a line with a relation
  // heads a listing ("in", "Core") or a grammar's column ("id ⇒ Return").
  if (token.side === "whole" && (token.bracketed || ["hyphen", "spaced"].includes(shapeOf(fold(token.text)) ?? ""))) {
    const under = lines.filter((l) => l.top >= label.bottom - tolerance(l, label) && l.top <= label.bottom + 1.2 * type.leading
      && l.x0 < label.x1 + 2 * label.size && l.x1 > label.x0 - 2 * label.size && sameColumn(page, l, label));
    if (under.length) {
      const x0 = Math.min(...under.map((l) => l.x0)), x1 = Math.max(...under.map((l) => l.x1)), bottom = Math.max(...under.map((l) => l.bottom));
      const aligned = Math.abs(x0 - label.x0) <= 2 * label.size || Math.abs((x0 + x1) / 2 - centre) <= 2 * label.size;
      const stroke = page.drawn.some((d) => across(d) && d.y > label.bottom - 1 && d.y < bottom && d.x < x1 && d.x + d.w > x0);
      const blocked = row.some((l) => l.x0 < x1 && l.x1 > x0 && /[\p{L}\d]/u.test(l.text));
      if (aligned && !stroke && !blocked && !under.some((l) => production(l, page, type)) && BETWEEN.test(under.map((l) => l.text).join(" "))) return { category: "over", bar: null, row: under, side: "over" };
    }
  }
  // A label set level with a stack of lines touches each without sharing
  // half its height with any: the stack is its row. Other labels on the
  // label's row (the next rule's, set beside) are not its row.
  if (row.every((l) => WHOLE.test(l.text))) row = lines.filter((l) => level(l, label) && !onRow(l, label) && sameColumn(page, l, label));
  const rest = (token.side === "whole" ? "" : label.text.slice(0, token.start) + " " + label.text.slice(token.end) + " ") + row.map((l) => l.text).join(" ");
  const body = /\p{L}|[^\p{L}\d\s\[\]()]/u.test(rest.replace(/[\[\]()]/g, "")) && rest.replace(/\s/g, "").length >= 3;
  if (!body) return { category: "none", bar: null, row, side: "right" };
  // A relation level with the label counts, on its row or in a line the
  // layout set apart (a tall arrow between two lines of terms).
  const levelled = page.lines.filter((l) => l !== label && onRow(l, label) && sameColumn(page, l, label)).map((l) => l.text).join(" ");
  const span = spanOf(label, token);
  if (token.side !== "whole") {
    if (production(label, page, type)) return { category: "comment", bar: null, row, side: "right" };
    if (MONO.test(faceOf(label, token))) return { category: "comment", bar: null, row, side: "right" };
    if (ruledAside(page, label, span, type) || walled(page, label, span, row)) return { category: "cell", bar: null, row, side: "right" };
    return RELATION.test(rest + " " + levelled) ? { category: "row", bar: null, row, side: token.side === "head" ? "left" : "right" } : { category: "none", bar: null, row, side: "right" };
  }
  if (!row.length) return { category: "none", bar: null, row, side: "right" };
  if (row.some((l) => production(l, page, type))) return { category: "comment", bar: null, row, side: "right" };
  if (ruledAside(page, label, span, type) || walled(page, label, span, row)) return { category: "cell", bar: null, row, side: "right" };
  const right = columnRight(page, label);
  const atMargin = right !== null && label.x1 >= right - label.size && row.every((l) => l.x1 < label.x0);
  if (atMargin) return { category: "margin", bar: null, row, side: "right" };
  // A row holding words in the text's face with no relation is a
  // table's ("MaxMigrate" beside a benchmark's name).
  if (row.some((l) => faceOf(l) === family(type.font) && !RELATION.test(l.text) && /\p{L}{3}/u.test(l.text))) return { category: "cell", bar: null, row, side: "right" };
  // The label stands at a side of its row, or over it. With lines on
  // both sides, its row is the nearer side where the other is twice as
  // far (a page of axioms set two to a row).
  const sideOf = (lines: Line[]): Setting["side"] | null => (lines.every((l) => l.x0 >= label.x1 - tolerance(l, label)) ? "left" : lines.every((l) => l.x1 <= label.x0 + tolerance(l, label)) ? "right"
    : lines.every((l) => l.top >= label.bottom - tolerance(l, label)) ? "over" : null);
  let side = sideOf(row);
  if (!side) {
    const toRight = row.filter((l) => l.x0 >= label.x1 - tolerance(l, label)), toLeft = row.filter((l) => l.x1 <= label.x0 + tolerance(l, label));
    if (toRight.length && toLeft.length && toRight.length + toLeft.length === row.length) {
      const gapRight = Math.min(...toRight.map((l) => l.x0)) - label.x1, gapLeft = label.x0 - Math.max(...toLeft.map((l) => l.x1));
      if (gapRight * 2 <= gapLeft) { row = toRight; side = "left"; } else if (gapLeft * 2 <= gapRight) { row = toLeft; side = "right"; }
    }
  }
  const text = (token.side === "whole" ? "" : label.text.slice(0, token.start) + " " + label.text.slice(token.end) + " ") + row.map((l) => l.text).join(" ");
  return side && RELATION.test(text + " " + levelled) ? { category: "row", bar: null, row, side } : { category: "none", bar: null, row, side: "right" };
}

// ------------------------------------------------------------ pass 3: names

const HYPHEN = RULE_SHAPE_HYPHEN.pattern!;
const SPACED = RULE_SHAPE_SPACED.pattern!;
const WORD = RULE_SHAPE_WORD.pattern!;
const SYMBOL = RULE_SHAPE_SYMBOL.pattern!;

function shapeOf(text: string): Shape | null {
  if (HYPHEN.test(text)) return "hyphen";
  if (SPACED.test(text)) return "spaced";
  if (WORD.test(text)) return "word";
  if (SYMBOL.test(text)) return "symbol";
  return null;
}

const capitals = (text: string) => text === text.toUpperCase();
const capitalised = (text: string) => /^\p{Lu}/u.test(text);

// Whether a name of this shape may label a rule in this category, and
// the rule that says so; null where it may not.
function allowed(shape: Shape, token: Token, category: Category): string | null {
  switch (category) {
    case "beside":
      return RULE_NAME_BESIDE.id;
    case "over":
      return RULE_NAME_OVER.id;
    case "row":
      return shape === "symbol" || (shape === "word" && !token.bracketed && !token.colon) ? null : RULE_NAME_ROW.id;
    case "margin":
      return shape === "hyphen" || shape === "spaced" ? RULE_NAME_MARGIN.id : null;
  }
}

// ------------------------------------------------------------ pass 4: conventions

// The font most of a line is set in, whatever its size ("CMSS8" and
// "CMSS9" are one face).
const family = (font: string) => font.replace(/\d+$/, "");
// The face of a stretch of a line, or of all of it but a stretch: the
// font most of its letters are set in (a line naming five rules in small
// capitals is still running text).
function faceOf(line: Line, stretch: { start: number; end: number; but?: boolean } = { start: 0, end: line.text.length }): string {
  const counts = new Map<string, number>();
  for (let i = 0; i < line.text.length; i += 1) {
    const inside = i >= stretch.start && i < stretch.end;
    if (stretch.but ? inside : !inside) continue;
    const ref = line.chars[i];
    if (!ref || ref.run < 0 || !/[\p{L}\d]/u.test(String.fromCodePoint(line.text.codePointAt(i)!))) continue;
    const font = family(line.runs[ref.run].font);
    counts.set(font, (counts.get(font) ?? 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
}
// Every face a token's letters are set in, as one string ("CMBX+CMTI"
// for a bold name with an italic subscript).
function facesOf(line: Line, token: Token): string {
  const faces = new Set<string>();
  for (let i = token.start; i < token.end; i += 1) {
    const ref = line.chars[i];
    if (!ref || ref.run < 0 || !/[\p{L}\d]/u.test(String.fromCodePoint(line.text.codePointAt(i)!))) continue;
    faces.add(family(line.runs[ref.run].font));
  }
  return [...faces].sort().join("+");
}

interface Candidate { line: Line; page: Page; token: Token; shape: Shape; setting: Setting & { category: Category }; rule: string; convention: string }

// A weak label — a single word — stands only where the paper sets two or
// more labels the same way, or where the text cites it (rule.convention).
const weak = (c: Candidate) => c.shape === "word" || (c.shape === "spaced" && /[\d↓↑]$/u.test(c.token.text));

// ------------------------------------------------------------ pass 6: boxes

interface Box { x: number; y: number; w: number; h: number }

// The rule a label names, as set (rule.box). With a bar, the bar's width
// joined with the label, the lines within 0.8 of a leading of the bar,
// then every line touching those within reach. Without one, the row. A
// line takes part only where it overlaps the bar and the label: the next
// rule's label, set a hair from the bar on its other side, is not in it.
// Nor is another label (`others`), a line set just under or just over
// another bar (that rule's conclusion or premise), a line of running
// text round a rule set inline, a line over a label that stands over
// its premises, or, in a row, a line on another label's row.
interface Others { lines: Set<Line>; bars: Drawn[] } // the other labels on the page and their bars
function boxOf(page: Page, label: Line, setting: Setting, type: Type, others: Others = { lines: new Set(), bars: [] }): Box {
  const bars = others.bars.filter((d) => d !== setting.bar);
  const another = (l: Line) => bars.some((d) => d.x < l.x1 && d.x + d.w > l.x0 && (Math.abs(l.top - d.y) <= 0.8 * type.leading || Math.abs(l.bottom - d.y) <= 0.8 * type.leading));
  const lines = ruleLines(page, label).filter((l) => !others.lines.has(l) && !another(l) && !prose(l, type)
    && (setting.side !== "over" || l.top >= label.top - tolerance(l, label))
    && (setting.bar || ![...others.lines].some((o) => onRow(o, l))));
  const slack = setting.bar ? 0 : BESIDE * label.size;
  const taken = new Set<Line>([label]);
  let x0: number, x1: number;
  if (setting.bar) {
    const bar = setting.bar;
    x0 = Math.min(bar.x, label.x0); x1 = Math.max(bar.x + bar.w, label.x1);
    for (const l of lines) if (l.x0 <= x1 + slack && l.x1 >= x0 - slack && l.bottom >= bar.y - 0.8 * type.leading && l.top <= bar.y + 0.8 * type.leading) taken.add(l);
  } else {
    for (const l of setting.row) taken.add(l);
    x0 = Math.min(...[...taken].map((l) => l.x0)); x1 = Math.max(...[...taken].map((l) => l.x1));
  }
  const within = (l: Line) => l.bottom >= label.top - REACH * type.leading && l.top <= label.bottom + REACH * type.leading;
  for (let grew = true; grew;) {
    grew = false;
    for (const line of lines) {
      if (taken.has(line) || line.x0 > x1 + slack || line.x1 < x0 - slack || !within(line) || !sameColumn(page, line, label)) continue;
      if ([...taken].some((t) => level(t, line))) { taken.add(line); grew = true; }
    }
  }
  const all = [...taken];
  const left = Math.max(0, Math.min(x0, ...all.map((l) => l.x0)) - PAD), right = Math.min(page.width, Math.max(x1, ...all.map((l) => l.x1)) + PAD);
  const top = Math.max(0, Math.min(...all.map((l) => l.top)) - PAD), bottom = Math.min(page.height, Math.max(...all.map((l) => l.bottom)) + PAD);
  return { x: left / page.width, y: top / page.height, w: (right - left) / page.width, h: (bottom - top) / page.height };
}

// ------------------------------------------------------------ pass 7: mentions

const NEAR = 60;
// "rule" (or a kin) within six words before or after the name: "the
// sapp rule", "rule containTrans", "rules slam, sbind and sapp".
const RULE_WORDS = /\b(?:rules?|laws?|axioms?)\b/i;
const RULE_BEFORE = /\b(?:rules?|laws?|axioms?)\s*[[(]?\s*(?:[^\s,()[\]]+,?\s+(?:and\s+|or\s+)?){0,6}$/iu;
const RULE_AFTER = /^\s*(?:[\])]\s*)?(?:,?\s*(?:and\s+|or\s+)?[^\s,()[\]]+){0,6}\s+(?:rules?|laws?|axioms?)\b/iu;
// A word with a capital after a lowercase letter is no English word: a
// camelCase name cites its rule wherever it is printed.
const camel = (text: string) => /\p{Ll}\p{Lu}/u.test(text);
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// A name in the text is the label's, whatever its case, only where one of
// the two is in capitals throughout: small capitals reach the text layer
// as capitals from some fonts and as the name from others, while
// "well-typed" is not the rule "Well-Typed".
// A hyphenated name whose prefix is printed as labelled and whose parts
// differ only in case is the same name (WS-app for WS-App).
const prefix = (text: string) => text.split(/[-‐‑–:/_]/)[0];
const sameName = (printed: string, name: string) => printed === name
  || (printed.toLowerCase() === name.toLowerCase() && (capitals(printed) || capitals(name) || (name.includes("-") && prefix(printed) === prefix(name))));

// Whether a place in the text cites the rule, in the form its shape and
// setting allow (rule.mention): a hyphenated name, a symbol or a spaced
// name in capitals as it is; a bracketed word in brackets; a bare word,
// or a spaced name with a capitalised word, in its printed case within a
// few words of "rule".
function cites(rule: { name: string; shape: Shape; bracketed: boolean }, printed: string, bracketed: boolean, before: string, after: string): boolean {
  const exact = printed.replace(/\s+/g, " ") === rule.name;
  if (rule.shape === "symbol") return exact;
  if (rule.shape === "hyphen" || (rule.shape === "spaced" && capitals(rule.name))) return sameName(printed.replace(/[\s\u00ad]+/g, " ").replace(/([-‐‑–]) /g, "$1"), rule.name);
  // A word: in brackets as the label was, or as printed with "rule"
  // (or a kin) within three words: "the sapp rule", "(rule slam and
  // sbind)"; a camelCase word as printed anywhere.
  if (bracketed) return sameName(printed, rule.name);
  return sameName(printed, rule.name) && (camel(rule.name) || RULE_BEFORE.test(before) || RULE_AFTER.test(after));
}

// Every place in the text that names one of the rules, longest names
// first so "T-App-Abs" is not "T-App".
function* mentionsIn(text: string, rules: { name: string; shape: Shape; bracketed: boolean }[]): Generator<{ index: number; length: number; nameStart: number; nameEnd: number; bracketed: boolean; printed: string; rule: number }> {
  if (!rules.length) return;
  const order = rules.map((r, i) => i).sort((a, b) => rules[b].name.length - rules[a].name.length);
  // A hyphen may break the name over a line ("(Sec-" / "Chs)").
  const names = order.map((i) => escape(rules[i].name).replace(/-/g, "[-‐‑–]\\s?").replace(/ /g, "\\s+")).join("|");
  const re = new RegExp(`(?<![\\p{L}\\d])(?<open>[\\[(])?(?<name>${names})(?<close>[\\])])?(?![\\p{L}\\d])`, "giu");
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    const groups = match.groups!;
    const bracketed = Boolean(groups.open && groups.close);
    const before = text.slice(Math.max(0, match.index - NEAR), match.index);
    const after = text.slice(match.index + match[0].length, match.index + match[0].length + NEAR);
    const rule = order.find((i) => cites(rules[i], groups.name, bracketed, before, after));
    if (rule === undefined) continue;
    const nameStart = match.index + (groups.open ? 1 : 0);
    yield { index: match.index, length: match[0].length, nameStart, nameEnd: nameStart + groups.name.length, bracketed, printed: groups.name, rule };
  }
}

// Whether the running text cites a name anywhere: what lets a weak label
// stand alone (rule.convention).
// Whether a name printed at a place in a line stands in running text: the
// rest of the line is in the text's face, or the line is the name alone
// set as its label is (a proof case headed "T CONTRACT"); a name in a
// listing's face is code ("[Response]" is a list type, not the law).
function inText(at: { line: Line; char: number }, length: number, labelFace: string, type: Type): boolean {
  const rest = faceOf(at.line, { start: at.char, end: at.char + length, but: true });
  if (rest === family(type.font)) return true;
  return rest === "" && faceOf(at.line) === labelFace;
}

function citedAnywhere(flows: Flow[], rule: { name: string; shape: Shape; bracketed: boolean }, labels: Set<Line>, labelFace: string, type: Type): boolean {
  for (const flow of flows) {
    for (const m of mentionsIn(flow.text, [rule])) {
      const at = flow.at[m.nameStart];
      if (!at || labels.has(at.line) || !inText(at, m.nameEnd - m.nameStart, labelFace, type)) continue;
      return true;
    }
  }
  return false;
}

/**
 * Every named rule, by its name in lower case: its first label in reading
 * order is where it is defined. `skip` holds lines that label nothing
 * (the bibliography's); `flows` is the text, read for what it cites.
 */
export function findRules(layout: Layout, skip: Set<Line>, flows: Flow[], trace: Trace): Map<string, Rule> {
  const type = typeOf(layout);
  const candidates: Candidate[] = [];
  const at = (page: Page, line: Line, box: Box) => [{ page: page.number, ...box }];
  const seen: { page: Page; line: Line; token: Token; setting: Setting }[] = [];
  for (const page of layout.pages) {
    for (const line of page.lines) {
      if (line.furniture || skip.has(line) || line.size > LABEL_SIZE * layout.bodySize) continue;
      const token = tokenOf(line);
      if (token) seen.push({ page, line, token, setting: settingOf(page, line, token, type) });
    }
  }
  // A label level with a bar on either side stands on the side most of
  // the paper's other labels do; short of a majority, on the first found.
  const sides = { left: 0, right: 0, over: 0 };
  for (const s of seen) if (s.setting.category === "beside" && !s.setting.other) sides[s.setting.side] += 1;
  for (const s of seen) if (s.setting.other && sides[s.setting.other.side] > sides[s.setting.side]) s.setting = s.setting.other;
  // A bar leading into a wider one under it is a step where no label
  // names that wider bar.
  const barred = new Set(seen.map((s) => s.setting.bar).filter(Boolean));
  for (const s of seen) if (s.setting.step && !barred.has(s.setting.step)) s.setting.derived = true;
  const boxAt = (page: Page, line: Line, setting: Setting) => {
    const rest = seen.filter((s) => s.page === page && s.line !== line);
    return boxOf(page, line, setting, type, { lines: new Set(rest.map((s) => s.line)), bars: rest.flatMap((s) => (s.setting.bar ? [s.setting.bar] : [])) });
  };
  {
    for (const { page, line, token, setting } of seen) {
      const box = boxAt(page, line, setting);
      trace.add(RULE_CANDIDATE.id, page.number, token.text, at(page, line, box));
      if (setting.category === "none") continue;
      if (setting.category === "cell" || setting.category === "group") { trace.add(RULE_CELL.id, page.number, token.text, at(page, line, box)); continue; }
      if (setting.category === "comment") { trace.add(RULE_HEADING.id, page.number, token.text, at(page, line, box)); continue; }
      if (setting.bar) trace.add(RULE_BAR.id, page.number, token.text, [{ page: page.number, x: setting.bar.x, y: setting.bar.y, w: setting.bar.w, h: Math.max(setting.bar.h, 1) }]);
      trace.add(RULE_SETTING.id, page.number, `${token.text} ${setting.category}`, at(page, line, box));
      const shape = shapeOf(fold(token.text));
      if (!shape) continue;
      if (shape === "hyphen" && !/[-‐‑–:/_][^-‐‑–:/_]*[\p{L}→⇒⇓∀∃⊢⊗⊕⊸∧∨¬<]/u.test(token.text)) { trace.add(RULE_NAME_LETTERS.id, page.number, token.text, at(page, line, box)); continue; }
      const rule = allowed(shape, token, setting.category);
      if (!rule) {
        if (setting.category === "margin") trace.add(RULE_HEADING.id, page.number, token.text, at(page, line, box));
        continue;
      }
      const convention = `${setting.category}|${setting.side}|${token.bracketed ? "[]" : ""}|${facesOf(line, token)}|${Math.round(line.size * 2) / 2}`;
      candidates.push({ line, page, token, shape, setting: setting as Candidate["setting"], rule, convention });
    }
  }
  // Conventions: how many labels the paper sets each way, and whether the
  // text cites any weak name set that way (rule.convention): a table's
  // headers and a plot's legend are set alike too, but never cited.
  // A weak label also stands where two strong ones (hyphenated, spaced,
  // symbols) are set the same way.
  const conventions = new Map<string, number>();
  const strong = new Map<string, number>();
  for (const c of candidates) {
    conventions.set(c.convention, (conventions.get(c.convention) ?? 0) + 1);
    if (!weak(c)) strong.set(c.convention, (strong.get(c.convention) ?? 0) + 1);
  }
  const labels = new Set(candidates.map((c) => c.line));
  const confirmed = new Set<string>();
  {
    const byConvention = new Map<string, Candidate[]>();
    for (const c of candidates) if (weak(c) && !confirmed.has(c.convention)) byConvention.set(c.convention, [...(byConvention.get(c.convention) ?? []), c]);
    for (const [convention, members] of byConvention) {
      if ((strong.get(convention) ?? 0) >= 2) { confirmed.add(convention); continue; }
      const names = members.map((c) => ({ name: c.token.text, shape: c.shape, bracketed: c.token.bracketed }));
      const face = faceOf(members[0].line, members[0].token);
      if (flows.some((flow) => [...mentionsIn(flow.text, names)].some((m) => { const at = flow.at[m.nameStart]; return at && !labels.has(at.line) && inText(at, m.nameEnd - m.nameStart, face, type); }))) confirmed.add(convention);
    }
  }
  const rules = new Map<string, Rule>();
  // A label at a step of a derivation defines its rule only where no
  // label at a rule's own setting does (rule.derivation).
  const ordered = [...candidates.filter((c) => !c.setting.derived), ...candidates.filter((c) => c.setting.derived)];
  // One label stands over a bar: under a rule's label found over it, a
  // token over the same bar is a premise ("⌉A⌈" under TL-and).
  const labelled = new Map<Drawn, number>();
  for (const c of ordered) {
    const key = keyOf(fold(c.token.text));
    const premise = c.setting.category === "over" && c.setting.bar && labelled.get(c.setting.bar) !== undefined && c.line.top - labelled.get(c.setting.bar)! <= 3 * type.leading;
    if (premise) { trace.add(RULE_CELL.id, c.page.number, c.token.text, at(c.page, c.line, boxAt(c.page, c.line, c.setting))); continue; }
    const known = rules.get(key);
    if (known) {
      if (c.setting.derived) { labels.delete(c.line); trace.add(RULE_DERIVATION.id, c.page.number, c.token.text, at(c.page, c.line, boxAt(c.page, c.line, c.setting))); }
      else known.labels.push(c.line);
      continue;
    }
    if (c.setting.derived && !citedAnywhere(flows, { name: c.token.text, shape: c.shape, bracketed: c.token.bracketed }, labels, faceOf(c.line, c.token), type)) {
      labels.delete(c.line); trace.add(RULE_DERIVATION.id, c.page.number, c.token.text, at(c.page, c.line, boxAt(c.page, c.line, c.setting))); continue;
    }
    const box = boxAt(c.page, c.line, c.setting);
    const boxes = at(c.page, c.line, box);
    if (weak(c) && (((conventions.get(c.convention) ?? 0) < 2 && (strong.get(c.convention) ?? 0) < 2) || !confirmed.has(c.convention))
      && !citedAnywhere(flows, { name: c.token.text, shape: c.shape, bracketed: c.token.bracketed }, labels, faceOf(c.line, c.token), type)) {
      trace.add(RULE_CONVENTION.id, c.page.number, `${c.token.text} alone`, boxes);
      continue;
    }
    rules.set(key, {
      key: `r${rules.size}`, kind: "rule", label: c.token.text, caption: c.line, page: c.page.number, ...box,
      name: c.token.text, shape: c.shape, bracketed: c.token.bracketed, category: c.setting.category, labels: [c.line],
    });
    if (c.setting.category === "over" && c.setting.bar && !labelled.has(c.setting.bar)) labelled.set(c.setting.bar, c.line.top);
    trace.add(c.rule, c.page.number, c.token.text, boxes);
    if (weak(c)) trace.add(RULE_CONVENTION.id, c.page.number, c.token.text, boxes);
    trace.add(RULE_BOX.id, c.page.number, c.token.text, boxes);
  }
  return rules;
}

/** The places in a flow of text that name a rule, as links to it (rule.mention). */
export function findRuleMentions(flow: Flow, rules: Map<string, Rule>, layout: Layout, trace: Trace): DocumentLink[] {
  const links: DocumentLink[] = [];
  if (!rules.size) return links;
  const size = (page: number): [number, number] => [layout.pages[page - 1].width, layout.pages[page - 1].height];
  const labels = new Set([...rules.values()].flatMap((r) => r.labels));
  const type = typeOf(layout);
  const all = [...rules.values()];
  for (const m of mentionsIn(flow.text, all)) {
    const rule = all[m.rule];
    const at = flow.at[m.nameStart];
    if (!at || labels.has(at.line)) continue;
    // A word only from running text, a line mostly in the text's face:
    // "[Response]" in a listing is a list type, not the law.
    if ((rule.shape === "word" || rule.shape === "spaced" || rule.shape === "symbol") && !inText(at, m.nameEnd - m.nameStart, faceOf(rule.labels[0]), type)) continue;
    if (citedAway(flow.text, m.index, m.index + m.length)) continue;
    const from = m.bracketed ? m.index : m.nameStart;
    const to = m.bracketed ? m.index + m.length : m.nameEnd;
    const boxes = boxesOf(flow, from, to, size);
    for (const box of boxes) links.push({ float: rule.key, label: flow.text.slice(from, to), ...box });
    trace.add(RULE_MENTION.id, boxes[0]?.page ?? 0, m.printed, boxes);
  }
  return links;
}

// Internals for the corpus tools (not part of the analyzer).
export const internals = { boxOf, typeOf, settingOf, tokenOf };
