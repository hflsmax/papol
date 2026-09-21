// People, nooks, shelves, tags, and the Library's list of papers. The
// library cases of test_paper_is_not_owned.py and the shelf and tag
// behavior of the Python routes, asked of the Worker.
import { describe, expect, it } from "vitest";

import { call, count, defaultShelf, exec, ok, paperWithCopy, register, row, rows, uuid, type Account } from "./helpers";

async function privateShelf(account: Account): Promise<string> {
  return (await row<{ uuid: string }>("SELECT uuid FROM shelves WHERE user_uuid = ? AND is_public = 0", account.uuid))!.uuid;
}

describe("the Library's people", () => {
  it("lists every user with how many papers they display", async () => {
    const ada = await register("ada@example.test", "Ada"), grace = await register("grace@example.test", "Grace");
    await paperWithCopy(ada, "a".repeat(64), "Shown", { shelfUuid: await defaultShelf(ada) });
    await paperWithCopy(ada, "b".repeat(64), "Hidden", { shelfUuid: await privateShelf(ada) });
    const users = await ok("GET", "/api/users", { headers: grace.headers });
    expect(users.map((u: any) => [u.display_name, u.paper_count])).toEqual([["Ada", 1], ["Grace", 0]]);
    expect(users[0].email).toBe("ada@example.test");
    expect((await call("GET", "/api/users")).status).toBe(401);
  });
});

describe("a nook", () => {
  it("shows its owner everything, and others only what is on display", async () => {
    const keeper = await register("keeper@example.test", "Ada"), other = await register("other@example.test", "Grace");
    const shown = "a".repeat(64), hidden = "b".repeat(64);
    const shownCopy = await paperWithCopy(keeper, shown, "On display", { shelfUuid: await defaultShelf(keeper) });
    await exec("UPDATE copies SET summary = 'Mine alone', thought = 'Worth it' WHERE uuid = ?", shownCopy);
    await paperWithCopy(keeper, hidden, "Kept private", { shelfUuid: await privateShelf(keeper) });
    const tag = await ok("POST", "/api/tags", { headers: keeper.headers, json: { name: "favourite reads" } });
    await exec("INSERT INTO copy_tags (uuid, copy_uuid, tag_uuid, user_uuid, created_at, updated_at, revision) VALUES (?, ?, ?, ?, ?, ?, 0)",
      uuid(), shownCopy, tag.uuid, keeper.uuid, new Date().toISOString(), new Date().toISOString());
    await ok("POST", "/api/boards", { headers: keeper.headers, json: { name: "Public board" } });
    await ok("POST", "/api/boards", { headers: keeper.headers, json: { name: "Private board", shelf_uuid: await privateShelf(keeper) } });

    const own = await ok("GET", `/api/users/${keeper.uuid}/nook`, { headers: keeper.headers });
    expect(own.papers.map((p: any) => p.sha256).sort()).toEqual([shown, hidden].sort());
    const mine = own.papers.find((p: any) => p.sha256 === shown);
    expect(mine).toMatchObject({ summary: "Mine alone", thought: "Worth it", is_public: true, copy_uuid: shownCopy, tags: [{ uuid: tag.uuid, name: "favourite reads" }] });
    expect(mine.users.map((u: any) => u.user.uuid)).toEqual([keeper.uuid]);
    expect(own.stats).toEqual({ papers: 2, displayed: 1, notes: 0, seminars: 0 });
    // Signing up left a tag too; the list is by name.
    expect(own.tags.map((t: any) => t.name)).toEqual(["favourite", "favourite reads"]);
    expect(own.shelves.map((s: any) => [s.name, s.paper_count, s.board_count])).toEqual([["Display", 1, 1], ["Personal", 1, 1]]);
    expect(own.boards.map((b: any) => b.can_edit)).toEqual([true, true]);

    const theirs = await ok("GET", `/api/users/${keeper.uuid}/nook`, { headers: other.headers });
    expect(theirs.papers.map((p: any) => p.sha256)).toEqual([shown]);
    expect(theirs.papers[0]).toMatchObject({ summary: null, thought: "Worth it", tags: [] });
    expect(theirs.stats).toBeNull();
    expect(theirs.tags).toEqual([]);
    expect(theirs.shelves.map((s: any) => s.name)).toEqual(["Display"]);
    expect(theirs.boards.map((b: any) => [b.name, b.can_edit])).toEqual([["Public board", false]]);
    expect(theirs.user).toMatchObject({ uuid: keeper.uuid, display_name: "Ada" });
  });

  it("is not there for a user who has left, or one who never was", async () => {
    const me = await register(), gone = await register();
    await exec("UPDATE users SET deleted_at = ? WHERE uuid = ?", new Date().toISOString(), gone.uuid);
    expect((await call("GET", `/api/users/${gone.uuid}/nook`, { headers: me.headers })).status).toBe(404);
    expect((await call("GET", `/api/users/${uuid()}/nook`, { headers: me.headers })).status).toBe(404);
  });
});

describe("the Library", () => {
  it("lists a paper nobody displays and one nobody holds, naming no reader for either", async () => {
    const keeper = await register("keeper@example.test", "Ada"), other = await register("other@example.test", "Grace");
    const kept = "a".repeat(64), nobodys = "c".repeat(64);
    await paperWithCopy(keeper, kept, "On a paper nobody owns", { shelfUuid: await privateShelf(keeper) });
    await exec("INSERT INTO papers (sha256, title, file_path, created_at, updated_at, revision) VALUES (?, 'Held by nobody', ?, ?, ?, 1)",
      nobodys, `${nobodys}.pdf`, new Date().toISOString(), new Date().toISOString());
    const listing = await ok("GET", "/api/papers", { headers: other.headers });
    expect(listing.map((p: any) => p.sha256).sort()).toEqual([kept, nobodys].sort());
    for (const entry of listing as any[]) {
      expect(entry.users).toEqual([]);
      expect(entry.summary).toBeNull();
      expect(entry.copy_uuid).toBeNull();
    }
    expect(listing.find((p: any) => p.sha256 === nobodys).file_path).toBe(`${nobodys}.pdf`);
  });

  it("names the readers who display a paper, with what they say of it", async () => {
    const ada = await register("ada@example.test", "Ada"), grace = await register("grace@example.test", "Grace");
    const digest = "d".repeat(64);
    const copy = await paperWithCopy(ada, digest, "Read by two", { shelfUuid: await defaultShelf(ada) });
    await exec("UPDATE copies SET thought = 'Brilliant', rating_liking = 5, is_author = 1 WHERE uuid = ?", copy);
    await exec("INSERT INTO copies (uuid, paper_sha256, user_uuid, shelf_uuid, is_author, created_at, updated_at, revision) VALUES (?, ?, ?, ?, 0, ?, ?, 0)",
      uuid(), digest, grace.uuid, await privateShelf(grace), new Date().toISOString(), new Date().toISOString());
    const entry = (await ok("GET", "/api/papers", { headers: grace.headers }))[0];
    expect(entry.users).toEqual([{ user: { uuid: ada.uuid, display_name: "Ada", affiliation: null, avatar_path: null, email: "ada@example.test" },
      is_author: true, thought: "Brilliant", rating_expertise: null, rating_reading: null, rating_liking: 5 }]);
    expect(entry.room_status).toBeNull();
  });
});

describe("shelves", () => {
  it("come as two, take three more with distinct names, and no more", async () => {
    const account = await register();
    expect((await ok("GET", "/api/shelves", { headers: account.headers })).map((s: any) => [s.name, s.is_public, s.is_default])).toEqual([["Display", true, true], ["Personal", false, false]]);
    const made = await ok("POST", "/api/shelves", { headers: account.headers, json: { name: "  Methods   papers ", color: "#ABCDEF", is_public: true } });
    expect(made).toMatchObject({ name: "Methods papers", color: "#abcdef", is_public: true, is_default: false, position: 2, paper_count: 0 });
    expect((await call("POST", "/api/shelves", { headers: account.headers, json: { name: "methods PAPERS", color: "#000000" } })).status).toBe(400);
    expect((await call("POST", "/api/shelves", { headers: account.headers, json: { name: "Bad colour", color: "blue" } })).status).toBe(422);
    await ok("POST", "/api/shelves", { headers: account.headers, json: { name: "Four", color: "#000000" } });
    await ok("POST", "/api/shelves", { headers: account.headers, json: { name: "Five", color: "#000000" } });
    expect((await call("POST", "/api/shelves", { headers: account.headers, json: { name: "Six", color: "#000000" } })).status).toBe(400);
  });

  it("renames, recolours, changes hands as the default, and hides unless a seminar is on", async () => {
    const account = await register();
    const display = await defaultShelf(account), personal = await privateShelf(account);
    const renamed = await ok("PUT", `/api/shelves/${personal}`, { headers: account.headers, json: { name: "Drafts", color: "#FFFFFF", is_default: true } });
    expect(renamed).toMatchObject({ name: "Drafts", color: "#ffffff", is_default: true });
    expect((await row("SELECT is_default FROM shelves WHERE uuid = ?", display))).toEqual({ is_default: 0 });
    expect((await call("PUT", `/api/shelves/${personal}`, { headers: account.headers, json: { name: "Display" } })).status).toBe(400);
    expect((await call("PUT", `/api/shelves/${uuid()}`, { headers: account.headers, json: { is_public: true } })).status).toBe(404);

    const digest = "7".repeat(64);
    await paperWithCopy(account, digest, "Shelved", { shelfUuid: display });
    const at = new Date().toISOString(), room = uuid();
    await exec("INSERT INTO rooms (uuid, paper_sha256, created_by, status, created_at) VALUES (?, ?, ?, 'called', ?)", room, digest, account.uuid, at);
    await exec("INSERT INTO room_participants (uuid, room_uuid, user_uuid, created_at) VALUES (?, ?, ?, ?)", uuid(), room, account.uuid, at);
    expect((await call("PUT", `/api/shelves/${display}`, { headers: account.headers, json: { is_public: false } })).status).toBe(400);
    await exec("UPDATE rooms SET status = 'finished' WHERE uuid = ?", room);
    expect((await ok("PUT", `/api/shelves/${display}`, { headers: account.headers, json: { is_public: false } })).is_public).toBe(false);
  });

  it("moves its papers and boards to the default when deleted, and is never the last one", async () => {
    const account = await register();
    const display = await defaultShelf(account), personal = await privateShelf(account);
    const digest = "8".repeat(64);
    await paperWithCopy(account, digest, "On the personal shelf", { shelfUuid: personal });
    const board = await ok("POST", "/api/boards", { headers: account.headers, json: { name: "Shelved board", shelf_uuid: personal } });
    expect((await call("DELETE", `/api/shelves/${personal}`, { headers: account.headers })).status).toBe(204);
    expect(await row("SELECT shelf_uuid FROM copies WHERE paper_sha256 = ?", digest)).toEqual({ shelf_uuid: display });
    expect(await row("SELECT shelf_uuid FROM boards WHERE uuid = ?", board.uuid)).toEqual({ shelf_uuid: display });
    expect((await call("DELETE", `/api/shelves/${display}`, { headers: account.headers })).status).toBe(400);
    // The default going hands the title on.
    await ok("POST", "/api/shelves", { headers: account.headers, json: { name: "Next", color: "#123456" } });
    expect((await call("DELETE", `/api/shelves/${display}`, { headers: account.headers })).status).toBe(204);
    expect((await rows("SELECT name FROM shelves WHERE user_uuid = ? AND deleted_at IS NULL AND is_default = 1", account.uuid))).toEqual([{ name: "Next" }]);
    // Every move was a version a replica hears of: onto Display, then onto Next.
    expect(await count("_server_change_log", "table_name = 'copies'")).toBe(2);
  });
});

describe("tags", () => {
  it("are made once whatever the case, listed by name, and taken off every copy when deleted", async () => {
    const account = await register();
    const first = await ok("POST", "/api/tags", { headers: account.headers, json: { name: "  Distributed   Systems " } });
    expect(first.name).toBe("Distributed Systems");
    const again = await ok("POST", "/api/tags", { headers: account.headers, json: { name: "distributed systems" } });
    expect(again.uuid).toBe(first.uuid);
    await ok("POST", "/api/tags", { headers: account.headers, json: { name: "algebra" } });
    expect((await ok("GET", "/api/tags", { headers: account.headers })).map((t: any) => t.name)).toEqual(["algebra", "Distributed Systems", "favourite"]);
    expect((await call("POST", "/api/tags", { headers: account.headers, json: { name: "   " } })).status).toBe(400);

    const copy = await paperWithCopy(account, "9".repeat(64), "Tagged", { shelfUuid: await defaultShelf(account) });
    await exec("INSERT INTO copy_tags (uuid, copy_uuid, tag_uuid, user_uuid, created_at, updated_at, revision) VALUES (?, ?, ?, ?, ?, ?, 0)",
      uuid(), copy, first.uuid, account.uuid, new Date().toISOString(), new Date().toISOString());
    expect((await call("DELETE", `/api/tags/${first.uuid}`, { headers: account.headers })).status).toBe(204);
    expect(await count("copy_tags", "deleted_at IS NULL")).toBe(0);
    expect((await ok("GET", "/api/tags", { headers: account.headers })).map((t: any) => t.name)).toEqual(["algebra", "favourite"]);
    expect((await call("DELETE", `/api/tags/${first.uuid}`, { headers: (await register()).headers })).status).toBe(404);
  });
});
