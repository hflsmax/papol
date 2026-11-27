// The email of the Lounge: what a user's friends did there since the
// last, once a day to begin with, and only when there is something new.
import { createExecutionContext, createScheduledController, env, waitOnExecutionContext } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";

import worker from "../src/index";
import { claim, type Job } from "../src/jobs/queue";
import { runOne } from "../src/jobs/run";
import { DAILY_CRON } from "../src/jobs/digests";
import { newsSince } from "../src/jobs/lounge";
import { call, count, defaultShelf, exec, ok, paperWithCopy, register, row, rows, type Account } from "./helpers";

const DIGEST = "d".repeat(64);
const DAY = 24 * 60 * 60 * 1000;

async function befriend(a: Account, b: Account) {
  await ok("POST", `/api/friends/${b.uuid}`, { headers: a.headers });
  await ok("POST", `/api/friends/${a.uuid}/accept`, { headers: b.headers });
}
const start = async (account: Account, json: unknown) => (await ok("POST", "/api/threads", { headers: account.headers, json })).uuid as string;
const reply = (account: Account, thread: string, body: string) => ok("POST", `/api/threads/${thread}/replies`, { headers: account.headers, json: { body } });
const tick = () => new Promise((done) => setTimeout(done, 5));

describe("the email of the Lounge", () => {
  const configured = { EMAIL_API_URL: "https://mail.example.test/emails", EMAIL_API_KEY: "key", EMAIL_FROM: "papol@example.test" };
  const calls: { url: string; body: any[] }[] = [];
  function emailApi(status = 200) {
    calls.length = 0;
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init.body)) });
      return new Response('{"data":[]}', { status });
    });
  }
  const sent = () => calls.flatMap((c) => c.body);
  const to = (account: Account) => sent().find((m) => m.to[0] === account.email);

  // A day's cron (a Tuesday's, unless told Monday), then the Lounge job
  // it queued run with mail configured.
  const MONDAY = Date.UTC(2026, 10, 23, 14), TUESDAY = Date.UTC(2026, 10, 24, 14);
  async function day(mailEnv: Env = { ...env, ...configured } as Env, scheduledTime = TUESDAY) {
    const ctx = createExecutionContext();
    await worker.scheduled(createScheduledController({ cron: DAILY_CRON, scheduledTime }), env, ctx);
    await waitOnExecutionContext(ctx);
    const queued = await rows<{ uuid: string }>("SELECT uuid FROM jobs WHERE kind = 'lounge_news' AND status = 'queued' ORDER BY created_at");
    expect(queued.length).toBe(1);
    await runOne(mailEnv, await claim(env.DB, queued[0].uuid, "test") as Job);
    await tick();
    return row<Job>("SELECT * FROM jobs WHERE uuid = ?", queued[0].uuid);
  }
  const monday = () => day(undefined, MONDAY);

  it("tells each user what their friends did, once, and nobody of what they did themselves", async () => {
    const ada = await register("ada@example.test", "Ada"), grace = await register("grace@example.test", "Grace <b>Hopper</b>");
    const alan = await register("alan@example.test", "Alan"), lone = await register("lone@example.test", "Lone");
    await befriend(ada, grace);
    await befriend(ada, alan);
    // Grace keeps a paper where friends see it, and says what she thinks.
    const copy = await paperWithCopy(grace, DIGEST, "Attention at depth", { shelfUuid: await defaultShelf(grace) });
    await exec("UPDATE copies SET thought = 'Worth a *second* read' WHERE uuid = ?", copy);
    // Ada starts a thread in the Lounge; Alan and Grace reply, and so does she.
    const thread = await start(ada, { words: "Split a **poster session**?" });
    await reply(alan, thread, "Yes, [the call](https://x.test/call) is out");
    await reply(grace, thread, "<i>Count me in</i>");
    await reply(ada, thread, "Good");

    emailApi();
    expect(await day()).toMatchObject({ status: "done", result: JSON.stringify({ sent: true, users: 3, recipients: 3 }) });
    // One batch, an email each, and none to whoever has no friends.
    expect(calls.map((c) => c.url)).toEqual(["https://mail.example.test/emails/batch"]);
    expect(sent().map((m) => m.to[0]).sort()).toEqual(["ada@example.test", "alan@example.test", "grace@example.test"]);
    expect(lone.uuid).toBeTruthy();

    const hers = to(ada);
    expect(hers).toMatchObject({ from: "papol@example.test", subject: "New in the Lounge from Alan and Grace <b>Hopper</b>" });
    expect(hers.text).toContain("Hello Ada,");
    // Her own thread, by what her friends said in it: not that she started it, nor her own reply.
    expect(hers.text).toContain([
      "Thread: Split a poster session?",
      "  Alan replied: “Yes, the call is out”",
      "  Grace <b>Hopper</b> replied: “<i>Count me in</i>”",
      `  https://papol.io/thread/${thread}`,
    ].join("\n"));
    expect(hers.text).not.toContain("Ada replied");
    expect(hers.text).not.toContain("started it");
    // The paper, under its title, by its short name.
    expect(hers.text).toContain(`Attention at depth\n  Grace <b>Hopper</b> added it: “Worth a *second* read”\n  https://papol.io/paper/${"d".repeat(32)}\n`);
    expect(hers.text).toContain("Read it all in the Lounge: https://papol.io/lounge");
    expect(hers.text).toContain("Papol sends this once a day, when there is something new in the Lounge. Change how often, or turn it off, under Preferences on your page: https://papol.io/profile");
    // Other people's words are words in the HTML, never markup.
    expect(hers.html).toContain(`<a href="https://papol.io/thread/${thread}"`);
    expect(hers.html).toContain("Grace &lt;b&gt;Hopper&lt;/b&gt; replied");
    expect(hers.html).toContain("&lt;i&gt;Count me in&lt;/i&gt;");
    expect(hers.html).not.toContain("<b>Hopper");
    expect(hers.html).not.toContain("<i>Count");
    expect(hers.html).toContain('href="https://papol.io/profile"');

    // Grace hears of Ada's thread and the replies there, not of her own paper.
    expect(to(grace).subject).toBe("New in the Lounge from Ada and Alan");
    expect(to(grace).text).toContain("  Ada started it\n  Alan replied");
    expect(to(grace).text).not.toContain("Attention at depth");
    // Alan is not Grace's friend: her paper is not his news, the thread is.
    expect(to(alan).text).not.toContain("Attention at depth");
    expect(to(alan).text).toContain("Thread: Split a poster session?");

    // The next day has nothing new: nothing is sent.
    emailApi();
    expect(await day()).toMatchObject({ result: JSON.stringify({ sent: true, users: 3, recipients: 0 }) });
    expect(calls).toEqual([]);

    // One more reply is told alone, to those who did not write it.
    await reply(alan, thread, "Booked");
    emailApi();
    await day();
    expect(sent().map((m) => [m.to[0], m.subject]).sort()).toEqual([
      ["ada@example.test", "New in the Lounge from Alan"],
      ["grace@example.test", "New in the Lounge from Alan"],
    ]);
    expect(to(ada).text).toContain("  Alan replied: “Booked”");
    expect(to(ada).text).not.toContain("Count me in");
  });

  it("names a thread's paper, a board and a project, and leaves out what is private", async () => {
    const ada = await register("ada@example.test", "Ada"), grace = await register("grace@example.test", "Grace");
    await befriend(ada, grace);
    const shelf = await defaultShelf(grace);
    await paperWithCopy(grace, DIGEST, "Attention at depth", { shelfUuid: shelf });
    const hidden = (await row<{ uuid: string }>("SELECT uuid FROM shelves WHERE user_uuid = ? AND is_public = 0", grace.uuid))!.uuid;
    await paperWithCopy(grace, "e".repeat(64), "Kept to myself", { shelfUuid: hidden });
    const thread = await start(grace, { paper_sha256: DIGEST, page: 3, y: 0.42, excerpt: "The gain flattens beyond eight heads." });
    const lab = await ok("POST", "/api/projects", { headers: grace.headers, json: { name: "Control Lab" } });

    emailApi();
    await day();
    const hers = to(ada);
    expect(hers.subject).toBe("New in the Lounge from Grace");
    expect(hers.text).toContain(`Thread: “The gain flattens beyond eight heads.”\n  Attention at depth, page 3\n  Grace started it\n  https://papol.io/thread/${thread}`);
    // A project she is not in opens where projects are joined.
    expect(hers.text).toContain("Project: Control Lab\n  Grace started it\n  https://papol.io/projects\n");
    expect(hers.text).not.toContain("Kept to myself");
    expect(lab.uuid).toBeTruthy();
    // Grace did all of it herself: she is not written to.
    expect(to(grace)).toBeUndefined();
  });

  it("leaves out a friend's dig and a reply the reader is emailed about on their own, unless they chose never", async () => {
    const ada = await register("ada@example.test", "Ada"), grace = await register("grace@example.test", "Grace");
    await befriend(ada, grace);
    // Grace keeps the paper, so Ada's dig on it is her "friends' digs" email; Grace's post in it is Ada's "replies" email.
    await paperWithCopy(grace, DIGEST, "Attention at depth", { shelfUuid: await defaultShelf(grace) });
    await exec("UPDATE copies SET created_at = '2026-01-01T00:00:00.000Z' WHERE user_uuid = ?", grace.uuid);
    const dig = await ok("POST", "/api/digs", { headers: ada.headers, json: { subject: `paper:${DIGEST}`, text: "The bound is loose" } });
    await ok("POST", `/api/digs/${dig.uuid}/posts`, { headers: grace.headers, json: { body: "Tight for d = 2" } });
    emailApi();
    await day();
    expect(sent()).toEqual([]);

    // Chosen never for those, the Lounge email says it instead.
    await exec("UPDATE users SET lounge_mailed_at = NULL");
    await ok("PUT", "/api/auth/profile", { headers: grace.headers, json: { emails: { friend_dig: "never" } } });
    await ok("PUT", "/api/auth/profile", { headers: ada.headers, json: { emails: { dig_reply: "never" } } });
    await exec("UPDATE jobs SET status = 'done' WHERE kind = 'lounge_news'");
    emailApi();
    await day();
    expect(to(grace).text).toContain("Ada dug");
    expect(to(ada).text).toContain("Grace posted in your dig");
  });

  it("is sent as often as each user chose in Preferences", async () => {
    const ada = await register("ada@example.test", "Ada"), grace = await register("grace@example.test", "Grace"), alan = await register("alan@example.test", "Alan");
    await befriend(ada, grace);
    await befriend(alan, grace);
    // It is daily to begin with; there is no "immediately", and never is kept.
    expect((await ok("GET", "/api/auth/me", { headers: ada.headers })).emails.lounge_activity).toBe("daily");
    expect((await call("PUT", "/api/auth/profile", { headers: ada.headers, json: { emails: { lounge_activity: "now" } } })).status).toBe(422);
    expect((await ok("PUT", "/api/auth/profile", { headers: ada.headers, json: { emails: { lounge_activity: "never" } } })).emails.lounge_activity).toBe("never");
    await ok("PUT", "/api/auth/profile", { headers: alan.headers, json: { emails: { lounge_activity: "weekly" } } });
    await start(grace, { words: "Reading group on Friday" });

    // A day that is not Monday writes to neither.
    emailApi();
    expect(await day()).toMatchObject({ result: JSON.stringify({ sent: true, users: 1, recipients: 0 }) });
    expect(sent()).toEqual([]);
    // Monday writes to whoever chose every week, and says so.
    emailApi();
    await monday();
    expect(sent().map((m) => m.to[0])).toEqual(["alan@example.test"]);
    expect(sent()[0].text).toContain("Papol sends this once a week, when there is something new in the Lounge.");
    // Back to every day, Ada is told of the last day.
    await ok("PUT", "/api/auth/profile", { headers: ada.headers, json: { emails: { lounge_activity: "daily" } } });
    emailApi();
    await day();
    expect(sent().map((m) => m.to[0])).toEqual(["ada@example.test"]);
  });

  it("does not send after a user what they already read in the Lounge", async () => {
    const ada = await register("ada@example.test", "Ada"), grace = await register("grace@example.test", "Grace");
    await befriend(ada, grace);
    const thread = await start(grace, { words: "Reading group on Friday" });
    await tick();
    await call("POST", "/api/room/seen", { headers: ada.headers });
    emailApi();
    await day();
    expect(sent()).toEqual([]);
    // What came after the visit is told.
    await tick();
    await reply(grace, thread, "Room 204");
    emailApi();
    await day();
    expect(to(ada).text).toContain("  Grace replied: “Room 204”");
    expect(to(ada).text).not.toContain("started it");
  });

  it("counts news from the last email or the last visit, a day or a week back at first, and never more than a week", () => {
    const at = Date.UTC(2026, 10, 24, 14), ago = (ms: number) => new Date(at - ms).toISOString();
    expect(newsSince({}, "daily", at)).toBe(ago(DAY));
    expect(newsSince({}, "weekly", at)).toBe(ago(7 * DAY));
    expect(newsSince({ lounge_mailed_at: ago(2 * DAY) }, "daily", at)).toBe(ago(2 * DAY));
    expect(newsSince({ lounge_mailed_at: ago(2 * DAY), room_seen_at: ago(DAY / 2) }, "daily", at)).toBe(ago(DAY / 2));
    expect(newsSince({ room_seen_at: ago(3 * DAY) }, "daily", at)).toBe(ago(DAY));
    expect(newsSince({ lounge_mailed_at: ago(40 * DAY) }, "daily", at)).toBe(ago(7 * DAY));
  });

  it("keeps the news for the next run when the mail cannot be sent, or is not configured", async () => {
    const ada = await register("ada@example.test", "Ada"), grace = await register("grace@example.test", "Grace");
    await befriend(ada, grace);
    await start(grace, { words: "Reading group on Friday" });
    expect(await day(env)).toMatchObject({ status: "done", result: JSON.stringify({ sent: false, skipped: "Email not configured" }) });
    emailApi(502);
    expect(await day()).toMatchObject({ status: "failed" });
    expect(await count("users", "lounge_mailed_at IS NOT NULL")).toBe(0);
    emailApi();
    await day();
    expect(sent().map((m) => m.to[0])).toEqual(["ada@example.test"]);
  });

  it("writes to everyone, a chunk of users to a job", async () => {
    const grace = await register("grace@example.test", "Grace");
    const accounts = await Promise.all(Array.from({ length: 22 }, (_, i) => register(`reader${i}@example.test`, `Reader ${i}`)));
    for (const account of accounts) await befriend(account, grace);
    await start(grace, { words: "Reading group on Friday" });
    emailApi();
    const first = await day();
    const next = await row<{ uuid: string }>("SELECT uuid FROM jobs WHERE kind = 'lounge_news' AND status = 'queued'");
    await runOne({ ...env, ...configured } as Env, await claim(env.DB, next!.uuid, "test") as Job);
    const second = await row<{ result: string }>("SELECT result FROM jobs WHERE uuid = ?", next!.uuid);
    const results = [JSON.parse(String(first!.result)), JSON.parse(second!.result)];
    expect(results.map((r) => r.users)).toEqual([20, 3]);
    // Everyone but Grace, whose own thread is no news to her.
    expect(results[0].recipients + results[1].recipients).toBe(22);
    expect(new Set(sent().map((m) => m.to[0])).size).toBe(22);
    expect(await count("jobs", "kind = 'lounge_news' AND status = 'queued'")).toBe(0);
  });
});
