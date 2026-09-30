// What a float or a statement is about, in a few words, for the viewer to
// name it by beside its number: a caption's first sentence ("Figure 3: An
// example of the attention mechanism…"), a theorem's name in brackets, or
// the words it opens with.

const LONGEST = 90;

// Lines read as one text: a word broken at a line's end is joined again.
export function joined(texts: string[]): string {
  return texts.map((t) => t.trim()).filter(Boolean).reduce((all, t) => (
    !all ? t : /\p{Ll}-$/u.test(all) && /^\p{Ll}/u.test(t) ? all.slice(0, -1) + t : `${all} ${t}`
  ), "");
}

// Its first sentence, and no longer than a line of the bar's tooltip can
// hold: cut at a word, with an ellipsis where it was cut.
export function briefly(text: string): string | undefined {
  let t = text.replace(/\s+/g, " ").trim();
  const end = t.search(/[.;](?=\s+\p{Lu}|\s*$)/u);
  if (end > 0) t = t.slice(0, end);
  if (t.length > LONGEST) t = `${t.slice(0, t.lastIndexOf(" ", LONGEST - 1) > 40 ? t.lastIndexOf(" ", LONGEST - 1) : LONGEST - 1)}…`;
  return /\p{L}{2}/u.test(t) ? t : undefined;
}

// A caption's words after its number: "Fig. 1. Multipaths for Example
// 1.1" is about "Multipaths for Example 1.1".
export function captionTitle(lines: string[], number: string): string | undefined {
  const text = joined(lines);
  const at = text.indexOf(number);
  if (at < 0) return undefined;
  return briefly(text.slice(at + number.length).replace(/^[\s.:|—–-]+/, ""));
}
