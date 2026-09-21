// Papol's helper on the GROBID host: an HTTP service on the loopback
// interface, behind the same nginx front door and credential as GROBID
// (module.nix, `grobid.expose`, `location /helper/`). The Worker posts
// a PDF's bytes and gets JSON back; the CPU that reading takes is spent
// here, where there is plenty, and not in a Worker invocation on
// Cloudflare's Free plan, which has about ten milliseconds of it.
//
//   POST /analyze   application/pdf → { references, citations, links }
//   POST /header    application/pdf → { title, authors, journal, year, doi, arxiv_id }
//   GET  /health                    → { ok: true }
//
// A body that is not a PDF is 400; GROBID failing, or saying nothing, is
// 502; either carries `{ detail }`. One line per request on stdout.

import fs from "node:fs";
import http from "node:http";
import { fileURLToPath } from "node:url";

import { grobidAt, type Grobid } from "./grobid";
import { analyze, header, Refusal } from "./service";

export { grobidAt };
export const MAX_BODY = 100 * 1024 * 1024;
const DEFAULT_PORT = 8072;
const GROBID = "http://127.0.0.1:8070";

function readBody(request: http.IncomingMessage): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        request.destroy();
        reject(new Refusal(413, `The body is over ${MAX_BODY} bytes`));
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolve(new Uint8Array(Buffer.concat(chunks))));
    request.on("error", reject);
  });
}

async function answer(grobid: Grobid, request: http.IncomingMessage): Promise<[number, unknown]> {
  const path = (request.url ?? "/").split("?")[0];
  if (request.method === "GET" && path === "/health") return [200, { ok: true }];
  if (path !== "/analyze" && path !== "/header") throw new Refusal(404, "No such endpoint");
  if (request.method !== "POST") throw new Refusal(405, "POST a PDF here");
  const bytes = await readBody(request);
  return [200, path === "/analyze" ? await analyze(grobid, bytes) : await header(grobid, bytes)];
}

export function createServer(grobid: Grobid, log: (line: string) => void = console.log): http.Server {
  return http.createServer(async (request, response) => {
    const started = Date.now();
    let status: number, body: unknown, detail = "";
    try {
      [status, body] = await answer(grobid, request);
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
// port of its own with GROBID stood in for.
const runAsProgram = process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
if (runAsProgram) {
  const port = Number(process.env.PAPOL_HELPER_PORT || DEFAULT_PORT);
  const server = createServer(grobidAt(process.env.PAPOL_GROBID_URL || GROBID));
  // GROBID may take minutes on a long paper; the response waits for it.
  server.requestTimeout = 300_000;
  server.listen(port, "127.0.0.1", () => console.log(`papol-helper listening on 127.0.0.1:${port}`));
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => server.close(() => process.exit(0)));
}
