// Friends, what friendship opens, and the Lounge made from it.
import { describe, expect, it } from "vitest";

import { call, count, defaultShelf, exec, ok, paperWithCopy, register, row, rows, uuid, type Account } from "./helpers";

const digest = (letter: string) => letter.repeat(64);
const name = (letter: string) => digest(letter).slice(0, 32);
const friends = (account: Account) => ok("GET", "/api/friends", { headers: account.headers });
const room = (account: Account, query = "") => ok("GET", `/api/room${query}`, { headers: account.headers });
const inbox = async (account: Account) => (await ok("GET", "/api/notifications", { headers: account.headers })).notifications;
const privateShelf = async (account: Account) => (await row<{ uuid: string }>("SELECT uuid FROM shelves WHERE user_uuid = ? AND is_public = 0", account.uuid))!.uuid;

async function befriend(a: Account, b: Account) {
  await ok("POST", `/api/friends/${b.uuid}`, { headers: a.headers });
  await ok("POST", `/api/friends/${a.uuid}/accept`, { headers: b.headers });
}

describe("becoming friends", () => {
  it("is asked for and accepted, with the request answered in the inbox", async () => {
    const ada = await register("ada@example.test", "Ada"), grace = await register("grace@example.test", "Grace");
    await paperWithCopy(ada, digest("a"), "Both keep this", { shelfUuid: await defaultShelf(ada) });
    await ok("POST", `/api/papers/${name("a")}/add-to-nook`, { headers: grace.headers, json: {} });

    expect((await call("POST", `/api/friends/${ada.uuid}`, { headers: ada.headers })).status).toBe(400);
    expect((await call("POST", `/api/friends/${uuid()}`, { headers: ada.headers })).status).toBe(404);
    const asked = await ok("POST", `/api/friends/${grace.uuid}`, { headers: ada.headers });
    expect(asked).toMatchObject({ friends: [], sent: [grace.uuid], requests: [] });
    // Asking twice is asking once.
    await ok("POST", `/api/friends/${grace.uuid}`, { headers: ada.headers });
    expect(await count("friendships")).toBe(1);

    // Grace is told who asks, by what they both keep in the open, in her inbox and by one email.
    const hers = await friends(grace);
    expect(hers.requests).toMatchObject([{ user: { uuid: ada.uuid, display_name: "Ada" }, common: [{ sha256: digest("a"), title: "Both keep this" }] }]);
    expect((await inbox(grace))[0]).toMatchObject({ content: "Ada asks to be friends.", kind: "friend_request", waiting: true, actor: { uuid: ada.uuid }, link: `/u/${ada.uuid}` });
    const mail = (await rows("SELECT payload FROM jobs WHERE kind = 'send_email'")).map((j) => JSON.parse(j.payload as string));
    expect(mail.map((m) => [m.to, m.subject])).toEqual([["grace@example.test", "Ada asks to be friends on Papol"]]);

    // Only the one asked accepts.
    expect((await call("POST", `/api/friends/${grace.uuid}/accept`, { headers: ada.headers })).status).toBe(404);
    const accepted = await ok("POST", `/api/friends/${ada.uuid}/accept`, { headers: grace.headers });
    expect(accepted).toMatchObject({ friends: [{ user: { uuid: ada.uuid } }], requests: [], sent: [] });
    expect((await friends(ada)).friends).toMatchObject([{ user: { uuid: grace.uuid } }]);
    // The request leaves her inbox; Ada hears it was accepted.
    expect((await inbox(grace)).some((n: any) => n.kind === "friend_request")).toBe(false);
    expect((await inbox(ada))[0]).toMatchObject({ content: "Grace accepted your friend request.", kind: "friend_accepted", actor: { uuid: grace.uuid } });
    expect((await call("GET", "/api/friends")).status).toBe(401);
  });

  it("happens at once when each has asked the other", async () => {
    const ada = await register("ada@example.test", "Ada"), grace = await register("grace@example.test", "Grace");
    await ok("POST", `/api/friends/${grace.uuid}`, { headers: ada.headers });
    const mutual = await ok("POST", `/api/friends/${ada.uuid}`, { headers: grace.headers });
    expect(mutual.friends).toMatchObject([{ user: { uuid: ada.uuid } }]);
    expect(await count("friendships", "state = 'friends'")).toBe(1);
  });

  it("is declined quietly: the asker goes on reading Requested, is never told and cannot ask again", async () => {
    const ada = await register("ada@example.test", "Ada"), grace = await register("grace@example.test", "Grace");
    await ok("POST", `/api/friends/${grace.uuid}`, { headers: ada.headers });
    const declined = await ok("POST", `/api/friends/${ada.uuid}/decline`, { headers: grace.headers });
    expect(declined).toMatchObject({ requests: [], friends: [] });
    expect((await friends(ada)).sent).toEqual([grace.uuid]);
    expect((await inbox(ada)).map((n: any) => n.kind)).toEqual([null]);
    expect((await inbox(grace)).some((n: any) => n.kind === "friend_request")).toBe(false);

    // Taking it back and asking again is not a second request.
    expect((await ok("DELETE", `/api/friends/${grace.uuid}`, { headers: ada.headers })).sent).toEqual([]);
    expect((await ok("POST", `/api/friends/${grace.uuid}`, { headers: ada.headers })).sent).toEqual([grace.uuid]);
    expect((await friends(grace)).requests).toEqual([]);
    expect(await count("notifications", "kind = 'friend_request'")).toBe(0);
    expect(await count("jobs", "kind = 'send_email'")).toBe(1);

    // Grace can change her mind.
    expect((await ok("POST", `/api/friends/${ada.uuid}`, { headers: grace.headers })).friends).toMatchObject([{ user: { uuid: ada.uuid } }]);
  });

  it("is taken back before it is answered, and ended by either without a word", async () => {
    const ada = await register("ada@example.test", "Ada"), grace = await register("grace@example.test", "Grace");
    await ok("POST", `/api/friends/${grace.uuid}`, { headers: ada.headers });
    await ok("DELETE", `/api/friends/${grace.uuid}`, { headers: ada.headers });
    expect(await count("friendships")).toBe(0);
    expect((await inbox(grace)).some((n: any) => n.kind === "friend_request")).toBe(false);

    await befriend(ada, grace);
    const before = (await inbox(ada)).length;
    expect((await ok("DELETE", `/api/friends/${ada.uuid}`, { headers: grace.headers })).friends).toEqual([]);
    expect((await friends(ada)).friends).toEqual([]);
    expect((await inbox(ada)).length).toBe(before);
    // Either may ask again.
    expect((await ok("POST", `/api/friends/${grace.uuid}`, { headers: ada.headers })).sent).toEqual([grace.uuid]);
  });

  it("takes one step through a friend link, which its owner can turn off", async () => {
    const ada = await register("ada@example.test", "Ada"), grace = await register("grace@example.test", "Grace");
    const { link } = await ok("POST", "/api/friends/link", { headers: ada.headers });
    expect(link).toMatch(/^[0-9A-Za-z]{10}$/);
    expect((await ok("POST", "/api/friends/link", { headers: ada.headers })).link).toBe(link);

    expect((await call("GET", `/api/friend-links/${link}`)).status).toBe(401);
    expect(await ok("GET", `/api/friend-links/${link}`, { headers: grace.headers })).toMatchObject({ user: { uuid: ada.uuid, display_name: "Ada" }, is_me: false, is_friend: false });
    expect((await call("POST", `/api/friend-links/${link}`, { headers: ada.headers })).status).toBe(400);
    expect(await ok("POST", `/api/friend-links/${link}`, { headers: grace.headers })).toMatchObject({ is_friend: true });
    expect((await friends(ada)).friends).toMatchObject([{ user: { uuid: grace.uuid } }]);
    expect((await inbox(ada))[0]).toMatchObject({ kind: "friend_accepted", content: "Grace is now your friend, through your friend link." });

    expect((await ok("DELETE", "/api/friends/link", { headers: ada.headers })).link).toBeNull();
    expect((await call("GET", `/api/friend-links/${link}`, { headers: grace.headers })).status).toBe(404);
    expect((await ok("POST", "/api/friends/link", { headers: ada.headers })).link).not.toBe(link);
  });

  it("goes with a closed account", async () => {
    const ada = await register("ada@example.test", "Ada"), grace = await register("grace@example.test", "Grace"), alan = await register("alan@example.test", "Alan");
    await befriend(ada, grace);
    await ok("POST", `/api/friends/${alan.uuid}`, { headers: ada.headers });
    await ok("DELETE", "/api/auth/account", { headers: ada.headers, json: { confirm_email: ada.email } });
    expect(await count("friendships")).toBe(0);
    expect((await friends(grace)).friends).toEqual([]);
    expect((await inbox(alan)).some((n: any) => n.kind === "friend_request")).toBe(false);
  });
});

describe("what a friend sees", () => {
  it("is the digs on papers kept on a public shelf, to read and to post in", async () => {
    const ada = await register("ada@example.test", "Ada"), grace = await register("grace@example.test", "Grace"), alan = await register("alan@example.test", "Alan");
    await paperWithCopy(ada, digest("a"), "Out in the open", { shelfUuid: await defaultShelf(ada) });
    await paperWithCopy(ada, digest("b"), "Kept back", { shelfUuid: await privateShelf(ada) });
    const anchor = await ok("POST", `/api/papers/${name("a")}/annotations`, { headers: ada.headers, json: { kind: "anchor", page: 4, body: { anchor: { x: 0.4, y: 0.25 } } } });
    const onPaper = await ok("POST", "/api/digs", { headers: ada.headers, json: { subject: `paper:${digest("a")}`, text: "The bound in section 3 is loose" } });
    const onAnchor = await ok("POST", "/api/digs", { headers: ada.headers, json: { subject: `annotation:${anchor.uuid}`, text: "Here it fails" } });
    const hidden = await ok("POST", "/api/digs", { headers: ada.headers, json: { subject: `paper:${digest("b")}`, text: "Mine alone" } });
    expect(onPaper.can_post).toBe(false);

    // Before they are friends, nothing.
    expect((await ok("GET", `/api/papers/${name("a")}/friend-digs`, { headers: grace.headers })).digs).toEqual([]);
    expect((await call("GET", `/api/digs/${onPaper.uuid}`, { headers: grace.headers })).status).toBe(404);

    await befriend(ada, grace);
    const seen = await ok("GET", `/api/papers/${name("a")}/friend-digs`, { headers: grace.headers });
    expect(seen.digs.map((d: any) => [d.uuid, d.excerpt, d.owner.uuid, d.subject.page ?? null])).toEqual([
      [onPaper.uuid, "The bound in section 3 is loose", ada.uuid, null],
      [onAnchor.uuid, "Here it fails", ada.uuid, 4],
    ]);
    expect((await ok("GET", `/api/papers/${name("b")}/friend-digs`, { headers: grace.headers })).digs).toEqual([]);
    expect((await call("GET", `/api/digs/${hidden.uuid}`, { headers: grace.headers })).status).toBe(404);
    // Someone who is not a friend still sees none of it.
    expect((await ok("GET", `/api/papers/${name("a")}/friend-digs`, { headers: alan.headers })).digs).toEqual([]);
    expect((await call("GET", `/api/digs/${onPaper.uuid}`, { headers: alan.headers })).status).toBe(404);

    // A friend reads it and posts in it; only its owner rewords or removes it.
    expect(await ok("GET", `/api/digs/${onPaper.uuid}`, { headers: grace.headers })).toMatchObject({ is_mine: false, project: null, can_post: true, text: "The bound in section 3 is loose" });
    const posted = await ok("POST", `/api/digs/${onPaper.uuid}/posts`, { headers: grace.headers, json: { body: "Tight for d = 2 though" } });
    expect(posted.posts).toMatchObject([{ body: "Tight for d = 2 though", is_mine: true }]);
    expect((await call("PUT", `/api/digs/${onPaper.uuid}`, { headers: grace.headers, json: { text: "mine" } })).status).toBe(403);
    expect((await call("DELETE", `/api/digs/${onPaper.uuid}`, { headers: grace.headers })).status).toBe(403);
    expect((await call("PUT", `/api/digs/${onPaper.uuid}/phase`, { headers: grace.headers, json: { phase: "gold" } })).status).toBe(403);
    expect((await call("POST", `/api/digs/${onPaper.uuid}/posts`, { headers: alan.headers, json: { body: "?" } })).status).toBe(404);

    // Ada hears of it, and can answer now that somebody has posted.
    expect((await inbox(ada))[0]).toMatchObject({ kind: "dig_post", content: "Grace posted in your dig on Out in the open.", link: `/paper/${name("a")}` });
    expect((await ok("GET", `/api/digs/${onPaper.uuid}`, { headers: ada.headers })).can_post).toBe(true);
    await ok("POST", `/api/digs/${onPaper.uuid}/posts`, { headers: ada.headers, json: { body: "Fair" } });
    expect((await inbox(grace))[0]).toMatchObject({ kind: "dig_post", content: "Ada posted in their dig on Out in the open." });

    // The shelf has the last word: private, and the dig is hers alone again; public, and it is back.
    await ok("PUT", `/api/papers/${name("a")}`, { headers: ada.headers, json: { shelf_uuid: await privateShelf(ada) } });
    expect((await ok("GET", `/api/papers/${name("a")}/friend-digs`, { headers: grace.headers })).digs).toEqual([]);
    expect((await call("GET", `/api/digs/${onPaper.uuid}`, { headers: grace.headers })).status).toBe(404);
    await ok("PUT", `/api/papers/${name("a")}`, { headers: ada.headers, json: { shelf_uuid: await defaultShelf(ada) } });
    expect((await ok("GET", `/api/digs/${onPaper.uuid}`, { headers: grace.headers })).posts.length).toBe(2);

    // Ending the friendship closes it again; what was posted stays.
    await ok("DELETE", `/api/friends/${ada.uuid}`, { headers: grace.headers });
    expect((await call("GET", `/api/digs/${onPaper.uuid}`, { headers: grace.headers })).status).toBe(404);
    expect((await ok("GET", `/api/digs/${onPaper.uuid}`, { headers: ada.headers })).posts.map((p: any) => p.body)).toEqual(["Tight for d = 2 though", "Fair"]);
  });
});

describe("the Lounge", () => {
  it("is empty until there is a friend, then the friends' own news, a paper to a row", async () => {
    const ada = await register("ada@example.test", "Ada"), grace = await register("grace@example.test", "Grace"), alan = await register("alan@example.test", "Alan");
    await paperWithCopy(grace, digest("a"), "Grace's paper", { shelfUuid: await defaultShelf(grace) });
    await ok("PUT", `/api/papers/${name("a")}`, { headers: grace.headers, json: { thought: "A classic" } });
    await ok("POST", `/api/papers/${name("a")}/add-to-nook`, { headers: alan.headers, json: {} });
    await paperWithCopy(alan, digest("b"), "Alan's paper", { shelfUuid: await defaultShelf(alan) });
    await paperWithCopy(alan, digest("c"), "Alan's secret", { shelfUuid: await privateShelf(alan) });
    const dig = await ok("POST", "/api/digs", { headers: grace.headers, json: { subject: `paper:${digest("a")}`, text: "Section 2 is the heart of it" } });

    // No friends yet: nothing, whatever is asked for. A stranger's public news is not the room's.
    expect(await room(ada)).toMatchObject({ friend_count: 0, rows: [] });
    expect((await room(ada, "?view=everyone")).rows).toEqual([]);
    const papers = (rs: any) => rs.rows.filter((r: any) => r.kind === "paper");

    await befriend(ada, grace);
    const mine = await room(ada);
    expect(mine).toMatchObject({ friend_count: 1 });
    expect(mine).not.toHaveProperty("view");
    expect(papers(mine)[0].in_my_nook).toBe(false);
    expect(papers(mine).map((r: any) => r.paper.title)).toEqual(["Grace's paper"]);
    expect(papers(mine)[0].lines.map((l: any) => [l.did, l.words])).toEqual(expect.arrayContaining([["added", "A classic"], ["dug", "Section 2 is the heart of it"]]));
    expect(papers(mine)[0].lines.find((l: any) => l.did === "dug").dig).toMatchObject({ uuid: dig.uuid, page: null, post_count: 0 });
    // The room is papers, boards and projects: a friendship is not a row.
    expect(mine.rows.every((r: any) => ["paper", "board", "project"].includes(r.kind))).toBe(true);
    // Alan, who is nobody's friend, sees nothing of it.
    expect((await room(alan)).rows).toEqual([]);

    // A thought kept private says nothing; a paper moved to a private shelf leaves the room.
    await ok("PUT", `/api/papers/${name("a")}`, { headers: grace.headers, json: { thought_public: false } });
    expect(papers(await room(ada))[0].lines.find((l: any) => l.did === "added").words).toBeNull();
    await ok("PUT", `/api/papers/${name("a")}`, { headers: grace.headers, json: { shelf_uuid: await privateShelf(grace) } });
    expect(papers(await room(ada))).toEqual([]);
  });

  it("marks what came since it was last opened, and tells the bar", async () => {
    const ada = await register("ada@example.test", "Ada"), grace = await register("grace@example.test", "Grace");
    expect(await ok("GET", "/api/room/news", { headers: ada.headers })).toEqual({ news: false });
    // Someone asking is the Inbox's to say: the room has no news of it.
    await ok("POST", `/api/friends/${ada.uuid}`, { headers: grace.headers });
    expect(await ok("GET", "/api/room/news", { headers: ada.headers })).toEqual({ news: false });
    expect(await room(ada)).not.toHaveProperty("requests");
    await ok("POST", `/api/friends/${grace.uuid}/accept`, { headers: ada.headers });

    await exec("UPDATE users SET room_seen_at = ? WHERE uuid = ?", new Date(Date.now() - 60_000).toISOString(), ada.uuid);
    await paperWithCopy(grace, digest("a"), "Old news", { shelfUuid: await defaultShelf(grace) });
    await exec("UPDATE copies SET created_at = ? WHERE paper_sha256 = ?", new Date(Date.now() - 3_600_000).toISOString(), digest("a"));
    expect((await ok("GET", "/api/room/news", { headers: ada.headers })).news).toBe(false);
    await paperWithCopy(grace, digest("b"), "Fresh", { shelfUuid: await defaultShelf(grace) });
    expect((await ok("GET", "/api/room/news", { headers: ada.headers })).news).toBe(true);
    const seen = (await room(ada)).rows.filter((r: any) => r.kind === "paper").map((r: any) => [r.paper.title, r.is_new]);
    expect(seen).toEqual([["Fresh", true], ["Old news", false]]);

    expect((await call("POST", "/api/room/seen", { headers: ada.headers })).status).toBe(204);
    expect((await ok("GET", "/api/room/news", { headers: ada.headers })).news).toBe(false);
    expect((await room(ada)).rows.some((r: any) => r.is_new)).toBe(false);
  });

  it("says when a thought or a rating changed, and not when a copy only moved", async () => {
    const ada = await register("ada@example.test", "Ada"), grace = await register("grace@example.test", "Grace");
    await befriend(ada, grace);
    await paperWithCopy(grace, digest("a"), "Long kept", { shelfUuid: await defaultShelf(grace) });
    await exec("UPDATE copies SET created_at = ? WHERE paper_sha256 = ?", new Date(Date.now() - 60 * 24 * 3_600_000).toISOString(), digest("a"));
    const papers = async () => (await room(ada)).rows.filter((r: any) => r.kind === "paper");
    expect(await papers()).toEqual([]);

    // A move between shelves is not news.
    await ok("PUT", `/api/papers/${name("a")}`, { headers: grace.headers, json: { is_author: true } });
    expect(await papers()).toEqual([]);
    await ok("PUT", `/api/papers/${name("a")}`, { headers: grace.headers, json: { thought: "Better on a second reading", rating_liking: 5 } });
    const [changed] = await papers();
    expect(changed.lines.map((l: any) => [l.did, l.words ?? null, l.ratings?.liking ?? null]).sort()).toEqual([["rated", null, 5], ["thought", "Better on a second reading", null]]);
    // Ratings kept private say nothing.
    await ok("PUT", `/api/papers/${name("a")}`, { headers: grace.headers, json: { ratings_public: false } });
    expect((await papers())[0].lines.map((l: any) => l.did)).toEqual(["thought"]);
  });

  it("keeps a folder brought in at once out of the room", async () => {
    const ada = await register("ada@example.test", "Ada"), grace = await register("grace@example.test", "Grace");
    await befriend(ada, grace);
    const shelf = await defaultShelf(grace);
    for (const letter of ["1", "2", "3", "4", "5", "6", "7"]) await paperWithCopy(grace, digest(letter), `Paper ${letter}`, { shelfUuid: shelf });
    await ok("PUT", `/api/papers/${name("7")}`, { headers: grace.headers, json: { thought: "The one to start with" } });
    const got = await room(ada);
    expect(got.rows.some((r: any) => r.kind === "batch")).toBe(false);
    // Only the one she said something about has a row.
    expect(got.rows.filter((r: any) => r.kind === "paper").map((r: any) => r.paper.title)).toEqual(["Paper 7"]);
  });

  it("shows a friend's reading only once they turn it on, and never the hours", async () => {
    const ada = await register("ada@example.test", "Ada"), grace = await register("grace@example.test", "Grace");
    await befriend(ada, grace);
    await paperWithCopy(grace, digest("a"), "Being read", { shelfUuid: await defaultShelf(grace) });
    await exec("UPDATE copies SET created_at = ? WHERE paper_sha256 = ?", new Date(Date.now() - 60 * 24 * 3_600_000).toISOString(), digest("a"));
    const at = new Date(Date.now() - 3_600_000).toISOString();
    await exec("INSERT INTO activity (uuid, user_uuid, kind, subject, started_at, ended_at, seconds) VALUES (?, ?, 'reading', ?, ?, ?, 1200)", uuid(), grace.uuid, digest("a"), at, at);
    const lines = async () => (await room(ada)).rows.filter((r: any) => r.kind === "paper").flatMap((r: any) => r.lines);
    expect(await lines()).toEqual([]);
    expect((await friends(grace)).shares_reading).toBe(false);

    expect((await ok("PUT", "/api/friends/settings", { headers: grace.headers, json: { shares_reading: true } })).shares_reading).toBe(true);
    const [reading] = await lines();
    expect(reading).toMatchObject({ did: "reading", user: { uuid: grace.uuid } });
    expect(reading.at).toBe(`${at.slice(0, 10)}T00:00:00.000Z`);
    expect(JSON.stringify(reading)).not.toContain("1200");
    // On a private shelf it is hers alone, shared or not.
    await ok("PUT", `/api/papers/${name("a")}`, { headers: grace.headers, json: { shelf_uuid: await privateShelf(grace) } });
    expect(await lines()).toEqual([]);
  });

  it("shows a project someone started, and lets the reader ask its keeper once to be let in", async () => {
    const ada = await register("ada@example.test", "Ada"), grace = await register("grace@example.test", "Grace");
    await befriend(ada, grace);
    const project = await ok("POST", "/api/projects", { headers: grace.headers, json: { name: "Effects" } });
    const shown = (await room(ada)).rows.find((r: any) => r.kind === "project");
    expect(shown).toMatchObject({ project: { uuid: project.uuid, name: "Effects", is_member: false, asked: false }, lines: [{ did: "started", user: { uuid: grace.uuid } }] });
    // Her own project is not news to her.
    expect((await room(grace)).rows.some((r: any) => r.kind === "project")).toBe(false);

    expect(await ok("POST", `/api/projects/${project.uuid}/ask`, { headers: ada.headers })).toEqual({ asked: true });
    await ok("POST", `/api/projects/${project.uuid}/ask`, { headers: ada.headers });
    expect((await inbox(grace)).filter((n: any) => n.kind === "project_ask")).toMatchObject([{ content: "Ada asks to join Effects.", link: `/project/${project.uuid}`, actor: { uuid: ada.uuid } }]);
    expect((await room(ada)).rows.find((r: any) => r.kind === "project").project.asked).toBe(true);
    expect((await call("POST", `/api/projects/${project.uuid}/ask`, { headers: grace.headers })).status).toBe(400);
  });
});
