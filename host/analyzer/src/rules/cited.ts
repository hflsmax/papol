// A mention that points into another work, not into this one: "Section
// 2.3" in "[Annenkov et al. 2019, Section 2.3]", "Fig. 1" in "[16, Fig. 1]",
// "Figure 2" in "Figure 2 of Connelly et al. 2003". The words and the
// number are this paper's own mention's; where they sit says they are
// the cited paper's (mention.cited-locator, mention.cited-of).

const YEAR = /(?:1[89]|20)\d\d[a-z]?/;

// Inside a citation's bracket, after the citation and a comma: a locator.
export function citedLocator(text: string, start: number): boolean {
  let depth = 0;
  for (let i = start - 1; i >= 0 && i >= start - 150; i -= 1) {
    const c = text[i];
    if (c === "]" || c === ")") depth += 1;
    else if (c === "[" || c === "(") {
      if (depth > 0) { depth -= 1; continue; }
      const inside = text.slice(i + 1, start);
      const tail = inside.slice(inside.lastIndexOf(";") + 1);
      const numeric = c === "[" && /^\s*\d{1,3}(?:\s*[-–,]\s*\d{1,3})*\s*,\s*(?:see\s+|cf\.\s+)?$/.test(tail);
      const authorYear = new RegExp(`(?:\\b${YEAR.source}|et al\\.?)\\s*,\\s*(?:see\\s+|cf\\.\\s+)?$`).test(tail);
      return numeric || authorYear;
    }
  }
  return false;
}

// Followed by "of" or "in" and a citation, or the supplementary material.
const OF = new RegExp(`^\\s*(?:of|in)\\s+(?:\\[|\\((?=[^)]*\\b${YEAR.source})|[A-Z][\\p{L}’'-]+(?:\\s+et al\\.?|\\s+and\\s+[A-Z][\\p{L}’'-]+)?\\s*,?\\s*\\(?${YEAR.source}|the\\s+(?:Supplementary|Supporting|extended version)|SI\\b|ref\\.)`, "u");
export function citedOf(text: string, end: number): boolean {
  return OF.test(text.slice(end, end + 80));
}

export const citedAway = (text: string, start: number, end: number) => citedLocator(text, start) || citedOf(text, end);
