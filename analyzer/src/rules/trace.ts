// What the analyzer did, rule by rule: every caption, mention, entry and
// citation, with the rule that produced it and where on the page it is.
// The corpus check counts it and the overlay draws it, so a wrong answer
// on a page names the rule to look at.

import type { Box } from "./layout";

export interface TraceItem {
  rule: string;
  page: number;
  text: string;
  boxes: Box[];
}

export class Trace {
  readonly items: TraceItem[] = [];
  add(rule: string, page: number, text: string, boxes: Box[]): void {
    this.items.push({ rule, page, text, boxes });
  }
  counts(): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const item of this.items) counts[item.rule] = (counts[item.rule] ?? 0) + 1;
    return counts;
  }
}
