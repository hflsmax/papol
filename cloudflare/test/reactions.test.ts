// Reactions: an emoji set on a thread, a reply, a dig or a post in one.
// Each is a reply or a post of a special sort, kept where those are, so
// whoever sees the thing sees its reactions and sets their own, nobody
// else does, and nothing counts one as something said.
import { describe, expect, it } from "vitest";

import { call, count, defaultShelf, ok, paperWithCopy, register, rows, uuid, type Account } from "./helpers";

const DIGEST = "e".repeat(64);
const start = async (account: Account, words = "Has anyone fitted the delay per night?") => ok("POST", "/api/threads", { headers: account.headers, json: { words } });
const reply = async (account: Account, thread: string, body: string) => ok("POST", `/api/threads/${thread}/replies`, { headers: account.headers, json: { body } });
const react = (account: Account, kind: string, on: string, emoji: unknown = "👍") => call("PUT", `/api/reactions/${kind}/${on}`, { headers: account.headers, json: { emoji } });
const unreact = (account: Account, kind: string, on: string, emoji = "👍") => call("DELETE", `/api/reactions/${kind}/${on}?emoji=${encodeURIComponent(emoji)}`, { headers: account.headers });
// How many reactions are kept, in threads and in digs.
const kept = async () => (await count("thread_replies", "emoji IS NOT NULL")) + (await count("dig_posts", "emoji IS NOT NULL"));
const reacted = async (response: Response) => { expect(response.status).toBe(200); return (await response.json() as { reactions: unknown[] }).reactions; };

async function befriend(a: Account, b: Account) {
  await ok("POST", `/api/friends/${b.uuid}`, { headers: a.headers });
  await ok("POST", `/api/friends/${a.uuid}/accept`, { headers: b.headers });
}

describe("reactions", () => {
  it("are set on a thread and its replies by whoever sees the thread, and by nobody else", async () => {
    const ada = await register("ada@example.test", "Ada"), grace = await register("grace@example.test", "Grace"), alan = await register("alan@example.test", "Alan");
    await befriend(ada, grace);
    const thread = await start(ada);
    expect(thread.reactions).toEqual([]);
    const said = (await reply(grace, thread.uuid, "Once per night, last spring.")).replies[0];
    expect(said.reactions).toEqual([]);

    // Each emoji once per person, counted, in the order first set, with who set it.
    expect(await reacted(await react(grace, "thread", thread.uuid))).toEqual([{ emoji: "👍", count: 1, mine: true, who: ["Grace"] }]);
    expect(await reacted(await react(grace, "thread", thread.uuid))).toEqual([{ emoji: "👍", count: 1, mine: true, who: ["Grace"] }]);
    await react(grace, "thread", thread.uuid, "🎉");
    expect(await reacted(await react(ada, "thread", thread.uuid))).toEqual([
      { emoji: "👍", count: 2, mine: true, who: ["Grace", "Ada"] }, { emoji: "🎉", count: 1, mine: false, who: ["Grace"] },
    ]);
    expect(await reacted(await react(ada, "reply", said.uuid, "💡"))).toEqual([{ emoji: "💡", count: 1, mine: true, who: ["Ada"] }]);

    // The thread carries them, on its jacket and in the Lounge, as each reader sees them.
    const read = await ok("GET", `/api/threads/${thread.uuid}`, { headers: grace.headers });
    expect(read.reactions).toEqual([{ emoji: "👍", count: 2, mine: true, who: ["Grace", "Ada"] }, { emoji: "🎉", count: 1, mine: true, who: ["Grace"] }]);
    expect(read.replies[0].reactions).toEqual([{ emoji: "💡", count: 1, mine: false, who: ["Ada"] }]);
    const row = ((await ok("GET", "/api/room", { headers: ada.headers })).rows as Record<string, any>[]).find((r) => r.kind === "thread");
    expect(row?.thread.reactions).toMatchObject([{ emoji: "👍", count: 2, mine: true }, { emoji: "🎉", count: 1, mine: false }]);
    expect(row?.thread.replies[0].reactions).toMatchObject([{ emoji: "💡", mine: true }]);

    // Alan is nobody's friend: he neither sets one nor takes one back, and a visitor is asked to sign in.
    expect((await react(alan, "thread", thread.uuid)).status).toBe(404);
    expect((await react(alan, "reply", said.uuid)).status).toBe(404);
    expect((await unreact(alan, "thread", thread.uuid)).status).toBe(404);
    expect((await call("PUT", `/api/reactions/thread/${thread.uuid}`, { json: { emoji: "👍" } })).status).toBe(401);
    // A friend of a replier alone does not see the thread.
    await befriend(grace, alan);
    expect((await react(alan, "reply", said.uuid)).status).toBe(404);

    // One's own is taken back; another's stays.
    expect(await reacted(await unreact(ada, "thread", thread.uuid))).toEqual([{ emoji: "👍", count: 1, mine: false, who: ["Grace"] }, { emoji: "🎉", count: 1, mine: false, who: ["Grace"] }]);
    expect(await reacted(await unreact(ada, "thread", thread.uuid, "🎉"))).toHaveLength(2);

    // Only what Papol offers, and only on what takes one.
    expect((await react(ada, "thread", thread.uuid, "x")).status).toBe(422);
    expect((await react(ada, "thread", thread.uuid, null)).status).toBe(422);
    expect((await react(ada, "paper", thread.uuid)).status).toBe(404);
    expect((await react(ada, "thread", uuid())).status).toBe(404);
    expect((await react(ada, "post", uuid())).status).toBe(404);
  });

  it("are nothing said: no reply, no post, no news in the Lounge, and not theirs to edit as one", async () => {
    const ada = await register("ada@example.test", "Ada"), grace = await register("grace@example.test", "Grace");
    await paperWithCopy(ada, DIGEST, "Attention at depth", { shelfUuid: await defaultShelf(ada) });
    await befriend(ada, grace);
    const thread = await start(ada);
    const dig = await ok("POST", "/api/digs", { headers: ada.headers, json: { subject: `paper:${DIGEST}`, text: "The gain flattens." } });
    await ok("POST", "/api/room/seen", { headers: ada.headers });
    await new Promise((done) => setTimeout(done, 5));
    const told = await count("notifications", "user_uuid = ?", ada.uuid);
    await react(grace, "thread", thread.uuid);
    await react(grace, "dig", dig.uuid);
    await react(ada, "dig", dig.uuid, "🎉");

    // The thread has no replies and one face; the Lounge holds no news of it.
    const read = await ok("GET", `/api/threads/${thread.uuid}`, { headers: ada.headers });
    expect(read.replies).toEqual([]);
    const row = ((await ok("GET", "/api/room", { headers: ada.headers })).rows as Record<string, any>[]).find((r) => r.kind === "thread");
    expect(row).toMatchObject({ is_new: false, at: thread.created_at, lines: [{ did: "started" }] });
    expect((await ok("GET", "/api/room/news", { headers: ada.headers })).news).toBe(false);
    // Told one way only: a line in her inbox for each emoji a friend set, and no email.
    expect(await count("notifications", "user_uuid = ?", ada.uuid)).toBe(told + 2);
    expect(await count("notifications", "user_uuid = ? AND kind = 'reaction'", ada.uuid)).toBe(2);
    expect(await count("email_held", "user_uuid = ?", ada.uuid)).toBe(0);

    // The dig has no posts, and its writer still waits for a friend to post before answering.
    const dug = await ok("GET", `/api/digs/${dig.uuid}`, { headers: ada.headers });
    expect(dug).toMatchObject({ posts: [], can_post: false });
    expect((await ok("GET", `/api/papers/${DIGEST.slice(0, 32)}/friend-digs`, { headers: grace.headers })).digs).toMatchObject([{ uuid: dig.uuid, post_count: 0, voices: [{ uuid: ada.uuid }] }]);

    // A reaction is not reworded or taken back as a reply or a post is, nor reacted to.
    const inThread = (await rows<{ uuid: string }>("SELECT uuid FROM thread_replies WHERE emoji IS NOT NULL"))[0].uuid;
    const inDig = (await rows<{ uuid: string }>("SELECT uuid FROM dig_posts WHERE emoji IS NOT NULL AND user_uuid = ?", grace.uuid))[0].uuid;
    expect((await call("PUT", `/api/thread-replies/${inThread}`, { headers: grace.headers, json: { body: "words" } })).status).toBe(404);
    expect((await call("DELETE", `/api/thread-replies/${inThread}`, { headers: grace.headers })).status).toBe(404);
    expect((await call("PUT", `/api/dig-posts/${inDig}`, { headers: grace.headers, json: { body: "words" } })).status).toBe(404);
    expect((await call("DELETE", `/api/dig-posts/${inDig}`, { headers: grace.headers })).status).toBe(404);
    expect((await react(ada, "reply", inThread)).status).toBe(404);
    expect((await react(ada, "post", inDig)).status).toBe(404);
  });

  it("stop being set once a friend is no longer one", async () => {
    const ada = await register("ada@example.test", "Ada"), grace = await register("grace@example.test", "Grace");
    await befriend(ada, grace);
    const thread = await start(ada);
    await react(grace, "thread", thread.uuid);
    await ok("DELETE", `/api/friends/${grace.uuid}`, { headers: ada.headers });
    expect((await react(grace, "thread", thread.uuid, "🎉")).status).toBe(404);
    expect((await unreact(grace, "thread", thread.uuid)).status).toBe(404);
  });

  it("are set on a dig and its posts where the dig is read: by its writer's friends while the writing is shown", async () => {
    const ada = await register("ada@example.test", "Ada"), grace = await register("grace@example.test", "Grace"), alan = await register("alan@example.test", "Alan");
    await paperWithCopy(ada, DIGEST, "Attention at depth", { shelfUuid: await defaultShelf(ada) });
    await befriend(ada, grace);
    const dig = await ok("POST", "/api/digs", { headers: ada.headers, json: { subject: `paper:${DIGEST}`, text: "The gain flattens beyond eight heads." } });
    expect(dig.reactions).toEqual([]);
    // Her own dig is hers to react to, even before anyone else reads it.
    expect(await reacted(await react(ada, "dig", dig.uuid, "🤔"))).toEqual([{ emoji: "🤔", count: 1, mine: true, who: ["Ada"] }]);

    const posted = await ok("POST", `/api/digs/${dig.uuid}/posts`, { headers: grace.headers, json: { body: "Table 3 has the extended case." } });
    expect(posted.reactions).toEqual([{ emoji: "🤔", count: 1, mine: false, who: ["Ada"] }]);
    const post = posted.posts[0];
    expect(post.reactions).toEqual([]);
    await react(grace, "dig", dig.uuid, "🤔");
    await react(ada, "post", post.uuid, "🙏");
    const read = await ok("GET", `/api/digs/${dig.uuid}`, { headers: grace.headers });
    expect(read.reactions).toEqual([{ emoji: "🤔", count: 2, mine: true, who: ["Ada", "Grace"] }]);
    expect(read.posts[0].reactions).toEqual([{ emoji: "🙏", count: 1, mine: false, who: ["Ada"] }]);

    // Alan is no friend of Ada's: the dig is not there for him, nor its post.
    expect((await react(alan, "dig", dig.uuid)).status).toBe(404);
    expect((await react(alan, "post", post.uuid)).status).toBe(404);
    expect((await unreact(alan, "dig", dig.uuid, "🤔")).status).toBe(404);
  });

  it("are set in a project by its members alone", async () => {
    const ada = await register("ada@example.test", "Ada"), grace = await register("grace@example.test", "Grace"), alan = await register("alan@example.test", "Alan");
    await paperWithCopy(ada, DIGEST, "Attention at depth");
    const project = await ok("POST", "/api/projects", { headers: ada.headers, json: { name: "Loop tuning" } });
    await ok("POST", `/api/projects/${project.uuid}/papers`, { headers: ada.headers, json: { paper_sha256: DIGEST } });
    const dig = await ok("POST", `/api/projects/${project.uuid}/digs`, { headers: ada.headers, json: { subject: `paper:${DIGEST}`, text: "Section 4 needs rerunning." } });
    expect(await reacted(await react(ada, "dig", dig.uuid, "👀"))).toEqual([{ emoji: "👀", count: 1, mine: true, who: ["Ada"] }]);
    for (const outsider of [grace, alan]) expect((await react(outsider, "dig", dig.uuid)).status).toBeGreaterThanOrEqual(403);
    expect(await kept()).toBe(1);
  });

  it("go with what they are on: a reply taken back, a post, a thread, a dig, and an account closed", async () => {
    const ada = await register("ada@example.test", "Ada"), grace = await register("grace@example.test", "Grace");
    await paperWithCopy(ada, DIGEST, "Attention at depth", { shelfUuid: await defaultShelf(ada) });
    await befriend(ada, grace);
    const thread = await start(ada);
    const first = (await reply(grace, thread.uuid, "One")).replies[0];
    const second = (await reply(ada, thread.uuid, "Two")).replies[1];
    await react(ada, "thread", thread.uuid);
    await react(ada, "reply", first.uuid);
    await react(grace, "reply", second.uuid);
    expect(await kept()).toBe(3);
    await ok("DELETE", `/api/thread-replies/${first.uuid}`, { headers: grace.headers });
    expect(await kept()).toBe(2);
    await ok("DELETE", `/api/threads/${thread.uuid}`, { headers: ada.headers });
    expect(await kept()).toBe(0);

    const dig = await ok("POST", "/api/digs", { headers: ada.headers, json: { subject: `paper:${DIGEST}`, text: "The gain flattens." } });
    const one = (await ok("POST", `/api/digs/${dig.uuid}/posts`, { headers: grace.headers, json: { body: "It does." } })).posts[0];
    const two = (await ok("POST", `/api/digs/${dig.uuid}/posts`, { headers: ada.headers, json: { body: "Thanks." } })).posts[1];
    await react(grace, "dig", dig.uuid);
    await react(ada, "post", one.uuid);
    await react(grace, "post", two.uuid);
    expect(await kept()).toBe(3);
    await ok("DELETE", `/api/dig-posts/${one.uuid}`, { headers: grace.headers });
    expect(await kept()).toBe(2);
    expect((await call("DELETE", `/api/digs/${dig.uuid}`, { headers: ada.headers })).status).toBe(204);
    expect(await kept()).toBe(0);

    // Closing an account takes what its user set, and what was set on what goes with them.
    const hers = await start(grace, "Grace's thread");
    const stays = await start(ada, "Ada's thread");
    const hersIn = (await reply(grace, stays.uuid, "Grace was here")).replies[0];
    await react(ada, "thread", hers.uuid);
    await react(ada, "reply", hersIn.uuid);
    await react(grace, "thread", stays.uuid);
    await react(ada, "thread", stays.uuid, "🎉");
    expect(await kept()).toBe(4);
    await ok("DELETE", "/api/auth/account", { headers: grace.headers, json: { confirm_email: grace.email } });
    expect(await kept()).toBe(1);
    expect((await ok("GET", `/api/threads/${stays.uuid}`, { headers: ada.headers }))).toMatchObject({ replies: [], reactions: [{ emoji: "🎉", count: 1, mine: true, who: ["Ada"] }] });
  });

  it("put a line in the inbox of whoever wrote the thing, gone if taken back unread", async () => {
    const ada = await register("ada@example.test", "Ada"), grace = await register("grace@example.test", "Grace");
    await befriend(ada, grace);
    const lines = async (account: Account) => (await rows<{ content: string; link: string; kind: string; actor_uuid: string; read: number }>(
      "SELECT content, link, kind, actor_uuid, read FROM notifications WHERE user_uuid = ? AND kind = 'reaction' ORDER BY created_at, uuid", account.uuid));
    const thread = await start(ada);
    const said = (await reply(grace, thread.uuid, "Once per night, last spring.")).replies[0];

    // One's own words reacted to by oneself tell nobody.
    await react(ada, "thread", thread.uuid);
    expect(await lines(ada)).toEqual([]);

    await react(grace, "thread", thread.uuid, "🔥");
    expect(await lines(ada)).toEqual([{ content: "Grace reacted 🔥 to your thread.", link: `/thread/${thread.uuid}`, kind: "reaction", actor_uuid: grace.uuid, read: 0 }]);
    // Set again, it is still one line; the inbox reads it with who it is from.
    await react(grace, "thread", thread.uuid, "🔥");
    expect(await lines(ada)).toHaveLength(1);
    const inbox = await ok("GET", "/api/notifications", { headers: ada.headers });
    expect(inbox.notifications.find((n: { kind: string }) => n.kind === "reaction")).toMatchObject({ content: "Grace reacted 🔥 to your thread.", link: `/thread/${thread.uuid}`, actor: { uuid: grace.uuid } });
    // Taken back unread, the line goes; set anew, it is there once.
    await unreact(grace, "thread", thread.uuid, "🔥");
    expect(await lines(ada)).toEqual([]);
    await react(grace, "thread", thread.uuid, "🔥");
    expect(await lines(ada)).toHaveLength(1);
    // A line already read stays when the emoji is taken back.
    await ok("POST", "/api/notifications/read", { headers: ada.headers });
    await unreact(grace, "thread", thread.uuid, "🔥");
    expect(await lines(ada)).toMatchObject([{ read: 1 }]);

    // A reply's writer is told, not the thread's starter.
    await react(ada, "reply", said.uuid, "💡");
    expect(await lines(grace)).toMatchObject([{ content: "Ada reacted 💡 to your reply in a thread.", link: `/thread/${thread.uuid}` }]);
    expect(await lines(ada)).toHaveLength(1);

    // A dig's writer and a post's writer are told, with the paper named.
    await paperWithCopy(ada, DIGEST, "Sleep and memory", { shelfUuid: await defaultShelf(ada) });
    const dig = await ok("POST", "/api/digs", { headers: ada.headers, json: { subject: `paper:${DIGEST}`, text: "The delay matters." } });
    const posted = await ok("POST", `/api/digs/${dig.uuid}/posts`, { headers: grace.headers, json: { body: "Agreed." } });
    await react(grace, "dig", dig.uuid, "🚀");
    expect((await lines(ada)).at(-1)).toMatchObject({ content: "Grace reacted 🚀 to your dig on Sleep and memory.", link: `/paper/${DIGEST.slice(0, 32)}#dig-${dig.uuid}` });
    await react(ada, "post", posted.posts[0].uuid, "🙌");
    expect((await lines(grace)).at(-1)).toMatchObject({ content: "Ada reacted 🙌 to your post in a dig on Sleep and memory.", link: `/paper/${DIGEST.slice(0, 32)}#dig-${dig.uuid}` });
  });
});
