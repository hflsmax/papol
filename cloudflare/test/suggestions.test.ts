// People to ask: whom the Lounge suggests, whom it never does, and the
// weekly email made from the same people.
import { createExecutionContext, createScheduledController, env, waitOnExecutionContext } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";

import worker from "../src/index";
import { claim, type Job } from "../src/jobs/queue";
import { runOne } from "../src/jobs/run";
import { DAILY_CRON, WEEKLY_CRON } from "../src/jobs/digests";
import { reasonOf } from "../src/jobs/suggestions";
import { suggestionsFor } from "../src/routes/suggestions";
import { call, count, defaultShelf, exec, ok, paperWithCopy, register, row, rows, uuid, type Account } from "./helpers";

const suggested = (account: Account) => ok("GET", "/api/friends/suggestions", { headers: account.headers });
const names = async (account: Account) => (await suggested(account)).map((s: any) => s.user.display_name);
// Those who share something with a user, the likeliest first: what the email is made of.
const shares = (account: Account) => suggestionsFor(env, account.uuid);
const sharers = async (account: Account) => (await shares(account)).map((s) => s.user.display_name);

async function befriend(a: Account, b: Account) {
  await ok("POST", `/api/friends/${b.uuid}`, { headers: a.headers });
  await ok("POST", `/api/friends/${a.uuid}/accept`, { headers: b.headers });
}

// Ada and someone made friends of friends, through a friend made for it.
async function linked(a: Account, b: Account, via?: Account) {
  const between = via ?? await register(`${uuid()}@example.test`, "Between");
  await befriend(a, between);
  await befriend(between, b);
  return between;
}

async function project(keeper: Account, name: string, ...joiners: Account[]) {
  const made = await ok("POST", "/api/projects", { headers: keeper.headers, json: { name } });
  const { invite_code } = await ok("POST", `/api/projects/${made.uuid}/invite`, { headers: keeper.headers });
  for (const joiner of joiners) await ok("POST", `/api/project-invites/${invite_code}`, { headers: joiner.headers });
  return made.uuid as string;
}

describe("people to ask", () => {
  it("are anyone in the Lounge, drawn afresh each time, with what we share said where there is any", async () => {
    const ada = await register("ada@example.test", "Ada");
    // A user alone has nobody to be shown, and nobody is shown themselves.
    expect(await suggested(ada)).toEqual([]);
    const grace = await register("grace@example.test", "Grace");
    // Someone they share nothing with is suggested, with nothing said of why.
    expect(await suggested(ada)).toEqual([{ user: expect.objectContaining({ uuid: grace.uuid }), project_count: 0, projects: [], mutual_count: 0 }]);
    const lab = await project(ada, "Control Lab", grace);
    expect(await suggested(ada)).toMatchObject([{ user: { uuid: grace.uuid }, project_count: 1, projects: [{ uuid: lab, name: "Control Lab" }] }]);
    expect((await call("GET", "/api/friends/suggestions")).status).toBe(401);

    // Six at a time out of everyone, and not the same six in the same order every time.
    for (let i = 0; i < 12; i += 1) await register(`${uuid()}@example.test`, `Reader ${i}`);
    const draws = new Set<string>();
    for (let i = 0; i < 8; i += 1) {
      const drawn = await names(ada);
      expect(drawn).toHaveLength(6);
      expect(new Set(drawn).size).toBe(6);
      draws.add(drawn.join());
    }
    expect(draws.size).toBeGreaterThan(1);

    // Someone I asked leads every draw, so the asking can be taken back.
    await ok("POST", `/api/friends/${grace.uuid}`, { headers: ada.headers });
    for (let i = 0; i < 4; i += 1) expect((await names(ada))[0]).toBe("Grace");
  });

  it("share a project with me or are friends of my friends, a project first, for the email", async () => {
    const ada = await register("ada@example.test", "Ada"), grace = await register("grace@example.test", "Grace");
    const edsger = await register("edsger@example.test", "Edsger"), stranger = await register("stranger@example.test", "Stranger");
    const one = await register("one@example.test", "One"), two = await register("two@example.test", "Two");
    await linked(ada, grace, one);
    await linked(ada, grace, two);
    const lab = await project(ada, "Control Lab", edsger);

    // Two friends in common are less than one project, and who they are is not said.
    expect(await shares(ada)).toEqual([
      { user: expect.objectContaining({ uuid: edsger.uuid, display_name: "Edsger" }), project_count: 1, projects: [{ uuid: lab, name: "Control Lab" }], mutual_count: 0 },
      { user: expect.objectContaining({ uuid: grace.uuid }), project_count: 0, projects: [], mutual_count: 2 },
    ]);
    // It runs both ways, and to someone with nothing in common nobody is suggested.
    expect(await sharers(grace)).toEqual(["Ada"]);
    // The two in between share both of them.
    expect(await sharers(one)).toEqual(["Two"]);
    expect(await shares(stranger)).toEqual([]);
  });

  it("share nothing by papers two people both keep, or by a request not yet accepted", async () => {
    const ada = await register("ada@example.test", "Ada"), grace = await register("grace@example.test", "Grace"), between = await register("between@example.test", "Between");
    await paperWithCopy(ada, "a".repeat(64), "Loss Curves", { shelfUuid: await defaultShelf(ada) });
    await ok("POST", `/api/papers/${"a".repeat(32)}/add-to-nook`, { headers: grace.headers, json: {} });
    expect(await shares(ada)).toEqual([]);
    await befriend(ada, between);
    await ok("POST", `/api/friends/${grace.uuid}`, { headers: between.headers });
    expect(await shares(ada)).toEqual([]);
    await ok("POST", `/api/friends/${between.uuid}/accept`, { headers: grace.headers });
    expect(await sharers(ada)).toEqual(["Grace"]);
    // A friendship ended is a reason no longer.
    await ok("DELETE", `/api/friends/${grace.uuid}`, { headers: between.headers });
    expect(await shares(ada)).toEqual([]);
  });

  it("leave out friends, anyone asked or asking, and whoever cannot be found", async () => {
    const ada = await register("ada@example.test", "Ada");
    const [friend, asked, asking, declined, unfindable, open] = await Promise.all(
      ["Friend", "Asked", "Asking", "Declined", "Unfindable", "Open"].map((name) => register(`${name.toLowerCase()}@example.test`, name)));
    await project(ada, "Control Lab", friend, asked, asking, declined, unfindable, open);
    expect((await names(ada)).sort()).toEqual(["Asked", "Asking", "Declined", "Friend", "Open", "Unfindable"]);

    await befriend(ada, friend);
    await ok("POST", `/api/friends/${asked.uuid}`, { headers: ada.headers });
    await ok("POST", `/api/friends/${ada.uuid}`, { headers: asking.headers });
    await ok("POST", `/api/friends/${ada.uuid}`, { headers: declined.headers });
    await ok("POST", `/api/friends/${declined.uuid}/decline`, { headers: ada.headers });
    await ok("PUT", "/api/auth/profile", { headers: unfindable.headers, json: { findable: false } });
    // Whoever she asked keeps their card for now, so she can take it back there.
    expect(await names(ada)).toEqual(["Asked", "Open"]);
    // Whoever she said Not now to still sees her card as asked, and learns nothing from it.
    expect(await names(declined)).toContain("Ada");
    expect(await names(asking)).toContain("Ada");
    // Someone who cannot be found is still suggested people.
    expect(await names(unfindable)).toContain("Open");
  });

  it("keep someone I asked for a week, whatever they answered, and let me take it back", async () => {
    const ada = await register("ada@example.test", "Ada"), grace = await register("grace@example.test", "Grace");
    await project(ada, "Control Lab", grace);
    await ok("POST", `/api/friends/${grace.uuid}`, { headers: ada.headers });
    expect(await names(ada)).toEqual(["Grace"]);
    // The one asked is not suggested the asker: the request is in her inbox.
    expect(await names(grace)).toEqual([]);
    // A quiet Not now changes nothing she can see.
    await ok("POST", `/api/friends/${ada.uuid}/decline`, { headers: grace.headers });
    expect(await names(ada)).toEqual(["Grace"]);
    await ok("DELETE", `/api/friends/${grace.uuid}`, { headers: ada.headers });
    expect(await names(ada)).toEqual(["Grace"]);
    // After a week the card goes; accepted, it goes at once.
    await exec("UPDATE friendships SET created_at = ?", new Date(Date.now() - 8 * 24 * 3600_000).toISOString());
    expect(await names(ada)).toEqual([]);
    const edsger = await register("edsger@example.test", "Edsger");
    await project(ada, "Second Lab", edsger);
    await ok("POST", `/api/friends/${edsger.uuid}`, { headers: ada.headers });
    expect(await names(ada)).toEqual(["Edsger"]);
    await ok("POST", `/api/friends/${ada.uuid}/accept`, { headers: edsger.headers });
    expect(await names(ada)).toEqual([]);
  });

  it("stop naming someone I am not interested in, and tell them nothing", async () => {
    const ada = await register("ada@example.test", "Ada"), grace = await register("grace@example.test", "Grace"), edsger = await register("edsger@example.test", "Edsger");
    await project(ada, "Control Lab", grace, edsger);
    const told = await count("notifications");
    const left = await ok("DELETE", `/api/friends/suggestions/${grace.uuid}`, { headers: ada.headers });
    expect(left.map((s: any) => s.user.display_name)).toEqual(["Edsger"]);
    await ok("DELETE", `/api/friends/suggestions/${grace.uuid}`, { headers: ada.headers });
    expect(await count("friend_suggestions")).toBe(1);
    expect(await names(ada)).toEqual(["Edsger"]);
    // It is hers alone: Grace is still suggested Ada, hears nothing, and can still be asked.
    expect((await names(grace)).sort()).toEqual(["Ada", "Edsger"]);
    expect(await count("notifications")).toBe(told);
    await ok("POST", `/api/friends/${grace.uuid}`, { headers: ada.headers });
    expect((await call("DELETE", `/api/friends/suggestions/${ada.uuid}`, { headers: ada.headers })).status).toBe(404);
    expect((await call("DELETE", `/api/friends/suggestions/${uuid()}`, { headers: ada.headers })).status).toBe(404);
    expect((await call("DELETE", `/api/friends/suggestions/${grace.uuid}`)).status).toBe(401);
  });

  it("go with a closed account", async () => {
    const ada = await register("ada@example.test", "Ada"), grace = await register("grace@example.test", "Grace");
    const between = await linked(ada, grace);
    await ok("DELETE", `/api/friends/suggestions/${grace.uuid}`, { headers: ada.headers });
    await ok("DELETE", `/api/friends/suggestions/${ada.uuid}`, { headers: grace.headers });
    const closed = await ok("DELETE", "/api/auth/account", { headers: grace.headers, json: { confirm_email: "grace@example.test" } });
    expect(closed.removed.friend_suggestions).toBe(2);
    expect(await suggested(ada)).toEqual([]);
    expect(await suggested(between)).toEqual([]);
  });

  it("say why in words", () => {
    const user = { uuid: "u", display_name: "Grace", affiliation: null, avatar_path: null, email: null };
    expect(reasonOf({ user, project_count: 1, projects: [{ uuid: "p", name: "Control Lab" }], mutual_count: 0 })).toBe("In Control Lab with you");
    expect(reasonOf({ user, project_count: 0, projects: [], mutual_count: 1 })).toBe("1 friend in common");
    expect(reasonOf({ user, project_count: 3, projects: [{ uuid: "p", name: "Control Lab" }], mutual_count: 2 }))
      .toBe("In Control Lab and 2 more projects with you, and 2 friends in common");
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

  // A cron (the week's, on Sunday evening, unless told the day's), then the
  // suggestions job it queued run with mail configured.
  const SUNDAY = Date.UTC(2026, 10, 22, 23), TUESDAY = Date.UTC(2026, 10, 24, 14);
  async function sunday(mailEnv: Env = { ...env, ...configured } as Env, scheduledTime = SUNDAY) {
    const ctx = createExecutionContext();
    await worker.scheduled(createScheduledController({ cron: scheduledTime === SUNDAY ? WEEKLY_CRON : DAILY_CRON, scheduledTime }), env, ctx);
    await waitOnExecutionContext(ctx);
    const queued = await rows<{ uuid: string }>("SELECT uuid FROM jobs WHERE kind = 'suggest_friends' AND status = 'queued' ORDER BY created_at");
    expect(queued.length).toBe(1);
    await runOne(mailEnv, await claim(env.DB, queued[0].uuid, "test") as Job);
    return row<Job>("SELECT * FROM jobs WHERE uuid = ?", queued[0].uuid);
  }
  const tuesday = () => sunday(undefined, TUESDAY);

  it("names whoever is new to each user, once, and says where to turn it off", async () => {
    const ada = await register("ada@example.test", "Ada"), grace = await register("grace@example.test", "Grace <b>Hopper</b>");
    const lone = await register("lone@example.test", "Lone");
    const lab = await project(ada, "Control Lab", grace);
    await exec("UPDATE users SET affiliation = 'Yale' WHERE uuid = ?", grace.uuid);

    emailApi();
    expect(await sunday()).toMatchObject({ status: "done", result: JSON.stringify({ sent: true, users: 3, recipients: 2 }) });
    // One batch, an email each, and none to whoever has nobody to be suggested.
    expect(calls.map((c) => c.url)).toEqual(["https://mail.example.test/emails/batch"]);
    expect(sent().map((m) => m.to[0]).sort()).toEqual(["ada@example.test", "grace@example.test"]);
    const hers = sent().find((m) => m.to[0] === "ada@example.test");
    expect(hers).toMatchObject({ from: "papol@example.test", subject: "Grace <b>Hopper</b> is on Papol too" });
    expect(hers.text).toContain("Hello Ada,");
    expect(hers.text).toContain("- Grace <b>Hopper</b> (Yale)\n  In Control Lab with you.\n  https://papol.io/u/" + grace.uuid);
    expect(hers.text).toContain("https://papol.io/lounge");
    expect(hers.text).toContain("Turn it off under Preferences on your page: https://papol.io/profile");
    // Someone else's name is words in the HTML, never markup.
    expect(hers.html).toContain(`<a href="https://papol.io/u/${grace.uuid}"`);
    expect(hers.html).toContain("Grace &lt;b&gt;Hopper&lt;/b&gt;");
    expect(hers.html).not.toContain("<b>Hopper");
    expect(hers.html).toContain('href="https://papol.io/profile"');

    // The next week has nobody new: nothing is sent, and the Lounge still shows her.
    emailApi();
    expect(await sunday()).toMatchObject({ result: JSON.stringify({ sent: true, users: 3, recipients: 0 }) });
    expect(calls).toEqual([]);
    expect((await names(ada)).sort()).toEqual(["Grace <b>Hopper</b>", "Lone"]);

    // Someone new is named alone, to those they are new to.
    const edsger = await register("edsger@example.test", "Edsger");
    const { invite_code } = await ok("POST", `/api/projects/${lab}/invite`, { headers: ada.headers });
    await ok("POST", `/api/project-invites/${invite_code}`, { headers: edsger.headers });
    emailApi();
    await sunday();
    expect(sent().map((m) => [m.to[0], m.subject]).sort()).toEqual([
      ["ada@example.test", "Edsger is on Papol too"],
      ["edsger@example.test", "People you may know on Papol"],
      ["grace@example.test", "Edsger is on Papol too"],
    ]);
    expect(lone.uuid).toBeTruthy();
  });

  it("is sent as often as each user chose in Preferences, and not about whoever they are not interested in", async () => {
    const ada = await register("ada@example.test", "Ada"), grace = await register("grace@example.test", "Grace"), edsger = await register("edsger@example.test", "Edsger");
    await project(ada, "Control Lab", grace, edsger);
    // It is weekly to begin with, and never is kept.
    expect((await ok("GET", "/api/auth/me", { headers: ada.headers })).emails.friend_suggestions).toBe("weekly");
    expect((await ok("PUT", "/api/auth/profile", { headers: ada.headers, json: { emails: { friend_suggestions: "never" } } })).emails.friend_suggestions).toBe("never");
    // Another choice made later leaves it so.
    expect((await ok("PUT", "/api/auth/profile", { headers: ada.headers, json: { findable: true } })).emails.friend_suggestions).toBe("never");
    await ok("DELETE", `/api/friends/suggestions/${edsger.uuid}`, { headers: grace.headers });
    await ok("PUT", "/api/auth/profile", { headers: edsger.headers, json: { emails: { friend_suggestions: "daily" } } });

    // The day's run writes only to whoever chose every day, and says so.
    emailApi();
    await tuesday();
    expect(sent().map((m) => m.to[0])).toEqual(["edsger@example.test"]);
    expect(sent()[0].text).toContain("Papol sends this once a day, when there is someone new to suggest.");
    // Sunday evening's writes to the weekly, and not to the daily.
    emailApi();
    await sunday();
    expect(sent().map((m) => m.to[0])).toEqual(["grace@example.test"]);
    expect(sent()[0].text).not.toContain("Edsger");
    expect(sent()[0].text).toContain("Papol sends this once a week");
    expect(await count("friend_suggestions", "user_uuid = ? AND mailed_at IS NOT NULL", ada.uuid)).toBe(0);
    // Back to weekly, the next Sunday evening writes to her.
    await ok("PUT", "/api/auth/profile", { headers: ada.headers, json: { emails: { friend_suggestions: "weekly" } } });
    emailApi();
    await tuesday();
    expect(sent()).toEqual([]);
    emailApi();
    await sunday();
    expect(sent().map((m) => m.to[0])).toEqual(["ada@example.test"]);
  });

  it("records nothing as said when the mail cannot be sent, or is not configured", async () => {
    const ada = await register("ada@example.test", "Ada"), grace = await register("grace@example.test", "Grace");
    await project(ada, "Control Lab", grace);
    expect(await sunday(env)).toMatchObject({ status: "done", result: JSON.stringify({ sent: false, skipped: "Email not configured" }) });
    emailApi(502);
    expect(await sunday()).toMatchObject({ status: "failed" });
    expect(await count("friend_suggestions")).toBe(0);
    // So the next week says it.
    emailApi();
    await sunday();
    expect(sent().length).toBe(2);
  });

  it("writes to everyone, a chunk of users to a job", async () => {
    const accounts = await Promise.all(Array.from({ length: 23 }, (_, i) => register(`reader${i}@example.test`, `Reader ${i}`)));
    await project(accounts[0], "Control Lab", ...accounts.slice(1));
    emailApi();
    expect(await sunday()).toMatchObject({ result: JSON.stringify({ sent: true, users: 20, recipients: 20 }) });
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
