// People to ask: whom the Lounge suggests, whom it never does, and the
// weekly email made from the same people.
import { createExecutionContext, createScheduledController, env, waitOnExecutionContext } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";

import worker from "../src/index";
import { claim, type Job } from "../src/jobs/queue";
import { runOne } from "../src/jobs/run";
import { reasonOf, SUGGESTIONS_CRON } from "../src/jobs/suggestions";
import { call, count, defaultShelf, exec, ok, paperWithCopy, register, row, rows, uuid, type Account } from "./helpers";

const digest = (letter: string) => letter.repeat(64);
const suggested = (account: Account) => ok("GET", "/api/friends/suggestions", { headers: account.headers });
const names = async (account: Account) => (await suggested(account)).map((s: any) => s.user.display_name);
const privateShelf = async (account: Account) => (await row<{ uuid: string }>("SELECT uuid FROM shelves WHERE user_uuid = ? AND is_public = 0", account.uuid))!.uuid;

// A copy of a paper on the account's public shelf, or on the shelf named.
async function keeps(account: Account, letter: string, title: string, shelfUuid?: string) {
  const shelf = shelfUuid ?? await defaultShelf(account);
  if (!(await row("SELECT 1 FROM papers WHERE sha256 = ?", digest(letter)))) return paperWithCopy(account, digest(letter), title, { shelfUuid: shelf });
  const at = new Date().toISOString();
  const copy = uuid();
  await exec("INSERT INTO copies (uuid, paper_sha256, user_uuid, shelf_uuid, is_author, created_at, updated_at, revision) VALUES (?, ?, ?, ?, 0, ?, ?, 0)",
    copy, digest(letter), account.uuid, shelf, at, at);
  return copy;
}

async function project(keeper: Account, name: string, ...joiners: Account[]) {
  const made = await ok("POST", "/api/projects", { headers: keeper.headers, json: { name } });
  const { invite_code } = await ok("POST", `/api/projects/${made.uuid}/invite`, { headers: keeper.headers });
  for (const joiner of joiners) await ok("POST", `/api/project-invites/${invite_code}`, { headers: joiner.headers });
  return made.uuid as string;
}

describe("people to ask", () => {
  it("are those in a project with me or keeping my papers in the open, a project first", async () => {
    const ada = await register("ada@example.test", "Ada"), grace = await register("grace@example.test", "Grace");
    const edsger = await register("edsger@example.test", "Edsger"), stranger = await register("stranger@example.test", "Stranger");
    await keeps(ada, "a", "Loss Curves");
    await keeps(ada, "b", "Error Dynamics");
    await keeps(grace, "a", "Loss Curves");
    await keeps(grace, "b", "Error Dynamics");
    await keeps(stranger, "c", "Something Else");
    const lab = await project(ada, "Control Lab", edsger);

    // Two papers in common are less than one project.
    expect(await suggested(ada)).toEqual([
      { user: expect.objectContaining({ uuid: edsger.uuid, display_name: "Edsger" }), project_count: 1, projects: [{ uuid: lab, name: "Control Lab" }], paper_count: 0, papers: [] },
      { user: expect.objectContaining({ uuid: grace.uuid }), project_count: 0, projects: [], paper_count: 2, papers: expect.arrayContaining([{ sha256: digest("a"), title: "Loss Curves" }, { sha256: digest("b"), title: "Error Dynamics" }]) },
    ]);
    // It runs both ways, and to someone with nothing in common nobody is suggested.
    expect(await names(grace)).toEqual(["Ada"]);
    expect(await suggested(stranger)).toEqual([]);
    expect((await call("GET", "/api/friends/suggestions")).status).toBe(401);
  });

  it("are made from nothing private", async () => {
    const ada = await register("ada@example.test", "Ada"), grace = await register("grace@example.test", "Grace");
    await keeps(ada, "a", "Loss Curves");
    const hidden = await keeps(grace, "a", "Loss Curves", await privateShelf(grace));
    expect(await suggested(ada)).toEqual([]);
    expect(await suggested(grace)).toEqual([]);
    // Put in the open, it is a reason; let go, it is none.
    await exec("UPDATE copies SET shelf_uuid = ? WHERE uuid = ?", await defaultShelf(grace), hidden);
    expect(await names(ada)).toEqual(["Grace"]);
    await exec("UPDATE copies SET deleted_at = ? WHERE uuid = ?", new Date().toISOString(), hidden);
    expect(await suggested(ada)).toEqual([]);
  });

  it("leave out friends, anyone asked or asking, and whoever cannot be found", async () => {
    const ada = await register("ada@example.test", "Ada");
    const [friend, asked, asking, declined, unfindable, open] = await Promise.all(
      ["Friend", "Asked", "Asking", "Declined", "Unfindable", "Open"].map((name) => register(`${name.toLowerCase()}@example.test`, name)));
    await keeps(ada, "a", "Loss Curves");
    for (const other of [friend, asked, asking, declined, unfindable, open]) await keeps(other, "a", "Loss Curves");
    expect((await names(ada)).sort()).toEqual(["Asked", "Asking", "Declined", "Friend", "Open", "Unfindable"]);

    await ok("POST", `/api/friends/${friend.uuid}`, { headers: ada.headers });
    await ok("POST", `/api/friends/${ada.uuid}/accept`, { headers: friend.headers });
    await ok("POST", `/api/friends/${asked.uuid}`, { headers: ada.headers });
    await ok("POST", `/api/friends/${ada.uuid}`, { headers: asking.headers });
    await ok("POST", `/api/friends/${ada.uuid}`, { headers: declined.headers });
    await ok("POST", `/api/friends/${declined.uuid}/decline`, { headers: ada.headers });
    await ok("PUT", "/api/auth/profile", { headers: unfindable.headers, json: { findable: false } });
    expect(await names(ada)).toEqual(["Open"]);
    // Whoever she said Not now to is not shown her either.
    expect(await names(declined)).not.toContain("Ada");
    // Someone who cannot be found is still suggested people.
    expect(await names(unfindable)).toContain("Open");
  });

  it("stop naming someone I am not interested in, and tell them nothing", async () => {
    const ada = await register("ada@example.test", "Ada"), grace = await register("grace@example.test", "Grace"), edsger = await register("edsger@example.test", "Edsger");
    await keeps(ada, "a", "Loss Curves");
    await keeps(grace, "a", "Loss Curves");
    await keeps(edsger, "a", "Loss Curves");
    const told = await count("notifications");
    const left = await ok("DELETE", `/api/friends/suggestions/${grace.uuid}`, { headers: ada.headers });
    expect(left.map((s: any) => s.user.display_name)).toEqual(["Edsger"]);
    await ok("DELETE", `/api/friends/suggestions/${grace.uuid}`, { headers: ada.headers });
    expect(await count("friend_suggestions")).toBe(1);
    expect(await names(ada)).toEqual(["Edsger"]);
    // It is hers alone: Grace is still suggested Ada, hears nothing, and can still be asked.
    expect(await names(grace)).toEqual(["Ada", "Edsger"]);
    expect(await count("notifications")).toBe(told);
    await ok("POST", `/api/friends/${grace.uuid}`, { headers: ada.headers });
    expect((await call("DELETE", `/api/friends/suggestions/${ada.uuid}`, { headers: ada.headers })).status).toBe(404);
    expect((await call("DELETE", `/api/friends/suggestions/${uuid()}`, { headers: ada.headers })).status).toBe(404);
    expect((await call("DELETE", `/api/friends/suggestions/${grace.uuid}`)).status).toBe(401);
  });

  it("go with a closed account", async () => {
    const ada = await register("ada@example.test", "Ada"), grace = await register("grace@example.test", "Grace");
    await keeps(ada, "a", "Loss Curves");
    await keeps(grace, "a", "Loss Curves");
    await ok("DELETE", `/api/friends/suggestions/${grace.uuid}`, { headers: ada.headers });
    await ok("DELETE", `/api/friends/suggestions/${ada.uuid}`, { headers: grace.headers });
    const closed = await ok("DELETE", "/api/auth/account", { headers: grace.headers, json: { confirm_email: "grace@example.test" } });
    expect(closed.removed.friend_suggestions).toBe(2);
    expect(await suggested(ada)).toEqual([]);
  });

  it("say why in words", () => {
    const user = { uuid: "u", display_name: "Grace", affiliation: null, avatar_path: null, email: null };
    expect(reasonOf({ user, project_count: 1, projects: [{ uuid: "p", name: "Control Lab" }], paper_count: 0, papers: [] })).toBe("In Control Lab with you");
    expect(reasonOf({ user, project_count: 0, projects: [], paper_count: 1, papers: [{ sha256: "a", title: "Loss Curves" }] })).toBe("Keeps “Loss Curves” that you keep too");
    expect(reasonOf({ user, project_count: 3, projects: [{ uuid: "p", name: "Control Lab" }], paper_count: 2, papers: [{ sha256: "a", title: "Loss Curves" }] }))
      .toBe("In Control Lab and 2 more projects with you, and keeps “Loss Curves” and 1 more paper that you keep too");
  });
});

describe("the weekly email of people to ask", () => {
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

  // Monday's cron, then the job it queued run with mail configured.
  async function monday(mailEnv: Env = { ...env, ...configured } as Env) {
    const ctx = createExecutionContext();
    await worker.scheduled(createScheduledController({ cron: SUGGESTIONS_CRON, scheduledTime: Date.now() }), env, ctx);
    await waitOnExecutionContext(ctx);
    const queued = await rows<{ uuid: string }>("SELECT uuid FROM jobs WHERE kind = 'suggest_friends' AND status = 'queued' ORDER BY created_at");
    expect(queued.length).toBe(1);
    await runOne(mailEnv, await claim(env.DB, queued[0].uuid, "test") as Job);
    return row<Job>("SELECT * FROM jobs WHERE uuid = ?", queued[0].uuid);
  }

  it("names whoever is new to each user, once, with a way out of it", async () => {
    const ada = await register("ada@example.test", "Ada"), grace = await register("grace@example.test", "Grace <b>Hopper</b>");
    const lone = await register("lone@example.test", "Lone");
    await keeps(ada, "a", "Loss Curves");
    await keeps(grace, "a", "Loss Curves");
    await keeps(lone, "z", "Nobody Else Has This");
    await exec("UPDATE users SET affiliation = 'Yale' WHERE uuid = ?", grace.uuid);

    emailApi();
    expect(await monday()).toMatchObject({ status: "done", result: JSON.stringify({ sent: true, users: 3, recipients: 2 }) });
    // One batch, an email each, and none to whoever has nobody to be suggested.
    expect(calls.map((c) => c.url)).toEqual(["https://mail.example.test/emails/batch"]);
    expect(sent().map((m) => m.to[0]).sort()).toEqual(["ada@example.test", "grace@example.test"]);
    const hers = sent().find((m) => m.to[0] === "ada@example.test");
    const token = (await row<{ unsubscribe_token: string }>("SELECT unsubscribe_token FROM users WHERE uuid = ?", ada.uuid))!.unsubscribe_token;
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    const link = `https://papol.io/api/email/unsubscribe/${token}`;
    expect(hers).toMatchObject({
      from: "papol@example.test", subject: "Grace <b>Hopper</b> is on Papol too",
      headers: { "List-Unsubscribe": `<${link}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
    });
    expect(hers.text).toContain("Hello Ada,");
    expect(hers.text).toContain("- Grace <b>Hopper</b> (Yale)\n  Keeps “Loss Curves” that you keep too.\n  https://papol.io/u/" + grace.uuid);
    expect(hers.text).toContain("https://papol.io/lounge");
    expect(hers.text).toContain(`Stop these emails: ${link}`);
    // Someone else's name is words in the HTML, never markup.
    expect(hers.html).toContain(`<a href="https://papol.io/u/${grace.uuid}"`);
    expect(hers.html).toContain("Grace &lt;b&gt;Hopper&lt;/b&gt;");
    expect(hers.html).not.toContain("<b>Hopper");
    expect(hers.html).toContain(`href="${link}"`);

    // The next week has nobody new: nothing is sent, and the Lounge still shows her.
    emailApi();
    expect(await monday()).toMatchObject({ result: JSON.stringify({ sent: true, users: 3, recipients: 0 }) });
    expect(calls).toEqual([]);
    expect(await names(ada)).toEqual(["Grace <b>Hopper</b>"]);

    // Someone new is named alone, to those they are new to.
    const edsger = await register("edsger@example.test", "Edsger");
    await keeps(edsger, "a", "Loss Curves");
    emailApi();
    await monday();
    expect(sent().map((m) => [m.to[0], m.subject]).sort()).toEqual([
      ["ada@example.test", "Edsger is on Papol too"],
      ["edsger@example.test", "People you may know on Papol"],
      ["grace@example.test", "Edsger is on Papol too"],
    ]);
    // The link is the same one every week.
    expect(sent().find((m) => m.to[0] === "ada@example.test").text).toContain(link);
  });

  it("is not sent to whoever turned it off, or about whoever they are not interested in", async () => {
    const ada = await register("ada@example.test", "Ada"), grace = await register("grace@example.test", "Grace"), edsger = await register("edsger@example.test", "Edsger");
    for (const account of [ada, grace, edsger]) await keeps(account, "a", "Loss Curves");
    // It is on to begin with, and off is kept.
    expect((await ok("GET", "/api/auth/me", { headers: ada.headers })).suggestion_email).toBe(true);
    expect((await ok("PUT", "/api/auth/profile", { headers: ada.headers, json: { suggestion_email: false } })).suggestion_email).toBe(false);
    // Another choice made later leaves it off.
    expect((await ok("PUT", "/api/auth/profile", { headers: ada.headers, json: { findable: true } })).suggestion_email).toBe(false);
    await ok("DELETE", `/api/friends/suggestions/${edsger.uuid}`, { headers: grace.headers });

    emailApi();
    await monday();
    expect(sent().map((m) => m.to[0]).sort()).toEqual(["edsger@example.test", "grace@example.test"]);
    expect(sent().find((m) => m.to[0] === "grace@example.test").text).not.toContain("Edsger");
    expect(await count("friend_suggestions", "user_uuid = ? AND mailed_at IS NOT NULL", ada.uuid)).toBe(0);
  });

  it("is turned off by the link in it, which asks before it acts", async () => {
    const ada = await register("ada@example.test", "Ada"), grace = await register("grace@example.test", "Grace");
    await keeps(ada, "a", "Loss Curves");
    await keeps(grace, "a", "Loss Curves");
    emailApi();
    await monday();
    vi.unstubAllGlobals();
    const token = (await row<{ unsubscribe_token: string }>("SELECT unsubscribe_token FROM users WHERE uuid = ?", ada.uuid))!.unsubscribe_token;
    const on = async () => (await ok("GET", "/api/auth/me", { headers: ada.headers })).suggestion_email;

    // Opening the link changes nothing: a scanner opens it before she does.
    const asked = await call("GET", `/api/email/unsubscribe/${token}`);
    expect(asked.status).toBe(200);
    expect(asked.headers.get("content-type")).toContain("text/html");
    expect(await asked.text()).toContain("Stop these emails");
    expect(await on()).toBe(true);
    // The press, with no sign-in, turns off hers and nobody else's.
    const done = await call("POST", `/api/email/unsubscribe/${token}`);
    expect(done.status).toBe(200);
    expect(await done.text()).toContain("You will get no more of these");
    expect(await on()).toBe(false);
    expect((await ok("GET", "/api/auth/me", { headers: grace.headers })).suggestion_email).toBe(true);
    expect(await (await call("GET", `/api/email/unsubscribe/${token}`)).text()).toContain("already off");
    // A link nobody was sent opens nothing.
    expect((await call("GET", `/api/email/unsubscribe/${"0".repeat(64)}`)).status).toBe(404);
    expect((await call("POST", `/api/email/unsubscribe/${"0".repeat(64)}`)).status).toBe(404);
    expect((await call("POST", "/api/email/unsubscribe/nonsense")).status).toBe(404);
    // Nor does the link of an account since closed.
    await ok("DELETE", "/api/auth/account", { headers: ada.headers, json: { confirm_email: "ada@example.test" } });
    expect((await call("GET", `/api/email/unsubscribe/${token}`)).status).toBe(404);
  });

  it("records nothing as said when the mail cannot be sent, or is not configured", async () => {
    const ada = await register("ada@example.test", "Ada"), grace = await register("grace@example.test", "Grace");
    await keeps(ada, "a", "Loss Curves");
    await keeps(grace, "a", "Loss Curves");
    expect(await monday(env)).toMatchObject({ status: "done", result: JSON.stringify({ sent: false, skipped: "Email not configured" }) });
    emailApi(502);
    expect(await monday()).toMatchObject({ status: "failed" });
    expect(await count("friend_suggestions")).toBe(0);
    // So the next week says it.
    emailApi();
    await monday();
    expect(sent().length).toBe(2);
  });

  it("writes to everyone, a chunk of users to a job", async () => {
    const accounts = await Promise.all(Array.from({ length: 23 }, (_, i) => register(`reader${i}@example.test`, `Reader ${i}`)));
    const at = new Date().toISOString();
    await paperWithCopy(accounts[0], digest("a"), "Loss Curves", { shelfUuid: await defaultShelf(accounts[0]) });
    for (const account of accounts.slice(1)) {
      await exec("INSERT INTO copies (uuid, paper_sha256, user_uuid, shelf_uuid, is_author, created_at, updated_at, revision) VALUES (?, ?, ?, ?, 0, ?, ?, 0)",
        uuid(), digest("a"), account.uuid, await defaultShelf(account), at, at);
    }
    emailApi();
    expect(await monday()).toMatchObject({ result: JSON.stringify({ sent: true, users: 20, recipients: 20 }) });
    // The job queued the rest after itself.
    const next = await row<{ uuid: string }>("SELECT uuid FROM jobs WHERE kind = 'suggest_friends' AND status = 'queued'");
    await runOne({ ...env, ...configured } as Env, await claim(env.DB, next!.uuid, "test") as Job);
    expect(await row("SELECT result FROM jobs WHERE uuid = ?", next!.uuid)).toEqual({ result: JSON.stringify({ sent: true, users: 3, recipients: 3 }) });
    expect(new Set(sent().map((m) => m.to[0])).size).toBe(23);
    // Three people to an email.
    expect(sent()[0].text.match(/https:\/\/papol\.io\/u\//g)!.length).toBe(3);
    expect(await count("jobs", "kind = 'suggest_friends' AND status = 'queued'")).toBe(0);
  });
});
