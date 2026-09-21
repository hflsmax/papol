// Notes, ink and clips through the API.
import { describe, expect, it } from "vitest";

import { call, count, defaultShelf, ok, paperWithCopy, register, row, type Account } from "./helpers";

async function kept(account: Account, digest = "1".repeat(64)) {
  await paperWithCopy(account, digest, "Annotated", { shelfUuid: await defaultShelf(account) });
  return digest.slice(0, 32);
}

async function stroke(account: Account, name: string) {
  return ok("POST", `/api/papers/${name}/annotations`, { headers: account.headers, json: {
    kind: "ink", page: 1, body: { points: [{ x: 0.1, y: 0.2 }], color: "#112233", width: 0.005, opacity: 0.9, shape: "round" },
  } });
}

describe("annotations", () => {
  it("takes a note, a stroke and a clip, lists them oldest first, and narrows by kind", async () => {
    const account = await register();
    const name = await kept(account);
    const note = await ok("POST", `/api/papers/${name}/annotations`, { headers: account.headers, json: { kind: "note", content: "About the paper" } });
    expect(note).toMatchObject({ kind: "note", content: "About the paper", page: null, body: {} });
    const ink = await stroke(account, name);
    expect(ink.body).toEqual({ points: [{ x: 0.1, y: 0.2 }], color: "#112233", width: 0.005, opacity: 0.9, shape: "round" });
    const clip = await ok("POST", `/api/papers/${name}/annotations`, { headers: account.headers, json: {
      kind: "clip", page: 2, name: "Figure 3", body: { source: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 }, frame: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 } },
    } });
    expect(clip.body.floating).toBe(false);
    // A stroke drawn without saying its colour has one on every device.
    const bare = await ok("POST", `/api/papers/${name}/annotations`, { headers: account.headers, json: { kind: "ink", page: 1, body: { points: [{ x: 0.5, y: 0.5 }] } } });
    expect(bare.body).toEqual({ points: [{ x: 0.5, y: 0.5 }], color: "#b3923d", width: 0.004, opacity: 1, shape: "flat" });

    const all = await ok("GET", `/api/papers/${name}/annotations`, { headers: account.headers });
    expect(all.map((a: any) => a.uuid)).toEqual([note.uuid, ink.uuid, clip.uuid, bare.uuid]);
    const inks = await ok("GET", `/api/papers/${name}/annotations?kind=ink`, { headers: account.headers });
    expect(inks.map((a: any) => a.uuid)).toEqual([ink.uuid, bare.uuid]);
    expect((await call("GET", `/api/papers/${name}/annotations?kind=laser`, { headers: account.headers })).status).toBe(422);
    // Each one is a version a replica hears of.
    expect(await count("_server_change_log", "table_name = 'annotations'")).toBe(4);
  });

  it("is only for a paper the user keeps", async () => {
    const keeper = await register(), other = await register();
    const name = await kept(keeper);
    expect((await call("GET", `/api/papers/${name}/annotations`, { headers: other.headers })).status).toBe(403);
    expect((await call("POST", `/api/papers/${name}/annotations`, { headers: other.headers, json: { kind: "note", content: "hi" } })).status).toBe(403);
    expect((await call("GET", `/api/papers/${"2".repeat(32)}/annotations`, { headers: keeper.headers })).status).toBe(404);
  });

  it("moves a stroke's points and leaves its nib", async () => {
    const account = await register();
    const name = await kept(account);
    const made = await stroke(account, name);
    const moved = await ok("PUT", `/api/annotations/${made.uuid}`, { headers: account.headers, json: { body: { points: [{ x: 0.8, y: 0.8 }] } } });
    expect(moved.body).toMatchObject({ points: [{ x: 0.8, y: 0.8 }], color: "#112233", shape: "round" });
    const reworded = await ok("PUT", `/api/annotations/${made.uuid}`, { headers: account.headers, json: { content: "said later", page: 3 } });
    expect(reworded).toMatchObject({ content: "said later", page: 3 });
    expect(reworded.body.points).toEqual([{ x: 0.8, y: 0.8 }]);
  });

  it("refuses a change that would break the shape, with a reason to read", async () => {
    const account = await register();
    const name = await kept(account);
    const made = await stroke(account, name);
    const emptied = await call("PUT", `/api/annotations/${made.uuid}`, { headers: account.headers, json: { body: { points: [] } } });
    expect(emptied.status).toBe(422);
    const wrongBody = await call("POST", `/api/papers/${name}/annotations`, { headers: account.headers, json: { kind: "ink", page: 1, body: { anchor: { type: "point", x: 0.1, y: 0.1 } } } });
    expect(wrongBody.status).toBe(422);
    const offPage = await call("PUT", `/api/annotations/${made.uuid}`, { headers: account.headers, json: { body: { points: [{ x: 9, y: 9 }] } } });
    expect(offPage.status).toBe(422);
    const detail = (await offPage.json<any>()).detail;
    // Readable, and free of anything a JSON encoder would choke on.
    expect([detail].flat().every((item) => typeof item === "string")).toBe(true);
    expect((await row("SELECT body FROM annotations WHERE uuid = ?", made.uuid))!.body).toContain('"x":0.1');
  });

  it("is deleted by its author and nobody else", async () => {
    const account = await register(), other = await register();
    const name = await kept(account);
    const made = await stroke(account, name);
    expect((await call("DELETE", `/api/annotations/${made.uuid}`, { headers: other.headers })).status).toBe(404);
    expect((await call("PUT", `/api/annotations/${made.uuid}`, { headers: other.headers, json: { content: "mine" } })).status).toBe(404);
    expect((await ok("DELETE", `/api/annotations/${made.uuid}`, { headers: account.headers })).message).toBe("Annotation deleted");
    expect(await ok("GET", `/api/papers/${name}/annotations`, { headers: account.headers })).toEqual([]);
    expect((await call("DELETE", `/api/annotations/${made.uuid}`, { headers: account.headers })).status).toBe(404);
  });
});
