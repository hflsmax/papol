// Threads: something selected in a paper, sent to the Lounge for the
// sender's friends to reply to. Seen by the starter and their friends,
// by nobody else, and nowhere but the Lounge.
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { call, count, ok, paperWithCopy, register, sha256, uuid, type Account } from "./helpers";

const DIGEST = "d".repeat(64);
const room = async (account: Account) => (await ok("GET", "/api/room", { headers: account.headers })).rows as Record<string, any>[];
const news = async (account: Account) => (await ok("GET", "/api/room/news", { headers: account.headers })).news;
const seen = (account: Account) => call("POST", "/api/room/seen", { headers: account.headers });
const passage = { paper_sha256: DIGEST, page: 3, y: 0.42, mark: btoa("[[3,0.1,0.9,0.42,0.02]]"), excerpt: "  The gain flattens\nbeyond eight heads. ", words: "Does this hold for our loop?" };
const start = (account: Account, json: unknown = passage) => call("POST", "/api/threads", { headers: account.headers, json });
const reply = (account: Account, thread: string, body: string) => call("POST", `/api/threads/${thread}/replies`, { headers: account.headers, json: { body } });

async function befriend(a: Account, b: Account) {
  await ok("POST", `/api/friends/${b.uuid}`, { headers: a.headers });
  await ok("POST", `/api/friends/${a.uuid}/accept`, { headers: b.headers });
}

describe("threads in the Lounge", () => {
  it("are started from a place in a paper, and shown to the starter and their friends alone", async () => {
    const ada = await register("ada@example.test", "Ada"), grace = await register("grace@example.test", "Grace"), alan = await register("alan@example.test", "Alan");
    await paperWithCopy(ada, DIGEST, "Attention at depth");
    await befriend(ada, grace);
    const made = await (await start(ada)).json() as Record<string, any>;
    expect(made).toMatchObject({
      user: { uuid: ada.uuid, display_name: "Ada" }, is_mine: true, paper_sha256: DIGEST, page: 3, y: 0.42, mark: passage.mark, box: null,
      excerpt: "The gain flattens\nbeyond eight heads.", picture_url: null, words: "Does this hold for our loop?", replies: [],
    });

    // Ada reads her own thread in her Lounge; Grace reads it as news.
    expect(await room(ada)).toMatchObject([{ kind: "thread", key: `thread:${made.uuid}`, is_new: false, thread: { uuid: made.uuid, is_mine: true }, paper: { sha256: DIGEST, title: "Attention at depth" }, lines: [{ user: { uuid: ada.uuid }, did: "started" }] }]);
    const hers = (await room(grace)).filter((row) => row.kind === "thread");
    expect(hers).toMatchObject([{ thread: { uuid: made.uuid, is_mine: false, excerpt: made.excerpt, words: made.words } }]);
    // One thread, as its jacket reads it, names its paper.
    expect(await ok("GET", `/api/threads/${made.uuid}`, { headers: grace.headers })).toMatchObject({ uuid: made.uuid, paper: { sha256: DIGEST, title: "Attention at depth" } });

    // Alan is nobody's friend: no row, no thread, no reply.
    expect((await room(alan)).filter((row) => row.kind === "thread")).toEqual([]);
    expect((await call("GET", `/api/threads/${made.uuid}`, { headers: alan.headers })).status).toBe(404);
    expect((await reply(alan, made.uuid, "Let me in")).status).toBe(404);
    expect((await call("GET", `/api/threads/${made.uuid}`)).status).toBe(401);
    // A friend of a friend is not a friend.
    await befriend(grace, alan);
    expect((await call("GET", `/api/threads/${made.uuid}`, { headers: alan.headers })).status).toBe(404);
  });

  it("are replied to by whoever sees them, and a reply by someone else is news", async () => {
    const ada = await register("ada@example.test", "Ada"), grace = await register("grace@example.test", "Grace"), alan = await register("alan@example.test", "Alan");
    await paperWithCopy(ada, DIGEST, "Attention at depth");
    await befriend(ada, grace);
    await befriend(ada, alan);
    await seen(ada); await seen(grace); await seen(alan);
    await new Promise((done) => setTimeout(done, 5));
    const made = await (await start(ada)).json() as Record<string, any>;
    // Her own thread is not news to her; it is to her friends.
    expect(await news(ada)).toBe(false);
    expect(await news(grace)).toBe(true);
    await seen(grace);
    await new Promise((done) => setTimeout(done, 5));

    const after = await (await reply(grace, made.uuid, "  It does not: Table 3 is translation only. ")).json() as Record<string, any>;
    expect(after.replies).toMatchObject([{ user: { uuid: grace.uuid }, body: "It does not: Table 3 is translation only.", is_mine: true }]);
    expect(await news(grace)).toBe(false);
    expect(await news(ada)).toBe(true);
    // Alan is not Grace's friend, and reads her reply all the same: it is in Ada's thread.
    const his = (await room(alan)).find((row) => row.kind === "thread")!;
    expect(his).toMatchObject({ is_new: true, thread: { replies: [{ user: { uuid: grace.uuid }, is_mine: false }] }, lines: [{ user: { uuid: ada.uuid }, did: "started" }, { user: { uuid: grace.uuid }, did: "replied" }] });
    expect(his.at).toBe(after.replies[0].created_at);
    expect((await reply(alan, made.uuid, "")).status).toBe(422);
    expect((await reply(alan, made.uuid, "x".repeat(20001))).status).toBe(422);

    // A reply is taken back by its writer alone; the thread by its starter alone, replies and all.
    await reply(alan, made.uuid, "Then we test it.");
    const alans = (await ok("GET", `/api/threads/${made.uuid}`, { headers: alan.headers })).replies[1].uuid;
    expect((await call("DELETE", `/api/thread-replies/${alans}`, { headers: ada.headers })).status).toBe(404);
    expect((await ok("DELETE", `/api/thread-replies/${alans}`, { headers: alan.headers })).replies).toHaveLength(1);
    expect((await call("DELETE", `/api/threads/${made.uuid}`, { headers: grace.headers })).status).toBe(403);
    await ok("DELETE", `/api/threads/${made.uuid}`, { headers: ada.headers });
    expect(await count("threads")).toBe(0);
    expect(await count("thread_replies")).toBe(0);
    expect((await room(grace)).filter((row) => row.kind === "thread")).toEqual([]);
  });

  it("are reworded by whoever said it, and rewording is not news", async () => {
    const ada = await register("ada@example.test", "Ada"), grace = await register("grace@example.test", "Grace"), alan = await register("alan@example.test", "Alan");
    await paperWithCopy(ada, DIGEST, "Attention at depth");
    await befriend(ada, grace);
    const made = await (await start(ada)).json() as Record<string, any>;
    expect(made.edited_at).toBeNull();
    const replied = await (await reply(grace, made.uuid, "It does not.")).json() as Record<string, any>;
    const graces = replied.replies[0];
    expect(graces.edited_at).toBeNull();
    await seen(ada); await seen(grace);
    await new Promise((done) => setTimeout(done, 5));
    const words = (json: unknown, account = ada, thread = made.uuid) => call("PUT", `/api/threads/${thread}`, { headers: account.headers, json });
    const body = (json: unknown, account = grace) => call("PUT", `/api/thread-replies/${graces.uuid}`, { headers: account.headers, json });

    // The starter rewords their own words; what was selected stays as sent.
    const reworded = await (await words({ words: "  Does this hold for **our** loop?  ", excerpt: "Something else", page: 9 })).json() as Record<string, any>;
    expect(reworded).toMatchObject({ uuid: made.uuid, words: "Does this hold for **our** loop?", excerpt: made.excerpt, page: 3, created_at: made.created_at, paper: { sha256: DIGEST } });
    expect(reworded.edited_at).toBeTruthy();
    // A thread from a paper can lose its words: the passage is left to read.
    expect((await (await words({ words: "  " })).json() as Record<string, any>).words).toBeNull();
    expect((await (await words({ words: "Back again." })).json() as Record<string, any>).words).toBe("Back again.");
    // Nobody else rewords it: a friend who sees it, or someone who does not.
    expect((await words({ words: "Mine now" }, grace)).status).toBe(403);
    expect((await words({ words: "Mine now" }, alan)).status).toBe(404);
    expect((await words({ words: "x".repeat(20001) })).status).toBe(422);

    // A reply is reworded by its writer alone, and never to nothing.
    const after = await (await body({ body: "  It does not: Table 3 is translation only. " })).json() as Record<string, any>;
    expect(after.replies).toMatchObject([{ uuid: graces.uuid, body: "It does not: Table 3 is translation only.", created_at: graces.created_at, is_mine: true }]);
    expect(after.replies[0].edited_at).toBeTruthy();
    expect((await body({ body: "Not what she said" }, ada)).status).toBe(404);
    expect((await body({ body: "   " })).status).toBe(422);
    expect((await body({})).status).toBe(422);
    // Saved as it was, nothing is marked as changed.
    const same = await (await body({ body: after.replies[0].body })).json() as Record<string, any>;
    expect(same.replies[0].edited_at).toBe(after.replies[0].edited_at);

    // Rewording is not news, and moves the thread nowhere in the room.
    expect(await news(ada)).toBe(false);
    expect(await news(grace)).toBe(false);
    expect((await room(ada))[0]).toMatchObject({ at: graces.created_at, is_new: false, thread: { words: "Back again.", replies: [{ body: after.replies[0].body }] } });

    // Words alone are the whole of a thread started in the Lounge, so they cannot be taken away.
    const plain = await (await start(ada, { words: "Is anyone going?" })).json() as Record<string, any>;
    expect((await words({ words: "" }, ada, plain.uuid)).status).toBe(422);
    expect((await words({}, ada, plain.uuid)).status).toBe(422);
    // A reply cannot be reworded once its writer no longer sees the thread.
    await ok("DELETE", `/api/friends/${ada.uuid}`, { headers: grace.headers });
    expect((await body({ body: "After we parted" })).status).toBe(404);
  });

  it("start in the Lounge itself, from no paper, with words alone", async () => {
    const ada = await register("ada@example.test", "Ada"), grace = await register("grace@example.test", "Grace");
    await befriend(ada, grace);
    const made = await (await start(ada, { words: "  Is anyone going to the adaptive optics meeting?  " })).json() as Record<string, any>;
    expect(made).toMatchObject({ is_mine: true, paper_sha256: null, page: null, y: null, excerpt: null, picture_url: null, words: "Is anyone going to the adaptive optics meeting?", paper: null, replies: [] });
    expect((await room(grace)).filter((row) => row.kind === "thread")).toMatchObject([{ thread: { uuid: made.uuid }, paper: null }]);
    expect((await ok("POST", `/api/threads/${made.uuid}/replies`, { headers: grace.headers, json: { body: "I am." } })).replies).toHaveLength(1);
    // Words are the whole of it, and nothing from a paper comes without the paper.
    expect((await start(ada, {})).status).toBe(422);
    expect((await start(ada, { words: "   " })).status).toBe(422);
    expect((await start(ada, { words: "Look", excerpt: "selected" })).status).toBe(422);
    expect((await start(ada, { ...passage, paper_sha256: undefined })).status).toBe(422);
  });

  it("leave with the friendship, and with a closed account", async () => {
    const ada = await register("ada@example.test", "Ada"), grace = await register("grace@example.test", "Grace");
    await paperWithCopy(ada, DIGEST, "Attention at depth");
    await befriend(ada, grace);
    const made = await (await start(ada)).json() as Record<string, any>;
    const graces = await (await start(grace, { ...passage, words: null })).json() as Record<string, any>;
    await reply(grace, made.uuid, "Mine to take along.");
    await reply(ada, graces.uuid, "And mine.");
    await ok("DELETE", `/api/friends/${ada.uuid}`, { headers: grace.headers });
    expect((await call("GET", `/api/threads/${made.uuid}`, { headers: grace.headers })).status).toBe(404);
    expect((await room(grace)).map((row) => row.key)).toEqual([`thread:${graces.uuid}`]);
    await ok("DELETE", "/api/auth/account", { headers: grace.headers, json: { confirm_email: "grace@example.test" } });
    expect(await count("threads")).toBe(1);
    expect(await count("thread_replies")).toBe(0);
  });

  it("carry the pictures and files their starter attached, and let them go with the thread", async () => {
    const ada = await register("ada@example.test", "Ada"), grace = await register("grace@example.test", "Grace");
    await befriend(ada, grace);
    const photo = await sha256("a jpeg"), notes = await sha256("a zip");
    const files = [{ sha256: photo, name: "whiteboard.jpg", mime: "image/jpeg", size: 6 }, { sha256: notes, name: 'notes "v2".zip', mime: "application/zip", size: 5 }];
    // Not before the bytes are in.
    expect((await start(ada, { words: "From today", files })).status).toBe(409);
    await env.FILES.put(`board_uploads/blobs/${photo}`, "a jpeg");
    await env.FILES.put(`board_uploads/blobs/${notes}`, "a zip");
    const made = await (await start(ada, { files })).json() as Record<string, any>;
    expect(made).toMatchObject({ words: null, files: [{ name: "whiteboard.jpg", is_picture: true, size: 6 }, { name: 'notes "v2".zip', is_picture: false, mime: "application/zip" }] });
    // Her friend reads them in the room, and fetches each: a picture as itself, a file as a download.
    const row = (await room(grace)).find((r) => r.kind === "thread")!;
    expect(row.thread.files).toHaveLength(2);
    const picture = await call("GET", row.thread.files[0].url);
    expect([picture.headers.get("content-type"), await picture.text()]).toEqual(["image/jpeg", "a jpeg"]);
    const file = await call("GET", row.thread.files[1].url);
    expect([file.headers.get("content-type"), file.headers.get("content-disposition")]).toEqual(["application/octet-stream", 'attachment; filename="notes v2.zip"']);
    await file.text();
    // Refused: too many, on a thread from a paper, or shaped wrong.
    expect((await start(ada, { words: "x", files: Array(9).fill(files[0]) })).status).toBe(422);
    expect((await start(ada, { ...passage, files })).status).toBe(422);
    expect((await start(ada, { words: "x", files: [{ sha256: "nope", name: "a", size: 1 }] })).status).toBe(422);
    // A second thread names the photo too, so removing the first keeps it and drops the zip.
    const other = await (await start(ada, { words: "Again", files: [files[0]] })).json() as Record<string, any>;
    await ok("DELETE", `/api/threads/${made.uuid}`, { headers: ada.headers });
    expect(await count("thread_files")).toBe(1);
    expect([await env.FILES.head(`board_uploads/blobs/${photo}`) !== null, await env.FILES.head(`board_uploads/blobs/${notes}`) !== null]).toEqual([true, false]);
    // Closing the account takes the rest.
    await ok("DELETE", "/api/auth/account", { headers: ada.headers, json: { confirm_email: "ada@example.test" } });
    expect([await count("thread_files"), await env.FILES.head(`board_uploads/blobs/${photo}`)]).toEqual([0, null]);
    expect(other.files).toHaveLength(1);
  });

  it("can start from a clipped picture, once its bytes are in", async () => {
    const ada = await register();
    await paperWithCopy(ada, DIGEST, "Attention at depth");
    const picture = await sha256("a png");
    const clip = { paper_sha256: DIGEST, page: 2, y: 0.3, box: btoa("[2,0.1,0.2,0.5,0.3]"), picture_sha256: picture };
    expect((await start(ada, clip)).status).toBe(409);
    await env.FILES.put(`board_uploads/blobs/${picture}`, "a png");
    const made = await (await start(ada, clip)).json() as Record<string, any>;
    expect(made).toMatchObject({ excerpt: null, words: null, box: clip.box, mark: null });
    // With no bucket address to give, the Worker serves it by the thread's name.
    expect(made.picture_url).toBe(`/api/threads/${made.uuid}/picture`);
    const served = await call("GET", made.picture_url);
    expect([served.status, served.headers.get("content-type"), await served.text()]).toEqual([200, "image/png", "a png"]);
    expect((await call("GET", `/api/threads/${uuid()}/picture`)).status).toBe(404);
  });

  it("refuse what is no passage, no place or no paper", async () => {
    const ada = await register();
    await paperWithCopy(ada, DIGEST, "Attention at depth");
    for (const bad of [
      { ...passage, excerpt: "   " },
      { ...passage, excerpt: undefined },
      { ...passage, excerpt: "x".repeat(10001) },
      { ...passage, page: 0 },
      { ...passage, y: 1.5 },
      { ...passage, mark: "not base64 <script>" },
      { ...passage, paper_sha256: "abc" },
      { ...passage, words: 7 },
    ]) expect((await start(ada, bad)).status, JSON.stringify(bad).slice(0, 80)).toBe(422);
    expect((await start(ada, { ...passage, paper_sha256: "e".repeat(64) })).status).toBe(404);
    expect((await call("POST", "/api/threads", { json: passage })).status).toBe(401);
    expect(await count("threads")).toBe(0);
  });
});
