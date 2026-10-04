// node --test scripts/keep-assets.test.mjs
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";

import { keepAssets, LIST } from "./keep-assets.mjs";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-10-04T19:00:00Z");

async function site(files) {
  const root = await mkdtemp(join(tmpdir(), "papol-site-"));
  for (const [path, body] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), body);
  }
  return root;
}

// A live site as the Worker answered before this change: every path it
// lacks gets its document, with a 200.
async function live(files) {
  const server = createServer((request, response) => {
    const path = request.url.slice(1);
    if (path in files) {
      response.writeHead(200, { "content-type": path.endsWith(".json") ? "application/json" : "text/javascript" });
      response.end(files[path]);
    } else {
      response.writeHead(200, { "content-type": "text/html" });
      response.end("<!doctype html><title>Papol</title>");
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { base: `http://127.0.0.1:${server.address().port}/`, close: () => server.close() };
}

test("a site with no list of earlier builds keeps nothing, and lists this build", async () => {
  const root = await site({ "index.html": "<!doctype html>", "viewer/assets/pdf_viewer-NEW.js": "new" });
  const server = await live({});
  try {
    assert.deepEqual(await keepAssets(root, server.base, NOW), { kept: 0, lost: [] });
    const list = JSON.parse(await readFile(join(root, LIST), "utf8"));
    assert.deepEqual(list, { "viewer/assets/pdf_viewer-NEW.js": new Date(NOW).toISOString() });
  } finally {
    server.close();
  }
});

test("a file of an earlier build is served again for a week after the last build that had it", async () => {
  const root = await site({
    "viewer/assets/pdf_viewer-NEW.js": "new",
    "boards/assets/board-SAME.js": "same",
  });
  const earlier = {
    "viewer/assets/pdf_viewer-OLD.js": new Date(NOW - DAY).toISOString(),
    "assets/index-WEEKOLD.js": new Date(NOW - 6 * DAY).toISOString(),
    "assets/index-STALE.js": new Date(NOW - 8 * DAY).toISOString(),
    "boards/assets/board-SAME.js": new Date(NOW - DAY).toISOString(),
    "viewer/assets/lost-GONE.js": new Date(NOW - DAY).toISOString(),
  };
  const server = await live({
    [LIST]: JSON.stringify(earlier),
    "viewer/assets/pdf_viewer-OLD.js": "old viewer",
    "assets/index-WEEKOLD.js": "older index",
    "assets/index-STALE.js": "stale index",
    "boards/assets/board-SAME.js": "same",
  });
  try {
    const { kept, lost } = await keepAssets(root, server.base, NOW);
    assert.equal(kept, 2);
    assert.deepEqual(lost, ["viewer/assets/lost-GONE.js (200)"]);
    assert.equal(await readFile(join(root, "viewer/assets/pdf_viewer-OLD.js"), "utf8"), "old viewer");
    assert.equal(await readFile(join(root, "assets/index-WEEKOLD.js"), "utf8"), "older index");
    await assert.rejects(readFile(join(root, "assets/index-STALE.js")));
    const list = JSON.parse(await readFile(join(root, LIST), "utf8"));
    assert.deepEqual(list, {
      "viewer/assets/pdf_viewer-NEW.js": new Date(NOW).toISOString(),
      "boards/assets/board-SAME.js": new Date(NOW).toISOString(),
      // The time a build last had a kept file stays its own, so it goes
      // a week after that build, not a week after this one.
      "viewer/assets/pdf_viewer-OLD.js": earlier["viewer/assets/pdf_viewer-OLD.js"],
      "assets/index-WEEKOLD.js": earlier["assets/index-WEEKOLD.js"],
    });
  } finally {
    server.close();
  }
});
