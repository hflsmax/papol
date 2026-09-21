// The suite runs inside the Workers runtime, against a D1 that is levelled
// and migrated per test file.
import fs from "node:fs";
import path from "node:path";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

// The site the Worker serves is assembled from three builds
// (scripts/assemble.sh). Where none has been, the suite stands three
// one-line documents in for it, so what is tested is the routing.
function standInSite() {
  const site = path.join(import.meta.dirname, "site");
  const documents: [string, string][] = [
    ["index.html", "<!doctype html><title>Papol</title>"],
    ["viewer/index.html", "<!doctype html><title>Papol viewer</title>"],
    ["boards/index.html", "<!doctype html><title>Papol board</title>"],
    ["boards/assets/board.js", "// the board"],
  ];
  for (const [file, body] of documents) {
    const target = path.join(site, file);
    if (fs.existsSync(target)) continue;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, body);
  }
}

export default defineConfig(async () => {
  standInSite();
  const migrations = await readD1Migrations(path.join(import.meta.dirname, "migrations"));
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./wrangler.toml" },
        miniflare: {
          // The suite hands wake-ups to the consumer itself, so a job
          // runs when a test says and not when the runtime delivers.
          bindings: { TEST_MIGRATIONS: migrations, QUEUE_DELIVERY: "manual", GROBID_URL: "https://grobid.test" },
        },
      }),
    ],
    test: {
      setupFiles: ["./test/setup.ts"],
    },
  };
});
