// People, nooks, shelves, tags, and the list of every paper.
import { describe, expect, it } from "vitest";

import { call, count, defaultShelf, exec, ok, paperWithCopy, register, row, rows, uuid, type Account } from "./helpers";

async function privateShelf(account: Account): Promise<string> {
  return (await row<{ uuid: string }>("SELECT uuid FROM shelves WHERE user_uuid = ? AND is_public = 0", account.uuid))!.uuid;
}

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
    expect(own.stats).toEqual({ papers: 2, displayed: 1 });
    // Signing up left a tag too; the list is by name.
    expect(own.tags.map((t: any) => t.name)).toEqual(["favourite", "favourite reads"]);
    expect(own.shelves.map((s: any) => [s.name, s.paper_count, s.board_count])).toEqual([["Display", 1, 1], ["Personal", 1, 1]]);
    expect(own.boards.map((b: any) => b.can_edit)).toEqual([true, true]);
    expect(own.boards[0]).toMatchObject({ name: "Private board", item_count: 0, project: null, owner: { uuid: keeper.uuid }, items: [] });

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

describe("Passing", () => {
  it("lists the papers its user read or wrote on that are not in their nook, for good, and to nobody else", async () => {
    const keeper = await register(), reader = await register();
    const dug = "c".repeat(64), anchored = "d".repeat(64), untouched = "e".repeat(64);
    for (const [digest, title] of [[dug, "Dug"], [anchored, "Anchored"], [untouched, "Only read"]]) {
      await paperWithCopy(keeper, digest, title, { shelfUuid: await defaultShelf(keeper) });
    }
    const marked = async (who: Account = reader) => (await ok("GET", `/api/users/${who.uuid}/nook`, { headers: who.headers })).unkept;
    expect(await marked()).toEqual([]);

    // A dig and an anchor, each on a paper that is not in the reader's nook.
    const dig = await ok("POST", "/api/digs", { headers: reader.headers, json: { subject: `paper:${dug}`, text: "Why this bound?" } });
    const anchor = await ok("POST", `/api/papers/${anchored.slice(0, 32)}/annotations`, { headers: reader.headers, json: { kind: "anchor", page: 1, body: { anchor: { x: 0.5, y: 0.5 } } } });
    const listed = await marked();
    expect(listed.map((m: any) => m.sha256).sort()).toEqual([dug, anchored].sort());
    expect(listed.find((m: any) => m.sha256 === dug)).toMatchObject({ title: "Dug", effort: null });
    expect(listed.find((m: any) => m.sha256 === anchored)).toMatchObject({ title: "Anchored", effort: null });
    // Marking a paper puts nothing in the nook.
    const nook = await ok("GET", `/api/users/${reader.uuid}/nook`, { headers: reader.headers });
    expect(nook.papers).toEqual([]);
    expect(nook.stats).toEqual({ papers: 0, displayed: 0 });

    // A paper on a shelf is not listed: added to the nook it leaves the
    // list, and taken out again it is back.
    // The copy is added now, whenever it began: when its user first read
    // the paper is not what their nook, or a friend's Lounge, is told.
    await exec("UPDATE copies SET created_at = '2020-01-01T00:00:00.000Z' WHERE user_uuid = ? AND paper_sha256 = ?", reader.uuid, dug);
    await ok("POST", `/api/papers/${dug.slice(0, 32)}/add-to-nook`, { headers: reader.headers });
    expect((await marked()).map((m: any) => m.sha256)).toEqual([anchored]);
    const added = (await ok("GET", `/api/users/${reader.uuid}/nook`, { headers: reader.headers })).papers[0];
    expect(added).toMatchObject({ sha256: dug });
    expect(Date.now() - Date.parse(added.created_at)).toBeLessThan(60_000);
    await ok("DELETE", `/api/papers/${dug.slice(0, 32)}`, { headers: reader.headers });
    expect((await marked()).map((m: any) => m.sha256).sort()).toEqual([dug, anchored].sort());
    // It stays with everything written on it rubbed out.
    await ok("DELETE", `/api/annotations/${anchor.uuid}`, { headers: reader.headers });
    await ok("DELETE", `/api/digs/${dig.uuid}`, { headers: reader.headers });
    expect((await marked()).map((m: any) => m.sha256).sort()).toEqual([dug, anchored].sort());

    // A paper only read is listed too, with the time spent on it, and one
    // opened for no time at all is not.
    const read = "f".repeat(64), glanced = "9".repeat(64);
    await paperWithCopy(keeper, read, "Read through", { shelfUuid: await defaultShelf(keeper) });
    await paperWithCopy(keeper, glanced, "Opened", { shelfUuid: await defaultShelf(keeper) });
    const started = Date.now() - 600_000;
    const span = (subject: string, seconds: number) => ({ uuid: uuid(), kind: "reading", subject, seconds,
      started_at: new Date(started).toISOString(), ended_at: new Date(started + 300_000).toISOString() });
    await ok("POST", "/api/activity", { headers: reader.headers, json: { spans: [span(read, 240), span(glanced, 0)] } });
    const withRead = await marked();
    expect(withRead.map((m: any) => m.sha256).sort()).toEqual([dug, anchored, read].sort());
    expect(withRead.find((m: any) => m.sha256 === read)).toMatchObject({ sha256: read, title: "Read through", effort: { seconds: 240 } });
    expect(withRead.find((m: any) => m.sha256 === dug).effort).toBeNull();
    // A paper its user keeps is not listed, however much is read or written on it.
    await ok("POST", "/api/activity", { headers: keeper.headers, json: { spans: [span(untouched, 120)] } });
    await ok("POST", "/api/digs", { headers: keeper.headers, json: { subject: `paper:${untouched}`, text: "Mine" } });
    expect(await marked(keeper)).toEqual([]);
    // Each is one copy of the reader's, not kept or taken out, and the
    // one read for no time left none.
    expect(await rows("SELECT paper_sha256, kept, deleted_at IS NOT NULL AS removed FROM copies WHERE user_uuid = ? ORDER BY paper_sha256", reader.uuid))
      .toEqual([{ paper_sha256: dug, kept: 1, removed: 1 }, { paper_sha256: anchored, kept: 0, removed: 0 }, { paper_sha256: read, kept: 0, removed: 0 }]);
    // Nobody is shown another's list.
    expect((await ok("GET", `/api/users/${keeper.uuid}/nook`, { headers: reader.headers })).unkept).toEqual([]);
  });
});

describe("the list of every paper", () => {
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
      is_author: true, thought: "Brilliant", rating_expertise: null, rating_reading: null, rating_liking: 5, summary: null, tags: [] }]);
  });
});

describe("a copy's fields", () => {
  it("each say for themselves whether others see them, on a paper's page and in a nook", async () => {
    const ada = await register("ada@example.test", "Ada"), grace = await register("grace@example.test", "Grace");
    const digest = "e".repeat(64), name = digest.slice(0, 32);
    const copy = await paperWithCopy(ada, digest, "Read in the open", { shelfUuid: await defaultShelf(ada) });
    const tag = await ok("POST", "/api/tags", { headers: ada.headers, json: { name: "methods" } });
    await ok("PUT", `/api/papers/${name}`, { headers: ada.headers, json: { thought: "Brilliant", summary: "Proves it twice", rating_reading: 4, tag_uuids: [tag.uuid] } });
    const readerOf = async () => (await ok("GET", `/api/papers/${name}`, { headers: grace.headers })).also_read_by[0];
    const nookRow = async () => (await ok("GET", `/api/users/${ada.uuid}/nook`, { headers: grace.headers })).papers[0];

    // As every copy was: thought and ratings seen, summary and tags kept.
    expect(await ok("GET", `/api/papers/${name}`, { headers: ada.headers })).toMatchObject({
      thought_public: true, ratings_public: true, summary_public: false, tags_public: false });
    expect(await readerOf()).toMatchObject({ thought: "Brilliant", rating_reading: 4, summary: null, tags: [] });
    expect(await nookRow()).toMatchObject({ thought: "Brilliant", rating_reading: 4, summary: null, tags: [] });

    // Turned the other way, each of the four.
    const turned = await ok("PUT", `/api/papers/${name}`, { headers: ada.headers, json: {
      thought_public: false, ratings_public: false, summary_public: true, tags_public: true } });
    expect(turned).toMatchObject({ thought_public: false, ratings_public: false, summary_public: true, tags_public: true,
      thought: "Brilliant", rating_reading: 4, summary: "Proves it twice" });
    const methods = [{ uuid: tag.uuid, name: "methods" }];
    expect(await readerOf()).toMatchObject({ thought: null, rating_reading: null, summary: "Proves it twice", tags: methods });
    expect(await nookRow()).toMatchObject({ thought: null, rating_reading: null, summary: "Proves it twice", tags: methods });
    // Its owner still sees all of it in their own nook.
    expect((await ok("GET", `/api/users/${ada.uuid}/nook`, { headers: ada.headers })).papers[0]).toMatchObject({
      thought: "Brilliant", rating_reading: 4, summary: "Proves it twice", tags: methods });
    // Every change is a version the replicas hear of.
    const logged = await row<{ row_json: string }>("SELECT row_json FROM _server_change_log WHERE row_uuid = ? ORDER BY sequence DESC LIMIT 1", copy);
    expect(JSON.parse(logged!.row_json)).toMatchObject({ thought_public: false, ratings_public: false, summary_public: true, tags_public: true });
  });

  it("pins a copy for its user alone, and tells the replicas", async () => {
    const ada = await register("ada@example.test", "Ada"), grace = await register("grace@example.test", "Grace");
    const digest = "f".repeat(64), name = digest.slice(0, 32);
    const copy = await paperWithCopy(ada, digest, "Read first", { shelfUuid: await defaultShelf(ada) });
    const nookRow = async (reader: typeof ada) => (await ok("GET", `/api/users/${ada.uuid}/nook`, { headers: reader.headers })).papers[0];
    // A copy starts unpinned.
    expect(await ok("GET", `/api/papers/${name}`, { headers: ada.headers })).toMatchObject({ pinned: false });
    expect(await nookRow(ada)).toMatchObject({ pinned: false });

    expect(await ok("PUT", `/api/papers/${name}`, { headers: ada.headers, json: { pinned: true } })).toMatchObject({ pinned: true });
    expect(await nookRow(ada)).toMatchObject({ pinned: true });
    // A visitor reads the nook in its own order: the pin is not theirs to see.
    expect(await nookRow(grace)).toMatchObject({ pinned: false });
    expect(await ok("GET", `/api/papers/${name}`, { headers: grace.headers })).toMatchObject({ pinned: null });
    const logged = await row<{ row_json: string }>("SELECT row_json FROM _server_change_log WHERE row_uuid = ? ORDER BY sequence DESC LIMIT 1", copy);
    expect(JSON.parse(logged!.row_json)).toMatchObject({ pinned: true });

    expect((await call("PUT", `/api/papers/${name}`, { headers: ada.headers, json: { pinned: "yes" } })).status).toBe(422);
    expect(await ok("PUT", `/api/papers/${name}`, { headers: ada.headers, json: { pinned: false } })).toMatchObject({ pinned: false });
    expect(await nookRow(ada)).toMatchObject({ pinned: false });

    // A public field on a private shelf is still seen by nobody.
    await ok("PUT", `/api/papers/${name}`, { headers: ada.headers, json: { shelf_uuid: await privateShelf(ada) } });
    expect((await ok("GET", `/api/papers/${name}`, { headers: grace.headers })).also_read_by).toEqual([]);

    expect((await call("PUT", `/api/papers/${name}`, { headers: ada.headers, json: { summary_public: "yes" } })).status).toBe(422);
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

  it("renames, recolours, changes hands as the default, and hides", async () => {
    const account = await register();
    const display = await defaultShelf(account), personal = await privateShelf(account);
    const renamed = await ok("PUT", `/api/shelves/${personal}`, { headers: account.headers, json: { name: "Drafts", color: "#FFFFFF", is_default: true } });
    expect(renamed).toMatchObject({ name: "Drafts", color: "#ffffff", is_default: true });
    expect((await row("SELECT is_default FROM shelves WHERE uuid = ?", display))).toEqual({ is_default: 0 });
    expect((await call("PUT", `/api/shelves/${personal}`, { headers: account.headers, json: { name: "Display" } })).status).toBe(400);
    expect((await call("PUT", `/api/shelves/${uuid()}`, { headers: account.headers, json: { is_public: true } })).status).toBe(404);

    const digest = "7".repeat(64);
    await paperWithCopy(account, digest, "Shelved", { shelfUuid: display });
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
  it("are made once whatever the case, listed newest first, and taken off every copy when deleted", async () => {
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

  it("are listed by when they last went onto a paper, most recent first", async () => {
    const account = await register();
    const names = ["algebra", "biology", "chemistry", "drama", "economics"];
    const tags: Record<string, string> = {};
    for (const name of names) tags[name] = (await ok("POST", "/api/tags", { headers: account.headers, json: { name } })).uuid;
    // Made long ago, so that only their use orders them.
    await exec("UPDATE tags SET created_at = '2020-01-01T00:00:00.000Z' WHERE user_uuid = ?", account.uuid);
    const copy = await paperWithCopy(account, "8".repeat(64), "Tagged", { shelfUuid: await defaultShelf(account) });
    const link = (tag: string, created: string, updated: string, deleted: string | null) => exec(
      "INSERT INTO copy_tags (uuid, copy_uuid, tag_uuid, user_uuid, created_at, updated_at, revision, deleted_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?)",
      uuid(), copy, tags[tag], account.uuid, created, updated, deleted);
    await link("biology", "2024-01-01T00:00:00.000Z", "2024-01-01T00:00:00.000Z", null);
    // Put on in 2023 and taken off since: its use was 2023, not the taking off.
    await link("drama", "2023-01-01T00:00:00.000Z", "2025-06-01T00:00:00.000Z", "2025-06-01T00:00:00.000Z");
    // Put on in 2022, taken off, and put back on in 2025.
    await link("economics", "2022-01-01T00:00:00.000Z", "2025-01-01T00:00:00.000Z", null);
    expect((await ok("GET", "/api/tags", { headers: account.headers })).map((t: any) => t.name))
      .toEqual(["economics", "biology", "drama", "algebra", "chemistry", "favourite"]);

    // Putting one on a paper now brings it to the top.
    await ok("PUT", `/api/papers/${"8".repeat(32)}`, { headers: account.headers, json: { tag_uuids: [tags.biology, tags.economics, tags.chemistry] } });
    expect((await ok("GET", "/api/tags", { headers: account.headers })).map((t: any) => t.name).slice(0, 3))
      .toEqual(["chemistry", "economics", "biology"]);
  });
});
