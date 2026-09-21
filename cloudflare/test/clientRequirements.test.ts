// The client-requirements gate.
import { SELF, env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { SCHEMA_HEADER, schemaVersion } from "../src/clientRequirements";

const CURRENT = String(schemaVersion());
const OLDER = String(schemaVersion() - 1);

async function ask(headers: Record<string, string> = {}) {
  const response = await SELF.fetch("https://papol.test/api/client-requirements", { headers });
  expect(response.status).toBe(200);
  return response.json<{ verdict: string; schema_version: number; download_url: string }>();
}

describe("client requirements", () => {
  it("tells a build what schema this server speaks", async () => {
    const asked = await ask({ [SCHEMA_HEADER]: OLDER });
    expect(asked.verdict).toBe("incompatible");
    expect(asked.schema_version).toBe(schemaVersion());
    expect(asked.download_url).toMatch(/^https:\/\//);
    expect((await ask({ [SCHEMA_HEADER]: CURRENT })).verdict).toBe("supported");
  });

  it("does not gate a caller that is not a Papol client", async () => {
    expect((await ask()).verdict).toBe("supported");
    expect((await ask({ "User-Agent": "curl/8.4.0" })).verdict).toBe("supported");
  });

  it("refuses a native build from before the header", async () => {
    expect((await ask({ "User-Agent": "Papol macOS/0.2.0" })).verdict).toBe("incompatible");
  });

  it("treats a header nobody can read as another build's", async () => {
    expect((await ask({ [SCHEMA_HEADER]: "three" })).verdict).toBe("incompatible");
  });

  it("starts on a database at this build's schema", async () => {
    const stamped = await env.DB.prepare("SELECT value FROM settings WHERE key = 'schema_version'").first<{ value: string }>();
    expect(stamped?.value).toBe(CURRENT);
    // Every table the schema declares, and nothing of Papol's besides.
    const { results } = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'd1_%' AND name NOT LIKE '\\_cf\\_%' ESCAPE '\\' ORDER BY name",
    ).all<{ name: string }>();
    expect(results.map((row) => row.name)).toEqual([
      "_server_change_log", "_server_clients", "admin_message_deliveries", "admin_messages",
      "annotations", "applied_mutations", "auth_tokens", "board_groups", "board_items", "boards",
      "copies", "copy_tags", "error_logs", "feedback", "jobs", "notifications", "paper_citations",
      "paper_links", "paper_references", "papers", "room_availabilities", "room_messages",
      "room_participants", "rooms", "settings", "sharables", "shelves", "tags", "users",
    ]);
  });
});
