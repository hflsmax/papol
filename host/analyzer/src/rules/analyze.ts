// A PDF read by rules (paper.ts), for the host's service: its bytes read
// with unpdf (pdf.ts). See registry.ts for how the rules are kept.

import { analyzeLayout, type RulesResult } from "./paper";
import { layout as layOut } from "./layout";
import { readPdf } from "./pdf";

export type { RulesResult };

export async function analyzeWithRules(bytes: Uint8Array): Promise<RulesResult> {
  return analyzeLayout(layOut(await readPdf(bytes)));
}
