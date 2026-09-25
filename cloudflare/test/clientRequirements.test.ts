// The client-requirements gate.
import { SELF, env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import worker from "../src/index";
import { DESKTOP_VERSION_HEADER, MINIMUM_DESKTOP_VERSION, SCHEMA_HEADER, schemaVersion } from "../src/clientRequirements";

const CURRENT = String(schemaVersion());
const OLDER = String(schemaVersion() - 1);

async function ask(headers: Record<string, string> = {}) {
  const response = await SELF.fetch("https://papol.test/api/client-requirements", { headers });
  expect(response.status).toBe(200);
  return response.json<{ verdict: string; schema_version: number; download_url: string; minimum_desktop_version: string; files_url: string | null }>();
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

  it("refuses a desktop build older than the one that speaks to the bucket itself, whatever schema it announces", async () => {
    expect(MINIMUM_DESKTOP_VERSION).toBe("0.5.0");
    const desktop = (version: string) => ask({ [SCHEMA_HEADER]: CURRENT, "User-Agent": `Papol macOS/${version}` });
    expect((await desktop("0.4.1")).verdict).toBe("incompatible");
    expect((await desktop("0.4.10")).verdict).toBe("incompatible");
    expect((await desktop("0.5.0")).verdict).toBe("supported");
    expect((await desktop("0.5.1")).verdict).toBe("supported");
    expect((await desktop("0.10.0")).verdict).toBe("supported");
    expect((await desktop("1.0")).verdict).toBe("supported");
    expect((await desktop("soon")).verdict).toBe("incompatible");
    expect((await desktop("0.5.0")).minimum_desktop_version).toBe("0.5.0");
    // The sync routes refuse the same build, so it stops and says so.
    const pull = await SELF.fetch("https://papol.test/api/sync/snapshot", { headers: { [SCHEMA_HEADER]: CURRENT, "User-Agent": "Papol macOS/0.4.1", Authorization: "Bearer none" } });
    expect(pull.status).toBe(426);
    expect(await pull.json()).toMatchObject({ detail: { error: "client_incompatible", minimum_desktop_version: "0.5.0" } });
  });

  it("judges the app's windows by the version they announce, as it judges the synchronizer", async () => {
    // The windows' requests cannot set a User-Agent; without this header
    // the startup check told a refused build it was supported.
    const window = (version: string) => ask({ [SCHEMA_HEADER]: CURRENT, [DESKTOP_VERSION_HEADER]: version });
    expect((await window("0.4.1")).verdict).toBe("incompatible");
    expect((await window("0.5.0")).verdict).toBe("supported");
    // The User-Agent, where there is one, is the synchronizer's and wins.
    expect((await ask({ [SCHEMA_HEADER]: CURRENT, [DESKTOP_VERSION_HEADER]: "0.5.0", "User-Agent": "Papol macOS/0.4.1" })).verdict).toBe("incompatible");
  });

  it("says where the files are: the bucket's own address, or nowhere when this Worker serves them", async () => {
    expect((await ask()).files_url).toBeNull();
    const hosted = await worker.fetch(new Request("https://papol.test/api/client-requirements"), { ...env, FILES_URL: "https://files.test/" as string } as Env);
    expect(((await hosted.json()) as { files_url: string }).files_url).toBe("https://files.test");
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
      "_server_change_log", "_server_clients", "activity", "admin_message_deliveries", "admin_messages",
      "annotations", "applied_mutations", "auth_tokens", "board_groups", "board_items", "boards",
      "copies", "copy_tags", "error_logs", "feedback", "jobs", "notifications", "paper_citations",
      "paper_floats", "paper_links", "paper_references", "papers", "room_availabilities", "room_messages",
      "room_participants", "rooms", "settings", "sharables", "shelves", "tags", "users",
    ]);
  });
});
