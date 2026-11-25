// The day's and the week's email: what users chose to be sent daily or
// weekly, held, and sent by the daily cron.
import { createExecutionContext, createScheduledController, env, waitOnExecutionContext } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";

import worker from "../src/index";
import { DAILY_CRON } from "../src/jobs/digests";
import { claim, type Job } from "../src/jobs/queue";
import { runOne } from "../src/jobs/run";
import { count, exec, ok, register, row, rows, type Account } from "./helpers";

describe("email held for the day or the week", () => {
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
  const MONDAY = Date.UTC(2026, 10, 23, 14), TUESDAY = Date.UTC(2026, 10, 24, 14);

  // A day's cron, then the digest job it queued run with mail configured.
  async function day(scheduledTime: number, mailEnv: Env = { ...env, ...configured } as Env) {
    const ctx = createExecutionContext();
    await worker.scheduled(createScheduledController({ cron: DAILY_CRON, scheduledTime }), env, ctx);
    await waitOnExecutionContext(ctx);
    const queued = await rows<{ uuid: string }>("SELECT uuid FROM jobs WHERE kind = 'send_digests' AND status = 'queued' ORDER BY created_at");
    expect(queued.length).toBe(1);
    await runOne(mailEnv, await claim(env.DB, queued[0].uuid, "test") as Job);
    return row<Job>("SELECT * FROM jobs WHERE uuid = ?", queued[0].uuid);
  }
  const choose = (account: Account, emails: object) => ok("PUT", "/api/auth/profile", { headers: account.headers, json: { emails } });
  const ask = (asker: Account, asked: Account) => ok("POST", `/api/friends/${asked.uuid}`, { headers: asker.headers });

  it("goes daily to whoever chose every day, and on Monday to whoever chose every week", async () => {
    const daily = await register("daily@example.test", "Daily"), weekly = await register("weekly@example.test", "Weekly");
    const ada = await register("ada@example.test", "Ada"), grace = await register("grace@example.test", "Grace");
    await choose(daily, { friend_request: "daily" });
    await choose(weekly, { friend_request: "weekly" });
    await ask(ada, daily);
    await ask(ada, weekly);
    await ask(grace, weekly);
    expect(await count("jobs", "kind = 'send_email'")).toBe(0);

    // Tuesday: the daily one, as the email it would have been. The weekly waits.
    emailApi();
    expect(await day(TUESDAY)).toMatchObject({ status: "done", result: JSON.stringify({ sent: true, users: 2, emails: 1 }) });
    expect(sent().map((m) => [m.to[0], m.subject])).toEqual([["daily@example.test", "Ada asks to be friends on Papol"]]);
    expect(sent()[0].text).toContain("Ada asks to be friends on Papol.");
    expect(await rows("SELECT DISTINCT user_uuid FROM email_held")).toEqual([{ user_uuid: weekly.uuid }]);

    // Monday: the week's, several of a kind as one email, signed once.
    emailApi();
    await day(MONDAY);
    expect(sent().map((m) => [m.to[0], m.subject])).toEqual([["weekly@example.test", "2 friend requests on Papol"]]);
    const text: string = sent()[0].text;
    expect(text).toContain("Ada asks to be friends on Papol\n\nAda asks to be friends on Papol.");
    expect(text).toContain("Grace asks to be friends on Papol");
    expect(text.match(/— Papol/g)).toHaveLength(1);
    expect(await count("email_held")).toBe(0);

    // Nothing held, nothing sent.
    emailApi();
    expect(await day(MONDAY)).toMatchObject({ result: JSON.stringify({ sent: true, users: 0, emails: 0 }) });
    expect(calls).toEqual([]);
  });

  it("asks how often when it sends: never lets go of what waited, at once sends it", async () => {
    const quiet = await register("quiet@example.test", "Quiet"), eager = await register("eager@example.test", "Eager"), ada = await register("ada@example.test", "Ada");
    await choose(quiet, { friend_request: "weekly" });
    await choose(eager, { friend_request: "weekly" });
    await ask(ada, quiet);
    await ask(ada, eager);
    await choose(quiet, { friend_request: "never" });
    await choose(eager, { friend_request: "now" });
    emailApi();
    await day(TUESDAY);
    expect(sent().map((m) => m.to[0])).toEqual(["eager@example.test"]);
    expect(await count("email_held")).toBe(0);
  });

  it("keeps what is held when the mail cannot be sent, or is not configured", async () => {
    const daily = await register("daily@example.test", "Daily"), ada = await register("ada@example.test", "Ada");
    await choose(daily, { friend_request: "daily" });
    await ask(ada, daily);
    expect(await day(TUESDAY, env)).toMatchObject({ status: "done", result: JSON.stringify({ sent: false, skipped: "Email not configured" }) });
    emailApi(502);
    expect(await day(TUESDAY)).toMatchObject({ status: "failed" });
    expect(await count("email_held")).toBe(1);
    emailApi();
    await day(TUESDAY);
    expect(sent().length).toBe(1);
    expect(await count("email_held")).toBe(0);
  });

  it("gathers an admin's feedback reports", async () => {
    const admin = await register("admin@example.test", "Admin");
    await exec("UPDATE users SET is_admin = 1 WHERE uuid = ?", admin.uuid);
    await choose(admin, { feedback_report: "daily" });
    await ok("POST", "/api/feedback", { json: { content: "Cannot sign in" } });
    await ok("POST", "/api/feedback", { json: { content: "Boxes overlap" } });
    emailApi();
    await day(TUESDAY);
    expect(sent().map((m) => [m.to[0], m.subject])).toEqual([["admin@example.test", "2 Papol feedback reports"]]);
    expect(sent()[0].text).toContain("Papol feedback: Cannot sign in");
    expect(sent()[0].text).toContain("Papol feedback: Boxes overlap");
  });
});
