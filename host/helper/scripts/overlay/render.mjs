// Screenshots of what the analyzer found, drawn over each paper's pages
// (overlay.html), for looking at rather than counting.
//
//   node scripts/overlay/render.mjs <pdf dir> <json dir> <out dir> [sha prefix…]
//
// Two sheets a paper: the body pages with the most citations and links,
// and the bibliography's first and last pages. CHROME names the browser.
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const [pdfDir, jsonDir, outDir, ...only] = process.argv.slice(2);
const pdfjsDir = path.resolve(here, "../../../../viewer/node_modules/pdfjs-dist/build");
fs.mkdirSync(outDir, { recursive: true });

const types = { ".html": "text/html", ".mjs": "text/javascript", ".json": "application/json", ".pdf": "application/pdf" };
const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  let file = null;
  if (url.pathname === "/overlay.html") file = path.join(here, "overlay.html");
  else if (url.pathname.startsWith("/pdfjs/")) file = path.join(pdfjsDir, path.basename(url.pathname));
  else if (url.pathname.startsWith("/pdf/")) file = path.join(pdfDir, path.basename(url.pathname));
  else if (url.pathname.startsWith("/json/")) file = path.join(jsonDir, path.basename(url.pathname));
  if (!file || !fs.existsSync(file)) { res.writeHead(404).end(); return; }
  res.writeHead(200, { "content-type": types[path.extname(file)] ?? "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;

const profile = fs.mkdtempSync(path.join(os.tmpdir(), "overlay-"));
const chrome = spawn(process.env.CHROME, ["--headless", "--no-sandbox", "--hide-scrollbars", "--remote-debugging-port=9335", `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
let targets = [];
for (let i = 0; i < 100 && !targets.some((t) => t.type === "page"); i += 1) {
  try { targets = await (await fetch("http://127.0.0.1:9335/json")).json(); } catch { /* not up yet */ }
  await new Promise((r) => setTimeout(r, 150));
}
const ws = new WebSocket(targets.find((t) => t.type === "page").webSocketDebuggerUrl);
await new Promise((r) => { ws.onopen = r; });
let id = 0;
const pending = new Map();
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (d.method === "Runtime.exceptionThrown") console.error("page error:", d.params.exceptionDetails?.exception?.description ?? d.params.exceptionDetails?.text);
  if (pending.has(d.id)) { pending.get(d.id)(d.result ?? d.error); pending.delete(d.id); }
};
const send = (method, params = {}) => new Promise((r) => { id += 1; pending.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
await send("Page.enable");
await send("Runtime.enable");
ws.addEventListener("message", (m) => {
  const d = JSON.parse(m.data);
  if (process.env.DEBUG && (d.method === "Runtime.exceptionThrown" || d.method === "Runtime.consoleAPICalled")) console.log(JSON.stringify(d.params).slice(0, 400));
});

async function shoot(sha, pages, name, cols = 2, scale = 1.25) {
  await send("Page.navigate", { url: `http://127.0.0.1:${port}/overlay.html?sha=${sha}&pages=${pages.join(",")}&cols=${cols}&scale=${scale}` });
  for (let i = 0; i < 200; i += 1) {
    const { result } = await send("Runtime.evaluate", { expression: "document.body && document.body.dataset.done", returnByValue: true });
    if (result?.value === "1") break;
    await new Promise((r) => setTimeout(r, 150));
  }
  const { result: state } = await send("Runtime.evaluate", { expression: "JSON.stringify({ done: document.body?.dataset.done, legend: document.getElementById('legend')?.textContent, errors: window.__errors })", returnByValue: true });
  if (process.env.DEBUG) console.log(state?.value);
  const { result: size } = await send("Runtime.evaluate", { expression: "JSON.stringify([document.body.scrollWidth, document.body.scrollHeight])", returnByValue: true });
  const [w, h] = JSON.parse(size.value);
  await send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: false });
  const shot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
  if (!shot?.data) throw new Error(`No screenshot of ${name}: ${JSON.stringify(shot)}`);
  fs.writeFileSync(path.join(outDir, name), Buffer.from(shot.data, "base64"));
}

const files = fs.readdirSync(jsonDir).filter((f) => f.endsWith(".json") && f !== "summary.json" && (!only.length || only.some((o) => f.startsWith(o))));
for (const file of files) {
  const result = JSON.parse(fs.readFileSync(path.join(jsonDir, file), "utf8"));
  const sha = result.sha, a = result.analysis;
  const bibPages = [...new Set(a.references.map((r) => r.page))].sort((x, y) => x - y);
  const busy = new Map();
  for (const c of a.citations) if (!bibPages.includes(c.page)) busy.set(c.page, (busy.get(c.page) ?? 0) + 1);
  for (const l of a.links) busy.set(l.page, (busy.get(l.page) ?? 0) + 1);
  const body = [...busy].sort((x, y) => y[1] - x[1]).slice(0, 4).map(([p]) => p).sort((x, y) => x - y);
  if (!body.length) body.push(1, 2);
  await shoot(sha, body, `${sha.slice(0, 10)}-body.png`);
  const bib = bibPages.length > 3 ? [...bibPages.slice(0, 3), bibPages[bibPages.length - 1]] : bibPages;
  if (bib.length) await shoot(sha, bib, `${sha.slice(0, 10)}-bib.png`);
  console.log(sha.slice(0, 10), "body", body.join(","), "bib", bib.join(","));
}
ws.close();
chrome.kill("SIGKILL");
server.close();
process.exit(0);
