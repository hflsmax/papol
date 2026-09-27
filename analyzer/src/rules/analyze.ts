// A PDF file read by rules (paper.ts, header.ts), for the scripts and tests
// that measure them: its bytes read with unpdf (pdf.ts). See registry.ts for how the rules are kept.

import { analyzeLayout, type RulesResult } from "./paper";
import { headerOf, HEADER_PAGES, type HeaderResult } from "./header";
import { layout as layOut } from "./layout";
import { readPdf } from "./pdf";

export type { RulesResult };

export async function analyzeWithRules(bytes: Uint8Array): Promise<RulesResult> {
  return analyzeLayout(layOut(await readPdf(bytes)));
}

export async function headerWithRules(bytes: Uint8Array): Promise<HeaderResult> {
  return headerOf(await readPdf(bytes, { pages: HEADER_PAGES }));
}
