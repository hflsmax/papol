// Named inference rules: where each one is defined, and the places in the
// text that name it. A programming-language paper sets its typing and
// reduction rules in a figure, each labelled with a name ("T-App",
// "[LT-IF]", "(BIND)"), and cites the names throughout its prose. A rule
// is kept as a float of kind `rule` whose box is the rule as set — its
// premises, bar and conclusion around the label — so a link to it is
// stored and followed like a link to a figure, and a clip of it shows the
// rule whole (cloudflare/src/papers/reading.ts).

import type { DocumentLink } from "../../../cloudflare/src/papers/reading";
import { citedAway } from "./cited";
import { typeOf, type Found, type Type } from "./floats";
import { boxesOf, type Flow, type Layout, type Line } from "./layout";
import { RULE_BOX, RULE_LABEL, RULE_LABEL_APART, RULE_MENTION, RULE_NAME, RULE_WORD } from "./registry";
import type { Trace } from "./trace";

export interface Rule extends Found {
  name: string; // as printed at its label, without brackets
  word: boolean; // a single bracketed word, not a hyphenated name
  labels: Line[]; // every line that labels a rule by this name
}

type Page = Layout["pages"][number];

// How far a label stands from the rest of its line, in its size, to be set
// apart from it (rule.label-apart). How many lines above and below the
// label a rule reaches, in the text's leading; how far beside its bar a
// rule's lines may begin or end, in the label's size; and how much blank
// two lines of one rule may have between them, in their size (rule.box).
const APART = 1;
const REACH = 2.5;
const BESIDE = 1;
const TOUCH = 0.35;
const PAD = 2;

const keyOf = (name: string) => name.toLowerCase().replace(/[‐‑–]/g, "-");
const HEAD = new RegExp(`^\\s*(?:[\\[(]\\s*(?<name>${RULE_NAME})\\s*[\\])]|(?<bare>${RULE_NAME})|[\\[(]\\s*(?<word>${RULE_WORD})\\s*[\\])])(?=\\s)`, "u");
const TAIL = new RegExp(`(?<=\\s)(?:[\\[(]\\s*(?<name>${RULE_NAME})\\s*[\\])]|(?<bare>${RULE_NAME})|[\\[(]\\s*(?<word>${RULE_WORD})\\s*[\\])])\\s*$`, "u");

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

// The font most of a line is set in, whatever its size ("CMSS8" and
// "CMSS9" are one face).
const family = (font: string) => font.replace(/\d+$/, "");
function faceOf(line: Line): string {
  const counts = new Map<string, number>();
  for (let i = 0; i < line.text.length; i += 1) {
    const ref = line.chars[i];
    if (!ref || ref.run < 0 || /\s/.test(line.text[i])) continue;
    const font = family(line.runs[ref.run].font);
    counts.set(font, (counts.get(font) ?? 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
}

interface Label { name: string; word: boolean; start: number; end: number; rule: string }

// The label a line carries, if it is one: the whole line (rule.label), or
// its head or tail set apart from the rest (rule.label-apart).
function labelOf(line: Line): Label | null {
  const text = line.text;
  const found = (match: RegExpExecArray | null, rule: string): Label | null => {
    if (!match?.groups) return null;
    const name = match.groups.name ?? match.groups.bare ?? match.groups.word;
    const start = match.index + match[0].indexOf(name);
    return { name, word: match.groups.word !== undefined, start, end: start + name.length, rule };
  };
  const whole = found(RULE_LABEL.pattern!.exec(text), RULE_LABEL.id);
  if (whole) return whole;
  const headMatch = HEAD.exec(text);
  const head = found(headMatch, RULE_LABEL_APART.id);
  if (head && headMatch && blankAfter(line, headMatch.index + headMatch[0].trimEnd().length) >= APART * line.size) return head;
  const tailMatch = TAIL.exec(text);
  const tail = found(tailMatch, RULE_LABEL_APART.id);
  if (tail && tailMatch && blankBefore(line, tailMatch.index + tailMatch[0].length - tailMatch[0].trimStart().length) >= APART * line.size) return tail;
  return null;
}

// The rule a label names, as set (rule.box). An inference rule is drawn
// with a bar between its premises and its conclusion: the bar nearest the
// label — beside it, or under a label set over the rule — is the rule's
// width, and the lines over and under the bar that touch, within reach,
// are the rule. A law or a machine step has no bar; it is the row its
// label is level with. A blank of a third of a line ends a rule: rows of
// rules stand a line or so apart.
function boxOf(page: Page, label: Line, type: Type): { x: number; y: number; w: number; h: number } {
  // A rule's lines are set near its label's size: a page whose broken
  // font reads as 120pt does not reach into it.
  const lines = page.lines.filter((l) => !l.furniture && l !== label && l.size <= 2 * label.size);
  const tolerance = (a: { size: number }, b: { size: number }) => TOUCH * Math.min(a.size, b.size);
  const near = (a: Line, b: Line) => a.top <= b.bottom + tolerance(a, b) && b.top <= a.bottom + tolerance(a, b);
  const slack = BESIDE * label.size;
  const bars = page.drawn.filter((d) => !d.image && d.h <= 1.5 && d.w >= 2 * label.size
    && d.y >= label.top - 1.5 * type.leading && d.y <= label.bottom + 1.5 * type.leading
    && d.x <= label.x1 + slack && d.x + d.w >= label.x0 - slack);
  const bar = bars.sort((a, b) => Math.abs(a.y - (label.top + label.bottom) / 2) - Math.abs(b.y - (label.top + label.bottom) / 2))[0];
  let x0: number, x1: number;
  const taken = new Set<Line>([label]);
  if (bar) {
    x0 = Math.min(bar.x, label.x0); x1 = Math.max(bar.x + bar.w, label.x1);
    for (const l of lines) if (l.x0 <= x1 + slack && l.x1 >= x0 - slack && l.bottom >= bar.y - 0.8 * type.leading && l.top <= bar.y + 0.8 * type.leading) taken.add(l);
  } else {
    for (const l of lines) if (near(l, label)) taken.add(l);
    x0 = Math.min(...[...taken].map((l) => l.x0)); x1 = Math.max(...[...taken].map((l) => l.x1));
  }
  const within = (l: Line) => l.bottom >= label.top - REACH * type.leading && l.top <= label.bottom + REACH * type.leading;
  for (let grew = true; grew;) {
    grew = false;
    for (const line of lines) {
      if (taken.has(line) || line.x0 > x1 + slack || line.x1 < x0 - slack || !within(line)) continue;
      if ([...taken].some((t) => near(t, line))) { taken.add(line); grew = true; }
    }
  }
  const all = [...taken];
  const left = Math.max(0, Math.min(x0, ...all.map((l) => l.x0)) - PAD), right = Math.min(page.width, Math.max(x1, ...all.map((l) => l.x1)) + PAD);
  const top = Math.max(0, Math.min(...all.map((l) => l.top)) - PAD), bottom = Math.min(page.height, Math.max(...all.map((l) => l.bottom)) + PAD);
  return { x: left / page.width, y: top / page.height, w: (right - left) / page.width, h: (bottom - top) / page.height };
}

/**
 * Every named rule, by its name in lower case: its first label in reading
 * order is where it is defined. `skip` holds lines that label nothing
 * (the bibliography's).
 */
export function findRules(layout: Layout, skip: Set<Line>, trace: Trace): Map<string, Rule> {
  const rules = new Map<string, Rule>();
  const type = typeOf(layout);
  for (const page of layout.pages) {
    for (const line of page.lines) {
      if (line.furniture || skip.has(line)) continue;
      const label = labelOf(line);
      if (!label) continue;
      const key = keyOf(label.name);
      const known = rules.get(key);
      if (known) { known.labels.push(line); continue; }
      const box = { page: page.number, ...boxOf(page, line, type) };
      rules.set(key, {
        key: `r${rules.size}`, kind: "rule", label: label.name, caption: line, name: label.name, word: label.word, labels: [line], ...box,
      });
      trace.add(label.rule, page.number, label.name, [box]);
      trace.add(RULE_BOX.id, page.number, label.name, [box]);
    }
  }
  return rules;
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// A name in the text is the label's, whatever its case, only where one of
// the two is in capitals throughout: small capitals reach the text layer
// as capitals from some fonts and as the name from others, while
// "well-typed" is not the rule "Well-Typed".
const capitals = (text: string) => text === text.toUpperCase();
const sameName = (printed: string, name: string) => printed === name || (printed.toLowerCase() === name.toLowerCase() && (capitals(printed) || capitals(name)));

/** The places in a flow of text that name a rule, as links to it (rule.mention). */
export function findRuleMentions(flow: Flow, rules: Map<string, Rule>, layout: Layout, trace: Trace): DocumentLink[] {
  const links: DocumentLink[] = [];
  if (!rules.size) return links;
  const size = (page: number): [number, number] => [layout.pages[page - 1].width, layout.pages[page - 1].height];
  const labels = new Set([...rules.values()].flatMap((r) => r.labels));
  const type = typeOf(layout);
  const byName = [...rules.values()].sort((a, b) => b.name.length - a.name.length);
  const names = byName.map((r) => escape(r.name).replace(/-/g, "[-‐‑–]")).join("|");
  // Whole: a name may be bare, a word must be bracketed.
  const re = new RegExp(`(?<![\\p{L}\\d])(?<open>[\\[(])?(?<name>${names})(?<close>[\\])])?(?![\\p{L}\\d])`, "giu");
  let match: RegExpExecArray | null;
  while ((match = re.exec(flow.text))) {
    const groups = match.groups!;
    const rule = byName.find((r) => sameName(groups.name, r.name));
    if (!rule) continue;
    const nameStart = match.index + (groups.open ? 1 : 0);
    const nameEnd = nameStart + groups.name.length;
    const bracketed = Boolean(groups.open && groups.close);
    const at = flow.at[nameStart];
    if (!at || labels.has(at.line)) continue;
    // A word only in brackets, and from running text, a line mostly in the
    // text's face: "[Response]" in a listing is a list type, not the law.
    if (rule.word && (!bracketed || faceOf(at.line) !== family(type.font))) continue;
    if (citedAway(flow.text, match.index, match.index + match[0].length)) continue;
    const from = bracketed ? match.index : nameStart;
    const to = bracketed ? match.index + match[0].length : nameEnd;
    const boxes = boxesOf(flow, from, to, size);
    for (const box of boxes) links.push({ float: rule.key, label: flow.text.slice(from, to), ...box });
    trace.add(RULE_MENTION.id, boxes[0]?.page ?? 0, groups.name, boxes);
  }
  return links;
}
