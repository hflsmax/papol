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
  RULE_BOX, RULE_CANDIDATE, RULE_CELL, RULE_CONVENTION, RULE_HEADING, RULE_MENTION, RULE_NAME_BESIDE, RULE_NAME_LETTERS,
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
const REACH = 2.5;
const PAD = 2;
const BAR_SHARE = 0.92; // of the text column: a wider bar needs its conclusion centred under it
const OVER_REACH = 6; // leadings a label over its premises may stand from the bar
const LABEL_SIZE = 1.2;

const keyOf = (name: string) => name.toLowerCase().replace(/[‐‑–]/g, "-").replace(/\s+/g, " ");

// ------------------------------------------------------------ pass 1: candidates

interface Token {
  text: string; // the name as printed, without brackets
  bracketed: boolean;
  side: "whole" | "head" | "tail"; // the whole line, or its head or tail set apart
  start: number; // in the line's text
  end: number;
}

const TOKEN = "(?:[A-Z]{1,2} )?[\\p{L}\\d][\\p{L}\\d'′<:=→⇒⇓∀∃⊢⊗⊕⊸~*∧∨¬|/\\-‐‑–]{0,23}";
const WHOLE = new RegExp(`^\\s*(?:(?<open>[\\[(])\\s*)?(?<token>${TOKEN})(?:\\s*(?<close>[\\])]))?\\s*$`, "u");
const HEAD = new RegExp(`^\\s*(?:(?<open>[\\[(])\\s*)?(?<token>${TOKEN})(?:\\s*(?<close>[\\])]))?(?=\\s)`, "u");
const TAIL = new RegExp(`(?<=\\s)(?:(?<open>[\\[(])\\s*)?(?<token>${TOKEN})(?:\\s*(?<close>[\\])]))?\\s*$`, "u");

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
function tokenOf(line: Line): Token | null {
  const text = line.text;
  const found = (match: RegExpExecArray | null, side: Token["side"]): Token | null => {
    if (!match?.groups) return null;
    const { open, close, token } = match.groups;
    if (Boolean(open) !== Boolean(close)) return null;
    if (open && close && "[(".indexOf(open) !== "])".indexOf(close)) return null;
    if (!/\p{L}/u.test(token) || /^\d+$/.test(token) || /^[A-Z][A-Za-z]*\d{2,4}[a-z]?$/.test(token)) return null;
    const start = match.index + match[0].indexOf(token);
    return { text: token, bracketed: Boolean(open), side, start, end: start + token.length };
  };
  const whole = found(WHOLE.exec(text), "whole");
  if (whole) return whole;
  const headMatch = HEAD.exec(text);
  const head = found(headMatch, "head");
  if (head && headMatch && blankAfter(line, headMatch.index + headMatch[0].trimEnd().length) >= APART * line.size) return head;
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
const GRAMMAR = /⩴|::=|∷=/u;
function production(line: Line, page: Page, type: Type): boolean {
  if (GRAMMAR.test(line.text)) return true;
  if (!/^\s*\|/.test(line.text)) return false;
  return page.lines.some((l) => GRAMMAR.test(l.text) && Math.abs(l.x0 - line.x0) <= 4 * line.size && l.top < line.top && l.top >= line.top - 4 * type.leading);
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

// A horizontal line with a vertical one standing at either end: the edge
// of a box drawn round a judgement form, not a rule's bar.
function framed(page: Page, d: Drawn): boolean {
  return page.drawn.some((v) => upright(v) && v.h >= 3 && v.y <= d.y + 1 && v.y + v.h >= d.y - 1
    && (Math.abs(v.x - d.x) <= 1 || Math.abs(v.x - d.x - d.w) <= 1));
}

// A vertical rule drawn beside the label, on its row: a table's.
function ruledAside(page: Page, label: Line): boolean {
  const mid = (label.top + label.bottom) / 2;
  return page.drawn.some((d) => upright(d) && d.h >= label.size && d.y <= mid && d.y + d.h >= mid
    && d.x >= label.x0 - 3 * label.size && d.x <= label.x1 + 3 * label.size);
}

// How a token stands to notation: beside a bar, over it, at the end of a
// row, at the margin (rule.setting); or as a cell, a group heading or a
// comment (rule.cell, rule.heading).
function settingOf(page: Page, label: Line, token: Token, type: Type): Setting {
  const lines = ruleLines(page, label);
  const slack = BESIDE * label.size;
  const mid = (label.top + label.bottom) / 2;
  const centre = (label.x0 + label.x1) / 2;
  const column = columnSpan(page, label) ?? (type.columns.find((c) => c.x0 <= centre && centre <= c.x1) ?? type.text);
  const measure = Array.isArray(column) ? column[1] - column[0] : column.x1 - column.x0;
  const wide = BAR_SHARE * measure;
  const widest = measure + 3 * label.size;
  // A bar as wide as the text could be a figure's own rule: it is a rule's
  // only with a conclusion centred under it and clearly shorter.
  const concluded = (d: Drawn) => lines.some((l) => l.top >= d.y - 1 && l.top <= d.y + 2 * type.leading && l.x0 < d.x + d.w && l.x1 > d.x
    && Math.abs((l.x0 + l.x1) / 2 - (d.x + d.w / 2)) <= 2 * label.size && l.x1 - l.x0 <= 0.8 * d.w);
  // ... or with the label standing beside it, level with it.
  const besides = (d: Drawn) => Math.abs(d.y - mid) <= LEVEL * label.size && (d.x >= label.x1 - slack || d.x + d.w <= label.x0 + slack);
  // What counts as a rule's bar (rule.bar).
  const near = page.drawn.filter((d) => across(d) && d.w >= 2 * label.size && d.w <= widest && (d.w <= wide || concluded(d) || besides(d))
    && d.y >= label.top - OVER_REACH * type.leading && d.y <= label.bottom + OVER_REACH * type.leading
    && d.x <= label.x1 + 2 * slack && d.x + d.w >= label.x0 - 2 * slack && !framed(page, d));
  const bars = near.filter((d) => d.y >= label.top - NEAR_BAR * type.leading && d.y <= label.bottom + NEAR_BAR * type.leading)
    .sort((a, b) => Math.abs(a.y - mid) - Math.abs(b.y - mid));
  // The nearest bar under the label, for a label standing over its premises.
  const aside = (d: Drawn) => Math.abs(d.x + d.w / 2 - (label.x0 + label.x1) / 2);
  const below = near.filter((d) => d.y >= label.bottom - 1).sort((a, b) => (Math.abs(a.y - b.y) > 1 ? a.y - b.y : aside(a) - aside(b)));
  let row = lines.filter((l) => onRow(l, label) && sameColumn(page, l, label));
  for (const bar of bars) {
    const spans = (l: Line) => l.x0 < bar.x + bar.w && l.x1 > bar.x;
    // A conclusion stands under a bar; an axiom's has nothing over it.
    const under = lines.some((l) => spans(l) && l.top >= bar.y - 1 && l.top <= bar.y + 2 * type.leading);
    if (!under) continue;
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
      return { category: "beside", bar, row, side: right ? "right" : "left" };
    }
  }
  // On its own line over the premises, aligned with the rule's left edge
  // or its middle: mathpar's label, as far up as the premises stack.
  for (const bar of below) {
    const spans = (l: Line) => l.x0 < bar.x + bar.w && l.x1 > bar.x;
    const under = lines.some((l) => spans(l) && l.top >= bar.y - 1 && l.top <= bar.y + 2 * type.leading);
    const aligned = Math.abs(label.x0 - bar.x) <= 2 * label.size || Math.abs((label.x0 + label.x1) / 2 - (bar.x + bar.w / 2)) <= 2 * label.size;
    // Nothing else on the label's row reaches over the bar, a bracketed
    // heading at the margin aside ("(Moving)").
    const blocks = (l: Line) => spans(l) && l.text.trim().length > 1 && !/^\s*[[(].*[\])]\s*$/.test(l.text);
    // The premises between the label and the bar stand over the bar; a
    // listing's lines run past a rule drawn under it.
    const between = lines.filter((l) => l.top >= label.bottom - tolerance(l, label) && l.bottom <= bar.y + 1 && spans(l));
    const overhangs = between.some((l) => l.x0 < bar.x - 2 * label.size || l.x1 > bar.x + bar.w + 2 * label.size);
    if (under && token.side === "whole" && aligned && !overhangs && !row.some(blocks)) return { category: "over", bar, row, side: "over" };
  }
  // A label set level with a stack of lines touches each without sharing
  // half its height with any: the stack is its row.
  if (!row.length) row = lines.filter((l) => level(l, label) && sameColumn(page, l, label));
  const rest = token.side === "whole" ? row.map((l) => l.text).join(" ") : label.text.slice(0, token.start) + " " + label.text.slice(token.end);
  const body = /\p{L}|[^\p{L}\d\s\[\]()]/u.test(rest.replace(/[\[\]()]/g, "")) && rest.replace(/\s/g, "").length >= 3;
  if (token.side !== "whole") return body ? { category: "row", bar: null, row, side: token.side === "head" ? "left" : "right" } : { category: "none", bar: null, row, side: "right" };
  if (!row.length || !body) return { category: "none", bar: null, row, side: "right" };
  if (row.some((l) => production(l, page, type))) return { category: "comment", bar: null, row, side: "right" };
  if (ruledAside(page, label)) return { category: "cell", bar: null, row, side: "right" };
  const right = columnRight(page, label);
  const atMargin = right !== null && label.x1 >= right - label.size && row.every((l) => l.x1 < label.x0);
  if (atMargin) return { category: "margin", bar: null, row, side: "right" };
  const side = row.every((l) => l.x0 >= label.x1 - tolerance(l, label)) ? "left" : row.every((l) => l.x1 <= label.x0 + tolerance(l, label)) ? "right" : null;
  return side ? { category: "row", bar: null, row, side } : { category: "none", bar: null, row, side: "right" };
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
      return shape === "word" && !token.bracketed && !capitalised(token.text) ? null : RULE_NAME_BESIDE.id;
    case "over":
      return shape === "word" && !token.bracketed ? null : RULE_NAME_OVER.id;
    case "row":
      return shape === "symbol" || (shape === "word" && !token.bracketed) ? null : RULE_NAME_ROW.id;
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
    if (!ref || ref.run < 0 || !/[\p{L}\d]/u.test(line.text[i])) continue;
    const font = family(line.runs[ref.run].font);
    counts.set(font, (counts.get(font) ?? 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
}

interface Candidate { line: Line; page: Page; token: Token; shape: Shape; setting: Setting & { category: Category }; rule: string; convention: string }

// A weak label — a single word — stands only where the paper sets two or
// more labels the same way, or where the text cites it (rule.convention).
const weak = (c: Candidate) => c.shape === "word";

// ------------------------------------------------------------ pass 6: boxes

interface Box { x: number; y: number; w: number; h: number }

// The rule a label names, as set (rule.box). With a bar, the bar's width
// joined with the label, the lines within 0.8 of a leading of the bar,
// then every line touching those within reach. Without one, the row.
function boxOf(page: Page, label: Line, setting: Setting, type: Type): Box {
  const lines = ruleLines(page, label);
  const slack = BESIDE * label.size;
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
const RULE_WORDS = /\b(?:rules?|laws?|axioms?|steps?)\b/i;
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// A name in the text is the label's, whatever its case, only where one of
// the two is in capitals throughout: small capitals reach the text layer
// as capitals from some fonts and as the name from others, while
// "well-typed" is not the rule "Well-Typed".
const sameName = (printed: string, name: string) => printed === name || (printed.toLowerCase() === name.toLowerCase() && (capitals(printed) || capitals(name)));

// Whether a place in the text cites the rule, in the form its shape and
// setting allow (rule.mention): a hyphenated name, a symbol or a spaced
// name in capitals as it is; a bracketed word in brackets; a bare word,
// or a spaced name with a capitalised word, in its printed case within a
// few words of "rule".
function cites(rule: { name: string; shape: Shape; bracketed: boolean }, printed: string, bracketed: boolean, around: string): boolean {
  const exact = printed.replace(/\s+/g, " ") === rule.name;
  if (rule.shape === "symbol") return exact;
  if (rule.shape === "hyphen" || (rule.shape === "spaced" && capitals(rule.name))) return sameName(printed.replace(/\s+/g, " "), rule.name);
  // A word: in brackets as the label was, or as printed with "rule"
  // (or a kin) close by: "the sapp rule", "(rule slam and sbind)".
  return bracketed ? sameName(printed, rule.name) : exact && RULE_WORDS.test(around);
}

// Every place in the text that names one of the rules, longest names
// first so "T-App-Abs" is not "T-App".
function* mentionsIn(text: string, rules: { name: string; shape: Shape; bracketed: boolean }[]): Generator<{ index: number; length: number; nameStart: number; nameEnd: number; bracketed: boolean; printed: string; rule: number }> {
  if (!rules.length) return;
  const order = rules.map((r, i) => i).sort((a, b) => rules[b].name.length - rules[a].name.length);
  const names = order.map((i) => escape(rules[i].name).replace(/-/g, "[-‐‑–]").replace(/ /g, "\\s+")).join("|");
  const re = new RegExp(`(?<![\\p{L}\\d])(?<open>[\\[(])?(?<name>${names})(?<close>[\\])])?(?![\\p{L}\\d])`, "giu");
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    const groups = match.groups!;
    const bracketed = Boolean(groups.open && groups.close);
    const around = text.slice(Math.max(0, match.index - NEAR), match.index + match[0].length + NEAR);
    const rule = order.find((i) => cites(rules[i], groups.name, bracketed, around));
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
  for (const page of layout.pages) {
    for (const line of page.lines) {
      if (line.furniture || skip.has(line) || line.size > LABEL_SIZE * layout.bodySize) continue;
      const token = tokenOf(line);
      if (!token) continue;
      const setting = settingOf(page, line, token, type);
      const box = boxOf(page, line, setting, type);
      trace.add(RULE_CANDIDATE.id, page.number, token.text, at(page, line, box));
      if (setting.category === "none") continue;
      if (setting.category === "cell" || setting.category === "group") { trace.add(RULE_CELL.id, page.number, token.text, at(page, line, box)); continue; }
      if (setting.category === "comment") { trace.add(RULE_HEADING.id, page.number, token.text, at(page, line, box)); continue; }
      if (setting.bar) trace.add(RULE_BAR.id, page.number, token.text, [{ page: page.number, x: setting.bar.x, y: setting.bar.y, w: setting.bar.w, h: Math.max(setting.bar.h, 1) }]);
      trace.add(RULE_SETTING.id, page.number, `${token.text} ${setting.category}`, at(page, line, box));
      const shape = shapeOf(token.text);
      if (!shape) continue;
      if (shape === "hyphen" && !/[-‐‑–][^-‐‑–]*\p{L}/u.test(token.text)) { trace.add(RULE_NAME_LETTERS.id, page.number, token.text, at(page, line, box)); continue; }
      const rule = allowed(shape, token, setting.category);
      if (!rule) {
        if (setting.category === "margin") trace.add(RULE_HEADING.id, page.number, token.text, at(page, line, box));
        continue;
      }
      const convention = `${setting.category}|${setting.side}|${token.bracketed ? "[]" : ""}|${faceOf(line, token)}|${Math.round(line.size * 2) / 2}`;
      candidates.push({ line, page, token, shape, setting: setting as Candidate["setting"], rule, convention });
    }
  }
  // Conventions: how many labels the paper sets each way.
  const conventions = new Map<string, number>();
  for (const c of candidates) conventions.set(c.convention, (conventions.get(c.convention) ?? 0) + 1);
  const labels = new Set(candidates.map((c) => c.line));
  const rules = new Map<string, Rule>();
  for (const c of candidates) {
    const key = keyOf(c.token.text);
    const known = rules.get(key);
    if (known) { known.labels.push(c.line); continue; }
    const box = boxOf(c.page, c.line, c.setting, type);
    const boxes = at(c.page, c.line, box);
    if (weak(c) && (conventions.get(c.convention) ?? 0) < 2
      && !citedAnywhere(flows, { name: c.token.text, shape: c.shape, bracketed: c.token.bracketed }, labels, faceOf(c.line, c.token), type)) {
      trace.add(RULE_CONVENTION.id, c.page.number, `${c.token.text} alone`, boxes);
      continue;
    }
    rules.set(key, {
      key: `r${rules.size}`, kind: "rule", label: c.token.text, caption: c.line, page: c.page.number, ...box,
      name: c.token.text, shape: c.shape, bracketed: c.token.bracketed, category: c.setting.category, labels: [c.line],
    });
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
