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
import { BIG_OPERATOR, boxesOf, type Flow, type Layout, type Line } from "./layout";
import type { Drawn } from "./page";
import {
  RULE_CONNECTIVES,
  RULE_BAR,
  RULE_BOX, RULE_CANDIDATE, RULE_CELL, RULE_CONVENTION, RULE_DERIVATION, RULE_HEADING, RULE_MENTION, RULE_NAME_BESIDE, RULE_NAME_LETTERS,
  RULE_NAME_MARGIN, RULE_NAME_OVER, RULE_NAME_ROW, RULE_SETTING, RULE_SHAPE_HYPHEN, RULE_SHAPE_PHRASE, RULE_SHAPE_SHORT, RULE_SHAPE_SPACED, RULE_SHAPE_SYMBOL, RULE_SHAPE_TITLE, RULE_SHAPE_WORD,
} from "./registry";
import type { Trace } from "./trace";

export type Shape = "hyphen" | "spaced" | "word" | "symbol" | "phrase" | "short" | "title";
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
// sign (WF-var+), a parenthesised tag (Choice(L)), an abbreviation's case
// in parentheses (cong. (bind), cong. (variadic)) or a spaced capital,
// digit or arrow (Val T, Interchange 1, Propagate ↓, Propagate-Var ↓1).
// A capital as a rule name has it: in the text's face, or a mathematical
// bold or italic one (𝑇 in ×𝑇); a Greek letter likewise (𝛽 in 𝛽 Box).
const CAP = "A-Z\\u{1D400}-\\u{1D419}\\u{1D434}-\\u{1D44D}\\u{1D468}-\\u{1D481}";
const GREEK = "\\p{Script=Greek}\\u{1D6A8}-\\u{1D7CB}";
const CONNECTIVE = RULE_CONNECTIVES;
// Mathematical partials (𝜕, bold and sans too) fold to the connective ∂
// (bdg-𝜕 in a POPL paper's text layer).
const PARTIAL = "\\u{1D6DB}\\u{1D715}\\u{1D74F}\\u{1D789}\\u{1D7C3}";
const MATH_LOWER = "\\u{1D44E}-\\u{1D467}";
const TOKEN = `(?:(?:[A-Z]{1,2}|[${GREEK}]) (?=[${CAP}])|(?<=[[(]\\s*)[${GREEK}${MATH_LOWER}]{1,2} (?=\\p{L}))?(?:[\\p{L}\\d]|[${CONNECTIVE}]{1,2}(?=[${CAP}\\d∞\\p{Ll}]|-\\p{L}))[\\p{L}\\d\\p{Co}'′’${CONNECTIVE}${PARTIAL}~*∗|/_\\-‐‑–−∞]{0,35}[+−±†‡♠♣♦?!↓↑-]{0,2}(?: ?\\([\\p{L}\\d]{1,4}\\)|\\. \\(\\p{L}{1,8}\\)| (?:[${CAP}]{1,2}|\\d{1,2}|[↓↑]\\d?))?`;
const WHOLE = new RegExp(`^\\s*(?:(?<open>[\\[(])\\s*)?(?<token>${TOKEN})(?:\\s?•)?(?<colon>:)?(?:\\s*(?<close>[\\])]))?\\s*$`, "u");
const HEAD = new RegExp(`^\\s*(?:(?<open>[\\[(])\\s*)?(?<token>${TOKEN})(?:\\s?•)?(?<colon>:)?(?:\\s*(?<close>[\\])]))?(?=\\s)`, "u");
// A line of capitalised words, a name set in small capitals whose
// letters after the first reach the text layer in lowercase ("Free Ok",
// "If (Multi-Outcome)"): a token only as the whole line, and only where the
// line is weighed as a label itself; read as a neighbour it stays words (a
// grammar's glosses, "Powerset Lattices", keep "Set 𝑈" a table's cell)
// (rule.shape.title).
const TITLED = new RegExp(`^\\s*(?<token>${RULE_SHAPE_TITLE.pattern!.source.slice(1, -1)})\\s*$`, "u");
const TAIL = new RegExp(`(?<=\\s)(?:(?<open>[\\[(])\\s*)?(?<token>${TOKEN})(?:\\s?•)?(?<colon>:)?(?:\\s*(?<close>[\\])]))?\\s*$`, "u");
// A name as its shape is judged: mathematical letters folded to the
// plain ones (×𝑇 is ×T, 𝜂-Red is η-Red).
// A minus sign joins a name's parts as a hyphen does, an asterisk operator
// marks it as an asterisk (Hyper Hoare Logic's While−∀∗∃∗, cited While-∀*∃*).
const fold = (text: string) => text.normalize("NFKC").replace(/−/g, "-").replace(/∗/g, "*");

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

// The layout may run a line into the next column's ("… 0" then DISP's
// conclusion "!x(x′).P −!−x−→ …"): where a piece starts near x, an em
// clear of the rest, its left edge.
function pieceAt(line: Line, x: number, size: number): number | null {
  for (let i = 0; i < line.text.length; i += 1) {
    const at = /\S/.test(line.text[i]) ? edgesOf(line, i) : null;
    if (at && at[0] >= x - 2 * size && at[0] <= x + size && blankBefore(line, i) >= size) return at[0];
  }
  return null;
}
// A line's left edge as a rule's box takes it: from its piece at the bar
// where it runs on from the next column's, the label on the bar's right.
const leftOf = (line: Line, bar: Drawn | null, label: Line) => (bar && line.x0 < bar.x - 2 * label.size && label.x0 >= bar.x + bar.w - BESIDE * label.size ? pieceAt(line, bar.x, label.size) ?? line.x0 : line.x0);

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

function tokenOf(line: Line, column = false, titles = false): Token | null {
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
    // A mathematical prefix, or a Greek one before a lowercase word, names
    // a rule only in brackets ("(𝑐𝑐 enter)", "(𝛽 as)"); bare, "𝑥 fresh" is
    // a side condition.
    if (!open && new RegExp(`^(?:[${MATH_LOWER}]{1,2} |[${GREEK}] \\p{Ll})`, "u").test(match.groups.token)) return null;
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
    // In brackets making up its line, one such capital with its number
    // tags a row as its name ("(𝑅1)", "(𝐹 )" heading reductions).
    const tag = side === "whole" && Boolean(open) && new RegExp(`^[${CAP}]\\d{0,2}$`, "u").test(token);
    if (/^\p{L}/u.test(token) && !tag && !/\p{L}/u.test(plain.replace(/[\u{1D400}-\u{1D7FF}]/gu, ""))) return null;
    if (/\p{L}/u.test(token[0]) && SYMBOLIC.test(font(start))) return null;
    // One or two italic letters with an index is a metavariable (S1, e′),
    // not a name; in brackets too where the index is set as a subscript
    // (a constraint's tag "(ℓ1)").
    const run = (i: number) => (line.chars[i]?.run >= 0 ? line.runs[line.chars[i].run] : null);
    const subscripted = /\d$/.test(token) && [...token].every((c, i) => !/\d/.test(c) || ((r) => r !== null && r.size < line.size - 0.5 && r.baseline > line.baseline + 0.5)(run(start + i)));
    if ((!open || subscripted) && /^\p{L}{1,2}\d*['′]*$/u.test(token) && [...token].every((c, i) => !/\p{L}/u.test(c) || ITALIC.test(font(start + i)))) return null;
    // Italic letters taking up full size again after an index are a
    // product of indexed variables ("LⱼₖLᵢₖ" read as "LjkLik").
    const offsets = [...token].map((c, i, all) => start + all.slice(0, i).join("").length);
    const scripts = offsets.map((at) => ((r) => Boolean(r && (r.sub || r.sup)))(run(at)));
    if (/^\p{L}+$/u.test(token) && offsets.every((at) => ITALIC.test(font(at))) && scripts.some((s, i) => !s && scripts.slice(0, i).some(Boolean))) return null;
    // A mathematical letter in parentheses after an index is an argument:
    // an indexed function applied ("𝟙𝐿(𝜎)", its 𝟙 read as "i"), no case.
    const applied = new RegExp(`\\([\\u{1D400}-\\u{1D7FF}]\\)$`, "u").exec(token);
    if (applied && ((r) => r !== null && r.size < line.size - 0.5)(run(start + applied.index - 1))) return null;
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
  // A whole line of capitalised words is a title's only (Set 𝑈 is a
  // grammar's type former, not a name spaced from its capital).
  const whole = found(WHOLE.exec(text), "whole") ?? (titles ? ((t) => (t && shapeOf(t.text) === "title" ? t : null))(found(TITLED.exec(text), "whole")) : null);
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

// A name as its short shape is judged: a letter read from a symbol font
// is a glyph, ⋆ here (⅋ and & reach the text layer as stmary's "O" and
// "N"), and mathematical letters fold to the plain ones.
function notation(line: Line, token: Token): string {
  return fold([...token.text].map((c, i, all) => {
    const ref = line.chars[token.start + all.slice(0, i).join("").length];
    return /\p{L}/u.test(c) && ref?.run >= 0 && SYMBOLIC.test(line.runs[ref.run].font) ? "⋆" : c;
  }).join(""));
}

// A line that is a short name alone, bracketed or not: connectives, signs,
// digits and Greek letters ("⊗", "!", "1⊥", ":π1", "|⊗", "(β→)", "(𝛽1)"),
// or one upright letter or digit (rule.shape.short). A lone letter or
// digit in brackets tags an item or an equation ("(a)", "(1)"); an
// italic Latin letter makes it a formula ("?A", "x⊥"), unless in brackets
// with a sign, as a column of labels sets it ("(𝑐𝑐→)"). In a column of
// labels heading rows, one in brackets may head its own line, a blank
// apart ("(𝜂×) match 𝑉 as …").
const SHORT_LINE = /^\s*(?:(?<open>[[(])\s*)?(?<token>[^\s[\]()]{1,4})(?:\s*(?<close>[\])]))?\s*$/u;
const SHORT_HEAD = /^\s*(?<open>[[(])\s*(?<token>[^\s[\]()]{1,4})\s*(?<close>[\])])(?=\s)/u;
function shortOf(line: Line, column = false, tags = false): Token | null {
  const text = line.text.split("").map((c, i) => (line.chars[i]?.run >= 0 && EXTENSION.test(line.runs[line.chars[i].run].font) ? " " : c)).join("");
  const head = column ? SHORT_HEAD.exec(text) : null;
  const match = SHORT_LINE.exec(text) ?? (head && blankAfter(line, head[0].length) >= 0.25 * line.size ? head : null);
  if (!match?.groups) return null;
  const { open, close, token: name } = match.groups;
  if (Boolean(open) !== Boolean(close) || (open && "[(".indexOf(open) !== "])".indexOf(close))) return null;
  const start = match.index + match[0].indexOf(name);
  const token: Token = { text: name, bracketed: Boolean(open), square: open === "[", colon: false, side: match === head ? "head" : "whole", start, end: start + name.length };
  const glyphs = notation(line, token);
  if (!SHORT.test(glyphs) || (open && !tags && /^[A-Za-z\d]$/.test(glyphs))) return null;
  const font = (i: number) => (line.chars[i]?.run >= 0 ? line.runs[line.chars[i].run].font : "");
  const italic = [...name].some((c, i, all) => /[A-Za-z]/.test(fold(c)) && ((f) => !SYMBOLIC.test(f) && (/[\u{1D400}-\u{1D7FF}]/u.test(c) || ITALIC.test(f)))(font(start + all.slice(0, i).join("").length)));
  if (italic && !(open && /[^A-Za-z\d]/.test(glyphs))) return null;
  // A connective before a mathematical lowercase letter is a formula, as
  // tokenOf reads it ("¬𝜑" over a diagram's edge).
  if (new RegExp(`^[${CONNECTIVE}¬]+[\\u{1D44E}-\\u{1D467}\\u{1D6FC}-\\u{1D71B}]`, "u").test(name)) return null;
  return token;
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
// Level as lines of a size are: a tall delimiter touches only what its
// ends reach, not a text's size further (Hb-Pop's ⟨ under Hb-Push's).
const levelBy = (a: Line, b: Line, size: number) => a.top <= b.bottom + TOUCH * size && b.top <= a.bottom + TOUCH * size;
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
// into a rule). A big operator is no broken font: a line whose large runs
// hold no letter is sized by its lettered ones (multris' ⁎ over its
// range "𝑖 ↦ p ∈ p⃗"); a big brace's pieces are no letters ("Û" for ⋀).
// So is a big operator set alone with its limits under or over it
// (PROTO-ALLOC's ∗ over "i ↦ p ∈ p⃗"); one bare, or with only a big
// bracket's pieces beside it, stands as tall as its size, lines over and
// under.
const lettered = (l: Line) => ((runs) => (runs.length ? Math.max(...runs.map((r) => r.size)) : l.size))(l.runs.filter((r) => /\p{L}/u.test(r.text) && !EXTENSION.test(r.font)));
function limited(l: Line): boolean {
  const op = l.runs.filter((r) => !r.sub && !r.sup);
  return BIG_OPERATOR.test(op.map((r) => r.text).join("")) && l.runs.some((r) => (r.sub || r.sup) && op.some((o) => r.x < o.x + o.width && r.x + r.width > o.x));
}
const ruleLines = (page: Page, label: Line) => page.lines.filter((l) => !l.furniture && l !== label && /[^\s\p{C}]/u.test(l.text) && (l.size <= 2 * label.size || lettered(l) <= 2 * label.size || limited(l)));

// What a line level with a bracketed word says when the word comments a
// grammar production: the production itself, or a "|" alternative under
// one within a few lines at the production's own indent ("| f" in "H | f"
// is a heap).
// A "|" inside brackets after ":=" is no alternative ("[𝑥 := do𝐺 [𝜌|Γ]]"
// in a machine's transition).
const GRAMMAR = /⩴|::=|∷=|∶∶=|:=(?:[^|[(]|\[[^\]]*\]|\([^)]*\))*\|/u;
const SIGN = /^\s*(?:⩴|::=|∷=|∶∶=|:=)\s*$/u;
function production(line: Line, page: Page, type: Type, depth = 0): boolean {
  if (GRAMMAR.test(line.text)) return true;
  // A grammar may set a spaced colon for its sign, the "|" of its
  // alternatives hung under the colon, its categories stacked line by line
  // ("Definitions 𝐷 : […]" over "Expressions 𝑒 : 𝑖" over "| 𝑒 [𝑒]").
  const colon = colonAt(line);
  if (colon !== null && depth <= 12) {
    const next = (l: Line) => l !== line && l.top > line.top + 1 && l.top <= line.bottom + type.leading;
    if (page.lines.some((l) => next(l) && /^\s*\|/.test(l.text) && Math.abs(l.x0 - colon) <= line.size)) return true;
    if (page.lines.some((l) => next(l) && colonAt(l) !== null && production(l, page, type, depth + 1))) return true;
  }
  // A grammar's sign may be set as a line of its own, the signs stacked
  // in a column and the "|" of the alternatives hung under the last
  // ("Parser 𝑃" beside ":=" over ":=" over "|").
  if (SIGN.test(line.text) && depth <= 12) {
    const under = (l: Line) => l !== line && l.top > line.top + 1 && l.top <= line.bottom + type.leading && Math.abs(l.x0 - line.x0) <= line.size;
    if (page.lines.some((l) => under(l) && (/^\s*\|\s*$/.test(l.text) || (SIGN.test(l.text) && production(l, page, type, depth + 1))))) return true;
  }
  if (!/^\s*\|/.test(line.text) || depth > 12) return false;
  const over = (l: Line) => Math.abs(l.x0 - line.x0) <= 4 * line.size && l.top < line.top && l.top >= line.top - 1.5 * type.leading;
  return page.lines.some((l) => over(l) && (GRAMMAR.test(l.text) || production(l, page, type, depth + 1)))
    || page.lines.some((l) => GRAMMAR.test(l.text) && Math.abs(l.x0 - line.x0) <= 4 * line.size && l.top < line.top && l.top >= line.top - 4 * type.leading);
}

// Where a line's first colon standing apart (" : ") sits.
function colonAt(line: Line): number | null {
  const i = line.text.search(/\s:\s/);
  const c = i < 0 ? undefined : line.chars[i + 1];
  if (!c || c.run < 0) return null;
  const run = line.runs[c.run];
  return run.x + (run.width * c.at) / Math.max(1, run.text.length);
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
      // Laid along a box's top or bottom edge within its span: a plot's
      // flat series on its axis (a memory curve at its floor over "iterations").
      || (v.w > 1.5 && v.h > 1.5 && (Math.abs(v.y - d.y) <= 0.5 || Math.abs(v.y + v.h - d.y) <= 0.5) && v.x <= d.x + 0.5 && v.x + v.w >= d.x + d.w - 0.5)
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

// A sub- or superscript: a line set smaller than a line it sits on the
// row of, beside or around it ("ᵢ" by "Δ"); a derivation
// set small throughout (staging's) has no larger line beside its
// judgments.
function script(page: Page, l: Line): boolean {
  return page.lines.some((o) => o !== l && !o.furniture && o.size >= 1.25 * l.size && level(o, l) && o.x0 <= l.x1 + o.size && o.x1 >= l.x0 - o.size);
}

// Text reaching up to a stroke from under it, or another
// stroke just under it, is what it overlines (TCInst's "‾Γ ⊢ τ′ₖ : κₖ‾",
// PRODORSUM's; a box's edge under it is a boxed tag's, "9d" in a
// conclusion): a conclusion stands clear of its bar, its baseline a
// full size under it however tight its box (a compact derivation's
// "• ⊢¹ λx. x ⇒ a → a"); a subscript's overline hugs it all the same
// ("‾Δᵢ‾"), a stroke about as wide as it. An accent alone (T⃗'s arrow,
// set as "#»" under sequent's Case bar) is overlined by nothing.
function hugs(page: Page, d: Drawn, type: Type): boolean {
  return page.lines.some((l) => !l.furniture && /[\p{L}\p{N}]/u.test(l.text) && l.top < d.y + 0.6 && l.top > d.y - 0.5 * l.size && l.bottom > d.y + 0.5 * l.size && (l.baseline - d.y < 0.95 * l.size || (script(page, l) && d.w <= l.x1 - l.x0 + 2 * l.size)) && l.x0 < d.x + d.w && l.x1 > d.x)
    || page.drawn.some((e) => e !== d && across(e) && !framed(page, e) && e.y > d.y + 0.2 && e.y - d.y <= 0.4 * type.bodySize && e.x >= d.x - 1 && e.x + e.w <= d.x + d.w + 1);
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

// A stroke with a heading set level between it and another stroke on
// its line, the two across the text's width ("—— Structural rules ——"
// over kokke-popl19's rules), rules the heading off: no step's bar (a
// label between two steps' bars leaves the width open).
function headed(page: Page, d: Drawn, type: Type): boolean {
  return page.lines.some((l) => !l.furniture && Math.abs((l.top + l.bottom) / 2 - d.y) <= LEVEL * l.size
    && [[d.x + d.w, l.x0], [l.x1, d.x]].some(([a, b]) => b - a >= -1 && b - a <= 2 * l.size)
    && page.drawn.some((e) => e !== d && across(e) && Math.abs(e.y - d.y) <= 1 && (e.x >= l.x1 - 1 && e.x - l.x1 <= 2 * l.size || l.x0 >= e.x + e.w - 1 && l.x0 - e.x - e.w <= 2 * l.size)
      && Math.max(d.x + d.w, e.x + e.w) - Math.min(d.x, e.x) >= BAR_SHARE * (type.text.x1 - type.text.x0)));
}
// A step boxed apart from a bar over it: a term of that rule's
// conclusion (kokke-popl19's AXCUT concludes with a boxed H-CUT), not
// the next step of its tree.
function boxedApart(page: Page, inner: Drawn, outer: Drawn): boolean {
  const beside = (v: Drawn, d: Drawn) => v.y < d.y - 1 && v.y + v.h > d.y + 1;
  const holds = (v: Drawn, d: Drawn) => v.x <= d.x + 1 && v.x + v.w >= d.x + d.w - 1 && beside(v, d);
  const sides = page.drawn.filter((v) => v.w <= 1.5 && v.h > 1.5);
  return page.drawn.some((v) => v.w > 1.5 && v.h > 1.5 && holds(v, inner) && !holds(v, outer))
    || sides.some((a) => beside(a, inner) && a.x <= inner.x + 1 && sides.some((b) => beside(b, inner) && b.x >= inner.x + inner.w - 1 && b.y === a.y && b.h === a.h
      && !(beside(a, outer) && a.x <= outer.x + 1 && b.x >= outer.x + outer.w - 1)));
}
// A stroke over a subterm of a line, from a character's start to another's
// end with the line going on past it ("‾τ ↦ t†‾" in M-SIG's "η ⊢ ‾τ ↦ t†‾"),
// overlines that part: a step's bar spans its conclusion.
function subterm(d: Drawn, l: Line): boolean {
  return (l.x0 < d.x - 1 || l.x1 > d.x + d.w + 1) && l.runs.some((r) => Math.abs(r.x - d.x) <= 1) && l.runs.some((r) => Math.abs(r.x + r.width - d.x - d.w) <= 1.5);
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
// A tree need not nest: a step's bar may stand to one side of the one it
// leads into (POPL-011's DT-App over the root's), or be the wider of the
// two (its premises the longer). The two bars then share half the
// narrower's span, the line between lies over the lower bar and mostly
// under the upper, is a judgment (a relation in it) with nothing else
// beside it over the lower bar, and the upper bar has premises over it
// (no caption), nor is either boxed apart from the other.
// For a label over its bar the upper bar stands under the label (`from`):
// a heading's underline over the label is no step.
function derivation(page: Page, bar: Drawn, lines: Line[], type: Type, slack: number, from = -Infinity): boolean {
  // A step's bar has premises over it (under the rule's label) or its
  // label beside it; a stroke with neither over a premise is its overline
  // (CDRcd's "‾Γ ⊢ eᵢ : Aᵢ‾", LIST's). Running text over it is no
  // premise ("… it sends the next queued event:" over dispatch's
  // "‾A_Q −→α A′‾").
  const premised = (d: Drawn, running = true) => lines.some((l) => !CAPTION.test(l.text) && (running || !prose(l, type)) && l.top > from && l.bottom <= d.y + 1 && l.bottom >= d.y - type.leading && Math.min(l.x1, d.x + d.w) - Math.max(l.x0, d.x) >= 0.5 * Math.min(l.x1 - l.x0, d.w));
  const held = (d: Drawn) => premised(d, false)
    || lines.some((l) => Math.abs((l.top + l.bottom) / 2 - d.y) <= LEVEL * l.size && (Math.abs(l.x0 - d.x - d.w) <= 2 * l.size || Math.abs(d.x - l.x1) <= 2 * l.size));
  return page.drawn.some((d) => d !== bar && across(d) && d.w >= 1.5 * type.bodySize && !framed(page, d) && !headed(page, d, type) && !dividing(page, d, type) && !overline(page, d, type) && held(d) && !hugs(page, d, type) && d.y > from && d.y < bar.y - 2 && d.y >= bar.y - 2.2 * type.leading
    && Math.min(d.x + d.w, bar.x + bar.w) - Math.max(d.x, bar.x) >= 0.5 * Math.min(bar.w, d.w)
    && lines.some((l) => /[\p{L}\d]/u.test(l.text) && l.top >= d.y - 1 && l.top <= d.y + 0.8 * type.leading && l.bottom <= bar.y + 1 && l.bottom >= bar.y - 0.8 * type.leading
      && Math.min(l.x1, d.x + d.w) - Math.max(l.x0, d.x) >= 0.5 * (l.x1 - l.x0) && l.x0 >= bar.x - slack && l.x1 <= bar.x + bar.w + slack && !subterm(d, l)
      && (d.w < bar.w || (RELATION.test(l.text) && premised(d) && !boxedApart(page, bar, d)
        && !lines.some((o) => o.top >= d.y - 1 && o.bottom <= bar.y + 1 && o.x0 < d.x + d.w && o.x1 > d.x && (o.x1 < bar.x - slack || o.x0 > bar.x + bar.w + slack))))));
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
// A conclusion the layout broke into pieces is measured whole: pieces
// a word space or so apart (a big brace splitting ConstructTerm's; tall
// braces and a big operator split "{ I(0, ∅) ∗ ⊛ Rᵢ } [ι : while …]" under
// WHILE's bar). A table's row is no conclusion: its cells stand columns
// apart ("Core Choice   [53, 136]   𝑒 ::= …" under Table 1's header rule).
function dividing(page: Page, d: Drawn, type: Type): boolean {
  if (d.w < BAR_SHARE * (type.text.x1 - type.text.x0)) return false;
  const centre = d.x + d.w / 2;
  const centred = (x0: number, x1: number) => Math.abs((x0 + x1) / 2 - centre) <= 2 * type.bodySize && x1 - x0 >= 0.3 * d.w;
  const under = page.lines.filter((l) => !l.furniture && l.top >= d.y - 1 && l.top <= d.y + type.leading);
  // A brace reaching up past the bar is a piece all the same.
  const pieces = page.lines.filter((l) => !l.furniture && l.bottom > d.y + 1 && l.top <= d.y + type.leading);
  const whole = (l: Line): [number, number] => {
    const taken = [l];
    let [x0, x1] = [l.x0, l.x1];
    for (let grew = true; grew;) {
      grew = false;
      for (const o of pieces) {
        if (taken.includes(o) || !taken.some((t) => level(o, t)) || !((o.x1 <= x0 + 1 && x0 - o.x1 <= type.bodySize) || (o.x0 >= x1 - 1 && o.x0 - x1 <= type.bodySize))) continue;
        taken.push(o); x0 = Math.min(x0, o.x0); x1 = Math.max(x1, o.x1); grew = true;
      }
    }
    return [x0, x1];
  };
  return !under.some((l) => centred(l.x0, l.x1) || centred(...whole(l)));
}
// The bar a step's conclusion leads into (the wider, or one as a tree
// that does not nest has it: derivation), where no label of its
// own names that bar (findRules knows): a rule's own bar set right under
// another's conclusion is not a step, nor is a frame's edge under it (the
// judgment's box under NEVER) a bar, nor a table's rule with no
// conclusion under it (Table 8's LoadLarger over running text).
function stepInto(page: Page, bar: Drawn, lines: Line[], type: Type, slack: number): Drawn | null {
  const shared = (d: Drawn) => Math.min(d.x + d.w, bar.x + bar.w) - Math.max(d.x, bar.x);
  return page.drawn.find((d) => d !== bar && across(d) && d.w >= 1.5 * type.bodySize && !framed(page, d) && !headed(page, d, type) && !hugs(page, d, type) && d.y > bar.y + 2 && d.y <= bar.y + 2.2 * type.leading
    && shared(d) >= 0.5 * Math.min(bar.w, d.w)
    && concludes(page, d, type) && !dividing(page, d, type)
    && lines.some((l) => l.top >= bar.y - 1 && l.top <= bar.y + 0.8 * type.leading && l.bottom <= d.y + 1 && l.bottom >= d.y - 0.6 * type.leading
      && Math.min(l.x1, bar.x + bar.w) - Math.max(l.x0, bar.x) >= 0.5 * (l.x1 - l.x0) && l.x0 >= d.x - slack && l.x1 <= d.x + d.w + slack
      && (d.w > bar.w + 1 || (RELATION.test(l.text) && !boxedApart(page, d, bar)
        && !lines.some((o) => o.top >= bar.y - 1 && o.bottom <= d.y + 1 && o.x0 < bar.x + bar.w && o.x1 > bar.x && (o.x1 < d.x - slack || o.x0 > d.x + d.w + slack)))))) ?? null;
}

// What stands at a row's end names a rule only where the row is one: a
// relation between its sides (an arrow, a turnstile, an equation), not a
// table's numbers or a paragraph's words. The supplemental arrows (⤇,
// ⤳, Leaf's ⤔ "guards") are all relations.
const RELATION = /[→⟶↦⟼⇒⟹⇛⇓⇝↝↠⇐⊢⊣⊨⊩⊑⊆≡≜≔=∼≈≤≥⊕⊗∗⊸⊳⊲▷◁⤀-⥿]|[−-]∗|->|=>|~>|<:|:>|::=/u;

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
  // The column is the paper's at least: on a page given to a figure the
  // lines of text's length are its formulas (Iron's Fig. 4, tinv-open's bar
  // wider than any of them).
  const paper = type.columns.find((c) => c.x0 <= centre && centre <= c.x1) ?? type.text;
  const spanned = columnSpan(page, label);
  const column: [number, number] = spanned ? [Math.min(spanned[0], paper.x0), Math.max(spanned[1], paper.x1)] : [paper.x0, paper.x1];
  const measure = column[1] - column[0];
  const wide = BAR_SHARE * measure;
  const widest = measure + 3 * label.size;
  // A label alone on its row at the column's left edge heads the rule
  // under it wherever the rule stands in the column (OOPSLA's "[Query]"
  // over a centred rule); a word in the text's face there, unbracketed,
  // opens a paragraph's line ("argument p and …").
  const [colLeft, colRight] = column;
  const alone = ruleLines(page, label).every((l) => l === label || !onRow(l, label) || !sameColumn(page, l, label));
  const margined = alone && Math.abs(label.x0 - colLeft) <= slack && (token.bracketed || faceOf(label, token) !== family(type.font));
  // A bar as wide as the text could be a figure's own rule: it is a rule's
  // only with a conclusion centred under it and clearly shorter.
  const concluded = (d: Drawn) => lines.some((l) => !CAPTION.test(l.text) && l.top >= d.y - 1 && l.top <= d.y + 2 * type.leading && l.x0 < d.x + d.w && l.x1 > d.x
    && Math.abs((l.x0 + l.x1) / 2 - (d.x + d.w / 2)) <= 2 * label.size && l.x1 - l.x0 <= 0.8 * d.w);
  // A bar set close under its premises is no underline where a
  // conclusion as wide stands under it (CD-ST-DEF): text underlined runs
  // on past the stroke.
  // A line may reach the layout in pieces on one row, a big brace or
  // operator apart (ConstructTerm's "⟨t⟩ —Construct(k),G→" and its set of
  // edges): it fits, and is sized, as one.
  const joined = (l: Line, d: Drawn) => {
    const row = lines.filter((o) => onRow(o, l) && o.x0 >= d.x - label.size && o.x1 <= d.x + d.w + label.size);
    return { x0: Math.min(l.x0, ...row.map((o) => o.x0)), x1: Math.max(l.x1, ...row.map((o) => o.x1)) };
  };
  const fits = (l: { x0: number; x1: number }, d: Drawn) => l.x0 >= d.x - label.size && l.x1 <= d.x + d.w + label.size
    && (l.x1 - l.x0 >= 0.5 * d.w || Math.abs((l.x0 + l.x1) / 2 - (d.x + d.w / 2)) <= 2 * label.size);
  const fitting = (l: Line, d: Drawn) => fits(l, d) || fits(joined(l, d), d);
  // A table's figures ("2.59±0.05" under a best result's underline)
  // conclude nothing.
  const tabulated = (l: Line) => /^[\d\s.,:±%×+−–-]+$/u.test(l.text);
  const topping = (d: Drawn) => lines.some((l) => l.top >= d.y - 1 && l.top <= d.y + type.leading && fitting(l, d) && !tabulated(l));
  // ... and as wide as a column of text only between premises and a
  // conclusion that fit it, well short of the page's text (a figure's
  // own rule runs across it).
  const capping = (d: Drawn) => lines.some((l) => l.bottom <= d.y + 1 && l.bottom >= d.y - type.leading && fitting(l, d));
  // ... or drawn exactly as wide as the conclusion under it or a premise
  // over it, however wide (E-APP-FUNCTOR's across the column): a figure's
  // own rule is drawn to the figure, not to a line of it.
  const edge = (l: { x0: number; x1: number }, d: Drawn) => Math.abs(l.x0 - d.x) <= 0.5 * label.size && Math.abs(l.x1 - d.x - d.w) <= 0.5 * label.size;
  const sized = (d: Drawn) => topping(d) && capping(d) && lines.some((l) => ((l.top >= d.y - 1 && l.top <= d.y + type.leading) || (l.bottom <= d.y + 1 && l.bottom >= d.y - type.leading)) && (edge(l, d) || edge(joined(l, d), d)));
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
    && ((d.x <= label.x1 + 2 * slack && d.x + d.w >= label.x0 - 2 * slack) || (besides(d) && blankTo(d)) || (margined && d.y > label.bottom && d.x >= label.x0 && d.x + d.w <= colRight + slack)) && !framed(page, d) && (!dividing(page, d, type) || (besides(d) && blankTo(d) && capping(d))) && !overline(page, d, type) && !struck(page, d) && (!underline(page, d) || concluded(d) || topping(d)) && !inProse(page, d, type));
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
    // A conclusion run into the next column's line on the left starts at
    // the bar an em clear of it (DISP's), the label on the bar's right:
    // one on its left would stand in the column's line.
    const starts = (l: Line) => l.x0 >= bar.x - 2 * label.size || (label.x0 >= bar.x + bar.w - slack && pieceAt(l, bar.x, label.size) !== null);
    return lines.some((l) => spans(l) && !CAPTION.test(l.text) && l.top >= bar.y - 1 && l.top <= bar.y + 2 * type.leading && starts(l) && l.x1 <= bar.x + bar.w + 2 * label.size);
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
        // Hard under a rule that starts where it does and runs well past
        // it, the label heads a ruled table's first row, beside no other
        // bar ("Variables" under Namespaces' rule, Constructs' rule to
        // its left).
        const under = bar.y <= label.top + 1 && Math.abs(label.x0 - bar.x) <= slack && bar.x + bar.w >= label.x1 + 2 * label.size;
        if (under) return { category: "cell", bar, row, side: "over" };
        if (hugs(page, bar, type) || Math.min(label.x1, bar.x + bar.w) - Math.max(label.x0, bar.x) < 0.5 * (label.x1 - label.x0)) continue;
        return { category: "cell", bar, row, side: "over" };
      }
      const right = bar.x + bar.w <= label.x0 + slack;
      // Wholly under the bar, the bar reaching over it, the label stands
      // among what the bar concludes, not beside it ("pgn", first of a
      // plot's tick labels under its axis).
      if (label.top >= bar.y - 0.5 && Math.min(label.x1, bar.x + bar.w) - Math.max(label.x0, bar.x) > tolerance(label, label)) continue;
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
    // A side condition set further along a premise the label heads, on
    // its baseline, is one more premise ("𝑖 ∈ 1..𝑛" beside Join's), but
    // where the row fills the bar end to end the token is its first
    // premise ("Γ RRG" over param's bar).
    const led = (l: Line) => spans(l) && RELATION.test(l.text) && l.x0 >= label.x1 - tolerance(l, label) && fits(l);
    const reach = [label, ...row.filter(spans)];
    const filled = Math.abs(Math.min(...reach.map((l) => l.x0)) - bar.x) <= 2 * label.size && Math.abs(Math.max(...reach.map((l) => l.x1)) - bar.x - bar.w) <= 2 * label.size;
    const along = (l: Line) => !filled && row.some((h) => h !== l && led(h) && h.x1 <= l.x0 && Math.abs(h.baseline - l.baseline) <= 0.5);
    const blocks = (l: Line) => spans(l) && /[\p{L}\d]/u.test(l.text) && !(l.text.trim().length === 1 && l.runs.every((r) => EXTENSION.test(r.font))) && !/^\s*[[(].*[\])]\s*$/.test(l.text) && (l.x0 < label.x1 - tolerance(l, label) || !fits(l) || !(RELATION.test(l.text) || along(l)) || GRAMMAR.test(l.text));
    const heads = row.some(led);
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
    // plot's axis labels ("pgn ppm sexp" under ParTS's legend swatch),
    // on one line or each word a line of its own.
    // A lone constant ("False", "Proph") concludes all the same.
    const worded = concluding.length > 0 && concluding.every((l) => /\p{L}{3}/u.test(l.text) && (l.text.trim().split(/\s+/).length >= 3 || concluding.length >= 3) && l.text.split(/\s+/).every((w) => /^[\p{L}\d().,%-]*$/u.test(w))
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
      const above = label.top - Math.max(...conclusion.filter((l) => l.bottom <= label.top + 1).map((l) => l.bottom), -Infinity);
      if (own && Math.min(...own.map((l) => l.top)) - label.bottom < above) continue;
      // So does one no nearer the conclusion than the premises hard under
      // it, over bars of their own: a heading centred over the next row of
      // rules ("Concatenation" under Product's rules in Fig. 27).
      const premises = lines.filter((l) => !onRow(l, label) && l.top >= label.bottom - 1 && l.top <= label.bottom + type.leading && l.x0 < label.x1 && l.x1 > label.x0
        && page.drawn.some((d) => d !== bar && across(d) && d.y >= l.bottom - 1 && d.y <= l.bottom + type.leading && d.x < l.x1 && d.x + d.w > l.x0));
      if (premises.length && Math.min(...premises.map((l) => l.top)) - label.bottom <= above) continue;
      // Its right edge at the bar's, or hanging past it from within (JFP
      // sets F_Compat under the conclusion's end, past the bar's; SWF_Refine
      // stops short of the bar's).
      const right = Math.abs(label.x1 - bar.x - bar.w) <= 2 * slack || (label.x0 > bar.x && label.x1 >= Math.max(...conclusion.map((l) => l.x1)) - 2 * slack && label.x1 - bar.x - bar.w <= 4 * slack);
      const left = Math.abs(label.x0 - bar.x) <= 2 * slack;
      // Figures level with the label make it a table's row, in whatever
      // column the layout read them ("Facile  97.5 ± 0.09" under a rule).
      const figured = lines.some((l) => onRow(l, label) && spans(l) && NUMERALS.test(l.text));
      if ((right || left) && !figured && !row.some((l) => spans(l) && /[\p{L}\d]/u.test(l.text))) return { category: "beside", bar, row, side: right ? "right" : "left" };
    }
  }
  {
    const own = overRow();
    // A sentence in the text's face level with it, words a blank apart
    // (no label beside it, "Prf-Nat-Distinct1"), makes it an entry of a
    // table, described there ("?𝑄   If 𝑄 is true, continue running; else
    // abort." over the next entry "𝑥′ = 𝑓 (𝑥) & 𝑄").
    const described = row.some((l) => faceOf(l) === family(type.font) && !RELATION.test(l.text) && l.text.trim().split(/\s+/).filter((w) => /\p{L}{3}/u.test(w)).length >= 3);
    if (own && described) return { category: "cell", bar: null, row, side: "right" };
    if (own) return { category: "over", bar: null, row: own, side: "over" };
  }
  // A label set level with a stack of lines touches each without sharing
  // half its height with any: the stack is its row. Other labels on the
  // label's row (the next rule's, set beside) are not its row, nor the
  // lines hard under them; nor, for one heading or ending its line, a
  // line on another label's row ("(enter)"'s side condition under the
  // row "(do)" heads).
  const others = (l: Line) => lines.some((o) => o !== label && onRow(o, l) && tokenOf(o)?.side === "whole");
  if (row.every((l) => WHOLE.test(l.text))) row = lines.filter((l) => level(l, label) && !onRow(l, label) && sameColumn(page, l, label) && tokenOf(l)?.side !== "whole" && (token.side === "whole" || !others(l)));
  // Bracketed labels set alike along a row part it: what lies past another is
  // that one's, and with lines on both sides, those between this label and
  // another are the other's, which heads or ends them ("(𝛽 Clos)" right
  // of "(𝛽 Box)"'s row, two reductions to a line). One heads a row part;
  // at the row's end it is a side condition ("(𝑑 fresh)").
  const parted = new Set<Line>();
  if (token.side === "whole" && token.bracketed) {
    const fences = row.filter((l) => { const t = tokenOf(l) ?? shortOf(l); return t?.side === "whole" && t.bracketed && Math.abs(l.size - label.size) <= 0.5
      && row.some((o) => o !== l && onRow(o, l) && o.x0 >= l.x1 - 1); });
    if (fences.length) {
      const beyond = (l: Line) => fences.some((f) => (f.x0 >= label.x1 && l.x0 >= f.x1 - 1) || (f.x1 <= label.x0 && l.x1 <= f.x0 + 1));
      const between = (l: Line) => fences.some((f) => (f.x0 >= label.x1 && l.x0 >= label.x1 - 1 && l.x1 <= f.x0 + 1) || (f.x1 <= label.x0 && l.x1 <= label.x0 + 1 && l.x0 >= f.x1 - 1));
      row = row.filter((l) => !fences.includes(l) && !beyond(l));
      const left = row.filter((l) => l.x1 <= label.x0 + tolerance(l, label)), right = row.filter((l) => l.x0 >= label.x1 - tolerance(l, label));
      if (left.length && right.length && left.length + right.length === row.length) {
        if (left.every(between) && !right.some(between)) row = right;
        else if (right.every(between) && !left.some(between)) row = left;
      }
      for (const l of page.lines) if (fences.includes(l) || beyond(l) || (onRow(l, label) && !row.includes(l) && between(l))) parted.add(l);
    }
  }
  const rest = (token.side === "whole" ? "" : label.text.slice(0, token.start) + " " + label.text.slice(token.end) + " ") + row.map((l) => l.text).join(" ");
  const body = /\p{L}|[^\p{L}\d\s\[\]()]/u.test(rest.replace(/[\[\]()]/g, "")) && rest.replace(/\s/g, "").length >= 3;
  if (!body) return { category: "none", bar: null, row, side: "right" };
  // A relation level with the label counts, on its row or in a line the
  // layout set apart (a tall arrow between two lines of terms).
  const levelled = page.lines.filter((l) => l !== label && onRow(l, label) && sameColumn(page, l, label) && !lowered(l) && !parted.has(l)).map((l) => l.text).join(" ");
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
  // A row opening with a quantifier states a lemma, no rule
  // ("∀𝑥 : Nat. half (add 𝑥 𝑥) ≐ 𝑥   (half_double)"); a premise over its
  // conclusion is a rule however it opens ("∃ 𝑑𝑏 ∈ 𝐷 (…)" over
  // G–Collective-Local's step).
  const stacked = row.some((a) => row.some((b) => b.top >= a.bottom - 1));
  if (atMargin && !stacked && /^\s*[∀∃]/u.test([...row].sort((a, b) => a.x0 - b.x0)[0].text)) return { category: "none", bar: null, row, side: "right" };
  // Ending a line of a conclusion set over several lines, each hard under
  // the last from the bar down within its span, and past the bar's end,
  // the label stands beside that rule (ExecCallback at its call's line,
  // between the precondition and the postcondition under the bar). No
  // other stroke stands between: a row over a bar of its own is that
  // rule's (P-Seq's premise under P-Arm's conclusion), a row in a frame
  // a judgment's form ("⊢ σ ⊲ σ₁ → σ₂" boxed under LT-LAMC).
  if (row.every((l) => l.x1 <= label.x0 + tolerance(l, label))) {
    const hung = page.drawn.filter((d) => across(d) && d.w >= 2 * label.size && d.y < label.top && d.y >= label.top - REACH * type.leading && d.x + d.w <= label.x0 && !framed(page, d) && !overline(page, d, type) && !struck(page, d)
      && row.every((l) => l.x0 >= d.x - label.size && l.x1 <= d.x + d.w + label.size)
      && !page.drawn.some((e) => e !== d && across(e) && e.w >= label.size && e.y > d.y + 1 && e.y < label.bottom && e.x < d.x + d.w && e.x + e.w > d.x)
      && lines.some((l) => l.bottom <= d.y + 1 && l.bottom >= d.y - type.leading && l.x0 >= d.x - label.size && l.x1 <= d.x + d.w + label.size)
      && ((stack) => {
        let end = d.y;
        for (const l of stack) { if (l.x0 < d.x - label.size || l.x1 > d.x + d.w + label.size || l.top - end > 0.5 * type.leading) return false; end = Math.max(end, l.bottom); }
        return stack.length >= 2 && row.every((r) => stack.includes(r));
      })(lines.filter((l) => l.top >= d.y - 1 && l.top < label.bottom && l.x0 < d.x + d.w && l.x1 > d.x).sort((a, b) => a.top - b.top)))
      .sort((a, b) => b.y - a.y)[0];
    if (hung) return { category: "beside", bar: hung, row, side: "right", derived: derivation(page, hung, lines, type, slack), step: stepInto(page, hung, lines, type, slack) };
  }
  if (atMargin) return { category: "margin", bar: null, row, side: "right" };
  // A row holding words in the text's face with no relation is a
  // table's ("MaxMigrate" beside a benchmark's name); another label set
  // as this one is (a rule beside, Wp-store beside Wp-load) is not.
  const sibling = (l: Line) => { const t = tokenOf(l); return Boolean(t) && faceOf(l, t!) === faceOf(label, token) && Math.abs(l.size - label.size) <= 0.5; };
  // A side condition in parentheses, or opening with "where", "if" and
  // the like, ends a rule's row ("(d fresh)", "where η fresh").
  // The layout may break one in pieces along the row ("(𝑀 : Proc 𝑄" and
  // "𝐹𝑉 (𝑀) ∩ 𝐹𝑉 (𝑞...) = ∅)"): its brackets close in the last.
  const sideNote = (l: Line) => /^\s*(?:\(.*\)|(?:where|when|if|iff|provided|unless)\s.*)$/.test(l.text)
    || (/^\s*\(/.test(l.text) && /^\s*\(.*\)\s*$/.test(row.filter((o) => onRow(o, l) && o.x0 >= l.x0).sort((a, b) => a.x0 - b.x0).map((o) => o.text).join(" ")));
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
  // A relation only inside a note of figures is a table's measurement,
  // no row's ("✗ (2.3s / B=4)" beside a benchmark).
  const figured = (t: string) => t.replace(/\([^()]*\d[^()]*\)/gu, " ");
  return side && RELATION.test(figured(text + " " + levelled)) ? { category: "row", bar: null, row, side } : { category: "none", bar: null, row, side: "right" };
}

// ------------------------------------------------------------ pass 3: names

const HYPHEN = RULE_SHAPE_HYPHEN.pattern!;
const SPACED = RULE_SHAPE_SPACED.pattern!;
const WORD = RULE_SHAPE_WORD.pattern!;
const SYMBOL = RULE_SHAPE_SYMBOL.pattern!;
const PHRASE = RULE_SHAPE_PHRASE.pattern!;
const SHORT = RULE_SHAPE_SHORT.pattern!;
const TITLE = RULE_SHAPE_TITLE.pattern!;

// Capitalised words in brackets are a phrase ("(Fixed Point)"); bare,
// a title.
function shapeOf(text: string, bracketed = false): Shape | null {
  if (HYPHEN.test(text)) return "hyphen";
  if (SPACED.test(text)) return "spaced";
  if (WORD.test(text)) return "word";
  if (SYMBOL.test(text)) return "symbol";
  if (!bracketed && TITLE.test(text)) return "title";
  if (PHRASE.test(text)) return "phrase";
  return null;
}

// A short name, or in brackets a Greek or mathematical prefix spaced
// from a word or a capital, as a column of labels sets it ("(𝛽 as)",
// "(𝑐𝑐 enter)", "(𝛽 F)"); bare, that is a side condition ("𝑥 fresh") or
// a judgment ("Γ F").
// A lone Latin letter or digit in brackets tags an item or a panel
// ("(a)"); a Greek one names a rule ("(μ)").
function shortShape(line: Line, token: Token, setting: Setting): Shape | null {
  const glyphs = notation(line, token);
  if (SHORT.test(glyphs)) return token.bracketed && /^[A-Za-z\d]$/.test(glyphs) && !(setting.category === "beside" && setting.bar) ? null : "short";
  // A type's upright letter and a mathematical capital for its
  // introduction or elimination ("U 𝐼", "F 𝐸"), as ×𝐸 and 1𝐼 are named.
  if (new RegExp(`^[A-Z] [${CAP}]$`, "u").test(token.text) && !/[A-Z]/.test(token.text.slice(-2))) return "short";
  return token.bracketed && new RegExp(`^[${GREEK}\\u{1D44E}-\\u{1D467}]{1,2} \\p{L}[\\p{L}\\d]{0,15}$`, "u").test(token.text) ? "spaced" : null;
}

// A line enclosed by a ring or box drawn round it alone, no more than
// twice its size across.
const ringed = (page: Page, line: Line) => page.drawn.some((d) => d.w > 1.5 && d.h > 1.5 && d.w <= 2.5 * line.size && d.h <= 2.5 * line.size
  && d.x <= line.x0 + 0.5 && d.x + d.w >= line.x1 - 0.5 && d.y <= line.top + 0.5 && d.y + d.h >= line.bottom - 0.5);

// A short name with a sign or a Greek letter in it, not a lone letter
// or digit: its face is the math's (a lone "c" is set as its paper's
// labels are, or is a diagram's lettering).
const signed = (shape: Shape, line: Line, token: Token) => shape === "short" && /[^A-Za-z\d]/.test(notation(line, token));

const capitals = (text: string) => text === text.toUpperCase();
const capitalised = (text: string) => /^\p{Lu}/u.test(text);

// Whether a name of this shape may label a rule in this category, and
// the rule that says so; null where it may not.
// A row that steps: an arrow or a turnstile between its sides, not the
// equation a grammar defines its categories by.
const STEP = /[→⟶↦⟼⇒⟹⇛⤇⇓⇝↝⤳↠⇐⊢⊣⊨⊩]|->|=>|~>/u;
// An arrow starred is the relation's closure: its row states where many
// steps lead, a goal reached, no step of its own ("𝑚𝑎𝑝 (𝑛1 × 32) 𝑓 ↦−→∗ …"
// tagged "(Tile1D)").
const CLOSURE = /(?:[→⟶↦⟼⇒⟹⇛⤇⇝↝⤳↠−-]|->|=>|~>)+\s*[∗*⋆]/gu;
const steps = (l: Line) => STEP.test(l.text.replace(CLOSURE, " "));
// A row that reduces: an arrow between its sides. A turnstile's row
// states a judgment, and a bare word heading one names its form
// ("Typing" before "Γ ⊢ 𝑒 : 𝜏"), as one heading a grammar's row names
// its category.
const ARROW = /[→⟶↦⟼⇒⟹⇛⤇⇓⇝↝⤳↠]|->|=>|~>/u;
const reduces = (l: Line) => ARROW.test(l.text.replace(CLOSURE, " "));

function allowed(shape: Shape, token: Token, category: Category, row: Line[] = [], side: Setting["side"] = "right"): string | null {
  // A word in parentheses at the margin names a row that steps ("(send)"
  // after a reduction); beside a grammar's equation it tags a category
  // ("(Actors)" after "A = x : Σ"), unless in lower case it names a law
  // as below ("(filter)" after "push(𝑣) · pop(𝑤) ≡ 0").
  if (category === "margin" && shape === "word" && token.bracketed && !token.square && row.some(steps)) return RULE_NAME_MARGIN.id;
  // Capitalised words name a rule only beside its bar: over one they head
  // a group of rules or a table's rows ("Well-formed Type", "Prior Work"),
  // at a row or the margin a figure's group (rule.shape.title).
  if (shape === "title" && category !== "beside") return null;
  switch (category) {
    case "beside":
      return RULE_NAME_BESIDE.id;
    case "over":
      return shape === "short" && !token.bracketed ? null : RULE_NAME_OVER.id;
    case "row":
      // A bare word heading a row that reduces stands as the paper's
      // convention allows, a weak label among strong ones set as it is
      // (app and beta in small capitals at the head of reductions headed
      // unw-inter-zone); heading a judgment or a grammar's row, or
      // ending a row, it names the judgment's form or the category.
      return shape === "symbol" || (shape === "short" && !token.bracketed) || (shape === "word" && !token.bracketed && (token.colon || side !== "left" || !row.some(reduces))) || (shape === "phrase" && !token.bracketed) ? null : RULE_NAME_ROW.id;
    case "margin":
      // A parenthesised word there in lower case names a law as its
      // neighbours do ("(filter)" between "(push-pop)" and "(pop-push)");
      // a capitalised one titles a group ("(Kinding)").
      return shape === "phrase" || shape === "short" ? null : shape === "hyphen" || shape === "spaced" || (shape === "word" && (token.square || (token.bracketed && !capitalised(token.text)))) ? RULE_NAME_MARGIN.id : null;
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
// Where a label stands across the page, its brackets with it.
function labelSpan(line: Line, token: Token): [number, number] {
  if (token.side === "whole") return [line.x0, line.x1];
  const open = token.bracketed ? line.text.slice(0, token.start).search(/[[(]\s*$/) : token.start;
  const close = token.bracketed ? token.end + line.text.slice(token.end).search(/[\])]/) : token.end - 1;
  return [edgesOf(line, open)?.[0] ?? line.x0, edgesOf(line, close)?.[1] ?? line.x1];
}
// The face of the bracket opening a bracketed token.
function bracketFace(line: Line, token: Token): string {
  const at = line.text.slice(0, token.start).search(/[[(]\s*$/);
  const ref = at < 0 ? undefined : line.chars[at];
  return ref && ref.run >= 0 ? family(line.runs[ref.run].font) : "";
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
const weak = (c: Candidate) => c.shape === "word" || c.shape === "short" || c.shape === "title" || (c.shape === "spaced" && new RegExp(`^(?:[${MATH_LOWER}]|[${GREEK}] \\p{Ll})`, "u").test(c.token.text)) || (c.shape === "spaced" && /[\d↓↑]$/u.test(c.token.text));

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
  // Nor is a conclusion as long as a line of text, set in the text's face
  // hard under the bar within its span (wp-conj0's "wp 𝒕₁{𝑄₁} ∧ wp 𝒕₂{𝑄₂} ⊢
  // wp (𝒕₁+𝒕₂) {𝑄₁∧𝑄₂}").
  const conclusion = (l: Line) => Boolean(bar) && l.x0 >= bar!.x - label.size && l.x1 <= bar!.x + bar!.w + label.size && l.top >= bar!.y - 1 && l.top <= bar!.y + 0.8 * type.leading;
  // Nor is a line set smaller than the text, as a figure is ("when T₂ ≠
  // … and …" under E_Forget).
  // A side condition ("where 0−free(ℓ, E) and …") set in from the rule's
  // edge under its row is no running text either.
  const running = (l: Line) => prose(l, type) && l.size >= 0.95 * type.bodySize
    && !(/^\s*(?:where|if|when|provided|unless)\b/i.test(l.text) && l.x0 > label.x0 + 2 * label.size);
  // Nor is a line set from the column's left edge reaching well left of
  // the bar and its label: a paragraph's line hard by a rule set in the
  // text ("ℓ₁ ≻ ℓ₂, and …:" over N-Strict, a theorem under E-β).
  // Without a bar, the same holds of a line over the label, not level
  // with it, reaching well left of the rest of its row ("when decoding
  // variant V :" over P-Fld's axiom, the label set level with both).
  const inset = setting.row.filter((l) => l.x0 > type.text.x0 + label.size);
  const rowStart = Math.min(label.x0, ...inset.map((l) => l.x0));
  const flushLeft = (l: Line) => l.x0 <= type.text.x0 + label.size && (bar ? l.x0 < Math.min(bar.x, label.x0) - 2 * label.size
    : inset.length > 0 && l.x0 < rowStart - 2 * label.size && l.bottom <= label.top + 1);
  // A gloss set under a bar-less row, in past where its formula starts
  // and not past where it ends, explains the rule's notation ("𝐺\𝑛′→𝛼 𝑛′
  // is 𝐺 with all … removed" under fix's "where"): a paragraph round a
  // rule set inline starts at the column's edge, or beside the rule.
  const body = setting.row.filter((l) => l !== label && l.x0 > label.x1);
  const gloss = (l: Line) => !bar && setting.side !== "over" && body.length > 0 && l.top >= label.bottom - 1
    && l.x0 > Math.min(...body.map((r) => r.x0)) + 2 * label.size && l.x0 < Math.max(...body.map((r) => r.x1));
  // A delimiter stretched over a stack of lines (a specification's tall
  // braces) is set larger than any line of the rule, however far from a
  // broken font: it takes part, and carries what it brackets (Acq-Read's
  // postcondition in braces after "{⊒𝑉 ∗ ℓ ↦ ℎ} ∗acq ℓ").
  const tall = page.lines.filter((l) => !l.furniture && /\S/.test(l.text) && STRETCHED.test(l.text) && l.size > 2 * label.size && l.size <= 12 * label.size);
  const lines = [...ruleLines(page, label), ...tall].filter((l) => !others.lines.has(l) && !another(l) && !setInto(page, l) && (!running(l) || premise(l) || conclusion(l) || gloss(l)) && !flushLeft(l) && !CAPTION.test(l.text)
    && (setting.side !== "over" || l.top >= label.top - tolerance(l, label))
    && (setting.bar || ![...others.lines].some((o) => onRow(o, l))));
  const slack = setting.bar ? 0 : BESIDE * label.size;
  const taken = new Set<Line>([label]);
  let x0: number, x1: number;
  if (bar) {
    x0 = Math.min(bar.x, label.x0); x1 = Math.max(bar.x + bar.w, label.x1);
    for (const l of lines) if (l.x0 <= x1 + slack && l.x1 >= x0 - slack && l.bottom >= bar.y - 0.8 * type.leading && l.top <= bar.y + 0.8 * type.leading) taken.add(l);
  } else {
    for (const l of setting.row) if (!flushLeft(l)) taken.add(l);
    x0 = Math.min(...[...taken].map((l) => l.x0)); x1 = Math.max(...[...taken].map((l) => l.x1));
  }
  // Past the conclusion, a line over another bar is that rule's premise
  // (Assign's over Access's conclusion; 1⊥'s over ⊗⅋'s, though "1⊥" is no
  // name found), unless it opens with a relation: the conclusion broken
  // over two lines (Define's "→ ⟨body…⟩"). That bar has a conclusion
  // under it: a frame's edge under the figure concludes nothing (CAS's
  // "B′(x) = ε" over the edge of Semantics 2). Running on from a line
  // over it (`end`), a line hard under that and further from the lines
  // under it hangs from this rule, the other rule's premise between (STORE's
  // "B′(x) = l · pc" over FLUSH's "B(x) = l · b").
  const beyond = (l: Line, end?: number) => Boolean(bar) && l.top > bar!.y + 0.8 * type.leading && !/^\s*[→⟶⇒↦=≡⊢]/u.test(l.text)
    && page.drawn.some((d) => {
      if (d === bar || !across(d) || d.y <= l.bottom || d.y - l.bottom > 2 * type.leading || d.x > l.x0 + label.size || d.x + d.w < l.x1 - label.size || !concludes(page, d, type)) return false;
      if (end === undefined) return true;
      const between = page.lines.filter((o) => o !== l && !o.furniture && o.top >= l.bottom - 1 && o.bottom <= d.y + 1 && o.x0 < l.x1 && o.x1 > l.x0);
      return !between.length || Math.min(...between.map((o) => o.top)) - l.bottom <= l.top - end + 1;
    });
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
      if (![...taken].some((t) => (tall.includes(t) || tall.includes(line) ? levelBy(t, line, label.size) : level(t, line)))) continue;
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
        // A row centred over the bar may run past its ends (Wp-Conj's side
        // conditions "idx(Q₁) ⊆ supp(t₁) …" over its premise).
        const centred = Math.abs((line.x0 + line.x1) / 2 - (bar.x + bar.w / 2)) <= label.size && line.x1 - line.x0 <= 2 * bar.w;
        if (taken.has(line) || (!centred && (line.x0 < bar.x - label.size || line.x1 > bar.x + bar.w + label.size)) || !sameColumn(page, line, label) || tokenOf(line)?.side === "whole") continue;
        if (line.bottom > start + 1 || start - line.bottom > 0.6 * type.leading || line.text.replace(/\s/g, "").length < 2) continue;
        // Upright words in the text's face are a note beside the rules
        // ("No ⊤L rules"), no premise; with a relation between them they
        // are one ("idx(Q₁) ⊆ supp(t₁)").
        if (faceOf(line) === family(type.font) && !RELATION.test(line.text) && line.runs.filter((r) => /\p{L}{2,}/u.test(r.text) && !ITALIC.test(r.font)).length >= 2) continue;
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
        if (taken.has(line) || line.size > 2 * label.size || line.x0 < bar.x - label.size || line.x1 > bar.x + bar.w + label.size || !sameColumn(page, line, label) || beyond(line, end)) continue;
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
      // Its braces, however tall, carry the stack on: one opening on its
      // last line, reaching down past it, takes in what it brackets
      // (rc-commit-spec's postcondition, two cases in one tall ⟨ ⟩).
      const braces = [...taken].filter((t) => STRETCHED.test(t.text) && t.size > 2 * label.size);
      const stack = [...taken].filter((t) => !braces.includes(t));
      // A brace closing on the stack's last line ends there with it.
      const end = ((e) => Math.max(e, ...braces.filter((b) => b.bottom <= e + type.leading).map((b) => b.bottom)))(Math.max(...stack.map((t) => t.bottom)));
      const last = Math.max(...stack.map((t) => t.top));
      const from = Math.min(...[...taken].map((t) => t.x0)), to = Math.max(...[...taken].map((t) => t.x1));
      // The next label under this one, level with the stack or left of
      // it, heads the lines from its top down (Hb-Pop under Hb-Push's
      // postcondition, its own in tall brackets further right).
      const next = Math.min(...[...others.lines].filter((o) => o.top > label.bottom + 1 && o.x0 < to && o.x1 > from - label.size && sameColumn(page, o, label)).map((o) => o.top));
      const bracketed = (l: Line) => braces.some((b) => l.x0 >= b.x0 - 1 && l.x1 <= b.x1 + 1 && l.top >= b.top - 1 && l.bottom <= b.bottom + 1);
      for (const line of [...lines, ...page.lines.filter((l) => !l.furniture && STRETCHED.test(l.text) && l.size > 2 * label.size)]) {
        if (taken.has(line) || line.x0 < from - label.size || line.x0 > to || !sameColumn(page, line, label) || tokenOf(line)?.side === "whole" || line.top >= next - 1) continue;
        const opening = STRETCHED.test(line.text) && line.size > 2 * label.size && line.top >= last - label.size && line.top < end && line.bottom > end + type.leading;
        if (!opening && !bracketed(line) && (line.top < end - 1 || line.top - end > 0.6 * type.leading || (!STRETCHED.test(line.text) && line.text.replace(/\s/g, "").length < 2))) continue;
        // Upright words with no relation among them head what follows
        // ("Rules for the post-crash modality" under pfs-pf).
        const words = line.text.split(/\s+/).filter((w) => /^\p{L}{3,}$/u.test(w) && line.runs.some((r) => r.text.includes(w) && !ITALIC.test(r.font) && !MONO.test(r.font) && !SYMBOLIC.test(r.font)));
        if (words.length >= 3 && !RELATION.test(line.text)) continue;
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
  const b = padded(page, Math.min(x0, ...all.map((l) => leftOf(l, bar, label))), Math.max(x1, ...all.map((l) => l.x1)), Math.min(...all.map((l) => l.top)), Math.max(...all.map((l) => l.bottom)));
  return { x: b.x0 / page.width, y: b.y0 / page.height, w: (b.x1 - b.x0) / page.width, h: (b.y1 - b.y0) / page.height };
}
// A box padded round what it holds, the padding stopping at a caption
// set hard over or under it ("Fig. 7." under Sample's indexed sum): the
// box holds the rule, not the caption's letters.
function padded(page: Page, x0: number, x1: number, y0: number, y1: number): { x0: number; x1: number; y0: number; y1: number } {
  let top = y0 - PAD, bottom = y1 + PAD;
  for (const l of page.lines) {
    if (l.furniture || !CAPTION.test(l.text) || l.x0 >= x1 || l.x1 <= x0) continue;
    if (l.top >= y1 - 1 && l.top < bottom) bottom = Math.max(y1, l.top);
    if (l.bottom <= y0 + 1 && l.bottom > top) top = Math.min(y0, l.bottom);
  }
  return { x0: Math.max(0, x0 - PAD), x1: Math.min(page.width, x1 + PAD), y0: Math.max(0, top), y1: Math.min(page.height, bottom) };
}

// ------------------------------------------------------------ pass 7: mentions

const NEAR = 60;
// "rule" (or a kin) within six words before or after the name: "the
// sapp rule", "rule containTrans", "rules slam, sbind and sapp".
const RULE_WORDS = /\b(?:rules?|laws?|axioms?)\b/i;
const RULE_BEFORE = /\b(?:rules?|laws?|axioms?)\s*[[(]?\s*(?:[^\s,()[\]]+,?\s+(?:and\s+|or\s+)?){0,6}$/iu;
const RULE_AFTER = /^\s*(?:[\])]\s*)?(?:,?\s*(?:and\s+|or\s+)?[^\s,()[\]]+){0,6}\s+(?:rules?|laws?|axioms?)\b/iu;
// ... and for a short name, "rule" hard by it, or a list of names in
// between: "rule !", "rules ⊗, ⅋, 1 and ⊥", "the c and w rules"; not
// "rules displayed in Figure 1".
const RULE_JUST_BEFORE = /\b(?:rules?|laws?|axioms?)\s+(?:[^\s,()[\]]+(?:\s*,\s*(?:and\s+|or\s+)?|\s+(?:and|or)\s+))*$/iu;
const RULE_JUST_AFTER = /^(?:(?:\s*,\s*(?:and\s+|or\s+)?|\s+(?:and|or)\s+)[^\s,()[\]]+)*\s+(?:rules?|laws?|axioms?)\b/iu;
// A word with a capital after a lowercase letter, or capitals running
// into a capitalised word (MKSVar, MALam1), is no English word: a
// camelCase name cites its rule wherever it is printed.
const camel = (text: string) => /\p{Ll}\p{Lu}|\p{Lu}{2}\p{Ll}{2}/u.test(text);
// A Latin capital alone in brackets, set in the math face ("(𝐹 )" among
// "(𝑅1)" … "(𝑅9)"), tags its row as a word does; an upright one letters a
// displayed term as a numeral numbers an equation ("(A)" and "(B)"
// tagging a program before and after its rewriting).
const mathCapital = (token: Token) => token.bracketed && /^[A-Z]$/.test(fold(token.text)) && !/^[A-Z]$/.test(token.text);
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// A name in the text is the label's, whatever its case, only where one of
// the two is in capitals throughout: small capitals reach the text layer
// as capitals from some fonts and as the name from others, while
// "well-typed" is not the rule "Well-Typed".
// A hyphenated name whose prefix is printed as labelled and whose parts
// differ only in case is the same name (WS-app for WS-App).
const prefix = (text: string) => text.split(/[-‐‑–:/_]/)[0];
const sameName = (printed: string, name: string) => fold(printed) === fold(name)
  || (fold(printed).toLowerCase() === fold(name).toLowerCase() && (capitals(printed) || capitals(name) || (name.includes("-") && prefix(printed) === prefix(name))));

// Whether a place in the text cites the rule, in the form its shape and
// setting allow (rule.mention): a hyphenated name, a symbol or a spaced
// name in capitals as it is; a bracketed word in brackets; a bare word,
// or a spaced name with a capitalised word, in its printed case within a
// few words of "rule".
// pdf.js may set a blank between two mathematical italic letters of a
// name, after the italic correction of an 𝑓 ("while𝑓 𝑎𝑙𝑠𝑒" citing
// while𝑓𝑎𝑙𝑠𝑒): no blank of the name's.
const MATH_GAP = /(?<=[\u{1D400}-\u{1D7FF}])\s(?=[\u{1D400}-\u{1D7FF}])/gu;

function cites(rule: { name: string; shape: Shape; bracketed: boolean }, spaced: string, bracketed: boolean, before: string, after: string): boolean {
  const printed = spaced.replace(MATH_GAP, "");
  const exact = printed.replace(/\s+/g, " ") === rule.name;
  if (rule.shape === "symbol") return exact;
  // A short name only with "rule" by it ("rule !", "rules ⊗, ⅋, 1 and
  // ⊥", "rules c and w"), or in brackets where it holds a sign and a
  // letter ("(β→)"; "(⋆)" marks a table's entries):
  // a bare "1" or "!" in prose is a number or a sign, "(1)" an equation.
  if (rule.shape === "short") return exact && (RULE_JUST_BEFORE.test(before) || RULE_JUST_AFTER.test(after) || (bracketed && /[^\p{L}\d]/u.test(rule.name) && /\p{L}/u.test(rule.name)));
  if (rule.shape === "hyphen" || (rule.shape === "spaced" && capitals(rule.name))) return sameName(printed.replace(/[\s\u00ad]+/g, " ").replace(/([-‐‑–]) /g, "$1"), rule.name);
  // A word: in brackets as the label was, or as printed with "rule"
  // (or a kin) within three words: "the sapp rule", "(rule slam and
  // sbind)"; a camelCase word as printed anywhere.
  if (bracketed) return sameName(printed, rule.name);
  // A label of a lowercase letter or two, set in brackets, is a keyword
  // or a little word in prose ("(do)", "(as)"; "the do identity", "rules
  // do a switch"): bare, it cites its rule only as a short name does, a
  // list of names ending where "rule" stands by it.
  if (rule.bracketed && /^\p{Ll}{1,2}$/u.test(rule.name)) return sameName(printed, rule.name) && (RULE_JUST_AFTER.test(after) || (RULE_JUST_BEFORE.test(before) && /^\s*(?:[,.;:)]|(?:and|or)\s|$)/u.test(after)));
  return sameName(printed, rule.name) && (camel(rule.name) || RULE_BEFORE.test(before) || RULE_AFTER.test(after));
}

// Every place in the text that names one of the rules, longest names
// first so "T-App-Abs" is not "T-App".
type Named = { name: string; shape: Shape; bracketed: boolean; set?: Line }; // set: its label's line
// A short name is cited set as its label is, sign by sign: a letter
// where the label has a symbol font's glyph is no citation of it ("O" in
// "O(n)" is not stmary's ⅋).
function setAsLabel(at: Flow["at"], start: number, rule: Named): boolean {
  if (rule.shape !== "short" || !rule.set) return true;
  const from = rule.set.text.indexOf(rule.name);
  const glyph = (line: Line, char: number) => line.chars[char]?.run >= 0 && SYMBOLIC.test(line.runs[line.chars[char].run].font);
  return from < 0 || [...rule.name].every((c, i, all) => {
    const k = all.slice(0, i).join("").length, there = at[start + k];
    return /\s/u.test(c) || (Boolean(there) && glyph(rule.set!, from + k) === glyph(there.line, there.char));
  });
}

function* mentionsIn(text: string, rules: Named[], at?: Flow["at"]): Generator<{ index: number; length: number; nameStart: number; nameEnd: number; bracketed: boolean; printed: string; rule: number }> {
  if (!rules.length) return;
  const order = rules.map((r, i) => i).sort((a, b) => rules[b].name.length - rules[a].name.length);
  // A hyphen may break the name over a line ("(Sec-" / "Chs)").
  // A minus sign and an asterisk operator stand for a hyphen and an
  // asterisk (While−∀∗∃∗ cited as While-∀*∃*).
  const names = order.map((i) => escape(rules[i].name).replace(/[-−]/g, "[-‐‑–−]\\s?").replace(/\\\*|∗/g, "[*∗]").replace(/ /g, "\\s+")
    .replace(/(?<=[\u{1D400}-\u{1D7FF}])(?=[\u{1D400}-\u{1D7FF}])/gu, "\\s?")).join("|");
  const re = new RegExp(`(?<![\\p{L}\\d])(?<open>[\\[(])?(?<name>${names})(?<close>[\\])])?(?![\\p{L}\\d])`, "giu");
  type Found = { index: number; length: number; nameStart: number; nameEnd: number; bracketed: boolean; printed: string; rule: number };
  const found: Found[] = [];
  // A bare word is cited where a name it is listed with is ("are raise,
  // unw-intra-zone, and then invoke"; "unw-intra-zone, and invoke"): a
  // word set off by a comma, an "and" or an "and then" from a hyphenated
  // or spaced name's citation names its rule too. Such a match waits
  // for its neighbours.
  const listed: (Found & { fits: number[] })[] = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    const groups = match.groups!;
    const bracketed = Boolean(groups.open && groups.close);
    const before = text.slice(Math.max(0, match.index - NEAR), match.index);
    const after = text.slice(match.index + match[0].length, match.index + match[0].length + NEAR);
    const nameStart = match.index + (groups.open ? 1 : 0);
    const fits = order.filter((i) => sameName(groups.name.replace(MATH_GAP, "").replace(/\s+/g, " "), rules[i].name) && (!at || setAsLabel(at, nameStart, rules[i])));
    const rule = order.find((i) => cites(rules[i], groups.name, bracketed, before, after) && (!at || setAsLabel(at, nameStart, rules[i])));
    const m = { index: match.index, length: match[0].length, nameStart, nameEnd: nameStart + groups.name.length, bracketed, printed: groups.name, rule: rule ?? -1 };
    if (rule !== undefined) found.push(m);
    else if (!bracketed && fits.some((i) => rules[i].shape === "word" && !rules[i].bracketed)) listed.push({ ...m, fits: fits.filter((i) => rules[i].shape === "word" && !rules[i].bracketed) });
  }
  const strong = (m: Found) => rules[m.rule].shape === "hyphen" || rules[m.rule].shape === "spaced";
  const LIST = /^(?:\s*,\s*(?:(?:and|or)\s+(?:then\s+)?)?|\s+(?:and|or)\s+(?:then\s+)?)$/u;
  const joined = (a: Found, b: Found) => a.index + a.length <= b.index && LIST.test(text.slice(a.index + a.length, b.index));
  for (const m of listed) {
    if (!found.some((o) => strong(o) && (joined(o, m) || joined(m, o)))) continue;
    found.push({ ...m, rule: m.fits[0] });
  }
  yield* found.sort((a, b) => a.index - b.index);
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

function citedAnywhere(flows: Flow[], rule: Named, labels: Set<Line>, labelFace: string, type: Type): boolean {
  for (const flow of flows) {
    for (const m of mentionsIn(flow.text, [rule], flow.at)) {
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

// A paragraph wrapped round a figure can reach the layout with the
// figure's label on its line, a blank apart past the paragraph's edge
// ("… for 𝑚’s   Focus" over the rule the paragraph wraps): the lines under
// it end at that edge, short of the label. The label is split off as a
// line of its own; `parents` maps it back to the line it came from.
const parents = new WeakMap<Line, Line>();
function unwrapped(page: Page, type: Type): Page {
  const out: Line[] = [];
  let split = false;
  for (const line of page.lines) {
    const token = line.furniture ? null : tokenOf(line, false, true);
    const k = token?.side === "tail" ? line.chars[token.start]?.run ?? -1 : -1;
    const whole = k > 0 && line.chars.slice(token!.start).every((c) => c.run < 0 || c.run >= k) && line.chars.slice(0, token!.start).every((c) => c.run < k)
      && line.runs.slice(k).map((r) => r.text).join("").trim() === line.text.slice(token!.start).trim();
    if (!whole || !prose({ ...line, text: line.text.slice(0, token!.start) } as Line, type)) { out.push(line); continue; }
    const edge = line.runs[k - 1].x + line.runs[k - 1].width;
    const wrapped = page.lines.some((l) => l !== line && !l.furniture && l.top > line.bottom - 1 && l.top <= line.bottom + type.leading && prose(l, type)
      && Math.abs(l.x1 - edge) <= 0.5 * line.size && l.x0 <= line.x0 + 2 * line.size);
    if (!wrapped) { out.push(line); continue; }
    const piece = (runs: typeof line.runs, from: number, to: number, shift: number): Line => ({
      ...line, runs, text: line.text.slice(from, to), chars: line.chars.slice(from, to).map((c) => (c.run < 0 ? c : { run: c.run - shift, at: c.at })),
      x0: runs[0].x, x1: Math.max(...runs.map((r) => r.x + r.width)),
    });
    const rest = piece(line.runs.slice(0, k), 0, token!.start, 0), label = piece(line.runs.slice(k), token!.start, line.text.length, k);
    parents.set(rest, line); parents.set(label, line);
    out.push(rest, label);
    split = true;
  }
  return split ? { ...page, lines: out } : page;
}

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
  const pages = layout.pages.map((page) => { const bars = textBars(page); return unwrapped(bars.length ? { ...page, drawn: [...page.drawn, ...bars] } : page, type); });
  for (const page of pages) {
    for (const line of page.lines) {
      if (line.furniture || skip.has(parents.get(line) ?? line) || line.size > LABEL_SIZE * bodySize || line.size < LABEL_LEAST * bodySize) continue;
      const token = tokenOf(line, false, true) ?? shortOf(line, false, true);
      // A lone letter or digit in brackets counts only beside a bar
      // (shortShape): elsewhere it tags an item or an equation.
      const setting = token && settingOf(page, line, token, type);
      if (token && setting && (!token.bracketed || mathCapital(token) || !/^[A-Za-z\d]$/.test(notation(line, token)) || (setting.category === "beside" && setting.bar))) seen.push({ page, line, token, setting });
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
      if (line.furniture || skip.has(parents.get(line) ?? line) || seen.some((s) => s.line === line) || line.size > LABEL_SIZE * bodySize || line.size < LABEL_LEAST * bodySize) continue;
      const token = tokenOf(line, true, true) ?? phraseOf(line) ?? shortOf(line, true);
      if (!token || (token.side === "whole" && !PHRASE.test(token.text)) || (token.side === "head" && !token.bracketed)) continue;
      const column = rows.filter((s) => (s.token.side === token.side || s.token.side === "whole") && Math.abs(edge(s.line, token.side) - edge(line, token.side)) <= 1 && Math.abs(s.line.size - line.size) <= 0.5
        && faceOf(s.line, s.token) === faceOf(line, token));
      // Rows set at their own indents head a column of labels only in
      // kind: bracketed labels set alike heading rows, this one a wide
      // blank from its row ("(Proc)" run into its transition among
      // "(Ret)" and "(Fun)").
      const close = line.text.indexOf(")", token.end);
      const alike = token.side === "head" && close >= 0 && blankAfter(line, close + 1) >= 0.5 * line.size
        && rows.filter((s) => s.token.bracketed && s.setting.side === "left" && Math.abs(s.line.size - line.size) <= 0.5 && faceOf(s.line, s.token) === faceOf(line, token)).length >= 3;
      if (column.length >= 2 || alike) seen.push({ page, line, token, setting: settingOf(page, line, token, type) });
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
  // Bracketed labels are set alike by their brackets, whatever face the
  // name inside takes ("(β∀)" in math italic among "(jump)" in sans);
  // one heading its own line heads that line ("(ret) ⟨H; J, …⟩").
  for (const s of seen) {
    const heading = s.token.side === "head" && s.token.bracketed;
    if (s.setting.category !== "none" || (s.token.side !== "whole" && !heading) || (!heading && !s.setting.row.length)) continue;
    const [x0, x1] = labelSpan(s.line, s.token);
    const column = seen.filter((o) => o !== s && o.page === s.page && o.setting.category === "row" && o.token.side !== "tail"
      && (Math.abs(labelSpan(o.line, o.token)[1] - x1) <= 1 || Math.abs(labelSpan(o.line, o.token)[0] - x0) <= 1) && Math.abs(o.line.size - s.line.size) <= 0.5
      && (faceOf(o.line, o.token) === faceOf(s.line, s.token) || (o.token.bracketed && s.token.bracketed && bracketFace(o.line, o.token) === bracketFace(s.line, s.token)))
      && Math.abs(o.line.top - s.line.top) <= 8 * type.leading);
    const side = heading ? "left" : s.setting.row.every((l) => l.x1 <= s.line.x0 + tolerance(l, s.line)) ? "right" : s.setting.row.every((l) => l.x0 >= s.line.x1 - tolerance(l, s.line)) ? "left" : null;
    if (column.length >= 2 && side && column.every((o) => o.setting.side === side)) s.setting = { category: "row", bar: null, row: s.setting.row, side };
  }
  // A bar leading into a wider one under it is a step where no label
  // names that wider bar.
  const barred = new Set(seen.map((s) => s.setting.bar).filter(Boolean));
  for (const s of seen) if (s.setting.step && !barred.has(s.setting.step)) s.setting.derived = true;
  // ... and a bar leading into a step is one: its conclusion is that
  // step's premise (T-Lam over T-App in let-arguments' desugared tree);
  // so is a label at a step's bar (a second label beside it). A bar is
  // a step where any label found at it is, whatever else (a premise's
  // cell) stands there too.
  const steps = new Set(seen.filter((s) => s.setting.derived && s.setting.bar).map((s) => s.setting.bar));
  for (let grown = true; grown;) {
    grown = false;
    for (const s of seen) {
      if (s.setting.derived || !((s.setting.step && steps.has(s.setting.step)) || (s.setting.category === "beside" && s.setting.bar && steps.has(s.setting.bar)))) continue;
      s.setting.derived = true; grown = true;
      if (s.setting.bar) steps.add(s.setting.bar);
    }
  }
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
      const shape = shapeOf(fold(token.text), token.bracketed) ?? (mathCapital(token) ? "word" : null) ?? shortShape(line, token, setting);
      if (!shape) continue;
      // A hyphen before a numeral numbers a capitalised word's variants
      // (Continuous-1, Continuous-2); after a lone letter it is a formula.
      if (shape === "hyphen" && !/[-‐‑–−:/_][^-‐‑–−:/_]*[\p{L}→⇒⇓∀∃⊢⊗⊕⊸∧∨¬<∂⊤⊥]/u.test(fold(token.text)) && !/\p{Lu}\p{Ll}{2,}[-‐‑–]\d{1,2}$/u.test(token.text)) { trace.add(RULE_NAME_LETTERS.id, page.number, token.text, at(page, line, box)); continue; }
      // A name set wholly raised or lowered is a script of its line, no
      // label ("Wrh⟦ ⟧" over a bracket's end).
      const scripted = [...token.text].every((c, i) => { const ref = line.chars[token.start + [...token.text].slice(0, i).join("").length]; return /\s/u.test(c) || (ref?.run >= 0 && (line.runs[ref.run].sup || line.runs[ref.run].sub)); });
      // So is a line of its own set smaller within a larger line's span on
      // its row, off its baseline: the index of a relation the layout split
      // off (NOM under the "d" of noms-exchanges-fuel's conclusion).
      const indexing = page.lines.some((o) => o !== line && !o.furniture && o.size >= 1.25 * line.size && o.size <= 2 * line.size && level(o, line) && o.x0 < line.x0 - 1 && o.x1 > line.x1 + 1
        && Math.abs(o.baseline - line.baseline) >= 0.2 * line.size);
      if (scripted || indexing) { trace.add(RULE_NAME_LETTERS.id, page.number, token.text, at(page, line, box)); continue; }
      // A short name set a blank apart from its row, as a label is: one
      // hard by it is a piece of the formula the layout split off ("(Γ)"
      // after a big ⨂).
      const [left, right] = labelSpan(line, token);
      if (shape === "short" && setting.category === "row" && token.side === "whole" && setting.row.some((l) => onRow(l, line) && Math.max(l.x0 - right, left - l.x1) < APART * line.size)) {
        trace.add(RULE_NAME_LETTERS.id, page.number, token.text, at(page, line, box)); continue;
      }
      // A letter in a ring drawn round it marks a step for the prose to
      // point at (Ⓐ beside a derivation's bar), no rule's name.
      if (shape === "short" && ringed(page, line)) { trace.add(RULE_NAME_LETTERS.id, page.number, token.text, at(page, line, box)); continue; }
      // A row opening with "where" goes on from the line over it
      // ("where π′ = …" under spawn's reduction).
      const over = (r: Line) => page.lines.filter((l) => !l.furniture && l.bottom <= r.top + 1 && r.top - l.bottom <= 0.5 * type.leading && l.x0 < r.x1 && l.x1 > r.x0);
      const rule = allowed(shape, token, setting.category, setting.row.flatMap((r) => (/^\s*where\s/.test(r.text) ? [r, ...over(r)] : [r])), setting.side);
      if (!rule) {
        if (setting.category === "margin") trace.add(RULE_HEADING.id, page.number, token.text, at(page, line, box));
        continue;
      }
      // The size of the label's own letters: a brace's piece set on its
      // line ("MSLocalConflict{") sizes nothing. A short name's signs and Greek
      // letters come from the math fonts, whatever face its paper's labels
      // take: its face is no convention.
      const size = line.runs[line.chars[token.start]?.run]?.size ?? line.size;
      const convention = `${setting.category}|${setting.side}|${token.bracketed ? "[]" : ""}|${signed(shape, line, token) ? "" : facesOf(line, token)}|${Math.round(size * 2) / 2}`;
      candidates.push({ line, page, token, shape, setting: setting as Candidate["setting"], rule, convention });
    }
  }
  // A bare word heading a row stands in a column of labels with a
  // hyphenated or spaced name heading a row on its page, set in its face
  // and size and aligned with it at either end (app, beta and invoke
  // under unw-inter-zone, all flush right); alone it is a grammar's
  // category or a judgment's form (rule.name.row).
  const headed = (c: Candidate) => c.setting.category === "row" && c.setting.side === "left" && !c.token.bracketed;
  const columnHead = (c: Candidate) => !(headed(c) && c.shape === "word") || candidates.some((o) => o !== c && o.page === c.page && headed(o) && !weak(o)
    && o.convention === c.convention && (Math.abs(o.line.x1 - c.line.x1) <= 1 || Math.abs(o.line.x0 - c.line.x0) <= 1));
  for (const c of candidates) if (!columnHead(c)) trace.add(RULE_NAME_ROW.id, c.page.number, `${c.token.text} alone`, at(c.page, c.line, boxAt(c.page, c.line, c.setting)));
  candidates = candidates.filter(columnHead);
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
  // A word in parentheses at the margin names a rule only among hyphenated
  // names set so ("(send)" by "(relay-in)"); alone it heads a judgment's
  // form ("(Matching)" by "σ ⊲ σ1 → σ2").
  const hyphened = new Map<string, number>();
  for (const c of candidates) if (!weak(c)) hyphened.set(c.convention, (hyphened.get(c.convention) ?? 0) + 1);
  // A camelCase word the text cites names its rule all the same
  // ("(RegRoot)" after its Hoare triple, cited as RegRoot): a group's
  // title is a plain word. A row left open by a connective is a conjunct
  // of a definition running on under it, no rule ("(lockedExcl)" after
  // "□ (∀s₁, s₂. …) ∧"); a name another label sets at its bar is that
  // rule's, cited by a proof's step ("(HavocS)" after HavocS's rule).
  const conjunct = (c: Candidate) => /[∧∨∗]\s*$/u.test([...c.setting.row].sort((a, b) => a.x0 - b.x0).map((l) => l.text).join(" "));
  const named = (c: Candidate) => candidates.some((o) => o !== c && Boolean(o.setting.bar) && keyOf(fold(o.token.text)) === keyOf(fold(c.token.text)));
  const titled = (c: Candidate) => !camel(c.token.text) || conjunct(c) || named(c) || !citedAnywhere(flows, { name: c.token.text, shape: c.shape, bracketed: c.token.bracketed, set: c.line }, new Set(candidates.map((o) => o.line)), faceOf(c.line, c.token), type);
  const tagged = (c: Candidate) => c.setting.category === "margin" && c.shape === "word" && c.token.bracketed && !c.token.square && (hyphened.get(c.convention) ?? 0) < 2 && titled(c);
  for (const c of candidates) if (tagged(c)) trace.add(RULE_CONVENTION.id, c.page.number, `${c.token.text} alone`, at(c.page, c.line, boxAt(c.page, c.line, c.setting)));
  candidates = candidates.filter((c) => !tagged(c));
  // A lone letter or digit in brackets beside a bar names a rule only
  // among glyphs named so on its page ("(1)" by "(𝜔)" and "(𝜌)"); a run of
  // numbers alone numbers equations ("(7)" to "(9)" at a fraction's end).
  const tag = (c: Candidate) => c.token.bracketed && !mathCapital(c.token) && /^[A-Za-z\d]$/.test(notation(c.line, c.token));
  const glyphed = (c: Candidate) => candidates.some((o) => o.page === c.page && o.token.bracketed && o.setting.category === "beside" && Boolean(o.setting.bar) && !tag(o) && signed(o.shape, o.line, o.token));
  for (const c of candidates) if (tag(c) && !glyphed(c)) trace.add(RULE_NAME_LETTERS.id, c.page.number, c.token.text, at(c.page, c.line, boxAt(c.page, c.line, c.setting)));
  candidates = candidates.filter((c) => !tag(c) || glyphed(c));
  const conventions = new Map<string, number>();
  const strong = new Map<string, number>();
  for (const c of candidates) {
    conventions.set(c.convention, (conventions.get(c.convention) ?? 0) + 1);
    if (!weak(c)) strong.set(c.convention, (strong.get(c.convention) ?? 0) + 1);
  }
  const labels = new Set(candidates.flatMap((c) => [c.line, ...(parents.has(c.line) ? [parents.get(c.line)!] : [])]));
  const confirmed = new Set<string>();
  // A paper that sets eight or more strong names at bars is a paper of
  // rules: a bare word at a bar of its own, in the face those
  // names are set in, stands there too (Löb, LET, Work), as do camelCase
  // words at bars set five or more alike.
  const atBar = (c: Candidate) => (c.setting.category === "beside" || c.setting.category === "over") && Boolean(c.setting.bar);
  // The face, and whether at the text's size or a figure's, whatever
  // size a figure is scaled to (Fig. 7's labels set at 6.5pt, Fig. 26's
  // at 9pt). A text italic and a math italic are one face to the reader
  // (Work among ⊕𝑅 and ∃𝑅).
  const italics = (faces: string) => [...new Set(faces.split("+").map((f) => (ITALIC.test(f) ? "italic" : f)))].sort().join("+");
  const style = (c: Candidate) => `${italics(c.convention.split("|")[3])}|${Math.abs(c.line.size - type.bodySize) <= 0.25 ? "text" : "figure"}`;
  const styles = new Map<string, number>();
  for (const c of candidates) if (!weak(c) && atBar(c)) styles.set(style(c), (styles.get(style(c)) ?? 0) + 1);
  const ruled = [...styles.values()].reduce((a, b) => a + b, 0) >= 8;
  const camelled = new Map<string, number>();
  for (const c of candidates) if (weak(c) && atBar(c) && camel(c.token.text)) camelled.set(c.convention, (camelled.get(c.convention) ?? 0) + 1);
  // A short name with a sign in it beside a bar of its own stands there
  // too, whatever its face (⊗, 1 and ! among h-cut and h-mix), where it
  // is one of a figure's labels, two more beside bars on its page on its
  // side; one of signs alone, a letter nowhere in it, where the paper
  // names two rules so or more (∀ and ∃×; ⊗, ⅋ and !). Alone, a sign
  // beside a stroke is a diagram's ("⊥" at an edge's end) or a goal's
  // mark ("?" over an open premise).
  const beside = (c: Candidate) => c.setting.category === "beside" && Boolean(c.setting.bar);
  const bare = (c: Candidate) => !/[\p{L}\d]/u.test(notation(c.line, c.token));
  const family = new Set(candidates.filter((c) => beside(c) && signed(c.shape, c.line, c.token) && bare(c)).map((c) => notation(c.line, c.token)));
  const figured = (c: Candidate) => candidates.filter((o) => o !== c && o.page === c.page && beside(o) && o.setting.side === c.setting.side).length >= 2;
  const established = (c: Candidate) => atBar(c) && ((ruled && (styles.get(style(c)) ?? 0) >= 2) || (camel(c.token.text) && (camelled.get(c.convention) ?? 0) >= 5)
    || (ruled && signed(c.shape, c.line, c.token) && beside(c) && figured(c) && (!bare(c) || family.size >= 2)));
  {
    const byConvention = new Map<string, Candidate[]>();
    for (const c of candidates) if (weak(c) && !confirmed.has(c.convention)) byConvention.set(c.convention, [...(byConvention.get(c.convention) ?? []), c]);
    for (const [convention, members] of byConvention) {
      if ((strong.get(convention) ?? 0) >= 2) { confirmed.add(convention); continue; }
      // Words set alike over their rules, two of them over premises over
      // a bar and the rest over a triple or relation each, are a figure's
      // labels (Snapshottable Stores' CREATE, REF, GET, CAPTURE, SET,
      // RESTORE); a table's headers stand right over its rule. Such a
      // label heads its rule, flush with its bar's left end ("Get" over
      // "𝑟 ∈ dom(𝜎)"); a word centred over a table's rule ("Inner" over
      // "𝐴 ⋈ 𝐵") or over a row of rules ("Union") titles them.
      const premised = (c: Candidate) => c.setting.category === "over" && Boolean(c.setting.bar) && Math.abs(c.line.x0 - c.setting.bar!.x) <= 0.5 * c.line.size
        && c.page.lines.some((l) => l !== c.line && l.top >= c.line.bottom - 1 && l.bottom <= c.setting.bar!.y + 1 && l.x0 < c.setting.bar!.x + c.setting.bar!.w && l.x1 > c.setting.bar!.x);
      if (members.length >= 3 && members.filter(premised).length >= 2) { confirmed.add(convention); continue; }
      const names = members.map((c) => ({ name: c.token.text, shape: c.shape, bracketed: c.token.bracketed, set: c.line }));
      const face = faceOf(members[0].line, members[0].token);
      if (flows.some((flow) => [...mentionsIn(flow.text, names, flow.at)].some((m) => { const at = flow.at[m.nameStart]; return at && !labels.has(at.line) && inText(at, m.nameEnd - m.nameStart, face, type); }))) confirmed.add(convention);
    }
  }
  // A weak name in brackets is one of the labels on its page set as it
  // is, by their brackets, at its size and on its side, where two of them
  // stand ("(Prim𝑔)" and "(𝛽𝜆)" among "(𝛽 Box)" and "(𝛽 Ret)", "(μ)" among
  // "(jump)" and "(lookup)"); those it joins count in turn.
  const columned = new Set<Candidate>();
  const sure = (c: Candidate) => !weak(c) || confirmed.has(c.convention) || established(c) || columned.has(c);
  for (let grew = true; grew;) {
    grew = false;
    for (const c of candidates) {
      if (!weak(c) || !c.token.bracketed || sure(c)) continue;
      const alike = candidates.filter((o) => o !== c && o.page === c.page && o.token.bracketed && o.setting.category === c.setting.category && o.setting.side === c.setting.side
        && Math.abs(o.line.size - c.line.size) <= 0.5 && bracketFace(o.line, o.token) === bracketFace(c.line, c.token));
      // Beside bars of their own, one sure among them will do ("(1)", "(𝜔)"
      // and "(𝜌)", three axioms in a row).
      const bars = c.setting.category === "beside" && Boolean(c.setting.bar) && alike.every((o) => o.setting.bar);
      if (alike.filter(sure).length >= 2 || (bars && alike.length >= 2 && alike.some(sure))) { columned.add(c); grew = true; }
    }
  }
  const rules = new Map<string, Rule>();
  // A label at a step of a derivation cites its rule, never defines it
  // (rule.derivation); a step's label read after the rule's own setting
  // lets a stacked rule keep its place.
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
    // A rule defined just over the bar, its conclusion standing as this
    // bar's premise, is a figure's rule stacked on another, no step
    // (S-Elem over the axiom S-ElemPartial).
    const bar = c.setting.bar;
    const stacked = bar && placed.some((p) => p.page === c.page && p.bar && p.bar !== bar && p.bar.y < bar.y - 2 && p.bar.y >= bar.y - 2.2 * type.leading
      && p.bar.x >= bar.x - type.bodySize && p.bar.x + p.bar.w <= bar.x + bar.w + type.bodySize && p.bar.w < bar.w);
    if (c.setting.derived && !stacked) {
      labels.delete(c.line); trace.add(RULE_DERIVATION.id, c.page.number, c.token.text, at(c.page, c.line, boxAt(c.page, c.line, c.setting))); continue;
    }
    const set: { lines: Line[] } = { lines: [] };
    const box = boxAt(c.page, c.line, c.setting, set);
    const boxes = at(c.page, c.line, box);
    if (weak(c) && !established(c) && !columned.has(c) && (((conventions.get(c.convention) ?? 0) < 2 && (strong.get(c.convention) ?? 0) < 2) || !confirmed.has(c.convention))
      && !citedAnywhere(flows, { name: c.token.text, shape: c.shape, bracketed: c.token.bracketed, set: c.line }, labels, faceOf(c.line, c.token), type)) {
      trace.add(RULE_CONVENTION.id, c.page.number, `${c.token.text} alone`, boxes);
      continue;
    }
    rules.set(again, {
      key: `r${rules.size}`, kind: "rule", label: c.token.text, caption: c.line, page: c.page.number, ...box,
      name: c.token.text, shape: c.shape, bracketed: c.token.bracketed, category: c.setting.category, labels: [c.line, ...(parents.has(c.line) ? [parents.get(c.line)!] : [])],
    });
    if (c.setting.category === "over" && c.setting.bar && !labelled.has(c.setting.bar)) labelled.set(c.setting.bar, c.line.top);
    trace.add(c.rule, c.page.number, c.token.text, boxes);
    if (weak(c)) trace.add(RULE_CONVENTION.id, c.page.number, c.token.text, boxes);
    placed.push({ rule: rules.get(again)!, page: c.page, label: c.line, bar: c.setting.bar, lines: set.lines, setting: c.setting });
  }
  // Each box again, kept only from the labels and bars of the rules found:
  // a token weighed and dropped (the Γ heading a conclusion) is no label.
  // A bracketed label at the margin is its row's, its name standing or
  // not: the row is no part of the next ("(GetPerms)" over GetTicket's
  // rows, uncited).
  const margins = seen.filter((s) => s.setting.category === "margin" && s.token.bracketed);
  for (const p of placed) {
    const rest = placed.filter((o) => o.page === p.page && o !== p);
    const set: { lines: Line[] } = { lines: [] };
    const fences = margins.filter((s) => s.page === p.page && s.line !== p.label).map((s) => s.line);
    Object.assign(p.rule, boxOf(p.page, p.label, p.setting, type, { lines: new Set([...rest.map((o) => o.label), ...fences]), bars: rest.flatMap((o) => (o.bar ? [o.bar] : [])) }, set));
    p.lines = set.lines;
  }
  separate(placed, type);
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
function separate(placed: Placed[], type: Type): void {
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
      // A big brace's piece reaches the layout raised off its row, its
      // depth under the baseline lost, into the row over it: it is the
      // bar-less row's whose baseline is the first at or under its own, a
      // label on its row giving the baseline (RegRoot's precondition braces
      // reaching up to AllocCustom's row).
      const onOwn = (p: Placed) => !p.bar && p.setting.side !== "over";
      const rows = STRETCHED.test(l.text) ? ps.filter((p) => onOwn(p) && p.label.baseline >= l.baseline - 1) : [];
      const braced = rows.length && ps.every(onOwn) ? rows.reduce((a, b) => (b.label.baseline < a.label.baseline ? b : a)) : undefined;
      // A line hard over a bar or hard under it, within its span, is that
      // rule's premise or conclusion, whatever bar-less label stands level
      // with it further along (T-NEW's premise "Γ, z : C, … ⊢ Tᵢ ≤ R, …"
      // level with T-CTXEMP across the figure); so is one between a label
      // over its premises and the bar (the tall brackets round T-NEW's
      // "class(C)").
      const barred = ps.find((p) => p.bar && l.x0 >= p.bar.x - p.label.size && l.x1 <= p.bar.x + p.bar.w + p.label.size
        && ((l.bottom <= p.bar.y + 1 && l.bottom >= p.bar.y - 0.8 * type.leading) || (l.top >= p.bar.y - 1 && l.top <= p.bar.y + 0.8 * type.leading)
          || (p.setting.side === "over" && l.top >= p.label.bottom - 1 && l.bottom <= p.bar.y + 1)));
      const own = ps.find((p) => p.label === l) ?? (barred && ps.every((p) => p === barred || !p.bar) ? barred : undefined) ?? ps.find((p) => !p.bar && onRow(l, p.label)) ?? braced ?? ps.find(heads) ?? ps.reduce((a, b) => (distance(l, b) < distance(l, a) ? b : a));
      for (const p of ps) if (p !== own) p.lines = p.lines.filter((x) => x !== l);
    }
    // Each box round its own lines and bar, and what it holds (unpadded).
    const held = here.map((p) => {
      const xs = [...p.lines.flatMap((l) => [leftOf(l, p.bar, p.label), l.x1]), ...(p.bar ? [p.bar.x, p.bar.x + p.bar.w] : [])];
      const ys = [...p.lines.flatMap((l) => [l.top, l.bottom]), ...(p.bar ? [p.bar.y] : [])];
      return { p, x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
    });
    const box = held.map((h) => padded(page, h.x0, h.x1, h.y0, h.y1));
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
  for (const m of mentionsIn(flow.text, all.map((r) => ({ ...r, set: r.labels[0] })), flow.at)) {
    const at = flow.at[m.nameStart];
    if (!at || labels.has(at.line)) continue;
    // A name defined more than once names the last definition before it,
    // or the first where it comes before them all.
    const named = all.filter((r) => keyOf(fold(r.name)) === keyOf(fold(all[m.rule].name))).sort((a, b) => place(a.caption.page, a.caption.top) - place(b.caption.page, b.caption.top));
    const here = place(at.line.page, at.line.top);
    const rule = named.filter((r) => place(r.caption.page, r.caption.top) <= here).pop() ?? named[0];
    // A word only from running text, a line mostly in the text's face:
    // "[Response]" in a listing is a list type, not the law.
    if ((rule.shape === "word" || rule.shape === "title" || rule.shape === "spaced" || rule.shape === "symbol" || rule.shape === "short") && !inText(at, m.nameEnd - m.nameStart, faceOf(rule.labels[0]), type)) continue;
    if (citedAway(flow.text, m.index, m.index + m.length)) continue;
    const from = m.bracketed ? m.index : m.nameStart;
    const to = m.bracketed ? m.index + m.length : m.nameEnd;
    const boxes = boxesOf(flow, from, to, size);
    for (const box of boxes) links.push({ float: rule.key, label: flow.text.slice(from, to), ...box });
    trace.add(RULE_MENTION.id, boxes[0]?.page ?? 0, m.printed, boxes);
  }
  return links;
}
