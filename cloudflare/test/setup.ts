// Every test file starts on a database at this build's schema, and every
// test on an empty one — the counterpart of backend/testdb.py, which
// levelled the schema before each test so that a count means what it
// says. The settings table keeps its version stamp; everything else goes,
// children before parents, and the bucket with it.
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

const EMPTIED = [
  "_server_change_log", "_server_clients", "applied_mutations", "auth_tokens",
  "copy_tags", "annotations", "board_items", "board_groups", "boards", "copies",
  "notifications", "room_participants", "room_messages", "room_availabilities", "rooms",
  "paper_citations", "paper_links", "paper_references", "sharables", "papers",
  "shelves", "tags", "feedback", "jobs",
  "admin_message_deliveries", "admin_messages", "error_logs", "users",
];

beforeEach(async () => {
  await env.DB.batch(EMPTIED.map((table) => env.DB.prepare(`DELETE FROM ${table}`)));
  const listed = await env.FILES.list();
  if (listed.objects.length) await env.FILES.delete(listed.objects.map((object) => object.key));
});
