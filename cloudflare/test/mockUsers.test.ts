// A mock user: an account nobody is behind. It signs in and keeps papers,
// and to everyone else it is not there.
import { env } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";

import { claim, type Job } from "../src/jobs/queue";
import { runOne } from "../src/jobs/run";
import { queueSuggestions } from "../src/jobs/suggestions";
import { call, count, defaultShelf, exec, ok, paperWithCopy, register, row, rows, type Account } from "./helpers";

const mock = (account: Account, on = 1) => exec("UPDATE users SET is_mock = ? WHERE uuid = ?", on, account.uuid);
const friends = (account: Account) => ok("GET", "/api/friends", { headers: account.headers });
const suggested = async (account: Account) => (await ok("GET", "/api/friends/suggestions", { headers: account.headers })).map((s: any) => s.user.display_name);
const found = async (account: Account, q: string) => (await ok("GET", `/api/friends/people?q=${q}`, { headers: account.headers })).map((u: any) => u.display_name);

async function befriend(a: Account, b: Account) {
  await ok("POST", `/api/friends/${b.uuid}`, { headers: a.headers });
  await ok("POST", `/api/friends/${a.uuid}/accept`, { headers: b.headers });
}

async function project(keeper: Account, name: string, ...joiners: Account[]) {
  const made = await ok("POST", "/api/projects", { headers: keeper.headers, json: { name } });
  const { invite_code } = await ok("POST", `/api/projects/${made.uuid}/invite`, { headers: keeper.headers });
  for (const joiner of joiners) await ok("POST", `/api/project-invites/${invite_code}`, { headers: joiner.headers });
  return made.uuid as string;
}

describe("a mock user", () => {
  it("is not found, suggested or asked, and asks nobody", async () => {
    const ada = await register("ada@example.test", "Ada"), jane = await register("jane@example.test", "Jane Doe"), grace = await register("grace@example.test", "Grace");
    await project(ada, "Control Lab", jane, grace);
    expect(await suggested(ada)).toEqual(["Grace", "Jane Doe"]);
    expect(await found(ada, "jane")).toEqual(["Jane Doe"]);

    await mock(jane);
    expect(await suggested(ada)).toEqual(["Grace"]);
    expect(await suggested(jane)).toEqual([]);
    expect(await found(ada, "jane")).toEqual([]);
    expect(await found(ada, "jane@example.test")).toEqual([]);
    expect(await found(jane, "ada")).toEqual([]);
    expect((await call("POST", `/api/friends/${jane.uuid}`, { headers: ada.headers })).status).toBe(404);
    expect((await call("POST", `/api/friends/${ada.uuid}`, { headers: jane.headers })).status).toBe(403);
    expect((await call("DELETE", `/api/friends/suggestions/${jane.uuid}`, { headers: ada.headers })).status).toBe(404);
    expect(await count("friendships")).toBe(0);
    expect(await count("notifications", "kind LIKE 'friend%'")).toBe(0);

    // A keeper neither finds it to add nor adds it, and it asks to join nothing.
    const other = await project(grace, "Other Lab");
    expect(await ok("GET", `/api/projects/${other}/people?q=jane`, { headers: grace.headers })).toEqual([]);
    expect((await call("POST", `/api/projects/${other}/members`, { headers: grace.headers, json: { user_uuid: jane.uuid } })).status).toBe(404);
    expect((await call("POST", `/api/projects/${other}/ask`, { headers: jane.headers })).status).toBe(403);
  });

  it("is nobody's friend, though it was one before it was marked, and is one again once the mark is off", async () => {
    const ada = await register("ada@example.test", "Ada"), jane = await register("jane@example.test", "Jane Doe"), grace = await register("grace@example.test", "Grace");
    await befriend(ada, jane);
    await befriend(jane, grace);
    await ok("POST", `/api/friends/${ada.uuid}`, { headers: (await register("asking@example.test", "Asking")).headers });
    await paperWithCopy(jane, "a".repeat(64), "Jane's paper", { shelfUuid: await defaultShelf(jane) });
    const room = async (account: Account) => ok("GET", "/api/room", { headers: account.headers });
    expect(await room(ada)).toMatchObject({ friend_count: 1, rows: [{ kind: "paper" }] });
    // A friend of a friend, through Jane.
    expect(await suggested(ada)).toEqual(["Grace"]);

    await mock(jane);
    expect(await room(ada)).toMatchObject({ friend_count: 0, rows: [] });
    expect((await friends(ada)).friends).toEqual([]);
    expect((await friends(ada)).requests.length).toBe(1);
    expect(await friends(jane)).toEqual({ friends: [], requests: [], sent: [] });
    expect(await room(jane)).toMatchObject({ friend_count: 0, rows: [] });
    expect(await suggested(ada)).toEqual([]);

    // Nothing was taken away.
    await mock(jane, 0);
    expect(await room(ada)).toMatchObject({ friend_count: 1, rows: [{ kind: "paper" }] });
    expect((await friends(jane)).friends.length).toBe(2);
  });

  it("is no reader of a paper to anyone else, and its nook is its own and an admin's", async () => {
    const ada = await register("ada@example.test", "Ada"), jane = await register("jane@example.test", "Jane Doe");
    await paperWithCopy(jane, "a".repeat(64), "Jane's paper", { shelfUuid: await defaultShelf(jane) });
    const readers = async () => (await ok("GET", `/api/papers/${"a".repeat(32)}`, { headers: ada.headers })).also_read_by.map((r: any) => r.user.display_name);
    expect(await readers()).toEqual(["Jane Doe"]);
    expect((await call("GET", `/api/users/${jane.uuid}/nook`, { headers: ada.headers })).status).toBe(200);

    await mock(jane);
    expect(await readers()).toEqual([]);
    expect((await call("GET", `/api/users/${jane.uuid}/nook`, { headers: ada.headers })).status).toBe(404);
    expect((await ok("GET", `/api/users/${jane.uuid}/nook`, { headers: jane.headers })).papers.length).toBe(1);
    await exec("UPDATE users SET is_admin = 1 WHERE uuid = ?", ada.uuid);
    expect((await call("GET", `/api/users/${jane.uuid}/nook`, { headers: ada.headers })).status).toBe(200);
  });

  it("is sent no email it could have chosen, and none an admin writes to everyone", async () => {
    const configured = { EMAIL_API_URL: "https://mail.example.test/emails", EMAIL_API_KEY: "key", EMAIL_FROM: "papol@example.test" };
    const boss = await register("boss@example.test", "Boss"), jane = await register("jane@example.test", "Jane Doe"), grace = await register("grace@example.test", "Grace");
    await exec("UPDATE users SET is_admin = 1 WHERE uuid = ?", boss.uuid);
    await project(boss, "Control Lab", jane, grace);
    // Something held for it from before the mark is let go unsent.
    await ok("PUT", "/api/auth/profile", { headers: jane.headers, json: { emails: { friend_request: "daily" } } });
    await ok("POST", `/api/friends/${jane.uuid}`, { headers: grace.headers });
    expect(await count("email_held")).toBe(1);
    await mock(jane);
    expect((await ok("GET", "/api/auth/me", { headers: jane.headers })).emails).toEqual({ friend_request: "never", friend_suggestions: "never" });

    const sent: any[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      sent.push(...[JSON.parse(String(init.body))].flat());
      return new Response('{"data":[]}');
    });
    const mailEnv = { ...env, ...configured } as Env;
    const run = async (kind: string) => {
      for (const job of await rows<{ uuid: string }>("SELECT uuid FROM jobs WHERE kind = ? AND status = 'queued'", kind)) await runOne(mailEnv, await claim(env.DB, job.uuid, "test") as Job);
    };
    await queueSuggestions(env, true);
    await run("suggest_friends");
    expect(sent.map((m) => m.to[0]).sort()).toEqual(["boss@example.test", "grace@example.test"]);
    expect(sent.every((m) => !m.text.includes("Jane Doe"))).toBe(true);

    sent.length = 0;
    const { queueDigests } = await import("../src/jobs/digests");
    await queueDigests(env, true);
    await run("send_digests");
    expect(sent).toEqual([]);
    expect(await count("email_held")).toBe(0);

    expect(await ok("POST", "/api/admin/announcements", { headers: boss.headers, json: { subject: "News", body: "Hello" } })).toMatchObject({ recipient_count: 2 });
    expect((await ok("GET", "/api/admin/message-recipients", { headers: boss.headers })).map((u: any) => u.display_name)).toEqual(["Boss", "Grace"]);
    expect((await call("POST", "/api/admin/announcements", { headers: boss.headers, json: { subject: "News", body: "Hello", user_uuids: [jane.uuid] } })).status).toBe(400);
    vi.unstubAllGlobals();
  });

  it("is in none of the admin's counts of who uses Papol", async () => {
    const boss = await register("boss@example.test", "Boss"), jane = await register("jane@example.test", "Jane Doe");
    await exec("UPDATE users SET is_admin = 1 WHERE uuid = ?", boss.uuid);
    await befriend(boss, jane);
    await ok("GET", "/api/auth/me", { headers: jane.headers });
    let users = await ok("GET", "/api/admin/users", { headers: boss.headers });
    expect(users).toMatchObject({ total_users: 2, new_count: 2 });
    expect(users.new.find((u: any) => u.display_name === "Boss").friends).toBe(1);

    await mock(jane);
    users = await ok("GET", "/api/admin/users", { headers: boss.headers });
    expect(users).toMatchObject({ total_users: 1, new_count: 1 });
    expect(users.new.map((u: any) => u.display_name)).toEqual(["Boss"]);
    expect(users.new[0].friends).toBe(0);
    // The mark is the admin's to set and take off, on the row.
    await ok("PUT", `/api/admin/tables/users/rows/${jane.uuid}`, { headers: boss.headers, json: { is_mock: 0 } });
    expect((await row<{ is_mock: number }>("SELECT is_mock FROM users WHERE uuid = ?", jane.uuid))?.is_mock).toBe(0);
  });
});
