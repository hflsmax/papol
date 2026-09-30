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
  RULE_CONNECTIVES,
  RULE_BAR,
  RULE_BOX, RULE_CANDIDATE, RULE_CELL, RULE_CONVENTION, RULE_DERIVATION, RULE_HEADING, RULE_MENTION, RULE_NAME_BESIDE, RULE_NAME_LETTERS,
  RULE_NAME_MARGIN, RULE_NAME_OVER, RULE_NAME_ROW, RULE_SETTING, RULE_SHAPE_HYPHEN, RULE_SHAPE_PHRASE, RULE_SHAPE_SPACED, RULE_SHAPE_SYMBOL, RULE_SHAPE_WORD,
} from "./registry";
import type { Trace } from "./trace";

export type Shape = "hyphen" | "spaced" | "word" | "symbol" | "phrase";
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
const OVER_REACH = 7; // leadings a label over its premises may stand from the bar
const LABEL_SIZE = 1.2;
const LABEL_LEAST = 0.55; // of the text's size: smaller is a diagram's lettering ("(Level J)")
const HUGGED = 0.6; // of the text's width: a bar a column wide between premises and conclusion
const FAR = 8; // label sizes a label level with its bar may stand from it, blank between

const keyOf = (name: string) => name.toLowerCase().replace(/[‐‑–]/g, "-").replace(/\s+/g, " ");

// ------------------------------------------------------------ pass 1: candidates

interface Token {
  text: string; // the name as printed, without brackets or a trailing colon
  bracketed: boolean;
  square: boolean; // in square brackets ([Int]), not parentheses
  colon: boolean; // set off by a colon after it ("Load:")
  closed?: boolean; // the colon ends a word ("Load:", "follows:")
  side: "whole" | "head" | "tail"; // the whole line, or its head or tail set apart
  start: number; // in the line's text
  end: number;
}

// A token begins with a letter or digit, or with the connectives of a
// symbol name (→L, ∀R, ×T, <:-Param) where a capital or a hyphened part follows them; it may end in a
// sign (WF-var+), a parenthesised tag (Choice(L)) or a spaced capital,
// digit or arrow (Val T, Interchange 1, Propagate ↓, Propagate-Var ↓1).
// A capital as a rule name has it: in the text's face, or a mathematical
// bold or italic one (𝑇 in ×𝑇); a Greek letter likewise (𝛽 in 𝛽 Box).
const CAP = "A-Z\\u{1D400}-\\u{1D419}\\u{1D434}-\\u{1D44D}\\u{1D468}-\\u{1D481}";
const GREEK = "\\p{Script=Greek}\\u{1D6A8}-\\u{1D7CB}";
const CONNECTIVE = RULE_CONNECTIVES;
// Mathematical partials (𝜕, bold and sans too) fold to the connective ∂
// (bdg-𝜕 in a POPL paper's text layer).
const PARTIAL = "\\u{1D6DB}\\u{1D715}\\u{1D74F}\\u{1D789}\\u{1D7C3}";
const TOKEN = `(?:(?:[A-Z]{1,2}|[${GREEK}]) (?=[${CAP}]))?(?:[\\p{L}\\d]|[${CONNECTIVE}]{1,2}(?=[${CAP}\\d∞\\p{Ll}]|-\\p{L}))[\\p{L}\\d\\p{Co}'′’${CONNECTIVE}${PARTIAL}~*|/_\\-‐‑–∞]{0,35}[+−±†‡♠♣♦?!↓↑-]{0,2}(?: ?\\([\\p{L}\\d]{1,4}\\)| (?:[${CAP}]{1,2}|\\d{1,2}|[↓↑]\\d?))?`;
const WHOLE = new RegExp(`^\\s*(?:(?<open>[\\[(])\\s*)?(?<token>${TOKEN})(?:\\s?•)?(?<colon>:)?(?:\\s*(?<close>[\\])]))?\\s*$`, "u");
const HEAD = new RegExp(`^\\s*(?:(?<open>[\\[(])\\s*)?(?<token>${TOKEN})(?:\\s?•)?(?<colon>:)?(?:\\s*(?<close>[\\])]))?(?=\\s)`, "u");
const TAIL = new RegExp(`(?<=\\s)(?:(?<open>[\\[(])\\s*)?(?<token>${TOKEN})(?:\\s?•)?(?<colon>:)?(?:\\s*(?<close>[\\])]))?\\s*$`, "u");
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
// The italic text faces: a lowercase word set in one after a connective
// is a variable, not a rule's side.
const ITALIC = /italic|ital|cmmi|lmmi|(?:T|M|-)I\d*$|-It$|Italic/i;

function tokenOf(line: Line, column = false): Token | null {
  const text = line.text.split("").map((c, i) => (line.chars[i]?.run >= 0 && EXTENSION.test(line.runs[line.chars[i].run].font) ? " " : c)).join("");
  const found = (match: RegExpExecArray | null, side: Token["side"]): Token | null => {
    if (!match?.groups) return null;
    const { open, close } = match.groups;
    // A colon after a letter ends the label, no part of its name ("Load:"
    // heading its rule; the colon is a connective only among others, "<:").
    const trailing = /[\p{L}\d]:$/u.test(match.groups.token);
    const token = trailing ? match.groups.token.slice(0, -1) : match.groups.token;
    const colon = match.groups.colon || (trailing ? ":" : undefined);
    // Straight after its last letter the colon closes the word ("Party A:"
    // over a listing), after a bullet it only sets the label off.
    const closed = trailing || (Boolean(match.groups.colon) && /[\p{L}\d]$/u.test(match.groups.token) && match[0].includes(`${match.groups.token}:`));
    if (Boolean(open) !== Boolean(close)) return null;
    if (open && close && "[(".indexOf(open) !== "])".indexOf(close)) return null;
    // A letter in it, unless it opens with a connective (⋍0); not a
    // number or a citation.
    if ((!/\p{L}/u.test(token) && !new RegExp(`^[${CONNECTIVE}]`, "u").test(token)) || /^\d+$/.test(token) || /^[A-Z][A-Za-z]*\d{2,4}[a-z]?$/.test(token)) return null;
    const start = match.index + match[0].indexOf(token);
    const font = (i: number) => (line.chars[i]?.run >= 0 ? line.runs[line.chars[i].run].font : "");
    // One opening with a letter whose letters are all mathematical
    // alphanumerics is a formula (𝑒0, 𝜇𝐹); ×𝑇 and 1𝐼 open otherwise. A
    // letter from a symbol font is a glyph the PDF maps wrong, no letter
    // ("𝐴𝑏 F", txsyc's F being ⩴).
    const plain = [...token].map((c, i, all) => (SYMBOLIC.test(font(start + all.slice(0, i).join("").length)) ? " " : c)).join("");
    if (/^\p{L}/u.test(token) && !/\p{L}/u.test(plain.replace(/[\u{1D400}-\u{1D7FF}]/gu, ""))) return null;
    if (/\p{L}/u.test(token[0]) && SYMBOLIC.test(font(start))) return null;
    // One or two italic letters with an index is a metavariable (S1, e′),
    // not a name; in brackets too where the index is set as a subscript
    // (a constraint's tag "(ℓ1)").
    const run = (i: number) => (line.chars[i]?.run >= 0 ? line.runs[line.chars[i].run] : null);
    const subscripted = /\d$/.test(token) && [...token].every((c, i) => !/\d/.test(c) || ((r) => r !== null && r.size < line.size - 0.5 && r.baseline > line.baseline + 0.5)(run(start + i)));
    if ((!open || subscripted) && /^\p{L}{1,2}\d*['′]*$/u.test(token) && [...token].every((c, i) => !/\p{L}/u.test(c) || ITALIC.test(font(start + i)))) return null;
    // One opening with a connective whose letters are all mathematical
    // alphanumerics with no capital among them (⊕𝜎𝑓, ¬𝜑), or all set in
    // an italic face (× 1/fps), is a formula: ×𝑇 and <:eq open otherwise.
    if (new RegExp(`^[${CONNECTIVE}]`, "u").test(token)) {
      const letters = [...token.matchAll(/\p{L}/gu)];
      if (letters.length && !/\p{L}/u.test(token.replace(/[\u{1D400}-\u{1D7FF}]/gu, "")) && !new RegExp(`[${CAP}]`, "u").test(token)) return null;
      if (letters.length && letters.every((m) => /[a-z]/.test(m[0]) && ITALIC.test(font(start + m.index!)))) return null;
    }
    return { text: token, bracketed: Boolean(open), square: open === "[", colon: Boolean(colon), closed, side, start, end: start + token.length };
  };
  const whole = found(WHOLE.exec(text), "whole");
  if (whole) return whole;
  const headMatch = HEAD.exec(text);
  const head = found(headMatch, "head");
  // In a column of bracketed labels heading rows, a long one may stand
  // closer to its row: "(perform)" as its row's text aligns with the rest.
  const apart = column && head?.bracketed ? 0.25 : APART;
  if (head && headMatch && (head.colon || blankAfter(line, headMatch.index + headMatch[0].trimEnd().length) >= apart * line.size)) return head;
  const tailMatch = TAIL.exec(text);
  const tail = found(tailMatch, "tail");
  if (tail && tailMatch && blankBefore(line, tailMatch.index + tailMatch[0].length - tailMatch[0].trimStart().length) >= (column ? 0.25 : APART) * line.size) return tail;
  return null;
}

// A bracketed phrase making up its line ("(Sequential composition)"):
// a label only in a column of labels set alike (rule.shape.phrase).
function phraseOf(line: Line): Token | null {
  const match = /^\s*\((?<token>[^()]+)\)\s*$/u.exec(line.text);
  if (!match?.groups || !PHRASE.test(match.groups.token)) return null;
  const start = line.text.indexOf(match.groups.token);
  return { text: match.groups.token, bracketed: true, square: false, colon: false, side: "whole", start, end: start + match.groups.token.length };
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
// A delimiter stretched over a stack of lines (a spec's tall braces)
// stands on no row.
const STRETCHED = /^[(){}[\]⟨⟩⟪⟫|‖⌈⌉⌊⌋\s]+$/u;
const onRow = (a: Line, b: Line) => Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) >= 0.5 * Math.min(a.size, b.size)
  && !(STRETCHED.test(a.text) && a.size > 1.5 * b.size) && !(STRETCHED.test(b.text) && b.size > 1.5 * a.size);

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
// A line set into a rule, a stroke touching it on both sides at its
// middle, heads a group of rules ("——— Structural rules ———").
const setInto = (page: Page, l: Line) => {
  const level = page.drawn.filter((d) => across(d) && d.y > l.top && d.y < l.bottom);
  return level.some((d) => Math.abs(d.x + d.w - l.x0) <= TOUCH * l.size) && level.some((d) => Math.abs(d.x - l.x1) <= TOUCH * l.size);
};
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
      || (v.w > 1.5 && v.w <= 8 && v.h > 1.5 && v.h <= 8 && [d.x, d.x + d.w].some((end) => end >= v.x - 2 && end <= v.x + v.w + 2))));
}

// A line drawn just under a line of text, from its first letter or to its
// last: an underline, not a bar (a premise stands clear of its bar).
// An overline with its index at its end ("‾Σ ⊢ τ‾ⁱ", a premise repeated
// over i): no bar.
function overline(page: Page, d: Drawn, type: Type): boolean {
  return page.lines.some((l) => !l.furniture && l.runs.some((r) => r.size <= 0.8 * type.bodySize && /^[\p{L}\p{N}]$/u.test(r.text.trim())
    && r.x >= d.x + d.w - 2 && r.x <= d.x + d.w + 3 && r.baseline <= d.y + 0.6 * r.size && r.baseline >= d.y - 1.5 * r.size));
}

// Text reaching up to a stroke from under it, or another
// stroke just under it, is what it overlines (TCInst's "‾Γ ⊢ τ′ₖ : κₖ‾",
// PRODORSUM's): a conclusion stands clear of its bar.
function hugs(page: Page, d: Drawn, type: Type): boolean {
  return page.lines.some((l) => !l.furniture && l.top < d.y + 0.6 && l.top > d.y - 0.5 * l.size && l.bottom > d.y + 0.5 * l.size && l.x0 < d.x + d.w && l.x1 > d.x)
    || page.drawn.some((e) => e !== d && across(e) && e.y > d.y + 0.2 && e.y - d.y <= 0.4 * type.bodySize && e.x >= d.x - 1 && e.x + e.w <= d.x + d.w + 1);
}

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

// A line struck through (a rule withdrawn, "(tapp)" in Evidently): the
// stroke runs through the words' lower-case letters over most of its
// length (a bar of dashes set as text runs through its own line, which
// has none).
function struck(page: Page, d: Drawn): boolean {
  const through = page.lines.filter((l) => !l.furniture && /\p{L}/u.test(l.text) && d.y >= l.baseline - 0.6 * l.size && d.y <= l.baseline - 0.1 * l.size);
  const crossed = through.reduce((n, l) => n + Math.max(0, Math.min(l.x1, d.x + d.w) - Math.max(l.x0, d.x)), 0) >= 0.5 * d.w;
  // A conclusion hard under the stroke makes it a bar, a big operator's
  // raised line through it notwithstanding.
  return crossed && !page.lines.some((l) => !through.includes(l) && l.top >= d.y - 1 && l.top <= d.y + 0.5 * l.size && l.x0 < d.x + d.w && l.x1 > d.x);
}

// A bar is a step of a derivation tree, not a rule's definition, where a
// narrower bar stands within its span just over it with a line between
// touching both and as wide as the upper bar: that line is the upper
// step's conclusion and this step's premise (rule.derivation); an accent
// drawn over part of a premise, or an overline, is no bar, nor a stroke
// with no premise over it and no label beside it. The line between holds
// a letter or digit: a row of vector arrows under a judgment's framed
// form is no conclusion.
// Or a wider bar stands just under it spanning it with a line between:
// this step's conclusion is the lower step's premise.
// For a label over its bar the upper bar stands under the label (`from`):
// a heading's underline over the label is no step.
function derivation(page: Page, bar: Drawn, lines: Line[], type: Type, slack: number, from = -Infinity): boolean {
  // A step's bar has premises over it (under the rule's label) or its
  // label beside it; a stroke with neither over a premise is its overline
  // (CDRcd's "‾Γ ⊢ eᵢ : Aᵢ‾", LIST's).
  const held = (d: Drawn) => lines.some((l) => (l.top > from && l.bottom <= d.y + 1 && l.bottom >= d.y - type.leading && l.x0 < d.x + d.w && l.x1 > d.x)
    || (Math.abs((l.top + l.bottom) / 2 - d.y) <= LEVEL * l.size && (Math.abs(l.x0 - d.x - d.w) <= 2 * l.size || Math.abs(d.x - l.x1) <= 2 * l.size)));
  return page.drawn.some((d) => d !== bar && across(d) && !overline(page, d, type) && held(d) && !hugs(page, d, type) && d.y > from && d.y < bar.y - 2 && d.y >= bar.y - 2.2 * type.leading
    && d.x >= bar.x - slack && d.x + d.w <= bar.x + bar.w + slack && d.w < bar.w
    && lines.some((l) => /[\p{L}\d]/u.test(l.text) && l.top >= d.y - 1 && l.top <= d.y + 0.8 * type.leading && l.bottom <= bar.y + 1 && l.bottom >= bar.y - 0.8 * type.leading && l.x0 >= d.x - 1 && l.x1 <= d.x + d.w + 1));
}
// A step's bar has its conclusion right under it, its baseline within a
// leading (a label raised beside the bar may lift the line's top): a
// table's rule has running text under it, or the next row's labels.
function concludes(page: Page, d: Drawn, type: Type): boolean {
  return page.lines.some((l) => !l.furniture && !prose(l, type) && tokenOf(l)?.side !== "whole" && l.baseline > d.y + 1 && l.baseline <= d.y + 1.2 * type.leading && l.x0 < d.x + d.w && l.x1 > d.x);
}
// A line across the text's width with no conclusion centred under it
// and a good part as wide divides a figure's parts (PLDI-199's Fig. 8
// over its boxed judgments, a table's rule), no rule's bar.
function dividing(page: Page, d: Drawn, type: Type): boolean {
  const centre = d.x + d.w / 2;
  return d.w >= BAR_SHARE * (type.text.x1 - type.text.x0) && !page.lines.some((l) => !l.furniture && l.top >= d.y - 1 && l.top <= d.y + type.leading
    && Math.abs((l.x0 + l.x1) / 2 - centre) <= 2 * type.bodySize && l.x1 - l.x0 >= 0.3 * d.w);
}
// The wider bar a step's conclusion leads into, where no label of its
// own names that bar (findRules knows): a rule's own bar set right under
// another's conclusion is not a step, nor is a frame's edge under it (the
// judgment's box under NEVER) a bar, nor a table's rule with no
// conclusion under it (Table 8's LoadLarger over running text).
function stepInto(page: Page, bar: Drawn, lines: Line[], type: Type, slack: number): Drawn | null {
  return page.drawn.find((d) => d !== bar && across(d) && !framed(page, d) && d.y > bar.y + 2 && d.y <= bar.y + 2.2 * type.leading
    && d.x <= bar.x + slack && d.x + d.w >= bar.x + bar.w - slack && d.w > bar.w
    && concludes(page, d, type) && !dividing(page, d, type)
    && lines.some((l) => l.top >= bar.y - 1 && l.top <= bar.y + 0.8 * type.leading && l.bottom <= d.y + 1 && l.bottom >= d.y - 0.6 * type.leading && l.x0 >= bar.x - 1 && l.x1 <= bar.x + bar.w + 1)) ?? null;
}

// What stands at a row's end names a rule only where the row is one: a
// relation between its sides (an arrow, a turnstile, an equation), not a
// table's numbers or a paragraph's words.
const RELATION = /[→⟶↦⟼⇒⟹⇛⤇⇓⇝↝⤳↠⇐⊢⊣⊨⊩⊑⊆≡≜≔=∼≈≤≥⊕⊗∗⊸⊳⊲▷◁]|[−-]∗|->|=>|~>|<:|:>|::=/u;

// A row ending in its relation, its right side on the lines under it.
const OPEN = new RegExp(`(?:^|\\s)(?:${RELATION.source})\\s*$`, "u");

// A relation between two terms, a blank on each side of it: a term on
// its left, not a list's comma or an opening bracket ("{< 0.1, ≤ 0.8}"
// lists bounds).
const BETWEEN = new RegExp(`(?:^|(?<![,;({[]\\s*)\\s)(?:${RELATION.source})\\S{0,2}(?:\\s|$)`, "u");

// A Hoare triple, a command between its pre- and postcondition's
// braces, the line's whole text.
const TRIPLE = /^\s*\{[^{}]+\}\s*[^{}\s][^{}]*\{[^{}]+\}\s*$/u;

// Whether the line under a label over it states a rule: a relation
// between terms, a Hoare triple ("{$E} empty () {λq. …}"), or, under a
// hyphenated or spaced name, one predicate applied to its terms
// ("persistent(Thunk F t n R φ)").
function related(text: string, token: Token): boolean {
  return BETWEEN.test(text) || TRIPLE.test(text) || (["hyphen", "spaced"].includes(shapeOf(fold(token.text)) ?? "") && /^\s*\p{L}[\p{L}\d]*\(.+\)\s*$/u.test(text));
}

// A line's text without its subscripts, smaller runs set below its
// baseline: a relation indexed so ("⊢CSL") stands between its terms.
function unscripted(line: Line): string {
  let text = line.text, at = 0;
  for (const r of line.runs) {
    const i = text.indexOf(r.text, at);
    if (i < 0) continue;
    if (r.size < line.size - 0.5 && r.baseline > line.baseline + 0.5) { text = text.slice(0, i) + text.slice(i + r.text.length); at = i; } else at = i + r.text.length;
  }
  return text;
}

// A table's cell of figures: numerals and their marks, no term.
const NUMERALS = /^[\s\d.,%±×†*()]*\d[\s\d.,%±×†*()]*$/u;

// A figure's or table's caption under a rule concludes nothing.
const CAPTION = /^\s*(?:Fig(?:ure)?|Table|Listing)\.?\s*\d/i;

// A listing's face (Computer Modern's typewriter in its cm, lm, EC and
// CM-Super cuts, and the like): a word at the head of a row set in it is code.
const MONO = /mono|consol|courier|typewriter|cmtt|lmtt|sftt|ectt|menlo|firacode|sourcecodepro|dejavusansm|inconsolata/i;

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
// its rules, not a table's rule. A stroke across closing three uprights
// level with it or more is a table's row (a grid of ticks and "n/a").
function boxSide(page: Page, d: Drawn, label: Line): boolean {
  if (d.h >= 3 * label.size) return false;
  const sides = (h: Drawn) => page.drawn.filter((u) => upright(u) && Math.abs(u.y - d.y) <= 1 && Math.abs(u.h - d.h) <= 1 && u.x >= h.x - 1 && u.x <= h.x + h.w + 1).length;
  const closes = (y: number) => page.drawn.some((h) => across(h) && Math.abs(h.y - y) <= 1 && h.x <= d.x + 1 && h.x + h.w >= d.x - 1 && sides(h) <= 2);
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
  // A label alone on its row at the column's left edge heads the rule
  // under it wherever the rule stands in the column (OOPSLA's "[Query]"
  // over a centred rule); a word in the text's face there, unbracketed,
  // opens a paragraph's line ("argument p and …").
  const [colLeft, colRight] = Array.isArray(column) ? column : [column.x0, column.x1];
  const alone = ruleLines(page, label).every((l) => l === label || !onRow(l, label) || !sameColumn(page, l, label));
  const margined = alone && Math.abs(label.x0 - colLeft) <= slack && (token.bracketed || faceOf(label, token) !== family(type.font));
  // A bar as wide as the text could be a figure's own rule: it is a rule's
  // only with a conclusion centred under it and clearly shorter.
  const concluded = (d: Drawn) => lines.some((l) => !CAPTION.test(l.text) && l.top >= d.y - 1 && l.top <= d.y + 2 * type.leading && l.x0 < d.x + d.w && l.x1 > d.x
    && Math.abs((l.x0 + l.x1) / 2 - (d.x + d.w / 2)) <= 2 * label.size && l.x1 - l.x0 <= 0.8 * d.w);
  // A bar set close under its premises is no underline where a
  // conclusion as wide stands under it (CD-ST-DEF): text underlined runs
  // on past the stroke.
  const fitting = (l: Line, d: Drawn) => l.x0 >= d.x - label.size && l.x1 <= d.x + d.w + label.size
    && (l.x1 - l.x0 >= 0.5 * d.w || Math.abs((l.x0 + l.x1) / 2 - (d.x + d.w / 2)) <= 2 * label.size);
  const topping = (d: Drawn) => lines.some((l) => l.top >= d.y - 1 && l.top <= d.y + type.leading && fitting(l, d));
  // ... and as wide as a column of text only between premises and a
  // conclusion that fit it, well short of the page's text (a figure's
  // own rule runs across it).
  const capping = (d: Drawn) => lines.some((l) => l.bottom <= d.y + 1 && l.bottom >= d.y - type.leading && fitting(l, d));
  // ... or drawn exactly as wide as the conclusion under it or a premise
  // over it, however wide (E-APP-FUNCTOR's across the column): a figure's
  // own rule is drawn to the figure, not to a line of it.
  const edge = (l: Line, d: Drawn) => Math.abs(l.x0 - d.x) <= 0.5 * label.size && Math.abs(l.x1 - d.x - d.w) <= 0.5 * label.size;
  const sized = (d: Drawn) => topping(d) && capping(d) && lines.some((l) => ((l.top >= d.y - 1 && l.top <= d.y + type.leading) || (l.bottom <= d.y + 1 && l.bottom >= d.y - type.leading)) && edge(l, d));
  // ... or with the label standing beside it, level with it.
  const besides = (d: Drawn) => Math.abs(d.y - mid) <= LEVEL * label.size && (d.x >= label.x1 - slack || d.x + d.w <= label.x0 + slack);
  // A label level with its bar may stand further off to its right (JFP's
  // \\infer sets T_Var an inch from its bar) where nothing but blank lies
  // between them; one to the left heads a rule of its own (DirVar).
  // A label with a line just under it heads a rule of its own (DirVal).
  const under = lines.filter((l) => l.top >= label.bottom - 1 && l.top <= label.bottom + 0.8 * type.leading && l.x0 < label.x1 && l.x1 > label.x0);
  const gapTo = (d: Drawn) => Math.max(0, d.x - label.x1, label.x0 - (d.x + d.w));
  const blankTo = (d: Drawn) => {
    const from = Math.min(label.x1, d.x + d.w), to = Math.max(label.x0, d.x);
    return d.x + d.w <= label.x0 + slack && gapTo(d) <= FAR * label.size && !under.length && !lines.some((l) => level(l, label) && l.x0 < to - 0.5 * label.size && l.x1 > from + 0.5 * label.size)
      && !page.drawn.some((o) => o !== d && across(o) && Math.abs(o.y - mid) <= LEVEL * label.size && o.x < to && o.x + o.w > from);
  };
  // What counts as a rule's bar (rule.bar).
  // A short bar (an axiom's, as wide as its one-symbol conclusion) is a
  // bar only level with the label or under it; a stroke that touches the
  // line over it is a bar only with a conclusion centred under it.
  // Further down, a bar ends a stack of premises that runs unbroken from
  // the label, each line hard under the last (a specification's
  // precondition, nine lines in braces over FUTURE-ITER-SPEC's bar).
  const unbroken = (d: Drawn) => {
    const stack = lines.filter((l) => l !== label && l.bottom > label.bottom && l.bottom < d.y + 1 && l.x0 < d.x + d.w && l.x1 > d.x).sort((a, b) => a.top - b.top);
    let end = label.bottom;
    for (const l of stack) { if (l.top - end > 0.5 * type.leading) return false; end = Math.max(end, l.bottom); }
    return d.y - end <= 0.5 * type.leading;
  };
  // Under the label, a bar as wide as the one line under it is an
  // axiom's however short (Ctx-Empty's "⊢ ·").
  const matched = (d: Drawn) => lines.some((l) => l.top >= d.y - 1 && l.top <= d.y + type.leading && Math.abs(l.x0 - d.x) <= 1 && Math.abs(l.x1 - d.x - d.w) <= 1);
  const near = page.drawn.filter((d) => across(d) && d.w <= widest && (d.w >= 2 * label.size || (d.w >= 1.3 * label.size && (besides(d) || d.y >= label.bottom - 1)) || (d.w >= label.size && d.y >= label.bottom - 1 && matched(d)))
    && (d.w <= wide || concluded(d) || besides(d) || sized(d) || (topping(d) && capping(d) && d.w <= HUGGED * (type.text.x1 - type.text.x0)))
    && d.y >= label.top - OVER_REACH * type.leading && (d.y <= label.bottom + OVER_REACH * type.leading || (d.y <= label.bottom + 2 * OVER_REACH * type.leading && unbroken(d)))
    && ((d.x <= label.x1 + 2 * slack && d.x + d.w >= label.x0 - 2 * slack) || (besides(d) && blankTo(d)) || (margined && d.y > label.bottom && d.x >= label.x0 && d.x + d.w <= colRight + slack)) && !framed(page, d) && !dividing(page, d, type) && !overline(page, d, type) && !struck(page, d) && (!underline(page, d) || concluded(d) || topping(d)) && !inProse(page, d, type));
  const bars = near.filter((d) => d.y >= label.top - NEAR_BAR * type.leading && d.y <= label.bottom + NEAR_BAR * type.leading)
    .sort((a, b) => Math.abs(a.y - mid) - Math.abs(b.y - mid) || gapTo(a) - gapTo(b));
  // The nearest bar under the label, for a label standing over its premises.
  const aside = (d: Drawn) => Math.abs(d.x + d.w / 2 - (label.x0 + label.x1) / 2);
  const below = near.filter((d) => d.y >= label.bottom - 1).sort((a, b) => (Math.abs(a.y - b.y) > 1 ? a.y - b.y : aside(a) - aside(b)));
  // A line hard under another label is that label's premise, on no row
  // of this one's (HThunk-Force's precondition, set lower beside
  // HThunk-Consequence), unless it shares the label's baseline (a
  // table's cells, each under the one over it).
  const headedBy = (l: Line) => lines.some((o) => o !== label && o.top < l.top && l.top - o.bottom <= 0.5 * type.leading && o.x0 < l.x1 && o.x1 > l.x0 && tokenOf(o)?.side === "whole");
  const lowered = (l: Line) => headedBy(l) && Math.abs(l.baseline - label.baseline) > 1;
  let row = lines.filter((l) => onRow(l, label) && sameColumn(page, l, label) && !lowered(l));
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
  // Under the label's row, beside the label's own column, stand
  // numerals, a row's heading at most to their left: the row heads a
  // table's columns ("MLKit" over its timings, "Program/Compiler" over
  // counts), however its cells are ruled.
  const cells = lines.filter((l) => l.top >= label.bottom - 1 && l.top <= label.bottom + 1.5 * type.leading && sameColumn(page, l, label) && (l.x1 <= label.x0 || l.x0 >= label.x1));
  const figures = cells.filter((l) => NUMERALS.test(l.text));
  if (token.side === "whole" && figures.length >= 2 && cells.every((l) => figures.includes(l) || figures.every((f) => l.x1 <= f.x0))) return { category: "cell", bar: null, row, side: "over" };
  // A bar with a label of its own set beside it (SSub_Refine) is that
  // label's rule: a label over it is the axiom's under the rule above.
  const claimed = (bar: Drawn) => lines.some((l) => Math.abs((l.top + l.bottom) / 2 - bar.y) <= LEVEL * label.size && l.x0 >= bar.x + bar.w - slack && l.x0 - bar.x - bar.w <= 2 * label.size
    && Math.abs(l.size - label.size) <= 0.5 && tokenOf(l)?.side === "whole" && faceOf(l) === faceOf(label));
  const beside: Setting[] = [];
  for (const bar of bars) {
    if (!concluded1(bar)) continue;
    // Raised onto the last premise's line, an em clear of it, its right
    // edge at the bar's end (Oxidizing OCaml's CASE): beside it all the
    // same. A table's header over its rule has no premise beside it, and
    // a bar with its own label level beside it (Cex-Emp) is that one's.
    const perched = token.side === "whole" && !claimed(bar) && !RELATION.test(label.text) && row.some((l) => l.x1 <= label.x0 && RELATION.test(l.text)) && row.every((l) => l.x1 <= label.x0 - label.size || l.x0 >= label.x1) && label.x0 > bar.x && Math.abs(label.x1 - bar.x - bar.w) <= 2 * slack && bar.y >= label.bottom - 1 && bar.y - label.bottom <= 0.5 * type.leading;
    if (perched) beside.push({ category: "beside", bar, row, side: "right", derived: derivation(page, bar, lines, type, slack), step: stepInto(page, bar, lines, type, slack) });
    else if (Math.abs(bar.y - mid) <= LEVEL * label.size) {
      // Level with the bar: beside it, or a cell over a table's rule.
      // A premise's overline running under the label is neither, nor
      // one the label only clips (a table's header stands over its rule).
      if (label.x0 < bar.x + bar.w - slack && label.x1 > bar.x + slack) {
        if (hugs(page, bar, type) || Math.min(label.x1, bar.x + bar.w) - Math.max(label.x0, bar.x) < 0.5 * (label.x1 - label.x0)) continue;
        return { category: "cell", bar, row, side: "over" };
      }
      const right = bar.x + bar.w <= label.x0 + slack;
      // A word set into a rule, the bar touching it on both sides, heads a
      // group ("——— Structural ———"); a rule's label has a gap on its side.
      const touching = (d: Drawn) => across(d) && Math.abs(d.y - bar.y) <= 1
        && (Math.abs(d.x - label.x1) <= TOUCH * label.size || Math.abs(d.x + d.w - label.x0) <= TOUCH * label.size);
      const goesOn = touching(bar) && page.drawn.some((d) => d !== bar && touching(d));
      if (goesOn) return { category: "group", bar, row, side: right ? "right" : "left" };
      // To the left of a stroke with nothing over it that runs straight
      // into a wider bar under it, the label heads the rule: the stroke is
      // its premise's overline (LIST's "‾Δ ⊢ Aᵢ : K‾").
      const bare = !lines.some((l) => l !== label && l.bottom <= bar.y + 1 && l.bottom >= bar.y - type.leading && l.x0 < bar.x + bar.w && l.x1 > bar.x);
      if (!right && bare && stepInto(page, bar, lines, type, slack)) continue;
      // Two sizes or more from the label, a stroke past a bar just under
      // the label spanning it is another rule's: the label stands over
      // that bar (M-Interface beside M-Struct's "‾η ⊢ τ ↦ t†‾").
      const far = (right ? label.x0 - bar.x - bar.w : bar.x - label.x1) >= 2 * label.size;
      if (far && page.drawn.some((d) => d !== bar && across(d) && !framed(page, d) && d.y > label.bottom - 1 && d.y - label.bottom <= 2 * type.leading && d.x <= label.x0 + slack && d.x + d.w >= label.x1)) continue;
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
  // A bar a wider one runs under, from its left edge, its conclusion the
  // one row between, may end a premise's own derivation (PGM-DT-TT): the
  // rule's is the wider where the label stands over it.
  const oneRow = (between: Line[]) => between.length > 0 && Math.max(...between.map((l) => l.top)) - Math.min(...between.map((l) => l.top)) < 0.5 * type.leading;
  const main = (bar: Drawn): Drawn => {
    const wider = near.find((d) => d.y > bar.y && d.y - bar.y <= 2 * type.leading && d.x <= bar.x + 2 && d.x + d.w >= bar.x + bar.w - 2 && d.w >= bar.w + label.size && concluded1(d) && concludes(page, d, type)
      && oneRow(lines.filter((l) => l.top > bar.y - 1 && l.bottom < d.y + 1 && l.x0 < bar.x + bar.w && l.x1 > bar.x)));
    return wider ? main(wider) : bar;
  };
  // On its own line over the premises, aligned with the rule's left edge
  // or its middle: mathpar's label, as far up as the premises stack.
  // A stroke with nothing between it and the label that runs straight
  // into a wider bar under it is a premise's overline (ROW's "‾Γ ⊢ ξᵢ : L‾").
  const overlining = (d: Drawn) => !lines.some((l) => l !== label && l.top >= label.bottom - 1 && l.bottom <= d.y + 1 && l.x0 < d.x + d.w && l.x1 > d.x)
    && Boolean(stepInto(page, d, lines, type, slack));
  for (const bar of below.flatMap((lower) => (claimed(lower) || overlining(lower) ? [] : main(lower) === lower ? [lower] : [main(lower), lower]))) {
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
    // sets as lines of their own block nothing, nor a big operator rising
    // to the label (a ⋀ its font maps to "Û").
    const blocks = (l: Line) => spans(l) && /[\p{L}\d]/u.test(l.text) && !(l.text.trim().length === 1 && l.runs.every((r) => EXTENSION.test(r.font))) && !/^\s*[[(].*[\])]\s*$/.test(l.text) && (l.x0 < label.x1 - tolerance(l, label) || !fits(l) || !RELATION.test(l.text) || GRAMMAR.test(l.text));
    const heads = row.some((l) => spans(l) && RELATION.test(l.text) && l.x0 >= label.x1 - tolerance(l, label) && fits(l));
    // A label at the margin heads the first bar under it only: bars
    // stacked over this one are a derivation's ("Θ₂ = …" over Fig. 9).
    const stacked = page.drawn.some((d) => d !== bar && across(d) && d.w >= 2 * label.size && d.y > label.bottom - 1 && d.y < bar.y - 1 && d.x < bar.x + bar.w && d.x + d.w > bar.x);
    // ... and the first bar on its row to its right: MT-Abs's is not
    // MT-Expand's, two rules along.
    const skipped = page.drawn.some((d) => d !== bar && across(d) && d.w >= 2 * label.size && Math.abs(d.y - bar.y) <= 1 && d.x >= label.x0 - slack && d.x < bar.x);
    const aligned = Math.abs(label.x0 - bar.x) <= 2 * label.size || Math.abs((label.x0 + label.x1) / 2 - (bar.x + bar.w / 2)) <= 2 * label.size
      || (heads && label.x0 >= bar.x - 2 * label.size && label.x1 <= bar.x + bar.w) || (margined && bar.x >= label.x0 - slack && !stacked && !skipped);
    // The premises between the label and the bar stand over the bar; a
    // listing's lines run past a rule drawn under it.
    const between = lines.filter((l) => l.top >= label.bottom - tolerance(l, label) && l.bottom <= bar.y + 1 && spans(l));
    const overhangs = between.some((l) => !fits(l)) || concluding.some((l) => !fits(l));
    // A hyphenated, spaced or symbol name between them, set smaller than
    // the label, labels the bar itself: the label over it heads the group
    // ("Implements" over <:-Param; a premise "strongly-stuck(e)" is set
    // as the text is).
    const relabelled = between.some((l) => { const t = tokenOf(l); return t?.side === "whole" && l.size < label.size - 0.5 && ["hyphen", "spaced", "symbol"].includes(shapeOf(fold(t.text)) ?? ""); });
    // The premises stand in one stack from the label to the bar: a blank
    // line's height between parts the label's own barless row from the
    // next rule's premises (NB-BIGMIX over an unlabelled rule).
    const stack = [label, ...between].sort((a, b) => a.top - b.top);
    const gapped = stack.some((l, i) => i > 0 && l.top - Math.max(...stack.slice(0, i).map((o) => o.bottom)) > type.leading);
    // Another label set as this one is, between them, heads the bar: this
    // label's rule is set without one (HOARE-UNITARY over HOARE-MEASURE,
    // both barless, over HOARE-SEQ's bar).
      const headed = between.some((l) => { const t = tokenOf(l); return t?.side === "whole" && Math.abs(l.size - label.size) <= 0.5 && faceOf(l) === faceOf(label) && shapeOf(fold(t.text)) === shapeOf(fold(token.text)); });
    // No other bar between the label and this one spans the label, but a
    // premise's own: the label is that rule's, or its premise.
    const barred = page.drawn.some((d) => d !== bar && across(d) && main(d) !== bar && !overline(page, d, type) && d.w >= 2 * label.size && d.y > label.bottom - 1 && d.y < bar.y && d.x < label.x1 && d.x + d.w > label.x0
      && !lines.some((l) => l.top < d.y && d.y < l.bottom && l.x0 <= d.x + 1 && d.x + d.w <= l.x1 + 1));
    // A relation on the label's row clear of the bar is the row the
    // label heads ("(tapp)" over the next figure's rule); a premise over a
    // bar of its own is the next rule's (ENV-R-KVAR's beside ENV-R-EMPTY).
    const premised = (l: Line) => page.drawn.some((d) => d !== bar && across(d) && d.y >= l.bottom - 1 && d.y <= l.bottom + type.leading && d.x <= (l.x0 + l.x1) / 2 && d.x + d.w >= (l.x0 + l.x1) / 2);
    // ... nor is one hard under another label, that label's premise
    // (POOL-RUN-SPEC's "model t ∗" beside POOL-CREATE-SPEC).
    const rowed = row.some((l) => !spans(l) && l.x0 >= label.x1 - tolerance(l, label) && l.x0 - label.x1 <= 4 * label.size && RELATION.test(l.text) && !premised(l) && !headedBy(l));
    // Three plain upright words or more with no relation or formula under
    // the bar are a table's subheadings ("LOC Spec Time (s)" under Flux's rule) or a
    // plot's axis labels ("pgn ppm sexp" under ParTS's legend swatch).
    // A lone constant ("False", "Proph") concludes all the same.
    const worded = concluding.length > 0 && concluding.every((l) => /\p{L}{3}/u.test(l.text) && l.text.trim().split(/\s+/).length >= 3 && l.text.split(/\s+/).every((w) => /^[\p{L}\d().,%-]*$/u.test(w))
      && !/[\u{1D400}-\u{1D7FF}]/u.test(l.text) && l.runs.every((r) => !/\p{L}/u.test(r.text) || (!ITALIC.test(r.font) && !SYMBOLIC.test(r.font) && !MONO.test(r.font))));
    if (under && token.side === "whole" && aligned && !overhangs && !worded && !relabelled && !headed && !gapped && !barred && !rowed && !row.some(blocks)) return { category: "over", bar, row, side: "over", derived: derivation(page, bar, lines, type, slack, label.bottom - 1), step: stepInto(page, bar, lines, type, slack) };
  }
  // Over the one line of an axiom set without a bar, aligned with it:
  // the line under the label holds a relation between terms and nothing
  // else on the label's row reaches over it. A bare word stands so only
  // where the paper sets two labels over bars the same way (findRules):
  // alone it heads a listing ("in", "Core") or a grammar's column ("id ⇒
  // Return").
  const overRow = (): Line[] | null => {
    if (token.side !== "whole") return null;
    // Labels set side by side over theirs, each line is the nearest's
    // ("[MergeIdempotence]" between two other labelled equations).
    // Labels set flush over the left of their rows (a table of reductions,
    // "(Ast-Gen)" and "(Sec-Tls)" heading two columns) take the lines from
    // their left edge on, the next column's label ending them.
    const others = row.filter((l) => tokenOf(l)?.side === "whole");
    const middle = (l: Line) => (l.x0 + l.x1) / 2;
    const flush = (o: Line) => lines.some((u) => u !== o && Math.abs(u.x0 - o.x0) <= o.size && u.top >= o.bottom - tolerance(u, o) && u.top <= o.bottom + type.leading);
    const heads = others.length > 0 && flush(label) && others.every(flush);
    const reach = (l: Line, o: Line) => (heads ? (l.x0 >= o.x0 - o.size ? l.x0 - o.x0 : Infinity) : Math.abs(middle(l) - middle(o)));
    // A big operator hangs from its baseline, whatever its line's top says.
    const hangs = (l: Line) => l.runs.every((r) => EXTENSION.test(r.font) || r.size < l.size - 0.5) && l.runs.some((r) => EXTENSION.test(r.font)) && l.baseline > label.bottom;
    const under = lines.filter((l) => (l.top >= label.bottom - tolerance(l, label) || hangs(l)) && l.top <= label.bottom + 1.2 * type.leading
      && l.x0 < label.x1 + 2 * label.size && l.x1 > label.x0 - 2 * label.size && sameColumn(page, l, label)
      && !others.some((o) => reach(l, o) < reach(l, label)));
    if (!under.length) return null;
    // The row runs on past the label in pieces a big operator apart.
    for (let grew = true; grew;) {
      grew = false;
      for (const l of lines) {
        if (under.includes(l) || !sameColumn(page, l, label) || others.some((o) => reach(l, o) < reach(l, label))) continue;
        if (under.some((u) => (Math.abs(u.baseline - l.baseline) <= 1 || (hangs(l) && l.baseline < u.baseline && u.top - l.bottom < 0)) && Math.max(u.x0, l.x0) - Math.min(u.x1, l.x1) <= 2 * label.size)) { under.push(l); grew = true; }
      }
    }
    const x0 = Math.min(...under.map((l) => l.x0)), x1 = Math.max(...under.map((l) => l.x1)), bottom = Math.max(...under.map((l) => l.bottom));
    const aligned = Math.abs(x0 - label.x0) <= 2 * label.size || Math.abs((x0 + x1) / 2 - centre) <= 2 * label.size;
    // A stroke under one letter ($N̲) marks the letter, no bar.
    const stroke = page.drawn.some((d) => across(d) && d.w >= 1.3 * label.size && d.y > label.bottom - 1 && d.y < bottom && d.x < x1 && d.x + d.w > x0);
    const blocked = row.some((l) => !hangs(l) && l.x0 < x1 && l.x1 > x0 && /[\p{L}\d]/u.test(l.text));
    return aligned && !stroke && !blocked && !under.some((l) => production(l, page, type)) && related(under.map(unscripted).join(" "), token) ? under : null;
  };
  // Under the conclusion, its edge at the bar's: the bar just over the
  // label with a conclusion between, nothing on the label's row over it.
  if (token.side === "whole") {
    for (const bar of bars) {
      if (bar.y >= label.top || !concluded1(bar)) continue;
      const spans = (l: Line) => l.x0 < bar.x + bar.w && l.x1 > bar.x;
      // Ticks on the label's own row are a table's cells, no conclusion.
      const conclusion = lines.filter((l) => spans(l) && l.top >= bar.y - 1 && l.top <= bar.y + 2 * type.leading && !onRow(l, label));
      if (!conclusion.length || Math.min(...conclusion.map((l) => l.top)) >= label.top || label.top - Math.max(...conclusion.map((l) => l.bottom)) > type.leading) continue;
      // A label nearer its own row under it than the conclusion over it
      // heads that row (SUM-BIGBMIX under HOARE-SUM's conclusion).
      const own = overRow();
      if (own && Math.min(...own.map((l) => l.top)) - label.bottom < label.top - Math.max(...conclusion.filter((l) => l.bottom <= label.top + 1).map((l) => l.bottom), -Infinity)) continue;
      // Its right edge at the bar's, or hanging past it from within (JFP
      // sets F_Compat under the conclusion's end, past the bar's; SWF_Refine
      // stops short of the bar's).
      const right = Math.abs(label.x1 - bar.x - bar.w) <= 2 * slack || (label.x0 > bar.x && label.x1 >= Math.max(...conclusion.map((l) => l.x1)) - 2 * slack && label.x1 - bar.x - bar.w <= 4 * slack);
      const left = Math.abs(label.x0 - bar.x) <= 2 * slack;
      if ((right || left) && !row.some((l) => spans(l) && /[\p{L}\d]/u.test(l.text))) return { category: "beside", bar, row, side: right ? "right" : "left" };
    }
  }
  {
    const own = overRow();
    if (own) return { category: "over", bar: null, row: own, side: "over" };
  }
  // A label set level with a stack of lines touches each without sharing
  // half its height with any: the stack is its row. Other labels on the
  // label's row (the next rule's, set beside) are not its row, nor the
  // lines hard under them.
  if (row.every((l) => WHOLE.test(l.text))) row = lines.filter((l) => level(l, label) && !onRow(l, label) && sameColumn(page, l, label) && tokenOf(l)?.side !== "whole");
  const rest = (token.side === "whole" ? "" : label.text.slice(0, token.start) + " " + label.text.slice(token.end) + " ") + row.map((l) => l.text).join(" ");
  const body = /\p{L}|[^\p{L}\d\s\[\]()]/u.test(rest.replace(/[\[\]()]/g, "")) && rest.replace(/\s/g, "").length >= 3;
  if (!body) return { category: "none", bar: null, row, side: "right" };
  // A relation level with the label counts, on its row or in a line the
  // layout set apart (a tall arrow between two lines of terms).
  const levelled = page.lines.filter((l) => l !== label && onRow(l, label) && sameColumn(page, l, label) && !lowered(l)).map((l) => l.text).join(" ");
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
  // table's ("MaxMigrate" beside a benchmark's name); another label set
  // as this one is (a rule beside, Wp-store beside Wp-load) is not.
  const sibling = (l: Line) => { const t = tokenOf(l); return Boolean(t) && faceOf(l, t!) === faceOf(label, token) && Math.abs(l.size - label.size) <= 0.5; };
  // A side condition in parentheses, or opening with "where", "if" and
  // the like, ends a rule's row ("(d fresh)", "where η fresh").
  const sideNote = (l: Line) => /^\s*(?:\(.*\)|(?:where|when|if|iff|provided|unless)\s.*)$/.test(l.text);
  if (row.some((l) => !sibling(l) && !sideNote(l) && faceOf(l) === family(type.font) && !RELATION.test(l.text) && /\p{L}{3}/u.test(l.text))) return { category: "cell", bar: null, row, side: "right" };
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
  // A row hard over a bar it fills from end to end is that rule's
  // premises, the token its first ("Γ RRG" over param's bar); a stroke
  // reaching well past the row parts a figure ((obs) over one).
  const from = Math.min(label.x0, ...row.map((l) => l.x0)), to = Math.max(label.x1, ...row.map((l) => l.x1));
  if (bars.some((b) => b.y > label.bottom - 1 && b.y - label.bottom <= type.leading && Math.abs(b.x - from) <= 2 * label.size && Math.abs(b.x + b.w - to) <= 2 * label.size)) return { category: "none", bar: null, row, side: "right" };
  return side && RELATION.test(text + " " + levelled) ? { category: "row", bar: null, row, side } : { category: "none", bar: null, row, side: "right" };
}

// ------------------------------------------------------------ pass 3: names

const HYPHEN = RULE_SHAPE_HYPHEN.pattern!;
const SPACED = RULE_SHAPE_SPACED.pattern!;
const WORD = RULE_SHAPE_WORD.pattern!;
const SYMBOL = RULE_SHAPE_SYMBOL.pattern!;
const PHRASE = RULE_SHAPE_PHRASE.pattern!;

function shapeOf(text: string): Shape | null {
  if (HYPHEN.test(text)) return "hyphen";
  if (SPACED.test(text)) return "spaced";
  if (WORD.test(text)) return "word";
  if (SYMBOL.test(text)) return "symbol";
  if (PHRASE.test(text)) return "phrase";
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
      return shape === "symbol" || (shape === "word" && !token.bracketed && !token.colon) || (shape === "phrase" && !token.bracketed) ? null : RULE_NAME_ROW.id;
    case "margin":
      return shape === "phrase" ? null : shape === "hyphen" || shape === "spaced" || (shape === "word" && token.square) ? RULE_NAME_MARGIN.id : null;
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
// Nor is a caption, another label (`others`), a line set just under or over
// another bar (that rule's conclusion or premise), a line of running
// text round a rule set inline, a line over a label that stands over
// its premises, or, in a row, a line on another label's row.
interface Others { lines: Set<Line>; bars: Drawn[] } // the other labels on the page and their bars
function boxOf(page: Page, label: Line, setting: Setting, type: Type, others: Others = { lines: new Set(), bars: [] }, out?: { lines: Line[] }): Box {
  const bars = others.bars.filter((d) => d !== setting.bar);
  const another = (l: Line) => bars.some((d) => d.x < l.x1 && d.x + d.w > l.x0 && (Math.abs(l.top - d.y) <= 0.8 * type.leading || Math.abs(l.bottom - d.y) <= 0.8 * type.leading));
  // A premise in words ("t₂ →* true implies …") over the bar, within its
  // span, is no running text.
  const bar = setting.bar;
  const premise = (l: Line) => Boolean(bar) && l.x0 >= bar!.x - label.size && l.x1 <= bar!.x + bar!.w + label.size && l.bottom <= bar!.y + 1 && l.bottom >= bar!.y - 1.5 * type.leading;
  // Nor is a line set smaller than the text, as a figure is ("when T₂ ≠
  // … and …" under E_Forget).
  // A side condition ("where 0−free(ℓ, E) and …") set in from the rule's
  // edge under its row is no running text either.
  const running = (l: Line) => prose(l, type) && l.size >= 0.95 * type.bodySize
    && !(/^\s*(?:where|if|when|provided|unless)\b/i.test(l.text) && l.x0 > label.x0 + 2 * label.size);
  const lines = ruleLines(page, label).filter((l) => !others.lines.has(l) && !another(l) && !setInto(page, l) && (!running(l) || premise(l)) && !CAPTION.test(l.text)
    && (setting.side !== "over" || l.top >= label.top - tolerance(l, label))
    && (setting.bar || ![...others.lines].some((o) => onRow(o, l))));
  const slack = setting.bar ? 0 : BESIDE * label.size;
  const taken = new Set<Line>([label]);
  let x0: number, x1: number;
  if (bar) {
    x0 = Math.min(bar.x, label.x0); x1 = Math.max(bar.x + bar.w, label.x1);
    for (const l of lines) if (l.x0 <= x1 + slack && l.x1 >= x0 - slack && l.bottom >= bar.y - 0.8 * type.leading && l.top <= bar.y + 0.8 * type.leading) taken.add(l);
  } else {
    for (const l of setting.row) taken.add(l);
    x0 = Math.min(...[...taken].map((l) => l.x0)); x1 = Math.max(...[...taken].map((l) => l.x1));
  }
  // Past the conclusion, a line over another bar is that rule's premise
  // (Assign's over Access's conclusion; 1⊥'s over ⊗⅋'s, though "1⊥" is no
  // name found), unless it opens with a relation: the conclusion broken
  // over two lines (Define's "→ ⟨body…⟩").
  const beyond = (l: Line) => Boolean(bar) && l.top > bar!.y + 0.8 * type.leading && !/^\s*[→⟶⇒↦=≡⊢]/u.test(l.text)
    && page.drawn.some((d) => d !== bar && across(d) && d.y > l.bottom && d.y - l.bottom <= 2 * type.leading && d.x <= l.x0 + label.size && d.x + d.w >= l.x1 - label.size);
  // Labels set level over bar-less rows head columns: a row keeps to its
  // own, from its label's left edge to the next label's ("(Ast-Gen)" and
  // "(Sec-Tls)" over two reductions).
  const columns = !bar && setting.side === "over" ? [...others.lines].filter((o) => o !== label && level(o, label)) : [];
  const fence = Math.min(...columns.filter((o) => o.x0 > label.x1).map((o) => o.x0));
  const fenced = (l: Line) => columns.length > 0 && ((l.x0 + l.x1) / 2 < label.x0 || (l.x0 + l.x1) / 2 > fence);
  // A label over a tall stack of premises reaches its bar's conclusion.
  const within = (l: Line) => l.bottom >= label.top - REACH * type.leading && l.top <= Math.max(label.bottom + REACH * type.leading, bar ? bar.y + type.leading : -Infinity);
  for (let grew = true; grew;) {
    grew = false;
    for (const line of lines) {
      if (taken.has(line) || line.x0 > x1 + slack || line.x1 < x0 - slack || !within(line) || !sameColumn(page, line, label) || beyond(line) || fenced(line)) continue;
      if (![...taken].some((t) => level(t, line))) continue;
      taken.add(line); grew = true;
      // Without a bar the row is as wide as its pieces, set a blank apart
      // (a big operator splits "⨁ₓ Pₓ ⊢ (⨁ₓ Pₓ) + (⨁ₓ Qₓ)" into lines).
      if (!bar) { x0 = Math.min(x0, line.x0); x1 = Math.max(x1, line.x1); }
    }
  }
  // Premises stacked over the bar reach up the same way, each line hard
  // over the next within the bar's span (T-If's three premises, each in
  // its grey panel).
  if (bar) {
    for (let grew = true; grew;) {
      grew = false;
      const over = [...taken].filter((t) => t.bottom < bar.y + 1 && t !== label);
      if (!over.length) break;
      const start = Math.min(...over.map((t) => t.top));
      for (const line of lines) {
        if (taken.has(line) || line.x0 < bar.x - label.size || line.x1 > bar.x + bar.w + label.size || !sameColumn(page, line, label) || tokenOf(line)?.side === "whole") continue;
        if (line.bottom > start + 1 || start - line.bottom > 0.6 * type.leading || line.text.replace(/\s/g, "").length < 2) continue;
        // Upright words in the text's face are a note beside the rules
        // ("No ⊤L rules"), no premise.
        if (faceOf(line) === family(type.font) && line.runs.filter((r) => /\p{L}{2,}/u.test(r.text) && !ITALIC.test(r.font)).length >= 2) continue;
        // Another bar over it or under it makes it another rule's.
        const barred = page.drawn.some((d) => d !== bar && across(d) && !overline(page, d, type) && d.x < line.x1 && d.x + d.w > line.x0
          && ((d.y >= line.top - 0.8 * type.leading && d.y <= line.top + 1) || (d.y >= line.bottom - 1 && d.y <= start + 1)));
        if (barred) continue;
        taken.add(line); grew = true;
      }
    }
  }
  // A conclusion set over several lines runs on, each line hard under
  // the last within the bar's span: a specification's program and its
  // postcondition in braces under a stack of bars (POOL-SIZE-SPEC).
  if (bar) {
    for (let grew = true; grew;) {
      grew = false;
      const under = [...taken].filter((t) => t.top > bar.y - 1 && t.size <= 2 * label.size);
      const end = Math.max(...under.map((t) => t.bottom));
      if (!under.length) break;
      for (const line of lines) {
        if (taken.has(line) || line.size > 2 * label.size || line.x0 < bar.x - label.size || line.x1 > bar.x + bar.w + label.size || !sameColumn(page, line, label) || beyond(line)) continue;
        // A lone glyph (a piece of the next line's tall brace) runs nothing on.
        if (line.top < end - 1 || line.top - end > 0.4 * type.leading || line.text.replace(/\s/g, "").length < 2) continue;
        taken.add(line); grew = true;
      }
    }
  }
  // Without a bar, a specification set under its label runs on the same
  // way: its program and postcondition, each line hard under the last,
  // opening within the block (STREAM-APPEND's "append s₁ s₂" under its
  // precondition in braces).
  if (!bar && setting.side === "over") {
    for (let grew = true; grew;) {
      grew = false;
      const end = Math.max(...[...taken].map((t) => t.bottom));
      const from = Math.min(...[...taken].map((t) => t.x0)), to = Math.max(...[...taken].map((t) => t.x1));
      // Its braces, however tall, carry the stack on.
      for (const line of [...lines, ...page.lines.filter((l) => !l.furniture && STRETCHED.test(l.text) && l.size > 2 * label.size)]) {
        if (taken.has(line) || line.x0 < from - label.size || line.x0 > to || !sameColumn(page, line, label) || tokenOf(line)?.side === "whole") continue;
        if (line.top < end - 1 || line.top - end > 0.6 * type.leading || (!STRETCHED.test(line.text) && line.text.replace(/\s/g, "").length < 2)) continue;
        taken.add(line); grew = true;
      }
    }
  }
  // A row left open by its relation ("⟪ e[e′](e₁, …) ⟫ =") runs on under
  // itself, each line hard under the last and set in past the row's
  // start, until a line back at the start opens the next row (DS-CTOR's
  // six lines of lets).
  if (!bar && setting.side !== "over") {
    const row = [...taken].filter((t) => t !== label).sort((a, b) => a.x0 - b.x0);
    const start = Math.min(...row.map((t) => t.x0));
    if (row.length && OPEN.test(row.map((t) => t.text).join(" "))) {
      for (let grew = true; grew;) {
        grew = false;
        const end = Math.max(...[...taken].map((t) => t.bottom));
        for (const line of lines) {
          if (taken.has(line) || line.x0 <= start + 0.5 * label.size || !sameColumn(page, line, label) || tokenOf(line)?.side === "whole") continue;
          if (line.top < end - 1 || line.top - end > 0.6 * type.leading) continue;
          taken.add(line); grew = true;
        }
      }
    }
  }
  const all = [...taken];
  if (out) out.lines = all;
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
 * Every named rule, by its name in lower case (and `#n` for its n-th
 * definition again): each label in reading order defines one. `skip` holds lines that label nothing
 * (the bibliography's); `flows` is the text, read for what it cites.
 */
// A bar set as text: a line of dashes, with digits on it or a star at
// its end as Iris draws its rules (rule.bar).
// Two such bars on one baseline reach the layout as one line ("−−−∗ −−−∗")
// and are two bars, split at the blank between them.
const TEXT_BAR = /^[−–—\-][−–—\-\d]*∗?$/;
const textBar = (part: string) => TEXT_BAR.test(part) && part.replace(/[^−–—\-]/g, "").length >= 4;
const textBars = (page: Page): Drawn[] => page.lines.flatMap((l) => {
  const parts = l.text.split(/\s+/).filter(Boolean);
  if (!parts.length || !parts.every(textBar)) return [];
  const bars: Drawn[] = [];
  for (const m of l.text.matchAll(/\S+/g)) {
    const x0 = edgesOf(l, m.index!)?.[0] ?? l.x0, x1 = edgesOf(l, m.index! + m[0].length - 1)?.[1] ?? l.x1;
    bars.push({ x: x0, y: l.bottom - 0.4 * l.size, w: x1 - x0, h: 0, image: false });
  }
  return bars;
});

export function findRules(layout: Layout, skip: Set<Line>, flows: Flow[], trace: Trace): Map<string, Rule> {
  const type = typeOf(layout);
  let candidates: Candidate[] = [];
  const at = (page: Page, line: Line, box: Box) => [{ page: page.number, ...box }];
  const seen: { page: Page; line: Line; token: Token; setting: Setting }[] = [];
  // The size labels are measured against: the layout's body size, or the
  // size most lines of prose length are set in where that is larger (a
  // paper whose listings or plots outweigh its text).
  const sizes = new Map<number, number>();
  for (const page of layout.pages) for (const l of page.lines) if (!l.furniture && l.text.length >= 60) sizes.set(Math.round(l.size * 2) / 2, (sizes.get(Math.round(l.size * 2) / 2) ?? 0) + 1);
  const proseSize = [...sizes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? layout.bodySize;
  const bodySize = Math.max(layout.bodySize, proseSize);
  const pages = layout.pages.map((page) => { const bars = textBars(page); return bars.length ? { ...page, drawn: [...page.drawn, ...bars] } : page; });
  for (const page of pages) {
    for (const line of page.lines) {
      if (line.furniture || skip.has(line) || line.size > LABEL_SIZE * bodySize || line.size < LABEL_LEAST * bodySize) continue;
      const token = tokenOf(line);
      if (token) seen.push({ page, line, token, setting: settingOf(page, line, token, type) });
    }
  }
  // A label in a column of labels heading or ending rows (two or more
  // set alike at its edge) may stand closer to its row than one alone:
  // "(perform)" as long as its row's indent, E_PreCheck at the end of a
  // long reduction.
  for (const page of pages) {
    const rows = seen.filter((s) => s.page === page && (s.setting.category === "row" || s.setting.category === "margin"));
    const edge = (l: Line, side: Token["side"]) => (side === "head" ? l.x0 : l.x1);
    for (const line of page.lines) {
      if (line.furniture || skip.has(line) || seen.some((s) => s.line === line) || line.size > LABEL_SIZE * bodySize || line.size < LABEL_LEAST * bodySize) continue;
      const token = tokenOf(line, true) ?? phraseOf(line);
      if (!token || (token.side === "whole" && !PHRASE.test(token.text)) || (token.side === "head" && !token.bracketed)) continue;
      const column = rows.filter((s) => (s.token.side === token.side || s.token.side === "whole") && Math.abs(edge(s.line, token.side) - edge(line, token.side)) <= 1 && Math.abs(s.line.size - line.size) <= 0.5
        && faceOf(s.line, s.token) === faceOf(line, token));
      if (column.length >= 2) seen.push({ page, line, token, setting: settingOf(page, line, token, type) });
    }
  }
  // A bare token set in a listing's face is code (a bracketed one names a
  // lemma), unless the paper sets its labels so: five or more at bars.
  const mono = seen.filter((s) => !s.token.bracketed && MONO.test(faceOf(s.line, s.token)));
  if (mono.filter((s) => (s.setting.category === "beside" || s.setting.category === "over") && s.setting.bar).length < 5) {
    for (const s of mono) s.setting = { category: "comment", bar: null, row: [], side: "right" };
  }
  // A label level with a bar on either side stands on the side most of
  // the paper's other labels do; short of a majority, on the first found.
  const sides = { left: 0, right: 0, over: 0 };
  for (const s of seen) if (s.setting.category === "beside" && !s.setting.other) sides[s.setting.side] += 1;
  for (const s of seen) if (s.setting.other && sides[s.setting.other.side] > sides[s.setting.side]) s.setting = s.setting.other;
  // A label in a column of row labels, set as they are, labels its row
  // too where the row's relation did not reach the text (a ⇝ drawn from
  // a font with no character for it leaves "k w h [[k]](w)").
  for (const s of seen) {
    if (s.setting.category !== "none" || s.token.side !== "whole" || !s.setting.row.length) continue;
    const column = seen.filter((o) => o !== s && o.page === s.page && o.setting.category === "row" && o.token.side !== "tail"
      && (Math.abs(o.line.x1 - s.line.x1) <= 1 || Math.abs(o.line.x0 - s.line.x0) <= 1) && Math.abs(o.line.size - s.line.size) <= 0.5
      && faceOf(o.line, o.token) === faceOf(s.line, s.token) && Math.abs(o.line.top - s.line.top) <= 8 * type.leading);
    const side = s.setting.row.every((l) => l.x1 <= s.line.x0 + tolerance(l, s.line)) ? "right" : s.setting.row.every((l) => l.x0 >= s.line.x1 - tolerance(l, s.line)) ? "left" : null;
    if (column.length >= 2 && side && column.every((o) => o.setting.side === side)) s.setting = { category: "row", bar: null, row: s.setting.row, side };
  }
  // A bar leading into a wider one under it is a step where no label
  // names that wider bar.
  const barred = new Set(seen.map((s) => s.setting.bar).filter(Boolean));
  for (const s of seen) if (s.setting.step && !barred.has(s.setting.step)) s.setting.derived = true;
  const boxAt = (page: Page, line: Line, setting: Setting, out?: { lines: Line[] }) => {
    const rest = seen.filter((s) => s.page === page && s.line !== line);
    return boxOf(page, line, setting, type, { lines: new Set(rest.map((s) => s.line)), bars: rest.flatMap((s) => (s.setting.bar ? [s.setting.bar] : [])) }, out);
  };
  {
    for (const { page, line, token, setting } of seen) {
      const box = boxAt(page, line, setting);
      trace.add(RULE_CANDIDATE.id, page.number, token.text, at(page, line, box));
      if (setting.category === "none") continue;
      // A word closed by a colon names the rule at its bar ("Load:");
      // elsewhere it opens a sentence's clause ("as follows:", "Otherwise:").
      if (token.closed && !setting.bar) continue;
      if (setting.category === "cell" || setting.category === "group") { trace.add(RULE_CELL.id, page.number, token.text, at(page, line, box)); continue; }
      if (setting.category === "comment") { trace.add(RULE_HEADING.id, page.number, token.text, at(page, line, box)); continue; }
      if (setting.bar) trace.add(RULE_BAR.id, page.number, token.text, [{ page: page.number, x: setting.bar.x, y: setting.bar.y, w: setting.bar.w, h: Math.max(setting.bar.h, 1) }]);
      trace.add(RULE_SETTING.id, page.number, `${token.text} ${setting.category}`, at(page, line, box));
      const shape = shapeOf(fold(token.text));
      if (!shape) continue;
      // A hyphen before a numeral numbers a capitalised word's variants
      // (Continuous-1, Continuous-2); after a lone letter it is a formula.
      if (shape === "hyphen" && !/[-‐‑–:/_][^-‐‑–:/_]*[\p{L}→⇒⇓∀∃⊢⊗⊕⊸∧∨¬<∂]/u.test(fold(token.text)) && !/\p{Lu}\p{Ll}{2,}[-‐‑–]\d{1,2}$/u.test(token.text)) { trace.add(RULE_NAME_LETTERS.id, page.number, token.text, at(page, line, box)); continue; }
      // A name set wholly raised or lowered is a script of its line, no
      // label ("Wrh⟦ ⟧" over a bracket's end).
      const scripted = [...token.text].every((c, i) => { const ref = line.chars[token.start + [...token.text].slice(0, i).join("").length]; return /\s/u.test(c) || (ref?.run >= 0 && (line.runs[ref.run].sup || line.runs[ref.run].sub)); });
      if (scripted) { trace.add(RULE_NAME_LETTERS.id, page.number, token.text, at(page, line, box)); continue; }
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
  // Labels over a bar, by convention: a bar-less axiom's word stands
  // only among two of them (rule.setting), and counts for nothing else.
  const overBarred = new Map<string, number>();
  for (const c of candidates) if (c.setting.category === "over" && c.setting.bar) overBarred.set(c.convention, (overBarred.get(c.convention) ?? 0) + 1);
  const barless = (c: Candidate) => weak(c) && c.setting.category === "over" && !c.setting.bar && (overBarred.get(c.convention) ?? 0) < 2;
  for (const c of candidates) if (barless(c)) trace.add(RULE_CONVENTION.id, c.page.number, `${c.token.text} alone`, at(c.page, c.line, boxAt(c.page, c.line, c.setting)));
  candidates = candidates.filter((c) => !barless(c));
  // A bare word over a bar with a hyphenated, spaced or symbol name
  // between it and the bar heads a group of rules ("(Reduction)" over
  // R-Proj2Beta) and labels nothing (rule.heading).
  // So does a word set unlike the paper's labels over one set like them
  // ("All", italic, over allEmpty).
  const alike = new Map<string, number>();
  for (const c of candidates) alike.set(c.convention, (alike.get(c.convention) ?? 0) + 1);
  const heading = (c: Candidate) => weak(c) && c.setting.category === "over" && Boolean(c.setting.bar)
    && candidates.some((o) => o !== c && (!weak(o) || alike.get(o.convention)! >= Math.max(3, 3 * alike.get(c.convention)!))
      && o.setting.category === "over" && o.setting.bar === c.setting.bar && o.line.top > c.line.top);
  for (const c of candidates) if (heading(c)) trace.add(RULE_HEADING.id, c.page.number, `${c.token.text} heading`, at(c.page, c.line, boxAt(c.page, c.line, c.setting)));
  candidates = candidates.filter((c) => !heading(c));
  const conventions = new Map<string, number>();
  const strong = new Map<string, number>();
  for (const c of candidates) {
    conventions.set(c.convention, (conventions.get(c.convention) ?? 0) + 1);
    if (!weak(c)) strong.set(c.convention, (strong.get(c.convention) ?? 0) + 1);
  }
  const labels = new Set(candidates.map((c) => c.line));
  const confirmed = new Set<string>();
  // A paper that sets eight or more strong names at bars is a paper of
  // rules: a bare word at a bar of its own, in the face those
  // names are set in, stands there too (Löb, LET, Work), as do camelCase
  // words at bars set five or more alike.
  const atBar = (c: Candidate) => (c.setting.category === "beside" || c.setting.category === "over") && Boolean(c.setting.bar);
  // The face, and whether at the text's size or a figure's, whatever
  // size a figure is scaled to (Fig. 7's labels set at 6.5pt, Fig. 26's
  // at 9pt).
  const style = (c: Candidate) => `${c.convention.split("|")[3]}|${Math.abs(c.line.size - type.bodySize) <= 0.25 ? "text" : "figure"}`;
  const styles = new Map<string, number>();
  for (const c of candidates) if (!weak(c) && atBar(c)) styles.set(style(c), (styles.get(style(c)) ?? 0) + 1);
  const ruled = [...styles.values()].reduce((a, b) => a + b, 0) >= 8;
  const camelled = new Map<string, number>();
  for (const c of candidates) if (weak(c) && atBar(c) && camel(c.token.text)) camelled.set(c.convention, (camelled.get(c.convention) ?? 0) + 1);
  const established = (c: Candidate) => atBar(c) && ((ruled && (styles.get(style(c)) ?? 0) >= 2) || (camel(c.token.text) && (camelled.get(c.convention) ?? 0) >= 5));
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
  const placed: Placed[] = [];
  for (const c of ordered) {
    const key = keyOf(fold(c.token.text));
    const premise = c.setting.category === "over" && c.setting.bar && labelled.get(c.setting.bar) !== undefined && c.line.top - labelled.get(c.setting.bar)! <= 3 * type.leading
      && c.setting.bar.y - labelled.get(c.setting.bar)! <= 3.5 * type.leading;
    if (premise) { trace.add(RULE_CELL.id, c.page.number, c.token.text, at(c.page, c.line, boxAt(c.page, c.line, c.setting))); continue; }
    // A name defined again (a second system's Var, a rule restated in
    // related work) is a rule of its own there; a mention names the
    // definition it follows (findRuleMentions). A derivation's step
    // cites one.
    const known = rules.get(key);
    if (known && c.setting.derived) { labels.delete(c.line); trace.add(RULE_DERIVATION.id, c.page.number, c.token.text, at(c.page, c.line, boxAt(c.page, c.line, c.setting))); continue; }
    const again = known ? `${key}#${[...rules.keys()].filter((k) => k === key || k.startsWith(`${key}#`)).length}` : key;
    if (c.setting.derived && !citedAnywhere(flows, { name: c.token.text, shape: c.shape, bracketed: c.token.bracketed }, labels, faceOf(c.line, c.token), type)) {
      labels.delete(c.line); trace.add(RULE_DERIVATION.id, c.page.number, c.token.text, at(c.page, c.line, boxAt(c.page, c.line, c.setting))); continue;
    }
    const set: { lines: Line[] } = { lines: [] };
    const box = boxAt(c.page, c.line, c.setting, set);
    const boxes = at(c.page, c.line, box);
    if (weak(c) && !established(c) && (((conventions.get(c.convention) ?? 0) < 2 && (strong.get(c.convention) ?? 0) < 2) || !confirmed.has(c.convention))
      && !citedAnywhere(flows, { name: c.token.text, shape: c.shape, bracketed: c.token.bracketed }, labels, faceOf(c.line, c.token), type)) {
      trace.add(RULE_CONVENTION.id, c.page.number, `${c.token.text} alone`, boxes);
      continue;
    }
    rules.set(again, {
      key: `r${rules.size}`, kind: "rule", label: c.token.text, caption: c.line, page: c.page.number, ...box,
      name: c.token.text, shape: c.shape, bracketed: c.token.bracketed, category: c.setting.category, labels: [c.line],
    });
    if (c.setting.category === "over" && c.setting.bar && !labelled.has(c.setting.bar)) labelled.set(c.setting.bar, c.line.top);
    trace.add(c.rule, c.page.number, c.token.text, boxes);
    if (weak(c)) trace.add(RULE_CONVENTION.id, c.page.number, c.token.text, boxes);
    placed.push({ rule: rules.get(again)!, page: c.page, label: c.line, bar: c.setting.bar, lines: set.lines, setting: c.setting });
  }
  // Each box again, kept only from the labels and bars of the rules found:
  // a token weighed and dropped (the Γ heading a conclusion) is no label.
  for (const p of placed) {
    const rest = placed.filter((o) => o.page === p.page && o !== p);
    const set: { lines: Line[] } = { lines: [] };
    Object.assign(p.rule, boxOf(p.page, p.label, p.setting, type, { lines: new Set(rest.map((o) => o.label)), bars: rest.flatMap((o) => (o.bar ? [o.bar] : [])) }, set));
    p.lines = set.lines;
  }
  separate(placed);
  for (const p of placed) trace.add(RULE_BOX.id, p.page.number, p.rule.name, [{ page: p.page.number, x: p.rule.x, y: p.rule.y, w: p.rule.w, h: p.rule.h }]);
  return rules;
}

// Rules set side by side never share ground (rule.box): a line two boxes
// took belongs to the rule whose label it is or stands level with, or
// whose row it opens (a row broken over two lines), else to the rule
// whose bar (or label) it sits nearest, each box
// is drawn again round its own lines, and two boxes that still meet — a
// wide bar reaching past a neighbour's corner, the padding round each —
// are cut apart halfway across the blank between what each holds.
interface Placed { rule: Rule; page: Page; label: Line; bar: Drawn | null; lines: Line[]; setting: Setting }
function separate(placed: Placed[]): void {
  const pages = new Map<Page, Placed[]>();
  for (const p of placed) pages.set(p.page, [...(pages.get(p.page) ?? []), p]);
  for (const [page, here] of pages) {
    if (here.length < 2) continue;
    // A line's distance from a rule: from its bar, or from its label.
    const distance = (l: Line, p: Placed) => {
      const mid = (l.top + l.bottom) / 2;
      if (p.bar) {
        const dx = Math.max(0, p.bar.x - l.x1, l.x0 - (p.bar.x + p.bar.w));
        return Math.hypot(dx, Math.max(0, Math.abs(mid - p.bar.y) - (l.bottom - l.top) / 2));
      }
      // A row's rule runs on under its label ("when …"), never over it:
      // a line over the label is the row's above.
      const d = Math.hypot(Math.max(0, p.label.x0 - l.x1, l.x0 - p.label.x1), Math.max(0, p.label.top - l.bottom, l.top - p.label.bottom));
      return l.bottom <= p.label.top + 1 ? d + page.height : d;
    };
    const owners = new Map<Line, Placed[]>();
    for (const p of here) for (const l of p.lines) owners.set(l, [...(owners.get(l) ?? []), p]);
    for (const [l, ps] of owners) {
      if (ps.length < 2) continue;
      // A row broken over two lines, its label at the end of the second
      // set in past the first's start, owns the first (ALLOC's
      // "(σ; η[r.ref r′]) ⟶ …" over its "if l fresh, …").
      const heads = (p: Placed) => !p.bar && l.bottom <= p.label.top + 1 && p.label.top - l.bottom <= p.label.size && l.x1 < p.label.x0
        && p.lines.some((o) => o !== p.label && onRow(o, p.label)) && p.lines.every((o) => o === p.label || !onRow(o, p.label) || o.x0 >= l.x0 + 4 * p.label.size);
      const own = ps.find((p) => p.label === l) ?? ps.find((p) => !p.bar && onRow(l, p.label)) ?? ps.find(heads) ?? ps.reduce((a, b) => (distance(l, b) < distance(l, a) ? b : a));
      for (const p of ps) if (p !== own) p.lines = p.lines.filter((x) => x !== l);
    }
    // Each box round its own lines and bar, and what it holds (unpadded).
    const held = here.map((p) => {
      const xs = [...p.lines.flatMap((l) => [l.x0, l.x1]), ...(p.bar ? [p.bar.x, p.bar.x + p.bar.w] : [])];
      const ys = [...p.lines.flatMap((l) => [l.top, l.bottom]), ...(p.bar ? [p.bar.y] : [])];
      return { p, x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
    });
    const box = held.map((h) => ({ x0: Math.max(0, h.x0 - PAD), x1: Math.min(page.width, h.x1 + PAD), y0: Math.max(0, h.y0 - PAD), y1: Math.min(page.height, h.y1 + PAD) }));
    for (let i = 0; i < held.length; i += 1) {
      for (let j = i + 1; j < held.length; j += 1) {
        const a = box[i], b = box[j];
        if (a.x0 >= b.x1 || b.x0 >= a.x1 || a.y0 >= b.y1 || b.y0 >= a.y1) continue;
        const [ha, hb] = [held[i], held[j]];
        // Cut across the axis the two hold apart on, with the wider blank;
        // where their holdings overlap both ways, across the smaller overlap.
        const gapY = Math.max(hb.y0 - ha.y1, ha.y0 - hb.y1), gapX = Math.max(hb.x0 - ha.x1, ha.x0 - hb.x1);
        const overY = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0), overX = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
        const vertical = gapY >= 0 || gapX >= 0 ? gapY >= gapX : overY <= overX;
        if (vertical) {
          const [up, down, hu, hd] = (ha.y0 + ha.y1) <= (hb.y0 + hb.y1) ? [a, b, ha, hb] : [b, a, hb, ha];
          const cut = gapY >= 0 ? (hu.y1 + hd.y0) / 2 : (Math.max(up.y0, down.y0) + Math.min(up.y1, down.y1)) / 2;
          up.y1 = Math.min(up.y1, cut); down.y0 = Math.max(down.y0, cut);
        } else {
          const [lf, rt, hl, hr] = (ha.x0 + ha.x1) <= (hb.x0 + hb.x1) ? [a, b, ha, hb] : [b, a, hb, ha];
          const cut = gapX >= 0 ? (hl.x1 + hr.x0) / 2 : (Math.max(lf.x0, rt.x0) + Math.min(lf.x1, rt.x1)) / 2;
          lf.x1 = Math.min(lf.x1, cut); rt.x0 = Math.max(rt.x0, cut);
        }
      }
    }
    here.forEach((p, i) => {
      const b = box[i];
      Object.assign(p.rule, { x: b.x0 / page.width, y: b.y0 / page.height, w: (b.x1 - b.x0) / page.width, h: (b.y1 - b.y0) / page.height });
    });
  }
}

/** The places in a flow of text that name a rule, as links to it (rule.mention). */
export function findRuleMentions(flow: Flow, rules: Map<string, Rule>, layout: Layout, trace: Trace): DocumentLink[] {
  const links: DocumentLink[] = [];
  if (!rules.size) return links;
  const size = (page: number): [number, number] => [layout.pages[page - 1].width, layout.pages[page - 1].height];
  const labels = new Set([...rules.values()].flatMap((r) => r.labels));
  const type = typeOf(layout);
  const all = [...rules.values()];
  // Where a rule is defined, in reading order.
  const place = (page: number, top: number) => page * 1e5 + top;
  for (const m of mentionsIn(flow.text, all)) {
    const at = flow.at[m.nameStart];
    if (!at || labels.has(at.line)) continue;
    // A name defined more than once names the last definition before it,
    // or the first where it comes before them all.
    const named = all.filter((r) => keyOf(fold(r.name)) === keyOf(fold(all[m.rule].name)));
    const here = place(at.line.page, at.line.top);
    const rule = named.filter((r) => place(r.caption.page, r.caption.top) <= here).pop() ?? named[0];
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
