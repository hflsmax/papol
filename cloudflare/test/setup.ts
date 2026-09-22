// Every test file starts on a database at this build's schema, and every
// test on an empty one, so that a count means what it says. The settings
// table keeps its version stamp, which the migrations wrote and the client
// gate reads (clientRequirements.test.ts); a setting a test wrote goes, as
// does everything else, and the bucket with it.
import { applyD1Migrations, env } from "cloudflare:test";
import type { D1Migration } from "@cloudflare/vitest-pool-workers";
import { beforeEach } from "vitest";

declare global {
  namespace Cloudflare {
    interface Env {
      // Handed in by vitest.config.ts; not a binding the Worker has.
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);

// The tables are read off the schema itself, so a table a migration adds
// is emptied without anybody remembering to list it. SQLite's own tables,
// the runtime's (_cf_) and the migrations' bookkeeping (d1_migrations) are
// not the application's and stay as they are.
const { results: tables } = await env.DB.prepare(
  `SELECT name FROM sqlite_master WHERE type = 'table'
     AND name NOT GLOB 'sqlite_*' AND name NOT GLOB '_cf_*' AND name NOT GLOB 'd1_*'
     AND name <> 'settings'`,
).all<{ name: string }>();
const EMPTIED = tables.map(({ name }) => name);

beforeEach(async () => {
  // The batch is one transaction, and a deferred foreign key is checked
  // only when it commits: by then every table is empty, so the order the
  // tables are emptied in does not matter.
  await env.DB.batch([
    env.DB.prepare("PRAGMA defer_foreign_keys = ON"),
    ...EMPTIED.map((table) => env.DB.prepare(`DELETE FROM "${table}"`)),
    env.DB.prepare("DELETE FROM settings WHERE key <> 'schema_version'"),
  ]);
  // A listing is a page at a time; a test that left more than a page
  // behind would otherwise leave the rest to the next.
  let cursor: string | undefined;
  do {
    const listed = await env.FILES.list({ cursor });
    if (listed.objects.length) await env.FILES.delete(listed.objects.map((object) => object.key));
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);
});
