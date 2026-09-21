// GROBID, next door: the container on this host, reached without a
// credential on the loopback interface. Both calls hand it a PDF as one
// multipart field and take its TEI back as text.

// GROBID reads the whole document with a CRF cascade; ten to sixty
// seconds for a long paper is normal.
const TIMEOUT_MS = 300_000;

export interface Grobid {
  // processFulltextDocument: the body, the bibliography, the markers.
  fulltext(pdf: Uint8Array): Promise<string>;
  // processHeaderDocument: the title block, consolidated against CrossRef
  // by GROBID itself.
  header(pdf: Uint8Array): Promise<string>;
}

export class GrobidError extends Error {}

async function post(base: string, path: string, pdf: Uint8Array, fields: [string, string][]): Promise<string> {
  const form = new FormData();
  form.set("input", new Blob([pdf as unknown as ArrayBuffer], { type: "application/pdf" }), "paper.pdf");
  for (const [name, value] of fields) form.append(name, value);
  let response: Response;
  try {
    response = await fetch(`${base.replace(/\/+$/, "")}${path}`, { method: "POST", body: form, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (error) {
    throw new GrobidError(`GROBID unreachable: ${(error as Error).message}`);
  }
  if (response.status === 204) throw new GrobidError("GROBID could not read this PDF (no text extracted)");
  if (response.status !== 200) throw new GrobidError(`GROBID returned ${response.status}`);
  return response.text();
}

export function grobidAt(base: string): Grobid {
  return {
    fulltext: (pdf) => post(base, "/api/processFulltextDocument", pdf, [
      // Repeated once per element boxes are wanted for; without it GROBID
      // returns the structure but not the geometry.
      ["teiCoordinates", "ref"], ["teiCoordinates", "biblStruct"], ["teiCoordinates", "figure"],
      ["includeRawCitations", "1"],
      // Consolidating the citations would have GROBID call CrossRef once
      // per reference inside this request. Papol looks up later and lazily.
      ["consolidateCitations", "0"], ["consolidateHeader", "0"],
    ]),
    // Consolidated: GROBID asks CrossRef for the paper itself, which is
    // how a paper that prints no identifier gets its DOI.
    header: (pdf) => post(base, "/api/processHeaderDocument", pdf, [["consolidateHeader", "1"]]),
  };
}
