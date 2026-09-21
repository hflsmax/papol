// The suite runs inside the Workers runtime, against a D1 that is levelled
// and migrated per test file — the counterpart of backend/testdb.py.
import path from "node:path";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig(async () => {
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
