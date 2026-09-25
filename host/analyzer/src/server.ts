// Papol's analyzer on the host: an HTTP service on the loopback interface,
// behind an nginx front door with one credential (module.nix,
// `location /analyzer/`). The Worker names a
// paper's public address, the analyzer fetches it from the bucket and
// answers JSON; neither the bytes nor the CPU that reading takes pass
// through a Worker invocation on Cloudflare's Free plan.
//
//   POST /analyze   application/json { url } or application/pdf → { references, citations, floats, links }
//   POST /header    application/json { url } or application/pdf → { title, authors, journal, year, doi, arxiv_id }
//   GET  /health                                                 → { ok: true }
//
// The url is a paper's address on a bucket domain this analyzer is told of
// (src/files.ts); the bytes are what a Worker with no bucket domain, in
// local development, still sends. A body that is not a PDF or an address
// is 400; a PDF the rules cannot read is 422; the bucket failing is 502;
// each carries `{ detail }`. Both are read by rules (src/rules/).
// One line per request on stdout.

import fs from "node:fs";
import http from "node:http";
import { fileURLToPath } from "node:url";

import { fetchPaper, fileOriginsFrom, paperAddress } from "./files";
import { analyze, header, Refusal } from "./service";

export { fileOriginsFrom };
export const MAX_BODY = 100 * 1024 * 1024;
// An address is a line of JSON.
const MAX_ADDRESS = 4 * 1024;
const DEFAULT_PORT = 8072;

export interface Options {
  // Bucket domains the analyzer fetches papers from.
  fileOrigins?: string[];
  fetch?: typeof fetch;
}

function readBody(request: http.IncomingMessage, maxBytes = MAX_BODY): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        request.destroy();
        reject(new Refusal(413, `The body is over ${maxBytes} bytes`));
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolve(new Uint8Array(Buffer.concat(chunks))));
    request.on("error", reject);
  });
}

// The PDF a request is about: fetched from the address it names, or the
// body itself.
async function paperOf(request: http.IncomingMessage, options: Required<Options>): Promise<Uint8Array> {
  const type = String(request.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
  if (type !== "application/json") return readBody(request);
  let sent: { url?: unknown };
  try {
    sent = JSON.parse(new TextDecoder().decode(await readBody(request, MAX_ADDRESS)));
  } catch (error) {
    if (error instanceof Refusal) throw error;
    throw new Refusal(400, "The body is not JSON");
  }
  return fetchPaper(paperAddress(sent?.url, options.fileOrigins), MAX_BODY, options.fetch);
}

async function answer(request: http.IncomingMessage, options: Required<Options>): Promise<[number, unknown]> {
  const path = (request.url ?? "/").split("?")[0];
  if (request.method === "GET" && path === "/health") return [200, { ok: true }];
  if (path !== "/analyze" && path !== "/header") throw new Refusal(404, "No such endpoint");
  if (request.method !== "POST") throw new Refusal(405, "POST a PDF here");
  const bytes = await paperOf(request, options);
  return [200, path === "/analyze" ? await analyze(bytes) : await header(bytes)];
}

export function createServer(log: (line: string) => void = console.log, options: Options = {}): http.Server {
  const settled: Required<Options> = {
    fileOrigins: options.fileOrigins ?? fileOriginsFrom(undefined),
    fetch: options.fetch ?? fetch,
  };
  return http.createServer(async (request, response) => {
    const started = Date.now();
    let status: number, body: unknown, detail = "";
    try {
      [status, body] = await answer(request, settled);
    } catch (error) {
      status = error instanceof Refusal ? error.status : 500;
      detail = error instanceof Refusal ? error.message : `Unexpected: ${(error as Error).message}`;
      body = { detail };
    }
    const json = JSON.stringify(body);
    log(`${new Date().toISOString()} ${request.method} ${request.url} ${status} ${request.headers["content-length"] ?? "-"}B ${Date.now() - started}ms${detail ? ` ${detail}` : ""}`);
    if (response.writableEnded || response.destroyed) return;
    response.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(json) });
    response.end(json);
  });
}

// Serve when run as a program; a test imports the bundle and serves on a
// port of its own.
const runAsProgram = process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
if (runAsProgram) {
  const port = Number(process.env.PAPOL_ANALYZER_PORT || DEFAULT_PORT);
  const server = createServer(console.log, {
    fileOrigins: fileOriginsFrom(process.env.PAPOL_ANALYZER_FILE_ORIGINS),
  });
  // Fetching a long paper from the bucket and reading it can take a while;
  // the response waits for it.
  server.requestTimeout = 300_000;
  server.listen(port, "127.0.0.1", () => console.log(`papol-analyzer listening on 127.0.0.1:${port}`));
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => server.close(() => process.exit(0)));
}
